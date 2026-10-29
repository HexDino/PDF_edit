import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parsePageRange, parsePageSegments } = require('../../suite/pages.js');

test('khoảng trống = tất cả trang', () => {
  assert.deepEqual(parsePageRange('', 3), [1, 2, 3]);
});
test('1-3,5,8- trên 8 trang', () => {
  assert.deepEqual(parsePageRange('1-3,5,8-', 8), [1, 2, 3, 5, 8]);
});
test('cho phép lặp trang khi trích', () => {
  assert.deepEqual(parsePageRange('2,2,1', 3), [2, 2, 1]);
});
test('vượt số trang báo INVALID_RANGE', () => {
  assert.throws(() => parsePageRange('4', 3), e => e.code === 'INVALID_RANGE');
});
test('khoảng ngược báo lỗi', () => {
  assert.throws(() => parsePageRange('3-1', 5), e => e.code === 'INVALID_RANGE');
});

test('parsePageSegments: mỗi đoạn phẩy là một file', () => {
  assert.deepEqual(parsePageSegments('1-3,5', 6), [[1, 2, 3], [5]]);
});
test('parsePageSegments: trống = một đoạn tất cả trang', () => {
  assert.deepEqual(parsePageSegments('', 6), [[1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(parsePageSegments('   ', 3), [[1, 2, 3]]);
});
test('parsePageSegments: giữ thứ tự và cho phép lặp', () => {
  assert.deepEqual(parsePageSegments('2,1-2', 3), [[2], [1, 2]]);
});
test('parsePageSegments: khoảng không hợp lệ báo INVALID_RANGE', () => {
  for (const spec of ['0', '4', '3-1', 'a', '1-3,,5']) {
    assert.throws(() => parsePageSegments(spec, 3), e => e.code === 'INVALID_RANGE', spec);
  }
  assert.throws(() => parsePageSegments('', 0), e => e.code === 'INVALID_RANGE');
});
