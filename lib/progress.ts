import { actionKey, classifyTrainingChoice, decisionQualityScore, formatBb, recordValue, trainingTypeLabels, type EquityModel, type EvUnit, type TrainingAction, type TrainingChoiceClassification, type TrainingType } from "./training";

export type ProgressSessionRecord = {
  id: string;
  trainingType: TrainingType | null;
  playersCount: number | null;
  stackBb: number | null;
  heroPosition: string | null;
  correctAnswers: number;
  totalAnswers: number;
  durationSeconds: number;
  startedAt: number;
  endedAt: number | null;
};

export type ProgressAnswerRecord = {
  sessionId: string;
  trainingType: TrainingType | null;
  equityModel: EquityModel;
  evUnit: EvUnit;
  trainingNodeId: string;
  handClass: string;
  heroPosition: string;
  stackBb: number;
  selectedAction: Record<string, unknown>;
  bestAction: string;
  isCorrect: boolean;
  strategy?: Record<string, number>;
  isMixed?: boolean | null;
  availableActions?: TrainingAction[];
  evs: Record<string, number>;
  bigBlind: number;
  answeredAt: number;
};

export type ProgressBreakdownItem = {
  key: string;
  label: string;
  hands: number;
  accuracy: number;
  evLossBb: number | null;
};

export type ProgressEvolutionPoint = {
  date: string;
  timestamp: number;
  hands: number;
  accuracy: number;
  evEfficiency: number | null;
};

export type ProgressWeakSpot = ProgressBreakdownItem & {
  trainingType: TrainingType | null;
};

export type ProgressCostlySpot = {
  key: string;
  handClass: string;
  context: string;
  hands: number;
  evLossBb: number;
};

export type ProgressDashboardData = {
  generatedAt: number;
  coverage: {
    sessionsReturned: number;
    answersReturned: number;
    sessionLimit: number;
    answerLimit: number;
    sessionsTruncated: boolean;
    answersTruncated: boolean;
  };
  summary: {
    hands: number;
    accuracy: number | null;
    decisionQuality: number | null;
    principalActionRate: number | null;
    principalActions: number | null;
    evEfficiency: number | null;
    evLossBb: number | null;
    comparison: {
      hands: number | null;
      accuracy: number | null;
      evEfficiency: number | null;
      evLossBb: number | null;
    };
  };
  evolution: ProgressEvolutionPoint[];
  performance: {
    training: ProgressBreakdownItem[];
    position: ProgressBreakdownItem[];
    stack: ProgressBreakdownItem[];
  };
  weakSpots: ProgressWeakSpot[];
  costlySpots: ProgressCostlySpot[];
  latestSessions: Array<ProgressSessionRecord & {
    trainingLabel: string;
    configuration: string;
    accuracy: number;
    evLossBb: number | null;
  }>;
};

type Aggregate = { correct: number; total: number; timestamp: number; evLossBb: number; evSamples: number };

const POSITION_ORDER = ["UTG", "UTG+1", "LJ", "UTG+2", "UTG+3", "EP", "MP", "MP1", "MP2", "HJ", "CO", "BTN_BU", "SB", "BB"];
const MIN_WEAK_SPOT_SAMPLE = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function calculateAccuracy(correctAnswers: number, totalAnswers: number) {
  if (totalAnswers <= 0) return 0;
  return Math.round(Math.max(0, Math.min(correctAnswers, totalAnswers)) / totalAnswers * 100);
}

/** Returns HRC decision loss in BB. Answers without comparable stored EVs stay unavailable. */
export function calculateAnswerEvLossBb(answer: Pick<ProgressAnswerRecord, "equityModel" | "evUnit" | "selectedAction" | "bestAction" | "evs" | "bigBlind">) {
  if (answer.equityModel !== "CHIP_EV" || !["CHIPS", "BIG_BLINDS"].includes(answer.evUnit)) return null;
  const selected = answer.selectedAction as TrainingAction;
  if (!selected || typeof selected !== "object" || typeof selected.type !== "string") return null;
  const selectedEv = recordValue(answer.evs, selected);
  if (findEv(answer.evs, answer.bestAction) === null) return null;
  const bestEv = Math.max(...Object.values(answer.evs));
  if (selectedEv === null || !Number.isFinite(bestEv)) return null;
  const nativeLoss = Math.max(0, bestEv - selectedEv);
  if (answer.evUnit === "BIG_BLINDS") return roundBb(nativeLoss);
  if (!Number.isFinite(answer.bigBlind) || answer.bigBlind <= 0) return null;
  return roundBb(nativeLoss / answer.bigBlind);
}

export function buildProgressDashboard(
  records: ProgressSessionRecord[],
  answerRecords: ProgressAnswerRecord[] = [],
  generatedAt = Date.now(),
  coverage: ProgressDashboardData["coverage"] = {
    sessionsReturned: records.length,
    answersReturned: answerRecords.length,
    sessionLimit: records.length,
    answerLimit: answerRecords.length,
    sessionsTruncated: false,
    answersTruncated: false,
  },
): ProgressDashboardData {
  const sessions = records
    .filter((record) => record.totalAnswers > 0)
    .sort((left, right) => right.startedAt - left.startedAt);
  const answers = answerRecords
    .map((answer) => {
      const classification = classifyProgressAnswer(answer);
      return { ...answer, isCorrect: classification?.acceptable ?? answer.isCorrect, classification, evLossBb: calculateAnswerEvLossBb(answer) };
    })
    .sort((left, right) => right.answeredAt - left.answeredAt);
  const hands = sessions.reduce((total, session) => total + session.totalAnswers, 0);
  const correct = sessions.reduce((total, session) => total + session.correctAnswers, 0);
  const evTotals = aggregateEv(answers);
  const classifications = answers.map((answer) => answer.classification).filter((classification): classification is TrainingChoiceClassification => classification !== null);
  const qualityScores = classifications.map(decisionQualityScore);
  const decisionQuality = answers.length > 0 && classifications.length === answers.length && qualityScores.every((score): score is number => score !== null)
    ? Math.round(qualityScores.reduce((total, score) => total + score, 0) / qualityScores.length)
    : null;
  const principalActions = classifications.length === answers.length ? classifications.filter((classification) => classification.isPrincipal).length : null;

  return {
    generatedAt,
    coverage,
    summary: {
      hands,
      accuracy: hands ? calculateAccuracy(correct, hands) : null,
      decisionQuality,
      principalActionRate: principalActions === null || answers.length === 0 ? null : Math.round(principalActions / answers.length * 100),
      principalActions,
      // There is no established RangeLab/HRC denominator for EV efficiency yet.
      evEfficiency: null,
      evLossBb: evTotals.samples ? roundBb(evTotals.loss) : null,
      comparison: buildComparison(sessions, answers, generatedAt),
    },
    evolution: aggregateEvolution(sessions),
    performance: {
      training: aggregateAnswerBreakdown(answers, (answer) => answer.trainingType ?? "FULL_HAND", (key) => key === "FULL_HAND" ? "Mão completa" : trainingTypeLabels[key as TrainingType]),
      position: aggregateAnswerBreakdown(answers, (answer) => normalizePosition(answer.heroPosition), positionLabel, positionSort),
      stack: aggregateAnswerBreakdown(answers, (answer) => formatBb(answer.stackBb), (key) => `${key} BB`, (left, right) => Number(left.key) - Number(right.key)),
    },
    weakSpots: buildWeakSpots(answers),
    costlySpots: buildCostlySpots(answers),
    latestSessions: buildLatestSessions(sessions, answers),
  };
}

function buildComparison(
  sessions: ProgressSessionRecord[],
  answers: Array<ProgressAnswerRecord & { evLossBb: number | null }>,
  now: number,
) {
  const currentStart = now - 30 * DAY_MS;
  const previousStart = now - 60 * DAY_MS;
  const currentSessions = sessions.filter((session) => session.startedAt >= currentStart);
  const previousSessions = sessions.filter((session) => session.startedAt >= previousStart && session.startedAt < currentStart);
  const currentAnswers = answers.filter((answer) => answer.answeredAt >= currentStart);
  const previousAnswers = answers.filter((answer) => answer.answeredAt >= previousStart && answer.answeredAt < currentStart);
  const current = sessionTotals(currentSessions);
  const previous = sessionTotals(previousSessions);
  const currentEv = aggregateEv(currentAnswers);
  const previousEv = aggregateEv(previousAnswers);
  return {
    hands: previous.total ? current.total - previous.total : null,
    accuracy: previous.total && current.total ? calculateAccuracy(current.correct, current.total) - calculateAccuracy(previous.correct, previous.total) : null,
    evEfficiency: null,
    // Improvement is positive when the user lost fewer BB than in the prior 30 days.
    evLossBb: previousEv.samples && currentEv.samples ? roundBb(previousEv.loss - currentEv.loss) : null,
  };
}

function aggregateEvolution(sessions: ProgressSessionRecord[]) {
  const groups = new Map<string, Aggregate>();
  for (const session of sessions) {
    const date = DAY_FORMATTER.format(new Date(session.startedAt));
    const current = groups.get(date) ?? emptyAggregate(session.startedAt);
    current.correct += session.correctAnswers;
    current.total += session.totalAnswers;
    current.timestamp = Math.min(current.timestamp, session.startedAt);
    groups.set(date, current);
  }
  return [...groups.entries()]
    .map(([date, aggregate]) => ({
      date,
      timestamp: aggregate.timestamp,
      hands: aggregate.total,
      accuracy: calculateAccuracy(aggregate.correct, aggregate.total),
      evEfficiency: null,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function aggregateAnswerBreakdown(
  answers: Array<ProgressAnswerRecord & { evLossBb: number | null }>,
  keyFor: (answer: ProgressAnswerRecord) => string,
  labelFor: (key: string) => string,
  sorter?: (left: ProgressBreakdownItem, right: ProgressBreakdownItem) => number,
) {
  const groups = new Map<string, Aggregate>();
  for (const answer of answers) addAnswer(groups, keyFor(answer), answer);
  const items = [...groups.entries()].map(([key, aggregate]) => breakdownItem(key, labelFor(key), aggregate));
  return sorter ? items.sort(sorter) : items.sort((left, right) => right.hands - left.hands || left.label.localeCompare(right.label));
}

function buildWeakSpots(answers: Array<ProgressAnswerRecord & { evLossBb: number | null }>): ProgressWeakSpot[] {
  const groups = new Map<string, Aggregate>();
  for (const answer of answers) {
    const position = normalizePosition(answer.heroPosition);
    addAnswer(groups, `${answer.trainingType}|${position}|${formatBb(answer.stackBb)}`, answer);
  }
  return [...groups.entries()].map(([key, aggregate]) => {
    const [rawTrainingType, position, stack] = key.split("|") as [TrainingType | "null", string, string];
    return {
      ...breakdownItem(key, `${positionLabel(position)} · ${stack} BB`, aggregate),
      trainingType: rawTrainingType === "null" ? null : rawTrainingType,
    };
  }).filter((item) => item.hands >= MIN_WEAK_SPOT_SAMPLE && (item.accuracy < 75 || (item.evLossBb ?? 0) > 0))
    .sort((left, right) => (right.evLossBb ?? -1) - (left.evLossBb ?? -1) || left.accuracy - right.accuracy || right.hands - left.hands)
    .slice(0, 4);
}

function buildCostlySpots(answers: Array<ProgressAnswerRecord & { evLossBb: number | null }>): ProgressCostlySpot[] {
  const groups = new Map<string, { loss: number; hands: number; handClass: string; context: string }>();
  for (const answer of answers) {
    if (answer.evLossBb === null || answer.evLossBb <= 0) continue;
    const stack = formatBb(answer.stackBb);
    const position = positionLabel(normalizePosition(answer.heroPosition));
    const key = `${answer.trainingType}|${answer.handClass}|${position}|${stack}`;
    const current = groups.get(key) ?? { loss: 0, hands: 0, handClass: answer.handClass, context: `${position} · ${stack} BB · ${answer.trainingType ? trainingTypeLabels[answer.trainingType] : "Mão completa"}` };
    current.loss += answer.evLossBb;
    current.hands += 1;
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, value]) => ({
    key,
    handClass: value.handClass,
    context: value.context,
    hands: value.hands,
    evLossBb: roundBb(value.loss),
  })).sort((left, right) => right.evLossBb - left.evLossBb || right.hands - left.hands || left.key.localeCompare(right.key)).slice(0, 5);
}

function buildLatestSessions(
  sessions: ProgressSessionRecord[],
  answers: Array<ProgressAnswerRecord & { evLossBb: number | null }>,
): ProgressDashboardData["latestSessions"] {
  const evBySession = new Map<string, { loss: number; samples: number }>();
  for (const answer of answers) {
    if (answer.evLossBb === null) continue;
    const current = evBySession.get(answer.sessionId) ?? { loss: 0, samples: 0 };
    current.loss += answer.evLossBb;
    current.samples += 1;
    evBySession.set(answer.sessionId, current);
  }
  return sessions.slice(0, 6).map((session) => {
    const ev = evBySession.get(session.id);
    return {
      ...session,
      trainingLabel: session.trainingType === null ? "Todos os spots" : trainingTypeLabels[session.trainingType],
      configuration: `${session.playersCount === null ? "Várias mesas" : `${session.playersCount}-max`} · ${session.stackBb === null ? "todos os stacks" : `${formatBb(session.stackBb)} BB`}`,
      accuracy: calculateAccuracy(session.correctAnswers, session.totalAnswers),
      evLossBb: ev?.samples ? roundBb(ev.loss) : null,
    };
  });
}

function addAnswer(
  groups: Map<string, Aggregate>,
  key: string,
  answer: ProgressAnswerRecord & { evLossBb: number | null },
) {
  const current = groups.get(key) ?? emptyAggregate(answer.answeredAt);
  current.correct += answer.isCorrect ? 1 : 0;
  current.total += 1;
  if (answer.evLossBb !== null) {
    current.evLossBb += answer.evLossBb;
    current.evSamples += 1;
  }
  groups.set(key, current);
}

function breakdownItem(key: string, label: string, aggregate: Aggregate): ProgressBreakdownItem {
  return {
    key,
    label,
    hands: aggregate.total,
    accuracy: calculateAccuracy(aggregate.correct, aggregate.total),
    evLossBb: aggregate.evSamples ? roundBb(aggregate.evLossBb) : null,
  };
}

function aggregateEv(answers: Array<{ evLossBb: number | null }>) {
  return answers.reduce((total, answer) => {
    if (answer.evLossBb !== null) {
      total.loss += answer.evLossBb;
      total.samples += 1;
    }
    return total;
  }, { loss: 0, samples: 0 });
}

function sessionTotals(sessions: ProgressSessionRecord[]) {
  return sessions.reduce((total, session) => ({
    total: total.total + session.totalAnswers,
    correct: total.correct + session.correctAnswers,
  }), { total: 0, correct: 0 });
}

function classifyProgressAnswer(answer: ProgressAnswerRecord) {
  if (!answer.strategy || !answer.availableActions?.length) return null;
  const selected = answer.selectedAction as TrainingAction;
  if (!selected || typeof selected !== "object" || typeof selected.type !== "string") return null;
  return classifyTrainingChoice(actionKey(selected), answer.availableActions, answer.bestAction, answer.strategy, Boolean(answer.isMixed), {
    evs: answer.evs,
    evUnit: answer.evUnit,
    bigBlind: answer.bigBlind,
  });
}

function findEv(evs: Record<string, number>, key: string) {
  if (typeof evs[key] === "number" && Number.isFinite(evs[key])) return evs[key];
  const match = Object.entries(evs).find(([candidate, value]) => candidate.toLowerCase() === key.toLowerCase() && Number.isFinite(value));
  return match?.[1] ?? null;
}

function emptyAggregate(timestamp: number): Aggregate {
  return { correct: 0, total: 0, timestamp, evLossBb: 0, evSamples: 0 };
}

function normalizePosition(position: string | null) {
  if (position === null) return "ALL";
  return position === "BTN" || position === "BU" ? "BTN_BU" : position;
}

function positionLabel(position: string) {
  if (position === "ALL") return "Todas as posições";
  return position === "BTN_BU" ? "BTN / BU" : position;
}

function positionSort(left: ProgressBreakdownItem, right: ProgressBreakdownItem) {
  const leftIndex = POSITION_ORDER.indexOf(left.key);
  const rightIndex = POSITION_ORDER.indexOf(right.key);
  return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.label.localeCompare(right.label);
}

function roundBb(value: number) {
  return Number(value.toFixed(4));
}
