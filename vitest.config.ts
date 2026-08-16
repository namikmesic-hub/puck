import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Unit tests never boot Electron; the mock covers the small surface
      // the main-process modules touch (paths, safeStorage, windows).
      electron: path.resolve(__dirname, 'test/mocks/electron.ts'),
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
});
