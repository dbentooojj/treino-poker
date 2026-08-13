import { parseCard } from "../../lib/poker/cards";
import type { HandNode, PlayableHandScenario, PlayablePlayer, PlayPosition } from "../../lib/play/types";

const card = parseCard;

function player(position: PlayPosition, first: string, second: string): PlayablePlayer {
  return { position, cards: [card(first), card(second)] };
}

const firstHandNodes: HandNode[] = [
  auto("h1-utg", "PREFLOP", "UTG", "FOLD", "h1-utg1"),
  auto("h1-utg1", "PREFLOP", "UTG+1", "FOLD", "h1-lj"),
  auto("h1-lj", "PREFLOP", "LJ", "FOLD", "h1-hj"),
  auto("h1-hj", "PREFLOP", "HJ", "FOLD", "h1-co"),
  auto("h1-co", "PREFLOP", "CO", "FOLD", "h1-hero-pre"),
  hero("h1-hero-pre", "PREFLOP", "BTN", "Sua vez no pré-flop", "A ação chegou em fold até você", "raise-2.2", [
    action("fold", "FOLD", "h1-sb-after-hero-fold"),
    action("raise-2.2", "RAISE", "h1-sb-after-raise", 2.2),
    action("all-in", "ALL_IN", "h1-sb-after-jam"),
  ]),
  auto("h1-sb-after-hero-fold", "PREFLOP", "SB", "FOLD", "WIN:BB"),
  auto("h1-sb-after-raise", "PREFLOP", "SB", "FOLD", "h1-bb-call"),
  auto("h1-bb-call", "PREFLOP", "BB", "CALL", "h1-bb-flop-check"),
  auto("h1-sb-after-jam", "PREFLOP", "SB", "FOLD", "h1-bb-after-jam"),
  auto("h1-bb-after-jam", "PREFLOP", "BB", "FOLD", "WIN:BTN"),
  auto("h1-bb-flop-check", "FLOP", "BB", "CHECK", "h1-hero-flop"),
  hero("h1-hero-flop", "FLOP", "BTN", "Sua vez no flop", "BB deu check", "bet-25", [
    action("check", "CHECK", "h1-bb-turn-check"),
    potAction("bet-25", "BET", "h1-bb-call-flop", 0.25),
    potAction("bet-75", "BET", "h1-bb-fold-flop", 0.75),
  ]),
  auto("h1-bb-call-flop", "FLOP", "BB", "CALL", "h1-bb-turn-check"),
  auto("h1-bb-fold-flop", "FLOP", "BB", "FOLD", "WIN:BTN"),
  auto("h1-bb-turn-check", "TURN", "BB", "CHECK", "h1-hero-turn"),
  hero("h1-hero-turn", "TURN", "BTN", "Sua vez no turn", "BB deu check", "bet-50", [
    action("check", "CHECK", "h1-bb-river-check"),
    potAction("bet-50", "BET", "h1-bb-call-turn", 0.5),
    potAction("bet-pot", "BET", "h1-bb-fold-turn", 1),
  ]),
  auto("h1-bb-call-turn", "TURN", "BB", "CALL", "h1-bb-river-check"),
  auto("h1-bb-fold-turn", "TURN", "BB", "FOLD", "WIN:BTN"),
  auto("h1-bb-river-check", "RIVER", "BB", "CHECK", "h1-hero-river"),
  hero("h1-hero-river", "RIVER", "BTN", "Sua vez no river", "Última decisão da mão", "bet-33", [
    action("check", "CHECK", "SHOWDOWN"),
    potAction("bet-33", "BET", "h1-bb-call-river", 0.33),
    action("all-in", "ALL_IN", "h1-bb-fold-river"),
  ]),
  auto("h1-bb-call-river", "RIVER", "BB", "CALL", "SHOWDOWN"),
  auto("h1-bb-fold-river", "RIVER", "BB", "FOLD", "WIN:BTN"),
];

const secondHandNodes: HandNode[] = [
  auto("h2-utg", "PREFLOP", "UTG", "FOLD", "h2-utg1"),
  auto("h2-utg1", "PREFLOP", "UTG+1", "FOLD", "h2-lj"),
  auto("h2-lj", "PREFLOP", "LJ", "FOLD", "h2-hj"),
  auto("h2-hj", "PREFLOP", "HJ", "FOLD", "h2-co"),
  auto("h2-co", "PREFLOP", "CO", "FOLD", "h2-btn-open"),
  auto("h2-btn-open", "PREFLOP", "BTN", "RAISE", "h2-sb-fold", 2.2),
  auto("h2-sb-fold", "PREFLOP", "SB", "FOLD", "h2-hero-pre"),
  hero("h2-hero-pre", "PREFLOP", "BB", "Defenda o big blind", "BTN abriu para 2,2 BB", "call", [
    action("fold", "FOLD", "WIN:BTN"),
    action("call", "CALL", "h2-hero-flop"),
    action("raise-6.5", "RAISE", "h2-btn-fold-pre", 6.5),
    action("all-in", "ALL_IN", "h2-btn-fold-pre"),
  ]),
  auto("h2-btn-fold-pre", "PREFLOP", "BTN", "FOLD", "WIN:BB"),
  hero("h2-hero-flop", "FLOP", "BB", "Sua vez no flop", "Você age primeiro fora de posição", "check", [
    action("check", "CHECK", "h2-btn-check-flop"),
    potAction("bet-33", "BET", "h2-btn-call-flop", 0.33),
  ]),
  auto("h2-btn-check-flop", "FLOP", "BTN", "CHECK", "h2-hero-turn"),
  auto("h2-btn-call-flop", "FLOP", "BTN", "CALL", "h2-hero-turn"),
  hero("h2-hero-turn", "TURN", "BB", "Sua vez no turn", "A ação começa no BB", "bet-50", [
    action("check", "CHECK", "h2-btn-check-turn"),
    potAction("bet-50", "BET", "h2-btn-call-turn", 0.5),
  ]),
  auto("h2-btn-check-turn", "TURN", "BTN", "CHECK", "h2-hero-river"),
  auto("h2-btn-call-turn", "TURN", "BTN", "CALL", "h2-hero-river"),
  hero("h2-hero-river", "RIVER", "BB", "Sua vez no river", "Escolha entre showdown e valor", "check", [
    action("check", "CHECK", "h2-btn-check-river"),
    potAction("bet-33", "BET", "h2-btn-fold-river", 0.33),
  ]),
  auto("h2-btn-check-river", "RIVER", "BTN", "CHECK", "SHOWDOWN"),
  auto("h2-btn-fold-river", "RIVER", "BTN", "FOLD", "WIN:BB"),
];

const thirdHandNodes: HandNode[] = [
  auto("h3-utg", "PREFLOP", "UTG", "FOLD", "h3-utg1"),
  auto("h3-utg1", "PREFLOP", "UTG+1", "FOLD", "h3-lj"),
  auto("h3-lj", "PREFLOP", "LJ", "FOLD", "h3-hj"),
  auto("h3-hj", "PREFLOP", "HJ", "FOLD", "h3-hero-pre"),
  hero("h3-hero-pre", "PREFLOP", "CO", "Abra do cutoff", "A ação chegou em fold", "raise-2.2", [
    action("fold", "FOLD", "h3-btn-fold-after-hero"),
    action("raise-2.2", "RAISE", "h3-btn-call", 2.2),
    action("all-in", "ALL_IN", "h3-btn-fold-after-jam"),
  ]),
  auto("h3-btn-fold-after-hero", "PREFLOP", "BTN", "FOLD", "h3-sb-fold-after-hero"),
  auto("h3-sb-fold-after-hero", "PREFLOP", "SB", "FOLD", "WIN:BB"),
  auto("h3-btn-call", "PREFLOP", "BTN", "CALL", "h3-sb-fold"),
  auto("h3-sb-fold", "PREFLOP", "SB", "FOLD", "h3-bb-fold"),
  auto("h3-bb-fold", "PREFLOP", "BB", "FOLD", "h3-hero-flop"),
  auto("h3-btn-fold-after-jam", "PREFLOP", "BTN", "FOLD", "h3-sb-fold-after-jam"),
  auto("h3-sb-fold-after-jam", "PREFLOP", "SB", "FOLD", "h3-bb-fold-after-jam"),
  auto("h3-bb-fold-after-jam", "PREFLOP", "BB", "FOLD", "WIN:CO"),
  hero("h3-hero-flop", "FLOP", "CO", "Sua vez no flop", "Você age antes do BTN", "bet-33", [
    action("check", "CHECK", "h3-btn-check-flop"),
    potAction("bet-33", "BET", "h3-btn-fold-flop", 0.33),
    potAction("bet-75", "BET", "h3-btn-call-flop", 0.75),
  ]),
  auto("h3-btn-fold-flop", "FLOP", "BTN", "FOLD", "WIN:CO"),
  auto("h3-btn-check-flop", "FLOP", "BTN", "CHECK", "h3-hero-turn"),
  auto("h3-btn-call-flop", "FLOP", "BTN", "CALL", "h3-hero-turn"),
  hero("h3-hero-turn", "TURN", "CO", "Sua vez no turn", "BTN continua na mão", "check", [
    action("check", "CHECK", "h3-btn-check-turn"),
    potAction("bet-50", "BET", "h3-btn-fold-turn", 0.5),
  ]),
  auto("h3-btn-fold-turn", "TURN", "BTN", "FOLD", "WIN:CO"),
  auto("h3-btn-check-turn", "TURN", "BTN", "CHECK", "h3-hero-river"),
  hero("h3-hero-river", "RIVER", "CO", "Sua vez no river", "Última decisão da mão", "check", [
    action("check", "CHECK", "h3-btn-check-river"),
    potAction("bet-50", "BET", "h3-btn-call-river", 0.5),
  ]),
  auto("h3-btn-check-river", "RIVER", "BTN", "CHECK", "SHOWDOWN"),
  auto("h3-btn-call-river", "RIVER", "BTN", "CALL", "SHOWDOWN"),
];

export const PLAY_HAND_FIXTURES: readonly PlayableHandScenario[] = [
  {
    source: "TEST",
    id: "btn-aj-vs-bb-kj",
    title: "BTN vs BB",
    subtitle: "Single-raised pot",
    effectiveStackBb: 25,
    dealerPosition: "BTN",
    heroPosition: "BTN",
    smallBlindBb: 0.5,
    bigBlindBb: 1,
    players: [player("UTG", "7d", "2c"), player("UTG+1", "9h", "4c"), player("LJ", "Qd", "5h"), player("HJ", "Tc", "8d"), player("CO", "Kd", "6h"), player("BTN", "As", "Jh"), player("SB", "8c", "7c"), player("BB", "Kc", "Jc")],
    board: [card("Jd"), card("8s"), card("3c"), card("6s"), card("2h")],
    firstNodeId: "h1-utg",
    nodes: firstHandNodes,
  },
  {
    source: "TEST",
    id: "bb-kq-vs-btn",
    title: "BB vs BTN",
    subtitle: "Defesa do big blind",
    effectiveStackBb: 25,
    dealerPosition: "BTN",
    heroPosition: "BB",
    smallBlindBb: 0.5,
    bigBlindBb: 1,
    players: [player("UTG", "6d", "2d"), player("UTG+1", "8h", "3h"), player("LJ", "Jd", "5c"), player("HJ", "Ts", "7s"), player("CO", "Ac", "4d"), player("BTN", "As", "Tc"), player("SB", "9c", "8c"), player("BB", "Kd", "Qd")],
    board: [card("Qc"), card("7d"), card("2s"), card("9h"), card("4c")],
    firstNodeId: "h2-utg",
    nodes: secondHandNodes,
  },
  {
    source: "TEST",
    id: "co-queens-vs-btn",
    title: "CO vs BTN",
    subtitle: "Valor fora de posição",
    effectiveStackBb: 25,
    dealerPosition: "BTN",
    heroPosition: "CO",
    smallBlindBb: 0.5,
    bigBlindBb: 1,
    players: [player("UTG", "5s", "2d"), player("UTG+1", "8h", "4h"), player("LJ", "Kd", "6c"), player("HJ", "Ac", "9d"), player("CO", "Qs", "Qd"), player("BTN", "Jc", "Jh"), player("SB", "Tc", "8c"), player("BB", "7s", "6s")],
    board: [card("9c"), card("5d"), card("2c"), card("Ks"), card("3h")],
    firstNodeId: "h3-utg",
    nodes: thirdHandNodes,
  },
];

function action(id: string, type: HandNode["actions"][number]["type"], next: string, amountBb?: number) {
  return { id, type, next, amountBb };
}

function potAction(id: string, type: "BET", next: string, potFraction: number) {
  return { id, type, next, potFraction };
}

function auto(id: string, street: HandNode["street"], actor: PlayPosition, type: HandNode["actions"][number]["type"], next: string, amountBb?: number): HandNode {
  return { id, street, actor, actions: [action(`${id}-action`, type, next, amountBb)] };
}

function hero(id: string, street: HandNode["street"], actor: PlayPosition, prompt: string, context: string, preferredActionId: string, actions: HandNode["actions"]): HandNode {
  return { id, street, actor, prompt, context, preferredActionId, actions };
}
