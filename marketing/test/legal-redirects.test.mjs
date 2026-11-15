import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The store listings (Google Play privacy policy and account deletion links)
// point at this host. The pages themselves live in the application, so every
// one of these paths must redirect there instead of returning a 404.
const config = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");

const EXPECTED = {
  "/privacy": "/privacy",
  "/privacy-policy": "/privacy",
  "/terms": "/terms",
  "/terms-of-service": "/terms",
  "/data-deletion": "/data-deletion",
  "/delete-account": "/data-deletion",
};

for (const [source, target] of Object.entries(EXPECTED)) {
  test(`${source} redirects to the application's ${target}`, () => {
    const line = `{ source: "${source}", destination: \`\${APP_URL}${target}\`, permanent: false }`;
    assert.ok(config.includes(line), `missing redirect for ${source}`);
  });
}
