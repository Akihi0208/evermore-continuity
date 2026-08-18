#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const [command, ...args] = process.argv.slice(2);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (command === "init" || command === "seal") {
  process.stdout.write("Vault passphrase requirement: at least 12 characters.\n");
}

if (command === "self-distill-import" && args[0]) {
  const recordPath = args[0];
  const profileTarget = resolve(args[1] ?? `${recordPath.replace(/\.json$/i, "")}.profile.json`);
  const auditTarget = resolve(args[2] ?? `${recordPath.replace(/\.json$/i, "")}.audit.json`);
  const existing = [];
  if (await exists(profileTarget)) existing.push(profileTarget);
  if (await exists(auditTarget)) existing.push(auditTarget);
  if (existing.length > 0) {
    process.stderr.write(
      `Error: Refusing to overwrite existing Self-Distillation output file${existing.length === 1 ? "" : "s"}: ${existing.join(", ")}. Choose different output path(s) or move/remove the existing file(s).\n`,
    );
    process.exitCode = 1;
  } else {
    await import("./evermore-impl.mjs");
  }
} else {
  await import("./evermore-impl.mjs");
}
