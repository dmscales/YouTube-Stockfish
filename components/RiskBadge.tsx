const STYLES: Record<string, { color: string; icon: string }> = {
  high: { color: "var(--critical)", icon: "▲" },
  medium: { color: "var(--serious)", icon: "◆" },
  low: { color: "var(--good)", icon: "●" },
  info: { color: "var(--accent)", icon: "i" },
};

/** Status color always ships with an icon and a text label, never color alone. */
export default function RiskBadge({ level, label }: { level: string; label?: string }) {
  const s = STYLES[level.toLowerCase()] ?? STYLES.info;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: s.color, color: "var(--text)" }}
    >
      <span aria-hidden style={{ color: s.color }}>{s.icon}</span>
      {label ?? level}
    </span>
  );
}
