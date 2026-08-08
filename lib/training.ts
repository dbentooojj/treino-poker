export const TRAINING_TYPES = ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN"] as const;
export const EQUITY_MODELS = ["CHIP_EV", "ICM"] as const;
export const QUESTION_COUNTS = [20, 50, 100] as const;

export type TrainingType = (typeof TRAINING_TYPES)[number];
export type EquityModel = (typeof EQUITY_MODELS)[number];
export type TrainingActionType = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE";
export type CompletionReason = "COMPLETED" | "USER_FINISHED";

export type TrainingAction = {
  id?: string;
  type: TrainingActionType;
  amountBb?: number;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type TrainingSequenceAction = TrainingAction & { position?: string };

export type TrainingFilters = {
  trainingType?: TrainingType;
  equityModel?: EquityModel;
  stackDepthBb?: number;
  heroPosition?: string;
};

export type TrainingConfig = Required<Pick<TrainingFilters, "trainingType" | "equityModel">> & {
  stackDepthBb?: number;
  heroPosition?: string;
  targetQuestions: number | null;
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
  stackDepthsBb: number[];
  heroPositions: string[];
  hasMatches: boolean;
};

export type QueueEntry = {
  trainingSetId: string;
  trainingNodeId: string;
  trainingHandId: string;
};

export type TrainingExercise = QueueEntry & {
  setName: string;
  handClass: string;
  trainingType: TrainingType;
  equityModel: EquityModel;
  playersCount: number;
  heroStackBb: number;
  heroPosition: string;
  villainPosition: string | null;
  blinds: BlindStructure;
  actionSequence: TrainingSequenceAction[];
  availableActions: TrainingAction[];
};

export type AnswerEvaluation = {
  correct: boolean;
  selectedKey: string;
  bestKey: string;
  bestLabel: string;
  strategy: Record<string, number>;
  evs: Record<string, number>;
};

export type TrainingSession = {
  id: string;
  startedAt: number;
  config: TrainingConfig;
  targetQuestions: number | null;
  answeredQuestions: number;
  correctAnswers: number;
  exercise: TrainingExercise;
};

export type ReportGroup = { label: string; answered: number; correct: number; accuracy: number };
export type TrainingReport = {
  sessionId: string;
  completionReason: CompletionReason;
  trainingType: TrainingType;
  equityModel: EquityModel;
  stackDepthBb: number | null;
  heroPosition: string | null;
  targetQuestions: number | null;
  answeredQuestions: number;
  correctAnswers: number;
  errors: number;
  accuracy: number;
  durationSeconds: number;
  averageSeconds: number | null;
  byPosition: ReportGroup[];
  byDecisionType: ReportGroup[];
  mostMissedHands: Array<{ handClass: string; errors: number }>;
  errorDetails: Array<{ handClass: string; heroPosition: string; selectedAction: string; bestAction: string }>;
  feedback: string[];
};

export const trainingTypeLabels: Record<TrainingType, string> = {
  PUSH_FOLD: "Push/Fold",
  CALL_VS_SHOVE: "Call vs Shove",
  OPEN_FOLD: "Open/Fold",
  VS_OPEN: "Vs Open",
};

export const trainingTypeDescriptions: Record<TrainingType, string> = {
  PUSH_FOLD: "Decisões de all-in ou fold",
  CALL_VS_SHOVE: "Responder a um shove",
  OPEN_FOLD: "Abrir ou abandonar a mão",
  VS_OPEN: "Responder a um open raise",
};

export const equityModelLabels: Record<EquityModel, string> = { CHIP_EV: "ChipEV", ICM: "ICM" };

export function actionKey(action: TrainingAction) { return action.id ?? action.type; }

export function actionLabel(action: TrainingAction, node: Pick<TrainingExercise, "heroStackBb" | "trainingType">) {
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

export function formatBb(value: number) { return Number(value.toFixed(2)).toString(); }
export function isTrainingType(value: unknown): value is TrainingType { return typeof value === "string" && (TRAINING_TYPES as readonly string[]).includes(value); }
export function isEquityModel(value: unknown): value is EquityModel { return typeof value === "string" && (EQUITY_MODELS as readonly string[]).includes(value); }
export function isQuestionCount(value: unknown): value is number | null { return value === null || (typeof value === "number" && (QUESTION_COUNTS as readonly number[]).includes(value)); }
export function isTrainingPosition(value: unknown): value is string {
  return typeof value === "string" && value.length <= 12 && /^(?:UTG(?:\+[1-7])?|EP|MP[1-7]?|HJ|CO|BTN|BU|SB|BB|P(?:[1-9]|10))$/.test(value);
}

export function actionAliases(action: TrainingAction) {
  return [action.id, action.type, action.type.toLowerCase(), action.label].filter((value): value is string => Boolean(value));
}

export function sameAction(left: TrainingAction, right: TrainingAction) {
  return actionAliases(left).some((alias) => actionAliases(right).includes(alias));
}

export function recordValue(record: Record<string, number>, action: TrainingAction) {
  for (const alias of actionAliases(action)) if (typeof record[alias] === "number") return record[alias];
  return null;
}

export function evaluateChoice(selectedKey: string, actions: TrainingAction[], bestAction: string | null, evs: Record<string, number>) {
  const selected = actions.find((action) => actionAliases(action).includes(selectedKey));
  if (!selected) return null;
  const values = actions.map((action) => ({ action, key: actionKey(action), value: recordValue(evs, action) }));
  const evBest = values.filter((item): item is typeof item & { value: number } => item.value !== null).sort((left, right) => right.value - left.value)[0];
  const configured = bestAction ? values.find((item) => actionAliases(item.action).includes(bestAction)) : undefined;
  const best = configured ?? evBest ?? values[0];
  return { correct: sameAction(selected, best.action), selected, selectedKey: actionKey(selected), bestKey: best.key, bestLabel: best.action.label ?? best.key };
}

export function fisherYates<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function buildExerciseQueue(entries: readonly QueueEntry[], targetQuestions: number | null, random: () => number = Math.random, previousQueue?: readonly QueueEntry[]) {
  if (!entries.length) return [];
  const target = targetQuestions ?? entries.length;
  const result: QueueEntry[] = [];
  while (result.length < target) {
    const cycle = fisherYates(entries, random);
    const previous = result.at(-1);
    if (previous && cycle.length > 1 && sameQueueEntry(previous, cycle[0])) [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
    result.push(...cycle.slice(0, target - result.length));
  }
  if (previousQueue && result.length > 1 && queuesEqual(result, previousQueue)) [result[0], result[1]] = [result[1], result[0]];
  return result;
}

export function sameQueueEntry(left: QueueEntry, right: QueueEntry) {
  return left.trainingNodeId === right.trainingNodeId && left.trainingHandId === right.trainingHandId;
}

function queuesEqual(left: readonly QueueEntry[], right: readonly QueueEntry[]) {
  return left.length === right.length && left.every((entry, index) => sameQueueEntry(entry, right[index]));
}
