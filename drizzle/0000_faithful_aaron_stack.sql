CREATE TABLE `app_meta` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `deleted_items` (
	`user_id` text NOT NULL,
	`space` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `space`, `id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`user_id` text NOT NULL,
	`space` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`user_id`, `space`, `id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text NOT NULL,
	`space` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`user_id`, `space`)
);
