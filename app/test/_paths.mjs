import path from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Thư mục gốc của ứng dụng Electron (cha của test/). */
export const APP_ROOT = path.resolve(TEST_DIR, '..');
export const TEST_ROOT = TEST_DIR;
/** Electron đóng gói kèm tên khác nhau theo hệ điều hành. */
export const electronBin = path.join(
  APP_ROOT,
  'node_modules/electron/dist/electron' + (process.platform === 'win32' ? '.exe' : ''),
);
export const OUT = path.join(TEST_ROOT, 'out');

/**
 * Môi trường để chạy Electron.
 * Một số môi trường (IDE gắn Electron, CI) đặt ELECTRON_RUN_AS_NODE=1 —
 * khi đó electron.exe chạy như Node thuần và app sẽ không khởi động được.
 */
export const electronEnv = (() => {
  const e = { ...process.env };
  delete e.ELECTRON_RUN_AS_NODE;
  e.TSP_NO_SINGLE_INSTANCE = '1';   // test không bị chặn bởi khoá một-instance
  return e;
})();

export function testFile(name) {
  return path.join(TEST_ROOT, name);
}

/**
 * Đóng app an toàn khi chạy test.
 * main.js có "hàng rào" hỏi xác nhận khi thoát lúc còn thay đổi chưa lưu — hộp thoại này
 * sẽ CHẶN tiến trình test vô thời hạn. Vì vậy phải xoá cờ "chưa lưu" trước khi đóng.
 */
export async function closeApp(app) {
  try {
    const w = app.windows()[0];
    if (w) await w.evaluate(() => { if (window.api) window.api.setDirty(false); });
  } catch { /* cửa sổ có thể đã đóng */ }
  await app.close().catch(() => {});
}

/** Thư mục thư viện chữ ký (khớp với app.getPath('userData')/signatures). */
export function sigLibDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(appData, 'TrinhSuaPDF', 'signatures');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'TrinhSuaPDF', 'signatures');
  }
  return path.join(process.env.HOME || '', '.config', 'TrinhSuaPDF', 'signatures');
}
