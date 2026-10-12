import { _electron as electron } from 'playwright-core';
import path from 'path';
import { APP_ROOT, TEST_ROOT, electronBin, testFile } from './_paths.mjs';

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox', testFile('scan-test.pdf')],
});
const w = await app.firstWindow();
const logs = [];
w.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
w.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await w
  .waitForFunction(
    () => window.__app && window.__app.pages.length === 2 && window.__app.pages.every((p) => p.rendered > 0),
    null,
    { timeout: 30000 },
  )
  .catch((e) => logs.push('WAIT FAIL ' + e.message));
console.log('status:', await w.textContent('#status'), 'title:', await w.title());
await w.screenshot({ path: path.join(TEST_ROOT, 'smoke.png') });
console.log(logs.join('\n'));
await app.close();
