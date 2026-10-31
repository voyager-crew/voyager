# Development Setup

## Install Dependencies

```bash
bun install
```

## Available Commands

| Command               | Description                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bun run dev`         | Start Chrome development mode with automatic rebuilds and extension self-reload (open tabs are not reloaded) |
| `bun run dev:firefox` | Start Firefox development mode                                                                               |
| `bun run dev:safari`  | Start Safari development mode (macOS only)                                                                   |
| `bun run build`       | Production build for Chrome                                                                                  |
| `bun run build:edge`  | Standalone Edge build and package                                                                            |
| `bun run build:all`   | Chrome + Firefox + Safari builds                                                                             |
| `bun run lint`        | Run oxlint with auto-fix                                                                                     |
| `bun run typecheck`   | Run TypeScript type checking                                                                                 |
| `bun run test`        | Run test suite                                                                                               |
| `bun run verify:pr`   | Standard local PR automation                                                                                 |

## Loading the Extension

1. Run `bun run dev` to start the development build
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist_chrome_dev` folder

---
