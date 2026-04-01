import { resolve } from "node:path";

let envArg = null;
let archiveMode = false;

for (const arg of process.argv.slice(2)) {
  if (arg === "--archive") {
    archiveMode = true;
  } else if (!envArg) {
    envArg = arg;
  }
}

const envPath = envArg ? resolve(process.cwd(), envArg) : resolve(process.cwd(), ".env");
process.env.DOTENV_CONFIG_PATH = envPath;
if (archiveMode) {
  process.env.ARCHIVE_ONLY = "true";
}

await import("../src/index.js");
