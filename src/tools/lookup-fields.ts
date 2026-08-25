/**
 * lookup_fields — the model's field dictionary.
 *
 * Merges the bundled ECS dictionary (semantic vocabulary) with the live
 * cluster's field_caps (ground truth of what actually exists), so the model
 * can resolve "which field holds X" without guessing — and without any
 * version-specific knowledge.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FieldCapsService, FieldMap } from "../lint/field-caps-service.js";
import { loadEcsDict, searchEcs, type EcsDict } from "../ecs/ecs-dict.js";

export interface LookupRow {
  field: string;
  type: string;
  exists: boolean | null; // null = no index given
  aggregatable: boolean | null;
  description: string;
  example?: string;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@.]+/)
    .flatMap((t) => t.split("."))
    .filter((t) => t.length >= 2);
}

/** Pure merge logic (unit-tested): live fields first, then ECS-only entries. */
export function buildLookupRows(
  query: string,
  dict: EcsDict,
  liveFields: FieldMap | null,
  limit: number
): LookupRow[] {
  const tokens = tokenizeQuery(query);
  const rows: LookupRow[] = [];
  const seen = new Set<string>();

  // 1) live fields matching the query — ground truth first
  if (liveFields) {
    const matches: Array<{ name: string; score: number }> = [];
    for (const name of liveFields.keys()) {
      if (name.startsWith("_")) continue;
      const lower = name.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower === token) score += 8;
        else if (lower.split(".").includes(token)) score += 4;
        else if (lower.includes(token)) score += 2;
      }
      // ECS description hit also counts (finds live ECS fields by meaning)
      const ecs = dict.byName.get(name);
      if (ecs) {
        for (const token of tokens) {
          if (ecs.description.toLowerCase().includes(token)) score += 1;
        }
      }
      if (score > 0) matches.push({ name, score });
    }
    matches.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    for (const m of matches.slice(0, limit)) {
      const info = liveFields.get(m.name)!;
      const ecs = dict.byName.get(m.name);
      rows.push({
        field: m.name,
        type: info.type,
        exists: true,
        aggregatable: info.aggregatable,
        description: ecs?.description ?? "(自定义字段，无 ECS 描述)",
        ...(ecs?.example ? { example: ecs.example } : {}),
      });
      seen.add(m.name);
    }
  }

  // 2) ECS entries not present live (or no index given)
  if (rows.length < limit) {
    for (const entry of searchEcs(dict, query, limit * 2)) {
      if (seen.has(entry.name)) continue;
      rows.push({
        field: entry.name,
        type: entry.type,
        exists: liveFields ? false : null,
        aggregatable: liveFields ? null : null,
        description: entry.description,
        ...(entry.example ? { example: entry.example } : {}),
      });
      if (rows.length >= limit) break;
    }
  }
  return rows;
}

export function formatLookupRows(rows: LookupRow[], index?: string): string {
  if (rows.length === 0) {
    return "未找到匹配字段。换更通用的英文关键词试试（ECS 描述是英文），或用 get_mappings 直接看索引结构。";
  }
  const lines = rows.map((r) => {
    const existence =
      r.exists === null ? "" : r.exists ? "［该索引存在✓］" : "［该索引不存在✗，仅为 ECS 标准名］";
    const agg = r.aggregatable === true ? "可聚合" : r.aggregatable === false ? "不可聚合(text)" : "";
    const example = r.example ? `（例: ${r.example}）` : "";
    return `- ${r.field} · ${r.type} ${existence}${agg ? " · " + agg : ""} — ${r.description}${example}`;
  });
  const header = index
    ? `字段查询结果（已与索引 ${index} 的真实 field_caps 求交）：`
    : "字段查询结果（未指定 index，仅 ECS 标准词汇；建议带上 index 参数确认字段真实存在）：";
  return `${header}\n${lines.join("\n")}`;
}

export function registerLookupFields(
  server: McpServer,
  fieldCaps: FieldCapsService,
  getEsMajor: () => number
) {
  server.tool(
    "lookup_fields",
    "Find the right field names before writing a query. Searches the bundled ECS " +
    "(Elastic Common Schema) dictionary by English keywords AND intersects with the " +
    "target index's real fields, telling you which fields actually exist, their types, " +
    "and whether they are aggregatable. ALWAYS prefer this over guessing field names " +
    "(e.g. never guess a .keyword suffix). Use English keywords like 'source ip', " +
    "'process name', 'login failure outcome'.",
    {
      query: z
        .string()
        .trim()
        .min(2)
        .describe("English keywords describing what you look for, e.g. 'source ip address' or 'user login outcome'"),
      index: z
        .string()
        .trim()
        .optional()
        .describe("Index name or pattern to check real existence against (strongly recommended)"),
      limit: z.number().int().min(1).max(50).optional().default(15),
    },
    async ({ query, index, limit }) => {
      let liveFields: FieldMap | null = null;
      if (index) {
        try {
          liveFields = await fieldCaps.getFields(index);
        } catch {
          liveFields = null; // index unreachable → ECS-only answer
        }
      }
      const dict = loadEcsDict(getEsMajor());
      const rows = buildLookupRows(query, dict, liveFields, limit);
      return {
        content: [{ type: "text" as const, text: formatLookupRows(rows, index) }],
      };
    }
  );
}
