import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal Vite config for the prototype.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
