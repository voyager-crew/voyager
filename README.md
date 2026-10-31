<div align="center">
  <img src="docs/public/logo.png" alt="Voyager logo" width="112" height="112">
  <h1>Voyager</h1>
  <p><b>Make every AI chat yours.</b></p>
  <p>Folders, a timeline, export and formula copy on Gemini, AI Studio, ChatGPT, Claude, DeepSeek and Kimi,<br>each one a plugin. Yours can be one too: a few lines of JSON, no code.</p>

  <p>
    <img src="https://voyager.nagi.fun/badges/github-stars.svg" alt="GitHub stars">
    <img src="https://voyager.nagi.fun/badges/github-forks.svg" alt="GitHub forks">
    <img src="https://voyager.nagi.fun/badges/github-release.svg" alt="Latest version">
    <img src="https://voyager.nagi.fun/badges/github-downloads.svg" alt="GitHub downloads">
    <a href="https://chromewebstore.google.com/detail/iifacdnjakkhjjiengaffnegbndgingi?utm_source=github&utm_medium=readme&utm_campaign=organic_growth&utm_content=en" target="_blank"><img src="https://img.shields.io/chrome-web-store/users/iifacdnjakkhjjiengaffnegbndgingi?style=flat-square&logo=googlechrome&label=chrome%20users" alt="Chrome Web Store users"></a>
    <a href="https://microsoftedge.microsoft.com/addons/detail/voyager/gibmkggjijalcjinbdhcpklodjkhhlne" target="_blank"><img src="https://img.shields.io/badge/edge%20users-50k%2B-0078D7?style=flat-square&logo=microsoftedge" alt="Edge Add-ons users"></a>
    <a href="https://addons.mozilla.org/firefox/addon/gemini-voyager/" target="_blank"><img src="https://img.shields.io/amo/users/gemini-voyager?style=flat-square&logo=firefox" alt="Firefox Add-ons users"></a>
  </p>

  <p>
    <a href="https://trendshift.io/repositories/16094" target="_blank"><img src="https://trendshift.io/api/badge/repositories/16094" alt="voyager-crew%2Fvoyager | Trendshift" width="250" height="55"/></a>
    <a href="https://www.star-history.com/voyager-crew/voyager" target="_blank">
     <picture>
       <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=voyager-crew/voyager&type=rank&theme=dark" />
       <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=voyager-crew/voyager&type=rank" />
       <img alt="Star History Rank" src="https://api.star-history.com/badge?repo=voyager-crew/voyager&type=rank" width="193" height="55" />
     </picture>
    </a>
    <a href="https://www.producthunt.com/products/gemini-voyager?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-gemini-voyager" target="_blank" rel="noopener noreferrer"><img alt="Voyager - AI conversation tools for Gemini, Claude, and ChatGPT | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1064704&amp;theme=light&amp;t=1768842096186"></a>
  </p>

  <p>
    <a href="https://voyager.nagi.fun/en">Documentation</a> ·
    <a href="#install">Install</a> ·
    <a href="https://voyager.nagi.fun/en/guide/write-a-plugin">Write a plugin</a> ·
    <a href="https://discord.gg/TEUFxdMbGb">Discord</a>
  </p>
  <p>
    <a href="./.github/README_ZH.md">简体中文</a> •
    <a href="./.github/README_ZH_TW.md">繁體中文</a> •
    <a href="./.github/README_JA.md">日本語</a> •
    <a href="./.github/README_FR.md">Français</a> •
    <a href="./.github/README_ES.md">Español</a> •
    <a href="./.github/README_PT.md">Português</a> •
    <a href="./.github/README_RU.md">Русский</a> •
    <a href="./.github/README_AR.md">العربية</a> •
    <a href="./.github/README_KO.md">한국어</a>
  </p>
</div>

<p align="center">
  <img src="docs/public/assets/promotion/voyager-social-preview.png" alt="Voyager — your prompts, kept local. Any web UI, including DeepSeek Harness." width="820">
</p>

## How it works

Voyager keeps three things apart.

- **Sites.** One small file per site says where things are on its page: the sidebar, a message, the composer.
- **Primitives.** Abilities Voyager ships once and runs anywhere: a timeline, folders, formula copy, diagrams, export.
- **Plugins.** Plain JSON that points primitives and CSS at those places. Nothing in a plugin runs as code, and every change it makes comes off when you turn it off.

So a site that redesigns its page needs one file fixed, and on ChatGPT, Claude, DeepSeek and Kimi that fix arrives from the plugin catalog without an extension update. A new site is one more file. And a plugin written once runs on every site it names.

This is the core of a plugin that blurs the sidebar before you take a screenshot, on four sites:

```json
{
  "matches": [
    "https://gemini.google.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://chat.deepseek.com/*"
  ],
  "contributes": {
    "styles": [{ "css": ".gv-shot-blur { filter: blur(6px) }" }],
    "domOps": [
      {
        "op": "addClass",
        "className": "gv-shot-blur",
        "target": { "kind": "semantic", "key": "sidebar" }
      }
    ]
  }
}
```

`sidebar` is a name, not a selector. Each site's file says what it means there.

Voyager's own features are built the same way. The timeline, formula copy, quote reply, reading width and nearly everything else ship as official plugins on top of the same primitives. Folders on Gemini and AI Studio are the last piece still running as built-in code, and they are moving over too.

## What you get

● works once installed · ○ one switch in the popup

| Feature                                                        | Gemini | AI Studio | ChatGPT | Claude | DeepSeek | Kimi |
| -------------------------------------------------------------- | :----: | :-------: | :-----: | :----: | :------: | :--: |
| [Folders](https://voyager.nagi.fun/en/guide/folders)           |   ●    |     ●     |    ●    |   ○    |    ○     |  ○   |
| [Timeline](https://voyager.nagi.fun/en/guide/timeline)         |   ●    |           |    ○    |   ○    |    ○     |      |
| [Export](https://voyager.nagi.fun/en/guide/export)             |   ●    |           |    ○    |   ○    |    ○     |  ○   |
| [Formula copy](https://voyager.nagi.fun/en/guide/formula-copy) |   ●    |     ●     |    ○    |   ○    |    ○     |      |
| [Quote reply](https://voyager.nagi.fun/en/guide/quote-reply)   |   ●    |           |    ○    |   ○    |    ○     |  ○   |
| [Diagrams](https://voyager.nagi.fun/en/guide/mermaid)          |   ●    |           |    ○    |        |          |      |
| Reading width and typography                                   |   ○    |           |    ○    |   ○    |    ○     |  ○   |
| Vim keys in the input box                                      |   ○    |           |    ○    |   ○    |    ○     |      |
| [Send key](https://voyager.nagi.fun/en/guide/send-behavior)    |   ○    |     ○     |    ○    |   ○    |    ○     |  ○   |
| Draft auto-save                                                |   ○    |           |         |   ○    |    ○     |  ○   |
| [Batch delete](https://voyager.nagi.fun/en/guide/batch-delete) |   ●    |     ●     |         |        |          |      |
| Visual effects (snow, rain, sakura)                            |   ○    |     ○     |    ○    |   ○    |    ○     |  ○   |

On every site, and on any other site you add, `localhost` included:

- **[Prompt library](https://voyager.nagi.fun/en/guide/prompts)**: one library that follows you, here inside [DeepSeek Harness](https://voyager.nagi.fun/en/guide/deepseek-harness).
- **[Cloud sync](https://voyager.nagi.fun/en/guide/cloud-sync)**: folders and prompts through Google Drive, or iCloud on Safari.

Gemini also gets [Deep Research export](https://voyager.nagi.fun/en/guide/deep-research), [watermark-free images](https://voyager.nagi.fun/en/guide/nanobanana), [forks](https://voyager.nagi.fun/en/guide/fork), [context sync](https://voyager.nagi.fun/en/guide/context-sync), a [default model](https://voyager.nagi.fun/en/guide/default-model) and a [Markdown fix](https://voyager.nagi.fun/en/guide/markdown-fix). The full table, with every plugin, is on the [plugins page](https://voyager.nagi.fun/en/guide/plugins).

> During the February 18 Gemini incident, when some users could no longer open their past chats, Voyager users still had them in their folders.

## Make it yours

A plugin you write lives only in your browser and needs no pull request.

- **Describe it.** In the popup's **Local plugins** card, choose **Describe a change**, write one sentence, and carry the prompt to any AI you like. Voyager checks the reply and shows what it changes before you import it.
- **Hand it to a coding agent.** Give Claude Code, Codex or Cursor the skill at `https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md`.
- **Write it by hand.** `npx create-voyager-plugin@latest init my-plugin --site claude`, then `check` runs the same checks as the import.

A plugin cannot run scripts, load anything from the network or read what your messages say. [What a plugin can do](https://voyager.nagi.fun/en/guide/write-a-plugin)

---

## Install

> [!NOTE]
> On Gemini for Enterprise, only the prompt library runs.

<div align="center">
  <a href="https://chromewebstore.google.com/detail/iifacdnjakkhjjiengaffnegbndgingi?utm_source=github&utm_medium=readme&utm_campaign=organic_growth&utm_content=en" target="_blank">
    <img src="https://img.shields.io/badge/Chrome%20Web%20Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store" height="36">
  </a>
  &nbsp;&nbsp;
  <a href="https://microsoftedge.microsoft.com/addons/detail/voyager/gibmkggjijalcjinbdhcpklodjkhhlne" target="_blank"><img src="https://img.shields.io/badge/Edge%20Add--ons-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white" alt="Edge Add-ons" height="36"></a>
  &nbsp;&nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/gemini-voyager/" target="_blank">
    <img src="https://img.shields.io/badge/Firefox%20Add--ons-FF7139?style=for-the-badge&logo=firefox&logoColor=white" alt="Firefox Add-ons" height="36">
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/voyager-crew/voyager/releases/latest/" target="_blank">
    <img src="https://img.shields.io/badge/Safari-000000?style=for-the-badge&logo=safari&logoColor=white" alt="Safari Download (macOS)" height="36">
  </a>
</div>

<p align="center">
  <sub><b>Edge users:</b> Voyager is still maintained on Edge Add-ons for users who need Edge on mobile or tablet. If review is delayed, Chrome Web Store and GitHub manual packages remain available.</sub>
</p>

For **manual installation** or **development builds**, please refer to the [Installation Guide](https://voyager.nagi.fun/en/guide/installation).

---

## Support this project

<div align="center">
  <a href="https://github.com/voyager-crew/voyager">
    <img src="https://raw.githubusercontent.com/voyager-crew/voyager/main/docs/public/assets/sponsors.svg" width="1000px" />
  </a>
</div>

If Voyager makes your life easier, consider buying me a coffee. It helps keep the updates coming! Sponsors will be featured in our Special Thanks section. ❤️

<div align="center">
  <a href="https://www.buymeacoffee.com/Nag1ovo" target="_blank">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" height="36">
  </a>
  <a href="https://github.com/sponsors/Nagi-ovo" target="_blank">
    <img src="https://img.shields.io/badge/Sponsor%20me-GitHub-ea4aaa?style=for-the-badge&logo=github&logoColor=white" alt="Sponsor on GitHub" height="36">
  </a>

  <p><b>Or support via WeChat / Alipay / Afdian:</b></p>
  <table align="center" border="0" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <img src="docs/public/assets/wechat-sponsor.png" alt="WeChat Pay" height="160"><br>
        <sub><b>WeChat Pay</b></sub>
      </td>
      <td align="center">
        <img src="docs/public/assets/alipay-sponsor.jpg" alt="Alipay" height="160"><br>
        <sub><b>Alipay</b></sub>
      </td>
      <td align="center">
        <a href="https://afdian.com/a/nagi-ovo" target="_blank">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://afdian-connect.vercel.app/profile.svg?slug=nagi-ovo&bg_color=%230d1117&text_color=%23dedbd7&border_color=%232e343d" />
            <source media="(prefers-color-scheme: light)" srcset="https://afdian-connect.vercel.app/profile.svg?slug=nagi-ovo" />
            <img alt="Nagi-ovo's Profile" src="https://afdian-connect.vercel.app/profile.svg?slug=nagi-ovo" height="160" />
          </picture>
        </a><br>
        <sub><b>Afdian</b></sub>
      </td>
    </tr>
  </table>
</div>

### Recommended tool: Typeless

I highly recommend **[Typeless (typeless.com)](https://www.typeless.com/?via=gemini-voyager)**, an AI voice-to-text tool that I used extensively during the development of Voyager. Integrating it into my daily workflow has saved me a tremendous amount of time and significantly boosted my productivity.

> 🎁 **[Join via my referral link](https://www.typeless.com/?via=gemini-voyager)** (Code: _`gemini-voyager`_) to get **$5 free credits**. This also gives me credits to keep maintaining this project—a free way to support my work! ❤️

---

## Community

<table>
  <tr>
    <td align="center" width="50%" valign="top">
      <a href="https://x.com/Nag1ovo/status/2012610584722731188" target="_blank">
        <img src="https://img.shields.io/badge/Follow%20on-𝕏-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow on X" height="36">
      </a>
      <br><br>
      <b>Follow for Updates</b><br>
      <sub>Get the latest updates.</sub>
    </td>
    <td align="center" width="50%" valign="top">
      <a href="https://discord.gg/TEUFxdMbGb" target="_blank">
        <img src="https://img.shields.io/discord/1463273957120675973?style=for-the-badge&logo=discord&logoColor=white&label=Join%20Discord" alt="Discord" height="36">
      </a>
      <br><br>
      <b>Join the Community</b><br>
      <sub>Chat with other users, share prompts, and get help.</sub>
    </td>
  </tr>
</table>

---

## Contributing

[<img src="https://devin.ai/assets/askdeepwiki.png" alt="Ask DeepWiki" height="20"/>](https://deepwiki.com/voyager-crew/voyager)

We welcome contributions! Whether you want to report bugs, suggest features, improve documentation, or submit code:

- **Issues**: Reproducible bugs only — use the [bug report](https://github.com/voyager-crew/voyager/issues/new?template=bug_report.yml) template
- **Discussions**: [Feature requests, ideas, and questions](https://github.com/voyager-crew/voyager/discussions) — not Issues
- **Pull Requests**: Check out [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for guidelines

<details>
<summary>Development Setup</summary>

```bash
# Install dependencies (the scripts run on Bun; CI uses Bun 1.3.12)
bun i

# Development mode (with auto-reload)
bun run dev:chrome   # Chrome & Chromium browsers
bun run dev:firefox  # Firefox
bun run dev:safari   # Safari (requires macOS)

# Production builds
bun run build:chrome   # Chrome
bun run build:edge     # Edge package (separate)
bun run build:firefox  # Firefox
bun run build:safari   # Safari
bun run build:all      # Chrome + Firefox + Safari
```

**Safari Development**: Run `bun run build:safari`, then open the tracked Xcode project under `Voyager/`.

</details>

Thank you for helping make Voyager better! ❤️

### Thanks

Special thanks to all contributors for their contributions to Voyager ❤️

<a href="https://github.com/voyager-crew/voyager/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=voyager-crew/voyager&max=200&columns=14" />
</a>

---

## Credits

> Voyager is a small side project. I'd rather spend time building things that help people than building migration paths designed to pull users away from other extensions.

- **[ChatGPT Conversation Timeline](https://github.com/Reborn14/chatgpt-conversation-timeline)** - The original timeline navigation extension for ChatGPT that inspired this project.

- **[gemini-watermark-remover](https://github.com/journey-ad/gemini-watermark-remover) / [GeminiWatermarkTool](https://github.com/allenk/GeminiWatermarkTool)** - Image Refinement is adapted from these projects. Third-party MIT notices are retained in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

- **[Gemini Helper](https://greasyfork.org/scripts/558318-gemini-helper)** - The default-model locking logic includes interaction ideas adapted from Gemini Helper, credited in its source.

- **[cordis](https://github.com/cordiverse/cordis)** - The plugin runtime's side-effect ledger (`PluginScope`) borrows its effect/disposal lifecycle design from cordis's fiber model.

## Ecosystem

Projects inspired by Voyager:

If your project is inspired by Voyager, forked from it, or built on top of it, share it in [Discussions](https://github.com/voyager-crew/voyager/discussions) and we'll add it here.

- **[DeepSeek Voyager](https://github.com/Azurboy/deepseek-voyager)** - A fork of Voyager adapted for DeepSeek, bringing timeline navigation and chat management to DeepSeek users!

- **[claude-nexus](https://github.com/Qiuner/claude-nexus)** - A Claude.ai enhancement extension inspired by Voyager, featuring timeline navigation, folder management, prompt library and more, with full prompt import/export compatibility with Voyager!

- **[Better_Doubao](https://github.com/Rex16200513/Better_Doubao)** - An advanced browser extension supercharging Doubao with enhanced navigation, organization, and productivity features.

- **[DeepSeek Enhancer](https://github.com/dlshuangchenyue1210/DeepSeek-Enhancer)** - A Voyager-inspired enhancement extension for the DeepSeek web app, offering multi-level folders, chat export, formula copy, data backup, and more.

---

## License

Voyager is licensed under **GPL-3.0**.
Third-party MIT notices for Image Refinement-related code and assets are retained in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Gemini is a trademark of Google LLC. Claude is a trademark of Anthropic, PBC. ChatGPT is a trademark of OpenAI, Inc. Kimi is a trademark of Moonshot AI. Voyager is an independent project and is not affiliated with, endorsed by, or sponsored by any of these companies.

---

<div align="center">
  <a href="https://www.star-history.com/#voyager-crew/voyager&type=date&legend=top-left">
   <picture>
     <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=voyager-crew/voyager&type=date&theme=dark&legend=top-left" />
     <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=voyager-crew/voyager&type=date&legend=top-left" />
     <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=voyager-crew/voyager&type=date&legend=top-left" />
   </picture>
  </a>
  <p>Made with ❤️ by Jesse Zhang</p>
  <sub>GPLv3 License © 2026</sub>
</div>
