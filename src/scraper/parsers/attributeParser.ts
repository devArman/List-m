import { sanitizeText } from '../../utils/helpers.js';

/**
 * Parse category-specific attributes from a listing detail page.
 *
 * list.am uses attribute tables/rows for structured data like:
 * - Real estate: Type, Rooms, Area (sqm), Floor, Building type, Renovation
 * - Auto: Make, Model, Year, Mileage, Engine, Transmission, Body type
 * - Electronics: Brand, Condition, etc.
 *
 * These are typically rendered as:
 *   <div class="attr">
 *     <div class="t">Label</div>
 *     <div class="i">Value</div>
 *   </div>
 * or as table rows:
 *   <tr><td>Label</td><td>Value</td></tr>
 */
export function parseAttributes(html: string): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  // Pattern 1: div-based attributes (class="attr" or similar)
  const divPattern = /<div[^>]*class="[^"]*(?:attr|property|detail|feature)[^"]*"[^>]*>\s*<(?:div|span)[^>]*class="[^"]*(?:t|label|key|name)[^"]*"[^>]*>([^<]+)<\/(?:div|span)>\s*<(?:div|span)[^>]*class="[^"]*(?:i|value|val)[^"]*"[^>]*>([^<]+)<\/(?:div|span)>/gi;

  let match: RegExpExecArray | null;
  while ((match = divPattern.exec(html)) !== null) {
    const key = normalizeKey(match[1]!);
    const value = sanitizeText(match[2]!);
    if (key && value) {
      attributes[key] = parseAttributeValue(key, value);
    }
  }

  // Pattern 2: table-based attributes
  const tablePattern = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi;
  while ((match = tablePattern.exec(html)) !== null) {
    const key = normalizeKey(match[1]!);
    const value = sanitizeText(match[2]!);
    if (key && value) {
      attributes[key] = parseAttributeValue(key, value);
    }
  }

  // Pattern 3: definition list based
  const dlPattern = /<dt[^>]*>([^<]+)<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/gi;
  while ((match = dlPattern.exec(html)) !== null) {
    const key = normalizeKey(match[1]!);
    const value = sanitizeText(match[2]!);
    if (key && value) {
      attributes[key] = parseAttributeValue(key, value);
    }
  }

  // Pattern 4: Generic label-value pairs using colon separator
  const colonPattern = /<(?:div|span|li)[^>]*>\s*([^<:]+):\s*<[^>]*>([^<]+)<\//gi;
  while ((match = colonPattern.exec(html)) !== null) {
    const key = normalizeKey(match[1]!);
    const value = sanitizeText(match[2]!);
    if (key && value && !attributes[key]) {
      attributes[key] = parseAttributeValue(key, value);
    }
  }

  return attributes;
}

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const NUMERIC_KEYS = new Set([
  'rooms', 'bedrooms', 'bathrooms', 'floor', 'total_floors', 'floors',
  'area', 'sqm', 'square', 'land_area',
  'year', 'mileage', 'engine', 'engine_size', 'engine_volume',
]);

function parseAttributeValue(key: string, value: string): unknown {
  // Try to convert numeric values
  if (NUMERIC_KEYS.has(key)) {
    const numMatch = value.match(/[\d,]+\.?\d*/);
    if (numMatch) {
      return parseFloat(numMatch[0].replace(/,/g, ''));
    }
  }

  // Boolean-like values
  const lower = value.toLowerCase();
  if (lower === 'yes' || lower === 'true' || lower === 'այո') return true;
  if (lower === 'no' || lower === 'false' || lower === 'ոdelays') return false;

  return value;
}
