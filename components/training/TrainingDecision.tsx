"use client";

import { useEffect, useState } from "react";
import type { PokerCard, Rank } from "../../lib/poker/cards";
import { actionAliases, actionKey, formatBb, type AnswerEvaluation, type TrainingAction, type TrainingExercise, type TrainingSequenceAction, type TrainingTableContext, type TrainingViewMode } from "../../lib/training";
import { PlayingCard } from "../play/PlayingCard";
import { UnifiedActionPanel } from "./UnifiedActionPanel";
import { UnifiedPokerTable, type UnifiedTableSeat } from "./UnifiedPokerTable";
import { UnifiedResultPanel } from "./UnifiedResultPanel";
import { buildTrainingPrompt, deriveTrainingTableVisualState, normalizeTrainingPosition, sequenceActionLabel, visibleTrainingTableSeats } from "./trainingPresentation";

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

type TrainingDecisionProps = {
  exercise: TrainingExercise;
  busy: boolean;
  feedback?: SpotFeedback | null;
  nextLabel?: string;
  viewMode?: TrainingViewMode;
  onChoose: (action: TrainingAction) => void;
  onRepeat?: () => void;
  onNext?: () => void;
};

export function TrainingDecision(props: TrainingDecisionProps) {
  return props.viewMode === "full-hand"
    ? <FullHandReplayDecision {...props}/>
    : <TrainingDecisionContent {...props} viewMode="quick-decision" visibleActionCount={props.exercise.actionSequence.length}/>;
}

function FullHandReplayDecision(props: TrainingDecisionProps) {
  const { exercise } = props;
  const [sequenceStep, setSequenceStep] = useState(0);
  useEffect(() => {
    if (sequenceStep >= exercise.actionSequence.length) return;
    const timer = window.setTimeout(() => setSequenceStep((current) => Math.min(current + 1, exercise.actionSequence.length)), 650);
    return () => window.clearTimeout(timer);
  }, [exercise.actionSequence.length, sequenceStep]);
  const replaying = sequenceStep < exercise.actionSequence.length;
  const nextSequenceAction = exercise.actionSequence[sequenceStep];
  const visibleActionCount = replaying ? sequenceStep + 1 : sequenceStep;
  const replayStatus = replaying ? <div className="spot-sequence-replay" role="status" aria-live="polite">
      <span>DESDE O INÍCIO</span>
      <b>{nextSequenceAction?.position ?? `Ação ${sequenceStep + 1}`} {nextSequenceAction ? sequenceActionLabel(nextSequenceAction, sequenceStep, exercise.actionSequence) : ""}</b>
      <small>{sequenceStep + 1} de {exercise.actionSequence.length}</small>
    </div> : null;
  return <TrainingDecisionContent {...props} viewMode="full-hand" visibleActionCount={visibleActionCount} replayStatus={replayStatus}/>;
}

function TrainingDecisionContent({ exercise, busy, feedback, nextLabel = "Próximo spot", viewMode, visibleActionCount, replayStatus, onChoose, onRepeat, onNext }: TrainingDecisionProps & {
  viewMode: TrainingViewMode;
  visibleActionCount: number;
  replayStatus?: React.ReactNode;
}) {
  return <section className="spot-training-decision" data-training-view-mode={viewMode} aria-labelledby="training-question">
    <div className="play-table-stage spot-table-stage"><SpotPokerTable exercise={exercise} viewMode={viewMode} visibleActionCount={visibleActionCount}/></div>
    {replayStatus ?? (feedback ? <SpotResult exercise={exercise} feedback={feedback} nextLabel={nextLabel} onRepeat={onRepeat} onNext={onNext}/> : <SpotActionPanel exercise={exercise} busy={busy} onChoose={onChoose}/>)}</section>;
}

export function TrainingTablePreview({ context, loading = false }: { context: TrainingTableContext | null; loading?: boolean }) {
  const actionHistory = new Map<string, TrainingSequenceAction>();
  context?.actionSequence.forEach((action) => {
    if (action.position) actionHistory.set(normalizeTrainingPosition(action.position), action);
  });
  const heroPosition = context ? normalizeTrainingPosition(context.heroPosition) : "";
  const seats = context ? previewTableSeats(context).map<UnifiedTableSeat>((seat) => {
    const normalized = normalizeTrainingPosition(seat.position);
    const hero = normalized === heroPosition;
    return {
      position: seat.label,
      positionKey: seat.position,
      stackBb: hero ? context.heroStackBb : undefined,
      hero,
      active: hero,
      folded: actionHistory.get(normalized)?.type === "FOLD",
      dealer: seat.dealer,
    };
  }) : [];
  const emptyMessage = loading ? "Carregando estudos…" : "Nenhum estudo disponível";
  return <div className={`unified-table-preview ${context ? "" : "is-empty"}`}>
    <UnifiedPokerTable seats={seats} anchorPosition={context?.heroPosition ?? ""} phase="DEALING" showDeck={false} showChips={false} showSeatDetails={false} ariaLabel={context ? `Prévia real de ${context.studyName}` : "Mesa de treinamento sem estudo selecionado"}/>
    {!context && <div className="training-table-empty" role="status"><b>{emptyMessage}</b>{!loading && <span>Importe e publique um estudo para iniciar um treinamento.</span>}</div>}
  </div>;
}

function previewTableSeats(context: TrainingTableContext) {
  return visibleTrainingTableSeats(context.playersCount, context.heroPosition);
}

function SpotPokerTable({ exercise, viewMode, visibleActionCount }: { exercise: TrainingExercise; viewMode: TrainingViewMode; visibleActionCount: number }) {
  const tableState = deriveTrainingTableVisualState(exercise, viewMode, visibleActionCount);
  const seats = tableState.seats.map<UnifiedTableSeat>((seat) => {
    return {
      position: seat.label,
      positionKey: seat.position,
      stackBb: seat.stackBb,
      committedBb: seat.committedBb,
      cards: seat.cardsFaceUp ? handClassPokerCards(exercise.handClass) : [],
      cardsVisible: seat.cardsFaceUp,
      visibleCards: seat.hasCards ? 2 : 0,
      animateCards: viewMode === "full-hand",
      hero: seat.isHero,
      folded: seat.isFolded,
      inHand: seat.isActiveInHand,
      active: seat.isActing,
      allIn: seat.lastAction === "ALL_IN",
      dealer: seat.dealer,
      lastAction: seat.lastAction,
      action: seat.lastAction ? { label: seat.lastAction.replace("_", "-"), tone: seat.lastAction.toLowerCase() } : undefined,
    };
  });
  return <UnifiedPokerTable
    seats={seats}
    anchorPosition={exercise.heroPosition}
    phase="PLAYING"
    potBb={tableState.potBb}
    showDeck={false}
    showChips
    showPot={viewMode === "full-hand"}
    showSeatDetails
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
  if (action.label) return action.label;
  if (action.type === "FOLD") return "Fold";
  if (action.type === "CHECK") return "Check";
  if (action.type === "CALL") return "Call";
  if (typeof action.amountBb === "number" && action.amountBb >= exercise.heroStackBb - .01) return "All-in";
  if (exercise.trainingType === "OPEN_FOLD") return "Open";
  if (exercise.trainingType === "VS_OPEN") return "3-bet";
  if (exercise.trainingType === "VS_3_BET") return "4-bet";
  if (exercise.trainingType === "VS_4_BET") return "5-bet";
  return action.type === "BET" ? "Bet" : "Raise";
}

function actionResultLabel(action: TrainingAction, exercise: TrainingExercise) {
  const label = mainActionLabel(action, exercise);
  return typeof action.amountBb === "number" ? `${label} ${formatBb(action.amountBb)} BB` : label;
}

function actionTone(action: TrainingAction, exercise: TrainingExercise) {
  if (action.label?.toLowerCase().includes("all-in")) return "all_in";
  if (typeof action.amountBb === "number" && action.amountBb >= exercise.heroStackBb - .01) return "all_in";
  return action.type.toLowerCase();
}
