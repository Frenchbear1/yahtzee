import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig({
  root: project + 'pages',
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': project } },
  publicDir: project + 'public',
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: project + '.pages-dist', emptyOutDir: true },
});
