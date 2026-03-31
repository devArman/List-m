import { createChildLogger } from '../../utils/logger.js';
import { sanitizeText, parsePriceString } from '../../utils/helpers.js';
import { BASE_URL } from '../../config/constants.js';

const log = createChildLogger('listingParser');

export interface ParsedListingCard {
  externalId: string;
  title: string;
  price: number | null;
  currency: string | null;
  thumbnailUrl: string | null;
  listingUrl: string;
  location: string | null;
}

export interface ListingPageResult {
  listings: ParsedListingCard[];
  totalPages: number;
  currentPage: number;
  totalListings: number | null;
}

/**
 * Parse listing cards from a category page.
 *
 * list.am category page listing patterns:
 * - Listings in container divs with class like "gl" or listing-related classes
 * - Each listing card contains: link to /item/{id}, title, price, thumbnail, location
 * - Pagination at bottom with page links
 */
export function parseListingPage(html: string): ListingPageResult {
  const listings: ParsedListingCard[] = [];
  const seen = new Set<string>();

  // Pattern: listing items linking to /item/{id}
  // Multiple possible formats observed on list.am
  const patterns = [
    // Pattern 1: <a href="/en/item/{id}"> with surrounding listing card
    /<div[^>]*class="[^"]*(?:gl|item|listing)[^"]*"[^>]*>[\s\S]*?<a\s+[^>]*href="\/(?:en\/)?item\/(\d+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/div>/gi,
    // Pattern 2: Direct item links with title and price in various structures
    /<a\s+[^>]*href="\/(?:en\/)?item\/(\d+)"[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);

      const cardHtml = match[2] || '';

      // Extract title
      const titleMatch = cardHtml.match(/<(?:div|span|b)[^>]*>([^<]+)<\/(?:div|span|b)>/);
      const title = sanitizeText(titleMatch?.[1] ?? cardHtml.replace(/<[^>]*>/g, '').trim());
      if (!title) continue;

      // Extract price
      const priceMatch = cardHtml.match(/<(?:div|span)[^>]*class="[^"]*price[^"]*"[^>]*>([^<]+)<\/(?:div|span)>/i)
        || cardHtml.match(/(\$[\d,]+|[\d,]+\s*(?:֏|\$|€|AMD|USD|EUR))/);
      const { price, currency } = parsePriceString(priceMatch?.[1] ?? '');

      // Extract thumbnail
      const imgMatch = cardHtml.match(/<img[^>]*src="([^"]+)"[^>]*>/i)
        || cardHtml.match(/background-image:\s*url\(([^)]+)\)/i);
      let thumbnailUrl = imgMatch?.[1] ?? null;
      if (thumbnailUrl && !thumbnailUrl.startsWith('http')) {
        thumbnailUrl = `${BASE_URL}${thumbnailUrl}`;
      }

      // Extract location
      const locMatch = cardHtml.match(/<(?:div|span)[^>]*class="[^"]*(?:loc|location|addr)[^"]*"[^>]*>([^<]+)<\/(?:div|span)>/i);
      const location = sanitizeText(locMatch?.[1] ?? null);

      listings.push({
        externalId: id,
        title,
        price,
        currency,
        thumbnailUrl,
        listingUrl: `${BASE_URL}/en/item/${id}`,
        location,
      });
    }

    if (listings.length > 0) break;
  }

  // Fallback: find all item links if structured parsing failed
  if (listings.length === 0) {
    const simplePattern = /href="\/(?:en\/)?item\/(\d+)"/gi;
    let match: RegExpExecArray | null;
    while ((match = simplePattern.exec(html)) !== null) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);

      listings.push({
        externalId: id,
        title: `Listing ${id}`,
        price: null,
        currency: null,
        thumbnailUrl: null,
        listingUrl: `${BASE_URL}/en/item/${id}`,
        location: null,
      });
    }
  }

  // Parse pagination
  const { totalPages, currentPage } = parsePagination(html);

  // Parse total listing count
  const totalMatch = html.match(/(?:(\d[\d,]*)\s*(?:listings?|results?|ads?))|(?:(?:Showing|Found)\s+(\d[\d,]*))/i);
  const totalListings = totalMatch
    ? parseInt((totalMatch[1] || totalMatch[2] || '0').replace(/,/g, ''), 10)
    : null;

  log.debug({ count: listings.length, currentPage, totalPages }, 'Parsed listing page');
  return { listings, totalPages, currentPage, totalListings };
}

function parsePagination(html: string): { totalPages: number; currentPage: number } {
  // Find all page number links
  const pageLinks = html.matchAll(/href="[^"]*\/(\d+)"[^>]*>\s*(\d+)\s*<\/a>/gi);
  let maxPage = 1;
  let currentPage = 1;

  for (const m of pageLinks) {
    const pageNum = parseInt(m[2]!, 10);
    if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
  }

  // Check for active/current page indicator
  const activeMatch = html.match(/<(?:span|a|div)[^>]*class="[^"]*(?:active|current|selected)[^"]*"[^>]*>\s*(\d+)\s*<\//i);
  if (activeMatch) {
    currentPage = parseInt(activeMatch[1]!, 10) || 1;
  }

  return { totalPages: maxPage, currentPage };
}
