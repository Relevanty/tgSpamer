import { spawn } from "node:child_process";
import process from "node:process";
import {
  configExists,
  getConfigLabel,
  readSequentialConfig,
  SEQUENTIAL_CONFIG_PATH,
} from "./sequential-config.js";

function runAccount(configPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["tools/start.js", configPath], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const configPaths = await readSequentialConfig();

if (configPaths.length === 0) {
  console.log("Порядок последовательного запуска не настроен.");
  console.log("Сначала откройте настройка последовательного запуска.bat.");
  console.log(`Файл настройки: ${SEQUENTIAL_CONFIG_PATH}`);
  process.exit(1);
}

const missing = configPaths.filter((configPath) => !configExists(configPath));
if (missing.length > 0) {
  console.log("Не найдены некоторые настроенные конфиги:");
  missing.forEach((configPath) => console.log(`- ${configPath}`));
  console.log("");
  console.log("Запустите настройку последовательного запуска заново.");
  process.exit(1);
}

console.log("Последовательный запуск рассылки.");
console.log(`Порядок: ${configPaths.map(getConfigLabel).join(" -> ")}`);
console.log("");

const results = [];

for (const configPath of configPaths) {
  const label = getConfigLabel(configPath);
  console.log(`===== Запуск ${label} =====`);
  const exitCode = await runAccount(configPath);
  results.push({ label, exitCode });
  console.log("");
  console.log(`${label} завершен с кодом ${exitCode}.`);
  console.log("");
}

console.log("Последовательный запуск завершен.");
results.forEach((result) => {
  console.log(`${result.label}: ${result.exitCode}`);
});

const failed = results.find((result) => result.exitCode !== 0);
process.exitCode = failed ? failed.exitCode || 1 : 0;
