# react-grab 연동 런타임 스모크-테스트 체크리스트

> 설계 문서: [2026-06-08-react-grab-element-selection-design.md](./2026-06-08-react-grab-element-selection-design.md) §9

## 테스트 환경

일회용 React 19 + Vite 앱을 만들어 `overlay.js` 와 `rrw-loader` 파일을 vendoring하고,
`useRrwOverlay(true, { bridgeUrl, token: clientToken })` 훅으로 로컬 브리지에 연결한다.

```bash
# 세팅 요약
pnpm create vite test-app --template react-ts   # React 19 기본
# overlay 빌드 산출물 복사
cp packages/overlay/dist/overlay.js test-app/src/rrw/overlay.js
cp packages/overlay/dist/rrw-loader.js test-app/src/rrw-loader.js
cp packages/overlay/dist/useRrwOverlay.js test-app/src/useRrwOverlay.js
# App.tsx에서:
#   import { useRrwOverlay } from './useRrwOverlay'
#   useRrwOverlay(true, { bridgeUrl: 'http://localhost:4317', token: '<clientToken>' })
# 브리지: pnpm --filter @rrw/bridge start
```

테스트 항목은 §9의 7개 미지수를 1:1 대응한다.

---

## 체크리스트

| # | 항목 | 상태 | PASS 기준 |
|---|------|------|-----------|
| 1 | 컬럼 의존성 | ✅ PASS | apply 파이프라인이 `source` 의 `:col` 부분을 파싱하지 않음 — `file:line` 만으로 에이전트가 코드를 찾음 |
| 2 | 프로그래밍 방식 활성화 | ⏳ pending | `api.activate()` 가 선택 모드로 진입하고, react-grab 자체 활성화 키 리스너가 호스트 입력을 탈취하지 않음 |
| 3 | Shadow-DOM 히트-테스팅 | ⏳ pending | 오버레이 FAB·드래프트 카드를 클릭해도 react-grab이 이를 선택 가능한 요소로 포착하지 않음; `[data-rrw-host]` 가드가 작동 |
| 4 | 불필요한 chrome 없음 | ⏳ pending | react-grab의 toolbar·selectionBox·dragBox·elementLabel 등 UI가 전혀 렌더되지 않음; 스타일 없는 박스 없음 |
| 5 | 클립보드 복사 억제 | ⏳ pending | `onElementSelect` 가 `false` 를 반환해 클립보드 쓰기 + 성공 플래시가 발생하지 않음; 미작동 시 `onBeforeCopy`/`transformCopyContent` 가드 추가 |
| 6 | freezeReactUpdates 트레이드오프 | ⏳ pending | `freezeReactUpdates:false` 설정으로 선택 중에도 오버레이(드래프트 카드·진행 패널)가 인터랙티브하고, 호스트 앱도 계속 동작 |
| 7 | dispose/재마운트 | ⏳ pending | activate→select→deactivate→dispose 후 재활성화 시 깨끗하게 재초기화됨; `getGlobalApi()` 가 dispose 후 죽은 핸들을 반환하지 않음 |

---

## #1 컬럼 의존성 — 코드 조사 결과 (PASS)

**결론: SAFE** — apply 파이프라인의 어떤 코드도 `source` 필드의 `:col` 부분을 파싱하거나 의존하지 않는다.

### 조사한 파일 및 근거

**`packages/bridge/src/store.ts` (lines 24, 41, 181)**
`source` 는 `string | null` 타입으로 저장·반환된다. `addComment` 에서 `input.source ?? null` 로 그대로 저장할 뿐, 파싱하지 않는다.

**`packages/bridge/src/app.ts`**
`POST /comments` 는 `NewComment` body를 받아 `store.addComment(body)` 를 호출한다. `source` 에 대한 처리 없음 — 브리지는 불투명 문자열로만 취급.

**`packages/agent/src/commands.ts`**
`cmdPull` → `client.listComments()` 로 가져온 코멘트 배열을 JSON으로 출력. `source` 필드를 접근하거나 분리하지 않는다.

**`packages/agent/src/runners.ts` (lines 19–25)**
에이전트에 전달되는 `PROMPT` 는 고정 문자열이다. `rrw pull` 출력(JSON)을 LLM이 직접 읽으며, `source` 는 JSON 내 불투명 문자열로 전달된다. `split(":")` 등 파싱 없음.

**`packages/agent/src/pr.ts`**
`prContentFromComments` 는 `comment`, `author`, `url` 만 사용한다. `source` 미사용.

**`packages/agent/src/apply.ts`**
`ApplyComment` 인터페이스에 `source` 필드가 없다. PR 본문 생성에 `source` 불참여.

**`docs/PROTOCOL.md` (line 31) & `skills/rrw-process/SKILL.md` (line 47)**
두 문서 모두 `source` 를 `file:line:col` 형식으로 설명하지만, 이는 에이전트(LLM)가 읽어서 코드를 **찾는** 힌트일 뿐이다. 에이전트는 자연어로 `source` 값을 해석하므로 `file:line` 만 있어도 위치를 찾는 데 충분하다. 파이프라인 코드가 `:col` 을 split하거나 인덱스로 접근하는 부분은 전혀 없다.

**요약:** `source` 는 bridge→store→agent CLI까지 전 구간에서 불투명 문자열이다. `file:line:col` → `file:line` 으로 변경해도 파이프라인은 그대로 동작한다. 유일한 변화는 LLM이 받는 위치 힌트에서 열 번호가 빠지는 것이며, 에이전트는 파일+줄 번호만으로도 코드를 찾을 수 있다.

---

## #2–#7 실행 결과

> ⏳ **pending** — 실제 React 19 호스트 앱 + 로컬 브리지 기동 후 사람이 직접 확인해야 함.

각 항목의 PASS 기준은 위 표를 참고하고, 아래 란에 결과를 기록하세요.

| # | 테스트 날짜 | 테스터 | 결과 | 메모 |
|---|-------------|--------|------|------|
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |

---

## 선택적 후속 작업 (Task 8 Step 3)

스모크-테스트 #4(불필요한 chrome 없음)가 통과한 경우, react-grab의 네이티브
`selectionBox` / `elementLabel` 을 활성화해 호버 시 컴포넌트 이름을 floating 라벨로
보여줄 수 있다:

1. `grab-engine.ts` 의 `theme` 에서 `selectionBox: { enabled: true }`, `elementLabel: { enabled: true }` 로 변경
2. `import 'react-grab/styles.css'` 를 overlay에 추가 (Shadow DOM 안에서 적용)
3. 기존 highlight + 라벨이 중복되지 않는지 확인

이 작업은 **baseline이 아니며** #4 확인 전에는 진행하지 않는다.
