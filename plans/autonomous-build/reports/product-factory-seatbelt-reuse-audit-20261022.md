# Product Factory / System-Agentic Seatbelt reuse audit

Date: 2026-10-22
Scope: read-only audit; no campaign state, browser state, credentials, or external systems changed.

## Verdict

`PARTIAL_REUSE_AVAILABLE`, `PRODUCT-FACTORY-SANDBOX-001` remains open.

The existing System-Agentic AI Tool Runtime is reusable as a narrow execution
backend through the existing `src/product-factory.mjs` adapter. It must not be
promoted to an arbitrary Product Factory sandbox merely because the Python
executor and macOS `sandbox-exec` are present.

No source change was required or made in this audit.

## Existing reusable contract

Source: `/Users/nam/Documents/System-Agentic_AI/products/agent-runtime/tool_executor.py`

The frozen executor currently provides:

- typed requests only: `workspace_exec` or `run_tests`;
- explicit `READ_ONLY` and `WORKSPACE_WRITE` policies;
- `ELEVATED` rejection;
- argv validation and approved executable roots;
- fresh temporary scratch directory per invocation;
- macOS Seatbelt profile with `(deny default)`;
- workspace and scratch read scope;
- workspace writes only for `WORKSPACE_WRITE`;
- outbound and inbound network denial;
- bounded timeout (maximum 120 seconds);
- bounded combined output (256 KiB);
- process-group termination on timeout/cancellation;
- secret-safe environment defaults and no authenticated connector/write action.

The runtime README documents the same contract and states that no authenticated
service writes are exposed by this backend.

## Existing marketing-seeding adapter

Source: `/Users/nam/Documents/marketing-seeding-integration/src/product-factory.mjs`

The adapter already:

- imports the frozen executor without modifying System-Agentic Core;
- validates that the executor path remains under the configured runtime root;
- sends a typed `READ_ONLY` request and no shell command;
- stages repository input in a temporary copy;
- routes Node probes through `/usr/bin/env node`;
- rejects unsafe/unallowlisted project manifest commands;
- redacts secret-like output;
- kills the detached bridge process group on timeout;
- fails closed unless all `factory-sandbox-v1` checks are explicitly `PASS`.

Focused tests in `test/product-factory.test.mjs` cover adapter request shape,
fail-closed behavior, staging, and all-pass attestation handling.

## Runtime observations

- `probeSystemAgenticSeatbeltCapability()` reports backend presence only as
  `backendInvocation=PASS`; profile, network, filesystem, child-process,
  timeout, and resource checks remain `UNSUPPORTED` without an explicit host
  attestation.
- The actual executor was invoked against synthetic temporary workspaces. The
  `/bin/echo` typed command completed under Seatbelt. Python probes using the
  host `/usr/bin/python3` failed before execution because this machine has no
  active developer tools (`xcode-select`), so they are not valid evidence of
  policy behavior.
- No arbitrary repository build, render, package-manager, media-generation, or
  network operation was run.

## Why this does not remove the blocker

The Product Factory contract requires independently reviewed, repeatable proof
for all of:

1. backend invocation;
2. profile integrity;
3. network denial;
4. filesystem scope;
5. child-process policy;
6. timeout/descendant cleanup;
7. resource limits.

The current Tool Runtime source demonstrates intended safeguards, but source
inspection and a harmless `echo` invocation do not establish each property on
this host. There is no persisted, independently reviewed attestation artifact
that is consumed by the service. Creating an attestation from these observations
would weaken the existing fail-closed boundary and would be incorrect.

## Reuse decision

- **Reuse now:** typed Seatbelt backend as a fail-closed adapter and for narrow
  synthetic/local probes that do not require arbitrary project execution.
- **Do not enable:** `executionEligible=true` for arbitrary Product Factory
  build/run/render/package-manager commands.
- **Do not rebuild:** another sandbox, executor, or Core contract.
- **Required future input:** a host-level, reproducible attestation for the
  seven checks, reviewed independently and persisted in a bounded capability
  artifact. The service can then consume that exact attestation without
  changing frozen Core semantics.

## Commands and evidence

Read-only/static:

```text
rg -n "sandbox|Seatbelt|execution_policy|tool_executor" \
  /Users/nam/Documents/System-Agentic_AI/products/agent-runtime \
  /Users/nam/Documents/marketing-seeding-integration/src/product-factory.mjs
```

Synthetic executor invocation (no external side effect):

```text
python3 ... execute_command({tool:"workspace_exec", ... argv:["/bin/echo","ok"], execution_policy:"READ_ONLY"})
=> execution_status=COMPLETED, exit_code=0, stdout="ok\n"
```

The failed Python probes were environment/toolchain failures and are not
claimed as sandbox certification.

## Limitations / remaining blocker

`PRODUCT-FACTORY-SANDBOX-001` remains `OPEN` / environment blocker. Product
Factory remains `NOT_EXECUTED_UNSAFE` for arbitrary project execution until the
attestation exists. This audit did not modify canonical state or external
services.

## Seven-check gap analysis

| Check | What source/probes establish | Why it is not a host attestation |
|---|---|---|
| backend invocation | `sandbox-exec` lookup and typed wrapper path exist; `/bin/echo` synthetic run completed | does not prove profile behavior for every invocation |
| profile integrity | source constructs `(version 1)`, `(deny default)` and scoped read/write rules; unit tests inspect generated profile | tests inspect strings/mocks, not kernel enforcement on the host |
| network denied | profile contains inbound/outbound deny rules | no valid Python/socket probe ran on this host; source intent alone is insufficient |
| filesystem scope | read roots and workspace/scratch write rules are constructed; read-only write attempt did not create a file (Python failed before body) | no successful interpreter probe, symlink and outside-path matrix on host |
| child-process policy | profile says `(allow process*)`; timeout code kills the process group | this is permissive process policy, not a bounded child-process/resource policy; descendant cleanup is only exercised on timeout |
| timeout cleanup | process-group kill and force cleanup are implemented; unit tests mock timeout | no host-level descendant probe completed; this is a runtime mechanism, not persisted attestation |
| resource limits | timeout/output limits exist | CPU, memory, process count, file-size, and other resource limits are not configured in `tool_executor.py`; this check cannot be PASS |

Because `resourceLimits` cannot be honestly marked `PASS` from the current
backend, a mechanical attestation would be false. No attestation artifact was
created and no execution eligibility was changed.
