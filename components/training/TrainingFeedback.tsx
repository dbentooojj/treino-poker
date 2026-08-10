import { actionKey, actionLabel, frequencyPercent, presentStrategy, recordValue, type AnswerEvaluation, type NodeRange, type TrainingExercise } from "../../lib/training";
import { RangeMatrix } from "./RangeMatrix";
import { SolverFrequencies } from "./SolverFrequencies";
import { HeroHand } from "./TrainingDecision";
import { TrainingFeedbackContext } from "./TrainingTable";

export function TrainingFeedback({ exercise, answer, choiceKey, range, isLast, onNext }: {
  exercise: TrainingExercise;
  answer: AnswerEvaluation;
  choiceKey: string;
  range: NodeRange;
  isLast: boolean;
  onNext: () => void;
}) {
  const strategy = presentStrategy(answer.strategy, exercise.availableActions, answer.isMixed);
  const selectedAction = exercise.availableActions.find((action) => actionKey(action) === choiceKey);
  const dominant = strategy.dominantAction;
  const selected = strategy.actions.find((item) => item.key === choiceKey);
  const mixed = strategy.isMixed;
  const selectedInStrategy = Boolean(selected?.isInStrategy);
  const recommendation = dominant ? actionLabel(dominant.action, exercise) : answer.bestLabel;
  const chosenLabel = selectedAction ? actionLabel(selectedAction, exercise) : "Sua ação";
  const tone = mixed ? "mixed" : answer.correct ? "good" : "bad";
  const mainMessage = mixed
    ? selectedInStrategy ? "Decisão dentro da estratégia" : "Essa ação foge da estratégia"
    : answer.correct ? "Boa decisão" : "Essa não era a melhor opção";
  const followup = mixed
    ? selectedInStrategy ? `Você escolheu ${chosenLabel}; o solver mistura ações neste spot.` : `O solver prefere ${recommendation} com maior frequência.`
    : answer.correct ? <>Você escolheu: <b>{chosenLabel}</b></> : <>Você escolheu <b>{chosenLabel}</b>. A recomendação é <b>{recommendation}</b>.</>;
  const explanation = buildExplanation(exercise, strategy, recommendation);

  return <section className={`rl-training-feedback tone-${tone}`} aria-live="polite">
    <div className="rl-feedback-columns">
      <div className="rl-feedback-primary">
        <header className="rl-feedback-header">
          <div className="rl-feedback-hand"><HeroHand handClass={exercise.handClass} compact/><b>{exercise.handClass}</b></div>
          <div className="rl-result-icon" aria-hidden="true">{mixed ? "!" : answer.correct ? "✓" : "×"}</div>
          <div className="rl-result-copy"><h1>{mainMessage}</h1><p>{followup}</p></div>
        </header>
        <SolverFrequencies exercise={exercise} answer={answer}/>
        <section className="rl-explanation-card"><h2><span>i</span> EXPLICAÇÃO</h2><p>{explanation}</p></section>
        <ExpectedValuePanel exercise={exercise} answer={answer} choiceKey={choiceKey}/>
      </div>
      <div className="rl-feedback-secondary">
        <RangeMatrix exercise={exercise} range={range}/>
        <TrainingFeedbackContext exercise={exercise}>
          <div className="rl-feedback-actions">
            <button className="rl-next-hand" type="button" onClick={onNext}>{isLast ? "Ver resultado" : "Próxima mão"}<span aria-hidden="true">→</span></button>
          </div>
        </TrainingFeedbackContext>
      </div>
    </div>
  </section>;
}

function ExpectedValuePanel({ exercise, answer, choiceKey }: { exercise: TrainingExercise; answer: AnswerEvaluation; choiceKey: string }) {
  const delta = answer.decisionClarity ?? evDifference(exercise, answer);
  const bestAction = exercise.availableActions.find((action) => actionKey(action) === answer.bestKey);
  const selectedAction = exercise.availableActions.find((action) => actionKey(action) === choiceKey);
  const bestEv = bestAction ? recordValue(answer.evs, bestAction) : null;
  const selectedEv = selectedAction ? recordValue(answer.evs, selectedAction) : null;
  const selectedLoss = bestEv !== null && selectedEv !== null ? Math.max(0, bestEv - selectedEv) : null;
  return <section className="rl-ev-card">
    <h2>VALOR ESPERADO (EV) · {evUnitLabel(exercise.evUnit)}</h2>
    <div className="rl-ev-table" role="table" aria-label="Valor esperado por ação">
      <div className="rl-ev-row header" role="row"><span>Ação</span><span>Frequência</span><span>EV</span></div>
      {exercise.availableActions.map((action) => {
        const frequency = frequencyPercent(recordValue(answer.strategy, action));
        const ev = recordValue(answer.evs, action);
        const best = actionKey(action) === answer.bestKey;
        return <div className={`rl-ev-row ${best ? "best" : ""}`} role="row" key={actionKey(action)}>
          <span>{actionLabel(action, exercise)}</span>
          <span>{frequency === null ? "—" : `${formatPercent(frequency)}%`}</span>
          <span>{ev === null ? "—" : formatEvWithUnit(ev, exercise.evUnit)}</span>
        </div>;
      })}
    </div>
    <div className="rl-ev-summary">
      <div><span>Melhor ação</span><b>{bestAction ? actionLabel(bestAction, exercise) : answer.bestLabel}</b></div>
      <div><span>Perda da escolha</span><b className={selectedLoss && selectedLoss > 0 ? "loss" : ""}>{selectedLoss === null ? "—" : selectedLoss > 0 ? `−${formatEvWithUnit(selectedLoss, exercise.evUnit)}` : formatEvWithUnit(0, exercise.evUnit)}</b></div>
      <div className="rl-delta-ev"><span>ΔEV</span><b>{delta === null ? "—" : `${delta >= 0 ? "+" : ""}${formatEvWithUnit(delta, exercise.evUnit)}`}</b></div>
    </div>
  </section>;
}

function buildExplanation(exercise: TrainingExercise, strategy: ReturnType<typeof presentStrategy>, recommendation: string) {
  if (strategy.isMixed) {
    const actions = strategy.actions.filter((item) => item.isInStrategy).map((item) => actionLabel(item.action, exercise));
    return `O solver mistura ${joinActions(actions)} com ${exercise.handClass} neste spot. As frequências mostram com que proporção cada linha deve ser usada.`;
  }
  const action = strategy.dominantAction?.action;
  if (!action) return `O estudo não disponibilizou frequência suficiente para explicar ${exercise.handClass} neste node.`;
  if (action.type === "FOLD") {
    if (exercise.trainingType === "CALL_VS_SHOVE") return `${exercise.handClass} fica fora do range de call contra o shove neste cenário. Preservar o stack tem valor esperado maior do que continuar.`;
    if (exercise.trainingType === "OPEN_FOLD") return `${exercise.handClass} fica fora do range de abertura do solver nesta posição e profundidade de stack.`;
    return `${exercise.handClass} fica fora do range de continuação do solver neste cenário. A linha com maior valor esperado é ${recommendation}.`;
  }
  if (exercise.trainingType === "PUSH_FOLD") return `Com ${exercise.heroStackBb} BB no ${exercise.heroPosition}, ${exercise.handClass} faz parte do range de shove. A combinação entre equidade e fold equity torna ${recommendation} a linha de maior valor esperado.`;
  if (exercise.trainingType === "CALL_VS_SHOVE") return `${exercise.handClass} está dentro do range de call do solver contra esse shove, considerando posição, stack efetivo e ranges envolvidos.`;
  if (exercise.trainingType === "OPEN_FOLD") return `${exercise.handClass} faz parte do range de abertura do solver nesta posição e profundidade de stack.`;
  return `${exercise.handClass} faz parte do range de ${recommendation.toLowerCase()} do solver neste cenário.`;
}

function evDifference(exercise: TrainingExercise, answer: AnswerEvaluation) {
  const values = exercise.availableActions
    .map((action) => recordValue(answer.evs, action))
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left);
  return values.length > 1 ? values[0] - values[1] : null;
}

function formatPercent(value: number) { return Number(value.toFixed(value >= 99.95 ? 0 : 1)); }
function formatEv(value: number) { return Number(value.toFixed(4)).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }); }
function formatEvWithUnit(value: number, unit: TrainingExercise["evUnit"]) { return `${formatEv(value)} ${evUnitLabel(unit)}`; }
function evUnitLabel(unit: TrainingExercise["evUnit"]) {
  if (unit === "CHIPS") return "fichas";
  if (unit === "BIG_BLINDS") return "BB";
  if (unit === "ICM_UTILITY") return "utilidade ICM";
  return "unidade não verificada";
}
function joinActions(actions: string[]) {
  if (actions.length < 2) return actions[0] ?? "as ações disponíveis";
  return `${actions.slice(0, -1).join(", ")} e ${actions.at(-1)}`;
}
