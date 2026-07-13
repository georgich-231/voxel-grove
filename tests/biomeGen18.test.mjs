import assert from "node:assert/strict";
import test from "node:test";

import { Biome, createBiomeDefinitions } from "../src/biomes.js";
import {
  MC18BiomeID,
  MC18BiomeName,
  debugGenLayers,
  getBiome,
  getBiomeName,
  getBiomes,
} from "../src/minecraft18BiomeGenerator.js";
import { createOverworldGenerator } from "../src/worldgen.js";

// Golden IDs generated from the MIT-licensed SeedFinding mc_biome 1.171.1
// OverworldBiomeSource with MCVersion.v1_8_9.
const DEFAULT_FIXTURES = [
  [0n, 0, 0, 4],
  [0n, 64, 64, 1],
  [0n, -128, 256, 16],
  [0n, 1024, -2048, 38],
  [0n, -4096, 777, 13],
  [0n, 3333, -2222, 27],
  [0n, 12000, 12000, 27],
  [1n, 0, 0, 0],
  [1n, 64, 64, 0],
  [1n, -128, 256, 129],
  [1n, 1024, -2048, 4],
  [1n, -4096, 777, 6],
  [1n, 3333, -2222, 6],
  [1n, 12000, 12000, 6],
  [12345n, 0, 0, 133],
  [12345n, 64, 64, 133],
  [12345n, -128, 256, 3],
  [12345n, 1024, -2048, 21],
  [12345n, -4096, 777, 132],
  [12345n, 3333, -2222, 16],
  [12345n, 12000, 12000, 162],
  [-1n, 0, 0, 24],
  [-1n, 64, 64, 24],
  [-1n, -128, 256, 131],
  [-1n, 1024, -2048, 19],
  [-1n, -4096, 777, 24],
  [-1n, 3333, -2222, 5],
  [-1n, 12000, 12000, 1],
  [9876543212345n, 0, 0, 6],
  [9876543212345n, 64, 64, 6],
  [9876543212345n, -128, 256, 7],
  [9876543212345n, 1024, -2048, 17],
  [9876543212345n, -4096, 777, 18],
  [9876543212345n, 3333, -2222, 132],
  [9876543212345n, 12000, 12000, 37],
];

const LARGE_BIOME_FIXTURES = [
  [12345n, 0, 0, 133],
  [12345n, 64, 64, 133],
  [12345n, -128, 256, 131],
  [12345n, 1024, -2048, 3],
  [12345n, -4096, 777, 4],
  [12345n, 3333, -2222, 3],
  [12345n, 12000, 12000, 35],
];

test("matches trusted Java 1.8.9 biome samples for DEFAULT worlds", () => {
  for (const [seed, x, z, expected] of DEFAULT_FIXTURES) {
    assert.equal(getBiome(seed, "DEFAULT", x, z), expected, `${seed} at ${x},${z}`);
  }
});

test("matches trusted Java 1.8.9 samples for LARGE_BIOMES and CUSTOMIZED size", () => {
  for (const [seed, x, z, expected] of LARGE_BIOME_FIXTURES) {
    assert.equal(getBiome(seed, "LARGE_BIOMES", x, z), expected, `large ${seed} at ${x},${z}`);
    assert.equal(getBiome(seed, "CUSTOMIZED", x, z, { biomeSize: 6, riverSize: 4 }), expected, `custom ${seed} at ${x},${z}`);
  }
});

test("preserves legacy biome IDs and names", () => {
  assert.equal(MC18BiomeID.MESA_ROCK, 38);
  assert.equal(MC18BiomeID.MUTATED_MESA_CLEAR_ROCK, 167);
  assert.equal(MC18BiomeName[129], "mutated_plains");
  assert.equal(getBiomeName(12345n, "DEFAULT", 1024, -2048), "jungle");
});

test("handles flat, Nether, End, and region lookups", () => {
  assert.equal(getBiome(99n, "FLAT", 0, 0, "3;7,2x3,2;2;village"), MC18BiomeID.DESERT);
  assert.equal(getBiome(99n, "NETHER", 0, 0), MC18BiomeID.HELL);
  assert.equal(getBiome(99n, "END", 0, 0), MC18BiomeID.SKY);

  const region = getBiomes(1n, "DEFAULT", -2, -2, 3, 2);
  assert.ok(region instanceof Int32Array);
  assert.deepEqual(Array.from(region), [0, 0, 0, 0, 0, 0]);
});

test("debug mode prints traceable GenLayer grids", () => {
  const debug = debugGenLayers(1n, "DEFAULT", 0, 0, 2, 2, true, undefined, { print: false });
  assert.match(debug, /GenLayerIsland\(1\):/);
  assert.match(debug, /GenLayerRemoveTooMuchOcean\(2\):/);
  assert.match(debug, /GenLayerHills\(1000\):/);
  assert.match(debug, /GenLayerVoronoiZoom\(10\):/);
});

test("overworld generator routes biomeAt through Java 1.8.9 biome source", () => {
  const generator = createOverworldGenerator({
    seed: 12345,
    biomeLayout: "java_1_8",
    Block: {},
    Biome,
    BIOMES: {},
    worldHeight: 256,
    seaLevel: 63,
    waterLevel: 63,
  });

  assert.equal(generator.minecraft18BiomeIdAt(1024, -2048), MC18BiomeID.JUNGLE);
  assert.equal(generator.biomeAt(1024, -2048), Biome.JUNGLE);
  assert.equal(generator.minecraft18BiomeIdAt(12000, 12000), MC18BiomeID.MUTATED_EXTREME_HILLS_WITH_TREES);
  assert.equal(generator.biomeAt(12000, 12000), Biome.EXTREME_HILLS_PLUS_M);

  const fullSeedGenerator = createOverworldGenerator({
    seed: Number(BigInt.asUintN(32, 9876543212345n)),
    biomeSeed: "9876543212345",
    biomeLayout: "java_1_8",
    Block: {},
    Biome,
    BIOMES: {},
    worldHeight: 256,
    seaLevel: 63,
    waterLevel: 63,
  });
  assert.equal(fullSeedGenerator.minecraft18BiomeIdAt(12000, 12000), MC18BiomeID.MESA);
  assert.equal(fullSeedGenerator.biomeAt(12000, 12000), Biome.MESA);
});

test("overworld generator defaults to the Minecraft 26.2 multi-noise biome source", () => {
  const generator = createOverworldGenerator({
    seed: 12345,
    biomeSeed: "12345",
    Block: {},
    Biome,
    BIOMES: {},
    worldHeight: 320,
    seaLevel: 63,
    waterLevel: 63,
  });
  assert.equal(generator.minecraft18BiomeIdAt(0, 0), null);
  assert.equal(generator.minecraft26BiomeIdAt(0, 0), "deep_ocean");
  assert.equal(generator.biomeAt(0, 0), Biome.DEEP_OCEAN);
  assert.equal(generator.minecraft26BiomeIdAt(256, -384), "grove");
  assert.equal(generator.biomeAt(256, -384), Biome.GROVE);
  assert.equal(generator.minecraft26BiomeIdAt(1024, 1024), "deep_frozen_ocean");
  assert.equal(generator.biomeAt(1024, 1024), Biome.FROZEN_OCEAN);
});

test("keeps deserts off the known highland regressions", () => {
  const generator = createOverworldGenerator({
    seed: 4095200884,
    biomeSeed: "4095200884",
    Block: {},
    Biome,
    BIOMES: {},
    worldHeight: 320,
    seaLevel: 63,
    waterLevel: 63,
  });

  assert.equal(generator.terrainHeight(848, 1592), 98);
  assert.equal(generator.minecraft26BiomeIdAt(848, 1592), "taiga");
  assert.equal(generator.biomeAt(848, 1592), Biome.TAIGA);
  assert.equal(generator.terrainHeight(72, 1992), 142);
  assert.equal(generator.minecraft26BiomeIdAt(72, 1992), "forest");
  assert.equal(generator.biomeAt(72, 1992), Biome.FOREST);
  assert.notEqual(generator.biomeAt(848, 1592), Biome.DESERT);
  assert.notEqual(generator.biomeAt(72, 1992), Biome.DESERT);
});

test("fills a Minecraft-scale plains province with tall grass and flowers", () => {
  const Block = new Proxy({}, { get: (_target, key) => String(key).toLowerCase() });
  const generator = createOverworldGenerator({
    seed: 4095200884,
    biomeSeed: "4095200884",
    Block,
    Biome,
    BIOMES: createBiomeDefinitions(Block),
    worldHeight: 320,
    seaLevel: 63,
    waterLevel: 63,
  });
  let plains = 0;
  let plants = 0;
  let tallGrass = 0;

  for (let z = -1632; z < -1568; z += 1) {
    for (let x = -800; x < -736; x += 1) {
      if (generator.biomeAt(x, z) !== Biome.PLAINS || generator.terrainHeight(x, z) <= 63) continue;
      plains += 1;
      const plant = generator.plantTypeAt(x, z);
      if (plant) plants += 1;
      if (plant === "tall_grass") tallGrass += 1;
    }
  }

  assert.equal(plains, 4096);
  assert.ok(plants / plains > 0.4, `plains plant coverage was ${plants / plains}`);
  assert.ok(tallGrass / plains > 0.3, `plains tall-grass coverage was ${tallGrass / plains}`);
});

test("never places sugar cane in savanna biomes", () => {
  const Block = new Proxy({}, { get: (_target, key) => String(key).toLowerCase() });
  const generator = createOverworldGenerator({
    seed: 4095200884,
    biomeSeed: "4095200884",
    Block,
    Biome,
    BIOMES: createBiomeDefinitions(Block),
    worldHeight: 320,
    seaLevel: 63,
    waterLevel: 63,
  });
  const savannas = new Set([Biome.SAVANNA, Biome.SAVANNA_PLATEAU, Biome.SAVANNA_M, Biome.SAVANNA_PLATEAU_M]);
  let savannaSamples = 0;
  // Force every sampled column to satisfy the water-neighbor prerequisite so
  // this test exercises the biome exclusion instead of depending on one
  // seed's current river placement.
  generator.nearNaturalWater = () => true;

  for (let z = -1750; z <= -1550; z += 2) {
    for (let x = -1450; x <= -1150; x += 2) {
      if (!savannas.has(generator.biomeAt(x, z))) continue;
      savannaSamples += 1;
      assert.notEqual(generator.plantTypeAt(x, z), "sugar_cane", `${x},${z}`);
    }
  }

  assert.ok(savannaSamples > 7000);
});
