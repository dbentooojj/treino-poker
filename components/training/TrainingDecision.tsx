"use client";

import { useEffect, useRef, useState } from "react";
import type { PokerCard, Rank } from "../../lib/poker/cards";
import { actionAliases, actionKey, classifyTrainingChoice, formatBb, recordValue, type AnswerEvaluation, type TrainingAction, type TrainingChoiceGrade, type TrainingExercise, type TrainingSequenceAction, type TrainingTableContext, type TrainingViewMode } from "../../lib/training";
import { PlayingCard } from "../play/PlayingCard";
import { UnifiedActionPanel } from "./UnifiedActionPanel";
import { UnifiedPokerTable, type UnifiedTableSeat } from "./UnifiedPokerTable";
import { UnifiedResultPanel, type UnifiedResultReview } from "./UnifiedResultPanel";
import { buildTrainingPrompt, deriveTrainingTableVisualState, displayTrainingPosition, normalizeTrainingPosition, sequenceActionLabel, visibleTrainingTableSeats } from "./trainingPresentation";

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
  nextCompactLabel?: string;
  nextCountdown?: number | null;
  nextAutoAdvanceActive?: boolean;
  nextDisabled?: boolean;
  nextAriaLabel?: string;
  viewMode?: TrainingViewMode;
  onChoose: (action: TrainingAction) => void;
  onRepeat?: () => void;
  onNext?: () => void;
  onFeedbackInteraction?: () => void;
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

function TrainingDecisionContent({ exercise, busy, feedback, nextLabel = "Próximo spot", nextCompactLabel, nextCountdown, nextAutoAdvanceActive, nextDisabled, nextAriaLabel, viewMode, visibleActionCount, replayStatus, onChoose, onRepeat, onNext, onFeedbackInteraction }: TrainingDecisionProps & {
  viewMode: TrainingViewMode;
  visibleActionCount: number;
  replayStatus?: React.ReactNode;
}) {
  return <section className="spot-training-decision" data-training-view-mode={viewMode} data-feedback={feedback ? "true" : "false"} aria-labelledby={feedback ? "spot-result-title" : "training-question"}>
    <MobileActionHistory exercise={exercise} visibleActionCount={visibleActionCount} feedback={Boolean(feedback)}/>
    <div className="play-table-stage spot-table-stage"><SpotPokerTable exercise={exercise} viewMode={viewMode} visibleActionCount={visibleActionCount}/></div>
    {replayStatus ?? (feedback ? <SpotResult exercise={exercise} feedback={feedback} nextLabel={nextLabel} nextCompactLabel={nextCompactLabel} nextCountdown={nextCountdown} nextAutoAdvanceActive={nextAutoAdvanceActive} nextDisabled={nextDisabled} nextAriaLabel={nextAriaLabel} viewMode={viewMode} onRepeat={onRepeat} onNext={onNext} onFeedbackInteraction={onFeedbackInteraction}/> : <SpotActionPanel exercise={exercise} busy={busy} onChoose={onChoose}/>)}</section>;
}

function MobileActionHistory({ exercise, visibleActionCount, feedback }: { exercise: TrainingExercise; visibleActionCount: number; feedback: boolean }) {
  const actions = exercise.actionSequence.slice(0, Math.max(0, Math.min(visibleActionCount, exercise.actionSequence.length)));
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollLeft = history.scrollWidth;
  }, [actions.length, feedback]);
  return <div ref={historyRef} className="spot-action-history" aria-label="Histórico de ações da mão">
    <div>
      {actions.map((action, index) => <span className={index === actions.length - 1 ? "is-latest" : ""} key={`${action.position ?? "action"}-${index}`}>
        <b>{action.position ? displayTrainingPosition(action.position, exercise.playersCount) : `${index + 1}`}</b>
        <small>{sequenceActionLabel(action, index, exercise.actionSequence)}</small>
      </span>)}
      <span className="is-current" aria-current="step">{feedback ? "Resultado" : actions.length < exercise.actionSequence.length ? "Em andamento" : "Sua vez"}</span>
    </div>
  </div>;
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
    };
  });
  return <UnifiedPokerTable
    seats={seats}
    anchorPosition={exercise.heroPosition}
    phase="PLAYING"
    potBb={tableState.potBb}
    showDeck={false}
    showChips
    showPot
    showSeatDetails
    centerLabel={tableCenterLabel(exercise)}
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

function SpotResult({ exercise, feedback, nextLabel, nextCompactLabel, nextCountdown, nextAutoAdvanceActive, nextDisabled, nextAriaLabel, viewMode, onRepeat, onNext, onFeedbackInteraction }: { exercise: TrainingExercise; feedback: SpotFeedback; nextLabel: string; nextCompactLabel?: string; nextCountdown?: number | null; nextAutoAdvanceActive?: boolean; nextDisabled?: boolean; nextAriaLabel?: string; viewMode: TrainingViewMode; onRepeat?: () => void; onNext?: () => void; onFeedbackInteraction?: () => void }) {
  const { answer } = feedback;
  const selectedAction = exercise.availableActions.find((action) => actionAliases(action).includes(feedback.selectedKey));
  const bestAction = exercise.availableActions.find((action) => actionAliases(action).includes(answer.bestKey));
  const selectedLabel = selectedAction ? actionResultLabel(selectedAction, exercise) : feedback.selectedKey;
  const bestLabel = bestAction ? actionResultLabel(bestAction, exercise) : answer.bestLabel;
  const classification = classifyTrainingChoice(feedback.selectedKey, exercise.availableActions, answer.bestKey, answer.strategy, answer.isMixed);
  const grade = classification?.grade ?? (answer.correct ? "CORRECT" : "WRONG");
  const dominantLabel = classification?.dominantAction ? actionResultLabel(classification.dominantAction.action, exercise) : bestLabel;
  const selectedFrequency = classification?.selectedAction?.frequencyPercent ?? null;
  const presentation = resultPresentation(grade);
  const summary = grade === "BEST"
    ? `Você escolheu ${selectedLabel}, a ação de maior EV${answer.isMixed ? " deste mix" : " da estratégia"}.`
    : grade === "CORRECT"
      ? `Você escolheu ${selectedLabel}. A ação faz parte do mix; ${dominantLabel} aparece com mais frequência.`
      : grade === "INACCURACY"
        ? `Você escolheu ${selectedLabel}. O solver usa essa ação raramente neste spot.`
        : `Você escolheu ${selectedLabel}. Essa ação não faz parte da estratégia do solver.`;
  const evDelta = selectedAction ? decisionEvDelta(selectedAction, exercise.availableActions, answer.evs) : null;
  const reviews: UnifiedResultReview[] = [
    ...(viewMode === "full-hand" ? [{ id: "preflop", status: grade, label: "Pré-flop" }] : []),
  ];
  return <UnifiedResultPanel
    score={answer.correct ? 100 : 0}
    metricValue={selectedFrequency === null ? "—" : `${formatFrequency(selectedFrequency)}%`}
    metricLabel="Frequência GTO"
    metricProgress={selectedFrequency ?? 0}
    resultIcon={presentation.icon}
    badge={answer.isMixed ? "ESTRATÉGIA MISTA" : undefined}
    eyebrow="RESULTADO DO SPOT"
    title={presentation.title}
    description={summary}
    reviews={reviews}
    details={<div className="spot-selected-choice" aria-label={`Escolha: ${selectedLabel}${selectedFrequency === null ? "" : `, ${formatFrequency(selectedFrequency)}% de frequência GTO`}`}><span>Escolha</span><b>{selectedLabel}</b>{selectedFrequency !== null && <strong>{formatFrequency(selectedFrequency)}% GTO</strong>}</div>}
    footer={evDelta !== null ? <span>ΔEV da decisão: <b className={evDelta < 0 ? "is-negative" : ""}>{formatDecisionEv(evDelta, exercise.evUnit)}</b></span> : undefined}
    repeatLabel="Repetir spot"
    nextLabel={nextLabel}
    nextCompactLabel={nextCompactLabel}
    nextCountdown={nextCountdown}
    nextAutoAdvanceActive={nextAutoAdvanceActive}
    nextDisabled={nextDisabled}
    nextAriaLabel={nextAriaLabel}
    tone={presentation.tone}
    className="spot-result"
    titleId="spot-result-title"
    onInteraction={onFeedbackInteraction}
    onRepeat={() => onRepeat?.()}
    onNext={() => onNext?.()}
  />;
}

function resultPresentation(grade: TrainingChoiceGrade) {
  if (grade === "BEST") return { icon: "✓✓", title: "MELHOR JOGADA", tone: "best" as const };
  if (grade === "CORRECT") return { icon: "✓", title: "JOGADA CORRETA", tone: "correct" as const };
  if (grade === "INACCURACY") return { icon: "!", title: "IMPRECISÃO", tone: "inaccuracy" as const };
  return { icon: "×", title: "JOGADA ERRADA", tone: "wrong" as const };
}

function decisionEvDelta(selectedAction: TrainingAction, actions: TrainingAction[], evs: Record<string, number>) {
  const selectedEv = recordValue(evs, selectedAction);
  const availableEvs = actions.map((action) => recordValue(evs, action)).filter((value): value is number => value !== null && Number.isFinite(value));
  return selectedEv === null || availableEvs.length === 0 ? null : selectedEv - Math.max(...availableEvs);
}

function formatFrequency(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function formatDecisionEv(value: number, unit: TrainingExercise["evUnit"]) {
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  const amount = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Math.abs(value));
  if (unit === "BIG_BLINDS") return `${sign}${amount} BB`;
  if (unit === "CHIPS") return `${sign}${amount} fichas`;
  if (unit === "ICM_UTILITY") return `${sign}${amount} ICM`;
  return `${sign}${amount}`;
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

function tableCenterLabel(exercise: TrainingExercise) {
  const hero = displayTrainingPosition(exercise.heroPosition, exercise.playersCount);
  const latestActor = [...exercise.actionSequence].reverse().find((action) => action.position && action.type !== "FOLD")?.position;
  return latestActor
    ? `${displayTrainingPosition(latestActor, exercise.playersCount)} vs ${hero}`
    : `${exercise.playersCount}-max · ${hero}`;
}
