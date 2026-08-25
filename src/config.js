import path from "node:path";

const profile = (process.env.PROFILE ?? "default").trim() || "default";
const storageMode = String(process.env.STORAGE_MODE ?? "shared").toLowerCase();
const storageBase =
  storageMode === "per_profile" ? path.resolve("storage", profile) : path.resolve("storage");
const reportPath = process.env.REPORT_FILE
  ? path.resolve(process.env.REPORT_FILE)
  : path.resolve(storageBase, "report.csv");

export const PATHS = {
  LISTS_DIR: path.resolve("lists"),
  MESSAGES_DIR: path.resolve("messages"),
  IMAGES_DIR: path.resolve("images"),
  REPORT_CSV: reportPath,
  PROCESSED_USERS_JSON: path.resolve(storageBase, "processed-users.json"),
  PROGRESS_STATE_JSON: path.resolve(storageBase, "progress-state.json"),
  DAILY_STATS_JSON: path.resolve(storageBase, "daily-stats.json"),
  CONNECTION_DEBUG_LOG: path.resolve(storageBase, "connection-debug.log"),
};

export const MESSAGE_CONFIG = {
    SEND_INTRO_TEXT: false,
    SEND_TEXT_FILES: true,
    RANDOMIZE_SINGLE_TEXT: false,
    TEXT_FILE_NAMES: ["1.txt"],
    INTRO_TEXT: ``,
    THIRD_MESSAGE_TEXT_FILE: process.env.THIRD_MESSAGE_TEXT_FILE ?? "",
    THIRD_MESSAGE_PHOTO_PATH: process.env.THIRD_MESSAGE_PHOTO_PATH ?? "",
};

export const STICKER_CONFIG = {
  ENABLED: true,
  SET_ID: process.env.STICKER_SET_ID ?? "",
  SET_ACCESS_HASH: process.env.STICKER_SET_ACCESS_HASH ?? "",
  DOC_ID: process.env.STICKER_DOC_ID ?? "",
  SET_INDEX: process.env.STICKER_SET_INDEX ?? "",
  STICKER_INDEX: process.env.STICKER_DOC_INDEX ?? "",
  INTERACTIVE_PROMPT: true,
  WAIT_TIMEOUT_MS: Number(process.env.STICKER_WAIT_TIMEOUT_MS ?? 180000),
  POLL_INTERVAL_MS: Number(process.env.STICKER_POLL_INTERVAL_MS ?? 2000),
};

export const RATE_LIMITS = {
  INTER_MESSAGE_DELAY_MS: 3000,
  INTER_USER_DELAY_MS: 60000,
  USERS_PER_BATCH: 20,
  BATCH_SLEEP_MS: 30 * 60 * 1000,
};

export const FLOOD_GUARD = {
    CHECK_SPAM_BOT_STATUS: true,
    SPAM_BOT_USERNAME: "@SpamBot",
    INITIAL_WAIT_MS: 2500,
    POLL_INTERVAL_MS: 1500,
    POLL_ATTEMPTS: 4,
    CHECK_INTERVAL_USERS: 5,
};

export const LOG_MODE = "Instant";

export const ARCHIVE_CONFIG = {
  NO_REPLY_HOURS: Number(process.env.ARCHIVE_NO_REPLY_HOURS ?? 24),
  DIALOG_MAX_AGE_HOURS: Number(process.env.ARCHIVE_DIALOG_MAX_AGE_HOURS ?? 168),
  MIN_OUTGOING: Number(process.env.ARCHIVE_MIN_OUTGOING ?? 2),
  MIN_LONG_TEXT: Number(process.env.ARCHIVE_MIN_LONG_TEXT ?? 200),
  MAX_DIALOGS_PER_RUN: Number(process.env.ARCHIVE_MAX_DIALOGS ?? 200),
  DIALOG_FETCH_BATCH: Number(process.env.ARCHIVE_DIALOG_FETCH_BATCH ?? 100),
  DEBUG: String(process.env.ARCHIVE_DEBUG ?? "true").toLowerCase() === "true",
  MESSAGES_SCAN_LIMIT: Number(process.env.ARCHIVE_MESSAGES_SCAN_LIMIT ?? 30),
};

export const PROFILE = profile;
export const STORAGE_MODE = storageMode;
