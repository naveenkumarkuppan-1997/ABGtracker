import path from 'node:path';
import { BLOCKED_EXTENSIONS } from '../src/domain/attachments';
import type { ServiceMode, ServiceModes } from './services';

export interface ServerConfig {
  production: boolean;
  port: number;
  host: string;
  databaseUrl?: string;
  mongodbUri?: string;
  dataDir: string;
  publicUrl: string;
  allowSignup: boolean;
  seedDemo: boolean;
  smtpUrl?: string;
  mailFrom: string;
  staticDir: string;
  logLevel: string;
  trustProxy: boolean;
  /** Organizations kept in memory at once, and minutes before an idle one is dropped. */
  orgCacheMax: number;
  orgCacheIdleMinutes: number;
  /** Where uploaded files are kept (back this folder up together with the database). */
  filesDir: string;
  maxFileMb: number;
  publicMaxFileMb: number;
  orgStorageMb: number;
  maxFilesPerIssue: number;
  /** Extensions refused for upload. */
  blockedExtensions: string[];
  /** Hour of day (0-23, in each person's own time zone; UTC if unknown) when "once a day" summaries go out. */
  digestHour: number;
  /** Which outside services are plugged in (mock = pretend, for development and demos). */
  services: ServiceModes;
  /** Registration policy: 'open' | 'invite_only' | 'admin_only'. */
  registrationPolicy: 'open' | 'invite_only' | 'admin_only';
  /** Super admin email addresses allowed to manage platform settings. */
  superAdminEmails: string[];
  /** Whether to use MongoDB Atlas for persistent application entities when MONGODB_URI is provided. */
  useMongoStore: boolean;
}

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));

/**
 * Reads and validates the environment. In production it refuses to start with unsafe or
 * incomplete settings, naming each problem, instead of failing mysteriously later.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const problems: string[] = [];

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a number between 1 and 65535.');

  const rawPublicUrl = env.PUBLIC_URL || env.APP_URL;
  const publicUrl = (rawPublicUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
  try {
    new URL(publicUrl);
  } catch {
    problems.push('PUBLIC_URL must be a full address such as https://tracker.example.com.');
  }

  if (production) {
    if (!rawPublicUrl) problems.push('PUBLIC_URL is required in production (it is used in invitation and reset links).');
    else if (!/^https:\/\//i.test(publicUrl) && !bool(env.ALLOW_INSECURE_HTTP, false)) problems.push('PUBLIC_URL must use https:// in production (set ALLOW_INSECURE_HTTP=1 only for a private test).');
    if (env.ALLOW_EMBEDDED_DB !== undefined && !bool(env.ALLOW_EMBEDDED_DB, true) && !env.DATABASE_URL) {
      problems.push('DATABASE_URL is required when ALLOW_EMBEDDED_DB=0.');
    } else if (bool(env.REQUIRE_POSTGRES, false) && !env.DATABASE_URL) {
      problems.push('DATABASE_URL is required when REQUIRE_POSTGRES=1.');
    }
    if (bool(env.SEED_DEMO, false)) problems.push('SEED_DEMO must not be enabled in production: it creates accounts with a publicly known password.');
  }
  for (const [name, min] of [['ORG_CACHE_MAX', 1], ['ORG_CACHE_IDLE_MINUTES', 1], ['MAX_FILE_MB', 1], ['PUBLIC_MAX_FILE_MB', 1], ['ORG_STORAGE_MB', 1], ['MAX_FILES_PER_ISSUE', 1]] as const) {
    if (env[name] !== undefined && !(Number.isFinite(Number(env[name])) && Number(env[name]) >= min)) problems.push(`${name} must be a number of at least ${min}.`);
  }
  if (env.DIGEST_HOUR !== undefined && !(Number.isInteger(Number(env.DIGEST_HOUR)) && Number(env.DIGEST_HOUR) >= 0 && Number(env.DIGEST_HOUR) <= 23)) problems.push('DIGEST_HOUR must be a whole number from 0 to 23.');
  const mockOk = !production || bool(env.ALLOW_MOCK_SERVICES, false);
  const mode = (name: string): ServiceMode => {
    const v = (env[name] ?? (mockOk ? 'mock' : 'none')).toLowerCase();
    if (v !== 'none' && v !== 'mock') problems.push(`${name}=${v} is not available yet. Use none or mock; real providers are added by the development team (see docs/INTEGRATION-HANDOFF.md).`);
    else if (v === 'mock' && !mockOk) problems.push(`${name}=mock pretends to be a real service, so it is refused in production. Set ALLOW_MOCK_SERVICES=1 only for a demo, or use none.`);
    return v === 'mock' ? 'mock' : 'none';
  };
  const services: ServiceModes = { billing: mode('BILLING_PROVIDER'), sso: mode('SSO_PROVIDER'), ai: mode('AI_PROVIDER') };
  if (env.SMTP_URL) {
    try {
      const u = new URL(env.SMTP_URL);
      if (!/^smtps?:$/.test(u.protocol)) problems.push('SMTP_URL must start with smtp:// or smtps://.');
    } catch {
      problems.push('SMTP_URL is not a valid address (expected smtp://user:password@host:587).');
    }
  }

  if (env.MONGODB_URI) {
    const trimmed = env.MONGODB_URI.trim();
    if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
      problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
    }
  }

  if (problems.length) throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);

  return {
    production,
    port,
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    databaseUrl: env.DATABASE_URL || undefined,
    mongodbUri: env.MONGODB_URI?.trim() || undefined,
    dataDir: path.resolve(env.DATA_DIR ?? 'server-data'),
    publicUrl,
    allowSignup: bool(env.ALLOW_SIGNUP, true),
    seedDemo: bool(env.SEED_DEMO, false),
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM ?? 'ABG Tracker <no-reply@localhost>',
    staticDir: path.resolve(env.STATIC_DIR ?? 'dist'),
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: bool(env.TRUST_PROXY, false),
    orgCacheMax: Number(env.ORG_CACHE_MAX ?? 50),
    orgCacheIdleMinutes: Number(env.ORG_CACHE_IDLE_MINUTES ?? 30),
    filesDir: path.resolve(env.FILES_DIR ?? 'server-files'),
    maxFileMb: Number(env.MAX_FILE_MB ?? 25),
    publicMaxFileMb: Number(env.PUBLIC_MAX_FILE_MB ?? 10),
    orgStorageMb: Number(env.ORG_STORAGE_MB ?? 1024),
    maxFilesPerIssue: Number(env.MAX_FILES_PER_ISSUE ?? 25),
    digestHour: Number(env.DIGEST_HOUR ?? 8),
    services,
    blockedExtensions: env.BLOCKED_EXTENSIONS !== undefined ? env.BLOCKED_EXTENSIONS.split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean) : [...BLOCKED_EXTENSIONS],
    registrationPolicy: (['open', 'invite_only', 'admin_only'].includes(env.REGISTRATION_POLICY || '') ? env.REGISTRATION_POLICY : 'open') as 'open' | 'invite_only' | 'admin_only',
    superAdminEmails: (env.SUPER_ADMIN_EMAILS ? env.SUPER_ADMIN_EMAILS.split(',') : ['alex@acme.dev', 'naveenkumar.kuppan@adamsbridge.dev']).map((e) => e.trim().toLowerCase()).filter(Boolean),
    useMongoStore: bool(env.USE_MONGO_STORE, true),
  };
}
