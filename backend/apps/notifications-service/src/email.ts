import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "@retainiq/observability";

export type EmailMessage = {
  to: string;
  subject: string;
  title: string;
  body: string;
  link?: string | null;
  /** Extra rows rendered as a list — used by digest emails. */
  items?: { title: string; body: string; when: string }[];
};

/**
 * SMTP sender. Configured entirely from env; when SMTP_HOST is unset the sender
 * is inert and callers fall back to logging (so dev/CI never tries to send).
 * Point SMTP_HOST at a local catcher (Mailpit/MailHog) to see real mail locally.
 */
export class EmailSender {
  private transport: Transporter | null = null;

  constructor(
    private readonly cfg: { host?: string; port: number; user?: string; pass?: string; from: string; appUrl: string; secure: boolean },
    private readonly logger: Logger,
  ) {
    if (cfg.host) {
      this.transport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
      });
    }
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  async send(msg: EmailMessage): Promise<boolean> {
    if (!this.transport) {
      this.logger.info({ to: msg.to, subject: msg.subject }, "email skipped (SMTP not configured)");
      return false;
    }
    try {
      await this.transport.sendMail({
        from: this.cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: this.renderText(msg),
        html: this.renderHtml(msg),
      });
      this.logger.info({ to: msg.to, subject: msg.subject }, "email sent");
      return true;
    } catch (error) {
      this.logger.error({ to: msg.to, err: String(error) }, "email send failed");
      return false;
    }
  }

  private renderText(msg: EmailMessage): string {
    const lines = [msg.title, "", msg.body];
    for (const it of msg.items ?? []) lines.push("", `• ${it.title} — ${it.body} (${it.when})`);
    if (msg.link) lines.push("", `${this.cfg.appUrl}${msg.link}`);
    return lines.join("\n");
  }

  private renderHtml(msg: EmailMessage): string {
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
    const items = (msg.items ?? [])
      .map(
        (it) =>
          `<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0">
             <div style="font-weight:600;color:#0f172a">${esc(it.title)}</div>
             <div style="color:#475569;font-size:14px">${esc(it.body)}</div>
             <div style="color:#94a3b8;font-size:12px">${esc(it.when)}</div>
           </td></tr>`,
      )
      .join("");
    const cta = msg.link
      ? `<p style="margin:24px 0 0"><a href="${this.cfg.appUrl}${msg.link}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">Open RetainIQ</a></p>`
      : "";
    return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
      <div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;font-weight:600">RetainIQ</div>
        <h1 style="margin:8px 0 4px;font-size:18px;color:#0f172a">${esc(msg.title)}</h1>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.5">${esc(msg.body)}</p>
        ${items ? `<table style="width:100%;border-collapse:collapse;margin-top:16px">${items}</table>` : ""}
        ${cta}
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:12px">You can change what you're emailed about in Notification settings.</p>
    </body></html>`;
  }
}
