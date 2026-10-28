import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 3;
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
const NATIVE_RECOVERY_MAX_ATTEMPTS = 3;
const NATIVE_RECOVERY_BASE_DELAY_MS = 5_000;
const NATIVE_RECOVERY_MAX_DELAY_MS = 60_000;

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
    .replace(/(password|passphrase|secret|token|cookie|credential|api[_-]?key|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR);
}

function sanitizeNative(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeNative(item));
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    // Raw terminal streams may contain private task data. Persist structured
    // receipts, hashes and markers only.
    if (["outputExcerpt", "stdout", "stderr", "rawOutput", "terminalOutput"].includes(key)) continue;
    result[key] = key === "lastError" ? safeError(item) : sanitizeNative(item);
  }
  return result;
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

function initialNativeRecovery() {
  return {
    attempts: 0,
    maxAttempts: NATIVE_RECOVERY_MAX_ATTEMPTS,
    baseDelayMs: NATIVE_RECOVERY_BASE_DELAY_MS,
    maxDelayMs: NATIVE_RECOVERY_MAX_DELAY_MS,
    nextAttemptAt: null,
    inFlightAttempt: null,
    inFlightSince: null,
    lastAttemptAt: null,
    epoch: 0,
    manualRecoveryCount: 0
  };
}

function normalizeNativeRecovery(value) {
  const defaults = initialNativeRecovery();
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawNextAttemptAt = input.nextAttemptAt;
  const hasInvalidNextAttemptAt = rawNextAttemptAt !== null && rawNextAttemptAt !== undefined &&
    (typeof rawNextAttemptAt !== "string" || !Number.isFinite(Date.parse(rawNextAttemptAt)));
  return {
    ...defaults,
    attempts: Number.isSafeInteger(input.attempts) ? Math.max(0, Math.min(defaults.maxAttempts, input.attempts)) : 0,
    nextAttemptAt: hasInvalidNextAttemptAt ? null : (typeof rawNextAttemptAt === "string" ? rawNextAttemptAt : null),
    invalidNextAttemptAt: hasInvalidNextAttemptAt || input.invalidNextAttemptAt === true,
    inFlightAttempt: Number.isSafeInteger(input.inFlightAttempt) && input.inFlightAttempt > 0 && input.inFlightAttempt <= defaults.maxAttempts ? input.inFlightAttempt : null,
    inFlightSince: typeof input.inFlightSince === "string" ? input.inFlightSince : null,
    lastAttemptAt: typeof input.lastAttemptAt === "string" ? input.lastAttemptAt : null,
    epoch: Number.isSafeInteger(input.epoch) && input.epoch >= 0 ? input.epoch : 0,
    manualRecoveryCount: Number.isSafeInteger(input.manualRecoveryCount) && input.manualRecoveryCount >= 0 ? input.manualRecoveryCount : 0
  };
}

function nativeRecoveryDelay(recovery, attempt) {
  return Math.min(recovery.maxDelayMs, recovery.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

function blockNativeRecovery(task, reason, at) {
  task.status = "BLOCKED_HUMAN_INPUT";
  task.error = reason;
  task.failedAt = at;
  task.wakeState = "NATIVE_RECOVERY_LIMIT_REACHED";
  if (task.native && typeof task.native === "object") {
    task.native.reconciliation = "BLOCKED_RETRY_LIMIT";
    task.native.reconciliationBlockedAt = at;
  }
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("coordinator state must be an object");
  if (value.schemaVersion === 1 || value.schemaVersion === 2) {
    const from = value.schemaVersion;
    // Schema v2/v3 migrations are additive. Existing task/result history remains
    // authoritative; native follow-up and bounded recovery metadata are optional.
    value.schemaVersion = SCHEMA_VERSION;
    value.migration ||= { from, migratedAt: iso() };
    if (from === 1) {
      for (const task of Array.isArray(value.tasks) ? value.tasks : []) {
        if (!Object.hasOwn(task, "workerKind")) task.workerKind = "CALLBACK";
        if (!Object.hasOwn(task, "native")) task.native = null;
      }
      for (const result of Array.isArray(value.results) ? value.results : []) {
        if (!Object.hasOwn(result, "native")) result.native = null;
      }
    }
  }
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported coordinator schema version: ${String(value.schemaVersion)}`);
  for (const key of ["tasks", "dependencyEvents", "wakeEvents", "results"]) {
    if (!Array.isArray(value[key])) value[key] = [];
  }
  value.revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  for (const task of value.tasks) {
    if (task.native) task.native = sanitizeNative(task.native);
    if (task.workerKind === "ORCA_NATIVE") task.nativeRecovery = normalizeNativeRecovery(task.nativeRecovery);
  }
  for (const result of value.results) if (result.native) result.native = sanitizeNative(result.native);
  const resultByTask = new Map(value.results.map((result) => [result.taskId, result]));
  for (const task of value.tasks) {
    if (task.status === "COMPLETE" && resultByTask.get(task.taskId)?.workerStatus === "NATIVE_RESUME_VERIFIED") {
      task.wakeState = "NATIVE_COMPLETED";
    }
  }
  for (const result of value.results) {
    if (result.workerStatus === "NATIVE_RESUME_VERIFIED" && result.native && result.native.reconciliation !== "COMPLETED") {
      result.native.reconciliation = "COMPLETED";
      result.native.reconciledAt = result.acceptedAt || null;
    }
  }
  for (const task of value.tasks) {
    if (task.status === "COMPLETE" && task.workerKind === "ORCA_NATIVE" && task.native && task.native.reconciliation !== "COMPLETED") {
      task.native.reconciliation = "COMPLETED";
      task.native.reconciledAt = task.completedAt || null;
    }
  }
  return value;
}

async function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

function hasRawNative(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasRawNative);
  if (Object.hasOwn(value, "outputExcerpt") || Object.hasOwn(value, "stdout") || Object.hasOwn(value, "stderr") || Object.hasOwn(value, "rawOutput") || Object.hasOwn(value, "terminalOutput")) return true;
  return Object.values(value).some(hasRawNative);
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
    let scrubbedRawNative = false;
    let normalizedStateChanged = false;
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8"));
      const beforeNormalization = JSON.stringify(parsed);
      scrubbedRawNative = hasRawNative(parsed.tasks) || hasRawNative(parsed.results);
      this.state = normalizeState(parsed);
      normalizedStateChanged = JSON.stringify(this.state) !== beforeNormalization;
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
          if (task.native?.requestId && task.workerKind === "ORCA_NATIVE" && (task.attemptCount > 0 || task.startedAt)) {
            const recovery = normalizeNativeRecovery(task.nativeRecovery);
            if (recovery.inFlightAttempt === null) {
              recovery.inFlightAttempt = Math.max(1, recovery.attempts + 1);
              recovery.inFlightSince = task.startedAt || this.now();
            }
            task.nativeRecovery = recovery;
            task.status = "WAITING_CHATGPT";
            task.wakeState = "NATIVE_REQUEST_RECONCILIATION";
          } else {
            task.status = task.native?.requestId ? "WAITING_CHATGPT" : (task.dependsOn.length ? "WAITING_DEPENDENCY" : "RUNNING");
            if (task.native?.requestId) task.wakeState = "NATIVE_REQUEST_RECONCILIATION";
          }
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
      if (task.status === "WAITING_CHATGPT" && task.workerKind === "ORCA_NATIVE" && !this.state.results.some((result) => result.taskId === task.taskId)) {
        const recovery = normalizeNativeRecovery(task.nativeRecovery);
        let recoveryChanged = recovery.invalidNextAttemptAt;
        if (recovery.invalidNextAttemptAt) {
          blockNativeRecovery(task, "COORDINATOR_NATIVE_RECOVERY_TIMESTAMP_INVALID", this.now());
          failed.push(task.taskId);
          task.nativeRecovery = recovery;
          task.recoveredAt = this.now();
          recovered.push(task.taskId);
          changed = true;
          continue;
        }
        if (recovery.inFlightAttempt !== null) {
          // A supervisor crash after the lease was persisted consumed that
          // reconciliation attempt. Never replay an interrupted attempt under
          // the same counter after restart.
          recovery.attempts = Math.max(recovery.attempts, recovery.inFlightAttempt);
          recovery.inFlightAttempt = null;
          recovery.inFlightSince = null;
          recovery.nextAttemptAt = new Date(Date.parse(this.now()) + nativeRecoveryDelay(recovery, Math.max(1, recovery.attempts))).toISOString();
          recoveryChanged = true;
          task.wakeState = "NATIVE_RECOVERY_CRASH_RECONCILED";
          task.native = sanitizeNative({ ...(task.native || {}), reconciliation: "CRASH_RECONCILED" });
        }
        if (recovery.attempts >= recovery.maxAttempts) {
          blockNativeRecovery(task, "COORDINATOR_NATIVE_RECOVERY_LIMIT_REACHED", this.now());
          failed.push(task.taskId);
          recoveryChanged = true;
        }
        task.nativeRecovery = recovery;
        if (recoveryChanged) {
          task.recoveredAt = this.now();
          recovered.push(task.taskId);
          changed = true;
        }
      }
    }
    if (changed || scrubbedRawNative || normalizedStateChanged) {
      this.state.wakeEvents.push({ type: "RECOVERY", recoveredTaskIds: recovered, failedTaskIds: failed, at: this.now() });
      await this.persist();
    }
    if (this.state.migration && this.state.migration.from === 1 && !this.state.migration.persistedAt) {
      this.state.migration.persistedAt = this.now();
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() { return structuredClone(this.state); }

  async persist(state = this.state) {
    if (!state) throw new Error("ProjectCoordinator must be initialized first");
    state.revision += 1;
    state.updatedAt = this.now();
    state.tasks = state.tasks.slice(-MAX_TASKS);
    state.dependencyEvents = state.dependencyEvents.slice(-MAX_EVENTS);
    state.wakeEvents = state.wakeEvents.slice(-MAX_EVENTS);
    state.results = state.results.slice(-MAX_EVENTS);
    await atomicWrite(this.stateFile, state);
  }

  async registerTask({ taskId, owner, scope, dependsOn = [], wakeState = "WAITING_DEPENDENCY", replaySafe = false, artifactPath, workerKind = "CALLBACK", native = null } = {}) {
    if (!this.state) throw new Error("ProjectCoordinator must be initialized first");
    const lock = await acquireProcessLock(this.lockFile);
    try {
    this.state = normalizeState(JSON.parse(await readFile(this.stateFile, "utf8")));
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
    const normalizedWorkerKind = text(workerKind, "workerKind", 80).toUpperCase();
    if (native !== null && (typeof native !== "object" || Array.isArray(native))) throw new Error("native task metadata must be an object or null");
    const task = {
      taskId: normalizedId,
      owner: text(owner, "owner", 120),
      scope: text(scope, "scope", 240),
      dependsOn: dependencies,
      replaySafe: replaySafe === true,
      workerKind: normalizedWorkerKind,
      native: native ? sanitizeNative(native) : null,
      nativeRecovery: normalizedWorkerKind === "ORCA_NATIVE" ? initialNativeRecovery() : null,
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
    } finally {
      await releaseProcessLock(this.lockFile, lock);
    }
  }

  async emitDependency({ eventId, dependencyId, owner, checkpoint, requestId = null } = {}) {
    if (!this.state) throw new Error("ProjectCoordinator must be initialized first");
    const lock = await acquireProcessLock(this.lockFile);
    try {
    this.state = normalizeState(JSON.parse(await readFile(this.stateFile, "utf8")));
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
    } finally {
      await releaseProcessLock(this.lockFile, lock);
    }
  }

  async recoverTask({ taskId, reason = "reconcile durable worker request" } = {}) {
    if (!this.state) throw new Error("ProjectCoordinator must be initialized first");
    const lock = await acquireProcessLock(this.lockFile);
    try {
    this.state = normalizeState(JSON.parse(await readFile(this.stateFile, "utf8")));
    const normalizedId = id(taskId, "taskId");
    const task = this.state.tasks.find((item) => item.taskId === normalizedId);
    if (!task) throw new Error("COORDINATOR_TASK_NOT_FOUND");
    if (task.status === "COMPLETE") return structuredClone(task);
    if (task.replaySafe !== true || task.workerKind !== "ORCA_NATIVE" || !task.native?.requestId) {
      throw new Error("COORDINATOR_NATIVE_RECOVERY_REQUIRES_REQUEST_ID");
    }
    if (!["FAILED", "WAITING_CHATGPT", "RUNNING", "BLOCKED_HUMAN_INPUT"].includes(task.status)) throw new Error("COORDINATOR_TASK_NOT_RECOVERABLE");
    task.status = task.native?.requestId ? "WAITING_CHATGPT" : (task.dependsOn.length ? "WAITING_DEPENDENCY" : "RUNNING");
    task.error = null;
    task.wakeState = "NATIVE_REQUEST_RECONCILIATION";
    task.recoveredAt = this.now();
    const recovery = normalizeNativeRecovery(task.nativeRecovery);
    task.nativeRecovery = {
      ...recovery,
      attempts: 0,
      nextAttemptAt: null,
      inFlightAttempt: null,
      inFlightSince: null,
      lastAttemptAt: null,
      epoch: recovery.epoch + 1,
      manualRecoveryCount: recovery.manualRecoveryCount + 1,
      invalidNextAttemptAt: false
    };
    task.native.reconciliation = "WAITING_CHATGPT";
    delete task.native.reconciliationBlockedAt;
    this.state.wakeEvents.push({ type: "NATIVE_REQUEST_RECONCILIATION", taskId: normalizedId, requestId: task.native.requestId, reason: text(reason, "reason", 200), at: task.recoveredAt });
    await this.persist();
    return structuredClone(task);
    } finally {
      await releaseProcessLock(this.lockFile, lock);
    }
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
        if (!(task.status === "RUNNING" || task.status === "WAITING_CHATGPT") || this.state.results.some((result) => result.taskId === task.taskId)) continue;
        let recoveryAttempt = null;
        if (task.status === "RUNNING") {
          task.attemptCount += 1;
          task.attemptId = `${task.taskId}:attempt:${task.attemptCount}`;
          task.startedAt = this.now();
          await this.persist();
        } else if (task.workerKind === "ORCA_NATIVE") {
          task.nativeRecovery = normalizeNativeRecovery(task.nativeRecovery);
          if (!task.native?.requestId) {
            blockNativeRecovery(task, "COORDINATOR_NATIVE_RECOVERY_REQUIRES_REQUEST_ID", this.now());
            this.state.wakeEvents.push({ type: "NATIVE_RECOVERY_BLOCKED", taskId: task.taskId, reason: task.error, at: task.failedAt });
            await this.persist();
            continue;
          }
          const recovery = task.nativeRecovery;
          if (recovery.inFlightAttempt === null) {
            if (recovery.nextAttemptAt && Date.parse(recovery.nextAttemptAt) > Date.parse(this.now())) continue;
            if (recovery.attempts >= recovery.maxAttempts) {
              blockNativeRecovery(task, "COORDINATOR_NATIVE_RECOVERY_LIMIT_REACHED", this.now());
              this.state.wakeEvents.push({ type: "NATIVE_RECOVERY_BLOCKED", taskId: task.taskId, requestId: task.native.requestId, attempts: recovery.attempts, at: task.failedAt });
              await this.persist();
              continue;
            }
            recovery.inFlightAttempt = recovery.attempts + 1;
            recovery.inFlightSince = this.now();
            recovery.lastAttemptAt = recovery.inFlightSince;
          }
          recoveryAttempt = recovery.inFlightAttempt;
          task.attemptId = `${task.taskId}:native-recovery:${recovery.epoch}:${recoveryAttempt}`;
          await this.persist();
        } else {
          task.status = "BLOCKED_HUMAN_INPUT";
          task.error = "COORDINATOR_CHATGPT_WAIT_REQUIRES_NATIVE_RECOVERY_PROTOCOL";
          task.failedAt = this.now();
          task.wakeState = "CHATGPT_RECOVERY_UNSUPPORTED";
          await this.persist();
          continue;
        }
        try {
          const result = await this.worker(structuredClone(task), {
            attemptId: task.attemptId,
            idempotencyKey: task.idempotencyKey,
            stateRoot: this.stateRoot,
            now: this.now(),
            recordNative: async (patch = {}) => {
              const current = this.state.tasks.find((item) => item.taskId === task.taskId);
              if (!current) throw new Error("COORDINATOR_TASK_NOT_FOUND");
              if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("native receipt patch must be an object");
              if (current.native?.requestId && patch.requestId && current.native.requestId !== patch.requestId) throw new Error("COORDINATOR_NATIVE_REQUEST_ID_CONFLICT");
              current.native = sanitizeNative({ ...(current.native || {}), ...structuredClone(patch) });
              await this.persist();
            }
          });
          if (!result || typeof result !== "object") throw new Error("COORDINATOR_WORKER_RESULT_INVALID");
          if (result.status === "WAITING_CHATGPT") {
            if (result.native && (typeof result.native !== "object" || Array.isArray(result.native))) throw new Error("native worker result must be an object");
            if (task.native?.requestId && result.native?.requestId && task.native.requestId !== result.native.requestId) throw new Error("COORDINATOR_NATIVE_REQUEST_ID_CONFLICT");
            if (result.native) task.native = sanitizeNative({ ...(task.native || {}), ...structuredClone(result.native) });
            if (task.workerKind !== "ORCA_NATIVE" || !task.native?.requestId) {
              task.status = "BLOCKED_HUMAN_INPUT";
              task.error = "COORDINATOR_NATIVE_RECOVERY_REQUIRES_REQUEST_ID";
              task.failedAt = this.now();
              task.wakeState = "NATIVE_RECOVERY_REQUEST_ID_MISSING";
              await this.persist();
              continue;
            }
            const recovery = normalizeNativeRecovery(task.nativeRecovery);
            if (recoveryAttempt !== null) {
              recovery.attempts = recoveryAttempt;
              recovery.inFlightAttempt = null;
              recovery.inFlightSince = null;
            }
            if (recovery.attempts >= recovery.maxAttempts) {
              task.nativeRecovery = recovery;
              blockNativeRecovery(task, "COORDINATOR_NATIVE_RECOVERY_LIMIT_REACHED", this.now());
              this.state.wakeEvents.push({ type: "NATIVE_RECOVERY_BLOCKED", taskId: task.taskId, requestId: task.native.requestId, attempts: recovery.attempts, at: task.failedAt });
              await this.persist();
              continue;
            }
            recovery.nextAttemptAt = new Date(Date.parse(this.now()) + nativeRecoveryDelay(recovery, Math.max(1, recovery.attempts))).toISOString();
            task.nativeRecovery = recovery;
            task.status = "WAITING_CHATGPT";
            task.wakeState = "WAITING_CHATGPT_BACKOFF";
            task.error = null;
            await this.persist();
            continue;
          }
          if (result.status !== "COMPLETED") throw new Error("COORDINATOR_WORKER_RESULT_NOT_COMPLETED");
          const artifact = result.artifactPath || task.artifactPath;
          const artifactFile = await resolveArtifact(this.stateRoot, artifact);
          const bytes = await readFile(artifactFile);
          const artifactHash = createHash("sha256").update(bytes).digest("hex");
          task.status = "COMPLETE";
          task.completedAt = this.now();
          const stateRootReal = await realpath(this.stateRoot);
          task.artifactPath = path.relative(stateRootReal, artifactFile);
          if (result.native && (typeof result.native !== "object" || Array.isArray(result.native))) throw new Error("native worker result must be an object");
          if (task.native?.requestId && result.native?.requestId && task.native.requestId !== result.native.requestId) throw new Error("COORDINATOR_NATIVE_REQUEST_ID_CONFLICT");
          if (result.native) {
            const nativeReceipt = { ...(task.native || {}), ...structuredClone(result.native) };
            if (task.workerKind === "ORCA_NATIVE") {
              nativeReceipt.reconciliation = "COMPLETED";
              nativeReceipt.reconciledAt = task.completedAt;
            }
            task.native = sanitizeNative(nativeReceipt);
          }
          if (task.nativeRecovery) {
            task.nativeRecovery.inFlightAttempt = null;
            task.nativeRecovery.inFlightSince = null;
            task.nativeRecovery.nextAttemptAt = null;
          }
          task.wakeState = result.workerStatus === "NATIVE_RESUME_VERIFIED" ? "NATIVE_COMPLETED" : "COMPLETED";
          const accepted = { taskId: task.taskId, attemptId: task.attemptId, status: "COMPLETED", artifactPath: task.artifactPath, artifactHash, acceptedAt: task.completedAt, workerStatus: result.workerStatus || "EXECUTED", native: task.native ? sanitizeNative(task.native) : null };
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

export {
  NATIVE_RECOVERY_BASE_DELAY_MS,
  NATIVE_RECOVERY_MAX_ATTEMPTS,
  NATIVE_RECOVERY_MAX_DELAY_MS,
  SCHEMA_VERSION,
  TASK_STATES
};
