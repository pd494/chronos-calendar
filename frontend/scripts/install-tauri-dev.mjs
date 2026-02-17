import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const tauriConfigPath = resolve(repoRoot, "src-tauri", "tauri.conf.dev.json");

const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const productName = config.productName || "Chronos Calendar Dev";
const appBundleName = `${productName}.app`;

const src = resolve(
  repoRoot,
  "src-tauri",
  "target",
  "debug",
  "bundle",
  "macos",
  appBundleName,
);

execFileSync("cp", ["-rf", src, "/Applications/"], { stdio: "inherit" });
