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
  await w.waitForTimeout(250);   // chờ transition viền thumbnail kết thúc
  const initialCur = await w.evaluate(() => {
    const th = document.querySelector('.th.cur');
    return th ? getComputedStyle(th).borderTopColor : null;
  });
  if (missingIds.length) throw new Error('Missing IDs: ' + missingIds.join(', '));
  if (missingSelectors.length) throw new Error('Missing selectors: ' + missingSelectors.join(', '));
  if (toolCount !== 5) throw new Error('Expected 5 [data-tool], got ' + toolCount);
  if (secCount !== 7) throw new Error('Expected 7 #inspector .ctx .sec, got ' + secCount);
  if (initialCur !== 'rgb(11, 92, 213)') throw new Error('Thiếu viền thumbnail hiện tại ngay khi mở: ' + initialCur);
  const a11y = await w.evaluate(() => {
    const labelled = el => !!(el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    const size = el => { const s = getComputedStyle(el); return { w: parseFloat(s.width), h: parseFloat(s.height) }; };
    const icons = [...document.querySelectorAll('.iconBtn, .modal .x, .tdel, .sw, .fi .pin')];
    const texts = [...document.querySelectorAll('.tool span, .lbl, .hintBar, .fg, .padLine, .page .num, .th .n')];
    const modals = [...document.querySelectorAll('.modal')];
    return {
      statusLive: document.getElementById('status').getAttribute('aria-live'),
      toastLive: document.getElementById('toast').getAttribute('aria-live'),
      iconLabels: icons.every(labelled),
      unlabelled: icons.filter(el => !labelled(el)).map(el => el.id || el.className),
      smallText: texts.filter(el => parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.className || el.tagName),
      dialogRoles: modals.every(m => m.getAttribute('role') === 'dialog' && m.getAttribute('aria-modal') === 'true'),
      dialogLabels: modals.every(m => {
        const id = m.getAttribute('aria-labelledby');
        return !!(id && document.getElementById(id)?.textContent.trim());
      }),
      smallTargets: [...document.querySelectorAll('.iconBtn, #thumbsCollapse, .tdel, .sw, .fi .pin')]
        .filter(el => { const { w, h } = size(el); return w < 32 || h < 32; })
        .map(el => { const { w, h } = size(el); return `${el.id || el.className}:${w}x${h}`; }),
    };
  });
  if (a11y.statusLive !== 'polite' || a11y.toastLive !== 'polite') throw new Error('Thiếu aria-live: ' + JSON.stringify(a11y));
  if (!a11y.iconLabels) throw new Error('Icon-only thiếu aria-label/title: ' + a11y.unlabelled.join(', '));
  if (a11y.smallText.length) throw new Error('Có chữ nhỏ hơn 12px: ' + a11y.smallText.join(', '));
  if (!a11y.dialogRoles) throw new Error('Modal thiếu role="dialog"/aria-modal="true"');
  if (!a11y.dialogLabels) throw new Error('Modal thiếu aria-labelledby hợp lệ');
  if (a11y.smallTargets.length) throw new Error('Vùng bấm <32px: ' + a11y.smallTargets.join(', '));
  const modalStyle = await w.evaluate(() => {
    const css = sel => getComputedStyle(document.querySelector(sel));
    return {
      radius: css('#sigModal .dlg').borderRadius,
      head: css('#sigModal .dlgHead').height,
      footer: css('#sigModal .dlgFoot').position,
      pad: css('#sigModal .padWrap').height,
      saveCard: !!document.querySelector('#saveModal .trueCard'),
      saveNote: css('#saveModal .note.warnTxt').backgroundColor,
    };
  });
  if (modalStyle.radius !== '14px' || modalStyle.head !== '56px') throw new Error('Modal sai radius/header: ' + JSON.stringify(modalStyle));
  if (modalStyle.footer !== 'sticky' || modalStyle.pad !== '260px') throw new Error('Modal sai footer/pad: ' + JSON.stringify(modalStyle));
  if (!modalStyle.saveCard || modalStyle.saveNote === 'rgba(0, 0, 0, 0)') throw new Error('Modal Lưu thiếu card/note cảnh báo: ' + JSON.stringify(modalStyle));
  await w.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await w.evaluate(() => {
    const s = sel => getComputedStyle(document.querySelector(sel));
    return { side: s('#side').transitionDuration, toast: s('#toast').transitionDuration, toastAnim: s('#toast').animationName };
  });
  await w.emulateMedia({ reducedMotion: 'no-preference' });
  if (motion.side !== '0s' || motion.toast !== '0s' || motion.toastAnim !== 'none') throw new Error('prefers-reduced-motion chưa tắt chuyển động: ' + JSON.stringify(motion));
  await w.evaluate(() => document.body.classList.add('dirty', 'inspector-open'));
  await w.click('[data-tool="erase"]');
  const switched = await w.evaluate(() => ({
    tool: document.body.classList.contains('tool-erase'),
    dirty: document.body.classList.contains('dirty'),
    drawer: document.body.classList.contains('inspector-open'),
  }));
  if (!switched.tool) throw new Error('tool class not switched');
  if (!switched.dirty || !switched.drawer) throw new Error('setTool cleared state classes: ' + JSON.stringify(switched));
  const guard = await w.evaluate(() => {
    const fire = sel => {
      const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      document.querySelector(sel).dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    return { page: fire('#pages'), topbar: fire('#fileTitle'), input: fire('#fontSearch') };
  });
  if (guard.page) throw new Error('pointerdown trên canvas bị preventDefault: ' + JSON.stringify(guard));
  if (!guard.topbar) throw new Error('pointerdown trên top bar không còn được guard: ' + JSON.stringify(guard));
  if (guard.input) throw new Error('pointerdown trên input bị preventDefault: ' + JSON.stringify(guard));
  console.log('editor DOM contract ok · 5 tools · 7 property sections');
} finally {
  await closeApp(app);
}
