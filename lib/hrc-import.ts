import type { EvUnit, TrainingAction, TrainingSequenceAction, TrainingType } from "./training";

export type HrcAction = {
  type: "F" | "C" | "R" | "X";
  amount: number;
  node?: number;
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
  sourcePath: string;
  player: number;
  street: number;
  children: number;
  sequence: HrcSequenceAction[];
  actions: HrcAction[];
  hands: Record<string, HrcHand>;
  metadata: Record<string, unknown>;
};
export type HrcSettings = {
  handdata: { stacks: number[]; blinds: number[]; skipSb: boolean; movingBu: boolean; anteType: string };
  eqmodel: { id: string; raked: boolean; metadata: Record<string, unknown> };
  metadata: Record<string, unknown>;
};
export type HrcValidatedPack = { name: string; settings: HrcSettings; nodes: HrcNode[]; eligible: number };
export type HrcPack = HrcValidatedPack & { contentHash: string; archiveSizeBytes: number };

export type HrcStudyNode = {
  nodeKey: string;
  trainingType: TrainingType;
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
  ignoredNodes: { AUTOMATIC_X: number };
  metadata: Record<string, unknown>;
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
  nodeCount: number;
  handCount: number;
  counts: Record<TrainingType, number>;
  ignoredNodes: HrcStudyImport["ignoredNodes"];
};

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 510;
const MAX_NODE_COUNT = 500;
const HAND_RANKS = [..."AKQJT98765432"];
const CANONICAL_HAND_CLASSES = new Set(buildCanonicalHandClasses());
const FREQUENCY_EPSILON = 1e-6;
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
    8: ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
    9: ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB"],
    10: ["UTG", "UTG+1", "UTG+2", "UTG+3", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  };
  return maps[count] ?? Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

export async function parseHrcPack(file: UploadedFile): Promise<HrcPack> {
  validateUpload(file);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const [files, contentHash] = await Promise.all([readHrcZip(bytes), sha256(bytes)]);
  const settingsEntry = [...files.keys()].find((name) => name.endsWith("settings.json"));
  if (!settingsEntry) throw new HrcImportError("settings.json não encontrado. Use Export Strategies → Complete Export no HRC.");
  const root = settingsEntry.slice(0, -"settings.json".length);
  const nodeEntries = [...files.keys()].filter((name) => name.startsWith(`${root}nodes/`) && name.endsWith(".json"));
  if (!nodeEntries.length) throw new HrcImportError("Nenhuma estratégia foi encontrada neste ZIP.");
  nodeEntries.sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

  const settings = parseJson(files.get(settingsEntry)!, settingsEntry);
  const nodes = nodeEntries.map((name) => parseJson(files.get(name)!, name));
  const validated = validateHrcPack({ name: file.name.replace(/\.zip$/i, ""), settings, nodes }, nodeEntries);
  return { ...validated, contentHash, archiveSizeBytes: file.size };
}

export function validateHrcPack(value: unknown, nodePaths: string[] = []): HrcValidatedPack {
  if (!isRecord(value)) throw new HrcImportError("Pacote HRC inválido.");
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 160) : "";
  const settings = value.settings;
  const nodes = value.nodes;
  if (!name || !isRecord(settings) || !isRecord(settings.handdata) || !isRecord(settings.eqmodel) || !Array.isArray(nodes)) {
    throw new HrcImportError("Pacote HRC inválido.");
  }
  if (nodes.length === 0 || nodes.length > MAX_NODE_COUNT) throw new HrcImportError("Quantidade de nodes do pacote HRC inválida.");

  const stacks = strictNumberArray(settings.handdata.stacks, "stacks");
  const blinds = strictNumberArray(settings.handdata.blinds, "blinds");
  if (stacks.length < 2 || stacks.length > 10 || stacks.some((stack) => stack <= 0)) {
    throw new HrcImportError("Stacks inválidos no settings.json.");
  }
  if (blinds.length < 2 || blinds[0] <= 0 || blinds[1] < 0 || blinds[1] > blinds[0] || (blinds[2] ?? 0) < 0) {
    throw new HrcImportError("Blinds inválidos no settings.json.");
  }

  const parsedNodes = nodes.map((node, index) => parseNode(node, index, stacks.length, nodePaths[index] ?? `nodes/${index}.json`));
  const eligible = parsedNodes.reduce(
    (total, node) => total + Object.values(node.hands).filter((hand) => hand.weight >= 0.01).length,
    0,
  );
  if (!eligible) throw new HrcImportError("Nenhuma mão elegível foi encontrada neste estudo.");

  const eqmodelId = firstString(settings.eqmodel.id, settings.eqmodel.type, settings.eqmodel.name, settings.eqmodel.model);
  return {
    name,
    settings: {
      handdata: {
        stacks,
        blinds,
        skipSb: Boolean(settings.handdata.skipSb),
        movingBu: Boolean(settings.handdata.movingBu),
        anteType: firstString(settings.handdata.anteType, settings.handdata.anteMode),
      },
      eqmodel: {
        id: eqmodelId,
        raked: Boolean(settings.eqmodel.raked),
        metadata: withoutKeys(settings.eqmodel, ["id", "raked"]),
      },
      metadata: structuredClone(settings),
    },
    nodes: parsedNodes,
    eligible,
  };
}

export function toHrcStudyImport(pack: HrcPack): HrcStudyImport {
  if (!/^[a-f0-9]{64}$/.test(pack.contentHash)) throw new HrcImportError("Hash do arquivo HRC inválido.");
  const { stacks, blinds, anteType: rawAnteType } = pack.settings.handdata;
  const bigBlind = blinds[0];
  const positions = positionNames(stacks.length);
  const ante = Math.max(0, blinds[2] ?? 0);
  const anteType = normalizeAnteType(rawAnteType, ante);
  const equityModel = inferEquityModel(pack.settings.eqmodel);
  const stackValues = stacks.map((stack) => roundBb(stack / bigBlind));
  const stackBb = stackValues.every((stack) => Math.abs(stack - stackValues[0]) < 0.001) ? stackValues[0] : null;
  const ignoredNodes = {
    AUTOMATIC_X: pack.nodes.filter(isAutomaticXNode).length,
  };

  const nodes = pack.nodes.flatMap((node): HrcStudyNode[] => {
    if (node.street !== 0 || !node.actions.length || node.player < 0) return [];
    const trainingType = classifyHrcNode(node, stacks);
    if (!trainingType) return [];
    const hands = Object.entries(node.hands);
    if (!hands.some(([, hand]) => hand.weight >= 0.01)) return [];

    const availableActions = node.actions.map((action, actionIndex) => toTrainingAction(action, actionIndex, node, stacks, bigBlind));
    const lastRaise = [...node.sequence].reverse().find((action) => action.type === "R");
    const heroPosition = positions[node.player] ?? `P${node.player + 1}`;
    const villainPosition = lastRaise ? positions[lastRaise.player] ?? `P${lastRaise.player + 1}` : null;

    return [{
      nodeKey: node.nodeKey,
      trainingType,
      heroPosition,
      heroStackBb: roundBb(stacks[node.player] / bigBlind),
      villainPosition,
      actionSequence: node.sequence.map((action, actionIndex) => ({
        ...toTrainingAction(action, actionIndex, node, stacks, bigBlind, action.player),
        position: positions[action.player] ?? `P${action.player + 1}`,
      })),
      availableActions,
      hands: hands.map(([handClass, hand]) => {
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
      }),
      metadata: {
        ...node.metadata,
        hrcNodeSource: node.sourcePath,
        hrcPlayer: node.player,
        hrcChildren: node.children,
      },
    }];
  });

  if (!nodes.length) throw new HrcImportError("O estudo não contém nodes pré-flop que possam ser classificados com segurança para treinamento.");
  const nodeKeys = new Set<string>();
  for (const node of nodes) {
    if (nodeKeys.has(node.nodeKey)) throw new HrcImportError(`Identificador de node duplicado no estudo: ${node.nodeKey}.`);
    nodeKeys.add(node.nodeKey);
  }
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
    metadata: {
      validationVersion: 2,
      sourceFormat: "HRC_COMPLETE_EXPORT",
      hrcEquityModel: pack.settings.eqmodel.id,
      hrcRaked: pack.settings.eqmodel.raked,
      hrcNodeCount: pack.nodes.length,
      compatibleNodeCount: nodes.length,
      ignoredNodes,
      eligibleHands: nodes.reduce((total, node) => total + node.hands.filter((hand) => Number(hand.metadata.hrcWeight) >= 0.01).length, 0),
      archiveSizeBytes: pack.archiveSizeBytes,
      hrcSettings: pack.settings.metadata,
    },
    nodes,
  };
}

export function summarizeHrcStudy(study: HrcStudyImport): HrcImportSummary {
  const counts: Record<TrainingType, number> = { PUSH_FOLD: 0, CALL_VS_SHOVE: 0, OPEN_FOLD: 0, VS_OPEN: 0 };
  for (const node of study.nodes) counts[node.trainingType]++;
  return {
    name: study.name,
    equityModel: study.equityModel,
    playersCount: study.playersCount,
    stackBb: study.stackBb,
    smallBlindBb: roundBb(study.smallBlind / study.bigBlind),
    anteBb: roundBb(study.ante / study.bigBlind),
    anteType: study.anteType,
    nodeCount: study.nodes.length,
    handCount: study.nodes.reduce((total, node) => total + node.hands.length, 0),
    counts,
    ignoredNodes: study.ignoredNodes,
  };
}

export function classifyHrcNode(node: HrcNode, stacks: number[]): TrainingType | null {
  if (node.player < 0 || !node.actions.length || node.actions.some((action) => action.type === "X")) return null;
  const foldActions = node.actions.filter((action) => action.type === "F");
  const callActions = node.actions.filter((action) => action.type === "C");
  const raiseActions = node.actions.filter((action) => action.type === "R");
  if (foldActions.length !== 1) return null;

  const voluntary = node.sequence.filter((action) => action.type === "R" || (action.type === "C" && action.amount > 0));
  const priorRaises = node.sequence.filter((action) => action.type === "R");
  if (!voluntary.length) {
    if (callActions.length || !raiseActions.length) return null;
    const shoveFlags = raiseActions.map((action) => isAllInRaise(action, node.player, stacks));
    if (shoveFlags.every(Boolean)) return "PUSH_FOLD";
    if (shoveFlags.every((flag) => !flag)) return "OPEN_FOLD";
    return null;
  }

  const lastRaiseIndex = node.sequence.findLastIndex((action) => action.type === "R");
  if (lastRaiseIndex < 0) return null;
  const lastRaise = node.sequence[lastRaiseIndex];
  const hasNonFoldAfterRaise = node.sequence.slice(lastRaiseIndex + 1).some((action) => action.type !== "F");
  if (hasNonFoldAfterRaise) return null;

  if (isAllInRaise(lastRaise, lastRaise.player, stacks)) {
    return callActions.length === 1 && !raiseActions.length ? "CALL_VS_SHOVE" : null;
  }

  const callsBeforeOpen = node.sequence.slice(0, lastRaiseIndex).some((action) => action.type === "C" && action.amount > 0);
  if (priorRaises.length === 1 && !callsBeforeOpen && callActions.length === 1 && raiseActions.length > 0) return "VS_OPEN";
  return null;
}

async function readHrcZip(bytes: Uint8Array): Promise<Map<string, string>> {
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
  if (!count || count > MAX_ZIP_ENTRIES || centralOffset + centralSize > eocd) throw new HrcImportError("Índice do ZIP inválido.");

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
      if (uncompressedSize > MAX_ENTRY_BYTES) throw new HrcImportError(`Arquivo interno muito grande: ${name}.`);
      if (compressedSize > 0 && uncompressedSize / compressedSize > 200) throw new HrcImportError(`Taxa de compressão insegura no arquivo ${name}.`);
      totalUncompressed += uncompressedSize;
    }
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new HrcImportError("O conteúdo descompactado excede o limite de 64 MB.");
    entries.push({ name, flags, method, crc, compressedSize, uncompressedSize, localOffset });
    pointer = end;
  }

  const settings = entries.filter((entry) => /(^|\/)settings\.json$/.test(entry.name));
  if (settings.length !== 1) throw new HrcImportError(settings.length ? "O ZIP contém mais de um settings.json." : "settings.json não encontrado. Use Export Strategies → Complete Export no HRC.");
  const root = settings[0].name.slice(0, -"settings.json".length);
  const expectedNode = new RegExp(`^${escapeRegExp(root)}nodes/[^/]+\\.json$`);
  const relevant = entries.filter((entry) => entry.name === settings[0].name || expectedNode.test(entry.name));
  const unexpectedJson = entries.find((entry) => entry.name.endsWith(".json") && !relevant.includes(entry));
  if (unexpectedJson) throw new HrcImportError(`JSON inesperado no ZIP: ${unexpectedJson.name}.`);

  const files = new Map<string, string>();
  for (const entry of relevant) files.set(entry.name, decoder.decode(await inflateEntry(bytes, view, entry)));
  return files;
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
  const compressed = bytes.slice(start, end);
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
        if (actualSize > entry.uncompressedSize || actualSize > MAX_ENTRY_BYTES) {
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
  if (!Array.isArray(value.actions) || !Array.isArray(value.sequence) || !isRecord(value.hands)) {
    throw new HrcImportError(`Estrutura do node HRC ${sourcePath || index} inválida.`);
  }
  const rawHands = value.hands;
  const actions = value.actions.map((action) => parseAction(action));
  const sequence = value.sequence.map((action) => {
    const parsed = parseAction(action);
    if (parsed.type === "X" || !isRecord(action) || !Number.isInteger(action.player) || Number(action.player) < 0 || Number(action.player) >= playersCount) {
      throw new HrcImportError(`Sequência do node HRC ${sourcePath || index} inválida.`);
    }
    const street = optionalJsonNumber(action.street, 0, "street da sequência");
    return { ...parsed, player: Number(action.player), street };
  });
  if (actions.length > 20 || (actions.length > 0 && Number(value.player) < 0)) {
    throw new HrcImportError(`Estratégia do node HRC ${sourcePath || index} inválida.`);
  }
  const street = optionalJsonNumber(value.street, 0, "street do node");
  const children = optionalJsonNumber(value.children, 0, "children do node");
  const hands: Record<string, HrcHand> = {};
  const rawHandClasses = Object.keys(rawHands);
  const invalidHandClass = rawHandClasses.find((handClass) => !isHandClass(handClass));
  if (invalidHandClass) throw new HrcImportError(`Classe de mão não canônica ${invalidHandClass} no node ${sourcePath}.`);
  if (actions.length && (rawHandClasses.length !== CANONICAL_HAND_CLASSES.size || [...CANONICAL_HAND_CLASSES].some((handClass) => !(handClass in rawHands)))) {
    throw new HrcImportError(`Node ${sourcePath} deve conter exatamente as 169 classes de mãos canônicas.`);
  }
  for (const [handClass, hand] of Object.entries(rawHands)) {
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
  if (actions.some((action) => action.type === "X")) {
    const isValidAutomaticX = actions.length === 1
      && actions[0].type === "X"
      && actions[0].amount === 0
      && children === 1
      && Object.keys(rawHands).length === 169
      && Object.keys(hands).length === 169
      && Object.values(hands).every((hand) => hand.played.length === 1
        && Math.abs(hand.played[0] - 1) <= 0.000001
        && hand.evs.length === 1);
    if (!isValidAutomaticX) {
      throw new HrcImportError(`Node automático X ${sourcePath || index} não segue o formato estrutural esperado.`);
    }
  }
  const explicitKey = firstString(value.id, value.nodeId, value.key);
  return {
    nodeKey: (explicitKey || sourcePath).slice(0, 240),
    sourcePath,
    player: Number(value.player),
    street,
    children,
    sequence,
    actions,
    hands,
    metadata: withoutKeys(value, ["id", "nodeId", "key", "player", "street", "children", "sequence", "actions", "hands"]),
  };
}

function parseAction(value: unknown): HrcAction {
  if (!isRecord(value) || !["F", "C", "R", "X"].includes(String(value.type))) throw new HrcImportError("Ação HRC inválida.");
  const amount = optionalJsonNumber(value.amount, 0, "valor da ação");
  if (amount < 0 || (value.type === "R" && amount <= 0) || (value.type === "X" && amount !== 0)) {
    throw new HrcImportError("Valor de ação HRC inválido.");
  }
  return {
    type: value.type as HrcAction["type"],
    amount,
    ...(Number.isInteger(value.node) ? { node: Number(value.node) } : {}),
    metadata: withoutKeys(value, ["type", "amount", "node", "player", "street"]),
  };
}

function toTrainingAction(action: HrcAction, index: number, node: HrcNode, stacks: number[], bigBlind: number, actingPlayer = node.player): TrainingAction {
  const id = `action-${index}`;
  const metadata = { ...action.metadata, hrcType: action.type, hrcAmount: action.amount, ...(action.node === undefined ? {} : { hrcChildNode: action.node }) };
  if (action.type === "F") return { id, type: "FOLD", metadata };
  if (action.type === "C") return { id, type: action.amount <= 0 ? "CHECK" : "CALL", metadata };
  if (action.type !== "R") throw new HrcImportError("Node automático X não pode ser convertido em uma decisão de treinamento.");
  return {
    id,
    type: "RAISE",
    amountBb: roundBb(action.amount / bigBlind),
    label: isAllInRaise(action, actingPlayer, stacks) ? "All-in" : undefined,
    metadata,
  };
}

function isAutomaticXNode(node: HrcNode) {
  return node.actions.length === 1 && node.actions[0].type === "X";
}

function isAllInRaise(action: Pick<HrcAction, "type" | "amount">, player: number, stacks: number[]) {
  if (action.type !== "R" || player < 0 || player >= stacks.length) return false;
  const stack = stacks[player];
  return Math.abs(action.amount - stack) <= Math.max(0.001, stack * 0.0001);
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

function validateUpload(file: UploadedFile) {
  if (!file.name || !/\.zip$/i.test(file.name)) throw new HrcImportError("Selecione um arquivo .zip exportado pelo HRC.");
  if (!ALLOWED_MIME_TYPES.has((file.type || "").toLowerCase())) throw new HrcImportError("O tipo MIME do arquivo não corresponde a um ZIP.");
  if (file.size <= 0) throw new HrcImportError("O arquivo ZIP está vazio.");
  if (file.size > MAX_ARCHIVE_BYTES) throw new HrcImportError("O arquivo HRC excede o limite de 25 MB.");
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

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
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
  if (!Number.isFinite(total) || Math.abs(total - 1) > FREQUENCY_EPSILON) {
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
