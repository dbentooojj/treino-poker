import type { EquityResult as EquityResultData } from "../../lib/poker/equity";

type EquityResultProps = {
  result: EquityResultData;
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

export default function EquityResult({ result }: EquityResultProps) {
  const heroEquity = percent(result.heroEquity);
  const tieRate = percent(result.tieRate);
  const villainEquity = percent(result.villainEquity);
  const heroWinRate = percent(result.heroWinRate);
  const villainWinRate = percent(result.villainWinRate);
  const outs = result.outs === null ? "—" : result.outs.toLocaleString("pt-BR");
  const resultDescription = `Resultados: Hero vence ${heroWinRate}, empate ${tieRate}, Vilão vence ${villainWinRate}`;

  return <section
    className="decision-equity"
    aria-label="Distribuição da equity"
  >
    <div className="equity-headlines">
      <div><span>Equity Hero</span><strong>{heroEquity}</strong></div>
      <div className="tie-headline"><span>Empate</span><strong>{tieRate}</strong></div>
      <div><span>Equity Vilão</span><strong>{villainEquity}</strong></div>
    </div>

    <div className="equity-distribution" aria-label={resultDescription}>
      <i className="hero" style={{ width: `${result.heroWinRate * 100}%` }} />
      <i className="tie" style={{ width: `${result.tieRate * 100}%` }} />
      <i className="villain" style={{ width: `${result.villainWinRate * 100}%` }} />
    </div>

    <dl className="decision-outcomes">
      <div className="outs"><dt>Outs</dt><dd>{outs}</dd></div>
      <div className="win"><dt>Vitória</dt><dd>{heroWinRate}</dd></div>
      <div className="loss"><dt>Derrota</dt><dd>{villainWinRate}</dd></div>
    </dl>
  </section>;
}
