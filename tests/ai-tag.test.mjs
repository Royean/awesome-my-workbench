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
test('AI-created, no later web edit',()=>{
 const i=aiTagInfo({createdVia:'mcp',aiCreatedAt:T('14:30'),lastAiEditAt:T('14:30')},now);
 assert.equal(i.text,'来自 AI 助手 · 今天 14:30');assert.equal(i.label,'AI 助手 今天 14:30 创建');
 const e=aiTagInfo({createdVia:'mcp',aiCreatedAt:T('14:30'),lastAiEditAt:T('15:00')},now);assert.equal(e.text,'来自 AI 助手 · 今天 15:00');assert.equal(e.label,'AI 助手 今天 14:30 创建，AI 助手 今天 15:00 修改');
});
test('AI-created then web-edited; AI edits again → back to AI text',()=>{
 const i=aiTagInfo({createdVia:'mcp',aiCreatedAt:T('14:30'),lastAiEditAt:T('14:30'),lastUserEditAt:T('15:02')},now);
 assert.equal(i.text,'AI 助手创建 · 你修改过');assert.equal(i.label,'AI 助手 今天 14:30 创建，你 今天 15:02 又修改');
 const again=aiTagInfo({createdVia:'mcp',aiCreatedAt:T('14:30'),lastAiEditAt:T('15:30'),lastUserEditAt:T('15:02')},now);
 assert.equal(again.text,'来自 AI 助手 · 今天 15:30');assert.equal(again.label,'AI 助手 今天 14:30 创建，你 今天 15:02 又修改，AI 助手 今天 15:30 修改');
});
test('web-created, AI-edited',()=>{
 const i=aiTagInfo({lastAiEditAt:T('15:10')},now);assert.equal(i.text,'AI 助手修改过 · 今天 15:10');assert.equal(i.label,'你创建，AI 助手 今天 15:10 修改');
});
test('web-created, AI-edited, then web-edited',()=>{
 const i=aiTagInfo({lastAiEditAt:'2026-11-01T14:39:00+08:00',lastUserEditAt:T('15:02')},now);
 assert.equal(i.text,'AI 助手修改过 · 你修改过');assert.equal(i.label,'你创建，AI 助手 今天 14:39 修改，你 今天 15:02 又修改');
});
