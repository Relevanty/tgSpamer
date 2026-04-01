import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function clampNextIndex(value, totalRows) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  if (!Number.isFinite(totalRows) || totalRows < 0) {
    return Math.floor(numeric);
  }

  return Math.min(Math.floor(numeric), totalRows);
}

export async function loadProgressState(filePath, totalRows) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      nextIndex: clampNextIndex(parsed?.nextIndex, totalRows),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { nextIndex: 0 };
    }
    throw error;
  }
}

export async function saveProgressState(filePath, nextIndex, totalRows) {
  await mkdir(dirname(filePath), { recursive: true });
  const payload = {
    nextIndex: clampNextIndex(nextIndex, totalRows),
    totalRows,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
