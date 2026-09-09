CREATE TABLE `player_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_player_tokens_player` ON `player_tokens` (`player_id`);--> statement-breakpoint
ALTER TABLE `players` ADD `google_uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `players_google_uid_unique` ON `players` (`google_uid`);