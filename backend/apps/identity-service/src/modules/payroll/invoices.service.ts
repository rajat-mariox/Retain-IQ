import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { RatesService } from "./rates.service.js";

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
function weekStartOf(d: Date): Date {
  return addDays(d, -((d.getUTCDay() + 6) % 7));
}
const cents = (n: number) => Math.round(n);

type DraftLine = {
  projectId: string | null;
  employeeId: string | null;
  description: string;
  minutes: number;
  billRateCents: number;
  amountCents: number;
  /** Which rung of the rate ladder produced billRateCents — shown in preview. */
  rateSource: string;
};

/**
 * Client invoices: billable hours → money owed by a client.
 *
 * Lines are one row per project·person, priced with the bill rate in effect on
 * the work's own dates (resolved through RatesService's ladder) and snapshotted
 * onto the line. Only APPROVED timesheet hours are invoiceable when the org
 * requires approval — you should not bill a client for hours a manager hasn't
 * signed off.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
  ) {}

  // ---- generation ----------------------------------------------------------

  /**
   * Price a client's billable hours for a period. Pure computation — `generate`
   * persists the same result, so preview and invoice can never disagree.
   */
  private async computeLines(clientId: string, periodStart: Date, periodEnd: Date) {
    const ctx = requireTenantContext();
    const settings = await this.rates.getSettings();
    const endExclusive = addDays(periodEnd, 1);

    const projects = await this.prisma.project.findMany({ where: { orgId: ctx.orgId, clientId }, select: { id: true, name: true } });
    if (projects.length === 0) return { lines: [] as DraftLine[], currency: settings.currency, skipped: [] as string[] };
    const projectName = new Map(projects.map((p) => [p.id, p.name]));

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        orgId: ctx.orgId,
        projectId: { in: projects.map((p) => p.id) },
        billable: true, // non-billable hours are never invoiceable, by definition
        date: { gte: periodStart, lt: endExclusive },
      },
      select: { employeeId: true, projectId: true, date: true, minutes: true },
    });

    let usable = entries;
    if (settings.requireApproval) {
      const approved = await this.prisma.timesheet.findMany({
        where: { orgId: ctx.orgId, status: "APPROVED" },
        select: { employeeId: true, weekStart: true },
      });
      const ok = new Set(approved.map((t) => `${t.employeeId}:${iso(t.weekStart)}`));
      usable = entries.filter((e) => ok.has(`${e.employeeId}:${iso(weekStartOf(e.date))}`));
    }

    // One line per project·person. Rate is resolved on the LAST worked date in
    // the group — a mid-period rate change would need per-date lines, which the
    // MVP doesn't model.
    const groups = new Map<string, { projectId: string; employeeId: string; minutes: number; lastDate: Date }>();
    for (const e of usable) {
      if (!e.projectId) continue;
      const key = `${e.projectId}:${e.employeeId}`;
      const g = groups.get(key) ?? { projectId: e.projectId, employeeId: e.employeeId, minutes: 0, lastDate: e.date };
      g.minutes += e.minutes;
      if (e.date > g.lastDate) g.lastDate = e.date;
      groups.set(key, g);
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set([...groups.values()].map((g) => g.employeeId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const empName = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const lines: DraftLine[] = [];
    const skipped: string[] = [];
    for (const g of groups.values()) {
      const resolved = await this.rates.resolveBillRate(g.employeeId, g.projectId, g.lastDate);
      const who = empName.get(g.employeeId) ?? "Unknown";
      const what = projectName.get(g.projectId) ?? "Project";
      if (resolved.billRateCents == null) {
        // Billable hours with no rate: surfaced, never billed at zero.
        skipped.push(`${who} on ${what} (${(g.minutes / 60).toFixed(1)}h) — no bill rate`);
        continue;
      }
      lines.push({
        projectId: g.projectId,
        employeeId: g.employeeId,
        description: `${what} — ${who}`,
        minutes: g.minutes,
        billRateCents: resolved.billRateCents,
        amountCents: cents((g.minutes / 60) * resolved.billRateCents),
        rateSource: resolved.source,
      });
    }

    lines.sort((a, b) => b.amountCents - a.amountCents);
    return { lines, currency: settings.currency, skipped };
  }

  /** Dry-run: what would this client be invoiced for this period, and why. */
  async preview(query: { clientId: string; periodStart: string; periodEnd: string }) {
    const ctx = requireTenantContext();
    const client = await this.prisma.client.findFirst({ where: { id: query.clientId, orgId: ctx.orgId }, select: { id: true, name: true } });
    if (!client) throw new NotFoundException("Client not found.");
    const start = parseDate(query.periodStart);
    const end = parseDate(query.periodEnd);
    if (end < start) throw new BadRequestException("The end date must be on or after the start date.");

    const { lines, currency, skipped } = await this.computeLines(client.id, start, end);
    const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
    return {
      clientId: client.id,
      clientName: client.name,
      periodStart: iso(start),
      periodEnd: iso(end),
      currency,
      totals: { minutes: lines.reduce((s, l) => s + l.minutes, 0), subtotalCents: subtotal, totalCents: subtotal, lineCount: lines.length },
      lines,
      skipped,
    };
  }

  /** Next INV-0001-style number for the org. */
  private async nextInvoiceNumber(orgId: string, prefix: string): Promise<string> {
    const last = await this.prisma.clientInvoice.findFirst({
      where: { orgId, invoiceNumber: { startsWith: `${prefix}-` } },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });
    const n = last ? Number(last.invoiceNumber.split("-").pop()) || 0 : 0;
    return `${prefix}-${String(n + 1).padStart(4, "0")}`;
  }

  /** Create a DRAFT invoice from a client's billable hours for a period. */
  async generate(input: { clientId: string; periodStart: string; periodEnd: string; dueInDays?: number; note?: string }) {
    const ctx = requireTenantContext();
    const client = await this.prisma.client.findFirst({ where: { id: input.clientId, orgId: ctx.orgId }, select: { id: true, name: true } });
    if (!client) throw new NotFoundException("Client not found.");
    const start = parseDate(input.periodStart);
    const end = parseDate(input.periodEnd);
    if (end < start) throw new BadRequestException("The end date must be on or after the start date.");

    // Billing the same client twice for one period double-bills them.
    const clash = await this.prisma.clientInvoice.findFirst({
      where: { orgId: ctx.orgId, clientId: client.id, status: { not: "VOID" }, periodStart: { lte: end }, periodEnd: { gte: start } },
      select: { invoiceNumber: true, periodStart: true, periodEnd: true },
    });
    if (clash) {
      throw new ConflictException(`${clash.invoiceNumber} already covers ${iso(clash.periodStart)} → ${iso(clash.periodEnd)} for this client. Void it first, or pick another period.`);
    }

    const { lines, currency } = await this.computeLines(client.id, start, end);
    if (lines.length === 0) throw new BadRequestException("No invoiceable hours for this client in this period.");

    const settings = await this.rates.getSettings();
    const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
    const number = await this.nextInvoiceNumber(ctx.orgId, settings.invoicePrefix);

    const created = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.clientInvoice.create({
        data: {
          orgId: ctx.orgId,
          clientId: client.id,
          invoiceNumber: number,
          periodStart: start,
          periodEnd: end,
          currency,
          subtotalCents: subtotal,
          totalCents: subtotal,
          dueAt: input.dueInDays ? addDays(new Date(), input.dueInDays) : null,
          note: input.note?.trim() || null,
        },
      });
      await tx.clientInvoiceLine.createMany({
        data: lines.map((l) => ({
          orgId: ctx.orgId,
          invoiceId: inv.id,
          projectId: l.projectId,
          employeeId: l.employeeId,
          description: l.description,
          minutes: l.minutes,
          billRateCents: l.billRateCents,
          amountCents: l.amountCents,
        })),
      });
      return inv;
    });

    return this.get(created.id);
  }

  // ---- lifecycle -----------------------------------------------------------

  async list(query: { status?: string; clientId?: string } = {}) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (query.status) where.status = query.status;
    if (query.clientId) where.clientId = query.clientId;

    const rows = await this.prisma.clientInvoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { client: { select: { name: true } }, _count: { select: { lines: true } } },
    });
    return rows.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      clientId: i.clientId,
      clientName: i.client.name,
      status: i.status,
      periodStart: iso(i.periodStart),
      periodEnd: iso(i.periodEnd),
      currency: i.currency,
      totalCents: i.totalCents,
      lineCount: i._count.lines,
      issuedAt: i.issuedAt?.toISOString() ?? null,
      dueAt: i.dueAt ? iso(i.dueAt) : null,
      paidAt: i.paidAt?.toISOString() ?? null,
    }));
  }

  async get(id: string) {
    const ctx = requireTenantContext();
    const inv = await this.prisma.clientInvoice.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { client: { select: { name: true, contactEmail: true } }, lines: { orderBy: { amountCents: "desc" } } },
    });
    if (!inv) throw new NotFoundException("Invoice not found.");
    const org = await this.prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } });

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orgName: org?.name ?? "",
      clientId: inv.clientId,
      clientName: inv.client.name,
      clientEmail: inv.client.contactEmail,
      status: inv.status,
      periodStart: iso(inv.periodStart),
      periodEnd: iso(inv.periodEnd),
      currency: inv.currency,
      subtotalCents: inv.subtotalCents,
      totalCents: inv.totalCents,
      issuedAt: inv.issuedAt?.toISOString() ?? null,
      dueAt: inv.dueAt ? iso(inv.dueAt) : null,
      paidAt: inv.paidAt?.toISOString() ?? null,
      note: inv.note,
      totals: { minutes: inv.lines.reduce((s, l) => s + l.minutes, 0), lineCount: inv.lines.length },
      lines: inv.lines.map((l) => ({
        id: l.id,
        projectId: l.projectId,
        employeeId: l.employeeId,
        description: l.description,
        minutes: l.minutes,
        billRateCents: l.billRateCents,
        amountCents: l.amountCents,
      })),
    };
  }

  /** DRAFT → SENT. After this the invoice is issued and its lines are fixed. */
  async send(id: string) {
    const ctx = requireTenantContext();
    const inv = await this.prisma.clientInvoice.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, status: true } });
    if (!inv) throw new NotFoundException("Invoice not found.");
    if (inv.status !== "DRAFT") throw new ConflictException(`This invoice is already ${inv.status.toLowerCase()}.`);
    await this.prisma.clientInvoice.update({ where: { id: inv.id }, data: { status: "SENT", issuedAt: new Date() } });
    return this.get(id);
  }

  async markPaid(id: string) {
    const ctx = requireTenantContext();
    const inv = await this.prisma.clientInvoice.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, status: true } });
    if (!inv) throw new NotFoundException("Invoice not found.");
    if (inv.status !== "SENT") throw new ConflictException("Only a sent invoice can be marked paid.");
    await this.prisma.clientInvoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: new Date() } });
    return this.get(id);
  }

  /** Void rather than delete — an issued invoice number must stay accounted for. */
  async voidInvoice(id: string) {
    const ctx = requireTenantContext();
    const inv = await this.prisma.clientInvoice.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, status: true } });
    if (!inv) throw new NotFoundException("Invoice not found.");
    if (inv.status === "PAID") throw new ConflictException("A paid invoice cannot be voided.");
    await this.prisma.clientInvoice.update({ where: { id: inv.id }, data: { status: "VOID" } });
    return this.get(id);
  }
}
