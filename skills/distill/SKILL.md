---
name: distill
description: Fold a finished or outdated document into the project wiki and delete it. Keeps only what is still true and that the code cannot tell you, checks it against the code, merges it into the wiki page for that topic, repoints references to the old doc, and removes the source in the same commit. Use when asked to distill, absorb, fold in or retire a handoff, design doc, plan, bug writeup, report or notes, or to write up how something works in the wiki.
argument-hint: "<doc-path ...>"
---

# Distill a document into the wiki

Documents to distill: $ARGUMENTS

The wiki is the small set of pages someone reads to learn how this project works today. Almost every other doc in a repo was written at a moment, for a purpose: a plan, a handoff, a bug investigation, a test run. Those pile up and go stale, and an agent that finds one by search cannot tell it is stale. Distilling moves the lasting part of such a doc into the wiki and deletes the rest. Git history keeps the original, so nothing is lost for good.

The wiki's location is `wiki` in `kb.json` at the repo root (default `docs/wiki`). Its `index.md` lists every page.

## What belongs in the wiki

A wiki page says how something works now and why it is that way. It holds what a reader could not get quickly from the code:

- **Reasons.** Why it is built this way, what constraint forced it, which alternative was tried or rejected and why. This is what stops someone from repeating a mistake.
- **Rules the code relies on** but never states in one place: invariants, ordering requirements, things that must stay in sync.
- **How a flow crosses files or services.** The map, not the territory.
- **Procedures.** How to run, deploy, recover, provision.
- **Lessons.** The trap a bug revealed, written as the rule to follow, without the story of the bug.
- **Vocabulary.** What the project's own terms mean.

Leave out:

- **Anything the code states directly:** signatures, file listings, schemas, config values, a walk through one function.
- **History and status:** when it was built, who built it, how it used to work, which phase is done. Git and the release notes hold that.
- **Plans and open work.** Those are tasks. They go to the project's backlog (`backlog` in `kb.json`), not the wiki.
- **Anything you could not confirm** against the code.

Expect a large reduction. A 500-line design doc for a feature that has shipped usually leaves 20 to 60 lines. If you are carrying most of a doc across, you are archiving it, and the wiki will rot the same way the doc did.

## Steps

1. **Read the whole doc** and list the claims worth keeping by the test above.

2. **Check each claim against the current code.** Open the files it names and search for the identifiers it uses.
   - True now: keep it.
   - False now: drop it.
   - Describes something not built: it is open work. Move it to the backlog if that is still wanted, otherwise drop it and say so in the commit.
   - The doc states a rule and the code breaks it, and you cannot tell which one is right: stop on that claim. It may be a bug in the code. Report it instead of choosing a side.
   - A code comment is not the code. When a comment and the doc disagree, check what the code actually does (configuration, exports, call sites) and go with that. Report the wrong one, the comment or the doc, as a stale line to fix.

3. **Choose the page.** Read `index.md` first and prefer an existing page. Name a page for the thing it describes (`dialer-pacing.md`), never for the document or event it came from (`powerdialer-design.md`, `phase-1-handoff.md`). Start a new page only when no page covers the topic. Split a page that passes about 300 lines.

4. **Write it in.** Use the present tense. Merge the new material into the page's existing structure instead of appending one section per source document. Name the files that implement what you describe, as repo-relative paths in backticks: the inventory script reads those paths to tell when a page needs checking again.

5. **Stamp new pages.** End a page you wrote in full with `<!-- verified: <sha> -->`. Use the commit your branch started from (`git merge-base HEAD origin/<base>`, short form), or `git rev-parse --short HEAD` when you work directly on the base branch. Never stamp a commit of your own branch: rebasing or squash-merging it leaves the stamp pointing at nothing. When you only added to an existing page, leave its stamp alone: the stamp vouches for the whole page, and you checked only your part.

6. **Update `index.md`:** one line per page, the link plus the question the page answers.

7. **Repoint references to the source doc.** List them:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs" <doc-path>
   ```

   The doc's `inbound` array names every file that mentions it.
   - In code comments, point at the wiki page when the page now holds what the comment cited. Otherwise remove the citation and keep the comment's own explanation.
   - In other working docs, repoint the link, or leave it when that doc is being distilled in the same run.
   - In records such as ADRs and release notes, change only the link target, never the text.

8. **Delete the source,** along with attachments that belong only to it, such as a sibling folder of screenshots.

9. **Commit.** One commit per source doc, holding the wiki edit, the reference fixes and the deletion together, so that reverting the commit restores everything about that doc:

   ```
   kb: distill docs/HANDOFF-X.md into docs/wiki/dialer-pacing.md

   Exit: <what shows the doc was finished: a commit, the code that implements it, a newer doc>
   Kept: <one line on what moved to the wiki>
   Dropped: <anything a reader might miss, and why it was dropped>

   KB-Source: docs/HANDOFF-X.md
   ```

10. **Log it** in the activity log, with the same reasoning as the commit's `Exit:` line:

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/scripts/log.mjs" distill distill <doc-path> --why "<exit, in one line>" --evidence "<commit or file>"
    ```

When nothing in a doc is worth keeping, skip the wiki, delete the doc, and use `kb: delete <path>` as the subject with the same body. Log it with the action `delete`.

Run by hand, distill does not take the sweep lock. If `node "${CLAUDE_PLUGIN_ROOT}/scripts/lock.mjs" status` shows a sweep running, tell the person that their change may conflict with its branch. Before changing anything outside the repository, re-read it, and if it changed since you read it, stop and show the person both versions.

When a person asks you directly to distill a doc, they have already decided it should go. When the sweep calls this, the sweep's rules decide whether a doc may be deleted without asking.
