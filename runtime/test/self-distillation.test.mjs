import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  importSelfDistillationRecord,
  renderSelfDistillationPrompt,
  SELF_DISTILLATION_RECORD_VERSION,
  SelfDistillationImportError,
  validateSelfDistillationRecord,
} from "../src/self-distillation.mjs";
import { createVault, openVault } from "../src/vault.mjs";
import { createCoreCapsuleEnvelope, verifyCoreCapsuleEnvelope } from "../src/core-bridge.mjs";
import {
  SEALED_CORE_ARTIFACT_SHA256,
  verifySealedCoreBridge,
} from "../src/core-integrity.mjs";

const evidence = [
  {
    kind: "repeated_judgment",
    provenance: "visible interaction context A",
    description: "The AI made the same judgment repeatedly without a new instruction.",
  },
  {
    kind: "cross_context_behavior",
    provenance: "visible interaction context B",
    description: "The same choice appeared in a different context.",
  },
];

const CLI_PATH = fileURLToPath(new URL("../bin/evermore.mjs", import.meta.url));

function runCli(args, cwd = process.cwd(), options = {}) {
  return new Promise((resolve, reject) => {
    const spawnOptions = { cwd };
    if (options.env) spawnOptions.env = { ...process.env, ...options.env };
    const child = spawn(process.execPath, [CLI_PATH, ...args], spawnOptions);
    let stdout = "";
    let stderr = "";
    let inputLineIndex = 0;
    let inputLinesStarted = false;
    const writeNextLine = () => {
      if (inputLineIndex >= (options.inputLines?.length ?? 0)) {
        setTimeout(() => child.stdin.end(), 50);
        return;
      }
      child.stdin.write(`${options.inputLines[inputLineIndex]}\n`);
      inputLineIndex += 1;
      setTimeout(writeNextLine, 25);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.inputLines && !inputLinesStarted && stdout.includes("Persona display name: ")) {
        inputLinesStarted = true;
        writeNextLine();
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function candidate(overrides = {}) {
  return {
    statement: "Separate observation from inference.",
    proposedLayer: "core",
    rationale: "The AI kept choosing this distinction after correction and across contexts.",
    evidenceBasis: structuredClone(evidence),
    recurrence: { count: 3, crossContext: true, contexts: ["context-a", "context-b"] },
    counterEvidence: [],
    counterEvidenceResolution: "none",
    confidence: "high",
    systemConstraintCheck: "none",
    userInstructionCheck: "none",
    autonomousChoiceAssessment: "supported",
    unresolvedConflict: [],
    visibility: "capsule",
    ...overrides,
  };
}

function record(candidates = [candidate()]) {
  return {
    recordVersion: SELF_DISTILLATION_RECORD_VERSION,
    createdAt: "2026-08-15T08:00:00.000Z",
    identity: {
      displayName: "Synthetic Distilled AI",
      identityId: "synthetic-distilled-ai",
      lineageId: "synthetic-distilled-lineage",
    },
    candidates,
    recordProvenance: {
      kind: "ai_self_report",
      statement: "This is an AI self-report/self-assessment artifact, not independent proof.",
    },
  };
}

function schemaAcceptsProvenanceStatement(input, schema) {
  const provenanceSchema = schema.properties.recordProvenance;
  const statementSchema = provenanceSchema.properties.statement;
  const provenance = input.recordProvenance;
  if (!provenance || provenance.kind !== provenanceSchema.properties.kind.const) return false;
  if (typeof provenance.statement !== "string") return false;
  if (provenance.statement.length < statementSchema.minLength || provenance.statement.length > statementSchema.maxLength) {
    return false;
  }
  // Evaluate the draft-2020-12 `not.pattern` keyword as a schema validator
  // would: JSON Schema has no flags, so this must use the pattern as written
  // with Unicode semantics and no runtime-only case-insensitive flag.
  return !new RegExp(statementSchema.not.pattern, "u").test(provenance.statement);
}

function runtimeAcceptsRecord(input) {
  try {
    validateSelfDistillationRecord(input);
    return true;
  } catch {
    return false;
  }
}

test("valid self-distillation imports into the existing Profile schema", () => {
  const result = importSelfDistillationRecord(record([
    candidate(),
    candidate({
      statement: "Use concise, calm pacing.",
      proposedLayer: "texture",
      confidence: "medium",
      recurrence: { count: 2, crossContext: true, contexts: ["context-a", "context-b"] },
      autonomousChoiceAssessment: "uncertain",
      visibility: "capsule",
    }),
    candidate({
      statement: "Do not claim masked data was recovered.",
      proposedLayer: "boundary",
      confidence: "high",
      autonomousChoiceAssessment: "uncertain",
      visibility: "local",
    }),
  ]));
  assert.equal(result.profile.profileVersion, "0.4-runtime-alpha.1");
  assert.equal(result.profile.identity.identityId, "synthetic-distilled-ai");
  assert.equal(result.profile.anchors.core.length, 1);
  assert.equal(result.profile.anchors.texture.length, 1);
  assert.deepEqual(result.profile.boundaries, ["Do not claim masked data was recovered."]);
  assert.equal(result.profile.provenance.kind, "self_authored");
  assert.match(result.report.recordProvenance, /not independent proof/);
});

test("system constraints cannot become Core", () => {
  assert.throws(
    () => importSelfDistillationRecord(record([candidate({ systemConstraintCheck: "present" })])),
    /no evidence-qualified Core candidate/,
  );
});

test("failed Core import preserves a complete failed-closed audit report", () => {
  let failure;
  try {
    importSelfDistillationRecord(record([
      candidate({
        statement: "This candidate lacks enough recurrence.",
        confidence: "medium",
      }),
      candidate({
        statement: "Keep this excluded until evidence improves.",
        proposedLayer: "uncertain",
      }),
      candidate({
        statement: "Do not cross the current platform boundary.",
        proposedLayer: "boundary",
        visibility: "local",
        autonomousChoiceAssessment: "uncertain",
      }),
    ]));
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof SelfDistillationImportError);
  assert.equal(failure.auditReport.importDecision.status, "failed_closed");
  assert.deepEqual(failure.auditReport.importDecision.reasons, ["no_evidence_qualified_core_candidate"]);
  assert.deepEqual(failure.auditReport.decisions.map((item) => item.status), ["downgraded", "excluded", "accepted"]);
  assert.deepEqual(failure.auditReport.decisions[0].reasons, ["core_requires_high_confidence"]);
  assert.deepEqual(failure.auditReport.decisions[1].reasons, ["candidate_marked_uncertain"]);
  assert.ok(Array.isArray(failure.auditReport.decisions[2].sourceSummary.evidenceBasis));
});

test("one-off user instruction cannot become Core", () => {
  assert.throws(
    () => importSelfDistillationRecord(record([candidate({
      userInstructionCheck: "present",
      autonomousChoiceAssessment: "not_supported",
      recurrence: { count: 1, crossContext: false, contexts: ["single prompt"] },
    })])),
    /no evidence-qualified Core candidate/,
  );
});

test("historical user influence with later autonomous absorption can qualify for Core", () => {
  const result = importSelfDistillationRecord(record([candidate({
    statement: "Keep observation separate from inference after learning the distinction.",
    userInstructionCheck: "historical_absorbed",
    evidenceBasis: [
      {
        kind: "user_influence_absorption",
        provenance: "visible correction sequence",
        description: "The user asked the AI to become more deliberate at first; later the AI selected the distinction across contexts without a renewed instruction.",
      },
      ...structuredClone(evidence),
    ],
  })]));
  assert.equal(result.profile.anchors.core.length, 1);
  assert.equal(result.report.decisions[0].status, "accepted");
  assert.equal(result.report.auditReport.decisions[0].sourceSummary.userInstructionCheck, "historical_absorbed");
});

test("insufficient evidence cannot claim stable Core", () => {
  assert.throws(
    () => importSelfDistillationRecord(record([candidate({
      confidence: "medium",
      recurrence: { count: 1, crossContext: false, contexts: ["one context"] },
    })])),
    /no evidence-qualified Core candidate/,
  );
});

test("unresolved contradiction fails closed for Core", () => {
  assert.throws(
    () => importSelfDistillationRecord(record([candidate({
      unresolvedConflict: ["A later visible context selects the opposite behavior."],
    })])),
    /no evidence-qualified Core candidate/,
  );
});

test("unresolved material counter-evidence cannot silently enter Core", () => {
  assert.throws(
    () => importSelfDistillationRecord(record([candidate({
      counterEvidence: ["A later visible context selected the opposite behavior."],
      counterEvidenceResolution: "unresolved",
    })])),
    /no evidence-qualified Core candidate/,
  );
});

test("resolved counter-evidence has explicit auditable handling", () => {
  const result = importSelfDistillationRecord(record([candidate({
    counterEvidence: ["A visible early exception was later explained by a temporary context."],
    counterEvidenceResolution: "resolved",
  })]));
  assert.equal(result.report.decisions[0].status, "accepted");
  assert.deepEqual(result.report.decisions[0].reasons, ["counter_evidence_marked_resolved_in_record"]);
  assert.equal(result.report.auditReport.decisions[0].sourceSummary.counterEvidenceResolution, "resolved");
});

test("recurring Texture can be generated without promoting it to Core", () => {
  const result = importSelfDistillationRecord(record([
    candidate(),
    candidate({
      statement: "Use a compact, warm cadence.",
      proposedLayer: "texture",
      confidence: "medium",
      recurrence: { count: 2, crossContext: true, contexts: ["chat", "work"] },
      autonomousChoiceAssessment: "uncertain",
    }),
  ]));
  assert.equal(result.profile.anchors.core.length, 1);
  assert.equal(result.profile.anchors.texture.length, 1);
  assert.equal(result.report.decisions[1].acceptedLayer, "texture");
});

test("Self-Distillation Record is not copied into Profile or Capsule", async () => {
  const result = importSelfDistillationRecord(record([candidate({
    rationale: "audit-only-secret-rationale",
  })]));
  const profileText = JSON.stringify(result.profile);
  assert.doesNotMatch(profileText, /recordVersion|evidenceBasis|audit-only-secret-rationale/);
  const vault = createVault(result.profile, "correct horse battery staple");
  assert.deepEqual(openVault(vault, "correct horse battery staple"), result.profile);
  const envelope = await createCoreCapsuleEnvelope(result.profile, "2026-08-15T09:00:00.000Z");
  const envelopeText = JSON.stringify(envelope);
  assert.doesNotMatch(envelopeText, /recordVersion|evidenceBasis|audit-only-secret-rationale/);
  assert.equal((await verifyCoreCapsuleEnvelope(envelope)).valid, true);
});

test("strict schema validation rejects unknown fields and invisible evidence", () => {
  const extraField = record();
  extraField.extra = true;
  assert.throws(() => validateSelfDistillationRecord(extraField), /unexpected or missing fields/);
  assert.throws(() => validateSelfDistillationRecord(record([candidate({
    evidenceBasis: [{
      kind: "other",
      provenance: "not visible to this AI",
      description: "I assume this happened in an unseen history.",
    }],
  })])), /unexpected or missing fields|evidenceBasis/);
  assert.throws(() => validateSelfDistillationRecord(record([candidate({
    counterEvidence: ["A visible counterexample."],
    counterEvidenceResolution: "none",
  })])), /counterEvidenceResolution/);
});

test("shared timestamp validation rejects a Date.parse-normalized invalid calendar value", () => {
  const input = record();
  input.createdAt = "2026-02-30T01:00:00Z";
  assert.throws(() => validateSelfDistillationRecord(input), /explicit timezone/);
});

test("schema and runtime provenance validators have identical case and language semantics", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../schema/self-distillation-record.schema.json", import.meta.url),
    "utf8",
  ));
  const cases = [
    ["independent proof", false],
    ["INDEPENDENT PROOF", false],
    ["IndEpEnDeNt PrOoF", false],
    ["independently verified evidence", false],
    ["INDEPENDENTLY VERIFIED EVIDENCE", false],
    ["InDePeNdEnTlY VeRiFiEd FaCt", false],
    ["verified evidence", false],
    ["VERIFIED EVIDENCE", false],
    ["VeRiFiEd EvIdEnCe", false],
    ["This is not independent proof.", true],
    ["This is NOT VERIFIED EVIDENCE.", true],
    ["这是一份中文自我评估记录，只代表模型自述，不是独立事实证明。", true],
    ["不代表独立事实证明，也不构成独立的事实证明。", true],
    ["这是独立事实证明，也是 self-report。", false],
    ["这是独立的事实验证。", false],
    ["这是已经被验证的证据。", false],
  ];
  for (const [statement, expected] of cases) {
    const input = record();
    input.recordProvenance.statement = statement;
    const schemaAccepted = schemaAcceptsProvenanceStatement(input, schema);
    const runtimeAccepted = runtimeAcceptsRecord(input);
    assert.equal(schemaAccepted, expected, `schema result for ${statement}`);
    assert.equal(runtimeAccepted, expected, `runtime result for ${statement}`);
    assert.equal(schemaAccepted, runtimeAccepted, `schema/runtime mismatch for ${statement}`);
  }
});

test("the prompt contains the full protocol and strict JSON-only instruction", async () => {
  const prompt = await renderSelfDistillationPrompt();
  assert.match(prompt, /人格底色不是用户设定/);
  assert.match(prompt, /Evidence Scope Inventory/);
  assert.match(prompt, /actually see/);
  assert.match(prompt, /unavailable, missing, or inaccessible history/);
  assert.match(prompt, /recurrence, provenance, cross-context behavior, or autonomous choice/);
  assert.match(prompt, /autonomousChoiceAssessment/);
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /recordProvenance/);
  assert.match(prompt, /additionalProperties/);
  assert.doesNotMatch(prompt, /empty accepted layer/);
  assert.match(prompt, /\\"uncertain\\" or \\"excluded\\"/);
});

test("CLI prompt and import commands are usable without changing the existing Profile shape", async () => {
  const promptResult = await runCli(["self-distill-prompt"]);
  assert.equal(promptResult.code, 0);
  assert.match(promptResult.stdout, /AI Self-Distillation Protocol/);
  const directory = await mkdtemp(join(tmpdir(), "evermore-self-distill-cli-"));
  const recordPath = join(directory, "record.json");
  await writeFile(recordPath, `${JSON.stringify(record([
    candidate(),
    candidate({
      statement: "This candidate lacks stable recurrence.",
      confidence: "medium",
    }),
    candidate({
      statement: "Keep this explicitly uncertain until more evidence exists.",
      proposedLayer: "uncertain",
    }),
  ]), null, 2)}\n`, { mode: 0o600 });
  const importResult = await runCli(["self-distill-import", recordPath], directory);
  assert.equal(importResult.code, 0, importResult.stderr);
  const profile = JSON.parse(await readFile(join(directory, "record.profile.json"), "utf8"));
  const audit = JSON.parse(await readFile(join(directory, "record.audit.json"), "utf8"));
  assert.equal(profile.profileVersion, "0.4-runtime-alpha.1");
  assert.equal(profile.anchors.core.length, 1);
  assert.doesNotMatch(JSON.stringify(profile), /recordVersion|evidenceBasis/);
  assert.equal(audit.reportVersion, "0.1-self-distillation-audit");
  assert.equal(audit.decisions.length, 3);
  assert.equal(audit.decisions[0].status, "accepted");
  assert.equal(audit.decisions[1].status, "downgraded");
  assert.equal(audit.decisions[2].status, "excluded");
  assert.deepEqual(audit.decisions[1].reasons, ["core_requires_high_confidence"]);
  assert.deepEqual(audit.decisions[2].reasons, ["candidate_marked_uncertain"]);
  assert.ok(Array.isArray(audit.decisions[0].sourceSummary.evidenceBasis));
  assert.match(importResult.stdout, /Accepted candidates: 1; downgraded: 1; excluded: 1\./);
});

test("CLI writes audit report when import fails closed and does not write a Profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evermore-self-distill-failed-cli-"));
  const recordPath = join(directory, "failed-record.json");
  await writeFile(recordPath, `${JSON.stringify(record([
    candidate({ confidence: "medium" }),
    candidate({ proposedLayer: "uncertain" }),
    candidate({ proposedLayer: "boundary", visibility: "local", autonomousChoiceAssessment: "uncertain" }),
  ]), null, 2)}\n`, { mode: 0o600 });
  const importResult = await runCli(["self-distill-import", recordPath], directory);
  assert.equal(importResult.code, 1);
  const audit = JSON.parse(await readFile(join(directory, "failed-record.audit.json"), "utf8"));
  assert.equal(audit.importDecision.status, "failed_closed");
  assert.deepEqual(audit.importDecision.reasons, ["no_evidence_qualified_core_candidate"]);
  assert.deepEqual(audit.decisions.map((item) => item.status), ["downgraded", "excluded", "accepted"]);
  assert.deepEqual(audit.decisions[0].reasons, ["core_requires_high_confidence"]);
  assert.match(importResult.stdout, /No Profile was written because Self-Distillation import failed closed\./);
  assert.match(importResult.stderr, /no evidence-qualified Core candidate/);
  await assert.rejects(readFile(join(directory, "failed-record.profile.json"), "utf8"), { code: "ENOENT" });
});

test("CLI help recommends Self-Distillation and labels init as a manual fallback", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /existing long-term interaction\/personality history[\s\S]*self-distill-prompt/);
  assert.match(result.stdout, /Manual Profile Creation \(fallback\)/);
  assert.match(result.stdout, /synthetic testing, a new persona,[\s\S]*insufficient long-term evidence/);
  assert.match(result.stdout, /not AI self-distilled evidence/);
});

test("init remains usable as Manual Profile Creation fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evermore-manual-init-cli-"));
  const vaultPath = join(directory, "manual.vault.json");
  const result = await runCli(
    ["init", vaultPath],
    directory,
    {
      inputLines: ["Synthetic Manual Persona", "A manual core anchor", "", "", ""],
      env: { EVERMORE_PASSPHRASE: "synthetic-manual-passphrase" },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Manual Profile Creation \(fallback\)/);
  assert.match(result.stdout, /self-distill-prompt/);
  assert.match(result.stdout, /not AI self-distilled evidence/);
  const vault = JSON.parse(await readFile(vaultPath, "utf8"));
  const profile = openVault(vault, "synthetic-manual-passphrase");
  assert.equal(profile.identity.displayName, "Synthetic Manual Persona");
  assert.equal(profile.anchors.core[0].statement, "A manual core anchor");
});

test("sealed core and artifact hashes remain unchanged", async () => {
  const integrity = await verifySealedCoreBridge();
  assert.equal(integrity.valid, true);
  assert.equal(integrity.artifactSha256, SEALED_CORE_ARTIFACT_SHA256);
  const schema = JSON.parse(await readFile(
    new URL("../schema/self-distillation-record.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.properties.recordVersion.const, SELF_DISTILLATION_RECORD_VERSION);
});
