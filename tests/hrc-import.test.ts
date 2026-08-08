import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { parseHrcPack, summarizeHrcStudy, toHrcStudyImport } from "../lib/hrc-import";

const settings = {
  handdata: {
    stacks: [1_000, 1_000],
    blinds: [100, 50, 10],
    skipSb: false,
    movingBu: true,
    anteType: "BB Ante",
  },
  eqmodel: { id: "chipEV", raked: false },
};

const pushNode = {
  player: 0,
  street: 0,
  children: 2,
  sequence: [],
  actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000 }],
  hands: { AA: { weight: 1, played: [0, 1], evs: [0, 2.5] } },
};

const callNode = {
  player: 1,
  street: 0,
  children: 2,
  sequence: [{ player: 0, street: 0, type: "R", amount: 1_000 }],
  actions: [{ type: "F", amount: 0 }, { type: "C", amount: 900 }],
  hands: { AKo: { weight: 0.75, played: [0.4, 0.6], evs: [-0.2, 0.1] } },
};

test("aceita um Complete Export válido e preserva estratégia, EVs e metadados", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
    "nodes/1.json": JSON.stringify(callNode),
  });
  const pack = await parseHrcPack(file);
  const study = toHrcStudyImport(pack);
  const summary = summarizeHrcStudy(study);

  assert.match(pack.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(study.playersCount, 2);
  assert.equal(study.stackBb, 10);
  assert.equal(study.ante, 10);
  assert.equal(study.anteType, "BB_ANTE");
  assert.equal(summary.counts.PUSH_FOLD, 1);
  assert.equal(summary.counts.CALL_VS_SHOVE, 1);
  assert.equal(study.nodes[1].actionSequence[0].label, "All-in");
  assert.deepEqual(study.nodes[1].hands[0].strategy, { "action-0": 0.4, "action-1": 0.6 });
  assert.deepEqual(study.nodes[1].hands[0].evs, { "action-0": -0.2, "action-1": 0.1 });
});

test("rejeita ZIP inválido", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "broken.zip", { type: "application/zip" }) as unknown as Parameters<typeof parseHrcPack>[0];
  await assert.rejects(parseHrcPack(file), /ZIP do HRC inválido/);
});

test("aceita o método deflate usado por ZIPs reais", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
  }, true);
  assert.equal((await parseHrcPack(file)).nodes.length, 1);
});

test("bloqueia path traversal dentro do ZIP", async () => {
  const file = zipFile({
    "../settings.json": JSON.stringify(settings),
    "../nodes/0.json": JSON.stringify(pushNode),
  });
  await assert.rejects(parseHrcPack(file), /path traversal/);
});

test("rejeita ZIP sem settings.json", async () => {
  const file = zipFile({ "nodes/0.json": JSON.stringify(pushNode) });
  await assert.rejects(parseHrcPack(file), /settings\.json não encontrado/);
});

test("rejeita node estruturalmente inválido", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify({ ...pushNode, hands: null }),
  });
  await assert.rejects(parseHrcPack(file), /Estrutura do node HRC/);
});

test("identifica Push/Fold somente quando o raise disponível é all-in", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/push.json": JSON.stringify(pushNode),
  });
  const study = toHrcStudyImport(await parseHrcPack(file));
  assert.equal(study.nodes[0].trainingType, "PUSH_FOLD");
  assert.equal(study.nodes[0].availableActions[1].label, "All-in");
});

test("identifica Call vs Shove pela sequência e pelas ações Fold/Call", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/call.json": JSON.stringify(callNode),
  });
  const study = toHrcStudyImport(await parseHrcPack(file));
  assert.equal(study.nodes[0].trainingType, "CALL_VS_SHOVE");
  assert.equal(study.nodes[0].villainPosition, "SB");
});

test("não confunde open raise com shove", async () => {
  const openNode = { ...pushNode, actions: [{ type: "F", amount: 0 }, { type: "R", amount: 250 }] };
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/open.json": JSON.stringify(openNode),
  });
  const study = toHrcStudyImport(await parseHrcPack(file));
  assert.equal(study.nodes[0].trainingType, "OPEN_FOLD");
  assert.equal(study.nodes[0].availableActions[1].label, undefined);
});

function zipFile(entries: Record<string, string>, compressed = false) {
  const bytes = createZip(entries, compressed);
  return new File([bytes], "study.zip", { type: "application/zip" }) as unknown as Parameters<typeof parseHrcPack>[0];
}

function createZip(entries: Record<string, string>, compressed: boolean) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const [name, source] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(source);
    const body = compressed ? new Uint8Array(deflateRawSync(data)) : data;
    const method = compressed ? 8 : 0;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(body, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, body.length, true);
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
  return concat([...localParts, ...centralParts, eocd]);
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
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
