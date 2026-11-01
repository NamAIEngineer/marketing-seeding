import { randomUUID } from "node:crypto";

const clean = (value, max = 240) => String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Manual login seam for the app-owned Chromium account runtime. */
export class ManualLoginSessionManager {
  #browserManager;
  #sessions = new Map();
  #ttlMs;
  constructor({ browserManager, ttlMs = 15 * 60_000 } = {}) {
    if (!browserManager || typeof browserManager.start !== "function") throw new Error("Chrome account browser manager is required");
    this.#browserManager = browserManager;
    this.#ttlMs = Math.max(60_000, Number(ttlMs) || 15 * 60_000);
  }
  async start({ platform, accountId, profileId, identityReference = null } = {}) {
    const requested = clean(platform, 80).toLowerCase();
    const account = clean(accountId, 160);
    if (!requested || !account || !clean(profileId, 500)) throw Object.assign(new Error("platform, accountId and profileId are required"), { code: "MANUAL_LOGIN_BINDING_REQUIRED" });
    for (const [id, session] of this.#sessions) if (session.accountId === account && session.platform === requested) await this.close(id);
    const opened = await this.#browserManager.start({ platform: requested, accountId: account, profilePath: profileId });
    const sessionId = opened?.sessionId || randomUUID();
    const startedAt = opened?.startedAt || new Date().toISOString();
    const expiresAt = opened?.expiresAt || new Date(Date.now() + this.#ttlMs).toISOString();
    this.#sessions.set(sessionId, { sessionId, platform: requested, accountId: account, profileReference: clean(profileId, 500), identityReference: clean(identityReference, 500) || null, startedAt, expiresAt, status: opened?.status || "WAITING_FOR_USER" });
    return this.status(sessionId);
  }
  async poll(sessionId) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "MANUAL_LOGIN_SESSION_NOT_FOUND" };
    if (Date.now() > Date.parse(session.expiresAt)) { await this.close(sessionId); return { status: "BLOCKED", code: "MANUAL_LOGIN_SESSION_EXPIRED", reason: "Chrome login window expired" }; }
    const observed = await this.#browserManager.poll(sessionId);
    if (observed?.status === "READY") { session.status = "READY"; session.identityReference = clean(observed.identityReference, 500) || session.identityReference; session.evidenceHash = clean(observed.evidenceHash, 80) || null; session.observedUrl = clean(observed.observedUrl, 500) || null; }
    else if (observed?.status === "BLOCKED") session.status = "BLOCKED";
    else session.status = "WAITING_FOR_USER";
    return { ...this.status(sessionId), ...(observed?.code ? { code: observed.code } : {}) };
  }
  status(sessionId) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "MANUAL_LOGIN_SESSION_NOT_FOUND" };
    return { sessionId: session.sessionId, platform: session.platform, accountId: session.accountId, status: session.status, code: session.status === "READY" ? "LOGIN_CONFIRMED" : "WAITING_FOR_USER", reason: session.status === "READY" ? "Đã xác minh danh tính từ redirect nền tảng" : "Đăng nhập trong cửa sổ Chrome riêng; danh tính chưa xác minh", identityReference: session.identityReference || null, observedUrl: session.observedUrl || null, evidenceHash: session.evidenceHash || null, profileReference: session.profileReference, source: `chrome-account:${session.accountId}`, startedAt: session.startedAt, expiresAt: session.expiresAt };
  }
  async close(sessionId) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "MANUAL_LOGIN_SESSION_NOT_FOUND" };
    this.#sessions.delete(String(sessionId));
    try { await this.#browserManager.close?.(sessionId); } catch {}
    return { sessionId: String(sessionId), status: "CLOSED" };
  }
}

export default ManualLoginSessionManager;
