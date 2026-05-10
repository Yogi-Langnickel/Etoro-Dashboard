import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "scripts", "test"];
const extensions = new Set([".js", ".mjs"]);

async function collectFiles(directory) {
  let entries = [];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(path);
      }

      return extensions.has(path.slice(path.lastIndexOf("."))) ? [path] : [];
    }),
  );

  return files.flat();
}

const files = (await Promise.all(roots.map(collectFiles))).flat();

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
