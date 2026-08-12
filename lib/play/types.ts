import type { PokerCard } from "../poker/cards";

export const PLAY_POSITIONS = ["UTG", "UTG+1", "UTG+2", "UTG+3", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;

export type PlayPosition = (typeof PLAY_POSITIONS)[number];
export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" | "FINISHED";
export type HandPhase = "DEALING" | "PLAYING" | "ACTION_RESOLVING" | "COLLECTING" | "DEALING_BOARD" | "SHOWDOWN" | "PAYOUT" | "FINISHED";
export type PlayActionType = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE" | "ALL_IN";

export type PlayActionDefinition = {
  id: string;
  type: PlayActionType;
  label?: string;
  amountBb?: number;
  potFraction?: number;
  next: string;
};

export type StrategyActionSnapshot = {
  actionId: string;
  frequencyPercent: number;
  evBb?: number;
  nextExternalNodeId?: string;
};

/** Contrato futuro entre uma árvore HRC e o motor, sempre preservando o combo exato. */
export type StrategyNodeSnapshot = {
  source: "MOCK" | "HRC";
  externalNodeId: string;
  board: PokerCard[];
  exactCombo: [PokerCard, PokerCard];
  actions: StrategyActionSnapshot[];
};

export type HandNode = {
  id: string;
  street: Exclude<Street, "SHOWDOWN" | "FINISHED">;
  actor: PlayPosition;
  prompt?: string;
  context?: string;
  actions: PlayActionDefinition[];
  preferredActionId?: string;
  strategy?: StrategyNodeSnapshot;
};

export type PlayablePlayer = {
  position: PlayPosition;
  cards: [PokerCard, PokerCard];
};

/** Contrato consumido pelo motor, independentemente de vir do demo ou de um futuro import HRC pós-flop. */
export type PlayableHandScenario = {
  source: "DEMO" | "HRC";
  externalStudyId?: string;
  solutionLabel?: string;
  id: string;
  title: string;
  subtitle: string;
  effectiveStackBb: number;
  dealerPosition: PlayPosition;
  heroPosition: PlayPosition;
  smallBlindBb: number;
  bigBlindBb: number;
  players: PlayablePlayer[];
  board: [PokerCard, PokerCard, PokerCard, PokerCard, PokerCard];
  firstNodeId: string;
  nodes: HandNode[];
};

export type MockPlayer = PlayablePlayer;
export type MockHand = PlayableHandScenario;

export type PlayerState = {
  position: PlayPosition;
  stackBb: number;
  committedBb: number;
  cards: [PokerCard, PokerCard];
  cardsVisible: boolean;
  folded: boolean;
  allIn: boolean;
  hero: boolean;
};

export type ResolvedPlayAction = Omit<PlayActionDefinition, "amountBb" | "potFraction"> & {
  amountBb?: number;
};

export type HandActionRecord = {
  nodeId: string;
  street: Street;
  position: PlayPosition;
  actionId: string;
  type: PlayActionType;
  amountBb?: number;
  label: string;
  hero: boolean;
};

export type StreetReview = {
  street: Exclude<Street, "SHOWDOWN" | "FINISHED">;
  status: "CORRECT" | "REVIEW" | "NOT_PLAYED";
};

export type HandResultState = {
  winnerPosition: PlayPosition | "TIE";
  winnerLabel: string;
  handLabel: string;
  score: number;
  reviews: StreetReview[];
  wonPotBb: number;
  showdown: boolean;
};

export type HandState = {
  handId: string;
  handNumber: number;
  street: Street;
  phase: HandPhase;
  potBb: number;
  activePosition: PlayPosition | null;
  dealerPosition: PlayPosition;
  heroPosition: PlayPosition;
  board: PokerCard[];
  players: PlayerState[];
  dealtCardCount: number;
  muckCount: number;
  currentNodeId: string | null;
  lastAction: HandActionRecord | null;
  actionHistory: HandActionRecord[];
  result: HandResultState | null;
};
