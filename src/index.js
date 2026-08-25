import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import input from "input";
import qrcodeTerminal from "qrcode-terminal";
import { Api, Logger, TelegramClient } from "telegram";
import { Raw } from "telegram/events/Raw.js";
import {
  ConnectionTCPAbridged,
  ConnectionTCPFull,
  ConnectionTCPObfuscated,
  UpdateConnectionState,
} from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";

import {
  FLOOD_GUARD,
  LOG_MODE,
  MESSAGE_CONFIG,
  PATHS,
  RATE_LIMITS,
  STICKER_CONFIG,
  ARCHIVE_CONFIG,
  PROFILE,
  STORAGE_MODE,
} from "./config.js";
import { loadListUsers, loadMessageFiles, loadUsersFromFile } from "./io.js";
import { loadProgressState, saveProgressState } from "./progress.js";
import { appendReportRow } from "./report.js";
import { loadProcessedUsers, saveProcessedUsers } from "./storage.js";
import { normalizeUsername, sleep, usernameKey } from "./utils.js";

// GramJS still needs non-empty app credentials for every auth method.
const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627";
const TODAY_KEY = new Date().toISOString().slice(0, 10);
const CONNECTION_TYPES = {
  full: ConnectionTCPFull,
  abridged: ConnectionTCPAbridged,
  obfuscated: ConnectionTCPObfuscated,
};

function nowStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
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

function buildOutboundMessages(fileMessages) {
  const messagePool = [];

  if (MESSAGE_CONFIG.SEND_INTRO_TEXT && MESSAGE_CONFIG.INTRO_TEXT.trim()) {
    messagePool.push(MESSAGE_CONFIG.INTRO_TEXT.trim());
  }

  if (MESSAGE_CONFIG.SEND_TEXT_FILES) {
    for (const message of fileMessages) {
      messagePool.push(message.text);
    }
  }

  if (!MESSAGE_CONFIG.RANDOMIZE_SINGLE_TEXT) {
    return messagePool;
  }

  if (messagePool.length === 0) {
    return [];
  }

  const randomIndex = Math.floor(Math.random() * messagePool.length);
  return [messagePool[randomIndex]];
}

function selectConfiguredTextFiles(fileMessages) {
  const rawNames = Array.isArray(MESSAGE_CONFIG.TEXT_FILE_NAMES)
    ? MESSAGE_CONFIG.TEXT_FILE_NAMES
    : [];
  const selectedNames = rawNames.map((name) => String(name).trim()).filter(Boolean);

  if (selectedNames.length === 0) {
    return fileMessages;
  }

  const selectedNameSet = new Set(selectedNames);
  return fileMessages.filter((fileMessage) => selectedNameSet.has(fileMessage.fileName));
}

function normalizeConfiguredPath(rawPath) {
  return String(rawPath ?? "").trim().replace(/[\\/]+/g, path.sep);
}

function resolveConfiguredPath(rawPath, baseDir) {
  const configuredPath = normalizeConfiguredPath(rawPath);
  if (!configuredPath) {
    return "";
  }

  if (path.isAbsolute(configuredPath)) {
    return path.normalize(configuredPath);
  }

  const firstPathPart = configuredPath
    .split(path.sep)
    .find((part) => part && part !== ".");
  if (firstPathPart?.toLowerCase() === path.basename(baseDir).toLowerCase()) {
    return path.resolve(configuredPath);
  }

  return path.resolve(baseDir, configuredPath);
}

async function isExistingFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function loadThirdMessagePayload() {
  const textFilePath = resolveConfiguredPath(
    MESSAGE_CONFIG.THIRD_MESSAGE_TEXT_FILE,
    PATHS.MESSAGES_DIR,
  );
  const photoPath = resolveConfiguredPath(
    MESSAGE_CONFIG.THIRD_MESSAGE_PHOTO_PATH,
    PATHS.IMAGES_DIR,
  );

  if (!textFilePath || !photoPath) {
    return null;
  }

  let text = "";
  try {
    text = (await fs.readFile(textFilePath, "utf8")).trim();
  } catch (error) {
    console.log(
      `Третье сообщение не отправляется: файл текста не найден (${formatEnvPath(textFilePath)}).`,
    );
    return null;
  }

  if (!text) {
    console.log(
      `Третье сообщение не отправляется: файл текста пустой (${formatEnvPath(textFilePath)}).`,
    );
    return null;
  }

  if (!(await isExistingFile(photoPath))) {
    console.log(
      `Третье сообщение не отправляется: фото не найдено (${formatEnvPath(photoPath)}).`,
    );
    return null;
  }

  return { text, photoPath };
}

function findResumeIndexFromProcessed(usersFromLists, processedUsers) {
  for (let index = 0; index < usersFromLists.length; index += 1) {
    const recipient = parseRecipientEntry(usersFromLists[index].raw);
    if (!recipient) {
      continue;
    }

    if (!processedUsers.has(recipient.key)) {
      return index;
    }
  }

  return usersFromLists.length;
}

function parseRecipientEntry(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return null;
  }

  const idHashMatch = value.match(/^(\d+):(-?\d+)$/);
  if (idHashMatch) {
    return {
      peer: new Api.InputPeerUser({
        userId: BigInt(idHashMatch[1]),
        accessHash: BigInt(idHashMatch[2]),
      }),
      label: `id:${idHashMatch[1]}`,
      key: value.toLowerCase(),
    };
  }

  const username = normalizeUsername(value);
  if (!username) {
    return null;
  }

  return {
    peer: username,
    label: username,
    key: usernameKey(username),
  };
}

function getErrorMessage(error) {
  if (typeof error?.errorMessage === "string" && error.errorMessage.trim()) {
    return error.errorMessage.trim();
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function isPeerFloodError(message) {
  return String(message).toUpperCase().includes("PEER_FLOOD");
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

function parseConfiguredBigInt(value) {
  const normalized = String(value ?? "").trim();
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function sameTelegramId(left, right) {
  return String(left ?? "") === String(right ?? "");
}

function parseTelegramLogLevel() {
  const logLevel = String(process.env.TELEGRAM_LOG_LEVEL ?? "error").trim().toLowerCase();
  return ["none", "error", "warn", "info", "debug"].includes(logLevel) ? logLevel : "error";
}

function formatConnectionState(state) {
  if (state === UpdateConnectionState.connected) {
    return "connected";
  }
  if (state === UpdateConnectionState.disconnected) {
    return "disconnected";
  }
  if (state === UpdateConnectionState.broken) {
    return "broken";
  }
  return `unknown(${state})`;
}

function getClientEndpoint(client) {
  const liveConnection = client?._sender?._connection;
  if (liveConnection?._ip && liveConnection?._port) {
    const transportName = String(liveConnection.constructor?.name ?? "Connection")
      .replace("Connection", "")
      .trim() || "Connection";
    return `${liveConnection._ip}:${liveConnection._port}/${transportName}`;
  }

  const sessionAddress = client?.session?.serverAddress || "unknown";
  const sessionPort = client?.session?.port || "unknown";
  return `${sessionAddress}:${sessionPort}/session`;
}

function createDiagnosticLogger(enabled, filePath) {
  return async (message) => {
    if (!enabled) {
      return;
    }

    const line = `${nowStamp()} ${message}`;
    console.log(`[diag] ${message}`);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${line}\n`, "utf8");
    } catch (error) {
      console.error(`Не удалось записать диагностический лог: ${getErrorMessage(error)}`);
    }
  };
}

function buildConnectionOptions() {
  const transportNameRaw = String(process.env.TELEGRAM_TRANSPORT ?? "full")
    .trim()
    .toLowerCase();
  let transportName = CONNECTION_TYPES[transportNameRaw] ? transportNameRaw : "full";
  const useWss = parseBooleanEnv("TELEGRAM_USE_WSS", false);
  const debugConnection = parseBooleanEnv("DEBUG_CONNECTION", false);
  const probeMode = parseBooleanEnv("PROBE_MODE", false);
  const telegramLogLevel = parseTelegramLogLevel();
  const probeIdleMs = parseIntegerEnv("PROBE_IDLE_MS", 60000, 1000);
  const connectionRetries = parseIntegerEnv("TELEGRAM_CONNECTION_RETRIES", 5, 0);
  const retryDelay = parseIntegerEnv("TELEGRAM_RETRY_DELAY_MS", 1000, 0);
  const timeout = parseIntegerEnv("TELEGRAM_CONNECT_TIMEOUT_SEC", 10, 1);
  const reconnectRetriesRaw = process.env.TELEGRAM_RECONNECT_RETRIES;
  const reconnectRetries =
    reconnectRetriesRaw === undefined || reconnectRetriesRaw === null || String(reconnectRetriesRaw).trim() === ""
      ? undefined
      : parseIntegerEnv("TELEGRAM_RECONNECT_RETRIES", 5, 0);

  // SOCKS-параметры: можно одним SOCKS_PROXY=host:port, либо раздельно SOCKS_HOST/SOCKS_PORT.
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
  const proxyEnabled = Boolean(proxy);

  // Для tg-ws-proxy лучше сразу использовать обфусцированный транспорт, чтобы прокси мог распознать DC.
  if (proxyEnabled && transportName === "full") {
    transportName = "obfuscated";
  }

  return {
    connection: CONNECTION_TYPES[transportName],
    transportName,
    telegramLogLevel,
    useWss,
    debugConnection,
    probeMode,
    probeIdleMs,
    connectionRetries,
    retryDelay,
    timeout,
    reconnectRetries,
    proxy,
    proxyEnabled,
  };
}

async function registerConnectionDiagnostics(client, connectionOptions, diagnosticLog) {
  await diagnosticLog(
    "Диагностика соединения включена. " +
    `transport=${connectionOptions.transportName}, useWSS=${connectionOptions.useWss}, ` +
    `timeout=${connectionOptions.timeout}s, connectionRetries=${connectionOptions.connectionRetries}, ` +
    `reconnectRetries=${connectionOptions.reconnectRetries ?? "default"}, retryDelay=${connectionOptions.retryDelay}ms` +
    (connectionOptions.proxyEnabled
      ? `, proxy=${connectionOptions.proxy.ip}:${connectionOptions.proxy.port} (socks${connectionOptions.proxy.socksType})`
      : ", proxy=off") +
    ".",
  );

  client.onError = async (error) => {
    await diagnosticLog(`Ошибка клиента: ${getErrorMessage(error)}`);
  };

  client.addEventHandler(
    async (update) => {
      await diagnosticLog(
        "Состояние соединения: " +
        `${formatConnectionState(update.state)}; connected=${Boolean(client.connected)}; ` +
        `dc=${client.session.dcId}; endpoint=${getClientEndpoint(client)}.`,
      );
    },
    new Raw({ types: [UpdateConnectionState] }),
  );
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

async function loadDailyStats(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveDailyStats(filePath, stats) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
}

async function saveLoginInfo(filePath, me) {
  const resolvedPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(
    resolvedPath,
    `${JSON.stringify(
      {
        id: String(me?.id ?? ""),
        username: String(me?.username ?? ""),
        firstName: String(me?.firstName ?? ""),
        lastName: String(me?.lastName ?? ""),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  if (typeof message.message === "string" && message.message.trim()) {
    return message.message.trim();
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  return "";
}

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С @SpamBot ==========

/**
 * Получает текущий статус аккаунта от @SpamBot.
 * Возвращает объект { hasRestriction: boolean | null, statusText: string }
 */
async function getSpamBotStatus(client) {
  const commandUnixTime = Math.floor(Date.now() / 1000) - 3;
  await client.sendMessage(FLOOD_GUARD.SPAM_BOT_USERNAME, { message: "/start" });

  for (let attempt = 0; attempt < FLOOD_GUARD.POLL_ATTEMPTS; attempt += 1) {
    if (attempt === 0) {
      await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);
    } else {
      await sleep(FLOOD_GUARD.POLL_INTERVAL_MS);
    }

    const messages = await client.getMessages(FLOOD_GUARD.SPAM_BOT_USERNAME, { limit: 10 });
    if (!messages || messages.length === 0) {
      continue;
    }

    const freshIncoming = messages.find(
      (message) =>
        !message.out &&
        Number.isFinite(Number(message.date)) &&
        Number(message.date) >= commandUnixTime &&
        extractMessageText(message),
    );
    const fallbackIncoming = messages.find(
      (message) => !message.out && extractMessageText(message),
    );
    const bestMessage = freshIncoming || fallbackIncoming;
    if (!bestMessage) {
      continue;
    }

    const statusText = extractMessageText(bestMessage);
    const statusTextLower = statusText.toLowerCase();
    const hasRestriction =
      !statusTextLower.includes("good news") && !statusTextLower.includes("no limits");
    return { hasRestriction, statusText };
  }

  return { hasRestriction: null, statusText: "Нет ответа от @SpamBot" };
}

/**
 * Ищет актуальное входящее сообщение от @SpamBot с кнопками.
 */
async function getSpamBotMessageWithButtons(client, minUnixTime = 0) {
  for (let attempt = 0; attempt < FLOOD_GUARD.POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(FLOOD_GUARD.POLL_INTERVAL_MS);
    }

    const messages = await client.getMessages(FLOOD_GUARD.SPAM_BOT_USERNAME, { limit: 10 });
    if (!messages || messages.length === 0) {
      continue;
    }

    const freshIncoming = messages.find(
      (message) =>
        !message.out &&
        message.replyMarkup &&
        Array.isArray(message.replyMarkup.rows) &&
        Number.isFinite(Number(message.date)) &&
        Number(message.date) >= minUnixTime,
    );
    const fallbackIncoming = messages.find(
      (message) =>
        !message.out &&
        message.replyMarkup &&
        Array.isArray(message.replyMarkup.rows),
    );

    const bestMessage = freshIncoming || fallbackIncoming;
    if (bestMessage) {
      return bestMessage;
    }
  }

  return null;
}

/**
 * Нажимает кнопку по тексту в указанном сообщении.
 * Для callback-кнопок использует GetBotCallbackAnswer,
 * а для обычных reply-кнопок отправляет текст кнопки сообщением.
 */
async function clickButtonByText(client, chat, msg, buttonText) {
  if (!msg?.replyMarkup?.rows) return false;

  const peer = await client.getInputEntity(chat);
  const expectedText = buttonText.toLowerCase();
  const altMap = {
    "why was i reported": ["why was i reported", "как снять ограничения", "почему меня заблокировали"],
    "i understand, thanks": ["i understand, thanks", "это ошибка", "я понял спасибо"],
  };
  const expectedList = [expectedText, ...(altMap[expectedText] ?? [])];
  const availableButtons = [];

  for (const row of msg.replyMarkup.rows) {
    for (const button of row.buttons) {
      const label = typeof button.text === "string" ? button.text.trim() : "";
      if (!label) {
        continue;
      }

      availableButtons.push(label);
      const labelLower = label.toLowerCase();
      const matched = expectedList.some((needle) => labelLower.includes(needle));
      if (!matched) continue;

      const hasCallbackData =
        button.data !== undefined &&
        button.data !== null &&
        (!("length" in button.data) || button.data.length > 0);

      if (hasCallbackData) {
        try {
          await client.invoke(new Api.messages.GetBotCallbackAnswer({
            peer: peer,
            msgId: msg.id,
            data: button.data,
          }));
          return true;
        } catch (error) {
          const message = getErrorMessage(error);
          if (!String(message).toUpperCase().includes("DATA_INVALID")) {
            throw error;
          }
          console.log(
            `Некорректный callback для кнопки "${label}", пробую отправить текст кнопки.`,
          );
        }
      }

      await client.sendMessage(chat, { message: label });
      return true;
    }
  }

  if (availableButtons.length > 0) {
    console.log(
      `Кнопка "${buttonText}" не найдена. Доступные кнопки: ${availableButtons.join(" | ")}`,
    );
  }

  // Fallback: нажимаем первую кнопку, если есть
  if (msg.replyMarkup?.rows?.[0]?.buttons?.[0]) {
    const btn = msg.replyMarkup.rows[0].buttons[0];
    const label = typeof btn.text === "string" ? btn.text.trim() : "";
    console.log(`Пробую fallback: первая кнопка "${label || "<no text>"}".`);
    const hasCallbackData =
      btn.data !== undefined &&
      btn.data !== null &&
      (!("length" in btn.data) || btn.data.length > 0);
    if (hasCallbackData) {
      await client.invoke(new Api.messages.GetBotCallbackAnswer({
        peer: peer,
        msgId: msg.id,
        data: btn.data,
      }));
      return true;
    }
    if (label) {
      await client.sendMessage(chat, { message: label });
      return true;
    }
  }

  return false;
}

/**
 * Выполняет полный диалог разблокировки с @SpamBot.
 * Возвращает true, если после диалога ограничения сняты, иначе false.
 */
async function attemptUnblock(client) {
  console.log('Пробую снять ограничение через диалог с @SpamBot...');

  // 1. Отправляем /start
  const startUnixTime = Math.floor(Date.now() / 1000) - 2;
  await client.sendMessage(FLOOD_GUARD.SPAM_BOT_USERNAME, { message: "/start" });
  await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);

  // Получаем актуальное входящее сообщение с кнопками
  let msg = await getSpamBotMessageWithButtons(client, startUnixTime);
  if (!msg) {
    console.log('Нет ответа с кнопками от @SpamBot');
    return false;
  }

  // Проверяем, может уже снято
  const initialText = extractMessageText(msg);
  const hadRestriction =
    !initialText.toLowerCase().includes('good news') &&
    !initialText.toLowerCase().includes('no limits');

  if (!hadRestriction) {
    console.log('На аккаунте уже нет ограничений.');
    return { resolved: true, hadRestriction, statusText: initialText };
  }

  // 2. Нажимаем "why was I reported?"
  console.log('Нажимаю "why was I reported?"...');
  let clicked = await clickButtonByText(client, FLOOD_GUARD.SPAM_BOT_USERNAME, msg, 'why was I reported');
  if (!clicked) {
    console.log('Кнопка "why was I reported?" не найдена.');
    return false;
  }
  await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);

  // Получаем следующее актуальное сообщение с кнопками
  const secondStepUnixTime = Math.floor(Date.now() / 1000) - 2;
  msg = await getSpamBotMessageWithButtons(client, secondStepUnixTime);
  if (!msg) {
    console.log('Нет ответа после первого клика');
    return false;
  }

  // 3. Нажимаем "i understand, thanks"
  console.log('Нажимаю "i understand, thanks"...');
  clicked = await clickButtonByText(client, FLOOD_GUARD.SPAM_BOT_USERNAME, msg, 'i understand, thanks');
  if (!clicked) {
    console.log('Кнопка "i understand, thanks" не найдена.');
    return false;
  }
  await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);

  // 4. Финальная проверка
  console.log('Проверяю финальный статус...');
  const finalStatus = await getSpamBotStatus(client);
  console.log(`Финальный статус: ${finalStatus.statusText}`);

  return { resolved: finalStatus.hasRestriction === false, hadRestriction, statusText: finalStatus.statusText };
}

// ========== КОНЕЦ ФУНКЦИЙ ДЛЯ @SpamBot ==========

async function appendLog(user, status) {
  await appendReportRow(PATHS.REPORT_CSV, {
    timestamp: nowStamp(),
    user,
    mode: LOG_MODE,
    status,
  });
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
  const connectionOptions = buildConnectionOptions();

  return { apiId, apiHash, forceSms, authMethod, connectionOptions };
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
    password: async () => input.password("Пароль 2FA (если включен): "),
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
        input.password(
          hint ? `Пароль 2FA (подсказка: ${hint}): ` : "Пароль 2FA (если включен): ",
        ),
      onError: async (error) => {
        console.error("Ошибка QR-авторизации Telegram:", error);
        return false;
      },
    },
  );
}

async function startClient(apiId, apiHash, forceSms, authMethod, connectionOptions) {
  const sessionString = process.env.SESSION_STRING ?? "";
  const stringSession = new StringSession(sessionString);
  const envPath = getActiveEnvPath();
  const envLabel = formatEnvPath(envPath);
  const diagnosticLog = createDiagnosticLogger(
    connectionOptions.debugConnection || connectionOptions.probeMode,
    PATHS.CONNECTION_DEBUG_LOG,
  );

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connection: connectionOptions.connection,
    baseLogger: new Logger(connectionOptions.telegramLogLevel),
    useWSS: connectionOptions.useWss,
    timeout: connectionOptions.timeout,
    retryDelay: connectionOptions.retryDelay,
    connectionRetries: connectionOptions.connectionRetries,
    ...(connectionOptions.reconnectRetries !== undefined
      ? { reconnectRetries: connectionOptions.reconnectRetries }
      : {}),
    ...(connectionOptions.proxyEnabled ? { proxy: connectionOptions.proxy } : {}),
  });

  await registerConnectionDiagnostics(client, connectionOptions, diagnosticLog);
  await diagnosticLog(
    `Инициализация клиента. dc=${client.session.dcId || "unknown"}, endpoint=${getClientEndpoint(client)}.`,
  );

  await client.connect();
  await diagnosticLog(
    `Подключение установлено. dc=${client.session.dcId}, endpoint=${getClientEndpoint(client)}.`,
  );
  const isAuthorized = await client.checkAuthorization();
  await diagnosticLog(`Статус авторизации: ${isAuthorized ? "authorized" : "not authorized"}.`);

  if (!isAuthorized) {
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
  const shouldSyncSession = !sessionString || savedSessionString !== sessionString;
  if (shouldSyncSession) {
    await upsertEnvValue(envPath, "SESSION_STRING", savedSessionString);
    console.log(`SESSION_STRING сохранен в ${envLabel}`);
  }

  return { client, diagnosticLog };
}

async function loadStickerDocument(client, envPath) {
  const configuredSetId = parseConfiguredBigInt(STICKER_CONFIG.SET_ID);
  const configuredSetAccessHash = parseConfiguredBigInt(STICKER_CONFIG.SET_ACCESS_HASH);
  const configuredDocId = parseConfiguredBigInt(STICKER_CONFIG.DOC_ID);

  if (configuredSetId !== null && configuredSetAccessHash !== null && configuredDocId !== null) {
    const stickerSet = await client.invoke(
      new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetID({
          id: configuredSetId,
          accessHash: configuredSetAccessHash,
        }),
        hash: 0,
      }),
    );

    const stickerDocument = stickerSet?.documents?.find((doc) =>
      sameTelegramId(doc.id, configuredDocId),
    );
    if (stickerDocument) {
      return stickerDocument;
    }

    console.log("Сохраненный стикер не найден в наборе, пробую старую настройку или выбор из Избранного.");
  }

  const stickerSets = await client.invoke(new Api.messages.GetAllStickers({ hash: 0 }));
  if (!stickerSets?.sets?.length) {
    return null;
  }

  const parsedSetIndex = Number.parseInt(String(STICKER_CONFIG.SET_INDEX).trim(), 10);
  const parsedDocIndex = Number.parseInt(String(STICKER_CONFIG.STICKER_INDEX).trim(), 10);
  const setIndex = Number.isFinite(parsedSetIndex) ? parsedSetIndex : null;
  const docIndex = Number.isFinite(parsedDocIndex) ? parsedDocIndex : null;

  if (setIndex === null || docIndex === null) {
    if (STICKER_CONFIG.INTERACTIVE_PROMPT) {
      console.log(
        "Стикер не настроен. Отправьте любой стикер в \"Избранное\" (Saved Messages). " +
        `Ожидаю до ${Math.floor(STICKER_CONFIG.WAIT_TIMEOUT_MS / 1000)} сек...`,
      );
      const deadline = Date.now() + STICKER_CONFIG.WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const messages = await client.getMessages("me", { limit: 10 });
        const stickerMsg =
          messages.find((m) => Boolean(m?.sticker)) ||
          messages.find((m) =>
            Boolean(
              m?.media?.document?.attributes?.some(
                (a) => a.className === "DocumentAttributeSticker",
              ),
            ),
          );
        if (stickerMsg?.sticker) {
          const doc = stickerMsg.sticker;
          await persistStickerSelection(client, doc, stickerSets, envPath);
          return doc;
        }
        if (stickerMsg?.media?.document) {
          const doc = stickerMsg.media.document;
          await persistStickerSelection(client, doc, stickerSets, envPath);
          return doc;
        }
        await sleep(STICKER_CONFIG.POLL_INTERVAL_MS);
      }
      console.log("Стикер не найден, продолжаю без стикера.");
      return null;
    }
    // No indices and no interactive prompt
    return null;
  }

  const targetSet = stickerSets.sets[setIndex] ?? stickerSets.sets[0];
  const stickerSet = await client.invoke(
    new Api.messages.GetStickerSet({
      stickerset: new Api.InputStickerSetID({
        id: targetSet.id,
        accessHash: targetSet.accessHash,
      }),
      hash: 0,
    }),
  );

  if (!stickerSet?.documents?.length) {
    return null;
  }

  const stickerDocument = stickerSet.documents[docIndex] ?? stickerSet.documents[0];
  await persistStickerSelection(client, stickerDocument, stickerSets, envPath);
  return stickerDocument;
}

async function archiveStaleDialogs(client) {
  const now = Date.now();
  const maxDialogs = Math.max(1, ARCHIVE_CONFIG.MAX_DIALOGS_PER_RUN || 30);
  const candidates = [];
  const skip = {
    notUser: 0,
    archived: 0,
    age: 0,
    outgoing: 0,
    length: 0,
    incoming: 0,
    noreply: 0,
    inputPeer: 0,
    empty: 0,
  };

  if (ARCHIVE_CONFIG.DEBUG) {
    console.log(
      `ARCHIVE DEBUG cfg: NO_REPLY=${ARCHIVE_CONFIG.NO_REPLY_HOURS}h, MAX_AGE=${ARCHIVE_CONFIG.DIALOG_MAX_AGE_HOURS}h, ` +
        `MIN_OUT=${ARCHIVE_CONFIG.MIN_OUTGOING}, MIN_LEN=${ARCHIVE_CONFIG.MIN_LONG_TEXT}, ` +
        `SCAN=${ARCHIVE_CONFIG.MESSAGES_SCAN_LIMIT}, MAX=${maxDialogs}, BATCH=${ARCHIVE_CONFIG.DIALOG_FETCH_BATCH}`,
    );
  }

  let scanned = 0;
  for await (const dialog of client.iterDialogs({
    limit: (ARCHIVE_CONFIG.DIALOG_FETCH_BATCH || 100) * 20,
  })) {
    if (candidates.length >= maxDialogs) break;
    scanned += 1;

    if (!dialog.isUser) {
      skip.notUser += 1;
      continue;
    }
    if (dialog.archived) {
      skip.archived += 1;
      continue;
    }

    const msgs = await client.getMessages(dialog.entity, {
      limit: ARCHIVE_CONFIG.MESSAGES_SCAN_LIMIT || 20,
    });
    if (!msgs || msgs.length === 0) {
      skip.empty += 1;
      continue;
    }

    const lastMessageTs = Number(msgs[0]?.date) * 1000 || now;
    const dialogAgeHours = (now - lastMessageTs) / (1000 * 60 * 60);
    if (dialogAgeHours > ARCHIVE_CONFIG.DIALOG_MAX_AGE_HOURS) {
      skip.age += 1;
      continue;
    }

    const outgoing = msgs.filter((m) => m.out);
    if (outgoing.length < ARCHIVE_CONFIG.MIN_OUTGOING) {
      skip.outgoing += 1;
      continue;
    }
    const longestOut = Math.max(...outgoing.map((m) => (m.message || m.text || "").length));
    if (longestOut < ARCHIVE_CONFIG.MIN_LONG_TEXT) {
      skip.length += 1;
      continue;
    }

    const firstOutIdx = msgs.findIndex((m) => m.out);
    const hasIncomingAfterFirstOut = msgs.slice(firstOutIdx + 1).some((m) => !m.out);
    if (hasIncomingAfterFirstOut) {
      skip.incoming += 1;
      continue;
    }

    const lastOut = outgoing.reduce(
      (acc, m) => Math.min(acc, Number(m.date) * 1000 || now),
      now,
    );
    const noReplyHours = (now - lastOut) / (1000 * 60 * 60);
    if (noReplyHours < ARCHIVE_CONFIG.NO_REPLY_HOURS) {
      skip.noreply += 1;
      continue;
    }

    try {
      const inputPeer = await client.getInputEntity(dialog.entity);
      candidates.push(inputPeer);
    } catch {
      skip.inputPeer += 1;
      continue;
    }
  }

  if (candidates.length === 0) {
    if (ARCHIVE_CONFIG.DEBUG) {
      console.log(
        `Архивация: 0 кандидатов. Просмотрено ${scanned} диалогов. ` +
          `skip: notUser=${skip.notUser}, archived=${skip.archived}, age=${skip.age}, ` +
          `out=${skip.outgoing}, len=${skip.length}, incoming=${skip.incoming}, ` +
          `noreply=${skip.noreply}, empty=${skip.empty}, inputPeer=${skip.inputPeer}`,
      );
    }
    console.log("Архивация: подходящих диалогов не найдено.");
    return;
  }

  console.log(`Архивация: перенос в архив ${candidates.length} диалогов...`);
  await client.invoke(
    new Api.folders.EditPeerFolders({
      folderPeers: candidates.map(
        (peer) =>
          new Api.InputFolderPeer({
            peer,
            folderId: 1,
          }),
      ),
    }),
  );
  console.log("Архивация завершена.");
}

async function persistStickerSelection(client, document, stickerSets, envPath) {
  if (!document?.attributes) return;
  const stickerAttr = document.attributes.find(
    (a) => a.className === "DocumentAttributeSticker" && a.stickerset?.id && a.stickerset?.accessHash,
  );
  if (!stickerAttr) return;

  const setId = stickerAttr.stickerset.id;
  const setHash = stickerAttr.stickerset.accessHash;

  const setIndex = stickerSets.sets.findIndex(
    (s) => sameTelegramId(s.id, setId) && sameTelegramId(s.accessHash, setHash),
  );

  let docIndex = -1;
  try {
    const stickerSet = await client.invoke(
      new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetID({
          id: setId,
          accessHash: setHash,
        }),
        hash: 0,
      }),
    );
    if (stickerSet?.documents?.length) {
      const foundIndex = stickerSet.documents.findIndex((d) => sameTelegramId(d.id, document.id));
      if (foundIndex >= 0) {
        docIndex = foundIndex;
      }
    }
  } catch (error) {
    // ignore; stable document id is enough for future loads.
  }

  if (setIndex >= 0) {
    await upsertEnvValue(envPath, "STICKER_SET_INDEX", setIndex);
  }
  if (docIndex >= 0) {
    await upsertEnvValue(envPath, "STICKER_DOC_INDEX", docIndex);
  }
  await upsertEnvValue(envPath, "STICKER_SET_ID", setId);
  await upsertEnvValue(envPath, "STICKER_SET_ACCESS_HASH", setHash);
  await upsertEnvValue(envPath, "STICKER_DOC_ID", document.id);
  console.log(
    `Стикер выбран и сохранен в ${formatEnvPath(envPath)} (STICKER_DOC_ID=${document.id}).`,
  );
}

async function sendMessagesToUser(
  client,
  user,
  outboundMessages,
  stickerDocument,
  thirdMessagePayload,
) {
  if (stickerDocument) {
    await client.sendFile(user, { file: stickerDocument });
    if (outboundMessages.length > 0) {
      await sleep(RATE_LIMITS.INTER_MESSAGE_DELAY_MS);
    }
  }

  for (let index = 0; index < outboundMessages.length; index += 1) {
    await client.sendMessage(user, { message: outboundMessages[index] });

    if (index === 0 && thirdMessagePayload) {
      await sleep(RATE_LIMITS.INTER_MESSAGE_DELAY_MS);
      await client.sendFile(user, {
        file: thirdMessagePayload.photoPath,
        caption: thirdMessagePayload.text,
      });
    }

    const hasNext = index < outboundMessages.length - 1;
    if (hasNext) {
      await sleep(RATE_LIMITS.INTER_MESSAGE_DELAY_MS);
    }
  }
}

async function main() {
  const { apiId, apiHash, forceSms, authMethod, connectionOptions } = validateEnv();

  const archiveOnly = String(process.env.ARCHIVE_ONLY ?? "false").toLowerCase() === "true";

  if (connectionOptions.probeMode) {
    const { client, diagnosticLog } = await startClient(
      apiId,
      apiHash,
      forceSms,
      authMethod,
      connectionOptions,
    );

    try {
      const me = await client.getMe();
      console.log(`Вход выполнен как ${me.username || me.firstName || me.id}`);
      const loginInfoFile = String(process.env.LOGIN_INFO_FILE ?? "").trim();
      if (loginInfoFile) {
        await saveLoginInfo(loginInfoFile, me);
      }
      console.log(
        `Режим проверки соединения включен. Отправки не будет. Наблюдение ${Math.round(connectionOptions.probeIdleMs / 1000)} сек.`,
      );
      console.log(`Диагностический лог: ${PATHS.CONNECTION_DEBUG_LOG}`);
      await diagnosticLog("Старт probe-режима без отправки сообщений.");
      await sleep(connectionOptions.probeIdleMs);
      await diagnosticLog("Probe-режим завершен без отправки сообщений.");
      console.log("Проверка соединения завершена.");
    } finally {
      await client.disconnect();
    }
    return;
  }

  const dailyStats = await loadDailyStats(PATHS.DAILY_STATS_JSON);
  if (!dailyStats[TODAY_KEY]) {
    dailyStats[TODAY_KEY] = { sent: 0, blocks: [] };
  }
  let sessionSent = 0;

  // Override message files via env
  const messageFilesOverride = String(process.env.MESSAGE_FILES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (messageFilesOverride.length > 0) {
    MESSAGE_CONFIG.TEXT_FILE_NAMES = messageFilesOverride;
  }

  const loadedFileMessages = await loadMessageFiles(PATHS.MESSAGES_DIR);
  const fileMessages = selectConfiguredTextFiles(loadedFileMessages);
  const outboundProbe = buildOutboundMessages(fileMessages);
  const thirdMessagePayload = await loadThirdMessagePayload();

  if (outboundProbe.length === 0) {
    throw new Error(
      "Не настроены исходящие сообщения. Проверьте MESSAGE_CONFIG и messages/*.txt",
    );
  }

  const listEnv = String(process.env.LIST_FILE ?? "").trim();
  let selectedList = listEnv;

  if (!selectedList) {
    const listEntries = await loadListUsers(PATHS.LISTS_DIR);
    const listFileSet = Array.from(new Set(listEntries.map((u) => u.fileName)));
    if (listFileSet.length === 0) {
      throw new Error("В папке lists нет файлов со списками.");
    }
    selectedList = listFileSet[0];
    if (listFileSet.length > 1) {
      console.log("Выберите файл списка:");
      listFileSet.forEach((name, idx) => console.log(`[${idx + 1}] ${name}`));
      const choiceRaw = await input.text(`Номер (1-${listFileSet.length}, по умолчанию 1): `);
      const choice = Number.parseInt(choiceRaw.trim(), 10);
      if (Number.isFinite(choice) && choice >= 1 && choice <= listFileSet.length) {
        selectedList = listFileSet[choice - 1];
      }
    }
  }
  console.log(`Использую список: ${selectedList}`);

  const usersFromLists = await loadUsersFromFile(PATHS.LISTS_DIR, selectedList);
  let { nextIndex: startIndex } = await loadProgressState(
    PATHS.PROGRESS_STATE_JSON,
    usersFromLists.length,
  );
  const processedUsers = await loadProcessedUsers(PATHS.PROCESSED_USERS_JSON);
  const usersSeenThisRun = new Set();

  if (startIndex === 0 && processedUsers.size > 0) {
    const derivedStartIndex = findResumeIndexFromProcessed(usersFromLists, processedUsers);
    if (derivedStartIndex > 0) {
      startIndex = derivedStartIndex;
      await saveProgressState(PATHS.PROGRESS_STATE_JSON, startIndex, usersFromLists.length);
      console.log(`Точка продолжения инициализирована из обработанных пользователей: строка ${startIndex + 1}`);
    }
  }

  if (startIndex >= usersFromLists.length) {
    console.log(`Загружено пользователей: ${usersFromLists.length}`);
    console.log(`Уже обработано пользователей: ${processedUsers.size}`);
    console.log("В списках нет необработанных строк. Отправлять нечего.");
    return;
  }

  const { client } = await startClient(
    apiId,
    apiHash,
    forceSms,
    authMethod,
    connectionOptions,
  );

  if (archiveOnly) {
    await archiveStaleDialogs(client);
    await client.disconnect();
    return;
  }
  const me = await client.getMe();
  console.log(`Вход выполнен как ${me.username || me.firstName || me.id}`);
  console.log(`Загружено пользователей: ${usersFromLists.length}`);
  console.log(`Уже обработано пользователей: ${processedUsers.size}`);
  if (startIndex > 0) {
    console.log(`Продолжаем с строки: ${startIndex + 1}`);
  }

  let stickerDocument = null;
  if (STICKER_CONFIG.ENABLED) {
    try {
      const envPath = getActiveEnvPath();
      stickerDocument = await loadStickerDocument(client, envPath);
      if (stickerDocument) {
        console.log("Стикер загружен.");
      } else {
        console.log("Стикер в наборах аккаунта не найден, продолжаю без стикера.");
      }
    } catch (error) {
      const message = error?.message || String(error);
      console.log(`Не удалось загрузить стикер, продолжаю без него: ${message}`);
    }
  }

  let attemptCounter = 0;
  let shouldArchiveAfterStop = false;
  const peerFloodRetriesByUser = new Map();

  try {
    for (let rowIndex = startIndex; rowIndex < usersFromLists.length; rowIndex += 1) {
      const row = usersFromLists[rowIndex];
      const nextIndex = rowIndex + 1;
      const recipient = parseRecipientEntry(row.raw);
      if (!recipient) {
        await saveProgressState(PATHS.PROGRESS_STATE_JSON, nextIndex, usersFromLists.length);
        continue;
      }

      const user = recipient.label;
      const dedupeKey = recipient.key;
      if (usersSeenThisRun.has(dedupeKey) || processedUsers.has(dedupeKey)) {
        console.log(`ПРОПУСК дубликата пользователя: ${user}`);
        await appendLog(user, "Skipped: duplicate username");
        await saveProgressState(PATHS.PROGRESS_STATE_JSON, nextIndex, usersFromLists.length);
        continue;
      }

      usersSeenThisRun.add(dedupeKey);
      attemptCounter += 1;
      let stopAfterCurrentUser = false;
      let retryCurrentUser = false;

      try {
        console.log(`[${attemptCounter}] Отправка для ${user}`);
        const outboundMessages = buildOutboundMessages(fileMessages);
        await sendMessagesToUser(
          client,
          recipient.peer,
          outboundMessages,
          stickerDocument,
          thirdMessagePayload,
        );

        processedUsers.add(dedupeKey);
        await saveProcessedUsers(PATHS.PROCESSED_USERS_JSON, processedUsers);
        await appendLog(user, "Success");
        sessionSent += 1;
        dailyStats[TODAY_KEY].sent = (dailyStats[TODAY_KEY].sent ?? 0) + 1;
        await saveDailyStats(PATHS.DAILY_STATS_JSON, dailyStats);
        console.log(
          `Сессия отправлено: ${sessionSent}. Сегодня отправлено: ${dailyStats[TODAY_KEY].sent}.`,
        );
        peerFloodRetriesByUser.delete(dedupeKey);
      } catch (error) {
        const message = getErrorMessage(error);
        console.error(`Ошибка для ${user}: ${message}`);
        await appendLog(user, `Error: ${message}`);

        if (isPeerFloodError(message)) {
          console.error("Обнаружен PEER_FLOOD. Пытаюсь снять ограничение...");
          dailyStats[TODAY_KEY].blocks = dailyStats[TODAY_KEY].blocks || [];
          dailyStats[TODAY_KEY].blocks.push({
            user,
            rowIndex,
            timestamp: nowStamp(),
            type: "peer_flood",
          });
          await saveDailyStats(PATHS.DAILY_STATS_JSON, dailyStats);

          let unblockResult = { resolved: false, hadRestriction: false, statusText: "" };
          if (FLOOD_GUARD.CHECK_SPAM_BOT_STATUS) {
            try {
              unblockResult = await attemptUnblock(client);
            } catch (e) {
              console.error('Попытка разблокировки завершилась исключением:', e);
            }
          }

          if (unblockResult.resolved) {
            if (unblockResult.hadRestriction) {
              console.log("✅ Ограничение снято. Повторяю отправку текущему пользователю.");
              await appendLog(user, "PEER_FLOOD resolved after SpamBot");
            } else {
              console.log("⚠️ SpamBot не показывает блок. Считаю это дневным лимитом и останавливаю рассылку.");
              stopAfterCurrentUser = true;
              shouldArchiveAfterStop = true;
              dailyStats[TODAY_KEY].blocks.push({
                user,
                rowIndex,
                timestamp: nowStamp(),
                type: "peer_flood_hard",
              });
              await saveDailyStats(PATHS.DAILY_STATS_JSON, dailyStats);
              await appendLog(user, "Stopped: PEER_FLOOD hard limit, stop for today");
            }

            if (!stopAfterCurrentUser) {
              const retryCount = peerFloodRetriesByUser.get(dedupeKey) ?? 0;
              if (retryCount >= 1) {
                console.log("Повторная отправка после PEER_FLOOD снова не прошла. Останавливаю запуск.");
                stopAfterCurrentUser = true;
                shouldArchiveAfterStop = true;
                await appendLog(user, "Stopped: PEER_FLOOD repeated after retry");
              } else {
                peerFloodRetriesByUser.set(dedupeKey, retryCount + 1);
                retryCurrentUser = true;
              }
            }
          } else {
            console.error('❌ Разблокировка не удалась или не была выполнена. Останавливаю текущий запуск.');
            stopAfterCurrentUser = true;
            shouldArchiveAfterStop = true;
            await appendLog(user, "Stopped: PEER_FLOOD and unblock failed");
          }
        }
      }

      if (stopAfterCurrentUser) {
        await saveProgressState(PATHS.PROGRESS_STATE_JSON, rowIndex, usersFromLists.length);
        console.log(
          `Запуск остановлен на строке ${rowIndex + 1}. При следующем запуске будет повторная попытка для этого пользователя.`,
        );
        break;
      }

      if (retryCurrentUser) {
        usersSeenThisRun.delete(dedupeKey);
        await saveProgressState(PATHS.PROGRESS_STATE_JSON, rowIndex, usersFromLists.length);
        rowIndex -= 1;
        continue;
      }

      await saveProgressState(PATHS.PROGRESS_STATE_JSON, nextIndex, usersFromLists.length);

      if (attemptCounter % RATE_LIMITS.USERS_PER_BATCH === 0) {
        console.log(
          `Пакет завершен (${attemptCounter} пользователей). Пауза ${Math.floor(RATE_LIMITS.BATCH_SLEEP_MS / 60000)} минут...`,
        );
        await sleep(RATE_LIMITS.BATCH_SLEEP_MS);
      }

      await sleep(RATE_LIMITS.INTER_USER_DELAY_MS);
    }
  } finally {
    if (shouldArchiveAfterStop) {
      try {
        await archiveStaleDialogs(client);
      } catch (e) {
        console.error("Ошибка при архивации диалогов:", e);
      }
    }
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

