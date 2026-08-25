/**
 * FieldCapsService — cached view of what fields actually exist on an index
 * pattern, straight from `_field_caps` (the ground truth for query linting).
 *
 * Priority rule of the whole lint layer: live cluster reality (this service)
 * always beats bundled knowledge (ECS dictionary, version conventions).
 */
import type { Client } from "@elastic/elasticsearch";

export interface FieldInfo {
  /** Primary type (first reported), e.g. "keyword", "text", "long". */
  type: string;
  /** All types reported across indices matching the pattern. */
  types: string[];
  aggregatable: boolean;
  searchable: boolean;
}

export type FieldMap = Map<string, FieldInfo>;

interface CacheEntry {
  at: number;
  fields: FieldMap;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_PATTERNS = 50;

export class FieldCapsService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private client: Client,
    private ttlMs: number = DEFAULT_TTL_MS
  ) {}

  /** Fetch (or reuse cached) field capabilities for an index pattern. */
  async getFields(indexPattern: string): Promise<FieldMap> {
    const hit = this.cache.get(indexPattern);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.fields;

    // Minimal parameter set so the call works on every client generation
    // (v5 legacy clients reject unknown/snake_case params). Legacy clients
    // may wrap the payload in `body`.
    const raw = (await (this.client as any).fieldCaps({
      index: indexPattern,
      fields: "*",
    })) as any;
    const payload = raw?.fields ? raw : raw?.body;

    const fields: FieldMap = new Map();
    for (const [name, caps] of Object.entries(
      (payload?.fields ?? {}) as Record<string, Record<string, any>>
    )) {
      const types = Object.keys(caps);
      if (types.length === 0) continue;
      const first = caps[types[0]];
      fields.set(name, {
        type: types[0],
        types,
        aggregatable: types.some((t) => caps[t]?.aggregatable),
        searchable: types.some((t) => caps[t]?.searchable),
      });
    }

    this.cache.set(indexPattern, { at: Date.now(), fields });
    // bound memory: drop oldest entries beyond the cap
    if (this.cache.size > MAX_PATTERNS) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    return fields;
  }

  invalidate(indexPattern?: string): void {
    if (indexPattern) this.cache.delete(indexPattern);
    else this.cache.clear();
  }
}
