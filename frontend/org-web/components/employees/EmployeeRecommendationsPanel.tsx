"use client";

import { useEffect, useState } from "react";
import { Sparkles, TrendingUp, GraduationCap, BadgeAlert, HeartPulse, CalendarClock, Info } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

type Kind = "PROMOTION_READINESS" | "SKILL_GAP" | "CERTIFICATION_RENEWAL" | "RETENTION_RISK" | "CONFIRMATION_DUE";
interface Rec { kind: Kind; signal: string; suggestion: string; confidence: "LOW" | "MEDIUM" | "HIGH"; actionRequired: string }
interface Data { generatedAt: string; disclaimer: string; recommendations: Rec[] }

const KIND: Record<Kind, { icon: typeof Sparkles; label: string; tint: string }> = {
  PROMOTION_READINESS: { icon: TrendingUp, label: "Promotion readiness", tint: "text-emerald-600 bg-emerald-500/10" },
  SKILL_GAP: { icon: GraduationCap, label: "Skill gap", tint: "text-sky-600 bg-sky-500/10" },
  CERTIFICATION_RENEWAL: { icon: BadgeAlert, label: "Certification renewal", tint: "text-amber-600 bg-amber-500/10" },
  RETENTION_RISK: { icon: HeartPulse, label: "Retention risk", tint: "text-rose-600 bg-rose-500/10" },
  CONFIRMATION_DUE: { icon: CalendarClock, label: "Confirmation due", tint: "text-violet-600 bg-violet-500/10" },
};
const CONF: Record<string, string> = { HIGH: "text-emerald-700", MEDIUM: "text-amber-700", LOW: "text-slate-500" };

/** AI recommendations for an employee — read-only, advisory, human-review-gated. */
export function EmployeeRecommendationsPanel({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/recommendations`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const recs = data?.recommendations ?? [];
  if (!loading && recs.length === 0) return null; // nothing to suggest → don't clutter

  return (
    <Card>
      <CardHeader
        title="AI recommendations"
        subtitle="Suggestions for review — no action is taken automatically"
        action={<Sparkles className="size-4 text-brand" />}
      />
      <div className="space-y-2.5 p-4">
        {loading ? <p className="py-3 text-center text-sm text-slate-500">Analyzing…</p> : null}
        {recs.map((r, i) => {
          const k = KIND[r.kind];
          const Icon = k.icon;
          return (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-hairline p-3">
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${k.tint}`}><Icon className="size-4.5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{k.label}</span>
                  <span className={`text-[11px] font-medium ${CONF[r.confidence]}`}>{r.confidence.toLowerCase()} confidence</span>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">needs review</span>
                </div>
                <p className="text-sm text-slate-700">{r.suggestion}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{r.signal}</p>
              </div>
            </div>
          );
        })}
        {data?.disclaimer ? <p className="inline-flex items-start gap-1.5 pt-1 text-[11px] text-slate-400"><Info className="mt-px size-3 shrink-0" /> {data.disclaimer}</p> : null}
      </div>
    </Card>
  );
}
