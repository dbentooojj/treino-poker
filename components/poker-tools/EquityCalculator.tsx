"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cardKey, type PokerCard } from "../../lib/poker/cards";
import type { EquityResult as EquityResultData } from "../../lib/poker/equity";
import {
  availableRangeCombinations,
  createRangeWeightMap,
  DEFAULT_VILLAIN_RANGE,
  handClassesFromRangeWeightMap,
  rangeCombinationCount,
  TOTAL_STARTING_HAND_COMBINATIONS,
  type RangeWeightMap,
} from "../../lib/poker/range";
import type { PokerStreet } from "../../lib/poker/street";
import type { EquityWorkerRequest, EquityWorkerResponse } from "../../workers/equity.worker";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SegmentedControl, StatusMessage } from "../ui/Primitives";
import CardPicker from "./CardPicker";
import PlayingCard from "./PlayingCard";
import VillainRangeSelector from "./VillainRangeSelector";

type Zone = "hero" | "villain" | "board";
type SlotTarget = { zone: Zone; index: number };
type OpponentMode = "exact" | "range";

function complete(cards: Array<PokerCard | null>): PokerCard[] {
  return cards.filter((card): card is PokerCard => card !== null);
}

function slotKey(target: SlotTarget): string {
  return `${target.zone}-${target.index}`;
}

function ordinal(index: number): string {
  return ["primeira", "segunda", "terceira", "quarta", "quinta"][index] ?? `${index + 1}ª`;
}

function zoneName(zone: Zone): string {
  if (zone === "hero") return "Hero";
  if (zone === "villain") return "Vilão";
  return "Board";
}

function streetFromBoard(cardCount: number): PokerStreet {
  if (cardCount === 0) return "preflop";
  if (cardCount <= 3) return "flop";
  return cardCount === 4 ? "turn" : "river";
}

type EquityCalculatorProps = {
  onEquityChange: (equity: number | null) => void;
  onResultChange: (result: EquityResultData | null) => void;
  onStreetChange: (street: PokerStreet) => void;
};

export default function EquityCalculator({ onEquityChange, onResultChange, onStreetChange }: EquityCalculatorProps) {
  const [hero, setHero] = useState<Array<PokerCard | null>>([null, null]);
  const [villain, setVillain] = useState<Array<PokerCard | null>>([null, null]);
  const [villainRangeWeights, setVillainRangeWeights] = useState<RangeWeightMap>(
    () => createRangeWeightMap(DEFAULT_VILLAIN_RANGE),
  );
  const [opponentMode, setOpponentMode] = useState<OpponentMode>("exact");
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [board, setBoard] = useState<Array<PokerCard | null>>([null, null, null, null, null]);
  const [active, setActive] = useState<SlotTarget>({ zone: "hero", index: 0 });
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  const heroCards = useMemo(() => complete(hero), [hero]);
  const villainCards = useMemo(() => complete(villain), [villain]);
  const boardCards = useMemo(() => complete(board), [board]);
  const currentStreet = streetFromBoard(boardCards.length);
  const villainRange = useMemo(
    () => handClassesFromRangeWeightMap(villainRangeWeights),
    [villainRangeWeights],
  );
  const rangeCombinations = useMemo(() => rangeCombinationCount(villainRange), [villainRange]);
  const validRangeCombinations = useMemo(
    () => availableRangeCombinations(villainRange, [...heroCards, ...boardCards]).length,
    [boardCards, heroCards, villainRange],
  );
  const rangePercent = rangeCombinations / TOTAL_STARTING_HAND_COMBINATIONS * 100;
  const selectedCards = useMemo(
    () => new Set([
      ...heroCards,
      ...(opponentMode === "exact" ? villainCards : []),
      ...boardCards,
    ].map(cardKey)),
    [boardCards, heroCards, opponentMode, villainCards],
  );
  const boardIsValid = boardCards.length === 0 || boardCards.length >= 3;
  const opponentIsReady = opponentMode === "exact"
    ? villainCards.length === 2
    : villainRange.length > 0 && validRangeCombinations > 0;
  const canCalculate = heroCards.length === 2 && opponentIsReady && boardIsValid;

  function invalidateResult(): void {
    requestIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setCalculating(false);
    setError(null);
    onEquityChange(null);
    onResultChange(null);
  }

  useEffect(() => {
    if (!canCalculate) return;

    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      setCalculating(true);
      const worker = new Worker(new URL("../../workers/equity.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = ({ data }: MessageEvent<EquityWorkerResponse>) => {
        if (data.requestId !== requestId || requestId !== requestIdRef.current) return;
        worker.terminate();
        workerRef.current = null;
        setCalculating(false);
        if (data.ok) {
          onEquityChange(data.result.heroEquity);
          onResultChange(data.result);
        } else {
          setError(data.error);
        }
      };
      worker.onerror = () => {
        if (requestId !== requestIdRef.current) return;
        setError("Não foi possível concluir o cálculo local.");
        setCalculating(false);
        worker.terminate();
        workerRef.current = null;
      };
      const message: EquityWorkerRequest = {
        requestId,
        input: {
          hero: heroCards,
          villain: opponentMode === "exact" ? villainCards : [],
          villainRange: opponentMode === "range" ? villainRange : undefined,
          board: boardCards,
        },
        options: {},
      };
      worker.postMessage(message);
    }, 180);

    return () => {
      window.clearTimeout(timer);
      if (requestId === requestIdRef.current) {
        workerRef.current?.terminate();
        workerRef.current = null;
      }
    };
  }, [boardCards, canCalculate, heroCards, onEquityChange, onResultChange, opponentMode, villainCards, villainRange]);

  function updateSlot(target: SlotTarget, card: PokerCard | null): void {
    if (card !== null && target.zone === "board" && isBoardSlotDisabled(target.index)) return;
    invalidateResult();
    const nextHero = [...hero];
    const nextVillain = [...villain];
    let nextBoard = [...board];

    if (target.zone === "hero") nextHero[target.index] = card;
    if (target.zone === "villain") nextVillain[target.index] = card;
    if (target.zone === "board") {
      if (card === null) {
        nextBoard = nextBoard.map((value, index) => index >= target.index ? null : value);
      } else {
        nextBoard[target.index] = card;
      }
    }

    setHero(nextHero);
    setVillain(nextVillain);
    setBoard(nextBoard);
    onStreetChange(streetFromBoard(complete(nextBoard).length));

    if (!card) {
      setActive(target);
      return;
    }

    const slots: Array<{ target: SlotTarget; card: PokerCard | null }> = [
      ...nextHero.map((value, index) => ({ target: { zone: "hero" as const, index }, card: value })),
      ...(opponentMode === "exact"
        ? nextVillain.map((value, index) => ({ target: { zone: "villain" as const, index }, card: value }))
        : []),
      ...nextBoard.map((value, index) => ({ target: { zone: "board" as const, index }, card: value })),
    ];
    const current = slots.findIndex((slot) => slotKey(slot.target) === slotKey(target));
    const next = [...slots.slice(current + 1), ...slots.slice(0, current + 1)].find((slot) => slot.card === null);
    if (next) setActive(next.target);
  }

  function clearCards(): void {
    invalidateResult();
    setHero([null, null]);
    setVillain([null, null]);
    setBoard([null, null, null, null, null]);
    setActive({ zone: "hero", index: 0 });
    onStreetChange("preflop");
  }

  function swapHands(): void {
    if (opponentMode !== "exact" || heroCards.length !== 2 || villainCards.length !== 2) return;
    invalidateResult();
    setHero([...villain]);
    setVillain([...hero]);
    setActive({ zone: "hero", index: 0 });
  }

  function changeOpponentMode(mode: OpponentMode): void {
    if (mode === opponentMode) return;
    invalidateResult();
    setRangeModalOpen(false);
    setOpponentMode(mode);
    if (mode === "exact") {
      const occupied = new Set([...heroCards, ...boardCards].map(cardKey));
      const compatibleVillain = villain.map((card) => card && occupied.has(cardKey(card)) ? null : card);
      setVillain(compatibleVillain);
      const missingVillain = compatibleVillain.findIndex((card) => card === null);
      setActive({ zone: "villain", index: missingVillain === -1 ? 0 : missingVillain });
      return;
    }
    const missingHero = hero.findIndex((card) => card === null);
    const missingBoard = board.findIndex((card) => card === null);
    setActive(missingHero >= 0
      ? { zone: "hero", index: missingHero }
      : { zone: "board", index: missingBoard === -1 ? 0 : missingBoard });
  }

  function applyVillainRange(weights: RangeWeightMap): void {
    invalidateResult();
    setVillainRangeWeights({ ...weights });
    setRangeModalOpen(false);
  }

  function isBoardSlotDisabled(index: number): boolean {
    return index > 0 && board[index - 1] === null;
  }

  const slot = (zone: Zone, index: number, label: string, card: PokerCard | null) => <PlayingCard
    key={`${zone}-${index}`}
    card={card}
    label={label}
    selected={active.zone === zone && active.index === index}
    disabled={zone === "board" && isBoardSlotDisabled(index)}
    placeholder={zone === "board" && index === 3 ? "Turn" : zone === "board" && index === 4 ? "River" : undefined}
    onSelect={() => setActive({ zone, index })}
    onRemove={() => updateSlot({ zone, index }, null)}
  />;

  return <article className="poker-tool-card equity-calculator-card simplified-equity-card" aria-busy={calculating || undefined}>
    <div className="tool-card-heading">
      <span className="tool-icon" aria-hidden="true">▦</span>
      <div className="tool-card-title"><h2>Calculadora de Equity</h2><p>Veja quanto cada mão realiza.</p></div>
      <div className="equity-heading-actions">
        <span className="live-analysis-badge" role="status"><i aria-hidden="true" /> {calculating ? "Calculando…" : "Atualização automática"}</span>
        {opponentMode === "exact" && <Button type="button" variant="outline" size="sm" disabled={villainCards.length !== 2 || heroCards.length !== 2} onClick={swapHands}><span aria-hidden="true">⇄</span> Trocar</Button>}
        <Button type="button" variant="outline" size="sm" onClick={clearCards}><Icon name="refresh"/>Limpar</Button>
      </div>
    </div>

    <div className="hand-selector simplified-hand-selector">
      <section className="hand-row">
        <div className="hand-row-label"><span>Hero</span><small>{heroCards.length}/2 cartas</small></div>
        <div className="hand-card-area">
          <div className="card-slot-row">{hero.map((card, index) => slot("hero", index, `Hero, carta ${index + 1}`, card))}</div>
        </div>
      </section>

      <section className="hand-row villain-hand-row">
        <div className="hand-row-label"><span>Vilão</span><small>{opponentMode === "exact" ? `${villainCards.length}/2 cartas` : "Range"}</small></div>
        <div className="hand-card-area villain-range-area">
          {opponentMode === "exact"
            ? <div className="card-slot-row">{villain.map((card, index) => slot("villain", index, `Vilão, carta ${index + 1}`, card))}</div>
            : <div className="selected-range-preview">
              <div><b>{rangePercent.toFixed(1).replace(".", ",")}%</b><span>{rangeCombinations.toLocaleString("pt-BR")} combos</span></div>
              <small>{validRangeCombinations.toLocaleString("pt-BR")} válidos</small>
              <button type="button" aria-label="Editar range do Vilão" onClick={() => setRangeModalOpen(true)}>Editar</button>
            </div>}
          <SegmentedControl className="opponent-mode-switch-system" label="Modo do Vilão" value={opponentMode} onChange={changeOpponentMode} options={[{ value: "exact", label: "Mão exata" }, { value: "range", label: "Range" }] as const}/>
        </div>
      </section>

      <section className="hand-row board-hand-row">
        <div className="hand-row-label"><span>Board</span><small>{boardCards.length === 0 ? "Opcional" : `${boardCards.length}/5 cartas`}</small></div>
        <div className="hand-card-area">
          <div className="board-slots">
            <div className={`board-street-group ${currentStreet === "flop" ? "active" : ""}`}>
              <span>Flop</span>
              <div className="card-slot-row">{board.slice(0, 3).map((card, index) => slot("board", index, `Flop, carta ${index + 1}`, card))}</div>
            </div>
            <div className={`board-street-group ${currentStreet === "turn" ? "active" : ""}`}>
              <span>Turn</span>
              <div className="card-slot-row">{slot("board", 3, "Turn", board[3])}</div>
            </div>
            <div className={`board-street-group ${currentStreet === "river" ? "active" : ""}`}>
              <span>River</span>
              <div className="card-slot-row">{slot("board", 4, "River", board[4])}</div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <CardPicker
      disabledCards={selectedCards}
      selectionLabel={`${zoneName(active.zone)} · ${ordinal(active.index)} carta`}
      onSelect={(card) => updateSlot(active, card)}
    />

    {error && <StatusMessage className="calculator-status" tone="error">{error}</StatusMessage>}
    {opponentMode === "range" && rangeModalOpen && <VillainRangeSelector
      selectedWeights={villainRangeWeights}
      blockedCards={[...heroCards, ...boardCards]}
      onApply={applyVillainRange}
      onCancel={() => setRangeModalOpen(false)}
    />}
  </article>;
}
