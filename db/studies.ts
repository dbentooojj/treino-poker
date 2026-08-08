import { asc, desc, eq, sql } from "drizzle-orm";
import type { HrcStudyImport } from "../lib/hrc-import";
import { getDb } from "./index";
import { trainingNodes, trainingSets } from "./schema";
import { persistHrcStudy } from "./study-import";

export { DuplicateHrcStudyError } from "./study-import";

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

export async function importHrcStudy(study: HrcStudyImport, importedBy: string): Promise<AdminStudy> {
  return persistHrcStudy(study, importedBy);
}

export async function setStudyPublished(studyId: string, published: boolean) {
  const [updated] = await getDb().update(trainingSets).set({
    status: published ? "PUBLISHED" : "IMPORTED",
    isPublished: published,
    publishedAt: published ? new Date() : null,
  }).where(eq(trainingSets.id, studyId)).returning({ id: trainingSets.id });
  return Boolean(updated);
}
