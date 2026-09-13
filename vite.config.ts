export default {
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/files': 'http://127.0.0.1:8788',
      // Gallery artwork is served from data/gallery, not dist/. Without this
      // the SPA fallback answers every thumbnail with index.html.
      '/gallery-files': 'http://127.0.0.1:8788',
    },
  },
};
