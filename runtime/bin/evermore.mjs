#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPortablePackage, normalizeProfile, verifyPortablePackage } from "../src/profile.mjs";
import { createVault, openVault, readVault, writeVault } from "../src/vault.mjs";
import { renderHostHandoff } from "../src/handoff.mjs";

const DEFAULT_VAULT = resolve("runtime-secrets", "persona.evermore-vault.json");

function usage(exitCode = 0) {
  const message = `Evermore Continuity Personal Runtime 0.4 alpha

Usage:
  evermore init [vault-path]
  evermore seal <profile.json> [vault-path]
  evermore export <vault-path> [portable-package.json]
  evermore verify <vault-path>
  evermore verify-package <portable-package.json>
  evermore prompt <portable-package.json>

Passphrases must contain at least 12 characters. For non-interactive use, set
EVERMORE_PASSPHRASE in the process environment; never commit it to a file.
`;
  (exitCode === 0 ? stdout : process.stderr).write(message);
  process.exitCode = exitCode;
}

async function secretPrompt(label) {
  if (process.env.EVERMORE_PASSPHRASE) return process.env.EVERMORE_PASSPHRASE;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Set EVERMORE_PASSPHRASE for non-interactive use");
  stdout.write(label);
  return new Promise((resolveSecret, rejectSecret) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolveSecret(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          rejectSecret(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

function splitEntries(value) {
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

async function interactiveProfile() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const displayName = await rl.question("Persona display name: ");
    const core = splitEntries(await rl.question("Core anchors (separate with ;): "));
    const texture = splitEntries(await rl.question("Texture anchors (separate with ;, optional): "));
    const boundaries = splitEntries(await rl.question("Boundaries (separate with ;, optional): "));
    const privateNotes = splitEntries(await rl.question("Private notes (never exported; separate with ;, optional): "));
    return normalizeProfile({
      identity: { displayName },
      anchors: {
        core: core.map((statement, index) => ({ key: `core-${index + 1}`, statement, visibility: "capsule" })),
        texture: texture.map((statement, index) => ({ key: `texture-${index + 1}`, statement, visibility: "capsule" })),
      },
      boundaries,
      privateNotes,
    });
  } finally {
    rl.close();
  }
}

async function passphraseForNewVault() {
  const first = await secretPrompt("Vault passphrase: ");
  if (!process.env.EVERMORE_PASSPHRASE) {
    const second = await secretPrompt("Repeat passphrase: ");
    if (first !== second) throw new Error("Passphrases do not match");
  }
  return first;
}

async function init(path = DEFAULT_VAULT) {
  const profile = await interactiveProfile();
  const passphrase = await passphraseForNewVault();
  await writeVault(resolve(path), createVault(profile, passphrase));
  stdout.write(`Encrypted vault created: ${resolve(path)}\n`);
}

async function seal(profilePath, vaultPath = DEFAULT_VAULT) {
  if (!profilePath) throw new Error("seal requires a profile JSON path");
  const input = JSON.parse(await readFile(resolve(profilePath), "utf8"));
  const passphrase = await passphraseForNewVault();
  await writeVault(resolve(vaultPath), createVault(input, passphrase));
  stdout.write(`Encrypted vault created: ${resolve(vaultPath)}\n`);
}

async function open(path) {
  const passphrase = await secretPrompt("Vault passphrase: ");
  return openVault(await readVault(resolve(path)), passphrase);
}

async function exportPackage(vaultPath, outputPath) {
  if (!vaultPath) throw new Error("export requires a vault path");
  const profile = await open(vaultPath);
  const pkg = createPortablePackage(profile);
  const target = resolve(outputPath ?? `${vaultPath.replace(/\.json$/i, "")}.portable.json`);
  await writeFile(target, `${JSON.stringify(pkg, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(target, 0o600);
  stdout.write(`Portable package created: ${target}\n`);
  stdout.write("Review it before sending. Local/private anchors and private notes were excluded.\n");
}

async function verifyVault(path) {
  if (!path) throw new Error("verify requires a vault path");
  await open(path);
  stdout.write("Vault valid. Encryption and profile integrity checks passed.\n");
}

async function loadPackage(path) {
  if (!path) throw new Error("A portable package path is required");
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function verifyPackage(path) {
  const result = verifyPortablePackage(await loadPackage(path));
  if (!result.valid) throw new Error(`Portable package invalid: ${result.errors.join(", ")}`);
  stdout.write("Portable package valid. Hash and required fields passed.\n");
}

async function prompt(path) {
  stdout.write(renderHostHandoff(await loadPackage(path)));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "init") await init(args[0]);
  else if (command === "seal") await seal(args[0], args[1]);
  else if (command === "export") await exportPackage(args[0], args[1]);
  else if (command === "verify") await verifyVault(args[0]);
  else if (command === "verify-package") await verifyPackage(args[0]);
  else if (command === "prompt") await prompt(args[0]);
  else {
    process.stderr.write(`Unknown command: ${basename(command)}\n`);
    usage(1);
  }
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
