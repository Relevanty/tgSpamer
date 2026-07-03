import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import input from "input";
import qrcodeTerminal from "qrcode-terminal";
import { Api, TelegramClient } from "telegram";
import {
  ConnectionTCPAbridged,
  ConnectionTCPFull,
  ConnectionTCPObfuscated,
} from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";

import { sleep } from "./utils.js";

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627";
const CONNECTION_TYPES = {
  full: ConnectionTCPFull,
  abridged: ConnectionTCPAbridged,
  obfuscated: ConnectionTCPObfuscated,
};

const STATE_VERSION = 1;
const DEFAULT_MIN_DATE = "2025-09-01";
const DEFAULT_MESSAGE_LIMIT = 40;
const DEFAULT_SCAN_DELAY_MS = 150;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;
const DISCORD_FILE_NAME = "discord-users.txt";
const MEETING_FILE_NAME = "zoom-telemost-users.txt";

function getErrorMessage(error) {
  if (typeof error?.errorMessage === "string" && error.errorMessage.trim()) {
    return error.errorMessage.trim();
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function parseBooleanEnv(name, defaultValue = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(rawValue).trim().toLowerCase());
}

function parseIntegerEnv(name, defaultValue, minValue = Number.NEGATIVE_INFINITY) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(String(rawValue).trim(), 10);
  if (Number.isNaN(parsedValue)) {
    return defaultValue;
  }
  return Math.max(parsedValue, minValue);
}

function getActiveEnvPath() {
  const configuredPath = String(process.env.DOTENV_CONFIG_PATH ?? "").trim();
  return configuredPath ? path.resolve(configuredPath) : path.resolve(".env");
}

function formatEnvPath(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return filePath;
}

function escapeEnvValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

async function upsertEnvValue(filePath, key, value) {
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content ? content.split(/\r?\n/) : [];
  const serialized = `${key}="${escapeEnvValue(value)}"`;
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

  await fs.writeFile(filePath, nextContent, "utf8");
}

function validateEnv() {
  const envApiId = Number(String(process.env.API_ID ?? "").trim());
  const envApiHash = String(process.env.API_HASH ?? "").trim();
  const hasEnvApiCredentials =
    Number.isInteger(envApiId) && envApiId > 0 && envApiHash.length > 0;
  const apiId = hasEnvApiCredentials ? envApiId : DEFAULT_API_ID;
  const apiHash = hasEnvApiCredentials ? envApiHash : DEFAULT_API_HASH;
  const forceSms = String(process.env.FORCE_SMS ?? "false").toLowerCase() === "true";
  const authMethodRaw = String(process.env.AUTH_METHOD ?? "qr").trim().toLowerCase();
  const authMethod = authMethodRaw === "phone" ? "phone" : "qr";

  return { apiId, apiHash, forceSms, authMethod };
}

function buildConnectionOptions() {
  const transportNameRaw = String(process.env.TELEGRAM_TRANSPORT ?? "full")
    .trim()
    .toLowerCase();
  let transportName = CONNECTION_TYPES[transportNameRaw] ? transportNameRaw : "full";
  const useWss = parseBooleanEnv("TELEGRAM_USE_WSS", false);
  const connectionRetries = parseIntegerEnv("TELEGRAM_CONNECTION_RETRIES", 5, 0);
  const retryDelay = parseIntegerEnv("TELEGRAM_RETRY_DELAY_MS", 1000, 0);
  const timeout = parseIntegerEnv("TELEGRAM_CONNECT_TIMEOUT_SEC", 10, 1);
  const reconnectRetriesRaw = process.env.TELEGRAM_RECONNECT_RETRIES;
  const reconnectRetries =
    reconnectRetriesRaw === undefined ||
    reconnectRetriesRaw === null ||
    String(reconnectRetriesRaw).trim() === ""
      ? undefined
      : parseIntegerEnv("TELEGRAM_RECONNECT_RETRIES", 5, 0);

  const socksProxyRaw = String(process.env.SOCKS_PROXY ?? "").trim();
  let socksHost = "";
  let socksPort = null;
  if (socksProxyRaw) {
    const match = socksProxyRaw.match(/^(.+):([0-9]+)$/);
    if (match) {
      socksHost = match[1].trim();
      const parsedPort = Number.parseInt(match[2], 10);
      socksPort = Number.isNaN(parsedPort) ? null : parsedPort;
    }
  }

  if (!socksHost) {
    socksHost = String(process.env.SOCKS_HOST ?? "").trim();
  }
  if (socksPort === null) {
    const socksPortRaw = String(process.env.SOCKS_PORT ?? "").trim();
    const parsedSocksPort = Number.parseInt(socksPortRaw, 10);
    socksPort = Number.isNaN(parsedSocksPort) ? null : parsedSocksPort;
  }

  const socksTypeRaw = String(process.env.SOCKS_TYPE ?? "5").trim();
  const socksType = socksTypeRaw === "4" ? 4 : 5;
  const proxy =
    socksHost && socksPort
      ? {
          ip: socksHost,
          port: socksPort,
          socksType,
        }
      : undefined;

  if (proxy && transportName === "full") {
    transportName = "obfuscated";
  }

  return {
    connection: CONNECTION_TYPES[transportName],
    useWSS: useWss,
    timeout,
    retryDelay,
    connectionRetries,
    ...(reconnectRetries !== undefined ? { reconnectRetries } : {}),
    ...(proxy ? { proxy } : {}),
  };
}

async function startClientWithPhoneAuth(client, forceSms) {
  let phoneNumberValue = "";
  const authParams = {
    phoneNumber: async () => {
      if (!phoneNumberValue) {
        phoneNumberValue = (await input.text("Номер телефона: ")).trim();
      }
      console.log(
        `Предпочтительный способ получения кода: ${authParams.forceSMS ? "SMS (forceSMS=true)" : "в приложении Telegram (forceSMS=false)"}`,
      );
      return phoneNumberValue;
    },
    password: async () => input.text("Пароль 2FA (если включен): "),
    phoneCode: async (isCodeViaApp) => {
      const prompt = isCodeViaApp
        ? "Код Telegram (из чата Telegram в приложении): "
        : "Код Telegram (из SMS): ";

      console.log(
        "Введите /resend для нового кода, /sms для SMS-режима или /app для кода в приложении.",
      );
      const value = (await input.text(prompt)).trim();
      const command = value.toLowerCase();

      if (command === "/resend") {
        const restartError = new Error("Restart auth and resend code");
        restartError.errorMessage = "RESTART_AUTH";
        throw restartError;
      }
      if (command === "/sms") {
        authParams.forceSMS = true;
        const restartError = new Error("Restart auth with SMS");
        restartError.errorMessage = "RESTART_AUTH";
        throw restartError;
      }
      if (command === "/app") {
        authParams.forceSMS = false;
        const restartError = new Error("Restart auth with in-app code");
        restartError.errorMessage = "RESTART_AUTH";
        throw restartError;
      }

      return value;
    },
    forceSMS: forceSms,
    onError: (error) => console.error("Ошибка авторизации Telegram:", error),
  };

  await client.start(authParams);
}

async function startClientWithQrAuth(client, apiId, apiHash) {
  console.log("Включен режим авторизации по QR.");
  console.log("Откройте Telegram на телефоне: Настройки -> Устройства -> Подключить устройство.");
  console.log("Затем отсканируйте QR-код ниже.");

  await client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      qrCode: async ({ token, expires }) => {
        const loginToken = token.toString("base64url");
        const loginUrl = `tg://login?token=${loginToken}`;
        const expiresAt = new Date(Number(expires) * 1000);
        console.log(`\nНовый QR-код сгенерирован. Действует до ${expiresAt.toLocaleString()}`);
        qrcodeTerminal.generate(loginUrl, { small: true });
      },
      password: async (hint) =>
        input.text(
          hint ? `Пароль 2FA (подсказка: ${hint}): ` : "Пароль 2FA (если включен): ",
        ),
      onError: async (error) => {
        console.error("Ошибка QR-авторизации Telegram:", error);
        return false;
      },
    },
  );
}

async function startClient(apiId, apiHash, forceSms, authMethod) {
  const sessionString = process.env.SESSION_STRING ?? "";
  const stringSession = new StringSession(sessionString);
  const envPath = getActiveEnvPath();
  const envLabel = formatEnvPath(envPath);

  const client = new TelegramClient(stringSession, apiId, apiHash, buildConnectionOptions());

  await client.connect();

  if (!(await client.checkAuthorization())) {
    if (authMethod === "phone") {
      if (forceSms) {
        console.warn(
          "FORCE_SMS=true: Telegram может не отправлять SMS-код для сторонних клиентов. " +
            "Если код не приходит, установите FORCE_SMS=false.",
        );
      }
      await startClientWithPhoneAuth(client, forceSms);
    } else {
      await startClientWithQrAuth(client, apiId, apiHash);
    }
  }

  const savedSessionString = client.session.save();
  if (!sessionString || savedSessionString !== sessionString) {
    await upsertEnvValue(envPath, "SESSION_STRING", savedSessionString);
    console.log(`SESSION_STRING сохранен в ${envLabel}`);
  }

  if (!sessionString) {
    console.log(`SESSION_STRING для ${envLabel}:`);
    console.log(savedSessionString);
  }

  return client;
}

function getProfile() {
  return String(process.env.PROFILE ?? "default").trim() || "default";
}

function sanitizePathSegment(value) {
  return String(value ?? "default")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "default";
}

function getStorageBase() {
  const storageMode = String(process.env.STORAGE_MODE ?? "shared").trim().toLowerCase();
  const profile = sanitizePathSegment(getProfile());
  if (storageMode === "per_profile") {
    return path.resolve("storage", profile);
  }
  return path.resolve("storage");
}

function getStatePath() {
  const override = String(process.env.LINK_SCAN_STATE_FILE ?? "").trim();
  if (override) {
    return path.resolve(override);
  }

  const storageMode = String(process.env.STORAGE_MODE ?? "shared").trim().toLowerCase();
  const profile = sanitizePathSegment(getProfile());
  if (storageMode === "per_profile") {
    return path.resolve(getStorageBase(), "link-scan-state.json");
  }
  return path.resolve(getStorageBase(), `link-scan-state.${profile}.json`);
}

function parseMinDate() {
  const rawValue = String(process.env.LINK_SCAN_MIN_DATE ?? DEFAULT_MIN_DATE).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    throw new Error(`Некорректный LINK_SCAN_MIN_DATE: ${rawValue}. Нужен формат YYYY-MM-DD.`);
  }

  const date = new Date(`${rawValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Некорректный LINK_SCAN_MIN_DATE: ${rawValue}.`);
  }

  return {
    label: rawValue,
    unixTime: Math.floor(date.getTime() / 1000),
  };
}

function getScannerConfig() {
  const minDate = parseMinDate();
  const discordOutOverride = String(process.env.LINK_SCAN_DISCORD_OUT ?? "").trim();
  const meetingOutOverride = String(process.env.LINK_SCAN_MEETING_OUT ?? "").trim();
  return {
    minDate,
    messageLimit: parseIntegerEnv("LINK_SCAN_MESSAGE_LIMIT", DEFAULT_MESSAGE_LIMIT, 1),
    scanDelayMs: parseIntegerEnv("LINK_SCAN_DELAY_MS", DEFAULT_SCAN_DELAY_MS, 0),
    maxConsecutiveErrors: parseIntegerEnv(
      "LINK_SCAN_MAX_CONSECUTIVE_ERRORS",
      DEFAULT_MAX_CONSECUTIVE_ERRORS,
      1,
    ),
    statePath: getStatePath(),
    discordOutPath: path.resolve(discordOutOverride || path.join("lists", DISCORD_FILE_NAME)),
    meetingOutPath: path.resolve(meetingOutOverride || path.join("lists", MEETING_FILE_NAME)),
  };
}

function toUnixSeconds(value) {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric > 1000000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function formatDateTime(unixSeconds) {
  if (!unixSeconds) {
    return "";
  }
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return (
    [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join("-") + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function getMessageText(message) {
  return String(message?.message ?? message?.text ?? "").trim();
}

function normalizeUsername(username) {
  const value = String(username ?? "").trim().replace(/^@/, "");
  return value ? `@${value}` : "";
}

function getUserIdentifier(user) {
  const username = normalizeUsername(user?.username);
  if (username) {
    return username;
  }

  if (user?.id && user?.accessHash !== undefined && user?.accessHash !== null) {
    return `${String(user.id)}:${String(user.accessHash)}`;
  }

  return "";
}

function getUserKeyFromEntity(user) {
  if (user?.id) {
    return `id:${String(user.id)}`;
  }
  const username = normalizeUsername(user?.username);
  return username ? username.toLowerCase() : "";
}

function buildDialogQueueEntry(dialog, folderName) {
  const entity = dialog.entity;
  const identifier = getUserIdentifier(entity);
  if (!identifier) {
    return null;
  }

  const username = normalizeUsername(entity.username);
  const topDate = toUnixSeconds(dialog.message?.date ?? dialog.date);

  return {
    userId: String(entity.id ?? ""),
    accessHash:
      entity.accessHash !== undefined && entity.accessHash !== null ? String(entity.accessHash) : "",
    username,
    identifier,
    title: String(dialog.title || entity.firstName || entity.lastName || identifier || "").trim(),
    folder: folderName,
    topDate,
  };
}

function isEligibleUserDialog(dialog) {
  if (!dialog?.isUser) {
    return false;
  }

  const entity = dialog.entity;
  if (!entity || entity.className !== "User") {
    return false;
  }
  if (entity.bot || entity.self || entity.deleted) {
    return false;
  }

  return true;
}

function buildInputPeer(entry) {
  if (entry.userId && entry.accessHash) {
    return new Api.InputPeerUser({
      userId: BigInt(entry.userId),
      accessHash: BigInt(entry.accessHash),
    });
  }
  if (entry.username) {
    return entry.username;
  }
  return entry.identifier;
}

async function loadState(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.dialogs)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const nextState = {
    ...state,
    nextIndex: Math.max(0, Math.min(Number(state.nextIndex) || 0, state.dialogs.length)),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

async function removeStateIfNeeded(filePath, reset) {
  if (!reset) {
    return false;
  }

  try {
    await fs.rm(filePath, { force: true });
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return false;
  }
}

async function loadLineSet(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

async function saveLineSet(filePath, values) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
  await fs.writeFile(filePath, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}

async function saveOutputLists(config, outputSets) {
  await Promise.all([
    saveLineSet(config.discordOutPath, outputSets.discord),
    saveLineSet(config.meetingOutPath, outputSets.meeting),
  ]);
}

function hasDiscord(text) {
  return String(text ?? "").toLowerCase().includes("discord.gg");
}

function hasMeetingLink(text) {
  const normalized = String(text ?? "").toLowerCase();
  return normalized.includes("zoom") || normalized.includes("telemost");
}

function classifyMessages(messages, minUnixTime) {
  let hasDiscordMatch = false;
  let hasMeetingMatch = false;
  let outgoingChecked = 0;

  for (const message of messages) {
    if (!message?.out) {
      continue;
    }

    const messageDate = toUnixSeconds(message.date);
    if (messageDate && messageDate < minUnixTime) {
      continue;
    }

    const text = getMessageText(message);
    if (!text) {
      continue;
    }

    outgoingChecked += 1;
    if (hasDiscord(text)) {
      hasDiscordMatch = true;
      break;
    }
    if (hasMeetingLink(text)) {
      hasMeetingMatch = true;
    }
  }

  if (hasDiscordMatch) {
    return { type: "discord", outgoingChecked };
  }
  if (hasMeetingMatch) {
    return { type: "meeting", outgoingChecked };
  }
  return { type: "none", outgoingChecked };
}

function getFloodWaitSeconds(error) {
  const candidates = [
    error?.seconds,
    error?.value,
    error?.errorMessage,
    error?.message,
    String(error ?? ""),
  ];

  for (const candidate of candidates) {
    const directNumber = Number(candidate);
    if (Number.isFinite(directNumber) && directNumber > 0) {
      return Math.floor(directNumber);
    }

    const text = String(candidate ?? "");
    const floodMatch = text.match(/FLOOD_WAIT_?(\d+)/i);
    if (floodMatch) {
      return Number.parseInt(floodMatch[1], 10);
    }
    const waitMatch = text.match(/wait of (\d+) seconds/i);
    if (waitMatch) {
      return Number.parseInt(waitMatch[1], 10);
    }
  }

  return 0;
}

async function getMessagesWithRetry(client, peer, limit) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await client.getMessages(peer, { limit });
    } catch (error) {
      const waitSeconds = getFloodWaitSeconds(error);
      if (!waitSeconds || attempt > 0) {
        throw error;
      }

      console.log(`Telegram просит паузу ${waitSeconds} сек. Жду и пробую еще раз...`);
      await sleep((waitSeconds + 1) * 1000);
    }
  }

  return [];
}

async function collectDialogQueue(client, account, config) {
  const queue = [];
  const seen = new Set();
  const folders = [
    { archived: false, name: "main", label: "основные" },
    { archived: true, name: "archive", label: "архив" },
  ];

  for (const folder of folders) {
    let scanned = 0;
    let added = 0;
    console.log(`Собираю личные диалоги: ${folder.label}...`);

    for await (const dialog of client.iterDialogs({ archived: folder.archived })) {
      scanned += 1;

      const topDate = toUnixSeconds(dialog.message?.date ?? dialog.date);
      if (topDate && topDate < config.minDate.unixTime && !dialog.pinned) {
        console.log(
          `${folder.label}: дошли до ${formatDateTime(topDate)} UTC, дальше старше ${config.minDate.label}.`,
        );
        break;
      }

      if (!isEligibleUserDialog(dialog)) {
        continue;
      }

      const entry = buildDialogQueueEntry(dialog, folder.name);
      if (!entry) {
        continue;
      }

      const key = getUserKeyFromEntity(dialog.entity);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      queue.push(entry);
      added += 1;

      if (added % 200 === 0) {
        console.log(`${folder.label}: добавлено ${added} личных диалогов...`);
      }
    }

    console.log(`${folder.label}: просмотрено ${scanned}, добавлено ${added}.`);
  }

  return {
    version: STATE_VERSION,
    accountId: String(account.id ?? ""),
    accountLabel: account.username ? `@${account.username}` : String(account.id ?? ""),
    profile: getProfile(),
    minDate: config.minDate.label,
    minUnixTime: config.minDate.unixTime,
    messageLimit: config.messageLimit,
    nextIndex: 0,
    dialogs: queue,
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function shouldResetFromArgs() {
  return process.argv.slice(2).some((arg) => arg === "--reset");
}

function assertStateMatchesAccount(state, account) {
  if (!state?.accountId) {
    return;
  }

  const accountId = String(account.id ?? "");
  if (String(state.accountId) !== accountId) {
    throw new Error(
      `State принадлежит другому аккаунту (${state.accountLabel || state.accountId}). ` +
        "Запустите с --reset или укажите другой LINK_SCAN_STATE_FILE.",
    );
  }
}

async function prepareState(client, account, config, reset) {
  const removed = await removeStateIfNeeded(config.statePath, reset);
  if (removed) {
    console.log(`State сброшен: ${formatEnvPath(config.statePath)}`);
  }

  const existingState = await loadState(config.statePath);
  if (existingState) {
    assertStateMatchesAccount(existingState, account);
    const nextIndex = Math.max(
      0,
      Math.min(Number(existingState.nextIndex) || 0, existingState.dialogs.length),
    );
    existingState.nextIndex = nextIndex;
    console.log(
      `Продолжаю scan: ${nextIndex + 1}/${existingState.dialogs.length} ` +
        `(state: ${formatEnvPath(config.statePath)}).`,
    );
    return existingState;
  }

  const state = await collectDialogQueue(client, account, config);
  await saveState(config.statePath, state);
  console.log(`Очередь сохранена: ${formatEnvPath(config.statePath)}`);
  console.log(`В очереди личных диалогов: ${state.dialogs.length}`);
  return state;
}

async function scanDialog(client, entry, config) {
  const peer = buildInputPeer(entry);
  const messages = await getMessagesWithRetry(client, peer, config.messageLimit);
  return classifyMessages(messages ?? [], config.minDate.unixTime);
}

async function runLinkScanner() {
  const reset = shouldResetFromArgs();
  const config = getScannerConfig();
  const { apiId, apiHash, forceSms, authMethod } = validateEnv();
  const client = await startClient(apiId, apiHash, forceSms, authMethod);

  try {
    const me = await client.getMe();
    const accountLabel = me.username ? `@${me.username}` : String(me.id);
    console.log(`Вход выполнен как ${accountLabel}`);
    console.log(
      `Ищу исходящие ссылки: discord.gg -> ${DISCORD_FILE_NAME}; zoom/telemost -> ${MEETING_FILE_NAME}`,
    );
    console.log(`Ограничения: последние ${config.messageLimit} сообщений, не старше ${config.minDate.label}.`);

    const state = await prepareState(client, me, config, reset);
    const outputSets = {
      discord: await loadLineSet(config.discordOutPath),
      meeting: await loadLineSet(config.meetingOutPath),
    };

    outputSets.meeting = new Set(
      Array.from(outputSets.meeting).filter((identifier) => !outputSets.discord.has(identifier)),
    );
    await saveOutputLists(config, outputSets);

    if (state.nextIndex >= state.dialogs.length) {
      console.log("Очередь уже полностью обработана. Для полного нового прохода используйте --reset.");
      console.log(`Discord: ${outputSets.discord.size}; Zoom/Telemost: ${outputSets.meeting.size}.`);
      return;
    }

    let processedThisRun = 0;
    let errorsThisRun = 0;
    let consecutiveErrors = 0;

    for (let index = state.nextIndex; index < state.dialogs.length; index += 1) {
      const entry = state.dialogs[index];
      const label = entry.identifier || entry.title || `#${index + 1}`;
      let shouldAdvance = true;

      try {
        const result = await scanDialog(client, entry, config);
        consecutiveErrors = 0;

        if (result.type === "discord") {
          outputSets.discord.add(entry.identifier);
          outputSets.meeting.delete(entry.identifier);
          await saveOutputLists(config, outputSets);
          console.log(`[${index + 1}/${state.dialogs.length}] Discord: ${label}`);
        } else if (result.type === "meeting" && !outputSets.discord.has(entry.identifier)) {
          outputSets.meeting.add(entry.identifier);
          await saveOutputLists(config, outputSets);
          console.log(`[${index + 1}/${state.dialogs.length}] Zoom/Telemost: ${label}`);
        }
      } catch (error) {
        errorsThisRun += 1;
        consecutiveErrors += 1;
        console.error(`[${index + 1}/${state.dialogs.length}] Ошибка для ${label}: ${getErrorMessage(error)}`);

        if (consecutiveErrors >= config.maxConsecutiveErrors) {
          shouldAdvance = false;
          state.nextIndex = index;
          state.completed = false;
          await saveState(config.statePath, state);
          throw new Error(
            `Остановлено после ${consecutiveErrors} ошибок подряд. ` +
              `Следующий запуск продолжит с ${index + 1}/${state.dialogs.length}.`,
          );
        }
      }

      if (shouldAdvance) {
        state.nextIndex = index + 1;
        state.completed = state.nextIndex >= state.dialogs.length;
        await saveState(config.statePath, state);
      }

      processedThisRun += 1;
      if (processedThisRun % 25 === 0 || state.completed) {
        console.log(
          `Проверено за запуск: ${processedThisRun}. ` +
            `Прогресс: ${state.nextIndex}/${state.dialogs.length}. ` +
            `Discord: ${outputSets.discord.size}; Zoom/Telemost: ${outputSets.meeting.size}; ` +
            `ошибок: ${errorsThisRun}.`,
        );
      }

      if (!state.completed && config.scanDelayMs > 0) {
        await sleep(config.scanDelayMs);
      }
    }

    console.log("Сканирование завершено.");
    console.log(`Discord список: ${formatEnvPath(config.discordOutPath)} (${outputSets.discord.size})`);
    console.log(`Zoom/Telemost список: ${formatEnvPath(config.meetingOutPath)} (${outputSets.meeting.size})`);
  } finally {
    await client.disconnect();
  }
}

runLinkScanner().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
