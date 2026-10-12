import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv, sigLibDir, closeApp } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({ executablePath: electronBin, args: [APP_ROOT, '--no-sandbox'], env: electronEnv });
const w = await app.firstWindow(); await w.setViewportSize({width:1500,height:940}).catch(()=>{});
const logs=[]; w.on('console', m => { if (m.type()==='error'||m.type()==='warning') logs.push(m.type()+': '+m.text()); }); w.on('pageerror', e => logs.push('PAGEERROR '+e.message));
await app.evaluate(({BrowserWindow})=>{ const b=BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setSize(1500,960); });
let savePath=null;
const setSave = p => app.evaluate(({dialog}, p)=>{ dialog.showSaveDialog = async()=>({canceled:false, filePath:p}); }, p);
await w.waitForFunction(() => window.__app && document.querySelectorAll('#fontList .fi').length === window.__app.FONTS.length);
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
await openPdf(testFile('scan-test.pdf'));
await w.click('[data-tool="erase"]');
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
await openPdf(testFile('text-doc.pdf'));
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
