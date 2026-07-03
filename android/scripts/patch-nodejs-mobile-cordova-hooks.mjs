import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoots = [
  path.resolve(__dirname, "..", "plugins", "nodejs-mobile-cordova"),
  path.resolve(__dirname, "..", "node_modules", "nodejs-mobile-cordova"),
];

const hookPatches = [
  {
    relativePath: "install/hooks/both/after-prepare-patch-npm-packages.js",
    patches: [
      [
        "new platformAPI();",
        "new platformAPI(platform, platformPath, context.events);",
      ],
    ],
  },
  {
    relativePath: "install/hooks/both/after-prepare-native-modules-preference.js",
    patches: [
      [
        "new platformAPI();",
        "new platformAPI(platform, platformPath, context.events);",
      ],
    ],
  },
  {
    relativePath: "install/hooks/android/after-prepare-create-macOS-builder-helper.js",
    patches: [
      [
        "new platformAPI();",
        "new platformAPI(platform, platformPath, context.events);",
      ],
    ],
  },
  {
    relativePath: "install/hooks/android/before-plugin-install.js",
    patches: [
      [
        "  if (fs.existsSync(input_filename)) {\n",
        "  if (!fs.existsSync(input_filename)) {\n    callback();\n    return;\n  }\n\n  if (fs.existsSync(input_filename)) {\n",
      ],
    ],
  },
];

for (const pluginRoot of pluginRoots) {
  if (!existsSync(pluginRoot)) {
    continue;
  }

  for (const { relativePath, patches } of hookPatches) {
    const filePath = path.join(pluginRoot, relativePath);
    if (!existsSync(filePath)) {
      continue;
    }

    let source = await readFile(filePath, "utf8");
    let patched = source;
    for (const [search, replacement] of patches) {
      patched = patched.replace(search, replacement);
    }

    if (patched !== source) {
      await writeFile(filePath, patched, "utf8");
      console.log(`patched ${path.relative(path.resolve(__dirname, ".."), filePath)}`);
    }
  }
}
