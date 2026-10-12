// Test "phiên chỉnh sửa" (.tsp.json nằm cạnh PDF gốc):
//   - lưu phiên: ghi đủ đối tượng, trạng thái xoá trang và ảnh chữ ký
//   - mở lại file gốc thì tự khôi phục, ảnh hiện lại được
//   - lưu PDF thì tự ghi kèm phiên
//   - phiên của tài liệu khác (khác số trang) thì bị bỏ qua, không dán nhầm
//   - xoá phiên
//
// Chạy: node test/session.mjs   (trong app/)
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

const WORK = path.join(OUT, 'session-test.pdf');
const SIDE = WORK.replace(/\.pdf$/i, '') + '.tsp.json';
fs.copyFileSync(testFile('text-doc.pdf'), WORK);
for (const f of [SIDE, path.join(OUT, 'session-out.pdf')]) if (fs.existsSync(f)) fs.unlinkSync(f);

const launch = async () => {
  const app = await electron.launch({ executablePath: electronBin, args: [APP_ROOT, '--no-sandbox', WORK], env: electronEnv });
  const w = await app.firstWindow();
  await w.waitForFunction(() => window.__app && window.__app.pages.length > 0 && window.__app.pages.every(p => p.rendered > 0), null, { timeout: 60000 });
  await w.waitForTimeout(400);
  return { app, w };
};
const sigPng = () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 100;
  const x = c.getContext('2d'); x.strokeStyle = '#111'; x.lineWidth = 8; x.lineCap = 'round';
  x.beginPath(); x.moveTo(10, 80); x.bezierCurveTo(80, -20, 150, 140, 290, 20); x.stroke();
  return c.toDataURL('image/png');
};

/* ---------- Lần 1: tạo chỉnh sửa rồi lưu phiên ---------- */
{
  const { app, w } = await launch();
  const A = (fn, arg) => w.evaluate(fn, arg);
  const url = await A(sigPng);
  await A(async (u) => {
    const a = window.__app;
    a.pushHistory();
    a.createObj({ type: 'text', page: 0, x: 90, y: 430, size: 16, color: '#c81e1e', font: 'PatrickHand', text: 'Đã kiểm tra', slant: 0, jitter: false });
    a.createObj({ type: 'rect', page: 0, x: 150, y: 196, w: 190, h: 18, color: '#f7f5eb', fillMode: 'solid', feather: false });
    await a.placeSignatureAt('br', false, u);
    a.pages[1].deleted = true;
  }, url);

  const n = await A(() => window.__app.objects.length);
  check('Chuẩn bị: 3 đối tượng + 1 trang bị xoá', n === 3, `${n} đối tượng`);

  await A(() => window.__app.saveSession(false));
  await w.waitForTimeout(300);
  check('Ghi được file phiên cạnh PDF gốc', fs.existsSync(SIDE), path.basename(SIDE));

  const s = JSON.parse(fs.readFileSync(SIDE, 'utf8'));
  check('Phiên chứa đủ đối tượng', s.objects.length === 3, `${s.objects.length} đối tượng: ${s.objects.map(o => o.type).join(',')}`);
  check('Phiên ghi nhận trang bị xoá', s.deleted[1] === true && s.deleted[0] === false, JSON.stringify(s.deleted));
  check('Phiên lưu kèm ảnh chữ ký', Object.keys(s.imgs || {}).length === 1, `${Object.keys(s.imgs || {}).length} ảnh`);
  check('Phiên ghi thông tin file gốc để chống dán nhầm', s.pdf && s.pdf.pages === 2 && s.pdf.size > 0, JSON.stringify(s.pdf));

  await closeApp(app);
}

/* ---------- Lần 2: mở lại -> tự khôi phục ---------- */
{
  const { app, w } = await launch();
  const A = (fn, arg) => w.evaluate(fn, arg);
  await w.waitForFunction(() => window.__app.objects.length > 0, null, { timeout: 15000 }).catch(() => {});
  const r = await A(() => ({
    n: window.__app.objects.length,
    types: window.__app.objects.map(o => o.type).sort(),
    del: window.__app.pages.map(p => p.deleted),
    text: (window.__app.objects.find(o => o.type === 'text') || {}).text,
    tag: document.getElementById('sessionTag').textContent,
  }));
  check('Mở lại file gốc thì tự khôi phục chỉnh sửa', r.n === 3 && r.del[1] === true, JSON.stringify(r.types) + ' · deleted=' + JSON.stringify(r.del));
  check('Chữ đã thêm được khôi phục đúng nội dung', r.text === 'Đã kiểm tra', JSON.stringify(r.text));
  check('Trạng thái hiện nhãn phiên', /phiên/.test(r.tag), r.tag);

  const imgOk = await A(() => {
    const o = window.__app.objects.find(x => x.type === 'img');
    const im = o && o.el.querySelector('img');
    return !!(im && /^data:image\/png/.test(im.getAttribute('src') || ''));
  });
  check('Ảnh chữ ký khôi phục và hiển thị lại được', imgOk === true);

  /* ---------- Lưu PDF thì tự ghi kèm phiên ---------- */
  const outPdf = path.join(OUT, 'session-out.pdf');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, outPdf);
  await A(() => { window.__app.doSave(false, false); });
  await w.waitForFunction(() => /Đã lưu|Lỗi/.test(document.getElementById('toast').textContent), null, { timeout: 90000 });
  const saved = fs.existsSync(outPdf);
  const s2 = JSON.parse(fs.readFileSync(SIDE, 'utf8'));
  check('Lưu PDF thì ghi kèm phiên mới', saved && s2.objects.length === 3 && new Date(s2.savedAt) > new Date(0), `${Math.round(fs.statSync(outPdf).size / 1024)} KB · ${s2.objects.length} đối tượng`);

  /* ---------- Xoá phiên ---------- */
  await A(() => { window.confirm = () => true; });
  await A(() => window.__app.clearSession());
  await w.waitForTimeout(300);
  check('Xoá phiên thì file .tsp.json biến mất', !fs.existsSync(SIDE));
  check('Đối tượng trên trang vẫn giữ nguyên sau khi xoá phiên', (await A(() => window.__app.objects.length)) === 3);

  await closeApp(app);
}

/* ---------- Lần 3: phiên không khớp thì bị bỏ qua ---------- */
{
  fs.writeFileSync(SIDE, JSON.stringify({
    app: 'TrinhSuaPDF', version: 1, savedAt: new Date().toISOString(),
    pdf: { name: 'khac.pdf', size: fs.statSync(WORK).size, pages: 99 },
    deleted: [false, false], imgs: {},
    objects: [{ id: 1, type: 'text', page: 0, x: 10, y: 10, size: 12, color: '#111111', font: 'PatrickHand', text: 'zzz', slant: 0, jitter: false, seed: 1 }],
  }));
  const { app, w } = await launch();
  await w.waitForTimeout(900);
  const n = await w.evaluate(() => window.__app.objects.length);
  check('Phiên không khớp số trang thì bị bỏ qua (không dán nhầm)', n === 0, `${n} đối tượng`);
  await closeApp(app);
}

fs.unlinkSync(WORK);
if (fs.existsSync(SIDE)) fs.unlinkSync(SIDE);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
