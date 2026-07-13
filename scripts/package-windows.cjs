const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const tempOutput = path.join(os.tmpdir(), "voxel-grove-release");
const releaseOutput = path.join(projectRoot, "release");
const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const getArgValue = (name) => {
  const prefix = `${name}=`;
  const inlineValue = args.find((arg) => arg.startsWith(prefix));
  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }

  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const mode = hasArg("--dir")
  ? "dir"
  : hasArg("--portable")
    ? "portable"
    : "installer";
const shouldBumpVersion = mode !== "dir" && !hasArg("--no-bump");
const shouldCleanRelease = mode !== "dir" && !hasArg("--keep-release");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolvePackageBin(packageName, binName = packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`, {
    paths: [projectRoot],
  });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const bin = packageJson.bin;
  const relativeBinPath =
    typeof bin === "string" ? bin : bin && bin[binName];

  if (!relativeBinPath) {
    throw new Error(`Could not find ${binName} bin for ${packageName}`);
  }

  return path.resolve(path.dirname(packageJsonPath), relativeBinPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function cleanPath(target, allowedRoot) {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(allowedRoot);

  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedTarget}`);
  }

  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function bumpSemver(version, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!match) {
    throw new Error(`Cannot auto-bump non-standard version: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (part === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (part === "minor") {
    minor += 1;
    patch = 0;
  } else if (part === "patch") {
    patch += 1;
  } else {
    throw new Error(`Unknown version bump: ${part}`);
  }

  return `${major}.${minor}.${patch}`;
}

function updatePackageVersion() {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageLockPath = path.join(projectRoot, "package-lock.json");
  const packageJson = readJson(packageJsonPath);
  const explicitVersion = getArgValue("--version");
  const bumpPart = getArgValue("--bump") || "patch";
  const nextVersion = explicitVersion || bumpSemver(packageJson.version, bumpPart);

  packageJson.version = nextVersion;
  writeJson(packageJsonPath, packageJson);

  if (fs.existsSync(packageLockPath)) {
    const packageLock = readJson(packageLockPath);
    packageLock.version = nextVersion;

    if (packageLock.packages && packageLock.packages[""]) {
      packageLock.packages[""].version = nextVersion;
    }

    writeJson(packageLockPath, packageLock);
  }

  console.log(`Packaging Voxel Grove ${nextVersion}`);
  return nextVersion;
}

function copyTopLevelArtifacts() {
  fs.mkdirSync(releaseOutput, { recursive: true });

  const files = fs
    .readdirSync(tempOutput)
    .filter((name) => fs.statSync(path.join(tempOutput, name)).isFile());

  if (files.length === 0) {
    throw new Error(`No package artifacts were created in ${tempOutput}`);
  }

  for (const file of files) {
    const source = path.join(tempOutput, file);
    const destination = path.join(releaseOutput, file);
    fs.copyFileSync(source, destination);
    console.log(`Copied ${destination}`);
  }
}

function copyUnpackedApp() {
  const source = path.join(tempOutput, "win-unpacked");
  const destination = path.join(releaseOutput, "win-unpacked");

  if (!fs.existsSync(source)) {
    throw new Error(`No unpacked app was created in ${source}`);
  }

  fs.mkdirSync(releaseOutput, { recursive: true });
  cleanPath(destination, releaseOutput);
  fs.cpSync(source, destination, { recursive: true });
  console.log(`Copied ${destination}`);
}

const target = mode === "portable" ? "portable" : "nsis";
const builderModeArgs = mode === "dir" ? ["--dir"] : ["--win", target];

if (shouldBumpVersion) {
  updatePackageVersion();
} else {
  console.log(`Packaging Voxel Grove ${readJson(path.join(projectRoot, "package.json")).version}`);
}

cleanPath(tempOutput, os.tmpdir());

if (shouldCleanRelease) {
  cleanPath(releaseOutput, projectRoot);
}

run(process.execPath, [resolvePackageBin("vite", "vite"), "build"]);
run(process.execPath, [
  resolvePackageBin("electron-builder", "electron-builder"),
  ...builderModeArgs,
  `--config.directories.output=${tempOutput}`,
]);

if (mode === "dir") {
  copyUnpackedApp();
} else {
  copyTopLevelArtifacts();
}
