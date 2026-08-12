import type { PokerCard } from "../../lib/poker/cards";
import { PlayingCard } from "./PlayingCard";

export function CommunityBoard({ cards }: { cards: PokerCard[] }) {
  return <div className="play-board" aria-label={cards.length ? `Board com ${cards.length} cartas` : "Board vazio"}>
    {cards.map((card, index) => <PlayingCard card={card} animate key={`${card.rank}${card.suit}-${index}`}/>) }
  </div>;
}
