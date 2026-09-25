// Extends app.json. EXPO_WEB_BASE_URL lets the web build live under a sub-path
// (GitHub Pages serves this repo at /movie-app-/); native builds never set it.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_WEB_BASE_URL ? { baseUrl: process.env.EXPO_WEB_BASE_URL } : {}),
  },
});
