import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function loadProcessedUsers(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.processed)) {
      return new Set();
    }
    return new Set(parsed.processed.map((x) => String(x).toLowerCase()));
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

export async function saveProcessedUsers(filePath, processedUsersSet) {
  await mkdir(dirname(filePath), { recursive: true });
  const payload = {
    processed: Array.from(processedUsersSet).sort(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
