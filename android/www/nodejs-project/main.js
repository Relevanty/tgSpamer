const fs = require("fs");
const path = require("path");
const cordova = require("cordova-bridge");
const ExcelJS = require("exceljs");
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627";
const TODAY_KEY = new Date().toISOString().slice(0, 10);
const accountSlots = ["acc1", "acc2", "acc3"];

const RATE_LIMITS = {
  INTER_MESSAGE_DELAY_MS: 3000,
  INTER_USER_DELAY_MS: 60000,
  USERS_PER_BATCH: 20,
  BATCH_SLEEP_MS: 30 * 60 * 1000,
};

const FLOOD_GUARD = {
  CHECK_SPAM_BOT_STATUS: true,
  SPAM_BOT_USERNAME: "@SpamBot",
  INITIAL_WAIT_MS: 2500,
  POLL_INTERVAL_MS: 1500,
  POLL_ATTEMPTS: 4,
};

const ARCHIVE_CONFIG = {
  NO_REPLY_HOURS: 24,
  DIALOG_MAX_AGE_HOURS: 168,
  MIN_OUTGOING: 2,
  MIN_LONG_TEXT: 200,
  MAX_DIALOGS_PER_RUN: 200,
  DIALOG_FETCH_BATCH: 100,
  DEBUG: false,
  MESSAGES_SCAN_LIMIT: 30,
};

const dataDir = cordova.app.datadir();
const accountsDir = path.join(dataDir, "accounts");
const listsDir = path.join(dataDir, "lists");
const messagesDir = path.join(dataDir, "messages");
const settingsDir = path.join(dataDir, "settings");
const storageDir = path.join(dataDir, "storage");
const draftsDir = path.join(dataDir, "drafts");

const authRuns = {};
const pendingInputs = {};
const dialogCache = {};
const activeCampaigns = {};
const activeParsers = {};

ensureDir(accountsDir);
ensureDir(listsDir);
ensureDir(messagesDir);
ensureDir(settingsDir);
ensureDir(storageDir);
ensureDir(draftsDir);

log(`Node worker loaded. dataDir=${dataDir}`);
postStatus("Node worker готов");
postAccountsStatus();
postListsStatus();

cordova.channel.on("accounts.status", postAccountsStatus);
cordova.channel.on("settings.get", function (payload) {
  postSettings(payload && payload.slot);
});
cordova.channel.on("settings.save", function (payload) {
  saveSlotSettings(payload && payload.slot, payload || {});
  postSettings(payload && payload.slot);
});
cordova.channel.on("lists.status", postListsStatus);
cordova.channel.on("lists.saveText", saveListText);
cordova.channel.on("lists.parseText", function (payload) {
  cordova.channel.post("parseResult", parseRecipientText(payload && payload.text));
});
cordova.channel.on("messages.saveText", saveMessageText);
cordova.channel.on("auth.check", function (payload) {
  checkAuth(payload).catch(function (error) {
    postAuthError(payload && payload.slot, error);
  });
});
cordova.channel.on("auth.start", function (payload) {
  startAuth(payload).catch(function (error) {
    postAuthError(payload && payload.slot, error);
  });
});
cordova.channel.on("auth.code", function (payload) {
  resolveAuthInput(payload && payload.slot, "code", payload && payload.code);
});
cordova.channel.on("auth.password", function (payload) {
  resolveAuthInput(payload && payload.slot, "password", payload && payload.password);
});
cordova.channel.on("auth.cancel", function (payload) {
  cancelAuth(payload && payload.slot);
});
cordova.channel.on("parser.dialogs", function (payload) {
  listParserDialogs(payload).catch(function (error) {
    postParserError(payload && payload.slot, error);
  });
});
cordova.channel.on("parser.start", function (payload) {
  startParser(payload).catch(function (error) {
    postParserError(payload && payload.slot, error);
  });
});
cordova.channel.on("parser.stop", function (payload) {
  stopParser(payload && payload.slot);
});
cordova.channel.on("campaign.start", function (payload) {
  startCampaign(payload).catch(function (error) {
    postCampaignError(payload && payload.slot, error);
  });
});
cordova.channel.on("campaign.stop", function (payload) {
  stopCampaign(payload && payload.slot);
});
cordova.channel.on("archive.start", function (payload) {
  startArchive(payload).catch(function (error) {
    postArchiveError(payload && payload.slot, error);
  });
});

cordova.app.on("pause", function (pauseLock) {
  postStatus("Приложение свернуто");
  pauseLock.release();
});

cordova.app.on("resume", function () {
  postStatus("Приложение активно");
});

function postStatus(message) {
  cordova.channel.post("status", message);
  log(message);
}

function log(message) {
  const text = String(message || "");
  cordova.channel.send(text);
  cordova.channel.post("log", text);
}

function nowStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function normalizeSlot(slotRaw) {
  const slot = String(slotRaw || "").trim().toLowerCase();
  return accountSlots.indexOf(slot) >= 0 ? slot : null;
}

function slotDir(slot) {
  return path.join(storageDir, slot);
}

function slotPaths(slot) {
  const dir = slotDir(slot);
  return {
    processed: path.join(dir, "processed-users.json"),
    progress: path.join(dir, "progress-state.json"),
    dailyStats: path.join(dir, "daily-stats.json"),
    report: path.join(dir, "report.csv"),
  };
}

function settingsPath(slot) {
  return path.join(settingsDir, slot + ".json");
}

function defaultSettings(slot) {
  return {
    slot: slot,
    listFile: "",
    messageText: "",
    sendIntroText: false,
    introText: "",
    sendTextFiles: false,
    messageFileNames: [],
    sendSticker: false,
    stickerSetIndex: "",
    stickerDocIndex: "",
    interUserDelayMs: RATE_LIMITS.INTER_USER_DELAY_MS,
    interMessageDelayMs: RATE_LIMITS.INTER_MESSAGE_DELAY_MS,
    usersPerBatch: RATE_LIMITS.USERS_PER_BATCH,
    batchSleepMs: RATE_LIMITS.BATCH_SLEEP_MS,
    randomizeSingleText: false,
  };
}

function loadSlotSettings(slotRaw) {
  const slot = normalizeSlot(slotRaw) || "acc1";
  const loaded = readJson(settingsPath(slot), {});
  const settings = Object.assign(defaultSettings(slot), loaded || {});
  settings.slot = slot;
  return settings;
}

function saveSlotSettings(slotRaw, payload) {
  const slot = normalizeSlot(slotRaw) || "acc1";
  const next = Object.assign(loadSlotSettings(slot), payload || {});
  next.slot = slot;
  next.messageFileNames = normalizeNameList(next.messageFileNames);
  writeJson(settingsPath(slot), next);
  return next;
}

function postSettings(slotRaw) {
  const slot = normalizeSlot(slotRaw) || "acc1";
  cordova.channel.post("settings", loadSlotSettings(slot));
}

function listTextFiles(dirPath) {
  ensureDir(dirPath);
  return fs.readdirSync(dirPath)
    .filter(function (name) {
      return fs.statSync(path.join(dirPath, name)).isFile() && name.toLowerCase().endsWith(".txt");
    })
    .sort(function (a, b) {
      return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });
    })
    .map(function (name) {
      const content = fs.readFileSync(path.join(dirPath, name), "utf8");
      const lineCount = content.split(/\r?\n/).filter(function (line) {
        return String(line || "").trim();
      }).length;
      return { name: name, lineCount: lineCount };
    });
}

function postListsStatus() {
  cordova.channel.post("lists", {
    lists: listTextFiles(listsDir),
    messages: listTextFiles(messagesDir),
  });
}

function sanitizeFileName(value) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return sanitized || "parsed-users";
}

function saveListText(payload) {
  const fileNameRaw = String((payload && payload.fileName) || "").trim();
  const text = String((payload && payload.text) || "");
  let fileName = sanitizeFileName(fileNameRaw || "imported-list");
  if (!fileName.toLowerCase().endsWith(".txt")) {
    fileName += ".txt";
  }
  fs.writeFileSync(path.join(listsDir, fileName), normalizeTextFile(text), "utf8");
  if (payload && payload.slot) {
    saveSlotSettings(payload.slot, { listFile: fileName });
    postSettings(payload.slot);
  }
  log(`Список сохранен: ${fileName}`);
  cordova.channel.post("parseResult", parseRecipientText(text));
  postListsStatus();
}

function saveMessageText(payload) {
  const fileNameRaw = String((payload && payload.fileName) || "").trim();
  const text = String((payload && payload.text) || "");
  let fileName = sanitizeFileName(fileNameRaw || "message");
  if (!fileName.toLowerCase().endsWith(".txt")) {
    fileName += ".txt";
  }
  fs.writeFileSync(path.join(messagesDir, fileName), normalizeTextFile(text), "utf8");
  if (payload && payload.slot) {
    const settings = loadSlotSettings(payload.slot);
    const names = normalizeNameList(settings.messageFileNames);
    if (names.indexOf(fileName) < 0) names.push(fileName);
    saveSlotSettings(payload.slot, { sendTextFiles: true, messageFileNames: names });
    postSettings(payload.slot);
  }
  log(`Сообщение сохранено: ${fileName}`);
  postListsStatus();
}

function normalizeNameList(value) {
  if (Array.isArray(value)) {
    return value.map(function (name) {
      return String(name || "").trim();
    }).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map(function (name) {
      return String(name || "").trim();
    })
    .filter(Boolean);
}

function loadMessageFiles() {
  return listTextFiles(messagesDir).map(function (entry) {
    return {
      fileName: entry.name,
      text: fs.readFileSync(path.join(messagesDir, entry.name), "utf8").trim(),
    };
  }).filter(function (entry) {
    return entry.text;
  });
}

function selectConfiguredTextFiles(fileMessages, settings) {
  const selectedNames = normalizeNameList(settings && settings.messageFileNames);
  if (selectedNames.length === 0) {
    return fileMessages;
  }
  const selectedSet = new Set(selectedNames);
  return fileMessages.filter(function (fileMessage) {
    return selectedSet.has(fileMessage.fileName);
  });
}

function normalizeTextFile(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return normalized ? normalized + "\n" : "";
}

function postAccountsStatus() {
  const status = {};
  for (let i = 0; i < accountSlots.length; i += 1) {
    const slot = accountSlots[i];
    const session = loadSession(slot);
    status[slot] = {
      hasSession: Boolean(session.sessionString),
      phone: session.phone || "",
      savedAt: session.savedAt || "",
    };
  }
  cordova.channel.post("accounts", status);
}

async function checkAuth(payload) {
  const slot = normalizeSlot(payload && payload.slot);
  if (!slot) throw new Error("Некорректный слот аккаунта");
  const session = loadSession(slot);
  if (!session.sessionString) {
    cordova.channel.post("auth", { type: "error", slot: slot, message: "Сессия не найдена" });
    postAccountsStatus();
    return;
  }

  cordova.channel.post("auth", { type: "status", slot: slot, message: `${slot}: проверяю сессию` });
  const client = createTelegramClient(session.sessionString);
  try {
    await client.connect();
    const authorized = await client.checkAuthorization();
    if (!authorized) {
      deleteSession(slot);
    }
    cordova.channel.post("auth", {
      type: authorized ? "done" : "error",
      slot: slot,
      message: authorized ? "Сессия активна" : "Сессия не авторизована",
    });
    postAccountsStatus();
  } finally {
    await disconnectClient(client);
  }
}

async function startAuth(payload) {
  const slot = normalizeSlot(payload && payload.slot);
  const phone = String((payload && payload.phone) || "").trim();
  if (!slot) throw new Error("Некорректный слот аккаунта");
  if (!phone) throw new Error("Номер Telegram пустой");
  if (authRuns[slot]) {
    cordova.channel.post("auth", { type: "status", slot: slot, message: "Авторизация уже запущена" });
    return;
  }

  authRuns[slot] = true;
  cordova.channel.post("auth", { type: "status", slot: slot, message: `${slot}: подключаюсь к Telegram` });

  const client = createTelegramClient(loadSession(slot).sessionString || "");
  try {
    await client.connect();
    if (await client.checkAuthorization()) {
      saveSession(slot, phone, client.session.save());
      cordova.channel.post("auth", { type: "done", slot: slot, message: "Сессия уже активна" });
      postAccountsStatus();
      return;
    }

    await client.start({
      phoneNumber: async function () {
        cordova.channel.post("auth", { type: "status", slot: slot, message: "Отправляю номер" });
        return phone;
      },
      phoneCode: async function (isCodeViaApp) {
        cordova.channel.post("auth", {
          type: "needCode",
          slot: slot,
          message: isCodeViaApp ? "Код пришел в Telegram" : "Код пришел по SMS",
        });
        return await waitForAuthInput(slot, "code");
      },
      password: async function (hint) {
        cordova.channel.post("auth", { type: "needPassword", slot: slot, hint: hint || "" });
        return await waitForAuthInput(slot, "password");
      },
      forceSMS: false,
      onError: function (error) {
        cordova.channel.post("auth", { type: "status", slot: slot, message: getErrorMessage(error) });
      },
    });

    saveSession(slot, phone, client.session.save());
    cordova.channel.post("auth", { type: "done", slot: slot, message: "Сессия сохранена" });
    postAccountsStatus();
  } finally {
    delete authRuns[slot];
    clearPendingInput(slot, "code");
    clearPendingInput(slot, "password");
    await disconnectClient(client);
  }
}

function createTelegramClient(sessionString) {
  return new TelegramClient(new StringSession(sessionString || ""), DEFAULT_API_ID, DEFAULT_API_HASH, {
    connectionRetries: 5,
    timeout: 15,
  });
}

async function getAuthorizedClient(slotRaw) {
  const slot = normalizeSlot(slotRaw);
  if (!slot) throw new Error("Некорректный слот аккаунта");
  const session = loadSession(slot);
  if (!session.sessionString) throw new Error(`${slot}: нет сохраненной сессии`);
  const client = createTelegramClient(session.sessionString);
  await client.connect();
  if (!(await client.checkAuthorization())) {
    deleteSession(slot);
    postAccountsStatus();
    await disconnectClient(client);
    throw new Error(`${slot}: сессия не авторизована`);
  }
  return client;
}

function waitForAuthInput(slot, type) {
  return new Promise(function (resolve, reject) {
    const key = inputKey(slot, type);
    clearPendingInput(slot, type);
    pendingInputs[key] = { resolve: resolve, reject: reject };
  });
}

function resolveAuthInput(slotRaw, type, valueRaw) {
  const slot = normalizeSlot(slotRaw);
  const key = inputKey(slot, type);
  const pending = pendingInputs[key];
  const value = String(valueRaw || "").trim();
  if (!slot || !pending) return;
  if (!value) {
    cordova.channel.post("auth", { type: "error", slot: slot, message: "Пустое значение" });
    return;
  }
  delete pendingInputs[key];
  pending.resolve(value);
}

function cancelAuth(slotRaw) {
  const slot = normalizeSlot(slotRaw);
  if (!slot) return;
  clearPendingInput(slot, "code", new Error("Авторизация отменена"));
  clearPendingInput(slot, "password", new Error("Авторизация отменена"));
  cordova.channel.post("auth", { type: "status", slot: slot, message: "Авторизация отменена" });
}

function clearPendingInput(slot, type, error) {
  const key = inputKey(slot, type);
  const pending = pendingInputs[key];
  if (!pending) return;
  delete pendingInputs[key];
  if (error) pending.reject(error);
}

function inputKey(slot, type) {
  return `${slot}:${type}`;
}

function sessionFile(slot) {
  return path.join(accountsDir, slot, "session.json");
}

function saveSession(slot, phone, sessionString) {
  const accountDir = path.join(accountsDir, slot);
  ensureDir(accountDir);
  writeJson(path.join(accountDir, "session.json"), {
    phone: phone,
    sessionString: sessionString,
    savedAt: new Date().toISOString(),
  });
}

function deleteSession(slot) {
  try {
    fs.unlinkSync(sessionFile(slot));
  } catch (error) {
    // ignore
  }
}

function loadSession(slotRaw) {
  const slot = normalizeSlot(slotRaw);
  if (!slot) return {};
  return readJson(sessionFile(slot), {});
}

function postAuthError(slotRaw, error) {
  const slot = normalizeSlot(slotRaw);
  cordova.channel.post("auth", { type: "error", slot: slot, message: getErrorMessage(error) });
  if (slot) {
    delete authRuns[slot];
    clearPendingInput(slot, "code");
    clearPendingInput(slot, "password");
  }
}

function postParser(slot, payload) {
  const message = Object.assign({ slot: normalizeSlot(slot) }, payload || {});
  cordova.channel.post("parser", message);
  if (message.message) log(message.message);
}

function postParserError(slotRaw, error) {
  postParser(slotRaw, { type: "error", message: getErrorMessage(error) });
}

async function listParserDialogs(payload) {
  const slot = normalizeSlot(payload && payload.slot);
  const client = await getAuthorizedClient(slot);
  try {
    postParser(slot, { type: "status", message: "Загружаю группы и каналы аккаунта..." });
    const dialogs = [];
    const seenIds = {};
    const cache = {};
    let index = 0;
    for await (const dialog of client.iterDialogs({ limit: 300 })) {
      const entity = dialog.entity;
      if (!isGroupOrChannel(entity)) continue;
      const className = String(entity.className || "Entity");
      const rawId = className + ":" + String(entity.id || entity.username);
      if (seenIds[rawId]) continue;
      seenIds[rawId] = true;
      const id = "dialog_" + index;
      index += 1;
      cache[id] = entity;
      dialogs.push({ id: id, name: formatDialogName(dialog) });
    }
    dialogs.sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
    });
    dialogCache[slot] = cache;
    postParser(slot, { type: "dialogs", dialogs: dialogs, message: `Найдено групп/каналов: ${dialogs.length}` });
  } finally {
    await disconnectClient(client);
  }
}

async function startParser(payload) {
  const slot = normalizeSlot(payload && payload.slot);
  if (!slot) throw new Error("Некорректный слот аккаунта");
  if (activeParsers[slot]) throw new Error(`${slot}: сбор уже запущен`);

  const run = { stopRequested: false };
  activeParsers[slot] = run;
  const client = await getAuthorizedClient(slot);
  try {
    const entity = await resolveParserEntity(client, slot, payload || {});
    const method = String((payload && payload.method) || "comments");
    const limit = Math.max(1, Number.parseInt(String((payload && payload.limit) || ""), 10) || (method === "comments" ? 100 : 5000));
    const participants = new Set();
    const commentSources = method === "comments" ? new Map() : null;
    postParser(slot, { type: "status", message: `Цель: ${entity.title || entity.username || entity.id}` });

    if (method === "all") {
      await collectAllParticipants(client, entity, participants, run, slot);
    } else if (method === "active") {
      await collectActiveUsers(client, entity, participants, limit, run, slot);
    } else if (method === "comments") {
      await collectCommenters(client, entity, participants, limit, commentSources, run, slot);
    } else {
      throw new Error("Неизвестный метод сбора");
    }

    if (participants.size === 0) {
      postParser(slot, { type: "done", count: 0, message: "Участники не найдены." });
      return;
    }

    const saved = await saveParticipants(entity, participants, commentSources, payload && payload.outputName);
    saveSlotSettings(slot, { listFile: saved.fileName });
    postListsStatus();
    postSettings(slot);
    postParser(slot, {
      type: "done",
      count: participants.size,
      fileName: saved.fileName,
      message: `Собрано ${participants.size}. Сохранено: ${saved.fileName}`,
    });
  } finally {
    delete activeParsers[slot];
    await disconnectClient(client);
  }
}

function stopParser(slotRaw) {
  const slot = normalizeSlot(slotRaw);
  if (slot && activeParsers[slot]) {
    activeParsers[slot].stopRequested = true;
    postParser(slot, { type: "status", message: "Останавливаю сбор после текущего шага..." });
  }
}

async function resolveParserEntity(client, slot, payload) {
  const source = String(payload.source || "manual");
  if (source === "dialog") {
    const id = String(payload.dialogId || "");
    const cached = dialogCache[slot] && dialogCache[slot][id];
    if (!cached) throw new Error("Выбранный диалог не найден в кэше. Обновите список групп.");
    return cached;
  }

  const target = String(payload.target || "").trim();
  if (!target) throw new Error("Введите ссылку, username или ID цели");
  postParser(slot, { type: "status", message: `Получаем информацию о ${target}...` });
  return await client.getEntity(target);
}

function describeEntity(entity) {
  if (entity && entity.broadcast) return "канал";
  if (entity && entity.megagroup) return "группа";
  return "чат";
}

function isGroupOrChannel(entity) {
  const className = String((entity && entity.className) || "");
  return className === "Channel" || className === "Chat";
}

function formatDialogName(dialog) {
  const entity = dialog.entity;
  const username = String((entity && entity.username) || "").trim();
  const title = String(dialog.title || (entity && entity.title) || username || (entity && entity.id) || "Без названия").trim();
  const access = username ? "@" + username : "приватный";
  return `${title} (${access}) - ${describeEntity(entity)}`;
}

async function collectAllParticipants(client, entity, participants, run, slot) {
  postParser(slot, { type: "status", message: "Начинаем сбор всех участников..." });
  try {
    for await (const participant of client.iterParticipants(entity)) {
      if (run.stopRequested) break;
      if (participant.bot) continue;
      const id = getUserIdentifier(participant);
      if (id) participants.add(id);
      if (participants.size > 0 && participants.size % 500 === 0) {
        postParser(slot, { type: "progress", count: participants.size, message: `Найдено пользователей: ${participants.size}` });
      }
    }
  } catch (error) {
    postParser(slot, { type: "status", message: `Ошибка при обходе участников: ${getErrorMessage(error)}` });
  }
}

async function collectActiveUsers(client, entity, participants, limit, run, slot) {
  postParser(slot, { type: "status", message: `Сканируем последние ${limit} сообщений...` });
  try {
    let count = 0;
    for await (const message of client.iterMessages(entity, { limit: limit })) {
      if (run.stopRequested) break;
      count += 1;
      if (count % 1000 === 0) {
        postParser(slot, { type: "progress", count: participants.size, message: `Проверено ${count}. Найдено: ${participants.size}` });
      }
      const sender = await message.getSender();
      if (!sender || sender.bot || sender.className !== "User") continue;
      const id = getUserIdentifier(sender);
      if (id) participants.add(id);
    }
  } catch (error) {
    postParser(slot, { type: "status", message: `Ошибка при чтении сообщений: ${getErrorMessage(error)}` });
  }
}

async function collectCommenters(client, entity, participants, postsLimit, commentSources, run, slot) {
  try {
    const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
    const linkedChatId = fullChannel.fullChat.linkedChatId;
    if (!linkedChatId) {
      throw new Error("У этого канала нет привязанной дискуссионной группы. Комментарии недоступны.");
    }
    const linkedGroup = await client.getEntity(linkedChatId);
    postParser(slot, { type: "status", message: `Дискуссионная группа: ${linkedGroup.username || linkedGroup.title || linkedChatId}` });
  } catch (error) {
    throw new Error(`Ошибка при получении дискуссионной группы: ${getErrorMessage(error)}`);
  }

  postParser(slot, { type: "status", message: `Парсим комментарии из последних ${postsLimit} постов...` });
  let postsDone = 0;
  for await (const post of client.iterMessages(entity, { limit: postsLimit })) {
    if (run.stopRequested) break;
    postsDone += 1;
    if (postsDone % 10 === 0) {
      postParser(slot, { type: "progress", count: participants.size, message: `Обработано ${postsDone}/${postsLimit}. Найдено: ${participants.size}` });
    }

    let offsetId = 0;
    while (!run.stopRequested) {
      let result;
      try {
        result = await client.invoke(new Api.messages.GetReplies({
          peer: entity,
          msgId: post.id,
          offsetId: offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit: 100,
          maxId: 0,
          minId: 0,
          hash: BigInt(0),
        }));
      } catch (error) {
        break;
      }
      if (!result.messages || !result.messages.length) break;

      const usersMap = new Map((result.users || []).map(function (user) {
        return [String(user.id), user];
      }));
      for (let i = 0; i < result.messages.length; i += 1) {
        const msg = result.messages[i];
        if (!msg.fromId || msg.fromId.className !== "PeerUser") continue;
        const user = usersMap.get(String(msg.fromId.userId));
        if (!user || user.bot) continue;
        const id = getUserIdentifier(user);
        if (id) {
          participants.add(id);
          addCommentSource(commentSources, entity, post, msg, user, id);
        }
      }
      if (result.messages.length < 100) break;
      offsetId = result.messages[result.messages.length - 1].id;
    }
  }
}

async function saveParticipants(entity, participants, commentSources, outputNameRaw) {
  const defaultBaseName = sanitizeFileName(entity.username || entity.title || entity.id);
  let outName = sanitizeFileName(outputNameRaw || defaultBaseName);
  if (!outName.toLowerCase().endsWith(".txt")) outName += ".txt";
  const outPath = path.join(listsDir, outName);
  const lines = Array.from(participants).sort(function (a, b) {
    return a.localeCompare(b, "ru");
  });
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  if (commentSources && commentSources.size > 0) {
    await saveCommentSourcesWorkbook(outPath, commentSources);
  }
  return { fileName: outName, filePath: outPath };
}

async function saveCommentSourcesWorkbook(outPath, commentSources) {
  const parsedPath = path.parse(outPath);
  const sourcesPath = path.join(parsedPath.dir, parsedPath.name + "_comments.xlsx");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Telegram Parser";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Комментарии", { views: [{ state: "frozen", ySplit: 1 }] });
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
  headerRow.eachCell(function (cell) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7EEF8" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFB7C9E2" } } };
  });
  Array.from(commentSources.values()).sort(function (a, b) {
    return a.nick.localeCompare(b.nick, "ru");
  }).forEach(function (source) {
    const row = worksheet.addRow(source);
    if (source.commentLink) {
      row.getCell(2).value = { text: source.commentLink, hyperlink: source.commentLink };
      row.getCell(2).font = { color: { argb: "FF0563C1" }, underline: true };
    }
    row.alignment = { vertical: "top", wrapText: true };
  });
  await workbook.xlsx.writeFile(sourcesPath);
  log(`Комментарии сохранены: ${sourcesPath}`);
}

function getUserIdentifier(user) {
  if (typeof (user && user.username) === "string" && user.username.trim()) {
    return user.username.startsWith("@") ? user.username : "@" + user.username;
  }
  if (user && user.id && user.accessHash) {
    return `${user.id}:${user.accessHash}`;
  }
  return null;
}

function formatMessageDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(typeof value === "number" && value < 1000000000000 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = function (number) { return String(number).padStart(2, "0"); };
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getMessageText(message) {
  return String((message && (message.message || message.text)) || "").trim();
}

function getTelegramEntityIdForLink(entity) {
  const rawId = String((entity && entity.id) || "").trim();
  return rawId.replace(/^-100/, "").replace(/^-/, "");
}

function buildTelegramMessageLink(entity, messageId, commentId) {
  if (!messageId) return "";
  const username = String((entity && entity.username) || "").trim().replace(/^@/, "");
  const commentSuffix = commentId ? "?comment=" + commentId : "";
  if (username) return `https://t.me/${username}/${messageId}${commentSuffix}`;
  const entityId = getTelegramEntityIdForLink(entity);
  if (entityId) return `https://t.me/c/${entityId}/${messageId}${commentSuffix}`;
  return "";
}

function addCommentSource(commentSources, entity, post, comment, user, userIdentifier) {
  if (!commentSources || commentSources.has(userIdentifier)) return;
  const username = String((user && user.username) || "").trim();
  const commentId = (comment && comment.id) || "";
  const postId = (post && post.id) || "";
  commentSources.set(userIdentifier, {
    nick: username ? "@" + username.replace(/^@/, "") : userIdentifier,
    commentLink: buildTelegramMessageLink(entity, postId, commentId),
    commentDate: formatMessageDate(comment && comment.date),
    commentText: getMessageText(comment),
  });
}

function postCampaign(slot, payload) {
  const message = Object.assign({ slot: normalizeSlot(slot) }, payload || {});
  cordova.channel.post("campaign", message);
  if (message.message) log(message.message);
}

function postCampaignError(slotRaw, error) {
  postCampaign(slotRaw, { type: "error", message: getErrorMessage(error) });
}

async function startCampaign(payload) {
  const slot = normalizeSlot(payload && payload.slot);
  if (!slot) throw new Error("Некорректный слот аккаунта");
  if (activeCampaigns[slot]) throw new Error(`${slot}: рассылка уже запущена`);

  const settings = saveSlotSettings(slot, payload || {});
  let listFile = String(settings.listFile || "").trim();
  if (!listFile) {
    const availableLists = listTextFiles(listsDir);
    if (availableLists.length === 0) throw new Error("В папке lists нет файлов со списками.");
    listFile = availableLists[0].name;
    saveSlotSettings(slot, { listFile: listFile });
    postSettings(slot);
  }
  settings.listFile = listFile;

  const fileMessages = selectConfiguredTextFiles(loadMessageFiles(), settings);
  const outboundProbe = buildOutboundMessages(settings, fileMessages);
  if (outboundProbe.length === 0 && !settings.sendSticker) {
    throw new Error("Не настроены исходящие сообщения. Проверьте MESSAGE_CONFIG и messages/*.txt");
  }

  const listPath = path.join(listsDir, listFile);
  if (!fs.existsSync(listPath)) throw new Error(`Список не найден: ${listFile}`);

  const run = { stopRequested: false };
  activeCampaigns[slot] = run;
  const client = await getAuthorizedClient(slot);
  try {
    const usersFromList = loadUsersFromFile(listPath, listFile);
    const paths = slotPaths(slot);
    const progress = loadProgressState(paths.progress, usersFromList.length);
    let startIndex = progress.nextIndex;
    if (payload && payload.startIndex !== undefined && payload.startIndex !== null && String(payload.startIndex).trim() !== "") {
      startIndex = Math.max(0, Math.min(usersFromList.length, Number.parseInt(String(payload.startIndex), 10) || 0));
      saveProgressState(paths.progress, startIndex, usersFromList.length);
    }
    const processedUsers = loadProcessedUsers(paths.processed);
    const usersSeenThisRun = new Set();
    if (startIndex === 0 && processedUsers.size > 0) {
      startIndex = findResumeIndexFromProcessed(usersFromList, processedUsers);
      if (startIndex > 0) saveProgressState(paths.progress, startIndex, usersFromList.length);
    }
    if (startIndex >= usersFromList.length) {
      postCampaign(slot, { type: "done", sent: 0, total: usersFromList.length, message: "В списке нет необработанных строк." });
      return;
    }

    const dailyStats = loadDailyStats(paths.dailyStats);
    if (!dailyStats[TODAY_KEY]) dailyStats[TODAY_KEY] = { sent: 0, blocks: [] };
    let sessionSent = 0;
    let attemptCounter = 0;
    let peerFloodNoLimitStreak = 0;
    let shouldArchiveAfterStop = false;
    let endedEarly = false;
    let stickerDocument = null;
    if (settings.sendSticker) {
      try {
        stickerDocument = await loadStickerDocument(client, settings);
        log(stickerDocument ? "Стикер загружен." : "Стикер не найден, продолжаю без стикера.");
      } catch (error) {
        log(`Не удалось загрузить стикер: ${getErrorMessage(error)}`);
      }
    }
    if (settings.sendSticker && !stickerDocument && outboundProbe.length === 0) {
      throw new Error("Стикер не найден и текст сообщения не настроен");
    }

    const me = await client.getMe();
    postCampaign(slot, {
      type: "started",
      total: usersFromList.length,
      nextIndex: startIndex,
      message: `Вход выполнен как ${me.username || me.firstName || me.id}. Использую список: ${listFile}`,
    });

    for (let rowIndex = startIndex; rowIndex < usersFromList.length; rowIndex += 1) {
      if (run.stopRequested) {
        saveProgressState(paths.progress, rowIndex, usersFromList.length);
        endedEarly = true;
        postCampaign(slot, { type: "stopped", nextIndex: rowIndex, total: usersFromList.length, message: "Рассылка остановлена." });
        break;
      }

      const row = usersFromList[rowIndex];
      const nextIndex = rowIndex + 1;
      const recipient = parseRecipientEntry(row.raw);
      if (!recipient) {
        saveProgressState(paths.progress, nextIndex, usersFromList.length);
        continue;
      }
      const user = recipient.label;
      const dedupeKey = recipient.key;
      if (usersSeenThisRun.has(dedupeKey) || processedUsers.has(dedupeKey)) {
        log(`ПРОПУСК дубликата пользователя: ${user}`);
        appendReportRow(paths.report, { timestamp: nowStamp(), user: user, mode: "Instant", status: "Skipped: duplicate username" });
        saveProgressState(paths.progress, nextIndex, usersFromList.length);
        continue;
      }

      usersSeenThisRun.add(dedupeKey);
      attemptCounter += 1;
      let stopAfterCurrentUser = false;
      try {
        postCampaign(slot, {
          type: "progress",
          current: nextIndex,
          total: usersFromList.length,
          sent: sessionSent,
          message: `[${attemptCounter}] Отправка для ${user}`,
        });
        await sendMessagesToUser(client, recipient.peer, buildOutboundMessages(settings, fileMessages), stickerDocument, settings, run);
        processedUsers.add(dedupeKey);
        saveProcessedUsers(paths.processed, processedUsers);
        appendReportRow(paths.report, { timestamp: nowStamp(), user: user, mode: "Instant", status: "Success" });
        sessionSent += 1;
        dailyStats[TODAY_KEY].sent = (dailyStats[TODAY_KEY].sent || 0) + 1;
        saveDailyStats(paths.dailyStats, dailyStats);
        peerFloodNoLimitStreak = 0;
      } catch (error) {
        const message = getErrorMessage(error);
        log(`Ошибка для ${user}: ${message}`);
        appendReportRow(paths.report, { timestamp: nowStamp(), user: user, mode: "Instant", status: `Error: ${message}` });
        if (isPeerFloodError(message)) {
          log("Обнаружен PEER_FLOOD. Пытаюсь снять ограничение...");
          dailyStats[TODAY_KEY].blocks = dailyStats[TODAY_KEY].blocks || [];
          dailyStats[TODAY_KEY].blocks.push({ user: user, rowIndex: rowIndex, timestamp: nowStamp(), type: "peer_flood" });
          saveDailyStats(paths.dailyStats, dailyStats);
          let unblockResult = { resolved: false, hadRestriction: false, statusText: "" };
          if (FLOOD_GUARD.CHECK_SPAM_BOT_STATUS) {
            try {
              unblockResult = await attemptUnblock(client);
            } catch (e) {
              log("Попытка разблокировки завершилась исключением: " + getErrorMessage(e));
            }
          }
          if (unblockResult.resolved) {
            if (unblockResult.hadRestriction) {
              log("Ограничение снято. Продолжаю.");
              appendReportRow(paths.report, { timestamp: nowStamp(), user: user, mode: "Instant", status: "PEER_FLOOD resolved after SpamBot" });
              peerFloodNoLimitStreak = 0;
            } else {
              peerFloodNoLimitStreak += 1;
              log(`SpamBot не показывает блок. Подозрение на дневной лимит (серия ${peerFloodNoLimitStreak}).`);
              if (peerFloodNoLimitStreak >= 2) {
                stopAfterCurrentUser = true;
                shouldArchiveAfterStop = true;
                appendReportRow(paths.report, { timestamp: nowStamp(), user: user, mode: "Instant", status: "Stopped: PEER_FLOOD hard limit, stop for today" });
              }
            }
          } else {
            log("Разблокировка не удалась или не была выполнена. Останавливаю текущий запуск.");
            stopAfterCurrentUser = true;
            shouldArchiveAfterStop = true;
            appendReportRow(paths.report, { timestamp: nowStamp(), user: user, mode: "Instant", status: "Stopped: PEER_FLOOD and unblock failed" });
          }
        }
      }

      if (stopAfterCurrentUser) {
        saveProgressState(paths.progress, rowIndex, usersFromList.length);
        endedEarly = true;
        postCampaign(slot, { type: "stopped", nextIndex: rowIndex, total: usersFromList.length, message: `Запуск остановлен на строке ${rowIndex + 1}.` });
        break;
      }

      saveProgressState(paths.progress, nextIndex, usersFromList.length);
      if (attemptCounter % Number(settings.usersPerBatch || RATE_LIMITS.USERS_PER_BATCH) === 0) {
        const batchSleepMs = Number(settings.batchSleepMs || RATE_LIMITS.BATCH_SLEEP_MS);
        log(`Пакет завершен (${attemptCounter} пользователей). Пауза ${Math.floor(batchSleepMs / 60000)} минут...`);
        await sleepCancellable(batchSleepMs, run);
      }
      await sleepCancellable(Number(settings.interUserDelayMs || RATE_LIMITS.INTER_USER_DELAY_MS), run);
    }

    if (shouldArchiveAfterStop) {
      await archiveStaleDialogs(client, slot);
    }
    if (!endedEarly) {
      postCampaign(slot, { type: "done", sent: sessionSent, total: usersFromList.length, message: `Рассылка завершена. Отправлено: ${sessionSent}` });
    }
  } finally {
    delete activeCampaigns[slot];
    await disconnectClient(client);
  }
}

function stopCampaign(slotRaw) {
  const slot = normalizeSlot(slotRaw);
  if (slot && activeCampaigns[slot]) {
    activeCampaigns[slot].stopRequested = true;
    postCampaign(slot, { type: "status", message: "Останавливаю рассылку после текущего шага..." });
  }
}

function loadUsersFromFile(filePath, fileName) {
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).map(function (line) {
    return { fileName: fileName, raw: line };
  });
}

function buildOutboundMessages(settings, fileMessages) {
  const messagePool = [];
  const introText = String(settings.introText || "").trim();
  if (settings.sendIntroText && introText) {
    messagePool.push(introText);
  }

  const text = String(settings.messageText || "").trim();
  if (text) messagePool.push(text);

  if (settings.sendTextFiles) {
    const selectedMessages = Array.isArray(fileMessages) ? fileMessages : selectConfiguredTextFiles(loadMessageFiles(), settings);
    for (let i = 0; i < selectedMessages.length; i += 1) {
      if (selectedMessages[i].text) messagePool.push(selectedMessages[i].text);
    }
  }

  if (!settings.randomizeSingleText) return messagePool;
  if (messagePool.length === 0) return [];
  return [messagePool[Math.floor(Math.random() * messagePool.length)]];
}

function parseRecipientEntry(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const idHashMatch = value.match(/^(\d+):(-?\d+)$/);
  if (idHashMatch) {
    return {
      peer: new Api.InputPeerUser({ userId: BigInt(idHashMatch[1]), accessHash: BigInt(idHashMatch[2]) }),
      label: `id:${idHashMatch[1]}`,
      key: value.toLowerCase(),
    };
  }
  const username = normalizeUsername(value);
  if (!username) return null;
  return { peer: username, label: username, key: usernameKey(username) };
}

function findResumeIndexFromProcessed(usersFromLists, processedUsers) {
  for (let index = 0; index < usersFromLists.length; index += 1) {
    const recipient = parseRecipientEntry(usersFromLists[index].raw);
    if (!recipient) continue;
    if (!processedUsers.has(recipient.key)) return index;
  }
  return usersFromLists.length;
}

async function sendMessagesToUser(client, user, outboundMessages, stickerDocument, settings, run) {
  if (stickerDocument) {
    await client.sendFile(user, { file: stickerDocument });
    if (outboundMessages.length > 0) {
      await sleepCancellable(Number(settings.interMessageDelayMs || RATE_LIMITS.INTER_MESSAGE_DELAY_MS), run);
    }
  }
  for (let index = 0; index < outboundMessages.length; index += 1) {
    if (run.stopRequested) break;
    await client.sendMessage(user, { message: outboundMessages[index] });
    if (index < outboundMessages.length - 1) {
      await sleepCancellable(Number(settings.interMessageDelayMs || RATE_LIMITS.INTER_MESSAGE_DELAY_MS), run);
    }
  }
}

async function loadStickerDocument(client, settings) {
  const stickerSets = await client.invoke(new Api.messages.GetAllStickers({ hash: 0 }));
  if (!stickerSets || !stickerSets.sets || !stickerSets.sets.length) return null;
  const setIndex = Number.parseInt(String(settings.stickerSetIndex || "").trim(), 10);
  const docIndex = Number.parseInt(String(settings.stickerDocIndex || "").trim(), 10);
  if (!Number.isFinite(setIndex) || !Number.isFinite(docIndex)) return null;
  const targetSet = stickerSets.sets[setIndex] || stickerSets.sets[0];
  const stickerSet = await client.invoke(new Api.messages.GetStickerSet({
    stickerset: new Api.InputStickerSetID({ id: targetSet.id, accessHash: targetSet.accessHash }),
    hash: 0,
  }));
  if (!stickerSet || !stickerSet.documents || !stickerSet.documents.length) return null;
  return stickerSet.documents[docIndex] || stickerSet.documents[0];
}

function loadProgressState(filePath, totalRows) {
  const parsed = readJson(filePath, {});
  return { nextIndex: clampNextIndex(parsed.nextIndex, totalRows) };
}

function saveProgressState(filePath, nextIndex, totalRows) {
  writeJson(filePath, { nextIndex: clampNextIndex(nextIndex, totalRows), totalRows: totalRows, updatedAt: new Date().toISOString() });
}

function clampNextIndex(value, totalRows) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  if (!Number.isFinite(totalRows) || totalRows < 0) return Math.floor(numeric);
  return Math.min(Math.floor(numeric), totalRows);
}

function loadProcessedUsers(filePath) {
  const parsed = readJson(filePath, {});
  if (!parsed || !Array.isArray(parsed.processed)) return new Set();
  return new Set(parsed.processed.map(function (x) { return String(x).toLowerCase(); }));
}

function saveProcessedUsers(filePath, processedUsersSet) {
  writeJson(filePath, { processed: Array.from(processedUsersSet).sort(), updatedAt: new Date().toISOString() });
}

function loadDailyStats(filePath) {
  const parsed = readJson(filePath, {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

function saveDailyStats(filePath, stats) {
  writeJson(filePath, stats || {});
}

function appendReportRow(reportPath, payload) {
  ensureDir(path.dirname(reportPath));
  if (!fs.existsSync(reportPath)) {
    fs.appendFileSync(reportPath, "Timestamp,User,Mode,Status\n", "utf8");
  }
  const row = [payload.timestamp, payload.user, payload.mode, payload.status].map(csvEscape).join(",");
  fs.appendFileSync(reportPath, row + "\n", "utf8");
}

function csvEscape(value) {
  const stringValue = String(value || "");
  if (/[,"\n]/.test(stringValue)) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function normalizeUsername(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const telegramLink = value.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,32})(?:[/?#].*)?$/i);
  if (telegramLink) return "@" + telegramLink[1];
  return value.startsWith("@") ? value : "@" + value;
}

function usernameKey(username) {
  return String(username || "").trim().toLowerCase();
}

function parseRecipientText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const invalid = [];
  let validCount = 0;
  let emptyCount = 0;
  lines.forEach(function (line, index) {
    const parsed = parseRecipientLine(line);
    if (parsed.status === "empty") emptyCount += 1;
    else if (parsed.status === "valid") validCount += 1;
    else invalid.push({ line: index + 1, value: line.trim() });
  });
  return { totalLines: lines.length, validCount: validCount, emptyCount: emptyCount, invalid: invalid };
}

function parseRecipientLine(raw) {
  const value = String(raw || "").trim();
  if (!value) return { status: "empty" };
  if (/^\d+:-?\d+$/.test(value)) return { status: "valid", type: "id-hash", value: value };
  const username = normalizeUsername(value);
  if (username && /^@[A-Za-z0-9_]{5,32}$/.test(username)) return { status: "valid", type: "username", value: username };
  return { status: "invalid" };
}

function isPeerFloodError(message) {
  return String(message || "").toUpperCase().indexOf("PEER_FLOOD") >= 0;
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.message === "string" && message.message.trim()) return message.message.trim();
  if (typeof message.text === "string" && message.text.trim()) return message.text.trim();
  return "";
}

async function getSpamBotStatus(client) {
  const commandUnixTime = Math.floor(Date.now() / 1000) - 3;
  await client.sendMessage(FLOOD_GUARD.SPAM_BOT_USERNAME, { message: "/start" });
  for (let attempt = 0; attempt < FLOOD_GUARD.POLL_ATTEMPTS; attempt += 1) {
    await sleep(attempt === 0 ? FLOOD_GUARD.INITIAL_WAIT_MS : FLOOD_GUARD.POLL_INTERVAL_MS);
    const messages = await client.getMessages(FLOOD_GUARD.SPAM_BOT_USERNAME, { limit: 10 });
    if (!messages || messages.length === 0) continue;
    const freshIncoming = messages.find(function (message) {
      return !message.out && Number.isFinite(Number(message.date)) && Number(message.date) >= commandUnixTime && extractMessageText(message);
    });
    const fallbackIncoming = messages.find(function (message) {
      return !message.out && extractMessageText(message);
    });
    const bestMessage = freshIncoming || fallbackIncoming;
    if (!bestMessage) continue;
    const statusText = extractMessageText(bestMessage);
    const lower = statusText.toLowerCase();
    return { hasRestriction: lower.indexOf("good news") < 0 && lower.indexOf("no limits") < 0, statusText: statusText };
  }
  return { hasRestriction: null, statusText: "Нет ответа от @SpamBot" };
}

async function getSpamBotMessageWithButtons(client, minUnixTime) {
  for (let attempt = 0; attempt < FLOOD_GUARD.POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(FLOOD_GUARD.POLL_INTERVAL_MS);
    const messages = await client.getMessages(FLOOD_GUARD.SPAM_BOT_USERNAME, { limit: 10 });
    if (!messages || messages.length === 0) continue;
    const freshIncoming = messages.find(function (message) {
      return !message.out && message.replyMarkup && Array.isArray(message.replyMarkup.rows) && Number.isFinite(Number(message.date)) && Number(message.date) >= minUnixTime;
    });
    const fallbackIncoming = messages.find(function (message) {
      return !message.out && message.replyMarkup && Array.isArray(message.replyMarkup.rows);
    });
    if (freshIncoming || fallbackIncoming) return freshIncoming || fallbackIncoming;
  }
  return null;
}

async function clickButtonByText(client, chat, msg, buttonText) {
  if (!msg || !msg.replyMarkup || !msg.replyMarkup.rows) return false;
  const peer = await client.getInputEntity(chat);
  const expectedText = buttonText.toLowerCase();
  const altMap = {
    "why was i reported": ["why was i reported", "как снять ограничения", "почему меня заблокировали"],
    "i understand, thanks": ["i understand, thanks", "это ошибка", "я понял спасибо"],
  };
  const expectedList = [expectedText].concat(altMap[expectedText] || []);
  const availableButtons = [];
  for (let r = 0; r < msg.replyMarkup.rows.length; r += 1) {
    const row = msg.replyMarkup.rows[r];
    for (let b = 0; b < row.buttons.length; b += 1) {
      const button = row.buttons[b];
      const label = typeof button.text === "string" ? button.text.trim() : "";
      if (!label) continue;
      availableButtons.push(label);
      const lower = label.toLowerCase();
      const matched = expectedList.some(function (needle) { return lower.indexOf(needle) >= 0; });
      if (!matched) continue;
      if (button.data !== undefined && button.data !== null && (!("length" in button.data) || button.data.length > 0)) {
        try {
          await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: peer, msgId: msg.id, data: button.data }));
          return true;
        } catch (error) {
          const message = getErrorMessage(error);
          if (message.toUpperCase().indexOf("DATA_INVALID") < 0) throw error;
        }
      }
      await client.sendMessage(chat, { message: label });
      return true;
    }
  }
  if (availableButtons.length > 0) log(`Кнопка "${buttonText}" не найдена. Доступные кнопки: ${availableButtons.join(" | ")}`);
  if (msg.replyMarkup.rows[0] && msg.replyMarkup.rows[0].buttons[0]) {
    const btn = msg.replyMarkup.rows[0].buttons[0];
    const label = typeof btn.text === "string" ? btn.text.trim() : "";
    if (btn.data !== undefined && btn.data !== null && (!("length" in btn.data) || btn.data.length > 0)) {
      await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: peer, msgId: msg.id, data: btn.data }));
      return true;
    }
    if (label) {
      await client.sendMessage(chat, { message: label });
      return true;
    }
  }
  return false;
}

async function attemptUnblock(client) {
  log("Пробую снять ограничение через диалог с @SpamBot...");
  const startUnixTime = Math.floor(Date.now() / 1000) - 2;
  await client.sendMessage(FLOOD_GUARD.SPAM_BOT_USERNAME, { message: "/start" });
  await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);
  let msg = await getSpamBotMessageWithButtons(client, startUnixTime);
  if (!msg) {
    log("Нет ответа с кнопками от @SpamBot");
    return false;
  }
  const initialText = extractMessageText(msg);
  const hadRestriction = initialText.toLowerCase().indexOf("good news") < 0 && initialText.toLowerCase().indexOf("no limits") < 0;
  if (!hadRestriction) {
    log("На аккаунте уже нет ограничений.");
    return { resolved: true, hadRestriction: hadRestriction, statusText: initialText };
  }
  log('Нажимаю "why was I reported?"...');
  let clicked = await clickButtonByText(client, FLOOD_GUARD.SPAM_BOT_USERNAME, msg, "why was I reported");
  if (!clicked) return false;
  await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);
  const secondStepUnixTime = Math.floor(Date.now() / 1000) - 2;
  msg = await getSpamBotMessageWithButtons(client, secondStepUnixTime);
  if (!msg) return false;
  log('Нажимаю "i understand, thanks"...');
  clicked = await clickButtonByText(client, FLOOD_GUARD.SPAM_BOT_USERNAME, msg, "i understand, thanks");
  if (!clicked) return false;
  await sleep(FLOOD_GUARD.INITIAL_WAIT_MS);
  const finalStatus = await getSpamBotStatus(client);
  log(`Финальный статус: ${finalStatus.statusText}`);
  return { resolved: finalStatus.hasRestriction === false, hadRestriction: hadRestriction, statusText: finalStatus.statusText };
}

async function startArchive(payload) {
  const slot = normalizeSlot(payload && payload.slot);
  const client = await getAuthorizedClient(slot);
  try {
    await archiveStaleDialogs(client, slot);
    cordova.channel.post("archive", { type: "done", slot: slot, message: "Архивация завершена." });
  } finally {
    await disconnectClient(client);
  }
}

function postArchiveError(slotRaw, error) {
  const slot = normalizeSlot(slotRaw);
  cordova.channel.post("archive", { type: "error", slot: slot, message: getErrorMessage(error) });
  log(getErrorMessage(error));
}

async function archiveStaleDialogs(client, slot) {
  const now = Date.now();
  const maxDialogs = Math.max(1, ARCHIVE_CONFIG.MAX_DIALOGS_PER_RUN || 30);
  const candidates = [];
  const skip = { notUser: 0, archived: 0, age: 0, outgoing: 0, length: 0, incoming: 0, noreply: 0, inputPeer: 0, empty: 0 };
  let scanned = 0;
  for await (const dialog of client.iterDialogs({ limit: (ARCHIVE_CONFIG.DIALOG_FETCH_BATCH || 100) * 20 })) {
    if (candidates.length >= maxDialogs) break;
    scanned += 1;
    if (!dialog.isUser) { skip.notUser += 1; continue; }
    if (dialog.archived) { skip.archived += 1; continue; }
    const msgs = await client.getMessages(dialog.entity, { limit: ARCHIVE_CONFIG.MESSAGES_SCAN_LIMIT || 20 });
    if (!msgs || msgs.length === 0) { skip.empty += 1; continue; }
    const lastMessageTs = Number(msgs[0] && msgs[0].date) * 1000 || now;
    const dialogAgeHours = (now - lastMessageTs) / (1000 * 60 * 60);
    if (dialogAgeHours > ARCHIVE_CONFIG.DIALOG_MAX_AGE_HOURS) { skip.age += 1; continue; }
    const outgoing = msgs.filter(function (m) { return m.out; });
    if (outgoing.length < ARCHIVE_CONFIG.MIN_OUTGOING) { skip.outgoing += 1; continue; }
    const longestOut = Math.max.apply(null, outgoing.map(function (m) { return ((m.message || m.text || "").length); }));
    if (longestOut < ARCHIVE_CONFIG.MIN_LONG_TEXT) { skip.length += 1; continue; }
    const firstOutIdx = msgs.findIndex(function (m) { return m.out; });
    const hasIncomingAfterFirstOut = msgs.slice(firstOutIdx + 1).some(function (m) { return !m.out; });
    if (hasIncomingAfterFirstOut) { skip.incoming += 1; continue; }
    const lastOut = outgoing.reduce(function (acc, m) { return Math.min(acc, Number(m.date) * 1000 || now); }, now);
    const noReplyHours = (now - lastOut) / (1000 * 60 * 60);
    if (noReplyHours < ARCHIVE_CONFIG.NO_REPLY_HOURS) { skip.noreply += 1; continue; }
    try {
      candidates.push(await client.getInputEntity(dialog.entity));
    } catch (error) {
      skip.inputPeer += 1;
    }
  }
  if (candidates.length === 0) {
    log(`Архивация: подходящих диалогов не найдено. Просмотрено ${scanned}.`);
    return;
  }
  log(`Архивация: перенос в архив ${candidates.length} диалогов...`);
  await client.invoke(new Api.folders.EditPeerFolders({
    folderPeers: candidates.map(function (peer) {
      return new Api.InputFolderPeer({ peer: peer, folderId: 1 });
    }),
  }));
  log("Архивация завершена.");
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function sleepCancellable(ms, run) {
  const deadline = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < deadline) {
    if (run && run.stopRequested) return;
    await sleep(Math.min(1000, deadline - Date.now()));
  }
}

function getErrorMessage(error) {
  if (error && typeof error.errorMessage === "string" && error.errorMessage.trim()) return error.errorMessage.trim();
  if (error && typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return String(error);
}

async function disconnectClient(client) {
  try {
    await client.disconnect();
  } catch (error) {
    // best effort
  }
}
