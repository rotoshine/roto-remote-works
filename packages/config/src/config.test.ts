import { describe, it, expect } from "vitest";
import { loadConfig } from "./index";

function fakeFs(files: Record<string, string>) {
  return {
    existsSync: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p: string) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error("ENOENT: " + p);
      return files[p]!;
    },
  };
}

describe("loadConfig", () => {
  it("returns defaults when there is no file and no env", () => {
    const c = loadConfig({ cwd: "/proj", env: {}, fs: fakeFs({}) });
    expect(c.bridgeUrl).toBe("http://localhost:4317");
    expect(c.token).toBe("");
    expect(c.author).toBeNull();
    expect(c.origin).toBe("local");
    expect(c.bridge.port).toBe(4317);
    expect(c.bridge.host).toBe("127.0.0.1");
    expect(c.bridge.dataDir).toBe("/proj/.rrw-data");
    expect(c.source).toBeNull();
  });

  it("reads bridgeUrl/token/author from rrw.config.json", () => {
    const fs = fakeFs({
      "/proj/rrw.config.json": JSON.stringify({
        bridgeUrl: "http://bridge.example:4317",
        token: "filetok",
        author: "Designer",
      }),
    });
    const c = loadConfig({ cwd: "/proj", env: {}, fs });
    expect(c.bridgeUrl).toBe("http://bridge.example:4317");
    expect(c.token).toBe("filetok");
    expect(c.author).toBe("Designer");
    expect(c.source).toBe("/proj/rrw.config.json");
  });

  it("lets env override the config file (secrets stay in env)", () => {
    const fs = fakeFs({
      "/proj/rrw.config.json": JSON.stringify({ bridgeUrl: "http://file:4317", token: "filetok" }),
    });
    const c = loadConfig({ cwd: "/proj", env: { RRW_BRIDGE_URL: "http://env:9000", RRW_TOKEN: "envtok" }, fs });
    expect(c.bridgeUrl).toBe("http://env:9000");
    expect(c.token).toBe("envtok");
  });

  it("walks up to find the config in an ancestor directory", () => {
    const fs = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ token: "anc" }) });
    const c = loadConfig({ cwd: "/proj/app/src", env: {}, fs });
    expect(c.token).toBe("anc");
    expect(c.source).toBe("/proj/rrw.config.json");
  });

  it("reads bridge serve options; env RRW_PORT overrides, relative dataDir resolves against config dir", () => {
    const fs = fakeFs({
      "/proj/rrw.config.json": JSON.stringify({ bridge: { port: 5000, host: "0.0.0.0", dataDir: "data" } }),
    });
    const c = loadConfig({ cwd: "/proj", env: { RRW_PORT: "6000" }, fs });
    expect(c.bridge.port).toBe(6000);
    expect(c.bridge.host).toBe("0.0.0.0");
    expect(c.bridge.dataDir).toBe("/proj/data");
  });

  it("normalizes origin — only 'remote' stays remote", () => {
    const remote = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ origin: "remote" }) });
    expect(loadConfig({ cwd: "/proj", env: {}, fs: remote }).origin).toBe("remote");
    const weird = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ origin: "weird" }) });
    expect(loadConfig({ cwd: "/proj", env: {}, fs: weird }).origin).toBe("local");
  });

  it("throws a clear error naming the file on invalid JSON", () => {
    const fs = fakeFs({ "/proj/rrw.config.json": "{ not json" });
    expect(() => loadConfig({ cwd: "/proj", env: {}, fs })).toThrow(/rrw\.config\.json/);
  });

  it("absolute env RRW_DATA_DIR wins over the file", () => {
    const fs = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ bridge: { dataDir: "data" } }) });
    const c = loadConfig({ cwd: "/proj", env: { RRW_DATA_DIR: "/var/rrw" }, fs });
    expect(c.bridge.dataDir).toBe("/var/rrw");
  });

  it("defaults processing to session mode + claude agent", () => {
    const c = loadConfig({ cwd: "/proj", env: {}, fs: fakeFs({}) });
    expect(c.processing.mode).toBe("session");
    expect(c.processing.agent).toBe("claude");
  });

  it("reads processing.mode/agent from the file", () => {
    const fs = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ processing: { mode: "worker", agent: "codex" } }) });
    const c = loadConfig({ cwd: "/proj", env: {}, fs });
    expect(c.processing.mode).toBe("worker");
    expect(c.processing.agent).toBe("codex");
  });

  it("env RRW_MODE/RRW_AGENT override the file", () => {
    const fs = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ processing: { mode: "worker", agent: "codex" } }) });
    const c = loadConfig({ cwd: "/proj", env: { RRW_MODE: "session", RRW_AGENT: "claude" }, fs });
    expect(c.processing.mode).toBe("session");
    expect(c.processing.agent).toBe("claude");
  });

  it("normalizes unknown processing values back to defaults", () => {
    const fs = fakeFs({ "/proj/rrw.config.json": JSON.stringify({ processing: { mode: "weird", agent: "gpt" } }) });
    const c = loadConfig({ cwd: "/proj", env: {}, fs });
    expect(c.processing.mode).toBe("session");
    expect(c.processing.agent).toBe("claude");
  });
});
