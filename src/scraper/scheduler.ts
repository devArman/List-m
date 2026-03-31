import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';
import { QUEUE_NAMES } from '../config/constants.js';
import { env } from '../config/environment.js';
import { getAllCategories } from '../services/categoryService.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('scheduler');

const categoryQueue = new Queue(QUEUE_NAMES.CATEGORY_SYNC, { connection: redis });
const discoveryQueue = new Queue(QUEUE_NAMES.LISTING_DISCOVERY, { connection: redis });
const embeddingQueue = new Queue(QUEUE_NAMES.EMBEDDING, { connection: redis });

/**
 * Run the initial full scrape pipeline:
 * 1. Sync category tree
 * 2. Discover all listings per category
 * (Detail scraping, image downloads, and embeddings are queued by the discovery worker)
 */
export async function runInitialScrape(): Promise<void> {
  log.info('Starting initial full scrape...');

  // Phase 1: Sync categories
  await categoryQueue.add('initial-category-sync', {}, {
    jobId: 'initial-category-sync',
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
  });

  log.info('Category sync job queued. Waiting for completion before discovery...');

  // Wait for category sync to complete before queuing discovery
  await waitForQueueDrain(QUEUE_NAMES.CATEGORY_SYNC, 300_000); // 5 min timeout

  // Phase 2: Queue listing discovery for all categories
  const categories = await getAllCategories();
  const leafCategories = categories.filter((c) =>
    !categories.some((other) => other.parentId === c.id)
  );

  log.info({ totalCategories: categories.length, leafCategories: leafCategories.length }, 'Queuing listing discovery');

  const discoveryJobs = leafCategories.map((cat) => {
    const parts = cat.externalId.split('/');
    return {
      name: `discover-${cat.externalId}`,
      data: {
        categoryExternalId: parts[0]!,
        subcategoryExternalId: parts[1],
      },
      opts: {
        jobId: `discover-${cat.externalId}`,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 10_000 },
      },
    };
  });

  if (discoveryJobs.length > 0) {
    await discoveryQueue.addBulk(discoveryJobs);
  }

  log.info({ jobs: discoveryJobs.length }, 'Listing discovery jobs queued');
}

/**
 * Start recurring poll: check first 2 pages of each category for new listings.
 */
export function startPolling(): NodeJS.Timeout {
  const intervalMs = env.POLL_INTERVAL_MINUTES * 60 * 1000;

  log.info({ intervalMinutes: env.POLL_INTERVAL_MINUTES }, 'Starting recurring poll');

  const interval = setInterval(async () => {
    try {
      log.info('Running periodic poll...');

      const categories = await getAllCategories();
      const leafCategories = categories.filter((c) =>
        !categories.some((other) => other.parentId === c.id)
      );

      const jobs = leafCategories.map((cat) => {
        const parts = cat.externalId.split('/');
        return {
          name: `poll-${cat.externalId}-${Date.now()}`,
          data: {
            categoryExternalId: parts[0]!,
            subcategoryExternalId: parts[1],
            maxPages: 2,
          },
          opts: {
            attempts: 2,
            backoff: { type: 'exponential' as const, delay: 5000 },
          },
        };
      });

      if (jobs.length > 0) {
        await discoveryQueue.addBulk(jobs);
      }

      log.info({ categories: jobs.length }, 'Poll jobs queued');
    } catch (error) {
      log.error({ error: String(error) }, 'Poll cycle failed');
    }
  }, intervalMs);

  return interval;
}

/**
 * Schedule daily reconciliation: full scan to detect inactive listings.
 */
export function scheduleDailyReconciliation(): NodeJS.Timeout {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // Run at midnight (next occurrence)
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(2, 0, 0, 0); // 2 AM local
  if (midnight <= now) midnight.setDate(midnight.getDate() + 1);
  const msUntilFirst = midnight.getTime() - now.getTime();

  log.info({ nextRun: midnight.toISOString() }, 'Daily reconciliation scheduled');

  // First timeout to align to 2 AM, then interval
  const timeout = setTimeout(async () => {
    await runReconciliation();

    setInterval(async () => {
      await runReconciliation();
    }, TWENTY_FOUR_HOURS);
  }, msUntilFirst);

  return timeout;
}

async function runReconciliation(): Promise<void> {
  log.info('Starting daily reconciliation...');

  // Re-sync categories
  await categoryQueue.add('daily-category-sync', {}, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
  });

  // Full listing discovery (no maxPages limit)
  const categories = await getAllCategories();
  const leafCategories = categories.filter((c) =>
    !categories.some((other) => other.parentId === c.id)
  );

  const jobs = leafCategories.map((cat) => {
    const parts = cat.externalId.split('/');
    return {
      name: `reconcile-${cat.externalId}-${Date.now()}`,
      data: {
        categoryExternalId: parts[0]!,
        subcategoryExternalId: parts[1],
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 10_000 },
      },
    };
  });

  if (jobs.length > 0) {
    await discoveryQueue.addBulk(jobs);
  }

  log.info({ categories: jobs.length }, 'Reconciliation jobs queued');
}

/**
 * Generate embeddings for all listings that don't have them.
 */
export async function backfillEmbeddings(): Promise<void> {
  const { getListingsWithoutEmbeddings } = await import('../services/listingService.js');

  let batch = await getListingsWithoutEmbeddings(100);
  let total = 0;

  while (batch.length > 0) {
    const jobs = batch.map((listing) => ({
      name: `embedding-backfill-${listing.id}`,
      data: {
        listingId: listing.id,
        externalId: String(listing.id),
        titleEn: listing.titleEn,
        descriptionEn: listing.descriptionEn,
        attributes: listing.attributes,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 2000 },
      },
    }));

    await embeddingQueue.addBulk(jobs);
    total += jobs.length;

    log.info({ batch: batch.length, total }, 'Queued embedding backfill batch');
    batch = await getListingsWithoutEmbeddings(100);
  }

  log.info({ total }, 'Embedding backfill complete');
}

async function waitForQueueDrain(queueName: string, timeoutMs: number): Promise<void> {
  const queue = new Queue(queueName, { connection: redis });
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();

    if (waiting === 0 && active === 0) {
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  log.warn({ queueName, timeoutMs }, 'Queue drain timeout reached');
}
