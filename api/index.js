const handler = require("../artifacts/api-server/dist/index.cjs");

module.exports = function api(req, res) {
  const app = handler.default ?? handler;
  return app(req, res);
};
