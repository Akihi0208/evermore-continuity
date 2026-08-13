import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const state = {
  active: false,
  attempts: 0,
};

function denied(api) {
  return function networkDisabled() {
    state.attempts += 1;
    const error = new Error(`Network access disabled by Continuity V03-041 guard: ${api}`);
    error.code = "ERR_CONTINUITY_NETWORK_DISABLED";
    throw error;
  };
}

function replace(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: target.propertyIsEnumerable?.(key) ?? false,
    value,
    writable: true,
  });
}

const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const dgram = require("node:dgram");

replace(net.Socket.prototype, "connect", denied("net.Socket.connect"));
replace(net, "connect", denied("net.connect"));
replace(net, "createConnection", denied("net.createConnection"));
replace(tls, "connect", denied("tls.connect"));
replace(http, "request", denied("http.request"));
replace(http, "get", denied("http.get"));
replace(https, "request", denied("https.request"));
replace(https, "get", denied("https.get"));
replace(dgram, "createSocket", denied("dgram.createSocket"));

for (const method of [
  "lookup",
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
]) {
  if (typeof dns[method] === "function") replace(dns, method, denied(`dns.${method}`));
  if (typeof dns.promises?.[method] === "function") {
    replace(dns.promises, method, denied(`dns.promises.${method}`));
  }
}

for (const globalApi of ["fetch", "WebSocket", "EventSource"]) {
  if (globalApi in globalThis) replace(globalThis, globalApi, denied(`globalThis.${globalApi}`));
}

syncBuiltinESMExports();

// Self-prove that the deny path is live, then reset the audit counter so only
// suite-originated attempts contribute to the release-gate result.
try {
  net.connect({ host: "127.0.0.1", port: 9 });
  throw new Error("Continuity V03-041 guard self-check did not deny net.connect");
} catch (error) {
  if (error?.code !== "ERR_CONTINUITY_NETWORK_DISABLED") throw error;
}
state.attempts = 0;
state.active = true;

process.stdout.write(
  `# CONTINUITY_NETWORK_GUARD_ACTIVE ${JSON.stringify({ active: state.active })}\n`,
);
process.on("exit", () => {
  process.stdout.write(
    `# CONTINUITY_NETWORK_GUARD_RESULT ${JSON.stringify({
      active: state.active,
      attempts: state.attempts,
    })}\n`,
  );
});
