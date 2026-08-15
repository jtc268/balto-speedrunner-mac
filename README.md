<p align="center">
  <img src="src/balto-mark.svg" width="92" alt="Balto Speedrunner mark" />
</p>

# Balto Speedrunner for Mac

Qwen 3.8 27B at up to 3x the speed on Apple Silicon, wrapped in a complete local coding agent. Install one native Mac app; Balto downloads, verifies, configures, and launches everything else.

No Homebrew, Docker, Terminal setup, cloud model account, or subscription is required. Inference and tools run locally. The only network use is the first runtime/model download, explicit web tool calls, and signed update checks.

## What users get

- Qwen 3.8 27B 4-bit with the measured Balto Turbo D3 configuration.
- A beautiful embedded coding workspace based on DeepSeek Harness.
- Real terminal and filesystem tools, full-Mac access mode, resumable jobs, and coding workflows.
- Vision through the same Qwen 3.8 27B route: attach an image or let the agent read a screenshot.
- Subscription-free public web search and public-page fetch, with private-network requests blocked.
- Optional Mac computer use: screenshot, click, type, keyboard shortcuts, and browser launch.
- Live token-per-second telemetry in the workspace and an MTPLX speed footer on responses.
- Signed in-app updates, with model files preserved across app updates.
- Hard lifecycle ownership: closing or quitting Balto stops its engine, gateway, harness, tools, and active setup process.

## Measured speed

Our reproducible warm tune on an M5 Max with 128 GB unified memory and Qwen 3.8 27B 4-bit measured:

| Lane | Decode | End to end | Relative end-to-end speed |
| --- | ---: | ---: | ---: |
| Autoregressive baseline | 28.7 tok/s | 27.9 tok/s | 1.00x |
| Balto Turbo D1 | 53.8 tok/s | 51.3 tok/s | 1.84x |
| Balto Turbo D2 | 80.3 tok/s | 74.4 tok/s | 2.66x |
| Balto Turbo D3 | **92.5 tok/s** | **84.7 tok/s** | **3.03x** |

Those are controlled warm-generation results. Real agent turns vary with prompt length, Qwen's draft acceptance, tool calls, vision, thermal state, and prefix-cache reuse. Balto shows the actual live rate instead of promising every response will run at the headline number.

For a quick fixed-prompt check against a running local stack, use `npm run benchmark:local`. The August 15 release smoke on the same M5 Max measured 74.7 tok/s for Turbo D3 versus 26.1 tok/s for AR on its production-quality Python continuation (2.86x end to end).

## Supported Macs

Balto requires:

- Apple Silicon: M1, M2, M3, M4, or M5 family.
- macOS 14 Sonoma or newer.
- At least 32 GB unified memory; 48 GB or more is recommended.
- About 28 GB free for the app-owned runtime, Qwen model, and working cache.

Base Macs with less than 32 GB are not supported by this 27B edition. Approximate warm decode expectations below are planning ranges, not guarantees:

| Mac class | Memory | Expected warm decode |
| --- | ---: | ---: |
| M1/M2 Pro or Max | 32 GB+ | 15-40 tok/s |
| M3/M4/M5 Pro | 36 GB+ | 20-50 tok/s |
| M3/M4/M5 Max | 48 GB+ | 35-90 tok/s |
| M1/M2/M3/M4 Ultra | 64 GB+ | 40-100 tok/s |

Balto automatically sizes usable context to memory: 32K at 32-47 GB, 64K at 48-63 GB, 131K at 64-95 GB, and up to 262K at 96 GB or more.

## One-click setup

The DMG contains the native Balto shell plus pinned ARM64 Node and `uv` bootstrap runtimes. On first launch Balto:

1. Confirms Apple Silicon, macOS, unified memory, and disk space.
2. Creates its private runtime and cache under the app's local data directory.
3. Installs pinned MTPLX 2.6.0 and DeepSeek Harness 0.1.0-rc.6 without changing system packages, and creates the permission-free `~/Balto` workspace.
4. Reuses the exact verified Qwen 3.8 language weights if MTPLX already has them; otherwise downloads them with resume support, then adds the revision-pinned native Qwen 3.8 vision tower (about 17 GB total).
5. Loads Qwen with Turbo, native MTP, depth 3, native tool prompting, standard sampling, and a context tier sized to the Mac.
6. Opens the coding workspace inside the same native app window.

Accessibility and Screen Recording are optional macOS permissions. Users only need them for computer-control tasks; coding, local terminal tools, vision uploads, and web search work without them.

## Development

Requirements: Apple Silicon, macOS 14+, Node 22, and Rust stable.

```bash
npm install
npm run check
npm test
npm run build
```

`npm run build` downloads and checksum-verifies the pinned ARM64 Node and `uv` bootstrap binaries before Tauri creates the `.app` and `.dmg`.

## Signing and releases

Customer releases use three protections:

1. Developer ID Application signing identifies Adore LLC to Gatekeeper.
2. Apple notarization and stapling let a downloaded DMG open cleanly.
3. Tauri updater signatures authenticate every in-app update artifact.

The release workflow expects Apple signing/notarization secrets and the Tauri updater private key. It publishes through the separate `jtc268/balto-speedrunner-mac` repository.

## License and credits

Balto Speedrunner is copyright 2026 Adore LLC. All rights reserved.

Powered by [MTPLX by Youssof Altoukhi](https://github.com/youssofal/MTPLX), licensed under Apache-2.0. The coding harness integrates MIT-licensed software from DeepSeek AI. Apple MLX and Qwen model weights retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Balto Speedrunner is not affiliated with or endorsed by DeepSeek, Qwen, Alibaba, Apple, MLX, MTPLX, Hugging Face, or OpenAI.
