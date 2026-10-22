import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { HttpError } from './errors';
import { getMongoDb } from './mongodb';

export interface MongoIntegrationTestResult {
  success: boolean;
  testRunId: string;
  database: string;
  collection: string;
  stages: {
    authenticated: boolean;
    userAuthorized: boolean;
    clientReady: boolean;
    writeAcknowledged: boolean;
    readVerified: boolean;
    deleted: boolean;
    cleanupConfirmed: boolean;
  };
  durationMs: number;
  error?: string;
  cleanupError?: string;
}

/**
 * Registers the controlled MongoDB integration test endpoint.
 *
 * Strict safety rules:
 * - Registered ONLY when MONGODB_INTEGRATION_TEST_ENABLED=true AND not in production.
 * - Requires server-verified Firebase authentication and valid account authorization.
 * - Writes strictly to the fixed '_test_diagnostics' collection in database 'abg_tracker'.
 * - Operates strictly on a single uniquely identified synthetic record.
 * - Never drops collections, alters schemas, or touches other records.
 * - Deletes the created record in a finally block and verifies cleanup.
 */
export function registerMongoTestRoutes(
  app: FastifyInstance,
  isProduction: boolean,
  requireUser: (req: FastifyRequest) => string
): void {
  const isExplicitlyEnabled = process.env.MONGODB_INTEGRATION_TEST_ENABLED === 'true';
  if (!isExplicitlyEnabled || isProduction || process.env.NODE_ENV === 'production') {
    return;
  }

  app.post('/api/test/mongodb-integration', async (req, reply) => {
    const startTime = Date.now();

    // 1. Enforce user authentication & authorization
    const userId = requireUser(req);
    if (!userId) {
      throw new HttpError(401, 'Unauthorized.');
    }

    // 2. Confirm MongoDB client is initialized
    const db = getMongoDb('abg_tracker');
    if (!db) {
      reply.code(503);
      return {
        success: false,
        testRunId: '',
        database: 'abg_tracker',
        collection: '_test_diagnostics',
        stages: {
          authenticated: true,
          userAuthorized: true,
          clientReady: false,
          writeAcknowledged: false,
          readVerified: false,
          deleted: false,
          cleanupConfirmed: false,
        },
        durationMs: Date.now() - startTime,
        error: 'MongoDB Atlas client is unavailable or disconnected.',
      };
    }

    const testCollectionName = '_test_diagnostics';
    const collection = db.collection(testCollectionName);

    // 3. Construct uniquely identified synthetic probe document
    const testDocId = new ObjectId();
    const testRunId = `phase4a_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const syntheticNonce = randomBytes(8).toString('hex');
    const timestamp = new Date().toISOString();

    const testDoc = {
      _id: testDocId,
      testRunId,
      category: 'synthetic_integration_probe',
      purpose: 'Phase 4A authenticated read-write-delete verification',
      probeTimestamp: timestamp,
      actorHash: randomBytes(8).toString('hex'), // Opaque random hash; no user PII
      payload: {
        metricValue: 42,
        nonce: syntheticNonce,
      },
    };

    const stages = {
      authenticated: true,
      userAuthorized: true,
      clientReady: true,
      writeAcknowledged: false,
      readVerified: false,
      deleted: false,
      cleanupConfirmed: false,
    };

    let inserted = false;
    let originalError: string | undefined;
    let cleanupError: string | undefined;

    try {
      // 4. Write: insert one uniquely identified document
      const insertResult = await collection.insertOne(testDoc);
      if (!insertResult.acknowledged || !insertResult.insertedId) {
        throw new Error('Insert operation was not acknowledged by MongoDB Atlas.');
      }
      inserted = true;
      stages.writeAcknowledged = true;

      // 5. Read back: fetch exact document using unique _id and testRunId
      const found = await collection.findOne({
        _id: testDocId,
        testRunId,
      });

      if (!found) {
        throw new Error('Verification read failed: written document was not found.');
      }

      // Assert expected synthetic fields match exactly
      if (
        found.testRunId !== testRunId ||
        found.payload?.nonce !== syntheticNonce ||
        found.payload?.metricValue !== 42
      ) {
        throw new Error('Verification read failed: document contents do not match inserted payload.');
      }
      stages.readVerified = true;
    } catch (err) {
      originalError = err instanceof Error ? err.message : String(err);
    } finally {
      // 6. Delete only this exact document if it was inserted
      if (inserted) {
        try {
          const deleteResult = await collection.deleteOne({
            _id: testDocId,
            testRunId,
          });

          if (deleteResult.deletedCount === 1) {
            stages.deleted = true;
          } else {
            cleanupError = `Expected deletedCount 1, received ${deleteResult.deletedCount}`;
          }

          // 7. Confirm cleanup: verify document is gone
          const confirmGone = await collection.findOne({ _id: testDocId });
          if (confirmGone === null && stages.deleted) {
            stages.cleanupConfirmed = true;
          } else if (confirmGone !== null) {
            cleanupError = 'Cleanup verification failed: document still exists after deletion.';
          }
        } catch (delErr) {
          cleanupError = delErr instanceof Error ? delErr.message : String(delErr);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const isSuccess =
      !originalError &&
      !cleanupError &&
      stages.writeAcknowledged &&
      stages.readVerified &&
      stages.deleted &&
      stages.cleanupConfirmed;

    if (!isSuccess) {
      reply.code(500);
      return {
        success: false,
        testRunId,
        database: 'abg_tracker',
        collection: testCollectionName,
        stages,
        durationMs,
        error: originalError || 'Integration test failed.',
        cleanupError,
      };
    }

    return {
      success: true,
      testRunId,
      database: 'abg_tracker',
      collection: testCollectionName,
      stages,
      durationMs,
    };
  });
}
