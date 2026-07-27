CREATE TABLE `sender_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`account_email` text NOT NULL,
	`sender_email` text NOT NULL,
	`manual_category` text,
	`is_safe` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sender_preference_account_sender_idx` ON `sender_preferences` (`account_email`,`sender_email`);--> statement-breakpoint
ALTER TABLE `indexed_messages` ADD `classification_reason` text DEFAULT 'no_signals' NOT NULL;--> statement-breakpoint
ALTER TABLE `indexed_messages` ADD `classification_confidence` text DEFAULT 'low' NOT NULL;--> statement-breakpoint
UPDATE `indexed_messages`
SET `classification_reason` = 'legacy_classification',
    `classification_confidence` = 'medium';
