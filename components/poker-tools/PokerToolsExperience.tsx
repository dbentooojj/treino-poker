"use client";

import { useState } from "react";
import type { EquityResult as EquityResultData } from "../../lib/poker/equity";
import type { PokerStreet } from "../../lib/poker/street";
import EquityCalculator from "./EquityCalculator";
import PotOddsCalculator from "./PotOddsCalculator";

export type MoneyUnit = "BB" | "R$";

export default function PokerToolsExperience() {
  const [heroEquity, setHeroEquity] = useState<number | null>(null);
  const [equityResult, setEquityResult] = useState<EquityResultData | null>(null);
  const [street, setStreet] = useState<PokerStreet>("preflop");
  const [startingPot, setStartingPot] = useState("");
  const [betAmount, setBetAmount] = useState("");
  const [unit, setUnit] = useState<MoneyUnit>("BB");

  return <section className="tools-content simplified-tools-content">
    <div className="poker-tools-grid simplified-tools-grid">
      <EquityCalculator
        onEquityChange={setHeroEquity}
        onResultChange={setEquityResult}
        onStreetChange={setStreet}
      />
      <PotOddsCalculator
        heroEquity={heroEquity}
        equityResult={equityResult}
        street={street}
        startingPot={startingPot}
        betAmount={betAmount}
        unit={unit}
        onStartingPotChange={setStartingPot}
        onBetAmountChange={setBetAmount}
        onUnitChange={setUnit}
      />
    </div>
  </section>;
}
