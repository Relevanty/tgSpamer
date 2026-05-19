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

const parserPath = resolve("src/parser.js");
process.argv = [process.argv[0], parserPath, ...forwardedArgs];

await import("../src/parser.js");
