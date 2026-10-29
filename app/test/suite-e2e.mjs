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
const pngSize = buf => {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

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
  assert.equal(await w.locator('#toolGrid .card:not([disabled])').count(), 9);
  assert.equal(await w.locator('#toolGrid .card[disabled]').count(), 5);
  assert.equal(await w.locator('#toolGrid .card .st').count(), 5);
  assert.equal(await w.locator('#toolGrid .groupTitle').count(), 5);
  assert.deepEqual(
    await w.$$eval('#toolGrid .card:not([disabled])', els => els.map(el => el.dataset.toolId)),
    ['merge', 'split', 'pages', 'organize', 'crop', 'pdf-images', 'protect', 'unlock', 'metadata'],
  );
  console.log('home: 14 thẻ · 9 bật (merge, split, pages, organize, crop, pdf-images, protect, unlock, metadata) · 5 tắt · 5 nhãn “Sắp có” · 5 nhóm');

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
  assert.equal(await w.locator('#toolGrid .card:not([disabled])').count(), 3);
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
  await w.evaluate(() => { location.hash = '#/tool/compress'; });
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
  const {
    PDFDocument, PDFName, PDFString,
  } = require('pdf-lib');
  async function make(file, n) {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([100 + i, 200]);
    fs.writeFileSync(file, await d.save());
  }
  async function makeSized(file, sizes) {
    const d = await PDFDocument.create();
    for (const [width, height] of sizes) {
      // Nội dung nhỏ để phân biệt trang chép sang với trang trắng chèn thêm.
      d.addPage([width, height]).drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
    }
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

  // 9b. Tách PDF: 4 trang bề rộng khác nhau; 1-2,4 -> 2 file (2/1 trang).
  const m2Src = path.join(OUT, 'm2-4pages.pdf');
  const splitOut = path.join(OUT, 'm2-split-out');
  fs.rmSync(splitOut, { recursive: true, force: true });
  fs.mkdirSync(splitOut, { recursive: true });
  await makeSized(m2Src, [[101, 200], [102, 200], [103, 200], [104, 200]]);
  await w.evaluate(() => window.__suite.openTool('split'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'split');
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: m2Src, out: splitOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ mode: 'ranges', ranges: '1-2,4', every: 2 });
  }, { file: m2Src, out: splitOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const splitRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('split result:', JSON.stringify(splitRes));
  if (!splitRes?.outputs?.length) throw new Error('Tách PDF không tạo output: ' + JSON.stringify(splitRes));
  assert.equal(splitRes.outputs.length, 2);
  assert.equal(path.basename(path.dirname(splitRes.outputs[0].path)), 'm2-4pages-tach');
  assert.deepEqual(
    splitRes.outputs.map(o => path.basename(o.path)),
    ['m2-4pages-01.pdf', 'm2-4pages-02.pdf'],
  );
  const splitDocs = await Promise.all(
    splitRes.outputs.map(o => PDFDocument.load(fs.readFileSync(o.path))),
  );
  assert.deepEqual(splitDocs.map(d => d.getPageCount()), [2, 1]);
  assert.deepEqual(
    splitDocs.map(d => d.getPages().map(p => Math.round(p.getWidth()))),
    [[101, 102], [104]],
  );
  console.log('split ok:', splitRes.outputs.map(o => path.basename(o.path)).join(', '), '· 2/1 trang');

  // 9c. Xoá & trích trang: trích 2,4 giữ đúng thứ tự.
  const pagesOut = path.join(OUT, 'm2-pages-out');
  fs.rmSync(pagesOut, { recursive: true, force: true });
  fs.mkdirSync(pagesOut, { recursive: true });
  await w.evaluate(() => window.__suite.openTool('pages'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'pages');
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: m2Src, out: pagesOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ mode: 'extract', pages: '2,4' });
  }, { file: m2Src, out: pagesOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const pagesRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('pages result:', JSON.stringify(pagesRes));
  if (!pagesRes?.outputs?.length) throw new Error('Trích trang không tạo output: ' + JSON.stringify(pagesRes));
  assert.equal(pagesRes.outputs.length, 1);
  assert.equal(path.basename(pagesRes.outputs[0].path), 'm2-4pages-trich-trang.pdf');
  const pagesDoc = await PDFDocument.load(fs.readFileSync(pagesRes.outputs[0].path));
  assert.equal(pagesDoc.getPageCount(), 2);
  assert.deepEqual(pagesDoc.getPages().map(p => Math.round(p.getWidth())), [102, 104]);
  console.log('pages ok:', path.basename(pagesRes.outputs[0].path), '· 2 trang (2,4)');

  // 9d. Tổ chức trang: 3,1,2 + xoay 90 + 1 trang trắng -> 4 trang.
  const organizeOut = path.join(OUT, 'm2-organize-out');
  fs.rmSync(organizeOut, { recursive: true, force: true });
  fs.mkdirSync(organizeOut, { recursive: true });
  await w.evaluate(() => window.__suite.openTool('organize'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'organize');
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: m2Src, out: organizeOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ order: '3,1,2', rotate: '90', blankCount: 1 });
  }, { file: m2Src, out: organizeOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const organizeRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('organize result:', JSON.stringify(organizeRes));
  if (!organizeRes?.outputs?.length) throw new Error('Tổ chức trang không tạo output: ' + JSON.stringify(organizeRes));
  assert.equal(organizeRes.outputs.length, 1);
  assert.equal(path.basename(organizeRes.outputs[0].path), 'm2-4pages-to-chuc.pdf');
  const orgDoc = await PDFDocument.load(fs.readFileSync(organizeRes.outputs[0].path));
  const orgPages = orgDoc.getPages();
  assert.equal(orgDoc.getPageCount(), 4);
  assert.deepEqual(orgPages.map(p => Math.round(p.getWidth())), [103, 101, 102, 102]);
  assert.deepEqual(
    orgPages.map(p => ((p.getRotation().angle % 360) + 360) % 360),
    [90, 90, 90, 90],
  );
  assert.equal(!!orgPages[3].node.Contents(), false, 'trang cuối phải là trang trắng');
  assert.equal(!!orgPages[2].node.Contents(), true, 'trang chép sang phải giữ nội dung');
  assert.deepEqual([Math.round(orgPages[3].getWidth()), Math.round(orgPages[3].getHeight())], [102, 200]);
  console.log('organize ok:', path.basename(organizeRes.outputs[0].path), '· 4 trang (3,1,2 + trắng) · xoay 90');

  // 9e. Crop PDF: 10 mm mỗi lề trên tất cả trang -> CropBox đúng, MediaBox giữ nguyên.
  const cropOut = path.join(OUT, 'm2-crop-out');
  fs.rmSync(cropOut, { recursive: true, force: true });
  fs.mkdirSync(cropOut, { recursive: true });
  await w.evaluate(() => window.__suite.openTool('crop'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'crop');
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: m2Src, out: cropOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ top: 10, right: 10, bottom: 10, left: 10, pages: '' });
  }, { file: m2Src, out: cropOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const cropRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('crop result:', JSON.stringify(cropRes));
  if (!cropRes?.outputs?.length) throw new Error('Crop PDF không tạo output: ' + JSON.stringify(cropRes));
  assert.equal(cropRes.outputs.length, 1);
  assert.equal(path.basename(cropRes.outputs[0].path), 'm2-4pages-crop.pdf');
  const cropDoc = await PDFDocument.load(fs.readFileSync(cropRes.outputs[0].path));
  assert.equal(cropDoc.getPageCount(), 4);
  const mm10 = 10 * 72 / 25.4;
  const srcWidths = [101, 102, 103, 104];
  const near = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) < 0.01, `${label}: mong đợi ${expected}, nhận ${actual}`);
  cropDoc.getPages().forEach((page, i) => {
    const box = page.getCropBox();
    near(box.x, mm10, `crop trang ${i + 1} x`);
    near(box.y, mm10, `crop trang ${i + 1} y`);
    near(box.width, srcWidths[i] - 2 * mm10, `crop trang ${i + 1} rộng`);
    near(box.height, 200 - 2 * mm10, `crop trang ${i + 1} cao`);
    near(page.getMediaBox().width, srcWidths[i], `media trang ${i + 1}`);
  });
  console.log('crop ok:', path.basename(cropRes.outputs[0].path), '· 4 trang · lề 10 mm');

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
  // Fixture 72 DPI: trang 1 rộng 100 pt × cao 200 pt → 100×200 px.
  assert.deepEqual(imgRes.outputs.map(o => pngSize(fs.readFileSync(o.path))), [
    { width: 100, height: 200 },
    { width: 101, height: 200 },
  ]);
  console.log('pdf-images ok:', imgFolder, imgNames.join(', '), '· 100×200 px @72 DPI');

  // 10b. PDF → ảnh JPEG thật: magic FF D8 FF.
  const jpgOut = path.join(OUT, 'm1b-img-jpg-out');
  fs.rmSync(jpgOut, { recursive: true, force: true });
  fs.mkdirSync(jpgOut, { recursive: true });
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: imgSrc, out: jpgOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ pages: '', dpi: 72, format: 'jpg', quality: 80 });
  }, { file: imgSrc, out: jpgOut });
  await w.click('#runBtn');
  const jpgRes = await w.evaluate(() => window.__suite.waitJob(60000));
  console.log('pdf-images jpg result:', JSON.stringify(jpgRes));
  if (!jpgRes?.outputs?.length) throw new Error('PDF → JPEG không tạo output: ' + JSON.stringify(jpgRes));
  assert.deepEqual(jpgRes.outputs.map(o => path.basename(o.path)), ['m1b-2pages-01.jpg', 'm1b-2pages-02.jpg']);
  assert.equal(path.basename(path.dirname(jpgRes.outputs[0].path)), 'm1b-2pages-anh');
  for (const o of jpgRes.outputs) {
    const bytes = fs.readFileSync(o.path);
    assert.ok(bytes.length > 0);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG magic FF D8 FF');
  }
  console.log('pdf-images jpg ok:', jpgRes.outputs.map(o => path.basename(o.path)).join(', '));

  // 10c. Cạnh dài tối đa 10.000 px: trang 2000×100 pt ở 600 DPI → 10000×500.
  const capSrc = path.join(OUT, 'm1b-wide.pdf');
  const capOut = path.join(OUT, 'm1b-cap-out');
  fs.rmSync(capOut, { recursive: true, force: true });
  fs.mkdirSync(capOut, { recursive: true });
  await makeSized(capSrc, [[2000, 100]]);
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: capSrc, out: capOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ pages: '', dpi: 600, format: 'png', quality: 90 });
  }, { file: capSrc, out: capOut });
  await w.click('#runBtn');
  const capRes = await w.evaluate(() => window.__suite.waitJob(60000));
  console.log('pdf-images 10k result:', JSON.stringify(capRes));
  if (!capRes?.outputs?.length) throw new Error('PDF → ảnh quá khổ không tạo output: ' + JSON.stringify(capRes));
  assert.equal(capRes.outputs.length, 1);
  assert.equal(path.basename(capRes.outputs[0].path), 'm1b-wide-01.png');
  assert.deepEqual(pngSize(fs.readFileSync(capRes.outputs[0].path)), { width: 10000, height: 500 });
  console.log('pdf-images 10k ok: cạnh dài 10000 px (600 DPI bị hạ tỉ lệ)');

  // 10d. Huỷ giữa lúc render nhiều trang: không tạo thư mục -anh, lần sau vẫn render được.
  const cancelSrc = path.join(OUT, 'm1b-many.pdf');
  const cancelOut = path.join(OUT, 'm1b-cancel-out');
  fs.rmSync(cancelOut, { recursive: true, force: true });
  fs.mkdirSync(cancelOut, { recursive: true });
  await makeSized(cancelSrc, Array.from({ length: 16 }, () => [600, 800]));
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: cancelSrc, out: cancelOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ pages: '', dpi: 300, format: 'png', quality: 90 });
  }, { file: cancelSrc, out: cancelOut });
  await w.click('#runBtn');
  await w.waitForFunction(() => Number(document.getElementById('progressBar').value) >= 1, null, { timeout: 60000 });
  assert.equal(await w.evaluate(() => window.__suite.state.running), true, 'job phải còn chạy khi huỷ');
  await w.click('#cancelBtn');
  await w.waitForFunction(() => window.__suite.state.running === false, null, { timeout: 30000 });
  const cancelRes = await w.evaluate(() => window.__suite.waitJob(5000));
  assert.equal(cancelRes, null, 'job huỷ không được trả kết quả/lỗi');
  assert.match(await w.locator('#toast').textContent(), /Đã huỷ job/);
  assert.equal(fs.existsSync(path.join(cancelOut, 'm1b-many-anh')), false, 'huỷ không được để lại thư mục -anh');
  assert.deepEqual(fs.readdirSync(cancelOut), [], 'thư mục xuất phải trống sau khi huỷ');
  console.log('pdf-images cancel ok: không có -anh, thư mục xuất trống');

  // Worker bị reset khi huỷ; lần render sau phải khởi động lại và thành công.
  await w.evaluate(() => window.__suite.setOptions({ pages: '1', dpi: 72, format: 'png', quality: 90 }));
  await w.click('#runBtn');
  const retryRes = await w.evaluate(() => window.__suite.waitJob(60000));
  console.log('pdf-images retry result:', JSON.stringify(retryRes));
  if (!retryRes?.outputs?.length) throw new Error('Render lại sau huỷ thất bại: ' + JSON.stringify(retryRes));
  assert.equal(retryRes.outputs.length, 1);
  assert.equal(path.basename(retryRes.outputs[0].path), 'm1b-many-01.png');
  assert.deepEqual(pngSize(fs.readFileSync(retryRes.outputs[0].path)), { width: 600, height: 800 });
  console.log('pdf-images retry ok:', retryRes.outputs[0].path);

  // 11. Khoá PDF: qpdf thật mã hoá AES-256; mật khẩu đúng mở được, sai bị từ chối.
  const protectOut = path.join(OUT, 'm1b-protect-out');
  fs.rmSync(protectOut, { recursive: true, force: true });
  fs.mkdirSync(protectOut, { recursive: true });
  await w.evaluate(() => window.__suite.openTool('protect'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'protect');
  assert.ok(
    (await w.$$eval('#options .field > label', els => els.map(el => el.textContent)))
      .some(t => /Mật khẩu chủ/.test(t) && /bắt buộc/.test(t)),
    'nhãn mật khẩu chủ phải nói bắt buộc khi hạn chế quyền',
  );
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
  assert.match(shown.stdout, /User password = secret/);
  assert.match(shown.stdout, /Supplied password is user password/);
  assert.equal(shown.stdout.includes('Supplied password is owner password'), false,
    'mật khẩu mở không được là mật khẩu chủ');
  assert.match(shown.stdout, /print low resolution: allowed/);
  assert.match(shown.stdout, /extract for any purpose: not allowed/);
  assert.match(shown.stdout, /modify anything: not allowed/);
  const asOwner = await qpdf(['--show-encryption', '--password=owner', locked]);
  assert.match(asOwner.stdout, /Supplied password is owner password/);
  await assert.rejects(
    qpdf(['--check', '--password=wrong', locked]),
    e => e.exitCode !== 0,
  );
  console.log('protect ok:', locked, '· mở = user, chủ = owner, in được; sao chép/sửa bị chặn');

  // 11b. Mở khoá PDF: fixture AES-256 được gỡ mã hoá bằng mật khẩu đúng;
  // file kết quả mở/kiểm tra được mà không cần mật khẩu.
  const unlockOut = path.join(OUT, 'm1b-unlock-out');
  fs.rmSync(unlockOut, { recursive: true, force: true });
  fs.mkdirSync(unlockOut, { recursive: true });
  const lockedSrc = path.join(OUT, 'm1b-locked.pdf');
  await qpdf(['--encrypt', '--user-password=secret', '--owner-password=owner',
    '--bits=256', '--', imgSrc, lockedSrc]);
  const lockProbe = await qpdf(['--show-encryption', '--password=secret', lockedSrc]);
  assert.match(lockProbe.stdout, /R = 6/);
  assert.match(lockProbe.stdout, /AESv3/);

  await w.evaluate(() => window.__suite.openTool('unlock'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'unlock');
  assert.equal(await w.locator('#options .field > label').textContent(), 'Mật khẩu hiện có');
  assert.equal(await w.locator('#options input[type="password"]').count(), 1);
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: lockedSrc, out: unlockOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
    window.__suite.setOptions({ password: 'secret' });
  }, { file: lockedSrc, out: unlockOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const unlockRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('unlock result:', JSON.stringify(unlockRes));
  if (!unlockRes?.outputs?.length) throw new Error('Mở khoá PDF không tạo output: ' + JSON.stringify(unlockRes));
  assert.equal(unlockRes.outputs.length, 1);
  const unlocked = unlockRes.outputs[0].path;
  assert.equal(path.basename(unlocked), 'm1b-locked-mo-khoa.pdf');
  assert.equal(path.dirname(path.resolve(unlocked)), path.resolve(unlockOut));
  assert.ok(fs.statSync(unlocked).size > 0, 'file mở khoá phải có dữ liệu');
  const unlockedShow = await qpdf(['--show-encryption', unlocked]);
  assert.match(unlockedShow.stdout, /File is not encrypted/);
  await qpdf(['--check', unlocked]);
  const unlockedDoc = await PDFDocument.load(fs.readFileSync(unlocked));
  assert.equal(unlockedDoc.getPageCount(), 2);
  console.log('unlock ok:', unlocked, '· không còn mã hoá, mở không cần mật khẩu');

  // 11c. Xoá metadata: PDF có Info + tệp đính kèm; mặc định xoá cả ba loại.
  const metaOut = path.join(OUT, 'm1b-metadata-out');
  fs.rmSync(metaOut, { recursive: true, force: true });
  fs.mkdirSync(metaOut, { recursive: true });
  const metaSrc = path.join(OUT, 'm1b-metadata.pdf');
  const metaDoc = await PDFDocument.create();
  metaDoc.addPage([200, 300]);
  metaDoc.setTitle('Tài liệu nội bộ');
  metaDoc.setAuthor('Nguyễn Văn A');
  metaDoc.setSubject('Chủ đề mật');
  metaDoc.setKeywords(['mật', 'nội bộ']);
  metaDoc.setCreationDate(new Date('2019-01-02T03:04:05Z'));
  metaDoc.setModificationDate(new Date('2020-02-03T04:05:06Z'));
  metaDoc.getInfoDict().set(PDFName.of('Company'), PDFString.of('SECRET-COMPANY-E2E'));
  const metaXmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/">SECRET-XMP-E2E</x:xmpmeta>';
  metaDoc.catalog.set(
    PDFName.of('Metadata'),
    metaDoc.context.register(metaDoc.context.stream(metaXmp, { Type: 'Metadata', Subtype: 'XML' })),
  );
  // XMP cấp trang: cũng phải bị xoá khi chọn removeXmp.
  const pageXmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/">SECRET-PAGE-XMP-E2E</x:xmpmeta>';
  metaDoc.getPage(0).node.set(
    PDFName.of('Metadata'),
    metaDoc.context.register(metaDoc.context.stream(pageXmp, { Type: 'Metadata', Subtype: 'XML' })),
  );
  await metaDoc.attach(Buffer.from('tệp đính kèm bí mật'), 'bi-mat.txt', { mimeType: 'text/plain' });
  fs.writeFileSync(metaSrc, await metaDoc.save());

  await w.evaluate(() => window.__suite.openTool('metadata'));
  await w.waitForFunction(() => window.__suite.state.tool?.id === 'metadata');
  assert.deepEqual(
    await w.$$eval('#options .field > label:not(.row)', els => els.map(el => el.textContent)),
    ['Xoá thông tin tài liệu (Info)', 'Xoá XMP metadata', 'Xoá tệp đính kèm'],
  );
  assert.equal(await w.locator('#options input[type="checkbox"]').count(), 3);
  assert.equal(
    await w.$$eval('#options input[type="checkbox"]', els => els.every(el => el.checked)),
    true,
    'cả ba tuỳ chọn phải bật mặc định',
  );
  await w.evaluate(({ file, out }) => window.api.suite.registerInput([file, out]), { file: metaSrc, out: metaOut });
  await w.evaluate(({ file, out }) => {
    window.__suite.addFiles([file]);
    window.__suite.setOutputDir(out);
  }, { file: metaSrc, out: metaOut });
  assert.equal(await w.locator('#runBtn').isEnabled(), true);
  await w.click('#runBtn');
  const metaRes = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('metadata result:', JSON.stringify(metaRes));
  if (!metaRes?.outputs?.length) throw new Error('Xoá metadata không tạo output: ' + JSON.stringify(metaRes));
  assert.equal(metaRes.outputs.length, 1);
  assert.deepEqual(metaRes.stats.removed, { info: true, xmp: true, attachments: 1 });
  const metaFile = metaRes.outputs[0].path;
  assert.equal(path.basename(metaFile), 'm1b-metadata-xoa-metadata.pdf');
  assert.equal(path.dirname(path.resolve(metaFile)), path.resolve(metaOut));
  assert.ok(fs.statSync(metaFile).size > 0, 'file xoá metadata phải có dữ liệu');
  const cleanedDoc = await PDFDocument.load(fs.readFileSync(metaFile), { updateMetadata: false });
  assert.equal(cleanedDoc.getPageCount(), 1);
  // Info phải vắng hẳn: ngày tạo/ngày sửa và khoá tuỳ biến không được còn.
  assert.equal(cleanedDoc.context.trailerInfo.Info, undefined, 'trailer không còn /Info');
  assert.equal(cleanedDoc.getCreationDate(), undefined, 'CreationDate phải bị xoá');
  assert.equal(cleanedDoc.getModificationDate(), undefined, 'ModDate phải bị xoá');
  assert.equal(cleanedDoc.getInfoDict().get(PDFName.of('Company')), undefined, '/Company phải bị xoá');
  assert.equal(cleanedDoc.getTitle(), undefined);
  assert.equal(cleanedDoc.getAuthor(), undefined);
  assert.equal(cleanedDoc.getSubject(), undefined);
  assert.equal(cleanedDoc.getKeywords(), undefined);
  assert.equal(cleanedDoc.catalog.has(PDFName.of('Metadata')), false);
  assert.equal(cleanedDoc.getPage(0).node.has(PDFName.of('Metadata')), false, 'trang không còn /Metadata');
  assert.equal(cleanedDoc.catalog.has(PDFName.of('AF')), false);
  const metaBytes = fs.readFileSync(metaFile);
  for (const marker of [
    'SECRET-XMP-E2E', 'SECRET-PAGE-XMP-E2E', '/Company', 'SECRET-COMPANY-E2E', '/CreationDate', '/ModDate',
  ]) {
    assert.equal(metaBytes.includes(Buffer.from(marker)), false, `không còn ${marker} trong file`);
  }
  const metaList = await qpdf(['--list-attachments', metaFile]);
  assert.doesNotMatch(metaList.stdout, /bi-mat\.txt/);
  await qpdf(['--check', metaFile]);
  console.log('metadata ok:', metaFile, '· Info/ngày/khoá tuỳ biến đã xoá hẳn, không còn tệp đính kèm');
} finally {
  await closeApp(app);
}
