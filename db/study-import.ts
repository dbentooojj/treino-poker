import { eq } from "drizzle-orm";
import type { HrcStudyImport } from "../lib/hrc-import";
import { getDb } from "./index";
import { hasPostgresErrorCode } from "./errors";
import { trainingHands, trainingNodes, trainingSets } from "./schema";

export type PersistedHrcStudy = {
  id: string;
  name: string;
  displayName: string | null;
  equityModel: "CHIP_EV" | "ICM";
  evUnit: HrcStudyImport["evUnit"];
  playersCount: number;
  stackBb: number | null;
  bigBlind: number;
  anteBb: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  status: "IMPORTED";
  isPublished: false;
  spotCount: number;
  importedAt: number;
};

export class DuplicateHrcStudyError extends Error {
  constructor(readonly existingStudyName: string) {
    super(`O estudo “${existingStudyName}” já foi importado a partir deste mesmo ZIP.`);
    this.name = "DuplicateHrcStudyError";
  }
}

export async function persistHrcStudy(study: HrcStudyImport, importedBy: string): Promise<PersistedHrcStudy> {
  const db = getDb();
  const [duplicate] = await db.select({ name: trainingSets.name }).from(trainingSets).where(eq(trainingSets.contentHash, study.contentHash)).limit(1);
  if (duplicate) throw new DuplicateHrcStudyError(duplicate.name);

  const setId = crypto.randomUUID();
  const importedAt = new Date();
  const nodeRows = study.nodes.map((node) => ({
    id: crypto.randomUUID(),
    trainingSetId: setId,
    nodeKey: node.nodeKey,
    trainingType: node.trainingType,
    heroPosition: node.heroPosition,
    heroStackBb: node.heroStackBb,
    villainPosition: node.villainPosition,
    actionSequence: node.actionSequence,
    availableActions: node.availableActions,
    metadata: node.metadata,
  }));
  const nodeTypes = [...new Set(study.nodes.map((node) => node.trainingType))];

  try {
    await db.transaction(async (tx) => {
      await tx.insert(trainingSets).values({
        id: setId,
        name: study.name,
        source: "HRC",
        contentHash: study.contentHash,
        gameType: "TOURNAMENT",
        street: "PREFLOP",
        trainingType: nodeTypes.length === 1 ? nodeTypes[0] : null,
        equityModel: study.equityModel,
        evUnit: study.evUnit,
        playersCount: study.playersCount,
        stackBb: study.stackBb,
        smallBlind: study.smallBlind,
        bigBlind: study.bigBlind,
        ante: study.ante,
        anteType: study.anteType,
        status: "IMPORTED",
        isPublished: false,
        icmContext: study.icmContext,
        importedAt,
        metadata: { ...study.metadata, importedBy, contentHash: study.contentHash, archiveSizeBytes: study.archiveSizeBytes },
      });
      for (const chunk of chunks(nodeRows, 500)) await tx.insert(trainingNodes).values(chunk);
      for (let nodeIndex = 0; nodeIndex < study.nodes.length; nodeIndex += 1) {
        const handRows = study.nodes[nodeIndex].hands.map((hand) => ({
          id: crypto.randomUUID(),
          trainingNodeId: nodeRows[nodeIndex].id,
          handClass: hand.handClass,
          strategy: hand.strategy,
          evs: hand.evs,
          bestAction: hand.bestAction,
          decisionClarity: hand.decisionClarity,
          isMixed: hand.isMixed,
          metadata: hand.metadata,
        }));
        for (const chunk of chunks(handRows, 1_000)) await tx.insert(trainingHands).values(chunk);
      }
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      const [existing] = await db.select({ name: trainingSets.name }).from(trainingSets).where(eq(trainingSets.contentHash, study.contentHash)).limit(1);
      if (existing) throw new DuplicateHrcStudyError(existing.name);
    }
    throw error;
  }

  return {
    id: setId,
    name: study.name,
    displayName: null,
    equityModel: study.equityModel,
    evUnit: study.evUnit,
    playersCount: study.playersCount,
    stackBb: study.stackBb,
    bigBlind: study.bigBlind,
    anteBb: study.bigBlind > 0 ? study.ante / study.bigBlind : 0,
    anteType: study.anteType,
    status: "IMPORTED",
    isPublished: false,
    spotCount: nodeRows.length,
    importedAt: importedAt.getTime(),
  };
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}
