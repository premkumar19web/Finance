import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development the browser calls /api on the Vite server, which forwards to the
    // backend. Same origin = no CORS and the session cookie always works, however the
    // site is opened (localhost, 127.0.0.1, [::1]).
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
