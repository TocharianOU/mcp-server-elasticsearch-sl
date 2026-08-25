/**
 * Live lint tests against a real Elasticsearch instance — version-agnostic.
 *
 * Gated by ES_TEST_URL (e.g. http://localhost:9200). Uses raw REST (fetch)
 * for fixtures and assertions so the SAME suite runs on every ES from 5.x
 * to 9.x (the modern JS client refuses old servers). This is the golden
 * version-matrix suite: run it via scripts/version-matrix.sh.
 *
 * Creates and deletes its own scratch indices (prefix: mcp_lint_test_).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldCapsService } from "../src/lint/field-caps-service.js";
import { extractDslFields, extractEsqlFields } from "../src/lint/field-extractor.js";
import {
  applyEsqlFixes,
  enrichEsError,
  lintFieldRefs,
  rewriteDslFields,
} from "../src/lint/query-lint.js";

const ES_URL = (process.env.ES_TEST_URL || "").replace(/\/$/, "");
const LEGACY = "mcp_lint_test_legacy";
const ECS = "mcp_lint_test_ecs";

const d = describe.skipIf(!ES_URL);

// ── raw REST helpers (work on every ES version) ───────────────────────────
async function es(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const resp = await fetch(`${ES_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    /* non-JSON */
  }
  return { status: resp.status, json };
}

/** Client shim: FieldCapsService only needs fieldCaps(). */
const clientShim = {
  fieldCaps: async ({ index }: { index: string }) => {
    const { status, json } = await es("GET", `/${index}/_field_caps?fields=*`);
    if (status >= 400) throw new Error(JSON.stringify(json));
    return json;
  },
} as any;

let major = 0;
let minor = 0;
let fieldCaps: FieldCapsService;

function totalHits(resp: any): number {
  const t = resp?.hits?.total;
  return typeof t === "number" ? t : t?.value ?? 0;
}

d("live lint against real ES (version-agnostic)", () => {
  beforeAll(async () => {
    const info = await es("GET", "/");
    [major, minor] = String(info.json?.version?.number || "0.0")
      .split(".")
      .map(Number);

    const wrap = (properties: Record<string, unknown>) =>
      major <= 6 ? { doc: { properties } } : { properties };
    const docPath = (index: string) =>
      major <= 6 ? `/${index}/doc` : `/${index}/_doc`;

    await es("DELETE", `/${LEGACY}`);
    await es("DELETE", `/${ECS}`);

    // legacy dynamic-mapping index: text with .keyword subfield
    const legacyCreate = await es("PUT", `/${LEGACY}`, {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: wrap({
        username: {
          type: "text",
          fields: { keyword: { type: "keyword", ignore_above: 256 } },
        },
        note: { type: "text" },
        "@timestamp": { type: "date" },
      }),
    });
    expect(legacyCreate.status, JSON.stringify(legacyCreate.json)).toBeLessThan(300);

    // ECS-style index: bare keyword, no subfields
    const ecsCreate = await es("PUT", `/${ECS}`, {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: wrap({
        "@timestamp": { type: "date" },
        user: { properties: { name: { type: "keyword" } } },
        source: { properties: { ip: { type: "ip" } } },
        event: { properties: { outcome: { type: "keyword" } } },
        message: { type: "text" },
      }),
    });
    expect(ecsCreate.status, JSON.stringify(ecsCreate.json)).toBeLessThan(300);

    await es("POST", `${docPath(ECS)}?refresh=true`, {
      "@timestamp": "2026-01-01T00:00:00Z",
      user: { name: "alice" },
      source: { ip: "10.0.0.1" },
      event: { outcome: "failure" },
      message: "login failed for alice",
    });
    await es("POST", `${docPath(LEGACY)}?refresh=true`, {
      username: "bob",
      note: "hello",
      "@timestamp": "2026-01-01T00:00:00Z",
    });

    fieldCaps = new FieldCapsService(clientShim, 1_000);
  }, 60_000);

  afterAll(async () => {
    await es("DELETE", `/${LEGACY}`);
    await es("DELETE", `/${ECS}`);
  });

  it("field caps reflect the two mapping worlds", async () => {
    const ecs = await fieldCaps.getFields(ECS);
    expect(ecs.get("user.name")?.type).toBe("keyword");
    expect(ecs.has("user.name.keyword")).toBe(false);

    const legacy = await fieldCaps.getFields(LEGACY);
    expect(legacy.get("username")?.type).toBe("text");
    expect(legacy.get("username.keyword")?.type).toBe("keyword");
  });

  it("spurious .keyword on ECS index is auto-fixed and query succeeds", async () => {
    const fields = await fieldCaps.getFields(ECS);
    const body: Record<string, unknown> = {
      query: { term: { "user.name.keyword": "alice" } },
      aggs: { by_user: { terms: { field: "user.name.keyword" } } },
    };
    const { fixes, problems } = lintFieldRefs(extractDslFields(body), fields);
    expect(problems).toHaveLength(0);
    expect(fixes.get("user.name.keyword")).toBe("user.name");

    const fixed = rewriteDslFields(body, fixes);
    const resp = await es("POST", `/${ECS}/_search`, fixed);
    expect(resp.status).toBe(200);
    expect(totalHits(resp.json)).toBe(1);
    expect(resp.json.aggregations.by_user.buckets[0].key).toBe("alice");
  });

  it("aggregating legacy text field is auto-fixed to .keyword and succeeds", async () => {
    const fields = await fieldCaps.getFields(LEGACY);
    const body: Record<string, unknown> = {
      aggs: { by_user: { terms: { field: "username" } } },
      size: 0,
    };
    const { fixes, problems } = lintFieldRefs(extractDslFields(body), fields);
    expect(problems).toHaveLength(0);
    expect(fixes.get("username")).toBe("username.keyword");

    const fixed = rewriteDslFields(body, fixes);
    const resp = await es("POST", `/${LEGACY}/_search`, fixed);
    expect(resp.status).toBe(200);
    expect(resp.json.aggregations.by_user.buckets[0].key).toBe("bob");
  });

  it("unknown field is blocked with live suggestions", async () => {
    const fields = await fieldCaps.getFields(ECS);
    const { problems } = lintFieldRefs(
      extractDslFields({ query: { term: { src_ip: "10.0.0.1" } } }),
      fields
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("source.ip");
  });

  it("real ES sort error gets enriched with .keyword explanation", async () => {
    const fields = await fieldCaps.getFields(ECS);
    const resp = await es("POST", `/${ECS}/_search`, {
      sort: [{ "user.name.keyword": "asc" }],
    });
    expect(resp.status).toBeGreaterThanOrEqual(400);
    const raw = JSON.stringify(resp.json);
    const enriched = enrichEsError(raw, fields);
    expect(enriched).toContain("user.name");
  });

  it("ES|QL lint fixes .keyword and query runs (8.11+ only)", async () => {
    if (major < 8 || (major === 8 && minor < 11)) return;

    const fields = await fieldCaps.getFields(ECS);
    let query = `FROM ${ECS} | WHERE user.name.keyword == "alice" | STATS c = COUNT(*) BY event.outcome | LIMIT 10`;
    const { fixes, problems } = lintFieldRefs(extractEsqlFields(query), fields);
    expect(problems).toHaveLength(0);
    expect(fixes.size).toBeGreaterThan(0);
    query = applyEsqlFixes(query, fixes);

    const resp = await es("POST", "/_query", { query });
    expect(resp.status).toBe(200);
    expect(resp.json.values.length).toBe(1);
  });
});
