"use client";

import { useEffect, useMemo, useState } from "react";
import { TrainingDecision, TrainingTablePreview } from "../components/training/TrainingDecision";
import {
  EQUITY_MODELS,
  QUESTION_COUNTS,
  TRAINING_TYPES,
  actionKey,
  equityModelLabels,
  evaluateChoice,
  formatBb,
  gameTypeLabels,
  trainingTypeDescriptions,
  trainingTypeLabels,
  type TrainingAction,
  type AnswerEvaluation,
  type TrainingConfig,
  type TrainingExercise,
  type TrainingFilters,
  type TrainingOptions,
  type TrainingReport,
  type TrainingSession,
  type TrainingMode,
  type TrainingType,
} from "../lib/training";

const EMPTY_OPTIONS: TrainingOptions = { trainingTypes: [], equityModels: [], stackDepthsBb: [], heroPositions: [], hasMatches: false, tableContext: null };
const ACTIVE_TRAINING_MODE: TrainingMode = "DECISION";

type PendingSpotFeedback = {
  answer: AnswerEvaluation;
  selectedKey: string;
  nextExercise: TrainingExercise | null;
  report: TrainingReport | null;
};

export function TrainingSetup({ preferredType, initialFilters, initialTargetQuestions = 50, onClose, onStarted, embedded = false }: { preferredType?: TrainingType; initialFilters?: TrainingFilters; initialTargetQuestions?: TrainingConfig["targetQuestions"]; onClose?: () => void; onStarted: (session: TrainingSession) => void; embedded?: boolean }) {
  const [filters, setFilters] = useState<TrainingFilters>(initialFilters ?? { trainingType: preferredType });
  const [targetQuestions, setTargetQuestions] = useState<TrainingConfig["targetQuestions"]>(initialTargetQuestions);
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

  const panel = <section className={`setup-card training-setup-card simplified-setup ${embedded ? "training-setup-embedded" : ""}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="setup-title">
      {!embedded && <button className="close-button" aria-label="Fechar" onClick={onClose}>×</button>}
      <div className="setup-heading"><span>CONFIGURAÇÃO DO TREINO</span><h2 id="setup-title">Prepare sua sessão</h2><p>Escolha o foco e o modelo. Os estudos publicados definem as mãos disponíveis.</p></div>
      <TrainingModeSelector/>
      <div className="setup-group"><label>Tipo de treinamento</label><div className="training-type-grid">{TRAINING_TYPES.map((type) => {
        const available = options.trainingTypes.includes(type);
        return <button key={type} type="button" disabled={!available || loading} className={filters.trainingType === type ? "selected" : ""} onClick={() => setFilters({ trainingType: type })}>
          <b>{trainingTypeLabels[type]}</b><small>{trainingTypeDescriptions[type]}</small>{!loading && !available && <i>Sem estudo</i>}
        </button>;
      })}</div></div>
      {loading && options.trainingTypes.length === 0 ? <div className="setup-loading"><i/><span>Consultando estudos disponíveis…</span></div> : noStudies ? <EmptyStudies/> : <>
        <div className="setup-model-row">
          <div className="setup-group"><label>Modelo</label><div className="choice-grid compact model-choice-grid">{EQUITY_MODELS.map((model) => <button type="button" key={model} disabled={!options.equityModels.includes(model)} className={filters.equityModel === model ? "selected" : ""} onClick={() => setFilters((current) => ({ trainingType: current.trainingType, equityModel: model }))}>{equityModelLabels[model]}</button>)}</div></div>
          <SelectField label="Quantidade de mãos" value={targetQuestions ?? "FREE"} disabled={false} onChange={(value) => setTargetQuestions(value === "FREE" ? null : Number(value) as TrainingConfig["targetQuestions"])} options={[...QUESTION_COUNTS.map((count) => ({ value: count, label: `${count} mãos` })), { value: "FREE", label: "Treino livre" }]}/>
        </div>
        <div className="setup-row setup-select-row">
          <SelectField label="Stack efetivo" value={filters.stackDepthBb ?? ""} disabled={!filters.equityModel || !options.stackDepthsBb.length} onChange={(value) => setFilters((current) => ({ ...current, stackDepthBb: value ? Number(value) : undefined, heroPosition: undefined }))} options={[{ value: "", label: "Todas" }, ...options.stackDepthsBb.map((stack) => ({ value: stack, label: `${formatBb(stack)} BB` }))]}/>
          <SelectField label="Posição do Hero" value={filters.heroPosition ?? ""} disabled={!filters.equityModel || !options.heroPositions.length} onChange={(value) => setFilters((current) => ({ ...current, heroPosition: value || undefined }))} options={[{ value: "", label: "Todas" }, ...options.heroPositions.map(asOption)]}/>
        </div>
      </>}
      {error && <div className="setup-error" role="alert">{error}</div>}
      <button className="start-button" disabled={!config || loading || starting} onClick={start}>{starting ? "Montando a fila…" : "Começar treinamento"}<span>{starting ? "" : "▶"}</span></button>
    </section>;
  if (embedded) return panel;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>{panel}</div>;
}

const QUICK_PREFLOP_ACTIONS: Array<{ id: string; label: string; type?: TrainingType }> = [
  { id: "ANY", label: "Qualquer" },
  { id: "RFI", label: "RFI", type: "OPEN_FOLD" },
  { id: "VS_OPEN", label: "vs Open", type: "VS_OPEN" },
  { id: "VS_3_BET", label: "vs 3-bet" },
  { id: "PUSH_FOLD", label: "Push / Fold", type: "PUSH_FOLD" },
  { id: "VS_SHOVE", label: "vs Shove", type: "CALL_VS_SHOVE" },
  { id: "VS_4_BET", label: "vs 4-bet" },
  { id: "FROM_START", label: "Desde o início" },
];

export function TrainingQuickSetup({ onStarted }: { onStarted: (session: TrainingSession) => void }) {
  const [filters, setFilters] = useState<TrainingFilters>({});
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState("");
  const targetQuestions: TrainingConfig["targetQuestions"] = 50;
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
        setFilters((current) => {
          const normalized = normalizeFilters(current, data);
          return { ...normalized, equityModel: normalized.equityModel ?? data.equityModels[0] };
        });
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

  const config = buildConfig(filters, targetQuestions, options.hasMatches, true);
  const modelLabel = options.tableContext
    ? `${gameTypeLabels[options.tableContext.gameType]} • ${equityModelLabels[options.tableContext.equityModel]}`
    : "Nenhum modelo disponível";

  function cycleModel() {
    if (options.equityModels.length < 2) return;
    const currentIndex = filters.equityModel ? options.equityModels.indexOf(filters.equityModel) : -1;
    const nextModel = options.equityModels[(currentIndex + 1) % options.equityModels.length];
    setFilters((current) => ({ trainingType: current.trainingType, equityModel: nextModel }));
  }

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

  return <>
    <div className="training-lobby-table">
      <TrainingTablePreview context={loading ? null : options.tableContext} loading={loading}/>
    </div>
    <section className="training-quick-setup" aria-label="Configuração rápida do treino">
      <div className="quick-setup-group quick-solution">
        <label>Modelo</label>
        <div><button type="button" disabled={!options.tableContext || loading} onClick={cycleModel} aria-label={`Modelo ${modelLabel}`} title={options.tableContext?.studyName}>{modelLabel}</button><button type="button" className="quick-settings-icon" aria-label="Abrir todas as configurações" onClick={() => setAdvancedOpen(true)}>⚙</button></div>
      </div>
      <TrainingModeSelector compact/>
      <div className="quick-setup-group quick-preflop-action">
        <label>Ação pré-flop <small title="Situação enfrentada pelo Hero">?</small></label>
        <div>{QUICK_PREFLOP_ACTIONS.map((item) => {
          const isAny = item.id === "ANY";
          const available = isAny ? options.trainingTypes.length > 0 : item.type ? options.trainingTypes.includes(item.type) : false;
          const selected = isAny ? available && !filters.trainingType : item.type === filters.trainingType;
          return <button type="button" key={item.id} disabled={!available || loading} title={available ? undefined : item.type ? "Nenhum estudo publicado para esta categoria" : "Ainda não há suporte para este filtro"} className={selected ? "selected" : ""} onClick={() => {
            if (isAny) setFilters((current) => ({ equityModel: current.equityModel }));
            else if (item.type) setFilters((current) => ({ trainingType: item.type, equityModel: current.equityModel }));
          }}>{item.label}</button>;
        })}</div>
      </div>
      {error && <div className="setup-error quick-setup-error" role="alert">{error}</div>}
      {!loading && !options.hasMatches && !error && <div className="quick-empty-studies">Importe um estudo para iniciar um treinamento.</div>}
      <div className="quick-setup-actions"><button type="button" className="quick-all-settings" onClick={() => setAdvancedOpen(true)}><span>⚙</span> Todas as configurações</button><button type="button" className="quick-start-training" disabled={!config || loading || starting} onClick={start}><span>▶</span>{starting ? "Preparando…" : "Iniciar treino"}</button></div>
    </section>
    {advancedOpen && <TrainingSetup
      initialFilters={filters}
      initialTargetQuestions={targetQuestions}
      onClose={() => setAdvancedOpen(false)}
      onStarted={(session) => { setAdvancedOpen(false); onStarted(session); }}
    />}
  </>;
}

function TrainingModeSelector({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "quick-setup-group quick-training-mode" : "setup-experience-switch"}>
    <label>Modo de treino</label>
    <div>
      <button type="button" className="selected" aria-pressed={ACTIVE_TRAINING_MODE === "DECISION"}>Decisão</button>
      <button type="button" disabled aria-disabled="true" title="Em desenvolvimento">Mão completa <small>Em desenvolvimento</small></button>
    </div>
  </div>;
}

export function DatabaseTrainer({ session, onReport }: { session: TrainingSession; onReport: (report: TrainingReport) => void }) {
  const [exercise, setExercise] = useState(session.exercise);
  const [answeredQuestions, setAnsweredQuestions] = useState(session.answeredQuestions);
  const [feedback, setFeedback] = useState<PendingSpotFeedback | null>(null);
  const [retryContext, setRetryContext] = useState<PendingSpotFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)));

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - session.startedAt) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [session.startedAt]);

  async function choose(selected: TrainingAction) {
    if (busy || feedback) return;
    if (retryContext) {
      const retry = evaluateChoice(actionKey(selected), exercise.availableActions, retryContext.answer.bestKey, retryContext.answer.evs, retryContext.answer.strategy);
      if (!retry) {
        setError("Esta ação não está disponível neste spot.");
        return;
      }
      setFeedback({
        ...retryContext,
        selectedKey: retry.selectedKey,
        answer: {
          ...retryContext.answer,
          correct: retry.correct,
          selectedKey: retry.selectedKey,
          bestKey: retry.bestKey,
          bestLabel: retry.bestLabel,
        },
      });
      setRetryContext(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "ANSWER", sessionId: session.id, questionIndex: answeredQuestions, trainingNodeId: exercise.trainingNodeId, trainingHandId: exercise.trainingHandId, selectedAction: actionKey(selected) }) });
      const data = await response.json() as { answer: AnswerEvaluation; answeredQuestions: number; nextExercise: TrainingExercise | null; report: TrainingReport | null; replayed: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a resposta.");
      setAnsweredQuestions(data.answeredQuestions);
      if (!data.answer || (!data.report && !data.nextExercise)) {
        throw new Error("Não foi possível carregar o próximo spot.");
      }
      setFeedback({ answer: data.answer, selectedKey: actionKey(selected), nextExercise: data.nextExercise, report: data.report });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível salvar a resposta.");
    } finally {
      setBusy(false);
    }
  }

  function repeatSpot() {
    if (!feedback) return;
    setRetryContext(feedback);
    setFeedback(null);
    setError("");
  }

  function advanceSpot() {
    if (!feedback) return;
    if (feedback.report) {
      onReport(feedback.report);
      return;
    }
    if (!feedback.nextExercise) return;
    setExercise(feedback.nextExercise);
    setFeedback(null);
    setRetryContext(null);
    setError("");
  }

  async function finish() {
    if (busy) return;
    if (feedback?.report) {
      onReport(feedback.report);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "FINISH", sessionId: session.id }) });
      const data = await response.json() as { report: TrainingReport; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível finalizar o treino.");
      onReport(data.report);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível finalizar o treino.");
    } finally {
      setBusy(false);
    }
  }

  const currentHand = feedback || retryContext ? answeredQuestions : answeredQuestions + 1;
  const progress = session.targetQuestions ? `${Math.min(currentHand, session.targetQuestions)} / ${session.targetQuestions}` : `${currentHand}`;
  return <section className="inline-training-session" aria-label="Sessão de treinamento">
    <header className="spot-session-toolbar">
      <div><span>Modelo</span><b>{equityModelLabels[exercise.equityModel]}</b></div>
      <div><span>Mãos</span><b>{progress}</b></div>
      <div><span>Tempo</span><b>{formatDuration(elapsed)}</b></div>
      <button type="button" disabled={busy} onClick={finish}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4m0 1h9l3 3-3 3H6"/></svg>Finalizar treino</button>
    </header>
    <TrainingDecision
      exercise={exercise}
      busy={busy}
      feedback={feedback}
      nextLabel={feedback?.report ? "Ver análise final" : "Próximo spot"}
      onChoose={choose}
      onRepeat={repeatSpot}
      onNext={advanceSpot}
    />
    {error && <div className="setup-error trainer-error" role="alert">{error}</div>}
  </section>;
}

export function TrainingReportView({ report, onExit, onStarted }: { report: TrainingReport; onExit: () => void; onStarted: (session: TrainingSession) => void }) {
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
  return <main className="training-screen report-screen"><header className="trainer-topbar"><button className="brand brand-button" onClick={onExit}><span className="brand-mark">R</span><span>Range<span>Lab</span></span></button><div className="spot-context"><span>ANÁLISE FINAL</span><b>{report.completionReason === "COMPLETED" ? "Treino concluído" : "Treino finalizado"}</b></div><button className="exit-button" onClick={onExit}>Voltar aos treinos</button></header>
    <section className="training-report"><div className="report-hero"><span>ANÁLISE COMPLETA DA SESSÃO</span><h1>{report.correctAnswers} / {report.answeredQuestions} corretas</h1><p>{report.accuracy}% de acerto · {formatDuration(report.durationSeconds)}</p><div><i>{report.trainingType === null ? "Todos os spots" : trainingTypeLabels[report.trainingType]}</i><i>{equityModelLabels[report.equityModel]}</i><i>{report.stackDepthBb === null ? "Stack: Todas" : `Stack: ${formatBb(report.stackDepthBb)} BB`}</i><i>{report.heroPosition === null ? "Posição: Todas" : `Posição: ${report.heroPosition}`}</i></div></div>
      {report.detailsTruncated && <p className="progress-footnote" role="status">Os totais cobrem a sessão completa; os agrupamentos e erros abaixo usam somente as {report.detailAnswers} respostas mais recentes.</p>}
      <div className="report-stat-grid"><article><span>Respondidas</span><b>{report.answeredQuestions}</b></article><article><span>Acertos</span><b className="green-text">{report.correctAnswers}</b></article><article><span>Erros</span><b className="red-text">{report.errors}</b></article><article><span>Média por resposta</span><b>{report.averageSeconds === null ? "—" : `${report.averageSeconds}s`}</b></article></div>
      <div className="report-grid">
        {report.byPosition.length > 0 && <ReportSection title="Por posição"><div className="report-bars">{report.byPosition.map((group) => <div key={group.label}><span>{group.label}</span><i><b style={{ width: `${group.accuracy}%` }}/></i><strong>{group.accuracy}%</strong><small>{group.answered} resp.</small></div>)}</div></ReportSection>}
        {report.mostMissedHands.length > 0 && <ReportSection title="Mãos com mais erros"><div className="missed-hands">{report.mostMissedHands.map((hand) => <div key={hand.handClass}><b>{hand.handClass}</b><span>{hand.errors} erro{hand.errors > 1 ? "s" : ""}</span></div>)}</div></ReportSection>}
        {report.byDecisionType.length > 0 && <ReportSection title="Clareza da decisão"><div className="decision-groups">{report.byDecisionType.map((group) => <div key={group.label}><span>{group.label}</span><b>{group.accuracy}%</b><small>{group.answered} respostas</small></div>)}</div></ReportSection>}
        {report.feedback.length > 0 && <ReportSection title="Feedback objetivo"><ul className="report-feedback">{report.feedback.map((item) => <li key={item}>{item}</li>)}</ul></ReportSection>}
        {report.decisionDetails.length > 0 && <ReportSection title="Revisão de todas as decisões" wide><div className="report-decision-list">{report.decisionDetails.map((detail) => <DecisionReview key={detail.questionIndex} detail={detail}/>)}</div></ReportSection>}
      </div>
      {error && <div className="setup-error" role="alert">{error}</div>}
      <div className="report-actions"><button disabled={starting !== null} onClick={() => start("REPEAT")}>{starting === "REPEAT" ? "Preparando…" : "Treinar novamente"}</button>{report.detailsAvailable && report.errors > 0 ? <button className="primary" disabled={starting !== null} onClick={() => start("REVIEW_ERRORS")}>{starting === "REVIEW_ERRORS" ? "Preparando…" : "Revisar erros recentes (até 100)"}</button> : report.errors === 0 ? <span>Nenhum erro para revisar.</span> : <span>Revisão por mão indisponível para este resumo histórico.</span>}</div>
    </section>
  </main>;
}

function ReportSection({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) { return <article className={`report-section ${wide ? "report-section-wide" : ""}`}><h2>{title}</h2>{children}</article>; }

function DecisionReview({ detail }: { detail: TrainingReport["decisionDetails"][number] }) {
  const strategyTotal = Object.values(detail.strategy).reduce((sum, value) => sum + value, 0);
  return <details className={`report-decision ${detail.isCorrect ? "correct" : "incorrect"}`} open={!detail.isCorrect}>
    <summary>
      <span>#{detail.questionIndex + 1}</span><b>{detail.handClass}</b><i>{detail.heroPosition}</i>
      <small>{reportActionLabel(detail.selectedAction)} → {reportActionLabel(detail.bestAction)}</small>
      <strong>{detail.isCorrect ? "Na estratégia" : "Revisar"}</strong>
    </summary>
    <div className="report-decision-body">
      <p>{detail.isMixed ? "Estratégia mista: mais de uma ação faz parte da solução." : "Estratégia predominante para esta mão."}</p>
      <div className="report-strategy-grid">{Object.entries(detail.strategy).map(([key, value]) => {
        const frequency = strategyTotal > 1.0001 ? value : value * 100;
        const ev = detail.evs[key];
        const selected = key === detail.selectedKey;
        const best = key === detail.bestAction;
        return <div key={key} className={`${selected ? "selected" : ""} ${best ? "best" : ""}`}>
          <span>{reportActionLabel(key)}{selected ? " · sua escolha" : best ? " · maior EV" : ""}</span>
          <b>{Number(frequency.toFixed(1))}%</b>
          <small>EV {typeof ev === "number" ? formatReportEv(ev, detail.evUnit) : "—"}</small>
        </div>;
      })}</div>
    </div>
  </details>;
}

function reportActionLabel(value: string) {
  const normalized = value.toLowerCase().replace(/[_-]/g, " ");
  if (normalized.includes("fold")) return "Fold";
  if (normalized.includes("check")) return "Check";
  if (normalized.includes("call")) return "Call";
  if (normalized.includes("all in") || normalized.includes("shove")) return "All-in";
  if (normalized.includes("bet")) return "Bet";
  if (normalized.includes("raise") || normalized.includes("open")) return "Raise";
  return value;
}

function formatReportEv(value: number, unit: TrainingReport["decisionDetails"][number]["evUnit"]) {
  const formatted = Number(value.toFixed(4));
  if (unit === "BIG_BLINDS") return `${formatted} BB`;
  if (unit === "CHIPS") return `${formatted} fichas`;
  if (unit === "ICM_UTILITY") return `${formatted} ICM`;
  return String(formatted);
}

function normalizeFilters(current: TrainingFilters, options: TrainingOptions): TrainingFilters {
  const trainingType = current.trainingType && options.trainingTypes.includes(current.trainingType) ? current.trainingType : undefined;
  const equityModel = current.equityModel && options.equityModels.includes(current.equityModel) ? current.equityModel : undefined;
  const stackDepthBb = current.stackDepthBb && options.stackDepthsBb.includes(current.stackDepthBb) ? current.stackDepthBb : undefined;
  const heroPosition = current.heroPosition && options.heroPositions.includes(current.heroPosition) ? current.heroPosition : undefined;
  return { trainingType, equityModel, stackDepthBb, heroPosition };
}

function buildConfig(filters: TrainingFilters, targetQuestions: TrainingConfig["targetQuestions"], hasMatches: boolean, allowAny = false): TrainingConfig | null {
  if (!hasMatches || (!allowAny && !filters.trainingType) || !filters.equityModel) return null;
  return { trainingType: filters.trainingType ?? null, equityModel: filters.equityModel, stackDepthBb: filters.stackDepthBb, heroPosition: filters.heroPosition, targetQuestions };
}

function SelectField({ label, value, options, disabled, onChange }: { label: string; value: string | number; options: Array<{ value: string | number; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="setup-group"><label>{label}</label><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={String(option.value) || "all"} value={option.value}>{option.label}</option>)}</select></div>;
}

function EmptyStudies() { return <div className="setup-empty"><span>∅</span><div><b>Nenhum estudo publicado disponível.</b><p>As opções aparecem automaticamente quando existe um estudo HRC compatível publicado.</p></div></div>; }
function asOption(value: string) { return { value, label: value === "BU" ? "BU (Button)" : value === "BTN" ? "BTN (Button)" : value }; }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return minutes ? `${minutes}m ${rest.toString().padStart(2, "0")}s` : `${rest}s`; }
