import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const SEQUENTIAL_CONFIG_PATH = path.resolve("storage", "sequential-accounts.txt");

const CONFIG_SEARCH_DIRS = [".", "configs", "accounts"];

function isTempEnvFile(fileName) {
  return fileName.startsWith(".env.tmp-login-") || fileName.includes("tmp-login-info");
}

function isRootEnvConfig(fileName) {
  return fileName.startsWith(".env.") && fileName !== ".env.example" && !isTempEnvFile(fileName);
}

function isNestedEnvConfig(fileName) {
  return (
    (fileName.startsWith(".env.") || fileName.endsWith(".env")) &&
    fileName !== ".env.example" &&
    !isTempEnvFile(fileName)
  );
}

export function normalizeConfigPath(configPath) {
  return path.relative(process.cwd(), path.resolve(configPath)).replace(/\\/g, "/");
}

export function getConfigLabel(configPath) {
  const normalized = normalizeConfigPath(configPath);
  const dirName = path.dirname(normalized).replace(/\\/g, "/");
  const fileName = path.basename(normalized);
  let label = fileName;

  if (fileName.startsWith(".env.")) {
    label = fileName.slice(".env.".length);
  } else if (fileName.endsWith(".env")) {
    label = fileName.slice(0, -".env".length);
  }

  if (!dirName || dirName === ".") {
    return label;
  }

  return `${dirName}/${label}`;
}

export function configExists(configPath) {
  return existsSync(path.resolve(configPath));
}

export async function findEnvConfigs() {
  const configs = [];
  const seen = new Set();

  for (const searchDir of CONFIG_SEARCH_DIRS) {
    const absoluteDir = path.resolve(searchDir);
    if (!existsSync(absoluteDir)) {
      continue;
    }

    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const isConfig =
        searchDir === "." ? isRootEnvConfig(entry.name) : isNestedEnvConfig(entry.name);
      if (!isConfig) {
        continue;
      }

      const configPath = normalizeConfigPath(path.join(searchDir, entry.name));
      if (seen.has(configPath)) {
        continue;
      }

      seen.add(configPath);
      configs.push({
        path: configPath,
        label: getConfigLabel(configPath),
      });
    }
  }

  configs.sort((left, right) => left.label.localeCompare(right.label, "en"));
  return configs;
}

export async function readSequentialConfig() {
  try {
    const raw = await fs.readFile(SEQUENTIAL_CONFIG_PATH, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => normalizeConfigPath(line));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeSequentialConfig(configPaths) {
  await fs.mkdir(path.dirname(SEQUENTIAL_CONFIG_PATH), { recursive: true });
  const content = `${configPaths.map(normalizeConfigPath).join("\n")}\n`;
  await fs.writeFile(SEQUENTIAL_CONFIG_PATH, content, "utf8");
}
