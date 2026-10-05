---
name: review
description: Work through everything kb flagged for a person, one item at a time, and carry out each decision. Use when asked to review kb's flags, answer what kb is waiting on, or go through the "Needs you" list.
---

# Review what kb is waiting on

kb flags what it is not sure about, or what is not its call, into the review list in kb's local folder. This skill walks the person through the open items and does what they decide.

## 1. Load the list

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" list --open --json
```

If nothing is open, say so and stop. Otherwise say how many are open, then take them oldest first. If `node "${CLAUDE_PLUGIN_ROOT}/scripts/lock.mjs" status` shows a sweep running, say that decisions about docs in its scope may conflict with its branch.

## 2. One item at a time

For each item, read the doc it names (and the backlog entry, for a `decide` item) so you can answer follow-up questions. Then show the person:

- the doc, and how long the item has waited
- the question
- what kb would do, and why it did not
- the evidence, and the pull request it came from

Offer kb's suggestion as the first choice, then the other sensible answers, then "skip". Never decide for them. An item the person skips stays open.

## 3. Carry out the decision

Do what they decided, following kb's own rules:

- **Delete or distill the doc:** follow the `kb:distill` skill, one commit per doc.
- **Keep it:** change nothing. If the answer applies to every doc of its kind ("these are records", "never touch notes/"), change the rule in `kb.json` instead, in its own commit, so the whole group stops being flagged.
- **A `decide` item:** write the decision into its backlog entry (it becomes ordinary work, or the entry is removed if the answer is "no"), and drop the `Decide:` prefix.
- **A change outside the repository:** only in a source with write access, re-reading the item just before writing, and logging the old value.
- **Something kb cannot do** (a prod setting, an account, a conversation): record the answer, and note in the outcome that the person will handle it.

Make repository changes on a branch named `kb/review-<YYYY-MM-DD>` from the base branch, and open one pull request for the session listing each decision. If the person is already on a branch of their own and asks you to work there, do that instead.

## 4. Record the answer

After each item, whatever the outcome:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" answer <id> --answer "<their decision, in their words>" --outcome "<what you did: commit, rule, or 'person will handle'>"
```

This logs the answer, and future sweeps respect it: an answered item is not raised again unless its doc changes. Finish with a short summary of what was decided and the pull request link, and mention that `/kb:log` shows the updated list.
