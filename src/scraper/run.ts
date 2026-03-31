import '../config/environment.js';
import { testConnection } from '../config/database.js';
import { createCategorySyncWorker } from './workers/categorySyncWorker.js';
import { createListingDiscoveryWorker } from './workers/listingDiscoveryWorker.js';
import { createDetailScrapingWorker } from './workers/detailScrapingWorker.js';
import { createImageDownloadWorker } from './workers/imageDownloadWorker.js';
import { createEmbeddingWorker } from './workers/embeddingWorker.js';
import { runInitialScrape, startPolling, scheduleDailyReconciliation } from './scheduler.js';
import { closeBrowser } from './browser.js';
import { closeDatabase } from '../config/database.js';
import { closeRedis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

async function main() {
  logger.info('Starting list.am scraper...');

  // Verify database connection
  await testConnection();

  // Start all workers
  const workers = [
    createCategorySyncWorker(),
    createListingDiscoveryWorker(),
    createDetailScrapingWorker(),
    createImageDownloadWorker(),
    createEmbeddingWorker(),
  ];

  logger.info({ workerCount: workers.length }, 'All workers started');

  // Run initial scrape
  await runInitialScrape();

  // Start recurring poll
  const pollInterval = startPolling();

  // Schedule daily reconciliation
  const reconTimeout = scheduleDailyReconciliation();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    clearInterval(pollInterval);
    clearTimeout(reconTimeout);

    await Promise.all(workers.map((w) => w.close()));
    await closeBrowser();
    await closeDatabase();
    await closeRedis();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start scraper');
  process.exit(1);
});
