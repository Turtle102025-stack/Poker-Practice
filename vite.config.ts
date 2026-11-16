import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base: './' makes the built site work from any sub-path (e.g. GitHub Pages /Poker-Practice/).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
