# List.am Scraper - Project Instructions

## Project Overview

This is a Node.js/TypeScript scraper for list.am (Armenia's largest classifieds platform). It scrapes categories, listings, detail pages, and images, stores everything in PostgreSQL with pgvector embeddings, and uses BullMQ for job orchestration.

## Tech Stack

- **Language:** TypeScript (ESM modules, `"type": "module"` in package.json)
- **Runtime:** Node.js 22 LTS
- **Package Manager:** pnpm
- **Database:** PostgreSQL 16 + pgvector (via Docker)
- **ORM:** Drizzle ORM
- **Queue:** BullMQ + Redis
- **Scraper:** Playwright (stealth) + FlareSolverr for Cloudflare bypass
- **Embeddings:** Local all-MiniLM-L6-v2 via @huggingface/transformers (384 dimensions)
- **Images:** sharp for thumbnails
- **Logging:** Pino

## Build & Run

```bash
# Install dependencies
pnpm install

# Start infrastructure (Postgres, Redis, FlareSolverr)
docker-compose up -d

# Push schema to database
pnpm db:push

# Type-check
pnpm build   # or: npx tsc --noEmit

# Run the scraper
pnpm scrape

# Dev mode (with tsx, no build needed)
pnpm dev
```

## Code Conventions

- All imports use `.js` extension (ESM requirement): `import { foo } from './bar.js'`
- Use `createChildLogger('moduleName')` for module-specific logging
- Parsers are pure functions that take HTML and return structured data
- Crawlers use parsers and handle network/retry logic
- Workers are BullMQ job processors that call crawlers/services
- Services handle database operations via Drizzle ORM
- Always use `withRetry()` for external HTTP requests
- Always use `randomDelay()` between scraping requests

## Directory Structure

- `src/config/` — Environment, database, Redis, constants
- `src/database/` — Drizzle schema and migrations
- `src/scraper/parsers/` — Pure HTML parsing functions (no side effects)
- `src/scraper/workers/` — BullMQ job processors
- `src/scraper/` — Crawlers, browser manager, scheduler
- `src/services/` — Database CRUD operations
- `src/ai/` — Embedding generation
- `src/utils/` — Logger, retry, rate limiting, helpers

## Database

Schema is defined in `src/database/schema.ts` using Drizzle ORM:
- `categories` — Category tree with parent-child relationships
- `listings` — All listing data + pgvector(384) embedding column
- `scrape_jobs` — Job tracking

To modify schema: edit `src/database/schema.ts`, then run `pnpm db:push` (dev) or `pnpm db:generate && pnpm db:migrate` (prod).

## Key Design Decisions

1. **Cloudflare bypass:** FlareSolverr generates cookies cached in Redis (10min TTL). Fast HTTP via `got` with cookies. Playwright browser is the fallback.
2. **Embeddings:** Local model (no API costs). Uses `all-MiniLM-L6-v2` (384 dims). Model downloads ~100MB on first use.
3. **Job queues:** Separate BullMQ queues per job type with appropriate concurrency (1 for category sync, 5 for detail scraping, 10 for image download).
4. **Rate limiting:** 2-5s random delay between requests. Max 5 detail scrapes per 10 seconds. Exponential backoff on 429/403.
5. **Resumability:** Jobs have unique IDs. Known listing IDs are checked before re-scraping. Restarting continues from the queue.

## Important Notes

- The `dist/` directory is gitignored — always build before running `pnpm start`
- `.env` is gitignored — copy `.env.example` and configure
- `storage/` (images) is gitignored — created at runtime
- Raw HTML is stored in the `listings.raw_html` column as backup for re-parsing
- list.am has Cloudflare protection — FlareSolverr must be running (`docker-compose up -d`)

## Testing Changes

After making changes:
1. Run `npx tsc --noEmit` to verify TypeScript compiles
2. Check that the scraper starts without errors: `pnpm scrape` (Ctrl+C to stop after startup)
3. For parser changes, test with sample HTML from `listings.raw_html` in the database
