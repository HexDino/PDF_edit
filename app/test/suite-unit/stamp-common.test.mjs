import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as pdfjs from '../../renderer/vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../renderer/vendor/pdf.worker.min.mjs', import.meta.url).href;
const require = createRequire(import.meta.url);
const { PDFDocument, degrees } = require('pdf-lib');

// Helpers are exercised on real serialized PDFs, including the future extra-angle use.
test('display mapping and extra counter-clockwise angle agree with independent PDF.js view', async () => {
  const { loadStampFont, drawDisplayText, displayToPdf } = require('../../suite/pdfops/stamp-common.js');
  const doc = await PDFDocument.create();
  const font = await loadStampFont(doc);
  for (const angle of [0, 90, 180, 270]) {
    const page = doc.addPage([400, 500]);
    page.setCropBox(40, 60, 320, 400);
    page.setRotation(degrees(angle));
    drawDisplayText(page, font, 'Góc xoay', { dx: 100, dy: 120, size: 12, color: '#112233', opacity: 0.5, extraAngle: 30 });
  }
  const bytes = await doc.save();
  assert.ok(bytes.length < 30000, 'small text must embed a subset, not the entire font');
  const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    for (let n = 1; n <= 4; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      for (const [x, y] of [[0, 0], [20, 30], [vp.width / 2, vp.height / 2]]) {
        const pt = displayToPdf({ x: 40, y: 60, width: 320, height: 400 }, (n - 1) * 90, x, y);
        const got = vp.convertToViewportPoint(...pt);
        assert.ok(Math.abs(got[0] - x) < 0.001 && Math.abs(got[1] - y) < 0.001);
      }
      const item = (await page.getTextContent()).items.find(i => i.str.trim());
      assert.equal(item.str, 'Góc xoay');
      const matrix = pdfjs.Util.transform(vp.transform, item.transform);
      assert.ok(Math.abs(matrix[4] - 100) < 0.001);
      assert.ok(Math.abs(matrix[5] - 120) < 0.001);
      const angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
      assert.ok(Math.abs(angle + 30) < 0.001, `expected visible counter-clockwise 30°, got ${angle}`);
    }
  } finally { await loading.destroy(); }
});

test('templates replace all supported placeholders without interpreting unknown text', () => {
  const { formatTemplate, colorToRgb, textRotation } = require('../../suite/pdfops/stamp-common.js');
  assert.equal(formatTemplate('{page}/{total} {page} {date} {other}', { page: 7, total: 8, date: '29/10/2026' }), '7/8 7 29/10/2026 {other}');
  const c = colorToRgb('#FF0080');
  assert.equal(c.red, 1); assert.equal(c.green, 0); assert.equal(c.blue, 128 / 255);
  for (const color of ['#abc', 'red', '#112233\n', null]) assert.throws(() => colorToRgb(color), e => e.code === 'INVALID_OPTIONS');
  assert.equal(textRotation(-30, 450), 60);
  assert.throws(() => textRotation(0, 45), e => e.code === 'INVALID_FILE');
});
