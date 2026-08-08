import type { TrainingAction, TrainingSequenceAction, TrainingType } from "./training";

export type HrcAction = { type: "F" | "C" | "R"; amount: number; node?: number };
export type HrcSequenceAction = HrcAction & { player: number; street: number };
export type HrcHand = { weight: number; played: number[]; evs: number[] };
export type HrcNode = {
  player: number;
  street: number;
  children: number;
  sequence: HrcSequenceAction[];
  actions: HrcAction[];
  hands: Record<string, HrcHand>;
};
export type HrcSettings = {
  handdata: { stacks: number[]; blinds: number[]; skipSb: boolean; movingBu: boolean; anteType: string };
  eqmodel: { id: string; raked: boolean };
};
export type HrcPack = { name: string; settings: HrcSettings; nodes: HrcNode[]; eligible: number };

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
  equityModel: "CHIP_EV" | "ICM";
  playersCount: number;
  stackBb: number | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  icmContext: string | null;
  metadata: Record<string, unknown>;
  nodes: HrcStudyNode[];
};

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_NODE_COUNT = 50_000;
const HAND_CLASS = /^(?:[2-9TJQKA]{2}|[2-9TJQKA]{2}[so])$/;

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
  };
  return maps[count] ?? Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

export async function parseHrcPack(file: File): Promise<HrcPack> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("O arquivo HRC excede o limite de 100 MB.");
  const files = await readHrcZip(file);
  if (!files["settings.json"]) throw new Error("settings.json não encontrado. Use Export Strategies → Complete Export no HRC.");
  const settings = JSON.parse(files["settings.json"]);
  const nodeNames = Object.keys(files)
    .filter((name) => /^nodes\/\d+\.json$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  if (!nodeNames.length) throw new Error("Nenhuma estratégia foi encontrada neste ZIP.");
  const nodes = nodeNames.map((name) => JSON.parse(files[name]));
  return validateHrcPack({ name: file.name.replace(/\.zip$/i, ""), settings, nodes });
}

export function validateHrcPack(value: unknown): HrcPack {
  if (!isRecord(value)) throw new Error("Pacote HRC inválido.");
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 160) : "";
  const settings = value.settings;
  const nodes = value.nodes;
  if (!name || !isRecord(settings) || !isRecord(settings.handdata) || !isRecord(settings.eqmodel) || !Array.isArray(nodes)) {
    throw new Error("Pacote HRC inválido.");
  }
  if (nodes.length === 0 || nodes.length > MAX_NODE_COUNT) throw new Error("Quantidade de nodes do pacote HRC inválida.");

  const stacks = numberArray(settings.handdata.stacks);
  const blinds = numberArray(settings.handdata.blinds);
  if (stacks.length < 2 || stacks.length > 10 || stacks.some((stack) => stack <= 0) || blinds.length < 2 || blinds[0] <= 0 || blinds[1] < 0) {
    throw new Error("Stacks ou blinds inválidos no settings.json.");
  }

  const parsedNodes = nodes.map((node, index) => parseNode(node, index, stacks.length));
  const eligible = parsedNodes.reduce((total, node) => total + Object.values(node.hands).filter((hand) => hand.weight >= 0.01).length, 0);
  if (!eligible) throw new Error("Nenhuma mão elegível foi encontrada neste estudo.");

  return {
    name,
    settings: {
      handdata: {
        stacks,
        blinds,
        skipSb: Boolean(settings.handdata.skipSb),
        movingBu: Boolean(settings.handdata.movingBu),
        anteType: typeof settings.handdata.anteType === "string" ? settings.handdata.anteType : "",
      },
      eqmodel: {
        id: typeof settings.eqmodel.id === "string" ? settings.eqmodel.id : "",
        raked: Boolean(settings.eqmodel.raked),
      },
    },
    nodes: parsedNodes,
    eligible,
  };
}

export function toHrcStudyImport(pack: HrcPack): HrcStudyImport {
  const { stacks, blinds, anteType: rawAnteType } = pack.settings.handdata;
  const bigBlind = blinds[0];
  const positions = positionNames(stacks.length);
  const ante = Math.max(0, blinds[2] ?? 0);
  const anteType = normalizeAnteType(rawAnteType, ante);
  const equityModel = pack.settings.eqmodel.id.toLowerCase().includes("icm") ? "ICM" : "CHIP_EV";
  const stackValues = stacks.map((stack) => roundBb(stack / bigBlind));
  const stackBb = stackValues.every((stack) => Math.abs(stack - stackValues[0]) < 0.001) ? stackValues[0] : null;

  const nodes = pack.nodes.flatMap((node, nodeIndex): HrcStudyNode[] => {
    if (node.street !== 0 || !node.actions.length) return [];
    const hands = Object.entries(node.hands).filter(([handClass, hand]) =>
      HAND_CLASS.test(handClass) && hand.weight >= 0.01 && hand.played.length >= node.actions.length && hand.evs.length >= node.actions.length,
    );
    if (!hands.length) return [];

    const availableActions = node.actions.map((action, actionIndex) => toTrainingAction(action, actionIndex, node, stacks, bigBlind));
    const lastRaise = [...node.sequence].reverse().find((action) => action.type === "R");
    const trainingType = classifyNode(node, lastRaise, stacks);
    const heroPosition = positions[node.player] ?? `P${node.player + 1}`;
    const villainPosition = lastRaise ? positions[lastRaise.player] ?? `P${lastRaise.player + 1}` : null;

    return [{
      nodeKey: String(nodeIndex),
      trainingType,
      heroPosition,
      heroStackBb: roundBb(stacks[node.player] / bigBlind),
      villainPosition,
      actionSequence: node.sequence.map((action, actionIndex) => ({
        ...toTrainingAction(action, actionIndex, node, stacks, bigBlind),
        position: positions[action.player] ?? `P${action.player + 1}`,
      })),
      availableActions,
      hands: hands.map(([handClass, hand]) => {
        const strategy = Object.fromEntries(availableActions.map((action, index) => [action.id!, hand.played[index]]));
        const evs = Object.fromEntries(availableActions.map((action, index) => [action.id!, hand.evs[index]]));
        const rankedEvs = [...hand.evs.slice(0, availableActions.length)].sort((left, right) => right - left);
        const bestIndex = hand.evs.slice(0, availableActions.length).reduce((best, value, index, values) => value > values[best] ? index : best, 0);
        return {
          handClass,
          strategy,
          evs,
          bestAction: availableActions[bestIndex]?.id ?? null,
          decisionClarity: rankedEvs.length > 1 ? rankedEvs[0] - rankedEvs[1] : null,
          isMixed: hand.played.slice(0, availableActions.length).filter((frequency) => frequency >= 0.05).length > 1,
          metadata: { hrcWeight: hand.weight },
        };
      }),
      metadata: { hrcNodeIndex: nodeIndex, hrcPlayer: node.player, hrcChildren: node.children },
    }];
  });

  if (!nodes.length) throw new Error("O estudo não contém nodes pré-flop compatíveis para treinamento.");
  return {
    name: pack.name,
    equityModel,
    playersCount: stacks.length,
    stackBb,
    smallBlind: blinds[1],
    bigBlind,
    ante,
    anteType,
    icmContext: equityModel === "ICM" ? "ICM" : null,
    metadata: {
      sourceFormat: "HRC_COMPLETE_EXPORT",
      hrcEquityModel: pack.settings.eqmodel.id,
      hrcRaked: pack.settings.eqmodel.raked,
      hrcNodeCount: pack.nodes.length,
      eligibleHands: nodes.reduce((total, node) => total + node.hands.length, 0),
    },
    nodes,
  };
}

async function readHrcZip(file: File): Promise<Record<string, string>> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (u32(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("ZIP do HRC inválido.");
  const count = u16(eocd + 10);
  const centralOffset = u32(eocd + 16);
  const files: Record<string, string> = {};
  let pointer = centralOffset;
  for (let index = 0; index < count; index++) {
    if (pointer + 46 > bytes.length || u32(pointer) !== 0x02014b50) throw new Error("Índice do ZIP inválido.");
    const method = u16(pointer + 10);
    const compressedSize = u32(pointer + 20);
    const nameLength = u16(pointer + 28);
    const extraLength = u16(pointer + 30);
    const commentLength = u16(pointer + 32);
    const localOffset = u32(pointer + 42);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    if (name === "settings.json" || /^nodes\/\d+\.json$/.test(name)) {
      if (localOffset + 30 > bytes.length || u32(localOffset) !== 0x04034b50) throw new Error("Entrada ZIP inválida.");
      const localNameLength = u16(localOffset + 26);
      const localExtraLength = u16(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const end = start + compressedSize;
      if (end > bytes.length) throw new Error("Entrada ZIP incompleta.");
      const compressed = bytes.slice(start, end);
      if (method === 0) files[name] = decoder.decode(compressed);
      else if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        files[name] = await new Response(stream).text();
      } else throw new Error(`Compressão ZIP não suportada (${method}).`);
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function parseNode(value: unknown, index: number, playersCount: number): HrcNode {
  if (!isRecord(value) || !Number.isInteger(value.player) || Number(value.player) < -1 || Number(value.player) >= playersCount) {
    throw new Error(`Node HRC ${index} inválido.`);
  }
  const actions = Array.isArray(value.actions) ? value.actions.map((action) => parseAction(action)) : [];
  const sequence = Array.isArray(value.sequence) ? value.sequence.map((action) => {
    const parsed = parseAction(action);
    if (!isRecord(action) || !Number.isInteger(action.player) || Number(action.player) < 0 || Number(action.player) >= playersCount) {
      throw new Error(`Sequência do node HRC ${index} inválida.`);
    }
    return { ...parsed, player: Number(action.player), street: finiteNumber(action.street, 0) };
  }) : [];
  if (actions.length > 20 || !isRecord(value.hands) || (actions.length > 0 && Number(value.player) < 0)) {
    throw new Error(`Estratégia do node HRC ${index} inválida.`);
  }
  const hands: Record<string, HrcHand> = {};
  for (const [handClass, hand] of Object.entries(value.hands)) {
    if (!HAND_CLASS.test(handClass) || !isRecord(hand)) continue;
    const played = numberArray(hand.played);
    const evs = numberArray(hand.evs);
    if (played.length < actions.length || evs.length < actions.length) continue;
    hands[handClass] = { weight: finiteNumber(hand.weight, 0), played, evs };
  }
  return {
    player: Number(value.player),
    street: finiteNumber(value.street, 0),
    children: finiteNumber(value.children, 0),
    sequence,
    actions,
    hands,
  };
}

function parseAction(value: unknown): HrcAction {
  if (!isRecord(value) || !["F", "C", "R"].includes(String(value.type))) throw new Error("Ação HRC inválida.");
  return {
    type: value.type as HrcAction["type"],
    amount: finiteNumber(value.amount, 0),
    ...(Number.isInteger(value.node) ? { node: Number(value.node) } : {}),
  };
}

function toTrainingAction(action: HrcAction, index: number, node: HrcNode, stacks: number[], bigBlind: number): TrainingAction {
  const id = `action-${index}`;
  if (action.type === "F") return { id, type: "FOLD" };
  if (action.type === "C") return { id, type: action.amount <= 0 ? "CHECK" : "CALL" };
  return {
    id,
    type: "RAISE",
    amountBb: roundBb(action.amount / bigBlind),
    label: action.amount >= stacks[node.player] - 0.001 ? "All-in" : undefined,
  };
}

function classifyNode(node: HrcNode, lastRaise: HrcSequenceAction | undefined, stacks: number[]): TrainingType {
  if (lastRaise) return lastRaise.amount >= stacks[lastRaise.player] - 0.001 ? "CALL_VS_SHOVE" : "VS_OPEN";
  const raises = node.actions.filter((action) => action.type === "R");
  return raises.length > 0 && raises.every((action) => action.amount >= stacks[node.player] - 0.001) ? "PUSH_FOLD" : "OPEN_FOLD";
}

function normalizeAnteType(value: string, ante: number): HrcStudyImport["anteType"] {
  if (ante <= 0) return "NONE";
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  return normalized.includes("bb") || normalized.includes("bigblind") ? "BB_ANTE" : "ANTE";
}

function numberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => finiteNumber(item, Number.NaN)).filter(Number.isFinite);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundBb(value: number) {
  return Number(value.toFixed(4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
