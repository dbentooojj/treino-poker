import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { HrcImportError, parseHrcPack, summarizeHrcStudy, toHrcStudyImport, validateHrcPack } from "../lib/hrc-import";

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
  hands: strategyHands([0, 1], [0, 2.5]),
};

const callNode = {
  player: 1,
  street: 0,
  children: 2,
  sequence: [{ player: 0, street: 0, type: "R", amount: 1_000 }],
  actions: [{ type: "F", amount: 0 }, { type: "C", amount: 900 }],
  hands: strategyHands([0.4, 0.6], [-0.2, 0.1], 0.75),
};

const automaticXHands = Object.fromEntries(allHandClasses().map((handClass) => [
  handClass,
  { weight: 1, played: [1], evs: [10.5] },
]));

const automaticXNode = {
  player: 1,
  street: 0,
  children: 1,
  sequence: [{ player: 0, street: 0, type: "F", amount: 0 }],
  actions: [{ type: "X", amount: 0 }],
  hands: automaticXHands,
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
  assert.equal(study.evUnit, "UNKNOWN", "o importador não deve inventar a unidade do EV ChipEV");
  assert.equal(study.metadata.validationVersion, 2);
  assert.equal(study.stackBb, 10);
  assert.equal(study.ante, 10);
  assert.equal(study.anteType, "BB_ANTE");
  assert.equal(summary.counts.PUSH_FOLD, 1);
  assert.equal(summary.counts.CALL_VS_SHOVE, 1);
  assert.equal(study.nodes[1].actionSequence[0].label, "All-in");
  const aceKingOffsuit = study.nodes[1].hands.find((hand) => hand.handClass === "AKo");
  assert.deepEqual(aceKingOffsuit?.strategy, { "action-0": 0.4, "action-1": 0.6 });
  assert.deepEqual(aceKingOffsuit?.evs, { "action-0": -0.2, "action-1": 0.1 });
});

test("rejeita ZIP inválido", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "broken.zip", { type: "application/zip" }) as unknown as Parameters<typeof parseHrcPack>[0];
  await assert.rejects(parseHrcPack(file), /ZIP do HRC inválido/);
});

test("limita a quantidade de nodes antes de expandir milhões de mãos", () => {
  assert.throws(() => validateHrcPack({ name: "oversized", settings, nodes: Array.from({ length: 501 }, () => pushNode) }), /Quantidade de nodes/);
});

test("aceita o método deflate usado por ZIPs reais", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
  }, true);
  assert.equal((await parseHrcPack(file)).nodes.length, 1);
});

test("interrompe descompactação quando o tamanho real excede o declarado", async () => {
  const bytes = createZip({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
  }, true);
  falsifyUncompressedSize(bytes, "nodes/0.json", 32);
  const file = new File([bytes], "study.zip", { type: "application/zip" }) as unknown as Parameters<typeof parseHrcPack>[0];
  await assert.rejects(parseHrcPack(file), /Tamanho descompactado inconsistente/);
});

test("aceita X automático, ignora o node estrutural e registra ignoredNodes.AUTOMATIC_X", async () => {
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
    "nodes/1.json": JSON.stringify(automaticXNode),
  });
  const pack = await parseHrcPack(file);
  const study = toHrcStudyImport(pack);
  const summary = summarizeHrcStudy(study);

  assert.equal(pack.nodes.length, 2);
  assert.equal(study.nodes.length, 1);
  assert.deepEqual(study.ignoredNodes, { AUTOMATIC_X: 1 });
  assert.deepEqual(study.metadata.ignoredNodes, { AUTOMATIC_X: 1 });
  assert.deepEqual(summary.ignoredNodes, { AUTOMATIC_X: 1 });
});

test("rejeita X que não segue integralmente o padrão automático", async (context) => {
  const invalidNodes = [
    { name: "amount diferente de zero", node: { ...automaticXNode, actions: [{ type: "X", amount: 1 }] } },
    { name: "mais de um filho", node: { ...automaticXNode, children: 2 } },
    {
      name: "menos de 169 mãos",
      node: { ...automaticXNode, hands: Object.fromEntries(Object.entries(automaticXHands).slice(0, 168)) },
    },
    {
      name: "frequência diferente de 100%",
      node: { ...automaticXNode, hands: { ...automaticXHands, AA: { weight: 1, played: [0.5], evs: [10.5] } } },
    },
    {
      name: "vetor com decisão adicional",
      node: { ...automaticXNode, hands: { ...automaticXHands, AA: { weight: 1, played: [1, 0], evs: [10.5, 0] } } },
    },
  ];

  for (const { name, node } of invalidNodes) {
    await context.test(name, async () => {
      const file = zipFile({
        "settings.json": JSON.stringify(settings),
        "nodes/0.json": JSON.stringify(pushNode),
        "nodes/1.json": JSON.stringify(node),
      });
      await assert.rejects(parseHrcPack(file), HrcImportError);
    });
  }
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

test("rejeita cobertura, classes, vetores e frequências estratégicas inválidas", async (context) => {
  const nonCanonicalHands = { ...pushNode.hands };
  delete nonCanonicalHands.A2s;
  nonCanonicalHands["2As"] = { weight: 1, played: [0, 1], evs: [0, 2.5] };
  const invalidNodes = [
    { name: "168 classes", node: { ...pushNode, hands: Object.fromEntries(Object.entries(pushNode.hands).slice(0, 168)) } },
    { name: "classe não canônica", node: { ...pushNode, hands: nonCanonicalHands } },
    { name: "played curto", node: replaceHand(pushNode, "AA", { weight: 1, played: [1], evs: [0, 2.5] }) },
    { name: "played longo", node: replaceHand(pushNode, "AA", { weight: 1, played: [0, 1, 0], evs: [0, 2.5] }) },
    { name: "EV curto", node: replaceHand(pushNode, "AA", { weight: 1, played: [0, 1], evs: [2.5] }) },
    { name: "EV longo", node: replaceHand(pushNode, "AA", { weight: 1, played: [0, 1], evs: [0, 2.5, 3] }) },
    { name: "soma 160%", node: replaceHand(pushNode, "AA", { weight: 1, played: [0.8, 0.8], evs: [0, 2.5] }) },
    { name: "unidade percentual", node: replaceHand(pushNode, "AA", { weight: 1, played: [40, 60], evs: [0, 2.5] }) },
    { name: "peso acima de 1", node: replaceHand(pushNode, "AA", { weight: 1.01, played: [0, 1], evs: [0, 2.5] }) },
  ];

  for (const { name, node } of invalidNodes) {
    await context.test(name, async () => {
      await assert.rejects(parseHrcPack(zipFile({
        "settings.json": JSON.stringify(settings),
        "nodes/0.json": JSON.stringify(node),
      })), HrcImportError);
    });
  }
});

test("normaliza apenas ruído numérico de borda sem preservar frequência ambígua", async () => {
  const noisyNode = replaceHand(pushNode, "AA", { weight: 1, played: [-0.0000005, 1.0000005], evs: [0, 2.5] });
  const pack = await parseHrcPack(zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(noisyNode),
  }));
  assert.deepEqual(pack.nodes[0].hands.AA.played, [0, 1]);
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

function allHandClasses() {
  const ranks = [..."AKQJT98765432"];
  const hands = [...ranks.map((rank) => `${rank}${rank}`)];
  for (let first = 0; first < ranks.length; first++) {
    for (let second = first + 1; second < ranks.length; second++) {
      hands.push(`${ranks[first]}${ranks[second]}s`, `${ranks[first]}${ranks[second]}o`);
    }
  }
  return hands;
}

type TestHand = { weight: number; played: number[]; evs: number[] };

function strategyHands(played: number[], evs: number[], weight = 1): Record<string, TestHand> {
  return Object.fromEntries(allHandClasses().map((handClass) => [handClass, { weight, played: [...played], evs: [...evs] }]));
}

function replaceHand<T extends { hands: Record<string, TestHand> }>(node: T, handClass: string, hand: TestHand): T {
  return { ...node, hands: { ...node.hands, [handClass]: hand } };
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

function falsifyUncompressedSize(bytes: Uint8Array, targetName: string, declaredSize: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const eocd = bytes.length - 22;
  let pointer = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);
  for (let index = 0; index < count; index++) {
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    if (name === targetName) {
      const localOffset = view.getUint32(pointer + 42, true);
      view.setUint32(pointer + 24, declaredSize, true);
      view.setUint32(localOffset + 22, declaredSize, true);
      return;
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Entrada de teste não encontrada: ${targetName}`);
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
