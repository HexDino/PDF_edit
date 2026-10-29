import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as pdfjs from '../../renderer/vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../renderer/vendor/pdf.worker.min.mjs', import.meta.url).href;

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName, PDFNumber } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { getTools } = require('../../suite/registry.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');
const APP = fileURLToPath(new URL('../../', import.meta.url));
const realFont = fontkit.create(fs.readFileSync(path.join(APP, 'renderer/fonts/BeVietnamPro-Regular.ttf')));
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.02, `${message}: ${a} != ${b}`);

// Invoke the registered production runner, never a fake font or layout implementation.
async function stamp(ctx) {
  const run = getTools().find(t => t.id === 'stamp').run;
  assert.equal(typeof run, 'function', 'stamp must be runnable');
  return run(ctx);
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-stamp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.pdf');
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  return { dir, file, out, ctx(options = {}, extra = {}) {
    return { files: [file], outputDir: out, tempDir: fs.mkdtempSync(path.join(dir, 'tmp-')),
      signal: new AbortController().signal, progress() {}, options, ...extra };
  } };
}
async function fixture(file, rotations = [0, 90, 180, 270], size = [640, 840], boxed = false) {
  const doc = await PDFDocument.create();
  for (const rotation of rotations) {
    const p = doc.addPage(size);
    p.node.set(PDFName.of('Rotate'), PDFNumber.of(rotation));
    if (boxed) {
      p.setMediaBox(50, 60, 640, 840);
      // Crop extends beyond the media's right edge: visible intersection is 590 x 700.
      p.setCropBox(100, 110, 700, 700);
      p.setTrimBox(120, 130, 500, 600);
      p.setBleedBox(110, 120, 540, 640);
      p.setArtBox(140, 150, 420, 500);
    }
  }
  fs.writeFileSync(file, await doc.save());
}
async function inspect(file, fn) {
  const loading = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: false });
  const doc = await loading.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ page, viewport, content, items: content.items.filter(i => i.str.trim()).map(i => ({
        ...i, view: pdfjs.Util.transform(viewport.transform, i.transform), style: content.styles[i.fontName],
      })) });
    }
    return await fn(pages);
  } finally { await loading.destroy(); }
}
const pageBoxes = doc => doc.getPages().map(p => [p.getMediaBox(), p.getCropBox(), p.getTrimBox(), p.getBleedBox(), p.getArtBox(), p.getRotation()]);

for (const position of ['header', 'footer']) {
  test(`${position}: real Vietnamese text is upright in PDF.js on 0/90/180/270 crop intersections`, async t => {
    const s = setup(t);
    await fixture(s.file, undefined, undefined, true);
    const before = fs.readFileSync(s.file);
    const result = await stamp(s.ctx({ leftText: 'Tiêu đề', centerText: 'Trang {page}/{total}', rightText: 'Ngày {date}', position }));
    const out = result.outputs[0].path;
    assert.deepEqual(pageBoxes(await PDFDocument.load(fs.readFileSync(out))), pageBoxes(await PDFDocument.load(before)));
    assert.deepEqual(fs.readFileSync(s.file), before);
    const d = new Date();
    const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    await inspect(out, pages => {
      pages.forEach(({ viewport, items }, i) => {
        assert.deepEqual(items.map(x => x.str), ['Tiêu đề', `Trang ${i + 1}/4`, `Ngày ${date}`]);
        assert.deepEqual([viewport.width, viewport.height], i % 2 ? [700, 590] : [590, 700]);
        for (const item of items) {
          // PDF.js composes page rotation with the emitted text matrix. -rotation fails at 90/270.
          near(item.view[0], 10, 'text advances right');
          near(item.view[1], 0, 'horizontal baseline');
          near(item.view[2], 0, 'upright axis');
          near(item.view[3], -10, 'glyph top points up');
          const top = item.view[5] - realFont.ascent / realFont.unitsPerEm * 10;
          const bottom = item.view[5] - realFont.descent / realFont.unitsPerEm * 10;
          near(position === 'header' ? top : viewport.height - bottom, 10 * 72 / 25.4, 'visible vertical margin');
        }
        near(items[0].view[4], 10 * 72 / 25.4, 'left');
        near(items[1].view[4] + items[1].width / 2, viewport.width / 2, 'center');
        near(items[2].view[4] + items[2].width, viewport.width - 10 * 72 / 25.4, 'right');
      });
    });
  });
}

for (const position of ['header', 'footer']) {
  test(`${position} margin zero keeps ascenders and descenders entirely inside every rotated view`, async t => {
    const s = setup(t);
    await fixture(s.file);
    const result = await stamp(s.ctx({ centerText: 'ẤỸ gypq', fontSize: 48, margin: 0, position }));
    await inspect(result.outputs[0].path, pages => {
      for (const { viewport, items } of pages) {
        assert.equal(items.length, 1);
        const baseline = items[0].view[5];
        assert.ok(baseline > 0 && baseline < viewport.height, 'baseline must be inside view');
        // Actual font glyph outlines, not a copy of the helper's baseline formula.
        for (const glyph of realFont.layout('ẤỸ gypq').glyphs) {
          assert.ok(baseline - glyph.bbox.maxY / realFont.unitsPerEm * 48 >= -0.01, 'ascender clipped');
          assert.ok(baseline - glyph.bbox.minY / realFont.unitsPerEm * 48 <= viewport.height + 0.01, 'descender clipped');
        }
        // The real Ấ outline reaches 1125 units, above the nominal 1000 ascent.
        if (position === 'header') near(baseline, 54, 'accent-safe header at zero margin');
        else near(baseline - realFont.descent / realFont.unitsPerEm * 48, viewport.height, 'descender metric at zero margin');
      }
    });
  });
}

test('sorts and deduplicates selected pages; consecutive numbering and last assigned total', async t => {
  const s = setup(t);
  await fixture(s.file);
  const result = await stamp(s.ctx({ pages: '4,2,4,2', startAt: 7 }));
  assert.equal(result.stats.pages, 2);
  await inspect(result.outputs[0].path, pages => assert.deepEqual(pages.map(p => p.items.map(i => i.str)), [[], ['Trang 7/8'], [], ['Trang 8/8']]));
});

test('normalizes decomposed Vietnamese to NFC and computes date once across midnight', async t => {
  const s = setup(t);
  await fixture(s.file, [0, 0]);
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 29, 23, 59, 59).getTime() });
  const result = await stamp(s.ctx({ centerText: 'Tiếng Việt {date}'.normalize('NFD') }, {
    progress(_phase, current) { if (current === 1) t.mock.timers.tick(2000); },
  }));
  await inspect(result.outputs[0].path, pages => assert.deepEqual(pages.map(p => p.items[0].str), ['Tiếng Việt 29/10/2026', 'Tiếng Việt 29/10/2026']));
});

test('normalizes negative and >360 orthogonal rotations without changing the page metadata', async t => {
  const s = setup(t);
  await fixture(s.file, [-90, 450]);
  const result = await stamp(s.ctx());
  const doc = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  assert.deepEqual(doc.getPages().map(p => p.getRotation().angle), [-90, 450]);
  await inspect(result.outputs[0].path, pages => pages.forEach(p => { near(p.items[0].view[0], 10, 'right'); near(p.items[0].view[3], -10, 'up'); }));
});

const invalids = [
  { color: '#bad' }, { color: 'red' }, { fontSize: 49 }, { fontSize: 5 }, { fontSize: 10.5 },
  { margin: -1 }, { margin: 101 }, { startAt: 0 }, { startAt: 10001 }, { position: 'side' },
  { leftText: 5 }, { centerText: 'x'.repeat(501) }, { pages: 2 },
  { centerText: 'one\ntwo' }, { leftText: 'one\rtwo' }, { rightText: 'a\tb' },
  { centerText: 'a\u0000b' }, { centerText: 'a\u007fb' }, { centerText: 'a\u2028b' },
  { centerText: 'a\u202eb' }, { leftText: ' ', centerText: '   ', rightText: ' ' },
  { ['D:/private/secret']: true }, null, [],
];
for (const [index, options] of invalids.entries()) {
  test(`direct invocation rejects invalid options safely (${index + 1})`, async t => {
    const s = setup(t);
    await fixture(s.file, [0]);
    await assert.rejects(stamp(s.ctx(options)), e => e.code === 'INVALID_OPTIONS' && !e.message.includes('private') && !e.message.includes(s.dir));
    assert.deepEqual(fs.readdirSync(s.out), []);
  });
}

for (const pages of ['5', '3-8', '0', '2-1', 'D:/private/secret']) {
  test(`rejects invalid page range without output (${pages})`, async t => {
    const s = setup(t);
    await fixture(s.file);
    await assert.rejects(stamp(s.ctx({ pages })), e => e.code === 'INVALID_RANGE' && !e.message.includes('private'));
    assert.deepEqual(fs.readdirSync(s.out), []);
  });
}
for (const [size, options] of [
  [[20, 20], {}], [[600, 5], { margin: 0 }], [[100, 200], { centerText: 'Không thể vừa trang nhỏ', fontSize: 48, margin: 0 }],
  [[200, 300], { margin: 100 }],
]) {
  test(`rejects impossible layout ${size} ${JSON.stringify(options)} without publishing`, async t => {
    const s = setup(t);
    await fixture(s.file, [0], size);
    await assert.rejects(stamp(s.ctx(options)), e => e.code === 'INVALID_OPTIONS');
    assert.deepEqual(fs.readdirSync(s.out), []);
  });
}

test('rejects individually fitting slots that overlap instead of painting text over text', async t => {
  const s = setup(t);
  await fixture(s.file, [0], [200, 300]);
  await assert.rejects(stamp(s.ctx({ leftText: 'Nội dung bên trái', centerText: 'Nội dung giữa', fontSize: 18, margin: 0 })), e => e.code === 'INVALID_OPTIONS');
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('unsupported real-font glyphs return a bounded safe MISSING_GLYPHS error', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const unsupported = Array.from({ length: 80 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
  await assert.rejects(stamp(s.ctx({ centerText: unsupported })), e => {
    assert.equal(e.code, 'MISSING_GLYPHS');
    assert.ok(e.message.length < 200);
    assert.match(e.message, /U\+4E00/);
    assert.ok(!e.message.includes(unsupported));
    return true;
  });
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('keeps existing output and source bytes; chooses a unique output name', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const source = fs.readFileSync(s.file);
  const first = await stamp(s.ctx({}, { outputDir: null }));
  assert.equal(path.basename(first.outputs[0].path), 'source-so-trang.pdf');
  const before = fs.readFileSync(first.outputs[0].path);
  const second = await stamp(s.ctx({ centerText: 'Khác' }, { outputDir: null }));
  assert.equal(path.basename(second.outputs[0].path), 'source-so-trang (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), before);
  assert.deepEqual(fs.readFileSync(s.file), source);
});

test('rejects encrypted PDF with PASSWORD_REQUIRED and no output', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const locked = path.join(s.dir, 'locked.pdf');
  await runProcess(binaryPath('qpdf.exe', { appRoot: APP, isPackaged: false }), ['--encrypt', 'pw', 'owner', '256', '--', s.file, locked]);
  await assert.rejects(stamp(s.ctx({}, { files: [locked] })), e => e.code === 'PASSWORD_REQUIRED' && !e.message.includes(s.dir));
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('rejects corrupt PDF safely without output', async t => {
  const s = setup(t);
  fs.writeFileSync(s.file, 'not a PDF');
  await assert.rejects(stamp(s.ctx()), e => e.code === 'INVALID_FILE' && !e.message.includes(s.dir));
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('rejects non-orthogonal rotation and disjoint visible boxes', async t => {
  const s = setup(t);
  await fixture(s.file, [45]);
  await assert.rejects(stamp(s.ctx()), e => e.code === 'INVALID_FILE');
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]).setCropBox(200, 200, 100, 100);
  fs.writeFileSync(s.file, await doc.save());
  await assert.rejects(stamp(s.ctx()), e => e.code === 'INVALID_FILE');
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('pre-abort performs no page work or publication', async t => {
  const s = setup(t);
  await fixture(s.file);
  const controller = new AbortController();
  controller.abort();
  const progress = [];
  await assert.rejects(stamp(s.ctx({}, { signal: controller.signal, progress(...args) { progress.push(args); } })), e => e.name === 'AbortError');
  assert.deepEqual(progress, []);
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('genuine event-loop cancellation after page 1 stops before page 2 and publishes nothing', async t => {
  const s = setup(t);
  await fixture(s.file, Array(20).fill(0));
  const before = fs.readFileSync(s.file);
  const controller = new AbortController();
  const completed = [];
  await assert.rejects(stamp(s.ctx({}, {
    signal: controller.signal,
    progress(phase, current) {
      if (phase === 'processing' && current > 0) {
        completed.push(current);
        if (current === 1) setImmediate(() => controller.abort());
      }
    },
  })), e => e.name === 'AbortError');
  assert.deepEqual(completed, [1], 'must yield between pages, not just before publication');
  assert.deepEqual(fs.readdirSync(s.out), []);
  assert.deepEqual(fs.readFileSync(s.file), before);
});
