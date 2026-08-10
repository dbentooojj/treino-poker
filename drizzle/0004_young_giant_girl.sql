CREATE TYPE "public"."ev_unit" AS ENUM('CHIPS', 'BIG_BLINDS', 'ICM_UTILITY', 'UNKNOWN');--> statement-breakpoint
ALTER TABLE "training_sessions" DROP CONSTRAINT "training_sessions_queue_check";--> statement-breakpoint
ALTER TABLE "training_sessions" DROP CONSTRAINT "training_sessions_completion_consistency_check";--> statement-breakpoint
ALTER TABLE "training_answers" ADD COLUMN "ev_unit" "ev_unit" DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sets" ADD COLUMN "ev_unit" "ev_unit" DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint

-- ICM has a known non-BB utility domain. ChipEV remains UNKNOWN until its native
-- unit is explicitly verified; the migration never guesses chips versus BB.
UPDATE "training_sets"
SET "ev_unit" = 'ICM_UTILITY'::"ev_unit"
WHERE "equity_model" = 'ICM';--> statement-breakpoint

UPDATE "training_answers" a
SET "ev_unit" = CASE
	WHEN s."equity_model" = 'ICM' THEN 'ICM_UTILITY'::"ev_unit"
	ELSE 'UNKNOWN'::"ev_unit"
END
FROM "training_sessions" s
WHERE s."id" = a."training_session_id";--> statement-breakpoint

-- Older imports were accepted before canonical 169-hand/vector validation existed.
-- Keep their data for audit/history, but require a fresh validated import before use.
UPDATE "training_sets"
SET
	"status" = 'ARCHIVED',
	"is_published" = false,
	"published_at" = NULL,
	"metadata" = "metadata" || jsonb_build_object(
		'quarantinedByMigration', '0004',
		'quarantineReason', 'Reimport required after HRC validation hardening'
	)
WHERE "source" = 'HRC'
	AND COALESCE("metadata" ->> 'validationVersion', '') <> '2';--> statement-breakpoint

UPDATE "training_sessions" s
SET
	"ended_at" = s."started_at" + (s."duration_seconds" * interval '1 second'),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason"
WHERE s."ended_at" IS NULL
	AND (
		s."training_set_id" IS NULL
		OR EXISTS (
			SELECT 1 FROM "training_sets" sets
			WHERE sets."id" = s."training_set_id"
				AND sets."metadata" ->> 'quarantinedByMigration' = '0004'
		)
	);--> statement-breakpoint

-- Rows inserted while the older constraints were active may still carry invalid
-- indexes. Preserve their aggregate counters and downgrade them to summary-only.
UPDATE "training_sessions" s
SET "answer_details_available" = false
WHERE EXISTS (
	SELECT 1 FROM "training_answers" a
	WHERE a."training_session_id" = s."id" AND a."question_index" < 0
);--> statement-breakpoint

DELETE FROM "training_answers" a
USING "training_sessions" s
WHERE s."id" = a."training_session_id"
	AND s."answer_details_available" = false
	AND a."question_index" < 0;--> statement-breakpoint

UPDATE "training_sessions"
SET
	"ended_at" = COALESCE("ended_at", "started_at" + ("duration_seconds" * interval '1 second')),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason",
	"target_questions" = NULL,
	"exercise_queue" = '[]'::jsonb,
	"queue_position" = 0
WHERE "answer_details_available" = false;--> statement-breakpoint

-- Close active rows that the older queue constraint allowed but that cannot be
-- resumed (empty queue or cursor at/after the end).
UPDATE "training_sessions"
SET
	"ended_at" = "started_at" + ("duration_seconds" * interval '1 second'),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason",
	"queue_position" = LEAST(GREATEST("queue_position", 0), jsonb_array_length("exercise_queue"))
WHERE "ended_at" IS NULL
	AND (jsonb_array_length("exercise_queue") = 0 OR "queue_position" >= jsonb_array_length("exercise_queue"));--> statement-breakpoint

-- Every queue item must be structurally usable and resolve through the same training
-- set to its node and hand. A future invalid item would otherwise break on advance.
UPDATE "training_sessions" s
SET
	"ended_at" = s."started_at" + (s."duration_seconds" * interval '1 second'),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason",
	"exercise_queue" = '[]'::jsonb,
	"queue_position" = 0
WHERE s."ended_at" IS NULL
	AND EXISTS (
		SELECT 1
		FROM jsonb_array_elements(s."exercise_queue") AS item(value)
		WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
			OR jsonb_typeof(item.value -> 'trainingSetId') IS DISTINCT FROM 'string'
			OR jsonb_typeof(item.value -> 'trainingNodeId') IS DISTINCT FROM 'string'
			OR jsonb_typeof(item.value -> 'trainingHandId') IS DISTINCT FROM 'string'
			OR NOT EXISTS (
				SELECT 1
				FROM "training_sets" sets
				INNER JOIN "training_nodes" nodes ON nodes."training_set_id" = sets."id"
				INNER JOIN "training_hands" hands ON hands."training_node_id" = nodes."id"
				WHERE sets."id" = s."training_set_id"
					AND sets."id"::text = (item.value ->> 'trainingSetId')
					AND nodes."id"::text = (item.value ->> 'trainingNodeId')
					AND hands."id"::text = (item.value ->> 'trainingHandId')
			)
	);--> statement-breakpoint

UPDATE "training_sessions"
SET "completion_reason" = 'USER_FINISHED'::"training_completion_reason"
WHERE "completion_reason" = 'COMPLETED'::"training_completion_reason"
	AND ("target_questions" IS NULL OR "answered_questions" < "target_questions");--> statement-breakpoint

-- Keep the newest active session and close older duplicates before enforcing the
-- one-active-session invariant used by refresh recovery.
WITH ranked_active AS (
	SELECT
		"id",
		row_number() OVER (PARTITION BY "user_id" ORDER BY "started_at" DESC, "id" DESC) AS active_rank
	FROM "training_sessions"
	WHERE "ended_at" IS NULL
)
UPDATE "training_sessions" s
SET
	"ended_at" = s."started_at" + (s."duration_seconds" * interval '1 second'),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason"
FROM ranked_active ranked
WHERE ranked."id" = s."id" AND ranked.active_rank > 1;--> statement-breakpoint

CREATE UNIQUE INDEX "training_sessions_one_active_per_user_unique" ON "training_sessions" USING btree ("user_id") WHERE "ended_at" IS NULL;--> statement-breakpoint

ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_question_index_check" CHECK ("question_index" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_answers" VALIDATE CONSTRAINT "training_answers_question_index_check";--> statement-breakpoint

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_summary_only_check" CHECK (
	"answer_details_available" = true
	OR ("ended_at" IS NOT NULL AND "completion_reason" = 'USER_FINISHED' AND "target_questions" IS NULL AND "exercise_queue" = '[]'::jsonb AND "queue_position" = 0)
) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_sessions" VALIDATE CONSTRAINT "training_sessions_summary_only_check";--> statement-breakpoint

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_queue_check" CHECK (
	jsonb_typeof("exercise_queue") = 'array'
	AND jsonb_array_length("exercise_queue") <= 100
	AND "queue_position" >= 0
	AND (
		("ended_at" IS NULL
			AND jsonb_array_length("exercise_queue") > 0
			AND "queue_position" < jsonb_array_length("exercise_queue")
			AND jsonb_typeof("exercise_queue" -> "queue_position") = 'object'
			AND jsonb_typeof(("exercise_queue" -> "queue_position") -> 'trainingSetId') IS NOT DISTINCT FROM 'string'
			AND jsonb_typeof(("exercise_queue" -> "queue_position") -> 'trainingNodeId') IS NOT DISTINCT FROM 'string'
			AND jsonb_typeof(("exercise_queue" -> "queue_position") -> 'trainingHandId') IS NOT DISTINCT FROM 'string')
		OR ("ended_at" IS NOT NULL AND "queue_position" <= jsonb_array_length("exercise_queue"))
	)
) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_sessions" VALIDATE CONSTRAINT "training_sessions_queue_check";--> statement-breakpoint

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_completion_consistency_check" CHECK (
	(("ended_at" IS NULL AND "completion_reason" IS NULL) OR ("ended_at" IS NOT NULL AND "completion_reason" IS NOT NULL))
	AND ("completion_reason" IS DISTINCT FROM 'COMPLETED' OR ("target_questions" IS NOT NULL AND "answered_questions" >= "target_questions"))
) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_sessions" VALIDATE CONSTRAINT "training_sessions_completion_consistency_check";
