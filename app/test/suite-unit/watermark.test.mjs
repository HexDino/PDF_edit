import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as pdfjs from '../../renderer/vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../renderer/vendor/pdf.worker.min.mjs', import.meta.url).href;

const require = createRequire(import.meta.url);
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream, degrees, rgb,
} = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { getTools } = require('../../suite/registry.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');
const APP = fileURLToPath(new URL('../../', import.meta.url));
const realFont = fontkit.create(fs.readFileSync(path.join(APP, 'renderer/fonts/BeVietnamPro-Regular.ttf')));
const near = (a, b, message, tolerance = 0.02) =>
  assert.ok(Math.abs(a - b) < tolerance, `${message}: ${a} != ${b}`);
const JPEG = path.join(APP, 'test', 'sig-photo.jpg');

// Independent PNG writer for image-mode fixtures.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};
function solidPng(width, height, [r, g, b] = [255, 0, 0]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Invoke the registered production runner, never a local copy.
async function watermark(ctx) {
  const run = getTools().find(t => t.id === 'watermark').run;
  assert.equal(typeof run, 'function', 'watermark must be runnable');
  return run(ctx);
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-wm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.pdf');
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const temps = [];
  return {
    dir, file, out, temps,
    ctx(options = {}, extra = {}) {
      const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
      temps.push(tempDir);
      return {
        files: [file], outputDir: out, tempDir,
        signal: new AbortController().signal, progress() {}, options, ...extra,
      };
    },
  };
}
// Nonzero MediaBox/CropBox origins; visible intersection is 380 x 560.
async function fixture(file, rotations = [0, 90, 180, 270]) {
  const doc = await PDFDocument.create();
  for (const rotation of rotations) {
    const page = doc.addPage([430, 620]);
    page.setMediaBox(50, 60, 430, 620);
    page.setCropBox(80, 90, 380, 560);
    page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 85, y: 95, width: 10, height: 10, color: rgb(0, 0, 1) });
  }
  fs.writeFileSync(file, await doc.save());
}
const pageBoxes = doc => doc.getPages().map(p => [p.getMediaBox(), p.getCropBox(), p.getTrimBox(), p.getBleedBox(), p.getArtBox(), p.getRotation()]);
function visibleBox(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  return {
    x, y,
    width: Math.min(media.x + media.width, crop.x + crop.width) - x,
    height: Math.min(media.y + media.height, crop.y + crop.height) - y,
  };
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
      pages.push({
        page, viewport, content,
        items: content.items.filter(i => i.str.trim()).map(i => ({
          ...i, view: pdfjs.Util.transform(viewport.transform, i.transform), style: content.styles[i.fontName],
        })),
      });
    }
    return await fn(pages);
  } finally { await loading.destroy(); }
}
function contentStreams(file) {
  return PDFDocument.load(fs.readFileSync(file)).then(loaded => loaded.getPages().map(page => {
    let contents = page.node.Contents();
    if (!contents) return '';
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    return refs.map(ref => {
      const stream = loaded.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return '';
      return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    }).join('\n');
  }));
}
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
// Walk real content operators and record the CTM at every Do (image draw).
function imageDraws(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const draws = [];
  let name = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'q') { stack.push(ctm.slice()); continue; }
    if (token === 'Q') { if (stack.length) ctm = stack.pop(); continue; }
    if (token === 'cm') {
      const values = tokens.slice(i - 6, i).map(Number);
      if (values.length === 6 && values.every(Number.isFinite)) ctm = multiply(ctm, values);
      continue;
    }
    if (token.startsWith('/')) { name = token; continue; }
    if (token === 'Do' && name) {
      draws.push({
        name,
        width: Math.hypot(ctm[0], ctm[1]),
        height: Math.hypot(ctm[2], ctm[3]),
        angle: (Math.atan2(ctm[1], ctm[0]) * 180 / Math.PI + 360) % 360,
        center: [ctm[0] * 0.5 + ctm[2] * 0.5 + ctm[4], ctm[1] * 0.5 + ctm[3] * 0.5 + ctm[5]],
      });
      name = null;
    }
  }
  return draws;
}
function imageObjects(doc, page) {
  const resources = page.node.Resources();
  const xobjects = resources && resources.lookup(PDFName.of('XObject'));
  if (!xobjects) return [];
  const out = [];
  for (const [, ref] of xobjects.entries()) {
    const stream = doc.context.lookup(ref);
    const dict = stream && stream.dict;
    if (!dict) continue;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (subtype !== PDFName.of('Image')) continue;
    out.push({ width: dict.get(PDFName.of('Width')).asNumber(), height: dict.get(PDFName.of('Height')).asNumber() });
  }
  return out;
}
function opacityStates(doc) {
  const out = [];
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const raw = resources && resources.lookup(PDFName.of('ExtGState'));
    if (!raw) continue;
    const states = raw instanceof PDFDict ? raw : doc.context.lookup(raw);
    if (!(states instanceof PDFDict)) continue;
    for (const [, ref] of states.entries()) {
      const dict = ref instanceof PDFDict ? ref : doc.context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      const ca = dict.get(PDFName.of('ca'));
      if (ca) out.push(ca.asNumber());
    }
  }
  return out;
}
// Font-source ink metrics (independent of the production measuring helper).
function inkMetrics(text, size) {
  const scale = size / realFont.unitsPerEm;
  let advance = 0, left = 0, right = 0;
  let ascent = realFont.ascent, descent = realFont.descent;
  for (const glyph of realFont.layout(text).glyphs) {
    const b = glyph.bbox;
    left = Math.min(left, advance + b.minX);
    right = Math.max(right, advance + b.maxX);
    ascent = Math.max(ascent, b.maxY);
    descent = Math.min(descent, b.minY);
    advance += glyph.advanceWidth;
  }
  right = Math.max(right, advance);
  return {
    left: left * scale, width: (right - left) * scale,
    ascent: ascent * scale, descent: descent * scale,
  };
}
function itemCorners(item, metrics, size) {
  const v = item.view;
  // PDF.js's view basis already contains the font size; metrics are in points.
  const ux = v[0] / size, uy = v[1] / size;
  const vx = v[2] / size, vy = v[3] / size;
  return [[metrics.left, metrics.ascent], [metrics.left + metrics.width, metrics.ascent],
    [metrics.left + metrics.width, metrics.descent], [metrics.left, metrics.descent]]
    .map(([u, y]) => [v[4] + u * ux + y * vx, v[5] + u * uy + y * vy]);
}

test('text is centered at the requested visual angle in PDF.js on 0/90/180/270 crop intersections', async t => {
  const s = setup(t);
  await fixture(s.file);
  const before = fs.readFileSync(s.file);
  const result = await watermark(s.ctx({ text: 'BẢN NHÁP', fontSize: 40, color: '#c81e1e', opacity: 80, angle: 30 }));
  const out = result.outputs[0].path;
  assert.equal(path.basename(out), 'source-watermark.pdf');
  assert.deepEqual(result.stats, { pages: 4, draws: 4 });
  assert.deepEqual(pageBoxes(await PDFDocument.load(fs.readFileSync(out))), pageBoxes(await PDFDocument.load(before)));
  assert.deepEqual(fs.readFileSync(s.file), before);
  // The mark is appended after the original blue rectangle (drawn above it).
  const streams = await contentStreams(out);
  assert.equal(streams.length, 4);
  for (const content of streams) {
    const original = content.indexOf('0 0 1 rg');
    const marked = content.indexOf('0.784');
    assert.ok(original >= 0 && marked > original, 'watermark content must follow existing page content');
  }
  const metrics = inkMetrics('BẢN NHÁP', 40);
  const rad = 30 * Math.PI / 180;
  await inspect(out, pages => {
    pages.forEach(({ viewport, items, content: textContent }, i) => {
      assert.equal(items.length, 1);
      assert.equal(items[0].str, 'BẢN NHÁP');
      assert.deepEqual([viewport.width, viewport.height], i % 2 ? [560, 380] : [380, 560]);
      const v = items[0].view;
      near(v[0], 40 * Math.cos(rad), 'text advances along requested visual angle');
      near(v[1], -40 * Math.sin(rad), 'text advances along requested visual angle');
      near(v[2], -40 * Math.sin(rad), 'text up-axis matches requested visual angle');
      near(v[3], -40 * Math.cos(rad), 'text up-axis matches requested visual angle');
      const ux = v[0] / 40, uy = v[1] / 40, vx = v[2] / 40, vy = v[3] / 40;
      const cx = v[4] + (metrics.left + metrics.width / 2) * ux + ((metrics.ascent + metrics.descent) / 2) * vx;
      const cy = v[5] + (metrics.left + metrics.width / 2) * uy + ((metrics.ascent + metrics.descent) / 2) * vy;
      near(cx, viewport.width / 2, 'horizontally centered in the visible display area', 0.5);
      near(cy, viewport.height / 2, 'vertically centered in the visible display area', 0.5);
      assert.ok(textContent.styles[items[0].fontName], 'real embedded font used');
    });
  });
  for (const dir of s.temps) assert.deepEqual(fs.readdirSync(dir), [], 'temp watermark file must be cleaned up');
});

test('page range selects and sorts pages for the watermark and invalid ranges fail', async t => {
  const s = setup(t);
  await fixture(s.file, [0, 0, 0, 0]);
  const result = await watermark(s.ctx({ text: 'CHỌN', pages: '4,2' }));
  assert.deepEqual(result.stats, { pages: 2, draws: 2 });
  await inspect(result.outputs[0].path, pages =>
    assert.deepEqual(pages.map(p => p.items.map(i => i.str)), [[], ['CHỌN'], [], ['CHỌN']]));
  const before = fs.readdirSync(s.out);
  await assert.rejects(watermark(s.ctx({ pages: '0' })), e => e.code === 'INVALID_RANGE');
  await assert.rejects(watermark(s.ctx({ pages: 'D:/private/secret' })), e =>
    e.code === 'INVALID_RANGE' && !e.message.includes('private'));
  assert.deepEqual(fs.readdirSync(s.out), before);
});

test('tiled text is inset by the margin, keeps each rotated box inside the view, and shares one grid', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const result = await watermark(s.ctx({ text: 'NHÁP', fontSize: 12, opacity: 100, angle: 30, tile: true, margin: 10 }));
  const marginPt = 10 * 72 / 25.4;
  assert.ok(result.stats.draws > 1, 'tile must repeat the mark');
  await inspect(result.outputs[0].path, pages => {
    const { viewport, items } = pages[0];
    assert.equal(items.length, result.stats.draws);
    const metrics = inkMetrics('NHÁP', 12);
    for (const item of items) {
      for (const [x, y] of itemCorners(item, metrics, 12)) {
        assert.ok(x >= marginPt - 0.02 && x <= viewport.width - marginPt + 0.02, `tile x inside margin: ${x}`);
        assert.ok(y >= marginPt - 0.02 && y <= viewport.height - marginPt + 0.02, `tile y inside margin: ${y}`);
      }
    }
  });
});

test('tile draw count is capped at 200 per page deterministically without overlapping marks', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const options = { text: 'A', fontSize: 12, opacity: 100, angle: 0, tile: true, margin: 0 };
  const first = await watermark(s.ctx(options));
  const second = await watermark(s.ctx(options));
  assert.ok(first.stats.draws > 1, 'dense page must still tile');
  assert.ok(first.stats.draws <= 200, `draws must be capped: ${first.stats.draws}`);
  assert.equal(first.stats.draws, second.stats.draws);
  let positions;
  await inspect(first.outputs[0].path, pages => {
    const { items } = pages[0];
    assert.equal(items.length, first.stats.draws);
    const left = Math.min(...items.map(i => i.view[4]));
    const right = Math.max(...items.map(i => i.view[4]));
    // Enlarged step: adjacent columns cannot overlap the 12pt glyphs.
    const xs = [...new Set(items.map(i => i.view[4]))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] > 12, `grid step must grow: ${xs[i] - xs[i - 1]}`);
    assert.ok(right > left);
    positions = items.map(i => [i.view[4], i.view[5]]);
  });
  await inspect(second.outputs[0].path, pages => {
    assert.deepEqual(pages[0].items.map(i => [i.view[4], i.view[5]]), positions, 'tile grid must be deterministic');
  });
});

test('tile with a margin that leaves no room is rejected without output', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  await assert.rejects(watermark(s.ctx({ tile: true, margin: 100 })), e => e.code === 'INVALID_OPTIONS');
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('small PNG image is centered, embedded once per draw and never upscaled', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const image = path.join(s.dir, 'small.png');
  fs.writeFileSync(image, solidPng(40, 20));
  const before = fs.readFileSync(s.file);
  const result = await watermark(s.ctx({ kind: 'image', imagePath: image, opacity: 60, angle: 0 }));
  assert.deepEqual(result.stats, { pages: 1, draws: 1 });
  assert.deepEqual(fs.readFileSync(s.file), before);
  const loaded = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  const page = loaded.getPage(0);
  const object = imageObjects(loaded, page)[0];
  assert.deepEqual([object.width, object.height], [40, 20], 'PNG pixels embedded at natural size');
  const draws = imageDraws((await contentStreams(result.outputs[0].path))[0]);
  assert.equal(draws.length, 1);
  near(draws[0].width, 40, 'image is not upscaled');
  near(draws[0].height, 20, 'image is not upscaled');
  near(draws[0].angle, 0, 'image visual angle at zero rotation');
  const box = visibleBox(page);
  near(draws[0].center[0], box.x + box.width / 2, 'image centered horizontally');
  near(draws[0].center[1], box.y + box.height / 2, 'image centered vertically');
  assert.deepEqual(opacityStates(loaded), [0.6]);
});

test('image visual angle follows page rotation on 0/90/180/270 and stays centered', async t => {
  const s = setup(t);
  await fixture(s.file);
  const image = path.join(s.dir, 'angled.png');
  fs.writeFileSync(image, solidPng(24, 12));
  const result = await watermark(s.ctx({ kind: 'image', imagePath: image, opacity: 100, angle: 25 }));
  assert.deepEqual(result.stats, { pages: 4, draws: 4 });
  const streams = await contentStreams(result.outputs[0].path);
  const loaded = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  loaded.getPages().forEach((page, i) => {
    const draw = imageDraws(streams[i])[0];
    near(draw.width, 24, `natural width on page ${i + 1}`);
    near(draw.height, 12, `natural height on page ${i + 1}`);
    near(draw.angle, (page.getRotation().angle + 25) % 360, `visual angle maps through page rotation ${i + 1}`);
    const box = visibleBox(page);
    near(draw.center[0], box.x + box.width / 2, `image centered in page space ${i + 1}`);
    near(draw.center[1], box.y + box.height / 2, `image centered in page space ${i + 1}`);
  });
});

test('oversized JPG is scaled down to fit a rotated non-cropped display area', async t => {
  const s = setup(t);
  await fixture(s.file, [90]);
  const result = await watermark(s.ctx({ kind: 'image', imagePath: JPEG, opacity: 35, angle: 0 }));
  const loaded = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  const page = loaded.getPage(0);
  assert.deepEqual(imageObjects(loaded, page)[0], { width: 1200, height: 600 });
  const draws = imageDraws((await contentStreams(result.outputs[0].path))[0]);
  near(draws[0].width, 560, 'JPG width fits the rotated visible width');
  near(draws[0].height, 280, 'JPG keeps its aspect ratio');
  near(draws[0].angle, 90, 'image is upright on a 90-degree page');
  const box = visibleBox(page);
  near(draws[0].center[0], box.x + box.width / 2, 'image centered in page space');
  near(draws[0].center[1], box.y + box.height / 2, 'image centered in page space');
  assert.deepEqual(opacityStates(loaded), [0.35]);
});

test('image mode rejects missing, empty, non-image, unreadable and corrupt paths safely', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  fs.writeFileSync(path.join(s.dir, 'corrupt.png'), 'not a PNG');
  fs.mkdirSync(path.join(s.dir, 'folder.png'));
  const cases = [
    ['', 'INVALID_OPTIONS'],
    [path.join(s.dir, 'missing.png'), 'INVALID_FILE'],
    [path.join(s.dir, 'notes.txt'), 'INVALID_OPTIONS'],
    [path.join(s.dir, 'corrupt.png'), 'INVALID_FILE'],
    [path.join(s.dir, 'folder.png'), 'INVALID_FILE'],
    ['D:/private/secret.png', 'INVALID_FILE'],
    [123, 'INVALID_OPTIONS'],
    ['a\nb.png', 'INVALID_OPTIONS'],
  ];
  for (const [imagePath, code] of cases) {
    await assert.rejects(watermark(s.ctx({ kind: 'image', imagePath })), e =>
      e.code === code
      && !e.message.includes(s.dir)
      && !e.message.includes('private')
      && !e.message.includes('a\nb'), `${JSON.stringify(imagePath)} -> ${code}`);
  }
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('direct invocation rejects invalid text/options safely', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const invalids = [
    { text: '' }, { text: '   ' }, { text: 'one\ntwo' }, { text: 'one\rtwo' },
    { text: 'a\tb' }, { text: 'a\u0000b' }, { text: 'x'.repeat(501) }, { text: 5 },
    { kind: 'video' }, { fontSize: 11 }, { fontSize: 201 }, { fontSize: 12.5 },
    { opacity: -1 }, { opacity: 101 }, { angle: -181 }, { angle: 181 }, { margin: -1 }, { margin: 101 },
    { color: 'red' }, { pages: 2 }, { ['D:/private/secret']: true }, null, [],
  ];
  for (const [index, options] of invalids.entries()) {
    await assert.rejects(watermark(s.ctx(options)), e =>
      e.code === 'INVALID_OPTIONS'
      && !e.message.includes('private')
      && !e.message.includes(s.dir), `invalid option ${index}`);
  }
  const unsupported = Array.from({ length: 80 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
  await assert.rejects(watermark(s.ctx({ text: unsupported })), e => {
    assert.equal(e.code, 'MISSING_GLYPHS');
    assert.ok(e.message.length < 200);
    assert.match(e.message, /U\+4E00/);
    assert.equal(e.message.includes(unsupported), false);
    return true;
  });
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('rejects encrypted PDFs with PASSWORD_REQUIRED and corrupt PDFs with INVALID_FILE', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const locked = path.join(s.dir, 'locked.pdf');
  await runProcess(binaryPath('qpdf.exe', { appRoot: APP, isPackaged: false }), ['--encrypt', 'pw', 'owner', '256', '--', s.file, locked]);
  await assert.rejects(watermark(s.ctx({}, { files: [locked] })), e => e.code === 'PASSWORD_REQUIRED' && !e.message.includes(s.dir));
  fs.writeFileSync(s.file, 'not a PDF');
  await assert.rejects(watermark(s.ctx()), e => e.code === 'INVALID_FILE' && !e.message.includes(s.dir));
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('pre-abort performs no page work or publication', async t => {
  const s = setup(t);
  await fixture(s.file);
  const controller = new AbortController();
  controller.abort();
  const progress = [];
  await assert.rejects(watermark(s.ctx({}, { signal: controller.signal, progress(...args) { progress.push(args); } })), e => e.name === 'AbortError');
  assert.deepEqual(progress, []);
  assert.deepEqual(fs.readdirSync(s.out), []);
});

test('genuine event-loop cancellation after page 1 stops before page 2 and publishes nothing', async t => {
  const s = setup(t);
  await fixture(s.file, Array(20).fill(0));
  const before = fs.readFileSync(s.file);
  const controller = new AbortController();
  const completed = [];
  await assert.rejects(watermark(s.ctx({ text: 'DỪNG', fontSize: 12 }, {
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

test('keeps existing output and source bytes; chooses a unique output name', async t => {
  const s = setup(t);
  await fixture(s.file, [0]);
  const source = fs.readFileSync(s.file);
  const first = await watermark(s.ctx({ text: 'MỘT' }, { outputDir: null }));
  assert.equal(path.basename(first.outputs[0].path), 'source-watermark.pdf');
  const before = fs.readFileSync(first.outputs[0].path);
  const second = await watermark(s.ctx({ text: 'HAI' }, { outputDir: null }));
  assert.equal(path.basename(second.outputs[0].path), 'source-watermark (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), before);
  assert.deepEqual(fs.readFileSync(s.file), source);
});
