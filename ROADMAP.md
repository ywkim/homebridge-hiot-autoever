# Roadmap

본 문서는 다음 작업 후보를 추적합니다. 우선순위는 사용자 보고·기여 의향에 따라 바뀝니다.

## 디바이스 타입 확장

Hi-oT 앱이 노출하는 모든 기능을 1:1 미러링하는 것이 목표입니다. 다음 타입들은 아직 미구현입니다.

- **엘리베이터 호출** — Hi-oT 앱의 호출 버튼 미러링. HomeKit Switch 또는 Stateless Programmable Switch로 구현 후보.
- **일괄소등** — 현관 일괄소등 버튼. HomeKit Scene 또는 Switch 후보.
- **방문자/공용 인터폰** — 호출 알림·도어락 등.
- **세대 환기 모드/풍량** — VNT 디바이스의 fan speed 단계.
- **난방 0.5 °C 정밀도** — 현재 1 °C 단위. Hi-oT가 0.5 °C를 받는지 확인 후.
- **AC 모드 확장** — 현재 COOL만. Hi-oT 앱이 HEAT/AUTO/DEHUMIDIFY를 노출하는 단지가 있다면 추가 확인 필요.

## 기능 강화

- **LGT 디밍·색온도** — Hi-oT 측에서 노출하는 단지·디바이스에 한해 Brightness/ColorTemperature 캐릭터리스틱 추가.
- **HomeKit Adaptive Lighting** — 디밍/색온도가 들어간 이후 후속.
- **푸시 기반 상태 갱신** — 현재는 폴링 전용. Hi-oT가 push 채널을 노출하면 폴링 부하 감소 가능.
- **로그인 실패 자가 진단** — 비밀번호 오류·계정 잠금·2FA 등 케이스별 로그 메시지 개선.

## 운영·배포

- **npm 배포** — 현재는 GitHub 클론 + `npm link`. 안정화 후 `npm publish`.
- **Homebridge Verified Plugin 등록** — 사용성·신뢰도 향상.
- **자동화된 E2E 테스트** — 캡처 기반 통합 테스트로 단지 호환성 회귀 방지.

## 문서

- 호환 단지 표 — 사용자 device 보고가 모이면 README에 추가.
- 자동화 레시피 모음 — "외출 시 일괄소등", "취침 시 환기 끄기" 등 예제.
- 영문 README 분리 — 현재 한 README 안에 TL;DR로만 영문 포함.

기여 의향이 있으시면 Issue를 먼저 열어 논의해 주세요. [CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요.
