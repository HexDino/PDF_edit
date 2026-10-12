// Kiểm tra độ phủ ký tự tiếng Việt của mọi phông trong renderer/fonts/.
// Tag "vietnamese" của Google Fonts KHÔNG đảm bảo đủ dấu chồng, nên phải tự kiểm.
//
// Chạy: node test/fonts-coverage.mjs            (báo cáo, exit 1 nếu có phông thiếu dấu)
//       node test/fonts-coverage.mjs --strict   (như trên, nhưng coi phông thiếu là lỗi cứng)
//       node test/fonts-coverage.mjs --json     (chỉ in JSON)
//
// Kết quả còn được ghi vào renderer/fonts/coverage.json để UI gắn nhãn cảnh báo.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { APP_ROOT, TEST_ROOT } from './_paths.mjs';

const require = createRequire(path.join(TEST_ROOT, 'tools', 'package.json'));
let fontkit;
try {
  fontkit = require('@pdf-lib/fontkit');
} catch {
  console.error('Thiếu @pdf-lib/fontkit. Chạy: cd test/tools && npm install');
  process.exit(2);
}

const FONTS_DIR = (() => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : path.join(APP_ROOT, 'renderer', 'fonts');
})();
const OUT_JSON = path.join(FONTS_DIR, 'coverage.json');
const WRITE_JSON = !process.argv.includes('--no-write');

/* ---------- Bộ 136 ký tự tiếng Việt dựng sẵn (68 thường + 68 hoa) ----------
   Gồm 6 nguyên âm mang dấu đặc trưng của tiếng Việt (ă â ê ô ơ ư) hợp với
   5 dấu thanh (sắc huyền hỏi ngã nặng), cộng a e i o u y và đ. */
const GROUPS = {
  a: 'aáàảãạ', ă: 'ăắằẳẵặ', â: 'âấầẩẫậ', e: 'eéèẻẽẹ', ê: 'êếềểễệ',
  i: 'iíìỉĩị', o: 'oóòỏõọ', ô: 'ôốồổỗộ', ơ: 'ơớờởỡợ', u: 'uúùủũụ',
  ư: 'ưứừửữự', y: 'yýỳỷỹỵ', đ: 'đ',
};
const LOWER = [...new Set(Object.values(GROUPS).join(''))];
const VIET = [...new Set([...LOWER, ...LOWER.map(c => c.toUpperCase())])];
const VIET_SET = new Set(VIET);

/** Lấy tập codepoint của font, chịu được nhiều phiên bản fontkit. */
function charSetOf(font) {
  if (font.characterSet) return new Set(font.characterSet);
  const s = new Set();
  const numGlyphs = font.numGlyphs ?? 0;
  for (let g = 0; g < numGlyphs; g++) {
    const cp = font.glyphForGlyphId?.(g)?.codePoints;
    if (cp) for (const c of cp) s.add(c);
  }
  return s;
}

function checkFile(file) {
  const buf = fs.readFileSync(path.join(FONTS_DIR, file));
  const font = fontkit.create(buf);
  const cs = charSetOf(font);
  const missing = VIET.filter(ch => !cs.has(ch.codePointAt(0)));
  const coverage = (VIET.length - missing.length) / VIET.length;
  return {
    file,
    name: font.familyName || font.postscriptName || file,
    numGlyphs: font.numGlyphs ?? null,
    total: VIET.length,
    missing: missing.length,
    coverage: +coverage.toFixed(4),
    missingChars: missing.join(''),
  };
}

const files = fs.readdirSync(FONTS_DIR)
  .filter(f => f.toLowerCase().endsWith('.ttf'))
  .filter(f => !/^BeVietnamPro/i.test(f))   // phông giao diện, không cần dấu viết tay
  .sort();

if (!files.length) { console.error('Không tìm thấy .ttf nào trong ' + FONTS_DIR); process.exit(2); }

const rows = files.map(f => {
  try { return checkFile(f); }
  catch (e) { return { file: f, error: e.message, coverage: 0, missing: VIET.length, missingChars: '' }; }
});

const jsonMode = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

if (!jsonMode) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nĐộ phủ ${VIET.length} ký tự tiếng Việt (${LOWER.length} thường + ${LOWER.length} hoa)\n`);
  console.log(pad('PHÔNG', 34) + pad('GLYPH', 7) + pad('ĐỦ', 5) + pad('PHỦ', 8) + 'THIẾU');
  console.log('-'.repeat(96));
  for (const r of rows.sort((a, b) => a.coverage - b.coverage)) {
    const ok = r.missing === 0 ? 'OK' : 'THIẾU';
    console.log(
      pad(r.file.replace(/\.ttf$/i, ''), 34) +
      pad(r.error ? '?' : r.numGlyphs, 7) +
      pad(ok, 5) +
      pad((r.coverage * 100).toFixed(1) + '%', 8) +
      (r.error ? 'LỖI: ' + r.error : (r.missingChars || '').slice(0, 60))
    );
  }
}

const bad = rows.filter(r => r.missing > 0);
// Chỉ ghi lại khi phần dữ liệu phông thay đổi — tránh làm file bị "sửa" chỉ vì mốc thời gian,
// khiến mỗi lần chạy test đều tạo diff rác.
const payload = Object.fromEntries(rows.map(r => [r.file, { coverage: r.coverage, missing: r.missingChars, error: r.error || null }]));
let unchanged = false;
try {
  const old = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  unchanged = JSON.stringify(old.fonts) === JSON.stringify(payload);
} catch { /* chưa có file */ }
if (WRITE_JSON && !unchanged) fs.writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: VIET.length,
  probe: VIET.join(''),
  fonts: payload,
}, null, 2));

if (!jsonMode) {
  if (WRITE_JSON) console.log(unchanged ? `\n${path.relative(APP_ROOT, OUT_JSON)} không đổi, giữ nguyên file cũ` : `\nĐã ghi ${path.relative(APP_ROOT, OUT_JSON)}`);
  if (bad.length) {
    console.log(`\n⚠ ${bad.length}/${rows.length} phông THIẾU ký tự tiếng Việt:`);
    for (const b of bad) console.log(`   · ${b.file} — thiếu ${b.missing}/${VIET.length}`);
  } else {
    console.log(`\n✓ Cả ${rows.length} phông đều đủ ${VIET.length} ký tự tiếng Việt.`);
  }
}

// Có phông thiếu dấu -> coi là lỗi (để không lọt phông lỗi vào bản phát hành)
process.exit(bad.length && (strict || !jsonMode) ? 1 : 0);
