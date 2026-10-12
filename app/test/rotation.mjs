// Test PDF có XOAY TRANG (0/90/180/270) — trường hợp hay gặp với bản scan bị lệch.
// Kiểm tra: đọc dòng chữ, bám dòng, và vị trí vùng che sau khi xuất "xoá hẳn".
// Đây là lỗi thật đã gặp: gộp mảnh chữ theo trục y của khung nhìn làm 2 dòng dính thành 1
// khi trang xoay 90/270, khiến bám dòng che lố.
//
// Chạy: node test/rotation.mjs   (trong app/)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, electronEnv, closeApp } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const app = await electron.launch({ executablePath: electronBin, args: [APP_ROOT, '--no-sandbox'], env: electronEnv });
const w = await app.firstWindow();
const errors = [];
w.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await w.waitForFunction(() => !!window.__app, null, { timeout: 60000 });
const A = (fn, arg) => w.evaluate(fn, arg);

/* ---------- Dựng PDF 4 trang, mỗi trang xoay một hướng ---------- */
const ROTS = [0, 90, 180, 270];
const bytes = await A(async (rots) => {
  const doc = await PDFLib.PDFDocument.create();
  const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (const rot of rots) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText('HOP DONG SO 12345', { x: 70, y: 760, size: 18, font: f });
    p.drawText('So tien 15000000 dong', { x: 70, y: 700, size: 14, font: f });
    if (rot) p.setRotation(PDFLib.degrees(rot));
  }
  return Array.from(await doc.save());
}, ROTS);
await A(async (b) => { await window.__app.openBytes(new Uint8Array(b), 'rot.pdf', null); }, bytes);
await w.waitForFunction(() => window.__app.pages.length === 4 && window.__app.pages.every(p => p.rendered > 0), null, { timeout: 60000 });
await w.waitForTimeout(400);

/* ---------- 1. Đọc dòng chữ ---------- */
const geo = await A(async () => {
  const a = window.__app, out = [];
  for (const pg of a.pages) {
    const lines = await a.pageLines(pg);
    out.push({ rot: ((pg.rotate % 360) + 360) % 360, vw: pg.vp1.width, vh: pg.vp1.height, n: lines.length,
      lines: lines.map(l => ({ x: +l.x.toFixed(1), y: +l.y.toFixed(1), w: +l.w.toFixed(1), h: +l.h.toFixed(1) })) });
  }
  return out;
});
check('Mỗi hướng xoay đều tách đúng 2 dòng chữ (không gộp nhầm)',
  geo.every(g => g.n === 2), geo.map(g => `rot${g.rot}:${g.n}`).join(' · '));
check('Hộp bao dòng chữ nằm trong khung nhìn',
  geo.every(g => g.lines.every(l => l.x >= -1 && l.y >= -1 && l.x + l.w <= g.vw + 1 && l.y + l.h <= g.vh + 1)),
  geo.map(g => `rot${g.rot} ${Math.round(g.vw)}×${Math.round(g.vh)}`).join(' · '));
check('Hướng của hộp bao đúng theo chiều xoay (0/180 ngang, 90/270 dọc)',
  geo.every(g => {
    const l = g.lines[0];
    const horiz = (g.rot === 0 || g.rot === 180);
    return horiz ? l.w > l.h * 3 : l.h > l.w * 3;
  }),
  geo.map(g => `rot${g.rot} w=${g.lines[0].w} h=${g.lines[0].h}`).join(' · '));

/* ---------- 2. Bám dòng chữ ---------- */
const snap = await A(async () => {
  const a = window.__app, out = [];
  for (const pg of a.pages) {
    const lines = await a.pageLines(pg);
    const l = lines[0];
    // khung nhỏ nằm giữa dòng -> phải được nới cho đủ dòng
    const r = { x: l.x + l.w * 0.35, y: l.y + l.h * 0.35, w: l.w * 0.3, h: l.h * 0.3 };
    const s = a.snapRectToLines(lines, r);
    out.push({ rot: ((pg.rotate % 360) + 360) % 360, raw: r, snap: s, line: l });
  }
  return out;
});
check('Bám dòng chữ nới đủ bề dày dòng trên mọi hướng xoay',
  snap.every(s => {
    const horiz = s.line.w >= s.line.h;
    // bề dày dòng luôn phải được phủ hết, và phải nới rộng hơn hẳn khung kéo tay
    const cover = horiz ? (s.snap.h >= s.line.h - 1 && s.snap.y <= s.line.y + 1)
                        : (s.snap.w >= s.line.w - 1 && s.snap.x <= s.line.x + 1);
    const grew = horiz ? s.snap.h > s.raw.h * 2 : s.snap.w > s.raw.w * 2;
    return cover && grew;
  }),
  snap.map(s => {
    const horiz = s.line.w >= s.line.h;
    return `rot${s.rot} ${horiz ? 'ngang' : 'dọc'} dày ${horiz ? s.raw.h.toFixed(0) + '→' + s.snap.h.toFixed(0) : s.raw.w.toFixed(0) + '→' + s.snap.w.toFixed(0)}`;
  }).join(' · '));

/* ---------- 3. Che + xuất "xoá hẳn" rồi soi lại điểm ảnh ---------- */
const boxes = await A(async () => {
  const a = window.__app, out = [];
  for (const pg of a.pages) {
    const l = (await a.pageLines(pg))[0];
    const b = { x: l.x - 2, y: l.y - 2, w: l.w + 4, h: l.h + 4 };
    a.createObj({ type: 'rect', page: pg.idx, ...b, color: '#ff00ff', fillMode: 'solid' });
    out.push({ page: pg.idx, ...b });
  }
  return out;
});
const outBytes = await A(async () => Array.from((await window.__app.buildPdf(true, { format: 'jpeg', dpi: 150 })).bytes));
check('Xuất "xoá hẳn" từ PDF xoay vẫn ra PDF hợp lệ',
  Buffer.from(outBytes.slice(0, 5)).toString() === '%PDF-', `${(outBytes.length / 1024).toFixed(0)} KB`);

const probe = (box, pageIdx) => A(async (args) => {
  const doc = await window.__app.pdfjs.getDocument({ data: new Uint8Array(args.bytes), isEvalSupported: false }).promise;
  const p = await doc.getPage(args.pageIdx + 1);
  const vp = p.getViewport({ scale: 1 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  await p.render({ canvasContext: x, viewport: vp }).promise;
  const b = args.box;
  const rx = Math.max(0, Math.round(b.x) + 3), ry = Math.max(0, Math.round(b.y) + 3);
  const rw = Math.max(1, Math.round(b.w) - 6), rh = Math.max(1, Math.round(b.h) - 6);
  const d = x.getImageData(rx, ry, rw, rh).data;
  let mag = 0, dark = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { n++;
    if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) mag++;
    if (d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110) dark++; }
  return { vp: [Math.round(vp.width), Math.round(vp.height)], mag: mag / n, dark: dark / n };
}, { bytes: outBytes, box, pageIdx });

let bad = 0;
const detail = [];
for (const b of boxes) {
  const r = await probe(b, b.page);
  const ok = r.mag > 0.85 && r.dark < 0.03;
  if (!ok) bad++;
  detail.push(`rot${geo[b.page].rot}: ${(r.mag * 100).toFixed(0)}% đúng màu, ${(r.dark * 100).toFixed(2)}% nét tối`);
}
check('Vùng che nằm đúng chỗ và chữ cũ bị xoá thật trên mọi hướng xoay', bad === 0, detail.join(' · '));

check('Không có lỗi JS khi xử lý trang xoay', errors.length === 0, errors.slice(0, 2).join(' | '));

await closeApp(app);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
