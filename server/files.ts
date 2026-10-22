import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORG_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[a-f0-9]{32}$/;

/**
 * File bytes on disk, one folder per organization. Names on disk are random keys, so what a
 * person calls a file never becomes a path (no traversal, no collisions, no guessing).
 *
 *   <root>/<orgId>/<first 2 of key>/<key>
 */
export class FileStore {
  constructor(private root: string) {}

  private locate(orgId: string, key: string, variant?: 'thumb'): string {
    if (!ORG_RE.test(orgId) || !KEY_RE.test(key)) throw new Error('Invalid file location.'); // never built from raw user input, but guard anyway
    return path.join(this.root, orgId, key.slice(0, 2), variant === 'thumb' ? `${key}.thumb` : key);
  }

  /** The whole file in memory (files are capped at a few tens of MB). */
  readAll(orgId: string, key: string): Promise<Buffer> {
    return readFile(this.locate(orgId, key));
  }

  async hasThumb(orgId: string, key: string): Promise<boolean> {
    try {
      return (await stat(this.locate(orgId, key, 'thumb'))).isFile();
    } catch {
      return false;
    }
  }

  async writeThumb(orgId: string, key: string, bytes: Buffer): Promise<void> {
    const target = this.locate(orgId, key, 'thumb');
    const tmp = `${target}.part`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
  }

  readThumb(orgId: string, key: string): ReadStream {
    return createReadStream(this.locate(orgId, key, 'thumb'));
  }

  /** Writes the bytes (atomically: temp file, then rename) and returns how to find them again. */
  async write(orgId: string, bytes: Buffer): Promise<{ key: string; sha256: string; size: number }> {
    const key = randomBytes(16).toString('hex');
    const target = this.locate(orgId, key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.part`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }

  read(orgId: string, key: string): ReadStream {
    return createReadStream(this.locate(orgId, key));
  }

  async exists(orgId: string, key: string): Promise<boolean> {
    try {
      return (await stat(this.locate(orgId, key))).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Deletes files nothing refers to any more (a crash between writing the bytes and saving the record,
   * or a leftover temp file). `isKnown` says whether a record still uses a key. Files younger than
   * `minAgeMs` are never touched, so an upload that is still being saved is safe. Returns how many were removed.
   */
  async sweep(isKnown: (orgId: string, key: string) => boolean, minAgeMs: number, now = Date.now()): Promise<number> {
    let removed = 0;
    const dirs = async (p: string) => {
      try {
        return await readdir(p, { withFileTypes: true });
      } catch {
        return []; // nothing stored yet
      }
    };
    for (const org of await dirs(this.root)) {
      if (!org.isDirectory() || !ORG_RE.test(org.name)) continue;
      for (const shard of await dirs(path.join(this.root, org.name))) {
        if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue;
        for (const f of await dirs(path.join(this.root, org.name, shard.name))) {
          const m = /^([a-f0-9]{32})(\.thumb)?(\.part)?$/.exec(f.name);
          if (!f.isFile() || !m || m[1].slice(0, 2) !== shard.name) continue; // only ever touches names this store would have made
          if (!m[3] && isKnown(org.name, m[1])) continue;
          const full = path.join(this.root, org.name, shard.name, f.name);
          try {
            if (now - (await stat(full)).mtimeMs < minAgeMs) continue;
            await rm(full, { force: true });
            removed++;
          } catch {
            /* gone already, or busy: next time */
          }
        }
      }
    }
    return removed;
  }

  /** Removes everything stored for an organization (when the organization is deleted). */
  async removeOrg(orgId: string): Promise<void> {
    if (!ORG_RE.test(orgId)) throw new Error('Invalid file location.');
    await rm(path.join(this.root, orgId), { recursive: true, force: true });
  }

  /** Deleting something already gone is fine. */
  async remove(orgId: string, key: string): Promise<void> {
    await rm(this.locate(orgId, key), { force: true });
    await rm(this.locate(orgId, key, 'thumb'), { force: true }); // a removed file leaves no preview behind
  }
}
