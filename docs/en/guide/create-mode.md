# Create Mode

Say in one sentence how a site should change. The site's own AI writes it as a plugin, and Voyager checks it and installs it for you. No code, and you never leave the chat you are in. It works on Gemini, AI Studio, ChatGPT, Claude, DeepSeek and Kimi.

Create mode has two entry points: the **Create** tab of the [Voyager panel](./panel.md) on the page, and the **My creations** card in the Voyager popup. What it makes is a local plugin that lives only in your browser. To write a plugin yourself or hand it to a coding agent, see [Write Your Own Plugin](./write-a-plugin.md).

## Create on the page

<GuideOp>

The quickest way runs on the AI site the plugin is for: open the Voyager panel there and choose **Create**.

</GuideOp>

<GuideSteps>
<GuideStep>

Write one sentence under **What should change?**, such as "Make my messages narrower and hide the sidebar", then choose **Create on this page**.

</GuideStep>
<GuideStep>

Voyager opens a new chat on that site and puts your request in the message box. Read it, then send it yourself: Voyager never presses send. If the message box already holds text, Voyager leaves it alone and asks you to send or clear it first.

</GuideStep>
<GuideStep>

The AI reads Voyager's page for the site and replies with one JSON code block. Under the block, Voyager adds **Preview and install**.

</GuideStep>
<GuideStep>

Choose it. The panel opens on a review: the sites the plugin runs on, each change, its CSS in full and anything under **Check first**. Choose **Install and turn on**, and it applies right away. You can turn it off any time under **Features**.

</GuideStep>
</GuideSteps>

<GuideOp>

To change the plugin, tell the AI in the same chat.

- **A new version**: under its new reply Voyager offers **Preview update**, then **Update and turn on**; the older block reads **Earlier version**.
- **Already installed**: the version you installed reads **Installed**.
- **Create chats only**: Voyager reads replies only in a chat where your message links Voyager's create page, which the request from **Create on this page** always does. In any other chat nothing appears under the replies; use the popup way below instead.

</GuideOp>

## Adding the page structure

<GuideOp>

The **Create** tab has one switch: **Add how this page is built, without any of its text, so the AI writes for what’s here**. It is on by default, so the AI writes for the page as it really is instead of guessing.

- **What it adds**: which page elements Voyager recognizes and how many, and the element tree around the latest reply and your latest message.
- **What it leaves out**: any text on the page, links, your chats, and attribute values that look like data, such as ids, emails or long numbers.
- **See what's added**: open it to read exactly the text that will be attached. It reads the page again when the page changes.
- **Off**: turn the switch off and the request holds only your sentence.

</GuideOp>

## The model notice on Gemini

<GuideOp>

On Gemini, Voyager first checks which model the new chat will use. If it is a lighter model such as Flash or Flash-Lite, the top of the **Create** tab says that model usually can't write a plugin.

- **What it suggests**: the notice names a stronger model to choose in Gemini's model menu, or offers to hand the request to a local coding agent (**Copy for a local agent** sits in the notice).
- **Check again**: after switching models in Gemini, choose **Check again**. Voyager also checks again when you come back to the panel.
- **Default model**: if you use [Default Model](./default-model.md), Voyager judges by the default the new chat will get.
- **It doesn't block you**: it is only a notice. **Create on this page** still works.

</GuideOp>

## When a reply can't be installed

<GuideOp>

Not every reply comes out right. Under a reply Voyager can't install, it says why in plain words, such as "It doesn't say which site it applies to" or "One of its changes isn't allowed".

- **Ask it to fix**: choose **Ask it to fix** under the reply. Voyager puts the list of problems in the message box, after anything you already typed, for you to send.
- **Once it's fixed**: when the AI replies with a fixed version, **Preview and install** appears under it.
- **During review**: if the problems only show up in the panel's review, Voyager installs nothing and lists them.

</GuideOp>

## After installing

<GuideOp>

Everything you installed is in **My creations**. In the panel it is a group in the **Features** tab. In the popup, on Gemini and AI Studio it is a settings card, right below **Cloud Sync** unless you move it, and **Jump to** at the top of the popup links to it; on ChatGPT, Claude, DeepSeek and Kimi it sits under the plugin list.

- **Switch**: each creation has a row and turns on and off like any other feature.
- **Remove**: choose the trash icon and confirm to remove it from this browser. You can't undo this.
- **Export**: choose **Export** on it in the popup's **My creations** list, then import the JSON file in another browser.
- **Share it**: if it would help everyone, propose it for the official catalog: [Plugin Contribution](./plugin-contribution.md) describes that path.

</GuideOp>

### The automatic check

<GuideOp>

When the panel opens, Voyager looks at whether each creation in **My creations** does anything on the current page.

- **Nothing matches**: a restyling creation is on, but no element it changes is on this page. Its row reads **On, but nothing on this page matches it**. Hover and focus states, and creations that only call built-ins, are not counted.
- **A frozen page**: when a creation that runs code made the page stop responding, Voyager has already turned it off, and its row says why.
- **Ask it to fix**: both cases offer **Ask it to fix**. Voyager opens a new chat on this site and fills it with what it saw on the page and the plugin as installed (plus the page structure while that switch is on). The panel closes so you can read it and send it.

</GuideOp>

## Recolouring Voyager

<GuideOp>

A creation can also recolour Voyager's own UI on the page, from one sentence again, such as "Give Voyager's panels and timeline a Nord palette". The AI sets Voyager's public colour variables in one `:root` rule, and they apply in light and dark alike.

- **What follows the palette**: the background, text, borders and hover colour of panels, menus, dialogs, tooltips and toasts; the accent of buttons, selection and focus; the danger colour for delete.
- **The timeline**: its rail, its resting dots and ticks, and the left slider's track have a colour of their own.
- **What keeps following the site**: the text, borders and hover colour that Voyager draws straight on the site's page, so light text never lands on the site's light background. The Voyager popup is not affected.

</GuideOp>

<GuideNote>

**A Nord example**: the sentence above usually gets CSS like this. A variable left unset keeps Voyager's own colour.

```css
:root {
  --gv-theme-surface: #2e3440;
  --gv-theme-hover: #3b4252;
  --gv-theme-text: #eceff4;
  --gv-theme-text-muted: #d8dee9;
  --gv-theme-border: #4c566a;
  --gv-theme-accent: #88c0d0;
  --gv-theme-accent-fg: #2e3440;
  --gv-theme-danger: #bf616a;
  --gv-theme-timeline: #81a1c1;
}
```

Every variable: `--gv-theme-surface` (background), `-hover` (hovered rows), `-text` (text), `-text-muted` (secondary text, icons), `-border` (borders), `-accent` (buttons, selection, focus), `-accent-fg` (text on accent), `-accent-hue` (the accent's OKLCH hue, a number), `-danger` (delete), `-timeline` (rail and dots on the site's background).

</GuideNote>

## Without the panel: create from the popup

<GuideOp>

To skip the new chat, or to have another chat or another AI write it, start from **My creations** in the popup. **Create your own**, at the end of the plugin list, takes you to its first field.

</GuideOp>

<GuideSteps>
<GuideStep>

Write one sentence under **What should change?**. The **Site** below it starts as the site of your current tab; change it if the plugin is for another site.

</GuideStep>
<GuideStep>

Choose **Copy for this chat** and paste the message into the AI chat on that site. The AI reads Voyager's page for the site, such as `https://voyager.nagi.fun/create/claude.md`, and replies with one JSON code block. The AI needs to be able to open links.

</GuideStep>
<GuideStep>

Paste the whole reply under **Paste the AI’s reply** and choose **Check reply**.

</GuideStep>
<GuideStep>

Voyager shows what the plugin changes in plain language. Choose **Import**, then turn the plugin on in the plugin list; on Gemini and AI Studio its switch appears right below the card. A plugin imported this way starts switched off.

</GuideStep>
</GuideSteps>

<GuideOp>

On this path Voyager sends nothing itself. You paste the message, and you carry the reply back.

</GuideOp>

## Creations that run code

<GuideOp>

When CSS and page changes can't do what you asked, such as counting your messages or reacting to a click, the AI can write a creation that runs JavaScript. Voyager runs it through Chrome's user scripts, only on the sites it lists, and only after you have read it. The review marks such a creation with a **Runs code** badge.

</GuideOp>

### Turning one on

<GuideOp>

- **Read it**: the review lists the sites it runs on and shows its full source. It can read everything on those pages, your chats included, and Voyager cannot stop it from sending what it reads elsewhere, so install only code you trust.
- **Install and turn on**: turns on exactly the code you read. If its code or sites change later, it pauses until you review it again, and the switch never syncs to your other devices.
- **One-time switch**: Chrome lets an extension run such code only after you allow it. Choose **Open Voyager’s details page**, turn on **Allow User Scripts** there (before Chrome 138, **Developer mode** at the top of `chrome://extensions`), then come back and choose **I turned it on**.
- **Browsers**: desktop Chrome or Edge 133 or newer. On Safari, Firefox and phones it stays installed but paused; ask the AI for a version that only changes how the page looks.

</GuideOp>

### Staying in control

<GuideOp>

In **My creations**, each creation that runs code shows **On, this device only**, **Off**, or **Paused** with the reason.

- **Stop all**: **Stop all creations that run code**, at the end of **My creations** (the popup card, or the panel's **Features** tab), stops every one at once; **Resume** starts them again.
- **Open pages**: a page that is already open keeps running them until it reloads. **Reload this page** does that for the current tab.
- **Freezes**: if a page stops responding after these creations ran on it, Voyager turns them off and names them in a notice the next time the page loads. Once the creation is fixed, review it in **My creations** and turn it back on.

</GuideOp>

## What it can and can't do

<GuideOp>

Most creations change only how the page looks and is laid out, run no code of their own, and undo every change when you turn them off.

- **Can do**: restyle the page, hide parts of it, add switches and sliders to settings, recolour Voyager, and on the plugin sites turn on Voyager's built-ins (formula copy, the timeline, Mermaid diagrams and others).
- **Needs code**: reacting to clicks, counting things or reading the page takes a creation that runs code, described above.
- **No creation can**: run on other sites or change Voyager's own settings. For a request like that, the AI says so and builds the closest version that works.
- **The full rules**: which fields a plugin may use and what the import checks are in [Write Your Own Plugin](./write-a-plugin.md#what-a-plugin-can-do).

</GuideOp>
