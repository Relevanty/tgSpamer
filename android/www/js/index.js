const accountSlots = ["acc1", "acc2", "acc3"];
const state = {
  engineReady: false,
  accounts: {},
  authSlot: null,
  selectedSlot: "acc1",
  settings: {},
  lists: [],
  messages: [],
  parserDialogs: {},
};

document.addEventListener("deviceready", onDeviceReady, false);
document.addEventListener("DOMContentLoaded", renderShell);

function onDeviceReady() {
  renderShell();
  logLine(`Cordova ${cordova.platformId}@${cordova.version}`);

  if (!window.nodejs) {
    setStatus("Node.js Mobile plugin недоступен");
    logLine("nodejs object is missing");
    return;
  }

  nodejs.channel.on("message", handleNodeMessage);
  nodejs.channel.on("status", function (message) {
    setStatus(message);
    logLine(message);
  });
  nodejs.channel.on("accounts", function (message) {
    state.accounts = message || {};
    renderAccounts();
  });
  nodejs.channel.on("settings", handleSettingsEvent);
  nodejs.channel.on("lists", handleListsEvent);
  nodejs.channel.on("parseResult", renderListCheckResult);
  nodejs.channel.on("auth", handleAuthEvent);
  nodejs.channel.on("parser", handleParserEvent);
  nodejs.channel.on("campaign", handleCampaignEvent);
  nodejs.channel.on("archive", handleArchiveEvent);

  nodejs.start("main.js", function (error) {
    if (error) {
      setStatus("Ошибка запуска Node worker");
      logLine(String(error));
      return;
    }

    state.engineReady = true;
    setStatus("Node worker запущен");
    sendToNode("accounts.status");
    sendToNode("lists.status");
    sendToNode("settings.get", { slot: state.selectedSlot });
  });
}

function renderShell() {
  bindTabs();
  bindControls();
  renderAccounts();
  renderListSelect();
  renderMessageSelect();
  renderDialogSelect();
  syncSlotSelects();
}

function bindControls() {
  bindClick("refreshButton", refreshAll);
  bindClick("refreshListsButton", function () {
    sendToNode("lists.status");
  });
  bindClick("saveListButton", saveListFromTextarea);
  bindClick("saveMessageButton", saveMessageFromTextarea);
  bindClick("checkListButton", function () {
    sendToNode("lists.parseText", { text: byId("listText").value });
  });
  bindClick("saveSettingsButton", function () {
    sendToNode("settings.save", collectSettingsPayload());
  });
  bindClick("startCampaignButton", function () {
    sendToNode("campaign.start", collectSettingsPayload());
  });
  bindClick("stopCampaignButton", function () {
    sendToNode("campaign.stop", { slot: state.selectedSlot });
  });
  bindClick("archiveButton", function () {
    sendToNode("archive.start", { slot: state.selectedSlot });
  });
  bindClick("loadDialogsButton", function () {
    const slot = byId("parserSlotSelect").value;
    setSelectedSlot(slot, false);
    sendToNode("parser.dialogs", { slot: slot });
  });
  bindClick("startParserButton", startParser);
  bindClick("stopParserButton", function () {
    sendToNode("parser.stop", { slot: byId("parserSlotSelect").value });
  });
  bindClick("sendPhoneButton", startAuth);
  bindClick("sendCodeButton", sendAuthCode);
  bindClick("sendPasswordButton", sendAuthPassword);
  bindClick("cancelAuthButton", cancelAuth);

  const settingsSlot = byId("settingsSlotSelect");
  if (settingsSlot) {
    settingsSlot.onchange = function () {
      setSelectedSlot(settingsSlot.value, false);
    };
  }

  const parserSlot = byId("parserSlotSelect");
  if (parserSlot) {
    parserSlot.onchange = function () {
      setSelectedSlot(parserSlot.value, false);
      renderDialogSelect();
    };
  }

  const listSelect = byId("settingsListSelect");
  if (listSelect) {
    listSelect.onchange = function () {
      const settings = state.settings[state.selectedSlot] || {};
      settings.listFile = listSelect.value;
      state.settings[state.selectedSlot] = settings;
    };
  }

  const fileInput = byId("listFileInput");
  if (fileInput) {
    fileInput.onchange = handleListFileImport;
  }

  const messageFileInput = byId("messageFileInput");
  if (messageFileInput) {
    messageFileInput.onchange = handleMessageFileImport;
  }

  const messageSelect = byId("messageFileSelect");
  if (messageSelect) {
    messageSelect.onchange = function () {
      const settings = state.settings[state.selectedSlot] || {};
      settings.messageFileNames = getSelectedOptions(messageSelect);
      state.settings[state.selectedSlot] = settings;
    };
  }
}

function bindClick(id, handler) {
  const element = byId(id);
  if (element) element.onclick = handler;
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.onclick = function () {
      activateTab(tab.dataset.tab);
    };
  });
}

function activateTab(tabId) {
  document.querySelectorAll(".tab").forEach(function (item) {
    item.classList.toggle("active", item.dataset.tab === tabId);
  });
  document.querySelectorAll(".panel").forEach(function (item) {
    item.classList.toggle("active", item.id === tabId);
  });
}

function refreshAll() {
  sendToNode("accounts.status");
  sendToNode("lists.status");
  sendToNode("settings.get", { slot: state.selectedSlot });
}

function setSelectedSlot(slotRaw, openSettings) {
  const slot = normalizeSlot(slotRaw);
  state.selectedSlot = slot;
  syncSlotSelects();
  renderAccounts();
  renderMessageSelect();
  renderDialogSelect();
  if (state.engineReady) {
    sendToNode("settings.get", { slot: slot });
  }
  if (openSettings) activateTab("settings");
}

function syncSlotSelects() {
  const settingsSlot = byId("settingsSlotSelect");
  const parserSlot = byId("parserSlotSelect");
  if (settingsSlot) settingsSlot.value = state.selectedSlot;
  if (parserSlot) parserSlot.value = state.selectedSlot;
}

function renderAccounts() {
  const grid = byId("accountGrid");
  if (!grid) return;

  grid.innerHTML = accountSlots.map(function (slot) {
    const account = state.accounts[slot] || {};
    const ready = Boolean(account.hasSession);
    const selected = state.selectedSlot === slot;
    const status = ready ? "сессия есть" : "не вошёл";
    return [
      '<article class="accountCard">',
      '  <div class="accountHeader">',
      `    <h2 class="accountName">${slot.toUpperCase()}</h2>`,
      `    <span class="badge ${ready ? "ready" : ""}">${status}</span>`,
      "  </div>",
      '  <div class="accountActions">',
      `    <button type="button" data-login="${slot}">${ready ? "Проверить" : "Войти"}</button>`,
      `    <button type="button" class="${selected ? "primary" : ""}" data-select="${slot}">${selected ? "Выбран" : "Выбрать"}</button>`,
      "  </div>",
      "</article>",
    ].join("");
  }).join("");

  grid.querySelectorAll("[data-login]").forEach(function (button) {
    button.onclick = function () {
      const slot = button.dataset.login;
      const account = state.accounts[slot] || {};
      setSelectedSlot(slot, false);
      if (account.hasSession) {
        sendToNode("auth.check", { slot: slot });
        return;
      }
      showAuthBox(slot);
    };
  });

  grid.querySelectorAll("[data-select]").forEach(function (button) {
    button.onclick = function () {
      setSelectedSlot(button.dataset.select, true);
      logLine(`Выбран слот ${button.dataset.select}`);
    };
  });
}

function handleSettingsEvent(settings) {
  if (!settings || !settings.slot) return;
  state.settings[settings.slot] = settings;
  if (settings.slot !== state.selectedSlot) return;

  setValue("messageText", settings.messageText || "");
  setValue("introText", settings.introText || "");
  setValue("delayInput", msToSeconds(settings.interUserDelayMs, 60));
  setValue("messageDelayInput", msToSeconds(settings.interMessageDelayMs, 3));
  setValue("usersPerBatchInput", Number(settings.usersPerBatch || 20));
  setValue("batchDelayInput", msToMinutes(settings.batchSleepMs, 30));
  setValue("stickerSetIndex", settings.stickerSetIndex || "");
  setValue("stickerDocIndex", settings.stickerDocIndex || "");
  setChecked("stickerEnabled", Boolean(settings.sendSticker));
  setChecked("sendTextFiles", Boolean(settings.sendTextFiles));
  setChecked("randomizeSingleText", Boolean(settings.randomizeSingleText));
  setChecked("sendIntroText", Boolean(settings.sendIntroText));
  renderListSelect();
  renderMessageSelect();
}

function handleListsEvent(payload) {
  state.lists = payload && Array.isArray(payload.lists) ? payload.lists : [];
  state.messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
  renderListSelect();
  renderMessageSelect();
}

function renderListSelect() {
  const select = byId("settingsListSelect");
  if (!select) return;

  const settings = state.settings[state.selectedSlot] || {};
  const current = settings.listFile || select.value || "";
  if (state.lists.length === 0) {
    select.innerHTML = '<option value="">Нет списков</option>';
    return;
  }

  select.innerHTML = state.lists.map(function (item) {
    const label = `${item.name} (${item.lineCount})`;
    return `<option value="${escapeAttr(item.name)}">${escapeHtml(label)}</option>`;
  }).join("");

  if (current && state.lists.some(function (item) { return item.name === current; })) {
    select.value = current;
  } else {
    select.value = state.lists[0].name;
  }
}

function renderMessageSelect() {
  const select = byId("messageFileSelect");
  if (!select) return;

  const settings = state.settings[state.selectedSlot] || {};
  const selected = normalizeNameList(settings.messageFileNames);
  if (state.messages.length === 0) {
    select.innerHTML = '<option value="">Нет message-файлов</option>';
    return;
  }

  select.innerHTML = state.messages.map(function (item) {
    const label = `${item.name} (${item.lineCount})`;
    return `<option value="${escapeAttr(item.name)}">${escapeHtml(label)}</option>`;
  }).join("");

  Array.from(select.options).forEach(function (option) {
    option.selected = selected.indexOf(option.value) >= 0;
  });
}

function handleListFileImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function () {
    byId("listText").value = String(reader.result || "");
    byId("listFileNameInput").value = normalizeTxtFileName(file.name);
    sendToNode("lists.parseText", { text: byId("listText").value });
    logLine(`Импортирован файл ${file.name}`);
  };
  reader.onerror = function () {
    logLine(`Не удалось прочитать файл ${file.name}`);
  };
  reader.readAsText(file);
}

function handleMessageFileImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function () {
    byId("messageText").value = String(reader.result || "").trim();
    byId("messageFileNameInput").value = normalizeTxtFileName(file.name);
    logLine(`Импортирован текст сообщения ${file.name}`);
  };
  reader.onerror = function () {
    logLine(`Не удалось прочитать файл ${file.name}`);
  };
  reader.readAsText(file);
}

function saveListFromTextarea() {
  const text = byId("listText").value;
  if (!text.trim()) {
    setListCheckText("Список пустой");
    return;
  }

  const fallback = `${state.selectedSlot}.txt`;
  const fileName = normalizeTxtFileName(byId("listFileNameInput").value || fallback);
  byId("listFileNameInput").value = fileName;
  sendToNode("lists.saveText", { slot: state.selectedSlot, fileName: fileName, text: text });
}

function saveMessageFromTextarea() {
  const text = byId("messageText").value;
  if (!text.trim()) {
    setText("campaignStatus", "Текст сообщения пустой");
    return;
  }

  const fileName = normalizeTxtFileName(byId("messageFileNameInput").value || "1.txt");
  byId("messageFileNameInput").value = fileName;
  sendToNode("messages.saveText", { slot: state.selectedSlot, fileName: fileName, text: text });
}

function collectSettingsPayload() {
  const startRowRaw = String(byId("startRowInput").value || "").trim();
  const payload = {
    slot: state.selectedSlot,
    listFile: byId("settingsListSelect").value,
    messageText: byId("messageText").value,
    sendIntroText: byId("sendIntroText").checked,
    introText: byId("introText").value,
    sendTextFiles: byId("sendTextFiles").checked,
    messageFileNames: getSelectedOptions(byId("messageFileSelect")),
    randomizeSingleText: byId("randomizeSingleText").checked,
    sendSticker: byId("stickerEnabled").checked,
    stickerSetIndex: byId("stickerSetIndex").value,
    stickerDocIndex: byId("stickerDocIndex").value,
    interUserDelayMs: secondsToMs(byId("delayInput").value, 60),
    interMessageDelayMs: secondsToMs(byId("messageDelayInput").value, 3),
    usersPerBatch: positiveInt(byId("usersPerBatchInput").value, 20),
    batchSleepMs: minutesToMs(byId("batchDelayInput").value, 30),
  };

  if (startRowRaw) {
    payload.startIndex = Math.max(0, positiveInt(startRowRaw, 1) - 1);
  }

  return payload;
}

function startParser() {
  const slot = byId("parserSlotSelect").value;
  setSelectedSlot(slot, false);

  const manualTarget = byId("manualTargetInput").value.trim();
  const dialogId = byId("dialogSelect").value;
  const payload = {
    slot: slot,
    source: manualTarget ? "manual" : "dialog",
    target: manualTarget,
    dialogId: dialogId,
    method: byId("parseMethodSelect").value,
    limit: positiveInt(byId("parseLimitInput").value, 100),
    outputName: byId("parseOutputInput").value,
  };

  sendToNode("parser.start", payload);
}

function handleParserEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.slot) {
    state.selectedSlot = normalizeSlot(event.slot);
    syncSlotSelects();
  }

  if (event.type === "dialogs") {
    state.parserDialogs[event.slot] = event.dialogs || [];
    renderDialogSelect();
  }

  const text = formatRunEvent(event, "Сбор");
  setText("parserStatus", text);
}

function renderDialogSelect() {
  const select = byId("dialogSelect");
  if (!select) return;

  const dialogs = state.parserDialogs[state.selectedSlot] || [];
  if (dialogs.length === 0) {
    select.innerHTML = '<option value="">Сначала загрузить чаты</option>';
    return;
  }

  select.innerHTML = dialogs.map(function (dialog) {
    return `<option value="${escapeAttr(dialog.id)}">${escapeHtml(dialog.name)}</option>`;
  }).join("");
}

function handleCampaignEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.slot) {
    state.selectedSlot = normalizeSlot(event.slot);
    syncSlotSelects();
  }
  setText("campaignStatus", formatRunEvent(event, "Рассылка"));
}

function handleArchiveEvent(event) {
  if (!event || typeof event !== "object") return;
  const text = formatRunEvent(event, "Архив");
  setText("campaignStatus", text);
}

function formatRunEvent(event, label) {
  const lines = [];
  const type = event.type || "status";
  lines.push(`${label}: ${type}`);
  if (event.message) lines.push(event.message);
  if (Number.isFinite(Number(event.current)) && Number.isFinite(Number(event.total))) {
    lines.push(`Строка: ${event.current}/${event.total}`);
  } else if (Number.isFinite(Number(event.nextIndex)) && Number.isFinite(Number(event.total))) {
    lines.push(`Следующая строка: ${Number(event.nextIndex) + 1}/${event.total}`);
  }
  if (Number.isFinite(Number(event.sent))) lines.push(`Отправлено: ${event.sent}`);
  if (Number.isFinite(Number(event.count))) lines.push(`Найдено: ${event.count}`);
  if (event.fileName) lines.push(`Файл: ${event.fileName}`);
  return lines.join("\n");
}

function showAuthBox(slot) {
  state.authSlot = normalizeSlot(slot);
  byId("authTitle").textContent = `Вход ${state.authSlot.toUpperCase()}`;
  byId("authBox").classList.remove("hidden");
  setAuthStage("phone", "Ожидание номера");
}

function startAuth() {
  const phone = byId("phoneInput").value.trim();
  if (!phone) {
    setAuthStatus("Введите номер");
    return;
  }
  setAuthStage("waiting", "Запрашиваю код Telegram");
  sendToNode("auth.start", { slot: state.authSlot, phone: phone });
}

function sendAuthCode() {
  const code = byId("codeInput").value.trim();
  if (!code) {
    setAuthStatus("Введите код");
    return;
  }
  setAuthStatus("Проверяю код");
  sendToNode("auth.code", { slot: state.authSlot, code: code });
}

function sendAuthPassword() {
  const password = byId("passwordInput").value;
  if (!password) {
    setAuthStatus("Введите пароль 2FA");
    return;
  }
  setAuthStatus("Проверяю пароль 2FA");
  sendToNode("auth.password", { slot: state.authSlot, password: password });
}

function cancelAuth() {
  if (state.authSlot) {
    sendToNode("auth.cancel", { slot: state.authSlot });
  }
  byId("authBox").classList.add("hidden");
  state.authSlot = null;
}

function handleAuthEvent(event) {
  if (!event || typeof event !== "object") return;

  if (event.slot) {
    state.authSlot = normalizeSlot(event.slot);
    state.selectedSlot = state.authSlot;
    syncSlotSelects();
    byId("authTitle").textContent = `Вход ${state.authSlot.toUpperCase()}`;
    byId("authBox").classList.remove("hidden");
  }

  if (event.type === "needCode") {
    setAuthStage("code", event.message || "Введите код Telegram");
  } else if (event.type === "needPassword") {
    setAuthStage("password", event.hint ? `2FA: ${event.hint}` : "Введите пароль 2FA");
  } else if (event.type === "done") {
    setAuthStage("done", "Сессия сохранена");
    sendToNode("accounts.status");
  } else if (event.type === "error") {
    setAuthStage("phone", event.message || "Ошибка авторизации");
    sendToNode("accounts.status");
  } else if (event.type === "status") {
    setAuthStatus(event.message || "");
  }
}

function setAuthStage(stage, message) {
  byId("authStage").textContent = stage;
  byId("phoneField").classList.toggle("hidden", stage !== "phone" && stage !== "waiting");
  byId("codeField").classList.toggle("hidden", stage !== "code");
  byId("passwordField").classList.toggle("hidden", stage !== "password");
  byId("sendPhoneButton").classList.toggle("hidden", stage !== "phone");
  byId("authCodeActions").classList.toggle("hidden", stage !== "code" && stage !== "password");
  byId("sendCodeButton").classList.toggle("hidden", stage !== "code");
  byId("sendPasswordButton").classList.toggle("hidden", stage !== "password");
  setAuthStatus(message);
}

function setAuthStatus(message) {
  byId("authStatus").textContent = message || "";
  if (message) logLine(message);
}

function renderListCheckResult(result) {
  if (!result) {
    setListCheckText("Нет результата");
    return;
  }

  const invalid = Array.isArray(result.invalid) ? result.invalid : [];
  const invalidPreview = invalid.slice(0, 4).map(function (item) {
    return `строка ${item.line}: ${item.value}`;
  }).join("\n");

  setListCheckText([
    `Всего строк: ${result.totalLines}`,
    `Получателей: ${result.validCount}`,
    `Пустых строк: ${result.emptyCount}`,
    `Проблемных строк: ${invalid.length}`,
    invalidPreview ? `\n${invalidPreview}` : "",
  ].filter(Boolean).join("\n"));
  logLine(`Список проверен: ${result.validCount}/${result.totalLines}`);
  sendToNode("lists.status");
}

function setListCheckText(text) {
  setText("listCheckResult", text);
}

function handleNodeMessage(message) {
  if (typeof message === "string") {
    logLine(message);
    return;
  }

  if (message && typeof message === "object") {
    logLine(JSON.stringify(message));
  }
}

function sendToNode(type, payload) {
  if (!state.engineReady || !window.nodejs) {
    logLine(`Node worker ещё не готов: ${type}`);
    return;
  }

  nodejs.channel.post(type, payload || {});
}

function setStatus(value) {
  setText("engineStatus", value || "");
}

function logLine(value) {
  const output = byId("logOutput");
  if (!output) return;

  const time = new Date().toLocaleTimeString();
  output.textContent = `${output.textContent}[${time}] ${value}\n`;
  output.scrollTop = output.scrollHeight;
}

function normalizeSlot(slotRaw) {
  const slot = String(slotRaw || "").trim().toLowerCase();
  return accountSlots.indexOf(slot) >= 0 ? slot : "acc1";
}

function normalizeTxtFileName(value) {
  let name = String(value || "list.txt")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) name = "list.txt";
  if (!name.toLowerCase().endsWith(".txt")) name += ".txt";
  return name.slice(0, 120);
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

function getSelectedOptions(select) {
  if (!select || !select.options) return [];
  return Array.from(select.options)
    .filter(function (option) {
      return option.selected && option.value;
    })
    .map(function (option) {
      return option.value;
    });
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function secondsToMs(value, fallbackSeconds) {
  const parsed = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackSeconds * 1000;
  return Math.round(parsed * 1000);
}

function minutesToMs(value, fallbackMinutes) {
  const parsed = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackMinutes * 60 * 1000;
  return Math.round(parsed * 60 * 1000);
}

function msToSeconds(value, fallbackSeconds) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackSeconds;
  return Math.round(parsed / 1000);
}

function msToMinutes(value, fallbackMinutes) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackMinutes;
  return Math.round(parsed / 60000);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function setValue(id, value) {
  const element = byId(id);
  if (element) element.value = value;
}

function setChecked(id, value) {
  const element = byId(id);
  if (element) element.checked = Boolean(value);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function byId(id) {
  return document.getElementById(id);
}
