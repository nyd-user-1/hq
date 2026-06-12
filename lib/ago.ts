// Compact relative time: "12s", "5m", "3h", "2d" ago. Accepts ms or ISO.
export function ago(at: number | string): string {
  const t = typeof at === "number" ? at : Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
