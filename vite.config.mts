import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  // Electron opens the production build with file://, so assets must resolve
  // relative to index.html instead of the filesystem root.
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
});
