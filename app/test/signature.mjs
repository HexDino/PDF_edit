// Test riêng cho phần chữ ký: khoá các lỗi đã sửa để không tái phát.
//
// Chạy: node test/signature.mjs   (trong app/)
//
// Phủ các lỗi:
//   S1  chữ ký cũ còn sót trên pad sau khi đặt
//   S2  "Đổi màu nét" biến ảnh JPG thành khối màu đặc
//   S3  thư viện bị nhân bản khi đặt cùng một chữ ký nhiều lần
//   S4  trạng thái hộp thoại không được reset khi mở lại
//   S5  cắt sát cố định làm cụt nét chữ ký mảnh
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, sigLibDir, electronEnv, closeApp } from './_paths.mjs';

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
const objs = () => A(() => window.__app.objects.map(o => ({ type: o.type, sig: !!o.sig, w: o.w, h: o.h, x: o.x, y: o.y })));
const libCount = () => A(async () => (await window.__app.libApi.list()).length);
/** Việc lưu thư viện chạy nền (không chặn đóng hộp thoại) nên phải chờ số lượng đổi. */
async function waitLib(prev, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const n = await libCount();
    if (n !== prev || Date.now() - t0 > ms) return n;
    await w.waitForTimeout(120);
  }
}
const keepPad = v => A(on => { document.getElementById('keepPad').checked = on; }, v);

let pageRect = null;
async function placeOnPage() {
  if (!pageRect) pageRect = await A(() => { const r = window.__app.pages[0].layer.getBoundingClientRect(); return { l: r.left, t: r.top, z: window.__app.zoom }; });
  await w.mouse.click(pageRect.l + 300 * pageRect.z, pageRect.t + 500 * pageRect.z);
  await w.waitForTimeout(250);
}
async function drawOnPad() {
  await w.click('#sigBtn');
  await w.waitForSelector('#sigModal:not([hidden])');
  await w.waitForTimeout(250);
  const pb = await (await w.$('#pad')).boundingBox();
  const pts = [];
  for (let i = 0; i <= 60; i++) { const u = i / 60; pts.push([pb.x + 50 + u * 400, pb.y + 130 - 45 * Math.sin(u * 9) * Math.exp(-u) + 16 * Math.sin(u * 25)]); }
  await w.mouse.move(...pts[0]); await w.mouse.down();
  for (const p of pts) await w.mouse.move(p[0], p[1], { steps: 2 });
  await w.mouse.up();
  await w.waitForTimeout(150);
}

const libBefore = await libCount();

/* ---------- S1: pad phải được xoá sau khi đặt (mặc định không giữ nét) ---------- */
await drawOnPad();
const strokesBefore = await A(() => window.__app.pad.strokes.length);
check('Vẽ được nét trên pad', strokesBefore > 0, `${strokesBefore} nét`);

await w.click('#sigUse');
await w.waitForTimeout(200);
await placeOnPage();

const placed = (await objs()).filter(o => o.type === 'img' && o.sig);
check('Đặt được chữ ký lên trang', placed.length === 1, JSON.stringify(placed[0] || null));
const strokesAfter = await A(() => window.__app.pad.strokes.length);
check('S1: pad được xoá sau khi đặt', strokesAfter === 0, `còn ${strokesAfter} nét`);

const libAfter1 = await waitLib(libBefore);
check('Thư viện tăng đúng 1 bản sau lần đặt đầu', libAfter1 - libBefore === 1, `${libBefore} → ${libAfter1}`);

/* ---------- S4: mở lại hộp thoại phải reset trạng thái ---------- */
const pre = await A(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 80;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 80);
  x.strokeStyle = '#111'; x.lineWidth = 6; x.beginPath(); x.moveTo(10, 60); x.quadraticCurveTo(100, -10, 190, 50); x.stroke();
  window.__app.setSigSrcImg(await window.__app.loadImage(c.toDataURL('image/png')));
  window.__app.setSigTab('image'); window.__app.processSigImage();
  window.__app.setLibSel((await window.__app.libApi.list())[0] || null);
  return { sigOut: !!window.__app.sigOut, libSel: !!window.__app.libSel };
});
await A(() => window.__app.openSig());
const post = await A(() => ({ sigOut: window.__app.sigOut, libSel: window.__app.libSel }));
check('S4: mở lại hộp thoại reset libSel/sigOut',
  pre.sigOut && pre.libSel && post.sigOut === null && post.libSel === null,
  `trước: sigOut=${pre.sigOut} libSel=${pre.libSel} · sau: sigOut=${post.sigOut} libSel=${post.libSel}`);
await A(() => { document.getElementById('sigModal').hidden = true; });

/* ---------- S3: đặt LẠI đúng chữ ký đó -> không thêm bản trùng ---------- */
await keepPad(true);
await drawOnPad();
const sigA = await A(() => window.__app.padSignature());
await w.click('#sigUse'); await w.waitForTimeout(200);
await placeOnPage();
const libAfter2 = await waitLib(libAfter1);
check('S3: đặt lần đầu với nét mới -> +1', libAfter2 - libAfter1 === 1, `${libAfter1} → ${libAfter2}`);

// Mở lại hộp thoại (không vẽ thêm): ảnh chữ ký xuất ra phải y hệt lần trước
await w.click('#sigBtn'); await w.waitForTimeout(300);
const sigB = await A(() => window.__app.padSignature());
check('Nét vẽ xuất ra nhất quán sau khi mở lại hộp thoại', !!sigA && sigA === sigB,
  `dài ${sigA ? sigA.length : 0} vs ${sigB ? sigB.length : 0} ký tự`);

await w.click('#sigUse'); await w.waitForTimeout(200);
await placeOnPage();
await w.waitForTimeout(2000);   // đợi việc lưu nền kết luận là trùng hay không
const libAfter3 = await libCount();
check('S3: chữ ký trùng không thêm vào thư viện', libAfter3 === libAfter2, `${libAfter2} → ${libAfter3}`);
await keepPad(false);

/* ---------- S2: "Đổi màu nét" trên ảnh JPG không được thành khối đặc ---------- */
const recolorRes = await A(async () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 120;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 120);
  x.strokeStyle = '#111'; x.lineWidth = 9; x.lineCap = 'round';
  x.beginPath(); x.moveTo(20, 90); x.bezierCurveTo(80, 10, 190, 130, 280, 30); x.stroke();
  const jpg = c.toDataURL('image/jpeg', 0.92);            // JPEG: không có alpha
  const out = await window.__app.recolor(jpg, '#c81e1e');
  const im = await window.__app.loadImage(out);
  const cc = document.createElement('canvas'); cc.width = im.naturalWidth; cc.height = im.naturalHeight;
  const cx = cc.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, cc.width, cc.height).data;
  let transparent = 0, opaque = 0, redish = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 20) transparent++;
    else if (d[i + 3] > 200) { opaque++; if (d[i] > 150 && d[i + 1] < 90) redish++; }
  }
  const n = d.length / 4;
  return { transparent: transparent / n, opaque: opaque / n, redish: opaque ? redish / opaque : 0, isPng: /^data:image\/png/.test(out) };
});
check('S2: recolor JPG giữ được nét (có vùng trong suốt)',
  recolorRes.transparent > 0.4 && recolorRes.opaque > 0.01 && recolorRes.isPng,
  `trong suốt ${(recolorRes.transparent * 100).toFixed(1)}% · đặc ${(recolorRes.opaque * 100).toFixed(1)}%`);
check('S2: nét đổi đúng sang màu chọn', recolorRes.redish > 0.6, `${(recolorRes.redish * 100).toFixed(1)}% pixel đặc là màu đỏ`);

/* ---------- S5: ngưỡng cắt sát phải theo tỉ lệ ảnh ---------- */
const cropRes = await A(() => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 300;
  const x = c.getContext('2d'); x.clearRect(0, 0, 800, 300);
  x.strokeStyle = 'rgba(10,10,10,0.12)'; x.lineWidth = 3;   // nét rất mảnh, alpha thấp
  x.beginPath(); x.moveTo(60, 200); x.quadraticCurveTo(400, 60, 740, 210); x.stroke();
  const t = window.__app.trimCanvas(c, 12, Math.round(800 * 0.012));
  return { trimmed: !!t, w: t ? t.width : 0, h: t ? t.height : 0 };
});
check('S5: cắt sát giữ được nét mảnh (alpha thấp)',
  cropRes.trimmed && cropRes.w > 600 && cropRes.w < 800 && cropRes.h < 300,
  `${cropRes.w}×${cropRes.h} (ảnh gốc 800×300)`);

/* ---------- Xuất PDF vẫn chạy ---------- */
const built = await A(async () => { const r = await window.__app.buildPdf(true); return r.bytes.length; });
check('Xuất được PDF có chữ ký', built > 1000, `${built} byte`);

/* ---------- Đếm file thư viện trên đĩa ---------- */
try {
  const dir = sigLibDir();
  if (fs.existsSync(dir)) console.log(`Thư viện trên đĩa: ${fs.readdirSync(dir).filter(f => f.endsWith('.png')).length} file · ${dir}`);
} catch { /* không quan trọng */ }

await closeApp(app);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
