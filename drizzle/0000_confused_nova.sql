CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_games_room_started` ON `games` (`room_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	PRIMARY KEY(`room_id`, `player_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_members_player` ON `members` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`name` text NOT NULL,
	`current_room` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_token_unique` ON `players` (`token`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`host_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `sheets` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`scores` text DEFAULT '{}' NOT NULL,
	`bonus` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	PRIMARY KEY(`game_id`, `player_id`)
);
