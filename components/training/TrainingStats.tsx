export function TrainingStats({ progress, elapsed }: { progress: string; elapsed: string }) {
  return <div className="rl-session-metrics" aria-label="Estatísticas da sessão">
    <div><span>MÃOS TREINADAS</span><b>{progress}</b></div>
    <div><span>ANÁLISE</span><b className="muted">AO FINAL</b></div>
    <div><span>TEMPO</span><b>{elapsed}</b></div>
  </div>;
}
