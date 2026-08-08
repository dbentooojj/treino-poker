"use client";

import { useMemo, useState } from "react";
import { calculateRequiredEquity } from "../../lib/poker/pot-odds";

type PotOddsCalculatorProps = {
  heroEquity: number | null;
};

function numberFromInput(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default function PotOddsCalculator({ heroEquity }: PotOddsCalculatorProps) {
  const [pot, setPot] = useState("100");
  const [call, setCall] = useState("50");
  const [unit, setUnit] = useState<"BB" | "R$">("BB");
  const potValue = numberFromInput(pot);
  const callValue = numberFromInput(call);
  const requiredEquity = useMemo(
    () => potValue === null || callValue === null ? null : calculateRequiredEquity(potValue, callValue),
    [potValue, callValue],
  );

  const comparison = heroEquity === null || requiredEquity === null
    ? null
    : heroEquity > requiredEquity + 1e-10
      ? "positive"
      : heroEquity < requiredEquity - 1e-10
        ? "negative"
        : "neutral";

  return <article className="poker-tool-card pot-odds-card">
    <div className="tool-card-heading compact">
      <span className="tool-icon gold" aria-hidden="true">%</span>
      <div><span>POT ODDS</span><h2>O preço do seu call.</h2><p>Descubra a equity mínima para chegar ao break-even.</p></div>
    </div>

    <div className="unit-switch" aria-label="Unidade dos valores">
      {(["BB", "R$"] as const).map((option) => <button type="button" key={option} aria-pressed={unit === option} className={unit === option ? "active" : ""} onClick={() => setUnit(option)}>{option}</button>)}
    </div>

    <div className="pot-inputs">
      <label htmlFor="current-pot">Pote atual</label>
      <div><input id="current-pot" inputMode="decimal" min="0" step="0.01" type="number" value={pot} onChange={(event) => setPot(event.target.value)} /><span>{unit}</span></div>
      <label htmlFor="call-value">Valor para pagar</label>
      <div><input id="call-value" inputMode="decimal" min="0" step="0.01" type="number" value={call} onChange={(event) => setCall(event.target.value)} /><span>{unit}</span></div>
    </div>

    {requiredEquity !== null ? <section className="pot-odds-result" aria-live="polite">
      <span>POT ODDS</span><strong>{percent(requiredEquity)}</strong>
      <div><span>Equidade mínima necessária</span><b>{percent(requiredEquity)}</b></div>
      <small>{callValue} / ({potValue} + {callValue})</small>
      <p>Você precisa de pelo menos <b>{percent(requiredEquity)}</b> de equidade para que o call seja break-even.</p>
    </section> : <p className="calculator-error">Informe valores não negativos para o pote e o call.</p>}

    {comparison && requiredEquity !== null && heroEquity !== null && <section className={`ev-comparison ${comparison}`} aria-live="polite">
      <span>COMPARAÇÃO MATEMÁTICA</span>
      <dl><div><dt>Sua equity</dt><dd>{percent(heroEquity)}</dd></div><div><dt>Equity necessária</dt><dd>{percent(requiredEquity)}</dd></div></dl>
      <strong>{comparison === "positive" ? "✓ CALL +EV" : comparison === "negative" ? "× CALL -EV" : "= BREAK-EVEN"}</strong>
      <p>{comparison === "positive" ? "A equity estimada é superior à equity mínima exigida pelo preço oferecido." : comparison === "negative" ? "A equity estimada é inferior à equity mínima exigida pelo preço oferecido." : "A equity estimada coincide com a equity mínima exigida pelo preço oferecido."}</p>
      <small>Comparação de equity e preço, não uma recomendação estratégica GTO.</small>
    </section>}

    {!comparison && <div className="integration-placeholder"><span>EQUIDADE × POT ODDS</span><p>Calcule a equity ao lado para comparar os dois números automaticamente.</p></div>}
  </article>;
}
