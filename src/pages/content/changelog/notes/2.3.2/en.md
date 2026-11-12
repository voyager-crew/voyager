> _"Magic is a world of visual imagination." — Frieren, 《Frieren: Beyond Journey's End》 (2023)_

### Highlights

- ✨ **Create mode**: say in one sentence how you want a site to change, the site's AI writes a small plugin, and Voyager checks it and installs it for you. Press :kbd:Alt+V: to open the panel and pick **Create**. [→ Docs](/guide/create-mode)
- 🎨 **Recolor Voyager**: ask for any palette in one sentence in **Create**, and Voyager's own panels, menus and timeline follow. The built-in Nord palette (off by default) was made this way: its first version was written by :gemini: Gemini (the Argon model) in Create mode. Turn it on under **Features** in the panel.
- 🔄 **No refresh after an update**: when Voyager updates, tabs that are already open pick up the new version on their own; a tab that cannot shows a card and reloads only when you click it.

### New

- **Creations that run code** _(off by default)_: for what a change of looks cannot do, the AI can write code. You see the code before installing, and you turn on the browser's user scripts switch yourself. Desktop Chrome and Edge only.
- **Show the AI the page**: your request can carry the structure of the current page, with none of its text, and you can read everything that is attached before sending. On :gemini: Gemini, you get a heads-up when the selected model usually cannot write a plugin.
- **Fixable when it goes wrong**: when a reply cannot be installed Voyager says why, and it tells you when an installed creation changes nothing; either way you can pick **Ask it to fix**.
- **Update reminders**: choose between opening the release notes, a NEW mark on the floating ball, or no reminder. If you skip a few versions, the notes you missed are shown together.
- **Font size**: reading font size moves in 1% steps, takes a typed number, and resets to 100% in one click.

### Fixes

- **:chatgpt: ChatGPT export**: very long conversations no longer fail as unreadable, and the export button no longer jumps sideways while the page loads.
- **:chatgpt: ChatGPT timeline**: in a scheduled task conversation, each run gets its own marker.
- **:chatgpt: ChatGPT Vim mode**: the mode badge stays beside the composer, on Codex too.
- **:gemini: Gemini sidebar**: with auto-hide on, opening the account switcher no longer collapses the sidebar.
- **Theme**: until you pick a theme, Voyager keeps following the system's light or dark.
- **Touch**: a finger can drag the floating ball and reach **Hide**.
- **Update reminders**: after choosing the NEW mark, the next update shows it as it should.
