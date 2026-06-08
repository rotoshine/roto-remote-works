import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const RUN = process.env.RRW_BUILD_TEST === "1";
const dist = resolve(import.meta.dirname, "dist");

describe.runIf(RUN)("overlay build artifact", () => {
  beforeAll(() => {
    execSync("pnpm build", { cwd: resolve(import.meta.dirname), stdio: "inherit" }); // throws on non-zero
    if (!existsSync(resolve(dist, "overlay.js"))) throw new Error("build did not emit overlay.js");
  }, 180_000);

  it("emits a single overlay.js (single-file vendoring contract)", () => {
    expect(readdirSync(dist).filter((f) => f.endsWith(".js"))).toEqual(["overlay.js"]);
  });

  it("bundles react-grab but not the Node @react-grab/cli", () => {
    const code = readFileSync(resolve(dist, "overlay.js"), "utf8");
    expect(code).toMatch(/react-grab/); // positive: react-grab IS bundled, not externalized
    expect(code).not.toMatch(/from\s*['"]@react-grab\/cli/);
    expect(code).not.toMatch(/require\(\s*['"]@react-grab\/cli/);
    expect(code).not.toMatch(/['"]node:child_process['"]/);
  });
});
