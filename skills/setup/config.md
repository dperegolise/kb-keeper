# kb.json reference

`kb.json` lives at the repository root. Every key is optional.

```json
{
  "wiki": "docs/wiki",
  "base": "main",
  "backlog": "docs/BACKLOG.md",
  "ignore": ["finance/**", "notes/**"],
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

## Local sources

Outside sources are not part of `kb.json`, because they name one person's tools and paths and the repository stays tool-agnostic. They live in `sources.json` in kb's local folder, inside the git directory (`node scripts/log.mjs --dir` prints it), and are never committed:

```json
[
  { "name": "Todoist", "how": "the `td` CLI, project Product", "access": "write", "truthFor": "which work is open and its status" },
  { "name": "Claude memory", "how": "~/.claude/projects/-home-me-src-app/memory/", "access": "write" },
  { "name": "marketing site", "how": "~/src/app-site", "access": "read", "truthFor": "pricing and plan names" }
]
```

Sweeps cross-reference every source and bring wrong copies in line with the source of truth. Without the file, kb looks only at the repository.

| Field | Meaning |
|---|---|
| `name` | What the source is called in logs and pull requests |
| `how` | How to reach it: a path, or the command-line tool and the part of it that belongs to this project |
| `access` | `read`: use it as evidence, and report what is wrong in it under "Needs you". `write`: kb may also correct it directly, and logs every change with the old value |
| `truthFor` | Optional. What this source decides when it disagrees with another. The code always decides how the system works |

Paths in `ignore` are off limits in sources too.

## Activity log

Every skill appends one line per action to `log` in kb's local folder: time, skill, action, target, where (`repo` or a source name), branch, why, evidence. The folder is `kb/` inside the repository's common git directory, so git never tracks it and every worktree shares it. `scripts/log.mjs` writes it, and `node scripts/log.mjs --path` prints where it is. Each write also rebuilds `log.html` in the same folder from `viewer/log.html` (`scripts/view.mjs`); `/kb:log` opens it.

A doc that no rule matches is `unclassified`, and the sweep either proposes a rule for it or flags it.

Only files tracked by git are inventoried. An uncommitted doc is work in progress, and deleting it could not be undone.
