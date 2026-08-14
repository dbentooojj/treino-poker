import { File } from "node:buffer";
import { parseHrcPack, toHrcStudyImport } from "../lib/hrc-import";

const NODE_COUNT = 9_700;
const settings = JSON.stringify({
  handdata: { stacks: [1_000, 1_000], blinds: [100, 50, 10], skipSb: false, movingBu: true, anteType: "BB Ante" },
  eqmodel: { id: "chipEV", raked: false },
});
const structuralNode = JSON.stringify({ player: -1, street: 0, children: 0, sequence: [], actions: [], hands: {} });
const trainingNode = JSON.stringify({
  player: 0,
  street: 0,
  children: 2,
  sequence: [],
  actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000 }],
  hands: strategyHands(),
});

let archive: Uint8Array | null = createStoredZip();
const file = new File([archive], "benchmark-9700.zip", { type: "application/zip" });
archive = null;
globalThis.gc?.();

const baseline = memorySnapshot();
let peak = baseline;
const mark = () => { peak = maxMemory(peak, memorySnapshot()); };

const pack = await parseHrcPack(file as unknown as Parameters<typeof parseHrcPack>[0]);
mark();
const study = toHrcStudyImport(pack, { releaseRawHands: true });
mark();

if (pack.nodes.length !== NODE_COUNT || study.sourceNodes.length !== NODE_COUNT || study.nodes.length !== 1) {
  throw new Error("O benchmark sintético não percorreu a árvore esperada.");
}

const final = memorySnapshot();
console.log(JSON.stringify({
  nodeCount: NODE_COUNT,
  archiveMiB: toMiB(file.size),
  baselineMiB: formatMemory(baseline),
  approximatePeakMiB: formatMemory(peak),
  approximatePeakDeltaMiB: formatMemory(subtractMemory(peak, baseline)),
  finalMiB: formatMemory(final),
  note: "Pico aproximado por snapshots de process.memoryUsage após parse e conversão; request.formData() não faz parte deste processo isolado.",
}, null, 2));

function strategyHands() {
  const ranks = [..."AKQJT98765432"];
  const handClasses = ranks.map((rank) => `${rank}${rank}`);
  for (let first = 0; first < ranks.length; first++) {
    for (let second = first + 1; second < ranks.length; second++) {
      handClasses.push(`${ranks[first]}${ranks[second]}s`, `${ranks[first]}${ranks[second]}o`);
    }
  }
  return Object.fromEntries(handClasses.map((handClass) => [handClass, { weight: 1, played: [0, 1], evs: [0, 2.5] }]));
}

function createStoredZip() {
  const entries: Array<[string, string]> = [["settings.json", settings]];
  for (let index = 0; index < NODE_COUNT; index++) entries.push([`nodes/${index}.json`, index === 0 ? trainingNode : structuralNode]);
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const [name, source] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(source);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, centralParts.length, true);
  eocdView.setUint16(10, centralParts.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, localOffset, true);
  return concatenate([...localParts, ...centralParts, eocd]);
}

function concatenate(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type MemorySnapshot = Pick<NodeJS.MemoryUsage, "rss" | "heapUsed" | "external" | "arrayBuffers">;

function memorySnapshot(): MemorySnapshot {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, external, arrayBuffers };
}

function maxMemory(left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot {
  return {
    rss: Math.max(left.rss, right.rss),
    heapUsed: Math.max(left.heapUsed, right.heapUsed),
    external: Math.max(left.external, right.external),
    arrayBuffers: Math.max(left.arrayBuffers, right.arrayBuffers),
  };
}

function subtractMemory(left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot {
  return {
    rss: Math.max(0, left.rss - right.rss),
    heapUsed: Math.max(0, left.heapUsed - right.heapUsed),
    external: Math.max(0, left.external - right.external),
    arrayBuffers: Math.max(0, left.arrayBuffers - right.arrayBuffers),
  };
}

function formatMemory(memory: MemorySnapshot) {
  return Object.fromEntries(Object.entries(memory).map(([key, bytes]) => [key, toMiB(bytes)]));
}

function toMiB(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}
