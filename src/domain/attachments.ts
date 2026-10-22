// Rules for attached files that both the browser (to explain limits) and the server (to enforce them) share.

export interface AttachmentLimits {
  maxFileBytes: number;
  maxFilesPerIssue: number;
  orgQuotaBytes: number;
}

export const DEFAULT_LIMITS: AttachmentLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerIssue: 25,
  orgQuotaBytes: 1024 * 1024 * 1024,
};

/** Programs and scripts that run when opened. Refused by default, since one careless click is enough. */
export const BLOCKED_EXTENSIONS = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'jar', 'dll', 'reg', 'lnk', 'sh', 'apk', 'app', 'dmg'];

export const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

/**
 * A safe display name: no folders, no control or bidi-override characters, no leading dots,
 * limited length. The original is never used as a path; this is only what people read.
 */
export function cleanFileName(raw: string): string {
  let n = raw
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '') // control + text-direction tricks
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .trim()
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ');
  if (n.length > 120) {
    const ext = extensionOf(n);
    const keep = ext && ext.length <= 10 ? `.${ext}` : '';
    n = n.slice(0, 120 - keep.length) + keep;
  }
  return n || 'file';
}

/** A reason the file can't be attached, or null. */
export function fileProblem(name: string, size: number, limits: AttachmentLimits = DEFAULT_LIMITS, blocked: string[] = BLOCKED_EXTENSIONS): string | null {
  if (size <= 0) return 'That file is empty.';
  if (size > limits.maxFileBytes) return `Files can be up to ${formatBytes(limits.maxFileBytes)}. This one is ${formatBytes(size)}.`;
  const ext = extensionOf(name);
  if (ext && blocked.includes(ext)) return `“.${ext}” files can't be attached, because they can run programs on someone's computer.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Image types that may be shown inline (never SVG: it can carry scripts). */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const isInlineImage = (mime: string): boolean => INLINE_IMAGE_TYPES.includes(mime);

/** Decides the real type from the first bytes, ignoring whatever the uploader claimed. */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** Content-Disposition value that is safe for any file name (RFC 6266 / 5987). */
export function contentDisposition(kind: 'attachment' | 'inline', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
