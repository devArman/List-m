import { createChildLogger } from '../../utils/logger.js';
import { sanitizeText, parsePriceString, extractIdFromUrl } from '../../utils/helpers.js';
import { parseAttributes } from './attributeParser.js';

const log = createChildLogger('detailParser');

export interface ParsedListingDetail {
  externalId: string;
  titleEn: string | null;
  titleHy: string | null;
  titleRu: string | null;
  descriptionEn: string | null;
  descriptionHy: string | null;
  descriptionRu: string | null;
  price: number | null;
  currency: string | null;
  priceType: string | null;
  locationCity: string | null;
  locationDistrict: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  contactName: string | null;
  contactPhone: string | null;
  sellerType: string | null;
  attributes: Record<string, unknown>;
  imageUrls: string[];
  postedAt: Date | null;
  updatedAtSource: Date | null;
}

export function parseListingDetail(html: string, url: string): ParsedListingDetail {
  const externalId = extractIdFromUrl(url) || '';

  return {
    externalId,
    ...parseTitles(html),
    ...parseDescriptions(html),
    ...parsePrice(html),
    ...parseLocation(html),
    ...parseContact(html),
    attributes: parseAttributes(html),
    imageUrls: parseImages(html),
    ...parseDates(html),
  };
}

function parseTitles(html: string): { titleEn: string | null; titleHy: string | null; titleRu: string | null } {
  // Primary title from <h1> or title-related div
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const titleDiv = html.match(/<div[^>]*class="[^"]*(?:title|jtitle)[^"]*"[^>]*>([^<]+)<\/div>/i);
  const mainTitle = sanitizeText(h1Match?.[1] ?? titleDiv?.[1] ?? null);

  // Try to find language-specific titles
  // list.am often shows the primary language and has toggle for others
  const enMatch = html.match(/<[^>]*(?:lang="en"|data-lang="en")[^>]*>([^<]+)<\//);
  const hyMatch = html.match(/<[^>]*(?:lang="hy"|data-lang="hy")[^>]*>([^<]+)<\//);
  const ruMatch = html.match(/<[^>]*(?:lang="ru"|data-lang="ru")[^>]*>([^<]+)<\//);

  return {
    titleEn: sanitizeText(enMatch?.[1] ?? null) || mainTitle,
    titleHy: sanitizeText(hyMatch?.[1] ?? null),
    titleRu: sanitizeText(ruMatch?.[1] ?? null),
  };
}

function parseDescriptions(html: string): { descriptionEn: string | null; descriptionHy: string | null; descriptionRu: string | null } {
  // Description is usually in a specific div
  const descPatterns = [
    /<div[^>]*class="[^"]*(?:body|desc|text|content)[^"]*"[^>]*id="[^"]*(?:desc|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="[^"]*(?:desc|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*(?:body|desc)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  let rawDesc: string | null = null;
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      rawDesc = match[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .trim();
      break;
    }
  }

  const description = sanitizeText(rawDesc);

  return {
    descriptionEn: description,
    descriptionHy: null,
    descriptionRu: null,
  };
}

function parsePrice(html: string): { price: number | null; currency: string | null; priceType: string | null } {
  // Price is typically in a prominent div with price class
  const pricePatterns = [
    /<div[^>]*class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class="[^"]*price[^"]*"[^>]*>([^<]+)<\/span>/i,
    /<[^>]*class="[^"]*xprice[^"]*"[^>]*>([^<]+)<\//i,
  ];

  let priceText = '';
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      priceText = match[1].replace(/<[^>]*>/g, '').trim();
      break;
    }
  }

  const { price, currency } = parsePriceString(priceText);

  // Determine price type
  let priceType: string | null = null;
  const lowerPrice = priceText.toLowerCase();
  if (lowerPrice.includes('/month') || lowerPrice.includes('monthly') || lowerPrice.includes('ամսական')) {
    priceType = 'per_month';
  } else if (lowerPrice.includes('/day') || lowerPrice.includes('daily') || lowerPrice.includes('օրական')) {
    priceType = 'per_day';
  } else if (lowerPrice.includes('negotiable') || lowerPrice.includes('պայdelays')) {
    priceType = 'negotiable';
  } else if (price !== null) {
    priceType = 'total';
  }

  return { price, currency, priceType };
}

function parseLocation(html: string): {
  locationCity: string | null;
  locationDistrict: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  // Location fields
  const locPatterns = [
    /<div[^>]*class="[^"]*loc[^"]*"[^>]*>([^<]+)<\/div>/i,
    /<(?:span|div)[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)<\//i,
  ];

  let locationText: string | null = null;
  for (const pattern of locPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      locationText = match[1].trim();
      break;
    }
  }

  // Parse city and district from location string
  let locationCity: string | null = null;
  let locationDistrict: string | null = null;
  let locationAddress: string | null = null;

  if (locationText) {
    const parts = locationText.split(/[,>]/).map((s) => s.trim()).filter(Boolean);
    locationCity = parts[0] ?? null;
    locationDistrict = parts[1] ?? null;
    locationAddress = parts.length > 2 ? parts.slice(2).join(', ') : null;
  }

  // Look for map coordinates
  let latitude: number | null = null;
  let longitude: number | null = null;

  const coordPatterns = [
    /(?:lat|latitude)['":\s]+(-?\d+\.?\d*)/i,
    /(?:lng|longitude|lon)['":\s]+(-?\d+\.?\d*)/i,
    /center=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /LatLng\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)/,
  ];

  const latMatch = html.match(coordPatterns[0]!);
  const lngMatch = html.match(coordPatterns[1]!);
  if (latMatch?.[1] && lngMatch?.[1]) {
    latitude = parseFloat(latMatch[1]);
    longitude = parseFloat(lngMatch[1]);
  }

  const centerMatch = html.match(coordPatterns[2]!);
  if (!latitude && centerMatch?.[1] && centerMatch?.[2]) {
    latitude = parseFloat(centerMatch[1]);
    longitude = parseFloat(centerMatch[2]);
  }

  return { locationCity, locationDistrict, locationAddress, latitude, longitude };
}

function parseContact(html: string): { contactName: string | null; contactPhone: string | null; sellerType: string | null } {
  // Phone number - often behind a "show phone" button or in data attributes
  const phonePatterns = [
    /href="tel:([^"]+)"/i,
    /class="[^"]*phone[^"]*"[^>]*>([^<]+)</i,
    /data-phone="([^"]+)"/i,
    /(\+374\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{2})/,
    /(0\d{2}\s*\d{2}\s*\d{2}\s*\d{2})/,
  ];

  let contactPhone: string | null = null;
  for (const pattern of phonePatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      contactPhone = match[1].trim();
      break;
    }
  }

  // Contact name
  const namePatterns = [
    /<div[^>]*class="[^"]*(?:author|seller|name|contact)[^"]*"[^>]*>([^<]+)<\/div>/i,
    /<span[^>]*class="[^"]*(?:author|seller)[^"]*"[^>]*>([^<]+)<\/span>/i,
  ];

  let contactName: string | null = null;
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      contactName = sanitizeText(match[1]);
      break;
    }
  }

  // Seller type
  let sellerType: string | null = null;
  const sellerPatterns = [
    /class="[^"]*(?:agency|dealer|agent)[^"]*"/i,
    /(?:agency|dealer|real estate|agent|broker)/i,
    /(?:private|owner|individual)/i,
  ];

  if (sellerPatterns[0]!.test(html) || sellerPatterns[1]!.test(html)) {
    sellerType = 'agency';
  } else if (sellerPatterns[2]!.test(html)) {
    sellerType = 'private';
  }

  return { contactName, contactPhone, sellerType };
}

function parseImages(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Pattern 1: Full-size image URLs in gallery/slider
  const patterns = [
    /data-original="([^"]+)"/gi,
    /data-src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /<img[^>]*src="(https?:\/\/[^"]*list\.am[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /<img[^>]*src="(\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /href="([^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1]!;

      // Skip tiny thumbnails (usually under 100px dimension in filename)
      if (url.includes('_t.') || url.includes('/t/') || url.includes('thumb')) continue;

      // Make absolute URL
      if (url.startsWith('/')) {
        url = `https://www.list.am${url}`;
      }

      if (!seen.has(url)) {
        seen.add(url);
        images.push(url);
      }
    }
  }

  return images;
}

function parseDates(html: string): { postedAt: Date | null; updatedAtSource: Date | null } {
  let postedAt: Date | null = null;
  let updatedAtSource: Date | null = null;

  // Date patterns
  const datePatterns = [
    /(?:posted|created|date)[^>]*>?\s*(\d{1,2}[\./]\d{1,2}[\./]\d{2,4})/i,
    /(?:updated|modified|renewed)[^>]*>?\s*(\d{1,2}[\./]\d{1,2}[\./]\d{2,4})/i,
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/,
    /datetime="([^"]+)"/,
  ];

  const postedMatch = html.match(datePatterns[0]!) || html.match(datePatterns[2]!) || html.match(datePatterns[3]!);
  if (postedMatch?.[1]) {
    const d = new Date(postedMatch[1]);
    if (!isNaN(d.getTime())) postedAt = d;
  }

  const updatedMatch = html.match(datePatterns[1]!);
  if (updatedMatch?.[1]) {
    const d = new Date(updatedMatch[1]);
    if (!isNaN(d.getTime())) updatedAtSource = d;
  }

  return { postedAt, updatedAtSource };
}
