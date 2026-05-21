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

## Architecture

- DynamicPlatformPlugin: `src/platform.ts`
- HTTP 클라이언트: `src/api/client.ts` — undici fetch + tough-cookie, 401 자동 재로그인 (TODO)
- Accessory 매핑: `src/accessories/*` — HomeKit Service per Hi-oT device type (TODO)
- 폴링: `src/poller.ts` — setInterval, 외부 상태 변화 감지 (TODO)

## 자격증명 처리 원칙

- `userid`/`password`는 Homebridge `config.json`에서만 읽음
- 로그 출력 금지: `userkeyvalu`, `JSESSIONID`, 평문 패스워드
  - TODO: pino redact paths 설정 (API client worktree에서 구현)
- 테스트 fixture: 캡처 사용 시 식별 정보 마스킹
- GDK 가스밸브: **Discovery 자체에서 제외** (HomeKit 미노출).
  안전 보장(우발 열기 차단) + UX 정리(빈 accessory 제거). handler 구현 시에도 HomeKit `Characteristic.Active = ACTIVE` (값 `1`) 명령은 무조건 차단.
