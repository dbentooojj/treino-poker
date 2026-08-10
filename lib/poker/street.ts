import { calculateRequiredEquity } from "./pot-odds";

export const STREETS = ["preflop", "flop", "turn", "river"] as const;

export type PokerStreet = (typeof STREETS)[number];
export type VillainStreetAction = "bet" | "check";
export type HeroStreetAction = "pending" | "call" | "fold" | "check";

export const STREET_LABELS: Record<PokerStreet, string> = {
  preflop: "Pré-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

export interface StreetInput {
  startingPot: string;
  villainAction: VillainStreetAction;
  betAmount: string;
  heroAction: HeroStreetAction;
}

export interface StreetDecision {
  startingPot: number | null;
  betAmount: number | null;
  potBeforeCall: number | null;
  callAmount: number | null;
  potAfterCall: number | null;
  requiredEquity: number | null;
  nextPot: number | null;
  handEnded: boolean;
  isComplete: boolean;
}

function createEmptyStreetInput(): StreetInput {
  return {
    startingPot: "",
    villainAction: "bet",
    betAmount: "",
    heroAction: "pending",
  };
}

export function createEmptyStreetInputs(): Record<PokerStreet, StreetInput> {
  return {
    preflop: createEmptyStreetInput(),
    flop: createEmptyStreetInput(),
    turn: createEmptyStreetInput(),
    river: createEmptyStreetInput(),
  };
}

function amountForInput(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function cascadeStreetStartingPots(
  inputs: Record<PokerStreet, StreetInput>,
  editedStreet: PokerStreet,
): Record<PokerStreet, StreetInput> {
  const next = Object.fromEntries(
    STREETS.map((street) => [street, { ...inputs[street] }]),
  ) as Record<PokerStreet, StreetInput>;
  const editedIndex = STREETS.indexOf(editedStreet);

  for (let index = editedIndex; index < STREETS.length - 1; index += 1) {
    const currentStreet = STREETS[index];
    const followingStreet = STREETS[index + 1];
    const decision = deriveStreetDecision(next[currentStreet]);

    if (decision.handEnded) {
      for (let later = index + 1; later < STREETS.length; later += 1) {
        next[STREETS[later]] = createEmptyStreetInput();
      }
      break;
    }

    if (!decision.isComplete || decision.nextPot === null) {
      for (let later = index + 1; later < STREETS.length; later += 1) {
        next[STREETS[later]] = { ...next[STREETS[later]], startingPot: "" };
      }
      break;
    }

    next[followingStreet] = {
      ...next[followingStreet],
      startingPot: amountForInput(decision.nextPot),
    };
  }

  return next;
}

/**
 * Parses the raw amount used by the street form. Both decimal comma and decimal
 * point are accepted, as are grouped values such as `1.234,50` and `1,234.50`.
 */
export function parsePokerAmount(value: string): number | null {
  let normalized = value.trim().replace(/\s+/g, "");
  if (normalized === "" || !/^\+?\d+(?:[.,]\d+)*$/.test(normalized)) return null;

  normalized = normalized.replace(/^\+/, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastPoint = normalized.lastIndexOf(".");

  if (lastComma >= 0 && lastPoint >= 0) {
    const decimalSeparator = lastComma > lastPoint ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.replaceAll(groupingSeparator, "");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (lastComma >= 0 || lastPoint >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = normalized.split(separator);
    const isGrouped = parts.length > 2
      ? parts.slice(1).every((part) => part.length === 3)
      : parts[0] !== "0" && parts[1]?.length === 3;

    if (parts.length > 2 && !isGrouped) return null;
    normalized = isGrouped ? parts.join("") : parts.join(".");
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function normalizeStreetInputAction(
  input: StreetInput,
  villainAction: VillainStreetAction,
): StreetInput {
  const allowedHeroActions: readonly HeroStreetAction[] = villainAction === "check"
    ? ["pending", "check"]
    : ["pending", "call", "fold"];

  return {
    ...input,
    villainAction,
    heroAction: allowedHeroActions.includes(input.heroAction) ? input.heroAction : "pending",
  };
}

export function deriveStreetDecision(input: StreetInput): StreetDecision {
  const startingPot = parsePokerAmount(input.startingPot);

  if (input.villainAction === "check") {
    const isComplete = startingPot !== null && input.heroAction === "check";
    return {
      startingPot,
      betAmount: 0,
      potBeforeCall: startingPot,
      callAmount: 0,
      potAfterCall: startingPot,
      requiredEquity: null,
      nextPot: isComplete ? startingPot : null,
      handEnded: false,
      isComplete,
    };
  }

  const betAmount = parsePokerAmount(input.betAmount);
  const hasValidAmounts = startingPot !== null && betAmount !== null && betAmount > 0;
  const potBeforeCall = hasValidAmounts ? startingPot + betAmount : null;
  const callAmount = hasValidAmounts ? betAmount : null;
  const potAfterCall = hasValidAmounts ? startingPot + betAmount * 2 : null;
  const requiredEquity = potBeforeCall !== null && callAmount !== null
    ? calculateRequiredEquity(potBeforeCall, callAmount)
    : null;
  const isCall = input.heroAction === "call";
  const isFold = input.heroAction === "fold";
  const isComplete = isFold || (hasValidAmounts && isCall);

  return {
    startingPot,
    betAmount,
    potBeforeCall,
    callAmount,
    potAfterCall,
    requiredEquity,
    nextPot: isComplete && isCall ? potAfterCall : null,
    handEnded: isFold,
    isComplete,
  };
}
