import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// Run against `pnpm preview --port 8787` after `pnpm build`.
const url = process.argv[2] ?? "http://127.0.0.1:8787";
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("Run this script with pnpm test:lighthouse");
const standalone = pnpm.endsWith(".exe");
mkdirSync("lighthouse-reports", { recursive: true });
for (const device of ["mobile", "desktop"]) {
  const result = spawnSync(
    standalone ? pnpm : process.execPath,
    [
      ...(standalone ? [] : [pnpm]),
      "dlx",
      "lighthouse@13.6.0",
      url,
      "--chrome-flags=--headless=new",
      "--output=json",
      "--output=html",
      `--output-path=lighthouse-reports/${device}`,
      ...(device === "desktop" ? ["--preset=desktop"] : []),
    ],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
