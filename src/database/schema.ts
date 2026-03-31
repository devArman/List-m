import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Custom pgvector type
const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(384)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    return String(value)
      .replace(/[\[\]]/g, '')
      .split(',')
      .map(Number);
  },
});

// ============ Categories ============

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    externalId: varchar('external_id', { length: 50 }).notNull(),
    parentId: integer('parent_id'),
    nameEn: varchar('name_en', { length: 255 }),
    nameHy: varchar('name_hy', { length: 255 }),
    nameRu: varchar('name_ru', { length: 255 }),
    slug: varchar('slug', { length: 255 }).notNull(),
    url: varchar('url', { length: 500 }).notNull(),
    listingCount: integer('listing_count').default(0),
    level: integer('level').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_categories_external_id').on(table.externalId),
    index('idx_categories_parent').on(table.parentId),
    index('idx_categories_slug').on(table.slug),
  ],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'parentChild',
  }),
  children: many(categories, { relationName: 'parentChild' }),
  listings: many(listings),
}));

// ============ Listings ============

export const listings = pgTable(
  'listings',
  {
    id: serial('id').primaryKey(),
    externalId: varchar('external_id', { length: 50 }).notNull(),
    categoryId: integer('category_id'),
    titleEn: text('title_en'),
    titleHy: text('title_hy'),
    titleRu: text('title_ru'),
    descriptionEn: text('description_en'),
    descriptionHy: text('description_hy'),
    descriptionRu: text('description_ru'),
    price: decimal('price', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 10 }),
    priceType: varchar('price_type', { length: 50 }),
    locationCity: varchar('location_city', { length: 255 }),
    locationDistrict: varchar('location_district', { length: 255 }),
    locationAddress: text('location_address'),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    contactName: varchar('contact_name', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 50 }),
    sellerType: varchar('seller_type', { length: 50 }),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().default({}),
    images: jsonb('images').$type<Array<{ originalUrl: string; localPath?: string; order: number }>>().default([]),
    sourceUrl: varchar('source_url', { length: 500 }).notNull(),
    postedAt: timestamp('posted_at'),
    updatedAtSource: timestamp('updated_at_source'),
    isActive: boolean('is_active').default(true),
    rawHtml: text('raw_html'),
    embedding: vector('embedding'),
    scrapedAt: timestamp('scraped_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_listings_external').on(table.externalId),
    index('idx_listings_category').on(table.categoryId),
    index('idx_listings_price').on(table.price),
    index('idx_listings_location').on(table.locationCity),
    index('idx_listings_posted').on(table.postedAt),
    index('idx_listings_active').on(table.isActive),
  ],
);

export const listingsRelations = relations(listings, ({ one }) => ({
  category: one(categories, {
    fields: [listings.categoryId],
    references: [categories.id],
  }),
}));

// ============ Scrape Jobs ============

export const scrapeJobs = pgTable(
  'scrape_jobs',
  {
    id: serial('id').primaryKey(),
    jobType: varchar('job_type', { length: 50 }).notNull(),
    targetUrl: varchar('target_url', { length: 500 }),
    categoryId: integer('category_id'),
    status: varchar('status', { length: 20 }).default('pending'),
    attempts: integer('attempts').default(0),
    maxAttempts: integer('max_attempts').default(3),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_scrape_jobs_status').on(table.status),
    index('idx_scrape_jobs_type').on(table.jobType),
    index('idx_scrape_jobs_category').on(table.categoryId),
  ],
);

export const scrapeJobsRelations = relations(scrapeJobs, ({ one }) => ({
  category: one(categories, {
    fields: [scrapeJobs.categoryId],
    references: [categories.id],
  }),
}));
