// Tiện ích: tải phông ứng viên (file .ttf đầy đủ, KHÔNG phải bản subset của CSS API)
// từ kho google/fonts, để rồi kiểm tra dấu tiếng Việt bằng fonts-coverage.mjs.
//
// Chạy: node test/fonts-fetch.mjs <thư-mục-đích> <family1> <family2> ...
//   ví dụ: node test/fonts-fetch.mjs test/fonts-candidates sacramento allura italianno
//
// Tên family là tên thư mục trong kho (thường là chữ thường, bỏ khoảng trắng):
//   "Pinyon Script" -> pinyonscript · "Gochi Hand" -> gochihand · "IBM Plex Mono" -> ibmplexmono
//
// Ghi chú: ưu tiên file tĩnh (tên không chứa "[") vì phông biến thiên (variable font)
// có thể không được pdf-lib/fontkit nhúng đúng.
import fs from 'fs';
import path from 'path';

const [dirArg, ...families] = process.argv.slice(2);
if (!dirArg || !families.length) {
  console.error('Dùng: node test/fonts-fetch.mjs <thư-mục-đích> <family...>');
  process.exit(2);
}
const OUT_DIR = path.resolve(dirArg);
fs.mkdirSync(OUT_DIR, { recursive: true });

const API = 'https://api.github.com/repos/google/fonts/contents';
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';

async function listDir(p) {
  const r = await fetch(`${API}/${p}`, { headers: { 'user-agent': 'trinh-sua-pdf-font-tool' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} khi liệt kê ${p}`);
  return r.json();
}

/** Chọn file .ttf tốt nhất: tĩnh trước, ưu tiên Regular, tránh Italic/Bold. */
function pickTtf(entries) {
  const ttfs = entries.filter(e => e.type === 'file' && /\.ttf$/i.test(e.name));
  if (!ttfs.length) return null;
  const score = e => {
    const n = e.name;
    let s = 0;
    if (n.includes('[')) s += 100;            // phông biến thiên: tránh
    if (/Italic/i.test(n)) s += 20;
    if (/Bold|Black|Light|Thin|Medium|SemiBold|ExtraBold/i.test(n)) s += 10;
    if (/Regular/i.test(n)) s -= 10;
    return s;
  };
  return ttfs.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0];
}

for (const fam of families) {
  const slug = fam.toLowerCase().replace(/\s+/g, '');
  let entries = null, prefix = null, err = null;
  for (const p of ['ofl', 'apache']) {
    try { entries = await listDir(`${p}/${slug}`); prefix = p; break; }
    catch (e) { err = e; }
  }
  if (!entries) { console.log(`BỎ QUA  ${fam} — không tìm thấy thư mục (${err?.message})`); continue; }

  const pick = pickTtf(entries);
  if (!pick) { console.log(`BỎ QUA  ${fam} — không có file .ttf`); continue; }

  const res = await fetch(`${RAW}/${prefix}/${slug}/${encodeURIComponent(pick.name)}`);
  if (!res.ok) { console.log(`LỖI     ${fam} — HTTP ${res.status} khi tải ${pick.name}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, pick.name), buf);
  console.log(`OK      ${fam} → ${pick.name} (${(buf.length / 1024).toFixed(0)} KB, ${prefix})`);
  await new Promise(r => setTimeout(r, 150));
}

console.log(`\nĐã tải vào ${OUT_DIR}`);
console.log(`Kiểm tra dấu tiếng Việt: node test/fonts-coverage.mjs --dir ${path.relative(process.cwd(), OUT_DIR)} --no-write`);
