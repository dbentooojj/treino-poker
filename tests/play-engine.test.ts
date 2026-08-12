import assert from "node:assert/strict";
import test from "node:test";
import { HandEngine } from "../lib/play/hand-engine";
import { MOCK_HANDS } from "../lib/play/mock-hands";
import type { HandState, PlayableHandScenario, PlayPosition } from "../lib/play/types";

function deal(engine: HandEngine) {
  for (let index = 0; index < 16; index += 1) engine.dealNextCard();
}

function actAndResolve(engine: HandEngine, actionId?: string) {
  const action = actionId ? engine.availableActions().find((entry) => entry.id === actionId) : engine.automaticAction();
  assert.ok(action, "a ação esperada deve estar disponível");
  engine.act(action.id);
  return engine.resolvePendingAction();
}

function revealStreet(engine: HandEngine, count: number) {
  for (let index = 0; index < count; index += 1) engine.revealNextBoardCard();
}

function playOpeningFolds(engine: HandEngine) {
  const order: PlayPosition[] = [];
  for (let index = 0; index < 5; index += 1) {
    const state = engine.snapshot();
    assert.ok(state.activePosition);
    order.push(state.activePosition);
    actAndResolve(engine);
  }
  return order;
}

function reachFlop(engine: HandEngine) {
  deal(engine);
  playOpeningFolds(engine);
  actAndResolve(engine, "raise-2.2");
  actAndResolve(engine);
  const afterCall = actAndResolve(engine);
  assert.equal(afterCall.phase, "COLLECTING");
  engine.collectBets();
  revealStreet(engine, 3);
}

test("ordem pré-flop avança por UTG, UTG+1, LJ, HJ e CO e pausa no Hero", () => {
  const engine = new HandEngine(MOCK_HANDS[0]);
  deal(engine);
  assert.equal(engine.snapshot().activePosition, "UTG");
  assert.deepEqual(playOpeningFolds(engine), ["UTG", "UTG+1", "LJ", "HJ", "CO"]);
  assert.equal(engine.snapshot().activePosition, "BTN");
  assert.equal(engine.isHeroTurn(), true);
  assert.equal(engine.automaticAction(), null);
  assert.deepEqual(engine.availableActions().map((action) => action.id), ["fold", "raise-2.2", "all-in"]);
});

test("fold envia o jogador ao muck e ele não pode agir novamente", () => {
  const engine = new HandEngine(MOCK_HANDS[0]);
  deal(engine);
  engine.act(engine.automaticAction()!.id);
  const folding = engine.snapshot();
  assert.equal(folding.players.find((player) => player.position === "UTG")?.folded, true);
  assert.equal(folding.muckCount, 1);
  engine.resolvePendingAction();
  assert.equal(engine.snapshot().activePosition, "UTG+1");
  assert.throws(() => engine.act("h1-utg-action"), /Ação inválida/);
});

test("raise, blinds e call atualizam committed chips, stacks e pote", () => {
  const engine = new HandEngine(MOCK_HANDS[0]);
  deal(engine);
  playOpeningFolds(engine);
  engine.act("raise-2.2");
  let state = engine.snapshot();
  assert.equal(player(state, "BTN").stackBb, 22.8);
  assert.equal(player(state, "BTN").committedBb, 2.2);
  engine.resolvePendingAction();
  actAndResolve(engine);
  engine.act(engine.automaticAction()!.id);
  state = engine.snapshot();
  assert.equal(player(state, "BB").stackBb, 22.8);
  assert.equal(player(state, "BB").committedBb, 2.2);
  engine.resolvePendingAction();
  assert.equal(engine.snapshot().phase, "COLLECTING");
  state = engine.collectBets();
  assert.equal(state.potBb, 4.9);
  assert.ok(state.players.every((entry) => entry.committedBb === 0));
  assert.equal(state.street, "FLOP");
});

test("mão principal avança FLOP → TURN → RIVER → SHOWDOWN e paga o vencedor", () => {
  const engine = new HandEngine(MOCK_HANDS[0]);
  reachFlop(engine);
  assert.equal(engine.snapshot().street, "FLOP");
  assert.equal(engine.snapshot().activePosition, "BB");
  actAndResolve(engine);
  actAndResolve(engine, "bet-25");
  actAndResolve(engine);
  engine.collectBets();
  revealStreet(engine, 1);
  assert.equal(engine.snapshot().street, "TURN");
  assert.equal(engine.snapshot().potBb, 7.3);

  actAndResolve(engine);
  actAndResolve(engine, "bet-50");
  actAndResolve(engine);
  engine.collectBets();
  revealStreet(engine, 1);
  assert.equal(engine.snapshot().street, "RIVER");
  assert.equal(engine.snapshot().potBb, 14.7);

  actAndResolve(engine);
  actAndResolve(engine, "bet-33");
  actAndResolve(engine);
  const collecting = engine.snapshot();
  assert.equal(collecting.phase, "COLLECTING");
  const showdown = engine.collectBets();
  assert.equal(showdown.street, "SHOWDOWN");
  assert.equal(showdown.potBb, 24.5);
  assert.equal(player(showdown, "BB").cardsVisible, true);

  const payout = engine.completeShowdown();
  assert.equal(payout.result?.winnerLabel, "Hero vence");
  assert.equal(payout.result?.handLabel, "Par de Valetes");
  assert.equal(payout.result?.score, 100);
  const finished = engine.awardPot();
  assert.equal(finished.phase, "FINISHED");
  assert.equal(finished.potBb, 0);
  assert.equal(player(finished, "BTN").stackBb, 37.5);
});

test("ação inválida é bloqueada e nova mão reinicia todo o estado sem reload", () => {
  const engine = new HandEngine(MOCK_HANDS[0]);
  deal(engine);
  playOpeningFolds(engine);
  assert.throws(() => engine.act("call"), /Ação inválida/);

  const next = new HandEngine(MOCK_HANDS[1], 2).snapshot();
  assert.equal(next.handNumber, 2);
  assert.equal(next.board.length, 0);
  assert.equal(next.muckCount, 0);
  assert.equal(next.dealtCardCount, 0);
  assert.equal(next.potBb, 0);
  assert.ok(next.players.every((entry) => !entry.folded && !entry.allIn));
  assert.equal(player(next, "SB").committedBb, 0.5);
  assert.equal(player(next, "BB").committedBb, 1);
});

test("as três mãos mock percorrem seus caminhos preferenciais até o fim", () => {
  for (const hand of MOCK_HANDS) {
    const engine = new HandEngine(hand);
    let guard = 0;
    while (engine.snapshot().phase !== "FINISHED" && guard < 200) {
      guard += 1;
      const state = engine.snapshot();
      if (state.phase === "DEALING") engine.dealNextCard();
      else if (state.phase === "PLAYING") {
        const node = engine.currentNode();
        assert.ok(node);
        const action = engine.automaticAction() ?? engine.availableActions().find((entry) => entry.id === node.preferredActionId);
        assert.ok(action, `node ${node.id} deve oferecer uma ação executável`);
        engine.act(action.id);
      } else if (state.phase === "ACTION_RESOLVING") engine.resolvePendingAction();
      else if (state.phase === "COLLECTING") engine.collectBets();
      else if (state.phase === "DEALING_BOARD") engine.revealNextBoardCard();
      else if (state.phase === "SHOWDOWN") engine.completeShowdown();
      else if (state.phase === "PAYOUT") engine.awardPot();
    }
    assert.ok(guard < 200, `${hand.id} não deve entrar em loop`);
    assert.equal(engine.snapshot().phase, "FINISHED");
    assert.ok(engine.snapshot().result);
  }
});

test("o mesmo motor aceita um cenário proveniente de futuro import HRC", () => {
  const importedScenario: PlayableHandScenario = {
    ...MOCK_HANDS[0],
    source: "HRC",
    externalStudyId: "hrc-study-123",
  };
  const state = new HandEngine(importedScenario).snapshot();
  assert.equal(state.handId, importedScenario.id);
  assert.equal(state.players.length, importedScenario.players.length);
  assert.equal(state.heroPosition, importedScenario.heroPosition);
});

function player(state: HandState, position: PlayPosition) {
  const found = state.players.find((entry) => entry.position === position);
  assert.ok(found);
  return found;
}
