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
    reviews={result.reviews.map((review) => ({ id: review.street, status: review.status, label: STREET_LABELS[review.street] }))}
    repeatLabel="Repetir mão"
    nextLabel="Próxima mão"
    tone={result.score >= 75 ? "correct" : "review"}
    titleId="play-result-title"
    onRepeat={onRepeat}
    onNext={onNext}
  />;
}
