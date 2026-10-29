# Project coordinator startup

`scripts/install-project-coordinator-launch-agent.mjs` installs the project
coordinator as a user `launchd` agent. It writes only under the user's
`Library/LaunchAgents` and the ignored runtime state directory. The supervisor
uses the durable coordinator state file and the exact Orca `terminal send`
request ID for recovery; it never creates a second marketing orchestrator.

Install/reload locally:

```bash
node scripts/install-project-coordinator-launch-agent.mjs
launchctl print gui/$(id -u)/ai.marketing-seeding.project-coordinator
```

Remove the startup agent:

```bash
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/ai.marketing-seeding.project-coordinator.plist"
```

Register a durable native task without running it in the submitting process:

```bash
node scripts/project-coordinator-supervisor.mjs --state-file "$HOME/build-agentic-AI/.agentic/marketing-seeding/project-coordinator/state.json" --task-file /path/to/task.json --register-only
```

The running LaunchAgent observes the persisted `RUNNING` task on its next tick,
acquires the process lock, then dispatches the native session call.

The launch agent is for project integration tasks only. It does not log in,
grant authority, publish, retry UNKNOWN, or operate social accounts.
