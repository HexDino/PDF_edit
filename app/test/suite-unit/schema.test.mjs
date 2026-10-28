import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateOptions } = require('../../suite/schema.js');

const tool = {
  options: [
    { key: 'dpi', type: 'int', min: 72, max: 600, default: 150 },
    { key: 'format', type: 'enum', values: ['jpg', 'png'], default: 'jpg' },
    { key: 'allow', type: 'bool', default: false },
    { key: 'password', type: 'password', default: '' },
  ],
};

test('áp default và ép kiểu hợp lệ', () => {
  assert.deepEqual(validateOptions(tool, { dpi: '300', allow: 1 }), {
    dpi: 300, format: 'jpg', allow: true, password: '',
  });
});
test('từ chối enum lạ', () => {
  assert.throws(() => validateOptions(tool, { format: 'webp' }), e => e.code === 'INVALID_OPTIONS');
});
test('từ chối tuỳ chọn lạ', () => {
  assert.throws(() => validateOptions(tool, { hack: 1 }), e => e.code === 'INVALID_OPTIONS');
});
test('từ chối số ngoài khoảng', () => {
  assert.throws(() => validateOptions(tool, { dpi: 601 }), e => e.code === 'INVALID_OPTIONS');
});
