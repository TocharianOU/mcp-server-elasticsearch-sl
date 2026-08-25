/**
 * ECS dictionary loader + keyword search.
 *
 * The dictionaries are generated from the official elastic/ecs flat spec by
 * scripts/build-ecs-dict.mjs and shipped inside the package (assets/).
 * They live in process memory only — never in the model's context; the
 * lookup_fields tool returns just the handful of entries a query needs.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface EcsEntry {
  name: string;
  type: string;
  description: string;
  example?: string;
  core: boolean;
}

export interface EcsDict {
  version: string;
  entries: EcsEntry[];
  byName: Map<string, EcsEntry>;
}

const cache = new Map<string, EcsDict>();

function assetPath(file: string): string {
  // compiled: dist/src/ecs/ecs-dict.js -> dist/assets/…  (build copies assets/)
  // source (vitest): src/ecs/ecs-dict.ts -> assets/…
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../assets", file);
}

/**
 * Load the dictionary matching the target ES major version:
 * ES 8/9 → ECS 9.x; ES ≤7 → ECS 1.x (the 7.x-era schema).
 */
export function loadEcsDict(esMajor: number = 8): EcsDict {
  const file = esMajor >= 8 ? "ecs-9.json" : "ecs-1.json";
  const hit = cache.get(file);
  if (hit) return hit;

  const raw = JSON.parse(fs.readFileSync(assetPath(file), "utf8")) as {
    version: string;
    fields: Record<string, { t: string; d: string; e?: string; c?: number }>;
  };
  const entries: EcsEntry[] = Object.entries(raw.fields).map(([name, f]) => ({
    name,
    type: f.t,
    description: f.d,
    ...(f.e ? { example: f.e } : {}),
    core: f.c === 1,
  }));
  const dict: EcsDict = {
    version: raw.version,
    entries,
    byName: new Map(entries.map((e) => [e.name, e])),
  };
  cache.set(file, dict);
  return dict;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@]+/)
    .filter((t) => t.length >= 2);
}

/** Score an entry against query tokens; 0 = no match. */
export function scoreEntry(entry: EcsEntry, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const nameLower = entry.name.toLowerCase();
  const nameParts = nameLower.split(".");
  const leaf = nameParts[nameParts.length - 1];
  const descLower = entry.description.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (nameLower === token) score += 8;
    else if (leaf === token) score += 5;
    else if (nameParts.some((p) => p === token)) score += 4;
    else if (nameLower.includes(token)) score += 3;
    if (descLower.includes(token)) score += 1;
  }
  if (score > 0 && entry.core) score += 0.5;
  return score;
}

/** Keyword search over the ECS dictionary. */
export function searchEcs(dict: EcsDict, query: string, limit = 15): EcsEntry[] {
  const tokens = tokenize(query);
  return dict.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length)
    .slice(0, limit)
    .map((s) => s.entry);
}
