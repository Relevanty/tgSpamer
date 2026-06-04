import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function loadMessageFiles(messagesDir) {
  const entries = await readdir(messagesDir, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  const messages = [];

  for (const fileName of files) {
    const content = await readFile(path.join(messagesDir, fileName), "utf8");
    const trimmed = content.trim();
    if (trimmed) {
      messages.push({ fileName, text: trimmed });
    }
  }

  return messages;
}

export async function loadListUsers(listsDir) {
  const entries = await readdir(listsDir, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  const users = [];

  for (const fileName of files) {
    const content = await readFile(path.join(listsDir, fileName), "utf8");
    for (const line of content.split(/\r?\n/)) {
      users.push({ fileName, raw: line });
    }
  }

  return users;
}

export async function loadUsersFromFile(listsDir, fileName) {
  const content = await readFile(path.join(listsDir, fileName), "utf8");
  const users = [];
  for (const line of content.split(/\r?\n/)) {
    users.push({ fileName, raw: line });
  }
  return users;
}
