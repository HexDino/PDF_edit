// Test gói tiện ích khi soạn thảo:
//   - Làm lại (redo) sau khi hoàn tác; thao tác mới thì xoá nhánh làm lại
//   - Nhân bản đối tượng (Ctrl+D) cho cả đối tượng theo toạ độ lẫn theo nét
//   - Đặt nhanh chữ ký vào góc trang, và đặt lên tất cả các trang
//
// Chạy: node test/editing.mjs   (trong app/)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv, closeApp } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// Mở bản sao trong test/out: nếu mở thẳng file mẫu trong repo, một file phiên .tsp.json
// còn sót lại sẽ được khôi phục và làm test bắt đầu với dữ liệu lạ.
const WORK = path.join(OUT, 'editing-text.pdf');
const SIDE = WORK.replace(/\.pdf$/i, '') + '.tsp.json';
fs.copyFileSync(testFile('text-doc.pdf'), WORK);
if (fs.existsSync(SIDE)) fs.unlinkSync(SIDE);

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox', WORK],
  env: electronEnv,
});
const w = await app.firstWindow();
const errors = [];
w.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await w.waitForFunction(() => window.__app && window.__app.pages.length > 0 && window.__app.pages.every(p => p.rendered > 0), null, { timeout: 60000 });
await w.waitForTimeout(300);
const A = (fn, arg) => w.evaluate(fn, arg);
const objs = () => A(() => window.__app.objects.map(o => ({ type: o.type, x: o.x, y: o.y, text: o.text })));
// Đặt đúng kích thước vùng nội dung (app tự maximize lúc mở nên phải unmaximize trước).
async function setContentSize(width, height) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const b = BrowserWindow.getAllWindows()[0];
    if (b.isMaximized()) b.unmaximize();
    for (let i = 0; i < 60 && b.isMaximized(); i++) await new Promise(r => setTimeout(r, 50));
    b.setContentSize(size[0], size[1]);
  }, [width, height]);
  await w.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [width, height], { timeout: 5000 });
}

const mkText = { type: 'text', page: 0, x: 80, y: 120, size: 18, color: '#111111', font: 'PatrickHand', slant: 0, jitter: false, text: 'Xin chào' };

/* ---------- 1. Làm lại (redo) ---------- */
await A((d) => { window.__app.pushHistory(); window.__app.createObj(d); }, mkText);
const n1 = (await objs()).length;
await A(() => window.__app.undo());
const n2 = (await objs()).length;
const redoState = await A(() => ({ canRedo: window.__app.future.length, btnDisabled: document.getElementById('redoBtn').disabled }));
await A(() => window.__app.redo());
const n3 = (await objs()).length;
check('Hoàn tác rồi làm lại khôi phục đúng đối tượng', n1 === 1 && n2 === 0 && n3 === 1, `${n1} → ${n2} → ${n3}`);
check('Nút "Làm lại" bật/tắt theo ngăn xếp', redoState.canRedo === 1 && redoState.btnDisabled === false, JSON.stringify(redoState));

await A((d) => { window.__app.pushHistory(); window.__app.createObj({ ...d, y: 260, text: 'Dòng mới' }); }, mkText);
const afterNew = await A(() => window.__app.future.length);
check('Thao tác mới xoá nhánh "làm lại"', afterNew === 0, `future=${afterNew}`);

/* ---------- 2. Nhân bản đối tượng ---------- */
const dupText = await A(() => {
  const a = window.__app;
  const src = a.objects.find(o => o.type === 'text');
  const before = a.objects.length;
  const n = a.duplicateObj(src);
  return { before, after: a.objects.length, dx: n.x - src.x, dy: n.y - src.y, type: n.type, text: n.text };
});
check('Nhân bản khung chữ: thêm 1 đối tượng, lệch 12 điểm',
  dupText.after === dupText.before + 1 && Math.abs(dupText.dx - 12) < 0.01 && Math.abs(dupText.dy - 12) < 0.01 && dupText.type === 'text',
  `Δ=(${dupText.dx},${dupText.dy})`);

const dupMask = await A(() => {
  const a = window.__app;
  const m = a.createObj({ type: 'lasso', page: 0, pts: [[100, 300], [200, 300], [200, 360]], color: '#ff0000', fillMode: 'solid' });
  const n = a.duplicateObj(m);
  return { p0: m.pts[0], p1: n.pts[0], kind: n.type };
});
check('Nhân bản vùng che: dịch toàn bộ điểm',
  Math.abs(dupMask.p1[0] - dupMask.p0[0] - 12) < 0.01 && Math.abs(dupMask.p1[1] - dupMask.p0[1] - 12) < 0.01,
  JSON.stringify(dupMask));

const toolsHtml = await A(() => {
  const a = window.__app;
  a.createObj({ type: 'rect', page: 0, x: 60, y: 400, w: 80, h: 20, color: '#ffffff', fillMode: 'solid' });
  return [...document.querySelectorAll('.obj .tools')].every(t => t.querySelector('.dup')) ;
});
check('Mọi đối tượng đều có nút nhân bản trên thanh công cụ', toolsHtml === true);

/* ---------- 3. Đặt nhanh chữ ký vào góc ---------- */
const sigUrl = await A(() => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 100;
  const x = c.getContext('2d'); x.strokeStyle = '#111'; x.lineWidth = 8; x.lineCap = 'round';
  x.beginPath(); x.moveTo(10, 80); x.bezierCurveTo(80, -20, 150, 140, 290, 20); x.stroke();
  return c.toDataURL('image/png');
});

const anchor = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  const o = await a.placeSignatureAt('br', false, url);
  const pg = a.pages[0];
  return { n: a.objects.length, sig: !!o.sig, right: o.x + o.w, bottom: o.y + o.h, pw: pg.vp1.width, ph: pg.vp1.height, h: o.h };
}, sigUrl);
check('Đặt nhanh chữ ký vào góc dưới phải',
  anchor.n === 1 && anchor.sig && Math.abs(anchor.right - (anchor.pw - 28)) < 0.01 && Math.abs(anchor.bottom - (anchor.ph - 28)) < 0.01,
  `mép phải ${anchor.right.toFixed(1)}/${(anchor.pw - 28).toFixed(1)} · mép dưới ${anchor.bottom.toFixed(1)}/${(anchor.ph - 28).toFixed(1)}`);
check('Chữ ký không cao quá 70 điểm', anchor.h <= 70.001, `h=${anchor.h.toFixed(1)}`);

const allPages = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  await a.placeSignatureAt('bc', true, url);
  return { n: a.objects.length, pages: a.pages.length, on: a.objects.map(o => o.page) };
}, sigUrl);
check('Đặt lên tất cả các trang', allPages.n === allPages.pages && new Set(allPages.on).size === allPages.pages,
  `${allPages.n}/${allPages.pages} trang · ${JSON.stringify(allPages.on)}`);

const skipDeleted = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  a.pages[1].deleted = true;
  await a.placeSignatureAt('br', true, url);
  const r = { n: a.objects.length, on: a.objects.map(o => o.page) };
  a.pages[1].deleted = false;
  return r;
}, sigUrl);
check('Bỏ qua trang đã bị xoá khi đặt lên tất cả', skipDeleted.n === 1 && skipDeleted.on[0] === 0, JSON.stringify(skipDeleted));

const midAnchor = await A(async (url) => {
  const a = window.__app;
  a.objects.forEach(o => o.el.remove()); a.objects.length = 0;
  const o = await a.placeSignatureAt('bl', false, url);
  return { left: o.x, centerX: o.x + o.w / 2, pw: a.pages[0].vp1.width };
}, sigUrl);
check('Góc dưới trái cách mép 28 điểm', Math.abs(midAnchor.left - 28) < 0.01, `x=${midAnchor.left.toFixed(1)}`);

/* ---------- 4. Đổi công cụ phải giữ class body (dirty, drawer, ...) ---------- */
await A(() => document.body.classList.add('dirty', 'inspector-open'));
await w.click('[data-tool="pen"]');
const kept = await A(() => ({ cls: document.body.className, dirty: document.body.classList.contains('dirty'), drawer: document.body.classList.contains('inspector-open') }));
if (!kept.dirty || !kept.drawer || !/\btool-pen\b/.test(kept.cls)) throw new Error('setTool làm mất class body: ' + kept.cls);
await A(() => document.body.classList.remove('dirty', 'inspector-open'));
console.log('setTool giữ body class ok:', kept.cls);

/* ---------- 5. Hợp đồng UI top bar/rail ---------- */
const ui = await A(() => ({
  railTools: [...document.querySelectorAll('#rail [data-tool]')].map(b => b.dataset.tool),
  saveInMenu: !!document.querySelector('.menu #saveSessionBtn'),
  title: document.getElementById('fileTitle').textContent,
  dirtyClass: document.body.classList.contains('dirty'),
}));
if (ui.railTools.join(',') !== 'select,text,erase,pen,hl') throw new Error('Rail tools sai: ' + ui.railTools);
if (!ui.saveInMenu) throw new Error('Thiếu Lưu phiên trong menu Tệp');
if (!ui.title) throw new Error('Thiếu tên file ở top bar');
console.log('top bar/rail ok:', JSON.stringify(ui));

// Menu Tệp phải đóng ngay khi chọn một mục (huỷ hộp xác nhận để không xoá phiên thật).
await A(() => { window.__confirm = window.confirm; window.confirm = () => false; document.querySelector('.menu').open = true; });
await w.click('#clearSessionBtn');
const menuClosed = await A(() => !document.querySelector('.menu').open);
await A(() => { window.confirm = window.__confirm; });
if (!menuClosed) throw new Error('Menu Tệp không đóng sau khi chọn mục');
console.log('menu Tệp đóng sau khi chọn mục ok');

/* ---------- 6. Responsive 900×600: drawer chứa trong layout + aria-expanded ---------- */
await setContentSize(900, 600);
await w.waitForTimeout(300);
const measure = () => A(() => {
  const box = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
      visible: el.getClientRects().length > 0 && style.display !== 'none' && r.width > 0 && r.height > 0 };
  };
  const topbar = document.querySelector('header');
  const items = [...topbar.querySelectorAll('button, summary')].filter(el => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0);
  return {
    innerWidth, vh: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    viewer: box('#viewer'), rail: box('#rail'), side: box('#side'), inspector: box('#inspector'),
    thumbsAria: document.getElementById('thumbsToggle').getAttribute('aria-expanded'),
    inspectorAria: document.getElementById('inspectorToggle').getAttribute('aria-expanded'),
    railLabelCount: document.querySelectorAll('#rail .tool span').length,
    railLabelsHidden: [...document.querySelectorAll('#rail .tool span')].every(s => getComputedStyle(s).display === 'none'),
    topbar: { height: topbar.getBoundingClientRect().height, scrollWidth: topbar.scrollWidth, clientWidth: topbar.clientWidth,
      itemCount: items.length, tops: items.map(el => Math.round(el.getBoundingClientRect().top)) },
  };
});
function assertCompact(s) {
  const problems = [];
  if (!s.rail || !s.rail.visible || s.rail.width < 50) problems.push('rail ẩn/hẹp');
  if (!s.viewer || !s.viewer.visible) problems.push('viewer ẩn');
  if (s.overflow) problems.push(`tràn ngang document (${s.scrollWidth}/${s.innerWidth})`);
  if (s.viewer && s.viewer.width < 500) problems.push('viewer <500: ' + s.viewer.width);
  if (s.inspector && s.inspector.visible) problems.push('inspector phải đóng (drawer)');
  if (s.side && s.side.visible) problems.push('thumbnails phải đóng (drawer)');
  if (s.railLabelCount === 0 || s.railLabelsHidden !== true) problems.push('rail phải icon-only');
  if (s.thumbsAria !== 'false') problems.push('aria-expanded thumbnails phải false: ' + s.thumbsAria);
  if (s.inspectorAria !== 'false') problems.push('aria-expanded inspector phải false: ' + s.inspectorAria);
  if (s.topbar.itemCount < 8) problems.push('topbar thiếu nút hiện: ' + s.topbar.itemCount);
  if (s.topbar.height > 60 || (Math.max(...s.topbar.tops) - Math.min(...s.topbar.tops)) > 1) problems.push('topbar xuống hàng');
  if (s.topbar.scrollWidth > s.topbar.clientWidth + 1) problems.push(`topbar tràn (${s.topbar.scrollWidth}/${s.topbar.clientWidth})`);
  if (problems.length) throw new Error('Responsive 900×600 lỗi: ' + problems.join(' · '));
}
const compact = await measure();
assertCompact(compact);

// Mở drawer thumbnails: hiện đè lên canvas, aria-expanded=true, không tăng scrollWidth.
await w.click('#thumbsToggle');
await w.waitForFunction(() => document.getElementById('side').getClientRects().length > 0);
await w.waitForTimeout(200);
const thumbsOpen = await measure();
if (!thumbsOpen.side.visible || Math.abs(thumbsOpen.side.width - 168) > 2) throw new Error('Drawer thumbnails sai bề rộng: ' + JSON.stringify(thumbsOpen.side));
if (thumbsOpen.thumbsAria !== 'true') throw new Error('aria-expanded thumbnails phải true: ' + thumbsOpen.thumbsAria);
if (thumbsOpen.side.left < -1 || thumbsOpen.side.right > thumbsOpen.innerWidth + 1) throw new Error('Drawer thumbnails lệch màn hình: ' + JSON.stringify(thumbsOpen.side));
if (thumbsOpen.overflow) throw new Error('Drawer thumbnails làm tràn ngang document');
if (Math.abs(thumbsOpen.viewer.width - compact.viewer.width) > 1) throw new Error('Drawer thumbnails chiếm chỗ canvas');
const thumbMeta = await A(async () => {
  await new Promise(r => setTimeout(r, 150));
  const th = document.querySelector('.th canvas');
  document.getElementById('viewer').dispatchEvent(new Event('scroll'));
  await new Promise(r => setTimeout(r, 180));
  const cur = document.querySelector('.th.cur');
  return { width: th ? th.getBoundingClientRect().width : 0, count: document.getElementById('thumbCount').textContent,
    pages: document.querySelectorAll('.th').length, cur: !!cur, curBorder: cur ? getComputedStyle(cur).borderTopColor : '' };
});
if (Math.abs(thumbMeta.width - 120) > 1) throw new Error('Thumbnail không rộng ~120px: ' + thumbMeta.width);
if (thumbMeta.count !== String(thumbMeta.pages) || thumbMeta.pages < 1) throw new Error('Header "Trang · N" sai: ' + JSON.stringify(thumbMeta));
if (!thumbMeta.cur || thumbMeta.curBorder !== 'rgb(11, 92, 213)') throw new Error('Thiếu viền xanh trang hiện tại: ' + JSON.stringify(thumbMeta));
await w.click('#thumbsCollapse');
await w.waitForFunction(() => document.getElementById('side').getClientRects().length === 0);
const thumbsClosed = await measure();
if (thumbsClosed.side.visible || thumbsClosed.thumbsAria !== 'false') throw new Error('Nút thu gọn thumbnails không đóng/aria sai');
if (thumbsClosed.overflow) throw new Error('Đóng thumbnails vẫn tràn ngang document');
// Mở/đóng lại bằng nút rail.
await w.click('#thumbsToggle');
await w.waitForFunction(() => document.getElementById('side').getClientRects().length > 0);
await w.click('#thumbsToggle');
await w.waitForFunction(() => document.getElementById('side').getClientRects().length === 0);
const thumbsToggled = await measure();
if (thumbsToggled.side.visible || thumbsToggled.thumbsAria !== 'false') throw new Error('Toggle rail không đóng thumbnails');

// Inspector drawer: mở/đóng, aria-expanded, không đổi bề rộng canvas.
await w.click('#inspectorToggle');
await w.waitForFunction(() => document.getElementById('inspector').getClientRects().length > 0);
await w.waitForTimeout(200);
const inspOpen = await measure();
if (!inspOpen.inspector.visible || Math.abs(inspOpen.inspector.width - 320) > 2) throw new Error('Drawer inspector sai bề rộng: ' + JSON.stringify(inspOpen.inspector));
if (inspOpen.inspectorAria !== 'true') throw new Error('aria-expanded inspector phải true: ' + inspOpen.inspectorAria);
if (inspOpen.inspector.right > inspOpen.innerWidth + 1 || inspOpen.inspector.left < inspOpen.innerWidth - 322) throw new Error('Drawer inspector lệch màn hình: ' + JSON.stringify(inspOpen.inspector));
if (inspOpen.overflow) throw new Error('Drawer inspector làm tràn ngang document');
if (Math.abs(inspOpen.viewer.width - compact.viewer.width) > 1) throw new Error('Drawer inspector chiếm chỗ canvas');
await w.click('#inspectorClose');
await w.waitForFunction(() => document.getElementById('inspector').getClientRects().length === 0);
const inspClosed = await measure();
if (inspClosed.inspector.visible || inspClosed.inspectorAria !== 'false') throw new Error('Nút đóng inspector không đóng/aria sai');
await w.click('#inspectorToggle');
await w.waitForFunction(() => document.getElementById('inspector').getClientRects().length > 0);
await w.click('#inspectorToggle');
await w.waitForFunction(() => document.getElementById('inspector').getClientRects().length === 0);
const inspToggled = await measure();
if (inspToggled.inspector.visible || inspToggled.inspectorAria !== 'false') throw new Error('Toggle inspector không đóng');
if (inspToggled.overflow) throw new Error('Đóng inspector vẫn tràn ngang document');
console.log('responsive 900x600 ok:', JSON.stringify({ viewer: Math.round(compact.viewer.width), rail: compact.rail.width, scrollWidth: compact.scrollWidth, topbar: compact.topbar, thumbs: thumbMeta }));

/* ---------- 7. ≥1200: thumbnails mở/thu gọn, canvas đủ chỗ ---------- */
await setContentSize(1400, 900);
await w.waitForTimeout(300);
const wide = await measure();
if (!wide.side.visible || Math.abs(wide.side.width - 168) > 2) throw new Error('Sidebar thumbnails không mở ở 1400: ' + JSON.stringify(wide.side));
if (!wide.inspector.visible || Math.abs(wide.inspector.width - 320) > 2) throw new Error('Inspector không hiện cố định ở 1400');
if (wide.thumbsAria !== 'true') throw new Error('aria-expanded thumbnails phải true ở 1400: ' + wide.thumbsAria);
if (wide.overflow) throw new Error('1400×900 bị tràn ngang document');
const pagePill = await A(() => {
  const el = document.querySelector('.page .num');
  return el ? { text: el.textContent, radius: getComputedStyle(el).borderRadius, width: el.getBoundingClientRect().width } : null;
});
if (!pagePill || pagePill.radius !== '999px' || !/^Trang 1 \/ \d+$/.test(pagePill.text)) throw new Error('Số trang không phải pill: ' + JSON.stringify(pagePill));
await w.click('#thumbsToggle');
await w.waitForTimeout(250);
const wideCollapsed = await measure();
if (wideCollapsed.side.width > 1 || wideCollapsed.thumbsAria !== 'false') throw new Error('Thu gọn thumbnails ở 1400 sai: ' + JSON.stringify(wideCollapsed.side));
if (wideCollapsed.viewer.width <= wide.viewer.width) throw new Error('Thu gọn thumbnails không nhường chỗ canvas');
if (wideCollapsed.overflow) throw new Error('Thu gọn thumbnails làm tràn ngang');
await w.click('#thumbsToggle');
await w.waitForTimeout(250);
const wideReopened = await measure();
if (!wideReopened.side.visible || Math.abs(wideReopened.side.width - 168) > 2 || wideReopened.thumbsAria !== 'true') throw new Error('Mở lại thumbnails ở 1400 sai');
// Desktop: thu gọn phải xoá cờ thumbs-open cũ, ẩn hẳn và chặn tab vào sidebar.
await A(() => document.body.classList.add('thumbs-open'));
await w.click('#thumbsCollapse');
await w.waitForTimeout(250);
const desktopCollapsed = await A(() => {
  const side = document.getElementById('side'), s = getComputedStyle(side);
  return {
    collapsed: document.body.classList.contains('thumbs-collapsed'),
    staleOpen: document.body.classList.contains('thumbs-open'),
    visibility: s.visibility, pointerEvents: s.pointerEvents, inert: side.inert === true,
    aria: document.getElementById('thumbsToggle').getAttribute('aria-expanded'),
    width: side.getBoundingClientRect().width,
  };
});
if (!desktopCollapsed.collapsed || desktopCollapsed.staleOpen) throw new Error('Thu gọn desktop còn cờ thumbs-open: ' + JSON.stringify(desktopCollapsed));
if (desktopCollapsed.width > 1 || desktopCollapsed.visibility !== 'hidden' || desktopCollapsed.pointerEvents !== 'none' || !desktopCollapsed.inert)
  throw new Error('Sidebar thu gọn vẫn còn control focusable: ' + JSON.stringify(desktopCollapsed));
if (desktopCollapsed.aria !== 'false') throw new Error('aria-expanded thumbnails sai khi thu gọn desktop');
await w.click('#thumbsToggle');
await w.waitForTimeout(250);
const desktopReopened = await A(() => {
  const side = document.getElementById('side'), s = getComputedStyle(side);
  return { collapsed: document.body.classList.contains('thumbs-collapsed'), staleOpen: document.body.classList.contains('thumbs-open'),
    visibility: s.visibility, pointerEvents: s.pointerEvents, inert: side.inert === true, width: side.getBoundingClientRect().width,
    aria: document.getElementById('thumbsToggle').getAttribute('aria-expanded') };
});
if (desktopReopened.collapsed || desktopReopened.staleOpen) throw new Error('Mở lại desktop còn class cũ: ' + JSON.stringify(desktopReopened));
if (Math.abs(desktopReopened.width - 168) > 2 || desktopReopened.visibility !== 'visible' || desktopReopened.pointerEvents === 'none' || desktopReopened.inert)
  throw new Error('Mở lại desktop không khôi phục sidebar: ' + JSON.stringify(desktopReopened));
if (desktopReopened.aria !== 'true') throw new Error('aria-expanded thumbnails sai khi mở lại desktop');
console.log('1400 thumbnails/canvas ok:', JSON.stringify({ side: wideReopened.side.width, viewer: Math.round(wideReopened.viewer.width), pill: pagePill }));
console.log('desktop collapse ok:', JSON.stringify({ hidden: desktopCollapsed, reopened: desktopReopened }));

check('Không có lỗi JS trong suốt quá trình', errors.length === 0, errors.slice(0, 2).join(' | '));

await w.screenshot({ path: path.join(OUT, 'editing-ui.png') }).catch(() => {});
await closeApp(app);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
if (failed.length) { console.log('Thất bại: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
