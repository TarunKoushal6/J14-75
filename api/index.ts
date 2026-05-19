import type { VercelRequest, VercelResponse } from "@vercel/node";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require("../artifacts/api-server/dist/index.cjs");

export default function api(req: VercelRequest, res: VercelResponse) {
  const app = handler.default ?? handler;
  return app(req, res);
}
