ALTER TABLE "training_sessions" DROP CONSTRAINT "training_sessions_target_questions_check";--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "answer_details_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Normalize malformed legacy queue state before applying JSON invariants.
UPDATE "training_sessions"
SET "exercise_queue" = '[]'::jsonb, "queue_position" = 0
WHERE jsonb_typeof("exercise_queue") IS DISTINCT FROM 'array';--> statement-breakpoint

-- Preserve aggregate counters whenever the per-answer ledger is absent, partial or
-- discontinuous. Only a complete 0..n-1 ledger is safe to treat as detailed history.
WITH ledger AS (
	SELECT
		s."id",
		count(a."id")::integer AS answer_count,
		min(a."question_index") AS minimum_index,
		max(a."question_index") AS maximum_index
	FROM "training_sessions" s
	LEFT JOIN "training_answers" a ON a."training_session_id" = s."id"
	GROUP BY s."id"
)
UPDATE "training_sessions" s
SET "answer_details_available" = false
FROM ledger
WHERE ledger."id" = s."id"
	AND (
		ledger.answer_count <> s."answered_questions"
		OR (ledger.answer_count > 0 AND (ledger.minimum_index <> 0 OR ledger.maximum_index <> ledger.answer_count - 1))
		OR (ledger.answer_count = 0 AND s."exercise_queue" = '[]'::jsonb)
	);--> statement-breakpoint

UPDATE "training_sessions"
SET
	"ended_at" = COALESCE("ended_at", "started_at" + ("duration_seconds" * interval '1 second')),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason",
	"target_questions" = NULL,
	"exercise_queue" = '[]'::jsonb,
	"queue_position" = 0
WHERE "answer_details_available" = false;--> statement-breakpoint

-- Regrade modern answer snapshots with the mixed-strategy rule introduced by the
-- application: every action with at least 5% solver frequency is accepted. Invalid
-- or ambiguous historical strategies are deliberately left untouched.
WITH answer_strategy AS (
	SELECT
		a."id",
		COALESCE(
			a."strategy" -> (a."selected_action" ->> 'id'),
			a."strategy" -> (a."selected_action" ->> 'type'),
			a."strategy" -> lower(a."selected_action" ->> 'type'),
			a."strategy" -> (a."selected_action" ->> 'label')
		) AS selected_frequency,
		stats.total_frequency,
		stats.minimum_frequency,
		stats.maximum_frequency,
		stats.numeric_values,
		stats.all_values,
		jsonb_array_length(CASE WHEN jsonb_typeof(n."available_actions") = 'array' THEN n."available_actions" ELSE '[]'::jsonb END) AS action_count,
		NOT EXISTS (
			SELECT 1
			FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n."available_actions") = 'array' THEN n."available_actions" ELSE '[]'::jsonb END) AS action(value)
			WHERE COALESCE(action.value ->> 'id', action.value ->> 'type') IS NULL
				OR NOT (a."strategy" ? COALESCE(action.value ->> 'id', action.value ->> 'type'))
		) AS actions_covered
	FROM "training_answers" a
	INNER JOIN "training_sessions" s ON s."id" = a."training_session_id"
	INNER JOIN "training_nodes" n ON n."id" = a."training_node_id"
	CROSS JOIN LATERAL (
		SELECT
			sum((entry.value #>> '{}')::double precision) FILTER (WHERE jsonb_typeof(entry.value) = 'number') AS total_frequency,
			min((entry.value #>> '{}')::double precision) FILTER (WHERE jsonb_typeof(entry.value) = 'number') AS minimum_frequency,
			max((entry.value #>> '{}')::double precision) FILTER (WHERE jsonb_typeof(entry.value) = 'number') AS maximum_frequency,
			count(*) FILTER (WHERE jsonb_typeof(entry.value) = 'number') AS numeric_values,
			count(*) AS all_values
		FROM jsonb_each(CASE WHEN jsonb_typeof(a."strategy") = 'object' THEN a."strategy" ELSE '{}'::jsonb END) AS entry
	) stats
	WHERE s."answer_details_available" = true
), valid_grades AS (
	SELECT
		"id",
		CASE
			WHEN (total_frequency BETWEEN 0.999999 AND 1.000001
					AND minimum_frequency >= -0.000001 AND maximum_frequency <= 1.000001)
				OR (total_frequency BETWEEN 99.9999 AND 100.0001
					AND minimum_frequency >= -0.0001 AND maximum_frequency <= 100.0001)
				THEN (selected_frequency #>> '{}')::double precision / total_frequency >= 0.05
		END AS is_correct
	FROM answer_strategy
	WHERE all_values > 0
		AND numeric_values = all_values
		AND all_values = action_count
		AND actions_covered
		AND jsonb_typeof(selected_frequency) = 'number'
)
UPDATE "training_answers" a
SET "is_correct" = grades.is_correct
FROM valid_grades grades
WHERE a."id" = grades."id"
	AND grades.is_correct IS NOT NULL
	AND a."is_correct" IS DISTINCT FROM grades.is_correct;--> statement-breakpoint

-- Modern session counters are derived data; reconcile them with the answer ledger.
UPDATE "training_sessions" s
SET
	"answered_questions" = (SELECT count(*)::integer FROM "training_answers" a WHERE a."training_session_id" = s."id"),
	"correct_answers" = (SELECT count(*)::integer FROM "training_answers" a WHERE a."training_session_id" = s."id" AND a."is_correct" = true)
WHERE s."answer_details_available" = true
	AND (
		s."answered_questions" IS DISTINCT FROM (SELECT count(*)::integer FROM "training_answers" a WHERE a."training_session_id" = s."id")
		OR s."correct_answers" IS DISTINCT FROM (SELECT count(*)::integer FROM "training_answers" a WHERE a."training_session_id" = s."id" AND a."is_correct" = true)
	);--> statement-breakpoint

-- Existing targets and queues must obey the production memory bound.
UPDATE "training_sessions"
SET "target_questions" = 100
WHERE "target_questions" > 100;--> statement-breakpoint

-- A modern session that reached its target but missed its terminal update is complete.
UPDATE "training_sessions" s
SET
	"ended_at" = COALESCE(
		(SELECT max(a."answered_at") FROM "training_answers" a WHERE a."training_session_id" = s."id"),
		s."started_at" + (s."duration_seconds" * interval '1 second')
	),
	"completion_reason" = 'COMPLETED'::"training_completion_reason"
WHERE s."answer_details_available" = true
	AND s."ended_at" IS NULL
	AND s."target_questions" IS NOT NULL
	AND s."answered_questions" >= s."target_questions";--> statement-breakpoint

-- Reconcile the two halves of terminal state without discarding an existing ending.
UPDATE "training_sessions"
SET "completion_reason" = CASE
	WHEN "target_questions" IS NOT NULL AND "answered_questions" >= "target_questions"
		THEN 'COMPLETED'::"training_completion_reason"
	ELSE 'USER_FINISHED'::"training_completion_reason"
END
WHERE "ended_at" IS NOT NULL
	AND "completion_reason" IS DISTINCT FROM CASE
		WHEN "target_questions" IS NOT NULL AND "answered_questions" >= "target_questions"
			THEN 'COMPLETED'::"training_completion_reason"
		ELSE 'USER_FINISHED'::"training_completion_reason"
	END;--> statement-breakpoint

UPDATE "training_sessions"
SET "completion_reason" = 'USER_FINISHED'::"training_completion_reason"
WHERE "ended_at" IS NULL
	AND "completion_reason" = 'COMPLETED'::"training_completion_reason"
	AND ("target_questions" IS NULL OR "answered_questions" < "target_questions");--> statement-breakpoint

UPDATE "training_sessions"
SET "ended_at" = "started_at" + ("duration_seconds" * interval '1 second')
WHERE "ended_at" IS NULL AND "completion_reason" IS NOT NULL;--> statement-breakpoint

-- Do not invent a new cursor for an already corrupt active session.
UPDATE "training_sessions"
SET
	"ended_at" = "started_at" + ("duration_seconds" * interval '1 second'),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason",
	"queue_position" = LEAST(GREATEST("queue_position", 0), jsonb_array_length("exercise_queue"))
WHERE "ended_at" IS NULL
	AND ("queue_position" < 0 OR "queue_position" >= jsonb_array_length("exercise_queue"));--> statement-breakpoint

-- For active oversized queues, retain only the next bounded window.
WITH trimmed_queues AS (
	SELECT
		s."id",
		COALESCE(
			jsonb_agg(item.value ORDER BY item.ordinality) FILTER (
				WHERE item.ordinality > s."queue_position"
					AND item.ordinality <= s."queue_position" + 100
			),
			'[]'::jsonb
		) AS queue
	FROM "training_sessions" s
	CROSS JOIN LATERAL jsonb_array_elements(s."exercise_queue") WITH ORDINALITY AS item(value, ordinality)
	WHERE s."ended_at" IS NULL AND jsonb_array_length(s."exercise_queue") > 100
	GROUP BY s."id"
)
UPDATE "training_sessions" s
SET "exercise_queue" = trimmed.queue, "queue_position" = 0
FROM trimmed_queues trimmed
WHERE s."id" = trimmed."id";--> statement-breakpoint

-- Terminal queues no longer need their full historical work list.
WITH trimmed_queues AS (
	SELECT
		s."id",
		jsonb_agg(item.value ORDER BY item.ordinality) FILTER (WHERE item.ordinality <= 100) AS queue
	FROM "training_sessions" s
	CROSS JOIN LATERAL jsonb_array_elements(s."exercise_queue") WITH ORDINALITY AS item(value, ordinality)
	WHERE jsonb_array_length(s."exercise_queue") > 100
	GROUP BY s."id"
)
UPDATE "training_sessions" s
SET
	"exercise_queue" = trimmed.queue,
	"queue_position" = LEAST(GREATEST(s."queue_position", 0), 100)
FROM trimmed_queues trimmed
WHERE s."id" = trimmed."id";--> statement-breakpoint

-- Normalize positions, then close sessions that do not have a resumable question.
UPDATE "training_sessions"
SET "queue_position" = LEAST(GREATEST("queue_position", 0), jsonb_array_length("exercise_queue"))
WHERE "ended_at" IS NOT NULL;--> statement-breakpoint

UPDATE "training_sessions"
SET
	"ended_at" = "started_at" + ("duration_seconds" * interval '1 second'),
	"completion_reason" = 'USER_FINISHED'::"training_completion_reason",
	"queue_position" = LEAST(GREATEST("queue_position", 0), jsonb_array_length("exercise_queue"))
WHERE "ended_at" IS NULL
	AND ("queue_position" < 0 OR "queue_position" >= jsonb_array_length("exercise_queue"));--> statement-breakpoint

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_queue_check" CHECK (
	jsonb_typeof("exercise_queue") = 'array'
	AND jsonb_array_length("exercise_queue") <= 100
	AND "queue_position" >= 0
	AND "queue_position" <= jsonb_array_length("exercise_queue")
) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_sessions" VALIDATE CONSTRAINT "training_sessions_queue_check";--> statement-breakpoint

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_completion_consistency_check" CHECK (
	("ended_at" IS NULL AND "completion_reason" IS NULL)
	OR ("ended_at" IS NOT NULL AND "completion_reason" IS NOT NULL)
) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_sessions" VALIDATE CONSTRAINT "training_sessions_completion_consistency_check";--> statement-breakpoint

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_target_questions_check" CHECK (
	"target_questions" IS NULL OR ("target_questions" > 0 AND "target_questions" <= 100)
) NOT VALID;--> statement-breakpoint
ALTER TABLE "training_sessions" VALIDATE CONSTRAINT "training_sessions_target_questions_check";
