export function calculateRequiredEquity(pot: number, call: number): number {
  if (!Number.isFinite(pot) || !Number.isFinite(call) || pot < 0 || call < 0) {
    throw new Error("Pote e valor para pagar devem ser números não negativos.");
  }
  const finalPot = pot + call;
  return finalPot === 0 ? 0 : call / finalPot;
}
