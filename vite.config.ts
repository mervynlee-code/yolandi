import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import path from 'node:path';

// Vite builds admin/index.html → admin/admin.js + admin/admin.css
// We output non-hashed file names so PHP can enqueue fixed asset names.

export default defineConfig({
  root: path.resolve(__dirname, 'admin'),
  plugins: [
    react(),
    // monacoEditorPlugin({
    //   languageWorkers: ['json', 'html', 'css', 'editorWorkerService']
    // })
  ],
  build: {
    outDir: path.resolve(__dirname, 'admin/dist'),
    emptyOutDir: false, // don't wipe entire admin folder; we overwrite files below
    sourcemap: false,
    assetsDir: '.',
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'admin/index.html'),
      output: {
        entryFileNames: 'admin.js',
        assetFileNames: (chunkInfo) => {
          if (chunkInfo.name && chunkInfo.name.endsWith('.css')) return 'admin.css';
          if (chunkInfo.type === 'asset' && chunkInfo.fileName.endsWith('.css')) return 'admin.css';
          return '[name][extname]';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
