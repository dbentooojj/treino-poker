import { formatBb, type TrainingExercise, type TrainingSequenceAction } from "../../lib/training";

export type TrainingTableSeat = {
  position: string;
  label: string;
  placement: string;
  dealer: boolean;
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
