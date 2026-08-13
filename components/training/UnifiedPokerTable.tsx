import type { PokerCard } from "../../lib/poker/cards";
import { formatBb } from "../../lib/training";
import { ChipStack } from "../play/ChipStack";
import { CommunityBoard } from "../play/CommunityBoard";
import { PlayingCard } from "../play/PlayingCard";
import { PotDisplay } from "../play/PotDisplay";

export type UnifiedTableSeat = {
  position: string;
  positionKey?: string;
  stackBb?: number;
  committedBb?: number;
  detail?: string;
  cards?: PokerCard[];
  cardsVisible?: boolean;
  visibleCards?: number;
  hero?: boolean;
  folded?: boolean;
  allIn?: boolean;
  active?: boolean;
  winner?: boolean;
  dealer?: boolean;
  mucking?: boolean;
  action?: { label: string; tone: string };
};

export type UnifiedPokerTableProps = {
  seats: UnifiedTableSeat[];
  anchorPosition: string;
  phase: string;
  potBb?: number;
  board?: PokerCard[];
  muckCount?: number;
  collecting?: boolean;
  showDeck?: boolean;
  showChips?: boolean;
  showSeatDetails?: boolean;
  payout?: { label: string; amountBb: number } | null;
  className?: string;
  ariaLabel?: string;
};

export function UnifiedPokerTable({ seats, anchorPosition, phase, potBb = 0, board = [], muckCount = 0, collecting = false, showDeck = true, showChips = true, showSeatDetails = true, payout, className = "", ariaLabel = "Mesa de treinamento" }: UnifiedPokerTableProps) {
  const orderedSeats = rotateSeatsToAnchor(seats, anchorPosition);
  const coordinates = tableSeatCoordinates(orderedSeats.length);
  return <div className={`play-table-frame unified-training-table play-phase-${phase.toLowerCase()} ${className}`} data-seat-count={orderedSeats.length} role="group" aria-label={ariaLabel}>
    <div className="play-table-rail">
      <div className="play-table-felt">
        <div className="play-felt-mark" aria-hidden="true">RANGELAB</div>
        {showDeck && <div className="play-deck" role="img" aria-label="Baralho"><i/><i/></div>}
        <div className="play-muck" role="img" aria-label={`${muckCount} folds no muck`}>
          {Array.from({ length: Math.min(muckCount, 7) }, (_, index) => <i style={{ "--muck-index": index } as React.CSSProperties} key={index}/>) }
        </div>
        {showChips && <PotDisplay amountBb={potBb}/>}
        <CommunityBoard cards={board}/>
        {showChips && payout && <div className="play-pot-payout"><span>{payout.label}</span><b>+{formatBb(payout.amountBb)} BB</b></div>}
        {orderedSeats.map((seat, index) => <UnifiedPokerSeat key={seat.positionKey ?? seat.position} seat={seat} slot={index + 1} coordinate={coordinates[index]} showDetails={showSeatDetails}/>)}
        {showChips && orderedSeats.map((seat, index) => {
          const coordinate = coordinates[index];
          const betCoordinate = inwardCoordinate(coordinate);
          const style = { "--table-bet-x": `${betCoordinate[0]}%`, "--table-bet-y": `${betCoordinate[1]}%` } as React.CSSProperties;
          return <div style={style} className={`play-bet-zone play-bet-zone-${index + 1} ${collecting && (seat.committedBb ?? 0) > 0 ? "play-bet-zone--collecting" : ""}`} key={seat.positionKey ?? seat.position}>
            <ChipStack amountBb={seat.committedBb ?? 0}/>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

function UnifiedPokerSeat({ seat, slot, coordinate, showDetails }: { seat: UnifiedTableSeat; slot: number; coordinate: [number, number]; showDetails: boolean }) {
  const showCards = !seat.folded || seat.mucking;
  const cards = seat.cards ?? [];
  const visibleCards = seat.visibleCards ?? cards.length;
  const style = { "--table-seat-x": `${coordinate[0]}%`, "--table-seat-y": `${coordinate[1]}%` } as React.CSSProperties;
  return <div style={style} className={`play-seat play-seat-${slot} ${seat.hero ? "play-seat--hero" : ""} ${seat.active ? "play-seat--active" : ""} ${seat.winner ? "play-seat--winner" : ""} ${seat.folded && !seat.mucking ? "play-seat--folded" : ""} ${seat.mucking ? "play-seat--mucking" : ""}`} data-position={seat.position} data-hero={seat.hero || undefined}>
    <div className="play-hole-cards" role="group" aria-label={`Cartas de ${seat.hero ? `${seat.position}, Hero` : seat.position}`}>
      {showCards && cards.slice(0, visibleCards).map((card, cardIndex) => <PlayingCard key={`${card.rank}${card.suit}-${cardIndex}`} card={card} compact faceDown={!seat.cardsVisible} animate/>)}
    </div>
    <div className="play-player-box">
      {seat.dealer && <i className="play-dealer" aria-label="Dealer">D</i>}
      <strong>{seat.position}{seat.hero && <small>VOCÊ</small>}</strong>
      {showDetails && <span>{seat.detail ?? (seat.stackBb === undefined ? "Stack indisponível" : `${formatBb(seat.stackBb)} BB${seat.allIn ? " · ALL-IN" : ""}`)}</span>}
    </div>
    {seat.action && <div className={`play-action-tag play-action-tag--${seat.action.tone}`}>{seat.action.label}</div>}
  </div>;
}

function rotateSeatsToAnchor<T extends { position: string; positionKey?: string }>(seats: T[], anchorPosition: string) {
  const anchorIndex = seats.findIndex((seat) => normalizePosition(seat.positionKey ?? seat.position) === normalizePosition(anchorPosition));
  if (anchorIndex <= 0) return seats;
  return [...seats.slice(anchorIndex), ...seats.slice(0, anchorIndex)];
}

export function tableSeatCoordinates(playersCount: number): Array<[number, number]> {
  const layouts: Record<number, Array<[number, number]>> = {
    2: [[50, 100], [50, 0]],
    3: [[50, 100], [22, 0], [78, 0]],
    4: [[50, 100], [0, 50], [50, 0], [100, 50]],
    5: [[50, 100], [0, 50], [32, 0], [68, 0], [100, 50]],
    6: [[50, 100], [20, 100], [0, 50], [30, 0], [70, 0], [100, 50]],
    7: [[50, 100], [20, 100], [0, 50], [20, 0], [50, 0], [80, 0], [100, 50]],
    8: [[50, 100], [18, 100], [0, 50], [18, 0], [50, 0], [82, 0], [100, 50], [82, 100]],
    9: [[50, 100], [35, 100], [17, 100], [0, 50], [18, 0], [50, 0], [82, 0], [100, 50], [82, 100]],
    10: [[50, 100], [34, 100], [17, 100], [0, 50], [12, 0], [38, 0], [62, 0], [88, 0], [100, 50], [83, 100]],
  };
  return layouts[playersCount] ?? layouts[8];
}

function inwardCoordinate([x, y]: [number, number]): [number, number] {
  return [50 + (x - 50) * .7, 50 + (y - 50) * .62];
}

function normalizePosition(position: string) {
  return position.toUpperCase() === "BU" ? "BTN" : position.toUpperCase();
}
