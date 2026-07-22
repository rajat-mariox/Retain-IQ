"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { ProductivityRulesData } from "@/lib/api";

const input = "flex-1 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none";

type Lists = Pick<ProductivityRulesData, "productiveApps" | "productiveDomains" | "distractingApps" | "distractingDomains">;

function ChipList({ label, hint, tone, values, onChange }: { label: string; hint: string; tone: "green" | "rose"; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  const chip = tone === "green" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200";
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="mb-2 text-xs text-slate-400">{hint}</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.length === 0 ? <span className="text-xs text-slate-400">None</span> : values.map((v) => (
          <span key={v} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${chip}`}>
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="opacity-60 hover:opacity-100"><X className="size-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Add app or domain…" className={input} />
        <button onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-3.5" /> Add</button>
      </div>
    </div>
  );
}

export function ProductivityRulesPanel({ initial }: { initial: ProductivityRulesData }) {
  const router = useRouter();
  const [lists, setLists] = useState<Lists>({
    productiveApps: initial.productiveApps,
    productiveDomains: initial.productiveDomains,
    distractingApps: initial.distractingApps,
    distractingDomains: initial.distractingDomains,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Lists) => (v: string[]) => { setLists({ ...lists, [k]: v }); setSaved(false); };

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch("/api/productivity/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lists) });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save."); return; }
      setSaved(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader
        title="Productivity rules"
        subtitle="Which apps & websites count as productive vs distracting — used across My Time, insights & monitoring"
        action={<span className="text-xs text-slate-400">{initial.customized ? "Customized" : "Using defaults"}</span>}
      />
      <CardBody className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChipList label="Productive apps" hint="IDEs, dev tools, design, office (e.g. vscode, intellij, figma)" tone="green" values={lists.productiveApps} onChange={set("productiveApps")} />
          <ChipList label="Productive websites" hint="R&D, docs, AI tools, cloud consoles (e.g. github.com, chatgpt.com)" tone="green" values={lists.productiveDomains} onChange={set("productiveDomains")} />
          <ChipList label="Distracting apps" hint="Entertainment, games, social (e.g. steam, netflix)" tone="rose" values={lists.distractingApps} onChange={set("distractingApps")} />
          <ChipList label="Distracting websites" hint="Streaming, games, social (e.g. youtube.com, instagram.com)" tone="rose" values={lists.distractingDomains} onChange={set("distractingDomains")} />
        </div>
        <div className="flex items-center justify-end gap-3">
          {error ? <span className="text-sm text-rose-600">{error}</span> : null}
          {saved && !busy ? <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check className="size-4" /> Saved</span> : null}
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save rules"}</button>
        </div>
      </CardBody>
    </Card>
  );
}
