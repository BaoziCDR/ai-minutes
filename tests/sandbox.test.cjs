const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { findCodex } = require("../electron/codex-models.cjs");
test(
  "macOS Codex sandbox permits only task input and denies sibling files and writes",
  { skip: process.platform !== "darwin" || !fs.existsSync(findCodex()) },
  () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-sandbox-"));
    try {
      const dir = path.join(base, "input");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "allowed.txt"), "allowed");
      fs.writeFileSync(path.join(base, "outside.txt"), "outside");
      const real = fs.realpathSync(dir);
      const script =
        'inside=no; outside=no; write=no; if /usr/bin/head -c 1 allowed.txt >/dev/null 2>&1; then inside=yes; fi; if /usr/bin/head -c 1 ../outside.txt >/dev/null 2>&1; then outside=yes; fi; if /usr/bin/touch should-not-write >/dev/null 2>&1; then write=yes; fi; echo "$inside $outside $write"';
      const out = execFileSync(
        findCodex(),
        [
          "sandbox",
          "-P",
          "meeting-read",
          "-C",
          real,
          "-c",
          `permissions.meeting-read.filesystem={":root"="deny",":minimal"="read",${JSON.stringify(real)}="read"}`,
          "-c",
          "permissions.meeting-read.network.enabled=false",
          "--",
          "/bin/sh",
          "-c",
          script,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(out.trim(), "yes no no");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
);
