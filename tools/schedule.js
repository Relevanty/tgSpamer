import { spawn } from "node:child_process";
import { resolve } from "node:path";

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function msUntilNext(hour = 12, minute = 0) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function runOnce(envPathArg, extraArgs = []) {
  const envPath = envPathArg ? resolve(process.cwd(), envPathArg) : resolve(process.cwd(), ".env");
  const child = spawn(process.execPath, [resolve("tools/start.js"), envPath], {
    stdio: "inherit",
    env: { ...process.env },
  });
  return new Promise((resolvePromise) => {
    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(`run finished with exit code ${code}`);
      }
      resolvePromise();
    });
  });
}

async function main() {
  let envArg = null;
  for (const arg of process.argv.slice(2)) {
    if (!envArg) envArg = arg;
  }

  const hour = Number.parseInt(process.env.SCHEDULE_HOUR ?? "12", 10);
  const minute = Number.parseInt(process.env.SCHEDULE_MINUTE ?? "0", 10);
  const startImmediately =
    String(process.env.SCHEDULE_START_IMMEDIATELY ?? "false").toLowerCase() === "true";

  let first = true;
  while (true) {
    if (!first || !startImmediately) {
      const delay = msUntilNext(hour, minute);
      const mins = Math.round(delay / 60000);
      console.log(`Scheduler: жду до ${hour.toString().padStart(2, "0")}:${minute
        .toString()
        .padStart(2, "0")} (~${mins} мин).`);
      await sleep(delay);
    }
    first = false;
    console.log("Scheduler: запускаю рассылку...");
    await runOnce(envArg);
    console.log("Scheduler: запуск завершён, планирую следующий день.");
  }
}

main();
