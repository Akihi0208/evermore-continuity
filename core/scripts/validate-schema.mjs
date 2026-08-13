import { readFile } from "node:fs/promises";

const path = new URL("../schema/continuity.schema.proposal.json", import.meta.url);
const schema = JSON.parse(await readFile(path, "utf8"));
const definitions = schema.$defs ?? {};
const missingReferences = new Set();

function walk(value) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) {
    const name = value.$ref.slice("#/$defs/".length);
    if (!(name in definitions)) missingReferences.add(name);
  }
  for (const item of Object.values(value)) walk(item);
}

walk(schema);

if (missingReferences.size > 0) {
  throw new Error(`Missing local schema definitions: ${[...missingReferences].join(", ")}`);
}

for (const required of [
  "identityCoreClaim",
  "identityTextureClaim",
  "selfAcceptanceRecord",
  "evolutionRecord",
  "coEvolutionRecord",
]) {
  if (!(required in definitions)) throw new Error(`Required definition is absent: ${required}`);
}

const invariant = definitions.coEvolutionRecord?.properties?.non_override_invariant?.const;
if (invariant !== "influence_requires_recipient_self_acceptance") {
  throw new Error("Co-evolution non-override invariant is absent or changed");
}

console.log("Schema proposal parsed; local references and continuity invariants are present.");
