import { fetchWithFallback } from './cloudflare.js';
import { parseListingDetail, type ParsedListingDetail } from './parsers/detailParser.js';
import { createChildLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { buildItemUrl } from '../utils/helpers.js';
import { env } from '../config/environment.js';

const log = createChildLogger('detailCrawler');

/**
 * Crawl a single listing's detail page and extract all data.
 */
export async function crawlListingDetail(externalId: string): Promise<ParsedListingDetail & { rawHtml: string }> {
  const url = buildItemUrl(externalId);

  log.debug({ externalId, url }, 'Crawling listing detail');

  const html = await withRetry(
    () => fetchWithFallback(url),
    { maxAttempts: env.SCRAPER_MAX_RETRIES },
  );

  const detail = parseListingDetail(html, url);

  log.debug({
    externalId,
    title: detail.titleEn,
    price: detail.price,
    images: detail.imageUrls.length,
    attributes: Object.keys(detail.attributes).length,
  }, 'Parsed listing detail');

  return { ...detail, rawHtml: html };
}

/**
 * Crawl multiple listing details with controlled concurrency.
 */
export async function crawlListingDetails(
  externalIds: string[],
  concurrency = 1,
): Promise<Map<string, ParsedListingDetail & { rawHtml: string }>> {
  const results = new Map<string, ParsedListingDetail & { rawHtml: string }>();
  const queue = [...externalIds];

  const worker = async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;

      try {
        const detail = await crawlListingDetail(id);
        results.set(id, detail);
      } catch (error) {
        log.error({ externalId: id, error: String(error) }, 'Failed to crawl listing detail');
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  log.info({ requested: externalIds.length, successful: results.size }, 'Batch detail crawl complete');
  return results;
}
