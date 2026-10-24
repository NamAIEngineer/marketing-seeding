const assertPreClickValidation = ({ validate } = {}) => { if (typeof validate !== "function") throw Object.assign(new Error("Browser transport requires pre-provider validation"), { code: "TRANSPORT_VALIDATION_REQUIRED" }); return true; };

/** Provider-neutral interaction contract. Implementations receive an explicit session. */
export class ExecutionTransport {
  async health() { throw new Error("health not implemented"); }
  async attach(_session) { throw new Error("attach not implemented"); }
  async navigate(_target) { throw new Error("navigate not implemented"); }
  async snapshot(_options) { throw new Error("snapshot not implemented"); }
  async observe(_options) { return this.snapshot(_options); }
  async resolve(_query) { throw new Error("resolve not implemented"); }
  async findControl(query) { return this.resolve(query); }
  async type(_target, _value) { throw new Error("type not implemented"); }
  async screenshot(_options) { throw new Error("screenshot not implemented"); }
  async click(target, options = {}) {
    assertPreClickValidation(options);
    await options.validate();
    throw Object.assign(new Error("click not implemented"), { code: "TRANSPORT_CAPABILITY_UNSUPPORTED" });
  }
  async observeTransition(_options) { throw new Error("observeTransition not implemented"); }
  async verifyActivation(_options) { throw new Error("verifyActivation not implemented"); }
  async evaluateMutation(_pageId, _expression, _options) { throw Object.assign(new Error("evaluateMutation not implemented"), { code: "TRANSPORT_CAPABILITY_UNSUPPORTED" }); }
  async detach() { throw new Error("detach not implemented"); }
  async closeOwnedResources() { return this.detach(); }
}
export default ExecutionTransport;
