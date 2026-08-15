import { createHash } from "node:crypto";
function normalize(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("Canonical JSON cannot contain non-finite numbers");
        return value;
    }
    if (Array.isArray(value))
        return value.map(normalize);
    if (typeof value === "object") {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            const item = value[key];
            if (item !== undefined)
                result[key] = normalize(item);
        }
        return result;
    }
    throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}
export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}
export function sha256(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function deepEqual(a, b) {
    return canonicalJson(a) === canonicalJson(b);
}
export function clone(value) {
    return structuredClone(value);
}
//# sourceMappingURL=canonical.js.map