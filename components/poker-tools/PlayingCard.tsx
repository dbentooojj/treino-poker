import { cardLabel, suitColorClass, SUIT_SYMBOLS, type PokerCard } from "../../lib/poker/cards";

type PlayingCardProps = {
  card: PokerCard | null;
  label: string;
  selected: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSelect: () => void;
  onRemove: () => void;
};

export default function PlayingCard({ card, label, selected, disabled = false, placeholder, onSelect, onRemove }: PlayingCardProps) {
  return <div className={`tool-card-slot ${selected ? "selected" : ""} ${disabled ? "disabled" : ""} ${card ? suitColorClass(card.suit) : "empty"}`}>
    <button
      type="button"
      className="tool-card-face"
      aria-label={card ? `${label}: ${cardLabel(card)}. Clique para trocar.` : `${label}: vazio. Clique para selecionar.`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      {card ? <><b>{card.rank}</b><span aria-hidden="true">{SUIT_SYMBOLS[card.suit]}</span></> : placeholder ? <small>{placeholder}</small> : <><b>+</b><small>carta</small></>}
    </button>
    {card && <button type="button" className="tool-card-remove" aria-label={`Remover ${cardLabel(card)} de ${label}`} onClick={onRemove}>×</button>}
  </div>;
}
