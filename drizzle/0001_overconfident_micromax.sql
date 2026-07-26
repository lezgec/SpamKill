CREATE TABLE `gmail_sync_state` (
	`account_email` text PRIMARY KEY NOT NULL,
	`history_id` text,
	`coverage_start_at` integer,
	`last_full_scan_at` integer,
	`last_incremental_sync_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `indexed_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`account_email` text NOT NULL,
	`message_id` text NOT NULL,
	`sender_email` text NOT NULL,
	`sender_name` text NOT NULL,
	`sender_domain` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`received_at` integer NOT NULL,
	`has_unsubscribe` integer DEFAULT false NOT NULL,
	`indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `indexed_account_message_idx` ON `indexed_messages` (`account_email`,`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `indexed_account_sender_message_idx` ON `indexed_messages` (`account_email`,`sender_email`,`message_id`);--> statement-breakpoint
CREATE INDEX `indexed_account_received_idx` ON `indexed_messages` (`account_email`,`received_at`);