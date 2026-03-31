import { fetchWithFallback } from './cloudflare.js';
import { parseListingPage, type ParsedListingCard } from './parsers/listingParser.js';
import { createChildLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { randomDelay, buildCategoryUrl } from '../utils/helpers.js';
import { env } from '../config/environment.js';

const log = createChildLogger('listingCrawler');

export interface DiscoveredListings {
  categoryExternalId: string;
  subcategoryExternalId?: string;
  listings: ParsedListingCard[];
  totalPages: number;
  totalListings: number | null;
}

/**
 * Crawl listing cards from a category, paginating through all pages.
 */
export async function crawlCategoryListings(
  categoryId: string,
  subcategoryId?: string,
  options: { maxPages?: number; knownIds?: Set<string> } = {},
): Promise<DiscoveredListings> {
  const { maxPages = Infinity, knownIds = new Set() } = options;
  const allListings: ParsedListingCard[] = [];
  let totalPages = 1;
  let totalListings: number | null = null;
  let page = 1;
  let consecutiveEmpty = 0;

  log.info({ categoryId, subcategoryId, maxPages }, 'Starting listing discovery');

  while (page <= totalPages && page <= maxPages) {
    try {
      const url = buildCategoryUrl(categoryId, subcategoryId, page);

      const html = await withRetry(
        () => fetchWithFallback(url),
        { maxAttempts: env.SCRAPER_MAX_RETRIES },
      );

      const result = parseListingPage(html);

      if (page === 1) {
        totalPages = result.totalPages;
        totalListings = result.totalListings;
        log.info({ categoryId, totalPages, totalListings }, 'Determined pagination');
      }

      if (result.listings.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) {
          log.info({ page, categoryId }, 'Stopping: consecutive empty pages');
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      // Filter out already-known listings
      const newListings = result.listings.filter((l) => !knownIds.has(l.externalId));
      allListings.push(...newListings);

      log.debug({
        page,
        found: result.listings.length,
        new: newListings.length,
        categoryId,
      }, 'Processed listing page');

      // If all listings on this page are known, we can stop
      if (newListings.length === 0 && result.listings.length > 0) {
        log.info({ page, categoryId }, 'Stopping: all listings on page already known');
        break;
      }

      page++;
      if (page <= totalPages) await randomDelay();
    } catch (error) {
      log.error({ page, categoryId, error: String(error) }, 'Failed to crawl listing page');
      page++;
      await randomDelay();
    }
  }

  log.info({
    categoryId,
    discovered: allListings.length,
    pagesScanned: page - 1,
  }, 'Listing discovery complete');

  return {
    categoryExternalId: categoryId,
    subcategoryExternalId: subcategoryId,
    listings: allListings,
    totalPages,
    totalListings,
  };
}

/**
 * Quick poll: check first N pages of a category for new listings.
 */
export async function pollCategoryForNew(
  categoryId: string,
  subcategoryId?: string,
  knownIds: Set<string> = new Set(),
  pagesToCheck = 2,
): Promise<ParsedListingCard[]> {
  return (await crawlCategoryListings(categoryId, subcategoryId, {
    maxPages: pagesToCheck,
    knownIds,
  })).listings;
}
