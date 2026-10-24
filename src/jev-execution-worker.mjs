import { validateExecutionReceiptV1 } from "./execution-contracts.mjs";
import { normalizePublicationVerification, PlatformAdapterRegistry } from "./platform-registries.mjs";
import { assertLiveGrantMatchesExecution } from "./live-execution-grant.mjs";

export const SUBMIT_READINESS_SAFETY_MARGIN_MS = 30_000;

function readinessResult(request) {
  return {
    state: String(request.readiness.state).toUpperCase(),
    checkedAt: request.readiness.checkedAt,
    expiresAt: request.readiness.expiresAt,
    evidenceReference: request.readiness.evidenceReference,
    reasonCode: request.readiness.reasonCode || "execution_readiness_fresh"
  };
}

function readinessEvidence(context) {
  const readiness = context?.target?.readiness || context?.request?.readiness;
  if (!readiness) return null;
  return {
    state: String(readiness.state || "UNKNOWN").toUpperCase(),
    checkedAt: readiness.checkedAt || null,
    expiresAt: readiness.expiresAt || null,
    reasonCode: readiness.reasonCode || null,
    evidenceReference: readiness.evidence || readiness.evidenceReference || null
  };
}

function errorClass(result, dryRun) {
  if (dryRun && result.submitState === "NOT_STARTED" && !result.reasonCode) return "NONE";
  return result.errorClassification || (result.submitState === "CONFIRMED" ? "NONE" : result.submitState === "UNKNOWN" ? "PLATFORM_ERROR" : "VALIDATION_ERROR");
}

function recoveryClass(result) {
  if (result.recoveryClassification) return result.recoveryClassification;
  if (result.submitState === "UNKNOWN" || result.submitState === "SUBMIT_SENT") return "UNKNOWN";
  return "NONE";
}

function sameTransportIdentity(left, right) {
  if (!left || !right) return false;
  return ["transport", "provider", "providerVersion"].every((key) => String(left[key] || "") === String(right[key] || ""));
}

export class JevExecutionWorker {
  constructor({ service, adapterRegistry, executionSessionResolver = null, workerId = `jev-${process.pid}`, env = process.env, leaseMs = 120_000, now = () => new Date() } = {}) {
    if (!service) throw new Error("JEV worker requires the control-plane service");
    this.service = service;
    if (!(adapterRegistry instanceof PlatformAdapterRegistry)) throw new Error("JEV worker requires a PlatformAdapterRegistry");
    this.adapterRegistry = adapterRegistry;
    this.executionSessionResolver = executionSessionResolver;
    this.workerId = String(workerId).trim();
    if (!this.workerId) throw new Error("workerId is required");
    this.env = env;
    this.leaseMs = leaseMs;
    this.now = now;
  }

  #liveEnabled(executionId, context, { exactOperatorDispatch = false } = {}) {
    if (this.env.SEEDING_JEV_LIVE_ENABLED !== "true" || context.authorization?.allowLiveExecution !== true) return false;
    if (exactOperatorDispatch) {
      if (this.env.SEEDING_JEV_EXACT_LIVE_ENABLED !== "true") return false;
    } else if (this.env.SEEDING_JEV_LIVE_EXECUTION_ID !== executionId && this.env.SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED !== "true") return false;
    try { return assertLiveGrantMatchesExecution(context.liveGrant, context.request, context.authorization); }
    catch { return false; }
  }

  #exactStateResult(requestRow, executionId) {
    const state = String(requestRow?.state || "").toUpperCase();
    const phase = String(requestRow?.executionPhase || "").toUpperCase();
    if (state === "SUBMIT_RESULT_UNKNOWN" || requestRow?.submitState === "UNKNOWN") {
      return { status: "SUBMIT_RESULT_UNKNOWN", executionId, state };
    }
    if (["SUBMIT_SENT_INTENT", "SUBMIT_SENT"].includes(state) || requestRow?.submitState === "SUBMIT_SENT") {
      return { status: "SUBMIT_RESULT_UNKNOWN", executionId, state, reasonCode: "submit_already_crossed_boundary" };
    }
    if (["CONFIRMED", "VERIFIED"].includes(state) || phase === "VERIFIED") {
      return { status: "TERMINAL_ALREADY_COMPLETE", executionId, state };
    }
    if (state === "EXECUTING" || phase === "EXECUTING") {
      return { status: "ALREADY_IN_PROGRESS", executionId, state };
    }
    if (["CANCELLED_PRE_SUBMIT", "FAILED", "REJECTED", "REMOVED", "DRY_RUN_COMPLETE", "DRY_RUN_FAILED"].includes(state)) {
      return { status: "NOT_DISPATCHABLE", executionId, state };
    }
    return null;
  }

  #normalizeExactResult(result, executionId) {
    if (["VERIFIED", "SUBMIT_RESULT_UNKNOWN", "PRE_SUBMIT_STOPPED", "NOT_DISPATCHABLE", "ALREADY_IN_PROGRESS", "TERMINAL_ALREADY_COMPLETE"].includes(result?.status)) return result;
    if (result?.status === "CONFIRMED") return { ...result, status: "VERIFIED", executionId };
    if (["UNKNOWN", "SUBMIT_SENT", "SUBMIT_SENT_INTENT"].includes(result?.status)) return { ...result, status: "SUBMIT_RESULT_UNKNOWN", executionId };
    if (["LEASE_BUSY", "LEASE_LOST", "EXECUTING"].includes(result?.status)) return { ...result, status: "ALREADY_IN_PROGRESS", executionId };
    return { ...result, status: "PRE_SUBMIT_STOPPED", executionId, reasonCode: result?.reasonCode || String(result?.status || "pre_submit_gate_failed").toLowerCase() };
  }

  #receipt(requestRow, request, result, { dryRun = false, reconciliation = false } = {}) {
    const verification = result.publicationVerification || result.publicationEvidence || result.publicationUrl || result.publicationReference
      ? normalizePublicationVerification(result.publicationVerification || result)
      : null;
    const submitState = String(result.submitState || (verification?.state === "CONFIRMED" ? "CONFIRMED" : verification?.state === "UNKNOWN" ? "UNKNOWN" : verification?.state === "FAILED" ? "FAILED" : "FAILED")).toUpperCase();
    const receiptResult = { ...result, submitState };
    const finishedAt = result.finishedAt || this.now().toISOString();
    const startedAt = result.startedAt || finishedAt;
    return validateExecutionReceiptV1({
      schemaVersion: 1,
      executionId: request.executionId,
      jobId: request.jobId,
      attempt: requestRow.attempt,
      startedAt,
      finishedAt,
      readinessResult: result.readinessResult || readinessResult(request),
      submitState,
      dryRun,
      publicationUrl: verification?.publicationUrl || result.publicationUrl || null,
      publicationReference: verification?.publicationReference || result.publicationReference || null,
      publicationEvidence: verification?.verificationEvidence || result.publicationEvidence || undefined,
      submitAcceptanceEvidence: result.submitAcceptanceEvidence || undefined,
      reconciliation,
      errorClassification: errorClass(receiptResult, dryRun),
      recoveryClassification: recoveryClass(receiptResult),
      preSubmitFailure: result.preSubmitFailure || undefined,
      reasonCode: result.preSubmitFailure?.reasonCode || result.reasonCode || undefined,
      submitBoundaryAttemptedAt: result.submitBoundaryAttemptedAt || undefined,
      uploadFailure: result.uploadFailure || undefined,
      telemetry: {
        durationMs: Math.max(0, Math.trunc(result.durationMs || Date.parse(finishedAt) - Date.parse(startedAt) || 0)),
        browserCommands: Math.max(0, Math.trunc(result.browserCommands || 0)),
        computerUseCalls: Math.max(0, Math.trunc(result.computerUseCalls || 0)),
        retries: Math.max(0, Math.trunc(result.retries || 0)),
        totalDryRunMs: dryRun ? Math.max(0, Math.trunc(result.durationMs || 0)) : 0,
        ...(result.telemetry || {})
      },
      verificationGates: result.gates || undefined
    });
  }

  async dispatchExactExecution(executionId) {
    const id = String(executionId || "").trim();
    if (!id) return { status: "NOT_DISPATCHABLE", executionId: null, reasonCode: "execution_id_required" };
    try {
      const result = await this.#run(id, { dryRun: false, exactOperatorDispatch: true });
      return this.#normalizeExactResult(result, id);
    } catch (error) {
      // A thrown error after the durable boundary is never a safe retry signal.
      // Re-read only this execution and report its persisted phase.
      let context = null;
      let stateReadFailed = false;
      try { context = await this.service.executionContext(id); }
      catch { stateReadFailed = true; }
      const persisted = this.#exactStateResult(context?.requestRow, id);
      if (persisted) return persisted;
      if (!context && /execution request not found/i.test(String(error?.message || ""))) {
        return { status: "NOT_DISPATCHABLE", executionId: id, reasonCode: "execution_not_found" };
      }
      if (stateReadFailed) {
        return { status: "SUBMIT_RESULT_UNKNOWN", executionId: id, reasonCode: "execution_state_unavailable_after_dispatch_error" };
      }
      return { status: "PRE_SUBMIT_STOPPED", executionId: id, reasonCode: String(error?.code || "pre_submit_gate_failed").toLowerCase() };
    }
  }

  async run(executionId, { dryRun = true } = {}) {
    return this.#run(executionId, { dryRun, exactOperatorDispatch: false });
  }

  async #run(executionId, { dryRun = true, exactOperatorDispatch = false } = {}) {
    const workerStartedAt = Date.now();
    const initial = await this.service.executionContext(executionId);
    if (exactOperatorDispatch) {
      const priorResult = this.#exactStateResult(initial.requestRow, executionId);
      if (priorResult) return priorResult;
      if (initial.requestRow.state !== "REQUEST_READY" || initial.requestRow.submitState !== "NOT_STARTED") {
        return { status: "NOT_DISPATCHABLE", executionId, state: initial.requestRow.state };
      }
      if (!this.#liveEnabled(executionId, initial, { exactOperatorDispatch })) {
        return { status: "PRE_SUBMIT_STOPPED", executionId, reasonCode: "exact_live_dispatch_not_authorized" };
      }
    }
    if (initial.requestRow.state !== "REQUEST_READY" || initial.requestRow.submitState !== "NOT_STARTED") {
      return { status: "NOT_DISPATCHABLE", executionId, state: initial.requestRow.state };
    }
    if (initial.request?.dryRun === true && !dryRun) return { status: "DRY_RUN_ONLY", executionId };
    const adapter = this.adapterRegistry.resolve(initial.request.platform);
    if (!adapter) return { status: "PLATFORM_UNSUPPORTED", executionId, platform: initial.request.platform, reasonCode: "adapter_not_registered" };
    const leaseStartedAt = Date.now();
    const leaseResult = await this.service.acquireExecutionLease(executionId, this.workerId, { leaseMs: this.leaseMs });
    const leaseAcquireMs = Date.now() - leaseStartedAt;
    if (!leaseResult.acquired) return { status: "LEASE_BUSY", executionId, reason: leaseResult.reason };
    const lease = leaseResult.lease;
    let leaseLost = false;
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy || leaseLost) return;
      heartbeatBusy = true;
      try {
        if (!await this.service.renewExecutionLease(lease.id, lease.token, { leaseMs: this.leaseMs })) leaseLost = true;
      } catch { leaseLost = true; }
      finally { heartbeatBusy = false; }
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();
    let executionSession = null;
    let resolvedSessionEnvelope = null;
    let executionTransport = null;
    let executionBrowserSurface = null;
    try {
      if (!initial.account || initial.account.status !== "enabled" || initial.account.health !== "healthy" || initial.account.profileId !== initial.request.profileId || initial.account.accountId !== initial.request.accountId) {
        return { status: "HUMAN_REQUIRED", executionId, reasonCode: "account_profile_binding_invalid" };
      }

      const readinessStarted = Date.now();
      // The request already carries bound READY readiness. Reuse it while fresh;
      // the service refreshes automatically when it is stale or missing.
      const readiness = await this.service.refreshCampaignJobReadiness(initial.post.id, this.workerId, {
        executionId: initial.request.executionId
      });
      const readinessRefreshMs = Date.now() - readinessStarted;
      const dryRunRequest = initial.request?.dryRun === true;
      if ((dryRunRequest ? readiness.readinessState !== "READY" : readiness.status !== "queued" || readiness.readinessState !== "READY")) {
        // A readiness gate is evaluated before the adapter and before the
        // durable submit boundary.  Its UNKNOWN/BLOCKED result is therefore
        // a safe pre-submit stop, never submission uncertainty.  Keep the
        // provider reason explicit so exact dispatch cannot normalize this
        // gate result into SUBMIT_RESULT_UNKNOWN.
        const reasonCode = readiness.reasons?.[0] || String(readiness.readinessState || readiness.status || "READINESS_NOT_READY").toLowerCase();
        return {
          status: "PRE_SUBMIT_STOPPED",
          executionId,
          reasonCode,
          reasonCodes: readiness.reasons || [reasonCode]
        };
      }
      const refreshed = await this.service.prepareExecutionRequest(initial.post.id, `jev-worker:${this.workerId}`, { dryRun: dryRunRequest });
      if (refreshed.executionId !== executionId || refreshed.state !== "REQUEST_READY") {
        return { status: "NOT_DISPATCHABLE", executionId, state: refreshed.state };
      }
      if (leaseLost) return { status: "LEASE_LOST", executionId };
      const context = await this.service.executionContext(executionId);
      const liveEnabled = !dryRun && this.#liveEnabled(executionId, context, { exactOperatorDispatch });
      if (!dryRun && !liveEnabled) return { status: "LIVE_NOT_AUTHORIZED", executionId };
      if (!dryRun && this.executionSessionResolver) {
        const resolver = this.executionSessionResolver;
        const acquire = typeof resolver.resolve === "function" ? resolver.resolve.bind(resolver) : resolver.acquire?.bind(resolver);
        if (typeof acquire !== "function") throw Object.assign(new Error("execution session resolver is invalid"), { code: "EXECUTION_SESSION_RESOLVER_INVALID" });
        resolvedSessionEnvelope = await acquire({ request: context.request, account: context.account, context, executionId });
        executionSession = resolvedSessionEnvelope?.session || resolvedSessionEnvelope;
        executionTransport = resolvedSessionEnvelope?.transport || executionSession?.transport || null;
        executionBrowserSurface = resolvedSessionEnvelope?.browserSurface || executionSession?.browserSurface || null;
        if (!executionSession || typeof executionSession !== "object") throw Object.assign(new Error("execution session unavailable"), { code: "EXECUTION_SESSION_UNAVAILABLE" });
        if (typeof executionSession.assertUsable === "function") executionSession.assertUsable();
      }
      await this.service.markExecutionStarted(executionId, lease, { dryRun });

      const queueToWorkerMs = Math.max(0, workerStartedAt - Date.parse(context.request.createdAt));
      let preSubmitFailure = null;
      let submitReadiness = readinessEvidence(context);
      let submitBoundaryAttemptedAt = null;
      const result = await adapter.execute(context.request, {
        dryRun,
        liveEnabled,
        account: context.account,
        executionSession: executionSession || undefined,
        transport: executionTransport || undefined,
        browserSurface: executionBrowserSurface || undefined,
        transportIdentity: executionSession?.transportIdentity || executionSession?.runtimeIdentity || executionTransport?.runtimeIdentity?.() || undefined,
        beforeProviderSend: async () => {
          if (dryRun) return null;
          return this.service.assertExecutionSendable(executionId, lease);
        },
        beforeSubmitIntent: async (verifiedGates, submitBoundaryEvidence = {}) => {
          submitBoundaryAttemptedAt = this.now().toISOString();
          if (leaseLost) throw Object.assign(new Error("Execution lease was lost before submit"), { code: "LEASE_LOST" });
          let current;
          try {
            current = await this.service.executionContext(executionId);
            if (current.request?.executionId !== executionId || current.requestRow?.executionId !== executionId || current.request?.jobId !== context.request.jobId ||
                current.request?.accountId !== context.request.accountId || current.request?.profileId !== context.request.profileId ||
                current.request?.target?.targetId !== context.request.target.targetId || current.target?.id !== context.request.target.targetId ||
                current.target?.accountId !== context.request.accountId || current.target?.profileId !== context.request.profileId ||
                current.target?.channel !== context.request.platform) {
              throw Object.assign(new Error("Execution context changed before submit"), { code: "execution_context_mismatch" });
            }
            submitReadiness = readinessEvidence(current);
            const expiresAt = Date.parse(submitReadiness?.expiresAt || "");
            if (!Number.isFinite(expiresAt) || expiresAt - this.now().getTime() <= SUBMIT_READINESS_SAFETY_MARGIN_MS) {
              const refreshed = await this.service.refreshCampaignJobReadiness(context.request.jobId, `jev-worker:${this.workerId}`, {
                force: true,
                executionId
              });
              current = await this.service.executionContext(executionId);
              submitReadiness = readinessEvidence(current);
              const refreshedExpiresAt = Date.parse(submitReadiness?.expiresAt || "");
              const refreshedCheckedAt = Date.parse(submitReadiness?.checkedAt || "");
              const refreshedReady = submitReadiness?.state === "READY" && refreshed?.readinessState === "READY";
              const refreshedRemainingMs = Number.isFinite(refreshedExpiresAt) ? refreshedExpiresAt - this.now().getTime() : NaN;
              if (refreshed?.status !== "queued" || !refreshedReady ||
                  !Number.isFinite(refreshedCheckedAt) || !Number.isFinite(refreshedRemainingMs) || refreshedRemainingMs <= SUBMIT_READINESS_SAFETY_MARGIN_MS) {
                const reasonCode = !refreshedReady
                  ? submitReadiness?.reasonCode || refreshed?.reasons?.[0] || String(submitReadiness?.state || refreshed?.readinessState || "READINESS_NOT_READY")
                  : refreshed?.status !== "queued" ? refreshed?.reasons?.[0] || "READINESS_BLOCKED"
                    : !Number.isFinite(refreshedCheckedAt) || !Number.isFinite(refreshedRemainingMs) ? "READINESS_EVIDENCE_INVALID"
                      : "READINESS_EXPIRING";
                preSubmitFailure = { reasonCode, stage: "readiness_refresh", gate: "readinessFresh", gateStatus: false };
                throw Object.assign(new Error("Provider readiness was not READY before submit"), { code: reasonCode, preSubmitFailure });
              }
            }
          } catch (error) {
            if (!preSubmitFailure) {
              const reasonCode = String(error?.code || submitReadiness?.reasonCode || "readiness_refresh_failed");
              preSubmitFailure = { reasonCode, stage: "readiness_refresh", gate: "readinessFresh", gateStatus: false };
            }
            if (submitReadiness?.state === "READY") {
              submitReadiness = { ...submitReadiness, state: "UNKNOWN", reasonCode: preSubmitFailure.reasonCode };
            }
            error.preSubmitFailure = preSubmitFailure;
            error.verificationGates = verifiedGates;
            error.code ||= preSubmitFailure.reasonCode;
            throw error;
          }
          try {
            const selectedTransportIdentity = executionSession?.transportIdentity || executionSession?.runtimeIdentity || null;
            const suppliedTransportIdentity = submitBoundaryEvidence.transportIdentity || selectedTransportIdentity;
            if (selectedTransportIdentity && !sameTransportIdentity(selectedTransportIdentity, suppliedTransportIdentity)) {
              throw Object.assign(new Error("Submit transport differs from acquired execution session"), { code: "TRANSPORT_SWITCH_AFTER_SESSION_ACQUIRE" });
            }
            return await this.service.beginExecutionSubmitIntent(executionId, lease, {
              liveEnabled,
              liveExecutionId: this.env.SEEDING_JEV_LIVE_EXECUTION_ID,
              autonomousLiveEnabled: this.env.SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED === "true",
              exactLiveDispatchEnabled: exactOperatorDispatch && this.env.SEEDING_JEV_EXACT_LIVE_ENABLED === "true",
              verifiedGates,
              requireTransportCertification: adapter.requiresCertifiedTransport === true,
              transportIdentity: suppliedTransportIdentity,
              transportCertification: submitBoundaryEvidence.transportCertification,
              preSubmitControlEvidence: submitBoundaryEvidence.preSubmitControlEvidence
            });
          } catch (error) {
            const reasonCode = String(error?.code || "other_platform_pre_submit_error");
            preSubmitFailure = error?.preSubmitFailure || {
              reasonCode,
              stage: "submit_boundary",
              gate: Object.entries(verifiedGates || {}).find(([, passed]) => passed !== true)?.[0] || null
            };
            error.preSubmitFailure = preSubmitFailure;
            error.verificationGates = verifiedGates;
            error.code ||= reasonCode;
            throw error;
          }
        },
        onSubmitSent: (submitAcceptanceEvidence) => this.service.markExecutionSubmitSent(executionId, lease, submitAcceptanceEvidence)
      });
      if (preSubmitFailure) {
        result.preSubmitFailure = preSubmitFailure;
      }
      if (submitBoundaryAttemptedAt) result.submitBoundaryAttemptedAt = submitBoundaryAttemptedAt;
      if (submitReadiness?.checkedAt) result.readinessResult = {
        state: submitReadiness.state,
        checkedAt: submitReadiness.checkedAt,
        expiresAt: submitReadiness.expiresAt,
        reasonCode: submitReadiness.reasonCode || preSubmitFailure?.reasonCode || "execution_readiness_fresh",
        evidenceReference: submitReadiness.evidenceReference
      };
      result.durationMs = Date.now() - workerStartedAt;
      result.telemetry = {
        ...(result.telemetry || {}),
        readinessRefreshMs,
        queueToWorkerMs,
        leaseAcquireMs
      };
      const receipt = this.#receipt(context.requestRow, context.request, result, { dryRun });
      await this.service.recordExecutionReceipt(executionId, receipt, `jev-worker:${this.workerId}`);
      const gateValues = Object.values(receipt.verificationGates || {});
      const dryRunPassed = receipt.submitState === "NOT_STARTED" && receipt.errorClassification === "NONE" && gateValues.length > 0 && gateValues.every((value) => value === true);
      if (exactOperatorDispatch) {
        if (receipt.submitState === "CONFIRMED") return { status: "VERIFIED", executionId, receipt };
        if (["UNKNOWN", "SUBMIT_SENT"].includes(receipt.submitState)) return { status: "SUBMIT_RESULT_UNKNOWN", executionId, receipt };
        if (["FAILED", "NOT_STARTED"].includes(receipt.submitState)) return { status: "PRE_SUBMIT_STOPPED", executionId, receipt };
      }
      return { status: dryRun ? (dryRunPassed ? "DRY_RUN_COMPLETE" : "DRY_RUN_FAILED") : receipt.submitState, executionId, receipt };
    } finally {
      clearInterval(heartbeat);
      if (executionSession) {
        const release = this.executionSessionResolver?.release || executionSession.release || executionSession.detach;
        if (typeof release === "function") await Promise.resolve().then(() => release.call(this.executionSessionResolver || executionSession, executionSession)).catch(() => undefined);
      }
      await this.service.releaseExecutionLease(lease.id, lease.token);
    }
  }

  async runReadyOnce({ dryRun = true } = {}) {
    const ready = await this.service.readyExecutionRequests();
    const results = [];
    for (const item of ready) {
      try {
        results.push(await this.run(item.executionId, { dryRun }));
      } catch (error) {
        results.push({ status: "WORKER_ERROR", executionId: item.executionId, reasonCode: String(error.code || "worker_error").toLowerCase() });
      }
    }
    return results;
  }

  async runReadyDryRunOnce() {
    const ready = await this.service.readyDryRunExecutionRequests();
    const results = [];
    for (const item of ready) {
      try {
        results.push(await this.run(item.executionId, { dryRun: true }));
      } catch (error) {
        results.push({ status: "WORKER_ERROR", executionId: item.executionId, reasonCode: String(error.code || "worker_error").toLowerCase() });
      }
    }
    return results;
  }

  async reconcile(executionId) {
    const initial = await this.service.executionContext(executionId);
    if (!["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN"].includes(initial.requestRow.state)) {
      return { status: "NOT_RECONCILABLE", executionId, state: initial.requestRow.state };
    }
    const adapter = this.adapterRegistry.resolve(initial.request.platform);
    if (!adapter) return { status: "PLATFORM_UNSUPPORTED", executionId, platform: initial.request.platform, reasonCode: "adapter_not_registered" };
    const leaseResult = await this.service.acquireExecutionLease(executionId, this.workerId, { leaseMs: this.leaseMs, mode: "reconcile" });
    if (!leaseResult.acquired) return { status: "LEASE_BUSY", executionId, reason: leaseResult.reason };
    const lease = leaseResult.lease;
    try {
      await this.service.markExecutionReconciliationAttempt(executionId);
      const context = await this.service.executionContext(executionId);
      const priorReceipt = (context.state.executionReceipts || [])
        .filter((item) => item.executionId === executionId && item.attempt === context.requestRow.attempt)
        .sort((left, right) => Date.parse(right.receivedAt || 0) - Date.parse(left.receivedAt || 0))[0];
      const result = await adapter.reconcile(context.request, {
        account: context.account,
        submittedAt: context.requestRow.submitIntentAt || context.requestRow.dispatchedAt || null,
        preSubmitMediaIntegrity: priorReceipt?.receipt?.publicationEvidence?.preSubmitMediaIntegrity || null
      });
      const receipt = this.#receipt(context.requestRow, context.request, result, { reconciliation: true });
      if (!(receipt.submitState === "UNKNOWN" && context.requestRow.state === "SUBMIT_RESULT_UNKNOWN")) {
        await this.service.recordExecutionReceipt(executionId, receipt, `jev-worker:${this.workerId}`);
      }
      return { status: receipt.submitState, executionId, receipt };
    } finally {
      await this.service.releaseExecutionLease(lease.id, lease.token);
    }
  }

  async reconcilePendingOnce() {
    const pending = await this.service.pendingExecutionReconciliations();
    const results = [];
    for (const item of pending) {
      try {
        results.push(await this.reconcile(item.executionId));
      } catch (error) {
        results.push({ status: "RECONCILIATION_ERROR", executionId: item.executionId, reasonCode: String(error.code || "reconciliation_error").toLowerCase() });
      }
    }
    return results;
  }
}
