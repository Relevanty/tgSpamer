import fs from "node:fs/promises";
import path from "node:path";
import input from "input";

const LISTS_DIR = path.resolve("lists");

function normalizeLine(line) {
  return String(line ?? "").trim().toLowerCase();
}

function splitLines(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function loadListFile(fileName) {
  const filePath = path.join(LISTS_DIR, fileName);
  const content = await fs.readFile(filePath, "utf8");
  return splitLines(content);
}

async function selectListFile(message, excludedFileName = "") {
  const entries = await fs.readdir(LISTS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .filter((name) => name !== excludedFileName)
    .sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));

  if (files.length === 0) {
    throw new Error(`В папке ${LISTS_DIR} нет txt-файлов.`);
  }

  return input.select(
    message,
    files.map((fileName) => ({ name: fileName, value: fileName })),
  );
}

function buildOutputName(sourceFileName, excludeFileName) {
  const source = path.parse(sourceFileName);
  const exclude = path.parse(excludeFileName);
  return `${source.name}_minus_${exclude.name}.txt`;
}

async function main() {
  await fs.mkdir(LISTS_DIR, { recursive: true });

  const sourceFileName = await selectListFile("Из какого файла убрать повторяшки?");
  const excludeFileName = await selectListFile("С каким файлом сравнить и исключить совпадения?", sourceFileName);

  const sourceLines = await loadListFile(sourceFileName);
  const excludeLines = await loadListFile(excludeFileName);
  const excludeSet = new Set(excludeLines.map(normalizeLine));
  const seen = new Set();
  const result = [];

  let removedBySecondFile = 0;
  let removedInsideSource = 0;

  for (const line of sourceLines) {
    const key = normalizeLine(line);

    if (excludeSet.has(key)) {
      removedBySecondFile += 1;
      continue;
    }

    if (seen.has(key)) {
      removedInsideSource += 1;
      continue;
    }

    seen.add(key);
    result.push(line);
  }

  const defaultOutputName = buildOutputName(sourceFileName, excludeFileName);
  const outputFileNameRaw = await input.text(`Куда сохранить результат [${defaultOutputName}]: `, {
    default: defaultOutputName,
  });
  let outputFileName = String(outputFileNameRaw ?? "").trim() || defaultOutputName;
  if (!outputFileName.toLowerCase().endsWith(".txt")) {
    outputFileName += ".txt";
  }

  const outputPath = path.join(LISTS_DIR, outputFileName);
  await fs.writeFile(outputPath, result.length > 0 ? `${result.join("\n")}\n` : "", "utf8");

  console.log("");
  console.log(`Исходный файл: ${sourceFileName}`);
  console.log(`Файл исключений: ${excludeFileName}`);
  console.log(`Было строк: ${sourceLines.length}`);
  console.log(`Удалено совпадений со вторым файлом: ${removedBySecondFile}`);
  console.log(`Удалено дублей внутри исходного файла: ${removedInsideSource}`);
  console.log(`Осталось строк: ${result.length}`);
  console.log(`Сохранено: ${outputPath}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
