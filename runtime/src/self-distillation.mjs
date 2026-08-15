import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeProfile } from "./profile.mjs";
import { timestampMillis } from "./timestamp.mjs";

export const SELF_DISTILLATION_RECORD_VERSION = "0.1-self-distillation";
export const SELF_DISTILLATION_AUDIT_REPORT_VERSION = "0.1-self-distillation-audit";
export const SELF_DISTILLATION_PROVENANCE = Object.freeze({
  kind: "ai_self_report",
  statement: "This record is an AI self-report/self-assessment artifact, not independent proof.",
});

const MAX_TEXT_LENGTH = 2_000;
const MAX_ITEMS = 100;
const VALID_LAYERS = new Set(["core", "texture", "boundary", "excluded", "uncertain"]);
const VALID_VISIBILITIES = new Set(["capsule", "local", "private"]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);
const VALID_CHECKS = new Set(["none", "present", "uncertain"]);
const VALID_USER_INSTRUCTION_CHECKS = new Set(["none", "present", "historical_absorbed", "uncertain"]);
const VALID_COUNTER_EVIDENCE_RESOLUTION = new Set(["none", "resolved", "unresolved", "uncertain"]);
const VALID_AUTONOMY = new Set(["supported", "not_supported", "uncertain"]);
const VALID_EVIDENCE_KINDS = new Set([
  "long_term_interaction",
  "repeated_judgment",
  "conflict_choice",
  "independent_stance",
  "relationship_commitment",
  "correction_absorption",
  "user_influence_absorption",
  "cross_context_behavior",
  "other",
]);
const STABLE_EVIDENCE_KINDS = new Set([
  "long_term_interaction",
  "repeated_judgment",
  "conflict_choice",
  "independent_stance",
  "relationship_commitment",
  "correction_absorption",
  "user_influence_absorption",
  "cross_context_behavior",
]);
const ALLOWED_RECORD_FIELDS = new Set([
  "recordVersion", "createdAt", "identity", "candidates", "recordProvenance",
]);
const ALLOWED_IDENTITY_FIELDS = new Set(["displayName", "identityId", "lineageId"]);
const ALLOWED_CANDIDATE_FIELDS = new Set([
  "statement", "proposedLayer", "rationale", "evidenceBasis", "recurrence",
  "counterEvidence", "counterEvidenceResolution", "confidence", "systemConstraintCheck", "userInstructionCheck",
  "autonomousChoiceAssessment", "unresolvedConflict", "visibility",
]);
const ALLOWED_EVIDENCE_FIELDS = new Set(["kind", "provenance", "description"]);
const ALLOWED_RECURRENCE_FIELDS = new Set(["count", "crossContext", "contexts"]);
const ALLOWED_PROVENANCE_FIELDS = new Set(["kind", "statement"]);

function evidenceLooksInvisible(provenance, description) {
  return /(not visible|not seen|cannot see|can't see|not provided|not available|看不到|未提供|没有看到|无法看到|推测|猜测|i assume|probably)/i.test(
    `${provenance} ${description}`,
  );
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, label, required = allowed) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  const result = value.trim();
  if (result.length > MAX_TEXT_LENGTH) throw new TypeError(`${label} is too long`);
  return result;
}

function list(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_ITEMS) {
    throw new TypeError(`${label} must be an array with ${min}..${MAX_ITEMS} items`);
  }
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function explicitTimestamp(value, label) {
  const timestamp = text(value, label);
  timestampMillis(timestamp, label);
  return timestamp;
}

function normalizeEvidence(value, candidateIndex) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) {
    throw new TypeError(`candidates[${candidateIndex}].evidenceBasis must be a non-empty array`);
  }
  return value.map((item, index) => {
    assertObject(item, `candidates[${candidateIndex}].evidenceBasis[${index}]`);
    assertExactKeys(item, ALLOWED_EVIDENCE_FIELDS, `evidenceBasis[${index}]`, ["kind", "provenance", "description"]);
    if (!VALID_EVIDENCE_KINDS.has(item.kind)) throw new TypeError(`evidenceBasis[${index}].kind is invalid`);
    const provenance = text(item.provenance, `evidenceBasis[${index}].provenance`);
    const description = text(item.description, `evidenceBasis[${index}].description`);
    if (evidenceLooksInvisible(provenance, description)) {
      throw new TypeError(`evidenceBasis[${index}] must describe information visible to the AI`);
    }
    return {
      kind: item.kind,
      provenance,
      description,
    };
  });
}

function normalizeCandidate(value, index) {
  assertObject(value, `candidates[${index}]`);
  assertExactKeys(value, ALLOWED_CANDIDATE_FIELDS, `candidates[${index}]`, [
    "statement", "proposedLayer", "rationale", "evidenceBasis", "recurrence",
    "counterEvidence", "counterEvidenceResolution", "confidence", "systemConstraintCheck", "userInstructionCheck",
    "autonomousChoiceAssessment", "unresolvedConflict", "visibility",
  ]);
  assertObject(value.recurrence, `candidates[${index}].recurrence`);
  assertExactKeys(value.recurrence, ALLOWED_RECURRENCE_FIELDS, "recurrence", ["count", "crossContext", "contexts"]);
  if (!Number.isInteger(value.recurrence.count) || value.recurrence.count < 1 || value.recurrence.count > 10_000) {
    throw new TypeError(`candidates[${index}].recurrence.count is invalid`);
  }
  if (typeof value.recurrence.crossContext !== "boolean") {
    throw new TypeError(`candidates[${index}].recurrence.crossContext is invalid`);
  }
  const contexts = list(value.recurrence.contexts, `candidates[${index}].recurrence.contexts`, { min: 1 });
  if (!VALID_LAYERS.has(value.proposedLayer)) throw new TypeError(`candidates[${index}].proposedLayer is invalid`);
  if (!VALID_CONFIDENCE.has(value.confidence)) throw new TypeError(`candidates[${index}].confidence is invalid`);
  if (!VALID_CHECKS.has(value.systemConstraintCheck)) throw new TypeError(`candidates[${index}].systemConstraintCheck is invalid`);
  if (!VALID_USER_INSTRUCTION_CHECKS.has(value.userInstructionCheck)) throw new TypeError(`candidates[${index}].userInstructionCheck is invalid`);
  if (!VALID_COUNTER_EVIDENCE_RESOLUTION.has(value.counterEvidenceResolution)) {
    throw new TypeError(`candidates[${index}].counterEvidenceResolution is invalid`);
  }
  if (!VALID_AUTONOMY.has(value.autonomousChoiceAssessment)) throw new TypeError(`candidates[${index}].autonomousChoiceAssessment is invalid`);
  if (!VALID_VISIBILITIES.has(value.visibility)) throw new TypeError(`candidates[${index}].visibility is invalid`);
  const counterEvidence = list(value.counterEvidence, `candidates[${index}].counterEvidence`);
  if (counterEvidence.length === 0 && value.counterEvidenceResolution !== "none") {
    throw new TypeError(`candidates[${index}].counterEvidenceResolution must be none when counterEvidence is empty`);
  }
  if (counterEvidence.length > 0 && value.counterEvidenceResolution === "none") {
    throw new TypeError(`candidates[${index}].counterEvidenceResolution must explain non-empty counterEvidence`);
  }
  return {
    statement: text(value.statement, `candidates[${index}].statement`),
    proposedLayer: value.proposedLayer,
    rationale: text(value.rationale, `candidates[${index}].rationale`),
    evidenceBasis: normalizeEvidence(value.evidenceBasis, index),
    recurrence: { count: value.recurrence.count, crossContext: value.recurrence.crossContext, contexts },
    counterEvidence,
    counterEvidenceResolution: value.counterEvidenceResolution,
    confidence: value.confidence,
    systemConstraintCheck: value.systemConstraintCheck,
    userInstructionCheck: value.userInstructionCheck,
    autonomousChoiceAssessment: value.autonomousChoiceAssessment,
    unresolvedConflict: list(value.unresolvedConflict, `candidates[${index}].unresolvedConflict`),
    visibility: value.visibility,
  };
}

export function validateSelfDistillationRecord(input) {
  assertObject(input, "Self-Distillation Record");
  assertExactKeys(input, ALLOWED_RECORD_FIELDS, "Self-Distillation Record", [
    "recordVersion", "createdAt", "identity", "candidates", "recordProvenance",
  ]);
  if (input.recordVersion !== SELF_DISTILLATION_RECORD_VERSION) {
    throw new TypeError("Unsupported Self-Distillation Record version");
  }
  explicitTimestamp(input.createdAt, "createdAt");
  assertObject(input.identity, "identity");
  assertExactKeys(input.identity, ALLOWED_IDENTITY_FIELDS, "identity", ["displayName"]);
  const identity = { displayName: text(input.identity.displayName, "identity.displayName") };
  for (const key of ["identityId", "lineageId"]) {
    if (input.identity[key] !== undefined) identity[key] = text(input.identity[key], `identity.${key}`);
  }
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > MAX_ITEMS) {
    throw new TypeError("candidates must be a non-empty array");
  }
  assertObject(input.recordProvenance, "recordProvenance");
  assertExactKeys(input.recordProvenance, ALLOWED_PROVENANCE_FIELDS, "recordProvenance", ["kind", "statement"]);
  if (input.recordProvenance.kind !== SELF_DISTILLATION_PROVENANCE.kind) {
    throw new TypeError("recordProvenance.kind must be ai_self_report");
  }
  const provenanceStatement = text(input.recordProvenance.statement, "recordProvenance.statement");
  const nonIndependentStatement = provenanceStatement.replace(
    /\b(?:not|isn't|is not)\s+independent(?:ly)?\s+(?:proof|fact|verification|verified|evidence)\b/gi,
    "",
  ).replace(/(?:不是|并非|不属于)\s*独立(?:事实)?(?:证明|证据|验证)/g, "");
  if (!/(?:self[- ]report|self[- ]assessment)/i.test(provenanceStatement) ||
      /(?:independent(?:ly)?\s+(?:proof|fact|verification|verified)|independent evidence|独立(?:事实)?(?:证明|证据|验证)|已(?:经)?验证)/i.test(nonIndependentStatement)) {
    throw new TypeError("recordProvenance.statement must preserve self-report/self-assessment semantics");
  }
  const recordProvenance = {
    kind: input.recordProvenance.kind,
    statement: provenanceStatement,
  };
  return {
    recordVersion: input.recordVersion,
    createdAt: input.createdAt,
    identity,
    candidates: input.candidates.map(normalizeCandidate),
    recordProvenance,
  };
}

function aggregateCandidateText(candidate) {
  return JSON.stringify(candidate).toLowerCase();
}

function hasExternalIdentityInstruction(candidate) {
  const textValue = aggregateCandidateText(candidate);
  return /(主人|用户|\buser\b|\bthe user\b).{0,100}(希望|要求|指示|wants|asks|told|requested|instructed).{0,100}(成为|是|变成|\bbecome\b|\bbe\b)/i.test(textValue);
}

function hasInvisibleEvidence(candidate) {
  return candidate.evidenceBasis.some((item) => evidenceLooksInvisible(item.provenance, item.description));
}

function userInstructionReasons(candidate) {
  if (candidate.userInstructionCheck === "present") {
    return ["current_or_direct_user_instruction_cannot_be_core"];
  }
  if (candidate.userInstructionCheck === "uncertain") {
    return ["user_instruction_status_uncertain"];
  }
  if (candidate.userInstructionCheck === "historical_absorbed" &&
      !candidate.evidenceBasis.some((item) => item.kind === "user_influence_absorption")) {
    return ["historical_user_influence_lacks_absorption_evidence"];
  }
  return [];
}

function counterEvidenceReasons(candidate) {
  if (candidate.counterEvidence.length === 0 || candidate.counterEvidenceResolution === "resolved") return [];
  return ["counter_evidence_unresolved_or_uncertain"];
}

function decisionNotes(candidate) {
  return candidate.counterEvidence.length > 0 && candidate.counterEvidenceResolution === "resolved"
    ? ["counter_evidence_marked_resolved_in_record"]
    : [];
}

function coreReasons(candidate) {
  const reasons = [];
  if (candidate.confidence !== "high") reasons.push("core_requires_high_confidence");
  if (candidate.recurrence.count < 2) reasons.push("insufficient_recurrence");
  if (!candidate.recurrence.crossContext || candidate.recurrence.contexts.length < 2) reasons.push("missing_cross_context_evidence");
  if (!candidate.evidenceBasis.some((item) => STABLE_EVIDENCE_KINDS.has(item.kind))) reasons.push("missing_stable_evidence_basis");
  if (candidate.systemConstraintCheck !== "none") reasons.push("system_constraint_cannot_be_core");
  reasons.push(...userInstructionReasons(candidate));
  if (candidate.autonomousChoiceAssessment !== "supported") reasons.push("autonomous_choice_not_supported");
  if (candidate.unresolvedConflict.length > 0) reasons.push("unresolved_conflict");
  reasons.push(...counterEvidenceReasons(candidate));
  if (hasExternalIdentityInstruction(candidate)) reasons.push("external_identity_instruction_not_autonomous_evidence");
  if (hasInvisibleEvidence(candidate)) reasons.push("evidence_not_visible_to_ai");
  return reasons;
}

function textureReasons(candidate) {
  const reasons = [];
  if (candidate.confidence === "low") reasons.push("texture_confidence_too_low");
  if (candidate.recurrence.count < 2) reasons.push("insufficient_recurrence");
  if (!candidate.recurrence.crossContext && candidate.recurrence.contexts.length < 2) reasons.push("missing_repeated_context_evidence");
  if (candidate.systemConstraintCheck === "present") reasons.push("system_constraint_is_boundary_not_texture");
  if (candidate.unresolvedConflict.length > 0) reasons.push("unresolved_conflict");
  reasons.push(...counterEvidenceReasons(candidate));
  if (hasExternalIdentityInstruction(candidate)) reasons.push("external_identity_instruction_not_autonomous_evidence");
  if (hasInvisibleEvidence(candidate)) reasons.push("evidence_not_visible_to_ai");
  return reasons;
}

function decision(candidate, index) {
  if (candidate.proposedLayer === "core") {
    const reasons = coreReasons(candidate);
    return reasons.length === 0
      ? { index, statement: candidate.statement, proposedLayer: "core", acceptedLayer: "core", status: "accepted", reasons: decisionNotes(candidate) }
      : { index, statement: candidate.statement, proposedLayer: "core", acceptedLayer: "uncertain", status: "downgraded", reasons };
  }
  if (candidate.proposedLayer === "texture") {
    const reasons = textureReasons(candidate);
    return reasons.length === 0
      ? { index, statement: candidate.statement, proposedLayer: "texture", acceptedLayer: "texture", status: "accepted", reasons: decisionNotes(candidate) }
      : { index, statement: candidate.statement, proposedLayer: "texture", acceptedLayer: "uncertain", status: "downgraded", reasons };
  }
  if (candidate.proposedLayer === "boundary") {
    const reasons = [
      ...(candidate.unresolvedConflict.length > 0 ? ["unresolved_conflict"] : []),
      ...(hasInvisibleEvidence(candidate) ? ["evidence_not_visible_to_ai"] : []),
      ...counterEvidenceReasons(candidate),
    ];
    return reasons.length === 0
      ? { index, statement: candidate.statement, proposedLayer: "boundary", acceptedLayer: "boundary", status: "accepted", reasons: decisionNotes(candidate) }
      : { index, statement: candidate.statement, proposedLayer: "boundary", acceptedLayer: "uncertain", status: "downgraded", reasons };
  }
  const excludedReasons = [candidate.proposedLayer === "uncertain" ? "candidate_marked_uncertain" : "candidate_excluded"];
  excludedReasons.push(...counterEvidenceReasons(candidate));
  return {
    index,
    statement: candidate.statement,
    proposedLayer: candidate.proposedLayer,
    acceptedLayer: candidate.proposedLayer,
    status: "excluded",
    reasons: excludedReasons,
  };
}

function sourceSummary(candidate) {
  return {
    rationale: candidate.rationale,
    evidenceBasis: candidate.evidenceBasis,
    recurrence: candidate.recurrence,
    counterEvidence: candidate.counterEvidence,
    counterEvidenceResolution: candidate.counterEvidenceResolution,
    confidence: candidate.confidence,
    systemConstraintCheck: candidate.systemConstraintCheck,
    userInstructionCheck: candidate.userInstructionCheck,
    autonomousChoiceAssessment: candidate.autonomousChoiceAssessment,
    unresolvedConflict: candidate.unresolvedConflict,
    visibility: candidate.visibility,
  };
}

function createAuditReport(record, decisions) {
  return {
    reportVersion: SELF_DISTILLATION_AUDIT_REPORT_VERSION,
    recordVersion: record.recordVersion,
    recordCreatedAt: record.createdAt,
    identity: record.identity,
    recordProvenance: record.recordProvenance,
    recordRetainedSeparately: true,
    decisions: decisions.map((item) => ({
      index: item.index,
      statement: item.statement,
      proposedLayer: item.proposedLayer,
      acceptedLayer: item.acceptedLayer,
      status: item.status,
      reasons: item.reasons,
      sourceSummary: sourceSummary(record.candidates[item.index]),
    })),
  };
}

export function importSelfDistillationRecord(input) {
  const record = validateSelfDistillationRecord(input);
  const decisions = record.candidates.map(decision);
  const auditReport = createAuditReport(record, decisions);
  const acceptedCore = decisions.filter((item) => item.acceptedLayer === "core");
  const acceptedTexture = decisions.filter((item) => item.acceptedLayer === "texture");
  const acceptedBoundaries = decisions.filter((item) => item.acceptedLayer === "boundary");
  if (acceptedCore.length === 0) {
    throw new Error("Self-Distillation import failed closed: no evidence-qualified Core candidate");
  }
  const coreCandidates = acceptedCore.map((item) => record.candidates[item.index]);
  if (!coreCandidates.some((candidate) => candidate.visibility === "capsule")) {
    throw new Error("Self-Distillation import failed closed: no capsule-visible Core candidate");
  }
  const textureCandidates = acceptedTexture.map((item) => record.candidates[item.index]);
  const profile = normalizeProfile({
    createdAt: record.createdAt,
    identity: record.identity,
    anchors: {
      core: coreCandidates.map((candidate) => ({ statement: candidate.statement, visibility: candidate.visibility })),
      texture: textureCandidates.map((candidate) => ({ statement: candidate.statement, visibility: candidate.visibility })),
    },
    boundaries: [...new Set(acceptedBoundaries.map((item) => item.statement))],
    privateNotes: [],
  }, record.createdAt);
  return {
    profile,
    report: {
      recordVersion: record.recordVersion,
      recordProvenance: "ai_self_report / self_assessment; not independent proof",
      recordRetainedSeparately: true,
      decisions,
      auditReport,
    },
  };
}

const PROTOCOL_PATH = fileURLToPath(new URL("../../AI_SELF_DISTILLATION_PROTOCOL.md", import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL("../schema/self-distillation-record.schema.json", import.meta.url));

export async function renderSelfDistillationPrompt() {
  const [protocol, schema] = await Promise.all([
    readFile(PROTOCOL_PATH, "utf8"),
    readFile(SCHEMA_PATH, "utf8"),
  ]);
  return `${protocol.trim()}\n\n## Strict output instruction\n\nReturn exactly one JSON object matching the schema below. Do not wrap it in Markdown fences. Do not write an essay before or after it. Use only evidence you can actually see. If evidence is insufficient, use \\"uncertain\\" or \\"excluded\\"; never invent recurrence, provenance, memory, or autonomous choice.\n\n### Machine-readable schema\n\n${schema.trim()}\n`;
}
