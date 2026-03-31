import { Worker, Queue, type Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../../config/constants.js';
import { crawlListingDetail } from '../detailCrawler.js';
import { upsertListing } from '../../services/listingService.js';
import { findByExternalId } from '../../services/categoryService.js';
import { createChildLogger } from '../../utils/logger.js';
import { randomDelay } from '../../utils/helpers.js';

const log = createChildLogger('detailScrapingWorker');

const imageQueue = new Queue(QUEUE_NAMES.IMAGE_DOWNLOAD, { connection: redis });
const embeddingQueue = new Queue(QUEUE_NAMES.EMBEDDING, { connection: redis });

export interface DetailScrapingJobData {
  externalId: string;
  categoryExternalId: string;
  title?: string;
  price?: number | null;
  currency?: string | null;
}

async function processJob(job: Job<DetailScrapingJobData>): Promise<void> {
  const { externalId, categoryExternalId } = job.data;

  log.info({ externalId, jobId: job.id }, 'Starting detail scraping');

  await randomDelay();

  const detail = await crawlListingDetail(externalId);

  // Resolve category DB ID
  const category = await findByExternalId(categoryExternalId);
  const categoryDbId = category?.id ?? null;

  // Save to database
  const listingId = await upsertListing(detail, categoryDbId);

  // Queue image downloads
  if (detail.imageUrls.length > 0) {
    await imageQueue.add(
      `images-${externalId}`,
      {
        listingId,
        externalId,
        categoryExternalId,
        imageUrls: detail.imageUrls,
      },
      {
        jobId: `images-${externalId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      },
    );
  }

  // Queue embedding generation
  await embeddingQueue.add(
    `embedding-${externalId}`,
    {
      listingId,
      externalId,
      titleEn: detail.titleEn,
      descriptionEn: detail.descriptionEn,
      attributes: detail.attributes,
    },
    {
      jobId: `embedding-${externalId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  );

  log.info({
    externalId,
    listingId,
    title: detail.titleEn,
    images: detail.imageUrls.length,
    jobId: job.id,
  }, 'Detail scraping complete');
}

export function createDetailScrapingWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.DETAIL_SCRAPING,
    processJob,
    {
      connection: redis,
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.DETAIL_SCRAPING],
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
      limiter: {
        max: 5,
        duration: 10_000, // Max 5 jobs per 10 seconds
      },
    },
  );

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id }, 'Detail scraping job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'Detail scraping job failed');
  });

  return worker;
}
