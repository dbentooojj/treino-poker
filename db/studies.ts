import { env } from "cloudflare:workers";
import type { HrcStudyImport } from "../lib/hrc-import";
import { ensureTrainingSchema } from "./training";

export type AdminStudy = {
  id: string;
  name: string;
  equityModel: "CHIP_EV" | "ICM";
  playersCount: number;
  stackBb: number | null;
  bigBlind: number;
  anteBb: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  status: "ACTIVE" | "INACTIVE";
  spotCount: number;
  importedAt: number;
};

export type StudiesAdminData = {
  summary: {
    studies: number;
    active: number;
    spots: number;
  };
  studies: AdminStudy[];
};

type StudyRow = {
  id: string;
  name: string;
  equity_model: AdminStudy["equityModel"];
  players_count: number;
  stack_bb: number | null;
  big_blind: number;
  ante: number;
  ante_type: AdminStudy["anteType"];
  status: AdminStudy["status"];
  spot_count: number;
  imported_at: number;
};

export async function getStudiesAdminData(): Promise<StudiesAdminData> {
  await ensureTrainingSchema();

  const result = await env.DB.prepare(`SELECT
      s.id,
      s.name,
      s.equity_model,
      s.players_count,
      COALESCE(s.stack_bb, MIN(n.hero_stack_bb)) AS stack_bb,
      s.big_blind,
      s.ante,
      s.ante_type,
      s.status,
      COUNT(n.id) AS spot_count,
      s.imported_at
    FROM training_sets s
    LEFT JOIN training_nodes n ON n.training_set_id = s.id
    WHERE s.source = 'HRC'
    GROUP BY s.id
    ORDER BY s.imported_at DESC, s.name ASC`).all<StudyRow>();

  const studies = result.results.map((row) => ({
    id: row.id,
    name: row.name,
    equityModel: row.equity_model,
    playersCount: row.players_count,
    stackBb: row.stack_bb,
    bigBlind: row.big_blind,
    anteBb: row.ante,
    anteType: row.ante_type,
    status: row.status,
    spotCount: Number(row.spot_count),
    importedAt: row.imported_at,
  }));

  return {
    summary: {
      studies: studies.length,
      active: studies.filter((study) => study.status === "ACTIVE").length,
      spots: studies.reduce((total, study) => total + study.spotCount, 0),
    },
    studies,
  };
}

export async function importHrcStudy(study: HrcStudyImport, importedBy: string): Promise<AdminStudy> {
  await ensureTrainingSchema();
  const setId = crypto.randomUUID();
  const importedAt = Date.now();
  const nodeRows = study.nodes.map((node) => ({
    id: crypto.randomUUID(),
    trainingSetId: setId,
    nodeKey: node.nodeKey,
    trainingType: node.trainingType,
    heroPosition: node.heroPosition,
    heroStackBb: node.heroStackBb,
    villainPosition: node.villainPosition,
    actionSequence: JSON.stringify(node.actionSequence),
    availableActions: JSON.stringify(node.availableActions),
    metadata: JSON.stringify(node.metadata),
  }));
  const handRows = study.nodes.flatMap((node, nodeIndex) => node.hands.map((hand) => ({
    id: crypto.randomUUID(),
    trainingNodeId: nodeRows[nodeIndex].id,
    handClass: hand.handClass,
    strategy: JSON.stringify(hand.strategy),
    evs: JSON.stringify(hand.evs),
    bestAction: hand.bestAction,
    decisionClarity: hand.decisionClarity,
    isMixed: hand.isMixed ? 1 : 0,
    metadata: JSON.stringify(hand.metadata),
  })));

  const db = env.DB;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO training_sets
      (id, name, source, game_type, street, equity_model, players_count, stack_bb, small_blind, big_blind, ante, ante_type, status, icm_context, imported_at, metadata)
      VALUES (?, ?, 'HRC', 'TOURNAMENT', 'PREFLOP', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
      .bind(
        setId,
        study.name,
        study.equityModel,
        study.playersCount,
        study.stackBb,
        study.smallBlind,
        study.bigBlind,
        study.ante,
        study.anteType,
        study.icmContext,
        importedAt,
        JSON.stringify({ ...study.metadata, importedBy }),
      ),
  ];

  for (const chunk of jsonChunks(nodeRows)) {
    statements.push(db.prepare(`INSERT INTO training_nodes
      (id, training_set_id, node_key, training_type, hero_position, hero_stack_bb, villain_position, action_sequence, available_actions, metadata)
      SELECT
        json_extract(value, '$.id'), json_extract(value, '$.trainingSetId'), json_extract(value, '$.nodeKey'),
        json_extract(value, '$.trainingType'), json_extract(value, '$.heroPosition'), json_extract(value, '$.heroStackBb'),
        json_extract(value, '$.villainPosition'), json_extract(value, '$.actionSequence'), json_extract(value, '$.availableActions'),
        json_extract(value, '$.metadata')
      FROM json_each(?)`).bind(chunk));
  }
  for (const chunk of jsonChunks(handRows)) {
    statements.push(db.prepare(`INSERT INTO training_hands
      (id, training_node_id, hand_class, strategy, evs, best_action, decision_clarity, is_mixed, metadata)
      SELECT
        json_extract(value, '$.id'), json_extract(value, '$.trainingNodeId'), json_extract(value, '$.handClass'),
        json_extract(value, '$.strategy'), json_extract(value, '$.evs'), json_extract(value, '$.bestAction'),
        json_extract(value, '$.decisionClarity'), json_extract(value, '$.isMixed'), json_extract(value, '$.metadata')
      FROM json_each(?)`).bind(chunk));
  }
  await db.batch(statements);

  return {
    id: setId,
    name: study.name,
    equityModel: study.equityModel,
    playersCount: study.playersCount,
    stackBb: study.stackBb,
    bigBlind: study.bigBlind,
    anteBb: study.ante,
    anteType: study.anteType,
    status: "ACTIVE",
    spotCount: nodeRows.length,
    importedAt,
  };
}

function jsonChunks<T>(rows: T[], maxCharacters = 700_000) {
  const chunks: string[] = [];
  let current: T[] = [];
  let size = 2;
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    if (current.length && size + serialized.length + 1 > maxCharacters) {
      chunks.push(JSON.stringify(current));
      current = [];
      size = 2;
    }
    current.push(row);
    size += serialized.length + 1;
  }
  if (current.length) chunks.push(JSON.stringify(current));
  return chunks;
}
