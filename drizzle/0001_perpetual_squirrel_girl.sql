CREATE TYPE "public"."training_completion_reason" AS ENUM('COMPLETED', 'USER_FINISHED');--> statement-breakpoint
CREATE TABLE "training_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_session_id" uuid NOT NULL,
	"training_set_id" uuid NOT NULL,
	"training_node_id" uuid NOT NULL,
	"training_hand_id" uuid NOT NULL,
	"question_index" integer NOT NULL,
	"hand_class" text NOT NULL,
	"hero_position" text NOT NULL,
	"stack_bb" double precision NOT NULL,
	"selected_action" jsonb NOT NULL,
	"best_action" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"strategy" jsonb NOT NULL,
	"evs" jsonb NOT NULL,
	"decision_clarity" double precision,
	"is_mixed" boolean,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_sessions" ALTER COLUMN "training_set_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ALTER COLUMN "players_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ALTER COLUMN "stack_bb" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ALTER COLUMN "hero_position" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" RENAME COLUMN "total_answers" TO "answered_questions";--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "target_questions" integer;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "exercise_queue" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "queue_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "source_session_id" uuid;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "completion_reason" "training_completion_reason";--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_training_session_id_training_sessions_id_fk" FOREIGN KEY ("training_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_training_set_id_training_sets_id_fk" FOREIGN KEY ("training_set_id") REFERENCES "public"."training_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_training_node_id_training_nodes_id_fk" FOREIGN KEY ("training_node_id") REFERENCES "public"."training_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_training_hand_id_training_hands_id_fk" FOREIGN KEY ("training_hand_id") REFERENCES "public"."training_hands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_answers_session_question_unique" ON "training_answers" USING btree ("training_session_id","question_index");--> statement-breakpoint
CREATE INDEX "training_answers_session_id_idx" ON "training_answers" USING btree ("training_session_id");--> statement-breakpoint
CREATE INDEX "training_answers_node_id_idx" ON "training_answers" USING btree ("training_node_id");--> statement-breakpoint
CREATE INDEX "training_answers_hand_id_idx" ON "training_answers" USING btree ("training_hand_id");--> statement-breakpoint
CREATE INDEX "training_answers_is_correct_idx" ON "training_answers" USING btree ("is_correct");--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_source_session_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_sessions_source_id_idx" ON "training_sessions" USING btree ("source_session_id");--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_target_questions_check" CHECK ("training_sessions"."target_questions" IS NULL OR "training_sessions"."target_questions" > 0);--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_counters_check" CHECK ("training_sessions"."answered_questions" >= 0 AND "training_sessions"."correct_answers" >= 0 AND "training_sessions"."correct_answers" <= "training_sessions"."answered_questions");
