import { describe, expect, it, beforeEach } from 'vitest';
import { loadConfig } from './config';
import {
  checkMongoHealth,
  closeMongoClient,
  extractDatabaseName,
  getDefaultMongoOptions,
  getMongoClient,
  getMongoDb,
  initMongoClient,
  isValidMongoUri,
  redactMongoUri,
} from './mongodb';

describe('MongoDB Atlas Module', () => {
  beforeEach(async () => {
    delete process.env.MONGODB_URI;
    await closeMongoClient();
  });

  describe('URI validation (isValidMongoUri)', () => {
    it('accepts valid mongodb:// and mongodb+srv:// connection URIs', () => {
      expect(isValidMongoUri('mongodb://localhost:27017/abg_tracker')).toBe(true);
      expect(isValidMongoUri('mongodb+srv://cluster-user:secret123@cluster0.example.mongodb.net/abg_tracker?retryWrites=true')).toBe(true);
      expect(isValidMongoUri('  mongodb+srv://cluster0.example.mongodb.net/abg_tracker  ')).toBe(true);
    });

    it('rejects non-MongoDB schemes and invalid strings', () => {
      expect(isValidMongoUri('')).toBe(false);
      expect(isValidMongoUri('http://localhost:27017')).toBe(false);
      expect(isValidMongoUri('postgres://user:pass@localhost:5432/abg')).toBe(false);
      expect(isValidMongoUri('redis://localhost:6379')).toBe(false);
      expect(isValidMongoUri(null as unknown as string)).toBe(false);
    });
  });

  describe('Credential Redaction (redactMongoUri)', () => {
    it('masks username and password credentials safely', () => {
      const uri = 'mongodb+srv://super_admin:MyP@ssw0rd!@cluster0.abcde.mongodb.net/abg_prod?retryWrites=true&w=majority';
      const redacted = redactMongoUri(uri);
      expect(redacted).not.toContain('MyP@ssw0rd!');
      expect(redacted).not.toContain('super_admin');
      expect(redacted).toContain('cluster0.abcde.mongodb.net/abg_prod');
      expect(redacted).toMatch(/^mongodb\+srv:\/\/\*\*\*\*:\*\*\*\*@cluster0/);
    });

    it('handles empty or non-string inputs safely without throwing', () => {
      expect(redactMongoUri('')).toBe('');
      expect(redactMongoUri(undefined as unknown as string)).toBe('');
    });
  });

  describe('Database Name Extraction (extractDatabaseName)', () => {
    it('extracts database name from connection strings', () => {
      expect(extractDatabaseName('mongodb+srv://user:pass@cluster.mongodb.net/my_app?retryWrites=true')).toBe('my_app');
      expect(extractDatabaseName('mongodb://127.0.0.1:27017/custom_db')).toBe('custom_db');
    });

    it('returns undefined when no database path segment is provided', () => {
      expect(extractDatabaseName('mongodb+srv://user:pass@cluster.mongodb.net/')).toBeUndefined();
      expect(extractDatabaseName('mongodb+srv://user:pass@cluster.mongodb.net')).toBeUndefined();
    });
  });

  describe('Connection Options & Pooling (getDefaultMongoOptions)', () => {
    it('configures conservative connection pool limits and timeouts', () => {
      const opts = getDefaultMongoOptions();
      expect(opts.maxPoolSize).toBe(10);
      expect(opts.minPoolSize).toBe(1);
      expect(opts.serverSelectionTimeoutMS).toBe(5000);
      expect(opts.connectTimeoutMS).toBe(10000);
      expect(opts.retryWrites).toBe(true);
    });
  });

  describe('Unconfigured State Handling', () => {
    it('returns null and does not throw when MONGODB_URI is absent', async () => {
      const client = await initMongoClient(undefined);
      expect(client).toBeNull();
      expect(getMongoClient()).toBeNull();
      expect(getMongoDb()).toBeNull();
    });

    it('reports unconfigured status via checkMongoHealth when URI is missing', async () => {
      const health = await checkMongoHealth();
      expect(health).toEqual({ configured: false, connected: false });
    });

    it('rejects malformed URIs when provided explicitly', async () => {
      await expect(initMongoClient('invalid-protocol://host:1234')).rejects.toThrow(
        /MONGODB_URI must start with mongodb:\/\/ or mongodb\+srv:\/\//
      );
    });
  });

  describe('Configuration Schema Integration (loadConfig)', () => {
    const validBase = {
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://tracker.example.com',
    };

    it('parses and accepts a valid MONGODB_URI', () => {
      const cfg = loadConfig({
        ...validBase,
        MONGODB_URI: 'mongodb+srv://app_user:pass@cluster0.xyz.mongodb.net/abg?retryWrites=true',
      });
      expect(cfg.mongodbUri).toBe('mongodb+srv://app_user:pass@cluster0.xyz.mongodb.net/abg?retryWrites=true');
    });

    it('rejects an invalid MONGODB_URI in configuration', () => {
      expect(() =>
        loadConfig({
          ...validBase,
          MONGODB_URI: 'https://cluster0.xyz.mongodb.net',
        })
      ).toThrow(/MONGODB_URI must start with mongodb:\/\/ or mongodb\+srv:\/\//);
    });
  });
});
