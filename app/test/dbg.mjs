import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox'] });
const page = await (await b.newContext({viewport:{width:1500,height:950}})).newPage();
page.on('console',m=>console.log('C',m.type(),m.text())); page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('http://localhost:8811/index.html'); await page.waitForTimeout(2000);
console.log(await page.evaluate(()=>!!window.__app), await page.textContent('#status'));
await b.close();
