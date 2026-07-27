import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "linux") {
  process.exit(0);
}

const glibcVersion = process.report?.getReport().header.glibcVersionRuntime;
if (!glibcVersion) {
  process.exit(0);
}

const [major, minor] = glibcVersion.split(".").map(Number);
const needsSourceBuild = major < 2 || (major === 2 && minor < 33);
if (!needsSourceBuild) {
  process.exit(0);
}

const packageDirectory = path.resolve("node_modules", "better-sqlite3");
if (!existsSync(path.join(packageDirectory, "package.json"))) {
  process.exit(0);
}

console.log(
  `glibc ${glibcVersion} detected; building better-sqlite3 from source.`,
);

function hasCommand(command) {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

const compilerVersions = ["13", "12", "11", "10"];
const compilerVersion = compilerVersions.find(
  (version) => hasCommand(`gcc-${version}`) && hasCommand(`g++-${version}`),
);

if (!compilerVersion && !hasCommand("g++")) {
  console.error(
    "A C++ compiler is required. Install one with: sudo apt install build-essential gcc-10 g++-10",
  );
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npmCommand,
  ["run", "build-release", "--prefix", packageDirectory],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(compilerVersion
        ? {
            CC: `gcc-${compilerVersion}`,
            CXX: `g++-${compilerVersion}`,
          }
        : {}),
    },
  },
);

if (result.error) {
  console.error(`Unable to build better-sqlite3: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
