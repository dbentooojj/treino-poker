import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { HrcStudyImport } from "../lib/hrc-import";
import { buildSpotSignature, isTrainingPosition, isTrainingType, type TrainingAction, type TrainingSequenceAction, type TrainingType } from "../lib/training";
import { getDb } from "./index";
import { hrcSourceNodes, trainingAnswers, trainingHands, trainingNodes, trainingSessions, trainingSets } from "./schema";
import { persistHrcStudy } from "./study-import";

export { DuplicateHrcStudyError } from "./study-import";

export class InvalidStoredStudyError extends Error {}
export class StudyPublishedError extends Error {}
export class StudyHistoryError extends Error {}

export type AdminStudy = {
  id: string;
  name: string;
  displayName: string | null;
  equityModel: "CHIP_EV" | "ICM";
  playersCount: number;
  stackBb: number | null;
  bigBlind: number;
  anteBb: number;
  anteType: "NONE" | "ANTE" | "BB_ANTE";
  status: "IMPORTED" | "PUBLISHED" | "ARCHIVED";
  isPublished: boolean;
  spotCount: number;
  importedAt: number;
};

export type StudiesAdminData = {
  summary: { studies: number; published: number; spots: number };
  studies: AdminStudy[];
};

export type StudyInventoryFilters = {
  trainingType?: TrainingType;
  heroPosition?: string;
  search?: string;
  page: number;
  pageSize: number;
};

export type StudyInventory = {
  study: {
    id: string;
    name: string;
    displayName: string | null;
    equityModel: "CHIP_EV" | "ICM";
    playersCount: number;
    stackBb: number | null;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    anteType: "NONE" | "ANTE" | "BB_ANTE";
    importedAt: number;
    status: "IMPORTED" | "PUBLISHED" | "ARCHIVED";
    isPublished: boolean;
    sourceNodeCount: number;
    trainingNodeCount: number;
    storedHandClassCount: number;
    eligibleTrainingHandClassCount: number;
    validationVersion: number | null;
    importerVersion: string | null;
  };
  countsByType: Array<{ trainingType: TrainingType; count: number }>;
  countsByPosition: Array<{ heroPosition: string; count: number }>;
  filters: { trainingTypes: TrainingType[]; heroPositions: string[] };
  spots: Array<{
    id: string;
    trainingType: TrainingType;
    heroPosition: string;
    villainPosition: string | null;
    heroStackBb: number;
    actionSequence: TrainingSequenceAction[];
    availableActions: TrainingAction[];
    signature: string;
    storedHandClassCount: number;
    eligibleTrainingHandClassCount: number;
    hasMixedStrategies: boolean;
    actionCount: number;
  }>;
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

export async function getStudiesAdminData(): Promise<StudiesAdminData> {
  const rows = await getDb().select({
    id: trainingSets.id,
    name: trainingSets.name,
    displayName: trainingSets.displayName,
    equityModel: trainingSets.equityModel,
    playersCount: trainingSets.playersCount,
    stackBb: sql<number | null>`COALESCE(${trainingSets.stackBb}, MIN(${trainingNodes.heroStackBb}))`,
    bigBlind: trainingSets.bigBlind,
    ante: trainingSets.ante,
    anteType: trainingSets.anteType,
    status: trainingSets.status,
    isPublished: trainingSets.isPublished,
    spotCount: sql<number>`COUNT(${trainingNodes.id})::int`,
    importedAt: trainingSets.importedAt,
  }).from(trainingSets)
    .leftJoin(trainingNodes, eq(trainingNodes.trainingSetId, trainingSets.id))
    .where(eq(trainingSets.source, "HRC"))
    .groupBy(trainingSets.id)
    .orderBy(desc(trainingSets.importedAt), asc(trainingSets.name));

  const studies: AdminStudy[] = rows.map((row) => ({
    ...row,
    anteBb: row.bigBlind > 0 ? row.ante / row.bigBlind : 0,
    importedAt: row.importedAt.getTime(),
  }));
  return {
    summary: {
      studies: studies.length,
      published: studies.filter((study) => study.isPublished && study.status === "PUBLISHED").length,
      spots: studies.reduce((total, study) => total + study.spotCount, 0),
    },
    studies,
  };
}

export async function getStudyInventory(studyId: string, filters: StudyInventoryFilters): Promise<StudyInventory | null> {
  const db = getDb();
  const [studyRow] = await db.select({
    id: trainingSets.id,
    name: trainingSets.name,
    displayName: trainingSets.displayName,
    equityModel: trainingSets.equityModel,
    playersCount: trainingSets.playersCount,
    stackBb: trainingSets.stackBb,
    smallBlind: trainingSets.smallBlind,
    bigBlind: trainingSets.bigBlind,
    ante: trainingSets.ante,
    anteType: trainingSets.anteType,
    importedAt: trainingSets.importedAt,
    status: trainingSets.status,
    isPublished: trainingSets.isPublished,
    metadata: trainingSets.metadata,
  }).from(trainingSets).where(eq(trainingSets.id, studyId)).limit(1);
  if (!studyRow) return null;

  const baseCondition = eq(trainingNodes.trainingSetId, studyId);
  const [[sourceCount], [trainingCount], [storedHandClassCount], [eligibleTrainingHandClassCount], typeRows, positionRows] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)::int` }).from(hrcSourceNodes).where(eq(hrcSourceNodes.trainingSetId, studyId)),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(trainingNodes).where(baseCondition),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(trainingHands)
      .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId)).where(baseCondition),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(trainingHands)
      .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
      .where(and(baseCondition, sql`COALESCE((${trainingHands.metadata}->>'hrcWeight')::double precision, 1) >= 0.01`)),
    db.select({ trainingType: trainingNodes.trainingType, count: sql<number>`COUNT(*)::int` })
      .from(trainingNodes).where(baseCondition).groupBy(trainingNodes.trainingType).orderBy(asc(trainingNodes.trainingType)),
    db.select({ heroPosition: trainingNodes.heroPosition, count: sql<number>`COUNT(*)::int` })
      .from(trainingNodes).where(baseCondition).groupBy(trainingNodes.heroPosition).orderBy(asc(trainingNodes.heroPosition)),
  ]);

  const spotConditions: SQL[] = [baseCondition];
  if (filters.trainingType) spotConditions.push(eq(trainingNodes.trainingType, filters.trainingType));
  if (filters.heroPosition) spotConditions.push(eq(trainingNodes.heroPosition, filters.heroPosition));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    spotConditions.push(sql`(${trainingNodes.heroPosition} ILIKE ${pattern} OR ${trainingNodes.villainPosition} ILIKE ${pattern} OR ${trainingNodes.actionSequence}::text ILIKE ${pattern} OR ${trainingNodes.availableActions}::text ILIKE ${pattern})`);
  }
  const where = and(...spotConditions)!;
  const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` }).from(trainingNodes).where(where);
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / filters.pageSize)));
  const rows = await db.select({
    id: trainingNodes.id,
    trainingType: trainingNodes.trainingType,
    heroPosition: trainingNodes.heroPosition,
    villainPosition: trainingNodes.villainPosition,
    heroStackBb: trainingNodes.heroStackBb,
    actionSequence: trainingNodes.actionSequence,
    availableActions: trainingNodes.availableActions,
    storedHandClassCount: sql<number>`COUNT(${trainingHands.id})::int`,
    eligibleTrainingHandClassCount: sql<number>`COUNT(${trainingHands.id}) FILTER (WHERE COALESCE((${trainingHands.metadata}->>'hrcWeight')::double precision, 1) >= 0.01)::int`,
    hasMixedStrategies: sql<boolean>`COALESCE(BOOL_OR(${trainingHands.isMixed}), false)`,
  }).from(trainingNodes)
    .leftJoin(trainingHands, eq(trainingHands.trainingNodeId, trainingNodes.id))
    .where(where)
    .groupBy(trainingNodes.id)
    .orderBy(asc(trainingNodes.trainingType), asc(trainingNodes.heroPosition), asc(trainingNodes.id))
    .limit(filters.pageSize)
    .offset((page - 1) * filters.pageSize);

  const validationVersion = Number(studyRow.metadata.validationVersion);
  const studyFields: Omit<typeof studyRow, "metadata"> = {
    id: studyRow.id,
    name: studyRow.name,
    displayName: studyRow.displayName,
    equityModel: studyRow.equityModel,
    playersCount: studyRow.playersCount,
    stackBb: studyRow.stackBb,
    smallBlind: studyRow.smallBlind,
    bigBlind: studyRow.bigBlind,
    ante: studyRow.ante,
    anteType: studyRow.anteType,
    importedAt: studyRow.importedAt,
    status: studyRow.status,
    isPublished: studyRow.isPublished,
  };
  return {
    study: {
      ...studyFields,
      sourceNodeCount: sourceCount.count,
      trainingNodeCount: trainingCount.count,
      storedHandClassCount: storedHandClassCount.count,
      eligibleTrainingHandClassCount: eligibleTrainingHandClassCount.count,
      importedAt: studyRow.importedAt.getTime(),
      validationVersion: Number.isFinite(validationVersion) ? validationVersion : null,
      importerVersion: typeof studyRow.metadata.importerVersion === "string" ? studyRow.metadata.importerVersion : null,
    },
    countsByType: typeRows,
    countsByPosition: positionRows,
    filters: {
      trainingTypes: typeRows.map((row) => row.trainingType),
      heroPositions: positionRows.map((row) => row.heroPosition),
    },
    spots: rows.map((row) => {
      const actionSequence = row.actionSequence as TrainingSequenceAction[];
      const availableActions = row.availableActions as TrainingAction[];
      return {
        ...row,
        actionSequence,
        availableActions,
        signature: buildSpotSignature({ ...row, actionSequence, availableActions }),
        actionCount: availableActions.length,
      };
    }),
    pagination: { page, pageSize: filters.pageSize, total, pages: Math.max(1, Math.ceil(total / filters.pageSize)) },
  };
}

export function parseStudyInventoryFilters(params: URLSearchParams): StudyInventoryFilters | null {
  const trainingType = params.get("trainingType") || undefined;
  const heroPosition = params.get("heroPosition") || undefined;
  const search = params.get("search")?.trim() || undefined;
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 20);
  if (trainingType && !isTrainingType(trainingType)) return null;
  if (heroPosition && !isTrainingPosition(heroPosition)) return null;
  if (search && search.length > 80) return null;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) return null;
  return {
    trainingType: isTrainingType(trainingType) ? trainingType : undefined,
    heroPosition: isTrainingPosition(heroPosition) ? heroPosition : undefined,
    search,
    page,
    pageSize,
  };
}

export async function importHrcStudy(study: HrcStudyImport, importedBy: string): Promise<AdminStudy> {
  return persistHrcStudy(study, importedBy);
}

export async function setStudyPublished(studyId: string, published: boolean) {
  return getDb().transaction(async (tx) => {
    const [study] = await tx.select({ status: trainingSets.status, metadata: trainingSets.metadata })
      .from(trainingSets).where(eq(trainingSets.id, studyId)).limit(1).for("update");
    if (!study) return false;
    if (published) {
      const version = Number(study.metadata.validationVersion);
      if (![2, 3].includes(version)) throw new InvalidStoredStudyError("Reimporte o estudo com a validação HRC atual antes de publicá-lo.");
      if (study.status === "ARCHIVED") throw new InvalidStoredStudyError("Estudos arquivados não podem ser publicados.");
      const [spot] = await tx.select({ id: trainingNodes.id }).from(trainingNodes)
        .where(eq(trainingNodes.trainingSetId, studyId)).limit(1);
      if (!spot) throw new InvalidStoredStudyError("O estudo não possui spots treináveis e não pode ser publicado.");
    }
    await tx.update(trainingSets).set({
      status: published ? "PUBLISHED" : "IMPORTED",
      isPublished: published,
      publishedAt: published ? new Date() : null,
    }).where(eq(trainingSets.id, studyId));
    return true;
  });
}

export async function deleteStudy(studyId: string) {
  return getDb().transaction(async (tx) => {
    const [study] = await tx.select({ id: trainingSets.id, status: trainingSets.status, isPublished: trainingSets.isPublished })
      .from(trainingSets).where(eq(trainingSets.id, studyId)).limit(1).for("update");
    if (!study) return false;
    if (study.status === "PUBLISHED" || study.isPublished) {
      throw new StudyPublishedError("Despublique o estudo antes de excluí-lo.");
    }
    const [[session], [answer]] = await Promise.all([
      tx.select({ id: trainingSessions.id }).from(trainingSessions).where(sql`
        ${trainingSessions.trainingSetId} = ${studyId}
        OR ${trainingSessions.exerciseQueue} @> jsonb_build_array(jsonb_build_object('trainingSetId', ${studyId}::text))
      `).limit(1),
      tx.select({ id: trainingAnswers.id }).from(trainingAnswers).where(eq(trainingAnswers.trainingSetId, studyId)).limit(1),
    ]);
    if (session || answer) {
      throw new StudyHistoryError("Este estudo está vinculado a uma sessão ou possui histórico de treinamento e não pode ser removido. Preserve-o ou arquive-o.");
    }
    await tx.delete(trainingSets).where(eq(trainingSets.id, studyId));
    return true;
  });
}
