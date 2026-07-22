type Entry = { key: string; label?: string; color?: string };

/** Look up a configured display label for a status/priority key (falls back to the key). */
export function labelOf(list: Entry[] | undefined, key: string): string {
  return list?.find((e) => e.key === key)?.label ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Look up a configured hex colour for a status/priority key (undefined → use the built-in tint). */
export function colorOf(list: Entry[] | undefined, key: string): string | undefined {
  return list?.find((e) => e.key === key)?.color;
}
