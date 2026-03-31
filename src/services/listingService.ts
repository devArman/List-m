import { eq, inArray, and, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { listings } from '../database/schema.js';
import { createChildLogger } from '../utils/logger.js';
import type { ParsedListingDetail } from '../scraper/parsers/detailParser.js';

const log = createChildLogger('listingService');

/**
 * Upsert a fully scraped listing into the database.
 */
export async function upsertListing(
  detail: ParsedListingDetail & { rawHtml: string },
  categoryDbId: number | null,
  images?: Array<{ originalUrl: string; localPath?: string; order: number }>,
): Promise<number> {
  const existing = await findByExternalId(detail.externalId);

  const data = {
    categoryId: categoryDbId,
    titleEn: detail.titleEn,
    titleHy: detail.titleHy,
    titleRu: detail.titleRu,
    descriptionEn: detail.descriptionEn,
    descriptionHy: detail.descriptionHy,
    descriptionRu: detail.descriptionRu,
    price: detail.price?.toString() ?? null,
    currency: detail.currency,
    priceType: detail.priceType,
    locationCity: detail.locationCity,
    locationDistrict: detail.locationDistrict,
    locationAddress: detail.locationAddress,
    latitude: detail.latitude?.toString() ?? null,
    longitude: detail.longitude?.toString() ?? null,
    contactName: detail.contactName,
    contactPhone: detail.contactPhone,
    sellerType: detail.sellerType,
    attributes: detail.attributes,
    images: images ?? detail.imageUrls.map((url, i) => ({ originalUrl: url, order: i })),
    sourceUrl: `https://www.list.am/en/item/${detail.externalId}`,
    postedAt: detail.postedAt,
    updatedAtSource: detail.updatedAtSource,
    isActive: true,
    rawHtml: detail.rawHtml,
    scrapedAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(listings).set(data).where(eq(listings.id, existing.id));
    log.debug({ externalId: detail.externalId }, 'Updated listing');
    return existing.id;
  }

  const [inserted] = await db.insert(listings).values({
    externalId: detail.externalId,
    ...data,
  }).returning({ id: listings.id });

  log.debug({ externalId: detail.externalId, id: inserted!.id }, 'Inserted listing');
  return inserted!.id;
}

export async function findByExternalId(externalId: string) {
  const results = await db
    .select()
    .from(listings)
    .where(eq(listings.externalId, externalId))
    .limit(1);
  return results[0] ?? null;
}

export async function getKnownExternalIds(externalIds: string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();

  const results = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(inArray(listings.externalId, externalIds));

  return new Set(results.map((r) => r.externalId));
}

export async function getKnownIdsForCategory(categoryDbId: number): Promise<Set<string>> {
  const results = await db
    .select({ externalId: listings.externalId })
    .from(listings)
    .where(eq(listings.categoryId, categoryDbId));

  return new Set(results.map((r) => r.externalId));
}

export async function markInactive(externalIds: string[]): Promise<void> {
  if (externalIds.length === 0) return;

  await db
    .update(listings)
    .set({ isActive: false, updatedAt: new Date() })
    .where(inArray(listings.externalId, externalIds));

  log.info({ count: externalIds.length }, 'Marked listings as inactive');
}

export async function updateEmbedding(listingId: number, embedding: number[]): Promise<void> {
  await db.execute(
    sql`UPDATE listings SET embedding = ${`[${embedding.join(',')}]`}::vector WHERE id = ${listingId}`
  );
}

export async function getListingsWithoutEmbeddings(limit = 100): Promise<Array<{ id: number; titleEn: string | null; descriptionEn: string | null; attributes: Record<string, unknown> | null }>> {
  return db
    .select({
      id: listings.id,
      titleEn: listings.titleEn,
      descriptionEn: listings.descriptionEn,
      attributes: listings.attributes,
    })
    .from(listings)
    .where(sql`embedding IS NULL AND is_active = true`)
    .limit(limit);
}
