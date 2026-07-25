CREATE TABLE `unsubscribe_history` (
	`id` text PRIMARY KEY NOT NULL,
	`account_email` text NOT NULL,
	`provider` text DEFAULT 'gmail' NOT NULL,
	`sender_email` text NOT NULL,
	`sender_name` text NOT NULL,
	`sender_domain` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer,
	`messages_trashed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unsubscribe_account_sender_idx` ON `unsubscribe_history` (`account_email`,`sender_email`);