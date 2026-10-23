/**
 * Provider-neutral boundary for normal browser interaction.
 *
 * A transport receipt says that the browser automation provider completed its
 * command. It never says that the page activated the control or accepted a
 * platform submission. Those are observed by the adapter in separate layers.
 */
export class BrowserInteractionTransport {
  constructor({ id = "browser-interaction", provider = "unknown", providerVersion = null } = {}) {
    this.id = String(id);
    this.provider = String(provider);
    this.providerVersion = providerVersion ? String(providerVersion) : null;
    // A final-submit transport must prove that it runs the caller's
    // pre-provider validation immediately before emitting browser input.
    // Implementations opt into this explicit contract; LinkedIn rejects
    // unmarked transports at its submit boundary.
    this.transportContractVersion = 1;
    this.requiresPreClickValidation = true;
  }

  assertPreClickValidation({ validate } = {}) {
    if (typeof validate !== "function") {
      throw Object.assign(new Error("Browser transport requires pre-provider validation"), { code: "TRANSPORT_VALIDATION_REQUIRED" });
    }
    return true;
  }

  runtimeIdentity() {
    return {
      transport: this.id,
      provider: this.provider,
      providerVersion: this.providerVersion
    };
  }

  async health() {
    return { state: "UNKNOWN", transport: this.id, provider: this.provider, providerVersion: this.providerVersion };
  }

  async assertReadyForFinalSubmit() {
    return this.runtimeIdentity();
  }

  async resolveTarget() {
    throw new Error(`${this.id} does not implement resolveTarget`);
  }

  async preflight() {
    throw new Error(`${this.id} does not implement preflight`);
  }

  async click() {
    throw new Error(`${this.id} does not implement click`);
  }

  async observeActivation() {
    throw new Error(`${this.id} does not implement observeActivation`);
  }
}

function timestamp(value) {
  if (!value) return new Date().toISOString();
  const text = String(value);
  return Number.isFinite(Date.parse(text)) ? text : new Date().toISOString();
}

/** Normalize provider output while preserving command/activation separation. */
export function transportReceipt(result, { transport, targetIdentity, startedAt, completedAt, diagnostics } = {}) {
  const source = result && typeof result === "object" ? result : {};
  const commandStatus = source.status === undefined || source.status === null
    ? "COMMAND_COMPLETED"
    : source.status === "COMMAND_COMPLETED" ? "COMMAND_COMPLETED" : String(source.status || "OUTCOME_UNKNOWN");
  return {
    transport: String(transport || source.transport || "browser-interaction"),
    commandStatus,
    targetIdentity: targetIdentity ? String(targetIdentity).slice(0, 160) : source.elementRef ? String(source.elementRef).slice(0, 160) : null,
    startedAt: timestamp(startedAt || source.startedAt || source.commandStartedAt),
    completedAt: timestamp(completedAt || source.completedAt || source.commandCompletedAt),
    diagnostics: diagnostics && typeof diagnostics === "object" ? diagnostics : source.diagnostics || null,
    providerResult: source.providerResult && typeof source.providerResult === "object" ? source.providerResult : null,
    // This is deliberately not called activation. Callers must observe page
    // state separately and produce controlActivationEvidence.
    activation: null
  };
}

/**
 * ORCA health is an observation, not a construction fact.  The transport
 * must use the client's read-only executable/connected-runtime probe before
 * it reports READY.  A missing probe or an unpinned runtime stays UNKNOWN;
 * a known version mismatch/unavailable runtime is UNAVAILABLE.
 */
async function observeOrcaHealth(browser, transport) {
  const base = {
    ...transport.runtimeIdentity(),
    commandCount: browser.browserCommandCount?.() ?? null
  };
  if (typeof browser.assertRuntimeVersion !== "function") {
    return { state: "UNKNOWN", ...base, reason: "ORCA_RUNTIME_PROBE_NOT_CONFIGURED" };
  }
  try {
    const observed = await browser.assertRuntimeVersion({ expectedVersion: transport.providerVersion });
    return {
      state: "READY",
      ...base,
      observedProviderVersion: observed?.connectedRuntimeVersion || observed?.observedVersion || browser.observedRuntimeVersion || null,
      readinessEvidence: "READ_ONLY_EXECUTABLE_AND_CONNECTED_RUNTIME_VERSION"
    };
  } catch (error) {
    const code = String(error?.code || "ORCA_RUNTIME_PROBE_FAILED");
    const unavailable = new Set([
      "ORCA_RUNTIME_VERSION_MISMATCH",
      "ORCA_CONNECTED_RUNTIME_VERSION_MISMATCH",
      "ORCA_RUNTIME_UNAVAILABLE",
      "PROVIDER_TIMEOUT"
    ]).has(code);
    return {
      state: unavailable ? "UNAVAILABLE" : "UNKNOWN",
      ...base,
      observedProviderVersion: browser.observedRuntimeVersion || null,
      reason: code
    };
  }
}

/** First implementation: ORCA's accessibility element command. */
export class OrcaAccessibilityTransport extends BrowserInteractionTransport {
  constructor(browser, { providerVersion = browser?.runtimeVersion || process.env.ORCA_VERSION || null } = {}) {
    super({ id: "orca-accessibility", provider: "orca", providerVersion });
    if (!browser) throw new Error("ORCA accessibility transport requires a browser client");
    this.browser = browser;
  }

  async health() {
    return observeOrcaHealth(this.browser, this);
  }

  async assertReadyForFinalSubmit() {
    if (typeof this.browser.assertRuntimeVersion !== "function") return this.runtimeIdentity();
    return this.browser.assertRuntimeVersion({ expectedVersion: this.providerVersion });
  }

  async click({ pageId, targetRef, targetIdentity = targetRef }, { validate, diagnostics, onProviderCallStarted } = {}) {
    if (!pageId || !targetRef) throw Object.assign(new Error("Browser transport target is incomplete"), { code: "TRANSPORT_TARGET_INVALID" });
    if (typeof this.browser.click !== "function") throw Object.assign(new Error("ORCA accessibility click transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE" });
    this.assertPreClickValidation({ validate });
    const startedAt = new Date().toISOString();
    const result = await this.browser.click(pageId, targetRef, { validate, onProviderCallStarted });
    const completedAt = new Date().toISOString();
    const receipt = transportReceipt(result, {
      transport: this.id,
      targetIdentity,
      startedAt,
      completedAt,
      diagnostics
    });
    // Preserve the legacy receipt fields consumed by existing execution
    // contracts while adding the normalized boundary fields.
    return {
      ...result,
      ...receipt,
      status: receipt.commandStatus,
      elementRef: String(targetRef),
      startedAt,
      completedAt
    };
  }
}

/** Normal pointer transport exposed by ORCA's browser command surface. */
export class OrcaPointerTransport extends BrowserInteractionTransport {
  constructor(browser, { providerVersion = browser?.runtimeVersion || process.env.ORCA_VERSION || null } = {}) {
    super({ id: "orca-pointer", provider: "orca", providerVersion });
    if (!browser) throw new Error("ORCA pointer transport requires a browser client");
    this.browser = browser;
  }

  async health() {
    return observeOrcaHealth(this.browser, this);
  }

  async assertReadyForFinalSubmit() {
    if (typeof this.browser.assertRuntimeVersion !== "function") return this.runtimeIdentity();
    return this.browser.assertRuntimeVersion({ expectedVersion: this.providerVersion });
  }

  async click({ pageId, targetRef, targetIdentity = targetRef, boundingBox }, { validate, diagnostics, onProviderCallStarted } = {}) {
    if (!pageId || !targetRef || !boundingBox) throw Object.assign(new Error("ORCA pointer target is incomplete"), { code: "TRANSPORT_TARGET_INVALID" });
    if (typeof this.browser.mouseMove !== "function" || typeof this.browser.mouseDown !== "function" || typeof this.browser.mouseUp !== "function") {
      throw Object.assign(new Error("ORCA pointer click transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE" });
    }
    this.assertPreClickValidation({ validate });
    const preflight = typeof validate === "function" ? await validate() : null;
    const startedAt = new Date().toISOString();
    onProviderCallStarted?.(startedAt);
    const x = Math.round(Number(boundingBox.x) + Number(boundingBox.width) / 2);
    const y = Math.round(Number(boundingBox.y) + Number(boundingBox.height) / 2);
    await this.browser.mouseMove(pageId, x, y);
    await this.browser.mouseDown(pageId, "left");
    const providerResult = await this.browser.mouseUp(pageId, "left");
    const completedAt = new Date().toISOString();
    return {
      ...transportReceipt({ status: "COMMAND_COMPLETED", providerResult }, { transport: this.id, targetIdentity, startedAt, completedAt, diagnostics }),
      status: "COMMAND_COMPLETED", commandStatus: "COMMAND_COMPLETED", elementRef: String(targetRef), providerCallStarted: true, providerCallStartedAt: startedAt, preflight,
      startedAt, completedAt, providerResult: providerResult && typeof providerResult === "object" ? providerResult : null
    };
  }
}

/**
 * Mint the deliberately narrow certification used for the first controlled
 * LinkedIn execution.  This is not a promotion of reversible evidence to a
 * general irreversible certification: the result is bound to one execution
 * and expires shortly after it is created.  Callers must opt in explicitly;
 * production configuration should keep this disabled unless the campaign is
 * the reviewed bootstrap lane.
 */
export function createBootstrapTransportCertification({
  sourceCertification,
  executionBinding,
  evidenceReference,
  expiresAt,
  allowBootstrap = false,
  now = Date.now(),
  maxTtlMs = 24 * 60 * 60 * 1000
} = {}) {
  if (allowBootstrap !== true) {
    throw Object.assign(new Error("Bootstrap transport certification is disabled"), { code: "BOOTSTRAP_CERTIFICATION_DISABLED" });
  }
  const source = sourceCertification && typeof sourceCertification === "object" ? sourceCertification : null;
  if (!source || source.certified !== true || String(source.provider || "") !== "orca" ||
      !String(source.transport || "").trim() || !String(source.providerVersion || "").trim() ||
      !String(source.evidenceReference || "").trim()) {
    throw Object.assign(new Error("A certified ORCA reversible transport record is required"), { code: "BOOTSTRAP_SOURCE_NOT_CERTIFIED" });
  }
  const sourceScope = String(source.certificationScope || "");
  if (!sourceScope || sourceScope === "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT" || sourceScope === "IRREVERSIBLE_LINKEDIN_SUBMIT" ||
      !/(REVERSIBLE|CONTROL_ACTIVATION)/i.test(sourceScope)) {
    throw Object.assign(new Error("Bootstrap source must be reversible control-activation evidence"), { code: "BOOTSTRAP_SOURCE_SCOPE_INVALID" });
  }
  const binding = executionBinding && typeof executionBinding === "object" ? { ...executionBinding } : null;
  if (!binding || String(binding.platform || "") !== "linkedin") {
    throw Object.assign(new Error("Bootstrap certification requires a LinkedIn execution binding"), { code: "BOOTSTRAP_BINDING_INVALID" });
  }
  const required = ["executionId", "campaignId", "jobId", "accountId", "profileId", "targetId", "targetUrl", "authorizationId", "authorizationBinding", "contentSha256"];
  if (required.some((key) => !String(binding[key] || "").trim())) {
    throw Object.assign(new Error("Bootstrap certification execution binding is incomplete"), { code: "BOOTSTRAP_BINDING_INCOMPLETE" });
  }
  binding.visibility = String(binding.visibility || "PUBLIC").toUpperCase();
  binding.mediaSha256 = Array.isArray(binding.mediaSha256) ? [...binding.mediaSha256].map(String).sort() : [];
  const expiry = Date.parse(String(expiresAt || ""));
  const current = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!Number.isFinite(expiry) || expiry <= current || expiry - current > Math.max(1, Number(maxTtlMs) || 0)) {
    throw Object.assign(new Error("Bootstrap transport certification expiry is invalid"), { code: "BOOTSTRAP_CERTIFICATION_EXPIRY_INVALID" });
  }
  const reference = String(evidenceReference || source.evidenceReference || "").trim();
  if (!reference || /[\r\n]/.test(reference)) {
    throw Object.assign(new Error("Bootstrap transport certification evidence reference is required"), { code: "BOOTSTRAP_EVIDENCE_REFERENCE_REQUIRED" });
  }
  return {
    transport: String(source.transport),
    provider: "orca",
    providerVersion: String(source.providerVersion),
    platform: "linkedin",
    certified: true,
    irreversibleSubmit: true,
    bootstrap: true,
    certificationScope: "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT",
    evidenceReference: reference.slice(0, 240),
    expiresAt: new Date(expiry).toISOString(),
    executionBinding: binding
  };
}

// Naming used by bootstrap orchestration callers; keep one implementation.
export const deriveBootstrapTransportCertification = createBootstrapTransportCertification;

export function selectCertifiedTransport({ transports = [], certifications = [], platform = "linkedin", runtime = {}, requireIrreversibleSubmit = false, executionBinding = null } = {}) {
  // A transport identity must have one unambiguous certification policy. Do
  // not let array ordering silently select the last record when configuration
  // accidentally contains conflicting scopes (for example a local fixture
  // record and an irreversible-submit record for the same ORCA transport).
  const certified = new Map();
  for (const item of certifications.filter((candidate) => candidate?.certified === true)) {
    const transportId = String(item.transport || "").trim();
    if (!transportId) continue;
    const scope = String(item.certificationScope || "").trim();
    // Bootstrap certification is a one-execution proof scope. It must never
    // become a generic irreversible-submit fallback when a caller omits the
    // exact execution binding.
    if (scope === "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT" && !executionBinding) continue;
    if (executionBinding && scope === "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT") {
      if (item.bootstrap !== true) continue;
      if (!matchesExecutionBinding(item, executionBinding)) continue;
    } else if (executionBinding && scope !== "IRREVERSIBLE_LINKEDIN_SUBMIT") continue;
    const policyIdentity = JSON.stringify({
      provider: String(item.provider || "").trim(),
      providerVersion: String(item.providerVersion || "").trim(),
      platform: item.platform ? String(item.platform).trim() : null,
      irreversibleSubmit: item.irreversibleSubmit === true,
      certificationScope: item.certificationScope ? String(item.certificationScope).trim() : null
    });
    const existing = certified.get(transportId);
    if (existing && existing.policyIdentity !== policyIdentity) {
      throw Object.assign(new Error(`Ambiguous certified browser transport identity: ${transportId}`), { code: "TRANSPORT_CERTIFICATION_AMBIGUOUS" });
    }
    if (!existing) certified.set(transportId, { item, policyIdentity });
  }
  const candidates = transports.filter((transport) => {
    const identity = transport?.runtimeIdentity?.() || {};
    const certification = certified.get(identity.transport);
    if (!certification) return false;
    const record = certification.item;
    if (record.platform && record.platform !== platform) return false;
    // Local fixture/reversible calibration records must never authorize an
    // irreversible final submit. Production callers opt into this stricter
    // scope and require an explicit live LinkedIn certification record.
    if (requireIrreversibleSubmit &&
        (platform !== "linkedin" || record.irreversibleSubmit !== true ||
         (record.certificationScope !== "IRREVERSIBLE_LINKEDIN_SUBMIT" && record.certificationScope !== "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT"))) return false;
    const runtimeProvider = String(runtime.provider || "").trim();
    const recordProvider = String(record.provider || "").trim();
    const transportProvider = String(identity.provider || "").trim();
    const runtimeVersion = String(runtime.providerVersion || "").trim();
    const recordVersion = String(record.providerVersion || "").trim();
    const transportVersion = String(identity.providerVersion || "").trim();
    // Certification is bound to the exact executable/provider identity. A
    // matching version from a different provider is not interchangeable.
    if (!runtimeProvider || !recordProvider || !transportProvider ||
        !runtimeVersion || !recordVersion || !transportVersion) return false;
    return runtimeProvider === recordProvider && runtimeProvider === transportProvider &&
      runtimeVersion === recordVersion && runtimeVersion === transportVersion;
  }).sort((a, b) => String(a.runtimeIdentity?.().transport || "").localeCompare(String(b.runtimeIdentity?.().transport || "")));
  if (candidates.length === 0) throw Object.assign(new Error("No certified browser interaction transport is available"), { code: "TRANSPORT_NOT_CERTIFIED" });
  return candidates[0];
}

export function selectedTransportCertification({ transport, certifications = [], platform = "linkedin", runtime = {}, requireIrreversibleSubmit = false, executionBinding = null } = {}) {
  const chosen = selectCertifiedTransport({ transports: [transport], certifications, platform, runtime, requireIrreversibleSubmit, executionBinding });
  const identity = chosen.runtimeIdentity?.() || {};
  return certifications.find((item) => item?.certified === true && item.transport === identity.transport &&
    item.provider === identity.provider && item.providerVersion === identity.providerVersion &&
    (item.certificationScope === "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT"
      ? item.bootstrap === true && !!executionBinding && matchesExecutionBinding(item, executionBinding)
      : !executionBinding || item.certificationScope === "IRREVERSIBLE_LINKEDIN_SUBMIT")) || null;
}

function matchesExecutionBinding(record, binding) {
  if (!binding || String(binding.platform || "") !== "linkedin") return false;
  const expires = Date.parse(record.expiresAt || "");
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  if (!record.evidenceReference || typeof record.evidenceReference !== "string") return false;
  const expected = {
    executionId: binding.executionId, campaignId: binding.campaignId, jobId: binding.jobId,
    accountId: binding.accountId, profileId: binding.profileId, targetId: binding.targetId,
    targetUrl: binding.targetUrl, authorizationId: binding.authorizationId,
    authorizationBinding: binding.authorizationBinding, contentSha256: binding.contentSha256,
    visibility: String(binding.visibility || "PUBLIC").toUpperCase(),
    mediaSha256: Array.isArray(binding.mediaSha256) ? [...binding.mediaSha256].map(String).sort() : []
  };
  const required = ["executionId", "campaignId", "jobId", "accountId", "profileId", "targetId", "targetUrl", "authorizationId", "authorizationBinding", "contentSha256"];
  if (required.some((key) => !String(expected[key] || "").trim())) return false;
  const actual = record.executionBinding || {};
  if (actual.executionId !== expected.executionId || actual.campaignId !== expected.campaignId ||
      actual.jobId !== expected.jobId || actual.accountId !== expected.accountId || actual.profileId !== expected.profileId ||
      actual.targetId !== expected.targetId || actual.targetUrl !== expected.targetUrl ||
      actual.authorizationId !== expected.authorizationId || actual.authorizationBinding !== expected.authorizationBinding ||
      actual.contentSha256 !== expected.contentSha256 || String(actual.visibility || "").toUpperCase() !== expected.visibility) return false;
  const media = Array.isArray(actual.mediaSha256) ? [...actual.mediaSha256].map(String).sort() : [];
  return JSON.stringify(media) === JSON.stringify(expected.mediaSha256);
}

function transportIdentity(value) {
  if (value && typeof value === "object") {
    return {
      transport: String(value.transport || "").trim(),
      provider: String(value.provider || "").trim(),
      providerVersion: String(value.providerVersion || "").trim()
    };
  }
  return { transport: String(value || "").trim(), provider: "", providerVersion: "" };
}

export function assertTransportCannotChangeAfterIntent({ selectedTransport, requestedTransport, intentPersisted = false } = {}) {
  const selected = transportIdentity(selectedTransport);
  const requested = transportIdentity(requestedTransport);
  const changed = selected.transport !== requested.transport ||
    selected.provider !== requested.provider ||
    selected.providerVersion !== requested.providerVersion;
  if (intentPersisted && requestedTransport && changed) {
    throw Object.assign(new Error("Browser interaction transport cannot change after durable submit intent"), { code: "TRANSPORT_SWITCH_AFTER_INTENT" });
  }
  return selectedTransport;
}

/**
 * Final-submit callers must use a transport that explicitly implements the
 * validation contract. A duck-typed click function is insufficient because it
 * could silently ignore the callback that fences the last browser input.
 */
export function assertValidatedTransport(transport) {
  if (!transport || typeof transport.click !== "function" ||
      transport.transportContractVersion !== 1 ||
      transport.requiresPreClickValidation !== true ||
      typeof transport.assertPreClickValidation !== "function") {
    throw Object.assign(new Error("Browser interaction transport is not certified for validated final input"), { code: "TRANSPORT_NOT_CERTIFIED" });
  }
  return transport;
}
