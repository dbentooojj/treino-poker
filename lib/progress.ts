import { formatBb, trainingTypeLabels, type TrainingType } from "./training";

export type ProgressSessionRecord = {
  id: string;
  trainingType: TrainingType;
  playersCount: number | null;
  stackBb: number | null;
  heroPosition: string | null;
  correctAnswers: number;
  totalAnswers: number;
  durationSeconds: number;
  startedAt: number;
  endedAt: number | null;
};

export type ProgressBreakdownItem = {
  key: string;
  label: string;
  hands: number;
  accuracy: number;
};

export type ProgressEvolutionPoint = {
  date: string;
  timestamp: number;
  hands: number;
  accuracy: number;
};

export type ProgressDashboardData = {
  generatedAt: number;
  summary: {
    hands: number;
    accuracy: number;
    sessions: number;
    durationSeconds: number;
  };
  evolution: ProgressEvolutionPoint[];
  performance: {
    training: ProgressBreakdownItem[];
    position: ProgressBreakdownItem[];
    stack: ProgressBreakdownItem[];
  };
  latestSessions: Array<ProgressSessionRecord & {
    trainingLabel: string;
    configuration: string;
    accuracy: number;
  }>;
};

type Aggregate = { correct: number; total: number; timestamp: number };

const POSITION_ORDER = ["UTG", "EP", "MP1", "MP2", "HJ", "CO", "BTN_BU", "SB", "BB"];
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

export function buildProgressDashboard(records: ProgressSessionRecord[]): ProgressDashboardData {
  const sessions = records
    .filter((record) => record.totalAnswers > 0)
    .sort((left, right) => right.startedAt - left.startedAt);
  const hands = sessions.reduce((total, session) => total + session.totalAnswers, 0);
  const correct = sessions.reduce((total, session) => total + session.correctAnswers, 0);

  return {
    generatedAt: Date.now(),
    summary: {
      hands,
      accuracy: calculateAccuracy(correct, hands),
      sessions: sessions.length,
      durationSeconds: sessions.reduce((total, session) => total + session.durationSeconds, 0),
    },
    evolution: aggregateEvolution(sessions),
    performance: {
      training: aggregateBreakdown(sessions, (session) => session.trainingType, (key) => trainingTypeLabels[key as TrainingType]),
      position: aggregateBreakdown(sessions, (session) => normalizePosition(session.heroPosition), positionLabel, positionSort),
      stack: aggregateBreakdown(sessions, (session) => session.stackBb === null ? "ALL" : formatBb(session.stackBb), (key) => key === "ALL" ? "Todos os stacks" : `${key}bb`, (left, right) => Number(left.key) - Number(right.key)),
    },
    latestSessions: sessions.slice(0, 10).map((session) => ({
      ...session,
      trainingLabel: trainingTypeLabels[session.trainingType],
      configuration: `${session.playersCount === null ? "Várias mesas" : `${session.playersCount}-max`} · ${session.stackBb === null ? "todos os stacks" : `${formatBb(session.stackBb)}bb`}`,
      accuracy: calculateAccuracy(session.correctAnswers, session.totalAnswers),
    })),
  };
}

function aggregateEvolution(sessions: ProgressSessionRecord[]) {
  const groups = new Map<string, Aggregate>();
  for (const session of sessions) {
    const date = DAY_FORMATTER.format(new Date(session.startedAt));
    const current = groups.get(date) ?? { correct: 0, total: 0, timestamp: session.startedAt };
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
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function aggregateBreakdown(
  sessions: ProgressSessionRecord[],
  keyFor: (session: ProgressSessionRecord) => string,
  labelFor: (key: string) => string,
  sorter?: (left: ProgressBreakdownItem, right: ProgressBreakdownItem) => number,
) {
  const groups = new Map<string, Aggregate>();
  for (const session of sessions) {
    const key = keyFor(session);
    const current = groups.get(key) ?? { correct: 0, total: 0, timestamp: 0 };
    current.correct += session.correctAnswers;
    current.total += session.totalAnswers;
    groups.set(key, current);
  }
  const items = [...groups.entries()].map(([key, aggregate]) => ({
    key,
    label: labelFor(key),
    hands: aggregate.total,
    accuracy: calculateAccuracy(aggregate.correct, aggregate.total),
  }));
  return sorter ? items.sort(sorter) : items.sort((left, right) => right.hands - left.hands || left.label.localeCompare(right.label));
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
