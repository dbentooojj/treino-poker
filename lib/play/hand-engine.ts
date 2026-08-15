import { compareHandRanks, evaluateHand, type HandRank } from "../poker/evaluator";
import { formatBb } from "../training";
import type {
  HandActionRecord,
  HandNode,
  HandResultState,
  HandState,
  PlayableHandScenario,
  PlayActionDefinition,
  PlayerState,
  PlayPosition,
  ResolvedPlayAction,
  Street,
  StreetReview,
} from "./types";

const BOARD_CARD_COUNTS: Partial<Record<Street, number>> = { FLOP: 3, TURN: 4, RIVER: 5 };
const STREET_ORDER: Exclude<Street, "SHOWDOWN" | "FINISHED">[] = ["PREFLOP", "FLOP", "TURN", "RIVER"];
const CATEGORY_LABELS: Record<HandRank["category"], string> = {
  "High Card": "Carta alta",
  Pair: "Par",
  "Two Pair": "Dois pares",
  "Three of a Kind": "Trinca",
  Straight: "Sequência",
  Flush: "Flush",
  "Full House": "Full house",
  "Four of a Kind": "Quadra",
  "Straight Flush": "Straight flush",
};
const PAIR_RANKS: Record<number, string> = { 14: "Ases", 13: "Reis", 12: "Damas", 11: "Valetes", 10: "Dezes", 9: "Noves", 8: "Oitos", 7: "Setes", 6: "Seis", 5: "Cincos", 4: "Quatros", 3: "Três", 2: "Dois" };

export class HandEngine {
  readonly hand: PlayableHandScenario;
  private readonly nodes: Map<string, HandNode>;
  private state: HandState;
  private pendingNext: string | null = null;
  private payoutPositions: PlayPosition[] = [];

  constructor(hand: PlayableHandScenario, handNumber = 1) {
    validateHand(hand);
    this.hand = hand;
    this.nodes = new Map(hand.nodes.map((node) => [node.id, node]));
    const players = hand.players.map<PlayerState>((entry) => ({
      ...entry,
      stackBb: hand.effectiveStackBb,
      committedBb: 0,
      cardsVisible: entry.position === hand.heroPosition,
      folded: false,
      allIn: false,
      hero: entry.position === hand.heroPosition,
    }));
    this.postBlind(players, "SB", hand.smallBlindBb);
    this.postBlind(players, "BB", hand.bigBlindBb);
    this.state = {
      handId: hand.id,
      handNumber,
      street: "PREFLOP",
      phase: "DEALING",
      potBb: 0,
      activePosition: null,
      dealerPosition: hand.dealerPosition,
      heroPosition: hand.heroPosition,
      board: [],
      players,
      dealtCardCount: 0,
      muckCount: 0,
      currentNodeId: hand.firstNodeId,
      lastAction: null,
      actionHistory: [],
      result: null,
    };
  }

  snapshot(): HandState {
    return {
      ...this.state,
      board: this.state.board.map((card) => ({ ...card })),
      players: this.state.players.map((player) => ({ ...player, cards: [{ ...player.cards[0] }, { ...player.cards[1] }] })),
      lastAction: this.state.lastAction ? { ...this.state.lastAction } : null,
      actionHistory: this.state.actionHistory.map((record) => ({ ...record })),
      result: this.state.result ? { ...this.state.result, reviews: this.state.result.reviews.map((review) => ({ ...review })) } : null,
    };
  }

  currentNode(): HandNode | null {
    return this.state.currentNodeId ? this.nodes.get(this.state.currentNodeId) ?? null : null;
  }

  isHeroTurn(): boolean {
    return this.state.phase === "PLAYING" && this.state.activePosition === this.hand.heroPosition;
  }

  availableActions(): ResolvedPlayAction[] {
    const node = this.currentNode();
    if (!node || !this.isHeroTurn()) return [];
    return node.actions.map((action) => this.resolveAction(action, node.actor));
  }

  automaticAction(): ResolvedPlayAction | null {
    const node = this.currentNode();
    if (!node || this.state.phase !== "PLAYING" || node.actor === this.hand.heroPosition || node.actions.length !== 1) return null;
    return this.resolveAction(node.actions[0], node.actor);
  }

  dealNextCard(): HandState {
    this.requirePhase("DEALING");
    this.state.dealtCardCount += 1;
    if (this.state.dealtCardCount === this.state.players.length * 2) this.activateNode(this.hand.firstNodeId);
    return this.snapshot();
  }

  act(actionId: string): HandState {
    this.requirePhase("PLAYING");
    const node = this.currentNode();
    if (!node || node.actor !== this.state.activePosition) throw new Error("Não existe jogador ativo para esta ação.");
    const definition = node.actions.find((action) => action.id === actionId);
    if (!definition) throw new Error(`Ação inválida neste node: ${actionId}`);
    const action = this.resolveAction(definition, node.actor);
    this.assertLegalAction(action, node.actor);
    const player = this.player(node.actor);

    if (action.type === "FOLD") {
      player.folded = true;
      this.state.muckCount += 1;
    } else if (action.type === "CALL" || action.type === "BET" || action.type === "RAISE" || action.type === "ALL_IN") {
      const contribution = this.contributionFor(action, player);
      player.stackBb = roundBb(player.stackBb - contribution);
      player.committedBb = roundBb(player.committedBb + contribution);
      player.allIn = player.stackBb === 0;
    }

    const record: HandActionRecord = {
      nodeId: node.id,
      street: node.street,
      position: node.actor,
      actionId: action.id,
      type: action.type,
      amountBb: action.amountBb,
      label: actionLabel(action),
      hero: node.actor === this.hand.heroPosition,
    };
    this.state.lastAction = record;
    this.state.actionHistory.push(record);
    this.pendingNext = action.next;
    this.state.activePosition = null;
    this.state.phase = "ACTION_RESOLVING";
    return this.snapshot();
  }

  resolvePendingAction(): HandState {
    this.requirePhase("ACTION_RESOLVING");
    if (!this.pendingNext) throw new Error("A ação não possui uma transição pendente.");
    const targetNode = this.nodes.get(this.pendingNext);
    if (targetNode && targetNode.street === this.state.street) {
      this.activateNode(targetNode.id);
      return this.snapshot();
    }
    if (this.committedTotal() > 0) {
      this.state.phase = "COLLECTING";
      return this.snapshot();
    }
    if (targetNode) this.beginNextStreet(targetNode);
    else this.enterTerminalIfReady();
    return this.snapshot();
  }

  collectBets(): HandState {
    this.requirePhase("COLLECTING");
    const collected = this.committedTotal();
    this.state.potBb = roundBb(this.state.potBb + collected);
    for (const player of this.state.players) player.committedBb = 0;
    const targetNode = this.pendingNext ? this.nodes.get(this.pendingNext) : null;
    if (targetNode) this.beginNextStreet(targetNode);
    else this.enterTerminalIfReady();
    return this.snapshot();
  }

  revealNextBoardCard(): HandState {
    this.requirePhase("DEALING_BOARD");
    const targetCount = BOARD_CARD_COUNTS[this.state.street];
    if (!targetCount) throw new Error("Esta street não possui cartas comunitárias para distribuir.");
    if (this.state.board.length >= targetCount) throw new Error("Todas as cartas desta street já foram distribuídas.");
    this.state.board.push({ ...this.hand.board[this.state.board.length] });
    if (this.state.board.length === targetCount) {
      if (!this.pendingNext || !this.nodes.has(this.pendingNext)) throw new Error("Street sem próximo node válido.");
      this.activateNode(this.pendingNext);
    }
    return this.snapshot();
  }

  completeShowdown(): HandState {
    this.requirePhase("SHOWDOWN");
    const contenders = this.state.players.filter((player) => !player.folded);
    if (contenders.length < 2 || this.state.board.length !== 5) throw new Error("Showdown exige board completo e ao menos dois jogadores.");
    const ranked = contenders.map((player) => ({ player, rank: evaluateHand([...player.cards, ...this.state.board]) }));
    let best = ranked[0].rank;
    for (const entry of ranked.slice(1)) if (compareHandRanks(entry.rank, best) > 0) best = entry.rank;
    const winners = ranked.filter((entry) => compareHandRanks(entry.rank, best) === 0).map((entry) => entry.player.position);
    this.payoutPositions = winners;
    this.state.result = this.buildResult(winners.length === 1 ? winners[0] : "TIE", best, true);
    this.state.phase = "PAYOUT";
    return this.snapshot();
  }

  awardPot(): HandState {
    this.requirePhase("PAYOUT");
    if (!this.state.result || this.payoutPositions.length === 0) throw new Error("Não existe vencedor para receber o pote.");
    const share = roundBb(this.state.potBb / this.payoutPositions.length);
    for (const position of this.payoutPositions) this.player(position).stackBb = roundBb(this.player(position).stackBb + share);
    this.state.potBb = 0;
    this.state.activePosition = null;
    this.state.street = "FINISHED";
    this.state.phase = "FINISHED";
    return this.snapshot();
  }

  private beginNextStreet(node: HandNode) {
    this.state.street = node.street;
    this.state.currentNodeId = node.id;
    this.state.activePosition = null;
    this.state.phase = "DEALING_BOARD";
  }

  private enterTerminalIfReady() {
    if (!this.pendingNext) throw new Error("Transição terminal ausente.");
    if (this.pendingNext === "SHOWDOWN") {
      this.state.street = "SHOWDOWN";
      this.state.phase = "SHOWDOWN";
      this.state.currentNodeId = null;
      this.state.activePosition = null;
      for (const player of this.state.players) if (!player.folded) player.cardsVisible = true;
      return;
    }
    if (!this.pendingNext.startsWith("WIN:")) throw new Error(`Destino desconhecido: ${this.pendingNext}`);
    const winner = this.pendingNext.slice(4) as PlayPosition;
    this.player(winner);
    this.payoutPositions = [winner];
    this.state.result = this.buildResult(winner, null, false);
    this.state.phase = "PAYOUT";
    this.state.currentNodeId = null;
    this.state.activePosition = null;
  }

  private buildResult(winner: PlayPosition | "TIE", rank: HandRank | null, showdown: boolean): HandResultState {
    const heroWon = winner === this.hand.heroPosition;
    return {
      winnerPosition: winner,
      winnerLabel: winner === "TIE" ? "Pote dividido" : heroWon ? "Hero vence" : `${winner} vence`,
      handLabel: rank ? describeRank(rank) : "Pote sem showdown",
      score: this.score(),
      reviews: this.streetReviews(),
      evDeltaBb: this.evDeltaBb(),
      wonPotBb: this.state.potBb,
      showdown,
    };
  }

  private score() {
    const heroRecords = this.state.actionHistory.filter((record) => record.hero);
    if (heroRecords.length === 0) return 0;
    const correct = heroRecords.filter((record) => ["BEST", "CORRECT"].includes(this.actionGrade(record))).length;
    return Math.round(correct / heroRecords.length * 100);
  }

  private streetReviews(): StreetReview[] {
    return STREET_ORDER.map((street) => {
      const decisions = this.state.actionHistory.filter((record) => record.hero && record.street === street);
      if (decisions.length === 0) return { street, status: "NOT_PLAYED" };
      const grades = decisions.map((record) => this.actionGrade(record));
      const status: StreetReview["status"] = grades.includes("WRONG")
        ? "WRONG"
        : grades.includes("INACCURACY")
          ? "INACCURACY"
          : grades.includes("CORRECT")
            ? "CORRECT"
            : "BEST";
      return { street, status };
    });
  }

  private actionGrade(record: HandActionRecord): StreetReview["status"] {
    const node = this.nodes.get(record.nodeId);
    const strategy = node?.strategy?.actions;
    const selected = strategy?.find((action) => action.actionId === record.actionId);
    const dominantFrequency = strategy?.reduce((maximum, action) => Math.max(maximum, action.frequencyPercent), 0);
    if (selected && dominantFrequency !== undefined) {
      if (selected.frequencyPercent >= dominantFrequency - .1) return "BEST";
      if (selected.frequencyPercent >= 5) return "CORRECT";
      if (selected.frequencyPercent > 0) return "INACCURACY";
      return "WRONG";
    }
    return node?.preferredActionId === record.actionId ? "BEST" : "WRONG";
  }

  private evDeltaBb() {
    let total = 0;
    let comparableDecisions = 0;
    for (const record of this.state.actionHistory.filter((entry) => entry.hero)) {
      const strategy = this.nodes.get(record.nodeId)?.strategy?.actions ?? [];
      const selectedEv = strategy.find((action) => action.actionId === record.actionId)?.evBb;
      const availableEvs = strategy.map((action) => action.evBb).filter((value): value is number => value !== undefined && Number.isFinite(value));
      if (selectedEv === undefined || availableEvs.length === 0) continue;
      total += selectedEv - Math.max(...availableEvs);
      comparableDecisions += 1;
    }
    return comparableDecisions > 0 ? Number(total.toFixed(4)) : null;
  }

  private activateNode(nodeId: string) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node inexistente: ${nodeId}`);
    const player = this.player(node.actor);
    if (player.folded) throw new Error(`Jogador foldado não pode voltar a agir: ${node.actor}`);
    this.pendingNext = null;
    this.state.currentNodeId = node.id;
    this.state.street = node.street;
    this.state.activePosition = node.actor;
    this.state.phase = "PLAYING";
  }

  private resolveAction(action: PlayActionDefinition, actor: PlayPosition): ResolvedPlayAction {
    const player = this.player(actor);
    const { potFraction, ...resolved } = action;
    if (action.type === "CALL") return { ...resolved, amountBb: roundBb(Math.min(this.toCall(player), player.stackBb)) };
    if (action.type === "ALL_IN") return { ...resolved, amountBb: roundBb(player.stackBb + player.committedBb) };
    if (potFraction !== undefined) return { ...resolved, amountBb: roundBb(Math.max(0.1, this.state.potBb * potFraction)) };
    return resolved;
  }

  private assertLegalAction(action: ResolvedPlayAction, actor: PlayPosition) {
    const player = this.player(actor);
    const toCall = this.toCall(player);
    if (player.folded || player.allIn) throw new Error("Este jogador não pode mais agir.");
    if (action.type === "CHECK" && toCall > 0) throw new Error("Check não é válido diante de uma aposta.");
    if (action.type === "CALL" && toCall <= 0) throw new Error("Call não é válido sem aposta a pagar.");
    if (action.type === "BET" && toCall > 0) throw new Error("Bet não é válido diante de uma aposta; use raise.");
    if (action.type === "RAISE") {
      if (action.amountBb === undefined || action.amountBb <= this.highestCommitment()) throw new Error("O raise precisa superar a aposta atual.");
      if (action.amountBb > player.stackBb + player.committedBb) throw new Error("O raise excede o stack disponível.");
    }
    if (action.type === "BET" && (!action.amountBb || action.amountBb > player.stackBb)) throw new Error("A aposta excede o stack disponível.");
    if (action.type === "ALL_IN" && action.amountBb !== player.stackBb + player.committedBb) throw new Error("O all-in deve comprometer todo o stack.");
  }

  private contributionFor(action: ResolvedPlayAction, player: PlayerState) {
    if (action.type === "CALL" || action.type === "BET" || action.type === "ALL_IN") return roundBb(Math.min(action.amountBb ?? 0, player.stackBb));
    if (action.type === "RAISE") return roundBb(Math.min((action.amountBb ?? 0) - player.committedBb, player.stackBb));
    return 0;
  }

  private toCall(player: PlayerState) {
    return roundBb(Math.max(0, this.highestCommitment() - player.committedBb));
  }

  private highestCommitment() {
    return Math.max(...this.state.players.map((player) => player.committedBb));
  }

  private committedTotal() {
    return roundBb(this.state.players.reduce((total, player) => total + player.committedBb, 0));
  }

  private player(position: PlayPosition) {
    const player = this.state.players.find((entry) => entry.position === position);
    if (!player) throw new Error(`Posição ausente na mão: ${position}`);
    return player;
  }

  private postBlind(players: PlayerState[], position: PlayPosition, amountBb: number) {
    const player = players.find((entry) => entry.position === position);
    if (!player) throw new Error(`Blind sem jogador: ${position}`);
    player.stackBb = roundBb(player.stackBb - amountBb);
    player.committedBb = roundBb(amountBb);
  }

  private requirePhase(phase: HandState["phase"]) {
    if (this.state.phase !== phase) throw new Error(`Operação indisponível durante ${this.state.phase}.`);
  }
}

export function actionLabel(action: ResolvedPlayAction) {
  const amount = action.amountBb === undefined ? "" : ` ${formatBb(action.amountBb)} BB`;
  if (action.type === "FOLD") return "FOLD";
  if (action.type === "CHECK") return "CHECK";
  if (action.type === "CALL") return `CALL${amount}`;
  if (action.type === "BET") return `BET${amount}`;
  if (action.type === "RAISE") return `RAISE TO${amount}`;
  return `ALL-IN${amount}`;
}

function describeRank(rank: HandRank) {
  if (rank.category === "Pair") return `Par de ${PAIR_RANKS[rank.kickers[0]] ?? "cartas"}`;
  return CATEGORY_LABELS[rank.category];
}

function roundBb(value: number) {
  return Math.round(value * 10 + 1e-8) / 10;
}

function validateHand(hand: PlayableHandScenario) {
  if (hand.players.length < 2 || hand.players.length > 10) throw new Error("Uma mão jogável deve possuir entre dois e dez jogadores.");
  const positions = new Set(hand.players.map((player) => player.position));
  if (positions.size !== hand.players.length || !positions.has(hand.heroPosition) || !positions.has(hand.dealerPosition)) throw new Error("As posições, o Hero e o dealer devem estar presentes no cenário.");
  const nodes = new Set(hand.nodes.map((node) => node.id));
  if (nodes.size !== hand.nodes.length || !nodes.has(hand.firstNodeId)) throw new Error("A árvore do cenário possui nodes duplicados ou início inválido.");
  const cards = [...hand.players.flatMap((player) => player.cards), ...hand.board].map((entry) => `${entry.rank}${entry.suit}`);
  if (new Set(cards).size !== cards.length) throw new Error("O cenário contém cartas duplicadas.");
}
