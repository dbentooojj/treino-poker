"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RANKS, type PokerCard } from "../../lib/poker/cards";
import {
  availableRangeCombinations,
  buildStartingHandMatrix,
  createRangeWeightMap,
  handClassesFromRangeWeightMap,
  rangeCombinationCount,
  TOTAL_STARTING_HAND_COMBINATIONS,
  toggleRangeHandWeight,
  VILLAIN_RANGE_PRESETS,
  type RangeWeightMap,
} from "../../lib/poker/range";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

type VillainRangeSelectorProps = {
  selectedWeights: RangeWeightMap;
  blockedCards: readonly PokerCard[];
  onApply: (weights: RangeWeightMap) => void;
  onCancel: () => void;
};

const STARTING_HAND_MATRIX = buildStartingHandMatrix();

function sameHands(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((handClass) => rightSet.has(handClass));
}

function handDescription(pair: boolean, suited: boolean): string {
  if (pair) return "par";
  return suited ? "mesmo naipe" : "naipes diferentes";
}

export default function VillainRangeSelector({
  selectedWeights,
  blockedCards,
  onApply,
  onCancel,
}: VillainRangeSelectorProps) {
  const [draftWeights, setDraftWeights] = useState<RangeWeightMap>(() => ({ ...selectedWeights }));
  const [focusedCell, setFocusedCell] = useState(0);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedHands = useMemo(
    () => handClassesFromRangeWeightMap(draftWeights),
    [draftWeights],
  );
  const selected = useMemo(() => new Set(selectedHands), [selectedHands]);
  const totalCombinations = useMemo(
    () => rangeCombinationCount(selectedHands),
    [selectedHands],
  );
  const availableCombinations = useMemo(
    () => availableRangeCombinations(selectedHands, blockedCards).length,
    [blockedCards, selectedHands],
  );
  const cellAvailability = useMemo(
    () => new Map(STARTING_HAND_MATRIX.map((cell) => {
      const base = rangeCombinationCount([cell.handClass]);
      const available = availableRangeCombinations([cell.handClass], blockedCards).length;
      return [cell.handClass, { available, base }] as const;
    })),
    [blockedCards],
  );
  const rangePercent = totalCombinations / TOTAL_STARTING_HAND_COMBINATIONS * 100;
  const activePreset = VILLAIN_RANGE_PRESETS.find((preset) => sameHands(selectedHands, preset.hands));

  function toggleHand(handClass: string): void {
    setDraftWeights((current) => toggleRangeHandWeight(current, handClass));
  }

  function choosePreset(hands: readonly string[]): void {
    setDraftWeights(createRangeWeightMap(hands));
  }

  function moveCellFocus(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const row = Math.floor(index / 13);
    const column = index % 13;
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = row * 13 + Math.max(0, column - 1);
    else if (event.key === "ArrowRight") nextIndex = row * 13 + Math.min(12, column + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, row - 1) * 13 + column;
    else if (event.key === "ArrowDown") nextIndex = Math.min(12, row + 1) * 13 + column;
    else if (event.key === "Home") nextIndex = row * 13;
    else if (event.key === "End") nextIndex = row * 13 + 12;
    else return;

    event.preventDefault();
    setFocusedCell(nextIndex);
    cellRefs.current[nextIndex]?.focus();
  }

  return <Modal titleId="villain-range-title" descriptionId="villain-range-description" onClose={onCancel} className="range-modal" closeLabel="Cancelar e fechar seletor de range">
        <header className="range-modal-header">
          <div>
            <span>RANGE DO VILÃO</span>
            <h3 id="villain-range-title">Escolha as mãos que fazem parte do range</h3>
            <p id="villain-range-description">Cada célula alterna entre 0% e 100%. O cálculo será feito somente ao aplicar.</p>
          </div>
        </header>

        <div className="range-presets" aria-label="Modelos rápidos de range">
          {VILLAIN_RANGE_PRESETS.map((preset) => <button
            type="button"
            key={preset.id}
            className={activePreset?.id === preset.id ? "active" : ""}
            aria-pressed={activePreset?.id === preset.id}
            title={preset.description}
            onClick={() => choosePreset(preset.hands)}
          >{preset.label}</button>)}
          <button type="button" className="clear" aria-pressed={selectedHands.length === 0} onClick={() => setDraftWeights({})}>Limpar</button>
        </div>

        <div className="villain-range-scroll">
          <div className="villain-range-chart">
            <div className="range-column-labels" aria-hidden="true">
              <span />
              {RANKS.map((rank) => <b key={rank}>{rank}</b>)}
            </div>
            <div className="range-matrix-body">
              <div className="range-row-labels" aria-hidden="true">
                {RANKS.map((rank) => <b key={rank}>{rank}</b>)}
              </div>
              <div className="villain-range-matrix" role="group" aria-label="Matriz 13 por 13 de mãos do range do Vilão">
                {STARTING_HAND_MATRIX.map((cell, index) => {
                  const isSelected = selected.has(cell.handClass);
                  const kind = cell.pair ? "pair" : cell.suited ? "suited" : "offsuit";
                  const availability = cellAvailability.get(cell.handClass) ?? { available: 0, base: 0 };
                  const isBlocked = availability.available === 0;
                  const isPartial = availability.available > 0 && availability.available < availability.base;
                  const isDisabled = isBlocked && !isSelected;
                  const availabilityLabel = `${availability.available} de ${availability.base} combos disponíveis`;
                  return <button
                    type="button"
                    ref={(element) => { cellRefs.current[index] = element; }}
                    key={`${cell.row}-${cell.column}`}
                    className={`villain-range-cell ${kind} ${isSelected ? "selected" : ""} ${isBlocked ? "blocked" : isPartial ? "partial" : ""}`}
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    aria-label={`${cell.handClass}, ${handDescription(cell.pair, cell.suited)}, ${availabilityLabel}${isSelected ? ", selecionada" : ", não selecionada"}`}
                    title={`${cell.handClass} · ${handDescription(cell.pair, cell.suited)} · ${availabilityLabel}`}
                    tabIndex={focusedCell === index ? 0 : -1}
                    onFocus={() => setFocusedCell(index)}
                    onKeyDown={(event) => moveCellFocus(event, index)}
                    onClick={() => toggleHand(cell.handClass)}
                  >{cell.handClass}</button>;
                })}
              </div>
            </div>
          </div>
        </div>

        <footer className="range-modal-footer">
          <div className="range-selection-summary" aria-live="polite">
            <span>Range selecionado</span>
            <strong>{rangePercent.toFixed(1).replace(".", ",")}% <small>· {totalCombinations.toLocaleString("pt-BR")} combos-base</small></strong>
            <em>{availableCombinations.toLocaleString("pt-BR")} combos válidos com as cartas conhecidas</em>
          </div>
          <div className="range-modal-actions">
            <Button type="button" className="range-cancel-button" variant="outline" onClick={onCancel}>Cancelar</Button>
            <Button
              type="button"
              className="range-apply-button"
              disabled={selectedHands.length === 0 || availableCombinations === 0}
              onClick={() => onApply({ ...draftWeights })}
            >Aplicar range</Button>
          </div>
        </footer>
  </Modal>;
}
