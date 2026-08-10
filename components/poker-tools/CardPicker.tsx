import {
  cardKey,
  cardLabel,
  RANKS,
  SUITS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  suitColorClass,
  type PokerCard,
} from "../../lib/poker/cards";

type CardPickerProps = {
  disabledCards: ReadonlySet<string>;
  selectionLabel: string;
  onSelect: (card: PokerCard) => void;
};

export default function CardPicker({ disabledCards, selectionLabel, onSelect }: CardPickerProps) {
  return <section className="card-picker inline-card-picker" aria-labelledby="card-picker-title">
    <div className="card-picker-heading">
      <div>
        <span>SELECIONAR CARTAS</span>
        <h3 id="card-picker-title">{selectionLabel}</h3>
      </div>
      <small>Cartas em uso ficam bloqueadas</small>
    </div>

    <div className="card-picker-scroll">
      <div className="card-picker-table">
        {SUITS.map((suit) => <div className={`card-picker-row ${suitColorClass(suit)}`} key={suit}>
          <span className="picker-suit" title={SUIT_NAMES[suit]}>
            <span aria-hidden="true">{SUIT_SYMBOLS[suit]}</span>
            <small>{SUIT_NAMES[suit]}</small>
          </span>
          <div>
            {RANKS.map((rank) => {
              const card: PokerCard = { rank, suit };
              const disabled = disabledCards.has(cardKey(card));
              return <button
                type="button"
                key={rank}
                disabled={disabled}
                className={disabled ? "in-use" : ""}
                aria-label={`${cardLabel(card)}${disabled ? ", já utilizada" : ""}`}
                onClick={() => onSelect(card)}
              ><span>{rank}</span>{disabled && <small aria-hidden="true">✓</small>}</button>;
            })}
          </div>
        </div>)}
      </div>
    </div>
  </section>;
}
