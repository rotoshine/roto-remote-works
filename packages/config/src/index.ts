import { existsSync as nodeExists, readFileSync as nodeRead } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface RrwConfigFile {
  bridgeUrl?: string;
  token?: string;
  author?: string;
  origin?: "local" | "remote";
  bridge?: { port?: number; host?: string; dataDir?: string };
}

export interface ResolvedConfig {
  bridgeUrl: string;
  token: string;
  author: string | null;
  origin: "local" | "remote";
  bridge: { port: number; host: string; dataDir: string };
  /** Absolute path of the config file that was loaded, or null. */
  source: string | null;
}

export interface LoadOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fileName?: string;
  fs?: {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string) => string;
  };
}

export const CONFIG_FILE = "rrw.config.json";
const DEFAULT_BRIDGE_URL = "http://localhost:4317";

/** Find the config file by walking up from `cwd` to the filesystem root. */
function findConfig(
  cwd: string,
  fileName: string,
  exists: (p: string) => boolean,
): string | null {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, fileName);
    if (exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the rrw config from (lowest→highest precedence): built-in defaults <
 * `rrw.config.json` (nearest ancestor) < environment variables. Secrets such as
 * the token are best left out of the committed file and supplied via env.
 */
export function loadConfig(opts: LoadOptions = {}): ResolvedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const fileName = opts.fileName ?? CONFIG_FILE;
  const exists = opts.fs?.existsSync ?? nodeExists;
  const read = opts.fs?.readFileSync ?? ((p: string) => nodeRead(p, "utf8"));

  const source = findConfig(cwd, fileName, exists);
  let file: RrwConfigFile = {};
  if (source) {
    try {
      file = JSON.parse(read(source)) as RrwConfigFile;
    } catch (err) {
      throw new Error(`invalid ${fileName} at ${source}: ${(err as Error).message}`);
    }
  }

  const baseDir = source ? dirname(source) : cwd;
  const originRaw = env.RRW_ORIGIN ?? file.origin;
  const rawDataDir = env.RRW_DATA_DIR ?? file.bridge?.dataDir ?? ".rrw-data";

  return {
    bridgeUrl: env.RRW_BRIDGE_URL ?? file.bridgeUrl ?? DEFAULT_BRIDGE_URL,
    token: env.RRW_TOKEN ?? file.token ?? "",
    author: env.RRW_AUTHOR ?? file.author ?? null,
    origin: originRaw === "remote" ? "remote" : "local",
    bridge: {
      port: Number(env.RRW_PORT ?? file.bridge?.port ?? 4317),
      host: env.RRW_HOST ?? file.bridge?.host ?? "127.0.0.1",
      dataDir: isAbsolute(rawDataDir) ? rawDataDir : join(baseDir, rawDataDir),
    },
    source,
  };
}
