import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const items=sqliteTable('items',{userId:text('user_id').notNull(),space:text('space').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),body:text('body').notNull() },t=>[primaryKey({columns:[t.userId,t.space,t.id]}),uniqueIndex('dose_schedule_unique').on(t.userId,t.space,sql`json_extract(${t.body}, '$.medicationId')`,sql`json_extract(${t.body}, '$.date')`,sql`json_extract(${t.body}, '$.scheduledTime')`).where(sql`${t.kind} = 'dose' AND json_extract(${t.body}, '$.scheduledTime') != ''`)]);
export const settings=sqliteTable('settings',{userId:text('user_id').notNull(),space:text('space').notNull(),body:text('body').notNull()},t=>[primaryKey({columns:[t.userId,t.space]})]);
export const deletedItems=sqliteTable('deleted_items',{userId:text('user_id').notNull(),space:text('space').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),body:text('body').notNull(),expiresAt:integer('expires_at').notNull()},t=>[primaryKey({columns:[t.userId,t.space,t.id]})]);
export const appMeta=sqliteTable('app_meta',{userId:text('user_id').notNull(),key:text('key').notNull(),value:text('value').notNull()},t=>[primaryKey({columns:[t.userId,t.key]})]);

export const workbenches=sqliteTable('workbenches',{userId:text('user_id').notNull(),id:text('id').notNull(),name:text('name').notNull(),type:text('type').notNull()},t=>[primaryKey({columns:[t.userId,t.id]})]);
