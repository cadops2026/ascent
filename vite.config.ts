import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Vite's default binds "localhost", which on this machine resolves to IPv6
    // ::1 ONLY — so a browser that resolves localhost to 127.0.0.1 gets
    // connection refused and the app looks dead. 0.0.0.0 binds IPv4 so both
    // 127.0.0.1 and localhost work. Dev server only; it serves the app bundle,
    // never data (that lives in Supabase behind auth).
    host: '0.0.0.0',
    port: 5173,
  },
})
