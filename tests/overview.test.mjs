import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview } from '../lib/overview.mjs';

test('overview combines workbench-specific deadlines and separates future plans from recent records', () => {
  const today = '2026-11-07';
  const input = {
    health: [
      { kind: 'visit', title: '复查', date: today, status: '待复查' },
      { kind: 'visit', title: '已就诊', date: today, status: '已完成' },
      { kind: 'meal', title: '最近一餐', date: today, time: '12:00' },
    ],
    finance: [
      { kind: 'asset_holding', title: '域名', date: '2026-11-01', category: 'domain', expiresOn: '2026-11-05' },
      { kind: 'asset_liability', title: '账单', date: '2026-11-01', dueDate: '2026-11-20' },
      { kind: 'asset_liability', title: '已还清', date: '2026-11-01', dueDate: '2026-11-10', status: 'closed' },
    ],
    travel: [
      { kind: 'travel_trip', id: 'future', title: '下一程', date: '2026-11-23', startDate: '2026-11-23' },
      { kind: 'travel_check', title: '订车', tripId: 'future', date: '2026-11-09' },
      { kind: 'travel_trip', id: 'past', title: '已完成旅行', date: '2026-11-01', status: 'completed' },
      { kind: 'travel_check', title: '过往准备', tripId: 'past', date: '2026-11-02' },
    ],
    reading: [{ kind: 'reading_entry', title: '读书笔记', date: '2026-11-05' }],
    other: [{ kind: 'task', title: '已完成的事项', date: today, done: true }],
  };
  const scopes = Object.keys(input).map(type => ({ id: type, type, name: type, space: type }));
  const result = buildOverview(scopes, space => input[space], today);

  assert.equal(result.overdueCount, 1);
  assert.equal(result.pendingCount, 5);
  assert.deepEqual(result.upcoming.map(item => item.title), ['域名', '复查', '订车', '账单', '下一程']);
  assert.equal(result.upcoming.find(item => item.title === '订车').trip, 'future');
  assert.deepEqual(result.workbenches.find(w => w.id === 'travel').recent.map(item => item.title), ['过往准备', '已完成旅行']);
  assert.equal(result.workbenches.find(w => w.id === 'health').recent[0].title, '最近一餐');
  assert.equal(result.workbenches.find(w => w.id === 'reading').recent[0].route, 'entries');
});

test('overview bounds preview rows and keeps full pending counts', () => {
  const scope = { id: 'custom', type: 'other', name: '自建台', space: 'custom' };
  const items = Array.from({ length: 10 }, (_, index) => ({
    kind: 'task', title: String(index), date: '2026-11-' + String(index + 1).padStart(2, '0'),
  })).reverse();
  const result = buildOverview([scope], () => items, '2026-11-07');

  assert.equal(result.pendingCount, 10);
  assert.equal(result.workbenches[0].pendingCount, 10);
  assert.equal(result.upcoming.length, 8);
  assert.deepEqual(result.workbenches[0].recent.map(item => item.title), ['6', '5', '4']);
});
