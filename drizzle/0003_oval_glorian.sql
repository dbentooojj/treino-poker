DELETE FROM "password_reset_tokens" older
USING "password_reset_tokens" newer
WHERE older."user_id" = newer."user_id"
	AND (older."created_at", older."id") < (newer."created_at", newer."id");--> statement-breakpoint
DROP INDEX "password_reset_user_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_user_id_unique" ON "password_reset_tokens" USING btree ("user_id");
