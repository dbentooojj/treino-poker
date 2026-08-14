import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProgressExperience from "../app/progresso/progress-experience";
import { nextReplayAttempt, TrainingReportView } from "../app/training-experience";
import { TrainingDecision, TrainingTablePreview } from "../components/training/TrainingDecision";
import {
  buildTrainingPrompt,
  sequenceActionLabel,
  trainingTableSeats,
} from "../components/training/trainingPresentation";
import { positionNames } from "../lib/hrc-import";
import { buildProgressDashboard } from "../lib/progress";
import type { TrainingAction, TrainingExercise } from "../lib/training";

const fold: TrainingAction = { id: "fold", type: "FOLD" };
const call: TrainingAction = { id: "call", type: "CALL" };
const threeBet: TrainingAction = { id: "three-bet", type: "RAISE", amountBb: 6.6 };
const allIn: TrainingAction = { id: "all-in", type: "RAISE", amountBb: 20, label: "All-in" };

test("a mesa usa as mesmas posições produzidas pelo importador HRC", () => {
  for (const playersCount of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const expected = positionNames(playersCount);
    const seats = trainingTableSeats(playersCount, expected.at(-1)!);
    assert.deepEqual(seats.map((seat) => seat.position), expected);
    assert.equal(seats.length, playersCount);
  }

  const headsUp = trainingTableSeats(2, "BB");
  assert.equal(headsUp[0].position, "SB");
  assert.equal(headsUp[0].label, "BTN/SB");
  assert.equal(headsUp[0].dealer, true);
});

test("pergunta e histórico derivam posição, ação e sizing da mesma sequência", () => {
  const exercise = makeExercise(2, [fold, call, threeBet, allIn]);
  assert.equal(buildTrainingPrompt(exercise), "BTN/SB abriu 2.2 BB. Você está no BB. Qual é sua resposta?");
  assert.equal(sequenceActionLabel(exercise.actionSequence[0], 0, exercise.actionSequence), "raise 2.2 BB");

  const reraised = [
    exercise.actionSequence[0],
    { position: "BB", type: "RAISE" as const, amountBb: 6.6 },
  ];
  assert.equal(sequenceActionLabel(reraised[1], 1, reraised), "3-bet 6.6 BB");
});

test("renderiza grades de 2, 3 e 4 ações sem assumir uma combinação fixa", () => {
  const actionSets = [
    [fold, allIn],
    [fold, call, allIn],
    [fold, call, threeBet, allIn],
  ];

  for (const actions of actionSets) {
    const markup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(2, actions)} busy={false} onChoose={() => undefined}/>);
    assert.match(markup, new RegExp(`play-action-buttons actions-${actions.length}`));
    assert.equal((markup.match(/<button/g) ?? []).length, actions.length);
  }
});

test("all-in efetivo abaixo do stack nominal mantém texto e estado visual de all-in", () => {
  const effectiveAllIn: TrainingAction = { id: "effective-all-in", type: "RAISE", amountBb: 19, label: "All-in" };
  const exercise = makeExercise(8, [fold, effectiveAllIn], "SB");
  exercise.heroStackBb = 20;
  const decisionMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(decisionMarkup, /play-action-button--all_in/);
  assert.match(decisionMarkup, /<b>All-in 19 BB<\/b>/);

  exercise.actionSequence = [{ position: "SB", type: "RAISE", amountBb: 19, label: "All-in" }];
  const replayMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} replayFromStart onChoose={() => undefined}/>);
  assert.match(replayMarkup, /play-action-tag--all_in/);
  assert.match(replayMarkup, /all-in 19 BB/);
});

test("Desde o início reproduz actionSequence antes da mesma decisão", async () => {
  const exercise = makeExercise(6, [fold, call], "BB");
  exercise.actionSequence = [
    { position: "UTG", type: "FOLD" },
    { position: "HJ", type: "FOLD" },
    { position: "BTN", type: "RAISE", amountBb: 2.3 },
    { position: "SB", type: "FOLD" },
  ];
  const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} replayFromStart onChoose={() => undefined}/>);
  assert.match(markup, /DESDE O INÍCIO/);
  assert.match(markup, /UTG fold/);
  assert.match(markup, /play-seat--folded[^>]*data-position="UTG"/);
  assert.doesNotMatch(markup, /play-action-buttons/);
  const [trainer, schema] = await Promise.all([
    readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(trainer, /presentationMode === "FROM_START"/);
  assert.match(trainer, /replayFromStart=/);
  assert.match(schema, /presentationMode: trainingPresentationMode/);
  assert.doesNotMatch(schema, /training_type[^\n]*FROM_START/);
});

test("Repetir spot cria uma nova tentativa e reinicia o replay FROM_START", async () => {
  assert.equal(nextReplayAttempt(0, "FROM_START"), 1);
  assert.equal(nextReplayAttempt(1, "FROM_START"), 2);
  assert.equal(nextReplayAttempt(0, "DECISION"), 0);

  const trainer = await readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8");
  assert.match(trainer, /setReplayAttempt\(\(current\) => nextReplayAttempt\(current, session\.config\.presentationMode\)\)/);
  assert.match(trainer, /key=\{`\$\{exercise\.trainingHandId\}:\$\{session\.config\.presentationMode \?\? "DECISION"\}:\$\{replayAttempt\}`\}/);
});

test("Visualizar distingue classes armazenadas das elegíveis para treino", async () => {
  const admin = await readFile(new URL("../app/admin/studies/studies-experience.tsx", import.meta.url), "utf8");
  assert.match(admin, /Classes de mão armazenadas/);
  assert.match(admin, /Classes elegíveis para treino/);
  assert.match(admin, /classes armazenadas/);
  assert.match(admin, /elegíveis para treino/);
  assert.doesNotMatch(admin, /<dt>Mãos<\/dt>/);
});

test("renderiza a quantidade correta de seats em heads-up, 6-max e 9-max", () => {
  for (const playersCount of [2, 6, 9]) {
    const heroPosition = positionNames(playersCount).at(-1)!;
    const markup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(playersCount, [fold, allIn], heroPosition)} busy={false} onChoose={() => undefined}/>);
    const visibleSeats = playersCount === 9 ? 8 : playersCount;
    assert.match(markup, new RegExp(`data-seat-count="${visibleSeats}"`));
    assert.equal((markup.match(/data-position=/g) ?? []).length, visibleSeats);
    assert.match(markup, /style="--table-seat-x:50%;--table-seat-y:100%" class="play-seat play-seat-1 play-seat--hero/);
  }
});

test("mesa de spot gira qualquer posição do Hero para o centro inferior com as cartas ao lado", () => {
  const positions = positionNames(9);
  for (const heroPosition of ["UTG", "CO", "BTN", "BB"]) {
    const exercise = makeExercise(9, [fold, call], heroPosition);
    exercise.handClass = "A6s";
    const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
    const heroSeat = markup.match(new RegExp(`<div style="--table-seat-x:50%;--table-seat-y:100%" class="play-seat play-seat-1 play-seat--hero[^>]*data-position="${heroPosition}"[\\s\\S]*?<div class="play-player-box">`))?.[0] ?? "";
    assert.match(heroSeat, new RegExp(`data-position="${heroPosition}"`));
    assert.match(heroSeat, /play-hole-cards/);
    assert.match(heroSeat, /play-card-rank">A</);
    assert.match(heroSeat, /play-card-rank">6</);
  }
  assert.equal(positions.length, 9);
});

test("sinaliza limites de memória sem rotular a amostra como histórico completo", () => {
  const data = buildProgressDashboard([], [], Date.UTC(2026, 7, 9), {
    sessionsReturned: 1_000,
    answersReturned: 10_000,
    sessionLimit: 1_000,
    answerLimit: 10_000,
    sessionsTruncated: true,
    answersTruncated: true,
  });
  const markup = renderToStaticMarkup(<ProgressExperience data={data}/>);
  assert.match(markup, /Janela recente limitada a/);
  assert.match(markup, /Mãos na janela/);
  assert.match(markup, />Janela<\/button>/);
  assert.doesNotMatch(markup, />Todos<\/button>/);
});

test("relatório diferencia totais completos de detalhes recentes limitados", () => {
  const markup = renderToStaticMarkup(<TrainingReportView report={{
    sessionId: "session",
    detailsAvailable: true,
    detailsTruncated: true,
    detailAnswers: 1_000,
    completionReason: "USER_FINISHED",
    trainingType: "PUSH_FOLD",
    equityModel: "CHIP_EV",
    stackDepthBb: 10,
    heroPosition: "BTN",
    targetQuestions: null,
    answeredQuestions: 1_001,
    correctAnswers: 999,
    errors: 2,
    accuracy: 100,
    evDelta: -0.25,
    evUnit: "BIG_BLINDS",
    durationSeconds: 1_001,
    averageSeconds: 1,
    byPosition: [],
    byDecisionType: [],
    mostMissedHands: [],
    errorDetails: [],
    decisionDetails: [],
    feedback: [],
  }} onExit={() => undefined} onStarted={() => undefined}/>);
  assert.match(markup, /Os totais cobrem a sessão completa/);
  assert.match(markup, /Revisar erros/);
  assert.match(markup, /Resultado do treino/);
  assert.doesNotMatch(markup, /ANÁLISE COMPLETA DA SESSÃO/);
});

test("drill avança sem revelar a solução e concentra a análise no relatório", async () => {
  const trainerSource = await readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(trainerSource, /import \{ TrainingFeedback \}/);
  assert.match(trainerSource, /setFeedback\(\{ answer: data\.answer/);
  assert.match(trainerSource, /setExercise\(feedback\.nextExercise\)/);
  assert.match(trainerSource, /Mapa de EV das mãos/);
  assert.match(trainerSource, /RangeMatrix/);
  assert.match(trainerSource, /report-spot-strip/);
  assert.match(trainerSource, /reportSpotSequence/);
  assert.doesNotMatch(trainerSource, /Ver análises adicionais/);

  const rangeSource = await readFile(new URL("../components/training/RangeMatrix.tsx", import.meta.url), "utf8");
  assert.match(rangeSource, /EV positivo/);
  assert.match(rangeSource, /EV neutro/);
  assert.match(rangeSource, /EV negativo/);
  assert.match(rangeSource, /rangeCellColor\(bestEv\)/);

  const decisionMarkup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(2, [fold, call])} busy={false} onChoose={() => undefined}/>);
  assert.match(decisionMarkup, /unified-training-table/);
  assert.match(decisionMarkup, /play-hole-cards/);
  assert.match(decisionMarkup, /play-card--dealt/);
  assert.match(decisionMarkup, /play-action-panel play-action-panel--hero/);
  assert.doesNotMatch(decisionMarkup, /play-chip-display|play-pot|play-bet-zone/);
  assert.doesNotMatch(decisionMarkup, /rl-training-sidebar/);
  assert.doesNotMatch(decisionMarkup, /RESULTADO DO SPOT/);
  assert.doesNotMatch(decisionMarkup, /FREQUÊNCIA DO SOLVER/);

  const feedbackMarkup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(2, [fold, call])} busy={false} feedback={{ answer: { correct: false, selectedKey: "fold", bestKey: "call", bestLabel: "Call", strategy: { fold: 0, call: 1 }, evs: { fold: 0, call: 1 }, decisionClarity: 1, isMixed: false }, selectedKey: "fold" }} onChoose={() => undefined} onRepeat={() => undefined} onNext={() => undefined}/>);
  assert.match(feedbackMarkup, /RESULTADO DO SPOT/);
  assert.match(feedbackMarkup, /data-tone="review"/);
  assert.match(feedbackMarkup, /REVISAR DECISÃO/);
  assert.match(feedbackMarkup, /Repetir spot/);
  assert.match(feedbackMarkup, /Próximo spot/);
});

test("spots e mão completa usam os mesmos componentes visuais", async () => {
  const [spot, table, action, result, styles] = await Promise.all([
    readFile(new URL("../components/training/TrainingDecision.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/PokerTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/ActionPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/HandResult.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const shared of ["UnifiedPokerTable", "UnifiedActionPanel", "UnifiedResultPanel"]) assert.match(spot, new RegExp(shared));
  assert.match(table, /UnifiedPokerTable/);
  assert.match(action, /UnifiedActionPanel/);
  assert.match(result, /UnifiedResultPanel/);
  assert.doesNotMatch(spot, /<div className="play-table-rail"|<div className="play-player-box"/);
  assert.match(styles, /\.play-action-button:hover:not\(:disabled\)[^{]*\{[^}]*filter:brightness\(1\.1\) saturate\(1\.06\)/);
  assert.doesNotMatch(styles, /\.play-action-button:hover(?:not\(:disabled\))?[^\{]*\{[^}]*(?:background|background-color):/);
  assert.match(styles, /\.report-decision-browser>div[^\{]*\{[^}]*overflow-y:scroll/);
});

test("treinar mantém mão completa indisponível sem cenários demonstrativos", async () => {
  const [header, appHeader, legacyPlay, workspace, trainer, playTrainer] = await Promise.all([
    readFile(new URL("../app/member-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/AppHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jogar/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/treinar/training-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/PlayTrainer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(header, /<AppHeader/);
  assert.match(appHeader, /href: "\/treinar", label: "Treinar"/);
  assert.match(legacyPlay, /redirect\("\/treinar"\)/);
  assert.doesNotMatch(workspace, /PlayTrainer|fullHandScenarios|MOCK_HANDS|cenários demonstrativos/);
  assert.doesNotMatch(workspace, /Novo drill|ÁREA DE TREINO/);
  assert.doesNotMatch(workspace, /if \(session\) return <DatabaseTrainer/);
  assert.match(workspace, /session \? <DatabaseTrainer/);
  assert.doesNotMatch(playTrainer, /router\.(push|replace)|window\.location|rangelab-play-lock/);
  assert.match(playTrainer, /scenarios: readonly PlayableHandScenario\[\]/);
  assert.doesNotMatch(playTrainer, /MOCK_HANDS|MTT · ChipEV/);
  assert.match(trainer, /className="inline-training-session"/);
  assert.match(trainer, /className="spot-session-sidebar"/);
  for (const label of ["Sessão atual", "Progresso", "Acerto", "Corretas", "Erros", "Tempo de treino"]) assert.match(trainer, new RegExp(label));
  assert.doesNotMatch(trainer, /EV do treino/);
  assert.doesNotMatch(trainer, /className="spot-session-toolbar"/);
  assert.doesNotMatch(trainer, /training-screen training-screen-redesigned/);
  for (const label of ["Modelo", "Modo de treino", "Decisão", "Mão completa", "Ação pré-flop", "Qualquer", "Todas as configurações", "Iniciar treino"]) assert.match(trainer, new RegExp(label));
  assert.doesNotMatch(trainer, /Mão completa · Em desenvolvimento/);
  for (const removed of ["Solutions", "Starting spot", "Preflop action", "All settings", "Start training", "From start"]) assert.doesNotMatch(trainer, new RegExp(removed));
  assert.match(trainer, /options\.trainingTypes\.length > 0/);
  assert.match(trainer, /trainingType: filters\.trainingType \?\? null/);
  assert.match(trainer, /Todos os spots/);
});

test("prévia da mesa renderiza somente o contexto recebido de um estudo real", () => {
  const markup = renderToStaticMarkup(<TrainingTablePreview context={{
    trainingSetId: "set-real",
    studyName: "HRC 6-max 20 BB",
    gameType: "TOURNAMENT",
    equityModel: "CHIP_EV",
    playersCount: 6,
    heroStackBb: 20,
    heroPosition: "CO",
    actionSequence: [{ position: "UTG", type: "FOLD" }],
  }}/>);
  assert.match(markup, /data-seat-count="6"/);
  assert.match(markup, /Prévia real de HRC 6-max 20 BB/);
  assert.match(markup, /data-position="CO" data-hero="true"/);
  assert.doesNotMatch(markup, /40 BB/);

  const empty = renderToStaticMarkup(<TrainingTablePreview context={null}/>);
  assert.match(empty, /Nenhum estudo disponível/);
  assert.match(empty, /Importe e publique um estudo/);
  assert.equal((empty.match(/data-position=/g) ?? []).length, 0);
});

test("prévia 9-max omite UTG+2 e usa a geometria visual de oito assentos", () => {
  const markup = renderToStaticMarkup(<TrainingTablePreview context={{
    trainingSetId: "set-9-max",
    studyName: "HRC 9-max 20 BB",
    gameType: "TOURNAMENT",
    equityModel: "CHIP_EV",
    playersCount: 9,
    heroStackBb: 20,
    heroPosition: "CO",
    actionSequence: [],
  }}/>);
  assert.match(markup, /data-seat-count="8"/);
  assert.equal((markup.match(/data-position=/g) ?? []).length, 8);
  assert.doesNotMatch(markup, /data-position="UTG\+2"/);
  for (const position of ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"]) {
    assert.match(markup, new RegExp(`data-position="${position.replace("+", "\\+")}"`));
  }

  const activeMarkup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(9, [fold, call], "CO")} busy={false} onChoose={() => undefined}/>);
  assert.match(activeMarkup, /data-seat-count="8"/);
  assert.doesNotMatch(activeMarkup, /data-position="UTG\+2"/);
});

function makeExercise(playersCount: number, availableActions: TrainingAction[], heroPosition = "BB"): TrainingExercise {
  return {
    trainingSetId: "set",
    trainingNodeId: "node",
    trainingHandId: "hand",
    setName: "Test",
    handClass: "88",
    trainingType: "VS_OPEN",
    equityModel: "CHIP_EV",
    evUnit: "UNKNOWN",
    playersCount,
    heroStackBb: 20,
    heroPosition,
    villainPosition: playersCount === 2 ? "SB" : "BTN",
    blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0, anteType: "NONE" },
    actionSequence: [{ position: playersCount === 2 ? "SB" : "BTN", type: "RAISE", amountBb: 2.2 }],
    availableActions,
  };
}
