import type { HandState } from "../../lib/play/types";
import { UnifiedPokerTable, type UnifiedTableSeat } from "../training/UnifiedPokerTable";

export function PokerTable({ state }: { state: HandState }) {
  const seats = state.players.map<UnifiedTableSeat>((player, positionIndex) => {
    const resolvingAction = state.phase === "ACTION_RESOLVING" && state.lastAction?.position === player.position;
    return {
      position: player.position,
      stackBb: player.stackBb,
      committedBb: player.committedBb,
      cards: player.cards,
      cardsVisible: player.cardsVisible,
      visibleCards: Number(state.dealtCardCount > positionIndex) + Number(state.dealtCardCount > state.players.length + positionIndex),
      hero: player.hero,
      folded: player.folded,
      allIn: player.allIn,
      active: state.activePosition === player.position,
      winner: state.result?.winnerPosition === player.position,
      dealer: state.dealerPosition === player.position,
      mucking: resolvingAction && state.lastAction?.type === "FOLD",
      action: resolvingAction && state.lastAction ? { label: state.lastAction.label, tone: state.lastAction.type.toLowerCase() } : undefined,
    };
  });
  return <UnifiedPokerTable
    seats={seats}
    anchorPosition={state.heroPosition}
    phase={state.phase}
    potBb={state.potBb}
    board={state.board}
    muckCount={state.muckCount}
    collecting={state.phase === "COLLECTING"}
    payout={state.result && state.phase === "PAYOUT" ? { label: state.result.winnerLabel, amountBb: state.result.wonPotBb } : null}
    ariaLabel={`Mesa da mão ${state.handNumber}`}
  />;
}
