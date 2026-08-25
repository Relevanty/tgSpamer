import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const envArg = process.argv[2] ?? ".env";
const envPath = resolve(process.cwd(), envArg);
const envFileName = basename(envPath);
const templatePath = resolve(process.cwd(), "templates", "example.env");

function serializeEnvValue(value) {
  const stringValue = String(value ?? "");
  if (!stringValue || /^[A-Za-z0-9._/@:+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function upsertEnvValue(content, key, value) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content ? content.split(/\r?\n/) : [];
  const serialized = `${key}=${serializeEnvValue(value)}`;
  let found = false;

  const updatedLines = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1] === key) {
      found = true;
      return serialized;
    }
    return line;
  });

  if (!found) {
    if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] !== "") {
      updatedLines.push("");
    }
    updatedLines.push(serialized);
  }

  let nextContent = updatedLines.join(eol);
  if (!nextContent.endsWith(eol)) {
    nextContent += eol;
  }
  return nextContent;
}

function profileFromEnvFileName(fileName) {
  if (fileName === ".env") {
    return "default";
  }

  if (fileName.startsWith(".env.")) {
    return fileName.slice(".env.".length) || "default";
  }

  if (fileName.endsWith(".env")) {
    return fileName.slice(0, -".env".length) || "default";
  }

  return "default";
}

if (!existsSync(envPath)) {
  if (!existsSync(templatePath)) {
    throw new Error(`Не найден templates/example.env. Невозможно создать ${envFileName}.`);
  }

  let content = readFileSync(templatePath, "utf8");
  content = upsertEnvValue(content, "SESSION_STRING", "");
  content = upsertEnvValue(content, "PROFILE", profileFromEnvFileName(envFileName));
  writeFileSync(envPath, content, "utf8");
  console.log(`Создан ${envFileName} из templates/example.env.`);
  console.log("");
}

process.env.AUTH_METHOD = "qr";
process.env.PROBE_MODE = "true";
process.env.PROBE_IDLE_MS = process.env.PROBE_IDLE_MS || "1000";

await import("./start.js");
