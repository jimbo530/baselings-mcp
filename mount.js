// Baselings Agent SDK — Mount helper
// Usage in server.js:  require('./agent-sdk/mount')(app);

module.exports = function mount(app) {
  const agentRoutes = require('./api-routes');
  app.use(agentRoutes);
  console.log('[agent-sdk] Agent API routes mounted at /agent/*');
};
