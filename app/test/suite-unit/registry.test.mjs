import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { listTools } = require('../../suite/registry.js');

test('có đủ 14 công cụ, id duy nhất', () => {
  const tools = listTools();
  assert.equal(tools.length, 14);
  assert.equal(new Set(tools.map(t => t.id)).size, 14);
});
test('mỗi công cụ có trường bắt buộc', () => {
  for (const t of listTools()) {
    for (const k of ['id', 'group', 'title', 'description', 'accept', 'status']) {
      assert.ok(t[k] !== undefined, `${t.id} thiếu ${k}`);
    }
  }
});
test('merge/split/pages/organize/crop/protect/unlock khả dụng, 6 công cụ đang chờ', () => {
  const tools = listTools();
  for (const id of ['merge', 'split', 'pages', 'organize', 'crop', 'protect', 'unlock']) {
    assert.equal(tools.find(t => t.id === id).status, 'available');
  }
  assert.equal(tools.filter(t => t.status === 'available').length, 8);
  assert.equal(tools.filter(t => t.status === 'planned').length, 6);
});
test('split/pages có đủ tuỳ chọn cho UI', () => {
  const tools = listTools();
  const split = tools.find(t => t.id === 'split');
  const pages = tools.find(t => t.id === 'pages');
  assert.deepEqual(split.options.find(o => o.key === 'mode').values, ['ranges', 'every-n', 'each-page']);
  assert.equal(split.options.find(o => o.key === 'ranges').type, 'text');
  assert.deepEqual(
    [split.options.find(o => o.key === 'every').min, split.options.find(o => o.key === 'every').max],
    [1, 1000],
  );
  assert.deepEqual(pages.options.find(o => o.key === 'mode').values, ['delete', 'extract']);
  assert.match(pages.options.find(o => o.key === 'pages').placeholder, /bắt buộc khi xoá/);
});
test('organize/crop có đủ tuỳ chọn cho UI', () => {
  const tools = listTools();
  const organize = tools.find(t => t.id === 'organize');
  const crop = tools.find(t => t.id === 'crop');
  const option = (tool, key) => tool.options.find(o => o.key === key);

  assert.equal(option(organize, 'order').type, 'text');
  assert.equal(option(organize, 'order').placeholder, '3,1,2 (trống = giữ nguyên)');
  assert.deepEqual(option(organize, 'rotate').values, ['0', '90', '180', '270']);
  assert.equal(option(organize, 'rotate').default, '0');
  assert.deepEqual([option(organize, 'blankCount').min, option(organize, 'blankCount').max], [0, 50]);
  assert.equal(option(organize, 'blankCount').default, 0);

  for (const [key, label] of [['top', 'Lề trên'], ['right', 'Lề phải'], ['bottom', 'Lề dưới'], ['left', 'Lề trái']]) {
    assert.equal(option(crop, key).type, 'int');
    assert.deepEqual([option(crop, key).min, option(crop, key).max], [0, 200]);
    assert.equal(option(crop, key).default, 0);
    assert.match(option(crop, key).label, new RegExp(`${label} \\(mm\\)`));
  }
  assert.equal(option(crop, 'pages').type, 'range');
  assert.equal(option(crop, 'pages').placeholder, '1-3,5 (trống = tất cả)');
});
test('protect nói rõ mật khẩu chủ bắt buộc khi hạn chế quyền', () => {
  const p = listTools().find(t => t.id === 'protect');
  const owner = p.options.find(o => o.key === 'ownerPassword');
  assert.match(owner.label, /bắt buộc/i);
});
test('unlock yêu cầu mật khẩu hiện có', () => {
  const u = listTools().find(t => t.id === 'unlock');
  assert.equal(u.status, 'available');
  assert.equal(u.options.length, 1);
  assert.equal(u.options[0].key, 'password');
  assert.equal(u.options[0].type, 'password');
  assert.equal(u.options[0].required, true);
  assert.equal(u.options[0].label, 'Mật khẩu hiện có');
});
test('không lộ hàm run qua IPC', () => {
  for (const t of listTools()) assert.equal(t.run, undefined);
});
