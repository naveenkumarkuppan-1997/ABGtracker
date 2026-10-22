import { describe, expect, it } from 'vitest';
import { cleanFileName, contentDisposition, extensionOf, fileProblem, formatBytes, isInlineImage, sniffImage } from './attachments';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('attachment rules', () => {
  it('formats sizes for people', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
  });

  it('cleans names', () => {
    expect(cleanFileName('../../a/b/c.txt')).toBe('c.txt');
    expect(cleanFileName('..\\..\\evil.txt')).toBe('evil.txt');
    expect(cleanFileName('a\u0007b‮.txt')).toBe('ab.txt');
    expect(cleanFileName('...')).toBe('file');
    expect(cleanFileName('  many   spaces  .md ')).toBe('many spaces .md');
    expect(cleanFileName('é'.repeat(200) + '.docx')).toMatch(/\.docx$/);
    expect(cleanFileName('é'.repeat(200) + '.docx').length).toBeLessThanOrEqual(120);
    expect(extensionOf('Archive.TAR.GZ')).toBe('gz');
    expect(extensionOf('noext')).toBe('');
  });

  it('explains why a file is refused', () => {
    expect(fileProblem('ok.pdf', 100)).toBeNull();
    expect(fileProblem('ok.pdf', 0)).toMatch(/empty/);
    expect(fileProblem('big.zip', 26 * 1024 * 1024)).toMatch(/up to 25 MB/);
    expect(fileProblem('setup.EXE', 10)).toMatch(/\.exe/);
    expect(fileProblem('setup.exe', 10, undefined, [])).toBeNull(); // an organization may allow it
  });

  it('recognises images by their bytes, only for safe raster types', () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(bytes('GIF89a....'))).toBe('image/gif');
    expect(sniffImage(Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x20]))).toBe('image/webp');
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(bytes('<html>'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(isInlineImage('image/png')).toBe(true);
    expect(isInlineImage('image/svg+xml')).toBe(false);
    expect(isInlineImage('text/html')).toBe(false);
  });

  it('builds a safe Content-Disposition for any name', () => {
    expect(contentDisposition('attachment', 'plan.pdf')).toBe(`attachment; filename="plan.pdf"; filename*=UTF-8''plan.pdf`);
    const odd = contentDisposition('attachment', 'a"b\\c é(1).txt');
    expect(odd).not.toMatch(/"b/); // quotes can't break out of the header
    expect(odd).toContain("filename*=UTF-8''a%22b%5Cc%20%C3%A9%281%29.txt");
    expect(contentDisposition('inline', 'x.png').startsWith('inline;')).toBe(true);
  });
});
