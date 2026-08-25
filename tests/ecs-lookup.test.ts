import { describe, expect, it } from "vitest";
import { loadEcsDict, scoreEntry, searchEcs } from "../src/ecs/ecs-dict.js";
import { buildLookupRows, formatLookupRows } from "../src/tools/lookup-fields.js";
import type { FieldMap } from "../src/lint/field-caps-service.js";

describe("ECS dictionary", () => {
  it("loads the v9 dictionary for ES 8/9", () => {
    const dict = loadEcsDict(8);
    expect(dict.entries.length).toBeGreaterThan(2000);
    expect(dict.byName.get("source.ip")?.type).toBe("ip");
    expect(dict.byName.get("@timestamp")?.core).toBe(true);
  });

  it("loads the v1 dictionary for ES 7", () => {
    const dict = loadEcsDict(7);
    expect(dict.version.startsWith("1.")).toBe(true);
    expect(dict.byName.has("source.ip")).toBe(true);
  });

  it("searchEcs finds fields by keywords", () => {
    const dict = loadEcsDict(8);
    const names = searchEcs(dict, "source ip address").map((e) => e.name);
    expect(names).toContain("source.ip");
    const proc = searchEcs(dict, "process name").map((e) => e.name);
    expect(proc).toContain("process.name");
  });

  it("scoreEntry returns 0 for no match", () => {
    const dict = loadEcsDict(8);
    const entry = dict.byName.get("source.ip")!;
    expect(scoreEntry(entry, ["zzzqqq"])).toBe(0);
  });
});

describe("buildLookupRows", () => {
  const live: FieldMap = new Map(
    Object.entries({
      "source.ip": { type: "ip", types: ["ip"], aggregatable: true, searchable: true },
      my_custom_ip: { type: "ip", types: ["ip"], aggregatable: true, searchable: true },
      message: { type: "text", types: ["text"], aggregatable: false, searchable: true },
    })
  );

  it("live-existing fields rank first and are marked", () => {
    const rows = buildLookupRows("source ip", loadEcsDict(8), live, 10);
    expect(rows[0].field).toBe("source.ip");
    expect(rows[0].exists).toBe(true);
    expect(rows[0].aggregatable).toBe(true);
    // ECS-only entries marked as not existing
    const ecsOnly = rows.find((r) => r.exists === false);
    expect(ecsOnly).toBeTruthy();
  });

  it("finds custom (non-ECS) live fields by name", () => {
    const rows = buildLookupRows("custom ip", loadEcsDict(8), live, 10);
    const custom = rows.find((r) => r.field === "my_custom_ip");
    expect(custom?.exists).toBe(true);
    expect(custom?.description).toContain("自定义");
  });

  it("without live fields exists is null", () => {
    const rows = buildLookupRows("user name login", loadEcsDict(8), null, 10);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.exists === null)).toBe(true);
    expect(rows.map((r) => r.field)).toContain("user.name");
  });

  it("respects limit", () => {
    const rows = buildLookupRows("ip", loadEcsDict(8), live, 5);
    expect(rows.length).toBeLessThanOrEqual(5);
  });
});

describe("formatLookupRows", () => {
  it("renders existence markers and header", () => {
    const rows = buildLookupRows("source ip", loadEcsDict(8), null, 3);
    const text = formatLookupRows(rows, undefined);
    expect(text).toContain("未指定 index");
    expect(text).toContain("source.ip");
  });

  it("empty result gives guidance", () => {
    expect(formatLookupRows([], "idx")).toContain("get_mappings");
  });
});
