import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import input from "input";
import ExcelJS from "exceljs";
import qrcodeTerminal from "qrcode-terminal";
import { Api, TelegramClient } from "telegram";
import {
  ConnectionTCPAbridged,
  ConnectionTCPFull,
  ConnectionTCPObfuscated,
} from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627";
const CONNECTION_TYPES = {
  full: ConnectionTCPFull,
  abridged: ConnectionTCPAbridged,
  obfuscated: ConnectionTCPObfuscated,
};
const NAV_BACK = "__parser_back__";
const NAV_EXIT = "__parser_exit__";

function getErrorMessage(error) {
  if (typeof error?.errorMessage === "string" && error.errorMessage.trim()) {
    return error.errorMessage.trim();
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function isBackInput(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "/back" || normalized === "back" || normalized === "назад";
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
    reconnectRetriesRaw === undefined || reconnectRetriesRaw === null || String(reconnectRetriesRaw).trim() === ""
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

function getUserIdentifier(user) {
  if (typeof user?.username === "string" && user.username.trim()) {
    return user.username.startsWith("@") ? user.username : `@${user.username}`;
  }
  if (user?.id && user?.accessHash) {
    return `${user.id}:${user.accessHash}`;
  }
  return null;
}

function sanitizeFileName(value) {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return sanitized || "parsed-users";
}

function formatMessageDate(value) {
  if (!value) {
    return "";
  }
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" && value < 1000000000000 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getMessageText(message) {
  return String(message?.message ?? message?.text ?? "").trim();
}

function getTelegramEntityIdForLink(entity) {
  const rawId = String(entity?.id ?? "").trim();
  return rawId.replace(/^-100/, "").replace(/^-/, "");
}

function buildTelegramMessageLink(entity, messageId, commentId = null) {
  if (!messageId) {
    return "";
  }

  const username = String(entity?.username ?? "").trim().replace(/^@/, "");
  const commentSuffix = commentId ? `?comment=${commentId}` : "";

  if (username) {
    return `https://t.me/${username}/${messageId}${commentSuffix}`;
  }

  const entityId = getTelegramEntityIdForLink(entity);
  if (entityId) {
    return `https://t.me/c/${entityId}/${messageId}${commentSuffix}`;
  }

  return "";
}

function addCommentSource(commentSources, entity, post, comment, user, userIdentifier) {
  if (!commentSources) {
    return;
  }

  const existing = commentSources.get(userIdentifier);
  if (existing) {
    return;
  }

  const username = String(user?.username ?? "").trim();
  const commentId = comment?.id ?? "";
  const postId = post?.id ?? "";

  commentSources.set(userIdentifier, {
    nick: username ? `@${username.replace(/^@/, "")}` : userIdentifier,
    commentLink: buildTelegramMessageLink(entity, postId, commentId),
    commentDate: formatMessageDate(comment?.date),
    commentText: getMessageText(comment),
  });
}

async function saveCommentSourcesWorkbook(outPath, commentSources) {
  const parsedPath = path.parse(outPath);
  const sourcesPath = path.join(parsedPath.dir, `${parsedPath.name}_comments.xlsx`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Telegram Parser";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Комментарии", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  worksheet.columns = [
    { header: "Ник", key: "nick", width: 24 },
    { header: "Ссылка на комментарий", key: "commentLink", width: 48 },
    { header: "Комментарий", key: "commentText", width: 90 },
    { header: "Дата комментария", key: "commentDate", width: 22 },
  ];
  worksheet.autoFilter = "A1:D1";

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE7EEF8" },
    };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFB7C9E2" } },
    };
  });

  for (const source of Array.from(commentSources.values()).sort((a, b) =>
    a.nick.localeCompare(b.nick, "ru"),
  )) {
    const row = worksheet.addRow({
      nick: source.nick,
      commentLink: source.commentLink,
      commentText: source.commentText,
      commentDate: source.commentDate,
    });

    if (source.commentLink) {
      row.getCell(2).value = { text: source.commentLink, hyperlink: source.commentLink };
      row.getCell(2).font = { color: { argb: "FF0563C1" }, underline: true };
    }

    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).alignment = { vertical: "top" };
    row.getCell(2).alignment = { vertical: "top", wrapText: false };
    row.getCell(3).alignment = { vertical: "top", wrapText: true };
    row.getCell(4).alignment = { vertical: "top" };
  }

  worksheet.getColumn(1).alignment = { vertical: "top" };
  worksheet.getColumn(2).alignment = { vertical: "top" };
  worksheet.getColumn(3).alignment = { vertical: "top", wrapText: true };
  worksheet.getColumn(4).alignment = { vertical: "top" };

  await workbook.xlsx.writeFile(sourcesPath);
  console.log(`Комментарии сохранены в ${sourcesPath}`);
}

function describeEntity(entity) {
  if (entity?.broadcast) {
    return "канал";
  }
  if (entity?.megagroup) {
    return "группа";
  }
  return "чат";
}

function isPublicGroupOrChannel(entity) {
  const className = String(entity?.className ?? "");
  const username = String(entity?.username ?? "").trim();
  return username && (className === "Channel" || className === "Chat");
}

async function listPublicDialogs(client) {
  const limit = parseIntegerEnv("PARSER_DIALOG_LIMIT", 300, 1);
  const dialogs = [];
  const seenIds = new Set();

  for await (const dialog of client.iterDialogs({ limit })) {
    const entity = dialog.entity;
    if (!isPublicGroupOrChannel(entity)) {
      continue;
    }

    const id = String(entity.id ?? entity.username);
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const username = String(entity.username).trim();
    const title = String(dialog.title || entity.title || username).trim();
    dialogs.push({
      entity,
      name: `${title} (@${username}) - ${describeEntity(entity)}`,
      value: entity,
    });
  }

  return dialogs.sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
}

async function resolveTargetEntity(client, target) {
  const trimmedTarget = String(target ?? "").trim();
  console.log(`Получаем информацию о ${trimmedTarget}...`);
  try {
    return await client.getEntity(trimmedTarget);
  } catch (error) {
    throw new Error(`Ошибка при получении группы/канала: ${getErrorMessage(error)}`);
  }
}

async function promptManualTarget(client) {
  while (true) {
    const targetEntity = await input.text(
      "Введите username, ссылку или ID группы/канала для парсинга (/back - назад): ",
    );
    const trimmedTarget = String(targetEntity ?? "").trim();
    if (!trimmedTarget || isBackInput(trimmedTarget)) {
      return NAV_BACK;
    }

    try {
      return await resolveTargetEntity(client, trimmedTarget);
    } catch (error) {
      console.error(getErrorMessage(error));
      console.log("Возвращаюсь к выбору источника.");
      return NAV_BACK;
    }
  }
}

async function promptTargetEntity(client) {
  while (true) {
    const source = await input.select("Откуда взять группу/канал для парсинга?", [
      { name: "Выбрать из публичных групп/каналов аккаунта", value: "account" },
      { name: "Ввести ссылку / username / ID вручную", value: "manual" },
      { name: "Завершить", value: NAV_EXIT },
    ]);

    if (source === NAV_EXIT) {
      return NAV_EXIT;
    }

    if (source === "manual") {
      const entity = await promptManualTarget(client);
      if (entity === NAV_BACK) {
        continue;
      }
      return entity;
    }

    console.log("Загружаю публичные группы и каналы аккаунта...");
    let dialogs = [];
    try {
      dialogs = await listPublicDialogs(client);
    } catch (error) {
      console.error(`Ошибка при загрузке списка групп/каналов: ${getErrorMessage(error)}`);
      continue;
    }

    if (dialogs.length === 0) {
      console.log("Публичные группы/каналы в аккаунте не найдены. Можно ввести ссылку вручную.");
      const entity = await promptManualTarget(client);
      if (entity === NAV_BACK) {
        continue;
      }
      return entity;
    }

    const selectedEntity = await input.select("Выберите группу/канал:", [
      ...dialogs,
      { name: "Назад", value: NAV_BACK },
    ]);

    if (selectedEntity === NAV_BACK) {
      continue;
    }
    return selectedEntity;
  }
}

async function collectAllParticipants(client, entity, participants) {
  console.log("Начинаем сбор всех участников...");
  try {
    for await (const participant of client.iterParticipants(entity)) {
      if (participant.bot) {
        continue;
      }
      const id = getUserIdentifier(participant);
      if (id) {
        participants.add(id);
      }
    }
  } catch (error) {
    console.error(`Ошибка при обходе участников: ${getErrorMessage(error)}`);
  }
}

async function collectActiveUsers(client, entity, participants) {
  const limitStr = await input.text("Сколько последних сообщений проверить? (по умолчанию 5000): ", {
    default: "5000",
  });
  const limit = Number.parseInt(limitStr, 10) || 5000;
  console.log(`Сканируем последние ${limit} сообщений...`);

  try {
    let count = 0;
    for await (const message of client.iterMessages(entity, { limit })) {
      count += 1;
      if (count % 1000 === 0) {
        console.log(`Проверено ${count} сообщений. Найдено пользователей: ${participants.size}`);
      }
      const sender = await message.getSender();
      if (!sender || sender.bot || sender.className !== "User") {
        continue;
      }
      const id = getUserIdentifier(sender);
      if (id) {
        participants.add(id);
      }
    }
  } catch (error) {
    console.error(`Ошибка при чтении сообщений: ${getErrorMessage(error)}`);
  }
}

async function collectCommenters(client, entity, participants, commentSources = null) {
  try {
    const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
    const linkedChatId = fullChannel.fullChat.linkedChatId;
    if (!linkedChatId) {
      throw new Error("У этого канала нет привязанной дискуссионной группы. Комментарии недоступны.");
    }
    const linkedGroup = await client.getEntity(linkedChatId);
    console.log(`Дискуссионная группа: ${linkedGroup.username || linkedGroup.title || linkedChatId}`);
  } catch (error) {
    throw new Error(`Ошибка при получении дискуссионной группы: ${getErrorMessage(error)}`);
  }

  const postsLimitStr = await input.text("Сколько последних постов канала проверить? (по умолчанию 100): ", {
    default: "100",
  });
  const postsLimit = Number.parseInt(postsLimitStr, 10) || 100;

  console.log(`Парсим комментарии из последних ${postsLimit} постов...`);
  let postsDone = 0;

  for await (const post of client.iterMessages(entity, { limit: postsLimit })) {
    postsDone += 1;
    if (postsDone % 10 === 0) {
      console.log(
        `Обработано ${postsDone}/${postsLimit} постов. Найдено пользователей: ${participants.size}`,
      );
    }

    let offsetId = 0;
    while (true) {
      let result;
      try {
        result = await client.invoke(
          new Api.messages.GetReplies({
            peer: entity,
            msgId: post.id,
            offsetId,
            offsetDate: 0,
            addOffset: 0,
            limit: 100,
            maxId: 0,
            minId: 0,
            hash: BigInt(0),
          }),
        );
      } catch {
        break;
      }

      if (!result.messages?.length) {
        break;
      }

      const usersMap = new Map((result.users ?? []).map((user) => [String(user.id), user]));
      for (const msg of result.messages) {
        if (msg.fromId?.className !== "PeerUser") {
          continue;
        }
        const user = usersMap.get(String(msg.fromId.userId));
        if (!user || user.bot) {
          continue;
        }
        const id = getUserIdentifier(user);
        if (id) {
          participants.add(id);
          addCommentSource(commentSources, entity, post, msg, user, id);
        }
      }

      if (result.messages.length < 100) {
        break;
      }
      offsetId = result.messages[result.messages.length - 1].id;
    }
  }
}

async function saveParticipants(entity, participants, commentSources = null) {
  const defaultBaseName = sanitizeFileName(entity.username || entity.title || entity.id);
  let outName = await input.text(`Введите имя файла для сохранения [${defaultBaseName}]: `, {
    default: defaultBaseName,
  });

  outName = String(outName ?? "").trim() || defaultBaseName;
  if (!outName.toLowerCase().endsWith(".txt")) {
    outName += ".txt";
  }

  const outPath = path.resolve("lists", outName);
  await fs.mkdir(path.resolve("lists"), { recursive: true });
  const lines = Array.from(participants).sort((a, b) => a.localeCompare(b, "ru"));
  await fs.writeFile(outPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`Сохранено в ${outPath}`);

  if (commentSources?.size > 0) {
    await saveCommentSourcesWorkbook(outPath, commentSources);
  }
}

async function promptParseMethod() {
  return input.select("Выберите метод сбора участников:", [
    { name: "Собрать всех участников", value: "all" },
    { name: "Собрать активных из истории сообщений", value: "active" },
    { name: "Собрать комментаторов из постов канала", value: "comments" },
    { name: "Назад", value: NAV_BACK },
  ]);
}

async function runParseScenario(client, entity) {
  console.log(`Цель: ${entity.title || entity.username || entity.id}`);

  const parseMethod = await promptParseMethod();
  if (parseMethod === NAV_BACK) {
    return { completed: false, back: true };
  }

  const participants = new Set();
  const commentSources = parseMethod === "comments" ? new Map() : null;

  if (parseMethod === "all") {
    await collectAllParticipants(client, entity, participants);
  } else if (parseMethod === "active") {
    await collectActiveUsers(client, entity, participants);
  } else if (parseMethod === "comments") {
    await collectCommenters(client, entity, participants, commentSources);
  }

  if (participants.size === 0) {
    console.log("Участники не найдены. Можно выбрать другую группу/канал или другой метод.");
    return { completed: false, back: true };
  }

  console.log(`Собрано ${participants.size} уникальных пользователей.`);
  await saveParticipants(entity, participants, commentSources);
  return { completed: true, back: false };
}

export async function runParser() {
  const { apiId, apiHash, forceSms, authMethod } = validateEnv();
  const client = await startClient(apiId, apiHash, forceSms, authMethod);

  try {
    const me = await client.getMe();
    console.log(`Вход выполнен как ${me.username || me.firstName || me.id}`);

    const cliTarget = process.argv.slice(2).find((arg) => String(arg).trim());
    let initialEntity = null;
    if (cliTarget) {
      try {
        initialEntity = await resolveTargetEntity(client, cliTarget);
      } catch (error) {
        console.error(getErrorMessage(error));
        console.log("Перехожу к интерактивному выбору цели.");
      }
    }

    while (true) {
      const entity = initialEntity ?? (await promptTargetEntity(client));
      initialEntity = null;

      if (entity === NAV_EXIT) {
        break;
      }

      try {
        const result = await runParseScenario(client, entity);
        if (result.completed) {
          break;
        }
      } catch (error) {
        console.error(`Ошибка: ${getErrorMessage(error)}`);
        console.log("Возвращаюсь к выбору группы/канала.");
      }
    }
  } finally {
    await client.disconnect();
  }
}

runParser().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
