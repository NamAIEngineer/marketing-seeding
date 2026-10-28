#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = "ai.marketing-seeding.project-coordinator";
const launchAgents = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgents, `${label}.plist`);
const stateRoot = path.join(os.homedir(), "build-agentic-AI", ".agentic", "marketing-seeding", "project-coordinator");
const nodePath = process.execPath;
const scriptPath = path.join(appRoot, "scripts", "project-coordinator-supervisor.mjs");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${nodePath}</string><string>${scriptPath}</string><string>--state-file</string><string>${path.join(stateRoot, "state.json")}</string></array>
<key>WorkingDirectory</key><string>${appRoot}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${path.join(stateRoot, "supervisor.stdout.log")}</string>
<key>StandardErrorPath</key><string>${path.join(stateRoot, "supervisor.stderr.log")}</string>
</dict></plist>\n`;
await mkdir(launchAgents, { recursive: true });
await mkdir(stateRoot, { recursive: true });
await writeFile(plistPath, plist, { encoding: "utf8", mode: 0o600 });
const domain = `gui/${process.getuid?.() || ""}`;
await run("launchctl", ["bootout", domain, plistPath]).catch(() => undefined);
await run("launchctl", ["bootstrap", domain, plistPath]);
process.stdout.write(`${JSON.stringify({ label, plistPath, stateRoot, nodePath, scriptPath, startup: "launchd", reversible: "launchctl bootout" }, null, 2)}\n`);
