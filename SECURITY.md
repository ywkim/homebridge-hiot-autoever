# Security Policy

## 자격증명 처리 원칙

본 플러그인은 Hi-oT 클라우드 계정 자격증명을 사용합니다. 다음 규칙을 적용합니다.

- `userid`, `password` 는 Homebridge `config.json`에서만 읽으며, 다른 곳으로 전송되지 않습니다.
- 첫 로그인 성공 시 서버가 발급한 `userkeyvalu` 토큰을 `src/storage/tokenStore.ts`가 로컬에 캐시합니다. 이후 로그인은 토큰 기반으로 동작하며 평문 비밀번호는 거의 사용되지 않습니다.
- 로그에서는 다음 값이 마스킹됩니다:
  - `userkeyvalu`
  - `JSESSIONID`
  - 평문 비밀번호
- `debugLogging: true` 로 verbose 로그를 켜도 위 값들은 동일하게 마스킹됩니다.

## 권장 운영

- Homebridge가 동작하는 호스트의 디스크 접근 권한을 최소화하세요. 토큰 캐시 파일은 호스트의 사용자 권한으로 보호됩니다.
- 가능하면 Hi-oT 앱에서 본 플러그인 전용 부계정을 만들고 공유 권한을 분리하세요.
- HomeKit의 사용자 초대(Home App "사용자 초대")로 가족 권한을 분리하면, Hi-oT 계정을 공유하지 않고도 다른 가족 구성원이 디바이스를 제어할 수 있습니다.

## 취약점 보고

플러그인의 보안 취약점을 발견하셨다면 **공개 GitHub Issue를 열지 마세요**. 대신:

- GitHub의 [Private Vulnerability Reporting](https://github.com/ywkim/homebridge-hiot-autoever/security/advisories/new) 폼을 사용해 주세요.

보고에 다음을 포함하면 빠른 대응에 도움이 됩니다:

- 영향 범위 (자격증명 유출 / 권한 우회 / DoS 등)
- 재현 절차
- 영향을 받는 버전·구성

가능한 한 빨리 회신하고, 영향이 큰 사안이면 비공개 패치 후 advisory 형태로 공개합니다.

## 범위 외

- Hi-oT 백엔드 자체의 취약점은 본 플러그인이 다룰 수 있는 범위가 아닙니다. 현대오토에버 측에 직접 보고해 주세요.
- HomeKit/Homebridge 자체의 취약점은 각 프로젝트에 보고해 주세요.
