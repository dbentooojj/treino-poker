import { env } from "cloudflare:workers";
import {
  type BlindStructure,
  type EquityModel,
  type TrainingAction,
  type TrainingConfig,
  type TrainingFilters,
  type TrainingHand,
  type TrainingNode,
  type TrainingOptions,
  type TrainingSequenceAction,
  type TrainingType,
} from "../lib/training";

let trainingSchemaPromise: Promise<void> | null = null;

export function ensureTrainingSchema() {
  trainingSchemaPromise ??= (async () => {
    if (!env.DB) throw new Error("O banco de estudos não está disponível.");
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS training_sets (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'HRC',
        game_type TEXT NOT NULL DEFAULT 'TOURNAMENT' CHECK (game_type IN ('TOURNAMENT')),
        street TEXT NOT NULL DEFAULT 'PREFLOP' CHECK (street IN ('PREFLOP')),
        equity_model TEXT NOT NULL CHECK (equity_model IN ('CHIP_EV', 'ICM')),
        players_count INTEGER NOT NULL,
        stack_bb REAL,
        small_blind REAL NOT NULL,
        big_blind REAL NOT NULL,
        ante REAL NOT NULL DEFAULT 0,
        ante_type TEXT NOT NULL DEFAULT 'NONE' CHECK (ante_type IN ('NONE', 'ANTE', 'BB_ANTE')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        icm_context TEXT,
        imported_at INTEGER NOT NULL,
        metadata TEXT
      )`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_sets_lookup_idx ON training_sets (game_type, street, equity_model, players_count)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_sets_status_idx ON training_sets (status)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS training_nodes (
        id TEXT PRIMARY KEY NOT NULL,
        training_set_id TEXT NOT NULL REFERENCES training_sets(id) ON DELETE CASCADE,
        node_key TEXT NOT NULL,
        training_type TEXT NOT NULL CHECK (training_type IN ('PUSH_FOLD', 'CALL_VS_SHOVE', 'OPEN_FOLD', 'VS_OPEN')),
        hero_position TEXT NOT NULL,
        hero_stack_bb REAL NOT NULL,
        villain_position TEXT,
        action_sequence TEXT NOT NULL,
        available_actions TEXT NOT NULL,
        metadata TEXT
      )`),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS training_nodes_set_key_unique ON training_nodes (training_set_id, node_key)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_nodes_filters_idx ON training_nodes (training_type, hero_stack_bb, hero_position, villain_position)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_nodes_set_id_idx ON training_nodes (training_set_id)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS training_hands (
        id TEXT PRIMARY KEY NOT NULL,
        training_node_id TEXT NOT NULL REFERENCES training_nodes(id) ON DELETE CASCADE,
        hand_class TEXT NOT NULL,
        strategy TEXT NOT NULL,
        evs TEXT NOT NULL,
        best_action TEXT,
        decision_clarity REAL,
        is_mixed INTEGER,
        metadata TEXT
      )`),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS training_hands_node_class_unique ON training_hands (training_node_id, hand_class)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_hands_node_id_idx ON training_hands (training_node_id)"),
    ]);
  })().catch((error) => {
    trainingSchemaPromise = null;
    throw error;
  });
  return trainingSchemaPromise;
}

export async function getTrainingOptions(filters: TrainingFilters): Promise<TrainingOptions> {
  await ensureTrainingSchema();
  const trainingTypes = await distinct<TrainingType>("n.training_type", clauses(filters, []));
  const equityModels = await distinct<EquityModel>("s.equity_model", clauses(filters, ["trainingType"]));
  const playerCounts = await distinct<number>("s.players_count", clauses(filters, ["trainingType", "equityModel"]));
  const stackDepthsBb = await distinct<number>("n.hero_stack_bb", clauses(filters, ["trainingType", "equityModel", "playersCount"]));
  const heroPositions = await distinct<string>("n.hero_position", clauses(filters, ["trainingType", "equityModel", "playersCount", "stackDepthBb"]));
  const fullKeys: Array<keyof TrainingFilters> = ["trainingType", "equityModel", "playersCount", "stackDepthBb", "heroPosition"];
  const villainPositions = await distinct<string>("n.villain_position", clauses(filters, fullKeys), "n.villain_position IS NOT NULL");
  const contextKeys: Array<keyof TrainingFilters> = [...fullKeys, "villainPosition"];
  const icmContexts = await distinct<string>("s.icm_context", clauses(filters, contextKeys), "s.icm_context IS NOT NULL");
  const blindRows = await selectRows<BlindRow>(
    `SELECT DISTINCT s.small_blind, s.big_blind, s.ante, s.ante_type ${baseFrom()} ${whereSql(clauses(filters, [...contextKeys, "icmContext"]))}
     ORDER BY s.big_blind, s.small_blind, s.ante`,
    clauses(filters, [...contextKeys, "icmContext"]).params,
  );
  const matchClause = clauses(filters, [...contextKeys, "icmContext"]);
  const match = await env.DB.prepare(`SELECT 1 AS available ${baseFrom()} ${whereSql(matchClause)} LIMIT 1`).bind(...matchClause.params).first();

  return {
    trainingTypes,
    equityModels,
    playerCounts,
    stackDepthsBb,
    heroPositions: sortPositions(heroPositions),
    villainPositions: sortPositions(villainPositions),
    icmContexts,
    blindStructures: blindRows.map(toBlindStructure),
    hasMatches: Boolean(match),
  };
}

export async function getTrainingSession(config: TrainingConfig): Promise<TrainingNode[]> {
  await ensureTrainingSchema();
  const filter: TrainingFilters = config;
  const exact = clauses(filter, ["trainingType", "equityModel", "playersCount", "stackDepthBb", "heroPosition", "villainPosition", "icmContext"]);
  const rows = await selectRows<SessionRow>(`WITH chosen_node AS (
      SELECT n.id ${baseFrom()} ${whereSql(exact)} ORDER BY RANDOM() LIMIT 1
    )
    SELECT n.id, n.training_set_id, n.training_type, n.hero_position, n.hero_stack_bb,
      n.villain_position, n.action_sequence, n.available_actions,
      s.name AS set_name, s.equity_model, s.players_count, s.small_blind, s.big_blind, s.ante, s.ante_type,
      h.id AS hand_id, h.hand_class, h.strategy, h.evs, h.best_action, h.decision_clarity, h.is_mixed
    FROM chosen_node c
    INNER JOIN training_nodes n ON n.id = c.id
    INNER JOIN training_sets s ON s.id = n.training_set_id
    INNER JOIN training_hands h ON h.training_node_id = n.id
    ORDER BY h.hand_class`, exact.params);
  if (!rows.length) return [];
  const first = rows[0];
  const hands: TrainingHand[] = rows.map((row) => ({
    id: row.hand_id,
    handClass: row.hand_class,
    strategy: parseNumberRecord(row.strategy),
    evs: parseNumberRecord(row.evs),
    bestAction: row.best_action,
    decisionClarity: row.decision_clarity,
    isMixed: row.is_mixed === null ? null : Boolean(row.is_mixed),
  }));
  return [{
    id: first.id,
    setId: first.training_set_id,
    setName: first.set_name,
    trainingType: first.training_type,
    equityModel: first.equity_model,
    playersCount: first.players_count,
    heroStackBb: first.hero_stack_bb,
    heroPosition: first.hero_position,
    villainPosition: first.villain_position,
    blinds: toBlindStructure(first),
    actionSequence: parseArray<TrainingSequenceAction>(first.action_sequence),
    availableActions: parseArray<TrainingAction>(first.available_actions),
    hands,
  }];
}

type ClauseResult = { parts: string[]; params: Array<string | number> };

function clauses(filters: TrainingFilters, keys: Array<keyof TrainingFilters>): ClauseResult {
  const result: ClauseResult = { parts: ["s.game_type = 'TOURNAMENT'", "s.street = 'PREFLOP'", "s.status = 'ACTIVE'", "s.players_count IN (6, 9)"], params: [] };
  const mapping: Partial<Record<keyof TrainingFilters, string>> = {
    trainingType: "n.training_type",
    equityModel: "s.equity_model",
    playersCount: "s.players_count",
    stackDepthBb: "n.hero_stack_bb",
    heroPosition: "n.hero_position",
    villainPosition: "n.villain_position",
    icmContext: "s.icm_context",
  };
  for (const key of keys) {
    const value = filters[key];
    if (value === undefined || value === "") continue;
    result.parts.push(`${mapping[key]} = ?`);
    result.params.push(value);
  }
  return result;
}

function baseFrom() {
  return "FROM training_nodes n INNER JOIN training_sets s ON s.id = n.training_set_id";
}

function whereSql(clause: ClauseResult, extra?: string) {
  return `WHERE ${[...clause.parts, ...(extra ? [extra] : [])].join(" AND ")}`;
}

async function distinct<T>(column: string, clause: ClauseResult, extra?: string) {
  const rows = await selectRows<{ value: T }>(
    `SELECT DISTINCT ${column} AS value ${baseFrom()} ${whereSql(clause, extra)} ORDER BY ${column}`,
    clause.params,
  );
  return rows.map((row) => row.value);
}

async function selectRows<T>(sql: string, params: Array<string | number>) {
  const result = await env.DB.prepare(sql).bind(...params).all<T>();
  return result.results;
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseNumberRecord(value: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch {
    return {};
  }
}

const POSITION_ORDER = ["UTG", "EP", "MP1", "MP2", "HJ", "CO", "BTN", "BU", "SB", "BB"];

function sortPositions(positions: string[]) {
  return positions.sort((left, right) => {
    const leftIndex = POSITION_ORDER.indexOf(left);
    const rightIndex = POSITION_ORDER.indexOf(right);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right);
  });
}

type BlindRow = { small_blind: number; big_blind: number; ante: number; ante_type: string };

function toBlindStructure(row: BlindRow): BlindStructure {
  return { smallBlind: row.small_blind, bigBlind: row.big_blind, ante: row.ante, anteType: row.ante_type };
}

type SessionRow = BlindRow & {
  id: string;
  training_set_id: string;
  training_type: TrainingType;
  hero_position: string;
  hero_stack_bb: number;
  villain_position: string | null;
  action_sequence: string;
  available_actions: string;
  set_name: string;
  equity_model: EquityModel;
  players_count: number;
  hand_id: string;
  hand_class: string;
  strategy: string;
  evs: string;
  best_action: string | null;
  decision_clarity: number | null;
  is_mixed: number | null;
};
