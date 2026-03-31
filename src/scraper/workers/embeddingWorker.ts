import { Worker, type Job } from 'bullmq';
import { redis } from '../../config/redis.js';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../../config/constants.js';
import { generateEmbedding, buildEmbeddingText } from '../../ai/embeddings.js';
import { updateEmbedding } from '../../services/listingService.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('embeddingWorker');

export interface EmbeddingJobData {
  listingId: number;
  externalId: string;
  titleEn: string | null;
  descriptionEn: string | null;
  attributes: Record<string, unknown> | null;
}

async function processJob(job: Job<EmbeddingJobData>): Promise<void> {
  const { listingId, externalId, titleEn, descriptionEn, attributes } = job.data;

  log.debug({ externalId, listingId, jobId: job.id }, 'Generating embedding');

  const text = buildEmbeddingText(titleEn, descriptionEn, attributes);
  const embedding = await generateEmbedding(text);

  if (embedding.length === 0) {
    throw new Error('Empty embedding generated');
  }

  await updateEmbedding(listingId, embedding);

  log.debug({ externalId, listingId, dimensions: embedding.length, jobId: job.id }, 'Embedding stored');
}

export function createEmbeddingWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.EMBEDDING,
    processJob,
    {
      connection: redis,
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.EMBEDDING],
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 2000 },
    },
  );

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id }, 'Embedding job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'Embedding job failed');
  });

  return worker;
}
