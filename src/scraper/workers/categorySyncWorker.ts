import { Worker, type Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../../config/constants.js';
import { crawlCategories } from '../categoryCrawler.js';
import { syncCategories } from '../../services/categoryService.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('categorySyncWorker');

async function processJob(job: Job): Promise<void> {
  log.info({ jobId: job.id }, 'Starting category sync');

  const categories = await crawlCategories();
  await syncCategories(categories);

  log.info({ jobId: job.id, categories: categories.length }, 'Category sync complete');
}

export function createCategorySyncWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.CATEGORY_SYNC,
    processJob,
    {
      connection: redis,
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.CATEGORY_SYNC],
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Category sync job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'Category sync job failed');
  });

  return worker;
}
