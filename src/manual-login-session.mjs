import { randomUUID } from "node:crypto";

const LOGIN_URLS = Object.freeze({
  linkedin: "https://www.linkedin.com/login",
  facebook: "https://www.facebook.com/login/",
  facebook_group: "https://www.facebook.com/login/"
});
const clean = (value, max = 240) => String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Retained, isolated visible Camoufox sessions for SSO/MFA/challenge handoff. */
export class ManualLoginSessionManager {
  #provision;
  #sessions = new Map();
  #ttlMs;
  constructor({ provision, ttlMs = 15 * 60_000 } = {}) {
    if (typeof provision !== "function") throw new Error("manual login provisioner is required");
    this.#provision = provision;
    this.#ttlMs = Math.max(60_000, Number(ttlMs) || 15 * 60_000);
  }
  async start({ platform, accountId, profileId, identityReference = null } = {}) {
    const requested = clean(platform, 80).toLowerCase();
    const browserPlatform = requested === "facebook" ? "facebook_group" : requested;
    const loginUrl = LOGIN_URLS[requested] || LOGIN_URLS[browserPlatform];
    if (!loginUrl || !clean(accountId, 160) || !clean(profileId, 180)) {
      throw Object.assign(new Error("platform, accountId and profileId are required"), { code: "MANUAL_LOGIN_BINDING_REQUIRED" });
    }
    for (const [id, session] of this.#sessions) if (session.accountId === accountId && session.platform === requested) await this.close(id);
    const runtime = await this.#provision();
    const acquired = await runtime.coordinator.acquire({ provider: "camoufox", platform: browserPlatform, accountId, profileReference: profileId, providerProfileId: profileId, identityReference });
    if (!acquired?.ready) throw Object.assign(new Error("Camoufox visible profile could not be opened"), { code: acquired?.code || "CAMOUFOX_MANUAL_LOGIN_UNAVAILABLE" });
    const protocol = await runtime.coordinator.protocolFactory()({ profileReference: acquired.handle.profileReference, expectedIdentity: { provider: "camoufox", platform: browserPlatform, accountId, identityReference }, runtimeIdentity: acquired.handle.runtimeIdentity });
    await protocol.attach({ allowUnauthenticated: true });
    const page = (await protocol.listTabs())[0];
    await protocol.navigate(page.pageId || page.id, loginUrl);
    const sessionId = randomUUID();
    this.#sessions.set(sessionId, { sessionId, platform: requested, browserPlatform, accountId: clean(accountId, 160), profileReference: clean(profileId, 180), loginUrl, protocol, coordinator: runtime.coordinator, handle: acquired.handle, pageId: page.pageId || page.id, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + this.#ttlMs).toISOString(), status: "WAITING_FOR_USER" });
    return this.status(sessionId);
  }
  async poll(sessionId) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "MANUAL_LOGIN_SESSION_NOT_FOUND" };
    if (Date.now() > Date.parse(session.expiresAt)) { await this.close(sessionId); return { status: "BLOCKED", code: "MANUAL_LOGIN_SESSION_EXPIRED", reason: "Cửa sổ đăng nhập đã hết thời gian" }; }
    try {
      const observed = await session.protocol.observeIdentity();
      const state = String(observed?.state || "UNKNOWN").toUpperCase();
      if (state === "READY") { session.status = "READY"; session.identityReference = clean(observed.identityReference, 400) || null; session.observed = observed; }
      else if (["CHALLENGED", "CHALLENGE", "MFA", "SECURITY_CHALLENGE"].includes(state)) session.status = "WAITING_FOR_USER";
      else session.status = "WAITING_FOR_USER";
      return this.status(sessionId);
    } catch (error) { return { ...this.status(sessionId), status: "WAITING_FOR_USER", code: clean(error?.code || "MANUAL_LOGIN_OBSERVATION_PENDING") }; }
  }
  status(sessionId) {
    const s = this.#sessions.get(String(sessionId));
    if (!s) return { status: "UNKNOWN", code: "MANUAL_LOGIN_SESSION_NOT_FOUND" };
    return { sessionId: s.sessionId, platform: s.platform, accountId: s.accountId, status: s.status, code: s.status === "READY" ? "LOGIN_CONFIRMED" : "WAITING_FOR_USER", reason: s.status === "READY" ? "Đã xác minh danh tính" : "Đăng nhập trong cửa sổ Camoufox riêng", identityReference: s.identityReference || null, loginUrl: s.loginUrl, profileReference: s.profileReference, startedAt: s.startedAt, expiresAt: s.expiresAt };
  }
  async close(sessionId) {
    const s = this.#sessions.get(String(sessionId));
    if (!s) return { status: "UNKNOWN", code: "MANUAL_LOGIN_SESSION_NOT_FOUND" };
    this.#sessions.delete(String(sessionId));
    await s.protocol?.detach?.().catch(() => undefined);
    await s.coordinator?.release?.(s.handle).catch(() => undefined);
    return { sessionId: String(sessionId), status: "CLOSED" };
  }
}

export default ManualLoginSessionManager;
