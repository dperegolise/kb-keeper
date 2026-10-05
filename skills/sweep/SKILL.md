---
name: sweep
description: Garbage-collect a repository's documentation. Triages every doc by its lifecycle class, distills what is still true into the wiki, deletes what is finished or obsolete, verifies living docs against the code, and opens one pull request that lists what was done and what needs a human decision. Use for the scheduled docs sweep, or when asked to clean up, prune or de-stale the docs. Optional arguments limit the sweep to some paths.
argument-hint: "[path-or-glob ...]"
---

# Sweep the docs

Scope: $ARGUMENTS (empty means the whole repository)

Docs accumulate because writing one is easy and nothing ever removes it. The sweep is the removal step. It goes through the docs, decides what each one is still good for, acts where the evidence is clear, and hands the rest to a person in one pull request.

A sweep usually runs unattended on a schedule. Do not stop to ask questions. Anything you would ask goes to the review list and under "Needs you" in the pull request.

## The review list

The review list in kb's local folder holds every question kb is waiting on a person to answer, until they answer it with `/kb:review`. The pull request is read once; the list stays until the item is answered.

- **Before you judge any doc,** read what the person already decided: `node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" list --json`. Follow those answers. Do not ask again about an answered doc.
- **Every flag goes on the list**, with the same question you put in the pull request:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" add --doc <path> --question "<one sentence>" --would "<what you would do>" --why-not "<which check failed>" [--evidence "<proof>"]
  ```

  Exit code 4 means the person already answered this doc and it has not changed since. Do not flag it; follow the printed answer. An open item for the same doc is updated, not duplicated. `add` logs the flag for you.
- **Every `Decide:` backlog entry** also goes on the list, with `--kind decide --doc <backlog file> --backlog "<entry title>"`.
- When the pull request is open, attach it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" link-pr --branch <your branch> --pr <url>`.

## 1. Set up

1. Read `kb.json` at the repo root. If it is missing, stop and say that `/kb:setup` has to run first.
2. Take the sweep lock, so only one sweep runs at a time in this clone, whichever worktree it starts in:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lock.mjs" acquire
   ```

   It prints a token: keep it for the end. If it exits with code 3, another sweep is running. Stop, log a `blocked` line with the holder it printed as the reason, and report who holds the lock. Never delete the lock file yourself. A lock whose sweep died goes stale after an hour without a log entry and is taken over automatically.

   From here on, release the lock however the run ends, including when you stop early or something fails: `node "${CLAUDE_PLUGIN_ROOT}/scripts/lock.mjs" release --token <token>`.
3. Check for a sweep that is still waiting: `gh pr list --state open --search "head:kb/sweep-"`. If one is open, release the lock, stop and report its link. Sweeps stacking up unread means the review queue is not being read, and adding to it makes that worse.
4. `git fetch`, then create the branch `kb/sweep-<YYYY-MM-DD>` from `origin/<base>`, where `<base>` is `base` in `kb.json` or else the default branch. If that name is already taken locally or on the remote, add `-2`, `-3` and so on.
   - If the working tree is clean, create the branch right here, in the current checkout. Note the branch you started on so you can switch back at the end.
   - If it has uncommitted changes, never touch them. Create a `git worktree` next to the repository (`../<repo>-kb-sweep-<date>`), not in a temp directory, so the person can find it afterwards.
5. Make sure the repository's commit hooks can run before your first commit. A fresh worktree usually has no installed dependencies, and a hook that runs a formatter or linter then fails. If the repository has a lockfile but its dependencies are not installed in this checkout, install them with its package manager (for example `pnpm install --frozen-lockfile`). Never bypass a hook. Run the formatter it uses on the files you wrote before committing them. If a hook fails on a file you did not write, flag it.
6. Take the inventory and keep the JSON where you can re-read it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs" --summary
   node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs" $ARGUMENTS > "${TMPDIR:-/tmp}/kb-inventory.json"
   ```

   If it reports `"shallow": true`, run `git fetch --unshallow` and take it again. Ages come from git history.

Each doc in the inventory has a `class`, its `lines`, `ageDays`, the files that mention it (`inbound`), the paths it mentions that no longer exist (`deadRefs`), and for ephemeral docs an `exit` condition and an `expired` flag.

## 2. What each class asks of you

| Class | Meaning | What the sweep does |
|---|---|---|
| `living` | Must be true: wiki pages, README, runbooks | Verify the ones with `changedRefs` or `deadRefs` |
| `record` | A decision or event, fixed when written: ADRs, release notes | Nothing. Old is correct here |
| `raw` | Source material from outside the project | Nothing |
| `ephemeral` | Useful until some event: handoffs, plans, designs, bug writeups, run reports | Judge it (section 3) |
| `unclassified` | No rule in `kb.json` matches | Add a rule to `kb.json` when the doc plainly belongs with an existing class, otherwise flag it |

Age by itself means nothing. A year-old ADR is fine, and yesterday's handoff may already be finished.

## 3. Judge each ephemeral doc

Give each one a verdict:

- **keep**: its exit condition has not happened. Say nothing about it.
- **distill**: it is finished, and part of it is still true and worth knowing.
- **delete**: it is finished, and nothing in it is worth keeping.
- **flag**: you are not sure, or the decision is not yours.

You may distill or delete without asking only when all of these hold:

1. **The exit condition has happened and you can point to the proof.** `expired: true` is proof for rules based on age or count. Otherwise the proof is in the repository (the commit that fixed the bug, the code that implements the design, the newer doc that replaces this one) or in a local source, as described under "Outside sources". A "STATUS: done" line inside the doc is a lead to check, not proof.
2. **Nothing lasting is lost.** Every claim that is still true, that the code cannot tell a reader, and that someone will need again is already in the wiki or goes there in this same commit.
3. **Nothing open is lost.** Unanswered questions, unfixed findings and unbuilt parts move to the backlog named in `kb.json`. If no backlog is configured, flag the doc. The pull request is not storage: once it is merged nobody reads it again. When an open item is a question only a person can answer, such as a warning about money, accounts or a customer, put it in the backlog as a `Decide:` entry, or keep the doc and flag it. Never let the pull request hold the only copy.
4. **Its references are handled.** Every file in `inbound` is repointed or cleaned up as the `distill` skill describes.
5. **You read all of it.** A `.docx`, `.pdf` or other file you cannot read in full is always a flag.

Flag the doc when any check fails or you had to guess. Also flag when:

- the doc and the code disagree about the main thing the doc describes, and you cannot tell which is right
- the doc records a commitment that lives outside the code, such as a promise to a customer, a legal or financial matter, or a decision someone is still waiting on
- the doc has not been touched for a long time, its exit condition has not happened, and it has `deadRefs`: it may be abandoned, and only a person knows

A disagreement on one point does not hold up the rest of a doc. Distill the rest, leave the disputed point out of the wiki, and list it under "Needs you" with what the doc says and what the code does.

For each doc you distill, follow the `kb:distill` skill. Load it before the first one.

## The backlog

Open work from distilled docs goes to the backlog, and nothing else removes it, so keep it from only growing:

- Before adding an entry, search the backlog for one about the same thing. Update that entry instead of adding a second.
- Keep an entry short: a heading and a few lines that say what is wrong and which files it touches. Its source doc is in git history; do not copy its story.
- Before adding, check that the problem still exists in the code. If it is already fixed, cite the fix in the commit and add nothing.
- After the docs, check up to 10 existing entries that cite files in the sweep's scope or that name code changed since the backlog was last edited. Remove each one whose fix you can point to, in one `kb: prune backlog` commit that lists every entry it removes and its proof.

## Outside sources

`sources.json` in kb's local folder (`node "${CLAUDE_PLUGIN_ROOT}/scripts/log.mjs" --dir`) lists places outside the repository that hold information about the same project, such as a task manager, Claude memory or another repository. It is local to this machine and never committed. Without it, use only this repository and its history. With it, the sweep keeps all of them in agreement:

- **Cross-reference.** For each doc you judge, look in the sources for the same subject: the task that tracks a backlog item, the memory note about a feature, a doc in a sibling repository. Use what you find as evidence, the same way you use the code.
- **Find the source of truth.** When they disagree, the code wins on how the system works. A source wins on what its `truthFor` names. Otherwise the most recent statement you can confirm wins. When you cannot tell, it goes under "Needs you".
- **Bring the rest in line.** Fix the repository's copies in your commits as usual. A source with `"access": "write"` you update directly. Git cannot revert that change, so log each outside write with the old value and list it under "Done" with where it happened. **Re-read the item immediately before you write it.** If it changed since you read it for your decision, whether by the person, another tool or another session, do not write. List it under "Needs you" with both versions. For a source with `"access": "read"`, list the correction under "Needs you".
- **Respect `ignore`.** Paths in `ignore` are off limits everywhere, both as evidence and as something to change.
- **Keep outside data out of shared places.** Put working copies under `tmp/` in kb's local folder, not in `/tmp`, and delete them when you finish.
- **Keep the open-work lists in step.** When a source with `"access": "write"` is the truth for open work, an open item you move to the backlog also needs a task there. Find the existing task, or create one. When you prune a backlog entry, close or update its task.
- **Keep the repository tool-agnostic.** Never write a source's name, task IDs or links, or local paths into files in the repository. The link between a backlog entry and its task goes in the log (`--evidence` with the task ID, `--where` with the source), and you find it again by searching the source for the entry's title.
- **Brief your helpers.** If you hand work to helper agents, give them these rules too: the local `tmp/` folder, the `ignore` list, keeping source names out of the repository, and that they report findings to you rather than writing to sources or the log themselves.

## Log what you do

Every action goes in the local activity log, with the reason, so that a person can see later what kb did and why:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/log.mjs" sweep <action> <target> --why "<reason>" [--evidence "<commit, file or task>"] [--where <source name>]
```

Log each action right after you take it, not in a batch at the end, so the times show the order things happened in. Log `start` (target: the scope) right after you take the lock, and `finish` (target: the pull request link, or `clean`) at the end. In between, log one line per `delete`, `distill`, `backlog-add`, `backlog-prune`, `verify`, `config` change and outside `update`, with the source's name as `--where`. Flags are logged by `review.mjs add`. A doc you keep needs no line. `--why` says the reason in this case, not the kind of action: for a `backlog-add`, name the doc the item came from and what is still open. The log lives in the git directory, so it records your reasoning without adding to the pull request or the repository.

## 4. Order and budget

Work from the cheapest decisions to the most expensive:

1. expired ephemeral docs
2. other ephemeral docs whose exit condition has happened
3. living docs that need verifying, following the `kb:verify` skill
4. backlog entries, as described under "The backlog"
5. unclassified docs

Stop at about 40 source docs for one pull request, unless the person who started the sweep gave another limit. A pull request too large to review gets merged unread or not at all. List what you did not reach under "Carried over"; the next sweep picks it up.

## 5. Commit

One commit per source doc, in the format the `distill` skill gives, so that any single decision can be reverted. One commit per corrected living doc, in the format the `verify` skill gives. Changes to `kb.json` get their own commit.

Follow the repository's own rules for commits and pushes (`CLAUDE.md`, hooks).

## 6. Open the pull request

If you changed nothing and flagged nothing, do not open a pull request. Say that the docs are clean and stop.

Otherwise push the branch and open a pull request against `<base>`, titled `kb sweep <date>: <N> lines removed, <M> need you`, with this body:

```markdown
## Done

| Doc | Action | Evidence | Now in |
|---|---|---|---|
| docs/HANDOFF-X.md | distilled | built in a1b2c3d | docs/wiki/dialer-pacing.md |
| docs/runs/2026-01-01.md | deleted | expired (keepLatest 5) | |
| docs/wiki/billing.md | verified | 2 corrections | |

## Needs you

### docs/SOME-DESIGN.md
**Question:** <the decision you need, in one sentence>
**I would:** <what you would do and why>
**Why I did not:** <which check failed>

## Carried over

<docs not reached this run, by folder, with counts>

## Undo

Each doc is its own commit. `git revert <sha>` restores one. After a squash merge, restore a file with
`git log --diff-filter=D --format=%h -- <path>` and then `git checkout <sha>^ -- <path>`.
```

Release the sweep lock with your token. Do not merge the pull request. If you cannot push or `gh` is unavailable, leave the branch in place and report its name along with the body you would have posted.

If you created the branch in the person's own checkout and started on a branch, switch back to it. If you started on a detached HEAD, stay on the sweep branch. Leave a worktree you created in place, and report its path.
