import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { APP_ROOT, OUT, electronBin, electronEnv, closeApp } from './_paths.mjs';

const require = createRequire(import.meta.url);

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
  assert.equal(await w.locator('#toolGrid .card:not([disabled])').count(), 1);
  assert.equal(await w.locator('#toolGrid .card[disabled]').count(), 13);
  assert.equal(await w.locator('#toolGrid .card .st').count(), 13);
  assert.equal(await w.locator('#toolGrid .groupTitle').count(), 5);
  assert.equal(
    await w.locator('#toolGrid .card:not([disabled])').getAttribute('data-tool-id'),
    'merge',
  );
  console.log('home: 14 thẻ · 1 bật (merge) · 13 tắt · 13 nhãn “Sắp có” · 5 nhóm');

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
  await w.evaluate(({ files, out }) => {
    window.__suite.addFiles(files); window.__suite.setOutputDir(out);
  }, { files: [a, b], out: outDir });
  await w.click('#runBtn');
  const res = await w.evaluate(() => window.__suite.waitJob(30000));
  console.log('merge result:', JSON.stringify(res));
  if (!res?.outputs?.length) throw new Error('Merge không tạo output');
  const outFile = res.outputs[0].path;
  const merged = await PDFDocument.load(fs.readFileSync(outFile));
  if (merged.getPageCount() !== 5) throw new Error('Sai số trang: ' + merged.getPageCount());
  console.log('merge ok:', outFile);
} finally {
  await closeApp(app);
}
