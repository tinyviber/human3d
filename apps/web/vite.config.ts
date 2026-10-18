import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
/** The web app lives in apps/web but keeps consuming the repo-level `public/`
 * assets (models, dynamics records) and emitting `dist/` at the repo root —
 * the dev server and the preview keep the same URLs and output layout the QA
 * scripts and docs expect. `server.fs.allow` covers the workspace sources
 * (packages/motion-core) so the linked package can be served through /@fs/. */
const repoRoot=fileURLToPath(new URL('../..',import.meta.url));
export default defineConfig({
  plugins:[react()],
  publicDir:path.resolve(repoRoot,'public'),
  build:{
    outDir:path.resolve(repoRoot,'dist'),
    emptyOutDir:true,
    rollupOptions:{input:{main:'index.html',workshop:'workshop.html'},output:{manualChunks:{three:['three']}}},
  },
  server:{fs:{allow:[repoRoot]}},
});
