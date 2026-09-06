import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base defaults to '/' (Vercel). GH Pages workflow sets VITE_BASE='/bountybot/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  server: { port: 5173 },
});
