import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgresql://listam:listam_secret@localhost:5432/listam'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  FLARESOLVERR_URL: z.string().default('http://localhost:8191/v1'),
  ANTHROPIC_API_KEY: z.string().default(''),

  SCRAPER_CONCURRENCY: z.coerce.number().int().min(1).default(3),
  SCRAPER_DELAY_MIN_MS: z.coerce.number().int().min(0).default(2000),
  SCRAPER_DELAY_MAX_MS: z.coerce.number().int().min(0).default(5000),
  SCRAPER_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(10),

  IMAGE_STORAGE_PATH: z.string().default('./storage/images'),

  API_PORT: z.coerce.number().int().default(3000),
  API_HOST: z.string().default('0.0.0.0'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
