CREATE TYPE "public"."training_presentation_mode" AS ENUM('DECISION', 'FROM_START');--> statement-breakpoint
ALTER TYPE "public"."training_type" ADD VALUE 'VS_3_BET';--> statement-breakpoint
ALTER TYPE "public"."training_type" ADD VALUE 'VS_4_BET';--> statement-breakpoint
CREATE TABLE "hrc_source_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_set_id" uuid NOT NULL,
	"parent_node_id" uuid NOT NULL,
	"action_index" integer NOT NULL,
	"child_reference" text NOT NULL,
	"child_node_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "hrc_source_edges_action_index_check" CHECK ("hrc_source_edges"."action_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hrc_source_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_set_id" uuid NOT NULL,
	"training_node_id" uuid,
	"source_node_id" text NOT NULL,
	"source_path" text NOT NULL,
	"player" integer NOT NULL,
	"street" integer NOT NULL,
	"action_sequence" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"is_trainable" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "hrc_source_nodes_street_check" CHECK ("hrc_source_nodes"."street" >= 0)
);
--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "presentation_mode" "training_presentation_mode" DEFAULT 'DECISION' NOT NULL;--> statement-breakpoint
ALTER TABLE "hrc_source_edges" ADD CONSTRAINT "hrc_source_edges_training_set_id_training_sets_id_fk" FOREIGN KEY ("training_set_id") REFERENCES "public"."training_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrc_source_edges" ADD CONSTRAINT "hrc_source_edges_parent_node_id_hrc_source_nodes_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."hrc_source_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrc_source_edges" ADD CONSTRAINT "hrc_source_edges_child_node_id_hrc_source_nodes_id_fk" FOREIGN KEY ("child_node_id") REFERENCES "public"."hrc_source_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrc_source_nodes" ADD CONSTRAINT "hrc_source_nodes_training_set_id_training_sets_id_fk" FOREIGN KEY ("training_set_id") REFERENCES "public"."training_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrc_source_nodes" ADD CONSTRAINT "hrc_source_nodes_training_node_id_training_nodes_id_fk" FOREIGN KEY ("training_node_id") REFERENCES "public"."training_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hrc_source_edges_parent_action_unique" ON "hrc_source_edges" USING btree ("parent_node_id","action_index");--> statement-breakpoint
CREATE INDEX "hrc_source_edges_set_idx" ON "hrc_source_edges" USING btree ("training_set_id");--> statement-breakpoint
CREATE INDEX "hrc_source_edges_child_idx" ON "hrc_source_edges" USING btree ("child_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hrc_source_nodes_set_source_unique" ON "hrc_source_nodes" USING btree ("training_set_id","source_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hrc_source_nodes_set_path_unique" ON "hrc_source_nodes" USING btree ("training_set_id","source_path");--> statement-breakpoint
CREATE INDEX "hrc_source_nodes_set_street_idx" ON "hrc_source_nodes" USING btree ("training_set_id","street");--> statement-breakpoint
CREATE INDEX "hrc_source_nodes_training_node_idx" ON "hrc_source_nodes" USING btree ("training_node_id");
