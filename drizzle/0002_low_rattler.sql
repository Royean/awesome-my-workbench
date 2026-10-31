CREATE TABLE `workbenches` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
