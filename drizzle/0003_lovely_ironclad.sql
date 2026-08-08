CREATE TABLE `training_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`training_type` text NOT NULL,
	`equity_model` text NOT NULL,
	`players_count` integer NOT NULL,
	`stack_bb` real NOT NULL,
	`hero_position` text NOT NULL,
	`villain_position` text,
	`correct_answers` integer DEFAULT 0 NOT NULL,
	`total_answers` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `training_sessions_user_started_idx` ON `training_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `training_sessions_user_type_idx` ON `training_sessions` (`user_id`,`training_type`);