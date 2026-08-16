/** Minimal Electron surface for unit tests (never a real browser process). */

import * as os from 'node:os';
import * as path from 'node:path';

export const app = {
  getPath: (name: string): string => path.join(os.tmpdir(), `puck-test-${name}`),
  quit: (): void => undefined,
  on: (): void => undefined,
};

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8'),
};

export class BrowserWindow {
  webContents = { on: (): void => undefined, setWindowOpenHandler: (): void => undefined };
  loadURL(): void {}
  close(): void {}
}

export const shell = { openExternal: async (): Promise<void> => undefined };
export const ipcMain = { handle: (): void => undefined };
