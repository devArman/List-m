import { env } from '../config/environment.js';
import { USER_AGENTS, VIEWPORTS, BASE_URL } from '../config/constants.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(): Promise<void> {
  const delay = env.SCRAPER_DELAY_MIN_MS +
    Math.random() * (env.SCRAPER_DELAY_MAX_MS - env.SCRAPER_DELAY_MIN_MS);
  return sleep(delay);
}

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

export function randomViewport(): { width: number; height: number } {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]!;
}

export function buildCategoryUrl(categoryId: string | number, subcategoryId?: string | number, page?: number): string {
  let url = `${BASE_URL}/en/category/${categoryId}`;
  if (subcategoryId) url += `/${subcategoryId}`;
  if (page && page > 1) url += `/${page}`;
  return url;
}

export function buildItemUrl(itemId: string | number): string {
  return `${BASE_URL}/en/item/${itemId}`;
}

export function extractIdFromUrl(url: string): string | null {
  const match = url.match(/\/item\/(\d+)/);
  return match?.[1] ?? null;
}

export function extractCategoryIdFromUrl(url: string): { categoryId: string; subcategoryId?: string } | null {
  const match = url.match(/\/category\/(\d+)(?:\/(\d+))?/);
  if (!match) return null;
  return {
    categoryId: match[1]!,
    subcategoryId: match[2],
  };
}

export function sanitizeText(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(/\s+/g, ' ').trim() || null;
}

export function parsePriceString(text: string): { price: number | null; currency: string | null } {
  if (!text) return { price: null, currency: null };

  const cleaned = text.replace(/,/g, '').trim();

  let currency: string | null = null;
  if (cleaned.includes('$') || cleaned.toLowerCase().includes('usd')) currency = 'USD';
  else if (cleaned.includes('֏') || cleaned.toLowerCase().includes('amd')) currency = 'AMD';
  else if (cleaned.includes('€') || cleaned.toLowerCase().includes('eur')) currency = 'EUR';
  else if (cleaned.includes('₽') || cleaned.toLowerCase().includes('rub')) currency = 'RUB';

  const numMatch = cleaned.match(/[\d,]+\.?\d*/);
  const price = numMatch ? parseFloat(numMatch[0].replace(/,/g, '')) : null;

  return { price, currency };
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
