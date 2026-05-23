# Changelog

본 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 사용합니다.

## [Unreleased]

### Added

- README 마케팅 리뉴얼: 지원 디바이스 표, Hi-oT 앱 비교, 안전 정책, 문제 해결 섹션 추가.
- `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, Issue/PR 템플릿, `ROADMAP.md` 추가.
- `package.json` 에 `homepage`/`repository`/`bugs` 메타데이터 및 검색 키워드 확장.

### Fixed

- README 의 `config.json` 예시에서 잘못된 키 `pollInterval` 을 실제 스키마인 `pollingIntervalMs` (밀리초 단위, 기본 30000)로 수정.

## [0.0.0] — initial scaffold

다음 기능이 구현되었습니다 (커밋 이력 기준):

- DynamicPlatformPlugin (`src/platform.ts`) — `didFinishLaunching` 에서 로그인, 디바이스 목록 조회, PlatformAccessory 등록/제거/복원.
- HTTP 클라이언트 (`src/api/client.ts`) — undici fetch + tough-cookie 쿠키 jar, 401 자동 재로그인.
- 토큰 영속화 (`src/storage/tokenStore.ts`) — `userkeyvalu` 디스크 캐시.
- 백그라운드 폴러 (`src/poller.ts`) — `getDevice(devicecd)` 주기 호출 → `Characteristic.updateValue` 캐시 갱신. `onGet` slow 경고 제거.
- 액세서리 핸들러 — LGT (Lightbulb), WSK (Outlet), SWT (Switch), ACB (HeaterCooler), VNT (Fan v2), HTR (Thermostat), GDK (LockMechanism read-only).
- GDK 가스밸브 안전 정책 — Hi-oT 앱·백엔드와 동일하게 unlock UI 차단.

[Unreleased]: https://github.com/ywkim/homebridge-hiot-autoever/compare/HEAD...HEAD
