import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const apiPort = process.env.PORT ?? '8787';
const browserMemory = fileURLToPath(new URL('./src/local/memory.ts', import.meta.url));

export default defineConfig({
  plugins: [
    {
      // In the browser build the agents keep the band's memory in the page (src/local/memory.ts) instead of Neo4j.
      name: 'browser-band-memory',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './memory.js' && importer && /server[\\/]agents\.ts$/.test(importer)) return browserMemory;
        return null;
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
