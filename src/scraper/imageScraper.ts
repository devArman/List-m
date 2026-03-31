import got from 'got';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { env } from '../config/environment.js';
import { createChildLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const log = createChildLogger('imageScraper');

const THUMBNAIL_SIZE = 300;

export interface DownloadedImage {
  originalUrl: string;
  localPath: string;
  thumbnailPath: string;
  order: number;
}

/**
 * Download all images for a listing and generate thumbnails.
 */
export async function downloadListingImages(
  categoryId: string | number,
  listingId: string,
  imageUrls: string[],
): Promise<DownloadedImage[]> {
  const results: DownloadedImage[] = [];
  const basePath = join(env.IMAGE_STORAGE_PATH, String(categoryId), listingId);

  await mkdir(basePath, { recursive: true });
  await mkdir(join(basePath, 'thumbs'), { recursive: true });

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i]!;
    try {
      const image = await downloadImage(url);
      const ext = guessExtension(url);
      const filename = `${i}.${ext}`;
      const localPath = join(basePath, filename);
      const thumbnailPath = join(basePath, 'thumbs', filename);

      await writeFile(localPath, image);

      // Generate thumbnail
      try {
        const thumbnail = await sharp(image)
          .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer();
        await writeFile(thumbnailPath, thumbnail);
      } catch (thumbErr) {
        log.warn({ url, error: String(thumbErr) }, 'Failed to generate thumbnail');
      }

      results.push({
        originalUrl: url,
        localPath,
        thumbnailPath,
        order: i,
      });

      log.debug({ listingId, order: i, url }, 'Downloaded image');
    } catch (error) {
      log.warn({ listingId, url, order: i, error: String(error) }, 'Failed to download image');
    }
  }

  log.info({ listingId, downloaded: results.length, total: imageUrls.length }, 'Image download complete');
  return results;
}

async function downloadImage(url: string): Promise<Buffer> {
  return withRetry(
    async () => {
      const response = await got.get(url, {
        responseType: 'buffer',
        timeout: { request: 30_000 },
        headers: {
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': 'https://www.list.am/',
        },
      });
      return response.body;
    },
    { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000 },
  );
}

function guessExtension(url: string): string {
  const match = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  return match?.[1]?.toLowerCase() ?? 'jpg';
}
