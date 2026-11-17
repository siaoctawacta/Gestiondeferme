import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  detectImage,
  removeUpload,
  saveUpload,
  uploadPath,
  uploadRoot,
} from './uploads';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 1]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('detectImage', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', () => {
    expect(detectImage(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectImage(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectImage(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('refuses anything else, including a RIFF file that is not WebP and an empty buffer', () => {
    expect(detectImage(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImage(Buffer.from('<svg></svg>'))).toBeNull();
    expect(detectImage(Buffer.from('%PDF-1.4'))).toBeNull();
    const wave = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WAVE'),
    ]);
    expect(detectImage(wave)).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
    expect(detectImage(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('uploads on disk', () => {
  const previous = process.env.UPLOAD_DIR;
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uploads-spec-'));
    process.env.UPLOAD_DIR = root;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
  });

  it('reads the root from UPLOAD_DIR, `uploads` under the working directory otherwise', () => {
    expect(uploadRoot()).toBe(root);
    delete process.env.UPLOAD_DIR;
    expect(uploadRoot()).toBe(join(process.cwd(), 'uploads'));
  });

  it('writes a file under a generated name, atomically, and returns its path relative to the root', async () => {
    const stored = await saveUpload('tasks/farm1', PNG, 'png');
    expect(stored).toMatch(/^tasks\/farm1\/[0-9a-f-]{36}\.png$/);
    expect(readFileSync(uploadPath(stored))).toEqual(PNG);
    expect(readdirSync(join(root, 'tasks', 'farm1'))).toHaveLength(1);
    const other = await saveUpload('tasks/farm1', PNG, 'png');
    expect(other).not.toBe(stored);
  });

  it('refuses a directory or an extension that would leave the folder', async () => {
    await expect(saveUpload('../outside', PNG, 'png')).rejects.toThrow();
    await expect(saveUpload('tasks/f', PNG, '../x')).rejects.toThrow();
    await expect(saveUpload('tasks/f', PNG, '')).rejects.toThrow();
    expect(() => uploadPath('../../etc/passwd')).toThrow();
    expect(() => uploadPath('/etc/passwd')).toThrow();
  });

  it('removes a file, and a missing one or null is not an error', async () => {
    const stored = await saveUpload('tasks/f', JPEG, 'jpg');
    await removeUpload(stored);
    expect(existsSync(uploadPath(stored))).toBe(false);
    await removeUpload(stored);
    await removeUpload(null);
  });
});
