// Trình sửa PDF – giao diện (chạy được cả trong Electron lẫn trình duyệt để kiểm thử)
import * as pdfjsLib from './vendor/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const { PDFDocument, degrees, rgb } = PDFLib;
const API = window.api || null;
const $ = id => document.getElementById(id);
const LH = 1.25;

/* ======================= Phông chữ (đều có sẵn trong ứng dụng) =======================
   Mọi phông ở đây đã được kiểm tra đủ 146 ký tự tiếng Việt bằng test/fonts-coverage.mjs
   (tag "vietnamese" của Google Fonts KHÔNG bảo đảm đủ dấu chồng). */
const G_NEAT = 'Chữ viết tay gọn', G_SIGN = 'Kiểu chữ ký', G_DOC = 'Kiểu bác sĩ (viết nhanh)', G_PRINT = 'In / văn bản';
const FONTS = [
  ['PatrickHand', 'Patrick Hand', G_NEAT, 'PatrickHand-Regular.ttf'],
  ['Mali', 'Mali', G_NEAT, 'Mali-Regular.ttf'],
  ['Sriracha', 'Sriracha', G_NEAT, 'Sriracha-Regular.ttf'],
  ['PlaywriteVN', 'Playwrite VN (chữ học trò)', G_NEAT, 'PlaywriteVN.ttf'],
  ['BadScript', 'Bad Script', G_NEAT, 'BadScript-Regular.ttf'],
  ['GrapeNuts', 'Grape Nuts', G_NEAT, 'GrapeNuts-Regular.ttf'],
  ['Itim', 'Itim', G_NEAT, 'Itim-Regular.ttf'],
  ['Pangolin', 'Pangolin', G_NEAT, 'Pangolin-Regular.ttf'],
  ['DancingScript', 'Dancing Script', G_SIGN, 'DancingScript.ttf'],
  ['Charm', 'Charm', G_SIGN, 'Charm-Regular.ttf'],
  ['GreatVibes', 'Great Vibes', G_SIGN, 'GreatVibes-Regular.ttf'],
  ['AlexBrush', 'Alex Brush', G_SIGN, 'AlexBrush-Regular.ttf'],
  ['MeaCulpa', 'Mea Culpa', G_SIGN, 'MeaCulpa-Regular.ttf'],
  ['Allura', 'Allura', G_SIGN, 'Allura-Regular.ttf'],
  ['Italianno', 'Italianno', G_SIGN, 'Italianno-Regular.ttf'],
  ['PinyonScript', 'Pinyon Script', G_SIGN, 'PinyonScript-Regular.ttf'],
  ['MeowScript', 'Meow Script', G_SIGN, 'MeowScript-Regular.ttf'],
  ['ComforterBrush', 'Comforter Brush', G_SIGN, 'ComforterBrush-Regular.ttf'],
  ['Babylonica', 'Babylonica', G_DOC, 'Babylonica-Regular.ttf'],
  ['Ole', 'Ole', G_DOC, 'Ole-Regular.ttf'],
  ['QwitcherGrypen', 'Qwitcher Grypen', G_DOC, 'QwitcherGrypen-Regular.ttf'],
  ['Shalimar', 'Shalimar', G_DOC, 'Shalimar-Regular.ttf'],
  ['Waterfall', 'Waterfall', G_DOC, 'Waterfall-Regular.ttf'],
  ['Updock', 'Updock', G_DOC, 'Updock-Regular.ttf'],
  ['BeVietnamPro', 'Be Vietnam Pro (chữ in)', G_PRINT, 'BeVietnamPro-Regular.ttf'],
  ['Lora', 'Lora (in có chân)', G_PRINT, 'Lora.ttf'],
  ['PlayfairDisplay', 'Playfair Display (tiêu đề)', G_PRINT, 'PlayfairDisplay.ttf'],
  ['IBMPlexMono', 'IBM Plex Mono (đánh máy)', G_PRINT, 'IBMPlexMono-Regular.ttf'],
  ['JetBrainsMono', 'JetBrains Mono (đánh máy)', G_PRINT, 'JetBrainsMono.ttf'],
].map(([key, name, group, file]) => ({ key, name, group, file }));
/** Thứ tự hiển thị các nhóm; nhóm mới chưa liệt kê sẽ được thêm vào cuối. */
const GROUP_ORDER = [G_NEAT, G_SIGN, G_DOC, G_PRINT];
const allGroups = () => [...GROUP_ORDER, ...new Set(FONTS.map(f => f.group))].filter((g, i, a) => g && a.indexOf(g) === i);
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
  fill: '#ffffff', autoFill: true, penColor: '#1a2a7a', penW: 1.6, hlColor: '#ffe14d', hlW: 12, trueRemove: true,
  eraseShape: 'rect', snapLines: true, fillMode: 'solid', feather: false, brushW: 16,
  flattenFormat: 'auto', flattenQuality: 0.9, flattenDpi: 300 };
const history = [], future = [];   // future: ngăn xếp cho "làm lại" (Ctrl+Y)

function toast(msg, ms = 2800) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function busy(on, txt) { $('busy').classList.toggle('show', on); if (txt) $('busyTxt').textContent = txt; }
function status(txt, st = 'ok') { $('status').textContent = txt; $('dot').className = 'dot ' + st; }
function setDirty(d) {
  dirty = d; API?.setDirty(d);
  document.title = (d ? '• ' : '') + (pdfDoc ? origName + ' – ' : '') + 'Trình sửa PDF';
  if (d && origPath) sessionTag('dirty');
}

/* ======================= Ma trận 2D (dạng PDF [a b c d e f]) ======================= */
const mul = (A, B) => [A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1], A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3], A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5]];
const inv = ([a, b, c, d, e, f]) => { const k = a * d - b * c; return [d / k, -b / k, -c / k, a / k, (c * f - d * e) / k, (b * e - a * f) / k]; };
const T = (x, y) => [1, 0, 0, 1, x, y], S = (x, y) => [x, 0, 0, y, 0, 0];
const R = deg => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/* ======================= Bộ chọn phông ======================= */
const PIN_KEY = 'fontPins', PREVIEW_KEY = 'fontPreviewText';
let fontPins = [], fontPreview = SAMPLE, fontCoverage = {};
try { const p = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); if (Array.isArray(p)) fontPins = p; } catch {}
try { fontPreview = localStorage.getItem(PREVIEW_KEY) || SAMPLE; } catch {}
const isPinned = k => fontPins.includes(k);
const savePins = () => { try { localStorage.setItem(PIN_KEY, JSON.stringify(fontPins)); } catch {} };

// Báo cáo độ phủ dấu tiếng Việt (do test/fonts-coverage.mjs sinh ra) -> gắn nhãn cảnh báo
fetch('fonts/coverage.json').then(r => r.ok ? r.json() : null).then(j => {
  if (j && j.fonts) { fontCoverage = j.fonts; if ($('fontList')) buildPicker(); }
}).catch(() => {});

// Chỉ tải phông khi mục xem trước lọt vào tầm nhìn: nhẹ hơn nhiều so với tải hết một lượt
let fontObserver = null;
function observePreviews() {
  fontObserver?.disconnect();
  fontObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      loadFont(fontByKey(e.target.dataset.key)).catch(() => {});
      fontObserver.unobserve(e.target);
    }
  }, { root: $('fontPanel'), rootMargin: '160px' });
  $('fontList').querySelectorAll('.pv').forEach(el => fontObserver.observe(el));
}

function buildPicker() {
  const list = $('fontList'); if (!list) return;
  const q = ($('fontSearch').value || '').trim().toLowerCase();
  const pvText = ($('fontPreviewText').value || '').trim() || SAMPLE;
  list.innerHTML = '';
  const match = f => !q || f.name.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
  const section = (title, items) => {
    if (!items.length) return;
    const h = document.createElement('div'); h.className = 'fg'; h.textContent = title; list.appendChild(h);
    for (const f of items) {
      const it = document.createElement('div'); it.className = 'fi'; it.dataset.key = f.key;
      it.innerHTML = '<span class="nm"></span><span class="pv"></span><button class="pin"></button>';
      const nm = it.querySelector('.nm'); nm.textContent = f.name;
      const cov = fontCoverage[f.file];
      if (cov && cov.missing) {
        const w = document.createElement('span'); w.className = 'warnGlyph'; w.textContent = '⚠';
        w.title = `Phông này thiếu ${cov.missing.length} ký tự tiếng Việt: ${cov.missing}`;
        nm.appendChild(w);
      }
      const pv = it.querySelector('.pv'); pv.textContent = pvText; pv.dataset.key = f.key; pv.style.fontFamily = cssFam(f.key);
      const pin = it.querySelector('.pin');
      pin.textContent = isPinned(f.key) ? '★' : '☆';
      pin.title = isPinned(f.key) ? 'Bỏ ghim' : 'Ghim phông này lên đầu';
      pin.classList.toggle('on', isPinned(f.key));
      pin.onclick = e => { e.stopPropagation(); fontPins = isPinned(f.key) ? fontPins.filter(k => k !== f.key) : [...fontPins, f.key]; savePins(); buildPicker(); };
      it.onclick = () => { closePicker(); chooseFont(f.key); };
      list.appendChild(it);
    }
  };
  if (!q) section('⭐ Đã ghim', FONTS.filter(f => isPinned(f.key) && match(f)));
  for (const g of allGroups()) section(g, FONTS.filter(f => f.group === g && match(f)));
  if (!list.children.length) list.innerHTML = '<div class="fg">Không tìm thấy phông nào</div>';
  observePreviews();
}
function openPicker() { $('fontPanel').classList.add('open'); buildPicker(); $('fontPanel').querySelector('.fi.sel')?.scrollIntoView({ block: 'nearest' }); }
function closePicker() { $('fontPanel').classList.remove('open'); }
$('fontBtn').onclick = e => { e.stopPropagation(); $('fontPanel').classList.contains('open') ? closePicker() : openPicker(); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('.fp')) closePicker(); });
$('fontSearch').oninput = () => buildPicker();
$('fontPreviewText').oninput = () => { fontPreview = $('fontPreviewText').value; try { localStorage.setItem(PREVIEW_KEY, fontPreview); } catch {} buildPicker(); };
$('fontPreviewText').value = fontPreview;
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
    for (const k in imgStore) delete imgStore[k]; srcSeq = 1; pendingPlace = null;   // dọn ảnh của file trước, tránh rò rỉ bộ nhớ
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
    renderThumbs();
    // Khôi phục phiên chỉnh sửa đã lưu cạnh file gốc (nếu có)
    const restored = await loadSession();
    if (restored > 0) {
      status(`${origName} · ${doc.numPages} trang · đã khôi phục ${restored} đối tượng`, 'ok');
      toast(`Đã khôi phục phiên chỉnh sửa: ${restored} đối tượng`, 5000);
    } else {
      sessionTag(origPath ? 'none' : 'none');
      toast(`Đã mở ${doc.numPages} trang`);
    }
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
const CTX_OF = { text: 'text', rect: 'rect', brush: 'rect', lasso: 'rect', img: 'img', ink: null };
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
  $('fillIn').value = selected && isMask(selected) ? selected.color : cur.fill;
  $('autoFillIn').checked = cur.autoFill;
  document.querySelectorAll('[data-es]').forEach(b => b.classList.toggle('on', b.dataset.es === cur.eraseShape));
  $('snapLines').checked = cur.snapLines;
  $('fillModeIn').value = (selected && isMask(selected) ? selected.fillMode : cur.fillMode) || 'solid';
  $('featherIn').checked = !!(selected && isMask(selected) ? selected.feather : cur.feather);
  $('brushW').value = selected?.type === 'brush' ? selected.width : cur.brushW;
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
$('fillIn').oninput = () => { cur.fill = $('fillIn').value; applyToSelected(o => isMask(o) && (o.color = cur.fill)); };
$('autoFillIn').onchange = () => { cur.autoFill = $('autoFillIn').checked; };
$('snapLines').onchange = () => { cur.snapLines = $('snapLines').checked; };
$('brushW').oninput = () => { const v = parseFloat($('brushW').value); if (v > 0) { cur.brushW = v; applyToSelected(o => o.type === 'brush' && (o.width = v)); } };
$('fillModeIn').onchange = () => { cur.fillMode = $('fillModeIn').value; applyToSelected(o => isMask(o) && (o.fillMode = cur.fillMode)); };
$('featherIn').onchange = () => { cur.feather = $('featherIn').checked; applyToSelected(o => isMask(o) && (o.feather = cur.feather)); };
document.querySelectorAll('[data-es]').forEach(b => b.onclick = () => { cur.eraseShape = b.dataset.es; if (tool !== 'erase') setTool('erase'); else syncControls(); });
$('autoFillBtn').onclick = () => {
  if (selected && isMask(selected)) { const c = sampleRing(pages[selected.page], maskBox(selected)); applyToSelected(o => o.color = c); cur.fill = c; syncControls(); toast('Đã lấy màu nền xung quanh: ' + c); }
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
const KEYS = { text: ['x', 'y', 'size', 'color', 'font', 'text', 'slant', 'jitter', 'seed'],
  rect: ['x', 'y', 'w', 'h', 'color', 'fillMode', 'feather'],
  brush: ['pts', 'width', 'color', 'fillMode', 'feather'],
  lasso: ['pts', 'color', 'fillMode', 'feather'],
  img: ['x', 'y', 'w', 'h', 'rot', 'srcId', 'sig'], ink: ['pts', 'dx', 'dy', 'color', 'width', 'mode'] };
/** Các loại "vùng che" — dùng chung cho tẩy/xoá và flatten. */
const MASK_TYPES = ['rect', 'brush', 'lasso'];
const isMask = o => MASK_TYPES.includes(o.type);
const plain = o => { const r = { id: o.id, type: o.type, page: o.page }; for (const k of KEYS[o.type]) r[k] = o[k]; return r; };
const snap = () => ({ objs: objects.map(plain), del: pages.map(p => p.deleted) });
function pushHistory(s = snap()) {
  history.push(JSON.stringify(s)); if (history.length > 300) history.shift();
  future.length = 0;   // có thao tác mới thì nhánh "làm lại" cũ không còn giá trị
  setDirty(true); updateButtons();
}
/** Dựng lại toàn bộ đối tượng + trạng thái trang từ một ảnh chụp. */
function restoreState(s) {
  objects.forEach(o => o.el?.remove()); objects = []; selected = null;
  s.objs.forEach(d => createObj(d));
  pages.forEach((p, i) => p.deleted = !!s.del[i]); refreshDeleted();
}
function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(snap()));       // lưu trạng thái hiện tại để có thể làm lại
  restoreState(JSON.parse(history.pop()));
  updateButtons(); syncControls(); toast('Đã hoàn tác');
}
function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(snap()));
  restoreState(JSON.parse(future.pop()));
  updateButtons(); syncControls(); toast('Đã làm lại');
}
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;
/** Nhân bản đối tượng đang chọn, lệch đi một chút để thấy ngay là đã tạo thêm. */
function duplicateObj(o) {
  if (!o) return null;
  pushHistory();
  const d = plain(o); delete d.id;
  if (d.pts) d.pts = d.pts.map(([x, y]) => [x + 12, y + 12]);
  else { d.x = (d.x || 0) + 12; d.y = (d.y || 0) + 12; }
  const n = createObj(d);
  setTool('select'); select(n);
  toast('Đã nhân bản đối tượng');
  return n;
}
function updateButtons() {
  $('undoBtn').disabled = !history.length;
  $('redoBtn').disabled = !future.length;
  $('delBtn').disabled = !selected;
  $('saveBtn').disabled = $('saveAsBtn').disabled = !pdfDoc;
  $('saveSessionBtn').disabled = $('clearSessionBtn').disabled = !pdfDoc || !API || !origPath;
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
  else if (tool === 'erase') {
    if (cur.eraseShape === 'brush') drawBrush(e, pg, x, y);
    else if (cur.eraseShape === 'lasso') drawLasso(e, pg, x, y);
    else drawRect(e, pg, x, y);
  }
  else if (tool === 'pen' || tool === 'hl') drawInk(e, pg, x, y);
  else if (tool === 'pick') {
    const c = samplePoint(pg, x, y); cur.fill = c;
    applyToSelected(o => isMask(o) && (o.color = c));
    setTool(prevTool === 'pick' ? 'erase' : prevTool); toast('Đã lấy màu ' + c);
  } else if (tool === 'place' && pendingPlace) {
    const im = imgStore[pendingPlace.srcId];
    let w, h;
    if (pendingPlace.sig) ({ w, h } = sigSize(im.w, im.h));
    else { w = Math.min(260, pg.vp1.width * 0.5); h = w * (im.h / im.w); }
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
/* ---- Bám dòng chữ: lấy hộp bao từng dòng chữ của trang bằng pdf.js ---- */
async function pageLines(pg) {
  if (pg.lines) return pg.lines;
  pg.lines = [];
  try {
    const tc = await pg.pdfPage.getTextContent();
    // Gộp mảnh chữ thành dòng trong hệ toạ độ KHÔNG xoay: với trang xoay 90/270, gộp theo
    // trục y của khung nhìn sẽ dính các dòng khác nhau vào làm một.
    const vp0 = pg.pdfPage.getViewport({ scale: 1, rotation: 0 });
    const box = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      // item.width/height của pdf.js đã ở đơn vị điểm PDF -> không nhân thêm ma trận text
      const [a, b, c, d, e, f] = it.transform;
      const la = Math.hypot(a, b) || 1, lb = Math.hypot(c, d) || 1;
      const nx = [a / la, b / la], ny = [c / lb, d / lb];
      const W = it.width || 0, H = it.height || 10;
      const pdf = [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v]) => [e + nx[0] * u + ny[0] * v, f + nx[1] * u + ny[1] * v]);
      items.push({ ...box(pdf.map(([x, y]) => pg.vp1.convertToViewportPoint(x, y))),   // toạ độ hiển thị
        grp: box(pdf.map(([x, y]) => vp0.convertToViewportPoint(x, y))),              // toạ độ để gộp dòng
        text: it.str });
    }
    items.sort((a, b) => a.grp.y - b.grp.y || a.grp.x - b.grp.x);
    for (const it of items) {
      const line = pg.lines.find(l => it.grp.y < l.grp.y + l.grp.h + 2 && it.grp.y + it.grp.h > l.grp.y - 2);
      if (line) {
        const ux0 = Math.min(line.x, it.x), ux1 = Math.max(line.x + line.w, it.x + it.w);
        const uy0 = Math.min(line.y, it.y), uy1 = Math.max(line.y + line.h, it.y + it.h);
        line.x = ux0; line.w = ux1 - ux0; line.y = uy0; line.h = uy1 - uy0;
        const gx0 = Math.min(line.grp.x, it.grp.x), gx1 = Math.max(line.grp.x + line.grp.w, it.grp.x + it.grp.w);
        const gy0 = Math.min(line.grp.y, it.grp.y), gy1 = Math.max(line.grp.y + line.grp.h, it.grp.y + it.grp.h);
        line.grp.x = gx0; line.grp.w = gx1 - gx0; line.grp.y = gy0; line.grp.h = gy1 - gy0;
        line.text += ' ' + it.text;
      } else pg.lines.push({ x: it.x, y: it.y, w: it.w, h: it.h, grp: { ...it.grp }, text: it.str });
    }
  } catch { /* PDF scan: không có lớp chữ để bám */ }
  return pg.lines;
}
/** Nới khung che cho phủ đúng các dòng chữ giao với nó.
 *  Bề dày dòng (vuông góc với chiều chữ) LUÔN được nới cho đủ; chiều chạy của chữ chỉ
 *  nới khi khung đã phủ hơn nửa dòng. Với trang xoay 90/270 chữ chạy dọc nên hai trục
 *  đổi vai cho nhau — suy ra từ hình dạng hộp bao của dòng. */
function snapRectToLines(lines, r) {
  const hit = lines.filter(l => l.y < r.y + r.h && l.y + l.h > r.y && l.x < r.x + r.w && l.x + l.w > r.x);
  if (!hit.length) return r;
  const PAD = 2;
  if (hit.every(l => l.w >= l.h)) {          // chữ nằm ngang: dày theo y, dài theo x
    const top = Math.min(...hit.map(l => l.y)) - PAD, bot = Math.max(...hit.map(l => l.y + l.h)) + PAD;
    let x0 = r.x, x1 = r.x + r.w;
    const full = hit.filter(l => (Math.min(x1, l.x + l.w) - Math.max(x0, l.x)) > l.w * 0.5);
    if (full.length) { x0 = Math.min(x0, ...full.map(l => l.x)); x1 = Math.max(x1, ...full.map(l => l.x + l.w)); }
    return { x: x0 - PAD, y: top, w: (x1 - x0) + 2 * PAD, h: bot - top };
  }
  // chữ chạy dọc: dày theo x, dài theo y
  const left = Math.min(...hit.map(l => l.x)) - PAD, right = Math.max(...hit.map(l => l.x + l.w)) + PAD;
  let y0 = r.y, y1 = r.y + r.h;
  const full = hit.filter(l => (Math.min(y1, l.y + l.h) - Math.max(y0, l.y)) > l.h * 0.5);
  if (full.length) { y0 = Math.min(y0, ...full.map(l => l.y)); y1 = Math.max(y1, ...full.map(l => l.y + l.h)); }
  return { x: left, y: y0 - PAD, w: right - left, h: (y1 - y0) + 2 * PAD };
}
/** Dòng chữ nằm dưới một điểm (bấm là che luôn cả dòng). */
function lineAt(lines, x, y) {
  return lines.find(l => x >= l.x - 6 && x <= l.x + l.w + 6 && y >= l.y - 6 && y <= l.y + l.h + 6);
}
function drawRect(e, pg, x0, y0) {
  const g = document.createElement('div'); g.className = 'ghost'; pg.layer.appendChild(g);
  let x1 = x0, y1 = y0;
  const boxOf = () => {
    const raw = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    return (cur.snapLines && pg.lines && pg.lines.length) ? snapRectToLines(pg.lines, raw) : raw;
  };
  const upd = () => { const b = boxOf(); Object.assign(g.style, { left: b.x * zoom + 'px', top: b.y * zoom + 'px', width: b.w * zoom + 'px', height: b.h * zoom + 'px' }); };
  upd();
  // nạp danh sách dòng chữ để khung tự bám (PDF scan sẽ bỏ qua)
  if (cur.snapLines && !pg.lines) pageLines(pg).then(() => upd());
  const mv = ev => { [x1, y1] = ptIn(ev, pg); upd(); };
  const up = async () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); g.remove();
    const tiny = Math.abs(x1 - x0) * zoom < 5 && Math.abs(y1 - y0) * zoom < 5;
    if (tiny && cur.snapLines) {   // bấm gọn một chỗ -> che trọn dòng chữ tại đó
      const l = lineAt(await pageLines(pg), x0, y0);
      if (!l) return;
      pushHistory();
      const o = createObj({ type: 'rect', page: pg.idx, x: l.x - 2, y: l.y - 2, w: l.w + 4, h: l.h + 4,
        color: cur.autoFill ? sampleRing(pg, l) : cur.fill, fillMode: cur.fillMode, feather: cur.feather });
      setTool('text'); select(o);
      toast('Đã che cả dòng chữ. Bấm lên vùng che để gõ chữ thay thế.', 4000);
      return;
    }
    const r = boxOf();
    if (r.w < 3 || r.h < 3) return;
    const color = cur.autoFill ? sampleRing(pg, r) : cur.fill;
    pushHistory();
    const o = createObj({ type: 'rect', page: pg.idx, ...r, color, fillMode: cur.fillMode, feather: cur.feather });
    setTool('text'); select(o);
    toast('Đã che. Bấm lên vùng che để gõ chữ thay thế · màu nền: ' + color, 4000);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
/** Cọ xoá: kéo nét, nét đó trở thành vùng bị xoá. */
function drawBrush(e, pg, x, y) {
  const probe = { x: x - 8, y: y - 8, w: 16, h: 16 };
  const color = cur.autoFill ? sampleRing(pg, probe) : cur.fill;
  const o = createObj({ type: 'brush', page: pg.idx, pts: [[+x.toFixed(2), +y.toFixed(2)]],
    width: cur.brushW, color, fillMode: cur.fillMode, feather: cur.feather });
  const before = snap(); before.objs = before.objs.filter(d => d.id !== o.id);
  const mv = ev => { const [a, b] = ptIn(ev, pg), l = o.pts[o.pts.length - 1]; if (Math.hypot(a - l[0], b - l[1]) * zoom < 1.5) return; o.pts.push([+a.toFixed(2), +b.toFixed(2)]); layout(o); };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (o.pts.length === 1) o.pts.push([o.pts[0][0] + 0.01, o.pts[0][1]]);
    layout(o); pushHistory(before); select(o);
    toast('Đã xoá theo nét cọ. Kéo tiếp để xoá thêm.', 3000);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
/** Khoanh vùng tự do: vùng khoanh trở thành vùng bị xoá. */
function drawLasso(e, pg, x, y) {
  const probe = { x: x - 8, y: y - 8, w: 16, h: 16 };
  const color = cur.autoFill ? sampleRing(pg, probe) : cur.fill;
  const o = createObj({ type: 'lasso', page: pg.idx, pts: [[+x.toFixed(2), +y.toFixed(2)]],
    color, fillMode: cur.fillMode, feather: cur.feather });
  const before = snap(); before.objs = before.objs.filter(d => d.id !== o.id);
  const mv = ev => { const [a, b] = ptIn(ev, pg), l = o.pts[o.pts.length - 1]; if (Math.hypot(a - l[0], b - l[1]) * zoom < 1.5) return; o.pts.push([+a.toFixed(2), +b.toFixed(2)]); layout(o); };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (o.pts.length < 3) { removeObj(o); return; }
    layout(o); pushHistory(before); select(o);
    toast('Đã che vùng khoanh. Khoanh tiếp để che thêm vùng khác.', 3000);
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
  const tools = '<div class="tools"><button class="mv" title="Kéo để di chuyển">✥</button>' + (o.type === 'text' ? '<button class="ed" title="Sửa chữ">✎</button>' : '') + '<button class="dup" title="Nhân bản (Ctrl+D)">⧉</button><button class="del" title="Xóa">✕</button></div>';
  if (o.type === 'text') {
    o.slant ||= 0; o.jitter = !!o.jitter; o.seed ??= (Math.random() * 1e9) >>> 0;
    el.classList.add('tb');
    el.innerHTML = tools + '<div class="lines"></div><textarea spellcheck="false" placeholder="Nhập chữ…" rows="1" wrap="off"></textarea><div class="rs" title="Kéo để đổi cỡ chữ"></div>';
    o.ta = el.querySelector('textarea'); o.ta.value = o.text;
    loadFont(fontByKey(o.font)).catch(() => {});
    wireText(o);
  } else if (o.type === 'rect') {
    el.classList.add('rc'); el.innerHTML = tools + '<div class="rs"></div>';
  } else if (o.type === 'brush' || o.type === 'lasso') {
    el.classList.add('msk'); if (o.type === 'lasso') el.classList.add('ls'); if (o.feather) el.classList.add('feather');
    el.innerHTML = tools + `<svg xmlns="http://www.w3.org/2000/svg">${o.type === 'lasso' ? '<polygon/>' : '<path/>'}</svg>`;
    el.querySelector(o.type === 'lasso' ? 'polygon' : 'path').addEventListener('pointerdown', e => {
      if (tool !== 'select') return; e.preventDefault(); e.stopPropagation(); select(o); startDrag(e, o);
    });
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
  el.querySelector('.dup').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); duplicateObj(o); });
  el.querySelector('.rs')?.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); select(o); startResize(e, o); });
  if (isMask(o) || o.type === 'img') el.addEventListener('pointerdown', e => {
    if (e.target.closest('.tools,.rs,.ro')) return;
    e.preventDefault(); e.stopPropagation();
    if (tool === 'text' && isMask(o)) { const [x, y] = ptIn(e, pages[o.page]); createTextAt(pages[o.page], x, y); return; }
    select(o); startDrag(e, o);
  });
  if (o.type !== 'text') el.addEventListener('dblclick', () => { if (isMask(o)) addTextInRect({ ...maskBox(o), page: o.page }); });
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
/** Hộp bao của một vùng che (để định vị DOM và lấy màu nền xung quanh). */
function maskBox(o) {
  if (o.type === 'rect') return { x: o.x, y: o.y, w: o.w, h: o.h };
  const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]);
  const pad = o.type === 'brush' ? o.width / 2 + 2 : 1;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
    w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
}
const polyPath = pts => 'M' + pts.map(p => `${p[0]} ${p[1]}`).join(' L ');

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
    if (o.type === 'rect') { el.style.background = o.color; el.classList.toggle('feather', !!o.feather); }
    else { el.style.transform = `rotate(${o.rot}deg)`; const im = el.querySelector('img'); if (im.getAttribute('src') !== imgStore[o.srcId].dataUrl) im.src = imgStore[o.srcId].dataUrl; }
  } else if (o.type === 'brush' || o.type === 'lasso') {
    const b = maskBox(o);
    Object.assign(el.style, { left: b.x * zoom + 'px', top: b.y * zoom + 'px', width: b.w * zoom + 'px', height: b.h * zoom + 'px' });
    const svg = el.querySelector('svg');
    svg.setAttribute('width', b.w * zoom); svg.setAttribute('height', b.h * zoom); svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    if (o.type === 'lasso') {
      const poly = svg.querySelector('polygon');
      poly.setAttribute('points', o.pts.map(p => p.join(',')).join(' '));
      poly.setAttribute('fill', o.color); poly.setAttribute('fill-opacity', o.feather ? 0.9 : 1);
    } else {
      const p = svg.querySelector('path');
      p.setAttribute('d', polyPath(o.pts)); p.setAttribute('stroke', o.color);
      p.setAttribute('stroke-width', o.width); p.setAttribute('stroke-opacity', o.feather ? 0.9 : 1);
    }
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
    if (isMask(o)) { cur.fill = o.color; cur.fillMode = o.fillMode || 'solid'; cur.feather = !!o.feather; }
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
  // cọ / khoanh không có x,y -> di chuyển bằng cách dịch toàn bộ điểm
  const pts0 = (o.type === 'brush' || o.type === 'lasso') ? o.pts.map(p => [...p]) : null;
  track(ev => {
    moved = true; const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
    if (o.type === 'ink') { o.dx = ox + dx; o.dy = oy + dy; }
    else if (pts0) { o.pts = pts0.map(p => [p[0] + dx, p[1] + dy]); }
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
/** Chuẩn hoá ảnh (đổi sang PNG nếu cần, thu nhỏ nếu quá lớn) rồi lưu vào imgStore. */
async function prepareSrc(dataUrl) {
  if (!/^data:image\/(png|jpeg)/.test(dataUrl)) { const i0 = await loadImage(dataUrl), c = document.createElement('canvas'); c.width = i0.naturalWidth; c.height = i0.naturalHeight; c.getContext('2d').drawImage(i0, 0, 0); dataUrl = c.toDataURL('image/png'); }
  const im = await loadImage(dataUrl);
  // ảnh lớn: thu nhỏ để file PDF gọn (tối đa 2000 px)
  let url = dataUrl, w = im.naturalWidth, h = im.naturalHeight;
  if (Math.max(w, h) > 2000) { const k = 2000 / Math.max(w, h); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); url = c.toDataURL(/png/.test(dataUrl.slice(0, 30)) ? 'image/png' : 'image/jpeg', 0.92); w = c.width; h = c.height; }
  return { srcId: addSrc(url, w, h), w, h };
}
/** Kích thước chữ ký khi đặt lên trang: rộng 150 điểm, không cao quá 70 điểm. */
const SIG_W = 150, SIG_MAX_H = 70;
function sigSize(w, h) {
  const ar = h / w;
  let sw = SIG_W, sh = sw * ar;
  if (sh > SIG_MAX_H) { sh = SIG_MAX_H; sw = sh / ar; }
  return { w: sw, h: sh };
}
/** Trang đang xem (theo vị trí cuộn) — dùng cho "đặt nhanh vào góc". */
function currentPageIdx() {
  if (!pages.length) return 0;
  const vt = $('viewer').getBoundingClientRect().top + 80;
  let best = pages[0];
  for (const p of pages) if (p.el.getBoundingClientRect().top <= vt) best = p;
  return best.idx;
}
/** Đặt chữ ký thẳng vào một góc trang, khỏi phải bấm chọn vị trí.
 *  anchor: 'bl' | 'bc' | 'br'; allPages: đặt lên mọi trang chưa bị xoá. */
async function placeSignatureAt(anchor, allPages, dataUrl) {
  const { srcId, w, h } = await prepareSrc(dataUrl);
  const { w: sw, h: sh } = sigSize(w, h);
  const cur = pages[currentPageIdx()];
  const targets = allPages ? pages.filter(p => !p.deleted)
    : [cur && !cur.deleted ? cur : pages.find(p => !p.deleted)].filter(Boolean);
  if (!targets.length) return toast('Không có trang nào để đặt chữ ký');
  const m = 28;   // lề cách mép trang
  pushHistory();
  let last = null;
  for (const pg of targets) {
    const x = anchor === 'bl' ? m : anchor === 'br' ? Math.max(m, pg.vp1.width - sw - m) : Math.max(0, (pg.vp1.width - sw) / 2);
    const y = Math.max(0, pg.vp1.height - sh - m);
    last = createObj({ type: 'img', page: pg.idx, x, y, w: sw, h: sh, rot: 0, srcId, sig: true });
  }
  setTool('select'); select(last); updateButtons();
  toast(targets.length > 1 ? `Đã đặt chữ ký vào ${targets.length} trang` : 'Đã đặt chữ ký vào góc trang', 3500);
  return last;
}
async function startPlaceImage(dataUrl, sig) {
  const { srcId } = await prepareSrc(dataUrl);
  pendingPlace = { srcId, sig };
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
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height), d = id.data, [r, g, b] = hexRgb255(color);
  // Ảnh đã có alpha thật (PNG nền trong suốt): chỉ đổi màu, giữ nguyên độ trong suốt.
  // Ảnh đục (JPG chụp/scan): dùng độ sáng làm alpha -> nền sáng thành trong suốt,
  // giữ nguyên hình dạng nét. Trước đây ghi đè RGB cả ảnh nên JPG thành khối màu đặc.
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasAlpha = true; break; }
  if (hasAlpha) {
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
      d[i + 3] = Math.round(Math.max(0, Math.min(1, (0.92 - L) / 0.72)) * 255);
    }
  }
  x.putImageData(id, 0, 0); return c.toDataURL('image/png');
}
const hexRgb255 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// --- Hộp thoại chữ ký
let sigTab = 'draw', libSel = null;
let sigSrcImg = null, sigOut = null;   // ảnh gốc nhập vào + kết quả đã tách nền
const pad = { strokes: [], color: '#1a2a7a', base: 3.2 };
$('sigBtn').onclick = () => { if (!pdfDoc) return toast('Hãy mở file PDF trước'); openSig(); };
function openSig(tab = 'draw') {
  // Mở lại hộp thoại phải sạch trạng thái của lần trước: không còn chọn nhầm
  // chữ ký cũ trong thư viện, không giữ ảnh đã tách nền của lần trước.
  libSel = null; sigOut = null; sigSrcImg = null;
  $('sigImgEmpty').hidden = false; $('sigImgCanvas').getContext('2d').clearRect(0, 0, $('sigImgCanvas').width, $('sigImgCanvas').height);
  syncPadControls();
  $('sigModal').hidden = false; setSigTab(tab); requestAnimationFrame(sizePad);
}
function syncPadControls() {
  $('padW').value = pad.base;
  document.querySelectorAll('.sw.ps').forEach(x => x.classList.toggle('sel', x.dataset.c.toLowerCase() === pad.color.toLowerCase()));
}
function closeAllModals() {
  // Escape khi hộp thoại Lưu đang mở phải giải phóng promise trong save(), nếu không sẽ treo
  if (!$('saveModal').hidden) { $('saveModal').querySelector('[data-close]')?.click(); return; }
  if (!$('sigModal').hidden) $('sigModal').hidden = true;
}
function closeModal(m) { m.hidden = true; }
document.querySelectorAll('.modal [data-close]').forEach(b => b.onclick = () => closeModal(b.closest('.modal')));
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => setSigTab(b.dataset.tab));
function setSigTab(t) {
  sigTab = t;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.dlg .tab').forEach(x => x.hidden = x.dataset.tab !== t);
  $('saveLibWrap').style.visibility = t === 'lib' ? 'hidden' : 'visible';
  $('keepPadWrap').style.visibility = t === 'draw' ? 'visible' : 'hidden';
  if (t === 'lib') renderLib(); if (t === 'draw') requestAnimationFrame(sizePad);
}
const padC = $('pad');
/** Hệ số phóng của canvas pad so với kích thước hiển thị (thường 2 để nét mịn). */
function padScale() { const w = padC.getBoundingClientRect().width || 1; return padC.width / w; }
function sizePad() { const r = padC.getBoundingClientRect(); if (!r.width) return; padC.width = Math.round(r.width * 2); padC.height = Math.round(r.height * 2); redrawPad(); }
function redrawPad() { const x = padC.getContext('2d'); x.clearRect(0, 0, padC.width, padC.height); const k = padScale(); pad.strokes.forEach(s => drawStroke(x, s, 0, k)); }
/**
 * Vẽ nét lên canvas. Toạ độ nét được lưu theo đơn vị CSS px của pad (không phụ thuộc
 * kích thước canvas), nên đổi cỡ cửa sổ hay xuất ảnh ở tỉ lệ khác đều cho kết quả
 * nhất quán — trước đây nét lưu theo px canvas nên bị lệch khi canvas đổi cỡ.
 * k = hệ số phóng khi vẽ.
 */
function drawStroke(x, s, from, k = 1) {
  // đường cong qua trung điểm, bề rộng thay đổi theo lực bút / tốc độ
  x.strokeStyle = pad.color; x.fillStyle = pad.color; x.lineCap = 'round'; x.lineJoin = 'round';
  const p = s; if (p.length === 1) { x.beginPath(); x.arc(p[0].x * k, p[0].y * k, p[0].w * k / 2, 0, 7); x.fill(); return; }
  for (let i = Math.max(1, from); i < p.length; i++) {
    const a = p[i - 1], b = p[i], pa = p[i - 2] || a;
    const m0 = { x: (pa.x + a.x) / 2 * k, y: (pa.y + a.y) / 2 * k }, m1 = { x: (a.x + b.x) / 2 * k, y: (a.y + b.y) / 2 * k };
    x.beginPath(); x.lineWidth = (a.w + b.w) / 2 * k; x.moveTo(i === 1 ? a.x * k : m0.x, i === 1 ? a.y * k : m0.y); x.quadraticCurveTo(a.x * k, a.y * k, m1.x, m1.y); x.stroke();
  }
}
let padCur = null;
padC.addEventListener('pointerdown', e => {
  e.preventDefault(); padC.setPointerCapture(e.pointerId);
  const r = padC.getBoundingClientRect();
  const pt = (ev, prev) => {
    const x = ev.clientX - r.left, y = ev.clientY - r.top, t = ev.timeStamp, B = pad.base;
    let w;
    if (ev.pointerType === 'pen' && ev.pressure > 0) w = B * (0.35 + 0.95 * ev.pressure);
    else if (!prev) w = B;
    else { const v = Math.hypot(x - prev.x, y - prev.y) / Math.max(1, t - prev.t); w = B * Math.max(0.4, Math.min(1.35, 1.35 - v * 0.45)); w = prev.w * 0.65 + w * 0.35; }
    return { x, y, t, w };
  };
  padCur = [pt(e)]; pad.strokes.push(padCur); drawStroke(padC.getContext('2d'), padCur, 0, padScale());
  const mv = ev => { const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; for (const c of (evs.length ? evs : [ev])) { const l = padCur[padCur.length - 1], p = pt(c, l); if (Math.hypot(p.x - l.x, p.y - l.y) < 1.2) continue; padCur.push(p); } drawStroke(padC.getContext('2d'), padCur, padCur.length - 2, padScale()); };
  const up = () => {
    padC.removeEventListener('pointermove', mv); padC.removeEventListener('pointerup', up); padC.removeEventListener('pointercancel', up);
    padCur = null;
    // Vẽ lại đầy đủ từ dữ liệu nét: bảo đảm canvas khớp 100% với những gì sẽ được đặt lên trang
    redrawPad();
  };
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
// (sigSrcImg / sigOut đã khai báo ở phần hộp thoại chữ ký phía trên)
$('sigImgBtn').onclick = () => $('sigImgInput').click();
$('sigImgInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; sigSrcImg = await loadImage(await fileToDataUrl(f)); processSigImage(); };
['bgRemove', 'bgTol', 'sigRecolor', 'sigRecolorC', 'sigCrop', 'sigWeight'].forEach(id => $(id).addEventListener('input', () => sigSrcImg && processSigImage()));
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
    const wt = Math.max(0.3, Math.min(2.5, (parseFloat($('sigWeight').value) || 100) / 100));   // làm đậm / mảnh nét
    const rc = $('sigRecolor').checked ? hexRgb255($('sigRecolorC').value) : null;
    for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
      const fx = Math.min(gw - 1.001, Math.max(0, X / B - 0.5)), fy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5)), ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
      const ix1 = Math.min(gw - 1, ix + 1), iy1 = Math.min(gh - 1, iy + 1);
      const bg = (sm[iy * gw + ix] * (1 - ax) + sm[iy * gw + ix1] * ax) * (1 - ay) + (sm[iy1 * gw + ix] * (1 - ax) + sm[iy1 * gw + ix1] * ax) * ay;
      const i = y * W + X, dark = bg - L[i];
      const a = Math.max(0, Math.min(1, ((dark - tol * 0.6) / soft) * wt));
      d[i * 4 + 3] = Math.round(a * 255);
      if (rc) { d[i * 4] = rc[0]; d[i * 4 + 1] = rc[1]; d[i * 4 + 2] = rc[2]; }
      else if (a > 0) { // làm đậm màu mực (bỏ phần lẫn màu giấy)
        const f = Math.min(1, 0.35 + 0.65 * a); for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.round(d[i * 4 + ch] * f);
      }
    }
    x.putImageData(id, 0, 0);
  }
  const cropPad = Math.max(2, Math.round(Math.max(W, H) * 0.012));
  sigOut = $('sigCrop').checked && $('bgRemove').checked ? (trimCanvas(c, 12, cropPad) || c) : c;
  const pv = $('sigImgCanvas'); pv.width = sigOut.width; pv.height = sigOut.height; pv.getContext('2d').drawImage(sigOut, 0, 0);
  $('sigImgEmpty').hidden = true;
}
// Ngưỡng tách nền tự động theo Otsu: tính trên độ sáng của chính ảnh đang nhập,
// thay vì để người dùng mò thanh trượt cho từng ảnh sáng/tối khác nhau.
function autoBgTol() {
  if (!sigSrcImg) return null;
  const k = Math.min(1, 480 / Math.max(sigSrcImg.naturalWidth, sigSrcImg.naturalHeight));
  const W = Math.max(1, Math.round(sigSrcImg.naturalWidth * k)), H = Math.max(1, Math.round(sigSrcImg.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(sigSrcImg, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i++) hist[Math.max(0, Math.min(255, Math.round(L[i])))]++;
  const total = L.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = i; }
  }
  const sorted = Array.from(L).sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.9)] ?? 255;   // độ sáng của giấy (phân vị 90%)
  const tol = Math.max(8, Math.min(120, Math.round((bg - thr) / 1.0)));
  $('bgTol').value = tol;
  return tol;
}
$('bgAutoBtn').onclick = () => {
  if (!sigSrcImg) return toast('Hãy chọn ảnh chữ ký trước');
  const t = autoBgTol(); processSigImage();
  toast('Đã tự chọn độ nhạy tách nền: ' + t);
};

// --- Thư viện chữ ký
// Băm nội dung ảnh để phát hiện chữ ký trùng trong thư viện
async function hashDataUrl(url) {
  const bin = atob(url.split(',')[1] || ''), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 5381; for (const b of bytes) h = ((h << 5) + h + b) >>> 0; return 'djb2-' + h.toString(16);
  }
}
const libApi = API ? { list: API.sigList, save: API.sigSave, del: API.sigDelete } : {
  list: async () => JSON.parse(localStorage.getItem('sigLib') || '[]'),
  save: async d => { const l = JSON.parse(localStorage.getItem('sigLib') || '[]'), id = 'sig-' + Date.now(); l.unshift({ id, dataUrl: d }); localStorage.setItem('sigLib', JSON.stringify(l)); return id; },
  del: async id => { localStorage.setItem('sigLib', JSON.stringify(JSON.parse(localStorage.getItem('sigLib') || '[]').filter(x => x.id !== id))); },
};
async function renderLib() {
  const g = $('libGrid'), list = await libApi.list(); g.innerHTML = '';
  const tab = g.parentElement; tab.querySelector('.libHead')?.remove();
  if (!list.length) { g.innerHTML = '<div class="libEmpty">Chưa có chữ ký nào. Hãy vẽ hoặc nhập ảnh, chữ ký sẽ được lưu ở đây.</div>'; return; }
  const head = document.createElement('div'); head.className = 'libHead';
  head.innerHTML = `<span><b>${list.length}</b> chữ ký trong thư viện</span>`;
  const dupBtn = document.createElement('button');
  dupBtn.textContent = '🧹 Dọn bản trùng';
  dupBtn.onclick = async () => {
    const seen = new Set(); let removed = 0;
    for (const s of list) {
      const h = await hashDataUrl(s.dataUrl);
      if (seen.has(h)) { await libApi.del(s.id); removed++; if (libSel?.id === s.id) libSel = null; }
      else seen.add(h);
    }
    toast(removed ? `Đã xoá ${removed} chữ ký trùng nhau` : 'Không có chữ ký trùng');
    renderLib();
  };
  head.appendChild(dupBtn);
  tab.insertBefore(head, g);
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
/** Ảnh PNG của chữ ký đang vẽ trên pad (null nếu chưa có nét).
 *  Dựng từ dữ liệu nét ở tỉ lệ cố định nên kết quả không phụ thuộc kích thước canvas pad. */
function padSignature() {
  if (!pad.strokes.length) return null;
  const S = 2, pad0 = 8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxW = 0;
  for (const s of pad.strokes) for (const p of s) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.w > maxW) maxW = p.w;
  }
  const m = pad0 + maxW / 2;
  const w = Math.max(1, Math.ceil(maxX - minX + 2 * m)), h = Math.max(1, Math.ceil(maxY - minY + 2 * m));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * S)); c.height = Math.max(1, Math.round(h * S));
  const x = c.getContext('2d');
  x.translate((m - minX) * S, (m - minY) * S);
  pad.strokes.forEach(s => drawStroke(x, s, 0, S));
  return c.toDataURL('image/png');
}
/** Lưu chữ ký vào thư viện, bỏ qua nếu đã có bản y hệt.
 *  Chạy NỀN: không được chặn việc đóng hộp thoại và đặt chữ ký lên trang. */
async function saveSignatureToLib(url) {
  const h = await hashDataUrl(url), list = await libApi.list();
  for (const s of list) if (await hashDataUrl(s.dataUrl) === h) { toast('Chữ ký này đã có trong thư viện, không lưu lại'); return; }
  await libApi.save(url);
}
async function useSignature(opts = {}) {
  let url = null;
  if (sigTab === 'draw') {
    url = padSignature();
    if (!url) return toast('Hãy ký vào ô trước');
  } else if (sigTab === 'image') {
    if (!sigOut) return toast('Hãy chọn ảnh chữ ký');
    url = sigOut.toDataURL('image/png');
  } else { if (!libSel) return toast('Hãy chọn một chữ ký trong thư viện'); url = libSel.dataUrl; }
  if (!url) return;

  const shouldSave = sigTab !== 'lib' && $('saveLib').checked;
  // Không giữ nét cũ trên pad -> lần mở sau bắt đầu với ô ký trắng
  if (sigTab === 'draw' && !$('keepPad').checked) { pad.strokes = []; redrawPad(); }

  // Đóng hộp thoại và đặt chữ ký NGAY; việc băm/lưu thư viện để chạy nền,
  // nếu await trước khi đóng thì hộp thoại còn che trang và cú bấm sẽ bị nuốt.
  closeModal($('sigModal'));
  const done = opts.anchor
    ? placeSignatureAt(opts.anchor, $('sigAllPages').checked, url)
    : startPlaceImage(url, true);
  done.catch(e => { console.error(e); toast('Không đặt được chữ ký: ' + (e.message || e)); });
  if (shouldSave) saveSignatureToLib(url).catch(e => console.warn(e));
}
$('sigAtBL').onclick = () => useSignature({ anchor: 'bl' });
$('sigAtBC').onclick = () => useSignature({ anchor: 'bc' });
$('sigAtBR').onclick = () => useSignature({ anchor: 'br' });

/* ======================= Lưu PDF ======================= */
const toRgb = h => { const [r, g, b] = hexRgb255(h); return rgb(r / 255, g / 255, b / 255); };
const dataUrlBytes = u => Uint8Array.from(atob(u.split(',')[1]), c => c.charCodeAt(0));
const FONT_FEATURES = { liga: false, clig: false, calt: false, dlig: false, frac: false, numr: false, dnom: false, kern: false };
const subsetOk = {}, fontCharSets = {};
/** Tập ký tự gốc của phông (đọc từ file .ttf), dùng để báo ký tự thiếu.
 *  Không dùng font đã nhúng vì khi bật subset, tập ký tự đó chỉ lớn dần theo nội dung đã vẽ. */
function charSetFor(key, buf) {
  if (fontCharSets[key] === undefined) {
    try { fontCharSets[key] = new Set(window.fontkit.create(buf).characterSet); } catch { fontCharSets[key] = null; }
  }
  return fontCharSets[key];
}
/** Thử nhúng với subset trên một tài liệu nháp để biết phông có hỗ trợ không,
 *  tránh làm hỏng tài liệu thật nếu việc nhúng thất bại giữa chừng. */
async function fontSupportsSubset(buf) {
  try {
    const d = await PDFDocument.create();
    d.registerFontkit(window.fontkit);
    await d.embedFont(new Uint8Array(buf), { subset: true, features: FONT_FEATURES });
    return true;
  } catch { return false; }
}
/**
 * Tô nền thông minh cho vùng chữ nhật: lấy màu ngay ngoài 4 góc rồi nội suy
 * (chuyển sắc) hoặc sao chép dải nền phía trên — tốt hơn nhiều so với tô một màu
 * khi nền giấy không đều, có dải màu hoặc có dòng kẻ.
 */
function fillSmart(ctx, box, mask, k) {
  const bx = Math.round(box.x), by = Math.round(box.y);
  const bw = Math.max(1, Math.round(box.w)), bh = Math.max(1, Math.round(box.h));
  const src = ctx.canvas;
  const blur = mask.feather ? `blur(${Math.max(1, Math.round(2 * k))}px)` : '';
  if (mask.fillMode === 'clone') {
    const gap = Math.max(1, Math.round(3 * k));
    const sy = by - bh - gap;
    if (sy >= 0) {
      const tmp = document.createElement('canvas'); tmp.width = bw; tmp.height = bh;
      tmp.getContext('2d').drawImage(src, bx, sy, bw, bh, 0, 0, bw, bh);
      ctx.save(); if (blur) ctx.filter = blur;
      ctx.drawImage(tmp, bx, by); ctx.restore();
      return;
    }
  }
  const m = Math.max(1, Math.round(3 * k));
  const pick = (x, y) => {
    const d = ctx.getImageData(Math.max(0, Math.min(src.width - 1, x)), Math.max(0, Math.min(src.height - 1, y)), 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  };
  const tmp = document.createElement('canvas'); tmp.width = 2; tmp.height = 2;
  const t = tmp.getContext('2d');
  t.fillStyle = pick(bx - m, by - m); t.fillRect(0, 0, 1, 1);
  t.fillStyle = pick(bx + bw + m, by - m); t.fillRect(1, 0, 1, 1);
  t.fillStyle = pick(bx - m, by + bh + m); t.fillRect(0, 1, 1, 1);
  t.fillStyle = pick(bx + bw + m, by + bh + m); t.fillRect(1, 1, 1, 1);
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (blur) ctx.filter = blur;
  ctx.drawImage(tmp, 0, 0, 2, 2, bx, by, bw, bh);
  ctx.restore();
}
/**
 * Vẽ một vùng che lên ctx.
 * map(x, y) -> [cx, cy] đổi toạ độ trang (điểm) sang toạ độ canvas; k là hệ số phóng.
 */
function paintMask(ctx, mask, map, k) {
  if (mask.type === 'brush') {
    ctx.save();
    ctx.strokeStyle = mask.color; ctx.fillStyle = mask.color;
    ctx.lineWidth = mask.width * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (mask.feather) ctx.filter = `blur(${Math.max(1, Math.round(1.5 * k))}px)`;
    if (mask.pts.length === 1) { const [cx, cy] = map(mask.pts[0][0], mask.pts[0][1]); ctx.beginPath(); ctx.arc(cx, cy, mask.width * k / 2, 0, 7); ctx.fill(); }
    else { ctx.beginPath(); mask.pts.forEach(([a, b], i) => { const [cx, cy] = map(a, b); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }); ctx.stroke(); }
    ctx.restore();
  } else if (mask.type === 'lasso') {
    ctx.save();
    ctx.fillStyle = mask.color;
    if (mask.feather) ctx.filter = `blur(${Math.max(1, Math.round(1.5 * k))}px)`;
    ctx.beginPath();
    mask.pts.forEach(([a, b], i) => { const [cx, cy] = map(a, b); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
    ctx.closePath(); ctx.fill(); ctx.restore();
  } else {
    const p = [[mask.x, mask.y], [mask.x + mask.w, mask.y], [mask.x + mask.w, mask.y + mask.h], [mask.x, mask.y + mask.h]].map(([a, b]) => map(a, b));
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (mask.fillMode === 'gradient' || mask.fillMode === 'clone') fillSmart(ctx, box, mask, k);
    else {
      ctx.save(); ctx.fillStyle = mask.color;
      if (mask.feather) ctx.filter = `blur(${Math.max(1, Math.round(1.5 * k))}px)`;
      ctx.beginPath(); p.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
}
/** Vẽ lại một trang thành ảnh và tô các vùng che lên đó. */
async function renderMaskedPage(pg, masks, opts = {}) {
  const p = pg.pdfPage;
  const v0 = p.getViewport({ scale: 1, rotation: 0 });
  const scale = Math.min((opts.dpi || 300) / 72, 7000 / Math.max(v0.width, v0.height));
  const vp0 = p.getViewport({ scale, rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp0.width); c.height = Math.ceil(vp0.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: x, viewport: vp0, intent: 'print' }).promise;
  for (const m of masks) {
    const map = (a, b) => { const [px, py] = apply(pg.M, a, b); return vp0.convertToViewportPoint(px, py); };
    paintMask(x, m, map, scale);
  }
  return c;
}
/** Trang chữ (gần như đơn sắc) nên dùng PNG cho sắc nét; trang ảnh/scan dùng JPEG cho nhẹ.
 *  Đếm tỉ lệ điểm ảnh có màu ĐẬM thay vì độ bão hoà trung bình — nền giấy màu kem
 *  (R,G,B hơi lệch nhau) vẫn là trang chữ, không được coi là ảnh màu. */
function pickAutoFormat(c) {
  const s = 160, k = Math.min(1, s / Math.max(c.width, c.height));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(c.width * k)); t.height = Math.max(1, Math.round(c.height * k));
  const tx = t.getContext('2d', { willReadFrequently: true });
  tx.drawImage(c, 0, 0, t.width, t.height);
  let n = 0, strong = 0;
  try {
    const d = tx.getImageData(0, 0, t.width, t.height).data;
    for (let i = 0; i < d.length; i += 4) {
      n++;
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 28) strong++;
    }
  } catch { return 'jpeg'; }
  return n && strong / n < 0.02 ? 'png' : 'jpeg';
}
async function flattenPage(doc, i, masks, opts = {}) {
  // Vẽ lại trang thành ảnh rồi tô vùng che thẳng vào ảnh -> nội dung cũ bị xóa thật
  const pg = pages[i], p = pg.pdfPage;
  const c = await renderMaskedPage(pg, masks, opts);
  const fmt = opts.format === 'png' ? 'png' : opts.format === 'jpeg' ? 'jpeg' : pickAutoFormat(c);
  const blob = await new Promise(res => c.toBlob(res, fmt === 'png' ? 'image/png' : 'image/jpeg', opts.quality ?? 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const img = fmt === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  const [x0, y0, x1, y1] = p.view;
  const np = doc.insertPage(i, [x1 - x0, y1 - y0]);
  np.setMediaBox(x0, y0, x1 - x0, y1 - y0);
  np.drawImage(img, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  np.setRotation(degrees(((pg.rotate % 360) + 360) % 360));
  doc.removePage(i + 1);
  return { page: np, bytes: blob.size, format: fmt };
}
/** Ảnh vá cho vùng che có nền chuyển sắc / sao chép / mờ mép (chế độ chỉ che phủ). */
function maskPatch(pg, o) {
  const k = canvasScale(pg), b = maskBox(o), pad = Math.ceil(6 * k);
  const sx = Math.round(b.x * k) - pad, sy = Math.round(b.y * k) - pad;
  const w = Math.max(1, Math.round(b.w * k) + 2 * pad), h = Math.max(1, Math.round(b.h * k) + 2 * pad);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(pg.canvas, sx, sy, w, h, 0, 0, w, h);
  paintMask(x, o, (a, bb) => [(a - b.x) * k + pad, (bb - b.y) * k + pad], k);
  return { dataUrl: c.toDataURL('image/png'), box: { x: b.x - pad / k, y: b.y - pad / k, w: w / k, h: h / k } };
}
async function buildPdf(trueRemove, flatOpts = {}) {
  const doc = await PDFDocument.load(origBytes, { ignoreEncryption: true, updateMetadata: false });
  doc.registerFontkit(window.fontkit);
  const items = objects.filter(o => !(o.type === 'text' && !o.text.trim()) && !pages[o.page].deleted);
  const docPages = doc.getPages(), flattened = new Set();
  let flatBytes = 0;
  if (trueRemove) for (const pg of pages) {
    const masks = items.filter(o => isMask(o) && o.page === pg.idx);
    if (masks.length && !pg.deleted) {
      busy(true, `Đang xóa hẳn nội dung bị che (trang ${pg.idx + 1})…`);
      const r = await flattenPage(doc, pg.idx, masks, flatOpts);
      docPages[pg.idx] = r.page; flattened.add(pg.idx); flatBytes += r.bytes;
    }
  }
  busy(true, 'Đang tạo PDF…');
  const fonts = {}, imgs = {}, missing = {};
  for (const key of new Set(items.filter(o => o.type === 'text').map(o => o.font))) {
    const buf = await loadFont(fontByKey(key));
    // Nhúng theo subset để PDF nhẹ hơn nhiều khi dùng nhiều phông; có nhánh dự phòng.
    if (subsetOk[key] === undefined) subsetOk[key] = await fontSupportsSubset(buf);
    fonts[key] = await doc.embedFont(new Uint8Array(buf), { subset: subsetOk[key], features: FONT_FEATURES });
  }
  for (const o of items) {
    const pg = pages[o.page], page = docPages[o.page], rot = ((pg.rotate % 360) + 360) % 360;
    if (isMask(o)) {
      if (flattened.has(o.page)) continue;
      if ((o.fillMode && o.fillMode !== 'solid') || o.feather) {
        // Nền chuyển sắc / sao chép / mờ mép -> nhúng ảnh vá đã dựng từ chính trang
        const patch = maskPatch(pg, o), key = 'patch-' + o.id, b = patch.box;
        imgs[key] ??= await doc.embedPng(dataUrlBytes(patch.dataUrl));
        const m = [pg.M, T(b.x, b.y + b.h), S(1, -1)].reduce(mul);
        page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(...m));
        page.drawImage(imgs[key], { x: 0, y: 0, width: b.w, height: b.h });
        page.pushOperators(PDFLib.popGraphicsState());
      } else if (o.type === 'rect') {
        const pts = [[o.x, o.y], [o.x + o.w, o.y + o.h]].map(([a, b]) => apply(pg.M, a, b));
        page.drawRectangle({ x: Math.min(pts[0][0], pts[1][0]), y: Math.min(pts[0][1], pts[1][1]), width: Math.abs(pts[1][0] - pts[0][0]), height: Math.abs(pts[1][1] - pts[0][1]), color: toRgb(o.color), borderWidth: 0 });
      } else {
        // Cọ / khoanh một màu -> vẽ vector cho nét sắc
        const m = mul(pg.M, S(1, -1));
        page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(...m));
        if (o.type === 'brush') page.drawSvgPath(polyPath(o.pts), { x: 0, y: 0, borderColor: toRgb(o.color), borderWidth: o.width, borderLineCap: PDFLib.LineCapStyle.Round });
        else page.drawSvgPath(polyPath(o.pts) + ' Z', { x: 0, y: 0, color: toRgb(o.color) });
        page.pushOperators(PDFLib.popGraphicsState());
      }
    } else if (o.type === 'text') {
      const font = fonts[o.font], br = baseRatio[o.font] ?? measureBaseline(o.font), text = o.text.normalize('NFC');
      const cs = charSetFor(o.font, fontBytes[o.font]);
      if (cs) for (const ch of text) if (!/\s/.test(ch) && !cs.has(ch.codePointAt(0))) (missing[o.font] ??= new Set()).add(ch);
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
  return { bytes: await doc.save(), missing, flattened: flattened.size, flatBytes };
}
function saveName() { return origName.replace(/\.pdf$/i, '') + '-da-chinh-sua.pdf'; }
/** Bật/tắt phần tuỳ chọn chất lượng ảnh trong hộp thoại Lưu. */
function syncFlatOpts() {
  const on = $('trueRemove').checked;
  $('flatOpts').hidden = !on;
  const fmt = $('flatFormat').value;
  $('flatQuality').disabled = fmt === 'png';
  $('flatHint').textContent = fmt === 'png' ? '· PNG giữ nét tuyệt đối, file thường nặng hơn'
    : fmt === 'jpeg' ? '· JPEG nhẹ hơn nhưng chữ nhỏ có thể hơi mờ'
      : '· Tự động: PNG cho trang chữ, JPEG cho trang scan/ảnh';
}
$('trueRemove').onchange = syncFlatOpts;
$('flatFormat').onchange = syncFlatOpts;
$('flatDpi').onchange = syncFlatOpts;
$('flatQuality').oninput = () => { $('flatQualityLbl').textContent = $('flatQuality').value; };
async function save(saveAs) {
  if (!pdfDoc) return;
  document.activeElement?.blur?.();
  const masks = objects.filter(o => isMask(o) && !pages[o.page].deleted);
  if (masks.length) {
    $('saveInfo').textContent = `Có ${masks.length} vùng tẩy xóa trên ${new Set(masks.map(o => o.page)).size} trang.`;
    $('trueRemove').checked = cur.trueRemove;
    $('flatFormat').value = cur.flattenFormat; $('flatDpi').value = String(cur.flattenDpi);
    $('flatQuality').value = Math.round(cur.flattenQuality * 100); $('flatQualityLbl').textContent = Math.round(cur.flattenQuality * 100);
    syncFlatOpts();
    $('saveModal').hidden = false;
    const ok = await new Promise(res => { $('saveGo').onclick = () => res(true); $('saveModal').querySelectorAll('[data-close]').forEach(b => b.onclick = () => res(false)); });
    $('saveModal').hidden = true; if (!ok) return;
    cur.trueRemove = $('trueRemove').checked;
    cur.flattenFormat = $('flatFormat').value;
    cur.flattenDpi = parseFloat($('flatDpi').value) || 300;
    cur.flattenQuality = (parseFloat($('flatQuality').value) || 90) / 100;
  }
  return doSave(saveAs, masks.length ? cur.trueRemove : false);
}
async function doSave(saveAs, trueRemove) {
  busy(true, 'Đang tạo PDF…');
  try {
    const flatOpts = { format: cur.flattenFormat, quality: cur.flattenQuality, dpi: cur.flattenDpi };
    const { bytes, missing, flattened, flatBytes } = await buildPdf(trueRemove, flatOpts);
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
    // Lưu kèm phiên để mở lại file gốc là sửa tiếp được (PDF đã xuất thì không sửa lại được)
    const sessionOk = await saveSession(true);
    const miss = Object.entries(missing).map(([k, set]) => `${fontByKey(k).name}: ${[...set].join(' ')}`);
    const msg = `Đã lưu “${where.split(/[\\/]/).pop()}”` + (sessionOk ? ` · kèm phiên chỉnh sửa ‹${origName.replace(/\.pdf$/i, '')}.tsp.json›` : '') + (flattened ? ` · đã xóa hẳn nội dung bị che trên ${flattened} trang (ảnh ${Math.round(flatBytes / 1024)} KB)` : '') + (miss.length ? ` · Lưu ý, phông không có ký tự → ${miss.join('; ')}` : '');
    toast(msg, 7000); status(msg);
    return where;
  } catch (e) { console.error(e); toast('Lỗi khi lưu PDF: ' + (e.message || e), 7000); status('Lỗi khi lưu', 'err'); }
  finally { busy(false); }
}
$('saveBtn').onclick = () => save(false);
$('saveAsBtn').onclick = () => save(true);

/* ======================= Phiên chỉnh sửa (.tsp.json) ======================= */
/** File PDF đã lưu là bản "nướng" — không sửa lại được. Phiên lưu các đối tượng đã
 *  thêm/sửa vào một file JSON cạnh PDF gốc, để mở lại file gốc là chỉnh tiếp. */
function buildSession() {
  const used = new Set(objects.filter(o => o.type === 'img').map(o => o.srcId));
  const imgs = {};
  for (const k of used) if (imgStore[k]) imgs[k] = imgStore[k];
  return {
    app: 'TrinhSuaPDF', version: 1, savedAt: new Date().toISOString(),
    pdf: { name: origName, size: origBytes ? origBytes.length : 0, pages: pages.length },
    deleted: pages.map(p => !!p.deleted),
    imgs, objects: objects.map(plain),
  };
}
/** Khôi phục chỉnh sửa từ phiên. Trả về số đối tượng, -1 nếu phiên không dùng được. */
function applySession(s) {
  if (!s || !Array.isArray(s.objects) || !Array.isArray(s.deleted)) return -1;
  // Phiên của tài liệu khác thì bỏ qua — tránh dán nhầm chữ ký sang văn bản khác
  if (s.pdf) {
    if (s.pdf.pages && s.pdf.pages !== pages.length) return -1;
    if (s.pdf.size && origBytes && s.pdf.size !== origBytes.length) return -1;
  }
  objects.forEach(o => o.el?.remove()); objects = []; selected = null;
  for (const k in imgStore) delete imgStore[k];
  srcSeq = 1;
  for (const [k, v] of Object.entries(s.imgs || {})) {
    imgStore[k] = v;
    const m = /^s(\d+)-/.exec(k); if (m) srcSeq = Math.max(srcSeq, +m[1] + 1);
  }
  pages.forEach((p, i) => p.deleted = !!s.deleted[i]);
  objects = s.objects.map(d => createObj(d));
  for (const o of objects) nextId = Math.max(nextId, o.id + 1);
  objects.forEach(layout);
  refreshDeleted(); updateButtons(); syncControls();
  return objects.length;
}
/** Ghi phiên cạnh file PDF gốc. */
async function saveSession(quiet) {
  if (!API || !origPath) { if (!quiet) toast('Chưa biết file gốc nên không lưu được phiên'); return false; }
  try {
    await API.sessionWrite(origPath, buildSession());
    sessionTag('saved');
    if (!quiet) toast('Đã lưu phiên cạnh file gốc — mở lại file gốc là sửa tiếp được', 5000);
    return true;
  } catch (e) { console.warn(e); if (!quiet) toast('Không ghi được phiên: ' + (e.message || e)); return false; }
}
/** Đọc phiên cạnh file gốc (nếu có) và dựng lại chỉnh sửa. */
async function loadSession() {
  if (!API || !origPath) return -1;
  try {
    const s = await API.sessionRead(origPath);
    if (!s) return -1;
    const n = applySession(s);
    if (n < 0) { toast('Có file phiên nhưng không khớp với PDF này nên bỏ qua', 6000); return -1; }
    sessionTag('restored', s.savedAt);
    return n;
  } catch (e) { console.warn(e); return -1; }
}
async function clearSession() {
  if (!API || !origPath) return;
  if (!confirm('Xoá phiên chỉnh sửa của file này?\n\nCác đối tượng đang có trên trang vẫn giữ nguyên, nhưng lần sau mở lại sẽ không tự khôi phục nữa.')) return;
  await API.sessionDelete(origPath);
  setDirty(false); sessionTag('none');
  toast('Đã xoá phiên chỉnh sửa');
}
function sessionTag(state, when) {
  const el = $('sessionTag'); if (!el) return;
  el.hidden = state === 'none' || !origPath;
  el.textContent = state === 'saved' ? '· phiên: đã lưu'
    : state === 'dirty' ? '· phiên: có thay đổi chưa lưu'
      : '· phiên: đã khôi phục';
  el.title = when ? 'Lưu lúc ' + new Date(when).toLocaleString('vi-VN')
    : 'Chỉnh sửa được lưu cạnh file PDF gốc dạng .tsp.json';
}
$('saveSessionBtn').onclick = () => saveSession(false);
$('clearSessionBtn').onclick = () => clearSession();

/* ======================= Phím tắt ======================= */
const homeBtn = document.getElementById('homeBtn');
if (homeBtn) homeBtn.onclick = async () => {
  if (dirty && !confirm('Bạn có chỉnh sửa chưa lưu. Về trang chủ và bỏ các chỉnh sửa này?')) return;
  API?.setDirty?.(false);
  if (API?.suite?.goHome) await API.suite.goHome();
  else location.href = 'index.html';
};
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  // Khi có hộp thoại mở: chỉ xử lý Escape, chặn mọi phím tắt khác (tránh Ctrl+S lưu ngoài ý muốn)
  if (!$('sigModal').hidden || !$('saveModal').hidden) { if (k === 'escape') { e.preventDefault(); closeAllModals(); } return; }
  if (c && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
  if (c && k === 'o') { e.preventDefault(); openDialog(); return; }
  if (c && (k === '=' || k === '+')) { e.preventDefault(); zoomIn(); return; }
  if (c && k === '-') { e.preventDefault(); zoomOut(); return; }
  const ae = document.activeElement?.tagName; if (ae === 'TEXTAREA' || ae === 'INPUT') return;
  if (c && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (c && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (c && k === 'd') { e.preventDefault(); if (selected) duplicateObj(selected); }
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
loadFont(FONTS[0]).then(() => status(`Sẵn sàng · ${FONTS.length} phông · chạy ngoại tuyến`)).catch(() => status('Lỗi tải phông', 'err'));
if (API) {
  API.initialFile().then(f => f && openBytes(f.data, f.name, f.path));
  API.onOpenPath(async p => { const f = await API.readPdf(p); openBytes(f.data, f.name, f.path); });
}
// dùng cho kiểm thử tự động
window.__app = { openBytes, createObj, save, doSave, buildPdf, setTool, chooseFont, sampleRing, select, startPlaceImage, openSig, setSigTab, useSignature, processSigImage,
  get objects() { return objects; }, get pages() { return pages; }, get zoom() { return zoom; }, setZoom, imgStore, baseRatio, cur, pad, loadImage, get sigOut() { return sigOut; },
  libApi, recolor, trimCanvas, hashDataUrl, autoBgTol, redrawPad, closeAllModals, padC, padSignature, drawStroke,
  FONTS, loadFont, fontBytes, charSetFor, pdfjs: pdfjsLib,
  pageLines, snapRectToLines, lineAt, maskBox, maskPatch, paintMask, renderMaskedPage, pickAutoFormat, syncFlatOpts,
  redo, undo, restoreState, duplicateObj, placeSignatureAt, sigSize, currentPageIdx, prepareSrc, pushHistory,
  saveSession, loadSession, clearSession, applySession, buildSession,
  get future() { return future; },
  get libSel() { return libSel; }, setLibSel: v => { libSel = v; },
  get sigSrcImg() { return sigSrcImg; }, setSigSrcImg: v => { sigSrcImg = v; } };
