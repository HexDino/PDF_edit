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

test('color accepts six hexadecimal digits, preserves defaults and rejects unsafe values', () => {
  const colored = { options: [{ key: 'color', type: 'color', default: '#1f2937' }] };
  assert.deepEqual(validateOptions(colored), { color: '#1f2937' });
  assert.deepEqual(validateOptions(colored, { color: '#Aa12F0' }), { color: '#Aa12F0' });
  for (const color of ['red', '#fff', '#11223344', '#gg1122', '#112233\n', 'url(private)', 123, null]) {
    assert.throws(() => validateOptions(colored, { color }), e => e.code === 'INVALID_OPTIONS');
  }
});

test('rejects option bags that are not plain objects', () => {
  const arrays = [
    [],
    Object.assign([], { dpi: 300 }),
    Object.assign([], { imagePath: 'C:\\private\\a.png' }),
  ];
  for (const input of [...arrays, null, 'dpi=300', 42, true]) {
    assert.throws(() => validateOptions(tool, input), e =>
      e.code === 'INVALID_OPTIONS' && e.message === 'Tuỳ chọn không hợp lệ.');
  }
});

test('imageFile accepts empty/normal paths, bounded length, and rejects NUL/CR/LF', () => {
  const image = { options: [{ key: 'imagePath', type: 'imageFile', default: '' }] };
  assert.deepEqual(validateOptions(image), { imagePath: '' });
  assert.deepEqual(validateOptions(image, { imagePath: '' }), { imagePath: '' });
  for (const imagePath of [
    'C:\\thư mục\\ảnh.png',
    '/home/user/a.jpg',
    'a'.repeat(1000),
  ]) {
    assert.deepEqual(validateOptions(image, { imagePath }), { imagePath });
  }
  for (const imagePath of [
    'a\0b.png', 'a\rb.png', 'a\nb.png', 'a'.repeat(1001), 42, null, ['a.png'],
  ]) {
    assert.throws(() => validateOptions(image, { imagePath }), e => e.code === 'INVALID_OPTIONS');
  }
});
