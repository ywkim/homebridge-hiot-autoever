# CLAUDE.md

## Project

homebridge-hiot-autoever — Homebridge plugin for Hi-oT (Hyundai Autoever)
KOCOM wallpad-based Korean apartments. Cloud login + REST polling.

## Commands

- `npm install` — 의존성 설치
- `npm test` — Vitest watch (TDD)
- `npm run test:ci` — 단발 + coverage
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — TS → dist/
- `npm run watch` — TS + Homebridge 재시작 (개발용, `npm link` 필요)

## TDD Workflow

1. 신규 기능 → `test/` 에 실패 테스트 먼저
2. `npm test` 실패 확인
3. `src/` 최소 구현 → 통과
4. 리팩터 + 통과 재확인
5. 커밋

PR은 신규/수정 코드에 테스트 없으면 CI 차단.

## Commit 규칙

**Conventional Commits 필수.** main push가 semantic-release를 트리거하며, 커밋 메시지로 version bump를 분류한다. 비-Conventional 커밋은 release에서 silent skip되거나 오분류된다.

- 타입: `feat` / `fix` / `refactor` / `docs` / `chore` / `test` / `ci` / `build` / `perf` / `style`
- BREAKING CHANGE: `feat!: ...` 또는 body에 `BREAKING CHANGE:` 줄
- PR squash 머지 시 PR title이 단일 커밋 메시지로 들어가므로 PR title도 Conventional Commits 형식 준수

## Architecture

- DynamicPlatformPlugin: `src/platform.ts`
- HTTP 클라이언트: `src/api/client.ts` — undici fetch + tough-cookie, 401 자동 재로그인
- Accessory 매핑: `src/accessories/*` — HomeKit Service per Hi-oT device type
- 폴링: `src/poller.ts` — Homebridge "Background polling" 패턴. 핸들러는 onGet을
  등록하지 않고, 폴러가 `client.getDevice(devicecd)`를 주기적으로 호출해 각
  핸들러의 `updateState(res)`로 `Characteristic.updateValue` cache 갱신. HomeKit은
  cache만 읽으므로 onGet "slow" 경고와 중복 호출이 사라진다.

## 자격증명 처리 원칙

- `userid`/`password`는 Homebridge `config.json`에서만 읽음
- 로그 출력 금지: `userkeyvalu`, `JSESSIONID`, 평문 패스워드
  - TODO: pino redact paths 설정 (API client worktree에서 구현)
- 테스트 fixture: 캡처 사용 시 식별 정보 마스킹

## 노출 원칙

**Hi-oT 앱이 노출하는 모든 기능을 HomeKit에 1:1 미러링.** plugin은 단순 미러 역할이며, EV호출·일괄소등 등 안전 영향이 큰 동작도 차단 가드 없이 그대로 노출한다. 안전 책임은 Hi-oT 앱과 동일하게 사용자가 진다.

GDK(가스밸브): Hi-oT 앱이 unlock UI 자체를 차단하므로(안전상의 이유로 모바일에서 가스밸브 open 불가, 백엔드도 `lock='on'` set 요청을 거부), HomeKit도 `LockTargetState.setProps({ validValues: [SECURED] })`로 unlock 버튼을 비활성화한다. 가스밸브를 열려면 Hi-oT 앱이 아닌 물리적 수단(주방 벽패드, 수동 레버)을 사용해야 한다. 백엔드 값 의미: `lock='off'`=잠금(SECURED), `lock='on'`=열림(UNSECURED).

이 원칙은 plugin scope·정책 의사결정의 단순화를 위한 1차 기준이다. 별도 trade-off가 발생하면 PR 단위로 논의.
