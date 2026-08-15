CREATE TABLE "hrc_source_hands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_node_id" uuid NOT NULL,
	"hand_class" text NOT NULL,
	"strategy" jsonb NOT NULL,
	"evs" jsonb NOT NULL,
	"weight" double precision NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "hrc_source_hands_weight_check" CHECK ("hrc_source_hands"."weight" >= 0 AND "hrc_source_hands"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "study_capabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_set_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_sessions" DROP CONSTRAINT "training_sessions_completion_consistency_check";--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "completed_hands" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "full_hand_state" jsonb;--> statement-breakpoint
ALTER TABLE "hrc_source_hands" ADD CONSTRAINT "hrc_source_hands_source_node_id_hrc_source_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."hrc_source_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_capabilities" ADD CONSTRAINT "study_capabilities_training_set_id_training_sets_id_fk" FOREIGN KEY ("training_set_id") REFERENCES "public"."training_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hrc_source_hands_node_class_unique" ON "hrc_source_hands" USING btree ("source_node_id","hand_class");--> statement-breakpoint
CREATE INDEX "hrc_source_hands_node_id_idx" ON "hrc_source_hands" USING btree ("source_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_capabilities_set_capability_unique" ON "study_capabilities" USING btree ("training_set_id","capability");--> statement-breakpoint
CREATE INDEX "study_capabilities_capability_idx" ON "study_capabilities" USING btree ("capability");--> statement-breakpoint
INSERT INTO "study_capabilities" ("id", "training_set_id", "capability", "metadata")
SELECT (
  substr(md5("id"::text || ':DECISION'), 1, 8) || '-' ||
  substr(md5("id"::text || ':DECISION'), 9, 4) || '-' ||
  substr(md5("id"::text || ':DECISION'), 13, 4) || '-' ||
  substr(md5("id"::text || ':DECISION'), 17, 4) || '-' ||
  substr(md5("id"::text || ':DECISION'), 21, 12)
)::uuid, "id", 'DECISION', jsonb_build_object('backfilled', true)
FROM "training_sets"
WHERE EXISTS (SELECT 1 FROM "training_nodes" WHERE "training_nodes"."training_set_id" = "training_sets"."id");--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_completed_hands_check" CHECK ("training_sessions"."completed_hands" >= 0);--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_completion_consistency_check" CHECK (((("training_sessions"."ended_at" IS NULL AND "training_sessions"."completion_reason" IS NULL) OR ("training_sessions"."ended_at" IS NOT NULL AND "training_sessions"."completion_reason" IS NOT NULL)) AND ("training_sessions"."completion_reason" IS DISTINCT FROM 'COMPLETED' OR ("training_sessions"."target_questions" IS NOT NULL AND (("training_sessions"."full_hand_state" IS NOT NULL AND "training_sessions"."completed_hands" >= "training_sessions"."target_questions") OR ("training_sessions"."full_hand_state" IS NULL AND "training_sessions"."answered_questions" >= "training_sessions"."target_questions"))))));
