# 기여 가이드

/ [README](./README.md) · [아키텍처](./docs/ARCHITECTURE.md) · [보안](./SECURITY.md) /

## 개발 환경

- **Node ≥ 22**, **pnpm**(버전은 `packageManager`로 고정, corepack 권장).
- **pnpm만 사용**하세요(npm/yarn 금지).

```bash
pnpm install
pnpm -r test         # 전체 패키지 테스트
pnpm -r typecheck    # 전체 타입체크
pnpm --filter @rrw/overlay build   # → packages/overlay/dist/overlay.js
```

## TDD가 기본 (Iron Law)

이 프로젝트는 **테스트를 먼저** 작성합니다.

```
실패하는 테스트 없이 프로덕션 코드를 작성하지 않는다.
```

1. **RED** — 동작을 기술하는 실패 테스트를 먼저 쓰고, 실패하는지 확인.
2. **GREEN** — 통과할 만큼만 최소로 구현.
3. **REFACTOR** — 초록을 유지하며 정리.

순수 로직은 단위 테스트로, 부수효과(git/gh, child_process)는 **러너를 주입**해
테스트하세요. 실제 동작이 중요한 곳(예: PR 흐름)은 임시 repo로 **실제 git 통합
테스트**까지 둡니다. PR을 올리기 전 `pnpm -r test`와 `pnpm -r typecheck`가 모두
초록이어야 합니다.

## 패키지 구조

| 패키지 | 무엇 |
|---|---|
| `packages/bridge` | Hono 서버 + 파일 상태 저장소 + `rrw-bridge` CLI |
| `packages/overlay` | React 오버레이 (Shadow DOM, 자체 완결형 CSS) |
| `packages/agent` | `rrw` CLI + worker/PR delivery 로직 |
| `packages/config` | `rrw.config.json` 로더(`@rrw/config`) |

전체 그림은 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## 자주 하는 작업

### 에이전트(러너) 추가
1. `packages/agent/src/runners.ts`의 `agentCommand`에 헤드리스 실행 커맨드 추가
   (+ 테스트). `resolveRunner`/config의 `AgentKind`도 확장.
2. 어댑터 문서 추가: `adapters/<name>/...` (Codex 예시는 `adapters/codex/AGENTS.md`).
   에이전트-중립 규약은 [docs/PROTOCOL.md](./docs/PROTOCOL.md)를 따르세요.

### 설정 필드 추가
`packages/config`의 타입 + `loadConfig`에 추가(+ 테스트). bridge/agent/overlay가
함께 읽으므로 한 곳만 고치면 됩니다. 우선순위는 기본값 < `rrw.config.json` < env.

### 브리지 라우트 추가
`packages/bridge/src/app.ts`. agent 전용이면 `requireAgent` 가드를 붙이고
`app.test.ts`에 티어(403/200) 테스트를 추가하세요.

## 코드 스타일
- TypeScript **strict**(`verbatimModuleSyntax`, `noUncheckedIndexedAccess`).
- 부수효과는 주입 가능한 경계 뒤로(테스트 용이성).
- 주변 코드의 네이밍/주석 밀도/관용구에 맞추기.

## 커밋 / PR
- **Conventional Commits**: `feat(agent): …`, `fix(bridge): …`, `docs: …` 등.
- PR 전 체크: `pnpm -r test` + `pnpm -r typecheck` 초록, 새 동작엔 테스트, 사용자에
  보이는 변경엔 문서 갱신.
