# DeepSeek Harness

DeepSeek's own open-source coding agent. It runs on your machine.

It has a web interface, at `localhost:3080`.

A web interface means Voyager can reach it.

## Why it works

Voyager's Prompt Manager doesn't care about domains. It cares about sites you've added.

A local address is a site.

So DeepSeek Harness is no different from Gemini, Claude or ChatGPT — just another place your prompts can follow you to.

## Three steps

### 1. Start DSH

```bash
npm i -g @deepseek-ai/dsh
dsh web
```

Open `http://localhost:3080` in your browser.

### 2. Add it in the popup

![Click the toolbar puzzle icon, then click Voyager to open its popup](/assets/dsh-enable-steps-en.png)

In the popup's **Site access** card, under **Other websites**, enter `localhost:3080`. Click **Add website** and grant access.

### 3. Reload the page

The floating button appears in the bottom-right corner.

![Prompt Manager running inside DeepSeek Harness](/assets/prompt-manager-deepseek-harness.png)

## One library, everywhere

You don't get a separate library per site. You get one library that follows you.

Every prompt you saved on Gemini, Claude or ChatGPT is already there when you open DSH — all of them. It works the other way too: write a prompt inside DSH and it's waiting for you back on Gemini.

Same tags, same favourites, same search.

![One library reaching every interface](/assets/one-prompt-library.png)

## A few notes

**The port isn't fixed.** DSH is still a developer preview, and its default port may change. If it does, just add the new one.

**Only the Prompt Manager loads.** On a custom site like DSH, Timeline, Folders and the rest won't start. (On DeepSeek's own website, many of them are available as official plugins.)

**Your prompts never leave the machine.** DSH is local, Voyager's library is local. Nothing in the chain goes out.

::: tip
The same approach works for any local web UI — Open WebUI, LibreChat, the one you wrote yourself. Add the address, reload, done.
:::
