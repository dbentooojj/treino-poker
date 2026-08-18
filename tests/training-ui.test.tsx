import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProgressExperience from "../app/progresso/progress-experience";
import { nextReplayAttempt, TrainingActionPicker, TrainingReportView } from "../app/training-experience";
import { TrainingDecision, TrainingTablePreview } from "../components/training/TrainingDecision";
import { mobileTableBetCoordinate, mobileTableSeatCoordinates } from "../components/training/UnifiedPokerTable";
import {
  buildTrainingPrompt,
  deriveTrainingTableVisualState,
  sequenceActionLabel,
  trainingTableSeats,
} from "../components/training/trainingPresentation";
import { positionNames } from "../lib/hrc-import";
import { buildProgressDashboard } from "../lib/progress";
import { trainingPresentationModeFromView, trainingViewModeFromPresentation, type TrainingAction, type TrainingExercise, type TrainingOptions } from "../lib/training";

const fold: TrainingAction = { id: "fold", type: "FOLD" };
const call: TrainingAction = { id: "call", type: "CALL" };
const minRaise: TrainingAction = { id: "min-raise", type: "RAISE", amountBb: 4.4 };
const threeBet: TrainingAction = { id: "three-bet", type: "RAISE", amountBb: 6.6 };
const largeRaise: TrainingAction = { id: "large-raise", type: "RAISE", amountBb: 12 };
const allIn: TrainingAction = { id: "all-in", type: "RAISE", amountBb: 20, label: "All-in" };

test("ações rápidas usam counts contextuais sem expor os números ao usuário", () => {
  const options: TrainingOptions = {
    trainingTypes: ["CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN", "VS_3_BET"],
    trainingTypeCounts: { PUSH_FOLD: 0, CALL_VS_SHOVE: 1, OPEN_FOLD: 1, VS_OPEN: 1, VS_3_BET: 2, VS_4_BET: 0 },
    totalTrainingNodes: 5,
    equityModels: ["CHIP_EV"],
    stackDepthsBb: [15],
    heroPositions: ["HJ"],
    hasMatches: true,
    tableContext: null,
    fullHandStages: [],
  };
  const markup = renderToStaticMarkup(<TrainingActionPicker options={options} filters={{ equityModel: "CHIP_EV", stackDepthBb: 15, heroPosition: "HJ" }} onChange={() => undefined}/>);
  assert.match(markup, />Qualquer<\/button>/);
  assert.match(markup, />vs 3-bet<\/button>/);
  assert.match(markup, /<button type="button" disabled="" title="Nenhum training node disponível para os filtros atuais" class="">vs 4-bet<\/button>/);
  assert.match(markup, /<button type="button" disabled="" title="Nenhum training node disponível para os filtros atuais" class="">Push \/ Fold<\/button>/);
  assert.doesNotMatch(markup, / · \d+/);
});

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

  assert.deepEqual(trainingTableSeats(8, "BB").map((seat) => seat.label), ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
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

test("renderiza grades de 2 a 6 ações sem assumir uma combinação fixa", () => {
  const actionSets = [
    [fold, allIn],
    [fold, call, allIn],
    [fold, call, threeBet, allIn],
    [fold, call, minRaise, threeBet, allIn],
    [fold, call, minRaise, threeBet, largeRaise, allIn],
  ];

  for (const actions of actionSets) {
    const markup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(2, actions)} busy={false} onChoose={() => undefined}/>);
    assert.match(markup, new RegExp(`play-action-buttons actions-${actions.length} is-active`));
    assert.match(markup, new RegExp(`data-action-count="${actions.length}"`));
    assert.equal((markup.match(/<button/g) ?? []).length, actions.length);
  }
});

test("geometria mobile distribui os assentos no oval e mantém o Hero embaixo", () => {
  for (const playersCount of [2, 3, 4, 6, 8, 10]) {
    const coordinates = mobileTableSeatCoordinates(playersCount);
    assert.equal(coordinates.length, playersCount);
    assert.deepEqual(coordinates[0], [50, 100]);
    for (const [x, y] of coordinates) {
      assert.ok(x >= 0 && x <= 100);
      assert.ok(y >= 0 && y <= 100);
    }
    assert.equal(new Set(coordinates.map(([x, y]) => `${x}:${y}`)).size, playersCount);
  }
});

test("fichas mobile ficam próximas ao assento e liberam as cartas do Hero", () => {
  const seat = mobileTableSeatCoordinates(8)[0];
  const bet = mobileTableBetCoordinate(seat);
  assert.ok(bet[0] > seat[0]);
  assert.ok(bet[1] < seat[1]);
  assert.ok(Math.hypot(bet[0] - 50, bet[1] - 50) < Math.hypot(seat[0] - 50, seat[1] - 50));
});

test("mesa mobile mantém dez assentos dentro da tela entre 320 e 430px", () => {
  const coordinates = mobileTableSeatCoordinates(10);
  for (const viewportWidth of [320, 360, 375, 390, 412, 430]) {
    const frameWidth = Math.min(viewportWidth - 60, 360);
    const frameLeft = (viewportWidth - frameWidth) / 2;
    const feltLeft = frameLeft + frameWidth * .1;
    const feltWidth = frameWidth * .8;
    const frameHeight = 170;
    const feltTop = frameHeight * .07;
    const feltHeight = frameHeight * .85;
    const centers = coordinates.map(([x, y]) => [feltLeft + feltWidth * x / 100, feltTop + feltHeight * y / 100] as const);
    for (const [x] of centers) assert.ok(x - 20 >= 0 && x + 20 <= viewportWidth);
    for (let index = 0; index < centers.length; index += 1) {
      const [x1, y1] = centers[index];
      const [x2, y2] = centers[(index + 1) % centers.length];
      assert.ok(Math.hypot(x2 - x1, y2 - y1) >= 40);
    }
  }
});

test("mantém a ação anterior horizontal e afastada das bordas no mobile", async () => {
  const exercise = makeExercise(8, [fold, call, minRaise, threeBet, largeRaise, allIn], "SB");
  exercise.actionSequence = [{ position: "BTN", type: "RAISE", amountBb: 20, label: "All-in" }];
  const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(markup, /data-position="BTN"[^>]*data-last-action="ALL_IN"[^>]*data-table-region="bottom"/);
  assert.doesNotMatch(markup, /play-action-tag/);
  assert.match(styles, /\.play-action-tag\s*\{[^}]*width:max-content;[^}]*white-space:nowrap;/);
  assert.match(styles, /\.spot-poker-table \.play-seat\[data-table-region="right"\] \.play-action-tag\s*\{/);
  assert.doesNotMatch(styles, /\.spot-poker-table \.play-action-tag\s*\{[^}]*overflow-wrap:anywhere;/);
  for (const count of [2, 3, 4, 5, 6]) {
    assert.match(styles, new RegExp(`\\.play-action-buttons\\.actions-${count}\\.is-active`));
  }
});

test("all-in efetivo abaixo do stack nominal mantém texto e estado visual de all-in", () => {
  const effectiveAllIn: TrainingAction = { id: "effective-all-in", type: "RAISE", amountBb: 19, label: "All-in" };
  const exercise = makeExercise(8, [fold, effectiveAllIn], "SB");
  exercise.heroStackBb = 20;
  const decisionMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(decisionMarkup, /play-action-button--all_in/);
  assert.match(decisionMarkup, /<b>All-in 19 BB<\/b>/);

  exercise.actionSequence = [{ position: "BB", type: "RAISE", amountBb: 19, label: "All-in" }];
  const tableMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(tableMarkup, /data-position="BB"[^>]*data-last-action="ALL_IN"/);
  assert.doesNotMatch(tableMarkup, /play-action-tag/);
  assert.match(tableMarkup, /aria-label="19 big blinds"/);
});

test("decisão rápida monta o spot imediatamente e o replay fica em um modo separado", async () => {
  const exercise = makeExercise(6, [fold, call], "BB");
  exercise.actionSequence = [
    { position: "UTG", type: "FOLD" },
    { position: "HJ", type: "FOLD" },
    { position: "BTN", type: "RAISE", amountBb: 2.3 },
    { position: "SB", type: "FOLD" },
  ];
  const quickMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(quickMarkup, /data-training-view-mode="quick-decision"/);
  assert.match(quickMarkup, /data-position="UTG"[^>]*play-seat--folded|play-seat--folded[^>]*data-position="UTG"/);
  assert.match(quickMarkup, /play-action-buttons/);
  assert.doesNotMatch(quickMarkup, /DESDE O INÍCIO/);

  const replayMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} viewMode="full-hand" onChoose={() => undefined}/>);
  assert.match(replayMarkup, /data-training-view-mode="full-hand"/);
  assert.match(replayMarkup, /DESDE O INÍCIO/);
  assert.match(replayMarkup, /UTG fold/);
  assert.doesNotMatch(replayMarkup, /play-action-buttons/);
  const [trainer, schema] = await Promise.all([
    readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(trainer, /trainingViewModeFromPresentation\(session\.config\.presentationMode\)/);
  assert.match(trainer, /viewMode=\{viewMode\}/);
  assert.doesNotMatch(trainer, /replayFromStart|Desde o início/);
  assert.match(schema, /presentationMode: trainingPresentationMode/);
  assert.doesNotMatch(schema, /training_type[^\n]*FROM_START/);
});

test("os modos de UI preservam compatibilidade com o contrato persistido", async () => {
  assert.equal(trainingViewModeFromPresentation("DECISION"), "quick-decision");
  assert.equal(trainingViewModeFromPresentation("FROM_START"), "full-hand");
  assert.equal(trainingPresentationModeFromView("quick-decision"), "DECISION");
  assert.equal(trainingPresentationModeFromView("full-hand"), "FROM_START");
  assert.equal(nextReplayAttempt(0, "full-hand"), 1);
  assert.equal(nextReplayAttempt(1, "full-hand"), 2);
  assert.equal(nextReplayAttempt(0, "quick-decision"), 0);

  const trainer = await readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8");
  assert.match(trainer, /setReplayAttempt\(\(current\) => nextReplayAttempt\(current, viewMode\)\)/);
  assert.match(trainer, /key=\{`\$\{exercise\.trainingHandId\}:\$\{viewMode\}:\$\{replayAttempt\}`\}/);
  assert.doesNotMatch(trainer, /\{ id: "FROM_START", label: "Desde o início" \}/);
});

test("estado visual centralizado representa folds, cartas, ações, blinds e fichas do spot", () => {
  const exercise = makeExercise(8, [fold, call], "SB");
  exercise.heroStackBb = 20;
  exercise.handClass = "K8s";
  exercise.villainPosition = "BB";
  exercise.actionSequence = [
    { position: "UTG", type: "FOLD" },
    { position: "UTG+1", type: "FOLD" },
    { position: "LJ", type: "FOLD" },
    { position: "HJ", type: "FOLD" },
    { position: "CO", type: "FOLD" },
    { position: "BTN", type: "FOLD" },
    { position: "BB", type: "RAISE", amountBb: 19, label: "All-in" },
  ];

  const tableState = deriveTrainingTableVisualState(exercise, "quick-decision", 0);
  const bb = tableState.seats.find((seat) => seat.position === "BB")!;
  const hero = tableState.seats.find((seat) => seat.position === "SB")!;
  const utg = tableState.seats.find((seat) => seat.position === "UTG")!;
  assert.equal(tableState.potBb, 19.5);
  assert.deepEqual({ folded: utg.isFolded, cards: utg.hasCards, action: utg.lastAction }, { folded: true, cards: false, action: "FOLD" });
  assert.deepEqual({ folded: bb.isFolded, cards: bb.hasCards, faceUp: bb.cardsFaceUp, committed: bb.committedBb, action: bb.lastAction }, { folded: false, cards: true, faceUp: false, committed: 19, action: "ALL_IN" });
  assert.deepEqual({ hero: hero.isHero, faceUp: hero.cardsFaceUp, stack: hero.stackBb, committed: hero.committedBb, acting: hero.isActing }, { hero: true, faceUp: true, stack: 20, committed: .5, acting: true });

  const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.doesNotMatch(markup, /play-action-tag/);
  assert.equal((markup.match(/aria-label="Carta virada para baixo"/g) ?? []).length, 2);
  assert.match(markup, /aria-label="19 big blinds"/);
  assert.match(markup, /aria-label="0.5 big blinds"/);
  assert.match(markup, /POTE/);
  assert.doesNotMatch(markup, /Stack indisponível|play-card--dealt|DESDE O INÍCIO/);
});

test("BB ante permanece no pote central e não duplica as fichas exibidas no big blind", () => {
  const exercise = makeExercise(8, [fold, call], "SB");
  exercise.blinds = { smallBlind: 0.5, bigBlind: 1, ante: 1, anteType: "BB Ante" };
  exercise.actionSequence = [{ position: "CO", type: "RAISE", amountBb: 20, label: "All-in" }];

  const tableState = deriveTrainingTableVisualState(exercise, "quick-decision");
  const bb = tableState.seats.find((seat) => seat.position === "BB")!;
  assert.equal(bb.committedBb, 1);
  assert.equal(tableState.potBb, 22.5);

  const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(markup, /data-position="BB"[^>]*data-committed-bb="1"/);
  assert.doesNotMatch(markup, /data-position="BB"[^>]*data-committed-bb="2"/);
  assert.match(markup, /aria-label="22.5 big blinds"/);
});

test("call importado do HRC converte o valor bruto em fichas comprometidas", () => {
  const exercise = makeExercise(6, [fold, call], "BB");
  exercise.blinds = { smallBlind: 50, bigBlind: 100, ante: 0, anteType: "NONE" };
  exercise.actionSequence = [
    { position: "UTG", type: "RAISE", amountBb: 2.5 },
    { position: "HJ", type: "CALL", metadata: { hrcAmount: 250 } },
  ];
  const tableState = deriveTrainingTableVisualState(exercise, "quick-decision");
  const caller = tableState.seats.find((seat) => seat.position === "HJ")!;
  assert.equal(caller.committedBb, 2.5);
  assert.equal(caller.lastAction, "CALL");
  assert.equal(tableState.potBb, 6.5);

  const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(markup, /data-position="HJ"[^>]*data-last-action="CALL"/);
  assert.doesNotMatch(markup, /play-action-tag/);
  assert.match(markup, /aria-label="2.5 big blinds"/);
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
    assert.match(markup, /style="--table-seat-x:50%;--table-seat-y:100%;--mobile-table-seat-x:50%;--mobile-table-seat-y:100%" class="play-seat play-seat-1 play-seat--hero/);
  }
});

test("mesa de spot gira qualquer posição do Hero para o centro inferior com as cartas ao lado", () => {
  const positions = positionNames(9);
  for (const heroPosition of ["UTG", "CO", "BTN", "BB"]) {
    const exercise = makeExercise(9, [fold, call], heroPosition);
    exercise.handClass = "A6s";
    const markup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
    const heroSeat = markup.match(new RegExp(`<div style="--table-seat-x:50%;--table-seat-y:100%;--mobile-table-seat-x:50%;--mobile-table-seat-y:100%" class="play-seat play-seat-1 play-seat--hero[^>]*data-position="${heroPosition}"[\\s\\S]*?<div class="play-player-box">`))?.[0] ?? "";
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
    presentationMode: "DECISION",
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
  assert.match(decisionMarkup, /play-card--back/);
  assert.doesNotMatch(decisionMarkup, /play-card--dealt/);
  assert.match(decisionMarkup, /play-action-panel play-action-panel--hero/);
  assert.match(decisionMarkup, /class="spot-action-history"/);
  assert.match(decisionMarkup, /aria-current="step">Sua vez/);
  assert.match(decisionMarkup, /play-chip-display/);
  assert.match(decisionMarkup, /class="play-pot"/);
  assert.match(decisionMarkup, /play-bet-zone/);
  assert.doesNotMatch(decisionMarkup, /rl-training-sidebar/);
  assert.doesNotMatch(decisionMarkup, /RESULTADO DO SPOT/);
  assert.doesNotMatch(decisionMarkup, /FREQUÊNCIA DO SOLVER/);

  const feedbackMarkup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(2, [fold, call])} busy={false} feedback={{ answer: { correct: false, selectedKey: "fold", bestKey: "call", bestLabel: "Call", strategy: { fold: 0, call: 1 }, evs: { fold: 0, call: 1 }, decisionClarity: 1, isMixed: false }, selectedKey: "fold" }} onChoose={() => undefined} onRepeat={() => undefined} onNext={() => undefined}/>);
  assert.match(feedbackMarkup, /RESULTADO DO SPOT/);
  assert.match(feedbackMarkup, /data-tone="wrong"/);
  assert.match(feedbackMarkup, /JOGADA ERRADA/);
  assert.match(feedbackMarkup, /Repetir spot/);
  assert.match(feedbackMarkup, /Próximo spot/);
  assert.match(feedbackMarkup, /data-feedback="true"/);
  assert.match(feedbackMarkup, /aria-current="step">Resultado/);
});

test("feedback mobile apresenta frequências reais quando a estratégia é mista", () => {
  const markup = renderToStaticMarkup(<TrainingDecision
    exercise={makeExercise(2, [fold, call])}
    busy={false}
    feedback={{ answer: { correct: true, selectedKey: "call", bestKey: "call", bestLabel: "Call", strategy: { fold: .28, call: .72 }, evs: { fold: 0, call: 1 }, decisionClarity: 1, isMixed: true }, selectedKey: "call" }}
    onChoose={() => undefined}
    onRepeat={() => undefined}
    onNext={() => undefined}
  />);
  assert.match(markup, /ESTRATÉGIA MISTA/);
  assert.match(markup, /MELHOR JOGADA/);
  assert.match(markup, /Frequência GTO/);
  assert.match(markup, /class="spot-selected-choice"/);
  assert.match(markup, /<span>Escolha<\/span><b>Call<\/b><strong>72% GTO<\/strong>/);
  assert.doesNotMatch(markup, /spot-strategy-breakdown/);
  assert.doesNotMatch(markup, /<b>Fold<\/b>/);
  assert.doesNotMatch(markup, /<span>Pré-flop<\/span>/);
});

test("feedback distingue ação correta do mix da ação mais frequente", () => {
  const markup = renderToStaticMarkup(<TrainingDecision
    exercise={makeExercise(2, [fold, call])}
    busy={false}
    feedback={{ answer: { correct: true, selectedKey: "fold", bestKey: "call", bestLabel: "Call", strategy: { fold: .28, call: .72 }, evs: { fold: .98, call: 1 }, decisionClarity: 1, isMixed: true }, selectedKey: "fold" }}
    onChoose={() => undefined}
    onRepeat={() => undefined}
    onNext={() => undefined}
  />);
  assert.match(markup, /data-tone="correct"/);
  assert.match(markup, />✓<\/i>/);
  assert.match(markup, /JOGADA CORRETA/);
  assert.match(markup, /−0,02/);
});

test("feedback usa o maior EV como melhor jogada mesmo quando outro raise é mais frequente", () => {
  const exercise = makeExercise(2, [fold, call, threeBet, allIn]);
  const markup = renderToStaticMarkup(<TrainingDecision
    exercise={exercise}
    busy={false}
    feedback={{ answer: { correct: true, selectedKey: "three-bet", bestKey: "call", bestLabel: "Call", strategy: { fold: 0, call: .314, "three-bet": .074, "all-in": .612 }, evs: { fold: 0, call: 1.3696, "three-bet": 1.3373, "all-in": 1.3453 }, decisionClarity: .0243, isMixed: true }, selectedKey: "three-bet" }}
    onChoose={() => undefined}
    onRepeat={() => undefined}
    onNext={() => undefined}
  />);
  assert.match(markup, /JOGADA CORRETA/);
  assert.match(markup, /All-in 20 BB aparece com mais frequência/);
  assert.doesNotMatch(markup, /MELHOR JOGADA/);
});

test("feedback mostra countdown acessível e progresso no mesmo botão de próximo spot", () => {
  const markup = renderToStaticMarkup(<TrainingDecision
    exercise={makeExercise(2, [fold, call])}
    busy={false}
    feedback={{ answer: { correct: true, selectedKey: "call", bestKey: "call", bestLabel: "Call", strategy: { fold: 0, call: 1 }, evs: { fold: 0, call: 1 }, decisionClarity: 1, isMixed: false }, selectedKey: "call" }}
    nextLabel="Próximo spot"
    nextCompactLabel="Próximo"
    nextCountdown={4}
    nextAutoAdvanceActive
    nextAriaLabel="Próximo spot automaticamente em 4 segundos"
    onChoose={() => undefined}
    onRepeat={() => undefined}
    onNext={() => undefined}
    onFeedbackInteraction={() => undefined}
  />);
  assert.match(markup, /aria-label="Próximo spot automaticamente em 4 segundos"/);
  assert.match(markup, /Próximo spot<\/span><span class="play-next-hand__label-compact"/);
  assert.match(markup, /play-next-hand__countdown[^>]*> · 4/);
  assert.match(markup, /play-next-hand__progress/);
});

test("controlador do treino persiste a preferência e limpa o timer em todos os desvios", async () => {
  const source = await readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8");
  assert.match(source, /rangelab:training:auto-advance/);
  assert.match(source, /feedback\.report/);
  assert.match(source, /stopAutoAdvance\(\)/);
  assert.match(source, /onFeedbackInteraction=\{pauseAutoAdvance\}/);
  assert.match(source, /nextDisabled=\{busy \|\| advancing\}/);
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

test("treinar oferece mão completa somente por estudos compatíveis, sem cenários demonstrativos", async () => {
  const [header, appHeader, legacyPlay, workspace, trainer, playTrainer, styles] = await Promise.all([
    readFile(new URL("../app/member-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/AppHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jogar/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/treinar/training-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/play/PlayTrainer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
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
  assert.match(trainer, /<progress value=\{session\.targetQuestions/);
  for (const label of ["Sessão atual", "Progresso", "Acerto", "Corretas", "Erros", "Tempo de treino"]) assert.match(trainer, new RegExp(label));
  assert.doesNotMatch(trainer, /EV do treino/);
  assert.doesNotMatch(trainer, /className="spot-session-toolbar"/);
  assert.doesNotMatch(trainer, /training-screen training-screen-redesigned/);
  for (const label of ["Modelo", "Modo de treino", "Decisão", "Mão completa", "Ação", "Estudo", "Qualquer", "Todas as configurações", "Iniciar treino"]) assert.match(trainer, new RegExp(label));
  assert.match(trainer, /selectedFullHandStage\.label/);
  assert.doesNotMatch(trainer, /Mão completa · Em desenvolvimento/);
  assert.doesNotMatch(trainer, /value: "full-hand", label: "Mão completa", disabled: true/);
  assert.match(trainer, /Nenhum estudo de mão completa disponível/);
  assert.match(trainer, /options\.fullHandStages\[0\]/);
  assert.doesNotMatch(trainer, /\{viewMode === "quick-decision" && <div className="quick-setup-group quick-solution">/);
  assert.match(trainer, /equityModelLabels\[selectedFullHandStage\.equityModel\]/);
  for (const removed of ["Solutions", "Starting spot", "Preflop action", "All settings", "Start training", "From start"]) assert.doesNotMatch(trainer, new RegExp(removed));
  assert.match(trainer, /options\.totalTrainingNodes/);
  assert.match(trainer, /trainingType: filters\.trainingType \?\? null/);
  assert.match(trainer, /Todos os spots/);
  assert.match(styles, /\.inline-training-session \{ min-width:0; grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.training-hub-shell\.spot-session-mode \{ overflow-x:clip; \}/);
  assert.match(styles, /\.spot-session-sidebar \{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*border:1px solid var\(--border-default\)/);
  assert.match(styles, /\.spot-table-stage \.play-table-frame \{ max-width:520px; margin-inline:auto; \}/);
  assert.match(styles, /\.spot-action-history,\s*\.play-table-context \{ display:none; \}/);
  assert.match(styles, /\.spot-training-decision \{[^}]*height:calc\(100dvh - var\(--header-height\) - 60px - env\(safe-area-inset-bottom\)\)[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(styles, /\.spot-table-stage \.spot-poker-table \{[^}]*width:min\(100%,360px\)[^}]*height:100%[^}]*aspect-ratio:auto/);
  assert.match(styles, /left:var\(--mobile-table-seat-x\);\s*top:var\(--mobile-table-seat-y\);/);
  assert.match(styles, /left:var\(--mobile-table-bet-x\);\s*top:var\(--mobile-table-bet-y\);/);
  assert.match(styles, /\.spot-poker-table \.play-card--back::before \{ display:none; \}/);
  assert.match(styles, /\.spot-poker-table \.play-seat:not\(\.play-seat--hero\) \.play-hole-cards \{ display:flex; \}/);
  assert.match(styles, /\.spot-poker-table \.play-seat:not\(\.play-seat--hero\) \.play-hole-cards \.play-card \+ \.play-card \{\s*margin-left:-10px;/);
  assert.match(styles, /data-table-side="left"\] \.play-hole-cards \{[^}]*right:calc\(100% \+ 5px\)[^}]*transform-origin:right center/);
  assert.match(styles, /data-table-side="right"\] \.play-hole-cards \{[^}]*left:calc\(100% \+ 5px\)[^}]*transform-origin:left center/);
  assert.match(styles, /data-table-side="center"\] \.play-hole-cards \{[^}]*left:calc\(100% \+ 5px\)[^}]*transform-origin:left center/);
  assert.match(styles, /\.spot-poker-table \.play-seat--hero \.play-hole-cards \{[^}]*bottom:calc\(100% \+ 4px\)[^}]*transform:translateX\(-50%\) scale\(\.88\)/);
  assert.match(styles, /\.spot-poker-table \.play-seat--hero \.play-hole-cards \.play-card \+ \.play-card \{\s*margin-left:-9px;/);
  assert.match(styles, /\.spot-poker-table \.play-chip-stack \{\s*display:none;/);
  assert.match(styles, /\.spot-action-panel \.play-action-copy \{[^}]*display:flex;/);
  assert.match(styles, /\.spot-action-panel \.play-action-buttons\.actions-3\.is-active \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\); \}/);
  assert.match(styles, /\.spot-result\.play-result \{[^}]*border-radius:24px 24px 0 0[^}]*animation:spot-feedback-sheet/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
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

test("apresenta o assento intermediário legado de 9-max como LJ na mesa e nas ações", () => {
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
  for (const position of ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]) {
    assert.match(markup, new RegExp(`data-position="${position.replace("+", "\\+")}"`));
  }
  assert.match(markup, /<strong>LJ<\/strong>/);
  assert.doesNotMatch(markup, /<strong>MP<\/strong>/);

  const exercise = makeExercise(9, [fold, call], "CO");
  exercise.trainingType = "CALL_VS_SHOVE";
  exercise.heroStackBb = 10;
  exercise.villainPosition = "UTG+2";
  exercise.actionSequence = [{ position: "UTG+2", type: "RAISE", amountBb: 10, label: "All-in" }];
  const activeMarkup = renderToStaticMarkup(<TrainingDecision exercise={exercise} busy={false} onChoose={() => undefined}/>);
  assert.match(activeMarkup, /data-seat-count="8"/);
  assert.doesNotMatch(activeMarkup, /data-position="UTG\+2"/);
  assert.match(activeMarkup, /LJ foi all-in 10 BB/);
  assert.doesNotMatch(activeMarkup, /UTG\+2 foi all-in|MP foi all-in/);
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
