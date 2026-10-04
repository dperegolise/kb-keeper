---
name: setup
description: Set up kb in a repository. Classifies the existing docs into lifecycle classes, writes kb.json, creates the wiki, adds the docs rules to CLAUDE.md, and schedules the recurring sweep.
disable-model-invocation: true
---

# Set up kb in this repository

kb keeps documentation from going stale by giving every doc a lifecycle class and sweeping on a schedule. Setup decides the classes for this repository and installs the schedule. It does not clean anything up; the sweeps do that afterwards.

Do the work on a branch named `kb/setup` (add `-2`, `-3` and so on if that name is taken locally or on the remote) and finish with a pull request. Before committing, make sure the repository's commit hooks can run: if it has a lockfile but no installed dependencies in this checkout, install them. Never bypass a hook.

## 1. Survey

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs" --summary
```

With no `kb.json` yet, everything shows as unclassified, grouped by folder. Open a few docs in each folder and each recurring file-name pattern (`HANDOFF-*.md`, `*-DESIGN.md`) until you know what kind of doc lives there.

## 2. Classify

For each folder or pattern, ask what ends the usefulness of a doc of this kind:

| Answer | Class |
|---|---|
| Nothing. It records a decision or an event, and stays correct as written | `record` |
| It has to be true for as long as it exists | `living` |
| An event: a merge, a fix, a newer version of the same doc, the passing of time | `ephemeral`, with an `exit` sentence naming that event |
| It is source material from outside the project | `raw` |
| It is not project documentation at all: finance, legal, marketing copy, generated output | add it to `ignore` |
| It is the person's scratch space: notes, drafts, a journal | add it to `ignore`. kb never reads or changes it |

Give an ephemeral rule `maxAgeDays` or `keepLatest` when its exit is mechanical, as with run reports and daily notes. The sweep can then expire those docs without reading for proof.

Existing docs that must stay true where they are (`README.md`, `CLAUDE.md`, a runbook) are `living` in place. Do not move them into the wiki during setup.

Show the person the proposed classification as a table of pattern, class, exit condition, doc count and line count. Ask about the groups you were unsure of before writing anything. A wrong class is the one setup mistake that costs something later: `ephemeral` on a doc that should be a record gets it deleted.

Then write `kb.json`. The format is in [config.md](config.md). Set `base` when sweeps should target a branch other than the default one. Set `backlog` to a Markdown file in the repository where this project keeps open work. If the project also tracks work in an outside tool (Jira, Linear, Todoist, a sprint board), still create the backlog file as the inbox for open work found in docs, and list the tool under `sources` so sweeps can keep the two in agreement. Run the summary again and confirm that nothing important is left unclassified.

## 3. Outside sources

Ask the person where else information about this project lives, and whether kb may only read each place or also update it:

- a task manager with a command-line tool, such as `td` for Todoist or `gh issue` for GitHub issues
- Claude memory for this repository: `~/.claude/projects/<the repository path with / replaced by ->/memory/`
- other repositories on the machine that document the same product or business

Write each one to `sources` in `kb.json` as described in [config.md](config.md): how to reach it, its access, and what it is the source of truth for. Sweeps cross-reference everything listed there and bring the copies that are wrong in line with the source of truth. Leave `sources` empty when the person wants kb to look only at the repository, and always for a repository whose sweeps run in CI, where none of these tools exist.

## 4. Start the activity log

kb keeps a local log of every action it takes and why. Add `.kb.log` to `.gitignore`, then create the log:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/log.mjs" --init
node "${CLAUDE_PLUGIN_ROOT}/scripts/log.mjs" setup config kb.json --why "<one line: the classes and sources chosen>"
```

The log is `.kb.log` at the root of the main checkout, so sweeps run in any worktree add to the same file.

## 5. Create the wiki

If the wiki folder does not exist, create it with an `index.md` that holds a title and one sentence saying that each page is listed below with the question it answers. Leave it empty otherwise. Pages arrive as sweeps distill docs into it.

## 6. Tell future sessions the rules

Add this section to `CLAUDE.md` (or `AGENTS.md` if that is what the project uses), adjusting the paths:

```markdown
## Docs

- How the system works: `docs/wiki/index.md`. Read the page for a subsystem before changing it. If your change makes a page false, fix the page in the same change (`/kb:verify`).
- Working docs (handoffs, plans, bug writeups, run reports) go in their existing folders. `kb.json` says what ends each kind. When the work a doc tracks is finished, distill it (`/kb:distill <path>`) instead of marking it done.
- Keep status and history out of docs: no "DONE", no "BUILT <date>", no struck-through items. Finished items are deleted. Git and the release notes are the history.
```

Then look for skills and scripts in the repository that generate docs, for example by searching `.claude/skills/` and `scripts/` for the doc folders. Where one writes a new file on every run, check that an ephemeral rule with `keepLatest` or `maxAgeDays` covers its output folder. Where one appends status to a living doc, propose changing it and let the person decide.

## 7. Schedule the sweep

Offer both options and install the one the person picks.

**GitHub Actions.** Copy `${CLAUDE_PLUGIN_ROOT}/templates/kb-sweep.yml` and `${CLAUDE_PLUGIN_ROOT}/templates/kb-verify.yml` into `.github/workflows/`. The first runs the sweep weekly and on demand. The second runs on pull requests and checks the wiki pages that cite the changed files. Both need a `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` repository secret, and the plugin's repository must be reachable from the runner. Tell the person which secret to add.

**A Claude Code routine.** Use `/schedule` to create a weekly routine in this repository whose prompt is `/kb:sweep`. The routine's environment needs this plugin installed.

## 8. Hand over

Commit `kb.json`, the `.gitignore` line, the wiki index, the `CLAUDE.md` section and any workflow files, and open the pull request.

In the description, suggest the order for the first cleanup: one `/kb:sweep <folder>` per folder, starting with the folders that have the most expired docs, and leaving design docs for last because they need the most reading. Each run produces its own pull request, and merging one makes the next one start from a smaller pile.
