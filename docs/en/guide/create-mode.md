# Create Mode

Say in one sentence how you want a site to change, such as "make my messages narrower". The AI on that site makes the change for you, and Voyager checks it before installing it. You don't need to know any code, and you don't leave the page. It works on Gemini, AI Studio, ChatGPT, Claude, DeepSeek and Kimi.

What you make is called a creation. It is a small plugin that stays in this browser only. You can turn it off or remove it at any time.

Create mode has two entry points: the **Create** tab of the [Voyager panel](./panel.md) on the page, and the **My creations** card in the Voyager popup (the window that opens when you click the Voyager icon in the browser toolbar).

## Create on the page

<GuideOp>

The quickest way is to do it on the AI site you want to change. Open the Voyager panel there and choose **Create**.

</GuideOp>

<GuideSteps>
<GuideStep>

Write one sentence under **What should change?**, such as "Make my messages narrower and hide the sidebar". Then choose **Create on this page**.

</GuideStep>
<GuideStep>

Voyager opens a new chat on that site and puts your request in the message box. Read it, then press send yourself. Voyager never sends anything for you. If the message box already has text, Voyager leaves it alone and asks you to send or clear it first.

</GuideStep>
<GuideStep>

When the AI replies, a Voyager button, **Preview and install**, appears under the reply.

</GuideStep>
<GuideStep>

Choose it. The panel lists what the creation will change, which sites it runs on, and anything under **Check first**. When you're happy, choose **Install and turn on**, and the change appears at once. If you don't want it any more, turn it off in the panel's **Features** tab.

</GuideStep>
</GuideSteps>

<GuideOp>

To change it again, keep talking to the AI in the same chat.

- **A new version**: **Preview update** appears under the AI's new reply. Check it, then choose **Update and turn on**. Older replies read **Earlier version**.
- **Already installed**: the reply you installed reads **Installed**.
- **Only in these chats**: the buttons appear only in a chat you started with **Create on this page**. For any other chat, use "Create from the popup" below.

</GuideOp>

## Let the AI see the page

<GuideOp>

The **Create** tab has one switch: **Add how this page is built, without any of its text, so the AI writes for what’s here**. It is on by default.

- **What it adds**: the page's layout, meaning which buttons, boxes and message areas it has and where they sit. With it, the AI doesn't have to guess.
- **What it never adds**: any text on the page, your chats included, and no web addresses or account details.
- **Look for yourself**: choose **See what’s added** to see everything that will go to the AI.
- **Leave it out**: turn the switch off, and the request holds only your sentence.

</GuideOp>

## The model notice on Gemini

<GuideOp>

Gemini has several models to choose from. Flash and Flash-Lite are lighter ones, and they usually can't make a creation that works. If the new chat would use one of them, the top of the **Create** tab tells you.

- **What to do**: the notice names a better model. Switch to it in Gemini's model menu, then choose **Check again**.
- **Another way**: choose **Copy for a local agent** in the notice to hand the job to a coding assistant on your computer. See [Write Your Own Plugin](./write-a-plugin.md).
- **It doesn't stop you**: it is only a notice. **Create on this page** still works.

</GuideOp>

## When it can't be installed

<GuideOp>

The AI doesn't always get it right the first time. When it doesn't, a line under the reply says why, such as "It doesn't say which site it applies to".

- **Ask it to fix**: choose **Ask it to fix** under the reply. Voyager writes the problems into the message box, and you press send.
- **Once it's fixed**: when the AI sends a fixed version, **Preview and install** appears under it again.
- **Nothing changes meanwhile**: a creation that wasn't installed doesn't touch your page.

</GuideOp>

## After installing

<GuideOp>

Everything you installed is in **My creations**.

- **In the panel**: the **My creations** group in the **Features** tab. Each creation has a row with its own switch.
- **In the popup**: on Gemini and AI Studio it is a card, below **Cloud Sync** unless you move it, and **Jump to** at the top of the popup takes you there. On the other sites it sits under the plugin list.
- **Remove**: choose the trash icon on its row and confirm. You can't undo this.
- **Take it to another browser**: choose **Export** on it in the popup's **My creations** to get a file. Import that file in the other browser.
- **Share it with everyone**: if it would help others, you can propose it for Voyager. [Plugin Contribution](./plugin-contribution.md) explains how.

</GuideOp>

### The automatic check

<GuideOp>

Each time you open the panel, Voyager checks whether your creations do anything on the current page.

- **Not working here**: when a creation is on but finds nothing to change on this page, its row reads **On, but nothing on this page matches it**. This often happens after a site redesign.
- **It froze the page**: when a creation that runs code made the page freeze, Voyager has already turned it off, and its row says why.
- **Ask it to fix**: both cases offer **Ask it to fix**. Choose it, and Voyager opens a new chat with the problem filled in. The panel closes so you can read it and press send.

</GuideOp>

## Recolouring Voyager

<GuideOp>

A creation can also change Voyager's own colours. Just say so, for example "make Voyager match Nord".

- **What changes**: Voyager's panels, menus, dialogs, pop-up messages and the timeline, in both light and dark mode.
- **What stays**: the site's own colours, and the text Voyager writes straight onto the site's page, so it never blends into the site's background. The Voyager popup doesn't change.
- **To go back**: turn the creation off, and the colours return.

</GuideOp>

## Create from the popup

<GuideOp>

To skip the new chat, or to have another chat or another AI do it, start from **My creations** in the popup. **Create your own**, at the bottom of the plugin list, takes you there.

</GuideOp>

<GuideSteps>
<GuideStep>

Write one sentence under **What should change?**. The **Site** below it starts as the site you are on; change it if the creation is for another site.

</GuideStep>
<GuideStep>

Choose **Copy for this chat**, then paste the copied text into the AI chat on that site and send it.

</GuideStep>
<GuideStep>

When the AI replies, copy the whole reply, paste it under **Paste the AI’s reply**, and choose **Check reply**.

</GuideStep>
<GuideStep>

Voyager tells you in plain words what it will change. Choose **Import**, then turn it on in the plugin list. A creation added this way starts switched off.

</GuideStep>
</GuideSteps>

<GuideOp>

On this path Voyager sends nothing itself. You paste the text over, and you bring the reply back.

</GuideOp>

## Creations that run code

<GuideOp>

Most creations only change how things look. Some requests need more, such as counting your messages or doing something when you click. For those, the AI makes a creation that runs code. The review marks it with **Runs code**.

</GuideOp>

### Turning one on

<GuideOp>

- **Look first**: the review lists the sites it runs on and shows all of its code. It can see everything on those pages, your chats included. Voyager can't stop it from sending what it sees somewhere else. So turn on only one you trust.
- **Install and turn on**: turns on exactly the version you just looked at. A later version from the AI stays off until you look at it again. The switch applies to this device only.
- **A one-time browser setting**: the browser must allow Voyager to run these creations. Choose **Open Voyager’s details page**, turn on **Allow User Scripts**, then come back and choose **I turned it on**.
- **Browsers**: Chrome or Edge 133 or newer on a computer. On Safari, Firefox and phones it stays installed but paused. You can ask the AI for a version that only changes how the page looks.

</GuideOp>

### Staying in control

<GuideOp>

In **My creations**, each creation that runs code reads **On, this device only**, **Off** or **Paused**, with the reason when paused.

- **Stop them all**: choose **Stop all creations that run code** at the bottom of **My creations**. Choose **Resume** to start them again.
- **Pages already open**: they keep running until you reload. **Reload this page** reloads the current page.
- **A frozen page**: if a page freezes because of them, Voyager turns them off. The next time the page opens, a notice tells you which ones.

</GuideOp>

## What it can and can't do

<GuideOp>

- **Can do**: change how a page looks, such as width, text size and colour; hide parts you don't want; add switches and sliders to settings; recolour Voyager. On some sites it can also turn on Voyager's own features, such as formula copy and the timeline.
- **Needs code**: doing something on a click, counting things, reading what's on the page. See "Creations that run code" above.
- **Nothing can**: run on other sites, or change Voyager's own settings. For a request like that, the AI says so and makes the closest version it can.

</GuideOp>

## The details

<GuideOp>

This section is for people who want to know how it works underneath. Skip it if you only want to use it.

- **What a creation is**: a local plugin, made of a plugin manifest and styles. Writing one by hand, the rules, and the colour variables for recolouring are in [Write Your Own Plugin](./write-a-plugin.md).
- **What the AI reads**: the request links Voyager's instructions for the site, such as `https://voyager.nagi.fun/create/claude.md`, and the AI replies with one JSON code block. Voyager shows its buttons only in a chat whose message carries that link. So for the popup way, the AI must be able to open links.
- **The page structure**: which page elements Voyager recognizes and how many, and the element tree around the latest reply and your latest message. No text and no web addresses; attribute values that look like ids, emails or long numbers are dropped too.
- **The model notice**: Voyager reads the model the new chat will get. With [Default Model](./default-model.md) on, it judges by that default. It checks again when you come back to the panel.
- **The automatic check**: Voyager looks only at whether the creation's styles and page changes find something on the current page. Hover and focus states, and creations that only call built-in features, are not counted.
- **Running code**: through Chrome's user scripts, and only on the sites the creation lists. Before Chrome 138, the switch is **Developer mode** at the top of `chrome://extensions`.

</GuideOp>
