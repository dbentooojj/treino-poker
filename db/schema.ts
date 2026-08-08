import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at").notNull(),
}, (table) => [index("sessions_user_id_idx").on(table.userId), index("sessions_expires_at_idx").on(table.expiresAt)]);

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("password_reset_user_id_idx").on(table.userId), index("password_reset_expires_at_idx").on(table.expiresAt)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  hits: integer("hits").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("auth_rate_limits_expires_at_idx").on(table.expiresAt)]);

export const trainingSets = sqliteTable("training_sets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("HRC"),
  gameType: text("game_type", { enum: ["TOURNAMENT"] }).notNull().default("TOURNAMENT"),
  street: text("street", { enum: ["PREFLOP"] }).notNull().default("PREFLOP"),
  equityModel: text("equity_model", { enum: ["CHIP_EV", "ICM"] }).notNull(),
  playersCount: integer("players_count").notNull(),
  stackBb: real("stack_bb"),
  smallBlind: real("small_blind").notNull(),
  bigBlind: real("big_blind").notNull(),
  ante: real("ante").notNull().default(0),
  anteType: text("ante_type", { enum: ["NONE", "ANTE", "BB_ANTE"] }).notNull().default("NONE"),
  status: text("status", { enum: ["ACTIVE", "INACTIVE"] }).notNull().default("ACTIVE"),
  icmContext: text("icm_context"),
  importedAt: integer("imported_at").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
}, (table) => [
  index("training_sets_lookup_idx").on(table.gameType, table.street, table.equityModel, table.playersCount),
  index("training_sets_status_idx").on(table.status),
]);

export const trainingNodes = sqliteTable("training_nodes", {
  id: text("id").primaryKey(),
  trainingSetId: text("training_set_id").notNull().references(() => trainingSets.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(),
  trainingType: text("training_type", { enum: ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN"] }).notNull(),
  heroPosition: text("hero_position").notNull(),
  heroStackBb: real("hero_stack_bb").notNull(),
  villainPosition: text("villain_position"),
  actionSequence: text("action_sequence", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull(),
  availableActions: text("available_actions", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
}, (table) => [
  uniqueIndex("training_nodes_set_key_unique").on(table.trainingSetId, table.nodeKey),
  index("training_nodes_filters_idx").on(table.trainingType, table.heroStackBb, table.heroPosition, table.villainPosition),
  index("training_nodes_set_id_idx").on(table.trainingSetId),
]);

export const trainingHands = sqliteTable("training_hands", {
  id: text("id").primaryKey(),
  trainingNodeId: text("training_node_id").notNull().references(() => trainingNodes.id, { onDelete: "cascade" }),
  handClass: text("hand_class").notNull(),
  strategy: text("strategy", { mode: "json" }).$type<Record<string, number>>().notNull(),
  evs: text("evs", { mode: "json" }).$type<Record<string, number>>().notNull(),
  bestAction: text("best_action"),
  decisionClarity: real("decision_clarity"),
  isMixed: integer("is_mixed", { mode: "boolean" }),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
}, (table) => [
  uniqueIndex("training_hands_node_class_unique").on(table.trainingNodeId, table.handClass),
  index("training_hands_node_id_idx").on(table.trainingNodeId),
]);

export const trainingSessions = sqliteTable("training_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  trainingType: text("training_type", { enum: ["PUSH_FOLD", "CALL_VS_SHOVE", "OPEN_FOLD", "VS_OPEN"] }).notNull(),
  equityModel: text("equity_model", { enum: ["CHIP_EV", "ICM"] }).notNull(),
  playersCount: integer("players_count").notNull(),
  stackBb: real("stack_bb").notNull(),
  heroPosition: text("hero_position").notNull(),
  villainPosition: text("villain_position"),
  correctAnswers: integer("correct_answers").notNull().default(0),
  totalAnswers: integer("total_answers").notNull().default(0),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
}, (table) => [
  index("training_sessions_user_started_idx").on(table.userId, table.startedAt),
  index("training_sessions_user_type_idx").on(table.userId, table.trainingType),
]);
