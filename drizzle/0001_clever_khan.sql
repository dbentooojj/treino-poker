CREATE TABLE `training_hands` (
	`id` text PRIMARY KEY NOT NULL,
	`training_node_id` text NOT NULL,
	`hand_class` text NOT NULL,
	`strategy` text NOT NULL,
	`evs` text NOT NULL,
	`best_action` text,
	`decision_clarity` real,
	`is_mixed` integer,
	`metadata` text,
	FOREIGN KEY (`training_node_id`) REFERENCES `training_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_hands_node_class_unique` ON `training_hands` (`training_node_id`,`hand_class`);--> statement-breakpoint
CREATE INDEX `training_hands_node_id_idx` ON `training_hands` (`training_node_id`);--> statement-breakpoint
CREATE TABLE `training_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`training_set_id` text NOT NULL,
	`node_key` text NOT NULL,
	`training_type` text NOT NULL,
	`hero_position` text NOT NULL,
	`hero_stack_bb` real NOT NULL,
	`villain_position` text,
	`action_sequence` text NOT NULL,
	`available_actions` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`training_set_id`) REFERENCES `training_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_nodes_set_key_unique` ON `training_nodes` (`training_set_id`,`node_key`);--> statement-breakpoint
CREATE INDEX `training_nodes_filters_idx` ON `training_nodes` (`training_type`,`hero_stack_bb`,`hero_position`,`villain_position`);--> statement-breakpoint
CREATE INDEX `training_nodes_set_id_idx` ON `training_nodes` (`training_set_id`);--> statement-breakpoint
CREATE TABLE `training_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text DEFAULT 'HRC' NOT NULL,
	`game_type` text DEFAULT 'TOURNAMENT' NOT NULL,
	`street` text DEFAULT 'PREFLOP' NOT NULL,
	`equity_model` text NOT NULL,
	`players_count` integer NOT NULL,
	`small_blind` real NOT NULL,
	`big_blind` real NOT NULL,
	`ante` real DEFAULT 0 NOT NULL,
	`ante_type` text DEFAULT 'NONE' NOT NULL,
	`icm_context` text,
	`imported_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `training_sets_lookup_idx` ON `training_sets` (`game_type`,`street`,`equity_model`,`players_count`);