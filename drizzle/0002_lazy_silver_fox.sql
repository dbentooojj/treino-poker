ALTER TABLE `training_sets` ADD `stack_bb` real;--> statement-breakpoint
ALTER TABLE `training_sets` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
CREATE INDEX `training_sets_status_idx` ON `training_sets` (`status`);