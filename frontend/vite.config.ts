import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  test: {
    environment: 'jsdom',
    setupFiles: ['./testing/setup.ts'],
    include: ['./testing/**/*.test.ts?(x)', './testing/**/*_test.ts?(x)'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const setCookie = proxyRes.headers['set-cookie']
            if (setCookie) {
              proxyRes.headers['set-cookie'] = (Array.isArray(setCookie) ? setCookie : [setCookie]).map(
                (cookie) => cookie.replace(/Domain=[^;]+;?\s*/gi, '')
              )
            }
          })
        },
      },
    },
  },
})
