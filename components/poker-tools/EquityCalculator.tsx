"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cardKey, type PokerCard } from "../../lib/poker/cards";
import { DEFAULT_SIMULATIONS, type EquityResult as EquityResultData } from "../../lib/poker/equity";
import type { EquityWorkerRequest, EquityWorkerResponse } from "../../workers/equity.worker";
import CardPicker from "./CardPicker";
import EquityResult from "./EquityResult";
import PlayingCard from "./PlayingCard";

type Zone = "hero" | "villain" | "board";
type SlotTarget = { zone: Zone; index: number };

const SIMULATION_OPTIONS = [10_000, 50_000, 100_000, 250_000];

function complete(cards: Array<PokerCard | null>): PokerCard[] {
  return cards.filter((card): card is PokerCard => card !== null);
}

function slotKey(target: SlotTarget): string {
  return `${target.zone}-${target.index}`;
}

type EquityCalculatorProps = {
  onEquityChange: (equity: number | null) => void;
};

export default function EquityCalculator({ onEquityChange }: EquityCalculatorProps) {
  const [hero, setHero] = useState<Array<PokerCard | null>>([null, null]);
  const [villain, setVillain] = useState<Array<PokerCard | null>>([null, null]);
  const [board, setBoard] = useState<Array<PokerCard | null>>([null, null, null, null, null]);
  const [active, setActive] = useState<SlotTarget>({ zone: "hero", index: 0 });
  const [simulations, setSimulations] = useState(DEFAULT_SIMULATIONS);
  const [result, setResult] = useState<EquityResultData | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const heroCards = complete(hero);
  const villainCards = complete(villain);
  const boardCards = complete(board);
  const disabledCards = useMemo(
    () => new Set([...heroCards, ...villainCards, ...boardCards].map(cardKey)),
    [heroCards, villainCards, boardCards],
  );
  const canCalculate = heroCards.length === 2 && (villainCards.length === 0 || villainCards.length === 2);

  function invalidateResult(): void {
    requestIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setCalculating(false);
    setResult(null);
    setError(null);
    onEquityChange(null);
  }

  function updateSlot(target: SlotTarget, card: PokerCard | null): void {
    invalidateResult();
    const nextHero = [...hero];
    const nextVillain = [...villain];
    const nextBoard = [...board];
    if (target.zone === "hero") nextHero[target.index] = card;
    if (target.zone === "villain") nextVillain[target.index] = card;
    if (target.zone === "board") nextBoard[target.index] = card;
    setHero(nextHero);
    setVillain(nextVillain);
    setBoard(nextBoard);

    if (card) {
      const slots: Array<{ target: SlotTarget; card: PokerCard | null }> = [
        ...nextHero.map((value, index) => ({ target: { zone: "hero" as const, index }, card: value })),
        ...nextVillain.map((value, index) => ({ target: { zone: "villain" as const, index }, card: value })),
        ...nextBoard.map((value, index) => ({ target: { zone: "board" as const, index }, card: value })),
      ];
      const current = slots.findIndex((slot) => slotKey(slot.target) === slotKey(target));
      const next = [...slots.slice(current + 1), ...slots.slice(0, current + 1)].find((slot) => slot.card === null);
      if (next) setActive(next.target);
    }
  }

  function clearAll(): void {
    invalidateResult();
    setHero([null, null]);
    setVillain([null, null]);
    setBoard([null, null, null, null, null]);
    setActive({ zone: "hero", index: 0 });
  }

  function swapHands(): void {
    if (heroCards.length !== 2 || villainCards.length !== 2) return;
    invalidateResult();
    setHero([...villain]);
    setVillain([...hero]);
    setActive({ zone: "hero", index: 0 });
  }

  function calculate(): void {
    if (!canCalculate) return;
    invalidateResult();
    setCalculating(true);
    const requestId = ++requestIdRef.current;
    const worker = new Worker(new URL("../../workers/equity.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<EquityWorkerResponse>) => {
      if (data.requestId !== requestId) return;
      setCalculating(false);
      worker.terminate();
      workerRef.current = null;
      if (data.ok) {
        setResult(data.result);
        onEquityChange(data.result.heroEquity);
      } else {
        setError(data.error);
      }
    };
    worker.onerror = () => {
      if (requestId !== requestIdRef.current) return;
      setCalculating(false);
      setError("Não foi possível concluir o cálculo local.");
      worker.terminate();
      workerRef.current = null;
    };
    const message: EquityWorkerRequest = {
      requestId,
      input: { hero: heroCards, villain: villainCards, board: boardCards },
      options: { simulations },
    };
    worker.postMessage(message);
  }

  const slot = (zone: Zone, index: number, label: string, card: PokerCard | null) => <PlayingCard
    key={`${zone}-${index}`}
    card={card}
    label={label}
    selected={active.zone === zone && active.index === index}
    onSelect={() => setActive({ zone, index })}
    onRemove={() => updateSlot({ zone, index }, null)}
  />;

  return <article className="poker-tool-card equity-calculator-card">
    <div className="tool-card-heading">
      <span className="tool-icon" aria-hidden="true">♠</span>
      <div><span>CALCULADORA DE EQUIDADE</span><h2>Veja quanto cada mão realiza.</h2><p>Texas Hold’em heads-up, calculado localmente carta por carta.</p></div>
    </div>

    <div className="hand-selector">
      <section className="hand-row">
        <div className="hand-row-label"><span>YOUR HAND</span><small>2 cartas obrigatórias</small></div>
        <div className="card-slot-row">{hero.map((card, index) => slot("hero", index, `Hero, carta ${index + 1}`, card))}</div>
      </section>
      <section className="hand-row">
        <div className="hand-row-label"><span>OPPONENT</span><small>{villainCards.length === 0 ? "Mão aleatória" : villainCards.length === 1 ? "Selecione a segunda carta" : "Mão definida"}</small></div>
        <div className="card-slot-row">{villain.map((card, index) => slot("villain", index, `Vilão, carta ${index + 1}`, card))}</div>
        <button type="button" className="swap-hands-button" disabled={villainCards.length !== 2 || heroCards.length !== 2} onClick={swapHands}>⇄ <span>Trocar mãos</span></button>
      </section>
      <section className="hand-row board-hand-row">
        <div className="hand-row-label"><span>BOARD</span><small>0 a 5 cartas</small></div>
        <div className="card-slot-row board-slots">{board.map((card, index) => slot("board", index, `Board, carta ${index + 1}`, card))}</div>
      </section>
    </div>

    <CardPicker disabledCards={disabledCards} onSelect={(card) => updateSlot(active, card)} />

    <div className="equity-controls">
      <label htmlFor="simulation-count">Simulações quando necessário</label>
      <select id="simulation-count" value={simulations} onChange={(event) => { invalidateResult(); setSimulations(Number(event.target.value)); }}>
        {SIMULATION_OPTIONS.map((amount) => <option value={amount} key={amount}>{amount.toLocaleString("pt-BR")}</option>)}
      </select>
      <button type="button" className="clear-tools-button" onClick={clearAll}>Limpar tudo</button>
      <button type="button" className="calculate-equity-button" disabled={!canCalculate || calculating} onClick={calculate}>
        {calculating ? <><i aria-hidden="true" /> Calculando equity...</> : <>Calcular equidade <span aria-hidden="true">→</span></>}
      </button>
    </div>
    {!canCalculate && <p className="calculator-hint">Complete as duas cartas do Hero. O Vilão deve ficar vazio ou ter duas cartas.</p>}
    {calculating && <p className="calculation-status" role="status">Calculando equity sem bloquear a interface…</p>}
    {error && <p className="calculator-error" role="alert">{error}</p>}
    {result && <EquityResult result={result} hero={heroCards} villain={villainCards} board={boardCards} />}
  </article>;
}
