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
test('14 công cụ khả dụng, 0 công cụ đang chờ', () => {
  const tools = listTools();
  for (const id of [
    'merge', 'split', 'pages', 'organize', 'crop', 'stamp', 'watermark',
    'pdf-images', 'images-pdf', 'html-pdf', 'compress', 'protect', 'unlock', 'metadata',
  ]) {
    assert.equal(tools.find(t => t.id === id).status, 'available');
  }
  assert.equal(tools.filter(t => t.status === 'available').length, 14);
  assert.equal(tools.filter(t => t.status === 'planned').length, 0);
});
test('compress khả dụng với lossless mặc định và các tuỳ chọn raster', () => {
  const tool = listTools().find(t => t.id === 'compress');
  assert.equal(tool.status, 'available');
  assert.equal(tool.group, 'optimize');
  assert.equal(tool.multiple, false);
  assert.deepEqual(tool.accept, ['.pdf']);
  const option = key => tool.options.find(o => o.key === key);
  assert.equal(option('mode').type, 'enum');
  assert.deepEqual(option('mode').values, ['lossless', 'raster']);
  assert.equal(option('mode').default, 'lossless');
  assert.match(option('mode').labels.raster, /mất lớp chữ/);
  assert.equal(option('pages').type, 'range');
  assert.equal(option('pages').default, '');
  assert.equal(option('dpi').type, 'int');
  assert.deepEqual([option('dpi').min, option('dpi').max], [72, 600]);
  assert.equal(option('dpi').default, 150);
  assert.equal(option('format').type, 'enum');
  assert.deepEqual(option('format').values, ['jpg', 'png']);
  assert.equal(option('format').default, 'jpg');
  assert.equal(option('quality').type, 'int');
  assert.deepEqual([option('quality').min, option('quality').max], [60, 100]);
  assert.equal(option('quality').default, 80);
});
test('watermark khả dụng với chữ hoặc ảnh và các tuỳ chọn đã duyệt', () => {
  const tool = listTools().find(t => t.id === 'watermark');
  assert.equal(tool.status, 'available');
  assert.equal(tool.multiple, false);
  assert.deepEqual(tool.accept, ['.pdf']);
  const option = key => tool.options.find(o => o.key === key);
  assert.equal(option('kind').type, 'enum');
  assert.deepEqual(option('kind').values, ['text', 'image']);
  assert.equal(option('kind').default, 'text');
  assert.equal(option('text').type, 'text');
  assert.equal(option('text').default, 'BẢN NHÁP');
  assert.equal(option('imagePath').type, 'imageFile');
  assert.equal(option('imagePath').default, '');
  for (const [key, min, max, value] of [
    ['fontSize', 12, 200, 60], ['opacity', 0, 100, 20], ['angle', -180, 180, 45], ['margin', 0, 100, 0],
  ]) {
    assert.equal(option(key).type, 'int');
    assert.deepEqual([option(key).min, option(key).max], [min, max]);
    assert.equal(option(key).default, value);
  }
  assert.equal(option('color').type, 'color');
  assert.equal(option('color').default, '#c81e1e');
  assert.equal(option('tile').type, 'bool');
  assert.equal(option('tile').default, false);
  assert.equal(option('pages').type, 'range');
  assert.equal(option('pages').default, '');
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
test('metadata khả dụng với ba tuỳ chọn bật mặc định', () => {
  const m = listTools().find(t => t.id === 'metadata');
  assert.equal(m.status, 'available');
  assert.equal(m.options.length, 3);
  const option = key => m.options.find(o => o.key === key);
  for (const [key, label] of [
    ['removeInfo', /Info/], ['removeXmp', /XMP/], ['removeAttachments', /đính kèm/],
  ]) {
    assert.equal(option(key).type, 'bool');
    assert.equal(option(key).default, true);
    assert.match(option(key).label, label);
  }
});
test('images-pdf nhận nhiều ảnh, có khổ/hướng/lề', () => {
  const tool = listTools().find(t => t.id === 'images-pdf');
  assert.equal(tool.status, 'available');
  assert.equal(tool.multiple, true);
  assert.equal(tool.minFiles, 1);
  assert.deepEqual(tool.accept, ['.png', '.jpg', '.jpeg', '.webp']);
  const option = key => tool.options.find(o => o.key === key);
  assert.equal(option('pageSize').type, 'enum');
  assert.deepEqual(option('pageSize').values, ['auto', 'A4', 'A3', 'Letter']);
  assert.equal(option('pageSize').default, 'A4');
  assert.equal(option('orientation').type, 'enum');
  assert.deepEqual(option('orientation').values, ['auto', 'portrait', 'landscape']);
  assert.equal(option('orientation').default, 'auto');
  assert.equal(option('margin').type, 'int');
  assert.deepEqual([option('margin').min, option('margin').max], [0, 50]);
  assert.equal(option('margin').default, 10);
  assert.match(option('margin').label, /mm/);
});
test('html-pdf nhận một file .html/.htm, có khổ/ngang/nền/lề', () => {
  const tool = listTools().find(t => t.id === 'html-pdf');
  assert.equal(tool.status, 'available');
  assert.equal(tool.multiple, false);
  assert.deepEqual(tool.accept, ['.html', '.htm']);
  const option = key => tool.options.find(o => o.key === key);
  assert.equal(option('pageSize').type, 'enum');
  assert.deepEqual(option('pageSize').values, ['A4', 'A3', 'Letter']);
  assert.equal(option('pageSize').default, 'A4');
  assert.equal(option('landscape').type, 'bool');
  assert.equal(option('landscape').default, false);
  assert.equal(option('printBackground').type, 'bool');
  assert.equal(option('printBackground').default, true);
  assert.equal(option('margin').type, 'int');
  assert.deepEqual([option('margin').min, option('margin').max], [0, 50]);
  assert.equal(option('margin').default, 10);
  assert.match(option('margin').label, /mm/);
});
test('không lộ hàm run qua IPC', () => {
  for (const t of listTools()) assert.equal(t.run, undefined);
});
