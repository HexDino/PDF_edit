// Test bản web một file (web/index.html): kiểm tra phần tẩy/xoá vừa được port.
//   - đọc dòng chữ từ PDF, bám dòng khi kéo khung
//   - vẽ khung che / cọ xoá / khoanh vùng
//   - lưu PDF với tuỳ chọn "xoá hẳn" (có hộp thoại chất lượng)
//
// Chạy: node test/web-erase.mjs   (trong app/)
// Lưu ý: bản web tải pdf.js / pdf-lib / fontkit từ CDN nên cần Internet.
import { _electron as electron } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv, closeApp } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });
const WEB_DIR = path.resolve(APP_ROOT, '..', 'web');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* ---------- Máy chủ tĩnh phục vụ web/ (để ES module + CDN hoạt động đúng) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const p = path.join(WEB_DIR, rel === '/' ? 'index.html' : rel);
  if (!p.startsWith(WEB_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const WEB_URL = `http://127.0.0.1:${server.address().port}/index.html`;
console.log(`Phục vụ ${WEB_DIR} tại ${WEB_URL}\n`);

/* ---------- Electron tối giản mở trang web ---------- */
const MAIN = path.join(OUT, 'web-main.cjs');
fs.writeFileSync(MAIN, `
const { app, BrowserWindow } = require('electron');
const os = require('os'), path = require('path');
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1400, height: 950, show: true, webPreferences: { contextIsolation: false } });
  // tự lưu file tải về, tránh hộp thoại lưu chặn tiến trình test
  w.webContents.session.on('will-download', (e, item) => { item.setSavePath(path.join(os.tmpdir(), item.getFilename())); });
  w.loadURL(process.env.WEB_URL);
});
app.on('window-all-closed', () => app.quit());
`);

const app = await electron.launch({
  executablePath: electronBin,
  args: [MAIN, '--no-sandbox'],
  env: { ...electronEnv, WEB_URL },
});
const w = await app.firstWindow();
const errors = [];
w.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
w.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
const A = (fn, arg) => w.evaluate(fn, arg);

await w.waitForFunction(() => !!window.__editor, null, { timeout: 90000 });
check('Bản web tải được (CDN pdf.js/pdf-lib/fontkit)', true);

/* ---------- Nạp PDF mẫu ---------- */
await A(async (b64) => {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  await window.__editor.loadPdf(u, 'text-doc.pdf');
}, fs.readFileSync(testFile('text-doc.pdf')).toString('base64'));
await w.waitForFunction(() => window.__editor.pages.length > 0 && window.__editor.pages.every(p => p.rendered > 0), null, { timeout: 60000 });
await w.waitForTimeout(300);

/* ---------- Bám dòng chữ ---------- */
const lines = await A(async () => (await window.__editor.pageLines(window.__editor.pages[0])).map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h, text: l.text })));
check('Bản web: đọc được dòng chữ từ PDF', lines.length >= 2, `${lines.length} dòng`);
console.log('   dòng đầu:', JSON.stringify(lines[0] || null));

const snap = await A((ls) => {
  const l = ls.find(x => x.w > 60) || ls[0];
  const r = { x: l.x + l.w * 0.3, y: l.y + l.h * 0.35, w: l.w * 0.25, h: l.h * 0.3 };
  return { raw: r, snap: window.__editor.snapRectToLines(ls, r), line: l };
}, lines);
check('Bản web: snap nới khung cho đủ dòng chữ',
  snap.snap.h > snap.raw.h * 1.6 && snap.snap.y <= snap.line.y + 1,
  `cao ${snap.raw.h.toFixed(1)} → ${snap.snap.h.toFixed(1)} điểm`);

/* ---------- Vẽ bằng chuột: khung, cọ, khoanh ---------- */
// Lưu ý: bật chế độ xoá làm thanh tuỳ chọn hiện ra -> layout dịch xuống,
// nên phải đọc lại toạ độ layer NGAY TRƯỚC mỗi lần kéo, không cache từ trước.
const layerRect = () => A(() => { const b = window.__editor.pages[0].layer.getBoundingClientRect(); return { l: b.left, t: b.top, z: window.__editor.zoom }; });
async function dragOnPage(pts) {
  const r = await layerRect();
  const at = (x, y) => [r.l + x * r.z, r.t + y * r.z];
  await w.mouse.move(...at(...pts[0])); await w.mouse.down();
  for (const p of pts.slice(1)) await w.mouse.move(...at(...p));
  await w.mouse.up();
  await w.waitForTimeout(300);
}

await A(() => { window.__editor.setMode('erase'); window.__editor.cur.eraseShape = 'rect'; });
await dragOnPage([[140, 45], [430, 85]]);
const m1 = await A(() => window.__editor.masks.map(m => ({ kind: m.kind, x: m.x, y: m.y, w: m.w, h: m.h, color: m.color, fillMode: m.fillMode })));
check('Bản web: kéo khung tạo vùng che', m1.length === 1 && m1[0].kind === 'rect', JSON.stringify(m1[0] || null));
check('Bản web: khung tự bám dòng chữ khi kéo', !!m1[0] && m1[0].h > 20, `cao ${m1[0] ? m1[0].h.toFixed(1) : 0} điểm`);

await A(() => { window.__editor.cur.eraseShape = 'brush'; });
await dragOnPage([[120, 200], [140, 207], [160, 200], [180, 207], [200, 200], [220, 207], [240, 200], [260, 207], [280, 200], [300, 207]]);
const m2 = await A(() => window.__editor.masks.filter(m => m.kind === 'brush').map(m => ({ pts: m.pts.length, width: m.width })));
check('Bản web: cọ xoá tạo vùng che theo nét', m2.length === 1 && m2[0].pts > 3, JSON.stringify(m2[0] || null));

await A(() => { window.__editor.cur.eraseShape = 'lasso'; });
await dragOnPage([[120, 300], [280, 300], [300, 350], [180, 370], [120, 340]]);
const m3 = await A(() => window.__editor.masks.filter(m => m.kind === 'lasso').map(m => ({ pts: m.pts.length })));
check('Bản web: khoanh vùng tạo vùng che', m3.length === 1 && m3[0].pts >= 3, JSON.stringify(m3[0] || null));

check('Bản web: không có lỗi JS khi vẽ', errors.length === 0, errors.slice(0, 2).join(' | '));

/* ---------- Heuristic định dạng ảnh ---------- */
const autoColor = await A(() => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 200;
  const x = c.getContext('2d');
  for (let i = 0; i < 300; i += 20) for (let j = 0; j < 200; j += 20) { x.fillStyle = `hsl(${(i * 7 + j * 13) % 360} 85% 55%)`; x.fillRect(i, j, 20, 20); }
  return window.__editor.pickAutoFormat(c);
});
check('Bản web: ảnh nhiều màu chọn JPEG', autoColor === 'jpeg', `chọn: ${autoColor}`);

/* ---------- Lưu PDF có xoá hẳn ---------- */
await A(() => { window.__editor.cur.trueRemove = true; window.__editor.cur.flattenFormat = 'jpeg'; window.__editor.cur.flattenDpi = 150; });
w.evaluate(() => { window.__editor.savePdf(); }).catch(() => {});
await w.waitForSelector('#saveModal:not([hidden])', { timeout: 20000 });
check('Bản web: mở hộp thoại lưu với tuỳ chọn chất lượng', true);
await w.click('#saveGo');
await w.waitForFunction(() => /Đã lưu|Lỗi/.test(document.getElementById('toast').textContent), null, { timeout: 120000 });
const toastTxt = (await w.textContent('#toast')).trim();
check('Bản web: lưu PDF thành công (có xoá hẳn)', /^Đã lưu/.test(toastTxt), toastTxt.slice(0, 140));

await w.screenshot({ path: path.join(OUT, 'web-erase-ui.png') }).catch(() => {});
check('Bản web: không có lỗi JS sau khi lưu', errors.length === 0, errors.slice(0, 2).join(' | '));

await closeApp(app);
server.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
