import got from 'got';
import { redis } from '../config/redis.js';
import { env } from '../config/environment.js';
import { COOKIE_CACHE_KEY, COOKIE_TTL_SECONDS, BASE_URL } from '../config/constants.js';
import { createChildLogger } from '../utils/logger.js';
import { randomUserAgent } from '../utils/helpers.js';

const log = createChildLogger('cloudflare');

interface FlareSolverrResponse {
  status: string;
  message: string;
  solution: {
    url: string;
    status: number;
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
    }>;
    userAgent: string;
    headers: Record<string, string>;
    response: string;
  };
}

interface CachedCookies {
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  userAgent: string;
}

export async function getCloudflareCookies(): Promise<CachedCookies> {
  // Check Redis cache first
  const cached = await redis.get(COOKIE_CACHE_KEY);
  if (cached) {
    log.debug('Using cached Cloudflare cookies');
    return JSON.parse(cached);
  }

  // Request fresh cookies from FlareSolverr
  log.info('Requesting fresh Cloudflare cookies from FlareSolverr...');

  const response = await got.post(env.FLARESOLVERR_URL, {
    json: {
      cmd: 'request.get',
      url: BASE_URL,
      maxTimeout: 60000,
    },
    timeout: { request: 70_000 },
    responseType: 'json',
  }).json<FlareSolverrResponse>();

  if (response.status !== 'ok') {
    throw new Error(`FlareSolverr failed: ${response.message}`);
  }

  const result: CachedCookies = {
    cookies: response.solution.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    })),
    userAgent: response.solution.userAgent,
  };

  // Cache in Redis
  await redis.set(COOKIE_CACHE_KEY, JSON.stringify(result), 'EX', COOKIE_TTL_SECONDS);
  log.info({ cookieCount: result.cookies.length }, 'Cloudflare cookies cached');

  return result;
}

export async function makeRequest(url: string): Promise<string> {
  try {
    const { cookies, userAgent } = await getCloudflareCookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const response = await got.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Cookie': cookieHeader,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: { request: 15_000 },
      retry: { limit: 0 },
    });

    if (response.statusCode === 403) {
      throw new Error('Cloudflare block detected (403)');
    }

    return response.body;
  } catch (error) {
    log.warn({ url, error: String(error) }, 'HTTP request failed, will use Playwright fallback');
    throw error;
  }
}

export async function fetchWithFallback(url: string): Promise<string> {
  try {
    return await makeRequest(url);
  } catch {
    log.info({ url }, 'Falling back to Playwright for page fetch');
    return await fetchWithPlaywright(url);
  }
}

async function fetchWithPlaywright(url: string): Promise<string> {
  const { createStealthContext, createPage } = await import('./browser.js');
  let cfCookies: CachedCookies | undefined;

  try {
    cfCookies = await getCloudflareCookies();
  } catch {
    log.warn('Could not get CF cookies for Playwright, proceeding without');
  }

  const context = await createStealthContext(cfCookies?.cookies);
  const page = await createPage(context);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for potential CF challenge
    await page.waitForTimeout(3000);

    // Check if we're still on CF challenge page
    const title = await page.title();
    if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention required')) {
      log.info('Cloudflare challenge detected, waiting for resolution...');
      await page.waitForURL((u) => !u.toString().includes('challenges'), { timeout: 30_000 });
      await page.waitForTimeout(2000);
    }

    const html = await page.content();

    // Update cached cookies from this successful session
    const browserCookies = await context.cookies();
    const newCached: CachedCookies = {
      cookies: browserCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      })),
      userAgent: randomUserAgent(),
    };
    await redis.set(COOKIE_CACHE_KEY, JSON.stringify(newCached), 'EX', COOKIE_TTL_SECONDS);

    return html;
  } finally {
    await page.close();
    await context.close();
  }
}

export async function invalidateCookies(): Promise<void> {
  await redis.del(COOKIE_CACHE_KEY);
  log.info('Cloudflare cookies invalidated');
}
