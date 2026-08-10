import { actionLabel, presentStrategy, type AnswerEvaluation, type TrainingExercise } from "../../lib/training";

export function SolverFrequencies({ exercise, answer }: { exercise: TrainingExercise; answer: AnswerEvaluation }) {
  const strategy = presentStrategy(answer.strategy, exercise.availableActions, answer.isMixed);
  return <section className="rl-solver-card" aria-label={`Frequência do solver para ${exercise.handClass}`}>
    <h2>FREQUÊNCIA DO SOLVER</h2>
    {strategy.actions.map((item) => {
      const value = item.frequencyPercent ?? 0;
      return <div className="rl-frequency-row" key={item.key}>
        <div><span>{actionLabel(item.action, exercise)}</span><b>{item.frequencyPercent === null ? "—" : `${formatFrequency(value)}%`}</b></div>
        <div className="rl-frequency-track" role="progressbar" aria-label={`${actionLabel(item.action, exercise)}: ${value}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
          <i style={{ width: `${value}%` }}/>
        </div>
      </div>;
    })}
  </section>;
}

function formatFrequency(value: number) { return Number(value.toFixed(1)); }
