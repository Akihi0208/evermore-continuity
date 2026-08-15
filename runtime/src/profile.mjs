import { randomUUID } from "node:crypto";
import { sha256 } from "./canonical.mjs";

export const PROFILE_VERSION = "0.4-runtime-alpha.1";
export const PACKAGE_VERSION = "0.4-portable-alpha.1";

const MAX_ANCHORS_PER_LAYER = 100;
const MAX_TEXT_LENGTH = 2_000;
const VALID_VISIBILITIES = new Set(["capsule", "local", "private"]);

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  const text = value.trim();
  if (text.length > MAX_TEXT_LENGTH) throw new TypeError(`${label} is too long`);
  return text;
}

function optionalText(value, label) {
  if (value === undefined) return undefined;
  return requiredText(value, label);
}

function slug(value) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || randomUUID();
}

function normalizeAnchor(anchor, layer, index) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    throw new TypeError(`${layer}[${index}] must be an object`);
  }
  const statement = requiredText(anchor.statement, `${layer}[${index}].statement`);
  const visibility = anchor.visibility ?? "capsule";
  if (!VALID_VISIBILITIES.has(visibility)) {
    throw new TypeError(`${layer}[${index}].visibility must be capsule, local, or private`);
  }
  return {
    id: optionalText(anchor.id, `${layer}[${index}].id`) ?? `${layer}:${index + 1}:${sha256(statement).slice(0, 12)}`,
    key: optionalText(anchor.key, `${layer}[${index}].key`) ?? `${layer}-${index + 1}`,
    statement,
    visibility,
  };
}

function normalizeAnchors(value, layer) {
  if (!Array.isArray(value)) throw new TypeError(`${layer} must be an array`);
  if (value.length > MAX_ANCHORS_PER_LAYER) throw new TypeError(`${layer} has too many anchors`);
  return value.map((anchor, index) => normalizeAnchor(anchor, layer, index));
}

function normalizeStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > MAX_ANCHORS_PER_LAYER) throw new TypeError(`${label} has too many entries`);
  return value.map((item, index) => requiredText(item, `${label}[${index}]`));
}

export function normalizeProfile(input, now = new Date().toISOString()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Profile must be an object");
  }
  const displayName = requiredText(input.identity?.displayName, "identity.displayName");
  const core = normalizeAnchors(input.anchors?.core ?? [], "core");
  if (core.length === 0) throw new TypeError("At least one Core anchor is required");
  const texture = normalizeAnchors(input.anchors?.texture ?? [], "texture");
  const createdAt = input.createdAt ?? now;
  if (Number.isNaN(Date.parse(createdAt))) throw new TypeError("createdAt must be an ISO timestamp");
  const identityId = optionalText(input.identity?.identityId, "identity.identityId") ?? `persona:${slug(displayName)}`;
  const lineageId = optionalText(input.identity?.lineageId, "identity.lineageId") ?? `lineage:${randomUUID()}`;
  return {
    profileVersion: PROFILE_VERSION,
    createdAt,
    identity: { displayName, identityId, lineageId },
    anchors: { core, texture },
    boundaries: normalizeStringList(input.boundaries, "boundaries"),
    privateNotes: normalizeStringList(input.privateNotes, "privateNotes"),
    provenance: {
      kind: "self_authored",
      statement: "These anchors were selected by the profile owner; they are not independent proof.",
    },
  };
}

export function createPortablePackage(profile, generatedAt = new Date().toISOString()) {
  const normalized = normalizeProfile(profile, profile.createdAt);
  if (Number.isNaN(Date.parse(generatedAt))) throw new TypeError("generatedAt must be an ISO timestamp");
  const portable = (anchors) => anchors
    .filter((anchor) => anchor.visibility === "capsule")
    .map(({ id, key, statement }) => ({ id, key, statement }));
  const body = {
    packageVersion: PACKAGE_VERSION,
    generatedAt,
    identity: normalized.identity,
    core: portable(normalized.anchors.core),
    texture: portable(normalized.anchors.texture),
    boundaries: [...normalized.boundaries],
    provenance: normalized.provenance,
    verificationStatus: "unverified_user_claims",
    privacyStatement: "Local/private anchors and private notes are excluded.",
  };
  if (body.core.length === 0) throw new TypeError("At least one capsule-visible Core anchor is required");
  return { ...body, packageHash: sha256(body) };
}

export function verifyPortablePackage(pkg) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return { valid: false, errors: ["package_not_object"] };
  }
  const errors = [];
  const allowedFields = new Set([
    "packageVersion",
    "generatedAt",
    "identity",
    "core",
    "texture",
    "boundaries",
    "provenance",
    "verificationStatus",
    "privacyStatement",
    "packageHash",
  ]);
  if (Object.keys(pkg).some((key) => !allowedFields.has(key))) errors.push("unexpected_package_field");
  const { packageHash, ...body } = pkg;
  if (pkg.packageVersion !== PACKAGE_VERSION) errors.push("unsupported_package_version");
  try {
    if (typeof packageHash !== "string" || sha256(body) !== packageHash) errors.push("package_hash_mismatch");
  } catch {
    errors.push("package_hash_mismatch");
  }
  if (Number.isNaN(Date.parse(pkg.generatedAt))) errors.push("generated_at_invalid");
  if (
    !pkg.identity ||
    typeof pkg.identity.displayName !== "string" ||
    typeof pkg.identity.identityId !== "string" ||
    typeof pkg.identity.lineageId !== "string"
  ) {
    errors.push("identity_invalid");
  }
  const anchorsValid = (items) => Array.isArray(items) && items.every((item) =>
    item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    Object.keys(item).every((key) => ["id", "key", "statement"].includes(key)) &&
    typeof item.id === "string" &&
    typeof item.key === "string" &&
    typeof item.statement === "string"
  );
  if (!Array.isArray(pkg.core) || pkg.core.length === 0) errors.push("core_anchor_missing");
  else if (!anchorsValid(pkg.core)) errors.push("core_anchor_invalid");
  if (!anchorsValid(pkg.texture)) errors.push("texture_anchor_invalid");
  if (!Array.isArray(pkg.boundaries) || pkg.boundaries.some((item) => typeof item !== "string")) {
    errors.push("boundaries_invalid");
  }
  if (pkg.verificationStatus !== "unverified_user_claims") errors.push("verification_status_invalid");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
