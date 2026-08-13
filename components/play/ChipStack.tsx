import { formatBb } from "../../lib/training";

const CHIP_COLORS = ["white", "red", "blue", "green", "black"] as const;

export function ChipStack({ amountBb, compact = false }: { amountBb: number; compact?: boolean }) {
  if (amountBb <= 0) return null;
  const count = Math.max(1, Math.min(7, Math.ceil(amountBb / 1.25)));
  return <div className={`play-chip-display ${compact ? "play-chip-display--compact" : ""}`} aria-label={`${formatBb(amountBb)} big blinds`}>
    <span className="play-chip-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <i className={`play-chip play-chip--${CHIP_COLORS[index % CHIP_COLORS.length]}`} style={{ "--chip-index": index } as React.CSSProperties} key={index}/>) }
    </span>
    {!compact && <b>{formatBb(amountBb)} BB</b>}
  </div>;
}
