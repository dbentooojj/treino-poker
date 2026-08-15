import { and, asc, eq } from "drizzle-orm";
import type { HrcAction, HrcSequenceAction } from "../lib/hrc-import";
import type { EquityModel, FullHandStage, QueueEntry } from "../lib/training";
import { getDb } from "./index";
import {
  hrcSourceEdges,
  hrcSourceHands,
  hrcSourceNodes,
  studyCapabilities,
  trainingHands,
  trainingSessions,
  trainingSets,
} from "./schema";

export type FullHandState = NonNullable<(typeof trainingSessions.$inferSelect)["fullHandState"]>;

export type FullHandStudy = {
  id: string;
  equityModel: EquityModel;
  playersCount: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  metadata: Record<string, unknown>;
  capabilityMetadata: Record<string, unknown>;
};

export type FullHandAdvance = {
  state: FullHandState;
  entry: QueueEntry | null;
  terminal: boolean;
};

const PUBLISHED_FULL_HAND = [
  eq(trainingSets.status, "PUBLISHED" as const),
  eq(trainingSets.isPublished, true),
  eq(trainingSets.street, "PREFLOP" as const),
  eq(studyCapabilities.capability, "FULL_HAND_PREFLOP"),
];

export async function getPublishedFullHandStages() {
  const rows = await getDb().select({
    equityModel: trainingSets.equityModel,
  }).from(studyCapabilities)
    .innerJoin(trainingSets, eq(trainingSets.id, studyCapabilities.trainingSetId))
    .where(and(...PUBLISHED_FULL_HAND))
    .orderBy(asc(trainingSets.displayOrder), asc(trainingSets.importedAt), asc(trainingSets.id));
  return rows.length
    ? [{ stage: "PREFLOP" as const, label: "Pré-flop", equityModel: rows[0].equityModel }]
    : [];
}

export async function selectPublishedFullHandStudy(stage: FullHandStage, equityModel?: EquityModel) {
  if (stage !== "PREFLOP") return null;
  const rows = await getDb().select({
    id: trainingSets.id,
    equityModel: trainingSets.equityModel,
    playersCount: trainingSets.playersCount,
    smallBlind: trainingSets.smallBlind,
    bigBlind: trainingSets.bigBlind,
    ante: trainingSets.ante,
    anteType: trainingSets.anteType,
    metadata: trainingSets.metadata,
    capabilityMetadata: studyCapabilities.metadata,
  }).from(studyCapabilities)
    .innerJoin(trainingSets, eq(trainingSets.id, studyCapabilities.trainingSetId))
    .where(and(...PUBLISHED_FULL_HAND, ...(equityModel ? [eq(trainingSets.equityModel, equityModel)] : [])))
    .orderBy(asc(trainingSets.displayOrder), asc(trainingSets.importedAt), asc(trainingSets.id))
    .limit(1);
  return (rows[0] ?? null) as FullHandStudy | null;
}

export async function getFullHandStudy(trainingSetId: string) {
  const [row] = await getDb().select({
    id: trainingSets.id,
    equityModel: trainingSets.equityModel,
    playersCount: trainingSets.playersCount,
    smallBlind: trainingSets.smallBlind,
    bigBlind: trainingSets.bigBlind,
    ante: trainingSets.ante,
    anteType: trainingSets.anteType,
    metadata: trainingSets.metadata,
    capabilityMetadata: studyCapabilities.metadata,
  }).from(studyCapabilities)
    .innerJoin(trainingSets, eq(trainingSets.id, studyCapabilities.trainingSetId))
    .where(and(eq(trainingSets.id, trainingSetId), ...PUBLISHED_FULL_HAND))
    .limit(1);
  return (row ?? null) as FullHandStudy | null;
}

export async function dealFullHand(study: FullHandStudy): Promise<FullHandAdvance> {
  const rootSourceNodeId = stringMetadata(study.capabilityMetadata, "rootSourceNodeId");
  const eligibleHeroPlayers = numberArrayMetadata(study.capabilityMetadata, "eligibleHeroPlayers")
    .filter((player) => player >= 0 && player < study.playersCount);
  if (!rootSourceNodeId || !eligibleHeroPlayers.length) throw new Error("Capacidade Full Hand inválida.");
  const handClasses = canonicalHandClasses();
  const stacksBb = initialStacksBb(study);

  for (let attempt = 0; attempt < 100; attempt++) {
    const heroPlayer = eligibleHeroPlayers[randomIndex(eligibleHeroPlayers.length)];
    const playerHandClasses = Array.from({ length: study.playersCount }, () => handClasses[randomIndex(handClasses.length)]);
    const state: FullHandState = {
      version: 1,
      rootSourceNodeId,
      currentSourceNodeId: rootSourceNodeId,
      heroPlayer,
      heroHandClass: playerHandClasses[heroPlayer],
      playerHandClasses,
      actionHistory: [],
      foldedPlayers: [],
      playerContributionsBb: [],
      potBb: 0,
      stacksBb,
    };
    const advanced = await advanceToHero(study, state, rootSourceNodeId);
    if (!advanced.terminal) return advanced;
  }
  throw new Error("Não foi possível distribuir uma mão que chegasse ao Hero.");
}

export async function continueFullHand(study: FullHandStudy, state: FullHandState, actionIndex: number): Promise<FullHandAdvance> {
  const node = await loadNode(study.id, state.currentSourceNodeId);
  if (!node || node.player !== state.heroPlayer || actionIndex < 0 || actionIndex >= node.actions.length) {
    throw new Error("Estado de mão completa inválido.");
  }
  const childId = await childForAction(node.id, actionIndex);
  if (!childId) return { state: snapshotState(study, state, node.actionSequence), entry: null, terminal: true };
  return advanceToHero(study, state, childId);
}

async function advanceToHero(study: FullHandStudy, original: FullHandState, startNodeId: string): Promise<FullHandAdvance> {
  let currentNodeId = startNodeId;
  for (let step = 0; step < 2_000; step++) {
    const node = await loadNode(study.id, currentNodeId);
    if (!node) throw new Error("Node da árvore HRC não encontrado.");
    const state = {
      ...snapshotState(study, original, node.actionSequence),
      currentSourceNodeId: node.id,
    };
    if (node.actions.length === 0 || node.player < 0) return { state, entry: null, terminal: true };

    if (node.player === state.heroPlayer && node.actions.length > 1) {
      if (!node.trainingNodeId) throw new Error("Decisão do Hero sem training_node compatível.");
      const [hand] = await getDb().select({ id: trainingHands.id }).from(trainingHands)
        .where(and(eq(trainingHands.trainingNodeId, node.trainingNodeId), eq(trainingHands.handClass, state.heroHandClass)))
        .limit(1);
      if (!hand) throw new Error("Estratégia do Hero não encontrada.");
      return {
        state,
        entry: { trainingSetId: study.id, trainingNodeId: node.trainingNodeId, trainingHandId: hand.id },
        terminal: false,
      };
    }

    const handClass = state.playerHandClasses[node.player];
    const strategy = node.actions.length === 1 ? null : await strategyForNode(node.id, node.trainingNodeId, handClass);
    if (node.actions.length > 1 && !strategy) throw new Error("Estratégia de jogador não encontrada na árvore HRC.");
    const actionIndex = strategy ? weightedActionIndex(strategy, node.actions.length) : 0;
    const childId = await childForAction(node.id, actionIndex);
    if (!childId) return { state, entry: null, terminal: true };
    currentNodeId = childId;
  }
  throw new Error("A árvore HRC excedeu o limite seguro de navegação.");
}

async function loadNode(trainingSetId: string, id: string) {
  const [node] = await getDb().select({
    id: hrcSourceNodes.id,
    player: hrcSourceNodes.player,
    actions: hrcSourceNodes.actions,
    actionSequence: hrcSourceNodes.actionSequence,
    trainingNodeId: hrcSourceNodes.trainingNodeId,
  }).from(hrcSourceNodes)
    .where(and(eq(hrcSourceNodes.trainingSetId, trainingSetId), eq(hrcSourceNodes.id, id)))
    .limit(1);
  return node ? {
    ...node,
    actions: node.actions as HrcAction[],
    actionSequence: node.actionSequence as HrcSequenceAction[],
  } : null;
}

async function childForAction(parentNodeId: string, actionIndex: number) {
  const [edge] = await getDb().select({ childNodeId: hrcSourceEdges.childNodeId }).from(hrcSourceEdges)
    .where(and(eq(hrcSourceEdges.parentNodeId, parentNodeId), eq(hrcSourceEdges.actionIndex, actionIndex)))
    .limit(1);
  return edge?.childNodeId ?? null;
}

async function strategyForNode(sourceNodeId: string, trainingNodeId: string | null, handClass: string) {
  if (trainingNodeId) {
    const [row] = await getDb().select({ strategy: trainingHands.strategy }).from(trainingHands)
      .where(and(eq(trainingHands.trainingNodeId, trainingNodeId), eq(trainingHands.handClass, handClass)))
      .limit(1);
    return row?.strategy ?? null;
  }
  const [row] = await getDb().select({ strategy: hrcSourceHands.strategy }).from(hrcSourceHands)
    .where(and(eq(hrcSourceHands.sourceNodeId, sourceNodeId), eq(hrcSourceHands.handClass, handClass)))
    .limit(1);
  return row?.strategy ?? null;
}

function weightedActionIndex(strategy: Record<string, number>, actionCount: number) {
  const weights = Array.from({ length: actionCount }, (_, index) => Math.max(0, strategy[`action-${index}`] ?? 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  let roll = Math.random() * total;
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index];
    if (roll <= 0) return index;
  }
  return weights.length - 1;
}

function snapshotState(study: FullHandStudy, state: FullHandState, sequence: HrcSequenceAction[]): FullHandState {
  const contributions = initialContributions(study);
  const folded = new Set<number>();
  for (const action of sequence) {
    if (action.street !== 0 || action.player < 0 || action.player >= study.playersCount) continue;
    if (action.type === "F") {
      folded.add(action.player);
    } else if (action.type === "R") {
      contributions[action.player] = Math.max(contributions[action.player], action.amount / study.bigBlind);
    } else if (action.type === "C") {
      contributions[action.player] += action.amount / study.bigBlind;
    }
  }
  return {
    ...state,
    actionHistory: sequence as unknown as Array<Record<string, unknown>>,
    foldedPlayers: [...folded],
    playerContributionsBb: contributions.map(roundBb),
    potBb: roundBb(contributions.reduce((sum, contribution) => sum + contribution, 0)),
    stacksBb: initialStacksBb(study).map((stack, player) => roundBb(Math.max(0, stack - contributions[player]))),
  };
}

function initialContributions(study: FullHandStudy) {
  const contributions = Array.from({ length: study.playersCount }, () => 0);
  contributions[study.playersCount - 1] += study.bigBlind / study.bigBlind;
  contributions[study.playersCount - 2] += study.smallBlind / study.bigBlind;
  if (study.anteType === "BB_ANTE") contributions[study.playersCount - 1] += study.ante / study.bigBlind;
  if (study.anteType === "ANTE") {
    for (let player = 0; player < study.playersCount; player++) contributions[player] += study.ante / study.bigBlind;
  }
  return contributions;
}

function initialStacksBb(study: FullHandStudy) {
  const values = numberArrayMetadata(study.metadata, "initialStacksBb");
  if (values.length === study.playersCount && values.every((value) => value > 0)) return values;
  const fallback = typeof study.metadata.stackBb === "number" ? study.metadata.stackBb : 20;
  return Array.from({ length: study.playersCount }, () => fallback);
}

function canonicalHandClasses() {
  const ranks = [..."AKQJT98765432"];
  const hands: string[] = [];
  for (let first = 0; first < ranks.length; first++) {
    hands.push(`${ranks[first]}${ranks[first]}`);
    for (let second = first + 1; second < ranks.length; second++) {
      hands.push(`${ranks[first]}${ranks[second]}s`, `${ranks[first]}${ranks[second]}o`);
    }
  }
  return hands;
}

function numberArrayMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function stringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function randomIndex(length: number) {
  return Math.min(length - 1, Math.floor(Math.random() * length));
}

function roundBb(value: number) {
  return Number(value.toFixed(4));
}
