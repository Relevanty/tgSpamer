export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeUsername(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return null;
  }
  return value.startsWith("@") ? value : `@${value}`;
}

export function usernameKey(username) {
  return String(username).trim().toLowerCase();
}

export function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[,"\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}
