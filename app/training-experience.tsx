"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EQUITY_MODELS,
  QUESTION_COUNTS,
  TRAINING_TYPES,
  actionKey,
  actionLabel,
  equityModelLabels,
  formatBb,
  recordValue,
  trainingTypeDescriptions,
  trainingTypeLabels,
  type AnswerEvaluation,
  type TrainingAction,
  type TrainingConfig,
  type TrainingExercise,
  type TrainingFilters,
  type TrainingOptions,
  type TrainingReport,
  type TrainingSession,
  type TrainingType,
} from "../lib/training";

const EMPTY_OPTIONS: TrainingOptions = { trainingTypes: [], equityModels: [], stackDepthsBb: [], heroPositions: [], hasMatches: false };

export function TrainingSetup({ preferredType, onClose, onStarted }: { preferredType?: TrainingType; onClose: () => void; onStarted: (session: TrainingSession) => void }) {
  const [filters, setFilters] = useState<TrainingFilters>({ trainingType: preferredType });
  const [targetQuestions, setTargetQuestions] = useState<TrainingConfig["targetQuestions"]>(50);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
    return params.toString();
  }, [filters]);
  const loading = loadedQuery !== filterQuery;

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
      .finally(() => { if (!controller.signal.aborted) setLoadedQuery(filterQuery); });
    return () => controller.abort();
  }, [filterQuery]);

  const config = buildConfig(filters, targetQuestions, options.hasMatches);
  const noStudies = !loading && options.trainingTypes.length === 0;

  async function start() {
    if (!config || starting) return;
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "START", config }) });
      const data = await response.json() as TrainingSession & { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar o treinamento.");
      onStarted(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar o treinamento.");
    } finally {
      setStarting(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="setup-card training-setup-card simplified-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <button className="close-button" aria-label="Fechar" onClick={onClose}>×</button>
      <div className="setup-heading"><span>CONFIGURAÇÃO DO TREINO</span><h2 id="setup-title">Prepare sua sessão</h2><p>Escolha apenas o foco. Os detalhes do solver vêm automaticamente dos estudos publicados.</p></div>

      <div className="setup-group"><label>Tipo de treinamento</label><div className="training-type-grid">{TRAINING_TYPES.map((type) => {
        const available = options.trainingTypes.includes(type);
        return <button key={type} type="button" disabled={!available || loading} className={filters.trainingType === type ? "selected" : ""} onClick={() => setFilters({ trainingType: type })}>
          <b>{trainingTypeLabels[type]}</b><small>{trainingTypeDescriptions[type]}</small>{!loading && !available && <i>Sem estudo</i>}
        </button>;
      })}</div></div>

      {loading && options.trainingTypes.length === 0 ? <div className="setup-loading"><i/><span>Consultando estudos disponíveis…</span></div> : noStudies ? <EmptyStudies/> : <>
        <div className="setup-group setup-field-block"><label>Modelo</label><div className="choice-grid compact model-choice-grid">{EQUITY_MODELS.map((model) => <button type="button" key={model} disabled={!options.equityModels.includes(model)} className={filters.equityModel === model ? "selected" : ""} onClick={() => setFilters((current) => ({ trainingType: current.trainingType, equityModel: model }))}>{equityModelLabels[model]}</button>)}</div></div>
        <div className="setup-row setup-select-row">
          <SelectField label="Stack efetivo" value={filters.stackDepthBb ?? ""} disabled={!filters.equityModel || !options.stackDepthsBb.length} onChange={(value) => setFilters((current) => ({ ...current, stackDepthBb: value ? Number(value) : undefined, heroPosition: undefined }))} options={[{ value: "", label: "Todas" }, ...options.stackDepthsBb.map((stack) => ({ value: stack, label: `${formatBb(stack)} BB` }))]}/>
          <SelectField label="Posição do Hero" value={filters.heroPosition ?? ""} disabled={!filters.equityModel || !options.heroPositions.length} onChange={(value) => setFilters((current) => ({ ...current, heroPosition: value || undefined }))} options={[{ value: "", label: "Todas" }, ...options.heroPositions.map(asOption)]}/>
        </div>
        <SelectField label="Quantidade de mãos" value={targetQuestions ?? "FREE"} disabled={false} onChange={(value) => setTargetQuestions(value === "FREE" ? null : Number(value) as TrainingConfig["targetQuestions"])} options={[...QUESTION_COUNTS.map((count) => ({ value: count, label: `${count} mãos` })), { value: "FREE", label: "Treino livre" }]}/>
      </>}

      {error && <div className="setup-error" role="alert">{error}</div>}
      <button className="start-button" disabled={!config || loading || starting} onClick={start}>{starting ? "Montando a fila…" : "Começar treino"}<span>{starting ? "" : "→"}</span></button>
    </section>
  </div>;
}

export function DatabaseTrainer({ session, onExit, onStarted }: { session: TrainingSession; onExit: () => void; onStarted: (session: TrainingSession) => void }) {
  const [exercise, setExercise] = useState(session.exercise);
  const [stats, setStats] = useState({ answered: session.answeredQuestions, correct: session.correctAnswers });
  const [choice, setChoice] = useState<TrainingAction | null>(null);
  const [answer, setAnswer] = useState<AnswerEvaluation | null>(null);
  const [nextExercise, setNextExercise] = useState<TrainingExercise | null>(null);
  const [pendingReport, setPendingReport] = useState<TrainingReport | null>(null);
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)));

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - session.startedAt) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [session.startedAt]);

  if (report) return <TrainingReportView report={report} onExit={onExit} onStarted={onStarted}/>;

  async function choose(selected: TrainingAction) {
    if (choice || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "ANSWER", sessionId: session.id, trainingNodeId: exercise.trainingNodeId, trainingHandId: exercise.trainingHandId, selectedAction: actionKey(selected) }) });
      const data = await response.json() as { answer: AnswerEvaluation; answeredQuestions: number; correctAnswers: number; nextExercise: TrainingExercise | null; report: TrainingReport | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a resposta.");
      setChoice(selected);
      setAnswer(data.answer);
      setStats({ answered: data.answeredQuestions, correct: data.correctAnswers });
      setNextExercise(data.nextExercise);
      setPendingReport(data.report);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível salvar a resposta.");
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    if (pendingReport) { setReport(pendingReport); return; }
    if (!nextExercise) return;
    setExercise(nextExercise);
    setChoice(null);
    setAnswer(null);
    setNextExercise(null);
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "FINISH", sessionId: session.id }) });
      const data = await response.json() as { report: TrainingReport; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível finalizar o treino.");
      setReport(data.report);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível finalizar o treino.");
    } finally {
      setBusy(false);
    }
  }

  const accuracy = stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0;
  const cards = handClassCards(exercise.handClass);
  const history = exercise.actionSequence.map(formatSequenceAction);
  const progress = session.targetQuestions ? `${stats.answered} / ${session.targetQuestions}` : `${stats.answered} respondidas`;

  return <main className="training-screen"><header className="trainer-topbar"><button className="brand brand-button" onClick={onExit}><span className="brand-mark">R</span><span>Range<span>Lab</span></span></button><div className="spot-context"><span>{trainingTypeLabels[exercise.trainingType]}</span><b>{equityModelLabels[exercise.equityModel]} · {formatBb(exercise.heroStackBb)} BB · {exercise.heroPosition}</b></div><button className="exit-button finish-training-button" disabled={busy} onClick={finish}>Finalizar treino</button></header>
    <div className="hrc-pack-bar"><span><i>✓</i> {exercise.setName}</span><div><b>{progress}</b><em>•</em> Acertos: {stats.correct}<em>•</em> {accuracy}%<em>•</em> {formatDuration(elapsed)}</div></div>
    <section className="trainer-layout"><div className="practice-column"><div className="table-meta"><span><i/> SPOT · {exercise.heroPosition} · {formatBb(exercise.heroStackBb)} BB</span><div>{history.map((item, index) => <small key={`${item}-${index}`}>{item}</small>)}</div></div>
      <div className="hrc-table-shell"><div className="hrc-table"><div className="trainer-inner-line"/>{exercise.villainPosition && <div className="game-seat hrc-villain"><span>{exercise.villainPosition}</span><b>{formatBb(exercise.heroStackBb)} BB efetivos</b><small>{history.at(-1)?.toUpperCase() || "AGUARDA"}</small></div>}<div className="center-pot"><span>BLINDS</span><b>{formatBlinds(exercise.blinds)}</b></div><div className="trainer-hero-cards"><TrainingCard rank={cards[0]} suit={cards[1]}/><TrainingCard rank={cards[2]} suit={cards[3]}/></div><div className="game-seat game-hero"><span>VOCÊ · {exercise.heroPosition}</span><b>{formatBb(exercise.heroStackBb)} BB</b><small>SUA AÇÃO</small></div><span className="hrc-player-note">{exercise.playersCount} jogadores no estudo</span></div></div>
      <div className="decision-panel"><div className="decision-copy"><span>MÃO · {exercise.handClass}</span><h1>{buildPrompt(exercise.trainingType, exercise.heroPosition, exercise.villainPosition, exercise.handClass)}</h1><p>Escolha antes de ver as frequências e os EVs armazenados no estudo.</p></div>
        {!answer && <div className={`hrc-action-grid actions-${exercise.availableActions.length}`}>{exercise.availableActions.map((action) => <button key={actionKey(action)} disabled={busy} onClick={() => choose(action)}><span>{actionIcon(action)}</span><b>{actionLabel(action, exercise)}</b><small>{typeof action.amountBb === "number" ? `${formatBb(action.amountBb)} BB` : ""}</small></button>)}</div>}
        {answer && choice && <div className={`feedback ${answer.correct ? "feedback-good" : "feedback-bad"}`}><div className="verdict-icon">{answer.correct ? "✓" : "!"}</div><div className="feedback-main"><span>{answer.correct ? "DECISÃO RECOMENDADA" : "REVEJA ESTA DECISÃO"}</span><h2>{answer.correct ? "Sua ação tem o melhor EV deste spot." : `A linha de maior EV é ${answer.bestLabel}.`}</h2><p>O resultado foi validado e persistido pelo servidor.</p><div className="solver-result-list">{exercise.availableActions.map((action) => { const key = actionKey(action); const frequency = recordValue(answer.strategy, action); const frequencyPercent = frequency === null ? null : formatPercent(frequency); const ev = recordValue(answer.evs, action); return <div key={key} className={`${key === answer.selectedKey ? "chosen" : ""} ${key === answer.bestKey ? "best" : ""}`}><span>{actionLabel(action, exercise)}</span><div className="frequency-track"><i style={{ width: `${Math.max(0, Math.min(100, frequencyPercent ?? 0))}%` }}/></div><b>{frequencyPercent === null ? "—" : `${frequencyPercent}%`}</b><small>{ev === null ? "EV —" : `EV ${Number(ev.toFixed(4))}`}</small></div>; })}</div><div className="feedback-bottom"><small>Frequências e EVs são snapshots do estudo usado nesta pergunta.</small><button onClick={advance}>{pendingReport ? "Ver resultado" : "Próxima mão"} →</button></div></div></div>}
        {error && <div className="setup-error trainer-error" role="alert">{error}</div>}
      </div></div>
      <aside className="stats-rail"><div className="session-card"><div className="rail-title"><span>SESSÃO ATUAL</span><i>● ao vivo</i></div><div className="session-progress-count">{progress}</div><div className="accuracy-ring" style={{ "--accuracy": `${accuracy * 3.6}deg` } as React.CSSProperties}><div><b>{accuracy}%</b><span>acerto</span></div></div><div className="stat-row"><div><span>Respostas</span><b>{stats.answered}</b></div><div><span>Acertos</span><b className="green-text">{stats.correct}</b></div><div><span>Tempo</span><b>{formatDuration(elapsed)}</b></div></div></div><div className="concept-card"><span>FILTROS</span><div><i>{trainingTypeLabels[session.config.trainingType]}</i><i>{equityModelLabels[session.config.equityModel]}</i><i>{session.config.stackDepthBb ? `${formatBb(session.config.stackDepthBb)} BB` : "Todos os stacks"}</i><i>{session.config.heroPosition ?? "Todas as posições"}</i></div></div></aside>
    </section></main>;
}

function TrainingReportView({ report, onExit, onStarted }: { report: TrainingReport; onExit: () => void; onStarted: (session: TrainingSession) => void }) {
  const [starting, setStarting] = useState<"REPEAT" | "REVIEW_ERRORS" | null>(null);
  const [error, setError] = useState("");
  async function start(mode: "REPEAT" | "REVIEW_ERRORS") {
    setStarting(mode);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, sourceSessionId: report.sessionId }) });
      const data = await response.json() as TrainingSession & { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar a sessão.");
      onStarted(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar a sessão.");
    } finally {
      setStarting(null);
    }
  }
  return <main className="training-screen report-screen"><header className="trainer-topbar"><button className="brand brand-button" onClick={onExit}><span className="brand-mark">R</span><span>Range<span>Lab</span></span></button><div className="spot-context"><span>RESULTADO</span><b>{report.completionReason === "COMPLETED" ? "Treino concluído" : "Treino finalizado"}</b></div><button className="exit-button" onClick={onExit}>Voltar ao início</button></header>
    <section className="training-report"><div className="report-hero"><span>{report.completionReason === "COMPLETED" ? "TREINO CONCLUÍDO" : "SESSÃO FINALIZADA"}</span><h1>{report.correctAnswers} / {report.answeredQuestions} corretas</h1><p>{report.accuracy}% de acerto · {formatDuration(report.durationSeconds)}</p><div><i>{trainingTypeLabels[report.trainingType]}</i><i>{equityModelLabels[report.equityModel]}</i><i>{report.stackDepthBb === null ? "Stack: Todas" : `Stack: ${formatBb(report.stackDepthBb)} BB`}</i><i>{report.heroPosition === null ? "Posição: Todas" : `Posição: ${report.heroPosition}`}</i></div></div>
      <div className="report-stat-grid"><article><span>Respondidas</span><b>{report.answeredQuestions}</b></article><article><span>Acertos</span><b className="green-text">{report.correctAnswers}</b></article><article><span>Erros</span><b className="red-text">{report.errors}</b></article><article><span>Média por resposta</span><b>{report.averageSeconds === null ? "—" : `${report.averageSeconds}s`}</b></article></div>
      <div className="report-grid">{report.byPosition.length > 0 && <ReportSection title="Por posição"><div className="report-bars">{report.byPosition.map((group) => <div key={group.label}><span>{group.label}</span><i><b style={{ width: `${group.accuracy}%` }}/></i><strong>{group.accuracy}%</strong><small>{group.answered} resp.</small></div>)}</div></ReportSection>}
        {report.mostMissedHands.length > 0 && <ReportSection title="Mãos com mais erros"><div className="missed-hands">{report.mostMissedHands.map((hand) => <div key={hand.handClass}><b>{hand.handClass}</b><span>{hand.errors} erro{hand.errors > 1 ? "s" : ""}</span></div>)}</div></ReportSection>}
        {report.byDecisionType.length > 0 && <ReportSection title="Clareza da decisão"><div className="decision-groups">{report.byDecisionType.map((group) => <div key={group.label}><span>{group.label}</span><b>{group.accuracy}%</b><small>{group.answered} respostas</small></div>)}</div></ReportSection>}
        {report.feedback.length > 0 && <ReportSection title="Feedback objetivo"><ul className="report-feedback">{report.feedback.map((item) => <li key={item}>{item}</li>)}</ul></ReportSection>}
        {report.errorDetails.length > 0 && <ReportSection title="Erros da sessão"><div className="error-review-list">{report.errorDetails.map((item, index) => <div key={`${item.handClass}-${item.heroPosition}-${index}`}><b>{item.handClass}</b><span>{item.heroPosition}</span><small>{item.selectedAction} → {item.bestAction}</small></div>)}</div></ReportSection>}
      </div>
      {error && <div className="setup-error" role="alert">{error}</div>}
      <div className="report-actions"><button disabled={starting !== null} onClick={() => start("REPEAT")}>{starting === "REPEAT" ? "Preparando…" : "Treinar novamente"}</button>{report.errors > 0 ? <button className="primary" disabled={starting !== null} onClick={() => start("REVIEW_ERRORS")}>{starting === "REVIEW_ERRORS" ? "Preparando…" : `Revisar erros (${report.errors})`}</button> : <span>Nenhum erro para revisar.</span>}</div>
    </section></main>;
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) { return <article className="report-section"><h2>{title}</h2>{children}</article>; }

function normalizeFilters(current: TrainingFilters, options: TrainingOptions): TrainingFilters {
  const trainingType = current.trainingType && options.trainingTypes.includes(current.trainingType) ? current.trainingType : undefined;
  const equityModel = current.equityModel && options.equityModels.includes(current.equityModel) ? current.equityModel : undefined;
  const stackDepthBb = current.stackDepthBb && options.stackDepthsBb.includes(current.stackDepthBb) ? current.stackDepthBb : undefined;
  const heroPosition = current.heroPosition && options.heroPositions.includes(current.heroPosition) ? current.heroPosition : undefined;
  return { trainingType, equityModel, stackDepthBb, heroPosition };
}

function buildConfig(filters: TrainingFilters, targetQuestions: TrainingConfig["targetQuestions"], hasMatches: boolean): TrainingConfig | null {
  if (!hasMatches || !filters.trainingType || !filters.equityModel) return null;
  return { trainingType: filters.trainingType, equityModel: filters.equityModel, stackDepthBb: filters.stackDepthBb, heroPosition: filters.heroPosition, targetQuestions };
}

function SelectField({ label, value, options, disabled, onChange }: { label: string; value: string | number; options: Array<{ value: string | number; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="setup-group"><label>{label}</label><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={String(option.value) || "all"} value={option.value}>{option.label}</option>)}</select></div>;
}

function EmptyStudies() { return <div className="setup-empty"><span>∅</span><div><b>Nenhum estudo publicado disponível.</b><p>As opções aparecem automaticamente quando existe um estudo HRC compatível publicado.</p></div></div>; }
function asOption(value: string) { return { value, label: value === "BU" ? "BU (Button)" : value === "BTN" ? "BTN (Button)" : value }; }
function formatBlinds(value: TrainingExercise["blinds"]) { return `${formatBb(value.smallBlind)} / ${formatBb(value.bigBlind)}${value.ante ? ` · ante ${formatBb(value.ante)}` : ""}`; }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return minutes ? `${minutes}m ${rest.toString().padStart(2, "0")}s` : `${rest}s`; }

function handClassCards(handClass: string): [string, string, string, string] { const clean = handClass.trim(); return clean.length === 2 ? [clean[0], "♠", clean[1], "♥"] : [clean[0], "♠", clean[1], clean.endsWith("s") ? "♠" : "♥"]; }
function TrainingCard({ rank, suit }: { rank: string; suit: string }) { const red = suit === "♥" || suit === "♦"; return <div className={`playing-card ${red ? "red-suit" : "black-suit"}`}><span>{rank}</span><b>{suit}</b></div>; }
function formatSequenceAction(action: { position?: string; type: string; amountBb?: number; label?: string }) { if (action.label) return action.label; return `${action.position ?? "Ação"} ${action.type.toLowerCase()}${typeof action.amountBb === "number" ? ` ${formatBb(action.amountBb)} BB` : ""}`; }
function buildPrompt(type: TrainingType, hero: string, villain: string | null, hand: string) { if (type === "CALL_VS_SHOVE") return `${villain ?? "O vilão"} foi all-in. Você está no ${hero} com ${hand}. Call ou fold?`; if (type === "VS_OPEN") return `${villain ?? "O vilão"} abriu. Você está no ${hero} com ${hand}. Qual é sua resposta?`; if (type === "OPEN_FOLD") return `A ação chegou em fold até você no ${hero}. O que fazer com ${hand}?`; return `Você está no ${hero} com ${hand}. Push ou fold?`; }
function actionIcon(action: TrainingAction) { if (action.type === "FOLD") return "×"; if (action.type === "CALL") return "●"; if (action.type === "CHECK") return "✓"; return action.type === "RAISE" ? "▲" : "◆"; }
function formatPercent(value: number) { return Number((value <= 1 ? value * 100 : value).toFixed(1)); }
