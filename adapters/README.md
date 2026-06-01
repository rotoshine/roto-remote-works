# Agent adapters

The processing protocol (`docs/PROTOCOL.md`) is **agent-neutral** — the `rrw` CLI
+ web-ask (`rrw ask`) are the only seam. Each adapter wires that protocol into a
specific agent:

| Adapter | How it triggers | File |
|---------|-----------------|------|
| **Claude Code** | `rrw-process` skill + a Monitor watch on the bridge | `skills/rrw-process/SKILL.md` |
| **Codex** | reads `AGENTS.md`; invoke it (or via the worker) to process | `adapters/codex/AGENTS.md` |
| **Generic / headless** | `rrw worker` polls the bridge and invokes your agent headlessly (`claude`/`codex`/custom) | `packages/agent` (`rrw worker`) |

**Add a new agent**: point it at `docs/PROTOCOL.md`, make sure it can run `rrw`
(env: `RRW_BRIDGE_URL`, `RRW_TOKEN`), and either give it a trigger (watch/poll) or
register it as a worker runner.
