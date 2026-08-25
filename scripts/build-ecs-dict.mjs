#!/usr/bin/env node
/**
 * Generate compact ECS field dictionaries from the official elastic/ecs
 * generated flat spec.
 *
 * Usage:
 *   node scripts/build-ecs-dict.mjs <ecs_flat.yml> <out.json> <ecsVersion>
 *
 * Regenerating (network required):
 *   curl -sL https://raw.githubusercontent.com/elastic/ecs/v9.5.0/generated/ecs/ecs_flat.yml -o /tmp/ecs_flat.yml
 *   node scripts/build-ecs-dict.mjs /tmp/ecs_flat.yml assets/ecs-9.json 9.5.0
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");

const [, , input, output, version] = process.argv;
if (!input || !output) {
  console.error("usage: build-ecs-dict.mjs <ecs_flat.yml> <out.json> <ecsVersion>");
  process.exit(1);
}

const flat = yaml.load(fs.readFileSync(input, "utf8"));

const fields = {};
for (const [name, def] of Object.entries(flat)) {
  const short = String(def.short ?? def.description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  fields[name] = {
    t: def.type ?? "keyword",
    d: short,
    ...(def.example !== undefined && def.example !== null
      ? { e: String(def.example).slice(0, 60) }
      : {}),
    ...(def.level === "core" ? { c: 1 } : {}),
  };
}

const out = { version: version ?? "unknown", count: Object.keys(fields).length, fields };
fs.writeFileSync(output, JSON.stringify(out));
console.log(`${output}: ${out.count} fields, ${(fs.statSync(output).size / 1024).toFixed(0)} KB`);
