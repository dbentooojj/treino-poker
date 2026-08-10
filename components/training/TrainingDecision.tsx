import { actionKey, formatBb, type TrainingAction, type TrainingExercise, type TrainingSequenceAction } from "../../lib/training";
import { suitColorClass } from "../../lib/poker/cards";
import { buildTrainingPrompt, normalizeTrainingPosition, sequenceActionLabel, trainingTableSeats } from "./trainingPresentation";

export function HeroHand({ handClass, compact = false }: { handClass: string; compact?: boolean }) {
  const cards = handClassCards(handClass);
  return <div className={`rl-hero-hand ${compact ? "compact" : ""}`} aria-label={`Sua mão: ${handClass}`}>
    <PlayingCard rank={cards[0]} suit={cards[1]}/>
    <PlayingCard rank={cards[2]} suit={cards[3]}/>
  </div>;
}

export function TrainingDecision({ exercise, busy, onChoose }: { exercise: TrainingExercise; busy: boolean; onChoose: (action: TrainingAction) => void }) {
  return <section className="rl-decision-stage" aria-labelledby="training-question">
    <PokerArena exercise={exercise}/>

    <div className="rl-question-row">
      <div className="rl-hand-label"><span>SUA MÃO</span><b>{exercise.handClass}</b></div>
      <HeroHand handClass={exercise.handClass}/>
      <div className="rl-question-divider" aria-hidden="true"/>
      <div className="rl-question-copy">
        <h1 id="training-question">{buildTrainingPrompt(exercise)}</h1>
        <p>Escolha antes de ver como o solver joga.</p>
      </div>
    </div>

    <div className={`rl-decision-actions actions-${exercise.availableActions.length}`} aria-label="Escolha sua ação">
      {exercise.availableActions.map((action) => {
        return <button key={actionKey(action)} disabled={busy} onClick={() => onChoose(action)}>
          <ActionIcon action={action}/>
          <span><b>{mainActionLabel(action, exercise)}</b>{typeof action.amountBb === "number" && <small>{formatBb(action.amountBb)} BB</small>}</span>
        </button>;
      })}
    </div>
  </section>;
}

function PokerArena({ exercise }: { exercise: TrainingExercise }) {
  const seats = trainingTableSeats(exercise.playersCount, exercise.heroPosition);
  const actions = new Map<string, { action: TrainingSequenceAction; index: number }>();
  exercise.actionSequence.forEach((action, index) => {
    if (action.position) actions.set(normalizeTrainingPosition(action.position), { action, index });
  });

  return <div className={`rl-poker-arena players-${seats.length}`} aria-label={`Mesa de poker com ${exercise.playersCount} jogadores`}>
    <div className="rl-table-felt">
      <div className="rl-table-inner-line"/>
      <div className="rl-board-backs" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index}/>)}</div>
      <div className="rl-table-watermark"><span>R</span> RangeLab</div>
      {seats.map((seat, index) => {
        const normalized = normalizeTrainingPosition(seat.position);
        const hero = normalized === normalizeTrainingPosition(exercise.heroPosition);
        const sequenceEntry = actions.get(normalized);
        const folded = sequenceEntry?.action.type === "FOLD";
        return <div key={seat.position} data-hero={hero || undefined} data-folded={folded || undefined} className={`rl-table-seat position-${seat.placement}`}>
          {seat.dealer && <i className="rl-dealer-chip">D</i>}
          <b>{seat.label}</b>
          <span>{hero ? `${formatBb(exercise.heroStackBb)} BB` : sequenceEntry ? sequenceActionLabel(sequenceEntry.action, sequenceEntry.index, exercise.actionSequence) : `${formatBb(exercise.heroStackBb)} BB`}</span>
          {hero && <small>VOCÊ</small>}
          {!hero && !sequenceEntry && index >= seats.length - 2 && <small>AGUARDA</small>}
        </div>;
      })}
    </div>
  </div>;
}

function ActionIcon({ action }: { action: TrainingAction }) {
  const isDown = action.type === "FOLD";
  const isCheck = action.type === "CHECK";
  return <i className="rl-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {isCheck ? <path d="m6 12 4 4 8-9"/> : <><path d={isDown ? "M12 5v14M7 14l5 5 5-5" : "M12 19V5M7 10l5-5 5 5"}/></>}
  </svg></i>;
}

function PlayingCard({ rank, suit }: { rank: string; suit: string }) {
  return <div className={`rl-playing-card ${suitColorClass(suit)}`}><span>{rank}</span><b>{suit}</b></div>;
}

function handClassCards(handClass: string): [string, string, string, string] {
  const clean = handClass.trim().toUpperCase();
  if (clean.length === 2) return [clean[0], "♠", clean[1], "♥"];
  return [clean[0], "♠", clean[1], clean.endsWith("S") ? "♠" : "♥"];
}

function mainActionLabel(action: TrainingAction, exercise: TrainingExercise) {
  if (action.type === "FOLD") return "Fold";
  if (action.type === "CHECK") return "Check";
  if (action.type === "CALL") return "Call";
  if (typeof action.amountBb === "number" && action.amountBb >= exercise.heroStackBb - 0.01) return "All-in";
  if (exercise.trainingType === "OPEN_FOLD") return "Open";
  if (exercise.trainingType === "VS_OPEN") return "3-bet";
  return action.type === "BET" ? "Bet" : "Raise";
}
