<p align="center">
  <img src=".github/assets/readme-hero.svg" width="100%" alt="Balto Speedrunner — triple Qwen 3.8 27B inference speed on Mac" />
</p>

<h1 align="center">Triple Your Qwen 3.8 27B Inference Speed on Mac</h1>

<p align="center">
  <strong>A high-speed, fully local coding agent for Apple Silicon.</strong><br />
  One beautiful native app. No Docker. No Homebrew. No cloud model. No subscription.
</p>

<p align="center">
  <img alt="macOS 14+" src="https://img.shields.io/badge/macOS_14%2B-Apple_Silicon-11131A?style=for-the-badge&logo=apple&logoColor=white" />
  <img alt="Qwen 3.8 27B" src="https://img.shields.io/badge/Qwen_3.8-27B-8F5CFF?style=for-the-badge" />
  <img alt="MLX native" src="https://img.shields.io/badge/MLX-Native-19BFFF?style=for-the-badge" />
  <img alt="Local and private" src="https://img.shields.io/badge/Inference-Local_%26_Private-24D49A?style=for-the-badge" />
</p>

<p align="center">
  <a href="#speed-you-can-see"><strong>Benchmarks</strong></a> ·
  <a href="#a-complete-agent-not-just-a-chat-box"><strong>Agent tools</strong></a> ·
  <a href="#one-click-zero-ceremony"><strong>Setup</strong></a> ·
  <a href="#supported-macs"><strong>Supported Macs</strong></a>
</p>

---

Balto Speedrunner turns **Qwen 3.8 27B 4-bit** into a complete local coding environment tuned for Apple Silicon. It packages the measured MTPLX Turbo D3 path, native vision, DeepSeek Harness, terminal access, web tools, and Mac computer control behind one app icon.

> [!IMPORTANT]
> **The headline is measured, not estimated.** A controlled warm run on an M5 Max reached **84.7 end-to-end tok/s** with Balto Turbo D3 versus **27.9 tok/s** autoregressive—**3.03× the baseline**. Real turns vary, so Balto shows live tok/s on every response.

## Why Balto feels different

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>⚡ Actually fast</h3>
      Native MLX inference, MTP speculation, depth-3 drafting, prefix caching, and memory-aware context sizing—preconfigured and ready.
    </td>
    <td width="33%" valign="top">
      <h3>🧠 The full 27B model</h3>
      The exact Qwen 3.8 27B text model, plus its matching native vision tower. No silent swap to a smaller vision model.
    </td>
    <td width="33%" valign="top">
      <h3>🛠️ A real coding agent</h3>
      Terminal, files, web search, page fetch, screenshots, mouse, keyboard, browser launch, and resumable coding jobs.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>🔒 Local by default</h3>
      Prompts, files, inference, and tool decisions stay on your Mac. Network access is limited to downloads, updates, and web tools you invoke.
    </td>
    <td width="33%" valign="top">
      <h3>🖥️ Native Mac experience</h3>
      One movable macOS window, a proper Dock icon, voice-dictation-friendly input, live speed telemetry, and no duplicate browser UI.
    </td>
    <td width="33%" valign="top">
      <h3>🧊 Clean lifecycle</h3>
      Close Balto and every Balto-owned model, gateway, harness, setup process, and helper stops. Your fans are not left spinning.
    </td>
  </tr>
</table>

## Speed you can see

Reproducible warm-generation results on an **M5 Max with 128 GB unified memory**:

| Inference lane | Decode | End-to-end | Relative end-to-end speed |
| :--- | ---: | ---: | ---: |
| Autoregressive baseline | 28.7 tok/s | 27.9 tok/s | 1.00× |
| Balto Turbo D1 | 53.8 tok/s | 51.3 tok/s | 1.84× |
| Balto Turbo D2 | 80.3 tok/s | 74.4 tok/s | 2.66× |
| **Balto Turbo D3** | **92.5 tok/s** | **84.7 tok/s** | **3.03×** |

The production-path August 15 smoke test measured **74.7 tok/s** for Turbo D3 versus **26.1 tok/s** for autoregressive generation—**2.86× end to end**. Run the same fixed-prompt check against a local stack with:

```bash
npm run benchmark:local
```

Performance changes with prompt length, draft acceptance, thermal state, vision, tool calls, and prefix-cache reuse. That is why the app reports the **actual token rate beneath every response** instead of hiding behind a lab number.

## A complete agent, not just a chat box

| Capability | Included | How it works |
| :--- | :---: | :--- |
| Terminal and filesystem | ✅ | Execute commands, inspect projects, edit files, run tests, and resume jobs |
| Web search and page fetch | ✅ | Subscription-free public search and fetching with private-network blocking |
| Native Qwen vision | ✅ | Attach images or let the agent inspect a Mac screenshot |
| Mac computer control | ✅ | Screenshot, click, type, hotkeys, and browser launch with optional permissions |
| Long context | ✅ | Automatically sized from 32K to 262K based on unified memory |
| Live performance telemetry | ✅ | Per-response tok/s, token count, decode time, and persistent speed meter |
| Automatic updates | ✅ | Signed Tauri updater artifacts without deleting the model cache |
| Hard-stop on close | ✅ | No orphaned inference servers, helpers, jobs, or fan overrides |

## One click. Zero ceremony.

Drop Balto into Applications and launch it. On first run, the app does the rest:

```text
Balto.dmg
   └── Verify this Mac
       └── Install pinned ARM64 runtime
           └── Download or reuse Qwen 3.8 27B
               └── Add the matching Qwen 3.8 vision tower
                   └── Tune context + Turbo D3
                       └── Open the local coding workspace
```

Balto installs pinned MTPLX and DeepSeek Harness components inside its own application data directory. It does **not** replace system Python, change Homebrew packages, or require a Terminal walkthrough. Downloads resume after interruption, and existing verified model weights can be reused through an APFS clone.

The app-owned model and vision files use roughly **17 GB**. Allow about **28 GB free** for the complete runtime, model, and working cache.

## Supported Macs

| Mac | Unified memory | Expected warm decode |
| :--- | ---: | ---: |
| M1 / M2 Pro or Max | 32 GB+ | 15–40 tok/s |
| M3 / M4 / M5 Pro | 36 GB+ | 20–50 tok/s |
| M3 / M4 / M5 Max | 48 GB+ | 35–90 tok/s |
| M1 / M2 / M3 / M4 Ultra | 64 GB+ | 40–100 tok/s |

**Requirements:** Apple Silicon, macOS 14 Sonoma or newer, and at least 32 GB unified memory. **48 GB or more is recommended.** Intel Macs and Apple Silicon Macs below 32 GB are not supported by this 27B edition.

Balto sizes context automatically:

- **32–47 GB:** 32K context
- **48–63 GB:** 64K context
- **64–95 GB:** 131K context
- **96 GB+:** up to 262K context

These ranges are planning guidance, not guaranteed rates. Memory bandwidth, thermals, active apps, context length, and acceptance rate all matter.

## Local means local

- **No inference subscription.** Qwen runs on the Mac.
- **No cloud model account.** No OpenAI, Anthropic, or hosted inference key is required.
- **No metered web-search plan.** The built-in public search and fetch path is subscription-free.
- **No mystery background daemon.** Quitting the app stops the stack it owns.
- **No model re-download after normal updates.** The cache survives application upgrades.

The network is used for first-time runtime/model downloads, signed update checks, and explicit web tool calls. Accessibility and Screen Recording are requested only when computer-control features need them.

## Development

Requirements: Apple Silicon, macOS 14+, Node 22, and Rust stable.

```bash
npm install
npm run check
npm test
npm run build
```

`npm run build` downloads and checksum-verifies the pinned ARM64 Node and `uv` bootstrap binaries before Tauri creates the app and DMG.

<details>
<summary><strong>Signing and release architecture</strong></summary>

Customer releases use three independent protections:

1. **Developer ID Application signing** identifies Adore LLC to Gatekeeper.
2. **Apple notarization and stapling** allow a downloaded DMG to open cleanly.
3. **Tauri updater signatures** authenticate every in-app update artifact.

The release workflow imports the distribution certificate into an ephemeral CI keychain, builds the ARM64 bundle, submits it for notarization, staples Apple's ticket, signs the updater metadata, and creates a GitHub release.

</details>

## Credits

Balto Speedrunner is copyright 2026 Adore LLC. All rights reserved.

Powered by [MTPLX by Youssof Altoukhi](https://github.com/youssofal/MTPLX), licensed under Apache-2.0. The coding harness integrates MIT-licensed software from DeepSeek AI. Apple MLX and Qwen model weights retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Balto Speedrunner is not affiliated with or endorsed by DeepSeek, Qwen, Alibaba, Apple, MLX, MTPLX, Hugging Face, or OpenAI.
