import { createChildLogger } from '../../utils/logger.js';
import { sanitizeText } from '../../utils/helpers.js';
import { BASE_URL } from '../../config/constants.js';

const log = createChildLogger('categoryParser');

export interface ParsedCategory {
  externalId: string;
  name: string;
  url: string;
  parentExternalId?: string;
  level: number;
  listingCount?: number;
}

/**
 * Parse the category tree from list.am/en/category page HTML.
 *
 * list.am category page structure (observed patterns):
 * - Categories are listed in `<div class="c">` containers
 * - Each category link: `<a href="/en/category/{id}">`
 * - Subcategories nested under parent with different class/indentation
 * - Category count may appear in parentheses like "(1,234)"
 */
export function parseCategoryTree(html: string): ParsedCategory[] {
  const categories: ParsedCategory[] = [];

  // Pattern 1: Match category links from the category index page
  // Format: <a href="/en/category/{id}">Category Name</a> or with counts
  const categoryLinkRegex = /<a\s+[^>]*href="\/(?:en\/)?category\/(\d+)(?:\/(\d+))?"[^>]*>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;

  const seen = new Set<string>();

  while ((match = categoryLinkRegex.exec(html)) !== null) {
    const categoryId = match[1]!;
    const subcategoryId = match[2];
    const rawName = match[3]!;

    const externalId = subcategoryId ? `${categoryId}/${subcategoryId}` : categoryId;

    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const name = sanitizeText(rawName.replace(/\(\d[\d,]*\)/, '').trim());
    if (!name) continue;

    // Extract listing count from parentheses
    const countMatch = rawName.match(/\(([\d,]+)\)/);
    const listingCount = countMatch ? parseInt(countMatch[1]!.replace(/,/g, ''), 10) : undefined;

    const url = subcategoryId
      ? `${BASE_URL}/en/category/${categoryId}/${subcategoryId}`
      : `${BASE_URL}/en/category/${categoryId}`;

    categories.push({
      externalId,
      name,
      url,
      parentExternalId: subcategoryId ? categoryId : undefined,
      level: subcategoryId ? 1 : 0,
      listingCount,
    });
  }

  // Pattern 2: Try parsing from structured div/dl/dt/dd elements
  // Some versions of the page use definition lists
  if (categories.length === 0) {
    const sectionRegex = /<(?:div|dl|section)[^>]*class="[^"]*cat[^"]*"[^>]*>([\s\S]*?)<\/(?:div|dl|section)>/gi;
    let sectionMatch: RegExpExecArray | null;

    while ((sectionMatch = sectionRegex.exec(html)) !== null) {
      const section = sectionMatch[1]!;
      const linkRegex = /<a\s+href="\/(?:en\/)?category\/(\d+)(?:\/(\d+))?"[^>]*>([^<]+)<\/a>/gi;
      let linkMatch: RegExpExecArray | null;

      while ((linkMatch = linkRegex.exec(section)) !== null) {
        const catId = linkMatch[1]!;
        const subId = linkMatch[2];
        const name = sanitizeText(linkMatch[3]!.replace(/\(\d[\d,]*\)/, '').trim());
        if (!name) continue;

        const extId = subId ? `${catId}/${subId}` : catId;
        if (seen.has(extId)) continue;
        seen.add(extId);

        categories.push({
          externalId: extId,
          name,
          url: subId ? `${BASE_URL}/en/category/${catId}/${subId}` : `${BASE_URL}/en/category/${catId}`,
          parentExternalId: subId ? catId : undefined,
          level: subId ? 1 : 0,
        });
      }
    }
  }

  log.info({ count: categories.length }, 'Parsed categories from HTML');
  return categories;
}

/**
 * Parse subcategories from a specific category page.
 * When viewing list.am/en/category/56, subcategories may appear as sidebar links.
 */
export function parseSubcategories(html: string, parentExternalId: string): ParsedCategory[] {
  const subcategories: ParsedCategory[] = [];
  const seen = new Set<string>();

  // Look for subcategory links within the page
  const regex = new RegExp(
    `<a\\s+[^>]*href="/(?:en/)?category/${parentExternalId}/(\\d+)"[^>]*>([^<]+)</a>`,
    'gi'
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const subId = match[1]!;
    const externalId = `${parentExternalId}/${subId}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const name = sanitizeText(match[2]!.replace(/\(\d[\d,]*\)/, '').trim());
    if (!name) continue;

    const countMatch = match[2]!.match(/\(([\d,]+)\)/);
    const listingCount = countMatch ? parseInt(countMatch[1]!.replace(/,/g, ''), 10) : undefined;

    subcategories.push({
      externalId,
      name,
      url: `${BASE_URL}/en/category/${parentExternalId}/${subId}`,
      parentExternalId,
      level: 1,
      listingCount,
    });
  }

  return subcategories;
}
