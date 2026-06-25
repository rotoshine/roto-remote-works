# 떠있는 오버레이 UI 공용 드래그 + 화면밖 방지 (clamp) + z-stacking

- 날짜: 2026-06-24
- 패키지: `packages/overlay`
- 상태: 설계 확정 (구현 계획 작성 대기)

## 1. 배경 / 문제

오버레이는 호스트 앱 위에 여러 떠있는 UI를 그린다. 현재 드래그 + 화면밖 방지(clamp)가
적용된 건 **드래프트 카드 하나뿐**이고, 그 카드조차 생성·드래그 시점에만 clamp되고
**창 리사이즈 시 재-clamp가 없다**.

나머지 떠있는 요소(코멘트 패널 / 진행 dock / 결과 배너)는 전부 CSS `fixed bottom-16 right-4`
**같은 좌표**라, 동시에 뜨면 **서로 겹쳐 쌓이고** 이동도 불가능하다.

요구: **모든 떠있는 UI 요소를 드래그로 옮길 수 있게 + 화면 밖으로 나가지 않게**.

## 2. 목표 / 비목표

### 목표
- 떠있는 UI 4종(드래프트 카드, 코멘트 패널, 진행 dock, 결과 배너)을 드래그로 이동.
- 모든 이동 요소가 화면 밖으로 나가지 않도록 clamp (생성 시 + 드래그 중 + **창 리사이즈 시**).
- 드래그 로직을 공용 `useDraggable` 훅으로 추출 (현재 인라인 중복 제거, 드래프트 카드도 이관).
- 처음 뜰 때 서로 다른 코너에 분산해 **기본 위치가 안 겹치게**.
- 드래그(상호작용)한 요소의 `z-index`를 올려 **겹쳐도 위로 쌓이게** (윈도우 매니저식 bring-to-front).

### 비목표 (YAGNI)
- 위치 **persistence 없음** — 세션 동안만 유지, 새로고침 시 기본 위치로.
- **FAB은 드래그 대상 아님** — 우하단 고정 앵커 버튼(클릭 전용)으로 유지.
- WebAskModal(중앙 모달), 하이라이트 박스(커서 추적)는 드래그 대상 아님.
- 터치/포인터 이벤트 확장 없음 — 기존 코드/테스트 컨벤션대로 **mouse 이벤트** 사용.

## 3. 접근법 결정

**채택: 공용 `useDraggable` 훅 + 명시적 그립 핸들.**

각 요소는 작은 그립/헤더 핸들을 잡아 이동하므로 내부 버튼·입력·링크는 그대로 클릭 가능하다.
기존 드래프트 카드의 `.rrw-draft-handle` 패턴과 일관된다.

대안과 기각 사유:
- **요소 전체 드래그(핸들 없음)**: 패널 내부 버튼/텍스트영역과 충돌, 상호작용 자식 제외 로직 필요 → 위험.
- **인라인 로직 복붙**: 4곳 중복, DRY 위반, 유지보수 악화.

## 4. 설계

### 4.1 순수 유틸 (`src/position.ts`, 기존 파일에 추가)

이미 `clampToViewport(pos, card, viewport, margin=12)`가 있고 테스트도 있다 (그대로 사용).

추가:
```ts
// z-index 할당기: 호출마다 1씩 증가. 드래그/상호작용 시 bring-to-front에 사용.
export function createZAllocator(base: number): () => number;
export const nextZ: () => number; // base = BASE_DRAG_Z 기본 인스턴스
```
- `BASE_DRAG_Z`는 카드 정적 z보다 위, **하이라이트(2147483100)·모달 backdrop 아래**.
- 순수 팩토리라 단위 테스트 용이(호출 시마다 증가 검증).

### 4.2 공용 훅 (`src/useDraggable.ts`, 신규)

```ts
useDraggable(opts: {
  size: Box;          // clamp용 근사 크기 { w, h }
  initial: Point;     // 기본 위치 (요소별 오프셋)
  margin?: number;    // 기본 12
}): {
  style: { left: number; top: number; zIndex: number };
  handleProps: { onMouseDown: (e: React.MouseEvent) => void };
}
```

동작:
- **마운트 시**: `pos = clampToViewport(initial, size, viewport())`.
- **handle onMouseDown**: `preventDefault` → `zIndex = nextZ()` (bring-to-front) →
  `document`에 `mousemove`/`mouseup` 부착 → 이동 중 `pos = clampToViewport(base + delta, size, viewport())`.
  `mouseup`에서 리스너 해제.
- **window `resize` 리스너**: 현재 `pos`를 재-clamp (드래프트 카드의 기존 갭 해결). 언마운트 시 해제.
- `viewport()` = `{ w: innerWidth, h: innerHeight }`.

### 4.3 적용 대상 (4종)

| 요소 | 핸들 | 기본 위치 | size(clamp) |
|---|---|---|---|
| 드래프트 카드 | 기존 `.rrw-draft-handle` (훅 이관) | 클릭한 요소 옆 (`{left: px, top: py+12}`, 기존 유지) | 288×200 |
| 코멘트 패널 | `.rrw-panel-head` (헤더) | 우하단 | 패널 근사값 |
| 진행 dock | `.rrw-dock`에 그립 바 추가 | 좌하단 | dock 근사값 |
| 결과 배너 | 왼쪽 그립(⠿) 추가 (링크·닫기는 클릭 유지) | 우상단 | 배너 근사값 |

- **기본 위치**는 마운트 시 viewport 기준으로 계산해 서로 다른 코너에 분산 → 처음부터 안 겹침.
  (우하단/좌하단/우상단/요소옆) — clamp가 좁은 화면도 보정.
- 드래그한 요소는 `nextZ()`로 z가 올라가 **겹쳐도 위로**.

**제외**: FAB(고정 앵커), WebAskModal(중앙 모달, `grid place-items-center`), 하이라이트(커서 추적).

### 4.4 CSS (`src/styles.css`)

- `.rrw-panel` / `.rrw-dock` / `.rrw-result`에서 위치 앵커(`bottom-16 right-4`) **제거** —
  이제 훅이 inline `left/top/zIndex` 공급. `.rrw-card`의 `position: fixed`는 유지(inline left/top이 적용되도록).
- 핸들에 `cursor: move` + 그립(⠿) 스타일 추가(드래프트 카드 그립과 동일 패턴).
- 진행 dock·결과 배너에 그립 핸들 마크업 추가.

## 5. 데이터 흐름 / 상태

- 각 떠있는 요소가 `useDraggable`를 호출 → 자체 `pos`/`zIndex` 보유(컴포넌트-로컬).
- 전역 공유 상태는 `nextZ()` 모듈 카운터 하나뿐 (bring-to-front 순서).
- 브리지/네트워크와 무관 — 순수 클라이언트 UI. apply 상태머신·신뢰 경계에 영향 없음.

## 6. 에러 / 엣지 케이스

- 매우 좁은 화면: clamp가 margin까지 당김(음수 방지). size가 viewport보다 크면 left/top은 margin으로 고정.
- 리사이즈로 화면이 줄어듦: resize 리스너가 현재 pos 재-clamp → 화면 밖 잔류 방지.
- 패널 내부 버튼 클릭: 핸들이 아닌 영역이므로 드래그 미발생, 클릭 정상.
- 결과 배너의 링크/닫기: 그립이 아니므로 클릭 정상.

## 7. 테스트 전략 (TDD Iron Law)

기존 컨벤션: vitest + @testing-library/react + jsdom, 드래그는 `fireEvent.mouseDown/mouseMove`.

순서(실패 테스트 → 최소 구현 → 리팩터):
1. **`position.test.ts`**: `createZAllocator`/`nextZ`가 호출마다 증가, base 반영 → 구현.
2. **`useDraggable.test.tsx`** (신규): 핸들 mousedown+mousemove 시 pos가 delta만큼 이동하되 clamp됨 /
   화면 밖으로 끌면 경계로 clamp / `resize` 이벤트 시 재-clamp / mousedown 시 zIndex가 `nextZ()`로 증가 → 훅 구현.
3. **`DesignCommentOverlay.test.tsx`**: 코멘트 패널·진행 dock·결과 배너가 각 핸들로 드래그되고 clamp됨 /
   드래그한 요소의 zIndex가 다른 요소보다 큼 / **기존 "드래프트 카드 핸들 드래그" 테스트는 유지**(훅 이관 후에도 통과) → 컴포넌트 배선.

게이트: `pnpm -r test` + `pnpm -r typecheck` 초록.

## 8. 변경 파일 요약

- `src/position.ts` — z 할당기 추가 (+ `position.test.ts`).
- `src/useDraggable.ts` (신규) + `src/useDraggable.test.tsx` (신규).
- `src/DesignCommentOverlay.tsx` — 드래프트/패널/결과 배너에 훅 적용, 인라인 `startDraftDrag` 제거, 기본 위치 계산.
- `.rrw-dock` 래퍼(`DesignCommentOverlay.tsx`) — 그립 핸들 마크업 추가. **`ProgressPanel.tsx`는 변경하지 않음**(래퍼에 핸들).
- `src/styles.css` — 위치 앵커 제거, 핸들 cursor/그립 스타일.
- `src/DesignCommentOverlay.test.tsx` — 패널/결과/진행 드래그·z-stacking 테스트 추가.

## 9. 위험 / 미해결

- size(clamp용 근사 크기)는 가변 콘텐츠라 근사값 사용 — 패널/배너 높이는 보수적으로 잡고 clamp margin이 흡수.
- z 범위 상한: 하이라이트(2147483100)/모달 backdrop과 충돌 안 하도록 `BASE_DRAG_Z` 설정.
