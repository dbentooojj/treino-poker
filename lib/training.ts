export const TRAINING_TYPES = ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN", "VS_3_BET", "VS_4_BET"] as const;
export const TRAINING_PRESENTATION_MODES = ["DECISION", "FROM_START"] as const;
export const FULL_HAND_STAGES = ["PREFLOP"] as const;
export const STUDY_CAPABILITIES = ["DECISION", "FULL_HAND_PREFLOP"] as const;
export const TRAINING_VIEW_MODES = ["quick-decision", "full-hand"] as const;
export const EQUITY_MODELS = ["CHIP_EV", "ICM"] as const;
export const EV_UNITS = ["CHIPS", "BIG_BLINDS", "ICM_UTILITY", "UNKNOWN"] as const;
export const QUESTION_COUNTS = [20, 50, 100] as const;
export const MIN_STRATEGY_FREQUENCY_PERCENT = 5;
export const MAX_EXERCISE_QUEUE_SIZE = 100;

export type TrainingType = (typeof TRAINING_TYPES)[number];
export type TrainingPresentationMode = (typeof TRAINING_PRESENTATION_MODES)[number];
export type FullHandStage = (typeof FULL_HAND_STAGES)[number];
export type StudyCapability = (typeof STUDY_CAPABILITIES)[number];
export type TrainingViewMode = (typeof TRAINING_VIEW_MODES)[number];
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
export type TrainingStreet = "PREFLOP" | "FLOP" | "TURN" | "RIVER";
export type TrainingGameType = "TOURNAMENT";
export type TrainingChoiceGrade = "BEST" | "CORRECT" | "INACCURACY" | "WRONG";

export type TrainingFilters = {
  trainingType?: TrainingType;
  equityModel?: EquityModel;
  stackDepthBb?: number;
  heroPosition?: string;
};

export type TrainingConfig = Required<Pick<TrainingFilters, "equityModel">> & {
  trainingType: TrainingType | null;
  stackDepthBb?: number;
  heroPosition?: string;
  targetQuestions: number | null;
  presentationMode?: TrainingPresentationMode;
  fullHandStage?: FullHandStage;
};

// PresentationMode remains the persisted/API contract. ViewMode is the UI concept
// that keeps an assembled decision spot separate from a future full-hand replay.
export function trainingViewModeFromPresentation(mode?: TrainingPresentationMode): TrainingViewMode {
  return mode === "FROM_START" ? "full-hand" : "quick-decision";
}

export function trainingPresentationModeFromView(mode: TrainingViewMode): TrainingPresentationMode {
  return mode === "full-hand" ? "FROM_START" : "DECISION";
}

export type BlindStructure = {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: string;
};

export type TrainingOptions = {
  trainingTypes: TrainingType[];
  trainingTypeCounts: Record<TrainingType, number>;
  totalTrainingNodes: number;
  equityModels: EquityModel[];
  stackDepthsBb: number[];
  heroPositions: string[];
  hasMatches: boolean;
  tableContext: TrainingTableContext | null;
  fullHandStages: Array<{ stage: FullHandStage; label: string; equityModel: EquityModel }>;
};

export type TrainingTableContext = {
  trainingSetId: string;
  studyName: string;
  gameType: TrainingGameType;
  equityModel: EquityModel;
  playersCount: number;
  heroStackBb: number;
  heroPosition: string;
  actionSequence: TrainingSequenceAction[];
};

export type QueueEntry = {
  trainingSetId: string;
  trainingNodeId: string;
  trainingHandId: string;
};

export type TrainingExercise = QueueEntry & {
  setName: string;
  handClass: string;
  trainingType: TrainingType | null;
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

export type TrainingChoiceClassification = {
  grade: TrainingChoiceGrade;
  selectedAction: StrategyActionPresentation | null;
  dominantAction: StrategyActionPresentation | null;
  strategy: StrategyPresentation | null;
};

export type TrainingSession = {
  id: string;
  startedAt: number;
  config: TrainingConfig;
  targetQuestions: number | null;
  answeredQuestions: number;
  correctAnswers: number;
  completedHands: number;
  evDelta: number;
  evUnit: EvUnit;
  exercise: TrainingExercise;
};

export type ReportGroup = { label: string; answered: number; correct: number; accuracy: number };
export type TrainingDecisionDetail = {
  questionIndex: number;
  handClass: string;
  heroPosition: string;
  selectedAction: string;
  selectedKey: string;
  bestAction: string;
  dominantAction: string;
  grade: TrainingChoiceGrade;
  selectedFrequencyPercent: number | null;
  isCorrect: boolean;
  isMixed: boolean;
  strategy: Record<string, number>;
  evs: Record<string, number>;
  evUnit: EvUnit;
};
export type TrainingReport = {
  sessionId: string;
  detailsAvailable: boolean;
  detailsTruncated: boolean;
  detailAnswers: number;
  completionReason: CompletionReason;
  presentationMode: TrainingPresentationMode;
  trainingType: TrainingType | null;
  equityModel: EquityModel;
  stackDepthBb: number | null;
  heroPosition: string | null;
  targetQuestions: number | null;
  answeredQuestions: number;
  correctAnswers: number;
  errors: number;
  accuracy: number;
  evDelta: number | null;
  evUnit: EvUnit | null;
  durationSeconds: number;
  averageSeconds: number | null;
  byPosition: ReportGroup[];
  byDecisionType: ReportGroup[];
  mostMissedHands: Array<{ handClass: string; errors: number }>;
  errorDetails: Array<{ handClass: string; heroPosition: string; selectedAction: string; bestAction: string }>;
  decisionDetails: TrainingDecisionDetail[];
  feedback: string[];
};

export const trainingTypeLabels: Record<TrainingType, string> = {
  PUSH_FOLD: "Push/Fold",
  CALL_VS_SHOVE: "Vs Shove",
  OPEN_FOLD: "RFI",
  VS_OPEN: "Vs Open",
  VS_3_BET: "Vs 3-bet",
  VS_4_BET: "Vs 4-bet",
};

export const trainingTypeDescriptions: Record<TrainingType, string> = {
  PUSH_FOLD: "Decisões de all-in ou fold",
  CALL_VS_SHOVE: "Responder a um shove",
  OPEN_FOLD: "Abrir ou abandonar a mão",
  VS_OPEN: "Responder a um open raise",
  VS_3_BET: "Defender o open contra uma 3-bet",
  VS_4_BET: "Responder a uma 4-bet após aplicar a 3-bet",
};

export const equityModelLabels: Record<EquityModel, string> = { CHIP_EV: "ChipEV", ICM: "ICM" };
export const gameTypeLabels: Record<TrainingGameType, string> = { TOURNAMENT: "MTT" };

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
  if (node.trainingType === "VS_3_BET") return action.amountBb ? `4-bet ${formatBb(action.amountBb)} BB` : "4-bet";
  if (node.trainingType === "VS_4_BET") return action.amountBb ? `5-bet ${formatBb(action.amountBb)} BB` : "5-bet";
  return action.amountBb ? `Raise ${formatBb(action.amountBb)} BB` : "Raise";
}

export function buildSpotSignature(spot: {
  trainingType: TrainingType | null;
  heroPosition: string;
  villainPosition: string | null;
  heroStackBb: number;
  actionSequence: TrainingSequenceAction[];
  availableActions: TrainingAction[];
}) {
  const raises = spot.actionSequence.filter((action) => action.type === "RAISE");
  const describeRaise = (action: TrainingSequenceAction | undefined, label: string) => {
    if (!action) return label;
    return `${action.position ?? "Vilão"} ${label}${typeof action.amountBb === "number" ? ` ${formatBb(action.amountBb)} BB` : ""}`;
  };
  if (spot.trainingType === "OPEN_FOLD") return `RFI • ${spot.heroPosition}`;
  if (spot.trainingType === "PUSH_FOLD") return `Push/Fold • ${spot.heroPosition}`;
  if (spot.trainingType === "CALL_VS_SHOVE") return `${spot.heroPosition} vs ${describeRaise(raises.at(-1), "shove")}`;
  if (spot.trainingType === "VS_OPEN") return `${spot.heroPosition} vs ${describeRaise(raises[0], "open")}`;
  if (spot.trainingType === "VS_3_BET") return `${describeRaise(raises[0], "open")} vs ${describeRaise(raises[1], "3-bet")} • Hero ${spot.heroPosition}`;
  return `${describeRaise(raises[0], "open")} • ${describeRaise(raises[1], "3-bet")} vs ${describeRaise(raises[2], "4-bet")} • Hero ${spot.heroPosition}`;
}

export function resolvedActionLabel(value: TrainingAction | string, actions: TrainingAction[], node: Pick<TrainingExercise, "heroStackBb" | "trainingType">) {
  const resolved = typeof value === "string"
    ? actions.find((action) => action.id === value) ?? actions.find((action) => actionAliases(action).includes(value))
    : actions.find((action) => sameAction(action, value));
  if (resolved) return actionLabel(resolved, node);
  if (typeof value !== "string") return actionLabel(value, node);
  return value;
}

export function formatBb(value: number) { return Number(value.toFixed(2)).toString(); }
export function isTrainingType(value: unknown): value is TrainingType { return typeof value === "string" && (TRAINING_TYPES as readonly string[]).includes(value); }
export function isTrainingPresentationMode(value: unknown): value is TrainingPresentationMode { return typeof value === "string" && (TRAINING_PRESENTATION_MODES as readonly string[]).includes(value); }
export function isFullHandStage(value: unknown): value is FullHandStage { return typeof value === "string" && (FULL_HAND_STAGES as readonly string[]).includes(value); }
export function isEquityModel(value: unknown): value is EquityModel { return typeof value === "string" && (EQUITY_MODELS as readonly string[]).includes(value); }
export function isQuestionCount(value: unknown): value is number | null { return value === null || (typeof value === "number" && (QUESTION_COUNTS as readonly number[]).includes(value)); }
export function isTrainingPosition(value: unknown): value is string {
  return typeof value === "string" && value.length <= 12 && /^(?:UTG(?:\+[1-7])?|EP|MP[1-7]?|LJ|HJ|CO|BTN|BU|SB|BB|P(?:[1-9]|10))$/.test(value);
}

export function actionAliases(action: TrainingAction) {
  return [action.id, action.type, action.type.toLowerCase(), action.label].filter((value): value is string => Boolean(value));
}

export function sameAction(left: TrainingAction, right: TrainingAction) {
  if (left.id && right.id) return left.id === right.id;
  if (left.type !== right.type) return false;
  if (left.amountBb !== undefined || right.amountBb !== undefined) return left.amountBb === right.amountBb;
  if (left.label && right.label) return left.label === right.label;
  return true;
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

export function classifyTrainingChoice(selectedKey: string, actions: TrainingAction[], bestAction: string | null, strategy?: Record<string, number>, mixedHint?: boolean): TrainingChoiceClassification | null {
  const selected = actions.find((action) => actionAliases(action).includes(selectedKey));
  if (!selected) return null;
  const configuredBest = bestAction ? actions.find((action) => actionAliases(action).includes(bestAction)) : null;
  const presented = strategy && isValidStrategy(strategy, actions) ? presentStrategy(strategy, actions, mixedHint) : null;
  const selectedPresentation = presented?.actions.find((item) => sameAction(item.action, selected)) ?? null;
  const selectedFrequency = selectedPresentation?.frequencyPercent;
  if (selectedFrequency !== null && selectedFrequency !== undefined) {
    const grade: TrainingChoiceGrade = configuredBest && sameAction(selected, configuredBest)
      ? "BEST"
      : selectedFrequency >= MIN_STRATEGY_FREQUENCY_PERCENT
        ? "CORRECT"
        : selectedFrequency > 0
          ? "INACCURACY"
          : "WRONG";
    return { grade, selectedAction: selectedPresentation, dominantAction: presented?.dominantAction ?? null, strategy: presented };
  }
  return {
    grade: configuredBest && sameAction(selected, configuredBest) ? "BEST" : "WRONG",
    selectedAction: null,
    dominantAction: null,
    strategy: null,
  };
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
  const classification = classifyTrainingChoice(selectedKey, actions, best.key, strategy);
  const correct = classification?.grade === "BEST" || classification?.grade === "CORRECT";
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
