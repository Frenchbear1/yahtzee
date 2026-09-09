import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({root:project+'lan',plugins:[react()],resolve:{alias:{'@':project}},publicDir:false,css:{postcss:{plugins:[tailwindcss()]}},build:{outDir:project+'.local-build/public',emptyOutDir:true}});
