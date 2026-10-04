---
name: sweep
description: Garbage-collect a repository's documentation. Triages every doc by its lifecycle class, distills what is still true into the wiki, deletes what is finished or obsolete, verifies living docs against the code, and opens one pull request that lists what was done and what needs a human decision. Use for the scheduled docs sweep, or when asked to clean up, prune or de-stale the docs. Optional arguments limit the sweep to some paths.
argument-hint: "[path-or-glob ...]"
---

# Sweep the docs

Scope: $ARGUMENTS (empty means the whole repository)

Docs accumulate because writing one is easy and nothing ever removes it. The sweep is the removal step. It goes through the docs, decides what each one is still good for, acts where the evidence is clear, and hands the rest to a person in one pull request.

A sweep usually runs unattended on a schedule. Do not stop to ask questions. Anything you would ask becomes an entry under "Needs you" in the pull request.

## 1. Set up

1. Read `kb.json` at the repo root. If it is missing, stop and say that `/kb:setup` has to run first.
2. Check for a sweep that is still waiting: `gh pr list --state open --search "head:kb/sweep-"`. If one is open, stop and report its link. Sweeps stacking up unread means the review queue is not being read, and adding to it makes that worse.
3. `git fetch`, then create `kb/sweep-<YYYY-MM-DD>` from `origin/<base>`, where `<base>` is `base` in `kb.json` or else the default branch. If the working tree has uncommitted changes, work in a temporary `git worktree` so that you never touch someone's work in progress.
4. Take the inventory and keep the JSON where you can re-read it:

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

1. **The exit condition has happened and you can point to the proof.** `expired: true` is proof for rules based on age or count. Otherwise the proof is in the repository: the commit that fixed the bug, the code that implements the design, the newer doc that replaces this one. A "STATUS: done" line inside the doc is a lead to check, not proof.
2. **Nothing lasting is lost.** Every claim that is still true, that the code cannot tell a reader, and that someone will need again is already in the wiki or goes there in this same commit.
3. **Nothing open is lost.** Unanswered questions, unfixed findings and unbuilt parts move to the backlog named in `kb.json`. If no backlog is configured, flag the doc.
4. **Its references are handled.** Every file in `inbound` is repointed or cleaned up as the `distill` skill describes.
5. **You read all of it.** A `.docx`, `.pdf` or other file you cannot read in full is always a flag.

Flag the doc when any check fails or you had to guess. Also flag when:

- the doc and the code disagree about the main thing the doc describes, and you cannot tell which is right
- the doc records a commitment that lives outside the code, such as a promise to a customer, a legal or financial matter, or a decision someone is still waiting on
- the doc has not been touched for a long time, its exit condition has not happened, and it has `deadRefs`: it may be abandoned, and only a person knows

A disagreement on one point does not hold up the rest of a doc. Distill the rest, leave the disputed point out of the wiki, and list it under "Needs you" with what the doc says and what the code does.

For each doc you distill, follow the `kb:distill` skill. Load it before the first one.

## 4. Order and budget

Work from the cheapest decisions to the most expensive:

1. expired ephemeral docs
2. other ephemeral docs whose exit condition has happened
3. living docs that need verifying, following the `kb:verify` skill
4. unclassified docs

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

Do not merge the pull request. If you cannot push or `gh` is unavailable, leave the branch in place and report its name along with the body you would have posted.
