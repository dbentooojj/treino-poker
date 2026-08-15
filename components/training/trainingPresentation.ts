import { formatBb, type TrainingExercise, type TrainingSequenceAction, type TrainingViewMode } from "../../lib/training";

export type TrainingTableSeat = {
  position: string;
  label: string;
  placement: string;
  dealer: boolean;
};

export type TrainingSeatLastAction = "FOLD" | "CALL" | "CHECK" | "BET" | "RAISE" | "ALL_IN";

export type TrainingSeatVisualState = TrainingTableSeat & {
  isHero: boolean;
  isFolded: boolean;
  isActiveInHand: boolean;
  hasCards: boolean;
  cardsFaceUp: boolean;
  stackBb?: number;
  committedBb: number;
  lastAction?: TrainingSeatLastAction;
  isActing: boolean;
};

export type TrainingTableVisualState = {
  mode: TrainingViewMode;
  seats: TrainingSeatVisualState[];
  potBb: number;
};

const TABLE_POSITIONS: Record<number, string[]> = {
  2: ["SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "UTG+1", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  10: ["UTG", "UTG+1", "UTG+2", "UTG+3", "MP", "HJ", "CO", "BTN", "SB", "BB"],
};

export function trainingTableSeats(playersCount: number, heroPosition: string): TrainingTableSeat[] {
  const count = Math.max(2, Math.min(10, Math.round(playersCount)));
  const positions = [...(TABLE_POSITIONS[count] ?? Array.from({ length: count }, (_, index) => `P${index + 1}`))];
  const normalizedHero = normalizeTrainingPosition(heroPosition);

  if (!positions.some((position) => normalizeTrainingPosition(position) === normalizedHero)) {
    positions[0] = heroPosition;
  }

  return positions.map((position) => {
    const normalized = normalizeTrainingPosition(position);
    return {
      position,
      label: displayTrainingPosition(position, count),
      placement: positionClass(normalized),
      dealer: count === 2 ? normalized === "SB" : normalized === "BTN",
    };
  });
}

export function visibleTrainingTableSeats(playersCount: number, heroPosition: string) {
  const seats = trainingTableSeats(playersCount, heroPosition);
  return playersCount === 9 ? seats.filter((seat) => normalizeTrainingPosition(seat.position) !== "UTG+2") : seats;
}

export function deriveTrainingTableVisualState(
  exercise: TrainingExercise,
  mode: TrainingViewMode,
  visibleActionCount = exercise.actionSequence.length,
): TrainingTableVisualState {
  const allSeats = trainingTableSeats(exercise.playersCount, exercise.heroPosition);
  const heroPosition = normalizeTrainingPosition(exercise.heroPosition);
  const bigBlind = exercise.blinds.bigBlind > 0 ? exercise.blinds.bigBlind : 1;
  const liveContributions = new Map(allSeats.map((seat) => [normalizeTrainingPosition(seat.position), 0]));
  const deadContributions = new Map(allSeats.map((seat) => [normalizeTrainingPosition(seat.position), 0]));
  const folded = new Set<string>();
  const lastActions = new Map<string, TrainingSeatLastAction>();
  const actionCount = mode === "quick-decision" ? exercise.actionSequence.length : visibleActionCount;
  const visibleSequence = exercise.actionSequence.slice(0, Math.max(0, Math.min(actionCount, exercise.actionSequence.length)));

  setContribution(liveContributions, "SB", exercise.blinds.smallBlind / bigBlind);
  setContribution(liveContributions, "BB", 1);
  const anteBb = Math.max(0, exercise.blinds.ante / bigBlind);
  if (anteBb > 0) {
    const anteType = exercise.blinds.anteType.toUpperCase();
    if (anteType.includes("BB")) setContribution(deadContributions, "BB", anteBb);
    else for (const seat of allSeats) setContribution(deadContributions, seat.position, anteBb);
  }

  visibleSequence.forEach((action) => {
    if (!action.position) return;
    const position = normalizeTrainingPosition(action.position);
    if (!liveContributions.has(position) || folded.has(position)) return;
    const committed = liveContributions.get(position) ?? 0;

    if (action.type === "FOLD") {
      folded.add(position);
      lastActions.set(position, "FOLD");
      return;
    }
    if (action.type === "CHECK") {
      lastActions.set(position, "CHECK");
      return;
    }
    if (action.type === "CALL") {
      const rawHrcAmount = finiteNumber(action.metadata?.hrcAmount);
      const callTarget = rawHrcAmount === undefined
        ? typeof action.amountBb === "number"
          ? Math.max(committed, action.amountBb)
          : Math.max(...liveContributions.values())
        : committed + Math.max(0, rawHrcAmount / bigBlind);
      liveContributions.set(position, roundBb(callTarget));
      lastActions.set(position, "CALL");
      return;
    }

    if (typeof action.amountBb === "number") {
      liveContributions.set(position, roundBb(Math.max(committed, action.amountBb)));
    }
    lastActions.set(position, action.label?.toLowerCase().includes("all-in")
      ? "ALL_IN"
      : action.type === "BET" ? "BET" : "RAISE");
  });

  const latestActor = visibleSequence.at(-1)?.position
    ? normalizeTrainingPosition(visibleSequence.at(-1)!.position!)
    : null;
  const sequenceComplete = visibleSequence.length >= exercise.actionSequence.length;
  const seats = visibleTrainingTableSeats(exercise.playersCount, exercise.heroPosition).map<TrainingSeatVisualState>((seat) => {
    const position = normalizeTrainingPosition(seat.position);
    const isHero = position === heroPosition;
    const isFolded = folded.has(position);
    return {
      ...seat,
      isHero,
      isFolded,
      isActiveInHand: !isFolded,
      hasCards: !isFolded,
      cardsFaceUp: isHero && !isFolded,
      // The current exercise payload only exposes Hero's stack. Villain stacks
      // stay absent instead of being inferred from the effective stack.
      ...(isHero ? { stackBb: exercise.heroStackBb } : {}),
      committedBb: roundBb((liveContributions.get(position) ?? 0) + (deadContributions.get(position) ?? 0)),
      lastAction: lastActions.get(position),
      isActing: sequenceComplete ? isHero : latestActor === position,
    };
  });
  const potBb = roundBb(
    [...liveContributions.values()].reduce((total, amount) => total + amount, 0)
    + [...deadContributions.values()].reduce((total, amount) => total + amount, 0),
  );

  return { mode, seats, potBb };
}

export function displayTrainingPosition(position: string, playersCount: number) {
  const normalized = normalizeTrainingPosition(position);
  return playersCount === 2 && normalized === "SB" ? "BTN/SB" : normalized;
}

export function normalizeTrainingPosition(position: string) {
  return position.toUpperCase() === "BU" ? "BTN" : position.toUpperCase();
}

export function buildTrainingPrompt(exercise: TrainingExercise) {
  const hero = displayTrainingPosition(exercise.heroPosition, exercise.playersCount);
  const villain = exercise.villainPosition
    ? displayTrainingPosition(exercise.villainPosition, exercise.playersCount)
    : "O vilão";
  const aggressiveAction = findVillainAggressiveAction(exercise);
  const sizing = typeof aggressiveAction?.amountBb === "number" ? ` ${formatBb(aggressiveAction.amountBb)} BB` : "";
  const stack = `${formatBb(exercise.heroStackBb)} BB`;

  if (exercise.trainingType === "CALL_VS_SHOVE") {
    return `${villain} foi all-in${sizing}. Você está no ${hero} com ${stack}. O que você faz?`;
  }
  if (exercise.trainingType === "VS_OPEN") {
    return `${villain} abriu${sizing}. Você está no ${hero}. Qual é sua resposta?`;
  }
  if (exercise.trainingType === "VS_3_BET") {
    return `${villain} aplicou uma 3-bet${sizing} após o seu open. Você está no ${hero}. Qual é sua resposta?`;
  }
  if (exercise.trainingType === "VS_4_BET") {
    return `${villain} aplicou uma 4-bet${sizing} após a sua 3-bet. Você está no ${hero}. Qual é sua resposta?`;
  }
  if (exercise.trainingType === "OPEN_FOLD") {
    return `A ação chegou em fold até você no ${hero}. O que fazer?`;
  }
  return `Você está no ${hero} com ${stack}. O que você faz?`;
}

export function sequenceActionLabel(action: TrainingSequenceAction, index: number, sequence: TrainingSequenceAction[]) {
  if (action.type === "FOLD") return "fold";
  if (action.type === "CHECK") return "check";
  if (action.type === "CALL") return "call";

  const amount = typeof action.amountBb === "number" ? ` ${formatBb(action.amountBb)} BB` : "";
  if (action.label?.toLowerCase().includes("all-in")) return `all-in${amount}`;
  if (action.type === "BET") return `bet${amount}`;

  const priorRaises = sequence.slice(0, index).filter((sequenceAction) => sequenceAction.type === "RAISE").length;
  const actionName = priorRaises === 0 ? "raise" : `${priorRaises + 2}-bet`;
  return `${actionName}${amount}`;
}

function findVillainAggressiveAction(exercise: TrainingExercise) {
  const villain = exercise.villainPosition ? normalizeTrainingPosition(exercise.villainPosition) : null;
  return [...exercise.actionSequence].reverse().find((action) => {
    const aggressive = action.type === "RAISE" || action.type === "BET";
    if (!aggressive) return false;
    return !villain || (action.position && normalizeTrainingPosition(action.position) === villain);
  });
}

function positionClass(position: string) {
  if (position === "EP") return "utg";
  if (/^MP[1-7]?$/.test(position)) return "mp";
  if (/^P(?:[1-9]|10)$/.test(position)) return position.toLowerCase();
  return position.toLowerCase().replace("+", "-").replace(/[^a-z0-9-]/g, "");
}

function setContribution(contributions: Map<string, number>, position: string, amount: number) {
  const normalized = normalizeTrainingPosition(position);
  if (contributions.has(normalized)) contributions.set(normalized, roundBb(Math.max(0, amount)));
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundBb(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
