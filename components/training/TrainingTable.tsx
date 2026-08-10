import { equityModelLabels, formatBb, trainingTypeLabels, type TrainingExercise } from "../../lib/training";
import { displayTrainingPosition, sequenceActionLabel } from "./trainingPresentation";

export function TrainingTable({ exercise, showHistory }: { exercise: TrainingExercise; showHistory: boolean }) {
  return <aside className={`rl-training-sidebar players-${exercise.playersCount}`} aria-label="Contexto do spot">
    <section className="rl-sidebar-card rl-context-card">
      <h2><SpotIcon name="target"/><span>CONTEXTO DO SPOT</span></h2>
      <dl>
        <ContextRow icon="players" label="Jogadores" value={String(exercise.playersCount)}/>
        <ContextRow icon="blinds" label="Blinds" value={formatBlinds(exercise.blinds)}/>
        <ContextRow icon="chip" label="BBA" value={exercise.blinds.ante ? formatChipAmount(exercise.blinds.ante) : "—"}/>
        <ContextRow icon="user" label="Posição do Hero" value={displayTrainingPosition(exercise.heroPosition, exercise.playersCount)} accent/>
        <ContextRow icon="stack" label="Stack do Hero" value={`${formatBb(exercise.heroStackBb)} BB`} accent/>
        <ContextRow icon="history" label="Ação até você" value={actionUntilHero(exercise)}/>
        <ContextRow icon="nodes" label="Tipo de treino" value={trainingTypeLabels[exercise.trainingType]}/>
        <ContextRow icon="chart" label="Modelo" value={equityModelLabels[exercise.equityModel]}/>
      </dl>
    </section>

    {showHistory && exercise.actionSequence.length > 0 && <section className="rl-sidebar-card rl-history-card">
      <h2><SpotIcon name="history"/><span>AÇÃO ANTERIOR</span></h2>
      <div className="rl-history-list">
        {exercise.actionSequence.map((action, index) => <div key={`${action.position ?? "action"}-${index}`}>
          <i>{shortPosition(action.position, index)}</i>
          <b>{action.position ? displayTrainingPosition(action.position, exercise.playersCount) : `Ação ${index + 1}`}</b>
          <span>{sequenceActionLabel(action, index, exercise.actionSequence)}</span>
        </div>)}
      </div>
    </section>}
  </aside>;
}

export function TrainingFeedbackContext({ exercise, children }: { exercise: TrainingExercise; children: React.ReactNode }) {
  return <section className="rl-feedback-context-card" aria-labelledby="feedback-context-title">
    <h2 id="feedback-context-title">CONTEXTO DO SPOT</h2>
    <div className="rl-feedback-context-grid">
      <dl>
        <ContextRow icon="players" label="Jogadores" value={String(exercise.playersCount)}/>
        <ContextRow icon="blinds" label="Blinds" value={formatBlinds(exercise.blinds)}/>
        <ContextRow icon="chip" label="BBA" value={exercise.blinds.ante ? formatChipAmount(exercise.blinds.ante) : "—"}/>
        <ContextRow icon="user" label="Posição do Hero" value={displayTrainingPosition(exercise.heroPosition, exercise.playersCount)} accent/>
        <ContextRow icon="stack" label="Stack do Hero" value={`${formatBb(exercise.heroStackBb)} BB`} accent/>
        <ContextRow icon="history" label="Ação até você" value={actionUntilHero(exercise)}/>
      </dl>
      <div className="rl-feedback-context-meta">
        <dl>
          <ContextRow icon="nodes" label="Tipo de treino" value={trainingTypeLabels[exercise.trainingType]}/>
          <ContextRow icon="chart" label="Modelo" value={equityModelLabels[exercise.equityModel]}/>
        </dl>
        {children}
      </div>
    </div>
  </section>;
}

function ContextRow({ icon, label, value, accent = false }: { icon: IconName; label: string; value: string; accent?: boolean }) {
  return <div><dt><SpotIcon name={icon}/>{label}</dt><dd className={accent ? "accent" : ""}>{value}</dd></div>;
}

type IconName = "target" | "players" | "blinds" | "chip" | "user" | "stack" | "history" | "nodes" | "chart";

function SpotIcon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "target") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3"/></svg>;
  if (name === "players" || name === "user") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.2 2.4-5 5.5-5s4.9 1.8 5.5 5M16 7.5a2.5 2.5 0 0 1 0 5M16.5 15c2.3.2 3.6 1.5 4 4"/></svg>;
  if (name === "blinds") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2M7 3l-2 3M17 3l2 3"/></svg>;
  if (name === "chip" || name === "stack") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/></svg>;
  if (name === "history") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 8V3m0 0h5M4 3l3.5 3.5A8 8 0 1 1 4 12"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "nodes") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6.5 7.5l4.3 8.6M17.5 7.5l-4.3 8.6"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6"/></svg>;
}

function formatBlinds(blinds: TrainingExercise["blinds"]) {
  return `${formatChipAmount(blinds.smallBlind)} / ${formatChipAmount(blinds.bigBlind)}`;
}

function formatChipAmount(value: number) {
  if (Number.isInteger(value) && value >= 1000) return value.toLocaleString("pt-BR");
  return formatBb(value);
}

function actionUntilHero(exercise: TrainingExercise) {
  if (!exercise.actionSequence.length) return "Sem ação anterior";
  const allFolds = exercise.actionSequence.every((action) => action.type === "FOLD");
  return allFolds ? "Folda até você" : sequenceActionLabel(exercise.actionSequence.at(-1)!, exercise.actionSequence.length - 1, exercise.actionSequence);
}

function shortPosition(position: string | undefined, index: number) {
  if (!position) return String(index + 1).padStart(2, "0");
  return position.replace("UTG+", "U+").slice(0, 4);
}
