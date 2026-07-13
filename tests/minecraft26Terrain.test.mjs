import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  MINECRAFT_26_2_TERRAIN_TARGET,
  Minecraft26OverworldTerrain,
} from "../src/minecraft26Terrain.js";

const Block = Object.freeze({
  AIR: 0,
  STONE: 3,
  BEDROCK: 9,
  WATER: 20,
  EXTRA_LAVA: 100,
});

test("uses Minecraft coordinates directly in the playable Java 26.2 range", () => {
  assert.deepEqual(MINECRAFT_26_2_TERRAIN_TARGET, {
    version: "26.2",
    minY: 0,
    height: 320,
    maxYExclusive: 320,
    seaLevel: 63,
    engineYOffset: 0,
  });
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  assert.equal(terrain.minecraftY(0), 0);
  assert.equal(terrain.minecraftY(63), 63);
  assert.equal(terrain.engineY(319), 319);
});

test("generates deterministic official-router density for a fixed seed and chunk", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  const blocks = new Uint16Array(320 * 16 * 16);
  const waterLevels = new Uint8Array(blocks.length);
  const heights = terrain.populateChunk(0, 0, blocks, waterLevels, Block);

  assert.equal(Math.min(...heights), 48);
  assert.equal(Math.max(...heights), 48);
  assert.equal(terrain.rawHeightAt(0, 0), 48);
  assert.equal(
    crypto.createHash("sha1").update(Buffer.from(blocks.buffer)).digest("hex"),
    "73288138f3cc9450f5720b83359246dc5d8c81af",
  );
});

test("preserves the full signed 64-bit Minecraft seed", () => {
  const positive = new Minecraft26OverworldTerrain({ seed: "9876543212345", worldHeight: 320 });
  const negative = new Minecraft26OverworldTerrain({ seed: "-9876543212345", worldHeight: 320 });
  assert.equal(positive.seed, 9876543212345n);
  assert.equal(negative.seed, -9876543212345n);
  assert.notEqual(positive.rawHeightAt(1024, 1024), negative.rawHeightAt(1024, 1024));
});

test("keeps low-relief surface detail spatially coherent", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  const centerX = 848;
  const centerZ = 1592;
  let laplacianTotal = 0;
  let isolatedSteps = 0;
  let samples = 0;

  for (let z = centerZ - 24; z < centerZ + 24; z += 1) {
    for (let x = centerX - 24; x < centerX + 24; x += 1) {
      const height = terrain.rawHeightAt(x, z);
      const neighbors = [
        terrain.rawHeightAt(x + 1, z),
        terrain.rawHeightAt(x - 1, z),
        terrain.rawHeightAt(x, z + 1),
        terrain.rawHeightAt(x, z - 1),
      ];
      laplacianTotal += Math.abs(height * 4 - neighbors.reduce((sum, value) => sum + value, 0));
      if (neighbors.every((value) => value === height + 1) || neighbors.every((value) => value === height - 1)) {
        isolatedSteps += 1;
      }
      samples += 1;
    }
  }

  assert.ok(laplacianTotal / samples < 0.7);
  assert.ok(isolatedSteps <= 2);
});

test("curves and compresses extreme mountain ramps instead of forming giant pyramids", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  const x = -3664;
  const z = 2896;

  assert.equal(terrain.preliminarySurfaceAt(x, z), 240);
  assert.ok(terrain.rawHeightAt(x, z) <= 208);
  assert.equal(terrain.biomeAt(x, z, terrain.rawHeightAt(x, z)), "stony_peaks");

  const north = [];
  for (let distance = 0; distance <= 128; distance += 4) {
    north.push(terrain.rawHeightAt(x, z - distance));
  }
  let directionChanges = 0;
  let previousDirection = 0;
  for (let index = 1; index < north.length; index += 1) {
    const direction = Math.sign(north[index] - north[index - 1]);
    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) directionChanges += 1;
    if (direction !== 0) previousDirection = direction;
  }
  assert.ok(directionChanges >= 3, `mountain ramp changed direction ${directionChanges} times`);
});

test("carves broad erosion corridors that stay continuous across voxel columns", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  const z = -4080;
  const corridor = [];

  for (let x = 3536; x <= 3584; x += 8) {
    const preliminary = terrain.preliminarySurfaceAt(x, z);
    const geomorphology = terrain.geomorphologyAt(x, z, preliminary);
    corridor.push(geomorphology.drainageCorridor);
    assert.ok(geomorphology.heightDelta <= -4, `${x},${z} only carved ${geomorphology.heightDelta}`);
  }

  assert.ok(corridor.every((strength) => strength >= 0.85));
});

test("keeps Minecraft-routed mountain ribs without isolated one-block spikes", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  const peakShape = terrain.shapeAt(-3664, 2896);
  const peakGeomorphology = terrain.geomorphologyAt(
    -3664,
    2896,
    terrain.preliminarySurfaceAt(-3664, 2896),
    peakShape,
  );
  assert.ok(peakShape.mountainRibSignal >= 0.9);
  assert.ok(peakGeomorphology.heightDelta >= 2.5);
});

test("keeps inland Minecraft lowlands rolling instead of pinning them to one height", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  for (const [centerX, centerZ] of [[1280, -2048], [2048, -1792], [-1280, 512]]) {
    const heights = [];
    for (let z = centerZ - 64; z <= centerZ + 64; z += 8) {
      for (let x = centerX - 64; x <= centerX + 64; x += 8) heights.push(terrain.rawHeightAt(x, z));
    }
    const range = Math.max(...heights) - Math.min(...heights);
    assert.ok(range >= 4, `${centerX},${centerZ} only varied ${range} blocks`);
  }
});

test("turns the reported river biome into a wide continuous wet channel", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  assert.ok(terrain.riverBiomeInfluenceAt(-321, -495) >= 0.8);
  assert.ok(terrain.rawHeightAt(-321, -495) <= 60);

  let currentWetRun = 0;
  let longestWetRun = 0;
  let riverBiomeColumns = 0;
  for (let x = -340; x <= -240; x += 1) {
    const height = terrain.rawHeightAt(x, -495);
    if (height < MINECRAFT_26_2_TERRAIN_TARGET.seaLevel) {
      currentWetRun += 1;
      longestWetRun = Math.max(longestWetRun, currentWetRun);
    } else {
      currentWetRun = 0;
    }
    if (terrain.isRiverBiomeAtSeaLevel(x, -495)) {
      riverBiomeColumns += 1;
      assert.ok(height <= 60, `river biome at ${x},-495 had a dry Y=${height} bed`);
    }
  }

  assert.ok(riverBiomeColumns >= 40);
  assert.ok(longestWetRun >= 40, `longest wet river span was only ${longestWetRun} blocks`);
});

test("keeps ocean continentalness submerged while preserving inland river biomes", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  let underwaterColumns = 0;

  for (let z = -512; z <= 512; z += 32) {
    for (let x = -512; x <= 512; x += 32) {
      const height = terrain.rawHeightAt(x, z);
      const shape = terrain.shapeAt(x, z);
      if (shape.signedContinentalness < -0.19) assert.ok(height <= 61, `${x},${z} rose to ${height}`);
      if (height >= 63) continue;
      underwaterColumns += 1;
      const biome = terrain.biomeAt(x, z, height);
      if (shape.signedContinentalness < -0.11) assert.match(biome, /ocean$/);
      else assert.equal(biome, terrain.rawBiomeAt(x, z, height));
    }
  }

  assert.ok(underwaterColumns > 500);
  assert.equal(terrain.baseHeightAt(824, -2024), 64);
  assert.equal(terrain.rawHeightAt(824, -2024), 61);
  assert.equal(terrain.biomeAt(824, -2024, 61), "cold_ocean");
});

test("preserves Minecraft quart-coordinate biome transitions and high-altitude peak biomes", () => {
  const terrain = new Minecraft26OverworldTerrain({ seed: "4095200884", worldHeight: 320 });
  const lowlandHeight = terrain.rawHeightAt(-192, -1984);
  assert.equal(terrain.rawBiomeAt(-192, -1984, lowlandHeight), "birch_forest");
  assert.equal(terrain.biomeAt(-192, -1984, lowlandHeight), "birch_forest");

  const peakHeight = terrain.rawHeightAt(-3664, 2896);
  assert.equal(terrain.rawBiomeAt(-3664, 2896, peakHeight), "stony_peaks");
  assert.equal(terrain.biomeAt(-3664, 2896, peakHeight), "stony_peaks");

  const surfaceBiomes = new Set();
  for (let z = -1024; z <= 1024; z += 32) {
    for (let x = -1024; x <= 1024; x += 32) {
      const height = terrain.rawHeightAt(x, z);
      if (height < MINECRAFT_26_2_TERRAIN_TARGET.seaLevel) continue;
      const rawBiome = terrain.rawBiomeAt(x, z, height);
      assert.equal(terrain.biomeAt(x, z, height), rawBiome, `${x},${z} replaced ${rawBiome}`);
      surfaceBiomes.add(rawBiome);
    }
  }
  assert.ok(surfaceBiomes.size >= 12, `only found ${surfaceBiomes.size} surface biomes`);
});
