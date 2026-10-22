/**
 * Server-only MongoDB Atlas connection manager.
 *
 * Provides:
 * - Connection pooling and lifecycle management
 * - URI validation and credential redaction
 * - Health verification and graceful teardown
 *
 * Security note: MONGODB_URI is strictly server-only. It must never be exposed
 * to frontend code, VITE_ variables, browser responses, or unredacted logs.
 */
import { MongoClient, type MongoClientOptions, type Db } from 'mongodb';

export interface MongoConnectionStatus {
  configured: boolean;
  connected: boolean;
  database?: string;
  error?: string;
}

let clientInstance: MongoClient | null = null;
let currentDbName: string | undefined = undefined;

/**
 * Redacts username and password from a MongoDB connection string.
 * Safe to use in log messages and error diagnostics.
 */
export function redactMongoUri(uri: string): string {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)@([^/?#]+)(.*)$/i);
    if (match) {
      return `${match[1]}****:****@${match[3]}${match[4]}`;
    }
    return uri;
  } catch {
    return 'mongodb://[REDACTED]';
  }
}

/**
 * Validates whether a given URI matches the standard MongoDB connection string format.
 */
export function isValidMongoUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  return trimmed.startsWith('mongodb://') || trimmed.startsWith('mongodb+srv://');
}

/**
 * Extracts the default database name from a MongoDB URI if present.
 */
export function extractDatabaseName(uri: string): string | undefined {
  if (!uri || typeof uri !== 'string') return undefined;
  try {
    const withoutProtocol = uri.replace(/^mongodb(?:\+srv)?:\/\//i, '');
    const slashIdx = withoutProtocol.indexOf('/');
    if (slashIdx === -1) return undefined;
    const pathAndQuery = withoutProtocol.slice(slashIdx + 1);
    const qIdx = pathAndQuery.indexOf('?');
    const dbSegment = qIdx === -1 ? pathAndQuery : pathAndQuery.slice(0, qIdx);
    const decoded = decodeURIComponent(dbSegment.trim());
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Default connection pool and timeout options tailored for MongoDB Atlas.
 */
export function getDefaultMongoOptions(): MongoClientOptions {
  return {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    retryWrites: true,
  };
}

/**
 * Initializes and connects the MongoDB client if MONGODB_URI is provided.
 * If not configured, gracefully returns null without throwing.
 */
export async function initMongoClient(uri?: string, options?: MongoClientOptions): Promise<MongoClient | null> {
  const targetUri = uri || process.env.MONGODB_URI;
  if (!targetUri) {
    return null;
  }

  if (!isValidMongoUri(targetUri)) {
    throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  if (clientInstance) {
    return clientInstance;
  }

  const mergedOptions: MongoClientOptions = {
    ...getDefaultMongoOptions(),
    ...options,
  };

  const client = new MongoClient(targetUri, mergedOptions);
  try {
    await client.connect();
    // Verify reachability
    await client.db('admin').command({ ping: 1 });
  } catch (err) {
    try {
      await client.close();
    } catch {
      // ignore close error on failed connection
    }
    throw err;
  }

  clientInstance = client;
  currentDbName = extractDatabaseName(targetUri) || 'abg_tracker';

  const redacted = redactMongoUri(targetUri);
  console.log(`MongoDB Atlas client connected (${redacted}, database: ${currentDbName})`);

  return clientInstance;
}

/**
 * Returns the currently active MongoClient instance, or null if uninitialized.
 */
export function getMongoClient(): MongoClient | null {
  return clientInstance;
}

/**
 * Returns a handle to the MongoDB Database, or null if client is not connected.
 */
export function getMongoDb(dbName?: string): Db | null {
  if (!clientInstance) return null;
  return clientInstance.db(dbName || currentDbName || 'abg_tracker');
}

/**
 * Checks connection health without throwing.
 */
export async function checkMongoHealth(): Promise<MongoConnectionStatus> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return { configured: false, connected: false };
  }

  if (!clientInstance) {
    return { configured: true, connected: false, error: 'Client not connected' };
  }

  try {
    await clientInstance.db('admin').command({ ping: 1 });
    return {
      configured: true,
      connected: true,
      database: currentDbName,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Gracefully closes the MongoDB connection pool if open.
 */
export async function closeMongoClient(): Promise<void> {
  if (clientInstance) {
    try {
      await clientInstance.close();
      console.log('MongoDB connection closed.');
    } finally {
      clientInstance = null;
      currentDbName = undefined;
    }
  }
}
