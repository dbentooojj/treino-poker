CREATE TYPE "public"."ante_type" AS ENUM('NONE', 'ANTE', 'BB_ANTE');--> statement-breakpoint
CREATE TYPE "public"."equity_model" AS ENUM('CHIP_EV', 'ICM');--> statement-breakpoint
CREATE TYPE "public"."game_type" AS ENUM('TOURNAMENT');--> statement-breakpoint
CREATE TYPE "public"."street" AS ENUM('PREFLOP');--> statement-breakpoint
CREATE TYPE "public"."training_set_status" AS ENUM('IMPORTED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."training_type" AS ENUM('PUSH_FOLD', 'CALL_VS_SHOVE', 'OPEN_FOLD', 'VS_OPEN');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_hands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_node_id" uuid NOT NULL,
	"hand_class" text NOT NULL,
	"strategy" jsonb NOT NULL,
	"evs" jsonb NOT NULL,
	"best_action" text,
	"decision_clarity" double precision,
	"is_mixed" boolean,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_set_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"training_type" "training_type" NOT NULL,
	"hero_position" text NOT NULL,
	"hero_stack_bb" double precision NOT NULL,
	"villain_position" text,
	"action_sequence" jsonb NOT NULL,
	"available_actions" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "training_nodes_stack_check" CHECK ("training_nodes"."hero_stack_bb" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"training_set_id" uuid NOT NULL,
	"training_type" "training_type" NOT NULL,
	"equity_model" "equity_model" NOT NULL,
	"players_count" integer NOT NULL,
	"stack_bb" double precision NOT NULL,
	"hero_position" text NOT NULL,
	"villain_position" text,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"total_answers" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'HRC' NOT NULL,
	"content_hash" text NOT NULL,
	"game_type" "game_type" DEFAULT 'TOURNAMENT' NOT NULL,
	"street" "street" DEFAULT 'PREFLOP' NOT NULL,
	"training_type" "training_type",
	"equity_model" "equity_model" NOT NULL,
	"players_count" integer NOT NULL,
	"stack_bb" double precision,
	"small_blind" double precision NOT NULL,
	"big_blind" double precision NOT NULL,
	"ante" double precision DEFAULT 0 NOT NULL,
	"ante_type" "ante_type" DEFAULT 'NONE' NOT NULL,
	"status" "training_set_status" DEFAULT 'IMPORTED' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"icm_context" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "training_sets_players_count_check" CHECK ("training_sets"."players_count" BETWEEN 2 AND 10),
	CONSTRAINT "training_sets_blinds_check" CHECK ("training_sets"."small_blind" >= 0 AND "training_sets"."big_blind" > 0 AND "training_sets"."ante" >= 0),
	CONSTRAINT "training_sets_publication_consistency_check" CHECK (("training_sets"."status" = 'PUBLISHED' AND "training_sets"."is_published" = true) OR ("training_sets"."status" <> 'PUBLISHED' AND "training_sets"."is_published" = false))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"password_iterations" integer NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_hands" ADD CONSTRAINT "training_hands_training_node_id_training_nodes_id_fk" FOREIGN KEY ("training_node_id") REFERENCES "public"."training_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_nodes" ADD CONSTRAINT "training_nodes_training_set_id_training_sets_id_fk" FOREIGN KEY ("training_set_id") REFERENCES "public"."training_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_training_set_id_training_sets_id_fk" FOREIGN KEY ("training_set_id") REFERENCES "public"."training_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_rate_limits_expires_at_idx" ON "auth_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_reset_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "training_hands_node_class_unique" ON "training_hands" USING btree ("training_node_id","hand_class");--> statement-breakpoint
CREATE INDEX "training_hands_node_id_idx" ON "training_hands" USING btree ("training_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_nodes_set_key_unique" ON "training_nodes" USING btree ("training_set_id","node_key");--> statement-breakpoint
CREATE INDEX "training_nodes_filters_idx" ON "training_nodes" USING btree ("training_type","hero_stack_bb","hero_position","villain_position");--> statement-breakpoint
CREATE INDEX "training_nodes_set_id_idx" ON "training_nodes" USING btree ("training_set_id");--> statement-breakpoint
CREATE INDEX "training_sessions_user_started_idx" ON "training_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "training_sessions_user_type_idx" ON "training_sessions" USING btree ("user_id","training_type");--> statement-breakpoint
CREATE INDEX "training_sessions_set_id_idx" ON "training_sessions" USING btree ("training_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_sets_content_hash_unique" ON "training_sets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "training_sets_lookup_idx" ON "training_sets" USING btree ("game_type","street","equity_model","players_count");--> statement-breakpoint
CREATE INDEX "training_sets_publication_idx" ON "training_sets" USING btree ("is_published","status","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");