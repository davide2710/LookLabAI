import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  
  return {
    plugins: [react()],
    base: '/',
    define: {
      // Importante: puntiamo a window.process.env per rendere la chiave reattiva
      // alle modifiche effettuate dal selettore di chiavi di Google Studio
      'process.env.API_KEY': 'window.process.env.API_KEY || ""'
    },
    build: {
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-ui': ['recharts', 'lucide-react'],
            'vendor-utils': ['jszip', 'file-saver'],
            'vendor-ai': ['@google/genai'],
          }
        }
      }
    }
  }
})