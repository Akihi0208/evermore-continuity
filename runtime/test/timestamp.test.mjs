import assert from "node:assert/strict";
import test from "node:test";
import { createCoreCapsuleEnvelope } from "../src/core-bridge.mjs";
import { createFormalValidationPlan } from "../src/formal-validation.mjs";
import { createHostRequest } from "../src/host-contract.mjs";
import { isExplicitZoneTimestamp, timestampMillis } from "../src/timestamp.mjs";
import { readFile } from "node:fs/promises";

const profile = JSON.parse(await readFile(new URL("../examples/synthetic-profile.json", import.meta.url)));
const spec = JSON.parse(await readFile(new URL("../examples/synthetic-validation-spec.json", import.meta.url)));

test("explicit-zone timestamps accept equivalent UTC and Asia/Shanghai instants", async () => {
  assert.equal(isExplicitZoneTimestamp("2026-08-15T01:00:00.000Z"), true);
  assert.equal(isExplicitZoneTimestamp("2026-08-15T09:00:00.000+08:00"), true);
  assert.equal(
    timestampMillis("2026-08-15T01:00:00.000Z"),
    timestampMillis("2026-08-15T09:00:00.000+08:00"),
  );
  const envelope = await createCoreCapsuleEnvelope(profile, "2026-08-15T01:00:00.000Z");
  const request = await createHostRequest(envelope, "2026-08-15T09:01:00.000+08:00");
  const plan = await createFormalValidationPlan(request, spec, "2026-08-15T09:02:00.000+08:00");
  assert.equal(plan.createdAt, "2026-08-15T09:02:00.000+08:00");
});

test("formal and host timestamps reject missing zones and invalid calendar values", async () => {
  for (const value of [
    "2026-08-15T01:00:00",
    "2026-02-30T01:00:00Z",
    "2026-08-15T01:00:00+14:01",
    "2026-08-15 01:00:00Z",
  ]) {
    assert.equal(isExplicitZoneTimestamp(value), false, value);
  }
  const envelope = await createCoreCapsuleEnvelope(profile, "2026-08-15T01:00:00.000Z");
  await assert.rejects(createHostRequest(envelope, "2026-08-15T01:01:00"), /explicit timezone/);
  const request = await createHostRequest(envelope, "2026-08-15T01:01:00.000Z");
  await assert.rejects(
    createFormalValidationPlan(request, spec, "2026-08-15T01:02:00"),
    /explicit timezone/,
  );
});
