import path from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Thư mục gốc của ứng dụng Electron (cha của test/). */
export const APP_ROOT = path.resolve(TEST_DIR, '..');
export const TEST_ROOT = TEST_DIR;
export const electronBin = path.join(APP_ROOT, 'node_modules/electron/dist/electron');
export const OUT = path.join(TEST_ROOT, 'out');

export function testFile(name) {
  return path.join(TEST_ROOT, name);
}
