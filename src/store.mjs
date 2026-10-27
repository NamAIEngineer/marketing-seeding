import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nowIso } from "./constants.mjs";

export function createInitialState(now = new Date()) {
  const timestamp = nowIso(now);
  return {
    schemaVersion: 8,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    control: {
      killSwitch: {
        active: false,
        epoch: 0,
        changedAt: null,
        changedBy: null,
        reason: null
      }
    },
    campaigns: [],
    campaignAuthorizations: [],
    liveExecutionGrants: [],
    submissionUncertainties: [],
    oneTimeExecutionWindows: [],
    executionAccounts: [],
    executionRequests: [],
    executionReceipts: [],
    executionLeases: [],
    artifacts: [],
    stories: [],
    publicationAttempts: [],
    schedules: [],
    scheduleRuns: [],
    targets: [],
    posts: [],
    metricSnapshots: [],
    keywordSnapshots: [],
    interactions: [],
    replies: [],
    conversions: [],
    collectorRuns: [],
    fixtureAutomationRuns: [],
    communityMemberships: [],
    memoryItems: [],
    browserSnapshots: [],
    browserExecutions: [],
    providerDecisions: [],
    auditLog: []
  };
}

const STATE_COLLECTIONS = Object.freeze([
  "campaigns", "campaignAuthorizations", "liveExecutionGrants", "submissionUncertainties", "oneTimeExecutionWindows", "executionAccounts", "executionRequests", "executionReceipts", "executionLeases", "artifacts", "stories", "publicationAttempts", "schedules", "scheduleRuns", "targets", "posts",
  "metricSnapshots", "keywordSnapshots", "interactions", "replies", "conversions", "collectorRuns", "fixtureAutomationRuns", "communityMemberships", "memoryItems", "browserSnapshots", "browserExecutions", "providerDecisions", "auditLog"
]);

export function migrateState(input, now = new Date()) {
  const state = input && typeof input === "object" ? input : createInitialState(now);
  const sourceVersion = Number(state.schemaVersion || 1);
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) throw new Error("Unsupported or invalid state schemaVersion");
  if (sourceVersion > 8) throw new Error(`State schemaVersion ${sourceVersion} is newer than supported version 8`);
  let changed = false;
  if (!state.control || typeof state.control !== "object" || Array.isArray(state.control)) {
    state.control = {};
    changed = true;
  }
  if (!state.control.killSwitch || typeof state.control.killSwitch !== "object" || Array.isArray(state.control.killSwitch)) {
    state.control.killSwitch = {};
    changed = true;
  }
  const killSwitch = state.control.killSwitch;
  if (typeof killSwitch.active !== "boolean") {
    killSwitch.active = false;
    changed = true;
  }
  if (!Number.isSafeInteger(killSwitch.epoch) || killSwitch.epoch < 0) {
    killSwitch.epoch = 0;
    changed = true;
  }
  for (const key of ["changedAt", "changedBy", "reason"]) {
    if (!(key in killSwitch)) {
      killSwitch[key] = null;
      changed = true;
    }
  }
  for (const key of STATE_COLLECTIONS) {
    if (!Array.isArray(state[key])) {
      state[key] = [];
      changed = true;
    }
  }
  if (sourceVersion < 8) {
    state.schemaVersion = 8;
    changed = true;
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    state.revision = 0;
    changed = true;
  }
  if (changed) {
    state.revision += 1;
    state.updatedAt = nowIso(now);
    state.auditLog.push({
      id: randomUUID(),
      at: state.updatedAt,
      actor: "system",
      event: "state_schema_migrated_v8",
      revision: state.revision
    });
  }
  return { state, changed };
}

export class JsonStore {
  #pending = Promise.resolve();
  #leaseHandle = null;

  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.requireLease = options.requireLease === true;
    this.leaseFile = `${filePath}.writer.lock`;
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const text = (await readFile(this.filePath, "utf8")).replace(/^\uFEFF/, "");
      const migrated = migrateState(JSON.parse(text));
      if (migrated.changed) {
        if (this.requireLease && !this.#leaseHandle) throw new Error("Writer lease is required before state migration");
        await copyFile(this.filePath, `${this.filePath}.schema-v8.bak`, fsConstants.COPYFILE_EXCL).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        await this.#write(migrated.state);
      }
      return migrated.state;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (this.requireLease && !this.#leaseHandle) throw new Error("Writer lease is required before state initialization");
      await this.#write(createInitialState());
    }
    return this.read();
  }

  async read() {
    const text = (await readFile(this.filePath, "utf8")).replace(/^\uFEFF/, "");
    return migrateState(JSON.parse(text)).state;
  }

  async mutate(actor, event, mutation) {
    if (this.requireLease && !this.#leaseHandle) throw new Error("Writer lease is required before mutation");
    const operation = this.#pending.then(async () => {
      const state = await this.read();
      const result = await mutation(state);
      state.revision += 1;
      state.updatedAt = nowIso();
      state.auditLog.push({
        id: randomUUID(),
        at: state.updatedAt,
        actor,
        event,
        revision: state.revision
      });
      if (state.auditLog.length > 1000) state.auditLog.splice(0, state.auditLog.length - 1000);
      await this.#write(state);
      return { state, result };
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }

  async acquireWriterLease() {
    if (this.#leaseHandle) return;
    await mkdir(path.dirname(this.leaseFile), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.#leaseHandle = await open(this.leaseFile, "wx", 0o600);
        await this.#leaseHandle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }), "utf8");
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let owner = null;
        try { owner = JSON.parse((await readFile(this.leaseFile, "utf8")).replace(/^\uFEFF/, "")); } catch {}
        const ownerPid = Number(owner?.pid);
        let alive = Number.isSafeInteger(ownerPid) && ownerPid > 0;
        if (alive) {
          try { process.kill(ownerPid, 0); } catch { alive = false; }
        }
        if (alive) throw new Error(`State writer lease is already held by PID ${ownerPid}`);
        const stale = `${this.leaseFile}.stale.${Date.now()}.${randomUUID()}`;
        try { await rename(this.leaseFile, stale); } catch (renameError) {
          if (renameError.code !== "ENOENT") throw renameError;
        }
      }
    }
    throw new Error("Could not acquire state writer lease");
  }

  async releaseWriterLease() {
    if (!this.#leaseHandle) return;
    const handle = this.#leaseHandle;
    this.#leaseHandle = null;
    await handle.close();
    await unlink(this.leaseFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async #write(state) {
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}
