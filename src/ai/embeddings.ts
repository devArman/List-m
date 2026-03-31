import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('embeddings');

let pipeline: any = null;

/**
 * Lazy-load the embedding model.
 * Uses all-MiniLM-L6-v2 via @huggingface/transformers (384 dimensions).
 */
async function getModel() {
  if (pipeline) return pipeline;

  log.info('Loading embedding model (all-MiniLM-L6-v2)... This may take a moment on first run.');
  const { pipeline: createPipeline } = await import('@huggingface/transformers');
  pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  log.info('Embedding model loaded');

  return pipeline;
}

/**
 * Generate a 384-dimensional embedding for a single text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = await getModel();
  const output = await model(text, { pooling: 'mean', normalize: true });

  // Output is a Tensor, convert to plain array
  const data: Float32Array = output.data;
  return Array.from(data);
}

/**
 * Generate embeddings for multiple texts.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];

  for (const text of texts) {
    try {
      const embedding = await generateEmbedding(text);
      results.push(embedding);
    } catch (error) {
      log.error({ error: String(error), text: text.substring(0, 100) }, 'Failed to generate embedding');
      results.push([]);
    }
  }

  return results;
}

/**
 * Build embedding input text from listing data.
 * Combines title, description, and key attributes into a single string.
 */
export function buildEmbeddingText(
  title: string | null,
  description: string | null,
  attributes: Record<string, unknown> | null,
): string {
  const parts: string[] = [];

  if (title) parts.push(title);
  if (description) parts.push(description.substring(0, 500)); // Limit description length

  if (attributes) {
    const attrText = Object.entries(attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (attrText) parts.push(attrText);
  }

  return parts.join('. ').substring(0, 1000) || 'listing';
}
