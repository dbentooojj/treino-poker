"use client";

import { useEffect, useMemo, useState } from "react";
import { TrainingDecision } from "../components/training/TrainingDecision";
import { TrainingFeedback } from "../components/training/TrainingFeedback";
import { TrainingStats } from "../components/training/TrainingStats";
import { TrainingTable } from "../components/training/TrainingTable";
import type { AuthUser } from "../db/auth";
import MemberHeader from "./member-header";
import {
  EQUITY_MODELS,
  QUESTION_COUNTS,
  TRAINING_TYPES,
  actionKey,
  equityModelLabels,
  formatBb,
  trainingTypeDescriptions,
  trainingTypeLabels,
  type AnswerEvaluation,
  type NodeRange,
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
      <div className="setup-heading"><span>CONFIGURAÇÃO DO TREINO</span><h2 id="setup-title">Prepare sua sessão</h2><p>Escolha o foco e o modelo. Os estudos publicados definem as mãos disponíveis.</p></div>
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
      <button className="start-button" disabled={!config || loading || starting} onClick={start}>{starting ? "Montando a fila…" : "Começar treino"}<span>{starting ? "" : "→"}</span></button>
    </section>
  </div>;
}

export function DatabaseTrainer({ session, user, onExit, onStarted }: { session: TrainingSession; user: AuthUser; onExit: () => void; onStarted: (session: TrainingSession) => void }) {
  const [exercise, setExercise] = useState(session.exercise);
  const [stats, setStats] = useState({ answered: session.answeredQuestions, correct: session.correctAnswers });
  const [choice, setChoice] = useState<TrainingAction | null>(null);
  const [answer, setAnswer] = useState<AnswerEvaluation | null>(null);
  const [nodeRange, setNodeRange] = useState<NodeRange | null>(null);
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

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const shouldLock = report === null;
    root.classList.toggle("rangelab-training-lock", shouldLock);
    body.classList.toggle("rangelab-training-lock", shouldLock);
    return () => {
      root.classList.remove("rangelab-training-lock");
      body.classList.remove("rangelab-training-lock");
    };
  }, [report]);

  if (report) return <TrainingReportView report={report} onExit={onExit} onStarted={onStarted}/>;

  async function choose(selected: TrainingAction) {
    if (choice || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/training/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "ANSWER", sessionId: session.id, questionIndex: stats.answered, trainingNodeId: exercise.trainingNodeId, trainingHandId: exercise.trainingHandId, selectedAction: actionKey(selected) }) });
      const data = await response.json() as { answer: AnswerEvaluation; nodeRange?: NodeRange; answeredQuestions: number; correctAnswers: number; nextExercise: TrainingExercise | null; report: TrainingReport | null; replayed: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a resposta.");
      if (!data.nodeRange || data.nodeRange.trainingSetId !== exercise.trainingSetId || data.nodeRange.trainingNodeId !== exercise.trainingNodeId) throw new Error("Não foi possível carregar o range desta decisão.");
      setChoice(selected);
      setAnswer(data.answer);
      setNodeRange(data.nodeRange);
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
    setNodeRange(null);
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

  const accuracy = stats.answered ? Math.round(stats.correct / stats.answered * 100) : null;
  const currentHand = stats.answered + (answer ? 0 : 1);
  const progress = session.targetQuestions ? `${Math.min(currentHand, session.targetQuestions)} / ${session.targetQuestions}` : `${currentHand}`;
  return <main className={`training-screen training-screen-redesigned ${answer ? "feedback-active" : ""}`}>
    <MemberHeader user={user}/>
    <header className="rl-trainer-topbar">
    <div className="rl-header-context">
      <div><span>MODELO</span><b>{equityModelLabels[exercise.equityModel]}</b></div>
    </div>
    <TrainingStats progress={progress} accuracy={accuracy} elapsed={formatDuration(elapsed)}/>
    <button className="rl-finish-training" disabled={busy} onClick={finish}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4m0 1h9l3 3-3 3H6"/></svg>Finalizar treino</button>
  </header>
    <section className="rl-training-shell">
      <div className={`rl-training-layout ${answer ? "learning-mode" : "decision-mode"}`}>
        {!answer && <TrainingTable exercise={exercise} showHistory/>}
        {!answer ? <TrainingDecision exercise={exercise} busy={busy} onChoose={choose}/> : choice && nodeRange ? <TrainingFeedback exercise={exercise} answer={answer} choiceKey={actionKey(choice)} range={nodeRange} isLast={Boolean(pendingReport)} onNext={advance}/> : null}
      </div>
      {error && <div className="setup-error trainer-error" role="alert">{error}</div>}
    </section>
  </main>;
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
  return <main className="training-screen report-screen"><header className="trainer-topbar"><button className="brand brand-button" onClick={onExit}><span className="brand-mark">R</span><span>Range<span>Lab</span></span></button><div className="spot-context"><span>RESULTADO</span><b>{report.completionReason === "COMPLETED" ? "Treino concluído" : "Treino finalizado"}</b></div><button className="exit-button" onClick={onExit}>Voltar ao início</button></header>
    <section className="training-report"><div className="report-hero"><span>{report.completionReason === "COMPLETED" ? "TREINO CONCLUÍDO" : "SESSÃO FINALIZADA"}</span><h1>{report.correctAnswers} / {report.answeredQuestions} corretas</h1><p>{report.accuracy}% de acerto · {formatDuration(report.durationSeconds)}</p><div><i>{trainingTypeLabels[report.trainingType]}</i><i>{equityModelLabels[report.equityModel]}</i><i>{report.stackDepthBb === null ? "Stack: Todas" : `Stack: ${formatBb(report.stackDepthBb)} BB`}</i><i>{report.heroPosition === null ? "Posição: Todas" : `Posição: ${report.heroPosition}`}</i></div></div>
      {report.detailsTruncated && <p className="progress-footnote" role="status">Os totais cobrem a sessão completa; os agrupamentos e erros abaixo usam somente as {report.detailAnswers} respostas mais recentes.</p>}
      <div className="report-stat-grid"><article><span>Respondidas</span><b>{report.answeredQuestions}</b></article><article><span>Acertos</span><b className="green-text">{report.correctAnswers}</b></article><article><span>Erros</span><b className="red-text">{report.errors}</b></article><article><span>Média por resposta</span><b>{report.averageSeconds === null ? "—" : `${report.averageSeconds}s`}</b></article></div>
      <div className="report-grid">
        {report.byPosition.length > 0 && <ReportSection title="Por posição"><div className="report-bars">{report.byPosition.map((group) => <div key={group.label}><span>{group.label}</span><i><b style={{ width: `${group.accuracy}%` }}/></i><strong>{group.accuracy}%</strong><small>{group.answered} resp.</small></div>)}</div></ReportSection>}
        {report.mostMissedHands.length > 0 && <ReportSection title="Mãos com mais erros"><div className="missed-hands">{report.mostMissedHands.map((hand) => <div key={hand.handClass}><b>{hand.handClass}</b><span>{hand.errors} erro{hand.errors > 1 ? "s" : ""}</span></div>)}</div></ReportSection>}
        {report.byDecisionType.length > 0 && <ReportSection title="Clareza da decisão"><div className="decision-groups">{report.byDecisionType.map((group) => <div key={group.label}><span>{group.label}</span><b>{group.accuracy}%</b><small>{group.answered} respostas</small></div>)}</div></ReportSection>}
        {report.feedback.length > 0 && <ReportSection title="Feedback objetivo"><ul className="report-feedback">{report.feedback.map((item) => <li key={item}>{item}</li>)}</ul></ReportSection>}
        {report.errorDetails.length > 0 && <ReportSection title="Erros da sessão"><div className="error-review-list">{report.errorDetails.map((item, index) => <div key={`${item.handClass}-${item.heroPosition}-${index}`}><b>{item.handClass}</b><span>{item.heroPosition}</span><small>{item.selectedAction} → {item.bestAction}</small></div>)}</div></ReportSection>}
      </div>
      {error && <div className="setup-error" role="alert">{error}</div>}
      <div className="report-actions"><button disabled={starting !== null} onClick={() => start("REPEAT")}>{starting === "REPEAT" ? "Preparando…" : "Treinar novamente"}</button>{report.detailsAvailable && report.errors > 0 ? <button className="primary" disabled={starting !== null} onClick={() => start("REVIEW_ERRORS")}>{starting === "REVIEW_ERRORS" ? "Preparando…" : "Revisar erros recentes (até 100)"}</button> : report.errors === 0 ? <span>Nenhum erro para revisar.</span> : <span>Revisão por mão indisponível para este resumo histórico.</span>}</div>
    </section>
  </main>;
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
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return minutes ? `${minutes}m ${rest.toString().padStart(2, "0")}s` : `${rest}s`; }
