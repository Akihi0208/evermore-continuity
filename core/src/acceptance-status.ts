import type { AcceptanceStatus } from "./types.js";

const ACCEPTANCE_STATUSES = new Set<string>([
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
]);

export function isAcceptanceStatus(value: unknown): value is AcceptanceStatus {
  return typeof value === "string" && ACCEPTANCE_STATUSES.has(value);
}
