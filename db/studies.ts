import { env } from "cloudflare:workers";
import type { HrcStudyImport } from "../lib/hrc-import";
import { persistHrcStudy } from "./study-import";
import { ensureTrainingSchema } from "./training";

export { DuplicateHrcStudyError } from "./study-import";

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
    anteBb: row.big_blind > 0 ? row.ante / row.big_blind : 0,
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
  return persistHrcStudy(env.DB, study, importedBy);
}
