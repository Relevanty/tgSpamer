import { access, appendFile } from "node:fs/promises";
import { constants } from "node:fs";
import { csvEscape } from "./utils.js";

const REPORT_HEADER = "Timestamp,User,Mode,Status\n";

export async function appendReportRow(reportPath, { timestamp, user, mode, status }) {
  try {
    await access(reportPath, constants.F_OK);
  } catch {
    await appendFile(reportPath, REPORT_HEADER, "utf8");
  }

  const row = [timestamp, user, mode, status].map(csvEscape).join(",");
  await appendFile(reportPath, `${row}\n`, "utf8");
}
