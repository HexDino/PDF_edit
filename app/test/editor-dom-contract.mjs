import { _electron as electron } from 'playwright-core';
import { APP_ROOT, electronBin, testFile, electronEnv, closeApp } from './_paths.mjs';

const REQUIRED_IDS = [
  'homeBtn','openBtn','saveBtn','saveAsBtn','saveSessionBtn','clearSessionBtn',
  'zoomIn','zoomOut','zoomFit','zoomLbl','sigBtn','imgBtn','undoBtn','redoBtn','delBtn',
  'dot','status','sessionTag','fontBtn','fontBtnTxt','fontPanel','fontSearch','fontPreviewText',
  'fontList','sizeIn','slantIn','jitterIn','colorIn','penW','rotIn','recolorBtn','snapLines',
  'brushW','fillModeIn','featherIn','fillIn','autoFillBtn','pickBtn','autoFillIn',
  'side','thumbs','viewer','empty','heroHand','openBtn2','pages',
  'sigModal','pad','padW','padUndo','padClear','sigImgBtn','sigImgCanvas','sigImgEmpty',
  'bgRemove','bgTol','bgAutoBtn','sigRecolor','sigRecolorC','sigCrop','sigWeight','libGrid',
  'sigAtBL','sigAtBC','sigAtBR','sigAllPages','saveLibWrap','saveLib','keepPadWrap','keepPad','sigUse',
  'saveModal','saveInfo','trueRemove','flatOpts','flatFormat','flatDpi','flatQuality',
  'flatQualityLbl','flatHint','saveGo','fileInput','imgInput','sigImgInput','measure','toast','busy','busyTxt',
  'thumbsToggle','inspectorToggle','inspectorClose',
];
const REQUIRED_SELECTORS = [
  'header', '#wrap', '#chrome', '#rail', '#inspector', '#fileTitle',
  '.ctx .sec[data-ctx]', '.ctx .sec.show', '[data-tool]', '[data-es]', '.tabs [data-tab]',
  '.th', '.page', '.layer', '#fontList .fi',
];

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox', testFile('scan-test.pdf')],
  env: electronEnv,
});
try {
  const w = await app.firstWindow();
  await w.waitForFunction(() => window.__app && window.__app.pages.length > 0, null, { timeout: 60000 });
  const missingIds = await w.evaluate(ids => ids.filter(id => !document.getElementById(id)), REQUIRED_IDS);
  const missingSelectors = await w.evaluate(sels => sels.filter(s => !document.querySelector(s)), REQUIRED_SELECTORS);
  const toolCount = await w.evaluate(() => document.querySelectorAll('[data-tool]').length);
  const secCount = await w.evaluate(() => document.querySelectorAll('#inspector .ctx .sec[data-ctx]').length);
  if (missingIds.length) throw new Error('Missing IDs: ' + missingIds.join(', '));
  if (missingSelectors.length) throw new Error('Missing selectors: ' + missingSelectors.join(', '));
  if (toolCount !== 5) throw new Error('Expected 5 [data-tool], got ' + toolCount);
  if (secCount !== 7) throw new Error('Expected 7 #inspector .ctx .sec, got ' + secCount);
  await w.click('[data-tool="erase"]');
  if (await w.evaluate(() => document.body.className) !== 'tool-erase') throw new Error('tool class not switched');
  console.log('editor DOM contract ok · 5 tools · 7 property sections');
} finally {
  await closeApp(app);
}
