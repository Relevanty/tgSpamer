import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const defaultListPath = path.join(repoRoot, "lists", "ВШЭ.txt");
const listPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultListPath;

const content = await readFile(listPath, "utf8");
const result = parseRecipientText(content);

console.log(JSON.stringify({ listPath, ...result }, null, 2));

function parseRecipientText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const invalid = [];
  let validCount = 0;
  let emptyCount = 0;

  lines.forEach((line, index) => {
    const parsed = parseRecipientLine(line);
    if (parsed.status === "empty") {
      emptyCount += 1;
    } else if (parsed.status === "valid") {
      validCount += 1;
    } else {
      invalid.push({ line: index + 1, value: line.trim() });
    }
  });

  return {
    totalLines: lines.length,
    validCount,
    emptyCount,
    invalid,
  };
}

function parseRecipientLine(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return { status: "empty" };
  }

  if (/^\d+:-?\d+$/.test(value)) {
    return { status: "valid", type: "id-hash", value };
  }

  const username = normalizeUsername(value);
  if (username && /^@[A-Za-z0-9_]{5,32}$/.test(username)) {
    return { status: "valid", type: "username", value: username };
  }

  return { status: "invalid" };
}

function normalizeUsername(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return null;
  }

  const telegramLink = value.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,32})(?:[/?#].*)?$/i);
  if (telegramLink) {
    return `@${telegramLink[1]}`;
  }

  return value.startsWith("@") ? value : `@${value}`;
}
