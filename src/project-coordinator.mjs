import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;
const TASK_STATES = new Set([
  "RUNNING",
  "WAITING_DEPENDENCY",
  "WAITING_CHATGPT",
  "BLOCKED_HUMAN_INPUT",
  "COMPLETE",
  "FAILED"
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_TASKS = 256;
const MAX_EVENTS = 512;
const MAX_ERROR = 240;

function iso(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) throw new Error("coordinator clock must return a valid date");
  return value.toISOString();
}

function id(value, label) {
  const result = String(value || "").trim();
  if (!SAFE_ID.test(result)) throw new Error(`${label} must be a path-safe identifier`);
  return result;
}

function text(value, label, max = 240) {
  const result = String(value || "").replace(/\s+/g, " ").trim();
  if (!result) throw new Error(`${label} is required`);
  return result.slice(0, max);
}

function safeError(error) {
  return String(error?.code || error?.message || error || "COORDINATOR_TASK_FAILED")
    .replace(/(?:password|passphrase|secret|token|cookie|credential|api[_-]?key|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR);
}

function initialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    coordinatorId: `coord-${randomUUID()}`,
    revision: 0,
    createdAt: iso(),
    updatedAt: iso(),
    tasks: [],
    dependencyEvents: [],
    wakeEvents: [],
    results: []
  };
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("coordinator state must be an object");
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported coordinator schema version: ${String(value.schemaVersion)}`);
  for (const key of ["tasks", "dependencyEvents", "wakeEvents", "results"]) {
    if (!Array.isArray(value[key])) value[key] = [];
  }
  value.revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  return value;
}

async function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

async function acquireProcessLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: iso() }), "utf8");
    return handle;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(await readFile(lockPath, "utf8")); } catch {}
    const ownerPid = Number(owner?.pid);
    if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        throw new Error("COORDINATOR_BUSY");
      } catch (probeError) {
        if (probeError.message === "COORDINATOR_BUSY" || probeError.code === "EPERM") {
          throw new Error("COORDINATOR_BUSY");
        }
        if (probeError.code !== "ESRCH") throw probeError;
      }
    }
    await unlink(lockPath).catch(() => undefined);
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: iso() }), "utf8");
    return handle;
  }
}

async function releaseProcessLock(lockPath, handle) {
  await handle?.close().catch(() => undefined);
  await unlink(lockPath).catch(() => undefined);
}

function relativeArtifact(stateRoot, rawPath) {
  const candidate = path.resolve(stateRoot, String(rawPath || ""));
  const root = path.resolve(stateRoot);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error("coordinator artifact escapes state root");
  return candidate;
}

async function resolveArtifact(stateRoot, rawPath) {
  const candidate = relativeArtifact(stateRoot, rawPath);
  const [rootRealPath, candidateRealPath] = await Promise.all([
    realpath(stateRoot),
    realpath(candidate)
  ]);
  if (candidateRealPath !== rootRealPath && !candidateRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error("coordinator artifact symlink escapes state root");
  }
  return candidateRealPath;
}

function eventReady(state, dependencyId) {
  return state.tasks.some((task) => task.taskId === dependencyId && task.status === "COMPLETE") ||
    state.dependencyEvents.some((event) => event.dependencyId === dependencyId && event.accepted === true);
}

function taskReady(state, task) {
  return task.dependsOn.every((dependencyId) => eventReady(state, dependencyId));
}

/**
 * Project-scoped development coordinator. It coordinates integration tasks only;
 * it never chooses campaigns, providers, accounts, authority, or transports.
 */
export class ProjectCoordinator {
  constructor({ stateFile, worker, clock = () => new Date(), intervalMs = 250 } = {}) {
    if (!stateFile) throw new Error("ProjectCoordinator requires stateFile");
    if (typeof worker !== "function") throw new Error("ProjectCoordinator requires a worker function");
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 25 || intervalMs > 60_000) throw new Error("coordinator intervalMs must be 25..60000");
    this.stateFile = path.resolve(stateFile);
    this.stateRoot = path.dirname(this.stateFile);
    this.lockFile = `${this.stateFile}.lock`;
    this.worker = worker;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.turn = null;
    this.state = null;
  }

  now() { return iso(this.clock()); }

  async init() {
    await mkdir(this.stateRoot, { recursive: true });
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.stateFile, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = initialState();
      await this.persist();
    }
    const recovered = [];
    const failed = [];
    let changed = false;
    for (const task of this.state.tasks) {
      if (task.status === "RUNNING" && !this.state.results.some((result) => result.taskId === task.taskId)) {
        if (task.replaySafe === true) {
          task.status = task.dependsOn.length ? "WAITING_DEPENDENCY" : "RUNNING";
          task.recoveredAt = this.now();
          recovered.push(task.taskId);
          changed = true;
        } else {
          task.status = "FAILED";
          task.error = "COORDINATOR_RECOVERY_REQUIRES_REPLAY_SAFE_TASK";
          task.failedAt = this.now();
          failed.push(task.taskId);
          changed = true;
        }
      }
    }
    if (changed) {
      this.state.wakeEvents.push({ type: "RECOVERY", recoveredTaskIds: recovered, failedTaskIds: failed, at: this.now() });
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() { return structuredClone(this.state); }

  async persist() {
    this.state.revision += 1;
    this.state.updatedAt = this.now();
    this.state.tasks = this.state.tasks.slice(-MAX_TASKS);
    this.state.dependencyEvents = this.state.dependencyEvents.slice(-MAX_EVENTS);
    this.state.wakeEvents = this.state.wakeEvents.slice(-MAX_EVENTS);
    this.state.results = this.state.results.slice(-MAX_EVENTS);
    await atomicWrite(this.stateFile, this.state);
  }

  async registerTask({ taskId, owner, scope, dependsOn = [], wakeState = "WAITING_DEPENDENCY", replaySafe = false, artifactPath } = {}) {
    if (!this.state) throw new Error("ProjectCoordinator must be initialized first");
    const normalizedId = id(taskId, "taskId");
    const existing = this.state.tasks.find((task) => task.taskId === normalizedId);
    const dependencies = [...new Set((Array.isArray(dependsOn) ? dependsOn : []).map((item) => id(item, "dependencyId")))];
    if (existing) {
      if (existing.owner !== owner || existing.scope !== scope || JSON.stringify(existing.dependsOn) !== JSON.stringify(dependencies)) throw new Error("COORDINATOR_TASK_ID_CONFLICT");
      return structuredClone(existing);
    }
    if (this.state.tasks.length >= MAX_TASKS) throw new Error("COORDINATOR_TASK_LIMIT");
    const status = dependencies.length ? "WAITING_DEPENDENCY" : "RUNNING";
    if (!TASK_STATES.has(status)) throw new Error("invalid coordinator task state");
    const task = {
      taskId: normalizedId,
      owner: text(owner, "owner", 120),
      scope: text(scope, "scope", 240),
      dependsOn: dependencies,
      replaySafe: replaySafe === true,
      artifactPath: artifactPath ? String(artifactPath) : `artifacts/${normalizedId}.json`,
      idempotencyKey: `coord:${normalizedId}`,
      status,
      createdAt: this.now(),
      attemptCount: 0,
      wakeState: dependencies.length ? wakeState : "READY"
    };
    this.state.tasks.push(task);
    await this.persist();
    return structuredClone(task);
  }

  async emitDependency({ eventId, dependencyId, owner, checkpoint, requestId = null } = {}) {
    if (!this.state) throw new Error("ProjectCoordinator must be initialized first");
    const normalizedEventId = id(eventId, "eventId");
    const normalizedDependency = id(dependencyId, "dependencyId");
    const prior = this.state.dependencyEvents.find((event) => event.eventId === normalizedEventId);
    if (prior) return { ...structuredClone(prior), duplicate: true };
    const event = {
      eventId: normalizedEventId,
      dependencyId: normalizedDependency,
      owner: text(owner, "owner", 120),
      checkpoint: text(checkpoint, "checkpoint", 160),
      requestId: requestId ? text(requestId, "requestId", 160) : null,
      accepted: true,
      emittedAt: this.now()
    };
    this.state.dependencyEvents.push(event);
    await this.persist();
    return structuredClone(event);
  }

  async runOnce() {
    if (!this.state) throw new Error("ProjectCoordinator must be initialized first");
    if (this.turn) return { status: "BUSY", promise: this.turn };
    this.turn = this.#runOnce();
    try { return await this.turn; } finally { this.turn = null; }
  }

  async #runOnce() {
    let lock;
    try { lock = await acquireProcessLock(this.lockFile); } catch (error) {
      if (error.message === "COORDINATOR_BUSY") return { status: "BUSY" };
      throw error;
    }
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.stateFile, "utf8")));
      const completed = [];
      for (const task of this.state.tasks) {
        if (task.status === "WAITING_DEPENDENCY" && taskReady(this.state, task)) {
          task.status = "RUNNING";
          task.wokenAt = this.now();
          task.wakeState = "DEPENDENCY_SATISFIED";
          this.state.wakeEvents.push({ type: "DEPENDENCY_SATISFIED", taskId: task.taskId, at: task.wokenAt });
          await this.persist();
        }
        if (task.status !== "RUNNING" || this.state.results.some((result) => result.taskId === task.taskId)) continue;
        task.attemptCount += 1;
        task.attemptId = `${task.taskId}:attempt:${task.attemptCount}`;
        task.startedAt = this.now();
        await this.persist();
        try {
          const result = await this.worker(structuredClone(task), {
            attemptId: task.attemptId,
            idempotencyKey: task.idempotencyKey,
            stateRoot: this.stateRoot,
            now: this.now()
          });
          if (!result || result.status !== "COMPLETED") throw new Error("COORDINATOR_WORKER_RESULT_NOT_COMPLETED");
          const artifact = result.artifactPath || task.artifactPath;
          const artifactFile = await resolveArtifact(this.stateRoot, artifact);
          const bytes = await readFile(artifactFile);
          const artifactHash = createHash("sha256").update(bytes).digest("hex");
          task.status = "COMPLETE";
          task.completedAt = this.now();
          task.artifactPath = path.relative(this.stateRoot, artifactFile);
          const accepted = { taskId: task.taskId, attemptId: task.attemptId, status: "COMPLETED", artifactPath: task.artifactPath, artifactHash, acceptedAt: task.completedAt, workerStatus: result.workerStatus || "EXECUTED" };
          this.state.results.push(accepted);
          completed.push(accepted);
          await this.persist();
        } catch (error) {
          task.status = "FAILED";
          task.failedAt = this.now();
          task.error = safeError(error);
          await this.persist();
        }
      }
      return { status: completed.length ? "COMPLETED" : "IDLE", completed };
    } finally {
      await releaseProcessLock(this.lockFile, lock);
    }
  }

  start() {
    if (this.timer) return this.timer;
    this.timer = setInterval(() => this.runOnce().catch(() => undefined), this.intervalMs);
    this.timer.unref?.();
    return this.timer;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async waitFor(taskId, { timeoutMs = 10_000 } = {}) {
    const normalizedId = id(taskId, "taskId");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.runOnce();
      const task = this.state.tasks.find((item) => item.taskId === normalizedId);
      if (!task) throw new Error("COORDINATOR_TASK_NOT_FOUND");
      if (["COMPLETE", "FAILED", "BLOCKED_HUMAN_INPUT"].includes(task.status)) return structuredClone(task);
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.intervalMs, Math.max(1, deadline - Date.now()))));
      this.state = normalizeState(JSON.parse(await readFile(this.stateFile, "utf8")));
    }
    throw new Error("COORDINATOR_WAIT_TIMEOUT");
  }
}

export { TASK_STATES, SCHEMA_VERSION };
