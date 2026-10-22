// Development entry: starts the API with sample organizations (only if the database is empty).
export {};
process.env.SEED_DEMO ??= '1';
process.env.PORT = '4000';
process.env.HOST ??= '127.0.0.1';
await import('./index');
