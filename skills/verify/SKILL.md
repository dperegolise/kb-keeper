---
name: verify
description: Check wiki pages and other living docs against the current code and correct what is no longer true. Use after a code change touches something the docs describe, before merging a pull request, when a doc is suspected to be out of date, or when asked to verify or fact-check documentation. Takes doc paths, or `--changed-since <git-ref>` to check only the pages that cite files changed since that ref.
argument-hint: "[doc-path ... | --changed-since <ref>]"
---

# Verify living docs against the code

Arguments: $ARGUMENTS

A living doc is one that must be true: a wiki page, the README, `CLAUDE.md`, a runbook. People and agents act on these without checking, so a false statement in one does more harm than a missing one. Verifying means checking what a page claims against the code and fixing only what is false.

## 1. Pick the pages

Ask the inventory script. It lists each living doc with `changedRefs` (files the page cites that changed since the page was last verified) and `deadRefs` (paths the page cites that no longer exist):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs" --class living                       # everything living
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs" --changed-since origin/main          # pages citing files in this diff
```

- With doc paths as arguments, verify those pages.
- With `--changed-since <ref>`, verify the pages that command returns.
- With no arguments, verify the living docs that have `changedRefs` or `deadRefs`.

If that leaves no pages, say so and stop. Make no commit.

## 2. Check each page

Start from what changed. For a page stamped `<!-- verified: <sha> -->`, `git diff <sha>..HEAD -- <changedRefs>` shows what moved under it. If that commit no longer exists, because the branch that held it was rebased or squash-merged, use the commit that wrote the stamp instead: `git log -1 --format=%h -S<sha> -- <page>`. Then read the whole page and check every statement that the code can confirm or refute:

- paths, and names of functions, types, tables, columns, routes, flags, config keys, environment variables and commands
- numbers: timeouts, limits, counts, versions
- sequences: "A happens, then B"
- scope statements: "the only place that…", "always", "never", "there are two modes"

Check the whole page, not only the sentences near the changed files, because the stamp you leave vouches for all of it.

## 3. Fix what is false

Make the smallest edit that makes the statement true. Remove statements about things that no longer exist. Leave correct prose alone, and do not restructure the page or document new features while you are here. Verification that rewrites pages produces diffs nobody can review, and then nobody trusts the result.

Three cases are not yours to fix quietly:

- **More than about a third of the page is wrong.** The page needs rewriting from the code, which is a `distill`-sized job. Report it instead of patching it.
- **The page states a rule and the code breaks it.** That may be a bug in the code, not an error in the doc. Leave the doc as it is and report the mismatch.
- **You cannot tell whether a statement is true.** Leave it and report it.

Put each report on the review list, so it waits until someone answers it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" add --doc <page> --question "<what is in doubt>" --would "<the fix you would make>" --why-not "<which case above>"`. In a sweep, also list it under the pull request's "Needs you". Otherwise, tell the person you are working with.

## 4. Stamp the page

End each page you checked in full with `<!-- verified: <sha> -->`, replacing any earlier stamp. When you work on a branch that will be merged, `<sha>` is the commit you branched from (`git merge-base HEAD origin/<base>`, short form), not your own HEAD: your branch's commits may be rebased or squash-merged away, and a stamp that names one then points at nothing. When you work directly on the base branch, use `git rev-parse --short HEAD`. Stamp pages that needed no changes too: the stamp is what stops the next run from checking them again.

Do not stamp a page you reported under the three cases above.

## 5. Commit

Run by hand, verify does not take the sweep lock. If `node "${CLAUDE_PLUGIN_ROOT}/scripts/lock.mjs" status` shows a sweep running, mention that your corrections may conflict with its branch.


When you are verifying as part of someone's in-progress change, leave the edits in the working tree for them to commit with their work, unless they asked you to commit.

Either way, log each page you stamped as `verify` (`review.mjs add` already logged the ones you reported).

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/log.mjs" verify verify docs/wiki/dialer-pacing.md --why "<what was false, or: all true>" --evidence "<file that shows it>"
```

Otherwise make one commit per corrected page, and one shared commit for pages that only gained a stamp:

```
kb: verify docs/wiki/dialer-pacing.md

- <what was false> -> <what it says now> (<file that shows it>)

KB-Verified: docs/wiki/dialer-pacing.md
```
