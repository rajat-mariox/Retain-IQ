import { CreditCard } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { InvoiceBadge, SubscriptionBadge } from "@/components/ui/badges";
import { PaginatedTable } from "@/components/ui/Pagination";
import { SeatUpgradeNotice } from "@/components/billing/SeatUpgradeNotice";
import { PlanCatalog } from "@/components/billing/PlanCatalog";
import { TrialStatus } from "@/components/billing/TrialStatus";
import { getBilling } from "@/lib/api";
import { formatDate } from "@/lib/format";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ upgrade?: string; reason?: string }> }) {
  const params = await searchParams;
  const seatUpgrade = params.upgrade === "seats";
  const billing = await getBilling().catch(() => null);
  const sub = billing?.subscription ?? null;
  const invoices = billing?.invoices ?? [];
  const plans = billing?.plans ?? [];
  const seatUse = sub && sub.seats > 0 ? Math.round((sub.activeSeats / sub.seats) * 100) : 0;

  return (
    <>
      <Topbar title="Billing" subtitle="Subscription, seats and invoices" />
      <PageBody>
        {seatUpgrade ? <SeatUpgradeNotice reason={params.reason} /> : null}
        {sub ? <TrialStatus sub={sub} /> : null}
        {sub ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Current plan" subtitle="Your active subscription" action={<SubscriptionBadge status={sub.status} />} />
              <CardBody className="space-y-5">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-semibold text-slate-900">{sub.planName}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {sub.basePrice > 0
                        ? `${usd(sub.basePrice)}/mo${sub.includedSeats > 0 ? ` · ${sub.includedSeats} seats included` : ""}${sub.additionalSeatPrice > 0 ? ` · +${usd(sub.additionalSeatPrice)}/seat` : ""}`
                        : sub.additionalSeatPrice > 0
                          ? `${usd(sub.additionalSeatPrice)} / seat / month`
                          : "Free"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold tabular-nums text-slate-900">{usd(sub.mrr)}</p>
                    <p className="mt-1 text-xs text-slate-500">/ month</p>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Seat usage</span>
                    <span className="tabular-nums text-slate-700">
                      {sub.activeSeats} / {sub.seats} active{sub.seatLimit ? ` · ${sub.seatLimit} max` : ""}
                    </span>
                  </div>
                  <span className="block h-2 overflow-hidden rounded-full bg-panel-2">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, seatUse)}%` }} />
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-hairline/60 pt-4 text-sm">
                  <Field label="Current period" value={`${formatDate(sub.currentPeriodStart)} – ${formatDate(sub.currentPeriodEnd)}`} />
                  <Field label="Auto-renew" value={sub.autoRenew ? "On" : "Off"} />
                  {sub.trialEndsAt ? <Field label="Trial ends" value={formatDate(sub.trialEndsAt)} /> : null}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Plans" subtitle="Upgrade or switch tiers" />
              <CardBody>
                <PlanCatalog plans={plans} sub={sub} highlight />
              </CardBody>
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardBody className="flex items-center gap-3 py-6">
                <CreditCard className="size-5 text-slate-400" />
                <p className="text-sm text-slate-600">No active subscription — your organization is on the Free plan. Choose a plan below to get started.</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Plans" subtitle="Available tiers" />
              <CardBody>
                <ul className="space-y-2.5">
                  {plans.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="truncate text-sm font-medium text-slate-800">{p.name}</span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {p.basePrice > 0
                          ? `${usd(p.basePrice)}/mo${p.includedSeats > 0 ? ` · ${p.includedSeats} incl` : ""}`
                          : p.additionalSeatPrice > 0
                            ? `${usd(p.additionalSeatPrice)}/seat`
                            : "Free"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-slate-400">Ask an owner to activate a paid plan, or contact support to subscribe.</p>
              </CardBody>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader title="Billing history" subtitle="Recent invoices" />
          <PaginatedTable
            minWidth="min-w-[640px]"
            pageSize={8}
            head={
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Invoice</th>
                <th className="px-5 py-3 text-left font-medium">Period</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            }
            empty={
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-500">No invoices yet.</td>
              </tr>
            }
            rows={invoices.map((inv) => (
              <tr key={inv.invoiceNumber} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-800">{inv.invoiceNumber}</td>
                <td className="px-5 py-3 text-slate-600">{formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}</td>
                <td className="px-5 py-3"><InvoiceBadge status={inv.status} /></td>
                <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{usd(inv.totalAmount)}</td>
              </tr>
            ))}
          />
        </Card>
      </PageBody>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-800">{value}</p>
    </div>
  );
}
