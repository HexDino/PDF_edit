// Trình sửa PDF – giao diện (chạy được cả trong Electron lẫn trình duyệt để kiểm thử)
import * as pdfjsLib from './vendor/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const { PDFDocument, degrees, rgb } = PDFLib;
const API = window.api || null;
const $ = id => document.getElementById(id);
const LH = 1.25;

/* ======================= Phông chữ (đều có sẵn trong ứng dụng) ======================= */
const G_NEAT = 'Chữ viết tay gọn', G_SIGN = 'Kiểu chữ ký', G_DOC = 'Kiểu bác sĩ (viết nhanh)';
const FONTS = [
  ['PatrickHand', 'Patrick Hand', G_NEAT, 'PatrickHand-Regular.ttf'],
  ['Mali', 'Mali', G_NEAT, 'Mali-Regular.ttf'],
  ['Sriracha', 'Sriracha', G_NEAT, 'Sriracha-Regular.ttf'],
  ['PlaywriteVN', 'Playwrite VN (chữ học trò)', G_NEAT, 'PlaywriteVN.ttf'],
  ['BadScript', 'Bad Script', G_NEAT, 'BadScript-Regular.ttf'],
  ['GrapeNuts', 'Grape Nuts', G_NEAT, 'GrapeNuts-Regular.ttf'],
  ['DancingScript', 'Dancing Script', G_SIGN, 'DancingScript.ttf'],
  ['Charm', 'Charm', G_SIGN, 'Charm-Regular.ttf'],
  ['GreatVibes', 'Great Vibes', G_SIGN, 'GreatVibes-Regular.ttf'],
  ['AlexBrush', 'Alex Brush', G_SIGN, 'AlexBrush-Regular.ttf'],
  ['MeaCulpa', 'Mea Culpa', G_SIGN, 'MeaCulpa-Regular.ttf'],
  ['Babylonica', 'Babylonica', G_DOC, 'Babylonica-Regular.ttf'],
  ['Ole', 'Ole', G_DOC, 'Ole-Regular.ttf'],
  ['QwitcherGrypen', 'Qwitcher Grypen', G_DOC, 'QwitcherGrypen-Regular.ttf'],
  ['Shalimar', 'Shalimar', G_DOC, 'Shalimar-Regular.ttf'],
  ['Waterfall', 'Waterfall', G_DOC, 'Waterfall-Regular.ttf'],
  ['Updock', 'Updock', G_DOC, 'Updock-Regular.ttf'],
].map(([key, name, group, file]) => ({ key, name, group, file }));
const fontByKey = k => FONTS.find(f => f.key === k) || FONTS[0];
const SAMPLE = 'Bệnh nhân uống thuốc ngày 2 lần';
const fontBytes = {}, fontReady = {}, baseRatio = {};
const cssFam = k => `'HW-${k}', cursive`;
function measureBaseline(key) {
  const S = 200, d = document.createElement('div');
  d.style.cssText = `position:absolute;left:-99999px;top:0;font-family:${cssFam(key)};font-size:${S}px;line-height:${LH};white-space:pre;font-kerning:none;font-variant-ligatures:none`;
  d.innerHTML = 'Ág<span style="display:inline-block;width:1px;height:0;vertical-align:baseline"></span>';
  document.body.appendChild(d); const r = d.lastChild.offsetTop / S; d.remove(); return r;
}
function loadFont(f) {
  if (!fontReady[f.key]) fontReady[f.key] = (async () => {
    const r = await fetch('fonts/' + f.file); if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer(); fontBytes[f.key] = buf;
    const ff = new FontFace('HW-' + f.key, buf.slice(0)); await ff.load(); document.fonts.add(ff);
    baseRatio[f.key] = measureBaseline(f.key);
    objects.filter(o => o.type === 'text' && o.font === f.key).forEach(layout);
    return buf;
  })().catch(e => { delete fontReady[f.key]; throw e; });
  return fontReady[f.key];
}

/* ======================= Trạng thái ======================= */
let pdfDoc = null, origBytes = null, origName = 'tai-lieu.pdf', origPath = null, lastSavePath = null;
let pages = [];            // {idx, pdfPage, rotate, vp1, M, el, canvas, layer, thumb, rendered, deleted}
let objects = [];          // text | rect | img | ink
const imgStore = {};       // srcId -> {dataUrl, w, h}
let zoom = 1, tool = 'text', prevTool = 'text', selected = null, nextId = 1, dirty = false;
let pendingPlace = null;   // {srcId, sig}
const cur = { font: 'PatrickHand', size: 18, color: '#1a2a7a', slant: 0, jitter: false,
  fill: '#ffffff', autoFill: true, penColor: '#1a2a7a', penW: 1.6, hlColor: '#ffe14d', hlW: 12, trueRemove: true };
const history = [];

function toast(msg, ms = 2800) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function busy(on, txt) { $('busy').classList.toggle('show', on); if (txt) $('busyTxt').textContent = txt; }
function status(txt, st = 'ok') { $('status').textContent = txt; $('dot').className = 'dot ' + st; }
function setDirty(d) { dirty = d; API?.setDirty(d); document.title = (d ? '• ' : '') + (pdfDoc ? origName + ' – ' : '') + 'Trình sửa PDF'; }

/* ======================= Ma trận 2D (dạng PDF [a b c d e f]) ======================= */
const mul = (A, B) => [A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1], A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3], A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5]];
const inv = ([a, b, c, d, e, f]) => { const k = a * d - b * c; return [d / k, -b / k, -c / k, a / k, (c * f - d * e) / k, (b * e - a * f) / k]; };
const T = (x, y) => [1, 0, 0, 1, x, y], S = (x, y) => [x, 0, 0, y, 0, 0];
const R = deg => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/* ======================= Bộ chọn phông ======================= */
function buildPicker() {
  const panel = $('fontPanel'); panel.innerHTML = '';
  for (const g of [G_NEAT, G_SIGN, G_DOC]) {
    const h = document.createElement('div'); h.className = 'fg'; h.textContent = g; panel.appendChild(h);
    for (const f of FONTS.filter(f => f.group === g)) {
      const it = document.createElement('button'); it.className = 'fi'; it.dataset.key = f.key;
      it.innerHTML = '<span class="nm"></span><span class="pv"></span>';
      it.querySelector('.nm').textContent = f.name;
      const pv = it.querySelector('.pv'); pv.textContent = SAMPLE; pv.style.fontFamily = cssFam(f.key);
      it.onclick = () => { closePicker(); chooseFont(f.key); };
      panel.appendChild(it);
    }
  }
}
function openPicker() { FONTS.forEach(f => loadFont(f).catch(() => {})); $('fontPanel').classList.add('open'); $('fontPanel').querySelector('.fi.sel')?.scrollIntoView({ block: 'nearest' }); }
function closePicker() { $('fontPanel').classList.remove('open'); }
$('fontBtn').onclick = e => { e.stopPropagation(); $('fontPanel').classList.contains('open') ? closePicker() : openPicker(); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('.fp')) closePicker(); });
async function chooseFont(key) {
  cur.font = key; syncControls();
  try { await loadFont(fontByKey(key)); } catch { toast('Không đọc được phông ' + key); return; }
  applyToSelected(o => o.type === 'text' && (o.font = key));
}

/* ======================= Mở PDF ======================= */
$('openBtn').onclick = $('openBtn2').onclick = () => openDialog();
async function openDialog() {
  if (API) { const r = await API.openPdfDialog(); if (r) openBytes(r.data, r.name, r.path); }
  else $('fileInput').click();
}
$('fileInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) openBytes(new Uint8Array(await f.arrayBuffer()), f.name, null); };
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer?.files || [])];
  const pdf = files.find(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  const img = files.find(f => /^image\//.test(f.type));
  if (pdf) openBytes(new Uint8Array(await pdf.arrayBuffer()), pdf.name, API?.pathForFile(pdf) || null);
  else if (img && pdfDoc) { startPlaceImage(await fileToDataUrl(img), false); }
  else toast('Vui lòng thả một file PDF');
});

async function openBytes(bytes, name, path) {
  if (dirty && !confirm('Bạn có chỉnh sửa chưa lưu. Mở file khác và bỏ các chỉnh sửa này?')) return;
  busy(true, 'Đang mở PDF…');
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false,
      cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href }).promise;
    if (pdfDoc) pdfDoc.destroy();
    pdfDoc = doc; origBytes = bytes; origName = name || 'tai-lieu.pdf'; origPath = path; lastSavePath = null;
    objects.forEach(o => o.el?.remove()); objects = []; history.length = 0; selected = null;
    $('empty').hidden = true; $('pages').hidden = false; $('pages').innerHTML = ''; $('thumbs').innerHTML = '';
    pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const vp1 = p.getViewport({ scale: 1 });
      const pg = { idx: n - 1, pdfPage: p, rotate: p.rotate, vp1, M: inv(vp1.transform), rendered: -1, deleted: false };
      pg.el = document.createElement('div'); pg.el.className = 'page'; pg.el.dataset.page = n - 1;
      pg.canvas = document.createElement('canvas'); pg.canvas.className = 'pc';
      pg.layer = document.createElement('div'); pg.layer.className = 'layer';
      const num = document.createElement('div'); num.className = 'num'; num.textContent = `Trang ${n} / ${doc.numPages}`;
      const ov = document.createElement('div'); ov.className = 'delOv';
      ov.innerHTML = '<div>Trang này sẽ bị xóa khi lưu <button>↺ Khôi phục</button></div>';
      ov.querySelector('button').onclick = () => togglePageDeleted(pg);
      pg.el.append(pg.canvas, pg.layer, ov, num); $('pages').appendChild(pg.el);
      pg.layer.addEventListener('pointerdown', e => onLayerDown(e, pg));
      pages.push(pg);
      buildThumb(pg);
    }
    fitWidth(true); updateButtons(); setDirty(false);
    status(`${origName} · ${doc.numPages} trang`);
    toast(`Đã mở ${doc.numPages} trang`);
    renderThumbs();
  } catch (e) { console.error(e); toast('Không mở được file: ' + (e.message || e), 6000); status('Lỗi mở file', 'err'); }
  finally { busy(false); }
}

/* ======================= Hiển thị, thu phóng, hình thu nhỏ ======================= */
let renderToken = 0;
async function renderAll() {
  const token = ++renderToken, dpr = Math.min(window.devicePixelRatio || 1, 3);
  for (const pg of pages) { pg.el.style.width = pg.vp1.width * zoom + 'px'; pg.el.style.height = pg.vp1.height * zoom + 'px'; }
  objects.forEach(layout);
  const order = [...pages].sort((a, b) => Math.abs(a.el.getBoundingClientRect().top) - Math.abs(b.el.getBoundingClientRect().top));
  for (const pg of order) {
    if (token !== renderToken) return;
    if (pg.rendered === zoom * dpr) continue;
    const vp = pg.pdfPage.getViewport({ scale: zoom * dpr });
    const c = document.createElement('canvas'); c.className = 'pc';
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = pg.vp1.width * zoom + 'px'; c.style.height = pg.vp1.height * zoom + 'px';
    try { await pg.pdfPage.render({ canvasContext: c.getContext('2d', { willReadFrequently: true }), viewport: vp }).promise; }
    catch (e) { if (token !== renderToken) return; console.error(e); }
    if (token !== renderToken) return;
    pg.canvas.replaceWith(c); pg.canvas = c; pg.rendered = zoom * dpr;
  }
}
function setZoom(z, keepCenter = true) {
  z = Math.max(0.25, Math.min(5, z));
  const v = $('viewer'), rx = (v.scrollLeft + v.clientWidth / 2) / (v.scrollWidth || 1), ry = (v.scrollTop + v.clientHeight / 2) / (v.scrollHeight || 1);
  zoom = z; $('zoomLbl').textContent = Math.round(z * 100) + '%';
  for (const pg of pages) { pg.canvas.style.width = pg.vp1.width * zoom + 'px'; pg.canvas.style.height = pg.vp1.height * zoom + 'px'; }
  renderAll();
  if (keepCenter) { v.scrollLeft = rx * v.scrollWidth - v.clientWidth / 2; v.scrollTop = ry * v.scrollHeight - v.clientHeight / 2; }
}
function fitWidth(initial) {
  if (!pages.length) return;
  const maxW = Math.max(...pages.map(p => p.vp1.width));
  setZoom(Math.min(initial ? 1.3 : 2.5, ($('viewer').clientWidth - 60) / maxW), !initial);
  if (initial) $('viewer').scrollTop = 0;
}
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const zoomIn = () => setZoom(STEPS.find(s => s > zoom + 0.001) || 5);
const zoomOut = () => setZoom([...STEPS].reverse().find(s => s < zoom - 0.001) || 0.25);
$('zoomIn').onclick = zoomIn; $('zoomOut').onclick = zoomOut; $('zoomFit').onclick = () => fitWidth(false);
$('viewer').addEventListener('wheel', e => { if (e.ctrlKey && pages.length) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { pages.forEach(p => p.rendered = -1); renderAll(); }, 200); });

function buildThumb(pg) {
  const th = document.createElement('div'); th.className = 'th';
  th.innerHTML = `<canvas></canvas><div class="n">${pg.idx + 1}</div><button class="tdel" title="Xóa / khôi phục trang">🗑</button>`;
  th.onclick = e => { if (e.target.closest('.tdel')) return; pg.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  th.querySelector('.tdel').onclick = e => { e.stopPropagation(); togglePageDeleted(pg); };
  pg.thumb = th; $('thumbs').appendChild(th);
}
async function renderThumbs() {
  for (const pg of pages) {
    const s = 110 / pg.vp1.width, vp = pg.pdfPage.getViewport({ scale: s * 2 });
    const c = pg.thumb.querySelector('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = '110px'; c.style.height = pg.vp1.height * s + 'px';
    try { await pg.pdfPage.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch {}
  }
}
function togglePageDeleted(pg) {
  pushHistory(); pg.deleted = !pg.deleted; refreshDeleted();
  if (pg.deleted && pages.every(p => p.deleted)) toast('Lưu ý: không thể lưu khi xóa hết các trang');
}
function refreshDeleted() { pages.forEach(p => { p.el.classList.toggle('deleted', p.deleted); p.thumb.classList.toggle('deleted', p.deleted); p.thumb.querySelector('.tdel').textContent = p.deleted ? '↺' : '🗑'; }); }
$('viewer').addEventListener('scroll', () => {
  const vt = $('viewer').getBoundingClientRect().top + 80; let best = pages[0];
  for (const p of pages) if (p.el.getBoundingClientRect().top <= vt) best = p;
  pages.forEach(p => p.thumb.classList.toggle('cur', p === best));
});

/* ======================= Công cụ ======================= */
const CTX_OF = { text: 'text', rect: 'rect', img: 'img', ink: null };
function setTool(t) {
  if (t !== 'pick') prevTool = t;
  tool = t; document.body.className = 'tool-' + t;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t !== 'place') pendingPlace = null;
  syncControls();
}
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { if (!pdfDoc) return toast('Hãy mở file PDF trước'); setTool(b.dataset.tool); });
function ctxTokens() {
  const t = new Set([tool]);
  if (selected) t.add(selected.type === 'ink' ? selected.mode : CTX_OF[selected.type]);
  return t;
}
function syncControls() {
  const toks = ctxTokens();
  document.querySelectorAll('.ctx .sec').forEach(s => s.classList.toggle('show', s.dataset.ctx.split(' ').some(k => toks.has(k))));
  const f = fontByKey(cur.font);
  $('fontBtnTxt').textContent = f.name; $('fontBtnTxt').style.fontFamily = cssFam(f.key); $('heroHand').style.fontFamily = cssFam(f.key);
  document.querySelectorAll('.fi').forEach(i => i.classList.toggle('sel', i.dataset.key === f.key));
  $('sizeIn').value = Math.round(cur.size * 10) / 10; $('slantIn').value = cur.slant; $('jitterIn').checked = cur.jitter;
  const col = colorTarget();
  $('colorIn').value = col;
  document.querySelectorAll('.ctx .sw').forEach(s => s.classList.toggle('sel', s.dataset.c.toLowerCase() === col.toLowerCase()));
  $('fillIn').value = selected?.type === 'rect' ? selected.color : cur.fill;
  $('autoFillIn').checked = cur.autoFill;
  $('penW').value = (selected?.type === 'ink' ? selected.width : (tool === 'hl' ? cur.hlW : cur.penW));
  $('rotIn').value = selected?.type === 'img' ? Math.round(selected.rot) : 0;
  $('recolorBtn').disabled = !(selected?.type === 'img' && selected.sig);
}
function colorTarget() {
  if (selected?.type === 'ink') return selected.color;
  if (selected?.type === 'text') return selected.color;
  if (tool === 'pen') return cur.penColor; if (tool === 'hl') return cur.hlColor;
  return cur.color;
}
function setColor(c) {
  if (selected?.type === 'ink' || (!selected && (tool === 'pen' || tool === 'hl'))) { if (tool === 'hl' || selected?.mode === 'hl') cur.hlColor = c; else cur.penColor = c; }
  else cur.color = c;
  applyToSelected(o => { if (o.type === 'text' || o.type === 'ink') o.color = c; });
  syncControls();
}
$('colorIn').oninput = () => setColor($('colorIn').value);
document.querySelectorAll('.ctx .sw').forEach(s => s.onclick = () => setColor(s.dataset.c));
$('sizeIn').oninput = () => { const v = parseFloat($('sizeIn').value); if (v >= 4 && v <= 200) { cur.size = v; applyToSelected(o => o.type === 'text' && (o.size = v)); } };
$('slantIn').oninput = () => { const v = parseFloat($('slantIn').value); if (v >= 0 && v <= 30) { cur.slant = v; applyToSelected(o => o.type === 'text' && (o.slant = v)); } };
$('jitterIn').onchange = () => { cur.jitter = $('jitterIn').checked; applyToSelected(o => o.type === 'text' && (o.jitter = cur.jitter)); };
$('penW').oninput = () => { const v = parseFloat($('penW').value); if (!(v > 0)) return; if (selected?.type === 'ink') applyToSelected(o => o.width = v); else if (tool === 'hl') cur.hlW = v; else cur.penW = v; };
$('rotIn').oninput = () => { const v = parseFloat($('rotIn').value); if (isFinite(v)) applyToSelected(o => o.type === 'img' && (o.rot = v)); };
$('fillIn').oninput = () => { cur.fill = $('fillIn').value; applyToSelected(o => o.type === 'rect' && (o.color = cur.fill)); };
$('autoFillIn').onchange = () => { cur.autoFill = $('autoFillIn').checked; };
$('autoFillBtn').onclick = () => {
  if (selected?.type === 'rect') { const c = sampleRing(pages[selected.page], selected); applyToSelected(o => o.color = c); cur.fill = c; syncControls(); toast('Đã lấy màu nền xung quanh: ' + c); }
  else toast('Hãy chọn một vùng che trước (hoặc vẽ vùng mới, màu sẽ tự lấy)');
};
$('pickBtn').onclick = () => { if (!pdfDoc) return; setTool('pick'); toast('Bấm vào chỗ có màu nền muốn lấy'); };
document.querySelector('header').addEventListener('pointerdown', e => { if (e.target.closest('input,label,#fontPanel')) return; e.preventDefault(); });

/* ======================= Lấy màu từ trang đã vẽ ======================= */
function canvasScale(pg) { return pg.canvas.width / pg.vp1.width; }
function hex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function sampleRing(pg, r) {
  const k = canvasScale(pg), ctx = pg.canvas.getContext('2d', { willReadFrequently: true });
  const m1 = 1.5 * k, m2 = 7 * k;
  const x0 = Math.max(0, Math.floor(r.x * k - m2)), y0 = Math.max(0, Math.floor(r.y * k - m2));
  const x1 = Math.min(pg.canvas.width, Math.ceil((r.x + r.w) * k + m2)), y1 = Math.min(pg.canvas.height, Math.ceil((r.y + r.h) * k + m2));
  if (x1 <= x0 || y1 <= y0) return '#ffffff';
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, R_ = [], G_ = [], B_ = [];
  const ix0 = r.x * k - m1, iy0 = r.y * k - m1, ix1 = (r.x + r.w) * k + m1, iy1 = (r.y + r.h) * k + m1;
  const step = Math.max(1, Math.round(k / 2));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) continue;
    const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4; R_.push(d[i]); G_.push(d[i + 1]); B_.push(d[i + 2]);
  }
  if (!R_.length) return '#ffffff';
  // màu nền = trung vị của nhóm điểm sáng (bỏ nét chữ tối xung quanh)
  const lum = R_.map((v, i) => 0.299 * v + 0.587 * G_[i] + 0.114 * B_[i]);
  const ord = lum.map((v, i) => i).sort((a, b) => lum[a] - lum[b]);
  const keep = ord.slice(Math.floor(ord.length * 0.35));
  const med = arr => { const s = keep.map(i => arr[i]).sort((a, b) => a - b); return s[s.length >> 1]; };
  return hex(med(R_), med(G_), med(B_));
}
function samplePoint(pg, x, y) {
  const k = canvasScale(pg), ctx = pg.canvas.getContext('2d', { willReadFrequently: true });
  const r = Math.max(1, Math.round(k)), cx = Math.round(x * k), cy = Math.round(y * k);
  const d = ctx.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r + 1, 2 * r + 1).data;
  let s = [0, 0, 0], n = 0; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
  return hex(s[0] / n, s[1] / n, s[2] / n);
}

/* ======================= Lịch sử (hoàn tác) ======================= */
const KEYS = { text: ['x', 'y', 'size', 'color', 'font', 'text', 'slant', 'jitter', 'seed'], rect: ['x', 'y', 'w', 'h', 'color'],
  img: ['x', 'y', 'w', 'h', 'rot', 'srcId', 'sig'], ink: ['pts', 'dx', 'dy', 'color', 'width', 'mode'] };
const plain = o => { const r = { id: o.id, type: o.type, page: o.page }; for (const k of KEYS[o.type]) r[k] = o[k]; return r; };
const snap = () => ({ objs: objects.map(plain), del: pages.map(p => p.deleted) });
function pushHistory(s = snap()) { history.push(JSON.stringify(s)); if (history.length > 300) history.shift(); setDirty(true); updateButtons(); }
function undo() {
  if (!history.length) return;
  const s = JSON.parse(history.pop());
  objects.forEach(o => o.el.remove()); objects = []; selected = null;
  s.objs.forEach(d => createObj(d));
  pages.forEach((p, i) => p.deleted = !!s.del[i]); refreshDeleted();
  updateButtons(); syncControls(); toast('Đã hoàn tác');
}
$('undoBtn').onclick = undo;
function updateButtons() {
  $('undoBtn').disabled = !history.length; $('delBtn').disabled = !selected;
  $('saveBtn').disabled = $('saveAsBtn').disabled = !pdfDoc;
}

/* ======================= Đối tượng trên trang ======================= */
function ptIn(e, pg) { const r = pg.layer.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; }
function onLayerDown(e, pg) {
  if (e.target !== pg.layer) return;
  if (e.button !== 0) return;
  if (document.activeElement?.tagName === 'TEXTAREA') document.activeElement.blur();
  if (pg.deleted) return;
  const [x, y] = ptIn(e, pg);
  if (tool === 'select') { select(null); return; }
  e.preventDefault();
  if (tool === 'text') createTextAt(pg, x, y);
  else if (tool === 'erase') drawRect(e, pg, x, y);
  else if (tool === 'pen' || tool === 'hl') drawInk(e, pg, x, y);
  else if (tool === 'pick') {
    const c = samplePoint(pg, x, y); cur.fill = c;
    applyToSelected(o => o.type === 'rect' && (o.color = c));
    setTool(prevTool === 'pick' ? 'erase' : prevTool); toast('Đã lấy màu ' + c);
  } else if (tool === 'place' && pendingPlace) {
    const im = imgStore[pendingPlace.srcId], ar = im.h / im.w;
    let w = pendingPlace.sig ? 150 : Math.min(260, pg.vp1.width * 0.5), h = w * ar;
    if (pendingPlace.sig && h > 70) { h = 70; w = h / ar; }
    pushHistory();
    const o = createObj({ type: 'img', page: pg.idx, x: x - w / 2, y: y - h / 2, w, h, rot: 0, srcId: pendingPlace.srcId, sig: pendingPlace.sig });
    setTool('select'); select(o); toast('Kéo để di chuyển, góc dưới phải để đổi cỡ, nút tròn phía trên để xoay');
  }
}
function createTextAt(pg, x, y) {
  pushHistory();
  const o = createObj({ type: 'text', page: pg.idx, x, y: Math.max(0, y - cur.size * LH / 2), size: cur.size, color: cur.color, font: cur.font, slant: cur.slant, jitter: cur.jitter, text: '' });
  o.isNew = true; select(o); o.ta.focus(); return o;
}
function drawRect(e, pg, x0, y0) {
  const g = document.createElement('div'); g.className = 'ghost'; pg.layer.appendChild(g);
  let x1 = x0, y1 = y0;
  const upd = () => { const x = Math.min(x0, x1), y = Math.min(y0, y1); Object.assign(g.style, { left: x * zoom + 'px', top: y * zoom + 'px', width: Math.abs(x1 - x0) * zoom + 'px', height: Math.abs(y1 - y0) * zoom + 'px' }); };
  upd();
  const mv = ev => { [x1, y1] = ptIn(ev, pg); upd(); };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); g.remove();
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (r.w < 3 || r.h < 3) return;
    const color = cur.autoFill ? sampleRing(pg, r) : cur.fill;
    pushHistory();
    const o = createObj({ type: 'rect', page: pg.idx, ...r, color });
    setTool('text'); select(o);
    toast('Đã che. Bấm lên vùng che để gõ chữ thay thế · màu nền: ' + color, 4000);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function drawInk(e, pg, x, y) {
  const mode = tool, o = createObj({ type: 'ink', page: pg.idx, pts: [[+x.toFixed(2), +y.toFixed(2)]], dx: 0, dy: 0, mode,
    color: mode === 'hl' ? cur.hlColor : cur.penColor, width: mode === 'hl' ? cur.hlW : cur.penW });
  const before = snap(); before.objs = before.objs.filter(d => d.id !== o.id);
  const mv = ev => { const [a, b] = ptIn(ev, pg), l = o.pts[o.pts.length - 1]; if (Math.hypot(a - l[0], b - l[1]) * zoom < 1.5) return; o.pts.push([+a.toFixed(2), +b.toFixed(2)]); layout(o); };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (o.pts.length === 1) o.pts.push([o.pts[0][0] + 0.01, o.pts[0][1]]); layout(o); pushHistory(before); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

function createObj(d) {
  const o = { ...d, id: d.id || nextId++ };
  nextId = Math.max(nextId, o.id + 1);
  const el = document.createElement('div'); el.className = 'obj'; o.el = el;
  const tools = '<div class="tools"><button class="mv" title="Kéo để di chuyển">✥</button>' + (o.type === 'text' ? '<button class="ed" title="Sửa chữ">✎</button>' : '') + '<button class="del" title="Xóa">✕</button></div>';
  if (o.type === 'text') {
    o.slant ||= 0; o.jitter = !!o.jitter; o.seed ??= (Math.random() * 1e9) >>> 0;
    el.classList.add('tb');
    el.innerHTML = tools + '<div class="lines"></div><textarea spellcheck="false" placeholder="Nhập chữ…" rows="1" wrap="off"></textarea><div class="rs" title="Kéo để đổi cỡ chữ"></div>';
    o.ta = el.querySelector('textarea'); o.ta.value = o.text;
    loadFont(fontByKey(o.font)).catch(() => {});
    wireText(o);
  } else if (o.type === 'rect') {
    el.classList.add('rc'); el.innerHTML = tools + '<div class="rs"></div>';
  } else if (o.type === 'img') {
    el.classList.add('im'); el.innerHTML = tools + '<img alt=""><div class="rs"></div><div class="ro" title="Kéo để xoay"></div>';
    el.querySelector('img').src = imgStore[o.srcId].dataUrl;
    el.querySelector('.ro').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); select(o); startRotate(e, o); });
  } else if (o.type === 'ink') {
    el.classList.add('ink'); if (o.mode === 'hl') el.classList.add('hl');
    el.innerHTML = tools + '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>';
    el.querySelector('path').addEventListener('pointerdown', e => { if (tool !== 'select') return; e.preventDefault(); e.stopPropagation(); select(o); startDrag(e, o); });
  }
  el.querySelector('.mv').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); select(o); startDrag(e, o); });
  el.querySelector('.del').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); deleteObj(o); });
  el.querySelector('.rs')?.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); select(o); startResize(e, o); });
  if (o.type === 'rect' || o.type === 'img') el.addEventListener('pointerdown', e => {
    if (e.target.closest('.tools,.rs,.ro')) return;
    e.preventDefault(); e.stopPropagation();
    if (tool === 'text' && o.type === 'rect') { const [x, y] = ptIn(e, pages[o.page]); createTextAt(pages[o.page], x, y); return; }
    select(o); startDrag(e, o);
  });
  if (o.type !== 'text') el.addEventListener('dblclick', () => { if (o.type === 'rect') addTextInRect(o); });
  pages[o.page].layer.appendChild(el);
  objects.push(o); layout(o);
  return o;
}
function addTextInRect(r) {
  pushHistory();
  const size = Math.max(6, Math.min(cur.size, r.h * 0.7 / LH));
  const t = createObj({ type: 'text', page: r.page, x: r.x + 2, y: r.y + (r.h - size * LH) / 2, size, color: cur.color, font: cur.font, slant: cur.slant, jitter: cur.jitter, text: '' });
  t.isNew = true; setTool('text'); select(t); t.ta.focus();
}

function wireText(o) {
  const ta = o.ta; let before = null;
  ta.addEventListener('focus', () => { before = snap(); select(o); });
  ta.addEventListener('input', () => { o.text = ta.value; layout(o); });
  ta.addEventListener('blur', () => {
    o.text = ta.value.normalize('NFC'); if (ta.value !== o.text) ta.value = o.text;
    if (!o.text.trim()) { removeObj(o); if (o.isNew) { history.pop(); updateButtons(); } else if (before) pushHistory(before); return; }
    if (before && !o.isNew && JSON.stringify(before) !== JSON.stringify(snap())) pushHistory(before);
    o.isNew = false; before = null;
  });
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') { ta.blur(); select(o); } e.stopPropagation(); });
  ta.addEventListener('pointerdown', e => { if (tool === 'select' && document.activeElement !== ta) { e.preventDefault(); select(o); startDrag(e, o); } });
  ta.addEventListener('dblclick', () => ta.focus());
  o.el.querySelector('.ed').addEventListener('click', () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
}

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function lineGeom(o, text) {
  const r = rng(o.seed), j = o.jitter;
  return text.split('\n').map(t => ({ text: t, slant: Math.max(0, Math.min(40, o.slant + (j ? (r() - 0.5) * 4 : 0))),
    rot: j ? (r() - 0.5) * 2.6 : 0, dy: j ? (r() - 0.5) * 0.12 * o.size : 0, dx: j ? (r() - 0.5) * 0.25 * o.size : 0 }));
}
function smoothPath(pts, dx = 0, dy = 0) {
  const p = pts.map(([x, y]) => [x + dx, y + dy]);
  if (p.length < 3) return `M${p[0][0]} ${p[0][1]} L${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
  let d = `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
  for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; d += ` Q${p[i][0].toFixed(2)} ${p[i][1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`; }
  const l = p[p.length - 1]; return d + ` L${l[0].toFixed(2)} ${l[1].toFixed(2)}`;
}
function inkBox(o) {
  const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]), pad = o.width / 2 + 2;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
}

function layout(o) {
  const el = o.el; if (!el) return;
  if (o.type === 'text') {
    const ta = o.ta, s = o.size * zoom;
    el.style.left = o.x * zoom + 'px'; el.style.top = o.y * zoom + 'px';
    ta.style.fontFamily = cssFam(o.font); ta.style.fontSize = s + 'px';
    const m = $('measure'); m.style.fontFamily = ta.style.fontFamily; m.style.fontSize = s + 'px'; m.textContent = ta.value || ta.placeholder;
    ta.style.width = Math.ceil(m.getBoundingClientRect().width + Math.max(4, s * 0.3)) + 'px';
    ta.style.height = Math.ceil((ta.value || ' ').split('\n').length * s * LH) + 'px';
    const holder = el.querySelector('.lines'), br = baseRatio[o.font] ?? 0.95; holder.textContent = '';
    lineGeom(o, ta.value).forEach((g, i) => {
      const sp = document.createElement('div'); sp.className = 'ln'; sp.textContent = g.text || '\u200b';
      sp.style.cssText += `top:${i * s * LH}px;font-family:${cssFam(o.font)};font-size:${s}px;color:${o.color};transform-origin:0 ${br * s}px;` +
        `transform:translate(${g.dx * zoom}px,${g.dy * zoom}px) rotate(${-g.rot}deg) skewX(${-g.slant}deg)`;
      holder.appendChild(sp);
    });
  } else if (o.type === 'rect' || o.type === 'img') {
    Object.assign(el.style, { left: o.x * zoom + 'px', top: o.y * zoom + 'px', width: o.w * zoom + 'px', height: o.h * zoom + 'px' });
    if (o.type === 'rect') el.style.background = o.color;
    else { el.style.transform = `rotate(${o.rot}deg)`; const im = el.querySelector('img'); if (im.getAttribute('src') !== imgStore[o.srcId].dataUrl) im.src = imgStore[o.srcId].dataUrl; }
  } else if (o.type === 'ink') {
    const b = inkBox(o);
    Object.assign(el.style, { left: (b.x + o.dx) * zoom + 'px', top: (b.y + o.dy) * zoom + 'px', width: b.w * zoom + 'px', height: b.h * zoom + 'px' });
    const svg = el.querySelector('svg'); svg.setAttribute('width', b.w * zoom); svg.setAttribute('height', b.h * zoom); svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    const p = svg.querySelector('path'); p.setAttribute('d', smoothPath(o.pts));
    p.setAttribute('stroke', o.color); p.setAttribute('stroke-width', o.width); p.setAttribute('stroke-opacity', o.mode === 'hl' ? 0.45 : 1);
  }
}
function select(o) {
  if (selected && selected !== o) selected.el?.classList.remove('sel');
  selected = o;
  if (o) {
    o.el.classList.add('sel');
    if (o.type === 'text') { cur.font = o.font; cur.size = o.size; cur.color = o.color; cur.slant = o.slant; cur.jitter = o.jitter; }
    if (o.type === 'rect') cur.fill = o.color;
  }
  updateButtons(); syncControls();
}
function removeObj(o) { o.el.remove(); objects = objects.filter(x => x !== o); if (selected === o) { selected = null; syncControls(); } }
function deleteObj(o) { if (!o) return; pushHistory(); o.isNew = false; if (o.ta) o.ta.value = ''; removeObj(o); updateButtons(); }
$('delBtn').onclick = () => deleteObj(selected);
function applyToSelected(fn) {
  if (!selected) return;
  const s0 = snap(); fn(selected); layout(selected);
  if (JSON.stringify(s0) !== JSON.stringify(snap())) pushHistory(s0);
}
function track(onMove, onEnd) {
  const mv = ev => onMove(ev), up = ev => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onEnd?.(ev); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function startDrag(e, o) {
  const sx = e.clientX, sy = e.clientY, s0 = snap(), pg = pages[o.page]; let moved = false;
  const ox = o.type === 'ink' ? o.dx : o.x, oy = o.type === 'ink' ? o.dy : o.y;
  track(ev => {
    moved = true; const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
    if (o.type === 'ink') { o.dx = ox + dx; o.dy = oy + dy; }
    else { o.x = Math.max(-o.w / 2 || -5, Math.min(pg.vp1.width - 5, ox + dx)); o.y = Math.max(-5, Math.min(pg.vp1.height - 5, oy + dy)); }
    layout(o);
  }, () => { if (moved) pushHistory(s0); });
}
function startResize(e, o) {
  const s0 = snap(); let moved = false;
  if (o.type === 'text') {
    const sy = e.clientY, sx = e.clientX, z0 = o.size, h0 = o.ta.offsetHeight, w0 = o.ta.offsetWidth;
    track(ev => { moved = true; const d = Math.max(ev.clientY - sy, (ev.clientX - sx) * h0 / Math.max(1, w0)); o.size = Math.max(4, Math.min(200, z0 * (h0 + d) / h0)); cur.size = o.size; $('sizeIn').value = Math.round(o.size); layout(o); },
      () => { if (moved) pushHistory(s0); });
  } else if (o.type === 'rect') {
    const sx = e.clientX, sy = e.clientY, w0 = o.w, h0 = o.h;
    track(ev => { moved = true; o.w = Math.max(3, w0 + (ev.clientX - sx) / zoom); o.h = Math.max(3, h0 + (ev.clientY - sy) / zoom); layout(o); }, () => { if (moved) pushHistory(s0); });
  } else if (o.type === 'img') {
    const r = pages[o.page].layer.getBoundingClientRect(), cx = r.left + (o.x + o.w / 2) * zoom, cy = r.top + (o.y + o.h / 2) * zoom;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy), w0 = o.w, h0 = o.h, mx = o.x + o.w / 2, my = o.y + o.h / 2;
    track(ev => { moved = true; const k = Math.max(0.05, Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0); o.w = w0 * k; o.h = h0 * k; o.x = mx - o.w / 2; o.y = my - o.h / 2; layout(o); },
      () => { if (moved) pushHistory(s0); });
  }
}
function startRotate(e, o) {
  const s0 = snap(), r = pages[o.page].layer.getBoundingClientRect(), cx = r.left + (o.x + o.w / 2) * zoom, cy = r.top + (o.y + o.h / 2) * zoom; let moved = false;
  track(ev => {
    moved = true; let a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
    if (a > 180) a -= 360; if (ev.shiftKey) a = Math.round(a / 15) * 15; else if (Math.abs(a) < 3) a = 0;
    o.rot = a; $('rotIn').value = Math.round(a); layout(o);
  }, () => { if (moved) pushHistory(s0); });
}

/* ======================= Ảnh & chữ ký ======================= */
let srcSeq = 1;
function addSrc(dataUrl, w, h) { const id = 's' + (srcSeq++) + '-' + Date.now().toString(36); imgStore[id] = { dataUrl, w, h }; return id; }
const fileToDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Ảnh không hợp lệ')); i.src = src; });
async function startPlaceImage(dataUrl, sig) {
  if (!/^data:image\/(png|jpeg)/.test(dataUrl)) { const i0 = await loadImage(dataUrl), c = document.createElement('canvas'); c.width = i0.naturalWidth; c.height = i0.naturalHeight; c.getContext('2d').drawImage(i0, 0, 0); dataUrl = c.toDataURL('image/png'); }
  const im = await loadImage(dataUrl);
  // ảnh lớn: thu nhỏ để file PDF gọn (tối đa 2000 px)
  let url = dataUrl, w = im.naturalWidth, h = im.naturalHeight;
  if (Math.max(w, h) > 2000) { const k = 2000 / Math.max(w, h); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); url = c.toDataURL(/png/.test(dataUrl.slice(0, 30)) ? 'image/png' : 'image/jpeg', 0.92); w = c.width; h = c.height; }
  pendingPlace = { srcId: addSrc(url, w, h), sig };
  setTool('place'); select(null);
  toast(sig ? 'Bấm vào vị trí trên trang để đặt chữ ký' : 'Bấm vào vị trí trên trang để đặt ảnh', 4000);
}
$('imgBtn').onclick = () => { if (!pdfDoc) return toast('Hãy mở file PDF trước'); $('imgInput').click(); };
$('imgInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) startPlaceImage(await fileToDataUrl(f), false); };
$('recolorBtn').onclick = async () => {
  if (selected?.type !== 'img') return;
  const url = await recolor(imgStore[selected.srcId].dataUrl, cur.color), im = imgStore[selected.srcId];
  const id = addSrc(url, im.w, im.h); applyToSelected(o => o.srcId = id);
};
async function recolor(dataUrl, color) {
  const im = await loadImage(dataUrl), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height), [r, g, b] = hexRgb255(color);
  for (let i = 0; i < d.data.length; i += 4) { d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; }
  x.putImageData(d, 0, 0); return c.toDataURL('image/png');
}
const hexRgb255 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// --- Hộp thoại chữ ký
let sigTab = 'draw', libSel = null;
const pad = { strokes: [], color: '#1a2a7a', base: 3.2 };
$('sigBtn').onclick = () => { if (!pdfDoc) return toast('Hãy mở file PDF trước'); openSig(); };
function openSig(tab = 'draw') { $('sigModal').hidden = false; setSigTab(tab); requestAnimationFrame(sizePad); }
function closeModal(m) { m.hidden = true; }
document.querySelectorAll('.modal [data-close]').forEach(b => b.onclick = () => closeModal(b.closest('.modal')));
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => setSigTab(b.dataset.tab));
function setSigTab(t) {
  sigTab = t;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.dlg .tab').forEach(x => x.hidden = x.dataset.tab !== t);
  $('saveLibWrap').style.visibility = t === 'lib' ? 'hidden' : 'visible';
  if (t === 'lib') renderLib(); if (t === 'draw') requestAnimationFrame(sizePad);
}
const padC = $('pad');
function sizePad() { const r = padC.getBoundingClientRect(); if (!r.width) return; padC.width = Math.round(r.width * 2); padC.height = Math.round(r.height * 2); redrawPad(); }
function redrawPad() { const x = padC.getContext('2d'); x.clearRect(0, 0, padC.width, padC.height); pad.strokes.forEach(s => drawStroke(x, s, 0)); }
function drawStroke(x, s, from) {
  // đường cong qua trung điểm, bề rộng thay đổi theo lực bút / tốc độ
  x.strokeStyle = pad.color; x.fillStyle = pad.color; x.lineCap = 'round'; x.lineJoin = 'round';
  const p = s; if (p.length === 1) { x.beginPath(); x.arc(p[0].x, p[0].y, p[0].w / 2, 0, 7); x.fill(); return; }
  for (let i = Math.max(1, from); i < p.length; i++) {
    const a = p[i - 1], b = p[i], pa = p[i - 2] || a;
    const m0 = { x: (pa.x + a.x) / 2, y: (pa.y + a.y) / 2 }, m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    x.beginPath(); x.lineWidth = (a.w + b.w) / 2; x.moveTo(i === 1 ? a.x : m0.x, i === 1 ? a.y : m0.y); x.quadraticCurveTo(a.x, a.y, m1.x, m1.y); x.stroke();
  }
}
let padCur = null;
padC.addEventListener('pointerdown', e => {
  e.preventDefault(); padC.setPointerCapture(e.pointerId);
  const r = padC.getBoundingClientRect(), k = padC.width / r.width;
  const pt = (ev, prev) => {
    const x = (ev.clientX - r.left) * k, y = (ev.clientY - r.top) * k, t = ev.timeStamp, B = pad.base * k;
    let w;
    if (ev.pointerType === 'pen' && ev.pressure > 0) w = B * (0.35 + 0.95 * ev.pressure);
    else if (!prev) w = B;
    else { const v = Math.hypot(x - prev.x, y - prev.y) / Math.max(1, t - prev.t) / k; w = B * Math.max(0.4, Math.min(1.35, 1.35 - v * 0.45)); w = prev.w * 0.65 + w * 0.35; }
    return { x, y, t, w };
  };
  padCur = [pt(e)]; pad.strokes.push(padCur); drawStroke(padC.getContext('2d'), padCur, 0);
  const mv = ev => { const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; for (const c of (evs.length ? evs : [ev])) { const l = padCur[padCur.length - 1], p = pt(c, l); if (Math.hypot(p.x - l.x, p.y - l.y) < 1.2) continue; padCur.push(p); } drawStroke(padC.getContext('2d'), padCur, padCur.length - 2); };
  const up = () => { padC.removeEventListener('pointermove', mv); padC.removeEventListener('pointerup', up); padC.removeEventListener('pointercancel', up); padCur = null; };
  padC.addEventListener('pointermove', mv); padC.addEventListener('pointerup', up); padC.addEventListener('pointercancel', up);
});
$('padUndo').onclick = () => { pad.strokes.pop(); redrawPad(); };
$('padClear').onclick = () => { pad.strokes = []; redrawPad(); };
$('padW').oninput = () => { pad.base = parseFloat($('padW').value); };
document.querySelectorAll('.sw.ps').forEach(s => s.onclick = () => { pad.color = s.dataset.c; document.querySelectorAll('.sw.ps').forEach(x => x.classList.toggle('sel', x === s)); redrawPad(); });
function trimCanvas(c, alphaMin = 8, padPx = 6) {
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let X = 0; X < c.width; X++) if (d[(y * c.width + X) * 4 + 3] > alphaMin) { if (X < x0) x0 = X; if (X > x1) x1 = X; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - padPx); y0 = Math.max(0, y0 - padPx); x1 = Math.min(c.width - 1, x1 + padPx); y1 = Math.min(c.height - 1, y1 + padPx);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
}

// --- Chữ ký từ ảnh: tách nền giấy (kể cả ảnh chụp bị sáng không đều)
let sigSrcImg = null, sigOut = null;
$('sigImgBtn').onclick = () => $('sigImgInput').click();
$('sigImgInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; sigSrcImg = await loadImage(await fileToDataUrl(f)); processSigImage(); };
['bgRemove', 'bgTol', 'sigRecolor', 'sigRecolorC', 'sigCrop'].forEach(id => $(id).addEventListener('input', () => sigSrcImg && processSigImage()));
function processSigImage() {
  const im = sigSrcImg, k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
  const W = Math.max(1, Math.round(im.naturalWidth * k)), H = Math.max(1, Math.round(im.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(im, 0, 0, W, H);
  if ($('bgRemove').checked) {
    const id = x.getImageData(0, 0, W, H), d = id.data, L = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    // bản đồ độ sáng của giấy: lấy giá trị sáng (phân vị 90%) theo từng ô rồi nội suy
    const B = Math.max(8, Math.round(Math.max(W, H) / 24)), gw = Math.ceil(W / B), gh = Math.ceil(H / B), grid = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const vals = []; for (let y = gy * B; y < Math.min(H, gy * B + B); y += 2) for (let X = gx * B; X < Math.min(W, gx * B + B); X += 2) vals.push(L[y * W + X]);
      vals.sort((a, b) => a - b); grid[gy * gw + gx] = vals[Math.floor(vals.length * 0.9)] ?? 255;
    }
    const sm = new Float32Array(gw * gh);   // làm mượt lưới 3x3, lấy max để nét chữ lớn không bị coi là giấy
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { let m = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const yy = gy + j, xx = gx + i; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) m = Math.max(m, grid[yy * gw + xx]); } sm[gy * gw + gx] = m * 0.5 + grid[gy * gw + gx] * 0.5; }
    const tol = parseFloat($('bgTol').value), soft = 10 + tol * 0.5;
    const rc = $('sigRecolor').checked ? hexRgb255($('sigRecolorC').value) : null;
    for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
      const fx = Math.min(gw - 1.001, Math.max(0, X / B - 0.5)), fy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5)), ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
      const ix1 = Math.min(gw - 1, ix + 1), iy1 = Math.min(gh - 1, iy + 1);
      const bg = (sm[iy * gw + ix] * (1 - ax) + sm[iy * gw + ix1] * ax) * (1 - ay) + (sm[iy1 * gw + ix] * (1 - ax) + sm[iy1 * gw + ix1] * ax) * ay;
      const i = y * W + X, dark = bg - L[i];
      const a = Math.max(0, Math.min(1, (dark - tol * 0.6) / soft));
      d[i * 4 + 3] = Math.round(a * 255);
      if (rc) { d[i * 4] = rc[0]; d[i * 4 + 1] = rc[1]; d[i * 4 + 2] = rc[2]; }
      else if (a > 0) { // làm đậm màu mực (bỏ phần lẫn màu giấy)
        const f = Math.min(1, 0.35 + 0.65 * a); for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.round(d[i * 4 + ch] * f);
      }
    }
    x.putImageData(id, 0, 0);
  }
  sigOut = $('sigCrop').checked && $('bgRemove').checked ? (trimCanvas(c, 40, 8) || c) : c;
  const pv = $('sigImgCanvas'); pv.width = sigOut.width; pv.height = sigOut.height; pv.getContext('2d').drawImage(sigOut, 0, 0);
  $('sigImgEmpty').hidden = true;
}

// --- Thư viện chữ ký
const libApi = API ? { list: API.sigList, save: API.sigSave, del: API.sigDelete } : {
  list: async () => JSON.parse(localStorage.getItem('sigLib') || '[]'),
  save: async d => { const l = JSON.parse(localStorage.getItem('sigLib') || '[]'), id = 'sig-' + Date.now(); l.unshift({ id, dataUrl: d }); localStorage.setItem('sigLib', JSON.stringify(l)); return id; },
  del: async id => { localStorage.setItem('sigLib', JSON.stringify(JSON.parse(localStorage.getItem('sigLib') || '[]').filter(x => x.id !== id))); },
};
async function renderLib() {
  const g = $('libGrid'), list = await libApi.list(); g.innerHTML = '';
  if (!list.length) { g.innerHTML = '<div class="libEmpty">Chưa có chữ ký nào. Hãy vẽ hoặc nhập ảnh, chữ ký sẽ được lưu ở đây.</div>'; return; }
  for (const s of list) {
    const it = document.createElement('div'); it.className = 'libItem' + (libSel?.id === s.id ? ' sel' : '');
    it.innerHTML = '<img alt=""><button class="ld" title="Xóa khỏi thư viện">✕</button>'; it.querySelector('img').src = s.dataUrl;
    it.onclick = e => { if (e.target.closest('.ld')) return; libSel = s; renderLib(); };
    it.ondblclick = () => { libSel = s; useSignature(); };
    it.querySelector('.ld').onclick = async e => { e.stopPropagation(); if (confirm('Xóa chữ ký này khỏi thư viện?')) { await libApi.del(s.id); if (libSel?.id === s.id) libSel = null; renderLib(); } };
    g.appendChild(it);
  }
}
$('sigUse').onclick = () => useSignature();
async function useSignature() {
  let url = null;
  if (sigTab === 'draw') {
    if (!pad.strokes.length) return toast('Hãy ký vào ô trước');
    const t = trimCanvas(padC, 8, 6); url = t?.toDataURL('image/png');
  } else if (sigTab === 'image') {
    if (!sigOut) return toast('Hãy chọn ảnh chữ ký');
    url = sigOut.toDataURL('image/png');
  } else { if (!libSel) return toast('Hãy chọn một chữ ký trong thư viện'); url = libSel.dataUrl; }
  if (!url) return;
  if (sigTab !== 'lib' && $('saveLib').checked) { try { await libApi.save(url); } catch (e) { console.warn(e); } }
  closeModal($('sigModal'));
  await startPlaceImage(url, true);
}

/* ======================= Lưu PDF ======================= */
const toRgb = h => { const [r, g, b] = hexRgb255(h); return rgb(r / 255, g / 255, b / 255); };
const dataUrlBytes = u => Uint8Array.from(atob(u.split(',')[1]), c => c.charCodeAt(0));
async function flattenPage(doc, i, rects) {
  // Vẽ lại trang thành ảnh 300 dpi, tô vùng che thẳng vào ảnh -> nội dung cũ bị xóa thật
  const pg = pages[i], p = pg.pdfPage;
  let scale = 300 / 72; const v0 = p.getViewport({ scale: 1, rotation: 0 });
  scale = Math.min(scale, 7000 / Math.max(v0.width, v0.height));
  const vp0 = p.getViewport({ scale, rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp0.width); c.height = Math.ceil(vp0.height);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: x, viewport: vp0, intent: 'print' }).promise;
  for (const r of rects) {
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([a, b]) => { const [px, py] = apply(pg.M, a, b); return vp0.convertToViewportPoint(px, py); });
    x.fillStyle = r.color; x.beginPath(); pts.forEach(([a, b], k) => k ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.fill();
  }
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
  const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const [x0, y0, x1, y1] = p.view;
  const np = doc.insertPage(i, [x1 - x0, y1 - y0]);
  np.setMediaBox(x0, y0, x1 - x0, y1 - y0);
  np.drawImage(img, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  np.setRotation(degrees(((pg.rotate % 360) + 360) % 360));
  doc.removePage(i + 1);
  return np;
}
async function buildPdf(trueRemove) {
  const doc = await PDFDocument.load(origBytes, { ignoreEncryption: true, updateMetadata: false });
  doc.registerFontkit(window.fontkit);
  const items = objects.filter(o => !(o.type === 'text' && !o.text.trim()) && !pages[o.page].deleted);
  const docPages = doc.getPages(), flattened = new Set();
  if (trueRemove) for (const pg of pages) {
    const rects = items.filter(o => o.type === 'rect' && o.page === pg.idx);
    if (rects.length && !pg.deleted) { busy(true, `Đang xóa hẳn nội dung bị che (trang ${pg.idx + 1})…`); docPages[pg.idx] = await flattenPage(doc, pg.idx, rects); flattened.add(pg.idx); }
  }
  busy(true, 'Đang tạo PDF…');
  const fonts = {}, imgs = {}, missing = {};
  for (const key of new Set(items.filter(o => o.type === 'text').map(o => o.font))) {
    const buf = await loadFont(fontByKey(key));
    fonts[key] = await doc.embedFont(new Uint8Array(buf), { subset: false, features: { liga: false, clig: false, calt: false, dlig: false, frac: false, numr: false, dnom: false, kern: false } });
  }
  for (const o of items) {
    const pg = pages[o.page], page = docPages[o.page], rot = ((pg.rotate % 360) + 360) % 360;
    if (o.type === 'rect') {
      if (flattened.has(o.page)) continue;
      const pts = [[o.x, o.y], [o.x + o.w, o.y + o.h]].map(([a, b]) => apply(pg.M, a, b));
      page.drawRectangle({ x: Math.min(pts[0][0], pts[1][0]), y: Math.min(pts[0][1], pts[1][1]), width: Math.abs(pts[1][0] - pts[0][0]), height: Math.abs(pts[1][1] - pts[0][1]), color: toRgb(o.color), borderWidth: 0 });
    } else if (o.type === 'text') {
      const font = fonts[o.font], br = baseRatio[o.font] ?? measureBaseline(o.font), text = o.text.normalize('NFC');
      const cs = new Set(font.getCharacterSet());
      for (const ch of text) if (!/\s/.test(ch) && !cs.has(ch.codePointAt(0))) (missing[o.font] ??= new Set()).add(ch);
      lineGeom(o, text).forEach((g, i) => {
        if (!g.text.length) return;
        const [px, py] = pg.vp1.convertToPdfPoint(o.x + g.dx, o.y + i * o.size * LH + br * o.size + g.dy);
        const A = (rot + g.rot) * Math.PI / 180, t = Math.tan(g.slant * Math.PI / 180), c = Math.cos(A), si = Math.sin(A);
        page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(c, si, c * t - si, si * t + c, px, py));
        page.drawText(g.text, { x: 0, y: 0, size: o.size, font, color: toRgb(o.color) });
        page.pushOperators(PDFLib.popGraphicsState());
      });
    } else if (o.type === 'img') {
      const src = imgStore[o.srcId];
      imgs[o.srcId] ??= /^data:image\/png/.test(src.dataUrl) ? await doc.embedPng(dataUrlBytes(src.dataUrl)) : await doc.embedJpg(dataUrlBytes(src.dataUrl));
      const m = [pg.M, T(o.x + o.w / 2, o.y + o.h / 2), R(o.rot), T(-o.w / 2, o.h / 2), S(1, -1)].reduce(mul);
      page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(...m));
      page.drawImage(imgs[o.srcId], { x: 0, y: 0, width: o.w, height: o.h });
      page.pushOperators(PDFLib.popGraphicsState());
    } else if (o.type === 'ink') {
      const m = mul(pg.M, S(1, -1));
      page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(...m));
      page.drawSvgPath(smoothPath(o.pts, o.dx, o.dy), { x: 0, y: 0, borderColor: toRgb(o.color), borderWidth: o.width,
        borderOpacity: o.mode === 'hl' ? 0.45 : 1, borderLineCap: PDFLib.LineCapStyle.Round, blendMode: o.mode === 'hl' ? PDFLib.BlendMode.Multiply : undefined });
      page.pushOperators(PDFLib.popGraphicsState());
    }
  }
  const del = pages.filter(p => p.deleted).map(p => p.idx).sort((a, b) => b - a);
  if (del.length === pages.length) throw new Error('Không thể xóa hết tất cả các trang');
  del.forEach(i => doc.removePage(i));
  return { bytes: await doc.save(), missing, flattened: flattened.size };
}
function saveName() { return origName.replace(/\.pdf$/i, '') + '-da-chinh-sua.pdf'; }
async function save(saveAs) {
  if (!pdfDoc) return;
  document.activeElement?.blur?.();
  const nRect = objects.filter(o => o.type === 'rect' && !pages[o.page].deleted).length;
  if (nRect) {
    $('saveInfo').textContent = `Có ${nRect} vùng tẩy xóa trên ${new Set(objects.filter(o => o.type === 'rect').map(o => o.page)).size} trang.`;
    $('trueRemove').checked = cur.trueRemove; $('saveModal').hidden = false;
    const ok = await new Promise(res => { $('saveGo').onclick = () => res(true); $('saveModal').querySelectorAll('[data-close]').forEach(b => b.onclick = () => res(false)); });
    $('saveModal').hidden = true; if (!ok) return; cur.trueRemove = $('trueRemove').checked;
  }
  return doSave(saveAs, nRect ? cur.trueRemove : false);
}
async function doSave(saveAs, trueRemove) {
  busy(true, 'Đang tạo PDF…');
  try {
    const { bytes, missing, flattened } = await buildPdf(trueRemove);
    busy(false);
    let where;
    if (API) {
      const def = origPath ? origPath.replace(/[^\\/]*$/, '') + saveName() : saveName();
      where = await API.savePdf({ data: bytes, path: saveAs ? null : lastSavePath, defaultPath: lastSavePath || def });
      if (!where) return;
      lastSavePath = where;
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = saveName(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); where = saveName();
    }
    setDirty(false);
    const miss = Object.entries(missing).map(([k, set]) => `${fontByKey(k).name}: ${[...set].join(' ')}`);
    const msg = `Đã lưu “${where.split(/[\\/]/).pop()}”` + (flattened ? ` · đã xóa hẳn nội dung bị che trên ${flattened} trang` : '') + (miss.length ? ` · Lưu ý, phông không có ký tự → ${miss.join('; ')}` : '');
    toast(msg, 6000); status(msg);
    return where;
  } catch (e) { console.error(e); toast('Lỗi khi lưu PDF: ' + (e.message || e), 7000); status('Lỗi khi lưu', 'err'); }
  finally { busy(false); }
}
$('saveBtn').onclick = () => save(false);
$('saveAsBtn').onclick = () => save(true);

/* ======================= Phím tắt ======================= */
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (c && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
  if (c && k === 'o') { e.preventDefault(); openDialog(); return; }
  if (c && (k === '=' || k === '+')) { e.preventDefault(); zoomIn(); return; }
  if (c && k === '-') { e.preventDefault(); zoomOut(); return; }
  if (!$('sigModal').hidden || !$('saveModal').hidden) { if (k === 'escape') { $('sigModal').hidden = true; } return; }
  const ae = document.activeElement?.tagName; if (ae === 'TEXTAREA' || ae === 'INPUT') return;
  if (c && k === 'z') { e.preventDefault(); undo(); }
  else if ((k === 'delete' || k === 'backspace') && selected) { e.preventDefault(); deleteObj(selected); }
  else if (k === 'escape') { select(null); if (tool === 'place' || tool === 'pick') setTool('select'); }
  else if (!c && pdfDoc && { v: 1, t: 1, e: 1, p: 1, h: 1 }[k]) setTool({ v: 'select', t: 'text', e: 'erase', p: 'pen', h: 'hl' }[k]);
  else if (selected && k.startsWith('arrow') && selected.type !== 'ink') {
    e.preventDefault(); const st = (e.shiftKey ? 10 : 1) / zoom; pushHistory();
    if (k === 'arrowleft') selected.x -= st; if (k === 'arrowright') selected.x += st; if (k === 'arrowup') selected.y -= st; if (k === 'arrowdown') selected.y += st; layout(selected);
  }
});

/* ======================= Khởi động ======================= */
buildPicker(); syncControls(); updateButtons();
loadFont(FONTS[0]).then(() => status('Sẵn sàng · 17 phông viết tay · chạy ngoại tuyến')).catch(() => status('Lỗi tải phông', 'err'));
if (API) {
  API.initialFile().then(f => f && openBytes(f.data, f.name, f.path));
  API.onOpenPath(async p => { const f = await API.readPdf(p); openBytes(f.data, f.name, f.path); });
}
// dùng cho kiểm thử tự động
window.__app = { openBytes, createObj, save, doSave, buildPdf, setTool, chooseFont, sampleRing, select, startPlaceImage, openSig, setSigTab, useSignature, processSigImage,
  get objects() { return objects; }, get pages() { return pages; }, get zoom() { return zoom; }, setZoom, imgStore, baseRatio, cur, pad, loadImage, get sigOut() { return sigOut; } };
