import { readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformMain = path.resolve(__dirname, "..", "platforms", "android", "app", "src", "main");
const assetsWww = path.join(platformMain, "assets", "www");

if (!existsSync(assetsWww)) {
  process.exit(0);
}

for (const entry of await readdir(platformMain, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("assets_www_stale_")) {
    continue;
  }

  try {
    await rm(path.join(platformMain, entry.name), { recursive: true, force: true });
  } catch {
    // Some stale folders can contain Windows-locked files. They are outside assets and harmless.
  }
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
const stalePath = path.join(platformMain, `assets_www_stale_${stamp}`);

try {
  await rename(assetsWww, stalePath);
  console.log(`moved generated assets www to ${path.relative(process.cwd(), stalePath)}`);
} catch (error) {
  try {
    const escapedAssetsWww = assetsWww.replace(/'/g, "''");
    const escapedStalePath = stalePath.replace(/'/g, "''");

    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$ErrorActionPreference='Stop'; Move-Item -LiteralPath '${escapedAssetsWww}' -Destination '${escapedStalePath}'`,
      ],
      { stdio: "pipe" },
    );
    console.log(`moved generated assets www to ${path.relative(process.cwd(), stalePath)}`);
  } catch (fallbackError) {
    throw new Error(
      `Failed to move generated Android assets www folder before prepare: ${error.message}; PowerShell fallback: ${fallbackError.message}`,
      { cause: fallbackError },
    );
  }
}
