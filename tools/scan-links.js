import { resolve } from "node:path";

let envArg = null;
const forwardedArgs = [];

for (const arg of process.argv.slice(2)) {
  if (!envArg && (arg === ".env" || arg.startsWith(".env.") || arg.endsWith(".env"))) {
    envArg = arg;
  } else {
    forwardedArgs.push(arg);
  }
}

const envPath = envArg ? resolve(process.cwd(), envArg) : resolve(process.cwd(), ".env");
process.env.DOTENV_CONFIG_PATH = envPath;

const scannerPath = resolve("src/linkScanner.js");
process.argv = [process.argv[0], scannerPath, ...forwardedArgs];

await import("../src/linkScanner.js");
