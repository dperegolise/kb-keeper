# kb

A Claude Code plugin that keeps a repository's documentation from going stale.

Docs pile up because writing one is easy and nothing ever removes it. Handoffs, plans, design docs, bug writeups and run reports outlive the work they describe, and an agent that finds one by search cannot tell that it is out of date. kb adds the missing removal step: a scheduled sweep that distills finished docs into a small wiki, deletes what is obsolete, checks the wiki against the code, and puts everything it was unsure about in one pull request.

## How it works

Every doc gets a lifecycle class from a rule in `kb.json`:

| Class | What it is | What kb does with it |
|---|---|---|
| `living` | Must be true: wiki pages, README, runbooks | Checks its claims against the code when the files it cites change |
| `record` | A decision or event, fixed when written: ADRs, release notes | Nothing. Old is correct |
| `raw` | Source material from outside the project | Nothing |
| `ephemeral` | Useful until some event: handoffs, plans, designs, bug writeups, run reports | Distills it into the wiki and deletes it once that event has happened |

Age alone decides nothing. A year-old ADR is fine, and yesterday's handoff may already be finished. What matters is the kind of doc and whether its claims still match the code.

The pieces:

- **`scripts/inventory.mjs`** is a dependency-free Node script that uses no model. For every doc it reports the class, size, age, which files mention it, which paths it cites that no longer exist, and for living docs which cited files changed since the page was last verified. This is the worklist.
- **`/kb:sweep [paths]`** triages the worklist, acts where the evidence is clear, and opens one pull request with a "Done" table and a "Needs you" list.
- **`/kb:distill <doc>`** folds one doc into the wiki: it keeps what is still true and that the code cannot tell you, repoints references, and deletes the source in the same commit.
- **`/kb:verify [docs | --changed-since <ref>]`** checks living docs against the code and fixes only what is false.
- **`/kb:setup`** classifies a repository's existing docs, writes `kb.json`, and installs the schedule.
- **`/kb:review`** walks you through everything kb flagged for you, one item at a time, and carries out each decision. Answered items are not raised again unless their doc changes.
- **`/kb:log`** opens the activity page: what is waiting on you, with a box on each item to type your answer, what kb did in this repository, and why.

## When the sweep acts without asking

It distills or deletes a doc only when all of these hold. Anything else is flagged in the pull request.

1. The doc is `ephemeral`, and its exit condition has happened with proof in the repository: a commit, the implementing code, a newer doc, or a mechanical expiry rule.
2. Every lasting claim in it is already in the wiki or moves there in the same commit.
3. Open questions and unfinished work move to the backlog.
4. Every reference to the doc from code or other docs is repointed.
5. The doc is text the model read in full. Binary formats are always flagged.

Each doc is its own commit, so `git revert <sha>` undoes a single decision. Merge sweep pull requests with a merge commit or a rebase to keep that property. Git history keeps every deleted doc either way.

## Install

```bash
claude plugin marketplace add dperegolise/kb-keeper   # or a local path to this repository
claude plugin install kb@kb-keeper
```

Then, in the repository you want to keep clean:

```
/kb:setup
```

## Configuration

`kb.json` at the repository root. The full reference is in [skills/setup/config.md](skills/setup/config.md).

```json
{
  "wiki": "docs/wiki",
  "base": "develop",
  "backlog": "docs/BACKLOG.md",
  "rules": [
    { "match": ["README.md", "CLAUDE.md", "docs/RUNBOOK.md"], "class": "living" },
    { "match": "docs/adr/**", "class": "record" },
    { "match": "docs/research/**", "class": "raw" },
    { "match": "docs/HANDOFF-*.md", "class": "ephemeral", "exit": "The handed-off work is merged." },
    { "match": "docs/flow-runs/**", "class": "ephemeral", "keepLatest": 5, "exit": "A later run covers the same flows." }
  ]
}
```

## Outside sources and the activity log

kb can also keep information outside the repository in agreement with it. List a task manager, Claude memory or sibling repositories in a local `sources.json`, each with read or write access and what it is the source of truth for. Sweeps then cross-reference them, decide which copy is right, and correct the rest. The file lives inside the git directory and is never committed, so the repository stays tool-agnostic and a clone without it, such as CI, looks only at the repository.

Every action kb takes, and the reason for it, goes to a log in the same local folder (`node scripts/log.mjs --path`). Git never tracks it. Each entry also rebuilds `log.html` beside it: a "Needs you" panel with every open question in full, summary tiles, actions over time, where they happened, and the full log grouped by run, action, place or day. It works opened straight from disk, and `/kb:log` opens it in the browser.

## Scheduling

`/kb:setup` installs one of these:

- **GitHub Actions.** [templates/kb-sweep.yml](templates/kb-sweep.yml) sweeps weekly and on demand. [templates/kb-verify.yml](templates/kb-verify.yml) runs on pull requests, and only starts a model when the inventory script finds a wiki page that cites a changed file.
- **A Claude Code routine** created with `/schedule`, with `/kb:sweep` as its prompt.

Only one sweep pull request is open at a time. If the last one has not been merged or closed, the next sweep stops and says so.

## Using the inventory directly

```bash
node scripts/inventory.mjs --summary                       # classes and folders at a glance
node scripts/inventory.mjs docs/bugs --class ephemeral     # JSON for part of the repository
node scripts/inventory.mjs --changed-since origin/main --paths-only
```

Only files tracked by git are listed. An uncommitted doc is work in progress, and deleting it could not be undone.

## Development

```bash
npm test            # node --test, no dependencies
npm run validate    # claude plugin validate . --strict
```
