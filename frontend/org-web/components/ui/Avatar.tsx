/**
 * A small initials avatar with a deterministic, name-derived tint. Purely
 * decorative identity aid — never the sole carrier of meaning (the name sits
 * beside it), so the tint pool is a neutral set, not the reserved status colors.
 */
const TINTS = [
  { bg: "bg-sky-100", fg: "text-sky-700" },
  { bg: "bg-violet-100", fg: "text-violet-700" },
  { bg: "bg-emerald-100", fg: "text-emerald-700" },
  { bg: "bg-amber-100", fg: "text-amber-700" },
  { bg: "bg-rose-100", fg: "text-rose-700" },
  { bg: "bg-teal-100", fg: "text-teal-700" },
  { bg: "bg-indigo-100", fg: "text-indigo-700" },
  { bg: "bg-fuchsia-100", fg: "text-fuchsia-700" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function tintFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const t = tintFor(name);
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ${t.bg} ${t.fg}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
