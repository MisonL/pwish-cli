#!/usr/bin/env node
import { main } from "../src/cli.js";
import { UserError } from "../src/config.js";
import { ApiError } from "../src/api.js";

try {
  const code = await main(process.argv.slice(2));
  process.exitCode = code ?? 0;
} catch (err) {
  if (err instanceof UserError) {
    process.stderr.write(`\u001b[31m✗ ${err.message}\u001b[0m\n`);
    if (err.hint) process.stderr.write(`${err.hint}\n`);
    process.exitCode = 2;
  } else if (err instanceof ApiError) {
    process.stderr.write(`\u001b[31m✗ ${err.message}\u001b[0m\n`);
    if (process.env.PWISH_DEBUG) process.stderr.write(`${JSON.stringify(err.payload, null, 2)}\n`);
    process.exitCode = err.code === "UNAUTHORIZED" || err.code === "NO_TOKEN" ? 3 : 1;
  } else {
    process.stderr.write(`\u001b[31m✗ ${err?.message || err}\u001b[0m\n`);
    if (process.env.PWISH_DEBUG) process.stderr.write(`${err?.stack}\n`);
    process.exitCode = 1;
  }
}
