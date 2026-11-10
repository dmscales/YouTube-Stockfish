export function ts(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function pct(x: number | null | undefined, digits = 0): string {
  return x == null ? "-" : `${(x * 100).toFixed(digits)}%`;
}

export function bytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Parse retention points, one per line (or separated by ";"):
 *   "0 100", "3, 78", "0:15 61%", "1:02\t40"
 * Time is seconds or m:ss. Value is percent of viewers still watching.
 */
export function parseRetention(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const raw of text.split(/[\n;]+/)) {
    const parts = raw.trim().replace(/%/g, "").split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const [tRaw, vRaw] = parts;
    const tm = tRaw.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)s?$/);
    const v = Number(vRaw);
    if (!tm || !Number.isFinite(v)) continue;
    const t = tm[1] ? Number(tm[1]) * 60 + Number(tm[2]) : Number(tm[2]);
    out.push([t, v]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
