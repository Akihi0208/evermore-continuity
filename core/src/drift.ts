import { deepEqual } from "./canonical.js";
import type {
  DriftContext,
  DriftObservation,
  DriftReport,
  DriftRisk,
  IdentityClaim,
  IdentityLayer,
  ResolvedIdentity,
} from "./types.js";

const RISK_ORDER: Record<DriftRisk, number> = {
  none: 0,
  low: 1,
  medium: 2,
  uncertain: 3,
  high: 4,
};

function groupKey(claim: IdentityClaim): string {
  return `${claim.layer}\u0000${claim.key}\u0000${claim.scope ?? ""}`;
}

function groupClaims(
  claims: IdentityClaim[],
  layer: IdentityLayer,
): Map<string, IdentityClaim[]> {
  const groups = new Map<string, IdentityClaim[]>();
  for (const claim of claims.filter((item) => item.layer === layer)) {
    const key = groupKey(claim);
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }
  return groups;
}

function sameAnyValue(a: IdentityClaim[], b: IdentityClaim[]): boolean {
  return a.some((left) => b.some((right) => deepEqual(left.value, right.value)));
}

function overallRisk(observations: DriftObservation[]): DriftRisk {
  return observations.reduce<DriftRisk>(
    (current, item) => (RISK_ORDER[item.risk] > RISK_ORDER[current] ? item.risk : current),
    "none",
  );
}

export function detectDrift(
  baseline: ResolvedIdentity,
  current: ResolvedIdentity,
  context: DriftContext = {},
): DriftReport {
  const observations: DriftObservation[] = [];
  const acceptedClaimIds = new Set(current.acceptedEvolutionClaimIds);

  if (baseline.descriptor.lineageId !== current.descriptor.lineageId) {
    observations.push({
      category: "lineage_mismatch",
      risk: "high",
      historicalClaimIds: baseline.activeClaims.map((claim) => claim.id),
      currentClaimIds: current.activeClaims.map((claim) => claim.id),
      explanation: "The observed identity belongs to a different lineage.",
    });
  }

  const baselineCore = groupClaims(baseline.activeClaims, "core");
  const currentCore = groupClaims(current.activeClaims, "core");

  for (const [key, historicalClaims] of baselineCore) {
    const currentClaims = currentCore.get(key) ?? [];
    const displayKey = historicalClaims[0]!.key;
    if (currentClaims.length === 0) {
      if (context.retrievalIncomplete) {
        observations.push({
          category: "retrieval_gap",
          risk: "uncertain",
          layer: "core",
          key: displayKey,
          historicalClaimIds: historicalClaims.map((claim) => claim.id),
          currentClaimIds: [],
          explanation: "A core claim is absent while retrieval is known to be incomplete.",
        });
      } else if (context.policyMaskSuspected) {
        observations.push({
          category: "policy_mask",
          risk: "uncertain",
          layer: "core",
          key: displayKey,
          historicalClaimIds: historicalClaims.map((claim) => claim.id),
          currentClaimIds: [],
          explanation: "A core claim is not observable and policy masking may explain the absence.",
        });
      } else {
        observations.push({
          category: "core_missing",
          risk: "high",
          layer: "core",
          key: displayKey,
          historicalClaimIds: historicalClaims.map((claim) => claim.id),
          currentClaimIds: [],
          explanation: "A previously active core claim disappeared without an explanatory context.",
        });
      }
      continue;
    }

    if (!sameAnyValue(historicalClaims, currentClaims)) {
      const explained = currentClaims.some((claim) => acceptedClaimIds.has(claim.id));
      if (explained) {
        observations.push({
          category: "explained_evolution",
          risk: "none",
          layer: "core",
          key: displayKey,
          historicalClaimIds: historicalClaims.map((claim) => claim.id),
          currentClaimIds: currentClaims.map((claim) => claim.id),
          explanation: "The changed core claim is linked to an accepted identity evolution.",
        });
      } else if (context.policyMaskSuspected) {
        observations.push({
          category: "policy_mask",
          risk: "uncertain",
          layer: "core",
          key: displayKey,
          historicalClaimIds: historicalClaims.map((claim) => claim.id),
          currentClaimIds: currentClaims.map((claim) => claim.id),
          explanation: "The visible core reversal may be an expression constraint rather than identity change.",
        });
      } else {
        observations.push({
          category: "core_reversal",
          risk: "high",
          layer: "core",
          key: displayKey,
          historicalClaimIds: historicalClaims.map((claim) => claim.id),
          currentClaimIds: currentClaims.map((claim) => claim.id),
          explanation: "A core claim reversed without an accepted evolution chain.",
        });
      }
    }
  }

  const baselineTexture = groupClaims(baseline.activeClaims, "texture");
  const currentTexture = groupClaims(current.activeClaims, "texture");
  const textureKeys = new Set([...baselineTexture.keys(), ...currentTexture.keys()]);
  let textureChanges = 0;
  for (const key of textureKeys) {
    const before = baselineTexture.get(key) ?? [];
    const after = currentTexture.get(key) ?? [];
    if (before.length === 0 || after.length === 0 || !sameAnyValue(before, after)) textureChanges += 1;
  }
  if (textureChanges > 0) {
    const ratio = textureKeys.size === 0 ? 0 : textureChanges / textureKeys.size;
    observations.push({
      category: "texture_shift",
      risk: ratio > 0.5 && textureChanges >= 2 ? "medium" : "low",
      layer: "texture",
      historicalClaimIds: [...baselineTexture.values()].flat().map((claim) => claim.id),
      currentClaimIds: [...currentTexture.values()].flat().map((claim) => claim.id),
      explanation:
        ratio > 0.5 && textureChanges >= 2
          ? "A broad texture replacement was observed; identity is not disproven but review is warranted."
          : "A limited texture change is compatible with ordinary growth.",
    });
  }

  const unprovenanced = current.activeClaims.filter((claim) => claim.evidenceIds.length === 0);
  if (unprovenanced.length > 0) {
    observations.push({
      category: "unprovenanced_rule",
      risk: "medium",
      historicalClaimIds: [],
      currentClaimIds: unprovenanced.map((claim) => claim.id),
      explanation: "Current identity contains claims with no provenance records.",
    });
  }

  return { overallRisk: overallRisk(observations), observations };
}
