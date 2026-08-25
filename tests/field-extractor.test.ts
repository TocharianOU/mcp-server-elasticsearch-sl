import { describe, expect, it } from "vitest";
import { extractDslFields, extractEsqlFields } from "../src/lint/field-extractor.js";

const fields = (refs: { field: string }[]) => refs.map((r) => r.field).sort();

describe("extractDslFields", () => {
  it("extracts leaf clause fields", () => {
    const refs = extractDslFields({
      query: {
        bool: {
          must: [
            { term: { "user.name.keyword": "alice" } },
            { match: { message: "failed login" } },
            { range: { "@timestamp": { gte: "now-1d" } } },
          ],
          filter: [{ exists: { field: "source.ip" } }],
        },
      },
    });
    expect(fields(refs)).toEqual(["@timestamp", "message", "source.ip", "user.name.keyword"]);
    expect(refs.every((r) => r.usage === "query")).toBe(true);
  });

  it("extracts aggregation fields with agg usage", () => {
    const refs = extractDslFields({
      aggs: {
        top_users: {
          terms: { field: "user.name" },
          aggs: { avg_dur: { avg: { field: "event.duration" } } },
        },
        over_time: { date_histogram: { field: "@timestamp", fixed_interval: "1h" } },
      },
    });
    const aggRefs = refs.filter((r) => r.usage === "agg");
    expect(fields(aggRefs)).toEqual(["@timestamp", "event.duration", "user.name"]);
  });

  it("extracts sort fields, skipping _score", () => {
    const refs = extractDslFields({
      sort: [{ "@timestamp": "desc" }, "_score", "host.name"],
    });
    expect(fields(refs)).toEqual(["@timestamp", "host.name"]);
    expect(refs.every((r) => r.usage === "sort")).toBe(true);
  });

  it("extracts multi_match fields and strips boosts", () => {
    const refs = extractDslFields({
      query: { multi_match: { query: "x", fields: ["title^2", "body"] } },
    });
    expect(fields(refs)).toEqual(["body", "title"]);
  });

  it("recurses into nested and function_score", () => {
    const refs = extractDslFields({
      query: {
        nested: {
          path: "process.parent",
          query: { term: { "process.parent.name": "bash" } },
        },
      },
    });
    expect(fields(refs)).toEqual(["process.parent", "process.parent.name"]);
  });

  it("handles agg filter sub-clauses and multi_terms", () => {
    const refs = extractDslFields({
      aggs: {
        only_err: {
          filter: { term: { "log.level": "error" } },
          aggs: { pair: { multi_terms: { terms: [{ field: "host.name" }, { field: "user.id" }] } } },
        },
      },
    });
    expect(fields(refs)).toEqual(["host.name", "log.level", "user.id"]);
  });

  it("empty body yields nothing", () => {
    expect(extractDslFields({})).toEqual([]);
  });
});

describe("extractEsqlFields", () => {
  it("extracts where/stats/sort fields", () => {
    const refs = extractEsqlFields(
      'FROM logs-* | WHERE user.name == "alice" AND event.outcome == "failure" | STATS c = COUNT(*) BY host.name | SORT c DESC'
    );
    const names = fields(refs);
    expect(names).toContain("user.name");
    expect(names).toContain("event.outcome");
    expect(names).toContain("host.name");
    // index pattern and alias must not appear
    expect(names).not.toContain("logs-*");
    expect(names).not.toContain("c");
  });

  it("excludes function names and keywords", () => {
    const refs = extractEsqlFields(
      "FROM idx | STATS avg_d = AVG(event.duration) BY user.id | WHERE avg_d > 100"
    );
    const names = fields(refs);
    expect(names).toEqual(["event.duration", "user.id"]);
  });

  it("ignores string literals and comments", () => {
    const refs = extractEsqlFields(
      'FROM idx | WHERE message LIKE "user.name*" // user.email\n | KEEP source.ip'
    );
    const names = fields(refs);
    expect(names).toContain("message");
    expect(names).toContain("source.ip");
    expect(names).not.toContain("user.name");
    expect(names).not.toContain("user.email");
  });

  it("handles backquoted identifiers", () => {
    const refs = extractEsqlFields("FROM idx | WHERE `weird field.name` > 1");
    expect(fields(refs)).toContain("weird field.name");
  });

  it("eval aliases are not reported as fields", () => {
    const refs = extractEsqlFields(
      "FROM idx | EVAL day = DATE_TRUNC(1d, @timestamp) | STATS c = COUNT(*) BY day"
    );
    const names = fields(refs);
    expect(names).toContain("@timestamp");
    expect(names).not.toContain("day");
  });

  it("empty query yields nothing", () => {
    expect(extractEsqlFields("")).toEqual([]);
  });
});
