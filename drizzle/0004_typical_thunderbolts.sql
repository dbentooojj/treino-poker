ALTER TABLE `training_sets` ADD `content_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `training_sets_content_hash_unique` ON `training_sets` (`content_hash`);