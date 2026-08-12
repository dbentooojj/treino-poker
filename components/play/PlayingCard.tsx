import { cardLabel, SUIT_SYMBOLS, suitColorClass, type PokerCard } from "../../lib/poker/cards";

export function PlayingCard({ card, faceDown = false, compact = false, animate = false }: { card: PokerCard; faceDown?: boolean; compact?: boolean; animate?: boolean }) {
  if (faceDown) return <div className={`play-card play-card--back ${compact ? "play-card--compact" : ""} ${animate ? "play-card--dealt" : ""}`} role="img" aria-label="Carta virada para baixo"><span aria-hidden="true">R</span></div>;
  return <div className={`play-card ${suitColorClass(card.suit)} ${compact ? "play-card--compact" : ""} ${animate ? "play-card--dealt" : ""}`} role="img" aria-label={cardLabel(card)}>
    <span className="play-card-rank">{card.rank}</span>
    <span className="play-card-suit" aria-hidden="true">{SUIT_SYMBOLS[card.suit]}</span>
  </div>;
}
