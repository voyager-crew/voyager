# AI Studio Enter send

Uses the shared AI Studio send-key coordinator on both `aistudio.google.com` and `aistudio.google.cn`. Enter sends when no upload is pending; Ctrl/Cmd+Enter inserts a newline. Shift+Enter, Alt+Enter and IME confirmation keep the host behavior. Stop controls are never clicked.

The existing AI Studio Enter-send switch controls this packaged plugin. AI Studio’s master switch mounts or stops it live; it does not read Gemini’s Ctrl+Enter switch. The manifest requires engine `>=1.9.0` for the `enterSends` mode.
