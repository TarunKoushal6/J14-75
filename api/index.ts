// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require("../artifacts/api-server/dist/index.cjs");

export default function api(req: any, res: any) {
  const app = handler.default ?? handler;
  return app(req, res);
}
