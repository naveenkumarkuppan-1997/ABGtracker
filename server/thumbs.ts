import sharp from 'sharp';

export const THUMB_SIZE = 360;
/** Refuse pictures that would need an enormous amount of memory to open (decompression bombs). */
const MAX_PIXELS = 50_000_000;

/** At most this many pictures are processed at once, so a page of photos can't exhaust the server. */
class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
const gate = new Gate(2);

/**
 * A small WebP preview of a picture. Re-encoding drops all metadata (camera, GPS location,
 * and so on) and applies the photo's rotation first. Throws if the bytes aren't a decodable
 * picture within the size limit; callers fall back to a plain file icon.
 */
export function makeThumbnail(bytes: Buffer, size = THUMB_SIZE): Promise<Buffer> {
  return gate.run(() =>
    sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false })
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
  );
}
