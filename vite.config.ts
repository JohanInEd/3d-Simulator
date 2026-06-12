import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Honor an externally assigned port (e.g. preview harnesses). Default is
    // 5180, NOT vite's usual 5173 — another project (SysG frontend) pins 5173
    // on this machine, so the sandbox claims its own port.
    port: process.env.PORT ? Number(process.env.PORT) : 5180,
  },
});
