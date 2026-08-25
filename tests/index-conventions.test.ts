import { describe, expect, it } from "vitest";
import {
  adviseOnIndexName,
  adviseOnIndexNotFound,
  enrichIndexError,
} from "../src/lint/index-conventions.js";

describe("adviseOnIndexName", () => {
  it("redirects data stream backing index to the stream name", () => {
    const advice = adviseOnIndexName(
      ".ds-logs-endpoint.events.network-default-2025.10.03-000007",
      8
    );
    expect(advice).toContain("logs-endpoint.events.network-default");
    expect(advice).toContain("data stream");
  });

  it("redirects alerts indices to Kibana API", () => {
    expect(adviseOnIndexName(".alerts-security.alerts-default", 8)).toContain("Kibana API");
    expect(adviseOnIndexName(".siem-signals-default", 7)).toContain("Kibana API");
    expect(adviseOnIndexName(".internal.alerts-security.alerts-default-000001", 8)).toContain(
      "Kibana API"
    );
  });

  it("flags kibana and system indices", () => {
    expect(adviseOnIndexName(".kibana_8.17.3_001", 8)).toContain("Kibana API");
    expect(adviseOnIndexName(".security-7", 8)).toContain("系统内部");
  });

  it("stays silent on normal indices and wildcards", () => {
    expect(adviseOnIndexName("logs-nginx.access-default", 8)).toBeNull();
    expect(adviseOnIndexName("my-app-2024.01", 8)).toBeNull();
    expect(adviseOnIndexName(".alerts-*", 8)).toBeNull();
  });
});

describe("adviseOnIndexNotFound", () => {
  it("suggests data stream naming for beats names on ES 8", () => {
    const advice = adviseOnIndexNotFound("filebeat-2024.01.01", 8);
    expect(advice).toContain("logs-");
  });

  it("suggests beats naming for data stream names on ES 7", () => {
    const advice = adviseOnIndexNotFound("logs-nginx-default", 7);
    expect(advice).toContain("filebeat");
  });

  it("always points at list tools", () => {
    expect(adviseOnIndexNotFound("whatever", 8)).toContain("list_indices");
  });
});

describe("enrichIndexError", () => {
  it("appends advice on index_not_found_exception", () => {
    const msg = enrichIndexError(
      "index_not_found_exception: no such index [filebeat-7.9]",
      8
    );
    expect(msg).toContain("提示");
  });

  it("passes through unrelated errors", () => {
    const msg = enrichIndexError("parsing_exception: unknown key", 8);
    expect(msg).not.toContain("提示");
  });
});
