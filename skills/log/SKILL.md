---
name: log
description: Open kb's activity page in the browser. It shows every action kb took in this repository and why, as summary tiles, charts and a log grouped by run, action, place or day. Use when asked to show the kb log, what kb did, or kb's activity.
---

# Open the kb activity page

Rebuild the page from the log and open it in the default browser:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/view.mjs" --open
```

The script prints the page's path. Tell the person that path. The page is `log.html` in kb's local folder inside the repository's git directory. It is rebuilt after every log entry, so they can also bookmark it or open it straight from their editor.

If no browser opens (a remote or headless machine), give them the path and stop.
