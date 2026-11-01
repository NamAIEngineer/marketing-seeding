import { readFile } from "node:fs/promises";

function bounded(value, max = 240) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function evidenceRefs(value) {
  return Array.isArray(value) ? [...new Set(value.map((item) => bounded(item)).filter(Boolean))].slice(0, 32) : [];
}

function evidenceCount(value) {
  return evidenceRefs(value).length;
}

function projectTask(task) {
  return {
    taskId: bounded(task?.taskId, 160),
    owner: bounded(task?.owner, 120),
    scope: bounded(task?.scope, 240),
    status: bounded(task?.status, 80),
    workerStatus: bounded(task?.workerStatus, 120),
    acceptanceStatus: bounded(task?.acceptanceStatus, 80),
    attemptCount: Number.isSafeInteger(task?.attemptCount) ? task.attemptCount : 0,
    dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map((item) => bounded(item, 160)).filter(Boolean).slice(0, 32) : [],
    parentTaskId: bounded(task?.parentTaskId, 160),
    relation: bounded(task?.relation, 80),
    wakeState: bounded(task?.wakeState, 120),
    error: bounded(task?.error, 240),
    lastResultAt: bounded(task?.lastResultAt, 80),
    completedAt: bounded(task?.completedAt, 80),
    evidenceCount: evidenceCount(task?.lastAcceptance?.evidenceRefs)
  };
}

function projectResult(result) {
  return {
    taskId: bounded(result?.taskId, 160),
    attemptId: bounded(result?.attemptId, 200),
    status: bounded(result?.status, 80),
    workerStatus: bounded(result?.workerStatus, 120),
    acceptanceStatus: bounded(result?.acceptanceStatus, 80),
    artifactHash: bounded(result?.artifactHash, 128),
    acceptedAt: bounded(result?.acceptedAt, 80),
    evidenceCount: evidenceCount(result?.acceptance?.evidenceRefs)
  };
}

function projectGoal(goal) {
  if (!goal || typeof goal !== "object" || Array.isArray(goal)) return null;
  return {
    schemaVersion: 1,
    goalId: bounded(goal.goalId, 160),
    goalRunId: bounded(goal.goalRunId, 160),
    mode: bounded(goal.mode, 80),
    nativeGoalMode: bounded(goal.nativeGoalMode, 80),
    status: bounded(goal.status, 80),
    owner: bounded(goal.owner, 120),
    consumer: bounded(goal.consumer, 240),
    checkpoint: bounded(goal.checkpoint, 240),
    sourceRevision: bounded(goal.sourceRevision, 160),
    nextAction: bounded(goal.nextAction, 240),
    acceptanceMatrix: Array.isArray(goal.acceptanceMatrix) ? goal.acceptanceMatrix.slice(0, 64).map((item) => ({
      id: bounded(item?.id, 120),
      status: bounded(item?.status, 80),
      owner: bounded(item?.owner, 120),
      dependency: bounded(item?.dependency, 240),
      classification: bounded(item?.classification, 80),
      evidenceCount: evidenceCount(item?.evidenceRefs),
      detail: bounded(item?.detail, 240)
    })) : [],
    taskRefs: Array.isArray(goal.taskRefs) ? goal.taskRefs.slice(0, 128).map((item) => ({
      taskId: bounded(item?.taskId, 160),
      owner: bounded(item?.owner, 120),
      status: bounded(item?.status, 80),
      deliveryStatus: bounded(item?.deliveryStatus, 80),
      workerStatus: bounded(item?.workerStatus, 120),
      acceptanceStatus: bounded(item?.acceptanceStatus, 80),
      sourceRevision: bounded(item?.sourceRevision, 160),
      blocker: bounded(item?.blocker, 240),
      nextAction: bounded(item?.nextAction, 240),
      evidenceCount: evidenceCount(item?.evidenceRefs)
    })) : [],
    currentBlockers: Array.isArray(goal.currentBlockers) ? goal.currentBlockers.map((item) => bounded(item, 240)).filter(Boolean).slice(0, 64) : [],
    wake: goal.wake && typeof goal.wake === "object" ? {
      consumer: bounded(goal.wake.consumer, 240),
      condition: bounded(goal.wake.condition, 240),
      nextWakeAt: bounded(goal.wake.nextWakeAt, 80),
      lastWakeAt: bounded(goal.wake.lastWakeAt, 80)
    } : null,
    evidenceCount: evidenceCount(goal.evidenceRefs),
    observedAt: bounded(goal.observedAt, 80),
    updatedAt: bounded(goal.updatedAt, 80)
  };
}

function projectSession(session) {
  return {
    role: bounded(session?.role, 80),
    branch: bounded(session?.branch, 240),
    observedHead: bounded(session?.observedHead, 160),
    ownedScope: Array.isArray(session?.ownedScope) ? session.ownedScope.map((item) => bounded(item, 240)).filter(Boolean).slice(0, 32) : [],
    receiverState: bounded(session?.receiverState, 120),
    uiMappingState: bounded(session?.uiMappingState, 120),
    currentTaskId: bounded(session?.currentTaskId, 160),
    mappingGeneration: Number.isSafeInteger(session?.mappingGeneration) ? session.mappingGeneration : 0,
    observedAt: bounded(session?.observedAt, 80),
    verifiedAt: bounded(session?.verifiedAt, 80),
    evidenceCount: evidenceCount(session?.evidenceRefs),
    unknown: Boolean(session?.unknownReason)
  };
}

export function projectCoordinatorState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { available: false, reason: "COORDINATOR_STATE_INVALID" };
  return {
    available: true,
    schemaVersion: Number.isSafeInteger(state.schemaVersion) ? state.schemaVersion : null,
    coordinatorId: bounded(state.coordinatorId, 160),
    revision: Number.isSafeInteger(state.revision) ? state.revision : null,
    updatedAt: bounded(state.updatedAt, 80),
    goal: projectGoal(state.goal),
    sessionRegistry: Array.isArray(state.sessionRegistry) ? state.sessionRegistry.slice(-32).map(projectSession) : [],
    tasks: Array.isArray(state.tasks) ? state.tasks.slice(-128).map(projectTask) : [],
    results: Array.isArray(state.results) ? state.results.slice(-128).map(projectResult) : [],
    wakeEvents: Array.isArray(state.wakeEvents) ? state.wakeEvents.slice(-64).map((event) => ({
      type: bounded(event?.type, 120),
      taskId: bounded(event?.taskId, 160),
      dependencyId: bounded(event?.dependencyId, 160),
      at: bounded(event?.at, 80)
    })) : []
  };
}

export async function readCoordinatorProjection(stateFile, { readFileFn = readFile } = {}) {
  try {
    const parsed = JSON.parse(await readFileFn(stateFile, "utf8"));
    return projectCoordinatorState(parsed);
  } catch (error) {
    return { available: false, reason: error?.code === "ENOENT" ? "COORDINATOR_STATE_MISSING" : "COORDINATOR_STATE_UNREADABLE" };
  }
}
