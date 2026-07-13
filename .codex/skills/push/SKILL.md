---
name: push
description: Review all uncommitted work and commits not yet pushed on the current branch, fix credible findings, commit remaining changes, and push. Use when the user invokes `$push` or asks to review, commit, and push all current branch work.
---

# Push Reviewed Changes

Use this workflow only inside the current Git repository. Invoking `$push` authorizes committing and pushing the current branch, but never force-pushing, resetting, discarding work, or exposing secrets.

1. Inspect `git status --short --branch`, the upstream, and commits not present on the upstream.
2. Load and follow the active `$full-review` skill exactly. Its review scope must include both the uncommitted worktree and all commits ahead of the branch upstream.
3. Let `$full-review` perform its required review/remediation, commits, validation, and normal push behavior.
4. If it has not pushed, push the current branch to its upstream; if no upstream exists, push `HEAD` to `origin` under the current branch name and set upstream.
5. Report the review steps, created commits, validation evidence, final push target, and any remaining risks or blockers.
