-- Drizzle Kit 0.31.10 incorrectly comma-splits SQLite expression index terms.
-- This unapplied migration was repaired before its first successful application.
CREATE UNIQUE INDEX `dose_schedule_unique` ON `items` (
  `user_id`, `space`,
  json_extract(`body`, '$.medicationId'),
  json_extract(`body`, '$.date'),
  json_extract(`body`, '$.scheduledTime')
) WHERE `kind` = 'dose' AND json_extract(`body`, '$.scheduledTime') != '';
