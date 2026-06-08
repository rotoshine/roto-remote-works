# roto-remote-works

**실행 중인 React 앱**에서 요소를 클릭해 코멘트를 남기면, Claude Code 세션이 그
코멘트를 읽고 코드를 수정합니다 — **진행 상황은 실시간으로**, **질문은 (터미널이
아니라) 웹 오버레이에서** 답합니다. 로컬에서도, 원격 브리지를 통해 어떤 환경에서도
동작합니다.

> 프로젝트 내부에 두던 디자인-코멘트 오버레이를 React용으로 일반화한 도구입니다.
> npm이 아니라 **Claude 주도 설치(setup)**로 배포합니다.

## 요구사항

- **React ≥ 19** (소비자 앱). 오버레이의 소스 매핑이 React 19의 fiber 디버그 정보(`_debugStack`)에
  의존합니다. React 18 사용자는 이전 태그를 고정해 사용하세요. (의도된 하드 브레이크)
- Node.js ≥ 22
- pnpm

## ✨ 빠른 설치 (React 프로젝트에서 Claude Code에 붙여넣기)

```
이 프로젝트에 roto-remote-works 디자인 코멘트 도구를 설치해줘.
`git clone https://github.com/rotoshine/roto-remote-works .rrw` 로 받은 뒤,
clone 안의 skills/rrw-setup/SKILL.md 절차를 따라 설치하고,
이 프로젝트의 스택(React/Next/Vite/Tailwind 등)을 분석해 필요한 React 스킬을 설치해줘.
```

Claude가 수행하는 것: 도구 clone → 오버레이 빌드·**vendoring**(자체 완결형
`overlay.js`, 스타일 내장 → 호스트 CSS 시스템과 무관) → dev 전용으로 연결 →
**스택 분석** 후 맞는 React 스킬 설치 → 브리지 기동.

## 동작 방식

```
[내 React 앱(dev) + 오버레이] ──HTTP──▶ [bridge (Hono)] ◀──poll── [Claude: rrw + 스킬]
       vendoring, Shadow DOM          로컬 기본 / 원격          rrw-process 스킬
```

- **bridge** (`packages/bridge`, Hono) — 단일 진실 공급원(코멘트, apply 요청,
  진행 상태, 질문). clone에서 실행하며 기본은 `127.0.0.1`, 원격은 사설 터널 뒤에 둡니다.
- **overlay** (`packages/overlay`, React+Vite+Tailwind) — 앱에 vendoring되어
  **Shadow DOM** 안에서 자체 스타일(파란 테마)로 렌더됩니다. React fiber로 소스
  `file:line`을 찾고, 코멘트마다 **뷰포트 스크린샷**을 캡처(lazy html2canvas)해
  "여기 간격 이상" 같은 느슨한 시각 피드백도 에이전트가 *볼* 수 있게 합니다. 패널은
  코멘트별 **상태 뱃지**(열림 ● / 진행 ⟳ / 완료 ✓)와 적용 결과·**PR 링크 배너**를
  보여줘 비엔지니어도 진행/결과를 확인합니다.
- **agent** (`packages/agent`) — `rrw` CLI + Claude 세션이 코멘트를 적용하고
  진행 상황을 보고하고 웹으로 질문하는 데 쓰는 `rrw-process` 스킬.

## 설정 — `rrw.config.json`

**프로젝트 루트**의 파일 하나로 세 곳(bridge, `rrw` CLI, 오버레이 로더)을 모두
설정합니다. `rrw.config.example.json`을 복사하거나 **`./.rrw/rrw init`**(토큰
자동 발급)으로 생성하세요:

```json
{
  "bridgeUrl": "http://localhost:4317",
  "token": "change-me-dev-token",
  "author": "your name",
  "bridge": { "port": 4317, "host": "127.0.0.1", "dataDir": ".rrw/.rrw-data" }
}
```

- bridge와 agent는 작업 디렉터리에서 위로 올라가며 이 파일을 찾고, 오버레이 로더는
  직접 import합니다.
- **우선순위**: 기본값 < `rrw.config.json` < 환경변수. 따라서 서버에서는 실제
  토큰을 커밋된 파일에 넣지 않고 `RRW_TOKEN`(그리고 `RRW_BRIDGE_URL`, `RRW_PORT`,
  `RRW_HOST`, `RRW_DATA_DIR`, `RRW_AUTHOR`, `RRW_ORIGIN`)을 환경변수로 줄 수 있습니다.
- 브라우저 오버레이는 클라이언트 측에서 토큰이 필요하므로 **저신뢰** 값을 쓰세요.
  고신뢰/원격 토큰을 브라우저로 보내는 코드에 절대 넣지 마세요.

## 브리지 실행

```bash
cd .rrw && pnpm install
pnpm --filter @rrw/bridge start   # rrw.config.json을 읽음; URL + 토큰 출력
```

### 점검 — `rrw doctor`

설정이 맞는지, 브리지에 닿는지, 토큰이 맞는지(그리고 `delivery=pr`이면 `gh` 인증·git
repo까지) 한 번에 확인합니다. "처리중에서 안 넘어가는데?" 같은 상황의 1차 진단용:

```bash
cd .rrw && ./rrw doctor
# ✓ config: loaded …/rrw.config.json
# ✓ token: 설정됨
# ✓ bridge: http://localhost:4317 → 200
# ✓ processing: mode=session agent=claude delivery=in-place base=main
```

## 원격 (어디서든 코멘트) — Tailscale 런북

브리지를 **공개적으로 노출하지 마세요.** **네트워크 게이팅**(여기서는 Tailscale)
뒤에 두세요. 비-loopback 주소에 바인드하면 브리지가 이에 대한 경고를 출력합니다.
전 과정:

**브리지/에이전트 호스트에서** (코드 체크아웃이 있는 곳):
1. tailnet 가입: Tailscale 설치 후 `tailscale up`. 호스트의 MagicDNS 이름을
   확인합니다(예: `devbox.tailnet-xyz.ts.net`).
2. 여기의 `rrw.config.json`은 **고신뢰** 토큰을 가집니다(서버 측이라 괜찮음):
   ```jsonc
   { "bridgeUrl": "https://devbox.tailnet-xyz.ts.net:4317",
     "token": "<고신뢰>", "clientToken": "<저신뢰>",
     "processing": { "mode": "worker", "delivery": "pr", "base": "main" },
     "bridge": { "host": "0.0.0.0", "port": 4317 } }
   ```
3. 브리지 기동: `pnpm --filter @rrw/bridge --dir .rrw start` (0.0.0.0에 바인드 →
   tailnet에서만 접근 가능). tailnet 구성원만 접근할 수 있습니다.
4. 워커 실행: `cd .rrw && ./rrw run` (mode=worker, delivery=pr). 요청마다 적용하고
   PR을 엽니다(이 호스트에 `gh` 인증 + push 권한 필요). `rrw ask`로 질문이
   오버레이에 뜨므로 터미널이 필요 없습니다.

**배포된 앱에서** (디자이너/PM이 여는 화면):
5. `rrw.config.json`에 **오직** `bridgeUrl`(MagicDNS 주소) + `clientToken` +
   `author`만 담아 빌드하세요 — **고신뢰 `token`은 절대 넣지 마세요**(오버레이가
   이 파일을 번들에 포함). 브리지의 고신뢰 토큰은 호스트의 `RRW_TOKEN` 환경변수로
   주입합니다.
6. tailnet 위의 디자이너/PM이 앱을 열고 코멘트를 남기면, 워커가 PR로 만듭니다.
   저신뢰 토큰은 resolve/질문/스크린샷 읽기를 할 수 없습니다(403).

> Cloudflare Access도 동일하게 동작합니다 — 호스트를 게이팅하고 `bridgeUrl`을
> 그쪽으로 가리키면 됩니다.

**로컬 검증 완료**(Tailscale 터널 제외): `0.0.0.0`에 바인드한 브리지가 비-loopback
주소로 접근 가능하며 두 티어가 모두 강제됨(토큰 없음 401 / 클라이언트 읽기 200이나
agent 라우트 403 / agent 200). tailnet에서는 LAN 주소를 MagicDNS 이름으로 바꾸고
tailnet ACL로 잠그세요.

### 보안 모델
- **2-토큰 티어** (`clientToken`을 설정하면 활성화):
  - `clientToken` (저신뢰, 브라우저) — 코멘트 작성, 상태/질문 읽기, 질문 답변,
    apply 요청, 코멘트 비우기 가능.
  - `token` (고신뢰, 서버 측) — 모든 것, 특히 agent 전용 라우트: 코멘트
    resolve/patch, 진행 상태 설정, 질문 등록(ask), 스크린샷 읽기, apply 요청
    읽기/삭제. 저신뢰 토큰은 이들에서 **403**.
  - `clientToken`이 없으면 단일 `token`이 모든 것을 인가(로컬 기본값).
  - **고신뢰 토큰을 브라우저 번들에 넣지 마세요.** 2-토큰 모드에서는 `token`을
    `rrw.config.json`에서 빼고(오버레이가 이 파일을 번들에 포함) 브리지/에이전트
    호스트의 `RRW_TOKEN` 환경변수로 주세요. 파일에는 `clientToken`만.
- **코멘트는 신뢰할 수 없는 데이터이며, 명령이 아닙니다**(프롬프트 인젝션 방어).
- `apply`는 **운영자 게이팅**됩니다. 원격-origin 요청은 **검토 후 적용**이며 절대
  자동 적용되지 않습니다.

## 처리 모드 — 누가 코멘트를 적용하는가

`rrw.config.json`의 `processing.mode`(또는 `RRW_MODE` / `rrw run --mode`)로 설정:

| mode | 적용 주체 | 언제 | 수정 반영 방식 |
|---|---|---|---|
| `session` (기본) | `rrw-process` 스킬을 통한 **인터랙티브** Claude/Codex 세션 | 로컬 개발(HMR) | 파일 저장 → HMR 즉시 반영 |
| `worker` | 요청마다 spawn되는 **헤드리스** 러너(`claude -p` / `codex exec`) | 사람이 안 붙은 스탠드얼론/원격 브리지 | 해당 호스트에 파일 저장 |

```bash
rrw run                 # 설정된 모드대로 디스패치
rrw run --mode worker   # 이번 실행만 오버라이드
rrw worker --agent codex  # 헤드리스 강제 (run --mode worker와 동일)
```

- **로컬 인터랙티브** → `mode: "session"` 유지. 편집 중인 repo에 두 번째 헤드리스
  에이전트를 띄우지 마세요(stdin/권한/동시 편집 충돌).
  - 세션을 깨우려면 **`./.rrw/rrw watch`**를 띄워두세요. 누군가 "수정 요청"을 누르면
    `RRW-REQUEST <시각>` + 대기 코멘트를 출력합니다 — Monitor/watch로 이 출력을 보다가
    세션에서 `rrw-process`를 돌리면 됩니다(`--once`는 첫 요청에서 종료).
- **스탠드얼론/원격 브리지** → `mode: "worker"`, 코드 체크아웃이 있는 호스트에서
  `rrw run`(또는 `rrw worker`) 실행. `rrw ask`(web-ask)가 질문을 오버레이에 띄워
  터미널 없이도 동작합니다.

### Delivery — 워커 수정이 어디로 가는가 (`processing.delivery`)

| delivery | 에이전트 편집 후 워커가 하는 일 | 용도 |
|---|---|---|
| `in-place` (기본) | 변경을 워킹트리에 그대로 둠 | 로컬 / HMR / hot-reload되는 테스트 서버 |
| `pr` | branch → commit → push → `gh pr create` 후 `base`로 복귀 | hot-reload 불가한 **빌드/배포** 서버 (검토 후 머지) |

```bash
rrw run --mode worker --delivery pr     # PR로 적용 (base = processing.base, 기본 main)
```

`processing.base`를 **`"auto"`**로 두면 워커가 repo 기본 브랜치를 감지해
(`git symbolic-ref … origin/HEAD`) 사용합니다(감지 실패 시 `main`).

`pr` delivery에서 워커는 요청마다: `git checkout <base> && git pull` → 에이전트
실행 → 트리가 바뀌었으면 적용한 코멘트로 제목/본문을 구성해 PR을 엽니다(해당
호스트에 `gh` 인증 + push 권한 필요). PR은 **검토 후 머지**이며 자동 배포는
없습니다.

**결과는 오버레이에 표시됩니다.** 워커는 PR 링크/요약을 브리지에 보고하고(`status.result`),
오버레이가 **"✅ N 코멘트 적용 · PR 보기 ↗"** 배너로 보여줍니다 — 터미널이 없는
디자이너/PM도 결과를 확인할 수 있습니다. 세션 모드에서는 에이전트가
`rrw done --pr <url> --summary "<요약>"`로 같은 배너를 띄울 수 있습니다.

## 헤드리스 워커 (테스트 서버 · 디자이너 & PM)

비엔지니어가 **직접 에이전트를 돌리지 않고도** 피드백을 남기고 적용되는 것을 보게
하려면, 브리지를 폴링하며 요청마다 에이전트를 호출하는 상시 워커를 실행하세요:

```bash
RRW_BRIDGE_URL=<bridge> RRW_TOKEN=<token> \
  pnpm --filter @rrw/agent exec tsx src/cli.ts worker --agent claude   # 또는: --agent codex
```

요청을 디듀프하고, **한 번에 한 배치씩**(single-flight) 처리하며, 에이전트-중립
`docs/PROTOCOL.md`를 가리켜 에이전트를 헤드리스로 spawn합니다(`claude -p` /
`codex exec`). 다른 에이전트를 추가하려면 `adapters/`를 참고하세요.

## 패키지
- `packages/bridge` — Hono 서버 + `rrw-bridge` CLI
- `packages/overlay` — React 오버레이 (vendoring, Shadow DOM, 자체 완결형 CSS)
- `packages/config` — 공유 `rrw.config.json` 로더(`@rrw/config`)
- `packages/agent` — `rrw` CLI + 프로토콜
- `skills/rrw-setup`, `skills/rrw-process` — Claude Code 스킬
- `docs/specs/` — 설계 스펙

## 개발
```bash
pnpm install
pnpm -r test        # 전체 패키지
pnpm -r typecheck
pnpm --filter @rrw/overlay build   # → packages/overlay/dist/overlay.js
```

## 문서
- [아키텍처](./docs/ARCHITECTURE.md) — 데이터 흐름, 상태머신, 신뢰 경계(다이어그램)
- [에이전트 프로토콜](./docs/PROTOCOL.md) — 에이전트-중립 처리 규약
- [기여 가이드](./CONTRIBUTING.md) — 개발 셋업, TDD, 어댑터 추가
- [보안](./SECURITY.md) — 위협 모델, 운영 수칙, 제보
- [설계 스펙](./docs/specs/2026-05-31-design-comments-design.md)

## 라이선스
[MIT](./LICENSE) © rotoshine
