"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProgressBreakdownItem, ProgressDashboardData, ProgressEvolutionPoint } from "../../lib/progress";

type RangeFilter = 7 | 30 | "all";
type PerformanceTab = "training" | "position" | "stack";

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });

export default function ProgressExperience({ data }: { data: ProgressDashboardData }) {
  const [range, setRange] = useState<RangeFilter>(30);
  const [tab, setTab] = useState<PerformanceTab>("training");
  const evolution = useMemo(() => filterEvolution(data.evolution, range, data.generatedAt), [data.evolution, data.generatedAt, range]);

  return <section className="member-content progress-content">
    <div className="member-heading progress-heading"><span>ÁREA DO ALUNO</span><h1>Progresso</h1><p>Acompanhe sua consistência e veja como suas decisões evoluem a cada treino.</p></div>

    <section className="progress-summary" aria-label="Resumo geral">
      <SummaryCard value={numberFormatter.format(data.summary.hands)} label="Mãos treinadas" icon="♠" />
      <SummaryCard value={`${data.summary.accuracy}%`} label="Precisão geral" icon="◎" />
      <SummaryCard value={numberFormatter.format(data.summary.sessions)} label="Sessões" icon="▦" />
      <SummaryCard value={formatDuration(data.summary.durationSeconds)} label="Tempo de treino" icon="◷" />
    </section>

    {data.summary.sessions === 0 ? <EmptyProgress /> : <>
      <section className="progress-panel evolution-panel" aria-labelledby="evolution-title">
        <div className="progress-panel-heading"><div><span>VISÃO TEMPORAL</span><h2 id="evolution-title">Evolução</h2></div><div className="progress-filter" aria-label="Período do gráfico">{([7, 30, "all"] as const).map((option) => <button key={option} type="button" className={range === option ? "active" : ""} aria-pressed={range === option} onClick={() => setRange(option)}>{option === "all" ? "Tudo" : `${option} dias`}</button>)}</div></div>
        {evolution.length > 1 ? <AccuracyChart points={evolution} /> : <div className="progress-section-empty"><i>↗</i><div><b>Continue treinando para acompanhar sua evolução.</b><span>São necessários dados de pelo menos dois dias no período selecionado.</span></div></div>}
      </section>

      <section className="progress-panel performance-panel" aria-labelledby="performance-title">
        <div className="progress-panel-heading"><div><span>RESULTADOS AGREGADOS</span><h2 id="performance-title">Desempenho</h2></div></div>
        <div className="performance-tabs" role="tablist" aria-label="Agrupar desempenho">
          <TabButton value="training" active={tab} onSelect={setTab}>Por treino</TabButton>
          <TabButton value="position" active={tab} onSelect={setTab}>Por posição</TabButton>
          <TabButton value="stack" active={tab} onSelect={setTab}>Por stack</TabButton>
        </div>
        <div className="performance-list" id="performance-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {data.performance[tab].map((item) => <PerformanceRow key={item.key} item={item} />)}
        </div>
      </section>

      <section className="progress-panel history-panel" aria-labelledby="history-title">
        <div className="progress-panel-heading"><div><span>ATIVIDADE RECENTE</span><h2 id="history-title">Últimas sessões</h2></div></div>
        <div className="session-list" role="table" aria-label="Últimas sessões de treinamento">
          <div className="session-list-head" role="row"><span role="columnheader">Data</span><span role="columnheader">Tipo de treino</span><span role="columnheader">Configuração</span><span role="columnheader">Mãos</span><span role="columnheader">Precisão</span></div>
          {data.latestSessions.map((session) => <div className="session-list-row" role="row" key={session.id}>
            <span role="cell" data-label="Data">{dateFormatter.format(new Date(session.startedAt))}</span>
            <span role="cell" data-label="Tipo de treino"><b>{session.trainingLabel}</b></span>
            <span role="cell" data-label="Configuração">{session.configuration}</span>
            <span role="cell" data-label="Mãos">{numberFormatter.format(session.totalAnswers)} {session.totalAnswers === 1 ? "mão" : "mãos"}</span>
            <span role="cell" data-label="Precisão"><strong>{session.accuracy}%</strong></span>
          </div>)}
        </div>
      </section>
    </>}
  </section>;
}

function SummaryCard({ value, label, icon }: { value: string; label: string; icon: string }) {
  return <article><i aria-hidden="true">{icon}</i><strong>{value}</strong><span>{label}</span></article>;
}

function EmptyProgress() {
  return <section className="progress-empty"><i aria-hidden="true">↗</i><span>PRIMEIRO TREINO</span><h2>Ainda não há dados de progresso.</h2><p>Complete alguns treinamentos para acompanhar sua evolução.</p><Link href="/#modos">Começar a treinar <span>→</span></Link></section>;
}

function TabButton({ value, active, onSelect, children }: { value: PerformanceTab; active: PerformanceTab; onSelect: (value: PerformanceTab) => void; children: React.ReactNode }) {
  return <button id={`tab-${value}`} type="button" role="tab" aria-selected={active === value} aria-controls="performance-panel" className={active === value ? "active" : ""} onClick={() => onSelect(value)}>{children}</button>;
}

function PerformanceRow({ item }: { item: ProgressBreakdownItem }) {
  return <article><div><b>{item.label}</b><span>{numberFormatter.format(item.hands)} {item.hands === 1 ? "mão" : "mãos"}</span></div><div className="performance-meter" aria-hidden="true"><i style={{ width: `${item.accuracy}%` }} /></div><strong>{item.accuracy}%</strong></article>;
}

function AccuracyChart({ points }: { points: ProgressEvolutionPoint[] }) {
  const coordinates = points.map((point, index) => ({
    ...point,
    x: 52 + index * (696 / Math.max(1, points.length - 1)),
    y: 24 + (100 - point.accuracy) * 1.55,
  }));
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  return <div className="accuracy-chart"><svg viewBox="0 0 800 230" role="img" aria-label={`Precisão de ${coordinates[0].accuracy}% a ${coordinates.at(-1)?.accuracy ?? 0}% no período`}>
    {[0, 25, 50, 75, 100].map((value) => { const y = 24 + (100 - value) * 1.55; return <g key={value}><line x1="52" x2="748" y1={y} y2={y} /><text x="8" y={y + 4}>{value}%</text></g>; })}
    <polyline points={polyline} />
    {coordinates.map((point) => <g className="chart-point" key={point.date}><circle cx={point.x} cy={point.y} r="5" /><title>{shortDateFormatter.format(new Date(point.timestamp))}: {point.accuracy}% em {point.hands} mãos</title></g>)}
    <text className="chart-date" x="52" y="214">{shortDateFormatter.format(new Date(coordinates[0].timestamp))}</text>
    <text className="chart-date chart-date-end" x="748" y="214">{shortDateFormatter.format(new Date(coordinates.at(-1)?.timestamp ?? coordinates[0].timestamp))}</text>
  </svg></div>;
}

function filterEvolution(points: ProgressEvolutionPoint[], range: RangeFilter, now: number) {
  if (range === "all") return points;
  const start = now - range * 24 * 60 * 60 * 1000;
  return points.filter((point) => point.timestamp >= start);
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min`;
  return totalSeconds ? "< 1min" : "0min";
}
