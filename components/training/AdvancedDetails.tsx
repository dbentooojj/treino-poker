import { actionLabel, recordValue, type AnswerEvaluation, type TrainingExercise } from "../../lib/training";

export function AdvancedDetails({ exercise, answer }: { exercise: TrainingExercise; answer: AnswerEvaluation }) {
  const difference = answer.decisionClarity ?? evDifference(exercise, answer);
  return <details className="training-disclosure advanced-details">
    <summary>Detalhes avançados <span>▾</span></summary>
    <div className="advanced-content">
      <h3>Detalhes do HRC</h3>
      {exercise.availableActions.map((action) => {
        const frequency = recordValue(answer.strategy, action);
        const ev = recordValue(answer.evs, action);
        const percentage = frequency === null ? null : frequency <= 1 ? frequency * 100 : frequency;
        return <div className="advanced-action" key={action.id ?? action.type}>
          <b>{actionLabel(action, exercise)}</b>
          <span>Frequência: {percentage === null ? "—" : `${Number(percentage.toFixed(1))}%`}</span>
          <span><abbr title="Valor esperado (EV) representa o resultado médio de uma decisão quando situações semelhantes se repetem muitas vezes.">Valor esperado (EV)</abbr>: {ev === null ? "—" : Number(ev.toFixed(4))}</span>
        </div>;
      })}
      {difference !== null && <p>Diferença de valor esperado: <b>ΔEV {Number(difference.toFixed(4))}</b></p>}
      <small>Unidade do estudo: {exercise.evUnit === "CHIPS" ? "fichas" : exercise.evUnit === "BIG_BLINDS" ? "BB" : exercise.evUnit === "ICM_UTILITY" ? "utilidade ICM" : "não verificada"}.</small>
    </div>
  </details>;
}

function evDifference(exercise: TrainingExercise, answer: AnswerEvaluation) {
  const values = exercise.availableActions.map((action) => recordValue(answer.evs, action)).filter((value): value is number => value !== null).sort((left, right) => right - left);
  return values.length > 1 ? values[0] - values[1] : null;
}
