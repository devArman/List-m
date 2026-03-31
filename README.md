# List.am Scraper

A complete Node.js backend system that scrapes all publicly available data from [list.am](https://www.list.am) (Armenia's largest classifieds platform with ~685K+ listings), stores it in PostgreSQL with vector embeddings, and orchestrates work through job queues.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ FlareSolverr │────▶│   Scraper    │────▶│  PostgreSQL  │
│  (CF bypass) │     │  (Playwright) │     │  (pgvector)  │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │    BullMQ    │
                    │   (Redis)    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Category │ │ Listing  │ │  Detail  │
        │  Sync    │ │ Discovery│ │ Scraping │
        └──────────┘ └──────────┘ └────┬─────┘
                                       │
                              ┌────────┼────────┐
                              ▼                 ▼
                        ┌──────────┐     ┌──────────┐
                        │  Image   │     │Embedding │
                        │ Download │     │Generation│
                        └──────────┘     └──────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 LTS, TypeScript |
| Scraper | Playwright with stealth anti-detection |
| CF Bypass | FlareSolverr (Docker) + cookie caching in Redis |
| Database | PostgreSQL 16 with pgvector extension |
| ORM | Drizzle ORM |
| Job Queue | BullMQ + Redis |
| Embeddings | Local all-MiniLM-L6-v2 via @huggingface/transformers (384 dims) |
| Images | sharp for thumbnail generation |
| Logging | Pino with pretty-print |

## Prerequisites

- **Node.js** >= 20 (22 LTS recommended)
- **pnpm** (package manager)
- **Docker** and **Docker Compose** (for PostgreSQL, Redis, FlareSolverr)

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd listam-scraper
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings (defaults work for local development)
```

### 3. Start infrastructure

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL** (pgvector) on port 5432
- **Redis** on port 6379
- **FlareSolverr** on port 8191

### 4. Create database tables

```bash
pnpm db:push
```

### 5. Run the scraper

```bash
pnpm scrape
```

## How It Works

### Scraping Pipeline

The scraper runs in 5 phases, orchestrated by BullMQ job queues:

#### Phase 1: Category Sync
- Fetches `list.am/en/category` to build the full category tree
- Identifies all top-level categories and their subcategories
- Stores in the `categories` table with parent-child relationships
- **Worker concurrency:** 1

#### Phase 2: Listing Discovery
- For each leaf category, paginates through all listing pages
- Extracts listing IDs, titles, prices, and thumbnail URLs from cards
- Compares against known listings in the database
- New listings are queued for detail scraping
- **Worker concurrency:** 3

#### Phase 3: Detail Scraping
- Visits each individual listing page (`list.am/en/item/{id}`)
- Extracts: title, description, price, location, contact info, attributes, image URLs
- Stores raw HTML as backup for future re-parsing
- Queues image downloads and embedding generation
- Rate-limited: max 5 jobs per 10 seconds with 2-5s random delay
- **Worker concurrency:** 5

#### Phase 4: Image Download
- Downloads full-resolution images for each listing
- Generates 300x300 thumbnails via sharp
- Saves to `storage/images/{categoryId}/{listingId}/`
- **Worker concurrency:** 10

#### Phase 5: Embedding Generation
- Combines title + description + attributes into text
- Generates 384-dimensional vector embeddings locally
- Uses `all-MiniLM-L6-v2` model (downloads ~100MB on first run)
- Stored in pgvector column for future similarity search
- **Worker concurrency:** 2

### Cloudflare Bypass

list.am is protected by Cloudflare. The bypass strategy:

1. **FlareSolverr** (primary): Sends requests to the FlareSolverr Docker container, which solves Cloudflare challenges and returns `cf_clearance` cookies
2. **Redis cookie cache**: Cookies are cached in Redis with 10-minute TTL
3. **Fast HTTP requests**: Subsequent requests use cached cookies via `got` (no browser needed)
4. **Playwright fallback**: If cookies expire or HTTP requests get blocked, falls back to full Playwright browser with stealth settings

### Scheduling

| Schedule | Action |
|----------|--------|
| **Initial** | Full scrape of all categories and listings |
| **Every 10 min** | Poll first 2 pages of each category for new listings |
| **Daily at 2 AM** | Full reconciliation — re-sync categories, detect inactive listings |

### Anti-Detection Measures

- Random delays between requests (2-5 seconds, configurable)
- Pool of 20+ real browser user agents, rotated per session
- Random viewport sizes and timezones
- `navigator.webdriver` override and other fingerprint spoofing
- Exponential backoff on rate limiting (30s → 60s → 120s → 300s)
- Resource blocking (fonts, stylesheets) for faster page loads

## Project Structure

```
src/
├── config/
│   ├── environment.ts      # Zod-validated env vars
│   ├── database.ts         # Drizzle ORM + pg pool
│   ├── redis.ts            # IORedis for BullMQ + cookie cache
│   └── constants.ts        # URLs, user agents, queue names
├── database/
│   └── schema.ts           # Drizzle schema (categories, listings, scrape_jobs)
├── scraper/
│   ├── browser.ts          # Playwright browser manager + stealth
│   ├── cloudflare.ts       # FlareSolverr integration + cookie management
│   ├── categoryCrawler.ts  # Crawls category tree
│   ├── listingCrawler.ts   # Paginates categories for listing URLs
│   ├── detailCrawler.ts    # Scrapes individual listing pages
│   ├── imageScraper.ts     # Downloads images + generates thumbnails
│   ├── scheduler.ts        # Orchestrates scraping pipeline
│   ├── run.ts              # CLI entry point
│   ├── parsers/
│   │   ├── categoryParser.ts   # Parses category tree from HTML
│   │   ├── listingParser.ts    # Parses listing cards from category pages
│   │   ├── detailParser.ts     # Parses full listing detail pages
│   │   └── attributeParser.ts  # Parses category-specific attributes
│   └── workers/
│       ├── categorySyncWorker.ts
│       ├── listingDiscoveryWorker.ts
│       ├── detailScrapingWorker.ts
│       ├── imageDownloadWorker.ts
│       └── embeddingWorker.ts
├── ai/
│   └── embeddings.ts       # Local vector embeddings (all-MiniLM-L6-v2)
├── services/
│   ├── categoryService.ts  # Category CRUD + tree operations
│   ├── listingService.ts   # Listing upsert, deactivation, embedding updates
│   └── imageService.ts     # Image path management
├── utils/
│   ├── logger.ts           # Pino logger
│   ├── retry.ts            # Exponential backoff retry
│   ├── rateLimit.ts        # Token bucket rate limiter
│   └── helpers.ts          # Sleep, random delay, URL builders, parsers
└── index.ts                # Main entry point
```

## Database Schema

### categories
Stores the full category tree with parent-child relationships. Supports English, Armenian, and Russian names.

### listings
Main table with all listing data:
- Multi-language title/description (en, hy, ru)
- Price with currency and type (per_month, total, etc.)
- Location (city, district, address, lat/lng)
- Contact info (phone, name, seller type)
- `attributes` JSONB for category-specific fields (sqm, bedrooms, mileage, etc.)
- `images` JSONB array with original URLs and local paths
- `embedding` pgvector(384) for similarity search
- `raw_html` backup of the original detail page

### scrape_jobs
Tracks job status for auditing and debugging.

## Configuration

All settings are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://listam:listam_secret@localhost:5432/listam` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `FLARESOLVERR_URL` | `http://localhost:8191/v1` | FlareSolverr endpoint |
| `SCRAPER_CONCURRENCY` | `3` | Max concurrent browser contexts |
| `SCRAPER_DELAY_MIN_MS` | `2000` | Min delay between requests |
| `SCRAPER_DELAY_MAX_MS` | `5000` | Max delay between requests |
| `SCRAPER_MAX_RETRIES` | `3` | Max retry attempts per request |
| `POLL_INTERVAL_MINUTES` | `10` | Recurring poll frequency |
| `IMAGE_STORAGE_PATH` | `./storage/images` | Local image storage directory |

## npm Scripts

| Script | Description |
|--------|-------------|
| `pnpm scrape` | Start the scraper (main entry point) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled JS from `dist/` |
| `pnpm dev` | Run with tsx (dev mode, no build needed) |
| `pnpm db:push` | Push schema to database (create/update tables) |
| `pnpm db:generate` | Generate migration files |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio (database GUI) |

## Docker

Build and run as a container:

```bash
docker build -t listam-scraper .
docker-compose up -d
docker run --network host listam-scraper
```

## Resumability

The scraper is designed to resume from where it left off:
- Listing IDs are checked against the database before queuing detail scrapes
- BullMQ jobs have unique IDs to prevent duplicates
- Failed jobs are retried with exponential backoff (3 attempts)
- Stopping and restarting the scraper continues processing the queue
