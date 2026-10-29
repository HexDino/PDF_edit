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
test('merge/split/pages khả dụng, các công cụ khác đang chờ', () => {
  const tools = listTools();
  assert.equal(tools.find(t => t.id === 'merge').status, 'available');
  assert.equal(tools.find(t => t.id === 'split').status, 'available');
  assert.equal(tools.find(t => t.id === 'pages').status, 'available');
  assert.ok(tools.filter(t => t.status === 'planned').length >= 9);
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
test('protect nói rõ mật khẩu chủ bắt buộc khi hạn chế quyền', () => {
  const p = listTools().find(t => t.id === 'protect');
  const owner = p.options.find(o => o.key === 'ownerPassword');
  assert.match(owner.label, /bắt buộc/i);
});
test('không lộ hàm run qua IPC', () => {
  for (const t of listTools()) assert.equal(t.run, undefined);
});
