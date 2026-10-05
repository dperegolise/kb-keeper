---
name: log
description: Open kb's activity page in the browser. It shows what kb is waiting on (with a box to answer each item), every action kb took in this repository and why, as summary tiles, charts and a log grouped by run, action, place or day. Use when asked to show the kb log, what kb did, or kb's activity.
---

# Open the kb activity page

Start kb's reply listener and open the live page in the default browser:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" start --open
node "${CLAUDE_PLUGIN_ROOT}/scripts/view.mjs"
```

The first command prints the live page's address; the second rebuilds `log.html` in kb's local folder and prints its path. Tell the person both. The file is rebuilt after every log entry, so they can also open it straight from their editor.

On every open item in "Needs you" there is a box for their answer. Enter saves it through the listener (bound to 127.0.0.1, stops itself after 8 idle hours), and `/kb:review` acts on saved answers first. If the listener is not running, the page keeps answers in the browser and offers "Copy replies" to paste into `/kb:review`.

If no browser opens (a remote or headless machine), give them the path and stop.
