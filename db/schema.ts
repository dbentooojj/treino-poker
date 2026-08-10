import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["admin", "user"]);
export const gameType = pgEnum("game_type", ["TOURNAMENT"]);
export const street = pgEnum("street", ["PREFLOP"]);
export const equityModel = pgEnum("equity_model", ["CHIP_EV", "ICM"]);
export const evUnit = pgEnum("ev_unit", ["CHIPS", "BIG_BLINDS", "ICM_UTILITY", "UNKNOWN"]);
export const anteType = pgEnum("ante_type", ["NONE", "ANTE", "BB_ANTE"]);
export const trainingType = pgEnum("training_type", ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN"]);
export const trainingSetStatus = pgEnum("training_set_status", ["IMPORTED", "PUBLISHED", "ARCHIVED"]);
export const trainingCompletionReason = pgEnum("training_completion_reason", ["COMPLETED", "USER_FINISHED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  role: userRole("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("sessions_user_id_idx").on(table.userId), index("sessions_expires_at_idx").on(table.expiresAt)]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("password_reset_user_id_unique").on(table.userId), index("password_reset_expires_at_idx").on(table.expiresAt)]);

export const authRateLimits = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  hits: integer("hits").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("auth_rate_limits_expires_at_idx").on(table.expiresAt)]);

export const trainingSets = pgTable("training_sets", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  displayOrder: integer("display_order").notNull().default(0),
  source: text("source").notNull().default("HRC"),
  contentHash: text("content_hash").notNull(),
  gameType: gameType("game_type").notNull().default("TOURNAMENT"),
  street: street("street").notNull().default("PREFLOP"),
  trainingType: trainingType("training_type"),
  equityModel: equityModel("equity_model").notNull(),
  evUnit: evUnit("ev_unit").notNull().default("UNKNOWN"),
  playersCount: integer("players_count").notNull(),
  stackBb: doublePrecision("stack_bb"),
  smallBlind: doublePrecision("small_blind").notNull(),
  bigBlind: doublePrecision("big_blind").notNull(),
  ante: doublePrecision("ante").notNull().default(0),
  anteType: anteType("ante_type").notNull().default("NONE"),
  status: trainingSetStatus("status").notNull().default("IMPORTED"),
  isPublished: boolean("is_published").notNull().default(false),
  icmContext: text("icm_context"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("training_sets_content_hash_unique").on(table.contentHash),
  index("training_sets_lookup_idx").on(table.gameType, table.street, table.equityModel, table.playersCount),
  index("training_sets_publication_idx").on(table.isPublished, table.status, table.displayOrder),
  check("training_sets_players_count_check", sql`${table.playersCount} BETWEEN 2 AND 10`),
  check("training_sets_blinds_check", sql`${table.smallBlind} >= 0 AND ${table.bigBlind} > 0 AND ${table.ante} >= 0`),
  check("training_sets_publication_consistency_check", sql`(${table.status} = 'PUBLISHED' AND ${table.isPublished} = true) OR (${table.status} <> 'PUBLISHED' AND ${table.isPublished} = false)`),
]);

export const trainingNodes = pgTable("training_nodes", {
  id: uuid("id").primaryKey(),
  trainingSetId: uuid("training_set_id").notNull().references(() => trainingSets.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(),
  trainingType: trainingType("training_type").notNull(),
  heroPosition: text("hero_position").notNull(),
  heroStackBb: doublePrecision("hero_stack_bb").notNull(),
  villainPosition: text("villain_position"),
  actionSequence: jsonb("action_sequence").$type<Array<Record<string, unknown>>>().notNull(),
  availableActions: jsonb("available_actions").$type<Array<Record<string, unknown>>>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("training_nodes_set_key_unique").on(table.trainingSetId, table.nodeKey),
  index("training_nodes_filters_idx").on(table.trainingType, table.heroStackBb, table.heroPosition, table.villainPosition),
  index("training_nodes_set_id_idx").on(table.trainingSetId),
  check("training_nodes_stack_check", sql`${table.heroStackBb} > 0`),
]);

export const trainingHands = pgTable("training_hands", {
  id: uuid("id").primaryKey(),
  trainingNodeId: uuid("training_node_id").notNull().references(() => trainingNodes.id, { onDelete: "cascade" }),
  handClass: text("hand_class").notNull(),
  strategy: jsonb("strategy").$type<Record<string, number>>().notNull(),
  evs: jsonb("evs").$type<Record<string, number>>().notNull(),
  bestAction: text("best_action"),
  decisionClarity: doublePrecision("decision_clarity"),
  isMixed: boolean("is_mixed"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("training_hands_node_class_unique").on(table.trainingNodeId, table.handClass),
  index("training_hands_node_id_idx").on(table.trainingNodeId),
]);

export const trainingSessions = pgTable("training_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  trainingSetId: uuid("training_set_id").references(() => trainingSets.id, { onDelete: "restrict" }),
  trainingType: trainingType("training_type").notNull(),
  equityModel: equityModel("equity_model").notNull(),
  playersCount: integer("players_count"),
  stackBb: doublePrecision("stack_bb"),
  heroPosition: text("hero_position"),
  villainPosition: text("villain_position"),
  correctAnswers: integer("correct_answers").notNull().default(0),
  answeredQuestions: integer("answered_questions").notNull().default(0),
  targetQuestions: integer("target_questions"),
  exerciseQueue: jsonb("exercise_queue").$type<Array<{ trainingSetId: string; trainingNodeId: string; trainingHandId: string }>>().notNull().default([]),
  queuePosition: integer("queue_position").notNull().default(0),
  sourceSessionId: uuid("source_session_id"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  completionReason: trainingCompletionReason("completion_reason"),
  answerDetailsAvailable: boolean("answer_details_available").notNull().default(true),
}, (table) => [
  foreignKey({ columns: [table.sourceSessionId], foreignColumns: [table.id], name: "training_sessions_source_session_id_fk" }).onDelete("set null"),
  index("training_sessions_user_started_idx").on(table.userId, table.startedAt),
  uniqueIndex("training_sessions_one_active_per_user_unique").on(table.userId).where(sql`${table.endedAt} IS NULL`),
  index("training_sessions_user_type_idx").on(table.userId, table.trainingType),
  index("training_sessions_set_id_idx").on(table.trainingSetId),
  index("training_sessions_source_id_idx").on(table.sourceSessionId),
  check("training_sessions_target_questions_check", sql`${table.targetQuestions} IS NULL OR (${table.targetQuestions} > 0 AND ${table.targetQuestions} <= 100)`),
  check("training_sessions_counters_check", sql`${table.answeredQuestions} >= 0 AND ${table.correctAnswers} >= 0 AND ${table.correctAnswers} <= ${table.answeredQuestions}`),
  check("training_sessions_queue_check", sql`jsonb_typeof(${table.exerciseQueue}) = 'array' AND jsonb_array_length(${table.exerciseQueue}) <= 100 AND ${table.queuePosition} >= 0 AND ((${table.endedAt} IS NULL AND jsonb_array_length(${table.exerciseQueue}) > 0 AND ${table.queuePosition} < jsonb_array_length(${table.exerciseQueue}) AND jsonb_typeof(${table.exerciseQueue} -> ${table.queuePosition}) = 'object' AND jsonb_typeof((${table.exerciseQueue} -> ${table.queuePosition}) -> 'trainingSetId') IS NOT DISTINCT FROM 'string' AND jsonb_typeof((${table.exerciseQueue} -> ${table.queuePosition}) -> 'trainingNodeId') IS NOT DISTINCT FROM 'string' AND jsonb_typeof((${table.exerciseQueue} -> ${table.queuePosition}) -> 'trainingHandId') IS NOT DISTINCT FROM 'string') OR (${table.endedAt} IS NOT NULL AND ${table.queuePosition} <= jsonb_array_length(${table.exerciseQueue})))`),
  check("training_sessions_completion_consistency_check", sql`(((${table.endedAt} IS NULL AND ${table.completionReason} IS NULL) OR (${table.endedAt} IS NOT NULL AND ${table.completionReason} IS NOT NULL)) AND (${table.completionReason} IS DISTINCT FROM 'COMPLETED' OR (${table.targetQuestions} IS NOT NULL AND ${table.answeredQuestions} >= ${table.targetQuestions})))`),
  check("training_sessions_summary_only_check", sql`${table.answerDetailsAvailable} = true OR (${table.endedAt} IS NOT NULL AND ${table.completionReason} = 'USER_FINISHED' AND ${table.targetQuestions} IS NULL AND ${table.exerciseQueue} = '[]'::jsonb AND ${table.queuePosition} = 0)`),
]);

export const trainingAnswers = pgTable("training_answers", {
  id: uuid("id").primaryKey(),
  trainingSessionId: uuid("training_session_id").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
  trainingSetId: uuid("training_set_id").notNull().references(() => trainingSets.id, { onDelete: "restrict" }),
  trainingNodeId: uuid("training_node_id").notNull().references(() => trainingNodes.id, { onDelete: "restrict" }),
  trainingHandId: uuid("training_hand_id").notNull().references(() => trainingHands.id, { onDelete: "restrict" }),
  questionIndex: integer("question_index").notNull(),
  handClass: text("hand_class").notNull(),
  heroPosition: text("hero_position").notNull(),
  stackBb: doublePrecision("stack_bb").notNull(),
  evUnit: evUnit("ev_unit").notNull().default("UNKNOWN"),
  selectedAction: jsonb("selected_action").$type<Record<string, unknown>>().notNull(),
  bestAction: text("best_action").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  strategy: jsonb("strategy").$type<Record<string, number>>().notNull(),
  evs: jsonb("evs").$type<Record<string, number>>().notNull(),
  decisionClarity: doublePrecision("decision_clarity"),
  isMixed: boolean("is_mixed"),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("training_answers_session_question_unique").on(table.trainingSessionId, table.questionIndex),
  index("training_answers_session_id_idx").on(table.trainingSessionId),
  index("training_answers_node_id_idx").on(table.trainingNodeId),
  index("training_answers_hand_id_idx").on(table.trainingHandId),
  index("training_answers_is_correct_idx").on(table.isCorrect),
  check("training_answers_question_index_check", sql`${table.questionIndex} >= 0`),
]);
