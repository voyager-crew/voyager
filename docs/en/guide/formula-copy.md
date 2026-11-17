# Formula Copy

Voyager makes it effortless to reuse mathematical formulas and scientific symbols. Click a formula to copy it as LaTeX, Word-ready MathML, or a Notion-friendly block.

## Introduction

When you ask Gemini to derive formulas or write mathematical expressions, it usually renders them using LaTeX. While beautiful, extracting the source code to use in your own papers, documents, or editors often requires manual effort.

Voyager provides seamless support for this:

1. **Auto-Detection**: Voyager automatically identifies formulas rendered on the page. Hovering over one shows that it's clickable.
2. **Click to Copy**: Click an inline or block formula and it's copied right away, with a short confirmation.
3. **Pick a Format**: In the popup, turn on **Answer content** → **Formula Copy**, then choose a copy format below the row:
   - **LaTeX**: Standard LaTeX source with dollar-sign delimiters, ideal for Overleaf, Markdown editors, etc.
   - **LaTeX (No Dollar Sign)**: The bare LaTeX source, for editors that add their own delimiters.
   - **MathML (Word)**: The best format for pasting directly into **Microsoft Word**.
   - **Notion ($$ format)**: Wraps every formula in `$$`, which Notion turns into an equation.

![Formula Copy](/assets/gemini-math-copy.png)

## Features

- **Word Compatibility**: With MathML support, you can paste complex AI-generated formulas directly into Word documents while maintaining perfect editable formatting.
- **Context Preservation**: Not only copies the formula itself but also preserves its mathematical context.
- **Instant Response**: Processed entirely locally for immediate results.

## Usage Tips

- **Academic Writing**: When writing papers in Word, have Gemini derive formulas, then use MathML copy-paste to avoid the hassle of manual entry in the Word Equation Editor.
- **Note Taking**: When taking notes in Obsidian or Notion, simply copy the LaTeX source directly.

## Where It Works

On Gemini and AI Studio, turn it on with **Answer content** → **Formula Copy** in the popup; the copy format appears below the row once it's on. That switch and the copy format apply to both sites. On Claude, ChatGPT, DeepSeek, and Grok, formula copy is a plugin: open the popup on that site and turn on **Formula Copy** in the **Plugins** card. See [All plugins](/en/guide/plugins) for each site's plugins.
