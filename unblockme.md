# Dashboard unblock record

The canonical record belongs to the central orchestration documentation
repository. In this workspace its accepted clean develop checkout is currently:

[Canonical Dashboard unblock record](/Users/yogi/Coding/.worktrees/asset-flow-review-policy-develop/docs/projects/etoro-dashboard/unblockme.md)

Resolve the accepted checkout before using the link. The named central checkout
and legacy docs links can point to another branch; they are compatibility paths,
not proof of accepted policy or current project documentation.

From this Dashboard checkout, run the verified orchestration bootstrap:

```sh
python3 /Users/yogi/Coding/.worktrees/asset-flow-review-policy-develop/scripts/workspace-context.py \
  bootstrap --repo "$PWD" --role developer
```

Use the returned projectMemory directory for unblockme.md, API/architecture/
security notes, design review and dated validation. If the develop worktree moves,
first follow /Users/yogi/Coding/AGENTS.md to locate and verify it, then use that
checkout's bootstrap. A standalone Dashboard clone does not bundle canonical
central records; report missing context instead of assuming a legacy link is
current. This file contains no account data or external provider authorization.
