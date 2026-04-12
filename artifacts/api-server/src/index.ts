import app from "./app.js";

// For local development: start the server when PORT is set.
// On Vercel (serverless), PORT is not set and the app is exported as a handler.
const rawPort = process.env["PORT"];
if (rawPort) {
  const port = Number(rawPort);
  if (!Number.isNaN(port) && port > 0) {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  }
}

// Export the Express app as the default export for Vercel serverless (@vercel/node).
export default app;
