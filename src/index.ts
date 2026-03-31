import './config/environment.js';
import { logger } from './utils/logger.js';

logger.info('list.am scraper starting...');
logger.info('Run "pnpm scrape" to start the scraper');
logger.info('Run "docker-compose up -d" first to start PostgreSQL, Redis, and FlareSolverr');

// Re-export for programmatic use
export { runInitialScrape, startPolling, backfillEmbeddings } from './scraper/scheduler.js';
export { crawlCategories } from './scraper/categoryCrawler.js';
export { crawlCategoryListings } from './scraper/listingCrawler.js';
export { crawlListingDetail } from './scraper/detailCrawler.js';
