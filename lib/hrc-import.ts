import type { EvUnit, StudyCapability, TrainingAction, TrainingSequenceAction, TrainingType } from "./training";

export type HrcAction = {
  type: "F" | "C" | "R" | "X";
  amount: number;
  node?: number | string;
  metadata: Record<string, unknown>;
};

export type HrcSequenceAction = HrcAction & { player: number; street: number };
export type HrcHand = {
  weight: number;
  played: number[];
  evs: number[];
  metadata: Record<string, unknown>;
};
export type HrcNode = {
  nodeKey: string;
  sourceNodeId: string;
  sourcePath: string;
  player: number;
  street: number;
  children: number;
  sequence: HrcSequenceAction[];
  actions: HrcAction[];
  hands: Record<string, HrcHand>;
  eligibleHandCount: number;
  metadata: Record<string, unknown>;
};
export type HrcSettings = {
  handdata: {
    stacks: number[];
    blinds: number[];
    skipSb: boolean;
    movingBu: boolean;
    anteType: string;
    anteMode: string;
    anteFirst: boolean;
  };
  eqmodel: { id: string; raked: boolean; metadata: Record<string, unknown> };
  metadata: Record<string, unknown>;
};

type HrcPreflopContext = {
  stacks: number[];
  initialLiveContributions: number[];
  deadContributions: number[];
};

type HrcPreflopState = {
  active: boolean[];
  liveContributions: number[];
  remainingStacks: number[];
};
export type HrcValidatedPack = { name: string; settings: HrcSettings; nodes: HrcNode[]; eligible: number };
export type HrcPack = HrcValidatedPack & { contentHash: string; archiveSizeBytes: number };

export type HrcStudyNode = {
  nodeKey: string;
  trainingType: TrainingType | null;
  decisionEligible: boolean;
  heroPosition: string;
  heroStackBb: number;
  villainPosition: string | null;
  actionSequence: TrainingSequenceAction[];
  availableActions: TrainingAction[];
  hands: Array<{
    handClass: string;
    strategy: Record<string, number>;
    evs: Record<string, number>;
    bestAction: string | null;
    decisionClarity: number | null;
    isMixed: boolean;
    metadata: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
};

export const HRC_IGNORED_REASONS = ["POSTFLOP", "AUTOMATIC_X", "UNSUPPORTED_SEQUENCE", "NO_ELIGIBLE_HANDS", "NON_TRAINABLE"] as const;
export type HrcIgnoredReason = (typeof HRC_IGNORED_REASONS)[number];
export type HrcIgnoredCounts = Record<HrcIgnoredReason, number>;

export type HrcSourceTreeNode = {
  sourceNodeId: string;
  sourcePath: string;
  player: number;
  street: number;
  sequence: HrcSequenceAction[];
  actions: HrcAction[];
  trainingNodeKey: string | null;
  ignoredReason: HrcIgnoredReason | null;
  metadata: Record<string, unknown>;
  hands: Array<{
    handClass: string;
    strategy: Record<string, number>;
    evs: Record<string, number>;
    weight: number;
    metadata: Record<string, unknown>;
  }>;
};

export type HrcStudyCapability = {
  capability: StudyCapability;
  metadata: Record<string, unknown>;
};

export type HrcStudyImport = {
  name: string;
  contentHash: string;
  archiveSizeBytes: number;
  equityModel: "CHIP_EV" | "ICM";
  evUnit: EvUnit;
  playersCount: number;
  stackBb: number | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  icmContext: string | null;
  ignoredNodes: HrcIgnoredCounts;
  metadata: Record<string, unknown>;
  capabilities: HrcStudyCapability[];
  sourceNodes: HrcSourceTreeNode[];
  nodes: HrcStudyNode[];
};

export type HrcImportSummary = {
  name: string;
  equityModel: HrcStudyImport["equityModel"];
  playersCount: number;
  stackBb: number | null;
  smallBlindBb: number;
  anteBb: number;
  anteType: HrcStudyImport["anteType"];
  sourceNodeCount: number;
  preflopNodeCount: number;
  nodeCount: number;
  storedHandClassCount: number;
  eligibleTrainingHandClassCount: number;
  counts: Record<TrainingType, number>;
  ignoredCount: number;
  ignoredNodes: HrcIgnoredCounts;
  capabilities: StudyCapability[];
  sourceHandClassCount: number;
};

export const HRC_IMPORT_LIMITS = {
  archiveBytes: 128 * 1024 * 1024,
  uncompressedBytes: 512 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  zipEntries: 20_050,
  nodeCount: 20_000,
  compressionRatio: 200,
} as const;
const HAND_RANKS = [..."AKQJT98765432"];
const CANONICAL_HAND_CLASSES = new Set(buildCanonicalHandClasses());
const FREQUENCY_EPSILON = 1e-6;
const HRC_FREQUENCY_ROUNDING_ERROR = 0.5e-4;
const ALLOWED_MIME_TYPES = new Set(["", "application/zip", "application/x-zip-compressed", "application/octet-stream"]);

type UploadedFile = Blob & { name: string; type: string };
type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

export class HrcImportError extends Error {
  constructor(message: string, readonly code = "INVALID_HRC_ARCHIVE") {
    super(message);
    this.name = "HrcImportError";
  }
}

export function positionNames(count: number) {
  const maps: Record<number, string[]> = {
    2: ["SB", "BB"],
    3: ["BTN", "SB", "BB"],
    4: ["CO", "BTN", "SB", "BB"],
    5: ["HJ", "CO", "BTN", "SB", "BB"],
    6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
    7: ["UTG", "UTG+1", "HJ", "CO", "BTN", "SB", "BB"],
    8: ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
    9: ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB"],
    10: ["UTG", "UTG+1", "UTG+2", "UTG+3", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  };
  return maps[count] ?? Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

export async function parseHrcPack(file: UploadedFile): Promise<HrcPack> {
  validateUpload(file);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const [archive, contentHash] = await Promise.all([readHrcZipIndex(bytes), sha256(bytes)]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const rawSettings = parseJson(decoder.decode(await inflateEntry(bytes, archive.view, archive.settings)), archive.settings.name);
  const settings = parseSettings(rawSettings);
  const nodes: HrcNode[] = [];
  const sourceIds = new Set<string>();
  let eligible = 0;
  for (let index = 0; index < archive.nodes.length; index++) {
    const entry = archive.nodes[index];
    const rawNode = parseJson(decoder.decode(await inflateEntry(bytes, archive.view, entry)), entry.name);
    const node = parseNode(rawNode, index, settings.handdata.stacks.length, entry.name);
    if (sourceIds.has(node.sourceNodeId)) throw new HrcImportError(`Identificador de source node duplicado: ${node.sourceNodeId}.`);
    sourceIds.add(node.sourceNodeId);
    eligible += node.eligibleHandCount;
    if (node.street !== 0) node.hands = {};
    nodes.push(node);
  }
  if (!eligible) throw new HrcImportError("Nenhuma mão elegível foi encontrada neste estudo.");
  const name = file.name.replace(/\.zip$/i, "").trim().slice(0, 160);
  if (!name) throw new HrcImportError("Nome do pacote HRC inválido.");
  return {
    name,
    settings,
    nodes,
    eligible,
    contentHash,
    archiveSizeBytes: file.size,
  };
}

export function normalizeHrcNodeReference(value: number | string): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const basename = trimmed.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  const normalized = basename?.replace(/\.json$/i, "").trim() ?? "";
  return normalized || null;
}

export function validateHrcPack(value: unknown, nodePaths: string[] = []): HrcValidatedPack {
  if (!isRecord(value)) throw new HrcImportError("Pacote HRC inválido.");
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 160) : "";
  const nodes = value.nodes;
  if (!name || !Array.isArray(nodes)) {
    throw new HrcImportError("Pacote HRC inválido.");
  }
  if (nodes.length === 0 || nodes.length > HRC_IMPORT_LIMITS.nodeCount) throw new HrcImportError("Quantidade de nodes do pacote HRC inválida.");
  const settings = parseSettings(value.settings);
  const parsedNodes = nodes.map((node, index) => parseNode(node, index, settings.handdata.stacks.length, nodePaths[index] ?? `nodes/${index}.json`));
  const sourceIds = new Set<string>();
  for (const node of parsedNodes) {
    if (sourceIds.has(node.sourceNodeId)) throw new HrcImportError(`Identificador de source node duplicado: ${node.sourceNodeId}.`);
    sourceIds.add(node.sourceNodeId);
  }
  const eligible = parsedNodes.reduce(
    (total, node) => total + node.eligibleHandCount,
    0,
  );
  if (!eligible) throw new HrcImportError("Nenhuma mão elegível foi encontrada neste estudo.");
  return { name, settings, nodes: parsedNodes, eligible };
}

export function toHrcStudyImport(pack: HrcPack, options: { releaseRawHands?: boolean } = {}): HrcStudyImport {
  if (!/^[a-f0-9]{64}$/.test(pack.contentHash)) throw new HrcImportError("Hash do arquivo HRC inválido.");
  const { stacks, blinds, anteType: rawAnteType, anteMode } = pack.settings.handdata;
  const bigBlind = blinds[0];
  const positions = positionNames(stacks.length);
  const ante = Math.max(0, blinds[2] ?? 0);
  const anteType = normalizeAnteType(`${rawAnteType} ${anteMode}`, ante);
  const preflopContext = createPreflopContext(pack.settings);
  const equityModel = inferEquityModel(pack.settings.eqmodel);
  const stackValues = stacks.map((stack) => roundBb(stack / bigBlind));
  const stackBb = stackValues.every((stack) => Math.abs(stack - stackValues[0]) < 0.001) ? stackValues[0] : null;
  const ignoredNodes = emptyIgnoredCounts();
  const counts = emptyTrainingTypeCounts();
  const nodes: HrcStudyNode[] = [];
  const sourceNodes: HrcSourceTreeNode[] = [];
  const nodeKeys = new Set<string>();
  let preflopNodeCount = 0;
  let storedHandClassCount = 0;
  let eligibleTrainingHandClassCount = 0;

  for (const node of pack.nodes) {
    if (node.street === 0) preflopNodeCount++;
    const classification = classifyHrcNodeDetailed(node, preflopContext);
    if (classification.reason) ignoredNodes[classification.reason]++;
    const trainingType = classification.trainingType;
    const allRawHands = Object.entries(node.hands);
    const materializeNode = node.street === 0 && node.player >= 0 && node.actions.length > 1 && allRawHands.length === 169;
    const rawHands = materializeNode ? allRawHands : [];
    let trainingNode: HrcStudyNode | null = null;

    if (materializeNode && rawHands.length) {
      if (nodeKeys.has(node.nodeKey)) throw new HrcImportError(`Identificador de node duplicado no estudo: ${node.nodeKey}.`);
      nodeKeys.add(node.nodeKey);
      const availableActions = node.actions.map((action, actionIndex) => toTrainingAction(action, actionIndex, node, preflopContext, bigBlind, positions, trainingType));
      const lastRaise = node.sequence.findLast((action) => action.type === "R");
      const heroPosition = positions[node.player] ?? `P${node.player + 1}`;
      const villainPosition = lastRaise ? positions[lastRaise.player] ?? `P${lastRaise.player + 1}` : null;
      const trainingHands = rawHands.map(([handClass, hand]) => {
        const strategy = Object.fromEntries(availableActions.map((action, index) => [action.id!, hand.played[index]]));
        const evs = Object.fromEntries(availableActions.map((action, index) => [action.id!, hand.evs[index]]));
        const actionEvs = hand.evs.slice(0, availableActions.length);
        const rankedEvs = [...actionEvs].sort((left, right) => right - left);
        const bestIndex = actionEvs.reduce((best, value, index, values) => value > values[best] ? index : best, 0);
        return {
          handClass,
          strategy,
          evs,
          bestAction: availableActions[bestIndex]?.id ?? null,
          decisionClarity: rankedEvs.length > 1 ? rankedEvs[0] - rankedEvs[1] : null,
          isMixed: hand.played.slice(0, availableActions.length).filter((frequency) => frequency >= 0.05).length > 1,
          metadata: { ...hand.metadata, hrcWeight: hand.weight },
        };
      });
      trainingNode = {
        nodeKey: node.nodeKey,
        trainingType,
        decisionEligible: trainingType !== null && node.eligibleHandCount > 0,
        heroPosition,
        heroStackBb: roundBb(stacks[node.player] / bigBlind),
        villainPosition,
        actionSequence: node.sequence.map((action, actionIndex) => ({
          ...toTrainingAction(action, actionIndex, node, preflopContext, bigBlind, positions, trainingType, action.player, true),
          position: positions[action.player] ?? `P${action.player + 1}`,
        })),
        availableActions,
        hands: trainingHands,
        metadata: {
          ...node.metadata,
          hrcNodeSource: node.sourcePath,
          hrcPlayer: node.player,
          hrcChildren: node.children,
          decisionTrainingEligible: trainingType !== null && node.eligibleHandCount > 0,
        },
      };
      nodes.push(trainingNode);
      if (trainingType) counts[trainingType]++;
      storedHandClassCount += trainingHands.length;
      if (trainingType) eligibleTrainingHandClassCount += trainingHands.filter((hand) => Number(hand.metadata.hrcWeight) >= 0.01).length;
    }

    sourceNodes.push({
      sourceNodeId: node.sourceNodeId,
      sourcePath: node.sourcePath,
      player: node.player,
      street: node.street,
      sequence: node.sequence,
      actions: node.actions,
      trainingNodeKey: trainingNode?.nodeKey ?? null,
      ignoredReason: classification.reason,
      metadata: {
        ...node.metadata,
        hrcChildren: node.children,
        eligibleHandCount: node.eligibleHandCount,
      },
      hands: trainingNode ? [] : allRawHands.map(([handClass, hand]) => ({
        handClass,
        strategy: Object.fromEntries(node.actions.map((_, index) => [`action-${index}`, hand.played[index]])),
        evs: Object.fromEntries(node.actions.map((_, index) => [`action-${index}`, hand.evs[index]])),
        weight: hand.weight,
        metadata: hand.metadata,
      })),
    });

    if (options.releaseRawHands) {
      // A forma persistível já contém estratégia e EV; no fluxo de importação não
      // mantenha também a cópia bruta mais pesada enquanto converte os próximos nodes.
      node.hands = {};
    }
  }

  const fullHand = analyzeFullHandPreflop(sourceNodes, stacks.length);
  const capabilities: HrcStudyCapability[] = [
    ...(nodes.some((node) => node.decisionEligible) ? [{ capability: "DECISION" as const, metadata: { trainingNodeCount: nodes.filter((node) => node.decisionEligible).length } }] : []),
    ...(fullHand.compatible ? [{
      capability: "FULL_HAND_PREFLOP" as const,
      metadata: {
        rootSourceNodeId: fullHand.rootSourceNodeId,
        reachableNodeCount: fullHand.reachableNodeCount,
        terminalCount: fullHand.terminalCount,
        eligibleHeroPlayers: fullHand.eligibleHeroPlayers,
      },
    }] : []),
  ];

  return {
    name: pack.name,
    contentHash: pack.contentHash,
    archiveSizeBytes: pack.archiveSizeBytes,
    equityModel,
    evUnit: equityModel === "ICM" ? "ICM_UTILITY" : "UNKNOWN",
    playersCount: stacks.length,
    stackBb,
    smallBlind: blinds[1],
    bigBlind,
    ante,
    anteType,
    icmContext: equityModel === "ICM" ? pack.settings.eqmodel.id || "ICM" : null,
    ignoredNodes,
    capabilities,
    metadata: {
      validationVersion: 4,
      importerVersion: "HRC_COMPLETE_TREE_V4",
      sourceFormat: "HRC_COMPLETE_EXPORT",
      hrcEquityModel: pack.settings.eqmodel.id,
      hrcRaked: pack.settings.eqmodel.raked,
      hrcNodeCount: pack.nodes.length,
      compatibleNodeCount: nodes.filter((node) => node.decisionEligible).length,
      fullHandDecisionNodeCount: nodes.length,
      preflopNodeCount,
      ignoredNodes,
      counts,
      storedHandClasses: storedHandClassCount,
      eligibleHands: eligibleTrainingHandClassCount,
      archiveSizeBytes: pack.archiveSizeBytes,
      initialStacksBb: stacks.map((stack) => roundBb(stack / bigBlind)),
      fullHandValidation: fullHand,
      hrcSettings: pack.settings.metadata,
    },
    sourceNodes,
    nodes,
  };
}

export function summarizeHrcStudy(study: HrcStudyImport): HrcImportSummary {
  const counts = emptyTrainingTypeCounts();
  for (const node of study.nodes) if (node.trainingType) counts[node.trainingType]++;
  return {
    name: study.name,
    equityModel: study.equityModel,
    playersCount: study.playersCount,
    stackBb: study.stackBb,
    smallBlindBb: roundBb(study.smallBlind / study.bigBlind),
    anteBb: roundBb(study.ante / study.bigBlind),
    anteType: study.anteType,
    sourceNodeCount: study.sourceNodes.length,
    preflopNodeCount: study.sourceNodes.filter((node) => node.street === 0).length,
    nodeCount: study.nodes.filter((node) => node.decisionEligible).length,
    storedHandClassCount: study.nodes.reduce((total, node) => total + node.hands.length, 0),
    eligibleTrainingHandClassCount: study.nodes.reduce((total, node) => total + (node.decisionEligible ? node.hands.filter((hand) => Number(hand.metadata.hrcWeight) >= 0.01).length : 0), 0),
    counts,
    ignoredCount: Object.values(study.ignoredNodes).reduce((total, count) => total + count, 0),
    ignoredNodes: study.ignoredNodes,
    capabilities: study.capabilities.map((item) => item.capability),
    sourceHandClassCount: study.sourceNodes.reduce((total, node) => total + node.hands.length, 0),
  };
}

export type FullHandPreflopAnalysis = {
  compatible: boolean;
  rootSourceNodeId: string | null;
  reachableNodeCount: number;
  terminalCount: number;
  eligibleHeroPlayers: number[];
  reasons: string[];
};

/**
 * Valida a árvore pelo conteúdo exportado: root único, referências resolvíveis,
 * estratégias por mão e ao menos um caminho terminal. O nome do ZIP não participa.
 */
export function analyzeFullHandPreflop(sourceNodes: HrcSourceTreeNode[], playersCount: number): FullHandPreflopAnalysis {
  const preflop = sourceNodes.filter((node) => node.street === 0);
  const roots = preflop.filter((node) => node.sequence.length === 0 && node.player >= 0 && node.actions.length > 0);
  const reasons: string[] = [];
  if (roots.length !== 1) reasons.push("ROOT_NOT_UNIQUE");
  const root = roots[0] ?? null;
  const byReference = new Map<string, HrcSourceTreeNode | null>();
  for (const node of sourceNodes) {
    for (const reference of [node.sourceNodeId, node.sourcePath]) {
      const normalized = normalizeHrcNodeReference(reference);
      if (!normalized) continue;
      const existing = byReference.get(normalized);
      byReference.set(normalized, existing === undefined || existing === node ? node : null);
    }
  }

  const reachable = new Set<HrcSourceTreeNode>();
  const pending = root ? [root] : [];
  let terminalCount = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (reachable.has(node)) continue;
    reachable.add(node);
    if (node.actions.length > 0 && (node.player < 0 || node.player >= playersCount)) reasons.push("ACTING_PLAYER_INVALID");
    if (node.actions.length > 1 && !node.trainingNodeKey && node.hands.length !== 169) reasons.push("STRATEGY_MISSING");
    if (node.actions.length === 0) terminalCount++;
    for (const action of node.actions) {
      if (action.node === undefined) {
        terminalCount++;
        continue;
      }
      const child = byReference.get(normalizeHrcNodeReference(action.node) ?? "");
      if (!child) {
        reasons.push("CHILD_UNRESOLVED");
        continue;
      }
      if (child.street === 0) pending.push(child);
      else terminalCount++;
    }
  }
  if (reachable.size !== preflop.length) reasons.push("UNREACHABLE_PREFLOP_NODE");
  if (terminalCount === 0) reasons.push("TERMINAL_MISSING");

  const eligibleHeroPlayers = Array.from({ length: playersCount }, (_, player) => player)
    .filter((player) => {
      const decisions = [...reachable].filter((node) => node.player === player && node.actions.length > 1);
      return decisions.length > 0 && decisions.every((node) => node.trainingNodeKey !== null);
    });
  if (eligibleHeroPlayers.length === 0) reasons.push("HERO_DECISIONS_NOT_TRAINABLE");

  return {
    compatible: reasons.length === 0,
    rootSourceNodeId: root?.sourceNodeId ?? null,
    reachableNodeCount: reachable.size,
    terminalCount,
    eligibleHeroPlayers,
    reasons: [...new Set(reasons)],
  };
}

export function classifyHrcNode(node: HrcNode, settingsOrStacks: HrcSettings | number[]): TrainingType | null {
  const context = Array.isArray(settingsOrStacks)
    ? createBarePreflopContext(settingsOrStacks)
    : createPreflopContext(settingsOrStacks);
  return classifyHrcNodeDetailed(node, context).trainingType;
}

function classifyHrcNodeDetailed(node: HrcNode, context: HrcPreflopContext): { trainingType: TrainingType | null; reason: HrcIgnoredReason | null } {
  if (node.street !== 0) return { trainingType: null, reason: "POSTFLOP" };
  if (isAutomaticXNode(node)) return { trainingType: null, reason: "AUTOMATIC_X" };
  if (node.player < 0 || node.actions.length < 2) {
    return { trainingType: null, reason: "NON_TRAINABLE" };
  }
  if (node.eligibleHandCount === 0) return { trainingType: null, reason: "NO_ELIGIBLE_HANDS" };
  const raiseActions = node.actions.filter((action) => action.type === "R");
  const voluntary = node.sequence.filter(isVoluntaryAction);
  const priorRaises = node.sequence.filter((action) => action.type === "R");
  if (!priorRaises.length && !voluntary.length) {
    if (!raiseActions.length) return { trainingType: null, reason: "NON_TRAINABLE" };
    const shoveFlags = raiseActions.map((action) => isAllInRaise(action, node.player, context, node.sequence));
    if (shoveFlags.some((flag) => !flag)) return { trainingType: "OPEN_FOLD", reason: null };
    return { trainingType: "PUSH_FOLD", reason: null };
  }

  const lastRaiseIndex = node.sequence.findLastIndex((action) => action.type === "R");
  if (lastRaiseIndex < 0) return { trainingType: null, reason: "UNSUPPORTED_SEQUENCE" };
  const lastRaise = node.sequence[lastRaiseIndex];
  const hasNonFoldAfterRaise = node.sequence.slice(lastRaiseIndex + 1).some((action) => action.type !== "F");
  if (hasNonFoldAfterRaise || lastRaise.player === node.player) return { trainingType: null, reason: "UNSUPPORTED_SEQUENCE" };

  if (isAllInRaise(lastRaise, lastRaise.player, context, node.sequence.slice(0, lastRaiseIndex))) {
    return { trainingType: "CALL_VS_SHOVE", reason: null };
  }
  const heroVoluntary = voluntary.filter((action) => action.player === node.player);
  const firstRaiseIndex = node.sequence.findIndex((action) => action.type === "R");
  const voluntaryBeforeFirstRaise = firstRaiseIndex > 0 && node.sequence.slice(0, firstRaiseIndex).some(isVoluntaryAction);
  if (priorRaises.length === 1 && heroVoluntary.length === 0 && !voluntaryBeforeFirstRaise) return { trainingType: "VS_OPEN", reason: null };
  if (priorRaises.length === 2
    && priorRaises[0].player === node.player
    && priorRaises[1].player !== node.player
    && heroVoluntary.length === 1
    && heroVoluntary[0] === priorRaises[0]) {
    return { trainingType: "VS_3_BET", reason: null };
  }
  if (priorRaises.length === 3
    && priorRaises[0].player !== node.player
    && priorRaises[1].player === node.player
    && priorRaises[2].player !== node.player
    && heroVoluntary.length === 1
    && heroVoluntary[0] === priorRaises[1]) {
    return { trainingType: "VS_4_BET", reason: null };
  }
  return { trainingType: null, reason: "UNSUPPORTED_SEQUENCE" };
}

async function readHrcZipIndex(bytes: Uint8Array) {
  if (bytes.length < 22) throw new HrcImportError("ZIP do HRC inválido.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (u32(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new HrcImportError("ZIP do HRC inválido.");
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) throw new HrcImportError("ZIP dividido em múltiplos discos não é suportado.");
  const count = u16(eocd + 10);
  const centralSize = u32(eocd + 12);
  const centralOffset = u32(eocd + 16);
  if (!count || count > HRC_IMPORT_LIMITS.zipEntries || centralOffset + centralSize > eocd) throw new HrcImportError("Índice do ZIP inválido.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let pointer = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < count; index++) {
    if (pointer + 46 > bytes.length || u32(pointer) !== 0x02014b50) throw new HrcImportError("Índice do ZIP inválido.");
    const flags = u16(pointer + 8);
    const method = u16(pointer + 10);
    const crc = u32(pointer + 16);
    const compressedSize = u32(pointer + 20);
    const uncompressedSize = u32(pointer + 24);
    const nameLength = u16(pointer + 28);
    const extraLength = u16(pointer + 30);
    const commentLength = u16(pointer + 32);
    const localOffset = u32(pointer + 42);
    const end = pointer + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new HrcImportError("Entrada ZIP inválida ou ZIP64 não suportado.");
    let name: string;
    try { name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength)); }
    catch { throw new HrcImportError("Nome de arquivo inválido no ZIP."); }
    validateZipPath(name);
    if (seen.has(name)) throw new HrcImportError(`Entrada duplicada no ZIP: ${name}.`);
    seen.add(name);
    if ((flags & 1) !== 0) throw new HrcImportError("ZIPs protegidos por senha não são suportados.");
    if (![0, 8].includes(method)) throw new HrcImportError(`Compressão ZIP não suportada (${method}).`);
    if (!name.endsWith("/")) {
      if (uncompressedSize > HRC_IMPORT_LIMITS.entryBytes) throw new HrcImportError(`Arquivo interno muito grande: ${name}.`);
      if (compressedSize > 0 && uncompressedSize / compressedSize > HRC_IMPORT_LIMITS.compressionRatio) throw new HrcImportError(`Taxa de compressão insegura no arquivo ${name}.`);
      totalUncompressed += uncompressedSize;
    }
    if (totalUncompressed > HRC_IMPORT_LIMITS.uncompressedBytes) throw new HrcImportError("O conteúdo descompactado excede o limite de 512 MB.");
    entries.push({ name, flags, method, crc, compressedSize, uncompressedSize, localOffset });
    pointer = end;
  }

  const settings = entries.filter((entry) => /(^|\/)settings\.json$/.test(entry.name));
  if (settings.length !== 1) throw new HrcImportError(settings.length ? "O ZIP contém mais de um settings.json." : "settings.json não encontrado. Use Export Strategies → Complete Export no HRC.");
  const root = settings[0].name.slice(0, -"settings.json".length);
  const expectedNode = new RegExp(`^${escapeRegExp(root)}nodes/[^/]+\\.json$`);
  const relevant = entries.filter((entry) => entry.name === settings[0].name || expectedNode.test(entry.name));
  const unexpectedFile = entries.find((entry) => !entry.name.endsWith("/") && !relevant.includes(entry));
  if (unexpectedFile) throw new HrcImportError(`Arquivo inesperado no ZIP: ${unexpectedFile.name}.`);
  const nodes = relevant.filter((entry) => entry !== settings[0]).sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }));
  if (!nodes.length) throw new HrcImportError("Nenhuma estratégia foi encontrada neste ZIP.");
  if (nodes.length > HRC_IMPORT_LIMITS.nodeCount) throw new HrcImportError("Quantidade de nodes do pacote HRC inválida.");
  return { view, settings: settings[0], nodes };
}

async function inflateEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry) {
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  if (entry.localOffset + 30 > bytes.length || u32(entry.localOffset) !== 0x04034b50) throw new HrcImportError(`Entrada ZIP inválida: ${entry.name}.`);
  const localFlags = u16(entry.localOffset + 6);
  const localMethod = u16(entry.localOffset + 8);
  const localNameLength = u16(entry.localOffset + 26);
  const localExtraLength = u16(entry.localOffset + 28);
  if ((localFlags & 1) !== 0 || localMethod !== entry.method) throw new HrcImportError(`Cabeçalho ZIP inconsistente: ${entry.name}.`);
  const start = entry.localOffset + 30 + localNameLength + localExtraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new HrcImportError(`Entrada ZIP incompleta: ${entry.name}.`);
  const compressed = bytes.subarray(start, end) as Uint8Array<ArrayBuffer>;
  let output: Uint8Array;
  if (entry.method === 0) output = compressed;
  else {
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let actualSize = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        actualSize += value.byteLength;
        if (actualSize > entry.uncompressedSize || actualSize > HRC_IMPORT_LIMITS.entryBytes) {
          await reader.cancel();
          throw new HrcImportError(`Tamanho descompactado inconsistente em ${entry.name}.`);
        }
        chunks.push(value);
      }
      output = concatenateBytes(chunks, actualSize);
    } catch (error) {
      if (error instanceof HrcImportError) throw error;
      throw new HrcImportError(`Não foi possível descompactar ${entry.name}.`);
    }
  }
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) throw new HrcImportError(`Integridade inválida no arquivo ${entry.name}.`);
  return output;
}

function parseNode(value: unknown, index: number, playersCount: number, sourcePath: string): HrcNode {
  if (!isRecord(value) || !Number.isInteger(value.player) || Number(value.player) < -1 || Number(value.player) >= playersCount) {
    throw new HrcImportError(`Node HRC ${sourcePath || index} inválido.`);
  }
  if (!Array.isArray(value.actions) || !Array.isArray(value.sequence)) {
    throw new HrcImportError(`Estrutura do node HRC ${sourcePath || index} inválida.`);
  }
  const actions = value.actions.map((action) => parseAction(action));
  const sequence = value.sequence.map((action) => {
    const parsed = parseAction(action);
    if (parsed.type === "X" || !isRecord(action) || !Number.isInteger(action.player) || Number(action.player) < 0 || Number(action.player) >= playersCount) {
      throw new HrcImportError(`Sequência do node HRC ${sourcePath || index} inválida.`);
    }
    const street = optionalJsonNumber(action.street, 0, "street da sequência");
    if (!Number.isInteger(street) || street < 0) throw new HrcImportError(`Sequência do node HRC ${sourcePath || index} inválida.`);
    return { ...parsed, player: Number(action.player), street };
  });
  if (actions.length > 20 || (actions.length > 0 && Number(value.player) < 0)) {
    throw new HrcImportError(`Estratégia do node HRC ${sourcePath || index} inválida.`);
  }
  const street = optionalJsonNumber(value.street, 0, "street do node");
  const children = optionalJsonNumber(value.children, 0, "children do node");
  if (!Number.isInteger(street) || street < 0 || !Number.isInteger(children) || children < 0) {
    throw new HrcImportError(`Estrutura do node HRC ${sourcePath || index} inválida.`);
  }
  const hands = street === 0 ? parsePreflopHands(value.hands, actions, children, sourcePath || String(index)) : {};
  const explicitKey = firstIdentifier(value.id, value.nodeId, value.key);
  const sourceNodeId = (explicitKey || sourcePath.split("/").at(-1)?.replace(/\.json$/i, "") || String(index)).slice(0, 240);
  return {
    nodeKey: sourceNodeId,
    sourceNodeId,
    sourcePath,
    player: Number(value.player),
    street,
    children,
    sequence,
    actions,
    hands,
    eligibleHandCount: Object.values(hands).filter((hand) => hand.weight >= 0.01).length,
    metadata: withoutKeys(value, ["id", "nodeId", "key", "player", "street", "children", "sequence", "actions", "hands"]),
  };
}

function parsePreflopHands(rawValue: unknown, actions: HrcAction[], children: number, sourcePath: string): Record<string, HrcHand> {
  if (!isRecord(rawValue)) throw new HrcImportError(`Estrutura do node HRC ${sourcePath} inválida.`);
  const rawHandClasses = Object.keys(rawValue);
  const invalidHandClass = rawHandClasses.find((handClass) => !isHandClass(handClass));
  if (invalidHandClass) throw new HrcImportError(`Classe de mão não canônica ${invalidHandClass} no node ${sourcePath}.`);
  if (actions.length && (rawHandClasses.length !== CANONICAL_HAND_CLASSES.size || [...CANONICAL_HAND_CLASSES].some((handClass) => !(handClass in rawValue)))) {
    throw new HrcImportError(`Node ${sourcePath} deve conter exatamente as 169 classes de mãos canônicas.`);
  }

  const hands: Record<string, HrcHand> = {};
  for (const [handClass, hand] of Object.entries(rawValue)) {
    if (!isRecord(hand)) throw new HrcImportError(`Mão ${handClass} inválida no node ${sourcePath}.`);
    const played = normalizeFrequencies(strictNumberArray(hand.played, `frequências de ${handClass}`), actions.length, handClass, sourcePath);
    const evs = strictNumberArray(hand.evs, `EVs de ${handClass}`);
    const weight = requiredFiniteNumber(hand.weight, `peso de ${handClass}`);
    if (weight < 0 || weight > 1 || evs.length !== actions.length) {
      throw new HrcImportError(`Estratégia da mão ${handClass} inválida no node ${sourcePath}.`);
    }
    hands[handClass] = { weight, played, evs, metadata: withoutKeys(hand, ["weight", "played", "evs"]) };
  }
  if (actions.length && !Object.keys(hands).length) throw new HrcImportError(`Node ${sourcePath} não contém classes de mãos válidas.`);
  if (actions.length === 1 && actions[0].type === "X") {
    const isValidAutomaticX = actions[0].amount === 0
      && children === 1
      && rawHandClasses.length === CANONICAL_HAND_CLASSES.size
      && Object.keys(hands).length === CANONICAL_HAND_CLASSES.size
      && Object.values(hands).every((hand) => hand.played.length === 1
        && Math.abs(hand.played[0] - 1) <= 0.000001
        && hand.evs.length === 1);
    if (!isValidAutomaticX) {
      throw new HrcImportError(`Node automático X ${sourcePath} não segue o formato estrutural esperado.`);
    }
  }
  return hands;
}

function parseAction(value: unknown): HrcAction {
  if (!isRecord(value) || !["F", "C", "R", "X"].includes(String(value.type))) throw new HrcImportError("Ação HRC inválida.");
  const validNumericChild = typeof value.node === "number" && Number.isSafeInteger(value.node) && value.node >= 0;
  const validStringChild = typeof value.node === "string" && value.node.length <= 240 && normalizeHrcNodeReference(value.node) !== null;
  if (value.node !== undefined && !validNumericChild && !validStringChild) {
    throw new HrcImportError("Referência de child node HRC inválida.");
  }
  const amount = optionalJsonNumber(value.amount, 0, "valor da ação");
  if (amount < 0 || (value.type === "R" && amount <= 0) || (value.type === "X" && amount !== 0)) {
    throw new HrcImportError("Valor de ação HRC inválido.");
  }
  return {
    type: value.type as HrcAction["type"],
    amount,
    ...((validNumericChild || validStringChild) ? { node: value.node as number | string } : {}),
    metadata: withoutKeys(value, ["type", "amount", "node", "player", "street"]),
  };
}

function toTrainingAction(
  action: HrcAction,
  index: number,
  node: HrcNode,
  context: HrcPreflopContext,
  bigBlind: number,
  positions: string[],
  _trainingType: TrainingType | null,
  actingPlayer = node.player,
  sequenceAction = false,
): TrainingAction {
  const id = `action-${index}`;
  const metadata = { ...action.metadata, hrcType: action.type, hrcAmount: action.amount, ...(action.node === undefined ? {} : { hrcChildNode: action.node }) };
  if (action.type === "F") return { id, type: "FOLD", metadata };
  if (action.type === "X") return { id, type: "CHECK", label: "Check", metadata };
  if (action.type === "C") {
    if (action.amount <= 0) return { id, type: "CHECK", metadata };
    const priorSequence = sequenceAction ? node.sequence.slice(0, index) : node.sequence;
    const unopened = !priorSequence.some((prior) => prior.type === "R");
    const label = unopened ? (positions[actingPlayer] === "SB" ? "Complete" : "Limp") : undefined;
    return { id, type: "CALL", ...(label ? { label } : {}), metadata };
  }
  if (action.type !== "R") throw new HrcImportError("Node automático X não pode ser convertido em uma decisão de treinamento.");
  const priorSequence = sequenceAction ? node.sequence.slice(0, index) : node.sequence;
  return {
    id,
    type: "RAISE",
    amountBb: roundBb(action.amount / bigBlind),
    label: isAllInRaise(action, actingPlayer, context, priorSequence) ? "All-in" : undefined,
    metadata,
  };
}

function isAutomaticXNode(node: HrcNode) {
  return node.actions.length === 1
    && node.actions[0].type === "X"
    && node.actions[0].amount === 0
    && node.children === 1;
}

function isAllInRaise(
  action: Pick<HrcAction, "type" | "amount">,
  player: number,
  context: HrcPreflopContext,
  priorSequence: HrcSequenceAction[],
) {
  if (action.type !== "R" || player < 0 || player >= context.stacks.length) return false;
  const state = replayPreflopState(context, priorSequence);
  if (!state.active[player]) return false;

  const actorCap = state.liveContributions[player] + state.remainingStacks[player];
  const opponentCaps = state.active
    .map((active, opponent) => active && opponent !== player
      ? state.liveContributions[opponent] + state.remainingStacks[opponent]
      : -1)
    .filter((cap) => cap >= 0);
  if (!opponentCaps.length) return false;

  const effectiveRaiseTo = Math.min(actorCap, Math.max(...opponentCaps));
  if (amountsMatch(action.amount, effectiveRaiseTo) || amountsMatch(action.amount, actorCap)) return true;

  // Compatibilidade com exports/fixtures legados que codificam o shove pelo
  // stack inicial, mesmo quando uma ante morta reduz o maior raise-to legal.
  return amountsMatch(action.amount, context.stacks[player]);
}

function inferEquityModel(eqmodel: HrcSettings["eqmodel"]): HrcStudyImport["equityModel"] {
  const descriptor = [eqmodel.id, ...Object.values(eqmodel.metadata).filter((value): value is string => typeof value === "string")]
    .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const compact = descriptor.replace(/\s+/g, "");
  if (compact.includes("chipev") || compact === "cev" || compact === "chip") return "CHIP_EV";
  if (compact.includes("icm") || compact.includes("fgs")) return "ICM";
  throw new HrcImportError(`Modelo de equidade HRC não reconhecido${eqmodel.id ? `: ${eqmodel.id}` : " no settings.json"}.`);
}

function normalizeAnteType(value: string, ante: number): HrcStudyImport["anteType"] {
  if (ante <= 0) return "NONE";
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  return normalized.includes("bb") || normalized.includes("bigblind") ? "BB_ANTE" : "ANTE";
}

function createBarePreflopContext(stacks: number[]): HrcPreflopContext {
  return {
    stacks: [...stacks],
    initialLiveContributions: stacks.map(() => 0),
    deadContributions: stacks.map(() => 0),
  };
}

function createPreflopContext(settings: HrcSettings): HrcPreflopContext {
  const { stacks, blinds, skipSb, anteType: rawAnteType, anteMode, anteFirst } = settings.handdata;
  const ante = Math.max(0, blinds[2] ?? 0);
  const anteType = normalizeAnteType(`${rawAnteType} ${anteMode}`, ante);
  const initialLiveContributions = stacks.map(() => 0);
  const deadContributions = stacks.map(() => 0);
  const smallBlindPlayer = stacks.length - 2;
  const bigBlindPlayer = stacks.length - 1;

  const postAntes = () => {
    if (anteType === "NONE") return;
    const players = anteType === "BB_ANTE"
      ? [bigBlindPlayer]
      : stacks.map((_, player) => player);
    for (const player of players) {
      const available = Math.max(0, stacks[player] - initialLiveContributions[player] - deadContributions[player]);
      deadContributions[player] += Math.min(ante, available);
    }
  };

  const postBlinds = () => {
    const posts: Array<[number, number]> = [];
    if (!skipSb) posts.push([smallBlindPlayer, Math.max(0, blinds[1] ?? 0)]);
    posts.push([bigBlindPlayer, Math.max(0, blinds[0] ?? 0)]);
    for (const [player, blind] of posts) {
      const available = Math.max(0, stacks[player] - initialLiveContributions[player] - deadContributions[player]);
      initialLiveContributions[player] += Math.min(blind, available);
    }
  };

  if (anteFirst) {
    postAntes();
    postBlinds();
  } else {
    postBlinds();
    postAntes();
  }
  return { stacks: [...stacks], initialLiveContributions, deadContributions };
}

function replayPreflopState(context: HrcPreflopContext, sequence: HrcSequenceAction[]): HrcPreflopState {
  const liveContributions = [...context.initialLiveContributions];
  const remainingStacks = context.stacks.map((stack, player) => Math.max(
    0,
    stack - context.deadContributions[player] - liveContributions[player],
  ));
  const active = context.stacks.map(() => true);

  for (const action of sequence) {
    if (action.street !== 0 || action.player < 0 || action.player >= context.stacks.length) continue;
    const player = action.player;
    if (action.type === "F") {
      active[player] = false;
      continue;
    }
    if (!active[player]) continue;
    const additional = action.type === "R"
      ? Math.max(0, action.amount - liveContributions[player])
      : action.type === "C" ? action.amount : 0;
    const committed = Math.min(additional, remainingStacks[player]);
    liveContributions[player] += committed;
    remainingStacks[player] -= committed;
  }
  return { active, liveContributions, remainingStacks };
}

function amountsMatch(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(0.001, Math.abs(right) * 0.0001);
}

function validateUpload(file: UploadedFile) {
  if (!file.name || !/\.zip$/i.test(file.name)) throw new HrcImportError("Selecione um arquivo .zip exportado pelo HRC.");
  if (!ALLOWED_MIME_TYPES.has((file.type || "").toLowerCase())) throw new HrcImportError("O tipo MIME do arquivo não corresponde a um ZIP.");
  if (file.size <= 0) throw new HrcImportError("O arquivo ZIP está vazio.");
  if (file.size > HRC_IMPORT_LIMITS.archiveBytes) throw new HrcImportError("O arquivo HRC excede o limite de 128 MB.");
}

function validateZipPath(name: string) {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name)) {
    throw new HrcImportError("O ZIP contém um caminho de arquivo inseguro.");
  }
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === ".")) throw new HrcImportError("O ZIP contém tentativa de path traversal.");
}

function parseJson(source: string, name: string) {
  try { return JSON.parse(source) as unknown; }
  catch { throw new HrcImportError(`JSON inválido em ${name}.`); }
}

function parseSettings(value: unknown): HrcSettings {
  if (!isRecord(value) || !isRecord(value.handdata) || !isRecord(value.eqmodel)) {
    throw new HrcImportError("settings.json inválido.");
  }
  const stacks = strictNumberArray(value.handdata.stacks, "stacks");
  const blinds = strictNumberArray(value.handdata.blinds, "blinds");
  if (stacks.length < 2 || stacks.length > 10 || stacks.some((stack) => stack <= 0)) {
    throw new HrcImportError("Stacks inválidos no settings.json.");
  }
  if (blinds.length < 2 || blinds[0] <= 0 || blinds[1] < 0 || blinds[1] > blinds[0] || (blinds[2] ?? 0) < 0) {
    throw new HrcImportError("Blinds inválidos no settings.json.");
  }
  const eqmodelId = firstString(value.eqmodel.id, value.eqmodel.type, value.eqmodel.name, value.eqmodel.model);
  const anteType = firstString(value.handdata.anteType);
  const anteMode = firstString(value.handdata.anteMode, value.handdata.anteOrder, value.handdata.forcedBetOrder);
  const anteOrder = `${anteType} ${anteMode}`.toLowerCase().replace(/[^a-z]/g, "");
  const anteFirst = typeof value.handdata.anteFirst === "boolean"
    ? value.handdata.anteFirst
    : !anteOrder.includes("blindfirst");
  return {
    handdata: {
      stacks,
      blinds,
      skipSb: Boolean(value.handdata.skipSb),
      movingBu: Boolean(value.handdata.movingBu),
      anteType: anteType || anteMode,
      anteMode,
      anteFirst,
    },
    eqmodel: {
      id: eqmodelId,
      raked: Boolean(value.eqmodel.raked),
      metadata: withoutKeys(value.eqmodel, ["id", "raked"]),
    },
    metadata: structuredClone(value),
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isHandClass(value: string) {
  return CANONICAL_HAND_CLASSES.has(value);
}

function buildCanonicalHandClasses() {
  const hands = HAND_RANKS.map((rank) => `${rank}${rank}`);
  for (let first = 0; first < HAND_RANKS.length; first++) {
    for (let second = first + 1; second < HAND_RANKS.length; second++) {
      hands.push(`${HAND_RANKS[first]}${HAND_RANKS[second]}s`, `${HAND_RANKS[first]}${HAND_RANKS[second]}o`);
    }
  }
  return hands;
}

function normalizeFrequencies(values: number[], actionCount: number, handClass: string, sourcePath: string) {
  if (values.length !== actionCount) throw new HrcImportError(`Vetor de frequências de ${handClass} possui tamanho inválido no node ${sourcePath}.`);
  if (actionCount === 0) return values;
  const bounded = values.map((value) => {
    if (value < -FREQUENCY_EPSILON || value > 1 + FREQUENCY_EPSILON) {
      throw new HrcImportError(`Frequência fora do domínio fracional em ${handClass} no node ${sourcePath}.`);
    }
    if (Math.abs(value) <= FREQUENCY_EPSILON) return 0;
    if (Math.abs(value - 1) <= FREQUENCY_EPSILON) return 1;
    return value;
  });
  const total = bounded.reduce((sum, value) => sum + value, 0);
  const sumTolerance = actionCount * HRC_FREQUENCY_ROUNDING_ERROR + FREQUENCY_EPSILON;
  if (!Number.isFinite(total) || Math.abs(total - 1) > sumTolerance) {
    throw new HrcImportError(`Frequências de ${handClass} não somam 1 no node ${sourcePath}.`);
  }
  return bounded.map((value) => value / total);
}

function concatenateBytes(chunks: Uint8Array[], totalSize: number) {
  const output = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function strictNumberArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new HrcImportError(`Campo ${field} inválido no JSON do HRC.`);
  }
  return value as number[];
}

function requiredFiniteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HrcImportError(`Campo ${field} inválido no JSON do HRC.`);
  return value;
}

function optionalJsonNumber(value: unknown, fallback: number, field: string) {
  if (value === undefined || value === null) return fallback;
  return requiredFiniteNumber(value, field);
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? "";
}

function firstIdentifier(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  }
  return "";
}

function isVoluntaryAction(action: HrcSequenceAction) {
  return action.type === "R" || (action.type === "C" && action.amount > 0);
}

function emptyIgnoredCounts(): HrcIgnoredCounts {
  return { POSTFLOP: 0, AUTOMATIC_X: 0, UNSUPPORTED_SEQUENCE: 0, NO_ELIGIBLE_HANDS: 0, NON_TRAINABLE: 0 };
}

function emptyTrainingTypeCounts(): Record<TrainingType, number> {
  return { PUSH_FOLD: 0, CALL_VS_SHOVE: 0, OPEN_FOLD: 0, VS_OPEN: 0, VS_3_BET: 0, VS_4_BET: 0 };
}

function roundBb(value: number) {
  return Number(value.toFixed(4));
}

function withoutKeys(value: Record<string, unknown>, keys: string[]) {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.has(key)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
