/**
 * Query lint engine.
 *
 * Checks AI-written field references against the live cluster's field caps
 * and either auto-fixes unambiguous mistakes (the classic one: a spurious
 * `.keyword` suffix on ECS/built-in mappings) or returns actionable
 * suggestions the model can follow without any version-specific knowledge.
 *
 * Design rule: live field caps are the ground truth; the lint layer must
 * never break the tool (all callers wrap it defensively) and never guess
 * when a fix is ambiguous.
 */
import type { FieldMap } from "./field-caps-service.js";
import type { FieldRef } from "./field-extractor.js";

export interface LintProblem {
  field: string;
  usage: string;
  at: string;
  message: string;
}

export interface LintResult {
  /** Unambiguous renames to apply: original field -> replacement. */
  fixes: Map<string, string>;
  /** Human-readable notes describing applied fixes. */
  notes: string[];
  /** Unfixable issues with actionable suggestions. */
  problems: LintProblem[];
}

const SUGGESTION_LIMIT = 5;

function levenshtein(a: string, b: string, cap = 6): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = tmp;
    }
  }
  return prev[b.length];
}

/** Rank existing fields by similarity to a missing name. */
export function suggestFields(
  missing: string,
  fields: FieldMap,
  limit = SUGGESTION_LIMIT
): string[] {
  const lower = missing.toLowerCase();
  const leaf = lower.split(".").pop() ?? lower;
  const scored: Array<{ name: string; score: number }> = [];

  for (const name of fields.keys()) {
    if (name.startsWith("_")) continue;
    const nameLower = name.toLowerCase();
    let score = Infinity;
    if (nameLower === lower) score = 0;
    else if (nameLower.includes(lower) || lower.includes(nameLower)) score = 1;
    else {
      const nameLeaf = nameLower.split(".").pop() ?? nameLower;
      if (nameLeaf === leaf) score = 1.5;
      else {
        const d = levenshtein(lower, nameLower);
        if (d <= Math.max(2, Math.floor(lower.length / 4))) score = 2 + d;
        else if (nameLeaf.includes(leaf) || leaf.includes(nameLeaf)) score = 6;
      }
    }
    if (score !== Infinity) scored.push({ name, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length)
    .slice(0, limit)
    .map((s) => s.name);
}

function describeField(name: string, fields: FieldMap): string {
  const info = fields.get(name);
  if (!info) return name;
  return `${name} (${info.type}${info.aggregatable ? ", 可聚合" : ""})`;
}

function isAggUsage(usage: string): boolean {
  return usage === "agg" || usage === "sort";
}

/**
 * Lint field references against the live field map.
 *
 * `definedExtra` carries names defined inside the query itself
 * (runtime mappings, script fields, ES|QL aliases) that must not be
 * flagged as missing.
 */
export function lintFieldRefs(
  refs: FieldRef[],
  fields: FieldMap,
  definedExtra: Set<string> = new Set()
): LintResult {
  const fixes = new Map<string, string>();
  const notes: string[] = [];
  const problems: LintProblem[] = [];

  for (const ref of refs) {
    const { field, usage, at } = ref;
    if (field.includes("*") || field.startsWith("_") || definedExtra.has(field)) {
      continue;
    }

    const info = fields.get(field);
    if (info) {
      // exists — only concern: aggregating/sorting on a non-aggregatable field
      if (isAggUsage(usage) && !info.aggregatable) {
        const sub = fields.get(`${field}.keyword`);
        if (sub?.aggregatable) {
          fixes.set(field, `${field}.keyword`);
          notes.push(
            `已自动修正：${field} 是 text 不可聚合/排序，改用其 keyword 子字段 ${field}.keyword`
          );
        } else {
          problems.push({
            field,
            usage,
            at,
            message:
              `字段 ${field} 是 ${info.type} 类型，不可用于聚合/排序，且没有 .keyword 子字段。` +
              `可聚合的相近字段：${suggestFields(field, fields)
                .filter((n) => fields.get(n)?.aggregatable)
                .map((n) => describeField(n, fields))
                .join("、") || "（未找到）"}`,
          });
        }
      }
      continue;
    }

    // missing field — the classic case first: spurious `.keyword`
    if (field.endsWith(".keyword")) {
      const base = field.slice(0, -".keyword".length);
      const baseInfo = fields.get(base);
      if (baseInfo) {
        if (!isAggUsage(usage) || baseInfo.aggregatable) {
          fixes.set(field, base);
          notes.push(
            `已自动修正：${field} 不存在——该索引的 ${base} 本身就是 ${baseInfo.type} 类型` +
            `（ECS/内置映射无 .keyword 子字段），已改用 ${base}`
          );
        } else {
          problems.push({
            field,
            usage,
            at,
            message:
              `${field} 不存在，且 ${base} 是 ${baseInfo.type} 类型不可聚合。` +
              `可聚合的相近字段：${suggestFields(base, fields)
                .filter((n) => fields.get(n)?.aggregatable)
                .map((n) => describeField(n, fields))
                .join("、") || "（未找到）"}`,
          });
        }
        continue;
      }
    }

    const suggestions = suggestFields(field, fields);
    problems.push({
      field,
      usage,
      at,
      message:
        `字段 ${field} 在该索引中不存在。` +
        (suggestions.length
          ? `相近的真实字段：${suggestions.map((n) => describeField(n, fields)).join("、")}`
          : `未找到相近字段；可用 lookup_fields 或 get_mappings 工具查看该索引的真实字段。`),
    });
  }

  return { fixes, notes, problems };
}

/** Render problems as a single actionable message for the model. */
export function formatLintReport(problems: LintProblem[]): string {
  const lines = problems.map(
    (p, i) => `${i + 1}. [${p.at}] ${p.message}`
  );
  return (
    `查询未执行：发现 ${problems.length} 个字段问题（基于该索引的真实 field_caps）。\n` +
    lines.join("\n") +
    `\n请按建议修正字段后重试；确认字段确实存在（如运行时字段）可加 skip_lint: true 跳过检查。`
  );
}

// ── DSL rewrite（与 extractor 同构的遍历，把 fixes 应用回查询体）────────────

const FIELD_KEY_CLAUSES = new Set([
  "term", "terms", "match", "match_phrase", "match_phrase_prefix",
  "match_bool_prefix", "range", "prefix", "wildcard", "regexp", "fuzzy",
  "span_term", "distance_feature",
]);
const FIELD_PROP_CLAUSES = new Set(["exists", "rank_feature"]);
const FIELDS_ARRAY_CLAUSES = new Set([
  "multi_match", "query_string", "simple_query_string", "combined_fields",
]);
const COMPOUND_KEYS = new Set([
  "bool", "must", "must_not", "should", "filter", "dis_max", "queries",
  "constant_score", "function_score", "boosting", "positive", "negative",
]);
const AGG_FIELD_TYPES = new Set([
  "terms", "significant_terms", "rare_terms", "date_histogram", "histogram",
  "avg", "sum", "min", "max", "cardinality", "value_count", "stats",
  "extended_stats", "percentiles", "percentile_ranks", "top_hits", "missing",
  "auto_date_histogram", "variable_width_histogram", "multi_terms",
]);

function renameKeys(obj: Record<string, unknown>, ren: (n: string) => string) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[ren(k)] = v;
  return out;
}

function rewriteQuery(node: unknown, ren: (n: string) => string): unknown {
  if (Array.isArray(node)) return node.map((n) => rewriteQuery(n, ren));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (FIELD_KEY_CLAUSES.has(key) && value && typeof value === "object") {
      out[key] = renameKeys(value as Record<string, unknown>, ren);
    } else if (FIELD_PROP_CLAUSES.has(key) && value && typeof value === "object") {
      const v = { ...(value as Record<string, unknown>) };
      if (typeof v.field === "string") v.field = ren(v.field);
      out[key] = v;
    } else if (FIELDS_ARRAY_CLAUSES.has(key) && value && typeof value === "object") {
      const v = { ...(value as Record<string, unknown>) };
      if (Array.isArray(v.fields)) {
        v.fields = v.fields.map((f) => {
          if (typeof f !== "string") return f;
          const [name, boost] = f.split("^");
          return boost ? `${ren(name)}^${boost}` : ren(name);
        });
      }
      out[key] = v;
    } else if (key === "nested" && value && typeof value === "object") {
      const v = { ...(value as Record<string, unknown>) };
      if (typeof v.path === "string") v.path = ren(v.path);
      v.query = rewriteQuery(v.query, ren);
      out[key] = v;
    } else if (COMPOUND_KEYS.has(key) || key === "query") {
      out[key] = rewriteQuery(value, ren);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function rewriteAggs(node: unknown, ren: (n: string) => string): unknown {
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [aggName, aggBody] of Object.entries(node as Record<string, unknown>)) {
    if (!aggBody || typeof aggBody !== "object") { out[aggName] = aggBody; continue; }
    const newBody: Record<string, unknown> = {};
    for (const [aggType, spec] of Object.entries(aggBody as Record<string, unknown>)) {
      if (aggType === "aggs" || aggType === "aggregations") {
        newBody[aggType] = rewriteAggs(spec, ren);
      } else if (aggType === "multi_terms" && spec && typeof spec === "object") {
        const v = { ...(spec as Record<string, unknown>) };
        if (Array.isArray(v.terms)) {
          v.terms = v.terms.map((t) => {
            if (t && typeof t === "object" && typeof (t as Record<string, unknown>).field === "string") {
              return { ...(t as Record<string, unknown>), field: ren((t as Record<string, unknown>).field as string) };
            }
            return t;
          });
        }
        newBody[aggType] = v;
      } else if (AGG_FIELD_TYPES.has(aggType) && spec && typeof spec === "object") {
        const v = { ...(spec as Record<string, unknown>) };
        if (typeof v.field === "string") v.field = ren(v.field);
        newBody[aggType] = v;
      } else if (aggType === "filter") {
        newBody[aggType] = rewriteQuery(spec, ren);
      } else {
        newBody[aggType] = spec;
      }
    }
    out[aggName] = newBody;
  }
  return out;
}

function rewriteSort(node: unknown, ren: (n: string) => string): unknown {
  if (typeof node === "string") return node === "_score" || node === "_doc" ? node : ren(node);
  if (Array.isArray(node)) return node.map((n) => rewriteSort(n, ren));
  if (node && typeof node === "object") {
    return renameKeys(node as Record<string, unknown>, (k) =>
      k === "_score" || k === "_doc" ? k : ren(k)
    );
  }
  return node;
}

/** Apply field renames to a DSL body (returns a new object). */
export function rewriteDslFields(
  body: Record<string, unknown>,
  fixes: Map<string, string>
): Record<string, unknown> {
  if (fixes.size === 0) return body;
  const ren = (n: string) => fixes.get(n) ?? n;
  const out: Record<string, unknown> = { ...body };
  if (out.query) out.query = rewriteQuery(out.query, ren);
  if (out.aggs) out.aggs = rewriteAggs(out.aggs, ren);
  if (out.aggregations) out.aggregations = rewriteAggs(out.aggregations, ren);
  if (out.sort) out.sort = rewriteSort(out.sort, ren);
  if (out.collapse && typeof out.collapse === "object") {
    const v = { ...(out.collapse as Record<string, unknown>) };
    if (typeof v.field === "string") v.field = ren(v.field);
    out.collapse = v;
  }
  return out;
}

/** Apply field renames inside an ES|QL query string (token-boundary safe). */
export function applyEsqlFixes(query: string, fixes: Map<string, string>): string {
  let result = query;
  for (const [from, to] of fixes) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(?<![\\w.@\`])${escaped}(?![\\w.@])`, "g"),
      to
    );
  }
  return result;
}

/** Names defined inside a DSL body itself (must not be linted as missing). */
export function collectDslDefinedFields(body: Record<string, unknown>): Set<string> {
  const defined = new Set<string>();
  for (const key of ["runtime_mappings", "script_fields"]) {
    const section = body[key];
    if (section && typeof section === "object") {
      for (const name of Object.keys(section as Record<string, unknown>)) defined.add(name);
    }
  }
  return defined;
}

// ── ES error enrichment（执行失败时把 ES 报错翻译成可行动建议）─────────────

const ES_FIELD_ERROR_PATTERNS = [
  /No mapping found for \[([^\]]+)\]/,
  /Unknown column \[([^\]]+)\]/i,
  /unknown field \[([^\]]+)\]/i,
  /No field found for \[([^\]]+)\]/,
  /Field \[([^\]]+)\] of type \[[^\]]+\] is not supported/,
  /Text fields are not optimised[^[]*\[([^\]]+)\]/,
  /Fielddata is disabled on \[([^\]]+)\]/,
];

/** If the ES error mentions a field, append live suggestions. */
export function enrichEsError(message: string, fields: FieldMap | null): string {
  if (!fields || fields.size === 0) return message;
  for (const pattern of ES_FIELD_ERROR_PATTERNS) {
    const m = pattern.exec(message);
    if (m?.[1]) {
      const missing = m[1];
      const base = missing.endsWith(".keyword")
        ? missing.slice(0, -".keyword".length)
        : null;
      if (base && fields.has(base)) {
        const info = fields.get(base)!;
        return (
          `${message}\n提示：${missing} 不存在，但 ${base} 本身是 ${info.type} 类型` +
          `（内置/ECS 映射无 .keyword 子字段），请直接使用 ${base}。`
        );
      }
      const suggestions = suggestFields(missing, fields);
      if (suggestions.length) {
        return (
          `${message}\n提示：该索引中的相近真实字段：` +
          suggestions.map((n) => describeField(n, fields)).join("、")
        );
      }
    }
  }
  return message;
}
