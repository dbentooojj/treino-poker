import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { HrcImportError, normalizeHrcNodeReference, parseHrcPack, positionNames, summarizeHrcStudy, toHrcStudyImport, validateHrcPack } from "../lib/hrc-import";

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

const effectiveBbaSettings = {
  ...settings,
  handdata: {
    ...settings.handdata,
    stacks: Array.from({ length: 8 }, () => 2_000),
    blinds: [100, 50, 100],
    anteType: "BB Ante",
    anteMode: "Ante First",
  },
};

const realCompleteExportSettings = {
  ...settings,
  handdata: {
    ...settings.handdata,
    stacks: Array.from({ length: 8 }, () => 200_000),
    blinds: [10_000, 5_000, 10_000],
    anteType: "BB Ante",
    anteMode: "Ante First",
  },
};

const foldsToSmallBlind = Array.from({ length: 6 }, (_, player) => ({
  player,
  street: 0,
  type: "F",
  amount: 0,
}));

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

test("mapeia os players HRC 8-max na ordem padrão", () => {
  assert.deepEqual(positionNames(8), ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
});

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
  assert.equal(Object.keys(pack.nodes[0].hands).length, 169, "conversões de inspeção preservam o pack de entrada por padrão");
  assert.equal(study.playersCount, 2);
  assert.equal(study.evUnit, "UNKNOWN", "o importador não deve inventar a unidade do EV ChipEV");
  assert.equal(study.metadata.validationVersion, 4);
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
  assert.throws(() => validateHrcPack({ name: "oversized", settings, nodes: Array.from({ length: 20_001 }, () => pushNode) }), /Quantidade de nodes/);
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
  assert.equal(study.sourceNodes[1].ignoredReason, "AUTOMATIC_X");
  const expected = { POSTFLOP: 0, AUTOMATIC_X: 1, UNSUPPORTED_SEQUENCE: 0, NO_ELIGIBLE_HANDS: 0, NON_TRAINABLE: 0 };
  assert.deepEqual(study.ignoredNodes, expected);
  assert.deepEqual(study.metadata.ignoredNodes, expected);
  assert.deepEqual(summary.ignoredNodes, expected);
});

test("Complete Export importa X automático e X real como check no mesmo pacote", async () => {
  const mixedCheckNode = {
    player: 7,
    street: 0,
    children: 4,
    sequence: [
      ...foldsToSmallBlind,
      { player: 6, street: 0, type: "C", amount: 5_000 },
    ],
    actions: [
      { type: "F", amount: 0 },
      { type: "X", amount: 0 },
      { type: "R", amount: 30_000, node: 8 },
      { type: "R", amount: 190_000, node: 10 },
    ],
    hands: strategyHands([0.1, 0.2, 0.3, 0.4], [-1, 0, 1, 2]),
  };
  const automaticNode = {
    ...automaticXNode,
    player: 7,
    sequence: foldsToSmallBlind,
  };
  const file = zipFile({
    "settings.json": JSON.stringify(realCompleteExportSettings),
    "nodes/7.json": JSON.stringify(mixedCheckNode),
    "nodes/8.json": JSON.stringify(automaticNode),
  });

  const pack = await parseHrcPack(file);
  const study = toHrcStudyImport(pack);
  const mixedSource = study.sourceNodes.find((node) => node.sourceNodeId === "7");
  const automaticSource = study.sourceNodes.find((node) => node.sourceNodeId === "8");

  assert.equal(pack.nodes.length, 2);
  assert.equal(study.sourceNodes.length, 2);
  assert.equal(study.nodes.length, 1, "VS_LIMP deve ser materializado somente para navegar Full Hand");
  assert.equal(study.nodes[0].decisionEligible, false);
  assert.equal(study.nodes[0].trainingType, null);
  assert.equal(mixedSource?.ignoredReason, "UNSUPPORTED_SEQUENCE");
  assert.deepEqual(mixedSource?.sequence, mixedCheckNode.sequence.map((action) => ({ ...action, metadata: {} })));
  assert.deepEqual(mixedSource?.actions.map((action) => [action.type, action.amount, action.node]), [
    ["F", 0, undefined],
    ["X", 0, undefined],
    ["R", 30_000, 8],
    ["R", 190_000, 10],
  ]);
  assert.equal(automaticSource?.ignoredReason, "AUTOMATIC_X");
  assert.equal(study.ignoredNodes.AUTOMATIC_X, 1);
  assert.equal(study.ignoredNodes.UNSUPPORTED_SEQUENCE, 1);
});

test("X misto é convertido em Check e R19 permanece All-in efetivo", async () => {
  const node = {
    player: 7,
    street: 0,
    children: 4,
    sequence: foldsToSmallBlind,
    actions: [
      { type: "F", amount: 0 },
      { type: "X", amount: 0 },
      { type: "R", amount: 30_000 },
      { type: "R", amount: 190_000 },
    ],
    hands: strategyHands([0.1, 0.2, 0.3, 0.4], [-1, 0, 1, 2]),
  };

  const study = await studyFromNodes([node], realCompleteExportSettings);

  assert.equal(study.nodes[0].trainingType, "OPEN_FOLD");
  assert.deepEqual(study.nodes[0].availableActions.map(({ type, label }) => ({ type, label })), [
    { type: "FOLD", label: undefined },
    { type: "CHECK", label: "Check" },
    { type: "RAISE", label: undefined },
    { type: "RAISE", label: "All-in" },
  ]);
  assert.equal(study.nodes[0].availableActions[3].amountBb, 19);
  assert.equal(study.ignoredNodes.AUTOMATIC_X, 0);
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
    { name: "desvio maior que o arredondamento de quatro casas", node: replaceHand(pushNode, "AA", { weight: 1, played: [0.9998, 0], evs: [0, 2.5] }) },
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

test("aceita e normaliza o arredondamento de quatro casas dos exports HRC", async () => {
  const roundedNode = {
    ...pushNode,
    children: 4,
    actions: [
      { type: "F", amount: 0 },
      { type: "C", amount: 100 },
      { type: "R", amount: 300 },
      { type: "R", amount: 1_000 },
    ],
    hands: strategyHands([0, 0, 0, 1], [0, 1, 2, 3]),
  };
  roundedNode.hands.J3o = { weight: 1, played: [0.9034, 0.007, 0.0897, 0], evs: [0, 1, 2, 3] };
  roundedNode.hands["43s"] = { weight: 1, played: [0.0001, 0.999, 0, 0.0008], evs: [0, 1, 2, 3] };

  const pack = await parseHrcPack(zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(roundedNode),
  }));

  const j3o = pack.nodes[0].hands.J3o.played;
  const fourThreeSuited = pack.nodes[0].hands["43s"].played;
  assert.equal(j3o.reduce((sum, frequency) => sum + frequency, 0), 1);
  assert.equal(fourThreeSuited.reduce((sum, frequency) => sum + frequency, 0), 1);
  assert.deepEqual(j3o, [0.9034, 0.007, 0.0897, 0].map((frequency) => frequency / 1.0001));
  assert.deepEqual(fourThreeSuited, [0.0001, 0.999, 0, 0.0008].map((frequency) => frequency / 0.9999));
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

test("mantém rejeição de arquivo interno excessivo", async () => {
  const bytes = createZip({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
  }, true);
  falsifyUncompressedSize(bytes, "nodes/0.json", 9 * 1024 * 1024);
  const file = new File([bytes], "study.zip", { type: "application/zip" }) as unknown as Parameters<typeof parseHrcPack>[0];
  await assert.rejects(parseHrcPack(file), /Arquivo interno muito grande/);
});

test("classifica RFI com raise normal e shove sem colapsar sizings", async () => {
  const node = {
    ...pushNode,
    children: 4,
    actions: [
      { type: "F", amount: 0 },
      { type: "R", amount: 230 },
      { type: "R", amount: 250 },
      { type: "R", amount: 1_000 },
    ],
    hands: strategyHands([0.1, 0.2, 0.3, 0.4], [0, 1, 2, 3]),
  };
  const study = await studyFromNodes([node]);
  assert.equal(study.nodes[0].trainingType, "OPEN_FOLD");
  assert.deepEqual(study.nodes[0].availableActions.map((action) => action.amountBb ?? null), [null, 2.3, 2.5, 10]);
  assert.deepEqual(Object.keys(study.nodes[0].hands[0].strategy), ["action-0", "action-1", "action-2", "action-3"]);
});

test("A) RFI reconhece R1900 como all-in efetivo do SB com BBA Ante First", async () => {
  const node = {
    ...pushNode,
    player: 6,
    children: 3,
    sequence: foldsToSmallBlind,
    actions: [
      { type: "F", amount: 0 },
      { type: "R", amount: 350 },
      { type: "R", amount: 1_900 },
    ],
    hands: strategyHands([0.2, 0.3, 0.5], [0, 1, 2]),
  };

  const study = await studyFromNodes([node], effectiveBbaSettings);
  assert.equal(study.nodes[0].trainingType, "OPEN_FOLD");
  assert.deepEqual(study.nodes[0].availableActions.map((action) => action.amountBb ?? null), [null, 3.5, 19]);
  assert.deepEqual(study.nodes[0].availableActions.map((action) => action.label), [undefined, undefined, "All-in"]);
});

test("B) Push puro com R1900 efetivo é PUSH_FOLD", async () => {
  const node = {
    ...pushNode,
    player: 6,
    sequence: foldsToSmallBlind,
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_900 }],
    hands: strategyHands([0.35, 0.65], [0, 2]),
  };

  const study = await studyFromNodes([node], effectiveBbaSettings);
  assert.equal(study.nodes[0].trainingType, "PUSH_FOLD");
  assert.equal(study.nodes[0].availableActions[1].label, "All-in");
});

test("C) BB enfrentando R1900 efetivo do SB é CALL_VS_SHOVE e preserva label na sequência", async () => {
  const node = {
    ...callNode,
    player: 7,
    sequence: [...foldsToSmallBlind, { player: 6, street: 0, type: "R", amount: 1_900 }],
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 1_800 }],
    hands: strategyHands([0.45, 0.55], [-1, 0.5]),
  };

  const study = await studyFromNodes([node], effectiveBbaSettings);
  assert.equal(study.nodes[0].trainingType, "CALL_VS_SHOVE");
  assert.equal(study.nodes[0].villainPosition, "SB");
  assert.equal(study.nodes[0].actionSequence.at(-1)?.amountBb, 19);
  assert.equal(study.nodes[0].actionSequence.at(-1)?.label, "All-in");
});

test("D) stacks assimétricos recalculam o teto efetivo quando o maior oponente folda", async () => {
  const asymmetricSettings = {
    ...settings,
    handdata: {
      ...settings.handdata,
      stacks: [2_000, 3_000, 1_000],
      blinds: [100, 50, 0],
      anteType: "None",
      anteMode: "Ante First",
    },
  };
  const beforeFold = {
    ...pushNode,
    player: 1,
    sequence: [],
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 2_000 }],
    hands: strategyHands([0.4, 0.6], [0, 1]),
  };
  const afterFold = {
    ...pushNode,
    player: 1,
    children: 3,
    sequence: [{ player: 0, street: 0, type: "F", amount: 0 }],
    actions: [
      { type: "F", amount: 0 },
      { type: "R", amount: 1_000 },
      { type: "R", amount: 2_000 },
    ],
    hands: strategyHands([0.2, 0.5, 0.3], [0, 1, 2]),
  };

  const study = await studyFromNodes([beforeFold, afterFold], asymmetricSettings);
  assert.equal(study.nodes[0].trainingType, "PUSH_FOLD");
  assert.equal(study.nodes[0].availableActions[1].label, "All-in", "o oponente de 2000 ainda define o teto contestável");
  assert.equal(study.nodes[1].trainingType, "OPEN_FOLD");
  assert.equal(study.nodes[1].availableActions[1].label, "All-in", "após o fold, o oponente de 1000 define o teto");
  assert.equal(study.nodes[1].availableActions[2].label, undefined, "o maior sizing não deve ser presumido all-in");
});

test("E) BBA morto reduz o all-in efetivo do SB de R2000 para R1900", async () => {
  const node = {
    ...pushNode,
    player: 6,
    sequence: foldsToSmallBlind,
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_900 }],
    hands: strategyHands([0.25, 0.75], [0, 1]),
  };
  const withoutAnte = {
    ...effectiveBbaSettings,
    handdata: {
      ...effectiveBbaSettings.handdata,
      blinds: [100, 50, 0],
      anteType: "None",
    },
  };

  const withBba = await studyFromNodes([node], effectiveBbaSettings);
  const withoutBba = await studyFromNodes([node], withoutAnte);
  assert.equal(withBba.nodes[0].trainingType, "PUSH_FOLD");
  assert.equal(withBba.nodes[0].availableActions[1].label, "All-in");
  assert.equal(withoutBba.nodes[0].trainingType, "OPEN_FOLD");
  assert.equal(withoutBba.nodes[0].availableActions[1].label, undefined);
});

test("F) ante convencional morto reconhece R1900 como all-in efetivo", async () => {
  const conventionalAnteSettings = {
    ...effectiveBbaSettings,
    handdata: {
      ...effectiveBbaSettings.handdata,
      anteType: "Ante",
      anteMode: "Ante First",
    },
  };
  const node = {
    ...pushNode,
    player: 0,
    sequence: [],
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_900 }],
    hands: strategyHands([0.3, 0.7], [0, 1]),
  };

  const study = await studyFromNodes([node], conventionalAnteSettings);
  assert.equal(study.nodes[0].trainingType, "PUSH_FOLD");
  assert.equal(study.nodes[0].availableActions[1].amountBb, 19);
  assert.equal(study.nodes[0].availableActions[1].label, "All-in");
});

test("preserva Complete do SB como ação independente em RFI", async () => {
  const node = {
    ...pushNode,
    children: 4,
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 100 }, { type: "R", amount: 350 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.1, 0.2, 0.3, 0.4], [0, 1, 2, 3]),
  };
  const study = await studyFromNodes([node]);
  assert.equal(study.nodes[0].trainingType, "OPEN_FOLD");
  assert.equal(study.nodes[0].availableActions[1].label, "Complete");
  assert.equal(study.nodes[0].availableActions[1].type, "CALL");
});

test("classifica vs Open com call, 3-bet e shove", async () => {
  const node = {
    ...callNode,
    sequence: [{ player: 0, street: 0, type: "R", amount: 230 }],
    children: 4,
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 230 }, { type: "R", amount: 700 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.1, 0.2, 0.3, 0.4], [-1, 0, 1, 2]),
  };
  const study = await studyFromNodes([node]);
  assert.equal(study.nodes[0].trainingType, "VS_OPEN");
  assert.equal(study.nodes[0].availableActions.length, 4);
  assert.equal(study.nodes[0].availableActions[3].label, "All-in");
});

test("não classifica raise sobre limp como VS_OPEN", async () => {
  const limpRaiseNode = {
    ...callNode,
    sequence: [
      { player: 0, street: 0, type: "C", amount: 100 },
      { player: 0, street: 0, type: "R", amount: 350 },
    ],
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 350 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.2, 0.5, 0.3], [-1, 0, 1]),
  };
  const study = await studyFromNodes([limpRaiseNode]);
  assert.equal(study.nodes.length, 1);
  assert.equal(study.nodes[0].decisionEligible, false);
  assert.equal(study.nodes[0].trainingType, null);
  assert.equal(study.ignoredNodes.UNSUPPORTED_SEQUENCE, 1);
});

test("Hero opener enfrentando 3-bet é VS_3_BET", async () => {
  const node = {
    ...callNode,
    player: 0,
    sequence: [
      { player: 0, street: 0, type: "R", amount: 230 },
      { player: 1, street: 0, type: "R", amount: 700 },
    ],
    children: 4,
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 700 }, { type: "R", amount: 900 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.2, 0.2, 0.3, 0.3], [-1, 0, 1, 2]),
  };
  const study = await studyFromNodes([node]);
  assert.equal(study.nodes[0].trainingType, "VS_3_BET");
});

test("cold 4-bet não é confundido com VS_3_BET", async () => {
  const threeMaxSettings = { ...settings, handdata: { ...settings.handdata, stacks: [1_000, 1_000, 1_000] } };
  const node = {
    ...callNode,
    player: 2,
    sequence: [
      { player: 0, street: 0, type: "R", amount: 230 },
      { player: 1, street: 0, type: "R", amount: 700 },
    ],
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 950 }],
    hands: strategyHands([0.5, 0.5], [0, 1]),
  };
  const study = await studyFromNodes([node], threeMaxSettings);
  assert.equal(study.nodes.length, 1);
  assert.equal(study.nodes[0].decisionEligible, false);
  assert.equal(study.nodes[0].trainingType, null);
  assert.equal(study.ignoredNodes.UNSUPPORTED_SEQUENCE, 1);
});

test("Hero 3-bettor enfrentando 4-bet é VS_4_BET", async () => {
  const node = {
    ...callNode,
    player: 1,
    sequence: [
      { player: 0, street: 0, type: "R", amount: 230 },
      { player: 1, street: 0, type: "R", amount: 650 },
      { player: 0, street: 0, type: "R", amount: 850 },
    ],
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 850 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.2, 0.3, 0.5], [-1, 0, 1]),
  };
  const study = await studyFromNodes([node]);
  assert.equal(study.nodes[0].trainingType, "VS_4_BET");
});

test("vs Shove deriva do último raise all-in e preserva ações adicionais", async () => {
  const node = {
    ...callNode,
    children: 3,
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 900 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.2, 0.5, 0.3], [-1, 0, 1]),
  };
  const study = await studyFromNodes([node]);
  assert.equal(study.nodes[0].trainingType, "CALL_VS_SHOVE");
  assert.equal(study.nodes[0].availableActions.length, 3);
});

test("mixed strategy com três ações mantém frequências, EVs e IDs independentes", async () => {
  const node = {
    ...pushNode,
    children: 3,
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 230 }, { type: "R", amount: 1_000 }],
    hands: strategyHands([0.2, 0.3, 0.5], [-0.5, 0.2, 0.7]),
  };
  const study = await studyFromNodes([node]);
  const hand = study.nodes[0].hands[0];
  assert.equal(hand.isMixed, true);
  assert.deepEqual(hand.strategy, { "action-0": 0.2, "action-1": 0.3, "action-2": 0.5 });
  assert.deepEqual(hand.evs, { "action-0": -0.5, "action-1": 0.2, "action-2": 0.7 });
});

test("preserva source node não treinável e ligação action → child sem duplicar mãos", async () => {
  const parent = { ...pushNode, actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000, node: 1 }] };
  const child = { player: -1, street: 0, children: 0, sequence: [], actions: [], hands: {} };
  const study = await studyFromNodes([parent, child]);
  assert.equal(study.sourceNodes.length, 2);
  assert.equal(study.sourceNodes[0].actions[1].node, 1);
  assert.equal(study.sourceNodes[1].trainingNodeKey, null);
  assert.equal(study.sourceNodes[1].hands.length, 0, "leaf estrutural não duplica training_hands");
  assert.equal(study.nodes.length, 1);
  assert.ok(study.capabilities.some((item) => item.capability === "FULL_HAND_PREFLOP"));
});

test("Full Hand preserva estratégia mixed de node navegável que não vira pergunta de Decisão", async () => {
  const root = {
    ...pushNode,
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000, node: 1 }],
  };
  const unsupportedChild = {
    ...callNode,
    player: 1,
    sequence: [
      { type: "R", amount: 1_000, player: 0, street: 0 },
      { type: "C", amount: 500, player: 1, street: 0 },
    ],
    actions: [{ type: "F", amount: 0 }, { type: "C", amount: 500 }],
    hands: strategyHands([0.35, 0.65], [-0.2, 0.1]),
  };
  const study = await studyFromNodes([root, unsupportedChild]);
  const sourceChild = study.sourceNodes[1];
  assert.equal(sourceChild.trainingNodeKey, "1");
  assert.equal(sourceChild.hands.length, 0, "a estratégia deve ser reutilizada de training_hands");
  const fullHandOnlyNode = study.nodes.find((node) => node.nodeKey === "1")!;
  assert.equal(fullHandOnlyNode.decisionEligible, false);
  assert.deepEqual(fullHandOnlyNode.hands.find((hand) => hand.handClass === "AKo")?.strategy, {
    "action-0": 0.35,
    "action-1": 0.65,
  });
  assert.ok(study.capabilities.some((item) => item.capability === "FULL_HAND_PREFLOP"));
});

test("não concede Full Hand quando uma referência de child node não pode ser resolvida", async () => {
  const root = {
    ...pushNode,
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000, node: "nodes/missing.json" }],
  };
  const study = await studyFromNodes([root]);
  assert.ok(study.capabilities.some((item) => item.capability === "DECISION"));
  assert.ok(!study.capabilities.some((item) => item.capability === "FULL_HAND_PREFLOP"));
  const validation = study.metadata.fullHandValidation as { reasons: string[] };
  assert.ok(validation.reasons.includes("CHILD_UNRESOLVED"));
});

test("normaliza referências numéricas e paths de child nodes para a mesma identidade", () => {
  assert.equal(normalizeHrcNodeReference(123), "123");
  assert.equal(normalizeHrcNodeReference("123"), "123");
  assert.equal(normalizeHrcNodeReference("nodes/123.json"), "123");
  assert.equal(normalizeHrcNodeReference("nodes/missing.json"), "missing");
});

test("relatório contabiliza source, pré-flop, treináveis e cada descarte", async () => {
  const postflop = { ...pushNode, street: 1 };
  const structural = { player: -1, street: 0, children: 0, sequence: [], actions: [], hands: {} };
  const unsupported = {
    ...pushNode,
    sequence: [{ player: 1, street: 0, type: "C", amount: 100 }],
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 230 }],
  };
  const noEligible = {
    ...pushNode,
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 230 }],
    hands: strategyHands([0.5, 0.5], [0, 1], 0),
  };
  const partiallyEligible = replaceHand(pushNode, "22", { weight: 0.005, played: [0, 1], evs: [0, 2.5] });
  const study = await studyFromNodes([partiallyEligible, postflop, structural, unsupported, noEligible]);
  const summary = summarizeHrcStudy(study);
  assert.equal(summary.sourceNodeCount, 5);
  assert.equal(summary.preflopNodeCount, 4);
  assert.equal(summary.nodeCount, 1);
  assert.equal(summary.storedHandClassCount, 507);
  assert.equal(summary.eligibleTrainingHandClassCount, 168);
  assert.deepEqual(summary.ignoredNodes, { POSTFLOP: 1, AUTOMATIC_X: 0, UNSUPPORTED_SEQUENCE: 1, NO_ELIGIBLE_HANDS: 1, NON_TRAINABLE: 1 });
  assert.equal(summary.ignoredCount, 4);
});

test("preserva nodes estruturais de flop, turn e river com hands bucket-style", async () => {
  const bucketHands = {
    "bucket/made-hand": { combos: 24, strategy: { check: 0.35, bet: 0.65 } },
    "bucket:draw": { combos: ["AsKs", "AhKh"], equity: 0.42 },
  };
  const postflopNodes = [
    {
      player: 0,
      street: 1,
      children: 2,
      sequence: [
        { player: 0, street: 0, type: "R", amount: 250 },
        { player: 1, street: 0, type: "C", amount: 250 },
      ],
      actions: [
        { type: "C", amount: 0, node: "nodes/2.json" },
        { type: "R", amount: 300, node: 2 },
      ],
      hands: bucketHands,
    },
    {
      player: 1,
      street: 2,
      children: 2,
      sequence: [{ player: 0, street: 1, type: "C", amount: 0 }],
      actions: [
        { type: "C", amount: 0, node: "nodes/3.json" },
        { type: "R", amount: 500, node: 3 },
      ],
      hands: bucketHands,
    },
    {
      player: 0,
      street: 3,
      children: 1,
      sequence: [{ player: 1, street: 2, type: "R", amount: 500 }],
      actions: [{ type: "C", amount: 500, node: "nodes/missing.json" }],
      hands: bucketHands,
    },
  ];
  const entries: Record<string, string> = {
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
  };
  postflopNodes.forEach((node, index) => { entries[`nodes/${index + 1}.json`] = JSON.stringify(node); });

  const pack = await parseHrcPack(zipFile(entries));
  const parsedPostflop = pack.nodes.filter((node) => node.street > 0);
  assert.equal(pack.nodes.length, 4);
  assert.deepEqual(parsedPostflop.map((node) => node.street), [1, 2, 3]);
  assert.ok(parsedPostflop.every((node) => Object.keys(node.hands).length === 0));
  assert.ok(parsedPostflop.every((node) => node.eligibleHandCount === 0));

  const study = toHrcStudyImport(pack);
  const postflopSources = study.sourceNodes.filter((node) => node.street > 0);
  assert.equal(postflopSources.length, 3);
  assert.ok(postflopSources.every((node) => node.ignoredReason === "POSTFLOP"));
  assert.ok(postflopSources.every((node) => node.trainingNodeKey === null));
  assert.deepEqual(postflopSources.map((node) => node.actions[0].node), ["nodes/2.json", "nodes/3.json", "nodes/missing.json"]);
  assert.equal(study.nodes.length, 1);
  assert.equal(study.nodes[0].nodeKey, "0");
  assert.equal(study.nodes.reduce((total, node) => total + node.hands.length, 0), 169);
});

test("mantém validação estrita de hands bucket-style em node pré-flop", async () => {
  const bucketPreflop = {
    ...pushNode,
    hands: { "bucket/premium": { combos: 12, strategy: { fold: 0, shove: 1 } } },
  };
  const file = zipFile({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(bucketPreflop),
  });

  await assert.rejects(parseHrcPack(file), /Classe de mão não canônica/);
});

test("aceita árvore HRC Pro sintética com 9.700 source nodes", async () => {
  const structuralNode = JSON.stringify({ player: -1, street: 0, children: 0, sequence: [], actions: [], hands: {} });
  const entries: Record<string, string> = {
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(pushNode),
  };
  for (let index = 1; index < 9_700; index++) entries[`nodes/${index}.json`] = structuralNode;
  const pack = await parseHrcPack(zipFile(entries));
  const study = toHrcStudyImport(pack, { releaseRawHands: true });
  assert.equal(pack.nodes.length, 9_700);
  assert.equal(study.sourceNodes.length, 9_700);
  assert.equal(study.nodes.length, 1);
  assert.equal(study.ignoredNodes.NON_TRAINABLE, 9_699);
  assert.equal(Object.keys(pack.nodes[0].hands).length, 0, "o fluxo real pode liberar as mãos brutas após materializar as linhas persistíveis");
});

async function studyFromNodes(nodes: unknown[], customSettings: unknown = settings) {
  const entries: Record<string, string> = { "settings.json": JSON.stringify(customSettings) };
  nodes.forEach((node, index) => { entries[`nodes/${index}.json`] = JSON.stringify(node); });
  return toHrcStudyImport(await parseHrcPack(zipFile(entries)));
}

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
