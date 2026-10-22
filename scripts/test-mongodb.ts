/**
 * Safe connection test script for MongoDB Atlas.
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<database>" npx tsx scripts/test-mongodb.ts
 *
 * This script never logs passwords or secrets.
 */
import {
  initMongoClient,
  closeMongoClient,
  redactMongoUri,
  getMongoDb,
  isValidMongoUri,
} from '../server/mongodb';

try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {
  // .env file is optional
}

async function run() {
  const uri = process.env.MONGODB_URI;

  console.log('--- ABG Tracker V2: MongoDB Atlas Connectivity Diagnostic ---');

  if (!uri) {
    console.error('ERROR: MONGODB_URI environment variable is not defined.');
    console.error('To test your connection, run:');
    console.error('  MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<database>" npx tsx scripts/test-mongodb.ts');
    process.exit(1);
  }

  if (!isValidMongoUri(uri)) {
    console.error(`ERROR: Invalid MONGODB_URI format: "${redactMongoUri(uri)}"`);
    console.error('The URI must begin with mongodb:// or mongodb+srv://');
    process.exit(1);
  }

  const redacted = redactMongoUri(uri);
  console.log(`Connecting to: ${redacted}`);

  const startTime = Date.now();
  try {
    const client = await initMongoClient(uri);
    if (!client) {
      throw new Error('Client failed to initialize.');
    }

    const elapsed = Date.now() - startTime;
    console.log(`Connection established in ${elapsed}ms.`);

    // Perform ping
    const adminDb = client.db('admin');
    const pingResult = await adminDb.command({ ping: 1 });
    console.log('Atlas cluster ping response:', pingResult);

    // Check target database
    const db = getMongoDb();
    if (db) {
      console.log(`Selected target database: "${db.databaseName}"`);
      const collections = await db.listCollections().toArray();
      console.log(`Existing collections (${collections.length}):`, collections.map((c) => c.name));
    }

    console.log('MongoDB Atlas connection verification SUCCEEDED.');
  } catch (error) {
    console.error('MongoDB Atlas connection verification FAILED.');
    console.error('Error detail:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await closeMongoClient();
  }
}

run();
