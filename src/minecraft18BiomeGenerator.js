const MULTIPLIER = 6364136223846793005n;
const ADDEND = 1442695040888963407n;
const LONG_BITS = 64;

export const MC18BiomeID = Object.freeze({
  OCEAN: 0,
  PLAINS: 1,
  DESERT: 2,
  EXTREME_HILLS: 3,
  FOREST: 4,
  TAIGA: 5,
  SWAMPLAND: 6,
  RIVER: 7,
  HELL: 8,
  SKY: 9,
  FROZEN_OCEAN: 10,
  FROZEN_RIVER: 11,
  ICE_FLATS: 12,
  ICE_MOUNTAINS: 13,
  MUSHROOM_ISLAND: 14,
  MUSHROOM_ISLAND_SHORE: 15,
  BEACHES: 16,
  DESERT_HILLS: 17,
  FOREST_HILLS: 18,
  TAIGA_HILLS: 19,
  SMALLER_EXTREME_HILLS: 20,
  JUNGLE: 21,
  JUNGLE_HILLS: 22,
  JUNGLE_EDGE: 23,
  DEEP_OCEAN: 24,
  STONE_BEACH: 25,
  COLD_BEACH: 26,
  BIRCH_FOREST: 27,
  BIRCH_FOREST_HILLS: 28,
  ROOFED_FOREST: 29,
  TAIGA_COLD: 30,
  TAIGA_COLD_HILLS: 31,
  REDWOOD_TAIGA: 32,
  REDWOOD_TAIGA_HILLS: 33,
  EXTREME_HILLS_WITH_TREES: 34,
  SAVANNA: 35,
  SAVANNA_ROCK: 36,
  MESA: 37,
  MESA_ROCK: 38,
  MESA_CLEAR_ROCK: 39,
  VOID: 127,
  MUTATED_PLAINS: 129,
  MUTATED_DESERT: 130,
  MUTATED_EXTREME_HILLS: 131,
  MUTATED_FOREST: 132,
  MUTATED_TAIGA: 133,
  MUTATED_SWAMPLAND: 134,
  MUTATED_ICE_FLATS: 140,
  MUTATED_JUNGLE: 149,
  MUTATED_JUNGLE_EDGE: 151,
  MUTATED_BIRCH_FOREST: 155,
  MUTATED_BIRCH_FOREST_HILLS: 156,
  MUTATED_ROOFED_FOREST: 157,
  MUTATED_TAIGA_COLD: 158,
  MUTATED_REDWOOD_TAIGA: 160,
  MUTATED_REDWOOD_TAIGA_HILLS: 161,
  MUTATED_EXTREME_HILLS_WITH_TREES: 162,
  MUTATED_SAVANNA: 163,
  MUTATED_SAVANNA_ROCK: 164,
  MUTATED_MESA: 165,
  MUTATED_MESA_ROCK: 166,
  MUTATED_MESA_CLEAR_ROCK: 167,
});

export const MC18BiomeName = Object.freeze({
  0: "ocean",
  1: "plains",
  2: "desert",
  3: "extreme_hills",
  4: "forest",
  5: "taiga",
  6: "swampland",
  7: "river",
  8: "hell",
  9: "sky",
  10: "frozen_ocean",
  11: "frozen_river",
  12: "ice_flats",
  13: "ice_mountains",
  14: "mushroom_island",
  15: "mushroom_island_shore",
  16: "beaches",
  17: "desert_hills",
  18: "forest_hills",
  19: "taiga_hills",
  20: "smaller_extreme_hills",
  21: "jungle",
  22: "jungle_hills",
  23: "jungle_edge",
  24: "deep_ocean",
  25: "stone_beach",
  26: "cold_beach",
  27: "birch_forest",
  28: "birch_forest_hills",
  29: "roofed_forest",
  30: "taiga_cold",
  31: "taiga_cold_hills",
  32: "redwood_taiga",
  33: "redwood_taiga_hills",
  34: "extreme_hills_with_trees",
  35: "savanna",
  36: "savanna_rock",
  37: "mesa",
  38: "mesa_rock",
  39: "mesa_clear_rock",
  127: "void",
  129: "mutated_plains",
  130: "mutated_desert",
  131: "mutated_extreme_hills",
  132: "mutated_forest",
  133: "mutated_taiga",
  134: "mutated_swampland",
  140: "mutated_ice_flats",
  149: "mutated_jungle",
  151: "mutated_jungle_edge",
  155: "mutated_birch_forest",
  156: "mutated_birch_forest_hills",
  157: "mutated_roofed_forest",
  158: "mutated_taiga_cold",
  160: "mutated_redwood_taiga",
  161: "mutated_redwood_taiga_hills",
  162: "mutated_extreme_hills_with_trees",
  163: "mutated_savanna",
  164: "mutated_savanna_rock",
  165: "mutated_mesa",
  166: "mutated_mesa_rock",
  167: "mutated_mesa_clear_rock",
});

export const MC18Accuracy = Object.freeze({
  exact: [
    "Java signed 64-bit GenLayer RNG and overflow behavior",
    "1.8.x Overworld GenLayer biome stack, including rare/mutated variants, hills, shores, rivers, deep ocean, and Voronoi zoom",
    "DEFAULT, DEFAULT_1_1, LARGE_BIOMES, AMPLIFIED, CUSTOMIZED biomeSize/riverSize, SUPERFLAT biome override, Nether, and End biome lookup",
  ],
  approximations: [
    "This module only generates biome IDs. Terrain density, block replacement, decorators, structures, and mob spawn tables remain outside this biome-map implementation.",
  ],
});

const B = MC18BiomeID;
const WARM_DRY = [B.DESERT, B.DESERT, B.DESERT, B.SAVANNA, B.SAVANNA, B.PLAINS];
const TEMPERATE = [B.FOREST, B.ROOFED_FOREST, B.EXTREME_HILLS, B.PLAINS, B.BIRCH_FOREST, B.SWAMPLAND];
const COOL = [B.FOREST, B.EXTREME_HILLS, B.TAIGA, B.PLAINS];
const ICY = [B.ICE_FLATS, B.ICE_FLATS, B.ICE_FLATS, B.TAIGA_COLD];
const DEFAULT_1_1 = [B.DESERT, B.FOREST, B.EXTREME_HILLS, B.SWAMPLAND, B.PLAINS, B.TAIGA];

const BIOME_INFO = new Map([
  [B.OCEAN, info("ocean", "ocean", "rain", 0.5)],
  [B.PLAINS, info("plains", "plains", "rain", 0.8, null, B.MUTATED_PLAINS)],
  [B.DESERT, info("desert", "desert", "none", 2.0, null, B.MUTATED_DESERT)],
  [B.EXTREME_HILLS, info("extreme_hills", "extreme_hills", "rain", 0.2, null, B.MUTATED_EXTREME_HILLS)],
  [B.FOREST, info("forest", "forest", "rain", 0.7, null, B.MUTATED_FOREST)],
  [B.TAIGA, info("taiga", "taiga", "rain", 0.25, null, B.MUTATED_TAIGA)],
  [B.SWAMPLAND, info("swampland", "swamp", "rain", 0.8, null, B.MUTATED_SWAMPLAND)],
  [B.RIVER, info("river", "river", "rain", 0.5)],
  [B.HELL, info("hell", "nether", "none", 2.0)],
  [B.SKY, info("sky", "the_end", "none", 0.5)],
  [B.FROZEN_OCEAN, info("frozen_ocean", "ocean", "snow", 0.0)],
  [B.FROZEN_RIVER, info("frozen_river", "river", "snow", 0.0)],
  [B.ICE_FLATS, info("ice_flats", "icy", "snow", 0.0, null, B.MUTATED_ICE_FLATS)],
  [B.ICE_MOUNTAINS, info("ice_mountains", "icy", "snow", 0.0)],
  [B.MUSHROOM_ISLAND, info("mushroom_island", "mushroom", "rain", 0.9)],
  [B.MUSHROOM_ISLAND_SHORE, info("mushroom_island_shore", "mushroom", "rain", 0.9)],
  [B.BEACHES, info("beaches", "beach", "rain", 0.8)],
  [B.DESERT_HILLS, info("desert_hills", "desert", "none", 2.0)],
  [B.FOREST_HILLS, info("forest_hills", "forest", "rain", 0.7)],
  [B.TAIGA_HILLS, info("taiga_hills", "taiga", "rain", 0.25)],
  [B.SMALLER_EXTREME_HILLS, info("smaller_extreme_hills", "extreme_hills", "rain", 0.2)],
  [B.JUNGLE, info("jungle", "jungle", "rain", 0.95, null, B.MUTATED_JUNGLE)],
  [B.JUNGLE_HILLS, info("jungle_hills", "jungle", "rain", 0.95)],
  [B.JUNGLE_EDGE, info("jungle_edge", "jungle", "rain", 0.95, null, B.MUTATED_JUNGLE_EDGE)],
  [B.DEEP_OCEAN, info("deep_ocean", "ocean", "rain", 0.5)],
  [B.STONE_BEACH, info("stone_beach", "none", "rain", 0.2)],
  [B.COLD_BEACH, info("cold_beach", "beach", "snow", 0.05)],
  [B.BIRCH_FOREST, info("birch_forest", "forest", "rain", 0.6, null, B.MUTATED_BIRCH_FOREST)],
  [B.BIRCH_FOREST_HILLS, info("birch_forest_hills", "forest", "rain", 0.6, null, B.MUTATED_BIRCH_FOREST_HILLS)],
  [B.ROOFED_FOREST, info("roofed_forest", "forest", "rain", 0.7, null, B.MUTATED_ROOFED_FOREST)],
  [B.TAIGA_COLD, info("taiga_cold", "taiga", "snow", -0.5, null, B.MUTATED_TAIGA_COLD)],
  [B.TAIGA_COLD_HILLS, info("taiga_cold_hills", "taiga", "snow", -0.5)],
  [B.REDWOOD_TAIGA, info("redwood_taiga", "taiga", "rain", 0.3, null, B.MUTATED_REDWOOD_TAIGA)],
  [B.REDWOOD_TAIGA_HILLS, info("redwood_taiga_hills", "taiga", "rain", 0.3, null, B.MUTATED_REDWOOD_TAIGA_HILLS)],
  [B.EXTREME_HILLS_WITH_TREES, info("extreme_hills_with_trees", "extreme_hills", "rain", 0.2, null, B.MUTATED_EXTREME_HILLS_WITH_TREES)],
  [B.SAVANNA, info("savanna", "savanna", "none", 1.2, null, B.MUTATED_SAVANNA)],
  [B.SAVANNA_ROCK, info("savanna_rock", "savanna", "none", 1.0, null, B.MUTATED_SAVANNA_ROCK)],
  [B.MESA, info("mesa", "mesa", "none", 2.0, null, B.MUTATED_MESA)],
  [B.MESA_ROCK, info("mesa_rock", "mesa", "none", 2.0, null, B.MUTATED_MESA_ROCK)],
  [B.MESA_CLEAR_ROCK, info("mesa_clear_rock", "mesa", "none", 2.0, null, B.MUTATED_MESA_CLEAR_ROCK)],
  [B.VOID, info("void", "none", "none", 0.5)],
  [B.MUTATED_PLAINS, info("mutated_plains", "plains", "rain", 0.8, B.PLAINS)],
  [B.MUTATED_DESERT, info("mutated_desert", "desert", "none", 2.0, B.DESERT)],
  [B.MUTATED_EXTREME_HILLS, info("mutated_extreme_hills", "extreme_hills", "rain", 0.2, B.EXTREME_HILLS)],
  [B.MUTATED_FOREST, info("mutated_forest", "forest", "rain", 0.7, B.FOREST)],
  [B.MUTATED_TAIGA, info("mutated_taiga", "taiga", "rain", 0.25, B.TAIGA)],
  [B.MUTATED_SWAMPLAND, info("mutated_swampland", "swamp", "rain", 0.8, B.SWAMPLAND)],
  [B.MUTATED_ICE_FLATS, info("mutated_ice_flats", "icy", "snow", 0.0, B.ICE_FLATS)],
  [B.MUTATED_JUNGLE, info("mutated_jungle", "jungle", "rain", 0.95, B.JUNGLE)],
  [B.MUTATED_JUNGLE_EDGE, info("mutated_jungle_edge", "jungle", "rain", 0.95, B.JUNGLE_EDGE)],
  [B.MUTATED_BIRCH_FOREST, info("mutated_birch_forest", "forest", "rain", 0.6, B.BIRCH_FOREST)],
  [B.MUTATED_BIRCH_FOREST_HILLS, info("mutated_birch_forest_hills", "forest", "rain", 0.6, B.BIRCH_FOREST_HILLS)],
  [B.MUTATED_ROOFED_FOREST, info("mutated_roofed_forest", "forest", "rain", 0.7, B.ROOFED_FOREST)],
  [B.MUTATED_TAIGA_COLD, info("mutated_taiga_cold", "taiga", "snow", -0.5, B.TAIGA_COLD)],
  [B.MUTATED_REDWOOD_TAIGA, info("mutated_redwood_taiga", "taiga", "rain", 0.25, B.REDWOOD_TAIGA)],
  [B.MUTATED_REDWOOD_TAIGA_HILLS, info("mutated_redwood_taiga_hills", "taiga", "rain", 0.25, B.REDWOOD_TAIGA_HILLS)],
  [B.MUTATED_EXTREME_HILLS_WITH_TREES, info("mutated_extreme_hills_with_trees", "extreme_hills", "rain", 0.2, B.EXTREME_HILLS_WITH_TREES)],
  [B.MUTATED_SAVANNA, info("mutated_savanna", "savanna", "none", 1.1, B.SAVANNA)],
  [B.MUTATED_SAVANNA_ROCK, info("mutated_savanna_rock", "savanna", "none", 1.0, B.SAVANNA_ROCK)],
  [B.MUTATED_MESA, info("mutated_mesa", "mesa", "none", 2.0, B.MESA)],
  [B.MUTATED_MESA_ROCK, info("mutated_mesa_rock", "mesa", "none", 2.0, B.MESA_ROCK)],
  [B.MUTATED_MESA_CLEAR_ROCK, info("mutated_mesa_clear_rock", "mesa", "none", 2.0, B.MESA_CLEAR_ROCK)],
]);

const BIOME_ID_BY_NAME = new Map();
for (const [idText, name] of Object.entries(MC18BiomeName)) {
  const id = Number(idText);
  BIOME_ID_BY_NAME.set(name, id);
  BIOME_ID_BY_NAME.set(name.replaceAll("_", ""), id);
  BIOME_ID_BY_NAME.set(`minecraft:${name}`, id);
}
BIOME_ID_BY_NAME.set("beach", B.BEACHES);
BIOME_ID_BY_NAME.set("mushroom_shore", B.MUSHROOM_ISLAND_SHORE);
BIOME_ID_BY_NAME.set("ice_plains", B.ICE_FLATS);
BIOME_ID_BY_NAME.set("cold_taiga", B.TAIGA_COLD);
BIOME_ID_BY_NAME.set("cold_taiga_hills", B.TAIGA_COLD_HILLS);
BIOME_ID_BY_NAME.set("mega_taiga", B.REDWOOD_TAIGA);
BIOME_ID_BY_NAME.set("mega_taiga_hills", B.REDWOOD_TAIGA_HILLS);
BIOME_ID_BY_NAME.set("mesa_plateau_f", B.MESA_ROCK);
BIOME_ID_BY_NAME.set("mesa_plateau", B.MESA_CLEAR_ROCK);
BIOME_ID_BY_NAME.set("sky", B.SKY);
BIOME_ID_BY_NAME.set("hell", B.HELL);

const sourceCache = new Map();

export function createMinecraft18BiomeSource(seed, worldType = "DEFAULT", generatorSettings = undefined) {
  return new Minecraft18BiomeSource(seed, worldType, generatorSettings);
}

export function getBiome(seed, worldType, x, z, generatorSettings = undefined) {
  return cachedSource(seed, worldType, generatorSettings).getBiome(x, z, true);
}

export function getBiomeName(seed, worldType, x, z, generatorSettings = undefined) {
  return MC18BiomeName[getBiome(seed, worldType, x, z, generatorSettings)] ?? "unknown";
}

export function getBiomes(seed, worldType, startX, startZ, width, height, useVoronoi = true, generatorSettings = undefined) {
  return cachedSource(seed, worldType, generatorSettings).getBiomes(startX, startZ, width, height, useVoronoi);
}

export function debugGenLayers(
  seed,
  worldType,
  startX,
  startZ,
  width,
  height,
  useVoronoi = true,
  generatorSettings = undefined,
  options = {},
) {
  const source = createMinecraft18BiomeSource(seed, worldType, generatorSettings);
  const text = source.debugLayers(startX, startZ, width, height, useVoronoi);
  if (options.print !== false) console.log(text);
  return text;
}

export class Minecraft18BiomeSource {
  constructor(seed, worldType = "DEFAULT", generatorSettings = undefined) {
    this.seed = seedToLong(seed);
    this.worldType = normalizeWorldType(worldType);
    this.generatorSettings = generatorSettings;
    this.settings = parseGeneratorSettings(this.worldType, generatorSettings);
    this.constantBiome = constantBiomeFor(this.worldType, generatorSettings);
    this.layers = [];

    if (this.constantBiome === null) this.buildOverworldLayers();
  }

  getBiome(x, z, useVoronoi = true) {
    if (this.constantBiome !== null) return this.constantBiome;
    return (useVoronoi ? this.voronoi : this.full).get(x, z);
  }

  getBiomes(startX, startZ, width, height, useVoronoi = true) {
    const out = new Int32Array(width * height);
    for (let dz = 0; dz < height; dz += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        out[dz * width + dx] = this.getBiome(startX + dx, startZ + dz, useVoronoi);
      }
    }
    return out;
  }

  debugLayers(startX, startZ, width, height, useVoronoi = true) {
    if (this.constantBiome !== null) {
      return formatGrid(`constant:${MC18BiomeName[this.constantBiome]}`, this.getBiomes(startX, startZ, width, height), width, height);
    }

    const layers = useVoronoi ? this.layers : this.layers.filter((layer) => layer !== this.voronoi);
    return layers.map((layer) => {
      const values = new Int32Array(width * height);
      for (let dz = 0; dz < height; dz += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          values[dz * width + dx] = layer.get(startX + dx, startZ + dz);
        }
      }
      return formatGrid(layer.name, values, width, height);
    }).join("\n\n");
  }

  add(layer) {
    this.layers.push(layer);
    return layer;
  }

  magnify(name, salt, parent, count, seed = this.seed) {
    let current = parent;
    for (let i = 0; i < count; i += 1) {
      current = this.add(new GenLayerZoom(`${name}${i}`, salt + BigInt(i), current, seed));
    }
    return current;
  }

  buildOverworldLayers() {
    let base = this.add(new GenLayerIsland("GenLayerIsland(1)", 1n, this.seed));
    base = this.add(new GenLayerZoom("GenLayerFuzzyZoom(2000)", 2000n, base, this.seed, true));
    base = this.add(new GenLayerAddIsland("GenLayerAddIsland(1)", 1n, base, this.seed));
    base = this.add(new GenLayerZoom("GenLayerZoom(2001)", 2001n, base, this.seed));
    base = this.add(new GenLayerAddIsland("GenLayerAddIsland(2)", 2n, base, this.seed));
    base = this.add(new GenLayerAddIsland("GenLayerAddIsland(50)", 50n, base, this.seed));
    base = this.add(new GenLayerAddIsland("GenLayerAddIsland(70)", 70n, base, this.seed));
    base = this.add(new GenLayerRemoveTooMuchOcean("GenLayerRemoveTooMuchOcean(2)", 2n, base, this.seed));
    base = this.add(new GenLayerAddSnow("GenLayerAddSnow(2)", 2n, base, this.seed));
    base = this.add(new GenLayerAddIsland("GenLayerAddIsland(3)", 3n, base, this.seed));
    base = this.add(new GenLayerEdge("GenLayerEdge(2,COOL_WARM)", 2n, base, this.seed, "COOL_WARM"));
    base = this.add(new GenLayerEdge("GenLayerEdge(2,HEAT_ICE)", 2n, base, this.seed, "HEAT_ICE"));
    base = this.add(new GenLayerEdge("GenLayerEdge(3,SPECIAL)", 3n, base, this.seed, "SPECIAL"));
    base = this.add(new GenLayerZoom("GenLayerZoom(2002)", 2002n, base, this.seed));
    base = this.add(new GenLayerZoom("GenLayerZoom(2003)", 2003n, base, this.seed));
    base = this.add(new GenLayerAddIsland("GenLayerAddIsland(4)", 4n, base, this.seed));
    base = this.add(new GenLayerAddMushroomIsland("GenLayerAddMushroomIsland(5)", 5n, base, this.seed));
    base = this.add(new GenLayerDeepOcean("GenLayerDeepOcean(4)", 4n, base, this.seed));

    const baseCopy = this.magnify("GenLayerZoom(baseCopy,1000+)", 1000n, base, 0);
    const riverInitBase = this.magnify("GenLayerZoom(riverInitBase,1000+)", 1000n, baseCopy, 0);
    const riverInit = this.add(new GenLayerRiverInit("GenLayerRiverInit(100)", 100n, riverInitBase, this.seed));

    let biomes = this.add(new GenLayerBiome("GenLayerBiome(200)", 200n, baseCopy, this.seed, this.settings.useDefault1_1));
    biomes = this.magnify("GenLayerZoom(biomePreEdge,1000+)", 1000n, biomes, 2);
    biomes = this.add(new GenLayerBiomeEdge("GenLayerBiomeEdge(1000)", 1000n, biomes, this.seed));

    let hillsNoise = this.add(new GenLayerZoom("GenLayerZoom(hillsNoise,0)#0", 0n, riverInit, 0n));
    hillsNoise = this.add(new GenLayerZoom("GenLayerZoom(hillsNoise,0)#1", 0n, hillsNoise, 0n));
    let variants = this.add(new GenLayerHills("GenLayerHills(1000)", 1000n, biomes, hillsNoise, this.seed));
    variants = this.add(new GenLayerRareBiome("GenLayerRareBiome(1001)", 1001n, variants, this.seed));

    for (let i = 0; i < this.settings.biomeSize; i += 1) {
      variants = this.add(new GenLayerZoom(`GenLayerZoom(${1000 + i})`, BigInt(1000 + i), variants, this.seed));
      if (i === 0) variants = this.add(new GenLayerAddIsland("GenLayerAddIsland(3,biomeZoom0)", 3n, variants, this.seed));
      if (i === 1 || this.settings.biomeSize === 1) {
        variants = this.add(new GenLayerShore("GenLayerShore(1000)", 1000n, variants, this.seed));
      }
    }

    variants = this.add(new GenLayerSmooth("GenLayerSmooth(1000,biomes)", 1000n, variants, this.seed));

    let river = this.magnify("GenLayerZoom(riverPre,1000+)", 1000n, riverInit, 2);
    river = this.magnify("GenLayerZoom(riverSize,1000+)", 1000n, river, this.settings.riverSize);
    river = this.add(new GenLayerRiver("GenLayerRiver(1)", 1n, river, this.seed));
    river = this.add(new GenLayerSmooth("GenLayerSmooth(1000,rivers)", 1000n, river, this.seed));

    this.full = this.add(new GenLayerRiverMix("GenLayerRiverMix(100)", 100n, variants, river, this.seed));
    this.voronoi = this.add(new GenLayerVoronoiZoom("GenLayerVoronoiZoom(10)", 10n, this.full, this.seed));
  }
}

class GenLayer {
  constructor(name, salt, parentOrParents, seed) {
    this.name = name;
    this.salt = BigInt(salt);
    this.parents = [];
    if (Array.isArray(parentOrParents)) this.parents = parentOrParents.filter(Boolean);
    else if (parentOrParents) this.parents = [parentOrParents];
    this.layerSeed = getLayerSeed(seed, this.salt);
    this.localSeed = 0n;
    this.cache = new Map();
  }

  get parent() {
    return this.parents[0];
  }

  get(x, z) {
    const key = `${x},${z}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const value = this.sample(x, z);
    this.cache.set(key, value);
    if (this.cache.size > 8192) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  initChunkSeed(x, z) {
    this.localSeed = getLocalSeed(this.layerSeed, x, z);
  }

  nextInt(bound) {
    const result = Number(floorModBigInt(this.localSeed >> 24n, BigInt(bound)));
    this.localSeed = mixSeed(this.localSeed, this.layerSeed);
    return result;
  }

  choose(...values) {
    return values[this.nextInt(values.length)];
  }
}

class GenLayerIsland extends GenLayer {
  constructor(name, salt, seed) {
    super(name, salt, null, seed);
  }

  sample(x, z) {
    this.initChunkSeed(x, z);
    return (x === 0 && z === 0) || this.nextInt(10) === 0 ? B.PLAINS : B.OCEAN;
  }
}

class GenLayerZoom extends GenLayer {
  constructor(name, salt, parent, seed, fuzzy = false) {
    super(name, salt, parent, seed);
    this.fuzzy = fuzzy;
  }

  sample(x, z) {
    const parentX = floorDiv2(x);
    const parentZ = floorDiv2(z);
    const center = this.parent.get(parentX, parentZ);
    this.initChunkSeed(clearLowBit(x), clearLowBit(z));

    const oddX = floorMod(x, 2);
    const oddZ = floorMod(z, 2);
    if (oddX === 0 && oddZ === 0) return center;

    const south = this.parent.get(parentX, floorDiv2(z + 1));
    const zChoice = this.choose(center, south);
    if (oddX === 0) return zChoice;

    const east = this.parent.get(floorDiv2(x + 1), parentZ);
    const xChoice = this.choose(center, east);
    if (oddZ === 0) return xChoice;

    const southeast = this.parent.get(floorDiv2(x + 1), floorDiv2(z + 1));
    return this.selectModeOrRandom(center, east, south, southeast);
  }

  selectModeOrRandom(center, east, south, southeast) {
    const random = this.choose(center, east, south, southeast);
    if (this.fuzzy) return random;
    if (east === south && east === southeast) return east;
    if (center === east && south !== southeast) return center;
    if (center === south && east !== southeast) return center;
    if (center === southeast && east !== south) return center;
    if (east === south && center !== southeast) return east;
    if (east === southeast && center !== south) return east;
    if (south === southeast && center !== east) return south;
    return random;
  }
}

class GenLayerAddIsland extends GenLayer {
  sample(x, z) {
    const northwest = this.parent.get(x - 1, z - 1);
    const northeast = this.parent.get(x + 1, z - 1);
    const southwest = this.parent.get(x - 1, z + 1);
    const southeast = this.parent.get(x + 1, z + 1);
    const center = this.parent.get(x, z);
    this.initChunkSeed(x, z);

    if (!isShallowOcean(center) || all(isShallowOcean, northwest, northeast, southwest, southeast)) {
      if (isShallowOcean(center) || all((id) => !isShallowOcean(id), northwest, northeast, southwest, southeast) || this.nextInt(5) !== 0) {
        return center;
      }
      if (isShallowOcean(northwest)) return center === B.FOREST ? B.FOREST : northwest;
      if (isShallowOcean(southwest)) return center === B.FOREST ? B.FOREST : southwest;
      if (isShallowOcean(northeast)) return center === B.FOREST ? B.FOREST : northeast;
      if (isShallowOcean(southeast)) return center === B.FOREST ? B.FOREST : southeast;
      return center;
    }

    let count = 1;
    let selected = B.PLAINS;
    if (!isShallowOcean(northwest) && this.nextInt(count++) === 0) selected = northwest;
    if (!isShallowOcean(northeast) && this.nextInt(count++) === 0) selected = northeast;
    if (!isShallowOcean(southwest) && this.nextInt(count++) === 0) selected = southwest;
    if (!isShallowOcean(southeast) && this.nextInt(count) === 0) selected = southeast;
    if (this.nextInt(3) === 0) return selected;
    return selected === B.FOREST ? B.FOREST : center;
  }
}

class GenLayerRemoveTooMuchOcean extends GenLayer {
  sample(x, z) {
    const center = this.parent.get(x, z);
    const north = this.parent.get(x, z - 1);
    const east = this.parent.get(x + 1, z);
    const south = this.parent.get(x, z + 1);
    const west = this.parent.get(x - 1, z);
    this.initChunkSeed(x, z);
    return all(isShallowOcean, center, north, east, south, west) && this.nextInt(2) === 0 ? B.PLAINS : center;
  }
}

class GenLayerAddSnow extends GenLayer {
  sample(x, z) {
    const value = this.parent.get(x, z);
    if (isShallowOcean(value)) return value;
    this.initChunkSeed(x, z);
    const roll = this.nextInt(6);
    if (roll === 0) return B.FOREST;
    return roll === 1 ? B.EXTREME_HILLS : B.PLAINS;
  }
}

class GenLayerEdge extends GenLayer {
  constructor(name, salt, parent, seed, mode) {
    super(name, salt, parent, seed);
    this.mode = mode;
  }

  sample(x, z) {
    if (this.mode === "SPECIAL") return this.sampleSpecial(x, z);
    const center = this.parent.get(x, z);
    const north = this.parent.get(x, z - 1);
    const east = this.parent.get(x + 1, z);
    const south = this.parent.get(x, z + 1);
    const west = this.parent.get(x - 1, z);

    if (this.mode === "COOL_WARM") {
      return center === B.PLAINS && any((id) => id === B.EXTREME_HILLS || id === B.FOREST, north, east, south, west)
        ? B.DESERT
        : center;
    }

    if (this.mode === "HEAT_ICE") {
      return center === B.FOREST && any((id) => id === B.PLAINS || id === B.DESERT, north, east, south, west)
        ? B.EXTREME_HILLS
        : center;
    }

    return center;
  }

  sampleSpecial(x, z) {
    let value = this.parent.get(x, z);
    if (isShallowOcean(value)) return value;
    this.initChunkSeed(x, z);
    if (this.nextInt(13) === 0) value |= (1 + this.nextInt(15)) << 8;
    return value;
  }
}

class GenLayerAddMushroomIsland extends GenLayer {
  sample(x, z) {
    const northwest = this.parent.get(x - 1, z - 1);
    const northeast = this.parent.get(x + 1, z - 1);
    const southwest = this.parent.get(x - 1, z + 1);
    const southeast = this.parent.get(x + 1, z + 1);
    const center = this.parent.get(x, z);
    this.initChunkSeed(x, z);
    return all(isShallowOcean, center, northwest, northeast, southwest, southeast) && this.nextInt(100) === 0
      ? B.MUSHROOM_ISLAND
      : center;
  }
}

class GenLayerDeepOcean extends GenLayer {
  sample(x, z) {
    const center = this.parent.get(x, z);
    if (!isShallowOcean(center)) return center;
    let oceanNeighbors = 0;
    if (isShallowOcean(this.parent.get(x, z - 1))) oceanNeighbors += 1;
    if (isShallowOcean(this.parent.get(x + 1, z))) oceanNeighbors += 1;
    if (isShallowOcean(this.parent.get(x, z + 1))) oceanNeighbors += 1;
    if (isShallowOcean(this.parent.get(x - 1, z))) oceanNeighbors += 1;
    return oceanNeighbors > 3 ? B.DEEP_OCEAN : center;
  }
}

class GenLayerRiverInit extends GenLayer {
  sample(x, z) {
    this.initChunkSeed(x, z);
    const value = this.parent.get(x, z);
    return isShallowOcean(value) ? value : this.nextInt(299999) + 2;
  }
}

class GenLayerBiome extends GenLayer {
  constructor(name, salt, parent, seed, useDefault1_1 = false) {
    super(name, salt, parent, seed);
    this.useDefault1_1 = useDefault1_1;
  }

  sample(x, z) {
    this.initChunkSeed(x, z);
    let climate = this.parent.get(x, z);
    const special = (climate >> 8) & 15;
    climate &= ~0xf00;

    if (isOcean(climate) || climate === B.MUSHROOM_ISLAND) return climate;

    if (climate === B.PLAINS) {
      if (special > 0) return this.nextInt(3) === 0 ? B.MESA_CLEAR_ROCK : B.MESA_ROCK;
      if (this.useDefault1_1) return DEFAULT_1_1[this.nextInt(DEFAULT_1_1.length)];
      return WARM_DRY[this.nextInt(WARM_DRY.length)];
    }

    if (climate === B.DESERT) {
      if (special > 0) return B.JUNGLE;
      return TEMPERATE[this.nextInt(TEMPERATE.length)];
    }

    if (climate === B.EXTREME_HILLS) {
      if (special > 0) return B.REDWOOD_TAIGA;
      return COOL[this.nextInt(COOL.length)];
    }

    if (climate === B.FOREST) {
      return ICY[this.nextInt(ICY.length)];
    }

    return B.MUSHROOM_ISLAND;
  }
}

class GenLayerBiomeEdge extends GenLayer {
  sample(x, z) {
    const center = this.parent.get(x, z);
    const north = this.parent.get(x, z - 1);
    const east = this.parent.get(x + 1, z);
    const south = this.parent.get(x, z + 1);
    const west = this.parent.get(x - 1, z);

    const extreme = this.replaceEdgeIfNeeded(north, east, south, west, center, B.EXTREME_HILLS, B.SMALLER_EXTREME_HILLS);
    if (extreme.matched) return extreme.value;

    const mesaF = this.replaceEdge(north, east, south, west, center, B.MESA_ROCK, B.MESA);
    if (!mesaF.keepChecking) return mesaF.value;

    const mesa = this.replaceEdge(north, east, south, west, center, B.MESA_CLEAR_ROCK, B.MESA);
    if (!mesa.keepChecking) return mesa.value;

    const redwood = this.replaceEdge(north, east, south, west, center, B.REDWOOD_TAIGA, B.TAIGA);
    if (!redwood.keepChecking) return redwood.value;

    if (center === B.DESERT && any((id) => id === B.ICE_FLATS, north, east, west, south)) {
      return B.EXTREME_HILLS_WITH_TREES;
    }

    if (center === B.SWAMPLAND) {
      if (any((id) => id === B.DESERT || id === B.ICE_FLATS || id === B.TAIGA_COLD, north, east, west, south)) {
        return B.PLAINS;
      }
      if (any((id) => id === B.JUNGLE, north, east, west, south)) return B.JUNGLE_EDGE;
    }

    return center;
  }

  replaceEdgeIfNeeded(north, east, south, west, center, biome, edgeBiome) {
    if (!areSimilar(center, biome)) return { matched: false, value: center };
    const value = this.canBiomesBeNeighbors(north, biome) &&
      this.canBiomesBeNeighbors(east, biome) &&
      this.canBiomesBeNeighbors(west, biome) &&
      this.canBiomesBeNeighbors(south, biome)
      ? center
      : edgeBiome;
    return { matched: true, value };
  }

  replaceEdge(north, east, south, west, center, biome, edgeBiome) {
    if (center !== biome) return { keepChecking: true, value: center };
    const value = areSimilar(north, biome) && areSimilar(east, biome) && areSimilar(west, biome) && areSimilar(south, biome)
      ? center
      : edgeBiome;
    return { keepChecking: false, value };
  }

  canBiomesBeNeighbors(id, biome) {
    if (areSimilar(id, biome)) return true;
    const a = biomeInfo(id);
    const bInfo = biomeInfo(biome);
    if (!a || !bInfo) return false;
    const tempA = temperatureGroup(a);
    const tempB = temperatureGroup(bInfo);
    return tempA === tempB || tempA === "medium" || tempB === "medium";
  }
}

class GenLayerHills extends GenLayer {
  constructor(name, salt, biomes, noise, seed) {
    super(name, salt, [biomes, noise], seed);
    this.biomes = biomes;
    this.noise = noise;
  }

  sample(x, z) {
    this.initChunkSeed(x, z);
    const base = this.biomes.get(x, z);
    let toHills = this.nextInt(3) === 0;
    const noiseValue = this.noise.get(x, z);
    const mutationRoll = (noiseValue - 2) % 29;

    if (!isShallowOcean(base) && noiseValue >= 2 && mutationRoll === 1) {
      const child = biomeInfo(base)?.child;
      return child ?? base;
    }

    if (mutationRoll === 0) toHills = true;
    if (!toHills) return base;

    let variant = base;
    if (base === B.DESERT) variant = B.DESERT_HILLS;
    else if (base === B.FOREST) variant = B.FOREST_HILLS;
    else if (base === B.BIRCH_FOREST) variant = B.BIRCH_FOREST_HILLS;
    else if (base === B.ROOFED_FOREST) variant = B.PLAINS;
    else if (base === B.TAIGA) variant = B.TAIGA_HILLS;
    else if (base === B.REDWOOD_TAIGA) variant = B.REDWOOD_TAIGA_HILLS;
    else if (base === B.TAIGA_COLD) variant = B.TAIGA_COLD_HILLS;
    else if (base === B.PLAINS) variant = this.nextInt(3) === 0 ? B.FOREST_HILLS : B.FOREST;
    else if (base === B.ICE_FLATS) variant = B.ICE_MOUNTAINS;
    else if (base === B.JUNGLE) variant = B.JUNGLE_HILLS;
    else if (base === B.OCEAN) variant = B.DEEP_OCEAN;
    else if (base === B.EXTREME_HILLS) variant = B.EXTREME_HILLS_WITH_TREES;
    else if (base === B.SAVANNA) variant = B.SAVANNA_ROCK;
    else if (areSimilar(base, B.MESA_ROCK)) variant = B.MESA;
    else if (base === B.DEEP_OCEAN && this.nextInt(3) === 0) variant = this.nextInt(2) === 0 ? B.PLAINS : B.FOREST;

    if (mutationRoll === 0 && variant !== base) {
      variant = biomeInfo(variant)?.child ?? base;
    }

    if (variant === base) return base;

    let similar = 0;
    if (areSimilar(this.biomes.get(x, z - 1), base)) similar += 1;
    if (areSimilar(this.biomes.get(x + 1, z), base)) similar += 1;
    if (areSimilar(this.biomes.get(x - 1, z), base)) similar += 1;
    if (areSimilar(this.biomes.get(x, z + 1), base)) similar += 1;
    return similar >= 3 ? variant : base;
  }
}

class GenLayerRareBiome extends GenLayer {
  sample(x, z) {
    this.initChunkSeed(x, z);
    const value = this.parent.get(x, z);
    return value === B.PLAINS && this.nextInt(57) === 0 ? B.MUTATED_PLAINS : value;
  }
}

class GenLayerShore extends GenLayer {
  sample(x, z) {
    const center = this.parent.get(x, z);
    const north = this.parent.get(x, z - 1);
    const east = this.parent.get(x + 1, z);
    const south = this.parent.get(x, z + 1);
    const west = this.parent.get(x - 1, z);
    const centerInfo = biomeInfo(center);

    if (center === B.MUSHROOM_ISLAND) {
      return all((id) => !isShallowOcean(id), north, east, south, west) ? center : B.MUSHROOM_ISLAND_SHORE;
    }

    if (centerInfo?.category === "jungle") {
      if (!all(isWoodedForJungleEdge, north, east, south, west)) return B.JUNGLE_EDGE;
      return all((id) => !isOcean(id), north, east, south, west) ? center : B.BEACHES;
    }

    if (center !== B.EXTREME_HILLS && center !== B.EXTREME_HILLS_WITH_TREES && center !== B.SMALLER_EXTREME_HILLS) {
      if (centerInfo?.precipitation === "snow") {
        if (!isOcean(center) && !all((id) => !isOcean(id), north, east, south, west)) return B.COLD_BEACH;
      } else if (center !== B.MESA && center !== B.MESA_ROCK) {
        if (!isOcean(center) && center !== B.RIVER && center !== B.SWAMPLAND && !all((id) => !isOcean(id), north, east, south, west)) {
          return B.BEACHES;
        }
      } else if (all((id) => !isOcean(id), north, east, south, west) && !all(isMesaLike, north, east, south, west)) {
        return B.DESERT;
      }
    } else if (!isOcean(center) && !all((id) => !isOcean(id), north, east, south, west)) {
      return B.STONE_BEACH;
    }

    return center;
  }
}

class GenLayerRiver extends GenLayer {
  sample(x, z) {
    const center = riverFilter(this.parent.get(x, z));
    const north = riverFilter(this.parent.get(x, z - 1));
    const east = riverFilter(this.parent.get(x + 1, z));
    const south = riverFilter(this.parent.get(x, z + 1));
    const west = riverFilter(this.parent.get(x - 1, z));
    return center === north && center === east && center === south && center === west ? -1 : B.RIVER;
  }
}

class GenLayerSmooth extends GenLayer {
  sample(x, z) {
    const center = this.parent.get(x, z);
    const north = this.parent.get(x, z - 1);
    const east = this.parent.get(x + 1, z);
    const south = this.parent.get(x, z + 1);
    const west = this.parent.get(x - 1, z);
    const xMatches = east === west;
    const zMatches = north === south;
    if (xMatches && zMatches) {
      this.initChunkSeed(x, z);
      return this.choose(west, north);
    }
    if (xMatches) return west;
    if (zMatches) return north;
    return center;
  }
}

class GenLayerRiverMix extends GenLayer {
  constructor(name, salt, biomes, rivers, seed) {
    super(name, salt, [biomes, rivers], seed);
    this.biomes = biomes;
    this.rivers = rivers;
  }

  sample(x, z) {
    const biome = this.biomes.get(x, z);
    const river = this.rivers.get(x, z);
    if (isOcean(biome)) return biome;
    if (river === B.RIVER) {
      if (biome === B.ICE_FLATS) return B.FROZEN_RIVER;
      return biome !== B.MUSHROOM_ISLAND && biome !== B.MUSHROOM_ISLAND_SHORE ? B.RIVER : B.MUSHROOM_ISLAND_SHORE;
    }
    return biome;
  }
}

class GenLayerVoronoiZoom extends GenLayer {
  sample(x, z) {
    let sampleX = x - 2;
    let sampleZ = z - 2;
    const parentX = floorDiv4(sampleX);
    const parentZ = floorDiv4(sampleZ);
    const cellX = parentX << 2;
    const cellZ = parentZ << 2;
    const offsets = [
      this.offset(cellX, cellZ, 0, 0),
      this.offset(cellX, cellZ, 4, 0),
      this.offset(cellX, cellZ, 0, 4),
      this.offset(cellX, cellZ, 4, 4),
    ];
    const localX = floorMod(sampleX, 4);
    const localZ = floorMod(sampleZ, 4);
    const distances = [
      contribution(offsets[0], localX, localZ),
      contribution(offsets[1], localX, localZ),
      contribution(offsets[2], localX, localZ),
      contribution(offsets[3], localX, localZ),
    ];
    let selected = 3;
    if (distances[0] < distances[1] && distances[0] < distances[2] && distances[0] < distances[3]) selected = 0;
    else if (distances[1] < distances[0] && distances[1] < distances[2] && distances[1] < distances[3]) selected = 1;
    else if (distances[2] < distances[0] && distances[2] < distances[1] && distances[2] < distances[3]) selected = 2;
    return this.parent.get(parentX + (selected & 1), parentZ + (selected >> 1));
  }

  offset(x, z, offX, offZ) {
    let mixed = mixSeed(this.layerSeed, BigInt(x + offX));
    mixed = mixSeed(mixed, BigInt(z + offZ));
    mixed = mixSeed(mixed, BigInt(x + offX));
    mixed = mixSeed(mixed, BigInt(z + offZ));
    const dx = (Number(floorModBigInt(mixed >> 24n, 1024n)) / 1024.0 - 0.5) * 3.6 + offX;
    mixed = mixSeed(mixed, this.layerSeed);
    const dz = (Number(floorModBigInt(mixed >> 24n, 1024n)) / 1024.0 - 0.5) * 3.6 + offZ;
    return [dx, dz];
  }
}

function cachedSource(seed, worldType, generatorSettings) {
  const key = `${seedToLong(seed).toString()}:${normalizeWorldType(worldType)}:${JSON.stringify(generatorSettings ?? null)}`;
  let source = sourceCache.get(key);
  if (!source) {
    source = createMinecraft18BiomeSource(seed, worldType, generatorSettings);
    sourceCache.set(key, source);
    if (sourceCache.size > 16) sourceCache.delete(sourceCache.keys().next().value);
  }
  return source;
}

function info(name, category, precipitation, temperature, parent = null, child = null) {
  return { name, category, precipitation, temperature, parent, child };
}

function biomeInfo(id) {
  return BIOME_INFO.get(id) ?? null;
}

function isShallowOcean(id) {
  return id === B.OCEAN;
}

function isOcean(id) {
  return id === B.OCEAN || id === B.FROZEN_OCEAN || id === B.DEEP_OCEAN;
}

function areSimilar(id, biome) {
  if (id === biome) return true;
  const a = biomeInfo(id);
  const bInfo = biomeInfo(biome);
  if (!a || !bInfo) return false;
  if (id !== B.MESA_ROCK && id !== B.MESA_CLEAR_ROCK) {
    return a.category !== "none" && bInfo.category !== "none" && a.category === bInfo.category;
  }
  return biome === B.MESA_ROCK || biome === B.MESA_CLEAR_ROCK;
}

function temperatureGroup(biome) {
  if (biome.category === "ocean") return "ocean";
  if (biome.temperature < 0.2) return "cold";
  if (biome.temperature < 1.0) return "medium";
  return "warm";
}

function isWoodedForJungleEdge(id) {
  const biome = biomeInfo(id);
  return biome?.category === "jungle" ||
    id === B.JUNGLE_EDGE ||
    id === B.JUNGLE ||
    id === B.JUNGLE_HILLS ||
    id === B.FOREST ||
    id === B.TAIGA ||
    isOcean(id);
}

function isMesaLike(id) {
  return id === B.MESA || id === B.MESA_ROCK || id === B.MESA_CLEAR_ROCK ||
    id === B.MUTATED_MESA || id === B.MUTATED_MESA_ROCK || id === B.MUTATED_MESA_CLEAR_ROCK;
}

function riverFilter(value) {
  return value >= 2 ? 2 + (value & 1) : value;
}

function all(predicate, ...values) {
  return values.every(predicate);
}

function any(predicate, ...values) {
  return values.some(predicate);
}

function contribution(offset, x, z) {
  return (x - offset[0]) * (x - offset[0]) + (z - offset[1]) * (z - offset[1]);
}

function long(value) {
  return BigInt.asIntN(LONG_BITS, BigInt(value));
}

function mixSeed(seed, salt) {
  return long(long(seed) * long(long(seed) * MULTIPLIER + ADDEND) + long(salt));
}

function getMidSalt(salt) {
  let mid = long(salt);
  mid = mixSeed(mid, salt);
  mid = mixSeed(mid, salt);
  mid = mixSeed(mid, salt);
  return mid;
}

function getLayerSeed(seed, salt) {
  const midSalt = getMidSalt(salt);
  let layerSeed = long(seed);
  layerSeed = mixSeed(layerSeed, midSalt);
  layerSeed = mixSeed(layerSeed, midSalt);
  layerSeed = mixSeed(layerSeed, midSalt);
  return layerSeed;
}

function getLocalSeed(layerSeed, x, z) {
  let local = long(layerSeed);
  local = mixSeed(local, BigInt(x));
  local = mixSeed(local, BigInt(z));
  local = mixSeed(local, BigInt(x));
  local = mixSeed(local, BigInt(z));
  return local;
}

function floorModBigInt(value, mod) {
  const result = value % mod;
  return result < 0n ? result + mod : result;
}

function floorDiv2(value) {
  return Math.floor(value / 2);
}

function floorDiv4(value) {
  return Math.floor(value / 4);
}

function floorMod(value, mod) {
  return ((value % mod) + mod) % mod;
}

function clearLowBit(value) {
  return value - floorMod(value, 2);
}

function seedToLong(seed) {
  if (typeof seed === "bigint") return long(seed);
  if (typeof seed === "number") return long(BigInt(Math.trunc(seed)));
  if (typeof seed === "string") {
    const trimmed = seed.trim();
    if (/^[+-]?\d+$/.test(trimmed)) return long(BigInt(trimmed));
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = Math.imul(31, hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    return long(BigInt(hash));
  }
  return 0n;
}

function normalizeWorldType(worldType) {
  const type = String(worldType ?? "DEFAULT").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (type === "NORMAL") return "DEFAULT";
  if (type === "LARGE") return "LARGE_BIOMES";
  if (type === "SUPERFLAT") return "FLAT";
  if (type === "NETHER") return "HELL";
  if (type === "END") return "SKY";
  return type;
}

function parseGeneratorSettings(worldType, generatorSettings) {
  const isCustomized = worldType === "CUSTOMIZED";
  const settings = {
    biomeSize: worldType === "LARGE_BIOMES" ? 6 : 4,
    riverSize: 4,
    useDefault1_1: worldType === "DEFAULT_1_1",
  };
  if (worldType === "AMPLIFIED") settings.biomeSize = 4;
  if (!isCustomized) return settings;

  const parsed = parseSettingsObject(generatorSettings);
  settings.biomeSize = clampInt(parsed?.biomeSize, settings.biomeSize, 1, 8);
  settings.riverSize = clampInt(parsed?.riverSize, settings.riverSize, 1, 8);
  return settings;
}

function parseSettingsObject(generatorSettings) {
  if (!generatorSettings) return null;
  if (typeof generatorSettings === "object") return generatorSettings;
  if (typeof generatorSettings !== "string") return null;
  const text = generatorSettings.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  const out = {};
  for (const pair of text.split(/[;,]/)) {
    const [key, value] = pair.split("=").map((part) => part?.trim());
    if (!key || value === undefined) continue;
    const number = Number.parseInt(value, 10);
    out[key] = Number.isFinite(number) ? number : value;
  }
  return out;
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function constantBiomeFor(worldType, generatorSettings) {
  if (worldType === "HELL") return B.HELL;
  if (worldType === "SKY") return B.SKY;
  if (worldType === "FLAT") return parseFlatBiome(generatorSettings);
  return null;
}

function parseFlatBiome(generatorSettings) {
  if (typeof generatorSettings === "object" && generatorSettings) {
    return lookupBiomeId(generatorSettings.biome ?? generatorSettings.biomeId ?? generatorSettings.biomeName, B.PLAINS);
  }

  if (typeof generatorSettings === "string") {
    const parts = generatorSettings.split(";");
    if (parts.length >= 3) return lookupBiomeId(parts[2], B.PLAINS);
    return lookupBiomeId(generatorSettings, B.PLAINS);
  }

  return B.PLAINS;
}

function lookupBiomeId(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return Number.isInteger(value) ? value : fallback;
  const text = String(value).trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  return BIOME_ID_BY_NAME.get(text) ?? BIOME_ID_BY_NAME.get(text.replaceAll("_", "")) ?? fallback;
}

function formatGrid(name, values, width, height) {
  const rows = [`${name}:`];
  for (let z = 0; z < height; z += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push(String(values[z * width + x]).padStart(4, " "));
    }
    rows.push(row.join(" "));
  }
  return rows.join("\n");
}
