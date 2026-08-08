"use client";

import { useState } from "react";
import EquityCalculator from "./EquityCalculator";
import PotOddsCalculator from "./PotOddsCalculator";

export default function PokerToolsExperience() {
  const [heroEquity, setHeroEquity] = useState<number | null>(null);

  return <section className="tools-content">
    <div className="tools-heading">
      <span>FERRAMENTAS DE MESA</span>
      <h1>Decida com os números <em>na mesa.</em></h1>
      <p>Calcule equity real e confira o preço do call em um só lugar. Tudo roda localmente, sem salvar suas cartas.</p>
    </div>
    <div className="poker-tools-grid">
      <EquityCalculator onEquityChange={setHeroEquity} />
      <PotOddsCalculator heroEquity={heroEquity} />
    </div>
  </section>;
}
