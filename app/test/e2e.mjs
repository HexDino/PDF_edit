import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv, sigLibDir, closeApp } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({ executablePath: electronBin, args: [APP_ROOT, '--no-sandbox'], env: electronEnv });
const w = await app.firstWindow();
const logs=[]; w.on('console', m => { if (m.type()==='error'||m.type()==='warning') logs.push(m.type()+': '+m.text()); }); w.on('pageerror', e => logs.push('PAGEERROR '+e.message));
// Đặt đúng kích thước vùng nội dung; app tự maximize lúc mở nên phải unmaximize xong mới resize được.
async function setContentSize(width, height) {
  await app.evaluate(async ({BrowserWindow}, size) => {
    const b = BrowserWindow.getAllWindows()[0];
    if (b.isMaximized()) b.unmaximize();
    for (let i = 0; i < 60 && b.isMaximized(); i++) await new Promise(r => setTimeout(r, 50));
    b.setContentSize(size[0], size[1]);
  }, [width, height]);
  await w.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [width, height], { timeout: 5000 });
}
let savePath=null;
const setSave = p => app.evaluate(({dialog}, p)=>{ dialog.showSaveDialog = async()=>({canceled:false, filePath:p}); }, p);
await w.waitForFunction(() => window.__app && document.querySelectorAll('#fontList .fi').length === window.__app.FONTS.length);
await setContentSize(1500, 940);
const A = (fn, arg) => w.evaluate(fn, arg);
async function openPdf(file){ await A(async(b64)=>{const s=atob(b64.d);const u=new Uint8Array(s.length);for(let i=0;i<u.length;i++)u[i]=s.charCodeAt(i);await window.__app.openBytes(u,b64.n,b64.path);},{d:fs.readFileSync(file).toString('base64'),n:file.split('/').pop(),path:file});
  await w.waitForFunction(()=>window.__app.pages.every(p=>p.rendered>0)); }
async function L(pi){ return A(pi=>{const r=window.__app.pages[pi].layer.getBoundingClientRect();return {l:r.left,t:r.top,z:window.__app.zoom}},pi); }
async function scrollTo(pi, y){ await A(([pi,y])=>{const p=window.__app.pages[pi];const v=document.getElementById('viewer');v.scrollTop+=p.layer.getBoundingClientRect().top-v.getBoundingClientRect().top+y*window.__app.zoom-250;},[pi,y]); }
async function dragRect(pi,x0,y0,x1,y1){ await scrollTo(pi,y0); const r=await L(pi); await w.mouse.move(r.l+x0*r.z,r.t+y0*r.z); await w.mouse.down(); await w.mouse.move(r.l+x1*r.z,r.t+y1*r.z,{steps:6}); await w.mouse.up(); }
async function clickAt(pi,x,y){ await scrollTo(pi,y); const r=await L(pi); await w.mouse.click(r.l+x*r.z,r.t+y*r.z); }
const objs = () => A(()=>window.__app.objects.map(o=>{const{el,ta,...r}=o;if(r.pts)r.pts=r.pts.length;return r;}));
async function saveVia(path, trueRemove){
  await setSave(path);
  await w.keyboard.press('Control+Shift+S');
  if (trueRemove!==undefined){ await w.waitForSelector('#saveModal:not([hidden])'); if(!trueRemove) await w.uncheck('#trueRemove'); else await w.check('#trueRemove'); await w.click('#saveGo'); }
  await w.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Đã lưu')||document.getElementById('status').textContent.includes('Lỗi'),null,{timeout:60000});
  const st = await w.textContent('#status'); await A(()=>document.getElementById('status').textContent='…'); return st;
}

/* ---------- 1. PDF scan: tẩy xóa + chữ thay thế + chữ ký vẽ + ảnh chữ ký tách nền ---------- */
// Dùng BẢN SAO trong test/out: khi lưu, app ghi kèm file phiên .tsp.json cạnh PDF gốc,
// nên mở thẳng file mẫu trong repo sẽ làm bẩn thư mục test/.
const SCAN = path.join(OUT, 'e2e-scan.pdf'), TEXT = path.join(OUT, 'e2e-text.pdf');
for (const [src, dst] of [['scan-test.pdf', SCAN], ['text-doc.pdf', TEXT]]) {
  fs.copyFileSync(testFile(src), dst);
  if (fs.existsSync(dst.replace(/\.pdf$/i, '') + '.tsp.json')) fs.unlinkSync(dst.replace(/\.pdf$/i, '') + '.tsp.json');
}
await openPdf(SCAN);
// Đo hình học inspector ở đúng 1400×900 và 900×600, rồi trả cửa sổ về 1500×940.
const segWidths = () => w.evaluate(() => [...document.querySelectorAll('.ctx .seg button')].map(b => ({ label: b.textContent.trim(), scroll: b.scrollWidth, client: b.clientWidth })));
function assertNoOverflow(rows, where) {
  const bad = rows.filter(r => r.scroll > r.client);
  if (bad.length) throw new Error(`Nhãn kiểu xoá tràn ở ${where}: ` + JSON.stringify(bad));
}
async function closeFontPanel() {
  if (await w.evaluate(() => document.getElementById('fontPanel').classList.contains('open'))) {
    await w.click('#fontBtn');
    await w.waitForFunction(() => !document.getElementById('fontPanel').classList.contains('open'));
  }
}

await setContentSize(1400, 900);
await w.click('[data-tool="erase"]');
const visible = await w.evaluate(() => [...document.querySelectorAll('.ctx .sec')].filter(s => s.classList.contains('show')).map(s => s.dataset.ctx));
if (!visible.includes('erase rect')) throw new Error('Inspector không hiện nhóm tẩy xoá: ' + visible);
const geo1400 = await w.evaluate(() => {
  const cards = [...document.querySelectorAll('#inspector .ctx .sec[data-ctx="erase rect"]')];
  const r = document.getElementById('inspector').getBoundingClientRect();
  return {
    headings: document.querySelectorAll('#inspector .ctx .sec h4').length,
    headingSize: getComputedStyle(document.querySelector('#inspector .ctx .sec h4')).fontSize,
    cards: cards.length,
    cardDisplay: cards.map(s => getComputedStyle(s).display),
    inspector: { width: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    vw: innerWidth, vh: innerHeight,
  };
});
if (geo1400.headings !== 7) throw new Error('Số tiêu đề inspector khác 7: ' + geo1400.headings);
if (geo1400.headingSize !== '12px') throw new Error('Tiêu đề inspector không phải 12px: ' + geo1400.headingSize);
if (geo1400.cards !== 2 || geo1400.cardDisplay.some(d => d !== 'flex')) throw new Error('Hai card tẩy xoá không hiển thị flex: ' + JSON.stringify(geo1400));
if (geo1400.inspector.width < 300 || geo1400.inspector.width > 340) throw new Error('Inspector sai bề rộng ở 1400: ' + geo1400.inspector.width);
if (geo1400.inspector.left < 0 || geo1400.inspector.right > geo1400.vw + 1) throw new Error('Inspector lệch khỏi màn hình ở 1400: ' + JSON.stringify(geo1400.inspector));
const seg1400 = await segWidths(); assertNoOverflow(seg1400, '1400×900');

await w.click('[data-tool="text"]');
await w.click('#fontBtn');
await w.waitForFunction(() => document.getElementById('fontPanel').classList.contains('open'));
const fp1400 = await w.evaluate(() => {
  const p = document.getElementById('fontPanel').getBoundingClientRect();
  const i = document.getElementById('inspector').getBoundingClientRect();
  return { width: p.width, left: p.left, right: p.right, top: p.top, bottom: p.bottom, inspLeft: i.left, vw: innerWidth, vh: innerHeight };
});
if (Math.abs(fp1400.width - 380) > 2) throw new Error('Font flyout sai bề rộng ở 1400: ' + fp1400.width);
if (Math.abs(fp1400.right - (fp1400.inspLeft - 16)) > 2) throw new Error('Font flyout cách inspector khác 16px: ' + JSON.stringify(fp1400));
if (fp1400.left < 0 || fp1400.top < 0 || fp1400.right > fp1400.vw || fp1400.bottom > fp1400.vh) throw new Error('Font flyout tràn màn hình ở 1400: ' + JSON.stringify(fp1400));
await closeFontPanel();

await setContentSize(900, 600);
await w.click('#inspectorToggle');
await w.waitForFunction(() => document.body.classList.contains('inspector-open'));
await w.click('[data-tool="erase"]');
const seg900 = await segWidths(); assertNoOverflow(seg900, '900×600');
await w.click('[data-tool="text"]');
await w.click('#fontBtn');
await w.waitForFunction(() => document.getElementById('fontPanel').classList.contains('open'));
const fp900 = await w.evaluate(() => {
  const p = document.getElementById('fontPanel').getBoundingClientRect();
  return { width: p.width, left: p.left, right: p.right, top: p.top, bottom: p.bottom, cx: (p.left + p.right) / 2, cy: (p.top + p.bottom) / 2, vw: innerWidth, vh: innerHeight };
});
if (Math.abs(fp900.width - 520) > 2) throw new Error('Font modal sai bề rộng ở 900: ' + fp900.width);
if (Math.abs(fp900.cx - fp900.vw / 2) > 2 || Math.abs(fp900.cy - fp900.vh / 2) > 2) throw new Error('Font modal không căn giữa ở 900: ' + JSON.stringify(fp900));
if (fp900.left < 0 || fp900.top < 0 || fp900.right > fp900.vw || fp900.bottom > fp900.vh) throw new Error('Font modal tràn màn hình ở 900: ' + JSON.stringify(fp900));
// Đóng drawer khi panel đang mở phải gỡ luôn .open; mở lại rồi vượt breakpoint 1200 cũng phải gỡ.
await w.click('#inspectorToggle');
await w.waitForFunction(() => !document.getElementById('fontPanel').classList.contains('open') && !document.body.classList.contains('inspector-open'));
await w.click('#inspectorToggle');
await w.click('#fontBtn');
await w.waitForFunction(() => document.getElementById('fontPanel').classList.contains('open'));
await setContentSize(1400, 900);
await w.waitForFunction(() => !document.getElementById('fontPanel').classList.contains('open'));
await setContentSize(1500, 940);
await w.click('[data-tool="erase"]');
console.log('inspector ok:', JSON.stringify({ visible, width1400: geo1400.inspector.width, seg1400, font1400: { width: fp1400.width, gap: +(fp1400.inspLeft - fp1400.right).toFixed(1) }, seg900, font900: { width: fp900.width, cx: fp900.cx, cy: fp900.cy, vw: fp900.vw, vh: fp900.vh } }));
await dragRect(0, 140, 196, 330, 214);         // che dòng chấm "Họ và tên: ....."
let o = await objs(); console.log('rect after draw:', JSON.stringify(o[0]));
await w.keyboard.type('');
await clickAt(0, 150, 205);                     // tool tự chuyển sang Chữ -> bấm lên vùng che
await w.keyboard.type('Nguyễn Thanh Hưng'); await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
// signature: draw in pad
await w.click('#sigBtn'); await w.waitForSelector('#sigModal:not([hidden])'); await w.waitForTimeout(200);
const pb = await (await w.$('#pad')).boundingBox();
const pts=[]; for(let i=0;i<=60;i++){const u=i/60; pts.push([pb.x+60+u*420, pb.y+120-50*Math.sin(u*9)*Math.exp(-u)+18*Math.sin(u*25)]);}
await w.mouse.move(...pts[0]); await w.mouse.down(); for(const p of pts) await w.mouse.move(p[0],p[1],{steps:2}); await w.mouse.up();
await w.mouse.move(pb.x+80,pb.y+170); await w.mouse.down(); await w.mouse.move(pb.x+470,pb.y+160,{steps:25}); await w.mouse.up();
await w.screenshot({path:`${OUT}/screenshot-signature-pad.png`});
console.log('pad strokes:', await A(()=>window.__app.pad.strokes.length));
// phải đợi hộp thoại đóng hẳn rồi mới bấm lên trang, nếu không cú bấm rơi vào lớp phủ modal
await w.click('#sigUse'); await w.waitForFunction(()=>document.getElementById('sigModal').hidden, null, { timeout: 10000 }); await clickAt(0, 380, 640);
console.log('sau khi đặt: objects =', JSON.stringify((await objs()).map(o=>o.type)));
o = await objs(); const sig = o.find(x=>x.type==='img'); console.log('signature placed:', JSON.stringify({x:sig.x,y:sig.y,w:sig.w,h:sig.h}));
await A(()=>{const a=window.__app; a.select(a.objects.find(o=>o.type==='img'));}); await w.fill('#rotIn','-8'); await w.dispatchEvent('#rotIn','input');
console.log('signature rot after control:', await A(()=>window.__app.objects.find(o=>o.type==='img').rot));
// image import with bg removal
await w.click('#sigBtn'); await w.click('.tabs [data-tab="image"]');
await w.setInputFiles('#sigImgInput', testFile('sig-photo.jpg'));
await w.waitForFunction(()=>!!window.__app.sigOut);
const alpha = await A(()=>{const c=window.__app.sigOut, x=c.getContext('2d'), d=x.getImageData(0,0,c.width,c.height).data; let t=0,o=0,s=0; for(let i=3;i<d.length;i+=4){if(d[i]===0)t++; else if(d[i]>200)o++; else s++;} return {w:c.width,h:c.height,transparent:+(t/(d.length/4)).toFixed(3),opaque:+(o/(d.length/4)).toFixed(3),semi:+(s/(d.length/4)).toFixed(3)};});
console.log('bg removal result:', JSON.stringify(alpha));
await w.screenshot({path:`${OUT}/screenshot-signature-import.png`});
await w.click('#sigUse'); await w.waitForFunction(()=>document.getElementById('sigModal').hidden, null, { timeout: 10000 }); await clickAt(0, 150, 720);
await A(()=>{const a=window.__app; a.select(null);});
// pen + highlighter
await w.click('[data-tool="hl"]'); await scrollTo(0,170); { const r=await L(0); await w.mouse.move(r.l+330*r.z,r.t+168*r.z); await w.mouse.down(); await w.mouse.move(r.l+590*r.z,r.t+168*r.z,{steps:10}); await w.mouse.up(); }
await w.click('[data-tool="pen"]'); { const r=await L(0); await w.mouse.move(r.l+140*r.z,r.t+260*r.z); await w.mouse.down(); for(let i=0;i<=20;i++) await w.mouse.move(r.l+(140+i*8)*r.z,r.t+(260+6*Math.sin(i))*r.z); await w.mouse.up(); }
await w.click('[data-tool="select"]'); await A(()=>window.__app.select(null));
await scrollTo(0, 420); await w.waitForTimeout(300);
await w.screenshot({path:`${OUT}/screenshot-signature-placed.png`});
console.log('objects on scan:', JSON.stringify((await objs()).map(o=>o.type)));
console.log('save scan:', await saveVia(`${OUT}/scan-da-chinh-sua.pdf`, true));
try { console.log('signature library files:', fs.readdirSync(sigLibDir()).length); }
catch { console.log('signature library files: (thư mục chưa tồn tại)'); }

/* ---------- 2. PDF chữ thường: tẩy xóa số tài khoản, xóa hẳn ---------- */
await setSave(path.join(OUT, '_tmp-save.pdf')); await app.evaluate(({dialog})=>{}); await A(()=>{window.confirm=()=>true;});
await openPdf(TEXT);
await w.click('[data-tool="erase"]');
await dragRect(0, 196, 176, 290, 198);
o = await objs(); console.log('text-pdf rect:', JSON.stringify(o[0]));
await clickAt(0, 202, 187); await w.keyboard.type('9876 543 210'); await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
await w.click('[data-tool="erase"]'); await A(()=>window.__app.select(window.__app.objects[0]));
await w.waitForTimeout(200);
await w.screenshot({path:`${OUT}/screenshot-erase-tool.png`});
await A(()=>window.__app.select(null));
// delete page 2 via thumbnail
await w.hover('.th:nth-child(2)'); await w.click('.th:nth-child(2) .tdel');
console.log('save text (NO true removal):', await saveVia(`${OUT}/text-che-phu.pdf`, false));
console.log('save text (true removal):', await saveVia(`${OUT}/text-xoa-han.pdf`, true));
console.log('LOGS:', logs.join('\n'));
await closeApp(app);
