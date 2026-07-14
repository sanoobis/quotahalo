# QuotaHalo

QuotaHalo is a private, local Windows dashboard for live AI coding-session token usage and quota limits. It reads local Codex Desktop session events and turns them into a polished, resizable, always-on-top monitor.

> QuotaHalo is an unofficial community project. It is not affiliated with, endorsed by, or sponsored by OpenAI.

![QuotaHalo icon](assets/icon.png)

## Features

- Current request context usage against the reported model context window
- Session input, output, cached input, reasoning output, and total tokens
- Remaining quota windows reported for the signed-in Codex account, with live countdowns and local reset times
- Explicit `N/A` state when Codex does not report a 5-hour or Weekly window—never a misleading blank gauge
- Recent context activity and session switching
- Full, Compact, and space-efficient Mini window modes
- Mini mode adapts its width: tightly spaced equal Context, 5-hour, and Weekly rings, or a wider context-focused layout
- Choose whether Mini displays both quota windows or only the 5-hour/Weekly window
- Hide the context indicator for a focused 5-hour + Weekly limits-only Mini panel
- Drag the window from any non-interactive surface
- Manual title-bar refresh with loading feedback
- Always-on-top pin, system tray, remembered position, and adjustable opacity
- Non-blocking background scans, lossless refresh queuing, and instant refresh after restore
- Built-in `npm run health` diagnostic for session-store performance and the live Codex quota feed
- Midnight, graphite, and light themes with four accent colors
- Configurable local sessions folder and refresh interval

The context card uses `last_token_usage`. Session metric cards use the cumulative `total_token_usage` reported for that session. QuotaHalo does not estimate pricing.

## Privacy

QuotaHalo does not include analytics, telemetry, or its own account system.

Context and token totals come from local session metadata and `token_count` events. Quotas are refreshed through the installed Codex app-server's account rate-limit method, which may contact OpenAI using the Codex session already present on the device. QuotaHalo never reads authentication files, and prompts, assistant responses, credentials, and tool output are not exposed to the renderer or transmitted by QuotaHalo.

By default, QuotaHalo reads:

```text
%USERPROFILE%\.codex\sessions
```

If `CODEX_HOME` is set, its `sessions` directory is used instead. You can choose another source in Settings.

## Install

Download the latest portable Windows executable from the repository's **Releases** page and run it. Windows may show a SmartScreen warning until public releases are signed and establish reputation.

For development:

```powershell
npm install
npm start
```

## Test and build

```powershell
npm test
npm run health:strict
npm run stress
npm run dist
```

The Windows artifact is written to `release/QuotaHalo-<version>-x64.exe`.

## Keyboard and window controls

- `Ctrl+R`: refresh now
- `Esc`: close Settings
- Window-size button: cycle Full → Compact → Mini
- Closing the window: hide to the system tray by default
- Tray menu: show/hide, window size, pin, refresh, or quit

## Compatibility

QuotaHalo supports the local JSONL session format produced by Codex Desktop and the installed Codex app-server rate-limit method, with JSONL quota events as a fallback. Account plans do not always report the same windows; an unavailable window is labeled `N/A` with an explanation. Please open an issue if a Codex update breaks detection.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Security issues should be reported according to [SECURITY.md](SECURITY.md), not opened publicly.

## License and marks

Source code is licensed under [GPL-3.0-only](LICENSE). Copyright © 2026 sanoobis.

The QuotaHalo name and logo are reserved marks of sanoobis and are not granted for use by the GPL license except as necessary to describe the origin of the software. See [TRADEMARKS.md](TRADEMARKS.md).
