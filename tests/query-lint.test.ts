import { describe, expect, it } from "vitest";
import type { FieldMap } from "../src/lint/field-caps-service.js";
import { extractDslFields } from "../src/lint/field-extractor.js";
import {
  applyEsqlFixes,
  collectDslDefinedFields,
  enrichEsError,
  formatLintReport,
  lintFieldRefs,
  rewriteDslFields,
  suggestFields,
} from "../src/lint/query-lint.js";

/** ECS-style modern mapping: keyword 字段没有 .keyword 子字段 */
function ecsFields(): FieldMap {
  return new Map(
    Object.entries({
      "@timestamp": { type: "date", types: ["date"], aggregatable: true, searchable: true },
      "user.name": { type: "keyword", types: ["keyword"], aggregatable: true, searchable: true },
      "source.ip": { type: "ip", types: ["ip"], aggregatable: true, searchable: true },
      "host.name": { type: "keyword", types: ["keyword"], aggregatable: true, searchable: true },
      message: { type: "text", types: ["text"], aggregatable: false, searchable: true },
      "event.outcome": { type: "keyword", types: ["keyword"], aggregatable: true, searchable: true },
    })
  );
}

/** legacy 动态映射：text + .keyword 子字段并存 */
function legacyFields(): FieldMap {
  return new Map(
    Object.entries({
      username: { type: "text", types: ["text"], aggregatable: false, searchable: true },
      "username.keyword": { type: "keyword", types: ["keyword"], aggregatable: true, searchable: true },
      note: { type: "text", types: ["text"], aggregatable: false, searchable: true },
    })
  );
}

describe("lintFieldRefs — the .keyword cases", () => {
  it("auto-fixes spurious .keyword on ECS mapping", () => {
    const { fixes, notes, problems } = lintFieldRefs(
      [{ field: "user.name.keyword", usage: "agg", at: "aggs.u" }],
      ecsFields()
    );
    expect(fixes.get("user.name.keyword")).toBe("user.name");
    expect(problems).toHaveLength(0);
    expect(notes[0]).toContain("user.name");
  });

  it("auto-adds .keyword when aggregating legacy text field", () => {
    const { fixes, problems } = lintFieldRefs(
      [{ field: "username", usage: "agg", at: "aggs.u" }],
      legacyFields()
    );
    expect(fixes.get("username")).toBe("username.keyword");
    expect(problems).toHaveLength(0);
  });

  it("keeps valid legacy .keyword usage untouched", () => {
    const { fixes, problems } = lintFieldRefs(
      [{ field: "username.keyword", usage: "agg", at: "aggs.u" }],
      legacyFields()
    );
    expect(fixes.size).toBe(0);
    expect(problems).toHaveLength(0);
  });

  it("problem when aggregating text without keyword subfield", () => {
    const { fixes, problems } = lintFieldRefs(
      [{ field: "message", usage: "agg", at: "aggs.m" }],
      ecsFields()
    );
    expect(fixes.size).toBe(0);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("不可用于聚合");
  });

  it("query usage on text field is fine", () => {
    const { fixes, problems } = lintFieldRefs(
      [{ field: "message", usage: "query", at: "query.match" }],
      ecsFields()
    );
    expect(fixes.size).toBe(0);
    expect(problems).toHaveLength(0);
  });
});

describe("lintFieldRefs — missing fields", () => {
  it("suggests near matches for unknown fields", () => {
    const { problems } = lintFieldRefs(
      [{ field: "src_ip", usage: "query", at: "query.term" }],
      ecsFields()
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("source.ip");
  });

  it("skips wildcards, metadata and defined-in-query names", () => {
    const { problems } = lintFieldRefs(
      [
        { field: "user.*", usage: "query", at: "q" },
        { field: "_id", usage: "query", at: "q" },
        { field: "my_runtime", usage: "query", at: "q" },
      ],
      ecsFields(),
      new Set(["my_runtime"])
    );
    expect(problems).toHaveLength(0);
  });
});

describe("suggestFields", () => {
  it("ranks exact-ish and leaf matches first", () => {
    const suggestions = suggestFields("hostname", ecsFields());
    expect(suggestions[0]).toBe("host.name");
  });
});

describe("rewriteDslFields", () => {
  it("rewrites fields across query/aggs/sort", () => {
    const body = {
      query: { bool: { must: [{ term: { "user.name.keyword": "a" } }] } },
      aggs: { u: { terms: { field: "user.name.keyword" } } },
      sort: [{ "user.name.keyword": "asc" }],
    };
    const fixed = rewriteDslFields(body, new Map([["user.name.keyword", "user.name"]]));
    const refs = extractDslFields(fixed).map((r) => r.field);
    expect(refs).toContain("user.name");
    expect(refs).not.toContain("user.name.keyword");
    // 原对象不被修改
    expect(JSON.stringify(body)).toContain("user.name.keyword");
  });

  it("preserves boost suffix in multi_match fields", () => {
    const body = { query: { multi_match: { query: "x", fields: ["username^3"] } } };
    const fixed = rewriteDslFields(body, new Map([["username", "username.keyword"]]));
    const mm = (fixed.query as any).multi_match;
    expect(mm.fields).toEqual(["username.keyword^3"]);
  });
});

describe("applyEsqlFixes", () => {
  it("replaces tokens at boundaries only", () => {
    const q = 'FROM logs | WHERE user.name.keyword == "a" | STATS c = COUNT(*) BY user.name.keyword';
    const fixed = applyEsqlFixes(q, new Map([["user.name.keyword", "user.name"]]));
    expect(fixed).not.toContain(".keyword");
    expect(fixed).toContain("BY user.name");
  });

  it("does not corrupt longer field names", () => {
    const q = "FROM x | KEEP host.name, host.name_alias";
    const fixed = applyEsqlFixes(q, new Map([["host.name", "host.hostname"]]));
    expect(fixed).toContain("host.hostname,");
    expect(fixed).toContain("host.name_alias");
  });
});

describe("collectDslDefinedFields", () => {
  it("collects runtime mappings and script fields", () => {
    const defined = collectDslDefinedFields({
      runtime_mappings: { day_of_week: { type: "keyword" } },
      script_fields: { doubled: {} },
    });
    expect(defined.has("day_of_week")).toBe(true);
    expect(defined.has("doubled")).toBe(true);
  });
});

describe("enrichEsError", () => {
  it("explains spurious .keyword in ES error", () => {
    const msg = enrichEsError(
      "search_phase_execution_exception: No mapping found for [user.name.keyword] in order to sort on",
      ecsFields()
    );
    expect(msg).toContain("user.name 本身是 keyword");
  });

  it("suggests near fields for unknown column", () => {
    const msg = enrichEsError("Unknown column [hostname]", ecsFields());
    expect(msg).toContain("host.name");
  });

  it("passes through unrelated errors", () => {
    const msg = enrichEsError("circuit_breaking_exception: too much load", ecsFields());
    expect(msg).not.toContain("提示");
  });
});

describe("formatLintReport", () => {
  it("mentions skip_lint escape hatch", () => {
    const report = formatLintReport([
      { field: "x", usage: "query", at: "query.term", message: "字段 x 不存在" },
    ]);
    expect(report).toContain("skip_lint");
    expect(report).toContain("1.");
  });
});
