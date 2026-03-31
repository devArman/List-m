import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { env } from '../config/environment.js';

/**
 * Get the storage path for a listing's images.
 */
export function getImageDir(categoryId: string | number, listingId: string): string {
  return join(env.IMAGE_STORAGE_PATH, String(categoryId), listingId);
}

export function getImagePath(categoryId: string | number, listingId: string, index: number, ext = 'jpg'): string {
  return join(getImageDir(categoryId, listingId), `${index}.${ext}`);
}

export function getThumbnailPath(categoryId: string | number, listingId: string, index: number, ext = 'jpg'): string {
  return join(getImageDir(categoryId, listingId), 'thumbs', `${index}.${ext}`);
}

export async function ensureImageDir(categoryId: string | number, listingId: string): Promise<string> {
  const dir = getImageDir(categoryId, listingId);
  await mkdir(join(dir, 'thumbs'), { recursive: true });
  return dir;
}

export function imageExists(categoryId: string | number, listingId: string, index: number): boolean {
  return existsSync(getImagePath(categoryId, listingId, index));
}
