"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageContainer, PageHeader, SegmentedControl, SegmentedTabs, StatusMessage } from "../../components/ui/Primitives";
import { trainingTypeLabels } from "../../lib/training";
import type { ProgressBreakdownItem, ProgressDashboardData, ProgressEvolutionPoint } from "../../lib/progress";

type RangeFilter = 7 | 30 | "all";
type PerformanceTab = "training" | "position" | "stack";

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });

export default function ProgressExperience({ data }: { data: ProgressDashboardData }) {
  const [range, setRange] = useState<RangeFilter>(30);
  const [tab, setTab] = useState<PerformanceTab>("position");
  const [selectedPerformance, setSelectedPerformance] = useState<string | null>(null);
  const evolution = useMemo(() => filterEvolution(data.evolution, range, data.generatedAt), [data.evolution, data.generatedAt, range]);
  const performance = data.performance[tab];
  const selected = performance.find((item) => item.key === selectedPerformance) ?? null;
  const partialCoverage = data.coverage.sessionsTruncated || data.coverage.answersTruncated;

  function selectTab(value: PerformanceTab) {
    setTab(value);
    setSelectedPerformance(null);
  }

  return <PageContainer>
    <PageHeader eyebrow="Seu desempenho" title="Progresso" description="Acompanhe sua consistência e veja como suas decisões evoluem a cada treino."/>

    {partialCoverage && <StatusMessage className="progress-status">Janela recente limitada a {numberFormatter.format(data.coverage.sessionLimit)} sessões e {numberFormatter.format(data.coverage.answerLimit)} respostas. Totais e detalhes abaixo cobrem somente os registros carregados.</StatusMessage>}

    <section className="progress-summary" aria-label={partialCoverage ? "Resumo da janela recente" : "Resumo geral"}>
      <SummaryCard
        label={partialCoverage ? "Mãos na janela" : "Mãos treinadas"}
        value={numberFormatter.format(data.summary.hands)}
        icon="cards"
        variation={formatVariation(data.summary.comparison.hands, "")}
      />
      <SummaryCard
        label={partialCoverage ? "Precisão na janela" : "Precisão geral"}
        value={formatPercent(data.summary.accuracy)}
        icon="target"
        variation={formatVariation(data.summary.comparison.accuracy, " pp")}
      />
      <SummaryCard
        label="Eficiência EV"
        value={formatPercent(data.summary.evEfficiency)}
        icon="trend"
        variation={formatVariation(data.summary.comparison.evEfficiency, " pp")}
        unavailable="Métrica ainda não definida com segurança para os dados HRC."
      />
      <SummaryCard
        label="EV perdido"
        value={formatEvLoss(data.summary.evLossBb)}
        icon="loss"
        variation={formatVariation(data.summary.comparison.evLossBb, " BB")}
        tone="negative"
      />
    </section>

    <div className="progress-top-grid">
      <section className="progress-panel evolution-panel" aria-labelledby="evolution-title">
        <div className="progress-panel-heading">
          <div className="progress-title"><LineIcon name="trend" /><h2 id="evolution-title">Evolução</h2></div>
          <SegmentedControl label="Período do gráfico" value={range} onChange={setRange} options={[{ value: 7, label: "7 dias" }, { value: 30, label: "30 dias" }, { value: "all", label: partialCoverage ? "Janela" : "Todos" }] as const}/>
        </div>
        {evolution.length > 1 ? <EvolutionChart points={evolution} /> : <ProgressEmpty title="Complete alguns treinos para acompanhar sua evolução." detail="São necessários dados de pelo menos dois dias no período selecionado." />}
        {evolution.length > 1 && <EvolutionInsight points={evolution} />}
      </section>

      <section className="progress-panel weak-panel" aria-labelledby="weak-title">
        <div className="progress-panel-heading progress-panel-heading-copy">
          <div><div className="progress-title"><LineIcon name="target" /><h2 id="weak-title">Pontos fracos</h2></div><p>Priorize estes spots para ganhar mais consistência.</p></div>
        </div>
        {data.weakSpots.length ? <div className="weak-list">{data.weakSpots.map((spot) => <article key={spot.key}>
          <div><b>{spot.trainingType ? trainingTypeLabels[spot.trainingType] : "Mão completa"}</b><span>{spot.label} · {numberFormatter.format(spot.hands)} mãos</span></div>
          <strong className={accuracyTone(spot.accuracy)}>{spot.accuracy}%</strong>
          <button type="button" disabled title="O treino direto deste agrupamento ainda não está disponível.">Treinar agora</button>
        </article>)}</div> : <ProgressEmpty compact title="Ainda não há decisões suficientes para identificar padrões." detail="Um ponto fraco exige pelo menos 5 decisões comparáveis." />}
      </section>
    </div>

    <section className="progress-panel performance-panel" aria-labelledby="performance-title">
      <div className="progress-panel-heading"><div className="progress-title"><LineIcon name="bars" /><h2 id="performance-title">Desempenho</h2></div></div>
      <SegmentedTabs className="performance-tabs-system" label="Agrupar desempenho" value={tab} onChange={selectTab} panelId="performance-panel" options={[{ value: "training", label: "Por treino" }, { value: "position", label: "Por posição" }, { value: "stack", label: "Por stack" }] as const}/>
      {performance.length ? <div className="performance-list" id="performance-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {performance.map((item) => <PerformanceRow key={item.key} item={item} selected={selectedPerformance === item.key} onSelect={() => setSelectedPerformance(selectedPerformance === item.key ? null : item.key)} />)}
      </div> : <ProgressEmpty compact title="Ainda não há dados para este agrupamento." detail="As barras aparecerão depois das primeiras decisões salvas." />}
      {selected && <div className="performance-detail" aria-live="polite"><span>Detalhes de <b>{selected.label}</b></span><span><b>{numberFormatter.format(selected.hands)}</b> decisões</span><span><b>{selected.accuracy}%</b> de precisão</span><span><b>{formatEvLoss(selected.evLossBb)}</b> de EV perdido</span></div>}
      {performance.length > 0 && <p className="progress-footnote"><LineIcon name="info" /> Selecione uma linha para ver os detalhes do grupo.</p>}
    </section>

    <div className="progress-bottom-grid">
      <section className="progress-panel costly-panel" aria-labelledby="costly-title">
        <div className="progress-panel-heading progress-panel-heading-copy"><div><div className="progress-title"><LineIcon name="network" /><h2 id="costly-title">Spots que mais custaram EV</h2></div><p>Ranking pelo EV HRC efetivamente perdido.</p></div></div>
        {data.costlySpots.length ? <ol className="costly-list">{data.costlySpots.map((spot, index) => <li key={spot.key}>
          <i>{index + 1}</i><div><b>{spot.handClass}</b><span>{spot.context}</span></div><strong>−{formatBb(spot.evLossBb)} BB</strong>
        </li>)}</ol> : <ProgressEmpty compact title="Nenhum EV perdido disponível." detail="O ranking exige EV ótimo e escolhido armazenados na resposta." />}
      </section>

      <section className="progress-panel history-panel" aria-labelledby="history-title">
        <div className="progress-panel-heading"><div className="progress-title"><LineIcon name="clock" /><h2 id="history-title">Últimas sessões</h2></div></div>
        {data.latestSessions.length ? <div className="session-list" role="table" aria-label="Últimas sessões de treinamento">
          <div className="session-list-head" role="row"><span role="columnheader">Data</span><span role="columnheader">Treino</span><span role="columnheader">Mãos</span><span role="columnheader">Precisão</span><span role="columnheader">EV</span></div>
          {data.latestSessions.map((session) => <div className="session-list-row" role="row" key={session.id}>
            <span role="cell" data-label="Data">{dateFormatter.format(new Date(session.startedAt))}</span>
            <span role="cell" data-label="Treino"><b>{session.trainingLabel}</b><small>{session.configuration}</small></span>
            <span role="cell" data-label="Mãos">{numberFormatter.format(session.totalAnswers)}</span>
            <span role="cell" data-label="Precisão"><strong>{session.accuracy}%</strong></span>
            <span role="cell" data-label="EV" className="negative-ev">{formatEvLoss(session.evLossBb)}</span>
          </div>)}
        </div> : <ProgressEmpty compact title="Nenhuma sessão concluída ainda." detail="Comece um treino para criar seu histórico." action />}
      </section>
    </div>

    <footer className="progress-footer"><LineIcon name="shield" /> Treine com consistência. Evolua com dados.</footer>
  </PageContainer>;
}

function SummaryCard({ label, value, icon, variation, tone, unavailable }: { label: string; value: string; icon: IconName; variation: Variation | null; tone?: "negative"; unavailable?: string }) {
  return <article className={tone ? `summary-${tone}` : undefined} title={unavailable}>
    <div className="summary-label"><LineIcon name={icon} /><span>{label}</span></div>
    <strong>{value}</strong>
    <div className="summary-change">{variation ? <><b className={variation.tone}>{variation.text}</b><span>vs. 30 dias anteriores</span></> : <span>{unavailable ?? "Comparativo disponível após 60 dias"}</span>}</div>
  </article>;
}

function PerformanceRow({ item, selected, onSelect }: { item: ProgressBreakdownItem; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={selected ? "selected" : ""} aria-expanded={selected} onClick={onSelect}>
    <div><b>{item.label}</b><span>{numberFormatter.format(item.hands)} {item.hands === 1 ? "mão" : "mãos"}</span></div>
    <div className="performance-meter" aria-hidden="true"><i style={{ width: `${item.accuracy}%` }} /></div>
    <strong>{item.accuracy}%</strong>
  </button>;
}

function EvolutionChart({ points }: { points: ProgressEvolutionPoint[] }) {
  const coordinates = points.map((point, index) => ({
    ...point,
    x: 54 + index * (692 / Math.max(1, points.length - 1)),
    y: 25 + (100 - point.accuracy) * 1.55,
  }));
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const middle = Math.floor((coordinates.length - 1) / 2);
  const dateIndexes = [...new Set([0, middle, coordinates.length - 1])];
  return <div className="evolution-chart">
    <div className="chart-legend"><span><i />Precisão (%)</span><span className="unavailable-series"><i />Eficiência EV indisponível</span></div>
    <svg viewBox="0 0 800 220" role="img" aria-label={`Precisão de ${coordinates[0].accuracy}% a ${coordinates.at(-1)?.accuracy ?? 0}% no período`}>
      {[0, 20, 40, 60, 80, 100].map((value) => { const y = 25 + (100 - value) * 1.55; return <g key={value}><line x1="54" x2="746" y1={y} y2={y} /><text x="8" y={y + 4}>{value}%</text></g>; })}
      <polyline points={polyline} />
      {coordinates.map((point) => <g className="chart-point" key={point.date}><circle cx={point.x} cy={point.y} r="4" tabIndex={0} /><title>{shortDateFormatter.format(new Date(point.timestamp))}: {point.accuracy}% em {point.hands} mãos</title></g>)}
      {dateIndexes.map((index) => <text key={index} className={`chart-date ${index === coordinates.length - 1 ? "chart-date-end" : ""}`} x={coordinates[index].x} y="211">{shortDateFormatter.format(new Date(coordinates[index].timestamp))}</text>)}
    </svg>
  </div>;
}

function EvolutionInsight({ points }: { points: ProgressEvolutionPoint[] }) {
  const delta = points.at(-1)!.accuracy - points[0].accuracy;
  const direction = delta > 0 ? "melhorou" : delta < 0 ? "caiu" : "permaneceu estável";
  return <p className="evolution-insight"><LineIcon name="info" /> Sua precisão {direction}{delta ? ` ${delta > 0 ? "+" : ""}${delta} pp` : ""} no período selecionado.</p>;
}

function ProgressEmpty({ title, detail, compact, action }: { title: string; detail: string; compact?: boolean; action?: boolean }) {
  return <div className={`progress-section-empty ${compact ? "compact" : ""}`}><LineIcon name="spark" /><div><b>{title}</b><span>{detail}</span>{action && <Link href="/treinar">Começar a treinar →</Link>}</div></div>;
}

type IconName = "cards" | "target" | "trend" | "loss" | "bars" | "info" | "network" | "clock" | "shield" | "spark";

function LineIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    cards: <><rect x="5" y="5" width="11" height="14" rx="2"/><path d="m9 5 1-2h9a2 2 0 0 1 2 2v10l-5 2"/><path d="m8 10 2-2 2 2-2 3z"/></>,
    target: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
    trend: <><path d="M3 18 9 12l4 3 8-9"/><path d="M16 6h5v5"/></>,
    loss: <><path d="M3 5v14h18"/><path d="m6 9 5 5 3-3 6 6"/></>,
    bars: <><path d="M4 20V10h4v10m4 0V4h4v16m4 0v-7h-4"/><path d="M2 20h20"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/></>,
    network: <><circle cx="12" cy="5" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><path d="m11 7-5 8m7-8 5 8M7 17h10"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
    shield: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-5"/></>,
    spark: <><path d="M12 3v4m0 10v4M3 12h4m10 0h4"/><circle cx="12" cy="12" r="3"/></>,
  };
  return <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

type Variation = { text: string; tone: "positive" | "negative" | "neutral" };

function formatVariation(value: number | null, suffix: string): Variation | null {
  if (value === null) return null;
  return { text: `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatBb(Math.abs(value))}${suffix}`, tone: value > 0 ? "positive" : value < 0 ? "negative" : "neutral" };
}

function filterEvolution(points: ProgressEvolutionPoint[], range: RangeFilter, now: number) {
  if (range === "all") return points;
  const start = now - range * 24 * 60 * 60 * 1000;
  return points.filter((point) => point.timestamp >= start);
}

function formatPercent(value: number | null) { return value === null ? "—" : `${value}%`; }
function formatBb(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: value === 0 ? 0 : 2 }).format(value); }
function formatEvLoss(value: number | null) { return value === null ? "—" : value === 0 ? "0 BB" : `−${formatBb(value)} BB`; }
function accuracyTone(value: number) { return value < 65 ? "warning" : value < 75 ? "attention" : "positive"; }
