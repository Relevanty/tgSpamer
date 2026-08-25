import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_THIRD_MESSAGE_FILE = "we.txt";
const DEFAULT_THIRD_MESSAGE_PHOTO = "images/sticker1.png";
let activeTempEnvPath = "";
let activeLoginInfoPath = "";
let signalCleanupStarted = false;

const translitMap = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function escapeEnvValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function serializeEnvValue(value) {
  const stringValue = String(value ?? "");
  if (!stringValue || /^[A-Za-z0-9._/@:+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `"${escapeEnvValue(stringValue)}"`;
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

function parseEnvValue(content, key) {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match?.[1] !== key) {
      continue;
    }

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return "";
}

function transliterate(value) {
  return Array.from(String(value ?? ""))
    .map((char) => translitMap[char.toLowerCase()] ?? char)
    .join("");
}

function sanitizeProfileName(value) {
  return transliterate(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 64);
}

function pickProfileBase(loginInfo) {
  const username = sanitizeProfileName(loginInfo.username);
  if (username) {
    return username;
  }

  const fullName = [loginInfo.firstName, loginInfo.lastName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const name = sanitizeProfileName(fullName);
  return name || "account";
}

function ensureUniqueProfileName(baseName) {
  let candidate = baseName;
  let index = 2;

  while (
    existsSync(path.resolve(`.env.${candidate}`)) ||
    existsSync(path.resolve(`запуск ${candidate}.bat`))
  ) {
    candidate = `${baseName}_${index}`;
    index += 1;
  }

  return candidate;
}

async function findTemplatePath() {
  const templatePath = path.resolve("templates", "example.env");
  if (existsSync(templatePath)) {
    return templatePath;
  }

  throw new Error("Не найден шаблон templates/example.env.");
}

async function createTempEnv(tempEnvPath) {
  const templatePath = await findTemplatePath();
  let content = await fs.readFile(templatePath, "utf8");
  content = upsertEnvValue(content, "SESSION_STRING", "");
  content = upsertEnvValue(content, "PROFILE", "tmp-login");
  content = upsertEnvValue(content, "THIRD_MESSAGE_TEXT_FILE", DEFAULT_THIRD_MESSAGE_FILE);
  content = upsertEnvValue(content, "THIRD_MESSAGE_PHOTO_PATH", DEFAULT_THIRD_MESSAGE_PHOTO);

  await fs.writeFile(tempEnvPath, content, "utf8");
  console.log(`Создан временный конфиг ${path.basename(tempEnvPath)} из ${path.basename(templatePath)}.`);
}

function runLogin(tempEnvPath, loginInfoPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["tools/login.js", tempEnvPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOGIN_INFO_FILE: loginInfoPath,
        PROBE_IDLE_MS: process.env.PROBE_IDLE_MS || "1000",
      },
      stdio: "inherit",
    });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function readLoginInfo(loginInfoPath) {
  const raw = await fs.readFile(loginInfoPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function buildBatchContent(title, commandLine) {
  return [
    "@echo off",
    "setlocal",
    "chcp 65001 >nul",
    'cd /d "%~dp0"',
    "",
    `echo ${title}`,
    "echo.",
    "",
    `call ${commandLine}`,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    "",
    "echo.",
    "echo Press any key to exit.",
    "pause >nul",
    "exit /b %EXIT_CODE%",
    "",
  ].join("\r\n");
}

async function writeBatchIfMissing(fileName, content) {
  const filePath = path.resolve(fileName);
  if (existsSync(filePath)) {
    console.log(`Файл уже существует, не перезаписываю: ${fileName}`);
    return;
  }

  await fs.writeFile(filePath, content, "utf8");
  console.log(`Создан ${fileName}`);
}

async function createProfileBatchFiles(profileName, envFileName) {
  await writeBatchIfMissing(
    `запуск ${profileName}.bat`,
    buildBatchContent(
      `Start campaign ${profileName}.`,
      `node tools/start.js "${envFileName}"`,
    ),
  );
  await writeBatchIfMissing(
    `архивация ${profileName}.bat`,
    buildBatchContent(
      `Archive ${profileName}.`,
      `node tools/start.js "${envFileName}" --archive`,
    ),
  );
  await writeBatchIfMissing(
    `сбор участников ${profileName}.bat`,
    buildBatchContent(
      `Parse users ${profileName}.`,
      `node tools/parse.js "${envFileName}"`,
    ),
  );
}

async function safeUnlink(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.log(`Не удалось удалить ${path.basename(filePath)}: ${error.message}`);
    }
  }
}

async function cleanupAfterSignal(signal) {
  if (signalCleanupStarted) {
    return;
  }
  signalCleanupStarted = true;
  await safeUnlink(activeLoginInfoPath);
  await safeUnlink(activeTempEnvPath);
  console.log(`\nВход прерван (${signal}). Временный конфиг удален.`);
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", () => {
  cleanupAfterSignal("SIGINT").catch(() => process.exit(130));
});
process.once("SIGTERM", () => {
  cleanupAfterSignal("SIGTERM").catch(() => process.exit(143));
});

async function main() {
  const suffix = `${process.pid}-${Date.now()}`;
  const tempEnvPath = path.resolve(`.env.tmp-login-${suffix}`);
  const loginInfoPath = path.resolve(`.env.tmp-login-info-${suffix}.json`);
  activeTempEnvPath = tempEnvPath;
  activeLoginInfoPath = loginInfoPath;
  let success = false;

  try {
    await createTempEnv(tempEnvPath);
    console.log("Отсканируйте QR-код. Финальный .env будет создан только после успешного входа.");
    console.log("");

    const exitCode = await runLogin(tempEnvPath, loginInfoPath);
    if (exitCode !== 0) {
      throw new Error(`Вход завершился с кодом ${exitCode}.`);
    }

    const tempEnvContent = await fs.readFile(tempEnvPath, "utf8");
    const sessionString = parseEnvValue(tempEnvContent, "SESSION_STRING");
    if (!sessionString) {
      throw new Error("SESSION_STRING не появился во временном конфиге.");
    }

    const loginInfo = await readLoginInfo(loginInfoPath);
    const profileBase = pickProfileBase(loginInfo);
    const profileName = ensureUniqueProfileName(profileBase);
    const finalEnvFileName = `.env.${profileName}`;
    const finalEnvPath = path.resolve(finalEnvFileName);

    let finalContent = upsertEnvValue(tempEnvContent, "PROFILE", profileName);
    finalContent = upsertEnvValue(finalContent, "THIRD_MESSAGE_TEXT_FILE", DEFAULT_THIRD_MESSAGE_FILE);
    finalContent = upsertEnvValue(finalContent, "THIRD_MESSAGE_PHOTO_PATH", DEFAULT_THIRD_MESSAGE_PHOTO);
    await fs.writeFile(tempEnvPath, finalContent, "utf8");
    await fs.rename(tempEnvPath, finalEnvPath);

    await createProfileBatchFiles(profileName, finalEnvFileName);
    success = true;
    console.log("");
    console.log(`Готово: создан ${finalEnvFileName}`);
  } finally {
    await safeUnlink(loginInfoPath);
    if (!success) {
      await safeUnlink(tempEnvPath);
      console.log("Временный конфиг удален. Финальный .env не создан.");
    }
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
