import { Worker, Queue, type Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../../config/constants.js';
import { crawlCategoryListings } from '../listingCrawler.js';
import { getKnownIdsForCategory } from '../../services/listingService.js';
import { findByExternalId } from '../../services/categoryService.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('listingDiscoveryWorker');

export interface ListingDiscoveryJobData {
  categoryExternalId: string;
  subcategoryExternalId?: string;
  maxPages?: number;
}

const detailQueue = new Queue(QUEUE_NAMES.DETAIL_SCRAPING, { connection: redis });

async function processJob(job: Job<ListingDiscoveryJobData>): Promise<void> {
  const { categoryExternalId, subcategoryExternalId, maxPages } = job.data;

  log.info({ categoryExternalId, subcategoryExternalId, jobId: job.id }, 'Starting listing discovery');

  // Get known listing IDs for this category
  const category = await findByExternalId(subcategoryExternalId ?? categoryExternalId);
  const knownIds = category
    ? await getKnownIdsForCategory(category.id)
    : new Set<string>();

  const result = await crawlCategoryListings(
    categoryExternalId,
    subcategoryExternalId,
    { maxPages, knownIds },
  );

  // Queue detail scraping for each new listing
  const jobs = result.listings.map((listing) => ({
    name: `detail-${listing.externalId}`,
    data: {
      externalId: listing.externalId,
      categoryExternalId: subcategoryExternalId ?? categoryExternalId,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
    },
    opts: {
      jobId: `detail-${listing.externalId}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
    },
  }));

  if (jobs.length > 0) {
    await detailQueue.addBulk(jobs);
    log.info({ categoryExternalId, newListings: jobs.length }, 'Queued detail scraping jobs');
  }

  log.info({
    categoryExternalId,
    discovered: result.listings.length,
    totalPages: result.totalPages,
    jobId: job.id,
  }, 'Listing discovery complete');
}

export function createListingDiscoveryWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.LISTING_DISCOVERY,
    processJob,
    {
      connection: redis,
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.LISTING_DISCOVERY],
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Listing discovery job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'Listing discovery job failed');
  });

  return worker;
}
