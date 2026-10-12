
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import fs from 'node:fs';
import path from 'node:path';

// Wave 3 dev-server helpers for the vote page (vote.html): same-origin proxies so Lace's service worker never
// has to reach localhost directly, and the compiled ZK artifacts served under /zk.
const ZK_DIRS = [path.resolve(__dirname, 'zk-artifacts'), path.resolve(__dirname, '../contract/src/managed/nightpoll')];
const PROOF_SERVER = process.env.NP_PROOF_SERVER ?? 'http://127.0.0.1:6300';
const RELAYER = process.env.NP_RELAYER_URL ?? 'http://127.0.0.1:8790';
const zkAssets = {
  name: 'nightpoll-zk-assets',
  configureServer(server: { middlewares: { use: (p: string, h: (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: Buffer | string): void }, next: () => void) => void) => void } }) {
    server.middlewares.use('/zk', (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
      if (!/^(keys\/[A-Za-z]+\.(prover|verifier)|zkir\/[A-Za-z]+\.bzkir)$/.test(rel)) return next();
      const f = ZK_DIRS.map((d) => path.join(d, rel)).find((x) => fs.existsSync(x));
      if (!f) { res.statusCode = 404; return res.end('missing ZK artifact; run `npm run compact` first'); }
      res.setHeader('content-type', 'application/octet-stream');
      res.end(fs.readFileSync(f));
    });
  },
};
// import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: './.vite',
  build: {
    target: 'esnext',
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Separate chunk for WASM modules to avoid top-level await issues
          if (id.includes('onchain-runtime-v3')) return 'wasm';
        },
      },
      },
    commonjsOptions: {
      // Transform CommonJS to ESM more aggressively
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      // Needed for Node.js modules
      ignoreDynamicRequires: true,
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/proof-server': { target: PROOF_SERVER, changeOrigin: true, rewrite: (p) => p.replace(/^\/proof-server/, '') },
      '/relayer': { target: RELAYER, changeOrigin: true, rewrite: (p) => p.replace(/^\/relayer/, '') },
    },
  },
  plugins: [
    zkAssets,
    react(),
    // Configure WASM plugin with more options
    wasm(),
    // Custom resolver for handling problematic modules
    {
      name: 'wasm-module-resolver',
      resolveId(source, importer) {
        // Special handling for the problematic module
        if (
          source === '@midnight-ntwrk/onchain-runtime-v3' &&
          importer &&
          importer.includes('@midnight-ntwrk/compact-runtime')
        ) {
          // Force dynamic import for this case
          return {
            id: source,
            external: false,
            moduleSideEffects: true,
          };
        }
        return null;
      },
    },
  ],
  optimizeDeps: {
    rolldownOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
      // Configure ESBuild to handle Node.js-style modules
      platform: 'browser',
      format: 'esm',
      loader: {
        '.wasm': 'binary',
      },
    },
    // Explicitly include these packages for pre-bundling, but force ESM
    include: ['@midnight-ntwrk/compact-runtime'],
    // Exclude WASM files and modules with top-level await from optimization
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
    ],
  },
  define: {},
  checks: {
    importIsUndefined: false,
    pluginTimings: false,
  },
  // Add specific import configuration for more control
  resolve: {
    // Ensure WASM files are loaded properly
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
});
