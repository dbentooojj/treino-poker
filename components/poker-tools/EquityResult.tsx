import { formatCard, type PokerCard } from "../../lib/poker/cards";
import type { EquityResult as EquityResultData } from "../../lib/poker/equity";

type EquityResultProps = {
  result: EquityResultData;
  hero: PokerCard[];
  villain: PokerCard[];
  board: PokerCard[];
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function cards(cards: PokerCard[], fallback: string): string {
  return cards.length > 0 ? cards.map(formatCard).join("  ") : fallback;
}

export default function EquityResult({ result, hero, villain, board }: EquityResultProps) {
  return <section className="equity-result" aria-live="polite" aria-labelledby="equity-result-title">
    <div className="equity-result-heading">
      <div><span>RESULTADO</span><h3 id="equity-result-title">Equity heads-up</h3></div>
      <small>{result.method === "exact" ? `Enumeração exata · ${result.total.toLocaleString("pt-BR")} runouts` : `${result.total.toLocaleString("pt-BR")} simulações`}</small>
    </div>

    <div className="equity-headlines">
      <div><span>HERO</span><strong>{percent(result.heroEquity)}</strong><small>equity</small></div>
      <div className="tie-headline"><span>EMPATE</span><strong>{percent(result.tieRate)}</strong><small>do total</small></div>
      <div><span>VILÃO</span><strong>{percent(result.villainEquity)}</strong><small>equity</small></div>
    </div>

    <div className="equity-bar" aria-label={`Equity: Hero ${percent(result.heroEquity)}, Vilão ${percent(result.villainEquity)}`}>
      <i style={{ width: `${result.heroEquity * 100}%` }} />
    </div>
    <div className="equity-bar-labels"><span>Hero {percent(result.heroEquity)}</span><span>Vilão {percent(result.villainEquity)}</span></div>

    <div className="equity-breakdown">
      <div><span>Win Hero</span><b>{percent(result.heroWinRate)}</b></div>
      <div><span>Tie</span><b>{percent(result.tieRate)}</b></div>
      <div><span>Win Vilão</span><b>{percent(result.villainWinRate)}</b></div>
    </div>

    <dl className="equity-cards-summary">
      <div><dt>Hero</dt><dd>{cards(hero, "—")}</dd></div>
      <div><dt>Vilão</dt><dd>{cards(villain, "Mão aleatória")}</dd></div>
      <div><dt>Board</dt><dd>{cards(board, "Board aberto")}</dd></div>
    </dl>
  </section>;
}
