// Test gói tiện ích khi soạn thảo:
//   - Làm lại (redo) sau khi hoàn tác; thao tác mới thì xoá nhánh làm lại
//   - Nhân bản đối tượng (Ctrl+D) cho cả đối tượng theo toạ độ lẫn theo nét
//   - Đặt nhanh chữ ký vào góc trang, và đặt lên tất cả các trang
//
// Chạy: node test/editing.mjs   (trong app/)
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
const errors = [];
w.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await w.waitForFunction(() => window.__app && window.__app.pages.length > 0 && window.__app.pages.every(p => p.rendered > 0), null, { timeout: 60000 });
await w.waitForTimeout(300);
const A = (fn, arg) => w.evaluate(fn, arg);
const objs = () => A(() => window.__app.objects.map(o => ({ type: o.type, x: o.x, y: o.y, text: o.text })));

const mkText = { type: 'text', page: 0, x: 80, y: 120, size: 18, color: '#111111', font: 'PatrickHand', slant: 0, jitter: false, text: 'Xin chào' };

/* ---------- 1. Làm lại (redo) ---------- */
await A((d) => { window.__app.pushHistory(); window.__app.createObj(d); }, mkText);
const n1 = (await objs()).length;
await A(() => window.__app.undo());
const n2 = (await objs()).length;
const redoState = await A(() => ({ canRedo: window.__app.future.length, btnDisabled: document.getElementById('redoBtn').disabled }));
await A(() => window.__app.redo());
const n3 = (await objs()).length;
check('Hoàn tác rồi làm lại khôi phục đúng đối tượng', n1 === 1 && n2 === 0 && n3 === 1, `${n1} → ${n2} → ${n3}`);
check('Nút "Làm lại" bật/tắt theo ngăn xếp', redoState.canRedo === 1 && redoState.btnDisabled === false, JSON.stringify(redoState));

await A((d) => { window.__app.pushHistory(); window.__app.createObj({ ...d, y: 260, text: 'Dòng mới' }); }, mkText);
const afterNew = await A(() => window.__app.future.length);
check('Thao tác mới xoá nhánh "làm lại"', afterNew === 0, `future=${afterNew}`);

/* ---------- 2. Nhân bản đối tượng ---------- */
const dupText = await A(() => {
  const a = window.__app;
  const src = a.objects.find(o => o.type === 'text');
  const before = a.objects.length;
  const n = a.duplicateObj(src);
  return { before, after: a.objects.length, dx: n.x - src.x, dy: n.y - src.y, type: n.type, text: n.text };
});
check('Nhân bản khung chữ: thêm 1 đối tượng, lệch 12 điểm',
  dupText.after === dupText.before + 1 && Math.abs(dupText.dx - 12) < 0.01 && Math.abs(dupText.dy - 12) < 0.01 && dupText.type === 'text',
  `Δ=(${dupText.dx},${dupText.dy})`);

const dupMask = await A(() => {
  const a = window.__app;
  const m = a.createObj({ type: 'lasso', page: 0, pts: [[100, 300], [200, 300], [200, 360]], color: '#ff0000', fillMode: 'solid' });
  const n = a.duplicateObj(m);
  return { p0: m.pts[0], p1: n.pts[0], kind: n.type };
});
check('Nhân bản vùng che: dịch toàn bộ điểm',
  Math.abs(dupMask.p1[0] - dupMask.p0[0] - 12) < 0.01 && Math.abs(dupMask.p1[1] - dupMask.p0[1] - 12) < 0.01,
  JSON.stringify(dupMask));

const toolsHtml = await A(() => {
  const a = window.__app;
  a.createObj({ type: 'rect', page: 0, x: 60, y: 400, w: 80, h: 20, color: '#ffffff', fillMode: 'solid' });
  return [...document.querySelectorAll('.obj .tools')].every(t => t.querySelector('.dup')) ;
});
check('Mọi đối tượng đều có nút nhân bản trên thanh công cụ', toolsHtml === true);

/* ---------- 3. Đặt nhanh chữ ký vào góc ---------- */
const sigUrl = await A(() => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 100;
  const x = c.getContext('2d'); x.strokeStyle = '#111'; x.lineWidth = 8; x.lineCap = 'round';
  x.beginPath(); x.moveTo(10, 80); x.bezierCurveTo(80, -20, 150, 140, 290, 20); x.stroke();
  return c.toDataURL('image/png');
});

const anchor = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  const o = await a.placeSignatureAt('br', false, url);
  const pg = a.pages[0];
  return { n: a.objects.length, sig: !!o.sig, right: o.x + o.w, bottom: o.y + o.h, pw: pg.vp1.width, ph: pg.vp1.height, h: o.h };
}, sigUrl);
check('Đặt nhanh chữ ký vào góc dưới phải',
  anchor.n === 1 && anchor.sig && Math.abs(anchor.right - (anchor.pw - 28)) < 0.01 && Math.abs(anchor.bottom - (anchor.ph - 28)) < 0.01,
  `mép phải ${anchor.right.toFixed(1)}/${(anchor.pw - 28).toFixed(1)} · mép dưới ${anchor.bottom.toFixed(1)}/${(anchor.ph - 28).toFixed(1)}`);
check('Chữ ký không cao quá 70 điểm', anchor.h <= 70.001, `h=${anchor.h.toFixed(1)}`);

const allPages = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  await a.placeSignatureAt('bc', true, url);
  return { n: a.objects.length, pages: a.pages.length, on: a.objects.map(o => o.page) };
}, sigUrl);
check('Đặt lên tất cả các trang', allPages.n === allPages.pages && new Set(allPages.on).size === allPages.pages,
  `${allPages.n}/${allPages.pages} trang · ${JSON.stringify(allPages.on)}`);

const skipDeleted = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  a.pages[1].deleted = true;
  await a.placeSignatureAt('br', true, url);
  const r = { n: a.objects.length, on: a.objects.map(o => o.page) };
  a.pages[1].deleted = false;
  return r;
}, sigUrl);
check('Bỏ qua trang đã bị xoá khi đặt lên tất cả', skipDeleted.n === 1 && skipDeleted.on[0] === 0, JSON.stringify(skipDeleted));

const midAnchor = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  const o = await a.placeSignatureAt('bl', false, url);
  return { left: o.x, centerX: o.x + o.w / 2, pw: a.pages[0].vp1.width };
}, sigUrl);
check('Góc dưới trái cách mép 28 điểm', Math.abs(midAnchor.left - 28) < 0.01, `x=${midAnchor.left.toFixed(1)}`);

check('Không có lỗi JS trong suốt quá trình', errors.length === 0, errors.slice(0, 2).join(' | '));

await w.screenshot({ path: path.join(OUT, 'editing-ui.png') }).catch(() => {});
await closeApp(app);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
