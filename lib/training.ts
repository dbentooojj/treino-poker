export const TRAINING_TYPES = ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN"] as const;
export const EQUITY_MODELS = ["CHIP_EV", "ICM"] as const;
export const TRAINING_DIFFICULTIES = ["EASY", "INTERMEDIATE", "HARD"] as const;
export const TRAINING_POSITIONS = ["UTG", "EP", "MP1", "MP2", "HJ", "CO", "BTN", "BU", "SB", "BB"] as const;

export type TrainingType = (typeof TRAINING_TYPES)[number];
export type EquityModel = (typeof EQUITY_MODELS)[number];
export type TrainingDifficulty = (typeof TRAINING_DIFFICULTIES)[number];
export type TrainingActionType = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE";

export type TrainingAction = {
  id?: string;
  type: TrainingActionType;
  amountBb?: number;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type TrainingSequenceAction = TrainingAction & {
  position?: string;
};

export type TrainingFilters = {
  trainingType?: TrainingType;
  equityModel?: EquityModel;
  playersCount?: number;
  stackDepthBb?: number;
  heroPosition?: string;
  villainPosition?: string;
  icmContext?: string;
};

export type TrainingConfig = Required<Pick<TrainingFilters, "trainingType" | "equityModel" | "playersCount" | "stackDepthBb" | "heroPosition">> & {
  villainPosition?: string;
  icmContext?: string;
  difficulty: TrainingDifficulty;
};

export type BlindStructure = {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: string;
};

export type TrainingOptions = {
  trainingTypes: TrainingType[];
  equityModels: EquityModel[];
  playerCounts: number[];
  stackDepthsBb: number[];
  heroPositions: string[];
  villainPositions: string[];
  icmContexts: string[];
  blindStructures: BlindStructure[];
  hasMatches: boolean;
};

export type TrainingHand = {
  id: string;
  handClass: string;
  strategy: Record<string, number>;
  evs: Record<string, number>;
  bestAction: string | null;
  decisionClarity: number | null;
  isMixed: boolean | null;
};

export type TrainingNode = {
  id: string;
  setId: string;
  setName: string;
  trainingType: TrainingType;
  equityModel: EquityModel;
  playersCount: number;
  heroStackBb: number;
  heroPosition: string;
  villainPosition: string | null;
  blinds: BlindStructure;
  actionSequence: TrainingSequenceAction[];
  availableActions: TrainingAction[];
  hands: TrainingHand[];
};

export type TrainingSession = {
  progressSessionId: string;
  startedAt: number;
  config: TrainingConfig;
  nodes: TrainingNode[];
};

export const trainingTypeLabels: Record<TrainingType, string> = {
  PUSH_FOLD: "Push / Fold",
  CALL_VS_SHOVE: "Call vs Shove",
  OPEN_FOLD: "Open / Fold",
  VS_OPEN: "Vs Open",
};

export const trainingTypeDescriptions: Record<TrainingType, string> = {
  PUSH_FOLD: "Decisões de all-in ou fold",
  CALL_VS_SHOVE: "Responder a um shove",
  OPEN_FOLD: "Abrir ou abandonar a mão",
  VS_OPEN: "Responder a um open raise",
};

export const equityModelLabels: Record<EquityModel, string> = {
  CHIP_EV: "Chip EV",
  ICM: "ICM",
};

export const difficultyLabels: Record<TrainingDifficulty, string> = {
  EASY: "Fácil",
  INTERMEDIATE: "Intermediário",
  HARD: "Difícil",
};

export function requiresVillainPosition(type?: TrainingType) {
  return type === "CALL_VS_SHOVE" || type === "VS_OPEN";
}

export function actionKey(action: TrainingAction) {
  return action.id ?? action.type;
}

export function actionLabel(action: TrainingAction, node: Pick<TrainingNode, "heroStackBb" | "trainingType">) {
  if (action.label) return action.label;
  if (action.type === "FOLD") return "Fold";
  if (action.type === "CHECK") return "Check";
  if (action.type === "CALL") return "Call";
  if (action.type === "BET") return action.amountBb ? `Bet ${formatBb(action.amountBb)} BB` : "Bet";
  if (typeof action.amountBb === "number" && action.amountBb >= node.heroStackBb - 0.01) return "All-in";
  if (node.trainingType === "OPEN_FOLD") return action.amountBb ? `Open ${formatBb(action.amountBb)} BB` : "Open raise";
  if (node.trainingType === "VS_OPEN") return action.amountBb ? `3-bet ${formatBb(action.amountBb)} BB` : "3-bet";
  return action.amountBb ? `Raise ${formatBb(action.amountBb)} BB` : "Raise";
}

export function formatBb(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function isTrainingType(value: unknown): value is TrainingType {
  return typeof value === "string" && (TRAINING_TYPES as readonly string[]).includes(value);
}

export function isEquityModel(value: unknown): value is EquityModel {
  return typeof value === "string" && (EQUITY_MODELS as readonly string[]).includes(value);
}

export function isTrainingDifficulty(value: unknown): value is TrainingDifficulty {
  return typeof value === "string" && (TRAINING_DIFFICULTIES as readonly string[]).includes(value);
}

export function isTrainingPosition(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 12
    && /^(?:UTG(?:\+[1-7])?|EP|MP[1-7]?|HJ|CO|BTN|BU|SB|BB|P(?:[1-9]|10))$/.test(value);
}
