import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const envArg = process.argv[2] ?? ".env";
const envPath = resolve(process.cwd(), envArg);
const envFileName = basename(envPath);
const examplePath = resolve(dirname(envPath), `example${envFileName}`);

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    throw new Error(`Не найден ${basename(examplePath)}. Невозможно создать ${envFileName}.`);
  }

  copyFileSync(examplePath, envPath);
  console.log(`Создан ${envFileName} из ${basename(examplePath)}.`);
  console.log("");
}

process.env.AUTH_METHOD = "qr";
process.env.PROBE_MODE = "true";
process.env.PROBE_IDLE_MS = process.env.PROBE_IDLE_MS || "1000";

await import("./start.js");
