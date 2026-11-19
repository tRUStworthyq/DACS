import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const gateway = 'http://localhost:8765'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      // API traffic stays on the Vite origin in the browser; Vite forwards it to Gateway.
      '/api': { target: gateway, changeOrigin: true },
      // Gateway may redirect an unauthenticated request to this OAuth2 endpoint.
      '/oauth2': { target: gateway, changeOrigin: true },
      // OAuth2 callback path, in case the provider returns through the frontend origin.
      '/login/oauth2': { target: gateway, changeOrigin: true },
      '/logout': { target: gateway, changeOrigin: true },
    },
  },
})
