import type { PokerCard, Rank } from "../../lib/poker/cards";
import { actionAliases, actionKey, formatBb, type AnswerEvaluation, type TrainingAction, type TrainingExercise, type TrainingSequenceAction } from "../../lib/training";
import { PlayingCard } from "../play/PlayingCard";
import { UnifiedActionPanel } from "./UnifiedActionPanel";
import { UnifiedPokerTable, type UnifiedTableSeat } from "./UnifiedPokerTable";
import { UnifiedResultPanel } from "./UnifiedResultPanel";
import { buildTrainingPrompt, normalizeTrainingPosition, trainingTableSeats } from "./trainingPresentation";

export type SpotFeedback = {
  answer: AnswerEvaluation;
  selectedKey: string;
};

export function HeroHand({ handClass, compact = false, animate = false }: { handClass: string; compact?: boolean; animate?: boolean }) {
  const cards = handClassPokerCards(handClass);
  return <div className={`rl-hero-hand ${compact ? "compact" : ""}`} aria-label={`Sua mão: ${handClass}`}>
    {cards.map((card, index) => <PlayingCard key={`${card.rank}${card.suit}-${index}`} card={card} compact={compact} animate={animate}/>)}
  </div>;
}

export function TrainingDecision({ exercise, busy, feedback, nextLabel = "Próximo spot", onChoose, onRepeat, onNext }: {
  exercise: TrainingExercise;
  busy: boolean;
  feedback?: SpotFeedback | null;
  nextLabel?: string;
  onChoose: (action: TrainingAction) => void;
  onRepeat?: () => void;
  onNext?: () => void;
}) {
  return <section className="spot-training-decision" aria-labelledby="training-question">
    <div className="play-table-stage spot-table-stage"><SpotPokerTable exercise={exercise}/></div>
    {feedback ? <SpotResult exercise={exercise} feedback={feedback} nextLabel={nextLabel} onRepeat={onRepeat} onNext={onNext}/> : <SpotActionPanel exercise={exercise} busy={busy} onChoose={onChoose}/>}
  </section>;
}

export function TrainingTablePreview() {
  const seats = trainingTableSeats(8, "UTG").map<UnifiedTableSeat>((seat) => ({
    position: seat.label,
    positionKey: seat.position,
    stackBb: 40,
    dealer: seat.dealer,
  }));
  return <div className="unified-table-preview">
    <UnifiedPokerTable seats={seats} anchorPosition="UTG" phase="DEALING" showDeck showChips={false} showSeatDetails={false} ariaLabel="Prévia da mesa de treinamento"/>
  </div>;
}

function SpotPokerTable({ exercise }: { exercise: TrainingExercise }) {
  const actionHistory = new Map<string, TrainingSequenceAction>();
  exercise.actionSequence.forEach((action) => {
    if (action.position) actionHistory.set(normalizeTrainingPosition(action.position), action);
  });
  const heroPosition = normalizeTrainingPosition(exercise.heroPosition);
  const seats = trainingTableSeats(exercise.playersCount, exercise.heroPosition).map<UnifiedTableSeat>((seat) => {
    const normalized = normalizeTrainingPosition(seat.position);
    const hero = normalized === heroPosition;
    const sequenceEntry = actionHistory.get(normalized);
    return {
      position: seat.label,
      positionKey: seat.position,
      stackBb: exercise.heroStackBb,
      cards: hero ? handClassPokerCards(exercise.handClass) : [],
      cardsVisible: hero,
      visibleCards: hero ? 2 : 0,
      hero,
      active: hero,
      folded: sequenceEntry?.type === "FOLD",
      dealer: seat.dealer,
    };
  });
  return <UnifiedPokerTable
    seats={seats}
    anchorPosition={exercise.heroPosition}
    phase="PLAYING"
    showChips={false}
    showSeatDetails={false}
    className="spot-poker-table"
    ariaLabel={`Mesa do spot com ${exercise.playersCount} jogadores`}
  />;
}

function SpotActionPanel({ exercise, busy, onChoose }: { exercise: TrainingExercise; busy: boolean; onChoose: (action: TrainingAction) => void }) {
  return <UnifiedActionPanel
    eyebrow="SUA VEZ"
    title={buildTrainingPrompt(exercise)}
    context="Escolha a ação que você faria."
    titleId="training-question"
    busy={busy}
    className="spot-action-panel"
    actions={exercise.availableActions.map((action) => ({
      id: actionKey(action),
      label: actionResultLabel(action, exercise),
      tone: actionTone(action, exercise),
    }))}
    onAction={(selectedKey) => {
      const selected = exercise.availableActions.find((action) => actionKey(action) === selectedKey);
      if (selected) onChoose(selected);
    }}
  />;
}

function SpotResult({ exercise, feedback, nextLabel, onRepeat, onNext }: { exercise: TrainingExercise; feedback: SpotFeedback; nextLabel: string; onRepeat?: () => void; onNext?: () => void }) {
  const { answer } = feedback;
  const selectedAction = exercise.availableActions.find((action) => actionAliases(action).includes(feedback.selectedKey));
  const bestAction = exercise.availableActions.find((action) => actionAliases(action).includes(answer.bestKey));
  const selectedLabel = selectedAction ? actionResultLabel(selectedAction, exercise) : feedback.selectedKey;
  const bestLabel = bestAction ? actionResultLabel(bestAction, exercise) : answer.bestLabel;
  const summary = answer.correct
    ? answer.isMixed ? `${selectedLabel} faz parte da estratégia mista deste spot.` : `Você escolheu ${selectedLabel}. Boa decisão.`
    : `Você escolheu ${selectedLabel}. A ação de referência é ${bestLabel}.`;
  return <UnifiedResultPanel
    score={answer.correct ? 100 : 0}
    eyebrow="RESULTADO DO SPOT"
    title={answer.correct ? "DECISÃO CORRETA" : "REVISAR DECISÃO"}
    description={summary}
    reviews={[
      { id: "preflop", status: answer.correct ? "CORRECT" : "REVIEW", label: "Pré-flop" },
      { id: "best", status: "NOT_PLAYED", label: "Melhor ação", value: bestLabel },
    ]}
    repeatLabel="Repetir spot"
    nextLabel={nextLabel}
    tone={answer.correct ? "correct" : "review"}
    className="spot-result"
    titleId="spot-result-title"
    onRepeat={() => onRepeat?.()}
    onNext={() => onNext?.()}
  />;
}

function handClassPokerCards(handClass: string): [PokerCard, PokerCard] {
  const clean = handClass.trim().toUpperCase();
  const firstRank = clean[0] as Rank;
  const secondRank = clean[1] as Rank;
  return [
    { rank: firstRank, suit: "s" },
    { rank: secondRank, suit: clean.length > 2 && clean.endsWith("S") ? "s" : "h" },
  ];
}

function mainActionLabel(action: TrainingAction, exercise: TrainingExercise) {
  if (action.type === "FOLD") return "Fold";
  if (action.type === "CHECK") return "Check";
  if (action.type === "CALL") return "Call";
  if (typeof action.amountBb === "number" && action.amountBb >= exercise.heroStackBb - .01) return "All-in";
  if (exercise.trainingType === "OPEN_FOLD") return "Open";
  if (exercise.trainingType === "VS_OPEN") return "3-bet";
  return action.type === "BET" ? "Bet" : "Raise";
}

function actionResultLabel(action: TrainingAction, exercise: TrainingExercise) {
  const label = mainActionLabel(action, exercise);
  return typeof action.amountBb === "number" ? `${label} ${formatBb(action.amountBb)} BB` : label;
}

function actionTone(action: TrainingAction, exercise: TrainingExercise) {
  if (typeof action.amountBb === "number" && action.amountBb >= exercise.heroStackBb - .01) return "all_in";
  return action.type.toLowerCase();
}
