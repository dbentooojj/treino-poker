"use client";

import { calculateCallEV } from "../../lib/poker/pot-odds";
import type { EquityResult as EquityResultData } from "../../lib/poker/equity";
import { deriveStreetDecision, parsePokerAmount, STREET_LABELS, type PokerStreet } from "../../lib/poker/street";
import EquityResult from "./EquityResult";
import type { MoneyUnit } from "./PokerToolsExperience";

type Decision = "positive" | "negative" | "neutral";

type PotOddsCalculatorProps = {
  heroEquity: number | null;
  equityResult?: EquityResultData | null;
  street: PokerStreet;
  startingPot: string;
  betAmount: string;
  unit: MoneyUnit;
  onStartingPotChange: (value: string) => void;
  onBetAmountChange: (value: string) => void;
  onUnitChange: (unit: MoneyUnit) => void;
};

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits).replace(".", ",")}%`;
}

function classify(heroEquity: number, requiredEquity: number): Decision {
  const margin = heroEquity - requiredEquity;
  if (Math.abs(margin) <= 0.0005) return "neutral";
  return margin > 0 ? "positive" : "negative";
}

function formatAmount(value: number | null, unit: MoneyUnit): string {
  if (value === null) return "—";
  const amount = value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return unit === "R$" ? `R$ ${amount}` : `${amount} BB`;
}

function formatPreviewAmount(value: number | null, unit: MoneyUnit): string {
  return formatAmount(value ?? 0, unit);
}

function formatEditableAmount(value: string): string {
  if (value.trim() === "") return "";
  const amount = parsePokerAmount(value);
  if (amount === null) return value;
  return amount.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatEV(value: number, unit: MoneyUnit): string {
  const sign = value >= 0 ? "+" : "−";
  const amount = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return unit === "R$" ? `${sign}R$ ${amount}` : `${sign}${amount} BB`;
}

export default function PotOddsCalculator({
  heroEquity,
  equityResult,
  street,
  startingPot,
  betAmount,
  unit,
  onStartingPotChange,
  onBetAmountChange,
  onUnitChange,
}: PotOddsCalculatorProps) {
  const streetLabel = STREET_LABELS[street];
  const calculation = deriveStreetDecision({
    startingPot,
    villainAction: "bet",
    betAmount,
    heroAction: "call",
  });
  const requiredEquity = calculation.requiredEquity;
  const decision = heroEquity !== null && requiredEquity !== null
    ? classify(heroEquity, requiredEquity)
    : null;
  const margin = heroEquity !== null && requiredEquity !== null
    ? heroEquity - requiredEquity
    : null;
  const callEV = heroEquity !== null
    && calculation.potBeforeCall !== null
    && calculation.callAmount !== null
    ? calculateCallEV(heroEquity, calculation.potBeforeCall, calculation.callAmount)
    : null;
  const decisionTitle = decision === "positive"
    ? "CALL +EV"
    : decision === "negative"
      ? "CALL −EV"
      : "BREAK-EVEN";
  const decisionText = decision === "positive"
    ? "O call é lucrativo no longo prazo com base nas informações atuais."
    : decision === "negative"
      ? "O call perde valor no longo prazo com base nas informações atuais."
      : "A decisão está no ponto de equilíbrio com base nas informações atuais.";

  return <aside className="poker-analysis-column simplified-analysis-column" aria-label="Pot Odds e resultado da decisão">
    <article className="poker-tool-card pot-odds-card simplified-pot-odds-card">
      <div className="analysis-card-heading">
        <div><span className="tool-icon gold" aria-hidden="true">%</span><h2>Pot Odds <small>· {streetLabel}</small></h2></div>
        <div className="unit-switch" aria-label="Unidade dos valores">
          {(["BB", "R$"] as const).map((option) => <button
            type="button"
            key={option}
            aria-pressed={unit === option}
            className={unit === option ? "active" : ""}
            onClick={() => onUnitChange(option)}
          >{option}</button>)}
        </div>
      </div>

      <div className="pot-inputs simplified-pot-inputs">
        <label htmlFor="pot-before-bet">Pote antes da aposta do Vilão</label>
        <div><input id="pot-before-bet" inputMode="decimal" type="text" autoComplete="off" placeholder="0" value={startingPot} onChange={(event) => onStartingPotChange(event.target.value)} onBlur={(event) => onStartingPotChange(formatEditableAmount(event.target.value))} /><span>{unit}</span></div>
        <label htmlFor="bet-to-call">Aposta que você está enfrentando</label>
        <div><input id="bet-to-call" inputMode="decimal" type="text" autoComplete="off" placeholder="0" value={betAmount} onChange={(event) => onBetAmountChange(event.target.value)} onBlur={(event) => onBetAmountChange(formatEditableAmount(event.target.value))} /><span>{unit}</span></div>
      </div>

      <dl className="pot-calculation-preview" aria-live="polite">
        <div><dt>Pote antes do call</dt><dd>{formatPreviewAmount(calculation.potBeforeCall, unit)}</dd></div>
        <div><dt>Valor do call</dt><dd>{formatPreviewAmount(calculation.callAmount, unit)}</dd></div>
        <div><dt>Pot odds</dt><dd>{percent(requiredEquity ?? 0)}</dd></div>
      </dl>

    </article>

    <article className={`poker-tool-card decision-card simplified-decision-card ${decision ?? "pending"}`} aria-live="polite">
      <div className="analysis-card-heading decision-heading">
        <div><span className="tool-icon" aria-hidden="true">⌁</span><h2>Análise da decisão</h2></div>
        {decision && <div className={`decision-status ${decision}`}>
          <strong><span aria-hidden="true">{decision === "positive" ? "✓" : decision === "negative" ? "×" : "="}</span>{decisionTitle}</strong>
          <p>{decisionText}</p>
        </div>}
      </div>

      {equityResult
        ? <EquityResult result={equityResult} />
        : <div className="decision-placeholder">
          <span aria-hidden="true">↗</span>
          <div><h3>Comparação automática</h3><p>Complete as mãos para visualizar a distribuição da equity.</p></div>
        </div>}

      <dl className="decision-summary">
        <div>
          <dt>Equity necessária</dt>
          <dd>{requiredEquity === null ? "—" : percent(requiredEquity)}</dd>
          <small>Pot odds</small>
        </div>
        <div className={decision ?? "pending"}>
          <dt>Margem</dt>
          <dd>{margin === null ? "—" : `${margin >= 0 ? "+" : ""}${(margin * 100).toFixed(1).replace(".", ",")} p.p.`}</dd>
          <small>{decision === "positive" ? "Acima da necessária" : decision === "negative" ? "Abaixo da necessária" : "Ponto de equilíbrio"}</small>
        </div>
        <div className={decision ?? "pending"}>
          <dt>EV do call</dt>
          <dd>{callEV === null ? "—" : formatEV(callEV, unit)}</dd>
          <small>Valor esperado</small>
        </div>
      </dl>
    </article>

  </aside>;
}
