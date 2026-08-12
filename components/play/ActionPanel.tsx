import { actionLabel } from "../../lib/play/hand-engine";
import type { HandNode, HandState, ResolvedPlayAction } from "../../lib/play/types";
import { UnifiedActionPanel } from "../training/UnifiedActionPanel";

const STREET_NAMES = { PREFLOP: "pré-flop", FLOP: "flop", TURN: "turn", RIVER: "river", SHOWDOWN: "showdown", FINISHED: "fim" } as const;

export function ActionPanel({ state, node, actions, onAction }: { state: HandState; node: HandNode | null; actions: ResolvedPlayAction[]; onAction: (id: string) => void }) {
  const heroTurn = state.phase === "PLAYING" && state.activePosition === state.heroPosition;
  let title = "A mão está em andamento";
  let context = `${STREET_NAMES[state.street]}`;
  if (state.phase === "DEALING") { title = "Distribuindo cartas…"; context = `Todos os ${state.players.length} jogadores recebem duas cartas`; }
  if (state.phase === "COLLECTING") { title = "Recolhendo as apostas…"; context = "As fichas estão indo para o pote"; }
  if (state.phase === "DEALING_BOARD") { title = `Distribuindo o ${STREET_NAMES[state.street]}…`; context = "A próxima street começa em instantes"; }
  if (state.phase === "SHOWDOWN") { title = "Showdown"; context = "Revelando as cartas dos jogadores restantes"; }
  if (state.phase === "PAYOUT") { title = state.result?.winnerLabel ?? "Entregando o pote"; context = state.result?.handLabel ?? "Mão encerrada"; }
  if (state.phase === "ACTION_RESOLVING" && state.lastAction) { title = `${state.lastAction.position} · ${state.lastAction.label}`; context = "Aguardando a ação chegar ao próximo jogador"; }
  if (state.phase === "PLAYING" && !heroTurn && state.activePosition) { title = `Ação em ${state.activePosition}`; context = `Jogando o ${STREET_NAMES[state.street]}`; }
  if (heroTurn) { title = node?.prompt ?? "Sua vez"; context = node?.context ?? "Escolha uma ação válida"; }

  return <UnifiedActionPanel
    eyebrow={heroTurn ? "SUA VEZ" : "MÃO EM ANDAMENTO"}
    title={title}
    context={context}
    active={heroTurn}
    actions={actions.map((action) => ({ id: action.id, label: actionLabel(action), tone: action.type.toLowerCase(), hint: sizingHint(action.id) }))}
    onAction={onAction}
  />;
}

function sizingHint(actionId: string) {
  if (actionId.includes("25")) return "25% do pote";
  if (actionId.includes("33")) return "33% do pote";
  if (actionId.includes("50")) return "50% do pote";
  if (actionId.includes("75")) return "75% do pote";
  if (actionId.includes("pot")) return "100% do pote";
  return null;
}
