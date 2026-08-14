"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../db/auth";
import AppHeader from "../components/ui/AppHeader";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Modal } from "../components/ui/Modal";
import { PageContainer, SegmentedControl, StatusMessage } from "../components/ui/Primitives";
import { TrainingDecision, TrainingTablePreview } from "../components/training/TrainingDecision";
import { RangeMatrix } from "../components/training/RangeMatrix";
import { displayTrainingPosition, sequenceActionLabel } from "../components/training/trainingPresentation";
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
  type TrainingPresentationMode,
  type NodeRange,
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

export function TrainingSetup({ preferredType, initialFilters, initialTargetQuestions = 50, initialPresentationMode = "DECISION", onClose, onStarted, embedded = false }: { preferredType?: TrainingType; initialFilters?: TrainingFilters; initialTargetQuestions?: TrainingConfig["targetQuestions"]; initialPresentationMode?: TrainingPresentationMode; onClose?: () => void; onStarted: (session: TrainingSession) => void; embedded?: boolean }) {
  const [filters, setFilters] = useState<TrainingFilters>(initialFilters ?? { trainingType: preferredType });
  const [targetQuestions, setTargetQuestions] = useState<TrainingConfig["targetQuestions"]>(initialTargetQuestions);
  const [presentationMode] = useState<TrainingPresentationMode>(initialPresentationMode);
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

  const config = buildConfig(filters, targetQuestions, options.hasMatches, false, presentationMode);
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

  const panel = <section className={`setup-card training-setup-card simplified-setup ${embedded ? "training-setup-embedded" : ""}`} role={embedded ? "region" : undefined} aria-labelledby="setup-title">
      <div className="setup-heading"><span>CONFIGURAÇÃO DO TREINO</span><h2 id="setup-title">Prepare sua sessão</h2><p id="setup-description">Escolha o foco e o modelo. Os estudos publicados definem as mãos disponíveis.</p></div>
      <TrainingModeSelector/>
      <div className="setup-group"><span className="setup-label" id="training-type-label">Tipo de treinamento</span><div className="training-type-grid" role="group" aria-labelledby="training-type-label">{TRAINING_TYPES.map((type) => {
        const available = options.trainingTypes.includes(type);
        return <button key={type} type="button" disabled={!available || loading} className={filters.trainingType === type ? "selected" : ""} onClick={() => setFilters({ trainingType: type })}>
          <b>{trainingTypeLabels[type]}</b><small>{trainingTypeDescriptions[type]}</small>{!loading && !available && <i>Sem estudo</i>}
        </button>;
      })}</div></div>
      {loading && options.trainingTypes.length === 0 ? <div className="setup-loading"><i/><span>Consultando estudos disponíveis…</span></div> : noStudies ? <EmptyStudies/> : <>
        <div className="setup-model-row">
          <div className="setup-group"><span className="setup-label" id="training-model-label">Modelo</span><div className="choice-grid compact model-choice-grid" role="group" aria-labelledby="training-model-label">{EQUITY_MODELS.map((model) => <button type="button" key={model} disabled={!options.equityModels.includes(model)} aria-pressed={filters.equityModel === model} className={filters.equityModel === model ? "selected" : ""} onClick={() => setFilters((current) => ({ trainingType: current.trainingType, equityModel: model }))}>{equityModelLabels[model]}</button>)}</div></div>
          <SelectField id="training-question-count" label="Quantidade de mãos" value={targetQuestions ?? "FREE"} disabled={false} onChange={(value) => setTargetQuestions(value === "FREE" ? null : Number(value) as TrainingConfig["targetQuestions"])} options={[...QUESTION_COUNTS.map((count) => ({ value: count, label: `${count} mãos` })), { value: "FREE", label: "Treino livre" }]}/>
        </div>
        <div className="setup-row setup-select-row">
          <SelectField id="training-stack" label="Stack efetivo" value={filters.stackDepthBb ?? ""} disabled={!filters.equityModel || !options.stackDepthsBb.length} onChange={(value) => setFilters((current) => ({ ...current, stackDepthBb: value ? Number(value) : undefined, heroPosition: undefined }))} options={[{ value: "", label: "Todas" }, ...options.stackDepthsBb.map((stack) => ({ value: stack, label: `${formatBb(stack)} BB` }))]}/>
          <SelectField id="training-position" label="Posição do Hero" value={filters.heroPosition ?? ""} disabled={!filters.equityModel || !options.heroPositions.length} onChange={(value) => setFilters((current) => ({ ...current, heroPosition: value || undefined }))} options={[{ value: "", label: "Todas" }, ...options.heroPositions.map(asOption)]}/>
        </div>
      </>}
      {error && <StatusMessage className="setup-status" tone="error">{error}</StatusMessage>}
      <Button className="training-start-system" type="button" size="lg" fullWidth loading={starting} disabled={!config || loading} onClick={start}>Começar treinamento<Icon name="play"/></Button>
    </section>;
  if (embedded) return panel;
  return <Modal titleId="setup-title" descriptionId="setup-description" onClose={() => onClose?.()}>{panel}</Modal>;
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
  const [presentationMode, setPresentationMode] = useState<TrainingPresentationMode>("DECISION");
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

  const config = buildConfig(filters, targetQuestions, options.hasMatches, true, presentationMode);
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
        <span className="quick-label">Modelo</span>
        <div><button type="button" disabled={!options.tableContext || loading} onClick={cycleModel} aria-label={`Modelo ${modelLabel}`} title={options.tableContext?.studyName}>{modelLabel}</button><Button type="button" className="quick-settings-icon" variant="ghost" size="sm" iconOnly aria-label="Abrir todas as configurações" onClick={() => setAdvancedOpen(true)}><Icon name="settings"/></Button></div>
      </div>
      <TrainingModeSelector compact/>
      <div className="quick-setup-group quick-preflop-action">
        <span className="quick-label" id="preflop-action-label">Ação pré-flop <small title="Situação enfrentada pelo Hero" aria-label="Ajuda: situação enfrentada pelo Hero">?</small></span>
        <div role="group" aria-labelledby="preflop-action-label">{QUICK_PREFLOP_ACTIONS.map((item) => {
          const isAny = item.id === "ANY";
          const isFromStart = item.id === "FROM_START";
          const available = isAny || isFromStart ? options.trainingTypes.length > 0 : item.type ? options.trainingTypes.includes(item.type) : false;
          const selected = isFromStart ? presentationMode === "FROM_START" : presentationMode === "DECISION" && (isAny ? available && !filters.trainingType : item.type === filters.trainingType);
          return <button type="button" key={item.id} disabled={!available || loading} title={available ? undefined : item.type ? "Nenhum estudo publicado para esta categoria" : "Ainda não há suporte para este filtro"} className={selected ? "selected" : ""} onClick={() => {
            if (isFromStart) {
              setPresentationMode("FROM_START");
              setFilters((current) => ({ equityModel: current.equityModel }));
            } else if (isAny) {
              setPresentationMode("DECISION");
              setFilters((current) => ({ equityModel: current.equityModel }));
            } else if (item.type) {
              setPresentationMode("DECISION");
              setFilters((current) => ({ trainingType: item.type, equityModel: current.equityModel }));
            }
          }}>{item.label}</button>;
        })}</div>
      </div>
      {error && <StatusMessage className="quick-setup-error" tone="error">{error}</StatusMessage>}
      {!loading && !options.hasMatches && !error && <div className="quick-empty-studies">Importe um estudo para iniciar um treinamento.</div>}
      <div className="quick-setup-actions"><Button type="button" className="quick-all-settings" variant="ghost" onClick={() => setAdvancedOpen(true)}><Icon name="settings"/>Todas as configurações</Button><Button type="button" className="quick-start-training" loading={starting} disabled={!config || loading} onClick={start}><Icon name="play"/>Iniciar treino</Button></div>
    </section>
    {advancedOpen && <TrainingSetup
      initialFilters={filters}
      initialTargetQuestions={targetQuestions}
      initialPresentationMode={presentationMode}
      onClose={() => setAdvancedOpen(false)}
      onStarted={(session) => { setAdvancedOpen(false); onStarted(session); }}
    />}
  </>;
}

function TrainingModeSelector({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "quick-setup-group quick-training-mode" : "setup-experience-switch"}>
    <span className="quick-label">Modo de treino</span>
    <SegmentedControl className="training-mode-segmented" label="Modo de treino" value={ACTIVE_TRAINING_MODE} onChange={() => undefined} options={[{ value: "DECISION", label: "Decisão" }, { value: "FULL_HAND", label: "Mão completa", disabled: true }] as const}/>
  </div>;
}

export function DatabaseTrainer({ session, onReport }: { session: TrainingSession; onReport: (report: TrainingReport) => void }) {
  const [exercise, setExercise] = useState(session.exercise);
  const [answeredQuestions, setAnsweredQuestions] = useState(session.answeredQuestions);
  const [correctAnswers, setCorrectAnswers] = useState(session.correctAnswers);
  const [feedback, setFeedback] = useState<PendingSpotFeedback | null>(null);
  const [retryContext, setRetryContext] = useState<PendingSpotFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replayAttempt, setReplayAttempt] = useState(0);
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
      const data = await response.json() as { answer: AnswerEvaluation; answeredQuestions: number; correctAnswers: number; nextExercise: TrainingExercise | null; report: TrainingReport | null; replayed: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a resposta.");
      setAnsweredQuestions(data.answeredQuestions);
      setCorrectAnswers(data.correctAnswers);
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
    setReplayAttempt((current) => nextReplayAttempt(current, session.config.presentationMode));
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
  const errors = Math.max(0, answeredQuestions - correctAnswers);
  const accuracy = answeredQuestions > 0 ? Math.round((correctAnswers / answeredQuestions) * 100) : null;
  return <section className="inline-training-session" aria-label="Sessão de treinamento">
    <aside className="spot-session-sidebar" aria-label="Resumo da sessão">
      <header><span>Sessão atual</span></header>
      <div className="spot-session-progress">
        <div><span>Progresso</span><b>{progress}</b></div>
        <progress value={session.targetQuestions ? Math.min(currentHand, session.targetQuestions) : undefined} max={session.targetQuestions ?? undefined} aria-label={`Progresso atual: ${progress}`}/>
      </div>
      <div className="spot-session-stats">
        <div><span>Acerto</span><b>{accuracy === null ? "—" : `${accuracy}%`}</b></div>
        <div><span>Corretas</span><b className="is-positive">{correctAnswers}</b></div>
        <div><span>Erros</span><b className={errors > 0 ? "is-negative" : ""}>{errors}</b></div>
      </div>
      <div className="spot-session-time"><span aria-label="Tempo de treino">Tempo<span className="spot-session-time-detail"> de treino</span></span><b>{formatDuration(elapsed)}</b></div>
      <Button type="button" className="spot-finish-system" variant="danger" size="sm" loading={busy} onClick={finish}><Icon name="logout"/>Finalizar treino</Button>
    </aside>
    <div className="spot-session-main">
      <TrainingDecision
        key={`${exercise.trainingHandId}:${session.config.presentationMode ?? "DECISION"}:${replayAttempt}`}
        exercise={exercise}
        busy={busy}
        feedback={feedback}
        nextLabel={feedback?.report ? "Ver análise final" : "Próximo spot"}
        onChoose={choose}
        onRepeat={repeatSpot}
        onNext={advanceSpot}
        replayFromStart={session.config.presentationMode === "FROM_START"}
      />
      {error && <StatusMessage className="trainer-error" tone="error">{error}</StatusMessage>}
    </div>
  </section>;
}

export function TrainingReportView({ report, onExit, onStarted, user = null }: { report: TrainingReport; onExit: () => void; onStarted: (session: TrainingSession) => void; user?: AuthUser | null }) {
  const [starting, setStarting] = useState<"REPEAT" | "REVIEW_ERRORS" | null>(null);
  const [error, setError] = useState("");
  const firstDecision = report.decisionDetails.find((detail) => !detail.isCorrect) ?? report.decisionDetails[0] ?? null;
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(firstDecision?.questionIndex ?? null);
  const [selectedSpot, setSelectedSpot] = useState<{ exercise: TrainingExercise; range: NodeRange } | null>(null);
  const [rangeLoading, setRangeLoading] = useState(Boolean(firstDecision));
  const [rangeError, setRangeError] = useState("");
  const selectedDetail = report.decisionDetails.find((detail) => detail.questionIndex === selectedQuestion) ?? null;

  useEffect(() => {
    if (selectedQuestion === null) return;
    const controller = new AbortController();
    fetch(`/api/training/session?id=${encodeURIComponent(report.sessionId)}&rangeQuestion=${selectedQuestion}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { spot?: { exercise: TrainingExercise; range: NodeRange }; error?: string };
        if (!response.ok || !data.spot) throw new Error(data.error || "Não foi possível carregar o mapa de EV.");
        setSelectedSpot(data.spot);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setSelectedSpot(null);
        setRangeError(requestError instanceof Error ? requestError.message : "Não foi possível carregar o mapa de EV.");
      })
      .finally(() => { if (!controller.signal.aborted) setRangeLoading(false); });
    return () => controller.abort();
  }, [report.sessionId, selectedQuestion]);

  function selectReportQuestion(questionIndex: number) {
    if (questionIndex === selectedQuestion) return;
    setSelectedQuestion(questionIndex);
    setSelectedSpot(null);
    setRangeLoading(true);
    setRangeError("");
  }

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
  const reportEv = report.evDelta === null || report.evUnit === null ? "—" : formatReportEv(report.evDelta, report.evUnit);
  return <main className="member-shell report-screen">{user && <AppHeader user={user} active="training"/>}
    <PageContainer width="wide" className="training-report training-report-redesigned">
      <div className="report-top-row">
        <header className="report-minimal-summary">
          <span>Resultado do treino</span>
          <p><strong>{report.accuracy}% de acerto</strong><i>·</i><b>{report.correctAnswers} corretas</b><i>·</i><b>{report.errors} erro{report.errors === 1 ? "" : "s"}</b><i>·</i><b className={report.evDelta !== null && report.evDelta < 0 ? "is-negative" : ""}>{reportEv}</b><i>·</i><b>{formatDuration(report.durationSeconds)}</b></p>
          <small>{report.trainingType === null ? "Todos os spots" : trainingTypeLabels[report.trainingType]} · {equityModelLabels[report.equityModel]} · {report.stackDepthBb === null ? "Stacks variados" : `${formatBb(report.stackDepthBb)} BB`} · {report.heroPosition === null ? "Todas as posições" : report.heroPosition}</small>
        </header>
        <div className="report-actions report-actions-top">
          <Button type="button" size="sm" variant="secondary" loading={starting === "REPEAT"} disabled={starting !== null && starting !== "REPEAT"} onClick={() => start("REPEAT")}><Icon name="refresh"/>Treinar novamente</Button>
          {report.detailsAvailable && report.errors > 0 && <Button type="button" size="sm" loading={starting === "REVIEW_ERRORS"} disabled={starting !== null && starting !== "REVIEW_ERRORS"} onClick={() => start("REVIEW_ERRORS")}>Revisar erros</Button>}
          <Button type="button" size="sm" variant="ghost" onClick={onExit}>Voltar</Button>
        </div>
      </div>
      {report.detailsTruncated && <p className="progress-footnote" role="status">Os totais cobrem a sessão completa; os agrupamentos e erros abaixo usam somente as {report.detailAnswers} respostas mais recentes.</p>}

      {selectedDetail && <div className="report-spot-strip">
        <div className="report-spot-context">
          <span>Spot {selectedDetail.questionIndex + 1}/{report.decisionDetails.length}</span>
          <b>{selectedSpot ? displayTrainingPosition(selectedSpot.exercise.heroPosition, selectedSpot.exercise.playersCount) : selectedDetail.heroPosition}{selectedSpot ? ` · ${formatBb(selectedSpot.exercise.heroStackBb)} BB` : ""}</b>
          <small>{selectedSpot ? reportSpotSequence(selectedSpot.exercise) : rangeLoading ? "Carregando contexto do spot…" : "Contexto do spot indisponível"}</small>
        </div>
        <div className="report-selected-decision"><b>{selectedDetail.handClass}</b><span>{reportActionLabel(selectedDetail.selectedAction)} → {reportActionLabel(selectedDetail.bestAction)}</span></div>
      </div>}

      {report.decisionDetails.length > 0 && <div className="report-analysis-workspace">
        <section className="report-range-card" aria-labelledby="report-range-title">
          <header><h2 id="report-range-title">Mapa de EV das mãos</h2></header>
          {rangeLoading ? <div className="report-range-state" role="status"><i/><span>Carregando EVs do spot…</span></div> : rangeError ? <div className="report-range-state is-error" role="status">{rangeError}</div> : selectedSpot ? <RangeMatrix exercise={selectedSpot.exercise} range={selectedSpot.range} hideSpotLabel/> : null}
        </section>
        <aside className="report-decision-browser" aria-label="Decisões da sessão">
          <header><h2>Decisões da sessão</h2><b>{report.decisionDetails.length}</b></header>
          <div>{report.decisionDetails.map((detail) => <button type="button" key={detail.questionIndex} className={`${detail.questionIndex === selectedQuestion ? "selected" : ""} ${detail.isCorrect ? "correct" : "incorrect"}`} aria-pressed={detail.questionIndex === selectedQuestion} onClick={() => selectReportQuestion(detail.questionIndex)}>
            <span>#{detail.questionIndex + 1}</span><b>{detail.handClass}</b><i>{detail.heroPosition}</i><small>{reportActionLabel(detail.selectedAction)} → {reportActionLabel(detail.bestAction)}</small><strong>{detail.isCorrect ? "Correta" : "Revisar"}</strong>
          </button>)}</div>
        </aside>
      </div>}

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </PageContainer>
  </main>;
}

function reportActionLabel(value: string) {
  const normalized = value.toLowerCase().replace(/[_-]/g, " ");
  if (/^action\s+\d+$/.test(normalized)) return "Ação";
  if (/[0-9]/.test(value) || value.includes(" ")) return value;
  if (normalized.includes("fold")) return "Fold";
  if (normalized.includes("check")) return "Check";
  if (normalized.includes("call")) return "Call";
  if (normalized.includes("all in") || normalized.includes("shove")) return "All-in";
  if (normalized.includes("bet")) return "Bet";
  if (normalized.includes("raise") || normalized.includes("open")) return "Raise";
  return value;
}

function reportSpotSequence(exercise: TrainingExercise) {
  const relevantActions = exercise.actionSequence
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action.type !== "FOLD");
  if (relevantActions.length === 0) return exercise.actionSequence.length > 0 ? "Folda até você" : "Sem ação anterior";
  return relevantActions.map(({ action, index }) => {
    const position = action.position ? displayTrainingPosition(action.position, exercise.playersCount) : "Ação";
    const label = sequenceActionLabel(action, index, exercise.actionSequence).replace(/^raise/, "abre").replace(/^bet/, "aposta");
    return `${position} ${label}`;
  }).join(" → ");
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

function buildConfig(filters: TrainingFilters, targetQuestions: TrainingConfig["targetQuestions"], hasMatches: boolean, allowAny = false, presentationMode: TrainingPresentationMode = "DECISION"): TrainingConfig | null {
  if (!hasMatches || (!allowAny && !filters.trainingType) || !filters.equityModel) return null;
  return { trainingType: filters.trainingType ?? null, equityModel: filters.equityModel, stackDepthBb: filters.stackDepthBb, heroPosition: filters.heroPosition, targetQuestions, presentationMode };
}

export function nextReplayAttempt(current: number, presentationMode: TrainingPresentationMode | undefined) {
  return presentationMode === "FROM_START" ? current + 1 : current;
}

function SelectField({ id, label, value, options, disabled, onChange }: { id: string; label: string; value: string | number; options: Array<{ value: string | number; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="setup-group"><label htmlFor={id}>{label}</label><select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={String(option.value) || "all"} value={option.value}>{option.label}</option>)}</select></div>;
}

function EmptyStudies() { return <div className="setup-empty"><span>∅</span><div><b>Nenhum estudo publicado disponível.</b><p>As opções aparecem automaticamente quando existe um estudo HRC compatível publicado.</p></div></div>; }
function asOption(value: string) { return { value, label: value === "BU" ? "BU (Button)" : value === "BTN" ? "BTN (Button)" : value }; }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return minutes ? `${minutes}m ${rest.toString().padStart(2, "0")}s` : `${rest}s`; }
