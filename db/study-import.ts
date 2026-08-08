import type { HrcStudyImport } from "../lib/hrc-import";

export type PersistedHrcStudy = {
  id: string;
  name: string;
  equityModel: "CHIP_EV" | "ICM";
  playersCount: number;
  stackBb: number | null;
  bigBlind: number;
  anteBb: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  status: "ACTIVE";
  spotCount: number;
  importedAt: number;
};

export class DuplicateHrcStudyError extends Error {
  constructor(readonly existingStudyName: string) {
    super(`O estudo “${existingStudyName}” já foi importado a partir deste mesmo ZIP.`);
    this.name = "DuplicateHrcStudyError";
  }
}

export async function persistHrcStudy(db: D1Database, study: HrcStudyImport, importedBy: string): Promise<PersistedHrcStudy> {
  const duplicate = await db.prepare("SELECT name FROM training_sets WHERE content_hash = ? LIMIT 1")
    .bind(study.contentHash)
    .first<{ name: string }>();
  if (duplicate) throw new DuplicateHrcStudyError(duplicate.name);

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

  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO training_sets
      (id, name, source, content_hash, game_type, street, equity_model, players_count, stack_bb, small_blind, big_blind, ante, ante_type, status, icm_context, imported_at, metadata)
      VALUES (?, ?, 'HRC', ?, 'TOURNAMENT', 'PREFLOP', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
      .bind(
        setId,
        study.name,
        study.contentHash,
        study.equityModel,
        study.playersCount,
        study.stackBb,
        study.smallBlind,
        study.bigBlind,
        study.ante,
        study.anteType,
        study.icmContext,
        importedAt,
        JSON.stringify({ ...study.metadata, importedBy, contentHash: study.contentHash }),
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

  try {
    // D1 executa db.batch como uma única transação e faz rollback do lote inteiro se qualquer statement falhar.
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /content_hash|training_sets_content_hash_unique|unique constraint/i.test(error.message)) {
      const existing = await db.prepare("SELECT name FROM training_sets WHERE content_hash = ? LIMIT 1")
        .bind(study.contentHash)
        .first<{ name: string }>();
      throw new DuplicateHrcStudyError(existing?.name ?? study.name);
    }
    throw error;
  }

  return {
    id: setId,
    name: study.name,
    equityModel: study.equityModel,
    playersCount: study.playersCount,
    stackBb: study.stackBb,
    bigBlind: study.bigBlind,
    anteBb: study.bigBlind > 0 ? study.ante / study.bigBlind : 0,
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
