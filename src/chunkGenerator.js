import { Biome, createBiomeDefinitions } from "./biomes.js";
import { RUNTIME_BLOCK_DEFINITIONS } from "./creativeContent.js";
import { createOverworldGenerator } from "./worldgen.js";

const CHUNK_SIZE = 16;
const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
const WORLD_HEIGHT = 320;
const SEA_LEVEL = 63;
const WATER_LEVEL = SEA_LEVEL;

const Block = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANK: 7,
  CLAY: 8,
  BEDROCK: 9,
  CRAFTING_TABLE: 10,
  PODZOL: 11,
  JUNGLE_GRASS: 12,
  MUD: 13,
  SANDSTONE: 14,
  SPRUCE_LOG: 15,
  SPRUCE_LEAVES: 16,
  JUNGLE_LOG: 17,
  JUNGLE_LEAVES: 18,
  CACTUS: 19,
  WATER: 20,
  GRAVEL: 21,
  COBBLESTONE: 22,
  COAL_ORE: 23,
  IRON_ORE: 24,
  COPPER_ORE: 25,
  GOLD_ORE: 26,
  DIAMOND_ORE: 27,
  RED_SAND: 28,
  TERRACOTTA: 29,
  WHITE_TERRACOTTA: 30,
  SNOW_GRASS: 31,
  SNOW: 32,
  BIRCH_LOG: 33,
  BIRCH_LEAVES: 34,
  MOSS: 35,
  WILDFLOWER: 36,
  FERN: 37,
  MEADOW_GRASS: 38,
  DRY_GRASS: 39,
  ACACIA_LOG: 40,
  ACACIA_LEAVES: 41,
  LIMESTONE: 42,
  BASALT: 43,
  SLATE: 44,
  TALL_GRASS: 45,
  GRANITE: 46,
  DIORITE: 47,
  ANDESITE: 48,
  DEEPSLATE: 49,
  ICE: 50,
  PACKED_ICE: 51,
  DANDELION: 52,
  POPPY: 53,
  BLUE_ORCHID: 54,
  DEAD_BUSH: 55,
  BERRY_BUSH: 56,
  SUGAR_CANE: 57,
  PUMPKIN: 58,
  MELON: 59,
  VINE: 60,
  COARSE_DIRT: 61,
  SAVANNA_GRASS: 62,
  CLOVER: 63,
  SAVANNA_SHRUB: 64,
  DARK_OAK_LOG: 65,
  DARK_OAK_LEAVES: 66,
  MYCELIUM: 67,
  BROWN_MUSHROOM: 68,
  RED_MUSHROOM: 69,
  SUNFLOWER: 70,
  WATERLILY: 71,
};

for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
  Block[definition.constant] = definition.block;
}

const BIOMES = createBiomeDefinitions(Block);

const TREE_BLOCKS = {
  oak: { log: Block.LOG, leaves: Block.LEAVES },
  spruce: { log: Block.SPRUCE_LOG, leaves: Block.SPRUCE_LEAVES },
  jungle: { log: Block.JUNGLE_LOG, leaves: Block.JUNGLE_LEAVES },
  birch: { log: Block.BIRCH_LOG, leaves: Block.BIRCH_LEAVES },
  acacia: { log: Block.ACACIA_LOG, leaves: Block.ACACIA_LEAVES },
  dark_oak: { log: Block.DARK_OAK_LOG, leaves: Block.DARK_OAK_LEAVES },
};
const GRASS_ONLY_PLANT_TYPES = new Set([
  "fern",
  "tall_grass",
  "wildflower",
  "dandelion",
  "poppy",
  "blue_orchid",
  "clover",
  "sunflower",
  "berry_bush",
]);
const GRASS_SURFACE_BLOCKS = new Set([
  Block.GRASS,
  Block.DIRT,
  Block.PODZOL,
  Block.JUNGLE_GRASS,
  Block.MUD,
  Block.MEADOW_GRASS,
  Block.DRY_GRASS,
  Block.COARSE_DIRT,
  Block.SAVANNA_GRASS,
  Block.MYCELIUM,
  Block.SNOW_GRASS,
]);

let generatorSeed = null;
let generatorBiomeSeed = null;
let generator = null;

self.onmessage = (event) => {
  try {
    const data = event.data;
    const result = generateChunk(data);
    self.postMessage({
      id: data.id,
      cx: data.cx,
      cz: data.cz,
      detail: data.detail,
      blocks: result.blocks,
      waterLevels: result.waterLevels,
    }, [result.blocks.buffer, result.waterLevels.buffer]);
  } catch (error) {
    self.postMessage({ id: event.data?.id, error: error?.stack || String(error) });
  }
};

function getGenerator(seed, biomeSeed = seed) {
  if (!generator || generatorSeed !== seed || generatorBiomeSeed !== biomeSeed) {
    generatorSeed = seed;
    generatorBiomeSeed = biomeSeed;
    generator = createOverworldGenerator({
      seed,
      biomeSeed,
      Block,
      Biome,
      BIOMES,
      worldHeight: WORLD_HEIGHT,
      seaLevel: SEA_LEVEL,
      waterLevel: WATER_LEVEL,
    });
  }
  return generator;
}

function generateChunk(data) {
  const world = createWorkerChunk(data.cx, data.cz, data.seed, data.biomeSeed);
  world.populateTerrain(data.detail);
  if (data.detail !== "terrain") world.populateVegetation();
  return {
    blocks: world.blocks,
    waterLevels: world.waterLevels,
  };
}

function createWorkerChunk(cx, cz, seed, biomeSeed) {
  const gen = getGenerator(seed, biomeSeed);
  const chunk = {
    cx,
    cz,
    seed,
    generator: gen,
    blocks: new Uint16Array(CHUNK_AREA * WORLD_HEIGHT),
    waterLevels: new Uint8Array(CHUNK_AREA * WORLD_HEIGHT),
    index(x, y, z) {
      return y * CHUNK_AREA + z * CHUNK_SIZE + x;
    },
    getLocal(x, y, z) {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return Block.AIR;
      return this.blocks[this.index(x, y, z)];
    },
    setWorldBlockIfInside(wx, y, wz, block, waterLevel = null) {
      const lx = wx - this.cx * CHUNK_SIZE;
      const lz = wz - this.cz * CHUNK_SIZE;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      const index = this.index(lx, y, lz);
      this.blocks[index] = block;
      this.waterLevels[index] = block === Block.WATER ? clamp((waterLevel ?? 0) + 1, 1, 8) : 0;
    },
    getWorldBlockIfInside(wx, y, wz) {
      const lx = wx - this.cx * CHUNK_SIZE;
      const lz = wz - this.cz * CHUNK_SIZE;
      return this.getLocal(lx, y, lz);
    },
    populateTerrain,
    populateVegetation,
    placeTreeSlice,
    placeOakTreeSlice,
    placeSpruceTreeSlice,
    placeJungleTreeSlice,
    placeBirchTreeSlice,
    placeTallBirchTreeSlice,
    placeAcaciaTreeSlice,
    placeDarkOakTreeSlice,
    placeMegaSpruceTreeSlice,
    placeSwampOakTreeSlice,
    placeClassicLeafCanopy,
    placeLeafCluster,
    placeLeafDisk,
    placeAcaciaCanopy,
    placeVineColumn,
    placeVineColumnFromLeaf,
    setLeafIfReplaceable,
    placeCactusSlice,
    placeRockSlice,
    placePlantSlice,
  };
  return chunk;
}

function populateTerrain(detail = "full") {
  this.generator.populateChunkTerrain(
    this.cx,
    this.cz,
    this.blocks,
    this.waterLevels,
    CHUNK_SIZE,
    CHUNK_AREA,
    {
      includeUndergroundFeatures: detail === "full",
      fastSurface: detail === "terrain",
    },
  );
}

function populateVegetation() {
  const worldX0 = this.cx * CHUNK_SIZE;
  const worldZ0 = this.cz * CHUNK_SIZE;
  const margin = 5;

  for (let wx = worldX0 - margin; wx < worldX0 + CHUNK_SIZE + margin; wx += 1) {
    for (let wz = worldZ0 - margin; wz < worldZ0 + CHUNK_SIZE + margin; wz += 1) {
      const groundY = this.generator.terrainHeight(wx, wz);
      const treeType = this.generator.treeTypeAt(wx, wz);
      if (treeType) {
        this.placeTreeSlice(wx, groundY + 1, wz, treeType);
        continue;
      }

      if (this.generator.shouldGrowCactus(wx, wz)) {
        this.placeCactusSlice(wx, groundY + 1, wz);
        continue;
      }

      const rock = this.generator.rockTypeAt(wx, wz);
      if (rock) {
        this.placeRockSlice(wx, groundY + 1, wz, rock);
        continue;
      }

      const plant = this.generator.plantTypeAt(wx, wz);
      if (plant) this.placePlantSlice(wx, groundY + 1, wz, plant);
    }
  }
}

function placeTreeSlice(wx, baseY, wz, treeType) {
  if (treeType === "spruce") return this.placeSpruceTreeSlice(wx, baseY, wz);
  if (treeType === "jungle") return this.placeJungleTreeSlice(wx, baseY, wz);
  if (treeType === "birch") return this.placeBirchTreeSlice(wx, baseY, wz);
  if (treeType === "tall_birch") return this.placeTallBirchTreeSlice(wx, baseY, wz);
  if (treeType === "acacia") return this.placeAcaciaTreeSlice(wx, baseY, wz);
  if (treeType === "dark_oak") return this.placeDarkOakTreeSlice(wx, baseY, wz);
  if (treeType === "mega_spruce") return this.placeMegaSpruceTreeSlice(wx, baseY, wz);
  if (treeType === "swamp_oak") return this.placeSwampOakTreeSlice(wx, baseY, wz);
  return this.placeOakTreeSlice(wx, baseY, wz);
}

function placeOakTreeSlice(wx, baseY, wz) {
  const large = hashFloat(wx, wz, this.seed ^ 0x0a0c) < 0.1;
  const height = (large ? 6 : 4) + hashInt(wx, wz, this.seed, large ? 4 : 3);
  const trunkTop = baseY + height - 1;

  for (let dy = 0; dy < height; dy += 1) this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.LOG);

  if (large) {
    for (const [dx, dz, salt] of [[1, 0, 0x11], [-1, 0, 0x22], [0, 1, 0x33], [0, -1, 0x44]]) {
      if (hashFloat(wx + dx, wz + dz, this.seed ^ (0xba2 + salt)) < 0.45) continue;
      const branchY = trunkTop - 2 + hashInt(wx + dx, wz + dz, this.seed ^ (0xba3 + salt), 2);
      const endX = wx + dx * 2;
      const endZ = wz + dz * 2;
      this.setWorldBlockIfInside(wx + dx, branchY, wz + dz, Block.LOG);
      this.setWorldBlockIfInside(endX, branchY, endZ, Block.LOG);
      this.placeLeafCluster(endX, branchY + 1, endZ, Block.LEAVES, 1, this.seed ^ (0x0a0d + salt));
    }
  }

  this.placeClassicLeafCanopy(wx, trunkTop, wz, Block.LEAVES, this.seed ^ 0x0a0e, {
    lowerCornerChance: large ? 0.48 : 0.28,
  });
}

function placeSpruceTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.spruce;
  const height = 6 + hashInt(wx, wz, this.seed ^ 0x5f3759, 7);
  const trunkTop = baseY + height - 1;
  const leafStart = baseY + Math.max(2, Math.floor(height * 0.42));

  for (let dy = 0; dy < height; dy += 1) this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log);

  for (let y = leafStart; y <= trunkTop + 1; y += 1) {
    const fromTop = trunkTop + 1 - y;
    let radius = fromTop <= 0 ? 0 : clamp(Math.floor((fromTop + 2) / 2), 1, 3);
    if (fromTop > 1 && fromTop % 2 === 0) radius = Math.max(1, radius - 1);
    for (let ox = -radius; ox <= radius; ox += 1) {
      for (let oz = -radius; oz <= radius; oz += 1) {
        if (ox === 0 && oz === 0 && y <= trunkTop) continue;
        if (radius > 1 && Math.abs(ox) === radius && Math.abs(oz) === radius) continue;
        if (Math.abs(ox) + Math.abs(oz) > radius + 1) continue;
        this.setLeafIfReplaceable(wx + ox, y, wz + oz, blocks.leaves);
      }
    }
  }
}

function placeJungleTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.jungle;
  const giant = hashFloat(wx, wz, this.seed ^ 0x1badb003) < 0.14;
  const height = (giant ? 13 : 7) + hashInt(wx, wz, this.seed ^ 0x1badb002, giant ? 5 : 4);
  const trunkTop = baseY + height - 1;

  for (let dy = 0; dy < height; dy += 1) {
    this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log);
    if (giant) {
      this.setWorldBlockIfInside(wx + 1, baseY + dy, wz, blocks.log);
      this.setWorldBlockIfInside(wx, baseY + dy, wz + 1, blocks.log);
      this.setWorldBlockIfInside(wx + 1, baseY + dy, wz + 1, blocks.log);
    }
  }

  if (!giant) {
    this.placeClassicLeafCanopy(wx, trunkTop, wz, blocks.leaves, this.seed ^ 0x1badb004, {
      lowerCornerChance: 0.42,
      vineChance: 0.16,
    });
    return;
  }

  this.placeLeafDisk(wx, trunkTop - 1, wz, 3, blocks.leaves, 0.25, this.seed ^ 0x1badb005, true);
  this.placeLeafDisk(wx, trunkTop, wz, 3, blocks.leaves, 0.08, this.seed ^ 0x1badb006, true);
  this.placeLeafDisk(wx, trunkTop + 1, wz, 2, blocks.leaves, 0.2, this.seed ^ 0x1badb007, true);

  for (const [dx, dz, salt] of [[2, 0, 0x12], [-2, 0, 0x23], [0, 2, 0x34], [0, -2, 0x45]]) {
    if (hashFloat(wx + dx, wz + dz, this.seed ^ (0x1badb008 + salt)) < 0.3) continue;
    const branchY = baseY + Math.floor(height * 0.48) + hashInt(wx + dx, wz + dz, this.seed ^ (0x77 + salt), 4);
    this.setWorldBlockIfInside(wx + Math.sign(dx), branchY, wz + Math.sign(dz), blocks.log);
    this.setWorldBlockIfInside(wx + dx, branchY + 1, wz + dz, blocks.log);
    this.placeLeafCluster(wx + dx, branchY + 2, wz + dz, blocks.leaves, 2, this.seed ^ (0x1badb009 + salt), 0.1, true);
  }
}

function placeBirchTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.birch;
  const height = 5 + hashInt(wx, wz, this.seed ^ 0xb1f6, 3);
  const trunkTop = baseY + height - 1;
  for (let dy = 0; dy < height; dy += 1) this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log);
  this.placeClassicLeafCanopy(wx, trunkTop, wz, blocks.leaves, this.seed ^ 0xb1f7, { lowerCornerChance: 0.34 });
}

function placeTallBirchTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.birch;
  const height = 9 + hashInt(wx, wz, this.seed ^ 0x7a11b17c, 5);
  const trunkTop = baseY + height - 1;
  for (let dy = 0; dy < height; dy += 1) this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log);
  this.placeLeafDisk(wx, trunkTop - 2, wz, 2, blocks.leaves, 0.28, this.seed ^ 0x7a11b17d);
  this.placeLeafDisk(wx, trunkTop - 1, wz, 2, blocks.leaves, 0.12, this.seed ^ 0x7a11b17e);
  this.placeLeafDisk(wx, trunkTop, wz, 1, blocks.leaves, 0.08, this.seed ^ 0x7a11b17f);
  this.placeLeafCluster(wx, trunkTop + 1, wz, blocks.leaves, 1, this.seed ^ 0x7a11b180);
}

function placeAcaciaTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.acacia;
  const height = 5 + hashInt(wx, wz, this.seed ^ 0xaca1, 3);
  const leanX = hashFloat(wx, wz, this.seed ^ 0xaca2) < 0.5 ? -1 : 1;
  const leanZ = hashFloat(wx, wz, this.seed ^ 0xaca3) < 0.5 ? -1 : 1;
  const fork = hashFloat(wx, wz, this.seed ^ 0xaca4) < 0.72;
  const bendStart = 2 + hashInt(wx, wz, this.seed ^ 0xaca7, 2);
  let topX = wx;
  let topZ = wz;

  for (let dy = 0; dy < height; dy += 1) {
    const lean = dy > bendStart ? Math.min(2, dy - bendStart) : 0;
    const bx = wx + lean * leanX;
    const bz = wz + (lean > 1 || dy === height - 1 ? leanZ : 0);
    topX = bx;
    topZ = bz;
    this.setWorldBlockIfInside(bx, baseY + dy, bz, blocks.log);
  }

  const canopyY = baseY + height - 1;
  this.placeAcaciaCanopy(topX, canopyY + 1, topZ, blocks.leaves, this.seed ^ 0xaca5);
  if (!fork) return;

  const forkX = wx - leanX;
  const forkZ = wz - leanZ;
  const forkY = baseY + Math.max(3, height - 2);
  this.setWorldBlockIfInside(wx, forkY, wz, blocks.log);
  this.setWorldBlockIfInside(forkX, forkY + 1, forkZ, blocks.log);
  this.setWorldBlockIfInside(forkX + Math.sign(forkX - wx), forkY + 2, forkZ, blocks.log);
  this.placeAcaciaCanopy(forkX, forkY + 2, forkZ, blocks.leaves, this.seed ^ 0xaca6);
}

function placeDarkOakTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.dark_oak;
  const height = 6 + hashInt(wx, wz, this.seed ^ 0xd4a0, 4);
  const trunkTop = baseY + height - 1;
  for (let dy = 0; dy < height; dy += 1) {
    this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log);
    this.setWorldBlockIfInside(wx + 1, baseY + dy, wz, blocks.log);
    this.setWorldBlockIfInside(wx, baseY + dy, wz + 1, blocks.log);
    this.setWorldBlockIfInside(wx + 1, baseY + dy, wz + 1, blocks.log);
  }
  this.placeLeafDisk(wx, trunkTop - 2, wz, 3, blocks.leaves, 0.24, this.seed ^ 0xd4a1);
  this.placeLeafDisk(wx + 1, trunkTop - 1, wz + 1, 3, blocks.leaves, 0.12, this.seed ^ 0xd4a2);
  this.placeLeafDisk(wx, trunkTop, wz, 2, blocks.leaves, 0.08, this.seed ^ 0xd4a3);
  this.placeLeafCluster(wx + 1, trunkTop + 1, wz + 1, blocks.leaves, 1, this.seed ^ 0xd4a4);
}

function placeMegaSpruceTreeSlice(wx, baseY, wz) {
  const blocks = TREE_BLOCKS.spruce;
  const height = 12 + hashInt(wx, wz, this.seed ^ 0x5f375a, 7);
  const trunkTop = baseY + height - 1;
  const leafStart = baseY + Math.max(4, Math.floor(height * 0.35));
  for (let dy = 0; dy < height; dy += 1) {
    this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log);
    this.setWorldBlockIfInside(wx + 1, baseY + dy, wz, blocks.log);
    this.setWorldBlockIfInside(wx, baseY + dy, wz + 1, blocks.log);
    this.setWorldBlockIfInside(wx + 1, baseY + dy, wz + 1, blocks.log);
  }
  for (let y = leafStart; y <= trunkTop + 1; y += 1) {
    const fromTop = trunkTop + 1 - y;
    const radius = clamp(Math.floor((fromTop + 3) / 2), 1, 4);
    this.placeLeafDisk(wx, y, wz, radius, blocks.leaves, radius > 2 ? 0.32 : 0.12, this.seed ^ (0x5f3760 + y));
  }
}

function placeSwampOakTreeSlice(wx, baseY, wz) {
  const height = 5 + hashInt(wx, wz, this.seed ^ 0x5a0, 3);
  const trunkTop = baseY + height - 1;
  for (let dy = 0; dy < height; dy += 1) this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.LOG);
  this.placeClassicLeafCanopy(wx, trunkTop, wz, Block.LEAVES, this.seed ^ 0x5a1, {
    lowerCornerChance: 0.48,
    vineChance: 0.24,
  });
}

function placeClassicLeafCanopy(wx, trunkTopY, wz, leaves, seed, options = {}) {
  const lowerCornerChance = options.lowerCornerChance ?? 0.32;
  const vineChance = options.vineChance ?? 0;

  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    this.setLeafIfReplaceable(wx + dx, trunkTopY + 1, wz + dz, leaves);
  }

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      const diagonal = Math.abs(dx) === 1 && Math.abs(dz) === 1;
      if (diagonal && hashFloat(wx + dx, wz + dz, seed ^ 0x101) < 0.28) continue;
      this.setLeafIfReplaceable(wx + dx, trunkTopY, wz + dz, leaves);
    }
  }

  for (const y of [trunkTopY - 1, trunkTopY - 2]) {
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        if (dx === 0 && dz === 0) continue;
        const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        if (corner && hashFloat(wx + dx, wz + dz, seed ^ y) > lowerCornerChance) continue;
        this.setLeafIfReplaceable(wx + dx, y, wz + dz, leaves);
        if (vineChance > 0 && (Math.abs(dx) === 2 || Math.abs(dz) === 2) && hashFloat(wx + dx, wz + dz, seed ^ (y + 0x71e)) < vineChance) {
          this.placeVineColumnFromLeaf(wx + dx, y, wz + dz, dx, dz, 4);
        }
      }
    }
  }
}

function placeLeafCluster(wx, y, wz, leaves, radius, seed, cornerChance = 0.15, vines = false) {
  this.placeLeafDisk(wx, y - 1, wz, Math.max(1, radius), leaves, cornerChance, seed ^ 0x44, vines);
  this.placeLeafDisk(wx, y, wz, radius, leaves, cornerChance, seed ^ 0x55, vines);
  this.placeLeafDisk(wx, y + 1, wz, Math.max(1, radius - 1), leaves, cornerChance, seed ^ 0x66, vines);
}

function placeLeafDisk(wx, y, wz, radius, leaves, cornerChance, seed, vines = false) {
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
      if (corner && hashFloat(wx + dx, wz + dz, seed) > cornerChance) continue;
      if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
      this.setLeafIfReplaceable(wx + dx, y, wz + dz, leaves);
      if (vines && (Math.abs(dx) === radius || Math.abs(dz) === radius) && hashFloat(wx + dx, wz + dz, seed ^ y) < 0.12) {
        this.placeVineColumnFromLeaf(wx + dx, y, wz + dz, dx, dz, 4);
      }
    }
  }
}

function placeAcaciaCanopy(wx, y, wz, leaves, seed) {
  this.placeLeafDisk(wx, y, wz, 2, leaves, 0.25, seed);
  this.placeLeafDisk(wx, y + 1, wz, 1, leaves, 0, seed ^ 0x17);
}

function placeVineColumn(wx, y, wz, maxLength) {
  for (let drop = 0; drop < maxLength; drop += 1) {
    if (this.getWorldBlockIfInside(wx, y - drop, wz) !== Block.AIR) break;
    this.setWorldBlockIfInside(wx, y - drop, wz, Block.VINE);
  }
}

function placeVineColumnFromLeaf(leafX, leafY, leafZ, outwardX, outwardZ, maxLength) {
  const directions = [];
  if (outwardX !== 0) directions.push([Math.sign(outwardX), 0]);
  if (outwardZ !== 0) directions.push([0, Math.sign(outwardZ)]);
  if (directions.length === 0) return;
  const [dx, dz] = directions.length === 1
    ? directions[0]
    : directions[hashFloat(leafX, leafZ, this.seed ^ leafY) < 0.5 ? 0 : 1];
  this.placeVineColumn(leafX + dx, leafY, leafZ + dz, maxLength);
}

function setLeafIfReplaceable(wx, y, wz, leaves) {
  const existing = this.getWorldBlockIfInside(wx, y, wz);
  if (existing === Block.AIR || existing === leaves || existing === Block.VINE) {
    this.setWorldBlockIfInside(wx, y, wz, leaves);
  }
}

function placeCactusSlice(wx, baseY, wz) {
  const height = 2 + hashInt(wx, wz, this.seed ^ 0xcac7, 3);
  for (let dy = 0; dy < height; dy += 1) this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.CACTUS);
}

function placeRockSlice(wx, baseY, wz, block) {
  const radius = hashFloat(wx, wz, this.seed ^ 0xb01d) < 0.28 ? 2 : 1;
  const height = 1 + (radius === 2 && hashFloat(wx, wz, this.seed ^ 0xb01e) < 0.45 ? 1 : 0);

  for (let dy = 0; dy < height; dy += 1) {
    const layerRadius = Math.max(0, radius - dy);
    for (let ox = -layerRadius; ox <= layerRadius; ox += 1) {
      for (let oz = -layerRadius; oz <= layerRadius; oz += 1) {
        const distance = Math.abs(ox) + Math.abs(oz);
        if (distance > layerRadius + 1) continue;
        if (Math.abs(ox) === layerRadius && Math.abs(oz) === layerRadius && hashFloat(wx + ox, wz + oz, this.seed ^ dy) < 0.65) continue;
        if (this.getWorldBlockIfInside(wx + ox, baseY + dy, wz + oz) !== Block.AIR) continue;
        this.setWorldBlockIfInside(wx + ox, baseY + dy, wz + oz, block);
      }
    }
  }
}

function placePlantSlice(wx, baseY, wz, plant) {
  const plantBlocks = {
    fern: Block.FERN,
    tall_grass: Block.TALL_GRASS,
    wildflower: Block.WILDFLOWER,
    dandelion: Block.DANDELION,
    poppy: Block.POPPY,
    blue_orchid: Block.BLUE_ORCHID,
    dead_bush: Block.DEAD_BUSH,
    berry_bush: Block.BERRY_BUSH,
    sugar_cane: Block.SUGAR_CANE,
    pumpkin: Block.PUMPKIN,
    melon: Block.MELON,
    vine: Block.VINE,
    clover: Block.CLOVER,
    savanna_shrub: Block.SAVANNA_SHRUB,
    brown_mushroom: Block.BROWN_MUSHROOM,
    red_mushroom: Block.RED_MUSHROOM,
    sunflower: Block.SUNFLOWER,
    waterlily: Block.WATERLILY,
  };
  const block = plantBlocks[plant] ?? Block.WILDFLOWER;

  if (plant === "waterlily") {
    const y = WATER_LEVEL + 1;
    if (this.getWorldBlockIfInside(wx, y, wz) !== Block.AIR) return;
    if (this.getWorldBlockIfInside(wx, y - 1, wz) !== Block.WATER) return;
    this.setWorldBlockIfInside(wx, y, wz, Block.WATERLILY);
    return;
  }

  if (this.getWorldBlockIfInside(wx, baseY, wz) !== Block.AIR) return;

  if (
    GRASS_ONLY_PLANT_TYPES.has(plant) &&
    !GRASS_SURFACE_BLOCKS.has(this.getWorldBlockIfInside(wx, baseY - 1, wz))
  ) return;

  if (plant === "sugar_cane") {
    const height = 2 + hashInt(wx, wz, this.seed ^ 0x5ca1e, 3);
    for (let dy = 0; dy < height; dy += 1) {
      if (this.getWorldBlockIfInside(wx, baseY + dy, wz) !== Block.AIR) break;
      this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.SUGAR_CANE);
    }
    return;
  }

  if (plant === "tall_grass" && hashFloat(wx, wz, this.seed ^ 0xd0557) < 0.5) {
    for (let dy = 0; dy < 2; dy += 1) {
      if (this.getWorldBlockIfInside(wx, baseY + dy, wz) !== Block.AIR) break;
      this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.TALL_GRASS);
    }
    return;
  }

  this.setWorldBlockIfInside(wx, baseY, wz, block);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashInt(x, z, seed, max) {
  return Math.floor(hashFloat(x, z, seed) * max);
}

function hashFloat(x, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ (seed | 0);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
