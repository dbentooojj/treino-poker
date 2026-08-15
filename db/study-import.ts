import { and, eq, ne } from "drizzle-orm";
import { normalizeHrcNodeReference, type HrcStudyImport } from "../lib/hrc-import";
import { getDb } from "./index";
import { hasPostgresErrorCode } from "./errors";
import { hrcSourceEdges, hrcSourceHands, hrcSourceNodes, studyCapabilities, trainingHands, trainingNodes, trainingSets } from "./schema";

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
  capabilities: Array<HrcStudyImport["capabilities"][number]["capability"]>;
};

export class DuplicateHrcStudyError extends Error {
  constructor(readonly existingStudyName: string) {
    super(`O estudo “${existingStudyName}” já foi importado a partir deste mesmo ZIP.`);
    this.name = "DuplicateHrcStudyError";
  }
}

export async function persistHrcStudy(study: HrcStudyImport, importedBy: string): Promise<PersistedHrcStudy> {
  const db = getDb();
  const activeDuplicate = and(eq(trainingSets.contentHash, study.contentHash), ne(trainingSets.status, "ARCHIVED"));

  const setId = crypto.randomUUID();
  const importedAt = new Date();
  const nodeRows = study.nodes.map((node) => ({
    id: crypto.randomUUID(),
    trainingSetId: setId,
    nodeKey: node.nodeKey,
    trainingType: node.trainingType,
    decisionEligible: node.decisionEligible,
    heroPosition: node.heroPosition,
    heroStackBb: node.heroStackBb,
    villainPosition: node.villainPosition,
    actionSequence: node.actionSequence,
    availableActions: node.availableActions,
    metadata: node.metadata,
  }));
  const nodeTypes = [...new Set(study.nodes.map((node) => node.trainingType).filter((type): type is NonNullable<typeof type> => type !== null))];
  const trainingNodeIds = new Map(nodeRows.map((node) => [node.nodeKey, node.id]));
  const decisionNodeKeys = new Set(study.nodes.filter((node) => node.decisionEligible).map((node) => node.nodeKey));
  const sourceRowIds = study.sourceNodes.map(() => crypto.randomUUID());
  const sourceNodeIdsByReference = new Map<string, string | null>();
  study.sourceNodes.forEach((node, index) => {
    for (const reference of [node.sourceNodeId, node.sourcePath]) {
      const normalized = normalizeHrcNodeReference(reference);
      if (!normalized) continue;
      const existing = sourceNodeIdsByReference.get(normalized);
      if (existing === undefined || existing === sourceRowIds[index]) sourceNodeIdsByReference.set(normalized, sourceRowIds[index]);
      else sourceNodeIdsByReference.set(normalized, null);
    }
  });

  try {
    await db.transaction(async (tx) => {
      const [duplicate] = await tx.select({
        id: trainingSets.id,
        name: trainingSets.name,
        metadata: trainingSets.metadata,
      }).from(trainingSets).where(activeDuplicate).limit(1).for("update");
      if (duplicate) {
        const existingVersion = Number(duplicate.metadata.validationVersion);
        const incomingVersion = Number(study.metadata.validationVersion);
        if (!Number.isInteger(existingVersion) || !Number.isInteger(incomingVersion) || incomingVersion <= existingVersion) {
          throw new DuplicateHrcStudyError(duplicate.name);
        }
        await tx.update(trainingSets).set({
          status: "ARCHIVED",
          isPublished: false,
          publishedAt: null,
        }).where(eq(trainingSets.id, duplicate.id));
      }
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
      if (study.capabilities.length) {
        await tx.insert(studyCapabilities).values(study.capabilities.map((item) => {
          const rootReference = typeof item.metadata.rootSourceNodeId === "string"
            ? sourceNodeIdsByReference.get(normalizeHrcNodeReference(item.metadata.rootSourceNodeId) ?? "") ?? null
            : null;
          return {
            id: crypto.randomUUID(),
            trainingSetId: setId,
            capability: item.capability,
            metadata: {
              ...item.metadata,
              ...(rootReference ? { rootSourceNodeId: rootReference } : {}),
            },
          };
        }));
      }
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
      for (let start = 0; start < study.sourceNodes.length; start += 1_000) {
        const sourceRows = study.sourceNodes.slice(start, start + 1_000).map((node, offset) => ({
          id: sourceRowIds[start + offset],
          trainingSetId: setId,
          trainingNodeId: node.trainingNodeKey ? trainingNodeIds.get(node.trainingNodeKey) ?? null : null,
          sourceNodeId: node.sourceNodeId,
          sourcePath: node.sourcePath,
          player: node.player,
          street: node.street,
          actionSequence: node.sequence,
          actions: node.actions,
          isTrainable: node.trainingNodeKey ? decisionNodeKeys.has(node.trainingNodeKey) : false,
          metadata: { ...node.metadata, ignoredReason: node.ignoredReason },
        }));
        await tx.insert(hrcSourceNodes).values(sourceRows);
      }
      for (let nodeIndex = 0; nodeIndex < study.sourceNodes.length; nodeIndex++) {
        const hands = study.sourceNodes[nodeIndex].hands;
        if (!hands.length) continue;
        const handRows = hands.map((hand) => ({
          id: crypto.randomUUID(),
          sourceNodeId: sourceRowIds[nodeIndex],
          handClass: hand.handClass,
          strategy: hand.strategy,
          evs: hand.evs,
          weight: hand.weight,
          metadata: hand.metadata,
        }));
        for (const chunk of chunks(handRows, 1_000)) await tx.insert(hrcSourceHands).values(chunk);
      }
      let sourceEdgeBatch: Array<{
        id: string;
        trainingSetId: string;
        parentNodeId: string;
        actionIndex: number;
        childReference: string;
        childNodeId: string | null;
        metadata: Record<string, unknown>;
      }> = [];
      for (let nodeIndex = 0; nodeIndex < study.sourceNodes.length; nodeIndex++) {
        const node = study.sourceNodes[nodeIndex];
        for (let actionIndex = 0; actionIndex < node.actions.length; actionIndex++) {
          const action = node.actions[actionIndex];
          if (action.node === undefined) continue;
          const childReference = String(action.node);
          const normalizedChildReference = normalizeHrcNodeReference(action.node);
          sourceEdgeBatch.push({
            id: crypto.randomUUID(),
            trainingSetId: setId,
            parentNodeId: sourceRowIds[nodeIndex],
            actionIndex,
            childReference,
            childNodeId: normalizedChildReference ? sourceNodeIdsByReference.get(normalizedChildReference) ?? null : null,
            metadata: { hrcType: action.type, hrcAmount: action.amount, ...action.metadata },
          });
          if (sourceEdgeBatch.length === 1_000) {
            await tx.insert(hrcSourceEdges).values(sourceEdgeBatch);
            sourceEdgeBatch = [];
          }
        }
      }
      if (sourceEdgeBatch.length) await tx.insert(hrcSourceEdges).values(sourceEdgeBatch);
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      const [existing] = await db.select({ name: trainingSets.name }).from(trainingSets).where(activeDuplicate).limit(1);
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
    spotCount: study.nodes.filter((node) => node.decisionEligible).length,
    importedAt: importedAt.getTime(),
    capabilities: study.capabilities.map((item) => item.capability),
  };
}

function* chunks<T>(rows: T[], size: number) {
  for (let index = 0; index < rows.length; index += size) yield rows.slice(index, index + size);
}
