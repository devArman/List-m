import { CATEGORY_URL } from '../config/constants.js';
import { fetchWithFallback } from './cloudflare.js';
import { parseCategoryTree, parseSubcategories } from './parsers/categoryParser.js';
import { createChildLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { randomDelay } from '../utils/helpers.js';
import { env } from '../config/environment.js';

const log = createChildLogger('categoryCrawler');

export interface CrawledCategory {
  externalId: string;
  name: string;
  url: string;
  parentExternalId?: string;
  level: number;
  listingCount?: number;
}

/**
 * Crawl the full category tree from list.am.
 * 1. Fetch the main category page
 * 2. Parse all top-level categories
 * 3. For each top-level category, fetch its page to get subcategories
 */
export async function crawlCategories(): Promise<CrawledCategory[]> {
  log.info('Starting category crawl...');

  const html = await withRetry(
    () => fetchWithFallback(CATEGORY_URL),
    { maxAttempts: env.SCRAPER_MAX_RETRIES },
  );

  const categories = parseCategoryTree(html);
  log.info({ count: categories.length }, 'Parsed top-level categories');

  // Crawl subcategories for each top-level category
  const topLevel = categories.filter((c) => c.level === 0);
  const allCategories: CrawledCategory[] = [...categories];

  for (const cat of topLevel) {
    try {
      await randomDelay();

      const catHtml = await withRetry(
        () => fetchWithFallback(cat.url),
        { maxAttempts: env.SCRAPER_MAX_RETRIES },
      );

      const subs = parseSubcategories(catHtml, cat.externalId);
      log.debug({ parent: cat.name, subcategories: subs.length }, 'Found subcategories');

      for (const sub of subs) {
        if (!allCategories.some((c) => c.externalId === sub.externalId)) {
          allCategories.push(sub);
        }
      }
    } catch (error) {
      log.error({ category: cat.name, error: String(error) }, 'Failed to crawl subcategories');
    }
  }

  log.info({ total: allCategories.length }, 'Category crawl complete');
  return allCategories;
}
