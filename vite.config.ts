export default {
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/files': 'http://127.0.0.1:8788',
    },
  },
};
