// Pure unit tests for the 「来自 AI 助手」 tag text and aria-label (public/request.js).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aiTagInfo,aiWhen} from '../public/request.js';
const now=new Date('2026-11-01T08:00:00Z');// 16:00 Asia/Shanghai
const T=hm=>`2026-11-01T${hm}:00+08:00`;
test('no markers → no tag',()=>{assert.equal(aiTagInfo({title:'x'},now),null);});
test('date wording: 今天/昨天/M月D日/cross-year',()=>{
 assert.equal(aiWhen(T('14:39'),now),'今天 14:39');
 assert.equal(aiWhen('2026-10-31T21:10:00+08:00',now),'昨天 21:10');
 assert.equal(aiWhen('2026-10-28T09:05:00+08:00',now),'10月28日 09:05');
 assert.equal(aiWhen('2025-12-30T09:05:00+08:00',now),'2025年12月30日 09:05');
});
test('tag text and label use the last AI change time',()=>{
 const i=aiTagInfo({createdVia:'mcp',aiCreatedAt:T('14:30'),lastAiEditAt:T('14:30')},now);
 assert.equal(i.text,'来自 AI 助手 · 今天 14:30');assert.equal(i.label,'由 AI 助手记录，最后修改于 今天 14:30');
 assert.equal(aiTagInfo({createdVia:'mcp',aiCreatedAt:T('14:30'),lastAiEditAt:T('15:00')},now).text,'来自 AI 助手 · 今天 15:00');
 assert.equal(aiTagInfo({lastAiEditAt:'2026-10-31T21:10:00+08:00'},now).text,'来自 AI 助手 · 昨天 21:10');
});
