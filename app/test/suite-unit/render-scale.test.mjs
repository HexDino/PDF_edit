import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScale, MAX_RENDER_EDGE } from '../../renderer/worker/render-scale.mjs';

test('DPI thường giữ nguyên tỉ lệ', () => {
  assert.equal(renderScale(72, 100, 200), 1);
  assert.equal(renderScale(150, 100, 200), 150 / 72);
});

test('trang rộng ở 600 DPI bị hạ để cạnh dài đúng 10.000 px', () => {
  const scale = renderScale(600, 2000, 100);
  assert.equal(scale, MAX_RENDER_EDGE / 2000);
  assert.equal(Math.ceil(2000 * scale), MAX_RENDER_EDGE);
  assert.equal(Math.ceil(100 * scale), 500);
});

test('trang dọc quá khổ cũng bị hạ theo cạnh dài', () => {
  const scale = renderScale(600, 500, 3000);
  assert.ok(Math.max(Math.ceil(500 * scale), Math.ceil(3000 * scale)) <= MAX_RENDER_EDGE);
  assert.equal(Math.ceil(3000 * scale), MAX_RENDER_EDGE);
});

test('kích thước không hợp lệ không làm hỏng tỉ lệ', () => {
  assert.equal(renderScale(300, 0, 0), 300 / 72);
  assert.equal(renderScale(undefined, 100, 200), 1);
});
