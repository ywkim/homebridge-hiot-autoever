# homebridge-hiot-autoever

[![npm version](https://img.shields.io/npm/v/homebridge-hiot-autoever.svg)](https://www.npmjs.com/package/homebridge-hiot-autoever) [![CI](https://github.com/ywkim/homebridge-hiot-autoever/actions/workflows/ci.yml/badge.svg)](https://github.com/ywkim/homebridge-hiot-autoever/actions/workflows/ci.yml)

Homebridge plugin for **Hi-oT (Hyundai Autoever)** — KOCOM wallpad-based Korean
apartments (힐스테이트 / 올림픽파크포레온 등). Connects to the Hi-oT cloud
(`https://home.hiot.autoever.com`) via cloud login + REST polling.

> Status: early scaffold. Not yet functional.

## Installation

```bash
npm install -g homebridge-hiot-autoever
```

Then configure via the Homebridge UI or `config.json`:

```json
{
  "platforms": [
    {
      "platform": "HiotAutoever",
      "userid": "<your hiot id>",
      "password": "<your hiot password>",
      "pollInterval": 30
    }
  ]
}
```

## Development

```bash
npm install
npm test            # vitest watch
npm run test:ci     # single run + coverage
npm run lint
npm run typecheck
npm run build
```

## License

Apache-2.0
