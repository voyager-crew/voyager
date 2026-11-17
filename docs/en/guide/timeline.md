# Time Travel

Voyager Timeline is a visual conversation navigation system for Gemini, Claude, and ChatGPT. It maps every message in a chat to an interactive node on the right side of the screen, turning long AI conversations into a navigable map you can jump through instantly.

Long conversations are messy. You scroll up, you scroll down, you lose your place.
Voyager turns your conversation into a timeline.

On Gemini, **Timeline** → **Show Timeline** controls the rail and its navigation shortcuts. Turning it off keeps saved stars and hierarchy. Message time labels follow **Timeline** → **Message timestamps** independently, so you can keep them visible with the timeline off.

On Claude, ChatGPT, DeepSeek, and Grok, the rail is that site's timeline plugin: turn it on under **Plugins**, and its **Options** hold the style, node levels (where offered), **Reset Timeline Position**, and **View Saved Library**, plus message timestamps on ChatGPT.

## See the Shape of Your Chat

Look at the right side of your screen.
Each node represents a message. The timeline visualizes the rhythm of your dialogue.

## Navigation, Solved.

- **Teleport**: Click a node to jump instantly to that message.
- **Peek**: Hover to see what's inside without moving.
- **Bookmark**: Long-press a node to **Star** it. It's like a bookmark for your brain.
- **Levels (Experimental)**: Off by default. Turn on **Enable Node Levels** below **Timeline** → **Show Timeline** once the row is on, then right-click a node to set its level (1-3) or collapse its children. Perfect for making branched conversations clear. Levels only show in the `Nodes` style: turning them on switches the timeline to `Nodes`, and `Ruler` and `Compact` can't be picked while levels are on.
- **Resize**: Drag the inner edge of the timeline to adjust its width.
- **Keyboard**: Navigate at the speed of thought. Default `j`/`k`, `gg`/`GG` to jump to first/last turn.

![Timeline Navigation](/assets/teaser.png)

## Star: Bookmark Your Breakthroughs

Long conversations bury gold. Star the moments that matter.

**How it works**: Long-press (hold ~0.5s) any node on the timeline. You'll see it light up — that message is now starred.

- Long-press again to unstar.
- Starred nodes stay highlighted so you can spot them at a glance.
- See all your starred messages in the **Saved Library**: click **View Saved Library** below **Timeline** → **Show Timeline** in the Voyager popup once the row is on, or open it from the Prompt Manager panel.

Think of it as planting a flag in the conversation — the moment you had a breakthrough, got the perfect answer, or want to pick up later.

::: tip Pro Tip
Stars sync across devices if you have [Cloud Sync](/en/guide/cloud-sync) enabled.
:::

## Make It Look Right

In the Voyager popup, turn on **Timeline** → **Show Timeline** to see its options below the row:

- **Timeline style**: `Nodes`, `Ruler`, or `Compact`.
- **Pin preview panel**: Keep the preview panel open beside the timeline. Its search box filters messages as you type.
- **Draggable Timeline**: Move the timeline anywhere on the page. **Reset Timeline Position** puts it back.

## Even Faster with Keys

Don't want to use the mouse? Use your keyboard.

**It's like turning on Vim mode in Gemini.**

### Default Shortcuts

- `k` - Jump to previous node
- `j` - Jump to next node
- `gg` - Jump to first turn
- `GG` - Jump to last turn

### Customize It

Open extension settings, click a shortcut box, press any key you want.
Any key, any combo. `n`/`p`? `,`/`.`? Your call.

**Flow mode**: Rapid presses queue up smoothly.
**Jump mode**: Instant response, max speed.

## When to Use Timeline

Timeline is most valuable in conversations longer than 10 messages, where scrolling becomes inefficient:

- **Research sessions**: You asked Gemini to explore a topic over 30+ turns. Timeline lets you jump back to the key insight without re-reading everything.
- **Code debugging**: A long debugging conversation where the solution appeared at turn 47. Star it, find it later in one click.
- **Learning and tutoring**: Working through a complex topic step by step. Use levels to collapse sections you've mastered.
- **Brainstorming review**: Reviewing a creative session to extract the best ideas. Stars mark the moments worth keeping.

## Timeline vs. Manual Scrolling

| Capability                 | Without Timeline              | With Voyager Timeline                                        |
| -------------------------- | ----------------------------- | ------------------------------------------------------------ |
| Find a specific message    | Scroll up and down repeatedly | Click a node or press j/k                                    |
| Bookmark key moments       | Copy-paste to external notes  | Long-press to star, syncs to cloud                           |
| See conversation structure | Read sequentially             | Visual map shows full shape at a glance                      |
| Keyboard navigation        | Not available in Gemini       | Vim-style j/k, gg/GG, fully customizable                     |
| Navigate 100+ messages     | Minutes of scrolling          | Instant jump to any point                                    |
| Organize long threads      | No built-in tools             | Levels (1-3) and collapsible children (experimental, opt-in) |

## Supported Browsers

Timeline works on Google Gemini, and on Claude and ChatGPT as built-in plugins, across Chrome, Edge, Firefox, Safari, Opera, and Brave. Keyboard shortcuts and starring work the same on all three. Levels are an experimental opt-in everywhere: on Gemini, turn on **Enable Node Levels** below **Timeline** → **Show Timeline** once the row is on; on Claude and ChatGPT, turn on the same switch in the **Timeline** plugin settings under **Plugins**. Starred messages sync across devices when [Cloud Sync](/en/guide/cloud-sync) is enabled.

Timeline is not available on AI Studio. DeepSeek and Grok each have an optional timeline plugin in the plugin catalog (they ship disabled).
