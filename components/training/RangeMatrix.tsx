import { useEffect, useRef, useState } from "react";
import {
  actionAliases,
  actionLabel,
  buildRangeMatrix,
  equityModelLabels,
  formatBb,
  presentStrategy,
  rangeActionShares,
  recordValue,
  trainingTypeLabels,
  type NodeRange,
  type NodeRangeHand,
  type StrategyPresentation,
  type TrainingAction,
  type TrainingExercise,
} from "../../lib/training";

export function RangeMatrix({ exercise, range, hideSpotLabel = false }: { exercise: TrainingExercise; range: NodeRange; hideSpotLabel?: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);
  const [pinnedHand, setPinnedHand] = useState<string | null>(null);
  const activeHand = pinnedHand ?? hoveredHand;
  const hands = new Map(range.hands.map((hand) => [hand.handClass.toUpperCase(), hand]));

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (pinnedHand && event.target instanceof Node && !sectionRef.current?.contains(event.target)) {
        setPinnedHand(null);
        setHoveredHand(null);
      }
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPinnedHand(null);
        setHoveredHand(null);
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [pinnedHand]);

  function pinHand(handClass: string) {
    clearHoverTimer();
    if (pinnedHand === handClass) {
      setPinnedHand(null);
      setHoveredHand(null);
      return;
    }
    setPinnedHand(handClass);
    setHoveredHand(handClass);
  }

  function closePopover() {
    clearHoverTimer();
    setPinnedHand(null);
    setHoveredHand(null);
  }

  function clearHoverTimer() {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }

  function scheduleHover(handClass: string) {
    if (pinnedHand) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredHand(handClass);
      hoverTimerRef.current = null;
    }, 350);
  }

  function leaveHand() {
    clearHoverTimer();
    if (!pinnedHand) setHoveredHand(null);
  }

  return <section ref={sectionRef} className="rl-range-section" aria-labelledby={hideSpotLabel ? undefined : "range-title"} aria-label={hideSpotLabel ? "Range do spot selecionado" : undefined}>
    <div className={`rl-range-topline ${hideSpotLabel ? "context-hidden" : ""}`}>
      {!hideSpotLabel && <h2 id="range-title">RANGE DESTE SPOT <span>{exercise.heroPosition} · {formatBb(exercise.heroStackBb)} BB</span></h2>}
      <div className="rl-range-legend" aria-label="Legenda da matriz">
        <span><i className="positive"/>EV positivo</span>
        <span><i className="neutral"/>EV neutro</span>
        <span><i className="negative"/>EV negativo</span>
        <span><i className="current"/>Sua mão</span>
      </div>
    </div>
    <div className="rl-range-matrix" role="grid" aria-label="Matriz de range 13 por 13">
      {buildRangeMatrix().map((cell) => {
        const hand = hands.get(cell.handClass.toUpperCase());
        const strategy = hand ? presentStrategy(hand.strategy, exercise.availableActions, hand.isMixed) : null;
        const shares = hand ? rangeActionShares(hand.strategy, exercise.availableActions) : { actionPercent: 0, foldPercent: 0, totalPercent: 0, hasData: false };
        const bestAction = hand ? resolveBestAction(hand, exercise.availableActions) : null;
        const bestEv = hand && bestAction ? recordValue(hand.evs, bestAction) : null;
        const isCurrent = cell.handClass.toUpperCase() === exercise.handClass.toUpperCase();
        const isActive = activeHand === cell.handClass;
        const mixed = shares.actionPercent > 0.05 && shares.foldPercent > 0.05;
        const label = hand && strategy
          ? `${cell.handClass}: ${strategy.actions.map((item) => `${actionLabel(item.action, exercise)} ${formatFrequency(item.frequencyPercent)}`).join(", ")}. Pressione para ver EVs.`
          : `${cell.handClass}: sem dado neste node`;
        return <div
          key={cell.handClass}
          role="gridcell"
          className={`rl-range-cell ${isCurrent ? "current-hand" : ""} ${isActive ? "is-inspecting" : ""} ${mixed ? "mixed" : ""} ${shares.hasData ? "has-data" : "no-data"} ${rangeCellTone(bestEv)}`}
          style={{
            "--range-cell-color": rangeCellColor(bestEv),
            "--range-cell-ink": bestEv === null ? "#95a09b" : "#101814",
          } as React.CSSProperties}
          onPointerEnter={(event) => { if (hand && event.pointerType !== "touch") scheduleHover(cell.handClass); }}
          onPointerLeave={leaveHand}
          onBlur={(event) => {
            if (!pinnedHand && !event.currentTarget.contains(event.relatedTarget)) setHoveredHand(null);
          }}
        >
          <button
            type="button"
            className="rl-range-cell-trigger"
            data-range-hand={cell.handClass}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={isActive}
            aria-controls={isActive ? `range-details-${cell.handClass}` : undefined}
            disabled={!hand || !strategy}
            onFocus={() => { if (!pinnedHand && hand) setHoveredHand(cell.handClass); }}
            onClick={() => { if (hand) pinHand(cell.handClass); }}
          >
            <b>{cell.handClass}</b>
            <small>{bestEv === null ? "—" : formatCellEv(bestEv)}</small>
          </button>
          {isActive && hand && strategy && <HandDetailsPopover
            id={`range-details-${cell.handClass}`}
            hand={hand}
            strategy={strategy}
            exercise={exercise}
            pinned={pinnedHand === cell.handClass}
            horizontal={cell.column <= 6 ? "right" : "left"}
            vertical={cell.row <= 6 ? "top" : "bottom"}
            onClose={closePopover}
          />}
        </div>;
      })}
    </div>
    <p className="rl-range-help">Passe o mouse ou toque em uma mão para ver frequências e EVs importados do HRC.</p>
  </section>;
}

function HandDetailsPopover({ id, hand, strategy, exercise, pinned, horizontal, vertical, onClose }: {
  id: string;
  hand: NodeRangeHand;
  strategy: StrategyPresentation;
  exercise: TrainingExercise;
  pinned: boolean;
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
  onClose: () => void;
}) {
  const bestAction = resolveBestAction(hand, exercise.availableActions);
  const delta = hand.decisionClarity ?? evDifference(hand, exercise.availableActions);
  const indication = strategy.isMixed ? "Estratégia mista" : delta !== null && Math.abs(delta) < 0.1 ? "Preferência leve" : "Preferência do solver";
  return <aside
    id={id}
    className="rl-range-popover"
    data-horizontal={horizontal}
    data-vertical={vertical}
    data-pinned={pinned}
    role={pinned ? "dialog" : "tooltip"}
    aria-label={`Detalhes de ${hand.handClass}`}
  >
    <header>
      <div><strong>{hand.handClass}</strong><span>{exercise.heroPosition} · {formatBb(exercise.heroStackBb)} BB</span></div>
      {pinned && <button type="button" aria-label="Fechar detalhes" onClick={onClose}>×</button>}
    </header>
    <p>{trainingTypeLabels[exercise.trainingType]} · {equityModelLabels[exercise.equityModel]}</p>
    <div className="rl-range-popover-actions">
      {strategy.actions.map((item) => {
        const ev = recordValue(hand.evs, item.action);
        const best = bestAction ? actionAliases(item.action).some((alias) => actionAliases(bestAction).includes(alias)) : false;
        return <div className={best ? "best" : ""} key={item.key}>
          <span>{actionLabel(item.action, exercise)}{best && <i>Melhor</i>}</span>
          <small>Frequência <b>{formatFrequency(item.frequencyPercent)}</b></small>
          <small>EV <b>{ev === null ? "—" : formatEv(ev)}</b></small>
        </div>;
      })}
    </div>
    <footer>
      <div><span>Melhor ação</span><b>{bestAction ? actionLabel(bestAction, exercise) : "—"}</b></div>
      <div><span>ΔEV</span><b>{delta === null ? "—" : formatEv(delta)}</b></div>
      <em className={strategy.isMixed ? "mixed" : ""}>{indication}</em>
    </footer>
  </aside>;
}

function resolveBestAction(hand: NodeRangeHand, actions: TrainingAction[]) {
  const configured = hand.bestAction
    ? actions.find((action) => actionAliases(action).includes(hand.bestAction!))
    : undefined;
  if (configured) return configured;
  return [...actions].sort((left, right) => (recordValue(hand.evs, right) ?? -Infinity) - (recordValue(hand.evs, left) ?? -Infinity))[0] ?? null;
}

function evDifference(hand: NodeRangeHand, actions: TrainingAction[]) {
  const values = actions
    .map((action) => recordValue(hand.evs, action))
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left);
  return values.length > 1 ? values[0] - values[1] : null;
}

function formatFrequency(value: number | null) {
  if (value === null) return "—";
  return `${Number(value.toFixed(value >= 99.95 ? 0 : 1)).toLocaleString("pt-BR")}%`;
}

function formatEv(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function formatCellEv(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rangeCellTone(ev: number | null) {
  if (ev === null) return "ev-no-data";
  if (Math.abs(ev) <= 0.025) return "ev-neutral";
  return ev > 0 ? "ev-positive" : "ev-negative";
}

function rangeCellColor(ev: number | null) {
  if (ev === null) return "#2d3532";
  const magnitude = Math.abs(ev);
  if (magnitude <= 0.025) return "#e5e7e1";
  const intensity = Math.min(1, Math.sqrt(magnitude / 2));
  return ev > 0
    ? mixRgb([226, 233, 226], [88, 220, 113], intensity)
    : mixRgb([235, 229, 225], [239, 143, 141], intensity);
}

function mixRgb(from: [number, number, number], to: [number, number, number], amount: number) {
  const channels = from.map((value, index) => Math.round(value + (to[index] - value) * amount));
  return `rgb(${channels.join(", ")})`;
}
