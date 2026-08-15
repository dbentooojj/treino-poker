import { formatBb } from "../../lib/training";
import type { HandResultState } from "../../lib/play/types";
import { UnifiedResultPanel } from "../training/UnifiedResultPanel";

const STREET_LABELS = { PREFLOP: "Pré-flop", FLOP: "Flop", TURN: "Turn", RIVER: "River" } as const;

export function HandResult({ result, onRepeat, onNext }: { result: HandResultState; onRepeat: () => void; onNext: () => void }) {
  return <UnifiedResultPanel
    score={result.score}
    eyebrow="RESULTADO DA MÃO"
    title="MÃO CONCLUÍDA"
    description={`${result.winnerLabel} · ${result.handLabel} · pote de ${formatBb(result.wonPotBb)} BB`}
    reviews={result.reviews.filter((review) => review.status !== "NOT_PLAYED").map((review) => ({ id: review.street, status: review.status, label: STREET_LABELS[review.street] }))}
    footer={typeof result.evDeltaBb === "number" ? <span>ΔEV total: <b className={result.evDeltaBb < 0 ? "is-negative" : ""}>{formatEvDelta(result.evDeltaBb)}</b></span> : undefined}
    repeatLabel="Repetir mão"
    nextLabel="Próxima mão"
    tone={result.score >= 75 ? "correct" : "review"}
    className="hand-result"
    titleId="play-result-title"
    onRepeat={onRepeat}
    onNext={onNext}
  />;
}

function formatEvDelta(value: number) {
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  const amount = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Math.abs(value));
  return `${sign}${amount} BB`;
}
