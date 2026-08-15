const ACCEPTANCE_STATUSES = new Set([
    "pending",
    "accepted",
    "rejected",
    "withdrawn",
]);
export function isAcceptanceStatus(value) {
    return typeof value === "string" && ACCEPTANCE_STATUSES.has(value);
}
//# sourceMappingURL=acceptance-status.js.map