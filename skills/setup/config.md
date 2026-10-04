# kb.json reference

`kb.json` lives at the repository root. Every key is optional.

```json
{
  "wiki": "docs/wiki",
  "base": "main",
  "backlog": "docs/BACKLOG.md",
  "ignore": ["finance/**"],
  "rules": [
    { "match": ["README.md", "CLAUDE.md", "docs/RUNBOOK.md"], "class": "living" },
    { "match": "docs/adr/**", "class": "record" },
    { "match": "docs/research/**", "class": "raw" },
    { "match": "docs/bugs/**", "class": "ephemeral", "exit": "The fix is merged." },
    { "match": "docs/runs/**", "class": "ephemeral", "keepLatest": 5, "exit": "A later run covers the same flows." },
    { "match": "docs/timeline/**", "class": "ephemeral", "maxAgeDays": 14, "exit": "Two weeks old." }
  ]
}
```

| Key | Default | Meaning |
|---|---|---|
| `wiki` | `docs/wiki` | Folder that holds the wiki. Everything in it is `living` without needing a rule |
| `base` | the default branch | Branch that sweeps start from and open pull requests against |
| `backlog` | none | Markdown file in the repository where open work goes when a doc is distilled. Sweeps also prune entries whose fix is in the code. Without it, docs that contain open work are flagged |
| `docs` | `**/*.md`, `**/*.mdx`, `**/*.docx`, `**/*.pdf` | Globs for what counts as a document. Replaces the default |
| `ignore` | `**/node_modules/**`, `.claude/**`, `.github/**`, `**/CHANGELOG*`, `**/LICENSE*` | Globs for documents kb should never look at. Adds to the default |
| `rules` | none | Ordered list. The first rule whose `match` fits a path decides its class |

## Rules

| Field | Meaning |
|---|---|
| `match` | One glob or a list of globs, relative to the repository root. `*` stays inside one path segment, `**` crosses segments |
| `class` | `living`, `record`, `raw` or `ephemeral` |
| `exit` | Ephemeral only. One sentence that says what ends this kind of doc's usefulness. The sweep reads it and looks for proof |
| `maxAgeDays` | Ephemeral only. The doc counts as expired once its last commit is older than this |
| `keepLatest` | Ephemeral only. Of the docs this rule matches, sorted by path, all but the last N count as expired. Meant for date-prefixed file names |

A doc that no rule matches is `unclassified`, and the sweep either proposes a rule for it or flags it.

Only files tracked by git are inventoried. An uncommitted doc is work in progress, and deleting it could not be undone.
