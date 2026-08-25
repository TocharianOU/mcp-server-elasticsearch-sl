import { describe, expect, it, vi } from "vitest";
import { FieldCapsService } from "../src/lint/field-caps-service.js";
import type { Client } from "@elastic/elasticsearch";

function mockClient(fieldsResp: Record<string, unknown>) {
  const fieldCaps = vi.fn().mockResolvedValue({ fields: fieldsResp });
  return { client: { fieldCaps } as unknown as Client, fieldCaps };
}

const SAMPLE = {
  "user.name": {
    keyword: { type: "keyword", aggregatable: true, searchable: true },
  },
  message: {
    text: { type: "text", aggregatable: false, searchable: true },
  },
  "host.legacy": {
    text: { type: "text", aggregatable: false, searchable: true },
    keyword: { type: "keyword", aggregatable: true, searchable: true },
  },
};

describe("FieldCapsService", () => {
  it("normalizes field caps into a FieldMap", async () => {
    const { client } = mockClient(SAMPLE);
    const svc = new FieldCapsService(client);
    const fields = await svc.getFields("logs-*");

    expect(fields.get("user.name")).toMatchObject({ type: "keyword", aggregatable: true });
    expect(fields.get("message")).toMatchObject({ type: "text", aggregatable: false });
    expect(fields.get("host.legacy")?.types.sort()).toEqual(["keyword", "text"]);
    expect(fields.get("host.legacy")?.aggregatable).toBe(true);
  });

  it("caches per pattern within TTL", async () => {
    const { client, fieldCaps } = mockClient(SAMPLE);
    const svc = new FieldCapsService(client, 60_000);
    await svc.getFields("a-*");
    await svc.getFields("a-*");
    await svc.getFields("b-*");
    expect(fieldCaps).toHaveBeenCalledTimes(2);
  });

  it("refetches after TTL expiry", async () => {
    vi.useFakeTimers();
    try {
      const { client, fieldCaps } = mockClient(SAMPLE);
      const svc = new FieldCapsService(client, 1_000);
      await svc.getFields("a-*");
      vi.advanceTimersByTime(1_500);
      await svc.getFields("a-*");
      expect(fieldCaps).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidate clears cache", async () => {
    const { client, fieldCaps } = mockClient(SAMPLE);
    const svc = new FieldCapsService(client);
    await svc.getFields("a-*");
    svc.invalidate("a-*");
    await svc.getFields("a-*");
    expect(fieldCaps).toHaveBeenCalledTimes(2);
  });
});
