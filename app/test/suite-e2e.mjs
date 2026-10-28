import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { APP_ROOT, OUT, electronBin, electronEnv, closeApp } from './_paths.mjs';

const require = createRequire(import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox'],
  env: { ...electronEnv, TSP_SUITE: '1' },
});
const w = await app.firstWindow();
await w.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
await w.waitForFunction(() => window.__suite?.tools().length === 14, null, { timeout: 30000 });
console.log('tools:', await w.evaluate(() => window.__suite.tools().length));
await w.fill('#toolSearch', 'ghép');
console.log('cards sau tìm:', await w.locator('#toolGrid .card').count());
await w.fill('#toolSearch', '');
await w.screenshot({ path: path.join(OUT, 'suite-home.png') });
await w.click('#editBtn');
await w.waitForFunction(() => !!window.__app, null, { timeout: 30000 });
console.log('editor mở được');
await closeApp(app);
