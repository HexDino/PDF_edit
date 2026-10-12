// Kiểm tra việc nhúng phông vào PDF:
//   1. Mọi phông trong danh sách đều nhúng được và KHÔNG thiếu ký tự tiếng Việt.
//   2. Bật subset làm dung lượng PDF nhỏ hơn hẳn so với tổng dung lượng file phông.
//
// Chạy: node test/fonts-export.mjs   (trong app/)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv, closeApp } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox', testFile('text-doc.pdf')],
  env: electronEnv,
});
const w = await app.firstWindow();
await w.waitForFunction(() => window.__app && window.__app.pages.length > 0 && window.__app.pages.every(p => p.rendered > 0), null, { timeout: 60000 });
await w.waitForTimeout(300);
const A = (fn, arg) => w.evaluate(fn, arg);

const fonts = await A(() => window.__app.FONTS.map(f => ({ key: f.key, name: f.name, group: f.group, file: f.file })));
console.log(`\nDanh sách phông (${fonts.length}): ${fonts.map(f => f.key).join(', ')}\n`);

/* ---------- 1. Nạp hết phông rồi tạo một đoạn chữ tiếng Việt cho mỗi phông ---------- */
const loaded = await A(async () => {
  const out = {};
  for (const f of window.__app.FONTS) {
    try { await window.__app.loadFont(f); out[f.key] = true; }
    catch (e) { out[f.key] = String(e.message || e); }
  }
  return out;
});
const loadFails = Object.entries(loaded).filter(([, v]) => v !== true);
check('Nạp được toàn bộ phông', loadFails.length === 0, loadFails.map(([k, v]) => `${k}: ${v}`).join(' | ') || `${fonts.length} phông`);

const PROBE = 'Bệnh nhân uống thuốc ngày 2 lần — ăâđêôơư ẮẶỄỸỢỤỊĐ 0123456789';
await A((probe) => {
  const a = window.__app;
  a.FONTS.forEach((f, i) => {
    a.createObj({ type: 'text', page: 0, x: 24, y: 20 + i * 27, size: 14, color: '#1a2a7a', font: f.key, slant: 0, jitter: false, text: probe });
  });
}, PROBE);
await w.waitForTimeout(400);

/* ---------- 2. Xuất PDF và kiểm tra ký tự thiếu ---------- */
const built = await A(async () => {
  const r = await window.__app.buildPdf(false);
  const missing = {};
  for (const [k, set] of Object.entries(r.missing)) missing[k] = [...set].join('');
  return { size: r.bytes.length, missing };
});
const missingKeys = Object.keys(built.missing);
check('Nhúng được chữ tiếng Việt với mọi phông (không thiếu ký tự)',
  missingKeys.length === 0,
  missingKeys.length ? missingKeys.map(k => `${k}: "${built.missing[k]}"`).join(' | ') : `${fonts.length} phông`);

/* ---------- 3. Subset phải làm PDF nhỏ hơn hẳn tổng dung lượng phông ---------- */
const fontDir = path.join(APP_ROOT, 'renderer', 'fonts');
let rawTotal = 0;
for (const f of fonts) {
  try { rawTotal += fs.statSync(path.join(fontDir, f.file)).size; } catch { /* bỏ qua */ }
}
const ratio = rawTotal ? built.size / rawTotal : 1;
console.log(`\nDung lượng PDF: ${(built.size / 1024).toFixed(0)} KB · tổng file phông: ${(rawTotal / 1024).toFixed(0)} KB · tỉ lệ ${(ratio * 100).toFixed(1)}%`);
check('Bật subset giúp PDF nhỏ hơn nhiều so với tổng phông', ratio < 0.5, `tỉ lệ ${(ratio * 100).toFixed(1)}%`);

const outFile = path.join(OUT, 'fonts-all.pdf');
fs.writeFileSync(outFile, Buffer.from(await A(async () => Array.from((await window.__app.buildPdf(false)).bytes))));
console.log(`Đã ghi ${path.relative(APP_ROOT, outFile)}`);

await closeApp(app);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
