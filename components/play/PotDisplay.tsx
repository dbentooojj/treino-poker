import { formatBb } from "../../lib/training";
import { ChipStack } from "./ChipStack";

export function PotDisplay({ amountBb }: { amountBb: number }) {
  return <div className="play-pot" aria-live="polite">
    {amountBb > 0 && <ChipStack amountBb={amountBb} compact/>}
    <span>POTE</span>
    <strong>{formatBb(amountBb)} BB</strong>
  </div>;
}
