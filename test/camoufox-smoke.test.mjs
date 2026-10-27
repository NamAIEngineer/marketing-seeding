import assert from "node:assert/strict";
import test from "node:test";
import { runCamoufoxSmoke } from "../scripts/camoufox-smoke.mjs";
import os from "node:os";
import path from "node:path";

test("Camoufox smoke reports missing runtime without launching or exposing paths", async () => {
  const result = await runCamoufoxSmoke({ env: { SEEDING_CAMOUFOX_RUNTIME_PATH: path.join(os.tmpdir(), "missing-camoufox-runtime"), SEEDING_CAMOUFOX_EXECUTABLE_PATH: path.join(os.tmpdir(), "missing-camoufox-executable") } });
  assert.equal(result.status, "CONFIG_MISSING");
  assert.ok(result.configErrors.includes("runtime_path_unavailable"));
  assert.equal("executablePath" in result, false); assert.equal("profileRoot" in result, false);
});
