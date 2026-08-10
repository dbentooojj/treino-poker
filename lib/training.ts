export const TRAINING_TYPES = ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN"] as const;
export const EQUITY_MODELS = ["CHIP_EV", "ICM"] as const;
export const EV_UNITS = ["CHIPS", "BIG_BLINDS", "ICM_UTILITY", "UNKNOWN"] as const;
export const QUESTION_COUNTS = [20, 50, 100] as const;
export const MIN_STRATEGY_FREQUENCY_PERCENT = 5;
export const MAX_EXERCISE_QUEUE_SIZE = 100;

export type TrainingType = (typeof TRAINING_TYPES)[number];
export type EquityModel = (typeof EQUITY_MODELS)[number];
export type EvUnit = (typeof EV_UNITS)[number];
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
  evUnit: EvUnit;
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
  decisionClarity: number | null;
  isMixed: boolean;
};

export type NodeRangeHand = {
  handClass: string;
  strategy: Record<string, number>;
  evs: Record<string, number>;
  bestAction: string | null;
  decisionClarity: number | null;
  isMixed: boolean;
};

export type NodeRange = {
  trainingSetId: string;
  trainingNodeId: string;
  hands: NodeRangeHand[];
};

export type StrategyActionPresentation = {
  action: TrainingAction;
  key: string;
  frequency: number | null;
  frequencyPercent: number | null;
  isInStrategy: boolean;
};

export type StrategyPresentation = {
  actions: StrategyActionPresentation[];
  isMixed: boolean;
  dominantAction: StrategyActionPresentation | null;
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
  detailsAvailable: boolean;
  detailsTruncated: boolean;
  detailAnswers: number;
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

export function isValidStrategy(strategy: Record<string, number>, actions: TrainingAction[]) {
  if (!actions.length || Object.keys(strategy).length !== actions.length) return false;
  const matchedKeys = actions.map((action) => actionAliases(action).find((alias) => Object.hasOwn(strategy, alias)) ?? null);
  if (matchedKeys.some((key) => key === null) || new Set(matchedKeys).size !== actions.length || Object.keys(strategy).some((key) => !matchedKeys.includes(key))) return false;
  const values = matchedKeys.map((key) => strategy[key!]);
  if (values.some((value) => value === null || !Number.isFinite(value) || value < 0)) return false;
  const frequencies = values as number[];
  const total = frequencies.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) <= 0.000001) return frequencies.every((value) => value <= 1.000001);
  if (Math.abs(total - 100) <= 0.0001) return frequencies.every((value) => value <= 100.0001);
  return false;
}

/** HRC imports fractions; callers with a complete legacy vector pass its total. */
export function frequencyPercent(value: number | null, vectorTotal = 1) {
  if (value === null || !Number.isFinite(value)) return null;
  const multiplier = Math.abs(vectorTotal - 100) <= 0.0001 ? 1 : 100;
  return Math.max(0, Math.min(100, value * multiplier));
}

export function presentStrategy(strategy: Record<string, number>, actions: TrainingAction[], mixedHint?: boolean): StrategyPresentation {
  const vectorTotal = strategyVectorTotal(strategy, actions);
  const presented = actions.map((action) => {
    const frequency = recordValue(strategy, action);
    const percentage = frequencyPercent(frequency, vectorTotal);
    return {
      action,
      key: actionKey(action),
      frequency,
      frequencyPercent: percentage,
      isInStrategy: percentage !== null && percentage >= MIN_STRATEGY_FREQUENCY_PERCENT,
    };
  });
  const actionable = presented.filter((item): item is StrategyActionPresentation & { frequencyPercent: number } => item.frequencyPercent !== null && item.frequencyPercent >= MIN_STRATEGY_FREQUENCY_PERCENT);
  const dominantAction = [...presented].filter((item): item is StrategyActionPresentation & { frequencyPercent: number } => item.frequencyPercent !== null)
    .sort((left, right) => right.frequencyPercent - left.frequencyPercent)[0] ?? null;
  return { actions: presented, isMixed: mixedHint ?? actionable.length > 1, dominantAction };
}

export function rangeActionShares(strategy: Record<string, number>, actions: TrainingAction[]) {
  const vectorTotal = strategyVectorTotal(strategy, actions);
  let actionPercent = 0;
  let foldPercent = 0;
  let hasData = false;
  for (const action of actions) {
    const percentage = frequencyPercent(recordValue(strategy, action), vectorTotal);
    if (percentage === null) continue;
    hasData = true;
    if (action.type === "FOLD") foldPercent += percentage;
    else actionPercent += percentage;
  }
  const total = actionPercent + foldPercent;
  const scale = total > 100 ? 100 / total : 1;
  return {
    actionPercent: actionPercent * scale,
    foldPercent: foldPercent * scale,
    totalPercent: Math.min(100, total),
    hasData,
  };
}

function strategyVectorTotal(strategy: Record<string, number>, actions: TrainingAction[]) {
  return actions.reduce((total, action) => {
    const value = recordValue(strategy, action);
    return value !== null && Number.isFinite(value) ? total + value : total;
  }, 0);
}

export const RANGE_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export type RangeMatrixCell = {
  handClass: string;
  row: number;
  column: number;
  pair: boolean;
  suited: boolean;
  offsuit: boolean;
};

export function buildRangeMatrix(): RangeMatrixCell[] {
  return RANGE_RANKS.flatMap((highRank, row) => RANGE_RANKS.map((lowRank, column) => ({
    row,
    column,
    pair: row === column,
    suited: row < column,
    offsuit: row > column,
    handClass: row === column ? `${highRank}${lowRank}` : row < column ? `${highRank}${lowRank}s` : `${lowRank}${highRank}o`,
  })));
}

export function evaluateChoice(selectedKey: string, actions: TrainingAction[], bestAction: string | null, evs: Record<string, number>, strategy?: Record<string, number>) {
  const selected = actions.find((action) => actionAliases(action).includes(selectedKey));
  if (!selected) return null;
  const values = actions.map((action) => ({ action, key: actionKey(action), value: recordValue(evs, action) }));
  const evBest = values.filter((item): item is typeof item & { value: number } => item.value !== null).sort((left, right) => right.value - left.value)[0];
  const configured = bestAction ? values.find((item) => actionAliases(item.action).includes(bestAction)) : undefined;
  const best = configured ?? evBest ?? values[0];
  const presented = strategy && isValidStrategy(strategy, actions) ? presentStrategy(strategy, actions) : null;
  const hasFrequencyData = presented?.actions.some((item) => item.frequencyPercent !== null) ?? false;
  const selectedStrategy = presented?.actions.find((item) => sameAction(item.action, selected));
  const correct = hasFrequencyData ? Boolean(selectedStrategy?.isInStrategy) : sameAction(selected, best.action);
  return { correct, selected, selectedKey: actionKey(selected), bestKey: best.key, bestLabel: best.action.label ?? best.key };
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
  if (targetQuestions !== null && (!Number.isInteger(targetQuestions) || targetQuestions <= 0 || targetQuestions > MAX_EXERCISE_QUEUE_SIZE)) {
    throw new RangeError(`A fila deve conter entre 1 e ${MAX_EXERCISE_QUEUE_SIZE} exercícios.`);
  }
  const pool = entries.slice(0, MAX_EXERCISE_QUEUE_SIZE);
  const target = targetQuestions ?? pool.length;
  const result: QueueEntry[] = [];
  while (result.length < target) {
    const cycle = fisherYates(pool, random);
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
