export function TrainingStats({ progress, accuracy, elapsed }: { progress: string; accuracy: number | null; elapsed: string }) {
  return <div className="rl-session-metrics" aria-label="Estatísticas da sessão">
    <div><span>MÃOS TREINADAS</span><b>{progress}</b></div>
    <div><span>ACERTO</span><b className={accuracy === null ? "muted" : "positive"}>{accuracy === null ? "--" : `${accuracy}%`}</b></div>
    <div><span>TEMPO</span><b>{elapsed}</b></div>
  </div>;
}
