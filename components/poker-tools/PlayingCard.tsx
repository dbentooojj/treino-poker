import { cardLabel, SUIT_SYMBOLS, type PokerCard } from "../../lib/poker/cards";

type PlayingCardProps = {
  card: PokerCard | null;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
};

export default function PlayingCard({ card, label, selected, onSelect, onRemove }: PlayingCardProps) {
  return <div className={`tool-card-slot ${selected ? "selected" : ""} ${card ? `suit-${card.suit}` : "empty"}`}>
    <button
      type="button"
      className="tool-card-face"
      aria-label={card ? `${label}: ${cardLabel(card)}. Clique para trocar.` : `${label}: vazio. Clique para selecionar.`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {card ? <><b>{card.rank}</b><span aria-hidden="true">{SUIT_SYMBOLS[card.suit]}</span></> : <><b>?</b><small>selecionar</small></>}
    </button>
    {card && <button type="button" className="tool-card-remove" aria-label={`Remover ${cardLabel(card)} de ${label}`} onClick={onRemove}>×</button>}
  </div>;
}
