# Contributing to homebridge-hiot-autoever

기여 환영합니다. 본 프로젝트는 Hi-oT(현대오토에버) KOCOM 월패드 단지의 디바이스를 HomeKit에 미러링하는 비공식 커뮤니티 플러그인입니다.

## 기여 형태

- **버그 신고**: [bug 보고 Issue](https://github.com/ywkim/homebridge-hiot-autoever/issues/new?template=bug_report.yml)
- **디바이스 동작 보고** ("우리 단지에서 됐어요/안 됐어요"): [device 보고 Issue](https://github.com/ywkim/homebridge-hiot-autoever/issues/new?template=device_report.yml). 호환 단지 표를 채우는 데 큰 도움이 됩니다.
- **신규 디바이스 타입·기능 추가**: 아래 TDD 워크플로를 따라 PR 보내주세요.
- **문서·번역 개선**: 가벼운 오타 수정도 환영.

## TDD 워크플로

본 프로젝트는 TDD를 강제합니다. **신규/수정 코드에 테스트가 없으면 CI가 차단합니다.**

1. 신규 기능이면 `test/`에 **실패하는 테스트**를 먼저 작성합니다.
2. `npm test` 로 실패를 확인합니다.
3. `src/`에 최소 구현을 추가해 통과시킵니다.
4. 리팩터링 후 다시 통과 확인.
5. 커밋·푸시.

## 로컬 개발

```bash
npm install
npm test            # vitest watch
npm run test:ci     # 단발 + coverage
npm run lint
npm run typecheck
npm run build
npm run watch       # tsc --watch (코드 변경 시 자동 빌드 — Homebridge는 수동 재시작)
```

Homebridge에 실제로 연결해 확인하려면:

```bash
npm run build
sudo npm link
homebridge -D
```

## 코드 스타일

- TypeScript strict 모드
- ESLint + Prettier 룰을 따릅니다 (`npm run lint` 통과 필수)
- `any` 사용 자제
- HomeKit 캐릭터리스틱 매핑은 `src/accessories/<type>.ts` 한 파일에 응집

## 커밋·PR 규칙

- 커밋 메시지는 `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:` 접두어를 사용합니다 (`git log --oneline` 참조).
- PR은 작게, 한 번에 하나의 디바이스 타입 또는 기능을 다룹니다.
- 안전 영향이 큰 동작(EV 호출, 일괄소등, 가스밸브 관련)을 추가/변경하는 PR은 PR 본문에 반드시 영향 범위를 명시해 주세요.
- PR 템플릿의 체크리스트(테스트 추가, 문서 갱신, 안전 영향 표기)를 모두 채워주세요.

## 노출 원칙 (정책)

[`CLAUDE.md`](./CLAUDE.md)와 [README의 "안전 정책"](./README.md#안전-정책-꼭-읽어주세요) 섹션을 먼저 읽어주세요. **Hi-oT 앱이 노출하는 모든 기능을 HomeKit에 1:1 미러링**하는 것이 1차 기준이고, 별도 trade-off가 필요하면 PR 단위로 논의합니다.

## 자격증명 처리

- 캡처·테스트 fixture를 첨부할 때 `userid`, `userkeyvalu`, `JSESSIONID`, 평문 비밀번호, 디바이스명에 포함된 동·호수 정보 등은 반드시 마스킹합니다.
- 보안 이슈는 공개 Issue가 아니라 [SECURITY.md](./SECURITY.md)에 명시된 경로로 보고해 주세요.

## 행동 규칙

서로 존중하는 톤을 유지합니다. 비방·차별·괴롭힘은 허용되지 않습니다.
