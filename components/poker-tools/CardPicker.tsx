import {
  cardKey,
  cardLabel,
  RANKS,
  SUITS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  type PokerCard,
} from "../../lib/poker/cards";

type CardPickerProps = {
  disabledCards: ReadonlySet<string>;
  onSelect: (card: PokerCard) => void;
};

export default function CardPicker({ disabledCards, onSelect }: CardPickerProps) {
  return <section className="card-picker" aria-labelledby="card-picker-title">
    <div className="card-picker-heading">
      <div><span>BARALHO</span><h3 id="card-picker-title">Escolha uma carta</h3></div>
      <small>Cartas em uso ficam bloqueadas</small>
    </div>
    <div className="card-picker-table">
      {SUITS.map((suit) => <div className={`card-picker-row suit-${suit}`} key={suit}>
        <span className="picker-suit" title={SUIT_NAMES[suit]} aria-hidden="true">{SUIT_SYMBOLS[suit]}</span>
        <div>
          {RANKS.map((rank) => {
            const card: PokerCard = { rank, suit };
            const disabled = disabledCards.has(cardKey(card));
            return <button
              type="button"
              key={rank}
              disabled={disabled}
              aria-label={`${cardLabel(card)}${disabled ? ", já utilizada" : ""}`}
              onClick={() => onSelect(card)}
            ><span>{rank}</span><small aria-hidden="true">{SUIT_SYMBOLS[suit]}</small></button>;
          })}
        </div>
      </div>)}
    </div>
  </section>;
}
