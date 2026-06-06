# AGENTS.md — roto-remote-works

이 repo에서 작업하는 모든 에이전트(Codex 등)용 안내. 상세는 **[CLAUDE.md](./CLAUDE.md)** 와 동일하니 먼저 읽어라.

핵심만:
- **pnpm 전용** (npm/yarn 금지), Node ≥ 22.
- **TDD Iron Law** — 실패 테스트 먼저. 부수효과는 러너 주입으로 테스트.
- 게이트: `pnpm -r test` + `pnpm -r typecheck` 초록. Conventional Commits.
- 빌드: `pnpm --filter @rrw/overlay build`.

먼저 읽을 문서: `CLAUDE.md` · `README.md` · `docs/ARCHITECTURE.md` · `CONTRIBUTING.md` · `docs/PROTOCOL.md`.

구조: `packages/{bridge,overlay,agent,config}` — bridge(Hono 상태 서버) / overlay(React vendored) / agent(`rrw` CLI + 처리) / config(`rrw.config.json` 로더). 에이전트-중립 처리 규약은 `docs/PROTOCOL.md`.

> 참고: `adapters/codex/AGENTS.md`는 이 repo가 아니라 **도구를 설치한 소비자 프로젝트의** Codex 어댑터 문서다(혼동 주의).
