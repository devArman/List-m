import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { categories } from '../database/schema.js';
import { createChildLogger } from '../utils/logger.js';
import type { CrawledCategory } from '../scraper/categoryCrawler.js';

const log = createChildLogger('categoryService');

/**
 * Upsert a batch of crawled categories into the database.
 * First inserts top-level categories, then resolves parent IDs for subcategories.
 */
export async function syncCategories(crawled: CrawledCategory[]): Promise<void> {
  const topLevel = crawled.filter((c) => !c.parentExternalId);
  const subcategories = crawled.filter((c) => !!c.parentExternalId);

  log.info({ topLevel: topLevel.length, subcategories: subcategories.length }, 'Syncing categories');

  // Upsert top-level categories
  for (const cat of topLevel) {
    await upsertCategory(cat);
  }

  // Upsert subcategories (need parent IDs)
  for (const sub of subcategories) {
    const parent = await findByExternalId(sub.parentExternalId!);
    await upsertCategory(sub, parent?.id);
  }

  log.info('Category sync complete');
}

async function upsertCategory(cat: CrawledCategory, parentDbId?: number): Promise<void> {
  const slug = cat.name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 250);

  const existing = await findByExternalId(cat.externalId);

  if (existing) {
    await db
      .update(categories)
      .set({
        nameEn: cat.name,
        slug,
        url: cat.url,
        listingCount: cat.listingCount ?? existing.listingCount,
        parentId: parentDbId ?? existing.parentId,
        level: cat.level,
        updatedAt: new Date(),
      })
      .where(eq(categories.id, existing.id));
  } else {
    await db.insert(categories).values({
      externalId: cat.externalId,
      nameEn: cat.name,
      slug,
      url: cat.url,
      listingCount: cat.listingCount ?? 0,
      parentId: parentDbId ?? null,
      level: cat.level,
    });
  }
}

export async function findByExternalId(externalId: string) {
  const results = await db
    .select()
    .from(categories)
    .where(eq(categories.externalId, externalId))
    .limit(1);
  return results[0] ?? null;
}

export async function getAllCategories() {
  return db.select().from(categories);
}

export async function getCategoryTree() {
  const all = await getAllCategories();
  const topLevel = all.filter((c) => !c.parentId);
  return topLevel.map((parent) => ({
    ...parent,
    children: all.filter((c) => c.parentId === parent.id),
  }));
}
