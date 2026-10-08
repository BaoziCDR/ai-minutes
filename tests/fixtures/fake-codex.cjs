#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "app-server") {
  const readline = require("node:readline");
  let initialized = false;
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "initialized") {
      initialized = true;
      return;
    }
    let result;
    if (message.method === "initialize") result = { userAgent: "fixture" };
    else if (message.method === "model/list" && initialized) {
      const model = {
        id: "fixture-model",
        model: "fixture-model",
        displayName: "Fixture Model",
        isDefault: true,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
      };
      result = message.params.cursor
        ? {
            data: [
              {
                ...model,
                id: "fixture-second",
                model: "fixture-second",
                displayName: "Fixture Second",
                isDefault: false,
              },
            ],
            nextCursor: null,
          }
        : {
            data: [
              model,
              { ...model, id: "hidden", model: "hidden", hidden: true },
            ],
            nextCursor: "page-2",
          };
    } else {
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ id: message.id, result }) + "\n");
  });
} else if (args[0] === "exec") {
  let prompt = "";
  process.stdin.on("data", (chunk) => (prompt += chunk));
  process.stdin.resume();
  process.stdin.on("end", () => {
    fs.writeFileSync(
      path.join(process.cwd(), "fixture-args.json"),
      JSON.stringify(args),
    );
    const schema = JSON.parse(
      fs.readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"),
    );
    if (schema.properties.requests) {
      const requests = prompt.includes('"clips":[]')
        ? [{ startMs: 0, endMs: 1500, reason: "核对金额", sourceIds: ["s1"] }]
        : [];
      fs.writeFileSync(
        args[args.indexOf("-o") + 1],
        JSON.stringify({ requests }),
      );
      process.exit(0);
    }
    fs.writeFileSync(
      args[args.indexOf("-o") + 1],
      JSON.stringify({
        overview: "模型选择验收",
        topics: [],
        decisions: [],
        actions: [],
        openQuestions: [],
        mindmap: { title: "测试", branches: [] },
      }),
    );
    process.exit(0);
  });
} else if (args[0] === "login") console.log("fixture login");
else process.exit(1);
