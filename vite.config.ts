import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import path from 'node:path';

// Vite builds admin/index.html → admin/dist/admin.js + admin/dist/admin.css
// Keep fixed names ONLY for the entry and CSS. Put code-split chunks under /chunks with hashes.

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname, 'admin'),
  base: command === 'build'
    ? '/wp-content/plugins/yolandi/admin/dist/'   // public URL prefix in WP
    : '/',
  plugins: [
    react(),
    // monacoEditorPlugin({
    //   languageWorkers: ['json', 'html', 'css', 'editorWorkerService']
    // })
  ],
  build: {
    outDir: path.resolve(__dirname, 'admin/dist'),
    emptyOutDir: false,
    sourcemap: false,
    assetsDir: '.',          // keep entry & css at dist/ root
    cssCodeSplit: false,     // single admin.css
    target: 'es2019',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: path.resolve(__dirname, 'admin/index.html'),
      output: {
        // Keep the entry stable for WP enqueue:
        entryFileNames: 'admin.js',

        // IMPORTANT: give code-split chunks unique, hashed names in a separate folder:
        chunkFileNames: 'chunks/[name]-[hash].js',

        // Keep CSS stable as admin.css; hash other assets if any:
        assetFileNames: (chunkInfo) => {
          if (chunkInfo.name && chunkInfo.name.endsWith('.css')) return 'admin.css';
          if (chunkInfo.type === 'asset' && chunkInfo.fileName.endsWith('.css')) return 'admin.css';
          // images/fonts/etc; hashed to avoid collisions
          return 'assets/[name]-[hash][extname]';
        },

        // Ensure React/JSX runtime isn’t bundled into the entry;
        // lazy chunks will import from chunks/vendor-react-*.js instead of ./admin.js
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/react/')) return 'vendor-react';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
}));
