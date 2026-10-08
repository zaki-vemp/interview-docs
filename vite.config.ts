import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // sucrase is only imported lazily (TypeScript runs); pre-bundle it so the dev
  // server doesn't re-optimise dependencies mid-session on the first TS run
  optimizeDeps: { include: ['sucrase'] },
  server: { port: 5173 },
});
