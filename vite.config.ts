import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // `npm run dev` doesn't serve api/; point /api at a deployed relay to exercise Muse sync locally.
  const relay = loadEnv(mode, '.', '').MUSE_RELAY_DEV_TARGET
  return {
    plugins: [react()],
    server: relay ? { proxy: { '/api': { target: relay, changeOrigin: true } } } : undefined,
  }
})
