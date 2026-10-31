# Total Freedom

Voyager Export lets you download any Gemini, ChatGPT, Claude, DeepSeek, or Kimi conversation as a Markdown, PDF, JSON, or image file. It extracts the full chat content — including code blocks, images, and formatting — giving you a permanent, portable copy of every AI conversation you have.

Data lock-in is the enemy.
We believe that if you create it, you own it.

## Format Comparison

| Feature     | Markdown                     | PDF                  | JSON                      | Image             |
| ----------- | ---------------------------- | -------------------- | ------------------------- | ----------------- |
| Best for    | Note apps (Obsidian, Notion) | Sharing and printing | Developers, data analysis | Sharing on mobile |
| Images      | Embedded                     | Fully included       | Base64 encoded            | Rendered in place |
| Code blocks | Preserved with syntax        | Rendered visually    | Raw text preserved        | Rendered visually |
| File size   | Smallest                     | Largest              | Medium                    | Large             |
| Searchable  | Plain text                   | PDF reader search    | Programmatic access       | No                |

## Export Everything

Voyager lets you pull your data out of the cloud and into your hands.

### The Formats

- **Markdown**: For your Obsidian vault or Notion. Clean, formatted text with embedded images.
- **PDF**: For sharing or printing. Beautifully laid out, images included.
- **JSON**: Raw data. For developers who want to build on top of their history.
- **Image**: One long PNG, great for sharing on your phone. Pick a narrow, medium, or wide layout.

### How to Export

1. Click the **Export** button (ChatGPT, Claude, DeepSeek, Kimi, and current Gemini layouts). It starts at the top right of the page; drag it anywhere, each site remembers its spot, and dropping it near the default position snaps it back. On Gemini you can also choose **Export conversation history** from a conversation's or response's ⋮ menu; on older Gemini layouts, hover the Gemini logo to see the **Export Icon**.
2. Choose your format.
3. Done.

On Claude, DeepSeek, and Kimi, export is a plugin that is off by default: turn it on under **Plugins** in the popup first. Voyager scrolls through a long conversation to read all of it, then starts with every message selected; untick the ones you don't want. If it can't confirm both the beginning and the end, it warns that the export may be incomplete. On ChatGPT, if it can't read the full history, it says so and asks you to scroll up to load earlier messages, then try again. Switching to another chat stops the export, and so does a new reply starting on Claude.

Files uploaded in a ChatGPT conversation appear in the export as a `📎 file name` line.

It’s your data. Do what you want with it.

<div style="display: flex; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; text-align: center;">
    <p><b>Step 1: Find Export</b></p>
    <img src="/assets/gemini-export-guide-1.png" alt="Export guide step 1" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
  <div style="flex: 1; text-align: center;">
    <p><b>Step 2: The Choice</b></p>
    <img src="/assets/gemini-export-guide-2.png" alt="Export guide step 2" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
</div>

### Safari PDF Export Note

Exporting PDF on Safari requires a slightly different process (manual print):

1. Click the **Export** button and select PDF format.
2. **Wait for about a second** (allow the page to prepare print styles).
3. Press `Command + P` to open the print dialog.
4. Select **"Save to PDF"** in the print dialog.

<img src="/assets/safari-export-pdf.png" alt="Safari Export PDF" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;"/>

## Deep Research Export

Gemini's Deep Research mode produces structured reports with sources, thinking steps, and citations. Voyager can export these sessions with all their metadata intact:

1. Open a completed Deep Research conversation.
2. Open the report's **Share & Export** menu and choose **Save Report**.
3. Choose your format.
4. The export includes the final report with its source links. To save the thinking process too, see [Deep Research Export](/en/guide/deep-research).

This is useful for academic research, competitive analysis, and technical documentation where you need to preserve the reasoning chain and source attribution.

## When to Export

- **Knowledge archiving**: Save important conversations before they get buried in your chat history.
- **Team sharing**: Export a debugging session as PDF to share with colleagues who don't use Gemini.
- **Building a knowledge base**: Export conversations in Markdown and organize them in Obsidian or Notion.
- **Data analysis**: Use JSON exports to programmatically analyze conversation patterns or extract structured data.
- **Compliance and auditing**: Keep records of AI-assisted decisions for audit trails.

## Supported Platforms

Export works on Gemini and ChatGPT across Chrome, Edge, Firefox, Safari, Opera, and Brave. Claude, DeepSeek, and Kimi export are plugins: off by default and turned on under **Plugins**. On Safari, PDF export uses a manual print step (Command+P after clicking export); Markdown and JSON exports still include images.
