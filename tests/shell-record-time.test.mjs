import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createShell} from '../public/shell.js';

test('custom workbench task and note forms preserve optional times on edit', async t => {
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-11-02T07:42:00Z')});
  const fields = new Map(), writes = [];
  const form = {isConnected: true}, button = {};
  const originalFormData = globalThis.FormData;
  globalThis.FormData = class { constructor() { return fields; } };
  globalThis.window = {addEventListener() {}};
  globalThis.document = {
    querySelector: selector => selector === '#shell-record-form' ? form : button,
  };
  t.after(() => {
    globalThis.FormData = originalFormData;
    delete globalThis.window;
    delete globalThis.document;
  });
  const ctx = {
    space: 'demo', workbench: 'custom', today: '2026-11-02', items: [],
    workbenches: [{id: 'custom', name: '虚构工作台', type: 'other'}],
    esc: String, icon: () => '', btn: () => '',
    field(label, name, value) { fields.set(name, value); return ''; },
    openDrawer() {}, closeDrawer() {}, load() {}, toast() {},
    async api(path, {method, body}) { writes.push({path, method, body: JSON.parse(body)}); },
  };
  const shell = createShell(ctx);
  const submit = async () => {
    fields.set('title', '修改后的标题');
    await form.onsubmit({preventDefault() {}});
    return writes.pop();
  };

  for (const kind of ['task', 'note']) {
    for (const [existing, expected, entered] of [
      [{}, ''],
      [{time: ''}, ''],
      [{time: '08:30'}, '08:30'],
      [{time: ''}, '', '09:45'],
      [{time: '08:30'}, '08:30', '09:45'],
      [{time: '08:30'}, '08:30', ''],
    ]) {
      ctx.items = [{id: 'fixture', kind, date: ctx.today, title: '原标题', done: true, ...existing}];
      await shell.handle('shell-edit', 'fixture');
      assert.equal(fields.get('time'), expected, `${kind} ${JSON.stringify(existing)}`);
      if (entered !== undefined) fields.set('time', entered);
      const {path, method, body} = await submit();
      assert.equal(path, '/api/items/fixture');
      assert.equal(method, 'PUT');
      assert.equal(body.time, entered ?? expected);
      if (kind === 'task') assert.equal(body.done, true);
    }

    await shell.handle('shell-add', kind);
    assert.equal(fields.get('time'), '15:42');
    fields.set('time', '');
    const {path, method, body} = await submit();
    assert.equal(path, '/api/items');
    assert.equal(method, 'POST');
    assert.equal(body.time, '');
  }
});
