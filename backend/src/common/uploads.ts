import { randomUUID } from 'crypto';
import { mkdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import {
  BadRequestException,
  Logger,
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';

const logger = new Logger('Uploads');

/** The folder every uploaded file lives under: `UPLOAD_DIR` (`uploads` under the working directory by default). */
export const uploadRoot = (): string =>
  resolve(process.env.UPLOAD_DIR || 'uploads');

/** The file of an upload as the interceptor hands it over (memory storage). */
export interface UploadedBlob {
  buffer: Buffer;
  size: number;
}

export interface ImageKind {
  mime: string;
  ext: string;
}

const startsWith = (buffer: Buffer, bytes: number[], at = 0): boolean =>
  buffer.length >= at + bytes.length &&
  bytes.every((byte, i) => buffer[at + i] === byte);

/**
 * The image type of a buffer from its first bytes (JPEG, PNG or WebP), or null
 * for anything else. Never the client's file name or declared type.
 */
export function detectImage(buffer: Buffer): ImageKind | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' };
  }
  // "RIFF" <size> "WEBP"
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * The absolute path of a stored file, from the path kept in the database
 * (relative to the upload root). A path that would leave the root is refused.
 */
export function uploadPath(stored: string): string {
  const root = uploadRoot();
  const full = resolve(root, stored);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Chemin de fichier hors du dossier des envois');
  }
  return full;
}

/**
 * Writes `buffer` as a new file of `dir` (relative to the upload root) under a
 * generated name (never a client-supplied one), through a temporary file and
 * an atomic rename, and returns its path relative to the root.
 */
export async function saveUpload(
  dir: string,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new Error('Extension invalide');
  const stored = `${dir.replace(/\/+$/, '')}/${randomUUID()}.${ext}`;
  const target = uploadPath(stored);
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, buffer, { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return stored;
}

/**
 * Deletes a stored file, best effort: one that is already gone is not an
 * error, and a failure is logged and swallowed (it must never undo the write
 * the cleanup follows, nor take down the new file).
 */
export async function removeUpload(stored: string | null): Promise<void> {
  if (!stored) return;
  try {
    await rm(uploadPath(stored), { force: true });
  } catch (error) {
    logger.warn(
      `Fichier non supprimé (${stored}) : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Interceptor of a multipart route with one file field: held in memory, at most
 * `maxBytes`; any refusal of the upload itself (too big, wrong field, malformed
 * body) answers 400 `message`, not Multer's own 413.
 */
export function singleFileUpload(
  field: string,
  maxBytes: number,
  message: string,
): Type<NestInterceptor> {
  const Base = FileInterceptor(field, {
    // Only the file itself: no text field, no second part.
    limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
  });
  @Injectable()
  class SingleFileUpload implements NestInterceptor {
    private readonly inner = new Base();
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      try {
        return await this.inner.intercept(context, next);
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) {
          throw new BadRequestException(message);
        }
        throw error;
      }
    }
  }
  return SingleFileUpload;
}
