import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { APP_ROOT, OUT, electronBin, electronEnv, closeApp } from './_paths.mjs';

const require = createRequire(import.meta.url);
const { runProcess } = require('../suite/util/spawn.js');
const { binaryPath } = require('../suite/util/paths.js');
const qpdf = (args, opts = {}) =>
  runProcess(binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }), args, opts);

const OUT_LABEL_DEFAULT = 'Cùng thư mục file gốc';
const screenshotPath = path.join(OUT, 'suite-home.png');
const cardIds = w => w.$$eval('#toolGrid .card', els => els.map(el => el.dataset.toolId));

fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox'],
  env: { ...electronEnv, TSP_SUITE: '1' },
});

try {
  const w = await app.firstWindow();
  await w.setViewportSize({ width: 1500, height: 1100 }).catch(() => {});
  await w.waitForFunction(
    () => window.__suite?.tools().length === 14
      && document.querySelectorAll('#toolGrid .card').length === 14,
    null,
    { timeout: 30000 },
  );

  // 1. Trang chủ render đủ 14 thẻ, đúng trạng thái.
  assert.equal(await w.locator('#toolGrid .card').count(), 14);
  assert.equal(await w.locator('#toolGrid .card:not([disabled])').count(), 3);
  assert.equal(await w.locator('#toolGrid .card[disabled]').count(), 11);
  assert.equal(await w.locator('#toolGrid .card .st').count(), 11);
  assert.equal(await w.locator('#toolGrid .groupTitle').count(), 5);
  assert.deepEqual(
    await w.$$eval('#toolGrid .card:not([disabled])', els => els.map(el => el.dataset.toolId)),
    ['merge', 'pdf-images', 'protect'],
  );
  console.log('home: 14 thẻ · 3 bật (merge, pdf-images, protect) · 11 tắt · 11 nhãn “Sắp có” · 5 nhóm');

  // 2. Tìm kiếm theo title + description.
  await w.fill('#toolSearch', 'ghép');
  await w.waitForFunction(() => document.querySelectorAll('#toolGrid .card').length === 2);
  assert.deepEqual(await cardIds(w), ['merge', 'images-pdf']);
  assert.equal(await w.locator('#toolGrid .card .st').count(), 1);
  assert.equal(await w.locator('#noResults').isVisible(), false);
  console.log('search “ghép”: 2 thẻ (merge, images-pdf)');

  await w.fill('#toolSearch', '');
  await w.waitForFunction(() => document.querySelectorAll('#toolGrid .card').length === 14);
  assert.equal(await w.locator('#toolGrid .card').count(), 14);

  await w.fill('#toolSearch', 'zzz');
  await w.waitForFunction(() => document.querySelectorAll('#toolGrid .card').length === 0);
  assert.equal(await w.locator('#toolGrid .card').count(), 0);
  assert.equal(await w.locator('#noResults').isVisible(), true);
  assert.equal((await w.locator('#noResults').textContent()).trim(), 'Không tìm thấy công cụ nào.');
  console.log('search “zzz”: 0 thẻ · hiện #noResults');

  await w.fill('#toolSearch', '');
  await w.waitForFunction(() => document.querySelectorAll('#toolGrid .card').length === 14);
  assert.equal(await w.locator('#noResults').isVisible(), false);

  // 3. Ảnh chụp trang chủ đủ nhóm và có dữ liệu.
  await w.screenshot({ path: screenshotPath });
  const shot = fs.statSync(screenshotPath);
  assert.ok(shot.isFile() && shot.size > 0, 'suite-home.png phải tồn tại và không rỗng');
  console.log('screenshot:', path.relative(APP_ROOT, screenshotPath), `${shot.size} bytes`);

  // 4. Mở Ghép PDF bằng thẻ; tool view thay home, nhãn thư mục xuất mặc định.
  await w.click('#toolGrid .card[data-tool-id="merge"]');
  await w.waitForFunction(
    () => location.hash === '#/tool/merge' && !document.getElementById('toolView').hidden,
  );
  assert.equal(await w.locator('#toolView').isVisible(), true);
  assert.equal(await w.locator('#homeView').isVisible(), false);
  assert.equal(await w.locator('#toolTitle').textContent(), 'Ghép PDF');
  assert.equal(await w.locator('#outLabel').textContent(), OUT_LABEL_DEFAULT);

  // 5. Giả lập UI job cũ rồi rời tool bằng rail “Trang chủ”: phải reset sạch.
  await w.evaluate(() => {
    window.__suite.state.jobId = 'job-cu';
    window.__suite.state.running = true;
    document.getElementById('progress').hidden = false;
    document.getElementById('cancelBtn').hidden = false;
    document.getElementById('progressText').textContent = 'Tiến trình cũ';
  });
  assert.equal(await w.locator('#progress').isVisible(), true);

  await w.locator('#nav .navItem', { hasText: 'Trang chủ' }).click();
  await w.waitForFunction(() => location.hash === '' && !document.getElementById('homeView').hidden);
  assert.equal(await w.locator('#toolView').isVisible(), false);
  assert.equal(await w.locator('#homeView').isVisible(), true);
  assert.equal(await w.locator('#nav .navItem.on').textContent(), 'Trang chủ');
  assert.equal(await w.evaluate(() => window.__suite.state.jobId), null);
  assert.equal(await w.evaluate(() => window.__suite.state.running), false);
  assert.deepEqual(
    await w.evaluate(() => ({
      progressHidden: document.getElementById('progress').hidden,
      cancelHidden: document.getElementById('cancelBtn').hidden,
      text: document.getElementById('progressText').textContent,
      value: document.getElementById('progressBar').value,
      max: document.getElementById('progressBar').max,
    })),
    { progressHidden: true, cancelHidden: true, text: '', value: 0, max: 1 },
  );
  console.log('rail “Trang chủ”: rời tool view · reset job UI');

  // 6. Nhãn thư mục xuất reset khi về home và khi mở lại tool.
  await w.click('#toolGrid .card[data-tool-id="merge"]');
  await w.waitForFunction(() => location.hash === '#/tool/merge');
  await w.evaluate(() => window.__suite.setOutputDir('D:\\đầu ra giả'));
  assert.equal(await w.locator('#outLabel').textContent(), 'D:\\đầu ra giả');
  assert.equal(await w.evaluate(() => window.__suite.state.outputDir), 'D:\\đầu ra giả');

  await w.click('#backBtn');
  await w.waitForFunction(() => location.hash === '' && !document.getElementById('homeView').hidden);
  assert.equal(await w.locator('#outLabel').textContent(), OUT_LABEL_DEFAULT);
  assert.equal(await w.evaluate(() => window.__suite.state.outputDir), null);

  await w.click('#toolGrid .card[data-tool-id="merge"]');
  await w.waitForFunction(() => location.hash === '#/tool/merge');
  assert.equal(await w.locator('#outLabel').textContent(), OUT_LABEL_DEFAULT);
  console.log('outLabel: reset khi về home và mở lại tool');

  // 7. Bấm nhóm trên rail từ tool view: về home, lọc đúng, highlight khớp.
  await w.locator('#nav .navItem', { hasText: 'Bảo mật' }).click();
  await w.waitForFunction(() => location.hash === '' && !document.getElementById('homeView').hidden);
  assert.equal(await w.locator('#toolView').isVisible(), false);
  assert.equal(await w.locator('#toolGrid .card').count(), 3);
  assert.equal(await w.locator('#toolGrid .card:not([disabled])').count(), 1);
  assert.deepEqual(await cardIds(w), ['protect', 'unlock', 'metadata']);
  assert.equal(await w.locator('#toolGrid .groupTitle').textContent(), 'Bảo mật');
  assert.equal(await w.locator('#nav .navItem.on').count(), 1);
  assert.equal(await w.locator('#nav .navItem.on').textContent(), 'Bảo mật');
  console.log('rail “Bảo mật” từ tool view: về home · 3 thẻ · highlight khớp');

  await w.locator('#nav .navItem', { hasText: 'Trang chủ' }).click();
  await w.waitForFunction(() => document.querySelectorAll('#toolGrid .card').length === 14);
  assert.equal(await w.locator('#nav .navItem.on').textContent(), 'Trang chủ');
  assert.equal(await w.locator('#toolGrid .groupTitle').count(), 5);

  // 8. Hash công cụ “Sắp có”/không tồn tại được xoá sạch, không kẹt tool view.
  await w.evaluate(() => { location.hash = '#/tool/split'; });
  await w.waitForFunction(
    () => location.hash === '' && document.getElementById('toast').textContent.includes('đợt sau'),
  );
  assert.equal(await w.locator('#toolView').isVisible(), false);
  assert.equal(await w.evaluate(() => window.__suite.state.tool), null);
  console.log('hash tool “Sắp có”: về home, xoá hash');

  await w.evaluate(() => { location.hash = '#/tool/khong-ton-tai'; });
  await w.waitForFunction(() => location.hash === '');
  assert.equal(await w.locator('#homeView').isVisible(), true);
  assert.equal(await w.locator('#toolView').isVisible(), false);
  console.log('hash không tồn tại: về home, xoá hash');

  // 9. Editor vẫn mở như trước.
  await w.click('#editBtn');
  await w.waitForFunction(() => !!window.__app, null, { timeout: 30000 });
  console.log('editor mở được');

  // Quay về home sau khi test editor ở Task 6
  await w.click('#homeBtn');
  await w.waitForFunction(() => window.__suite?.tools().length === 14, null, { timeout: 30000 });

  const a = path.join(OUT, 'm1a-a.pdf'), b = path.join(OUT, 'm1a-b.pdf'), outDir = path.join(OUT, 'm1a-out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const { PDFDocument } = require('pdf-lib');
  async function make(file, n) {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([100 + i, 200]);
    fs.writeFileSync(file, await d.save());
  }
  await make(a, 2); await make(b, 3);

  await w.evaluate(() => window.__suite.openTool('merge'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'merge');
  // E2E dùng đường dẫn trực tiếp (không qua hộp thoại) nên phải đăng ký trước.
  await w.evaluate(({ files, out }) => window.__suite.registerInput([...files, out]), { files: [a, b], out: outDir });
  await w.evaluate(({ files, out }) => {
    window.__suite.addFiles(files); window.__suite.setOutputDir(out);
  }, { files: [a, b], out: outDir });
  await w.click('#runBtn');
  const res = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('merge result:', JSON.stringify(res));
  if (!res?.outputs?.length) throw new Error('Merge không tạo output');
  const outFile = res.outputs[0].path;
  assert.equal(path.basename(outFile), 'm1a-a-ghep.pdf');
  assert.equal(path.dirname(path.resolve(outFile)), path.resolve(outDir));
  const merged = await PDFDocument.load(fs.readFileSync(outFile));
  if (merged.getPageCount() !== 5) throw new Error('Sai số trang: ' + merged.getPageCount());
  console.log('merge ok:', outFile);

  // Đường dẫn chưa đăng ký bị từ chối, không lộ đường dẫn tuyệt đối ra UI.
  const unregistered = path.join(APP_ROOT, 'test', 'text-doc.pdf');
  const rejected = await w.evaluate(async p => ({
    job: await window.api.suite.jobStart({ toolId: 'merge', files: [p], options: {}, outputDir: null }),
    reveal: await window.api.suite.reveal(p),
  }), unregistered);
  assert.equal(rejected.job.ok, false);
  assert.equal(rejected.job.error.code, 'FORBIDDEN');
  assert.equal(rejected.job.error.message.includes(unregistered), false);
  assert.equal(rejected.reveal, false);
  console.log('allowlist: từ chối file chưa đăng ký · không lộ đường dẫn');

  // 10. PDF → ảnh: worker pdf.js thật render 2 trang thành PNG trong thư mục -anh.
  const imgSrc = path.join(OUT, 'm1b-2pages.pdf');
  const imgOut = path.join(OUT, 'm1b-img-out');
  fs.rmSync(imgOut, { recursive: true, force: true });
  fs.mkdirSync(imgOut, { recursive: true });
  await make(imgSrc, 2);
  await w.evaluate(() => window.__suite.openTool('pdf-images'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'pdf-images');
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: imgSrc, out: imgOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ pages: '', dpi: 72, format: 'png', quality: 90 });
  }, { file: imgSrc, out: imgOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const imgRes = await w.evaluate(() => window.__suite.waitJob(60000));
  console.log('pdf-images result:', JSON.stringify(imgRes));
  if (!imgRes?.outputs?.length) throw new Error('PDF → ảnh không tạo output: ' + JSON.stringify(imgRes));
  assert.equal(imgRes.outputs.length, 2);
  const imgNames = imgRes.outputs.map(o => path.basename(o.path));
  assert.deepEqual(imgNames, ['m1b-2pages-01.png', 'm1b-2pages-02.png']);
  const imgFolder = path.dirname(imgRes.outputs[0].path);
  assert.equal(path.basename(imgFolder), 'm1b-2pages-anh');
  for (const o of imgRes.outputs) {
    const bytes = fs.readFileSync(o.path);
    assert.ok(bytes.length > 0, `${path.basename(o.path)} phải có dữ liệu`);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic');
  }
  console.log('pdf-images ok:', imgFolder, imgNames.join(', '));

  // 11. Khoá PDF: qpdf thật mã hoá AES-256; mật khẩu đúng mở được, sai bị từ chối.
  const protectOut = path.join(OUT, 'm1b-protect-out');
  fs.rmSync(protectOut, { recursive: true, force: true });
  fs.mkdirSync(protectOut, { recursive: true });
  await w.evaluate(() => window.__suite.openTool('protect'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'protect');
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: imgSrc, out: protectOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ openPassword: 'secret', ownerPassword: 'owner', allowPrint: true, allowCopy: false, allowModify: false });
  }, { file: imgSrc, out: protectOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const protectRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('protect result:', JSON.stringify(protectRes));
  if (!protectRes?.outputs?.length) throw new Error('Khoá PDF không tạo output: ' + JSON.stringify(protectRes));
  assert.equal(protectRes.outputs.length, 1);
  const locked = protectRes.outputs[0].path;
  assert.equal(path.basename(locked), 'm1b-2pages-khoa.pdf');
  assert.equal(path.dirname(path.resolve(locked)), path.resolve(protectOut));
  assert.ok(fs.statSync(locked).size > 0, 'file khoá phải có dữ liệu');

  const shown = await qpdf(['--show-encryption', '--password=secret', locked]);
  assert.match(shown.stdout, /R = 6/);
  assert.match(shown.stdout, /AESv3/);
  assert.match(shown.stdout, /print low resolution: allowed/);
  assert.match(shown.stdout, /extract for any purpose: not allowed/);
  await assert.rejects(
    qpdf(['--check', '--password=wrong', locked]),
    e => e.exitCode !== 0,
  );
  console.log('protect ok:', locked);
} finally {
  await closeApp(app);
}
