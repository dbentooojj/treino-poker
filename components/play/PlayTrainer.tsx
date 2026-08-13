"use client";

import { useEffect, useMemo, useState } from "react";
import { HandEngine } from "../../lib/play/hand-engine";
import type { HandState, PlayableHandScenario } from "../../lib/play/types";
import { ActionPanel } from "./ActionPanel";
import { HandResult } from "./HandResult";
import { PokerTable } from "./PokerTable";

export function PlayTrainer({ scenarios }: { scenarios: readonly PlayableHandScenario[] }) {
  if (!scenarios.length) return <section className="play-trainer play-trainer-empty"><h2>Mão completa em desenvolvimento</h2><p>Ainda não há estudos pós-flop disponíveis para este modo.</p></section>;
  return <ScenarioTrainer scenarios={scenarios}/>;
}

function ScenarioTrainer({ scenarios: availableScenarios }: { scenarios: readonly PlayableHandScenario[] }) {
  const [handIndex, setHandIndex] = useState(0);
  const [handNumber, setHandNumber] = useState(1);
  const [speed, setSpeed] = useState<"NORMAL" | "FAST">("NORMAL");
  const [engine, setEngine] = useState(() => new HandEngine(availableScenarios[0], 1));
  const [state, setState] = useState<HandState>(() => engine.snapshot());
  const hand = availableScenarios[handIndex];
  const node = useMemo(() => hand.nodes.find((entry) => entry.id === state.currentNodeId) ?? null, [hand, state.currentNodeId]);
  const actions = engine.availableActions();

  useEffect(() => {
    const automatic = engine.automaticAction();
    let delay: number | null = null;
    let advance: (() => HandState) | null = null;
    if (state.phase === "DEALING") { delay = 105; advance = () => engine.dealNextCard(); }
    else if (state.phase === "PLAYING" && automatic) { delay = 680; advance = () => engine.act(automatic.id); }
    else if (state.phase === "ACTION_RESOLVING") { delay = state.lastAction?.type === "FOLD" ? 540 : 430; advance = () => engine.resolvePendingAction(); }
    else if (state.phase === "COLLECTING") { delay = 720; advance = () => engine.collectBets(); }
    else if (state.phase === "DEALING_BOARD") { delay = 430; advance = () => engine.revealNextBoardCard(); }
    else if (state.phase === "SHOWDOWN") { delay = 1250; advance = () => engine.completeShowdown(); }
    else if (state.phase === "PAYOUT") { delay = 900; advance = () => engine.awardPot(); }
    if (delay === null || !advance) return;
    const timer = window.setTimeout(() => setState(advance!()), speed === "FAST" ? Math.max(70, delay * 0.46) : delay);
    return () => window.clearTimeout(timer);
  }, [engine, speed, state]);

  function choose(actionId: string) {
    setState(engine.act(actionId));
  }

  function start(nextIndex: number, nextNumber: number) {
    const nextEngine = new HandEngine(availableScenarios[nextIndex], nextNumber);
    setHandIndex(nextIndex);
    setHandNumber(nextNumber);
    setEngine(nextEngine);
    setState(nextEngine.snapshot());
  }

  return <section className="play-trainer">
    <header className="play-context-bar">
      <div className="play-hand-context"><span>MÃO {handNumber}</span><b>{hand.title}</b><small>{hand.subtitle}</small></div>
      <div className="play-context-pills">{hand.solutionLabel && <span>{hand.solutionLabel}</span>}<span>{hand.players.length}-max</span><span>{hand.effectiveStackBb} BB</span><strong>{streetLabel(state.street)}</strong></div>
      <div className="play-speed" aria-label="Velocidade das animações"><span>VELOCIDADE</span><button type="button" className={speed === "NORMAL" ? "active" : ""} onClick={() => setSpeed("NORMAL")}>Normal</button><button type="button" className={speed === "FAST" ? "active" : ""} onClick={() => setSpeed("FAST")}>Rápida</button></div>
    </header>
    <div className="play-table-stage"><PokerTable state={state}/></div>
    {state.phase === "FINISHED" && state.result ? <HandResult result={state.result} onRepeat={() => start(handIndex, handNumber)} onNext={() => start((handIndex + 1) % availableScenarios.length, handNumber + 1)}/> : <ActionPanel state={state} node={node} actions={actions} onAction={choose}/>}
  </section>;
}

function streetLabel(street: HandState["street"]) {
  if (street === "PREFLOP") return "Pré-flop";
  if (street === "FINISHED") return "Finalizada";
  return street.charAt(0) + street.slice(1).toLowerCase();
}
