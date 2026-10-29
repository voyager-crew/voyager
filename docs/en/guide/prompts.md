# Your Intellectual Assets: Prompt Library

You craft a perfect prompt. It solves a complex coding problem or writes a beautiful email.
Do you throw it away?
No. You save it.

## The Prompt Vault

This is your personal repository of genius.

### 1. Capture

When you write something great, click the floating Voyager ball (it sits next to the input area by default, and you can drag it anywhere) to open the **Prompt Manager**.
It’s now part of your vault.

### 2. Categorize

Add tags like `coding`, `email`, or `research` (separate them with commas).
Keep your tools sharpened and sorted.

### 3. Deploy

Next time you need it, don't type it again.
Open the manager, search by tag or keyword, and click to insert.
One click. Infinite leverage.

![Prompt Manager](/assets/gemini-prompt-manager.png)

## Compact list & notes

When prompts pile up and the card list no longer fits, the panel adapts:

### View toggle

The `≡ / ▦` button on the right of the search bar switches between **Compact list** (default) and **Comfortable view**.

- **Compact list**: one prompt per row, ~10 visible at once; the right side shows tags · expand · edit · delete
- **Comfortable view**: full Markdown preview, best for a small collection

### Required name

The **Name** field at the top of the add/edit form gives each prompt a short title and is required when creating or editing a prompt. Legacy prompts without a name remain available, but need a name the next time they are edited.

### Fast hover preview

In compact mode, hover any row for **~250 ms** to see its full content in a floating tooltip — replaces the browser's native `title` tooltip (which can take 1–3 s to open).

### Slash quick insert

In a chat input, type `/` followed by part of a prompt name. The list shows matching names and tags; hover an item to preview its full body, then click it or press `Tab` / `Enter` to select it. The editor displays the selected name as a highlighted token and sends the complete prompt body.

![Compact list view](/assets/gemini-prompt-manager-compact.png)

## Available Anywhere

The Prompt Manager can now be used on any website you choose, not just Gemini™ and AI Studio.

### How to Enable

On Claude, ChatGPT, DeepSeek, and Kimi, Prompt Manager is a row in the site's **Plugins** card. Open the Voyager popup while you're on the site and turn on **Prompt Manager**. If it's the first feature you turn on there, your browser asks for access to the site once.

For any other site:

1. Click the Voyager icon in your browser's extension toolbar.
2. In the **Site access** card, find **Other websites**.
3. Enter the website address (e.g., `poe.com`).
4. Click **Add website** and grant permission.
5. **Reload the target page** to see the floating button.

### Popular AI Websites

- `copilot.microsoft.com` - Microsoft Copilot
- `poe.com` - Poe

### Local Apps

Local addresses work too — enter `localhost:3080` or `127.0.0.1:3080` the same way. For example, [DeepSeek Harness](/en/guide/deepseek-harness) runs on `localhost:3080`, and the Prompt Manager attaches to it just like any hosted site.

![Prompt Manager running inside DeepSeek Harness](/assets/prompt-manager-deepseek-harness.png)

::: tip
On websites you add yourself, **only** the Prompt Manager is activated. Features like Timeline and Folders don't load there. Claude, ChatGPT, DeepSeek, and Kimi are different: they get their own official plugins, which you can browse in the [plugin list](/en/guide/plugins).
:::
