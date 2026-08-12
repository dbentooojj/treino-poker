DROP INDEX "training_sets_content_hash_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "training_sets_content_hash_unique"
ON "training_sets" USING btree ("content_hash")
WHERE "status" <> 'ARCHIVED'::"training_set_status";
