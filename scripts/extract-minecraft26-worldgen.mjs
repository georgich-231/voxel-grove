import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";

const VERSION = "26.2";
const EXPECTED_SERVER_SHA1 = "823e2250d24b3ddac457a60c92a6a941943fcd6a";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const outputPath = path.join(projectRoot, "src", "generated", "minecraft26WorldgenData.js");

const candidates = [
  process.argv[2],
  process.env.MINECRAFT_26_2_SERVER_JAR,
  path.join(projectRoot, "vendor", `minecraft-server-${VERSION}.jar`),
  path.join(os.tmpdir(), `minecraft-server-${VERSION}.jar`),
  process.env.APPDATA && path.join(process.env.APPDATA, ".minecraft", "versions", VERSION, `${VERSION}.jar`),
].filter(Boolean);

const jarPath = candidates.find((candidate) => fs.existsSync(candidate));
if (!jarPath) {
  if (fs.existsSync(outputPath)) {
    console.log(`Using existing generated Minecraft ${VERSION} worldgen data.`);
    process.exit(0);
  }
  throw new Error([
    `Minecraft Java ${VERSION} was not found.`,
    `Download the official ${VERSION} server JAR, then set MINECRAFT_26_2_SERVER_JAR`,
    `or run: npm run worldgen:extract -- C:\\path\\to\\server.jar`,
  ].join("\n"));
}

const outerBuffer = fs.readFileSync(jarPath);
const outerSha1 = crypto.createHash("sha1").update(outerBuffer).digest("hex");
const outerZip = new AdmZip(outerBuffer);
const nestedPath = `META-INF/versions/${VERSION}/server-${VERSION}.jar`;
const nestedEntry = outerZip.getEntry(nestedPath);
const dataZip = nestedEntry ? new AdmZip(nestedEntry.getData()) : outerZip;

if (nestedEntry && outerSha1 !== EXPECTED_SERVER_SHA1) {
  throw new Error(`Unexpected Minecraft ${VERSION} server JAR SHA-1: ${outerSha1}`);
}

function resourceId(entryName, folder) {
  const prefix = `data/minecraft/worldgen/${folder}/`;
  return `minecraft:${entryName.slice(prefix.length, -".json".length)}`;
}

function readJson(entry) {
  return JSON.parse(entry.getData().toString("utf8"));
}

function collect(folder) {
  const prefix = `data/minecraft/worldgen/${folder}/`;
  return dataZip.getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.startsWith(prefix) && entry.entryName.endsWith(".json"))
    .map((entry) => [resourceId(entry.entryName, folder), readJson(entry)])
    .sort(([left], [right]) => left.localeCompare(right));
}

const settingsEntry = dataZip.getEntry("data/minecraft/worldgen/noise_settings/overworld.json");
if (!settingsEntry) throw new Error(`The selected JAR does not contain Minecraft ${VERSION} Overworld settings.`);

const officialSettings = readJson(settingsEntry);
const data = {
  version: VERSION,
  sourceSha1: outerSha1,
  noise: collect("noise"),
  densityFunctions: collect("density_function"),
  settings: {
    sea_level: officialSettings.sea_level,
    disable_mob_generation: officialSettings.disable_mob_generation,
    aquifers_enabled: officialSettings.aquifers_enabled,
    ore_veins_enabled: officialSettings.ore_veins_enabled,
    legacy_random_source: officialSettings.legacy_random_source,
    default_block: officialSettings.default_block,
    default_fluid: officialSettings.default_fluid,
    surface_rule: officialSettings.surface_rule,
    noise: officialSettings.noise,
    noise_router: officialSettings.noise_router,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const source = [
  `// Generated locally from the official Minecraft Java ${VERSION} JAR.`,
  "// Do not edit or redistribute this generated file; rerun npm run worldgen:extract.",
  `export const MINECRAFT_26_2_WORLDGEN = Object.freeze(${JSON.stringify(data)});`,
  "",
].join("\n");
fs.writeFileSync(outputPath, source, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)} from Minecraft Java ${VERSION} (${outerSha1}).`);
