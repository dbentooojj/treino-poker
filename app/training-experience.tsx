"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EQUITY_MODELS,
  TRAINING_DIFFICULTIES,
  TRAINING_TYPES,
  actionKey,
  actionLabel,
  difficultyLabels,
  equityModelLabels,
  formatBb,
  requiresVillainPosition,
  trainingTypeDescriptions,
  trainingTypeLabels,
  type BlindStructure,
  type TrainingAction,
  type TrainingConfig,
  type TrainingFilters,
  type TrainingOptions,
  type TrainingSession,
  type TrainingType,
} from "../lib/training";

const EMPTY_OPTIONS: TrainingOptions = {
  trainingTypes: [],
  equityModels: [],
  playerCounts: [],
  stackDepthsBb: [],
  heroPositions: [],
  villainPositions: [],
  icmContexts: [],
  blindStructures: [],
  hasMatches: false,
};

export function TrainingSetup({ preferredType, onClose, onStarted }: {
  preferredType?: TrainingType;
  onClose: () => void;
  onStarted: (session: TrainingSession) => void;
}) {
  const [filters, setFilters] = useState<TrainingFilters>({ trainingType: preferredType });
  const [difficulty, setDifficulty] = useState<TrainingConfig["difficulty"]>("INTERMEDIATE");
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
    return params.toString();
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/training/options?${filterQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as TrainingOptions & { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar os estudos.");
        setOptions(data);
        setFilters((current) => normalizeFilters(current, data));
        setError("");
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setOptions(EMPTY_OPTIONS);
        setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar os estudos.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filterQuery]);

  const config = options.hasMatches ? buildConfig(filters, difficulty) : null;
  const noStudies = !loading && options.trainingTypes.length === 0;

  async function start() {
    if (!config || starting) return;
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json() as TrainingSession & { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar o treinamento.");
      if (!data.nodes.length) {
        setError("Nenhum estudo disponível para esta configuração.");
        return;
      }
      onStarted(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar o treinamento.");
    } finally {
      setStarting(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="setup-card training-setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <button className="close-button" aria-label="Fechar" onClick={onClose}>×</button>
      <div className="setup-heading"><span>CONFIGURAÇÃO DO TREINO</span><h2 id="setup-title">Qual spot você quer praticar?</h2><p>Somente combinações disponíveis nos estudos importados podem ser iniciadas.</p></div>

      <div className="setup-group"><label>Tipo de treinamento</label><div className="training-type-grid">{TRAINING_TYPES.map((type) => {
        const available = options.trainingTypes.includes(type);
        return <button key={type} type="button" disabled={!available || loading} className={filters.trainingType === type ? "selected" : ""} onClick={() => setFilters({ trainingType: type })}>
          <b>{trainingTypeLabels[type]}</b><small>{trainingTypeDescriptions[type]}</small>{!loading && !available && <i>Sem estudo</i>}
        </button>;
      })}</div></div>

      {loading && options.trainingTypes.length === 0 ? <div className="setup-loading"><i/><span>Consultando estudos disponíveis…</span></div> : noStudies ? <EmptyStudies/> : <>
        <div className="setup-row setup-model-row"><div className="setup-group"><label>Modelo</label><div className="choice-grid compact">{EQUITY_MODELS.map((model) => <button type="button" key={model} disabled={!options.equityModels.includes(model)} className={filters.equityModel === model ? "selected" : ""} onClick={() => updateFilter(setFilters, "equityModel", model)}>{equityModelLabels[model]}</button>)}</div></div>
          <div className="setup-group"><label>Mesa</label><div className="choice-grid compact">{[6, 9].map((count) => <button type="button" key={count} disabled={!options.playerCounts.includes(count)} className={filters.playersCount === count ? "selected" : ""} onClick={() => updateFilter(setFilters, "playersCount", count)}>{count}-max</button>)}</div></div></div>

        <div className="setup-row"><SelectField label="Stack efetivo" value={filters.stackDepthBb} disabled={!options.stackDepthsBb.length} onChange={(value) => updateFilter(setFilters, "stackDepthBb", Number(value))} options={options.stackDepthsBb.map((stack) => ({ value: stack, label: `${formatBb(stack)} BB` }))}/>
          <SelectField label="Posição do Hero" value={filters.heroPosition} disabled={!options.heroPositions.length} onChange={(value) => updateFilter(setFilters, "heroPosition", value)} options={options.heroPositions.map(asOption)}/></div>

        {requiresVillainPosition(filters.trainingType) && <div className="setup-row"><SelectField label={filters.trainingType === "CALL_VS_SHOVE" ? "Shove de" : "Open de"} value={filters.villainPosition} disabled={!options.villainPositions.length} onChange={(value) => updateFilter(setFilters, "villainPosition", value)} options={options.villainPositions.map(asOption)}/>
          <div className="setup-group"><label>Sequência</label><div className="static-input">{filters.trainingType === "CALL_VS_SHOVE" ? "Vilão all-in → decisão do Hero" : "Vilão abre → decisão do Hero"}</div></div></div>}

        {filters.equityModel === "ICM" && <div className="setup-row"><SelectField label="Contexto ICM" value={filters.icmContext} disabled={!options.icmContexts.length} onChange={(value) => updateFilter(setFilters, "icmContext", value)} options={options.icmContexts.map(asOption)}/>
          <div className="setup-context-note"><b>Contexto do estudo</b><span>Bolha, ITM ou mesa final vêm do dataset importado.</span></div></div>}

        <div className="setup-row"><div className="setup-group"><label>Blinds do estudo</label><div className="blind-structures">{options.blindStructures.length ? options.blindStructures.map((blinds) => <span key={blindKey(blinds)}>{formatBlinds(blinds)}</span>) : <span>Selecione a configuração</span>}</div></div>
          <div className="setup-group"><label>Dificuldade</label><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as TrainingConfig["difficulty"])}>{TRAINING_DIFFICULTIES.map((level) => <option value={level} key={level}>{difficultyLabels[level]}</option>)}</select><small className="difficulty-note">Define a seleção de mãos quando o estudo trouxer métricas de clareza e mistura; nunca altera o cálculo do solver.</small></div></div>
      </>}

      {error && <div className="setup-error" role="alert">{error}</div>}
      <button className="start-button" disabled={!config || loading || starting} onClick={start}>{starting ? "Carregando estudo…" : "Começar agora"}<span>{starting ? "" : "→"}</span></button>
    </section>
  </div>;
}

export function DatabaseTrainer({ session, onExit }: { session: TrainingSession; onExit: () => void }) {
  const node = session.nodes[0];
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<TrainingAction | null>(null);
  const [stats, setStats] = useState({ answered: 0, correct: 0 });
  const hand = node.hands[index] ?? node.hands[0];
  const cards = handClassCards(hand.handClass);
  const result = choice ? evaluateChoice(choice, node.availableActions, hand.bestAction, hand.evs) : null;
  const accuracy = stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0;
  const history = useMemo(() => node.actionSequence.map(formatSequenceAction), [node.actionSequence]);

  function answer(action: TrainingAction) {
    if (choice) return;
    const evaluation = evaluateChoice(action, node.availableActions, hand.bestAction, hand.evs);
    setChoice(action);
    setStats((current) => ({ answered: current.answered + 1, correct: current.correct + (evaluation.correct ? 1 : 0) }));
  }

  function next() {
    setChoice(null);
    setIndex((current) => (current + 1) % node.hands.length);
  }

  return <main className="training-screen"><header className="trainer-topbar"><button className="brand brand-button" onClick={onExit}><span className="brand-mark">R</span><span>Range<span>Lab</span></span></button><div className="spot-context"><span>{trainingTypeLabels[node.trainingType]}</span><b>{equityModelLabels[node.equityModel]} · {node.playersCount}-max · {formatBb(node.heroStackBb)} BB</b></div><button className="exit-button" onClick={onExit}>← Sair do treino</button></header>
    <div className="hrc-pack-bar"><span><i>✓</i> {node.setName}</span><div><b>{node.hands.length}</b> classes de mão <em>•</em> {difficultyLabels[session.config.difficulty]} <em>•</em> dados persistidos no estudo</div></div>
    <section className="trainer-layout"><div className="practice-column"><div className="table-meta"><span><i/> TORNEIO · PRÉ-FLOP</span><div>{history.map((item, itemIndex) => <small key={`${item}-${itemIndex}`}>{item}</small>)}</div></div>
      <div className="hrc-table-shell"><div className="hrc-table"><div className="trainer-inner-line"/>{node.villainPosition && <div className="game-seat hrc-villain"><span>{node.villainPosition}</span><b>{formatBb(node.heroStackBb)} BB efetivos</b><small>{history.at(-1)?.toUpperCase() || "AGUARDA"}</small></div>}<div className="center-pot"><span>BLINDS</span><b>{formatBlinds(node.blinds)}</b></div><div className="trainer-hero-cards"><TrainingCard rank={cards[0]} suit={cards[1]}/><TrainingCard rank={cards[2]} suit={cards[3]}/></div><div className="game-seat game-hero"><span>VOCÊ · {node.heroPosition}</span><b>{formatBb(node.heroStackBb)} BB</b><small>SUA AÇÃO</small></div><span className="hrc-player-note">{node.playersCount} jogadores no cálculo</span></div></div>
      <div className="decision-panel"><div className="decision-copy"><span>SUA DECISÃO · {node.heroPosition}</span><h1>{buildPrompt(node.trainingType, node.heroPosition, node.villainPosition, hand.handClass)}</h1><p>Escolha antes de ver as frequências e os EVs armazenados no estudo.</p></div>
        {!choice && <div className={`hrc-action-grid actions-${node.availableActions.length}`}>{node.availableActions.map((action) => <button key={actionKey(action)} onClick={() => answer(action)}><span>{actionIcon(action)}</span><b>{actionLabel(action, node)}</b><small>{typeof action.amountBb === "number" ? `${formatBb(action.amountBb)} BB` : ""}</small></button>)}</div>}
        {choice && result && <div className={`feedback ${result.correct ? "feedback-good" : "feedback-bad"}`}><div className="verdict-icon">{result.correct ? "✓" : "!"}</div><div className="feedback-main"><span>{result.correct ? "DECISÃO RECOMENDADA" : "REVEJA ESTA DECISÃO"}</span><h2>{result.correct ? "Sua ação tem o melhor EV deste spot." : `A linha de maior EV é ${result.bestLabel}.`}</h2><p>Resultado calculado somente com os EVs e frequências persistidos para {hand.handClass} neste node.</p><div className="solver-result-list">{node.availableActions.map((action) => { const key = actionKey(action); const frequency = recordValue(hand.strategy, action); const frequencyPercent = frequency === null ? null : formatPercent(frequency); const ev = recordValue(hand.evs, action); return <div key={key} className={`${sameAction(action, choice) ? "chosen" : ""} ${key === result.bestKey ? "best" : ""}`}><span>{actionLabel(action, node)}</span><div className="frequency-track"><i style={{ width: `${Math.max(0, Math.min(100, frequencyPercent ?? 0))}%` }}/></div><b>{frequencyPercent === null ? "—" : `${frequencyPercent}%`}</b><small>{ev === null ? "EV —" : `EV ${Number(ev.toFixed(4))}`}</small></div>; })}</div><div className="feedback-bottom"><small>As frequências não são alteradas pela dificuldade escolhida.</small><button onClick={next}>Próxima mão →</button></div></div></div>}
      </div></div>
      <aside className="stats-rail"><div className="session-card"><div className="rail-title"><span>SESSÃO ATUAL</span><i>● ao vivo</i></div><div className="accuracy-ring" style={{ "--accuracy": `${accuracy * 3.6}deg` } as React.CSSProperties}><div><b>{accuracy}%</b><span>acerto</span></div></div><div className="stat-row"><div><span>Respostas</span><b>{stats.answered}</b></div><div><span>Acertos</span><b className="green-text">{stats.correct}</b></div><div><span>Erros</span><b className="red-text">{stats.answered - stats.correct}</b></div></div></div><div className="concept-card"><span>CONFIGURAÇÃO</span><div><i>{trainingTypeLabels[node.trainingType]}</i><i>{equityModelLabels[node.equityModel]}</i><i>{node.playersCount}-max</i><i>{formatBb(node.heroStackBb)} BB</i></div></div></aside>
    </section></main>;
}

function normalizeFilters(current: TrainingFilters, options: TrainingOptions): TrainingFilters {
  const trainingType = current.trainingType && options.trainingTypes.includes(current.trainingType) ? current.trainingType : options.trainingTypes[0];
  const equityModel = current.equityModel && options.equityModels.includes(current.equityModel) ? current.equityModel : options.equityModels[0];
  const playersCount = current.playersCount && options.playerCounts.includes(current.playersCount) ? current.playersCount : options.playerCounts[0];
  const stackDepthBb = current.stackDepthBb && options.stackDepthsBb.includes(current.stackDepthBb) ? current.stackDepthBb : options.stackDepthsBb[0];
  const heroPosition = current.heroPosition && options.heroPositions.includes(current.heroPosition) ? current.heroPosition : options.heroPositions[0];
  const needsVillain = requiresVillainPosition(trainingType);
  const villainPosition = needsVillain ? (current.villainPosition && options.villainPositions.includes(current.villainPosition) ? current.villainPosition : options.villainPositions[0]) : undefined;
  const icmContext = equityModel === "ICM" ? (current.icmContext && options.icmContexts.includes(current.icmContext) ? current.icmContext : options.icmContexts[0]) : undefined;
  return { trainingType, equityModel, playersCount, stackDepthBb, heroPosition, villainPosition, icmContext };
}

function updateFilter<K extends keyof TrainingFilters>(setter: React.Dispatch<React.SetStateAction<TrainingFilters>>, key: K, value: TrainingFilters[K]) {
  setter((current) => ({ ...current, [key]: value }));
}

function buildConfig(filters: TrainingFilters, difficulty: TrainingConfig["difficulty"]): TrainingConfig | null {
  if (!filters.trainingType || !filters.equityModel || !filters.playersCount || !filters.stackDepthBb || !filters.heroPosition) return null;
  if (requiresVillainPosition(filters.trainingType) && !filters.villainPosition) return null;
  if (filters.equityModel === "ICM" && !filters.icmContext) return null;
  return { trainingType: filters.trainingType, equityModel: filters.equityModel, playersCount: filters.playersCount, stackDepthBb: filters.stackDepthBb, heroPosition: filters.heroPosition, villainPosition: filters.villainPosition, icmContext: filters.icmContext, difficulty };
}

function SelectField({ label, value, options, disabled, onChange }: { label: string; value: string | number | undefined; options: Array<{ value: string | number; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="setup-group"><label>{label}</label><select value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="" disabled>Selecione</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function EmptyStudies() {
  return <div className="setup-empty"><span>∅</span><div><b>Nenhum estudo disponível para esta configuração.</b><p>Quando um estudo HRC compatível for importado no painel administrativo, as opções aparecerão aqui automaticamente.</p></div></div>;
}

function asOption(value: string) { return { value, label: value === "BU" ? "BU (Button)" : value === "BTN" ? "BTN (Button)" : value }; }
function blindKey(value: BlindStructure) { return `${value.smallBlind}-${value.bigBlind}-${value.ante}-${value.anteType}`; }
function formatBlinds(value: BlindStructure) { return `${formatBb(value.smallBlind)} / ${formatBb(value.bigBlind)}${value.ante ? ` · ante ${formatBb(value.ante)} (${value.anteType})` : ""}`; }

function handClassCards(handClass: string): [string, string, string, string] {
  const clean = handClass.trim();
  if (clean.length === 2) return [clean[0], "♠", clean[1], "♥"];
  return [clean[0], "♠", clean[1], clean.endsWith("s") ? "♠" : "♥"];
}

function TrainingCard({ rank, suit }: { rank: string; suit: string }) {
  const red = suit === "♥" || suit === "♦";
  return <div className={`playing-card ${red ? "red-suit" : "black-suit"}`}><span>{rank}</span><b>{suit}</b></div>;
}

function formatSequenceAction(action: { position?: string; type: string; amountBb?: number; label?: string }) {
  if (action.label) return action.label;
  const amount = typeof action.amountBb === "number" ? ` ${formatBb(action.amountBb)} BB` : "";
  return `${action.position ?? "Ação"} ${action.type.toLowerCase()}${amount}`;
}

function buildPrompt(type: TrainingType, hero: string, villain: string | null, hand: string) {
  if (type === "CALL_VS_SHOVE") return `${villain ?? "O vilão"} foi all-in. Você está no ${hero} com ${hand}. Call ou fold?`;
  if (type === "VS_OPEN") return `${villain ?? "O vilão"} abriu. Você está no ${hero} com ${hand}. Qual é sua resposta?`;
  if (type === "OPEN_FOLD") return `A ação chegou em fold até você no ${hero}. O que fazer com ${hand}?`;
  return `Você está no ${hero} com ${hand}. Push ou fold?`;
}

function actionIcon(action: TrainingAction) {
  if (action.type === "FOLD") return "×";
  if (action.type === "CALL") return "●";
  if (action.type === "CHECK") return "✓";
  return action.type === "RAISE" ? "▲" : "◆";
}

function evaluateChoice(choice: TrainingAction, actions: TrainingAction[], bestAction: string | null, evs: Record<string, number>) {
  const values = actions.map((action) => ({ action, key: actionKey(action), value: recordValue(evs, action) }));
  const evBest = values.filter((item): item is typeof item & { value: number } => item.value !== null).sort((left, right) => right.value - left.value)[0];
  const configured = bestAction ? values.find((item) => actionAliases(item.action).includes(bestAction)) : undefined;
  const best = configured ?? evBest ?? values[0];
  return { correct: sameAction(choice, best.action), bestKey: best.key, bestLabel: best.action.label ?? best.key };
}

function recordValue(record: Record<string, number>, action: TrainingAction) {
  for (const alias of actionAliases(action)) if (typeof record[alias] === "number") return record[alias];
  return null;
}

function actionAliases(action: TrainingAction) {
  return [action.id, action.type, action.type.toLowerCase(), action.label].filter((value): value is string => Boolean(value));
}

function sameAction(left: TrainingAction, right: TrainingAction) {
  return actionAliases(left).some((alias) => actionAliases(right).includes(alias));
}

function formatPercent(value: number) {
  return Number((value <= 1 ? value * 100 : value).toFixed(1));
}
