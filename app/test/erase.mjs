// Test phần tẩy/xoá nâng cao:
//   - bám dòng chữ (snap) trên PDF chữ, và bỏ qua êm với PDF scan
//   - cọ xoá và khoanh vùng
//   - nền chuyển sắc / mờ mép
//   - "xoá hẳn" với tuỳ chọn PNG/JPEG và DPI
// Kiểm chứng cuối cùng bằng cách RENDER LẠI PDF đã lưu và soi điểm ảnh vùng bị che.
//
// Chạy: node test/erase.mjs   (trong app/)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv } from './_paths.mjs';

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

/** Render một trang của PDF (mảng byte) rồi thống kê điểm ảnh trong vùng chỉ định.
 *  `box` dùng toạ độ hiển thị (điểm, gốc trên-trái) — cùng hệ với pageLines(). */
const probeRegion = (bytes, box, target) => A(async (args) => {
  const { bytes, box, target } = args;
  const lib = window.__app.pdfjs;
  const doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const p = await doc.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  await p.render({ canvasContext: x, viewport: vp }).promise;
  const rx = Math.max(0, Math.round(box.x) + 3), ry = Math.max(0, Math.round(box.y) + 3);
  const rw = Math.max(1, Math.min(c.width - rx, Math.round(box.w) - 6));
  const rh = Math.max(1, Math.min(c.height - ry, Math.round(box.h) - 6));
  const d = x.getImageData(rx, ry, rw, rh).data;
  let match = 0, dark = 0, n = 0;
  const [tr, tg, tb] = target;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    n++;
    if (Math.abs(r - tr) < 40 && Math.abs(g - tg) < 40 && Math.abs(b - tb) < 40) match++;
    if (r < 110 && g < 110 && b < 110) dark++;
  }
  return { match: match / n, dark: dark / n, w: rw, h: rh };
}, { bytes: Array.from(bytes), box, target });

/* ---------- 1. Bám dòng chữ trên PDF chữ ---------- */
const lines = await A(async () => {
  const l = await window.__app.pageLines(window.__app.pages[0]);
  return l.map(x => ({ x: x.x, y: x.y, w: x.w, h: x.h, text: x.text }));
});
check('Đọc được dòng chữ từ PDF chữ', lines.length >= 2, `${lines.length} dòng`);
console.log('   dòng đầu:', JSON.stringify(lines[0] || null));

const snapTest = await A((lines) => {
  const l = lines.find(x => x.w > 60) || lines[0];
  // khung nhỏ nằm giữa dòng, chỉ phủ một phần chiều cao -> phải được nới cho đủ dòng
  const r = { x: l.x + l.w * 0.3, y: l.y + l.h * 0.35, w: l.w * 0.25, h: l.h * 0.3 };
  const s = window.__app.snapRectToLines(lines, r);
  return { raw: r, snap: s, line: l };
}, lines);
check('Snap nới khung cho đủ chiều cao dòng chữ',
  snapTest.snap.h > snapTest.raw.h * 1.6 && snapTest.snap.y <= snapTest.line.y + 1,
  `cao ${snapTest.raw.h.toFixed(1)} → ${snapTest.snap.h.toFixed(1)} điểm`);

/* ---------- 2. Che bằng khung + xoá hẳn, rồi render lại để kiểm chứng ---------- */
const target = lines.find(l => l.w > 60) || lines[0];
const box = { x: target.x - 2, y: target.y - 2, w: target.w + 4, h: target.h + 4 };
const MAGENTA = [255, 0, 255];
await A((b) => { window.__app.createObj({ type: 'rect', page: 0, ...b, color: '#ff00ff', fillMode: 'solid' }); }, box);

const flatJpeg = await A(async () => Array.from((await window.__app.buildPdf(true, { format: 'jpeg', quality: 0.85, dpi: 150 })).bytes));
const flatPng = await A(async () => Array.from((await window.__app.buildPdf(true, { format: 'png', dpi: 150 })).bytes));
const coverOnly = await A(async () => Array.from((await window.__app.buildPdf(false)).bytes));

check('PDF sau khi xoá hẳn vẫn là PDF hợp lệ',
  Buffer.from(flatJpeg.slice(0, 5)).toString() === '%PDF-', `${(flatJpeg.length / 1024).toFixed(0)} KB`);
check('Xuất được cả PNG và JPEG, dung lượng khác nhau',
  flatPng.length !== flatJpeg.length && flatPng.length > 50000,
  `PNG ${(flatPng.length / 1024).toFixed(0)} KB vs JPEG ${(flatJpeg.length / 1024).toFixed(0)} KB`);

// Heuristic chọn định dạng: trang chữ -> PNG, trang scan/ảnh -> JPEG
const autoText = await A(async () => {
  const c = await window.__app.renderMaskedPage(window.__app.pages[0], [], { dpi: 150 });
  return window.__app.pickAutoFormat(c);
});
check('Tự động chọn PNG cho trang chữ', autoText === 'png', `chọn: ${autoText}`);

const rFlat = await probeRegion(flatJpeg, box, MAGENTA);
check('Xoá hẳn: vùng che đã bị tô kín và không còn chữ cũ',
  rFlat.match > 0.9 && rFlat.dark < 0.02,
  `đúng màu ${(rFlat.match * 100).toFixed(1)}% · còn nét tối ${(rFlat.dark * 100).toFixed(2)}%`);

const rCover = await probeRegion(coverOnly, box, MAGENTA);
check('Chỉ che phủ: vùng che cũng phủ kín (nhưng chữ cũ vẫn còn trong file)',
  rCover.match > 0.9, `đúng màu ${(rCover.match * 100).toFixed(1)}%`);

/* ---------- 3. Cọ xoá và khoanh vùng ---------- */
const BRUSH = [0, 128, 0];
const LASSO = [255, 140, 0];
await A(() => { window.__app.objects.forEach(o => o.el.remove()); window.__app.objects.length = 0; });
const brushBox = await A((b) => {
  const o = window.__app.createObj({ type: 'brush', page: 0, pts: [[b.x, b.y + b.h / 2], [b.x + b.w * 0.5, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]], width: Math.max(8, b.h * 0.7), color: '#008000', fillMode: 'solid' });
  return window.__app.maskBox(o);
}, box);
const brushPdf = await A(async () => Array.from((await window.__app.buildPdf(true, { format: 'jpeg', dpi: 150 })).bytes));
const rBrush = await probeRegion(brushPdf, brushBox, BRUSH);
check('Cọ xoá: nét cọ trở thành vùng bị xoá thật', rBrush.match > 0.5, `đúng màu ${(rBrush.match * 100).toFixed(1)}%`);

await A(() => { window.__app.objects.forEach(o => o.el.remove()); window.__app.objects.length = 0; });
const lassoBox = await A((b) => {
  const o = window.__app.createObj({ type: 'lasso', page: 0, pts: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], color: '#ff8c00', fillMode: 'solid' });
  return window.__app.maskBox(o);
}, box);
const lassoPdf = await A(async () => Array.from((await window.__app.buildPdf(true, { format: 'jpeg', dpi: 150 })).bytes));
const rLasso = await probeRegion(lassoPdf, lassoBox, LASSO);
check('Khoanh vùng: cả vùng khoanh bị xoá thật', rLasso.match > 0.9, `đúng màu ${(rLasso.match * 100).toFixed(1)}%`);

/* ---------- 4. Nền chuyển sắc / mờ mép (chế độ chỉ che phủ dùng ảnh vá) ---------- */
await A(() => { window.__app.objects.forEach(o => o.el.remove()); window.__app.objects.length = 0; });
await A((b) => { window.__app.createObj({ type: 'rect', page: 0, ...b, color: '#ffffff', fillMode: 'gradient', feather: true }); }, box);
const gradPdf = await A(async () => Array.from((await window.__app.buildPdf(false)).bytes));
const rGrad = await probeRegion(gradPdf, box, [255, 255, 255]);
check('Nền chuyển sắc: vùng che được vá kín, không còn chữ',
  rGrad.match > 0.5 && rGrad.dark < 0.15,
  `trắng ${(rGrad.match * 100).toFixed(1)}% · còn nét tối ${(rGrad.dark * 100).toFixed(2)}%`);

fs.writeFileSync(path.join(OUT, 'erase-flat-jpeg.pdf'), Buffer.from(flatJpeg));
fs.writeFileSync(path.join(OUT, 'erase-flat-png.pdf'), Buffer.from(flatPng));
console.log(`\nĐã ghi PDF mẫu vào ${path.relative(APP_ROOT, OUT)}`);

/* ---------- 5. PDF scan: bám dòng chữ phải bỏ qua êm ---------- */
await A(async (b64) => {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  await window.__app.openBytes(u, 'scan-test.pdf', null);
}, fs.readFileSync(testFile('scan-test.pdf')).toString('base64'));
await w.waitForFunction(() => window.__app.pages.length > 0 && window.__app.pages.every(p => p.rendered > 0), null, { timeout: 30000 });
const scanLines = await A(async () => (await window.__app.pageLines(window.__app.pages[0])).length);
check('PDF scan: không có lớp chữ, snap bỏ qua êm', scanLines === 0, `${scanLines} dòng`);

const autoScan = await A(async () => {
  const c = await window.__app.renderMaskedPage(window.__app.pages[0], [], { dpi: 150 });
  return window.__app.pickAutoFormat(c);
});
console.log(`   (trang scan-test.pdf được chọn: ${autoScan} — trang này gần như đơn sắc nên PNG là hợp lý)`);

// Heuristic phải chọn JPEG cho ảnh nhiều màu
const autoColor = await A(() => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  const x = c.getContext('2d');
  for (let i = 0; i < 400; i += 20) for (let j = 0; j < 300; j += 20) {
    x.fillStyle = `hsl(${(i * 7 + j * 13) % 360} 85% 55%)`;
    x.fillRect(i, j, 20, 20);
  }
  return window.__app.pickAutoFormat(c);
});
check('Tự động chọn JPEG cho ảnh nhiều màu', autoColor === 'jpeg', `chọn: ${autoColor}`);

await app.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
