import { Worker, type Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../../config/constants.js';
import { downloadListingImages } from '../imageScraper.js';
import { db } from '../../config/database.js';
import { listings } from '../../database/schema.js';
import { eq } from 'drizzle-orm';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('imageDownloadWorker');

export interface ImageDownloadJobData {
  listingId: number;
  externalId: string;
  categoryExternalId: string;
  imageUrls: string[];
}

async function processJob(job: Job<ImageDownloadJobData>): Promise<void> {
  const { listingId, externalId, categoryExternalId, imageUrls } = job.data;

  log.info({ externalId, imageCount: imageUrls.length, jobId: job.id }, 'Starting image download');

  const downloaded = await downloadListingImages(categoryExternalId, externalId, imageUrls);

  // Update listing with local image paths
  const imageRecords = downloaded.map((img) => ({
    originalUrl: img.originalUrl,
    localPath: img.localPath,
    order: img.order,
  }));

  await db
    .update(listings)
    .set({
      images: imageRecords,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId));

  log.info({
    externalId,
    downloaded: downloaded.length,
    total: imageUrls.length,
    jobId: job.id,
  }, 'Image download complete');
}

export function createImageDownloadWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.IMAGE_DOWNLOAD,
    processJob,
    {
      connection: redis,
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.IMAGE_DOWNLOAD],
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  );

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id }, 'Image download job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'Image download job failed');
  });

  return worker;
}
