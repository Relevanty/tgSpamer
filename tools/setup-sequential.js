import readline from "node:readline";
import process from "node:process";
import {
  findEnvConfigs,
  getConfigLabel,
  readSequentialConfig,
  SEQUENTIAL_CONFIG_PATH,
  writeSequentialConfig,
} from "./sequential-config.js";

const configs = await findEnvConfigs();
const savedOrder = await readSequentialConfig();
const availablePaths = new Set(configs.map((config) => config.path));
const selected = savedOrder.filter((configPath) => availablePaths.has(configPath));

let cursor = 0;
let message = "";
let closing = false;

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() {
  process.stdout.write("\x1b[?25l");
}

function showCursor() {
  process.stdout.write("\x1b[?25h");
}

function render() {
  clearScreen();
  hideCursor();

  console.log("Настройка последовательного запуска");
  console.log("");
  console.log("Стрелки вверх/вниз - перемещение. Enter - выбрать или убрать.");
  console.log("Выберите Сохранить, чтобы сохранить порядок.");
  console.log("q или Esc - выйти без сохранения.");
  console.log("");

  configs.forEach((config, index) => {
    const orderIndex = selected.indexOf(config.path);
    const order = orderIndex >= 0 ? ` (${orderIndex + 1})` : "";
    const pointer = cursor === index ? " =<" : "";
    console.log(`${config.label}${order}${pointer}`);
  });

  console.log("");
  console.log(`Сохранить${cursor === configs.length ? " =<" : ""}`);

  if (message) {
    console.log("");
    console.log(message);
  }
}

function toggleSelected(configPath) {
  const selectedIndex = selected.indexOf(configPath);
  if (selectedIndex >= 0) {
    selected.splice(selectedIndex, 1);
    return;
  }

  selected.push(configPath);
}

function closeWithoutSave() {
  if (closing) {
    return;
  }
  closing = true;
  cleanupTerminal();
  process.exit(0);
}

async function saveAndExit() {
  if (closing) {
    return;
  }

  if (selected.length === 0) {
    message = "Перед сохранением выберите хотя бы один конфиг.";
    render();
    return;
  }

  closing = true;
  await writeSequentialConfig(selected);
  cleanupTerminal();
  process.exit(0);
}

function cleanupTerminal() {
  showCursor();
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}

if (configs.length === 0) {
  console.log("Конфиги аккаунтов не найдены.");
  console.log("Создайте аккаунт через войти.bat или добавьте .env.* в корень проекта.");
  process.exit(1);
}

if (!process.stdin.isTTY) {
  console.log("Нужен интерактивный терминал.");
  process.exit(1);
}

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on("keypress", (_input, key) => {
  if (closing) {
    return;
  }

  if (key?.ctrl && key.name === "c") {
    closeWithoutSave();
    return;
  }

  if (key?.name === "escape" || key?.name === "q") {
    closeWithoutSave();
    return;
  }

  if (key?.name === "up") {
    cursor = cursor <= 0 ? configs.length : cursor - 1;
    message = "";
    render();
    return;
  }

  if (key?.name === "down") {
    cursor = cursor >= configs.length ? 0 : cursor + 1;
    message = "";
    render();
    return;
  }

  if (key?.name === "return") {
    if (cursor === configs.length) {
      saveAndExit().catch((error) => {
        cleanupTerminal();
        console.error(error?.message || error);
        process.exit(1);
      });
      return;
    }

    toggleSelected(configs[cursor].path);
    message = "";
    render();
  }
});

process.once("SIGINT", closeWithoutSave);
process.once("SIGTERM", closeWithoutSave);

render();
