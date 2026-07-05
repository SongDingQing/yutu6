#!/usr/bin/env node

import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";

const [input, output, font = "微软雅黑"] = process.argv.slice(2);

if (!input || !output) {
  console.error("Usage: normalize_pptx_fonts.mjs <input.pptx> <output.pptx> [font]");
  process.exit(2);
}

const temp = await mkdtemp(join(tmpdir(), "yuhua-pptx-fonts-"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error([`${command} ${args.join(" ")} failed`, result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

try {
  run("unzip", ["-q", input, "-d", temp], process.cwd());

  for await (const file of walk(temp)) {
    const ext = extname(file).toLowerCase();
    if (![".xml", ".rels"].includes(ext)) continue;

    const before = await readFile(file, "utf8");
    const after = before
      .replace(/typeface="[^"]*"/g, `typeface="${font}"`)
      .replace(/Calibri Light/g, font)
      .replace(/Calibri/g, font);

    if (after !== before) {
      await writeFile(file, after, "utf8");
    }
  }

  await rm(output, { force: true });
  run("zip", ["-qr", output, "."], temp);
} finally {
  await rm(temp, { recursive: true, force: true });
}
