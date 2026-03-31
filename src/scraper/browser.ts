import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createChildLogger } from '../utils/logger.js';
import { randomUserAgent, randomViewport } from '../utils/helpers.js';
import { TIMEZONES, LOCALES } from '../config/constants.js';

const log = createChildLogger('browser');

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;

  log.info('Launching browser...');

  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  browser.on('disconnected', () => {
    log.warn('Browser disconnected');
    browser = null;
  });

  log.info('Browser launched');
  return browser;
}

export async function createStealthContext(cookies?: Array<{ name: string; value: string; domain: string; path: string }>): Promise<BrowserContext> {
  const b = await getBrowser();
  const ua = randomUserAgent();
  const viewport = randomViewport();
  const timezone = TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)]!;
  const locale = LOCALES[Math.floor(Math.random() * LOCALES.length)]!;

  const context = await b.newContext({
    userAgent: ua,
    viewport,
    timezoneId: timezone,
    locale,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': `${locale},en;q=0.9`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
  });

  // Inject anti-detection scripts
  await context.addInitScript(`
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Override chrome detection
    window.chrome = { runtime: {} };

    // Override plugins length
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  `);

  if (cookies?.length) {
    await context.addCookies(cookies);
    log.debug({ count: cookies.length }, 'Injected cookies into context');
  }

  return context;
}

export async function createPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  // Block unnecessary resources for speed
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['font', 'stylesheet', 'media'].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  return page;
}

export async function navigateWithRetry(page: Page, url: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      return;
    } catch (error) {
      log.warn({ url, attempt, error: String(error) }, 'Navigation failed');
      if (attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    log.info('Browser closed');
  }
}
