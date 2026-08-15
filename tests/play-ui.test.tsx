import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionPanel } from "../components/play/ActionPanel";
import { HandResult } from "../components/play/HandResult";
import { PlayingCard } from "../components/play/PlayingCard";
import { PokerTable } from "../components/play/PokerTable";
import { HandEngine } from "../lib/play/hand-engine";
import { PLAY_HAND_FIXTURES } from "./fixtures/play-hands";
import { parseCard } from "../lib/poker/cards";

test("PlayingCard usa quatro cores e um verso real de baralho", () => {
  const html = ["As", "Kh", "Qd", "Jc"].map((value) => renderToStaticMarkup(createElement(PlayingCard, { card: parseCard(value) }))).join("");
  assert.match(html, /suit-s/);
  assert.match(html, /suit-h/);
  assert.match(html, /suit-d/);
  assert.match(html, /suit-c/);
  const back = renderToStaticMarkup(createElement(PlayingCard, { card: parseCard("As"), faceDown: true }));
  assert.match(back, /play-card--back/);
  assert.match(back, /Carta virada para baixo/);
});

test("mesa renderiza os oito assentos, blinds e duas cartas para todos", () => {
  const engine = new HandEngine(PLAY_HAND_FIXTURES[0]);
  for (let index = 0; index < 16; index += 1) engine.dealNextCard();
  const html = renderToStaticMarkup(createElement(PokerTable, { state: engine.snapshot() }));
  for (const position of ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]) assert.match(html, new RegExp(`data-position="${position.replace("+", "\\+")}`));
  assert.equal((html.match(/Carta virada para baixo/g) ?? []).length, 14);
  assert.match(html, /Ás de espadas/);
  assert.match(html, /Valete de copas/);
  assert.match(html, /0\.5 big blinds/);
  assert.match(html, /1 big blinds/);
});

test("mesa rotaciona os assentos para manter qualquer posição do Hero embaixo", () => {
  const btnEngine = new HandEngine(PLAY_HAND_FIXTURES[0]);
  const bbEngine = new HandEngine(PLAY_HAND_FIXTURES[1]);
  const btnHtml = renderToStaticMarkup(createElement(PokerTable, { state: btnEngine.snapshot() }));
  const bbHtml = renderToStaticMarkup(createElement(PokerTable, { state: bbEngine.snapshot() }));
  assert.match(btnHtml, /play-seat-1[^\"]*play-seat--hero[^\"]*\" data-position=\"BTN\"/);
  assert.match(bbHtml, /play-seat-1[^\"]*play-seat--hero[^\"]*\" data-position=\"BB\"/);
});

test("geometria 8-max mantém três assentos em cima, três embaixo e um em cada ponta", () => {
  const html = renderToStaticMarkup(createElement(PokerTable, { state: new HandEngine(PLAY_HAND_FIXTURES[0]).snapshot() }));
  const expectedSlots = { BTN: 1, SB: 2, BB: 3, UTG: 4, "UTG+1": 5, LJ: 6, HJ: 7, CO: 8 } as const;
  for (const [position, slot] of Object.entries(expectedSlots)) {
    assert.match(html, new RegExp(`play-seat-${slot}[^\"]*\" data-position=\"${position.replace("+", "\\+")}\"`));
  }
});

test("painel do Hero mostra somente as ações válidas sem feedback imediato", () => {
  const engine = new HandEngine(PLAY_HAND_FIXTURES[0]);
  for (let index = 0; index < 16; index += 1) engine.dealNextCard();
  for (let index = 0; index < 5; index += 1) {
    engine.act(engine.automaticAction()!.id);
    engine.resolvePendingAction();
  }
  const state = engine.snapshot();
  const node = engine.currentNode();
  const html = renderToStaticMarkup(createElement(ActionPanel, { state, node, actions: engine.availableActions(), onAction: () => undefined }));
  assert.match(html, /SUA VEZ/);
  assert.match(html, /FOLD/);
  assert.match(html, /RAISE TO 2\.2 BB/);
  assert.match(html, /ALL-IN 25 BB/);
  assert.doesNotMatch(html, /CALL/);
  assert.doesNotMatch(html, /CORRETO|ERRADO/);
});

test("review final oferece repetir e próxima mão por street", () => {
  const result = {
    winnerPosition: "BTN" as const,
    winnerLabel: "Hero vence",
    handLabel: "Par de Valetes",
    score: 86,
    evDeltaBb: -0.04,
    wonPotBb: 24.5,
    showdown: true,
    reviews: [
      { street: "PREFLOP" as const, status: "BEST" as const },
      { street: "FLOP" as const, status: "CORRECT" as const },
      { street: "TURN" as const, status: "INACCURACY" as const },
      { street: "RIVER" as const, status: "NOT_PLAYED" as const },
    ],
  };
  const html = renderToStaticMarkup(createElement(HandResult, { result, onRepeat: () => undefined, onNext: () => undefined }));
  assert.match(html, /MÃO CONCLUÍDA/);
  assert.match(html, /Pré-flop/);
  assert.match(html, /<span>Pré-flop<\/span><b>✓✓<\/b>/);
  assert.match(html, /<span>Flop<\/span><b>✓<\/b>/);
  assert.match(html, /<span>Turn<\/span><b>!<\/b>/);
  assert.doesNotMatch(html, /River/);
  assert.match(html, /86%/);
  assert.match(html, /ΔEV total/);
  assert.match(html, /−0,04 BB/);
  assert.match(html, /Repetir mão/);
  assert.match(html, /Próxima mão/);
});
