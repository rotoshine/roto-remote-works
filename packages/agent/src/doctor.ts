import type { CmdRunner } from "./pr";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Subset of the resolved config that `rrw doctor` inspects. */
export interface DoctorConfig {
  bridgeUrl: string;
  token: string;
  clientToken: string | null;
  source: string | null;
  processing: { mode: string; agent: string; delivery: string; base: string };
}

export interface DoctorDeps {
  config: DoctorConfig;
  /** Probe the bridge (GET /status with the token); resolves to the HTTP status, throws on network error. */
  probeBridge: () => Promise<number>;
  /** Command runner for gh/git checks (pr delivery). */
  run?: CmdRunner;
}

/** Diagnose a roto-remote-works setup; returns a list of checks (✓/✗ + hint). */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorCheck[]> {
  const c = deps.config;
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "config",
    ok: true,
    detail: c.source ? `loaded ${c.source}` : "rrw.config.json 없음 — 기본값/env 사용",
  });

  checks.push({
    name: "token",
    ok: c.token.length > 0,
    detail: c.token ? "설정됨" : "없음 — rrw.config.json의 token 또는 RRW_TOKEN 필요",
  });

  try {
    const status = await deps.probeBridge();
    if (status === 200) checks.push({ name: "bridge", ok: true, detail: `${c.bridgeUrl} → 200` });
    else if (status === 401)
      checks.push({ name: "bridge", ok: false, detail: `401 토큰 불일치 (${c.bridgeUrl})` });
    else checks.push({ name: "bridge", ok: false, detail: `예상치 못한 상태 ${status} (${c.bridgeUrl})` });
  } catch {
    checks.push({ name: "bridge", ok: false, detail: `연결 실패 (${c.bridgeUrl}) — 브리지가 떠 있나요?` });
  }

  checks.push({
    name: "clientToken",
    ok: true,
    detail: c.clientToken ? "설정됨 (2-토큰 모드)" : "없음 (단일 토큰 모드)",
  });

  checks.push({
    name: "processing",
    ok: true,
    detail: `mode=${c.processing.mode} agent=${c.processing.agent} delivery=${c.processing.delivery} base=${c.processing.base}`,
  });

  if (c.processing.delivery === "pr" && deps.run) {
    const gh = await deps.run("gh", ["auth", "status"]);
    checks.push({
      name: "gh",
      ok: gh.code === 0,
      detail: gh.code === 0 ? "인증됨" : "gh 인증 필요 (delivery=pr) — `gh auth login`",
    });
    const git = await deps.run("git", ["rev-parse", "--is-inside-work-tree"]);
    checks.push({
      name: "git",
      ok: git.code === 0,
      detail: git.code === 0 ? "git 워킹트리" : "git repo 아님 (delivery=pr에 필요)",
    });
  }

  return checks;
}
