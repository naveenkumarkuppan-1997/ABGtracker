// Runs the production build on this machine: one process serves the API and the web app.
//   npm run host      ->  http://localhost:4000
// Data stays in ./server-data (embedded PostgreSQL). Only this computer can connect (HOST=127.0.0.1).
export {};
const port = process.env.PORT ?? '4000';
process.env.NODE_ENV ??= 'production';
process.env.PORT = port;
process.env.HOST ??= '127.0.0.1';
process.env.PUBLIC_URL ??= `http://localhost:${port}`;
process.env.ALLOW_INSECURE_HTTP ??= '1'; // plain http is fine for localhost
process.env.ALLOW_EMBEDDED_DB ??= '1';
process.env.ALLOW_MOCK_SERVICES ??= '1'; // local demo: pretend billing, sign-in and AI are connected
await import('./index');
