import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import { APP_ROOT, OUT, electronBin, testFile, electronEnv } from './_paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox', testFile('scan-test.pdf')],
  env: electronEnv,
});
const w = await app.firstWindow();
await w.waitForFunction(
  () => window.__app && window.__app.pages.length === 2 && window.__app.pages.every((p) => p.rendered > 0),
);
await w.evaluate(async () => {
  const a = window.__app;
  await a.chooseFont('Shalimar');
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 100;
  const x = c.getContext('2d');
  x.strokeStyle = '#c81e1e';
  x.lineWidth = 8;
  x.beginPath();
  x.moveTo(10, 80);
  x.bezierCurveTo(80, -20, 150, 140, 290, 20);
  x.stroke();
  const id = 't1';
  a.imgStore[id] = { dataUrl: c.toDataURL('image/png'), w: 300, h: 100 };
  for (const pg of [0, 1]) {
    a.createObj({ type: 'rect', page: pg, x: 60, y: 120, w: 160, h: 30, color: '#2a8f3a' });
    a.createObj({ type: 'img', page: pg, x: 250, y: 200, w: 180, h: 60, rot: 25, srcId: id, sig: true });
    a.createObj({
      type: 'ink',
      page: pg,
      pts: [
        [60, 300],
        [120, 330],
        [180, 290],
        [240, 340],
      ],
      dx: 10,
      dy: 5,
      color: '#1a2a7a',
      width: 3,
      mode: 'pen',
    });
    a.createObj({
      type: 'ink',
      page: pg,
      pts: [
        [60, 380],
        [300, 380],
      ],
      dx: 0,
      dy: 0,
      color: '#ffe14d',
      width: 14,
      mode: 'hl',
    });
    a.createObj({
      type: 'text',
      page: pg,
      x: 70,
      y: 430,
      size: 22,
      color: '#1a2a7a',
      font: 'Shalimar',
      slant: 8,
      jitter: true,
      text: 'Bệnh nhân uống thuốc\nngày 2 lần',
    });
  }
});
await w.waitForTimeout(500);
await w.addStyleTag({
  content:
    'header,#toast,#side{display:none!important}.obj{outline:none!important}.obj .tools,.obj .rs,.obj .ro{display:none!important}',
});
await w.evaluate(() => window.__app.setZoom(1, false));
await w.waitForFunction(() => window.__app.pages.every((p) => p.rendered === 1 || p.rendered === window.devicePixelRatio));
await w.waitForTimeout(400);
for (const i of [0, 1]) await (await w.$(`.page[data-page="${i}"]`)).screenshot({ path: `${OUT}/ov-screen-${i + 1}.png` });
for (const [n, tr] of [
  ['ov-cover', false],
  ['ov-flat', true],
]) {
  const bytes = await w.evaluate(async (tr) => Array.from((await window.__app.buildPdf(tr)).bytes), tr);
  fs.writeFileSync(`${OUT}/${n}.pdf`, Buffer.from(bytes));
}
await app.close();
