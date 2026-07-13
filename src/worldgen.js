import { MC18BiomeID, createMinecraft18BiomeSource } from "./minecraft18BiomeGenerator.js";
import { Minecraft26OverworldTerrain } from "./minecraft26Terrain.js";

export function createOverworldGenerator(options) {
  return new OverworldGenerator(options);
}

const MINECRAFT_MIN_Y = 0;
const MINECRAFT_MAX_Y = 255;
const MINECRAFT_HEIGHT = MINECRAFT_MAX_Y - MINECRAFT_MIN_Y + 1;
const MINECRAFT_NOODLE_MIN_Y = 6;
const MINECRAFT_NOODLE_MAX_Y = 255;
const MINECRAFT_118_MIN_Y = -64;
const MINECRAFT_118_MAX_Y = 320;
const MINECRAFT_118_HEIGHT = MINECRAFT_118_MAX_Y - MINECRAFT_118_MIN_Y;
const ORE_CHUNK_AREA = 16 * 16;
const DENSITY_XZ_SIZE = 7;
const DENSITY_Y_SIZE = 25;
const DENSITY_XZ_CELLS = DENSITY_XZ_SIZE - 1;
const DENSITY_Y_CELLS = DENSITY_Y_SIZE - 1;
const TERRAIN_FEATURE_SCALE = 1.35;
const BIOME_CHOICE_CELL_SIZE = 800;
const MOUNTAIN_BIOME_CELL_SIZE = 1600;
const TEMPERATURE_CELL_SIZE = 2600;
const MOISTURE_CELL_SIZE = 2400;

class OverworldGenerator {
  constructor({
    seed,
    Block,
    Biome,
    BIOMES,
    worldHeight,
    seaLevel,
    waterLevel,
    terrainFeatureScale = TERRAIN_FEATURE_SCALE,
    worldType = "DEFAULT",
    generatorSettings = undefined,
    biomeSeed = seed,
    biomeLayout = "modern_legacy",
    useMinecraft18Biomes = biomeLayout === "java_1_8",
    terrainAlgorithm = biomeLayout === "java_1_8" ? "custom_legacy" : "minecraft_java_26_2",
  }) {
    this.seed = seed >>> 0;
    this.Block = Block;
    this.Biome = Biome;
    this.BIOMES = BIOMES;
    this.worldHeight = worldHeight;
    this.seaLevel = seaLevel;
    this.waterLevel = waterLevel;
    this.terrainFeatureScale = terrainFeatureScale;
    this.biomeLayout = biomeLayout;
    this.terrainAlgorithm = terrainAlgorithm;
    this.minecraft18BiomeSource = useMinecraft18Biomes
      ? createMinecraft18BiomeSource(biomeSeed, worldType, generatorSettings)
      : null;
    this.minecraft26Terrain = terrainAlgorithm === "minecraft_java_26_2"
      ? new Minecraft26OverworldTerrain({
        seed: biomeSeed,
        worldHeight,
      })
      : null;

    this.continentNoise = new PerlinNoise(this.seed ^ 0x4c2a35c7);
    this.erosionNoise = new PerlinNoise(this.seed ^ 0x91e10da5);
    this.weirdnessNoise = new PerlinNoise(this.seed ^ 0xf00dbabe);
    this.biomeNoise = new PerlinNoise(this.seed ^ 0xb10f00d);
    this.hillVariantNoise = new PerlinNoise(this.seed ^ 0x1a8b10e);
    this.heightNoise = new PerlinNoise(this.seed ^ 0xa341316c);
    this.detailNoise = new PerlinNoise(this.seed ^ 0xc8013ea4);
    this.riverNoise = new PerlinNoise(this.seed ^ 0x5eaf00d);
    this.temperatureNoise = new PerlinNoise(this.seed ^ 0xb5297a4d);
    this.vegetationNoise = new PerlinNoise(this.seed ^ 0xad90777d);
    this.treeNoise = new PerlinNoise(this.seed ^ 0x7e95761e);
    this.caveCheeseNoise = new PerlinNoise(this.seed ^ 0x0ca7e01);
    this.spaghettiNoise = new PerlinNoise(this.seed ^ 0x5a9e771);
    this.noodleNoise = new PerlinNoise(this.seed ^ 0x00d1e);
    this.aquiferNoise = new PerlinNoise(this.seed ^ 0xa91fe2);
    this.terrainWarpNoise = new PerlinNoise(this.seed ^ 0x7a2e11a5);
    this.veinNoise = new PerlinNoise(this.seed ^ 0x0e5eed);
    this.rawHeightCache = new Map();
    this.heightCache = new Map();
    this.shapeCache = new Map();
    this.temperatureCache = new Map();
    this.moistureCache = new Map();
    this.climateCache = new Map();
    this.biomeCache = new Map();
    this.steepnessCache = new Map();
    this.shoreCache = new Map();
    this.surfaceBlockCache = new Map();
    this.biomeProfileCache = new Map();
    this.waterFillCache = new Map();
    this.treeCache = new Map();
    this.cactusCache = new Map();
    this.rockCache = new Map();
    this.plantCache = new Map();
    this._trimCounter = 0;
  }

  minecraftY(y) {
    if (this.worldHeight <= 1) return MINECRAFT_MIN_Y;
    return MINECRAFT_MIN_Y + (y / (this.worldHeight - 1)) * (MINECRAFT_HEIGHT - 1);
  }

  minecraft118Y(y) {
    if (this.worldHeight <= 1) return MINECRAFT_118_MIN_Y;
    return MINECRAFT_118_MIN_Y + (y / (this.worldHeight - 1)) * MINECRAFT_118_HEIGHT;
  }

  caveCellHash(cellX, cellY, cellZ, salt) {
    return hashFloat(cellX + cellY * 7349, cellZ - cellY * 1931, this.seed ^ salt);
  }

  terrainHeight(x, z) {
    const key = columnKey(x, z);
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;

    if (this.minecraft26Terrain) {
      const height = clamp(
        Math.round(this.minecraft26Terrain.rawHeightAt(x, z)),
        1,
        this.worldHeight - 2,
      );
      this.heightCache.set(key, height);
      return height;
    }

    let height = 1;
    let probeY = Math.min(this.worldHeight - 2, Math.floor(this.rawTerrainHeight(x, z)) + 36);
    for (; probeY >= 1; probeY -= 8) {
      if (this.terrainDensityAt(x, probeY, z) > 0) break;
    }
    const top = Math.min(this.worldHeight - 2, probeY + 7);
    const bottom = Math.max(1, probeY - 1);
    for (let y = top; y >= bottom; y -= 1) {
      if (this.terrainDensityAt(x, y, z) > 0) {
        height = y;
        break;
      }
    }

    const shape = this.terrainShapeAt(x, z);
    const river = this.riverChannelAt(x, z, shape);
    if (river.isRiverColumn) {
      height = Math.min(height, river.floorY);
    }

    this.heightCache.set(key, height);
    return height;
  }

  smoothedRawTerrainHeight(x, z) {
    const weights = [1, 4, 6, 4, 1];
    let height = 0;
    let weightTotal = 0;

    for (let oz = -2; oz <= 2; oz += 1) {
      for (let ox = -2; ox <= 2; ox += 1) {
        const weight = weights[ox + 2] * weights[oz + 2];
        height += this.rawTerrainHeight(x + ox, z + oz) * weight;
        weightTotal += weight;
      }
    }

    return height / weightTotal;
  }

  rawTerrainHeight(x, z) {
    if (this.minecraft26Terrain) {
      return this.minecraft26Terrain.rawHeightAt(x, z);
    }

    const key = columnKey(x, z);
    const cached = this.rawHeightCache.get(key);
    if (cached !== undefined) return cached;

    const shape = this.terrainShapeAt(x, z);
    const spline = this.terrainSplineAt(shape);
    const land = spline.land;
    const inland = spline.inland;
    const farInland = spline.farInland;
    const coastShelf = spline.coast;
    const lowland = spline.lowland;
    const biomeId = this.minecraft18BiomeSource
      ? minecraft18BiomeIdToVoxelBiome(this.Biome, this.minecraft18BiomeIdAt(x, z))
      : null;
    const biomeProfile = this.minecraft18BiomeSource ? this.blendedBiomeProfileAt(x, z) : null;
    // FIX: Increased roughness baseline (0.32→0.40) and erosion/mountain contributions
    // This gives more height variation across all inland terrain
    const roughness = 0.36 + spline.relief * 0.9 + shape.mountainSignal * 0.56 + spline.ridge * 0.22;
    const featureScale = this.terrainFeatureScale;
    const lx = x / featureScale;
    const lz = z / featureScale;
    const broadHills = this.heightNoise.fbm2(lx * 0.0062 + 87, lz * 0.0062 - 41, 3, 2, 0.52);
    const rollingHills = this.detailNoise.fbm2(lx * 0.016 - 17, lz * 0.016 + 29, 3, 2, 0.5);
    const lowlandRoll = this.heightNoise.fbm2(lx * 0.0105 - 203, lz * 0.0105 + 157, 3, 2, 0.52);
    // Desert dune noise: medium-frequency elongated waves for rolling sand dunes
    const duneNoise = normalizeNoise(this.detailNoise.fbm2(lx * 0.022 + 783, lz * 0.011 - 419, 3, 2, 0.46));
    const shoulderNoise = normalizeNoise(this.detailNoise.fbm2(lx * 0.0037 + 61, lz * 0.0037 - 109, 3, 2, 0.56));
    const strataNoise = this.detailNoise.fbm2(x * 0.045 + 5, z * 0.045 - 11, 2, 2, 0.42);
    const basinNoise = normalizeNoise(this.heightNoise.fbm2(lx * 0.0026 + 419, lz * 0.0026 - 337, 3, 2, 0.54));
    const terraceNoise = normalizeNoise(this.terrainWarpNoise.fbm2(lx * 0.0068 - 29, lz * 0.0068 + 71, 3, 2, 0.48));
    const mountainRippleNoise = this.detailNoise.fbm2(lx * 0.028 + 487, lz * 0.028 - 563, 3, 2.05, 0.48);
    const mountainGullyNoise = normalizeNoise(this.terrainWarpNoise.fbm2(lx * 0.019 - 661, lz * 0.019 + 709, 3, 2.1, 0.5));
    const oceanDepth = spline.ocean * (12 + shape.rangeNoise * 26 + spline.relief * 7) + spline.deepOcean * (8 + basinNoise * 14);
    const riverBank = shape.riverBank ?? shape.river;
    // Deeper valley carving: river corridor lowered more aggressively so the
    // river sits in a visible floodplain, not flush with surrounding terrain.
    const riverCut = riverBank * (18 + inland * 12 + spline.relief * 6);
    const valleyCut =
      shape.valley * inland * (10 + spline.relief * 13) +
      spline.valley * (5.5 + shape.erosion * 10);
    const basinCut = spline.basin * (4 + basinNoise * 8) * (1 - riverBank * 0.35);
    const mountainMask = shape.mountainSignal;
    const mountainCore = Math.pow(mountainMask, 1.58);
    const summitSignal = shape.summitSignal ?? 0;
    const saddleSignal = shape.saddleSignal ?? 0;
    const ridgedSummit = shape.ridgedPeak * shape.ridgedPeak * 0.62;
    const summitMask = Math.max(
      Math.pow(Math.max(0, shape.peakNoise * shape.ridge, ridgedSummit), 1.72) * mountainCore * 0.58,
      summitSignal * Math.pow(mountainMask, 0.95) * 0.62,
    );
    const base =
      this.seaLevel -
      16 +
      land * 21 +
      inland * 5 +
      farInland * 2.5 -
      oceanDepth +
      coastShelf * 5.5 +
      spline.plateau * 2.5;
    const microTerrain = this.detailNoise.fbm2(x * 0.072 + 223, z * 0.072 - 163, 3, 2, 0.46) *
                         (1.8 + roughness * 1.4) * land * lerp(1, 0.48, mountainMask);
    const rolling =
      broadHills * (6.2 + roughness * 6.8) * land +
      rollingHills * (2.6 + roughness * 3.8) * land +
      lowlandRoll * (1.8 + lowland * 3.2) * land * (1 - riverBank * 0.42) +
      microTerrain;
    const foothills =
      smoothstep(0.06, 0.40, mountainMask) *
      (1 - mountainCore) *
      (18 + shoulderNoise * 18 + Math.max(0, broadHills) * 10);
    const ridgedCrest = shape.ridgedPeak * Math.pow(mountainMask, 1.72);
    // Mojang-style mountains read as broad heightmap mass with rough faces.
    // Keep the lift strong, but avoid narrow summit spires and floating shelves.
    const mountain =
      mountainCore * (32 + shape.rangeNoise * 38 + shape.upliftNoise * 20) +
      ridgedCrest * mountainCore * (9 + shape.rangeNoise * 10) +
      summitMask * (30 + shape.ridgedPeak * 24 + shape.rangeNoise * 14 + normalizeNoise(strataNoise) * 6) -
      saddleSignal * mountainCore * (20 + shape.rangeNoise * 22);
    const mountainBreakup =
      mountainCore *
      (
        (shape.mountainDetail ?? 0) * (11 + shape.rangeNoise * 12) +
        mountainRippleNoise * (4 + shape.rangeNoise * 6) +
        (shape.mountainRibSignal ?? 0) * (4.5 + shape.rangeNoise * 5.5) -
        smoothstep(0.58, 0.88, mountainGullyNoise) * (1 - summitSignal * 0.65) * (5 + shape.rangeNoise * 6)
      );
    const gentlePlain =
      this.gentleTerrainMaskAt(x, z, shape) *
      lowland *
      (this.seaLevel + 5 + broadHills * 4.3 + lowlandRoll * 2.6 + rollingHills * 1.2 - riverCut * 0.28);
    let height = base + rolling + foothills + mountain + mountainBreakup - riverCut - valleyCut - basinCut;
    height = lerp(height, gentlePlain, clamp(this.gentleTerrainMaskAt(x, z, shape) * lowland * 0.24, 0, 0.24));

    // Desert dune layer: only in hot/dry inland areas away from mountains
    const temperature = this.temperatureAt(x, z);
    const moisture = this.moistureAt(x, z);
    const duneMask = smoothstep(0.60, 0.80, temperature) *
                     smoothstep(0.40, 0.20, moisture) *
                     smoothstep(0.36, 0.60, shape.continentalness) *
                     (1 - smoothstep(0.22, 0.50, shape.mountainSignal)) *
                     (1 - riverBank * 0.8);
    if (duneMask > 0.01) {
      height += duneMask * (duneNoise * 10 + normalizeNoise(rollingHills) * 4);
    }

    const plateauSignal = spline.plateau * land * (1 - riverBank * 0.45);
    if (plateauSignal > 0.01) {
      const plateauBase = this.seaLevel + 19 + shape.rangeNoise * 24 + terraceNoise * 9;
      const plateauLifted = lerp(height, Math.max(height, plateauBase), plateauSignal * 0.28);
      const terraced = Math.round(plateauLifted / 3) * 3 + strataNoise * 1.15;
      height = lerp(plateauLifted, terraced, plateauSignal * 0.16);
    }

    const highAltitudeSoftCap = this.worldHeight - 34;
    if (height > highAltitudeSoftCap) {
      height = highAltitudeSoftCap + (height - highAltitudeSoftCap) * 0.38;
    }

    // FIX: Extended coastal slope — starts capping at continentalness 0.44 (was 0.30)
    // This ensures terrain smoothly descends toward the ocean instead of hitting a vertical cliff
    if (shape.continentalness < 0.44) {
      height = Math.min(height, this.seaLevel - 1 - smoothstep(0.10, 0.44, 0.44 - shape.continentalness) * 22);
    }
    if (
      riverBank > 0.12 &&
      shape.erosion > 0.40 &&
      shape.continentalness > 0.38 &&
      shape.continentalness < 0.80 &&
      shape.mountainSignal < 0.34
    ) {
      const bank = smoothstep(0.16, 0.84, riverBank);
      const channel = smoothstep(0.48, 0.92, shape.river);
      const floodplain = smoothstep(0.22, 0.74, riverBank);
      const bankTexture = this.detailNoise.fbm2(lx * 0.032 + 911, lz * 0.032 - 877, 2, 2, 0.48) * 1.6;
      const target = this.waterLevel + 10 - floodplain * 7 - channel * 8 + bankTexture * (1 - channel * 0.65);
      const blend = clamp(floodplain * 0.55 + channel * 0.34, 0, 0.88);
      if (height > target) height = lerp(height, target, blend);
      if (channel > 0.68) {
        const channelTarget = this.waterLevel - 1 - channel * 2;
        const channelPin = smoothstep(0.68, 0.94, channel);
        height = lerp(height, Math.min(height, channelTarget), channelPin);
      }
    }

    if (biomeProfile) {
      height = this.applyMinecraft18BiomeTerrainHeight(
        x,
        z,
        height,
        biomeId,
        biomeProfile,
        shape,
        broadHills,
        rollingHills,
        lowlandRoll,
        basinNoise,
      );
    }

    this.rawHeightCache.set(key, height);
    return height;
  }

  applyMinecraft18BiomeTerrainHeight(
    x,
    z,
    height,
    biomeId,
    profile,
    shape,
    broadHills,
    rollingHills,
    lowlandRoll,
    basinNoise,
  ) {
    const B = this.Biome;
    const ocean = isOceanBiome(B, biomeId);
    const deepOcean = biomeId === B.DEEP_OCEAN;
    const river = isRiverBiome(B, biomeId);
    const beach = biomeId === B.BEACH || biomeId === B.COLD_BEACH || biomeId === B.STONE_BEACH || biomeId === B.MUSHROOM_SHORE;
    const swamp = isSwampBiome(B, biomeId);
    const plateau =
      biomeId === B.SAVANNA_PLATEAU ||
      biomeId === B.SAVANNA_PLATEAU_M ||
      biomeId === B.MESA_PLATEAU ||
      biomeId === B.MESA_PLATEAU_F ||
      biomeId === B.MESA_PLATEAU_M ||
      biomeId === B.MESA_PLATEAU_F_M;
    const hilly =
      isClassicExtremeHillsBiome(B, biomeId) ||
      biomeId === B.DESERT_HILLS ||
      biomeId === B.FOREST_HILLS ||
      biomeId === B.TAIGA_HILLS ||
      biomeId === B.COLD_TAIGA_HILLS ||
      biomeId === B.MEGA_TAIGA_HILLS ||
      biomeId === B.MEGA_SPRUCE_TAIGA_HILLS ||
      biomeId === B.JUNGLE_HILLS ||
      biomeId === B.BIRCH_FOREST_HILLS ||
      biomeId === B.BIRCH_FOREST_HILLS_M ||
      biomeId === B.ICE_MOUNTAINS ||
      biomeId === B.ICE_SPIKES;

    const reliefNoise =
      broadHills * (8 + profile.variation * 16) +
      rollingHills * (3 + profile.variation * 8) +
      lowlandRoll * (2 + profile.variation * 5);
    const vanillaStyleTarget =
      this.seaLevel +
      profile.rootHeight * 18 +
      (profile.variation - 0.2) * 5 +
      reliefNoise * (ocean || river ? 0.28 : 1);

    let blend = 0.28;
    if (ocean) blend = 0.92;
    else if (river) blend = 0.78;
    else if (beach) blend = 0.68;
    else if (swamp) blend = 0.58;
    else if (plateau) blend = 0.52;
    else if (hilly) blend = 0.44;

    let next = lerp(height, vanillaStyleTarget, blend);

    if (ocean) {
      const oceanFloor = this.waterLevel - (deepOcean ? 30 : 15) + basinNoise * 6 + broadHills * 2.5;
      next = Math.min(next, oceanFloor);
    } else if (river) {
      const riverFloor = this.waterLevel - 2 + rollingHills * 1.5;
      next = Math.min(next, riverFloor);
    } else if (beach) {
      const beachTop = this.waterLevel + (biomeId === B.STONE_BEACH ? 5 : 2) + broadHills * 1.4;
      next = lerp(next, Math.min(next, beachTop), 0.8);
    } else if (swamp) {
      const wetLowland = smoothstep(0.42, 0.78, shape.erosion) * (1 - smoothstep(0.18, 0.40, shape.mountainSignal));
      const swampTop = this.waterLevel + 1 + rollingHills * 2.2 - wetLowland * 3.5;
      next = lerp(next, Math.min(next, swampTop), 0.62);
    } else if (plateau) {
      const plateauFloor = this.seaLevel + 25 + profile.rootHeight * 16 + basinNoise * 5;
      next = Math.max(next, plateauFloor);
      next = lerp(next, Math.round(next / 3) * 3, 0.18);
    } else if (hilly) {
      const hillFloor = this.seaLevel + 10 + profile.rootHeight * 22 + Math.max(0, broadHills) * profile.variation * 12;
      next = Math.max(next, hillFloor);
      next += Math.max(0, broadHills) * profile.variation * 10;
    } else if (!beach && !swamp) {
      const landFloor = this.waterLevel + 2 + Math.max(0, profile.rootHeight) * 8 + Math.max(0, broadHills) * 2;
      next = Math.max(next, landFloor);
    }

    return clamp(next, 1, this.worldHeight - 2);
  }

  terrainSplineAt(shape) {
    const land = smoothstep(0.23, 0.63, shape.continentalness);
    const ocean = 1 - land;
    const deepOcean = 1 - smoothstep(0.07, 0.25, shape.continentalness);
    const inland = smoothstep(0.34, 0.76, shape.continentalness);
    const farInland = smoothstep(0.54, 0.88, shape.continentalness);
    const coast = smoothstep(0.24, 0.42, shape.continentalness) * (1 - smoothstep(0.48, 0.66, shape.continentalness));
    const relief = 1 - shape.erosion;
    const lowland = smoothstep(0.4, 0.74, shape.erosion) * (1 - smoothstep(0.2, 0.46, shape.mountainSignal));
    const foldedRidge = shape.foldedRidge ?? smoothstep(0.08, 0.72, shape.peaksAndValleys);
    const valley = shape.valleyFloor ?? (
      (1 - smoothstep(-0.94, -0.42, shape.peaksAndValleys)) *
      inland *
      smoothstep(0.42, 0.78, shape.erosion)
    );
    const basin =
      land *
      smoothstep(0.54, 0.84, shape.erosion) *
      (1 - smoothstep(-0.78, -0.35, shape.peaksAndValleys)) *
      (1 - smoothstep(0.14, 0.42, shape.mountainSignal));
    const ridge =
      inland *
      smoothstep(0.1, 0.72, relief) *
      Math.max(foldedRidge * 0.72, shape.ridge * 0.55);
    const plateau = shape.plateauSignal ?? (
      inland *
      smoothstep(0.58, 0.86, shape.erosion) *
      smoothstep(0.42, 0.78, shape.rangeNoise) *
      (1 - smoothstep(0.34, 0.62, shape.mountainSignal))
    );

    return {
      land,
      ocean,
      deepOcean,
      inland,
      farInland,
      coast,
      relief,
      lowland,
      valley,
      basin,
      ridge,
      plateau,
    };
  }

  biomeTerrainProfileFor(biomeId) {
    const B = this.Biome;
    if (biomeId === B.DEEP_OCEAN) return { rootHeight: -1.8, variation: 0.1 };
    if (biomeId === B.OCEAN || biomeId === B.FROZEN_OCEAN) return { rootHeight: -1.0, variation: 0.1 };
    if (biomeId === B.RIVER || biomeId === B.FROZEN_RIVER) return { rootHeight: -0.5, variation: 0.0 };
    if (biomeId === B.BEACH || biomeId === B.COLD_BEACH || biomeId === B.MUSHROOM_SHORE) return { rootHeight: 0.0, variation: 0.025 };
    if (biomeId === B.STONE_BEACH) return { rootHeight: 0.1, variation: 0.8 };
    if (biomeId === B.SWAMPLAND) return { rootHeight: -0.04, variation: 0.10 };
    if (biomeId === B.SWAMPLAND_M) return { rootHeight: 0.02, variation: 0.13 };
    // FIX: Boosted plains/forest variation so interior terrain reads as genuine MC
    // hills, not subtle slopes. Real-life smoothness was making inland feel uniform.
    if (biomeId === B.PLAINS || biomeId === B.SUNFLOWER_PLAINS) return { rootHeight: 0.13, variation: 0.26 };
    // Desert dunes: more height variation for rolling sand dunes feel
    if (biomeId === B.DESERT) return { rootHeight: 0.18, variation: 0.30 };
    if (biomeId === B.DESERT_HILLS || biomeId === B.DESERT_M) return { rootHeight: 0.52, variation: 0.55 };
    if (biomeId === B.FOREST || biomeId === B.BIRCH_FOREST || biomeId === B.ROOFED_FOREST || biomeId === B.FLOWER_FOREST) return { rootHeight: 0.14, variation: 0.40 };
    if (biomeId === B.FOREST_HILLS || biomeId === B.BIRCH_FOREST_HILLS || biomeId === B.BIRCH_FOREST_HILLS_M) return { rootHeight: 0.55, variation: 0.58 };
    if (biomeId === B.BIRCH_FOREST_M || biomeId === B.ROOFED_FOREST_M) return { rootHeight: 0.26, variation: 0.60 };
    if (biomeId === B.TAIGA || biomeId === B.COLD_TAIGA || biomeId === B.MEGA_TAIGA || biomeId === B.MEGA_SPRUCE_TAIGA) return { rootHeight: 0.24, variation: 0.42 };
    if (biomeId === B.TAIGA_HILLS || biomeId === B.COLD_TAIGA_HILLS || biomeId === B.MEGA_TAIGA_HILLS || biomeId === B.MEGA_SPRUCE_TAIGA_HILLS) return { rootHeight: 0.56, variation: 0.58 };
    if (biomeId === B.TAIGA_M || biomeId === B.COLD_TAIGA_M) return { rootHeight: 0.34, variation: 0.60 };
    // Jungles: more relief to produce proper hilly jungle feel
    if (biomeId === B.JUNGLE || biomeId === B.JUNGLE_M) return { rootHeight: 0.24, variation: 0.52 };
    if (biomeId === B.JUNGLE_HILLS) return { rootHeight: 0.58, variation: 0.65 };
    if (biomeId === B.JUNGLE_EDGE || biomeId === B.JUNGLE_EDGE_M) return { rootHeight: 0.14, variation: 0.38 };
    if (biomeId === B.SAVANNA) return { rootHeight: 0.13, variation: 0.24 };
    if (biomeId === B.SAVANNA_PLATEAU || biomeId === B.SAVANNA_M || biomeId === B.SAVANNA_PLATEAU_M) return { rootHeight: 1.6, variation: 0.10 };
    if (biomeId === B.MESA) return { rootHeight: 0.12, variation: 0.32 };
    if (biomeId === B.MESA_BRYCE) return { rootHeight: 0.12, variation: 0.95 };
    if (biomeId === B.MESA_PLATEAU || biomeId === B.MESA_PLATEAU_F || biomeId === B.MESA_PLATEAU_M || biomeId === B.MESA_PLATEAU_F_M) return { rootHeight: 1.5, variation: 0.08 };
    if (biomeId === B.MEADOW) return { rootHeight: 0.35, variation: 0.24 };
    if (biomeId === B.GROVE) return { rootHeight: 0.78, variation: 0.48 };
    if (biomeId === B.SNOWY_SLOPES) return { rootHeight: 0.92, variation: 0.58 };
    if (biomeId === B.FROZEN_PEAKS) return { rootHeight: 1.08, variation: 0.62 };
    if (biomeId === B.JAGGED_PEAKS) return { rootHeight: 1.24, variation: 0.92 };
    if (biomeId === B.STONY_PEAKS) return { rootHeight: 1.06, variation: 0.72 };
    if (biomeId === B.EXTREME_HILLS_EDGE) return { rootHeight: 0.38, variation: 0.42 };
    if (biomeId === B.EXTREME_HILLS || biomeId === B.EXTREME_HILLS_PLUS) return { rootHeight: 1.08, variation: 0.58 };
    if (biomeId === B.EXTREME_HILLS_M || biomeId === B.EXTREME_HILLS_PLUS_M) return { rootHeight: 1.22, variation: 0.70 };
    if (biomeId === B.ICE_PLAINS) return { rootHeight: 0.13, variation: 0.16 };
    if (biomeId === B.ICE_MOUNTAINS) return { rootHeight: 0.5, variation: 0.5 };
    if (biomeId === B.ICE_SPIKES) return { rootHeight: 0.43, variation: 0.6 };
    if (biomeId === B.MUSHROOM_ISLAND) return { rootHeight: 0.22, variation: 0.42 };
    return { rootHeight: 0.12, variation: 0.32 };
  }

  blendedBiomeProfileAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.biomeProfileCache.get(key);
    if (cached) return cached;

    const centerProfile = this.biomeTerrainProfileFor(this.biomeAt(x, z));
    let root = 0;
    let variation = 0;
    let total = 0;

    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const sampleProfile = this.biomeTerrainProfileFor(this.biomeAt(x + ox * 6, z + oz * 6));
        let weight = 10 / Math.sqrt(ox * ox + oz * oz + 0.2);
        if (sampleProfile.rootHeight > centerProfile.rootHeight) weight *= 0.5;
        // Also reduce influence of samples significantly lower than center (e.g. swamps
        // near plains) — prevents low biomes from carving into adjacent terrain.
        if (sampleProfile.rootHeight < centerProfile.rootHeight - 0.22) weight *= 0.5;
        root += sampleProfile.rootHeight * weight;
        variation += sampleProfile.variation * weight;
        total += weight;
      }
    }

    const profile = {
      rootHeight: root / total,
      variation: variation / total,
    };
    this.biomeProfileCache.set(key, profile);
    return profile;
  }

  terrainDensityAt(x, y, z) {
    if (this.minecraft26Terrain) {
      return this.minecraft26Terrain.densityAt(x, y, z);
    }

    const shape = this.terrainShapeAt(x, z);
    const spline = this.terrainSplineAt(shape);
    const biomeId = this.biomeAt(x, z);
    const profile = this.blendedBiomeProfileAt(x, z);
    const offset = this.modernTerrainOffset(shape, profile, biomeId);
    const factor = this.modernTerrainFactor(shape, profile, biomeId);
    const jaggedness = this.modernTerrainJaggedness(shape, profile, biomeId);
    const mountain = this.modernMountainSignal(shape);
    const summit = shape.summitSignal ?? 0;
    const saddle = shape.saddleSignal ?? 0;
    const gradientHeight = lerp(126, 164, smoothstep(0.28, 0.78, shape.continentalness)) + spline.plateau * 8 - spline.basin * 6;
    const verticalGradient = lerpClamped(y, 0, gradientHeight, 1.48, -1.48);
    let depth = verticalGradient + offset + spline.plateau * 0.045 - spline.valley * 0.055;
    // Y-warp added to break vertical-pillar artifact: without it, the 2D noise
    // stamps the same pattern at every height on steep faces, producing columns.
    // The y * 0.005 / 0.0032 shifts the sample point differently per layer.
    const jaggedNoise = this.detailNoise.fbm2(
      x * 0.0036 + 19.3 + y * 0.0050,
      z * 0.0036 - 41.7 + y * 0.0032,
      4, 2, 0.52,
    );
    const highJaggedFade =
      1 - smoothstep(118, 205, y) * (0.6 + mountain * 0.35) * (1 - summit * 0.35);
    const jaggedBase = halfNegativeValue(jaggedNoise);
    const jaggedContribution = jaggedBase > 0 ? jaggedBase * highJaggedFade : jaggedBase;
    if (mountain > 0.08) {
      const mountainFineNoise = this.detailNoise.fbm2(
        x * 0.023 + 411 + y * 0.006,
        z * 0.023 - 307 - y * 0.004,
        3, 2.05, 0.5,
      );
      const mountainRibNoise = this.hillVariantNoise.fbm2(
        x * 0.041 - 173 + y * 0.004,
        z * 0.041 + 229 - y * 0.003,
        2, 2.1, 0.48,
      );
      const altitudeMask = smoothstep(this.seaLevel + 4, this.seaLevel + 34, y) *
        (1 - smoothstep(this.worldHeight - 42, this.worldHeight - 9, y));
      const coreMask = smoothstep(0.50, 0.86, shape.mountainSignal);
      depth += mountain * altitudeMask * (
        mountainFineNoise * (0.035 + coreMask * 0.012) +
        mountainRibNoise * (0.018 + coreMask * 0.007) +
        (shape.mountainDetail ?? 0) * (0.026 + coreMask * 0.008) +
        (shape.mountainRibSignal ?? 0) * (0.014 + coreMask * 0.005)
      );
    }
    const terrainTerm = 4 * quarterNegativeValue((depth + jaggedness * jaggedContribution) * factor);
    const cheese = this.base3dNoiseAt(x, y, z, shape, profile);
    let density = terrainTerm + cheese;

    if (this.minecraft18BiomeSource && !isOceanBiome(this.Biome, biomeId) && !isRiverBiome(this.Biome, biomeId)) {
      const expectedSurface = this.rawTerrainHeight(x, z);
      const belowBiomeSurface = smoothstep(expectedSurface + 6, expectedSurface - 10, y);
      const supportStrength = 0.12 + Math.max(0, profile.rootHeight) * 0.24 + profile.variation * 0.10;
      density += belowBiomeSurface * supportStrength;
    } else if (this.minecraft18BiomeSource && (isOceanBiome(this.Biome, biomeId) || isRiverBiome(this.Biome, biomeId))) {
      const expectedFloor = this.rawTerrainHeight(x, z);
      const aboveBiomeFloor = smoothstep(expectedFloor - 4, expectedFloor + 10, y);
      density -= aboveBiomeFloor * (isOceanBiome(this.Biome, biomeId) ? 0.34 : 0.26);
    }

    if (mountain > 0.22 && y > this.seaLevel + 4) {
      const expectedSurface = this.rawTerrainHeight(x, z);
      const belowSurface = smoothstep(expectedSurface - 4, expectedSurface - 30, y);
      const highTerrain = smoothstep(this.seaLevel + 8, this.seaLevel + 40, y);
      const summitOpen = 1 - smoothstep(0.58, 0.92, summit) * 0.45;
      const coreSupport =
          smoothstep(0.42, 0.78, shape.mountainRibSignal ?? 0) * 0.055 +
          smoothstep(0.36, 0.72, summit) * 0.040;
      density += belowSurface * highTerrain * mountain * summitOpen * (0.18 + coreSupport);
    }

    if (shape.cliffSignal > 0.02) {
      const cliffNoise = sample3(
        this.terrainWarpNoise,
        x + y * 0.27,
        y,
        z - y * 0.19,
        0.018,
        2,
      );
      density += cliffNoise * shape.cliffSignal * smoothstep(18, 120, y) * (1 - smoothstep(184, 244, y)) * 0.022;
    }

    if (saddle > 0.01) {
      const saddleBaseY = lerp(92, 132, smoothstep(0.28, 0.78, shape.continentalness));
      const highSlope = smoothstep(saddleBaseY, saddleBaseY + 58, y);
      const summitPreserve = 1 - smoothstep(0.38, 0.76, summit);
      density -= saddle * summitPreserve * highSlope * 0.34;
    }
    if (mountain > 0.35) {
      const ceilingTaper = smoothstep(this.worldHeight - 92, this.worldHeight - 18, y);
      density -= ceilingTaper * mountain * (0.72 + (1 - summit) * 0.94) * 1.4;
    }
    const hardCeilingTaper = smoothstep(this.worldHeight - 44, this.worldHeight - 10, y);
    density -= hardCeilingTaper * (0.55 + mountain * 0.9 + summit * 0.25);

    density += lerpClamped(y, 0, 8, 0.18, 0);
    const topFade = lerpClamped(y, this.worldHeight - 28, this.worldHeight - 8, 1, 0);
    density = -0.078125 + topFade * (density + 0.078125);
    density = squeezeValue(0.64 * density);

    const riverBank = shape.riverBank ?? shape.river;
    const riverCarve =
      smoothstep(0.24, 0.82, riverBank) *
      smoothstep(0.44, 0.72, shape.erosion) *
      smoothstep(0.40, 0.54, shape.continentalness) *
      (1 - smoothstep(0.72, 0.84, shape.continentalness)) *
      (1 - smoothstep(0.20, 0.42, shape.mountainSignal));
    if (riverCarve > 0.01) {
      const channelT = smoothstep(0.42, 0.90, shape.river);
      const riverFloorY = this.waterLevel - 2 - channelT * 1.4;
      const aboveBed = smoothstep(riverFloorY - 4, riverFloorY + 6, y);
      const headroom = 1 - smoothstep(this.waterLevel + 8, this.waterLevel + 20, y);
      density -= aboveBed * headroom * riverCarve * 0.78;
    }

    // FIX: Ocean carving is now driven by continentalness value, NOT just biome type.
    // Previously this only fired when isOceanBiome() was true. But at the coastline
    // the biome is BEACH or inland — so the ocean floor was never carved, the terrain
    // stayed solid at sea level, and you got a vertical cliff at the biome boundary.
    // Now we apply carving to ALL low-continentalness areas, creating a smooth slope.
    {
      const nearOcean = smoothstep(0.46, 0.16, shape.continentalness); // ramps up as C drops
      if (nearOcean > 0.01) {
        const oceanCut = smoothstep(this.seaLevel - 32, this.seaLevel + 3, y);
        density -= oceanCut * nearOcean * 0.58;
      }
    }

    return density;
  }

  modernTerrainOffset(shape, profile, biomeId) {
    const spline = this.terrainSplineAt(shape);
    const signedContinentalness = shape.continentalness * 2 - 1;
    const mountain = this.modernMountainSignal(shape);
    const shoreShelf = smoothstep(0.24, 0.44, shape.continentalness) * (1 - smoothstep(0.5, 0.68, shape.continentalness));
    let offset = remap(signedContinentalness, -1, 1, -0.46, 0.46);
    offset += profile.rootHeight * 0.22;
    const ridgeCrest = Math.pow(clamp(shape.ridgedPeak, 0, 1), 1.55);
    const summit = shape.summitSignal ?? ridgeCrest;
    const saddle = shape.saddleSignal ?? 0;
    const mountainDetail = shape.mountainDetail ?? 0;
    const mountainRib = shape.mountainRibSignal ?? 0;
    const alpinePocket = smoothstep(0.66, 0.9, shape.mountainPocketNoise ?? 0.5) *
      (1 - smoothstep(0.42, 0.78, summit));
    // Broad mountain mass gets a conservative lift. Crest bands and summit knots
    // receive the extra elevation, while saddles are lowered so ranges have a
    // peak-pass-peak skyline instead of a single snowy plateau.
    offset += mountain * (0.34 + ridgeCrest * 0.18 + summit * 0.42);
    offset += mountain * mountainDetail * 0.15;
    offset += mountain * mountainRib * 0.07;
    offset -= mountain * alpinePocket * 0.11;
    offset -= saddle * 0.42;
    offset += spline.plateau * 0.12 + spline.ridge * 0.04;
    offset -= spline.valley * 0.16 + spline.basin * 0.05;
    offset += shoreShelf * 0.14;
    // The soft river-bank signal lowers nearby terrain while the narrower
    // shape.river signal is reserved for actual wet channel columns.
    offset -= (shape.riverBank ?? shape.river) * 0.28;
    // FIX: Coastal descent now starts much further inland (cont 0.62 instead of
    // 0.50) and is stronger (0.45 instead of 0.32). This spreads the inland-to-
    // beach drop across ~50-100 blocks horizontally — the earlier 0.50→0.30 band
    // was so narrow that the beach sat 10-15 blocks above water with a near-
    // vertical sand wall right at the coast. Spreading it out gives a real slope.
    offset -= smoothstep(0.62, 0.30, shape.continentalness) * 0.45;
    // FIX: Ocean descent slightly relaxed (0.62 → 0.55) since the wider coastal
    // ramp now picks up more of the descent. Together they produce a smooth
    // beach → shallow water → deep ocean slope instead of a stepped wall.
    offset -= smoothstep(0.40, 0.06, shape.continentalness) * 0.55;
    // Swamps need shallow, water-level basins rather than deep ocean bowls.
    // FIX: Global terrain lowering. Brings everything down ~7 blocks so the bottom
    // of coastal slopes and depressions actually reach waterLevel.
    offset -= 0.14;
    if (isSwampBiome(this.Biome, biomeId)) {
      const wetLowland = smoothstep(0.48, 0.76, shape.erosion) * (1 - smoothstep(0.16, 0.34, shape.mountainSignal));
      offset -= 0.045 + wetLowland * 0.06;
    }
    return clamp(offset, -0.9, 1.18);
  }

  modernTerrainFactor(shape, profile, biomeId) {
    const spline = this.terrainSplineAt(shape);
    const mountain = this.modernMountainSignal(shape);
    const inland = smoothstep(0.32, 0.76, shape.continentalness);
    const ridgeCrest = Math.pow(clamp(shape.ridgedPeak, 0, 1), 1.25);
    const summit = shape.summitSignal ?? ridgeCrest;
    const peakBoost = mountain > 0.25 ? (ridgeCrest * 0.12 + summit * 0.26) * mountain : 0;
    let factor = 0.92 + inland * 0.30 + mountain * 0.52 + profile.variation * 0.34 + peakBoost;
    factor += mountain * Math.abs(shape.mountainDetail ?? 0) * 0.16 + mountain * (shape.mountainRibSignal ?? 0) * 0.08;
    factor += spline.ridge * 0.10 + spline.plateau * 0.07;
    factor *= lerp(1, 0.88, spline.lowland * (1 - mountain));
    if (isOceanBiome(this.Biome, biomeId)) factor *= 0.72;
    if (isRiverBiome(this.Biome, biomeId)) factor *= 0.82;
    if (isSwampBiome(this.Biome, biomeId)) factor *= 0.64;
    if (biomeId === this.Biome.BEACH || biomeId === this.Biome.COLD_BEACH || biomeId === this.Biome.MUSHROOM_SHORE) factor *= 0.74;
    return clamp(factor, 0.62, 2.1);
  }

  modernTerrainJaggedness(shape, profile, biomeId) {
    if (isOceanBiome(this.Biome, biomeId) || isRiverBiome(this.Biome, biomeId)) return 0;
    if (isSwampBiome(this.Biome, biomeId)) return 0.06;
    const mountain = this.modernMountainSignal(shape);
    const foldedRidge = clamp((shape.peaksAndValleys + 1) * 0.5, 0, 1);
    const summit = shape.summitSignal ?? 0;
    const rangeCrest = shape.rangeCrest ?? 0;
    const spline = this.terrainSplineAt(shape);
    // FIX: profile.variation now contributes much more to jaggedness so plains/forests
    // get visible block-to-block height variation instead of long smooth slopes.
    return clamp(
      mountain * 0.50 +
      summit * 0.20 +
      rangeCrest * mountain * 0.12 +
      Math.abs(shape.mountainDetail ?? 0) * mountain * 0.18 +
      (shape.mountainRibSignal ?? 0) * mountain * 0.12 +
      spline.ridge * 0.08 +
      shape.cliffSignal * 0.035 +
      profile.variation * 0.26 +
      Math.pow(foldedRidge, 2.0) * 0.14,
      0,
      1.12,
    );
  }

  modernMountainSignal(shape) {
    const signedContinentalness = shape.continentalness * 2 - 1;
    const signedErosion = shape.erosion * 2 - 1;
    const inland = smoothstep(-0.1, 0.55, signedContinentalness);
    const rough = 1 - smoothstep(-0.9, 0.4, signedErosion);
    const peak = smoothstep(0.02, 0.72, shape.peaksAndValleys);
    const ridgePeak = smoothstep(0.46, 0.88, shape.rangeNoise) * smoothstep(0.34, 0.88, shape.upliftNoise);
    return clamp(Math.max(shape.mountainSignal, inland * rough * peak * 0.74, inland * rough * ridgePeak * 0.62), 0, 1);
  }

  base3dNoiseAt(x, y, z, shape, profile) {
    const land = smoothstep(0.24, 0.62, shape.continentalness);
    const mountain = this.modernMountainSignal(shape);
    const summit = shape.summitSignal ?? 0;
    const spline = this.terrainSplineAt(shape);
    // Mountain amplitude raised to 0.28 — now that factor is lower the cheese
    // needs to be stronger to produce interesting overhang / cliff texture.
    const amplitude = (
      0.18 +
      land * 0.18 +
      profile.variation * 0.18 +
      mountain * 0.04 +
      summit * 0.025 +
      shape.cliffSignal * 0.018 +
      spline.ridge * 0.035
    ) * (1 - (shape.riverBank ?? shape.river) * 0.58) * (1 - spline.basin * 0.22);
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let total = 0;

    for (let octave = 0; octave < 5; octave += 1) {
      sum += sample3(
        this.heightNoise,
        x + octave * 61.7,
        y * 1.35 - octave * 23.1,
        z - octave * 47.3,
        0.0072 * freq,
        2,
        2,
        0.5,
      ) * amp;
      total += amp;
      amp *= 0.55;
      freq *= 1.9;
    }

    const cheese = sum / total;
    // Push fade ceiling up to y=140-210 so tall peaks (y=165-185) still get
    // cheese-noise overhangs and cliff texture rather than a flat cap.
    const peakFade = mountain > 0.2
      ? 1 - smoothstep(92, 166, y) * clamp(mountain * 0.9 + summit * 0.28, 0, 0.88)
      : 1;
    const verticalMask = smoothstep(6, 32, y) * (1 - smoothstep(this.worldHeight - 52, this.worldHeight - 14, y));
    return cheese * amplitude * verticalMask * peakFade;
  }

  buildChunkDensityField(worldX0, worldZ0, chunkSize = 16) {
    const field = new Float32Array(DENSITY_XZ_SIZE * DENSITY_Y_SIZE * DENSITY_XZ_SIZE);
    const xzStep = chunkSize / DENSITY_XZ_CELLS;
    const yStep = (this.worldHeight - 1) / DENSITY_Y_CELLS;

    for (let gy = 0; gy < DENSITY_Y_SIZE; gy += 1) {
      const y = gy * yStep;
      for (let gz = 0; gz < DENSITY_XZ_SIZE; gz += 1) {
        const z = worldZ0 + gz * xzStep;
        for (let gx = 0; gx < DENSITY_XZ_SIZE; gx += 1) {
          const x = worldX0 + gx * xzStep;
          field[densityFieldIndex(gx, gy, gz)] = this.terrainDensityAt(x, y, z);
        }
      }
    }

    return field;
  }

  interpolatedChunkDensityAt(field, localX, y, localZ, chunkSize = 16) {
    const xzStep = chunkSize / DENSITY_XZ_CELLS;
    const yStep = (this.worldHeight - 1) / DENSITY_Y_CELLS;
    const gx = clamp(Math.floor(localX / xzStep), 0, DENSITY_XZ_CELLS - 1);
    const gz = clamp(Math.floor(localZ / xzStep), 0, DENSITY_XZ_CELLS - 1);
    const gy = clamp(Math.floor(y / yStep), 0, DENSITY_Y_CELLS - 1);
    const tx = (localX - gx * xzStep) / xzStep;
    const tz = (localZ - gz * xzStep) / xzStep;
    const ty = (y - gy * yStep) / yStep;

    const c000 = field[densityFieldIndex(gx, gy, gz)];
    const c100 = field[densityFieldIndex(gx + 1, gy, gz)];
    const c010 = field[densityFieldIndex(gx, gy + 1, gz)];
    const c110 = field[densityFieldIndex(gx + 1, gy + 1, gz)];
    const c001 = field[densityFieldIndex(gx, gy, gz + 1)];
    const c101 = field[densityFieldIndex(gx + 1, gy, gz + 1)];
    const c011 = field[densityFieldIndex(gx, gy + 1, gz + 1)];
    const c111 = field[densityFieldIndex(gx + 1, gy + 1, gz + 1)];
    const x00 = lerp(c000, c100, tx);
    const x10 = lerp(c010, c110, tx);
    const x01 = lerp(c001, c101, tx);
    const x11 = lerp(c011, c111, tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
  }

  fillInterpolatedChunkDensityColumn(
    field,
    localX,
    localZ,
    output,
    z0Samples,
    z1Samples,
    chunkSize = 16,
  ) {
    const xzStep = chunkSize / DENSITY_XZ_CELLS;
    const yStep = (this.worldHeight - 1) / DENSITY_Y_CELLS;
    const gx = clamp(Math.floor(localX / xzStep), 0, DENSITY_XZ_CELLS - 1);
    const gz = clamp(Math.floor(localZ / xzStep), 0, DENSITY_XZ_CELLS - 1);
    const tx = (localX - gx * xzStep) / xzStep;
    const tz = (localZ - gz * xzStep) / xzStep;

    for (let gy = 0; gy < DENSITY_Y_SIZE; gy += 1) {
      const base = densityFieldIndex(gx, gy, gz);
      const nextZ = base + DENSITY_XZ_SIZE;
      z0Samples[gy] = lerp(field[base], field[base + 1], tx);
      z1Samples[gy] = lerp(field[nextZ], field[nextZ + 1], tx);
    }

    for (let y = 0; y < this.worldHeight; y += 1) {
      const gy = clamp(Math.floor(y / yStep), 0, DENSITY_Y_CELLS - 1);
      const ty = (y - gy * yStep) / yStep;
      output[y] = lerp(
        lerp(z0Samples[gy], z0Samples[gy + 1], ty),
        lerp(z1Samples[gy], z1Samples[gy + 1], ty),
        tz,
      );
    }
  }

  riverChannelAt(x, z, shape = this.terrainShapeAt(x, z)) {
    const strength = shape.river;
    const terrainY = Math.floor(this.rawTerrainHeight(x, z));
    const center = smoothstep(0.36, 0.88, strength);
    const isRiverColumn =
      strength > 0.30 &&
      shape.erosion > 0.40 &&
      shape.continentalness > 0.40 &&
      shape.continentalness < 0.80 &&
      shape.mountainSignal < 0.30 &&
      terrainY <= this.waterLevel + 5 &&
      terrainY >= this.waterLevel - 6;
    const bedNoise = normalizeNoise(this.detailNoise.fbm2(x * 0.11 + 517, z * 0.11 - 323, 2));
    // Deeper rivers (3-8 blocks) with more variation based on channel strength
    const depth = clamp(Math.round(3 + center * 5 + bedNoise * 1.8), 3, 8);
    const surfaceY = this.waterLevel;
    return {
      strength,
      isRiverColumn,
      surfaceY,
      floorY: surfaceY - depth,
      clearY: surfaceY + 6,
      depth,
    };
  }

  trimCaches() {
    const HOT = 8192;
    const COOL = 4096;
    trimMap(this.heightCache, HOT);
    trimMap(this.rawHeightCache, HOT);
    trimMap(this.shapeCache, HOT);
    trimMap(this.biomeCache, HOT);
    trimMap(this.biomeProfileCache, HOT);
    trimMap(this.temperatureCache, COOL);
    trimMap(this.moistureCache, COOL);
    trimMap(this.climateCache, COOL);
    trimMap(this.steepnessCache, COOL);
    trimMap(this.shoreCache, COOL);
    trimMap(this.surfaceBlockCache, COOL);
    trimMap(this.waterFillCache, COOL);
    trimMap(this.treeCache, COOL);
    trimMap(this.cactusCache, COOL);
    trimMap(this.rockCache, COOL);
    trimMap(this.plantCache, COOL);
  }

  fluidLevelStoreFor(block) {
    return block === this.Block.WATER || block === this.Block.EXTRA_LAVA ? 1 : 0;
  }

  populateChunkTerrain(
    cx,
    cz,
    blocks,
    waterLevels,
    chunkSize = 16,
    chunkArea = chunkSize * chunkSize,
    options = {},
  ) {
    if ((++this._trimCounter & 3) === 0) this.trimCaches();
    if (options.fastSurface === true) {
      this.populateFastChunkSurface(cx, cz, blocks, waterLevels, chunkSize, chunkArea);
      return;
    }
    if (this.minecraft26Terrain) {
      this.populateMinecraft26ChunkTerrain(cx, cz, blocks, waterLevels, chunkSize, chunkArea, options);
      return;
    }
    const worldX0 = cx * chunkSize;
    const worldZ0 = cz * chunkSize;
    const densityField = this.buildChunkDensityField(worldX0, worldZ0, chunkSize);
    const columnHeights = new Int16Array(chunkArea);
    const densityColumn = new Float64Array(this.worldHeight);
    const densityZ0Samples = new Float64Array(DENSITY_Y_SIZE);
    const densityZ1Samples = new Float64Array(DENSITY_Y_SIZE);
    columnHeights.fill(0);

    for (let x = 0; x < chunkSize; x += 1) {
      for (let z = 0; z < chunkSize; z += 1) {
        const wx = worldX0 + x;
        const wz = worldZ0 + z;
        const columnIndex = z * chunkSize + x;

        const shape = this.terrainShapeAt(wx, wz);
        const river = { isRiverColumn: false, floorY: this.waterLevel - 2, surfaceY: this.waterLevel, clearY: this.waterLevel + 2 };
        const isRiverColumn = river.isRiverColumn;
        const riverFloor = river.floorY;
        const riverSurface = river.surfaceY;
        const riverClearY = river.clearY;
        const terrainY = this.terrainHeight(wx, wz);
        const riverRaisesBed = isRiverColumn && terrainY >= riverFloor - 1;
        const naturalWaterColumn =
          this.shouldFillWaterAt(wx, wz, terrainY) &&
          terrainY <= this.waterLevel + 1;
        this.fillInterpolatedChunkDensityColumn(
          densityField,
          x,
          z,
          densityColumn,
          densityZ0Samples,
          densityZ1Samples,
          chunkSize,
        );

        for (let y = 0; y < this.worldHeight; y += 1) {
          let block = this.Block.AIR;
          const density = densityColumn[y];
          if (y === 0) block = this.Block.BEDROCK;
          else if (y <= 4 || density > 0) block = this.Block.STONE;
          else if (y <= this.waterLevel) block = this.Block.WATER;

          if (isRiverColumn && y > 4) {
            if (y <= riverFloor) {
              // Keep normal riverbeds solid, but do not raise existing ocean or
              // deep-water floors into a visible underwater stripe.
              if (riverRaisesBed && (block === this.Block.AIR || block === this.Block.WATER)) {
                block = this.Block.STONE;
              }
            } else if (y <= riverSurface) {
              // Force water up to sea level even if the density field leaves thin stone caps.
              block = this.Block.WATER;
            } else if (y <= riverClearY) {
              // Clear the roof over the channel; otherwise the surface pass paints gravel/clay
              // above the water and the river looks dry from above.
              block = this.Block.AIR;
            }
          } else if (naturalWaterColumn && y > 4) {
            if (y === this.waterLevel && block === this.Block.STONE) {
              block = this.Block.WATER;
            } else if (y > this.waterLevel && y <= this.waterLevel + 2 && block === this.Block.STONE) {
              block = this.Block.AIR;
            }
          }

          const index = y * chunkArea + columnIndex;
          blocks[index] = block;
          waterLevels[index] = this.fluidLevelStoreFor(block);
          if (block === this.Block.STONE || block === this.Block.BEDROCK) columnHeights[columnIndex] = y;
        }

        if (isRiverColumn && riverRaisesBed) {
          columnHeights[columnIndex] = Math.min(columnHeights[columnIndex], riverFloor);
        }
        this.heightCache.set(columnKey(wx, wz), columnHeights[columnIndex]);
      }
    }

    this.runBiomeSurfacePass(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea);
    if (options.includeUndergroundFeatures !== false) {
      this.runCaveAndOrePass(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea);
    }
  }

  populateMinecraft26ChunkTerrain(cx, cz, blocks, waterLevels, chunkSize, chunkArea, options = {}) {
    const columnHeights = this.minecraft26Terrain.populateChunk(
      cx,
      cz,
      blocks,
      waterLevels,
      this.Block,
      chunkSize,
      chunkArea,
    );
    const worldX0 = cx * chunkSize;
    const worldZ0 = cz * chunkSize;
    for (let x = 0; x < chunkSize; x += 1) {
      for (let z = 0; z < chunkSize; z += 1) {
        this.heightCache.set(
          columnKey(worldX0 + x, worldZ0 + z),
          columnHeights[z * chunkSize + x],
        );
      }
    }

    this.runBiomeSurfacePass(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea);
    if (options.includeUndergroundFeatures !== false) {
      this.runCaveAndOrePass(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea, true);
    }
  }

  populateFastChunkSurface(cx, cz, blocks, waterLevels, chunkSize, chunkArea) {
    const worldX0 = cx * chunkSize;
    const worldZ0 = cz * chunkSize;
    const sampleStep = 2;
    const sampleWidth = Math.ceil(chunkSize / sampleStep) + 1;
    const samples = new Array(sampleWidth * sampleWidth);
    blocks.fill(this.Block.AIR);
    waterLevels.fill(0);

    for (let sampleZ = 0; sampleZ < sampleWidth; sampleZ += 1) {
      for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
        const wx = worldX0 + sampleX * sampleStep;
        const wz = worldZ0 + sampleZ * sampleStep;
        const height = clamp(Math.round(this.terrainHeight(wx, wz)), 1, this.worldHeight - 2);
        const biomeId = this.biomeAt(wx, wz);
        samples[sampleZ * sampleWidth + sampleX] = {
          height,
          water: this.shouldFillWaterAt(wx, wz, height),
          surface: this.surfaceBlocksFor(wx, wz, height, biomeId),
        };
      }
    }

    for (let x = 0; x < chunkSize; x += 1) {
      for (let z = 0; z < chunkSize; z += 1) {
        const columnIndex = z * chunkSize + x;
        const gx = x / sampleStep;
        const gz = z / sampleStep;
        const sx = Math.floor(gx);
        const sz = Math.floor(gz);
        const tx = gx - sx;
        const tz = gz - sz;
        const sample00 = samples[sz * sampleWidth + sx];
        const sample10 = samples[sz * sampleWidth + sx + 1];
        const sample01 = samples[(sz + 1) * sampleWidth + sx];
        const sample11 = samples[(sz + 1) * sampleWidth + sx + 1];
        const topHeight = lerp(sample00.height, sample10.height, tx);
        const bottomHeight = lerp(sample01.height, sample11.height, tx);
        const solidTop = clamp(Math.round(lerp(topHeight, bottomHeight, tz)), 1, this.worldHeight - 2);
        const nearestSampleX = tx < 0.5 ? sx : sx + 1;
        const nearestSampleZ = tz < 0.5 ? sz : sz + 1;
        const nearestSample = samples[nearestSampleZ * sampleWidth + nearestSampleX];
        const waterTop = nearestSample.water && solidTop <= this.waterLevel + 1
          ? this.waterLevel
          : -1;

        blocks[columnIndex] = this.Block.BEDROCK;
        for (let y = 1; y <= solidTop; y += 1) {
          blocks[y * chunkArea + columnIndex] = this.Block.STONE;
        }

        // A two-block preview grid is fine enough to avoid the old 4x4
        // sand/snow patches while keeping first-pass chunk coverage fast.
        const surface = nearestSample.surface;
        const fillerDepth = 4;
        blocks[solidTop * chunkArea + columnIndex] = surface.top;
        for (let depth = 1; depth <= fillerDepth && solidTop - depth > 0; depth += 1) {
          blocks[(solidTop - depth) * chunkArea + columnIndex] = surface.filler;
        }

        for (let y = solidTop + 1; y <= waterTop && y < this.worldHeight; y += 1) {
          const index = y * chunkArea + columnIndex;
          blocks[index] = this.Block.WATER;
          waterLevels[index] = this.fluidLevelStoreFor(this.Block.WATER);
        }
      }
    }
  }

  runBiomeSurfacePass(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea) {
    const worldX0 = cx * chunkSize;
    const worldZ0 = cz * chunkSize;

    for (let x = 0; x < chunkSize; x += 1) {
      for (let z = 0; z < chunkSize; z += 1) {
        const wx = worldX0 + x;
        const wz = worldZ0 + z;
        const columnIndex = z * chunkSize + x;
        const height = columnHeights[columnIndex];
        const biomeId = this.biomeAt(wx, wz);
        const surface = this.surfaceBlocksFor(wx, wz, height, biomeId);
        const fillerDepth = this.minecraft26Terrain
          ? clamp(Math.floor(this.minecraft26Terrain.surfaceDepthAt(wx, wz)), 1, 7)
          : 3 + Math.floor(normalizeNoise(this.detailNoise.fbm2(wx * 0.061 + 7, wz * 0.061 - 3, 2)) * 2);
        let depth = -1;

        for (let y = this.worldHeight - 1; y >= 1; y -= 1) {
          const index = y * chunkArea + columnIndex;
          const block = blocks[index];
          if (block === this.Block.AIR || block === this.Block.WATER) {
            depth = -1;
            continue;
          }
          if (block !== this.Block.STONE) continue;
          if (depth === -1) {
            blocks[index] = surface.top;
            waterLevels[index] = this.fluidLevelStoreFor(blocks[index]);
            depth = 1;
          } else if (depth <= fillerDepth) {
            blocks[index] = surface.filler;
            waterLevels[index] = this.fluidLevelStoreFor(blocks[index]);
            depth += 1;
          } else {
            depth += 1;
          }
        }
      }
    }
  }

  runCaveAndOrePass(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea, carveCaves = true) {
    const worldX0 = cx * chunkSize;
    const worldZ0 = cz * chunkSize;

    for (let x = 0; x < chunkSize; x += 1) {
      for (let z = 0; z < chunkSize; z += 1) {
        const wx = worldX0 + x;
        const wz = worldZ0 + z;
        const columnIndex = z * chunkSize + x;
        const surfaceHeight = columnHeights[columnIndex];
        const river = this.riverChannelAt(wx, wz);
        const riverBiome = isRiverBiome(this.Biome, this.biomeAt(wx, wz));
        for (let y = 1; y <= surfaceHeight; y += 1) {
          const index = y * chunkArea + columnIndex;
          const block = blocks[index];
          if (block === this.Block.AIR || block === this.Block.WATER || block === this.Block.BEDROCK) continue;
          const protectRiver = (river.isRiverColumn || riverBiome) && y <= river.surfaceY + 4;
          if (carveCaves && !protectRiver && y > 4 && this.isCaveAt(wx, y, wz, surfaceHeight)) {
            const caveBlock = this.aquiferBlockAt(wx, y, wz, surfaceHeight);
            blocks[index] = caveBlock;
            waterLevels[index] = this.fluidLevelStoreFor(caveBlock);
          } else if (block === this.Block.STONE) {
            const ore = this.oreBlockAt(wx, y, wz, surfaceHeight);
            blocks[index] = ore;
            waterLevels[index] = this.fluidLevelStoreFor(ore);
          }
        }
      }
    }

    this.growIsolatedCommonOres(
      cx,
      cz,
      blocks,
      waterLevels,
      columnHeights,
      chunkSize,
      chunkArea,
    );
  }

  growIsolatedCommonOres(cx, cz, blocks, waterLevels, columnHeights, chunkSize, chunkArea) {
    const directions = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    for (let x = 0; x < chunkSize; x += 1) {
      for (let z = 0; z < chunkSize; z += 1) {
        const columnIndex = z * chunkSize + x;
        const maxY = Math.min(this.worldHeight - 2, columnHeights[columnIndex]);
        for (let y = 1; y <= maxY; y += 1) {
          const index = y * chunkArea + z * chunkSize + x;
          const ore = blocks[index];
          if (ore !== this.Block.COAL_ORE && ore !== this.Block.IRON_ORE) continue;

          const connected =
            (x + 1 < chunkSize && blocks[index + 1] === ore) ||
            (x > 0 && blocks[index - 1] === ore) ||
            blocks[index + chunkArea] === ore ||
            blocks[index - chunkArea] === ore ||
            (z + 1 < chunkSize && blocks[index + chunkSize] === ore) ||
            (z > 0 && blocks[index - chunkSize] === ore);
          if (connected) continue;

          const wx = cx * chunkSize + x;
          const wz = cz * chunkSize + z;
          const start = hashInt(wx + y * 31, wz - y * 17, this.seed ^ ore, directions.length);
          let grew = false;
          for (let offset = 0; offset < directions.length; offset += 1) {
            const [dx, dy, dz] = directions[(start + offset) % directions.length];
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (nx < 0 || nx >= chunkSize || nz < 0 || nz >= chunkSize) continue;
            const neighborIndex = ny * chunkArea + nz * chunkSize + nx;
            if (blocks[neighborIndex] !== this.Block.STONE) continue;
            blocks[neighborIndex] = ore;
            waterLevels[neighborIndex] = this.fluidLevelStoreFor(ore);
            grew = true;
            break;
          }

          if (!grew && x > 0 && x < chunkSize - 1 && z > 0 && z < chunkSize - 1) {
            blocks[index] = this.Block.STONE;
            waterLevels[index] = this.fluidLevelStoreFor(this.Block.STONE);
          }
        }
      }
    }
  }

  terrainShapeAt(x, z) {
    if (this.minecraft26Terrain) {
      return this.minecraft26Terrain.shapeAt(x, z);
    }

    const key = columnKey(x, z);
    const cached = this.shapeCache.get(key);
    if (cached) return cached;

    const featureScale = this.terrainFeatureScale;
    const sx = x / featureScale;
    const sz = z / featureScale;
    const warpX = this.detailNoise.fbm2(sx * 0.0021 + 21, sz * 0.0021 - 73, 3) * 46;
    const warpZ = this.detailNoise.fbm2(sx * 0.0021 - 91, sz * 0.0021 + 37, 3) * 46;
    const wx = sx + warpX;
    const wz = sz + warpZ;
    const rawContinentalness = normalizeNoise(this.continentNoise.fbm2(wx * 0.00135, wz * 0.00135, 4, 2, 0.55));
    const cellularContinentalness = this.layeredCellularValueAt(wx, wz, 0xc0711d, 1536, 4);
    const continentalness = clamp(lerp(rawContinentalness, cellularContinentalness, 0.28), 0, 1);
    const erosion = normalizeNoise(this.erosionNoise.fbm2(wx * 0.00205 + 17, wz * 0.00205 - 41, 4, 2, 0.56));
    const weirdness = this.weirdnessNoise.fbm2(wx * 0.00415 - 120, wz * 0.00415 + 90, 4, 2, 0.52);
    const peaksAndValleys = peaksAndValleysFromWeirdness(weirdness);
    // Three river noise layers: two main branches + one tributary at tighter scale.
    // Wider bands and a lower erosion gate make rivers significantly more visible.
    const riverNoiseA = this.riverNoise.fbm2(wx * 0.0018 + 201, wz * 0.0018 - 151, 3, 2, 0.52);
    const riverNoiseB = this.riverNoise.fbm2(wx * 0.00155 - 571, wz * 0.00155 + 349, 3, 2, 0.52);
    const riverNoiseC = this.riverNoise.fbm2(wx * 0.0028 + 113, wz * 0.0028 - 417, 2, 2, 0.5);
    const riverWidthNoise = normalizeNoise(this.detailNoise.fbm2(wx * 0.0065 + 313, wz * 0.0065 - 271, 2));
    const riverNetworkNoise = normalizeNoise(this.riverNoise.fbm2(wx * 0.00072 + 991, wz * 0.00072 - 733, 3, 2, 0.56));
    // Wider channels: inner doubled, outer ~50% wider, bank ~40% wider
    const riverInner = lerp(0.0072, 0.0148, riverWidthNoise);
    const riverOuter = lerp(0.036, 0.062, riverWidthNoise);
    const riverBankOuter = lerp(0.072, 0.115, riverWidthNoise);
    // Slightly lower erosion gate so rivers appear more across the world
    const riverErosionGate = smoothstep(0.40, 0.70, erosion);
    const riverContinentGate = smoothstep(0.36, 0.52, continentalness) * (1 - smoothstep(0.70, 0.82, continentalness));
    const riverNetworkGate = lerp(0.42, 1, smoothstep(0.28, 0.56, riverNetworkNoise));
    const riverBandA = 1 - smoothstep(riverInner, riverOuter, Math.abs(riverNoiseA));
    const riverBandB = 1 - smoothstep(riverInner * 0.9, riverOuter * 0.9, Math.abs(riverNoiseB));
    const riverBandC = 1 - smoothstep(riverInner * 0.65, riverOuter * 0.65, Math.abs(riverNoiseC));
    const riverBankBandA = 1 - smoothstep(riverInner * 1.5, riverBankOuter, Math.abs(riverNoiseA));
    const riverBankBandB = 1 - smoothstep(riverInner * 1.35, riverBankOuter * 0.92, Math.abs(riverNoiseB));
    const pvRiverBand = 1 - smoothstep(-0.985, -0.86, peaksAndValleys);
    const riverPath = Math.max(riverBandA, riverBandB * 0.76, riverBandC * 0.55, pvRiverBand * 0.18);
    const riverBankPath = Math.max(riverBankBandA, riverBankBandB * 0.76, riverBandC * 0.42, pvRiverBand * 0.14);
    const riverGates = riverContinentGate * riverErosionGate * riverNetworkGate;
    const river = Math.pow(riverPath, 1.35) * riverGates;
    const riverBank = Math.max(river, Math.pow(riverBankPath, 1.12) * riverGates * 0.92);
    const valley = (1 - smoothstep(-0.9, -0.43, peaksAndValleys)) * smoothstep(0.48, 0.82, continentalness);
    const ridge = smoothstep(0.14, 0.52, Math.abs(weirdness));
    const peakNoise = normalizeNoise(this.detailNoise.fbm2(wx * 0.0085 - 19, wz * 0.0085 + 63, 3));
    const ridgedPeak = this.detailNoise.ridgedFbm2(wx * 0.0036 - 31, wz * 0.0036 + 79, 4, 2.0, 0.48);
    const rangeNoise = normalizeNoise(this.heightNoise.fbm2(wx * 0.00125 + 311, wz * 0.00125 - 257, 3, 2, 0.55));
    const upliftNoise = normalizeNoise(this.hillVariantNoise.fbm2(wx * 0.00095 - 411, wz * 0.00095 + 173, 3, 2, 0.58));
    const crestNoiseA = this.hillVariantNoise.fbm2(wx * 0.0032 + 223, wz * 0.0032 - 181, 3, 2, 0.52);
    const crestNoiseB = this.heightNoise.fbm2(wx * 0.0048 - 331, wz * 0.0048 + 277, 2, 2, 0.5);
    const rangeCrest = clamp(Math.max(
      (1 - smoothstep(0.07, 0.36, Math.abs(crestNoiseA))) * 0.72,
      (1 - smoothstep(0.06, 0.30, Math.abs(crestNoiseB))) * 0.48,
    ), 0, 1);
    const summitKnots = Math.pow(normalizeNoise(this.detailNoise.fbm2(wx * 0.0072 + 13, wz * 0.0072 - 97, 3, 2, 0.54)), 2.15);
    const inland = smoothstep(0.38, 0.74, continentalness);
    const lowErosion = smoothstep(0.10, 0.72, 1 - erosion);
    const pvMountain =
      inland *
      lowErosion *
      smoothstep(-0.08, 0.66, peaksAndValleys);
    const rangeMountain =
      inland *
      smoothstep(0.12, 0.68, 1 - erosion) *
      smoothstep(0.34, 0.76, rangeNoise);
    const upliftMountain =
      inland *
      smoothstep(0.18, 0.66, 1 - erosion) *
      smoothstep(0.50, 0.86, upliftNoise);
    const mountainSignal = clamp(Math.pow(Math.max(pvMountain, rangeMountain, upliftMountain), 0.86) * 1.18, 0, 1);
    const mountainDetailGate = smoothstep(0.30, 0.76, mountainSignal);
    const mountainBreakNoise = this.detailNoise.fbm2(wx * 0.017 + 503, wz * 0.017 - 617, 4, 2.05, 0.5);
    const mountainPocketNoise = normalizeNoise(this.terrainWarpNoise.fbm2(wx * 0.0105 - 727, wz * 0.0105 + 691, 3, 2, 0.52));
    const ribFieldA = this.hillVariantNoise.fbm2(wx * 0.0135 + 347, wz * 0.0135 - 283, 3, 2.15, 0.5);
    const ribFieldB = this.heightNoise.fbm2(wx * 0.021 - 181, wz * 0.021 + 419, 2, 2.1, 0.48);
    const mountainRibSignal = clamp(Math.max(
      (1 - smoothstep(0.070, 0.30, Math.abs(ribFieldA))) * 0.50,
      (1 - smoothstep(0.080, 0.34, Math.abs(ribFieldB))) * 0.34,
    ) * mountainDetailGate, 0, 1);
    const mountainDetail = clamp(
      (
        mountainBreakNoise * 0.30 +
        (mountainRibSignal - 0.34) * 0.18 +
        (mountainPocketNoise - 0.5) * 0.18
      ) * mountainDetailGate,
      -1,
      1,
    );
    const mountainScreeSignal = clamp(
      mountainDetailGate *
      (smoothstep(0.62, 0.92, mountainPocketNoise) * 0.30 + mountainRibSignal * 0.22),
      0,
      1,
    );
    const valleyFloor =
      (1 - smoothstep(-0.96, -0.45, peaksAndValleys)) *
      inland *
      smoothstep(0.42, 0.82, erosion) *
      (1 - smoothstep(0.18, 0.45, mountainSignal));
    const foldedRidge =
      smoothstep(0.08, 0.72, peaksAndValleys) *
      inland *
      smoothstep(0.12, 0.72, 1 - erosion);
    const plateauSignal = clamp(
      inland *
      smoothstep(0.58, 0.86, erosion) *
      smoothstep(0.42, 0.78, rangeNoise) *
      (1 - smoothstep(0.34, 0.62, mountainSignal)) *
      (0.72 + normalizeNoise(crestNoiseB) * 0.28),
      0,
      1,
    );
    const cliffSignal = clamp(
      (foldedRidge * 0.55 + rangeCrest * 0.45) *
      smoothstep(0.34, 0.82, 1 - erosion) *
      inland,
      0,
      1,
    );
    const sharpenedRidgedPeak = Math.pow(clamp(ridgedPeak, 0, 1), 2.65);
    const summitValleyGate = smoothstep(-0.82, -0.45, peaksAndValleys);
    const summitSignal = clamp(
      Math.max(
        rangeCrest * (0.24 + summitKnots * 0.34),
        sharpenedRidgedPeak * (0.18 + peakNoise * 0.36),
      ) * smoothstep(0.42, 0.86, mountainSignal) * summitValleyGate,
      0,
      1,
    );
    const saddleSignal = clamp(
      mountainSignal *
      (1 - summitSignal) *
      (1 - rangeCrest * 0.35) *
      smoothstep(0.38, 0.75, rangeNoise) *
      smoothstep(0.28, 0.78, upliftNoise),
      0,
      1,
    );

    const shape = {
      continentalness,
      erosion,
      weirdness,
      peaksAndValleys,
      ridge,
      river,
      riverBank,
      valley,
      peakNoise,
      ridgedPeak,
      rangeCrest,
      rangeNoise,
      upliftNoise,
      summitSignal,
      saddleSignal,
      mountainDetail,
      mountainRibSignal,
      mountainPocketNoise,
      mountainScreeSignal,
      mountainSignal,
      valleyFloor,
      foldedRidge,
      plateauSignal,
      cliffSignal,
      warpX,
      warpZ,
    };
    this.shapeCache.set(key, shape);
    return shape;
  }

  climateAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.climateCache.get(key);
    if (cached) return cached;

    const shape = this.terrainShapeAt(x, z);
    const temperature = this.temperatureAt(x, z);
    const vegetation = this.moistureAt(x, z);

    const climate = {
      temperature,
      moisture: vegetation,
      vegetation,
      continentalness: shape.continentalness,
      erosion: shape.erosion,
      weirdness: shape.weirdness,
      peaksAndValleys: shape.peaksAndValleys,
      depth: 0,
    };
    this.climateCache.set(key, climate);
    return climate;
  }

  moistureAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.moistureCache.get(key);
    if (cached !== undefined) return cached;

    const warp = this.detailNoise.fbm2(x * 0.00055 + 4, z * 0.00055 - 31, 2) * 120;
    const rawMoisture = normalizeNoise(this.vegetationNoise.fbm2((x + warp) * 0.00068, (z - warp) * 0.00068, 2, 2, 0.52));
    const cellularMoisture = this.layeredCellularValueAt(x + warp, z - warp, 0x6d0157, MOISTURE_CELL_SIZE, 2);
    const moisture = clamp(0.5 + (lerp(rawMoisture, cellularMoisture, 0.58) - 0.5) * 1.60, 0, 1);
    this.moistureCache.set(key, moisture);
    return moisture;
  }

  temperatureAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.temperatureCache.get(key);
    if (cached !== undefined) return cached;

    const latitude = Math.sin(z * 0.00024) * 0.08;
    const warp = this.detailNoise.fbm2(x * 0.00052 - 42, z * 0.00052 + 16, 2) * 112;
    const rawTemperature = normalizeNoise(this.temperatureNoise.fbm2((x + warp) * 0.00062 - 70, (z - warp) * 0.00062 + 20, 2, 2, 0.52));
    const cellularTemperature = this.layeredCellularValueAt(x + warp, z - warp, 0x7e2a97, TEMPERATURE_CELL_SIZE, 2);
    const temperature = clamp(0.5 + (lerp(rawTemperature, cellularTemperature, 0.54) - 0.5) * 1.26 + latitude, 0, 1);
    this.temperatureCache.set(key, temperature);
    return temperature;
  }

  gentleTerrainMaskAt(x, z, shape = this.terrainShapeAt(x, z)) {
    const temperature = this.temperatureAt(x, z);
    const moisture = this.moistureAt(x, z);
    const meadowClimate =
      smoothstep(0.34, 0.46, temperature) *
      (1 - smoothstep(0.63, 0.72, temperature)) *
      smoothstep(0.34, 0.5, moisture) *
      (1 - smoothstep(0.68, 0.78, moisture));
    const savannaClimate =
      smoothstep(0.54, 0.64, temperature) *
      smoothstep(0.34, 0.42, moisture) *
      (1 - smoothstep(0.62, 0.72, moisture));
    const lowMountain = 1 - smoothstep(0.18, 0.45, shape.mountainSignal);
    const highErosion = smoothstep(0.42, 0.75, shape.erosion);
    return clamp(Math.max(meadowClimate, savannaClimate) * lowMountain * highErosion, 0, 1);
  }

  biomeRegionRoll(x, z, salt = 0) {
    return normalizeNoise(this.biomeNoise.fbm2(
      x * 0.00064 + salt * 37.1,
      z * 0.00064 - salt * 19.7,
      3,
      2,
      0.55,
    ));
  }

  cellularValueAt(x, z, cellSize, salt) {
    const gx = x / cellSize;
    const gz = z / cellSize;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const tx = smoothstep(0, 1, gx - ix);
    const tz = smoothstep(0, 1, gz - iz);
    const v00 = hashFloat(ix, iz, this.seed ^ salt);
    const v10 = hashFloat(ix + 1, iz, this.seed ^ salt);
    const v01 = hashFloat(ix, iz + 1, this.seed ^ salt);
    const v11 = hashFloat(ix + 1, iz + 1, this.seed ^ salt);
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
  }

  layeredCellularValueAt(x, z, salt, baseCellSize, layers) {
    let value = 0;
    let amplitude = 1;
    let total = 0;
    for (let layer = 0; layer < layers; layer += 1) {
      const cellSize = baseCellSize / (2 ** layer);
      value += this.cellularValueAt(x, z, cellSize, salt + layer * 0x9e37) * amplitude;
      total += amplitude;
      amplitude *= 0.55;
    }
    return value / total;
  }

  // Climate handles broad regions; this cell roll keeps individual biome
  // patches readable without turning transitions into tiny checkerboards.
  biomeChoiceRoll(x, z, salt = 0, cellSize = BIOME_CHOICE_CELL_SIZE) {
    const warpX = this.detailNoise.fbm2(x * 0.0009 + salt * 11.7, z * 0.0009 - salt * 8.3, 2) * 160;
    const warpZ = this.detailNoise.fbm2(x * 0.0009 - salt * 6.1, z * 0.0009 + salt * 13.9, 2) * 160;
    const cellX = Math.floor((x + warpX) / cellSize);
    const cellZ = Math.floor((z + warpZ) / cellSize);
    const cellRoll = hashFloat(cellX + salt * 101, cellZ - salt * 131, this.seed ^ 0xb10f7);
    const layeredRoll = this.layeredCellularValueAt(x + warpX, z + warpZ, 0xb10f7 + salt * 17, cellSize * 2, 3);
    return clamp(lerp(cellRoll, layeredRoll, 0.32), 0, 1);
  }

  biomeHillSignalAt(x, z, shape = this.terrainShapeAt(x, z)) {
    const hillPatch = normalizeNoise(this.hillVariantNoise.fbm2(
      x * 0.00185 - 97,
      z * 0.00185 + 131,
      4,
      2,
      0.56,
    ));
    return clamp(
      hillPatch * 0.46 +
      shape.rangeNoise * 0.30 +
      shape.mountainSignal * 0.42 +
      (1 - shape.erosion) * 0.20,
      0,
      1,
    );
  }

  pickWeightedBiome(x, z, salt, entries, cellSize = BIOME_CHOICE_CELL_SIZE) {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.biomeChoiceRoll(x, z, salt, cellSize) * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) return entry.biome;
    }
    return entries[entries.length - 1].biome;
  }

  // FIX: Rebalanced biome distribution
  // Key changes:
  //   - Hot climate starts at 0.58 so deserts, badlands, and jungles are findable
  //   - Wet/dry moisture bands are broad enough to form larger climate regions
  //   - Rare hot dry biomes favor mesa plateaus instead of unrelated cold biomes
  //   - Rebalanced weights within each zone to prevent any single biome dominating
  weightedClimateBiomeAt(x, z, temperature, moisture, shape) {
    const rareRoll = this.biomeRegionRoll(x, z, 7);

    // FIX: More even temperature bands
    // hot:  T > 0.68 → ~32% of land  (was 0.60 → 40%, too dominant)
    // warm: T > 0.48 → ~20% of land  (was 0.42 → 18%)
    // cool: T > 0.28 → ~20% of land  (was 0.24 → 18%)
    // cold: T ≤ 0.28 → ~28% of land  (was 24%)
    const hot  = temperature > 0.58;
    const warm = temperature > 0.42;
    const cool = temperature > 0.25;

    // Moisture bands are intentionally broad so hot/dry regions become real
    // desert/badlands provinces instead of small sand circles inside savanna.
    const wet  = moisture > 0.58;
    const dry  = moisture < 0.46;
    const semiDry = moisture < 0.54;

    const windsweptProvince =
      shape.continentalness > 0.46 &&
      (1 - shape.erosion) > 0.48 &&
      (
        shape.mountainSignal > 0.42 ||
        (shape.rangeNoise > 0.76 && shape.peaksAndValleys > 0.10) ||
        (shape.rangeCrest > 0.56 && shape.upliftNoise > 0.58)
      );
    const bumpy = windsweptProvince;

    // --- HOT zone ---

    // Hot + Wet: Jungle territory
    if (hot && wet) {
      return this.pickWeightedBiome(x, z, 13, [
        { biome: this.Biome.JUNGLE,    weight: 6 },
        { biome: this.Biome.FOREST,    weight: 1.5 },
        { biome: this.Biome.SWAMPLAND, weight: 1 },
      ], 900);
    }

    // Hot + Dry: Desert/Mesa territory
    if (hot && dry) {
      return this.pickWeightedBiome(x, z, 17, [
        { biome: this.Biome.DESERT,         weight: 8 },
        { biome: this.Biome.MESA,           weight: 3 },
        { biome: this.Biome.MESA_PLATEAU_F, weight: 1.6 },
        { biome: this.Biome.SAVANNA,        weight: 0.6 },
      ], 1100);
    }

    // FIX: Rare biomes threshold lowered from 0.965 → 0.93 (7% vs 3.5% of inland)
    // This makes Jungle, Mega Taiga, and Mesa Plateaus actually findable
    if (rareRoll > 0.93 && shape.continentalness > 0.54) {
      if (hot && moisture < 0.5) {
        return this.pickWeightedBiome(x, z, 27, [
          { biome: this.Biome.MESA_PLATEAU,   weight: 1.6 },
          { biome: this.Biome.MESA_PLATEAU_F, weight: 1.4 },
          { biome: this.Biome.MESA,           weight: 1 },
        ], 1000);
      }
      if (warm && wet) return this.Biome.JUNGLE;
      if (cool && moisture > 0.5) return this.Biome.MEGA_TAIGA;
    }

    // Temperate forest patch (keep from original, slightly more likely)
    if (temperature > 0.34 && temperature < 0.66 && moisture > 0.52 && moisture < 0.68 && shape.erosion > 0.42 && this.biomeRegionRoll(x, z, 5) < 0.30) {
      return this.Biome.FOREST;
    }

    // Hot + Moist (middle): Savanna/Forest mix
    if (hot) {
      if (moisture > 0.56) {
        return this.pickWeightedBiome(x, z, 31, [
          { biome: this.Biome.SAVANNA, weight: 3 },
          { biome: this.Biome.JUNGLE,  weight: 2 },
          { biome: this.Biome.FOREST,  weight: 2 },
          { biome: this.Biome.PLAINS,  weight: 2 },
        ], 850);
      }
      if (semiDry) {
        return this.pickWeightedBiome(x, z, 32, [
          { biome: this.Biome.DESERT,  weight: 5 },
          { biome: this.Biome.SAVANNA, weight: 2.2 },
          { biome: this.Biome.MESA,    weight: 2 },
        ], 1000);
      }
      // Hot neutral bands should transition out of deserts gradually, not carve a
      // tight green ring around every sand patch.
      return this.pickWeightedBiome(x, z, 32, [
        { biome: this.Biome.SAVANNA, weight: 4 },
        { biome: this.Biome.DESERT,  weight: 2 },
        { biome: this.Biome.MESA,    weight: 1 },
        { biome: this.Biome.PLAINS,  weight: 1 },
      ], 900);
    }

    // --- WARM zone ---

    if (warm) {
      // Warm + Wet: Swampy/dense forests
      if (wet && shape.continentalness > 0.47 && shape.erosion > 0.34) {
        return this.pickWeightedBiome(x, z, 37, [
          { biome: this.Biome.SWAMPLAND,    weight: 3 },
          { biome: this.Biome.ROOFED_FOREST, weight: 2 },
          { biome: this.Biome.BIRCH_FOREST,  weight: 2 },
          { biome: this.Biome.FOREST,        weight: 3 },
        ], 900);
      }
      // Warm + Dry: Open land
      if (dry) {
        return this.pickWeightedBiome(x, z, 39, [
          { biome: this.Biome.SAVANNA, weight: 3 },
          { biome: this.Biome.PLAINS,  weight: 4 },
          { biome: this.Biome.FOREST,  weight: 2 },
          { biome: this.Biome.DESERT,  weight: 1 },
        ], 820);
      }
      // Warm + bumpy terrain: More extreme hills
      if (bumpy) {
        return this.pickWeightedBiome(x, z, 41, [
          { biome: this.Biome.EXTREME_HILLS, weight: 4.2 },
          { biome: this.Biome.FOREST,        weight: 2.6 },
          { biome: this.Biome.BIRCH_FOREST,  weight: 1.8 },
          { biome: this.Biome.ROOFED_FOREST, weight: 1.0 },
          { biome: this.Biome.PLAINS,        weight: 0.9 },
        ], MOUNTAIN_BIOME_CELL_SIZE);
      }
      // Warm + moist
      return this.pickWeightedBiome(x, z, 41, [
        { biome: this.Biome.FOREST,        weight: 4 },
        { biome: this.Biome.BIRCH_FOREST,  weight: 3 },
        { biome: this.Biome.ROOFED_FOREST, weight: 2 },
        { biome: this.Biome.PLAINS,        weight: 3 },
        { biome: this.Biome.SWAMPLAND,     weight: 2 },
      ], 820);
    }

    // --- COOL zone ---

    if (cool) {
      // FIX: Cool zone now has wet/dry splits (previously only bumpy vs flat)
      if (wet) {
        return this.pickWeightedBiome(x, z, 49, [
          { biome: this.Biome.FOREST,        weight: 3 },
          { biome: this.Biome.BIRCH_FOREST,  weight: 3 },
          { biome: this.Biome.TAIGA,         weight: 2 },
          { biome: this.Biome.ROOFED_FOREST, weight: 1 },
          { biome: this.Biome.SWAMPLAND,     weight: 1 },
        ], 820);
      }
      if (dry) {
        return this.pickWeightedBiome(x, z, 51, [
          { biome: this.Biome.PLAINS,  weight: 4 },
          { biome: this.Biome.TAIGA,   weight: 3 },
          { biome: this.Biome.FOREST,  weight: 2 },
          { biome: this.Biome.SAVANNA, weight: 1 },
        ], 820);
      }
      if (bumpy) {
        return this.pickWeightedBiome(x, z, 53, [
          { biome: this.Biome.EXTREME_HILLS, weight: 4.4 },
          { biome: this.Biome.TAIGA,         weight: 2.5 },
          { biome: this.Biome.FOREST,        weight: 1.8 },
          { biome: this.Biome.BIRCH_FOREST,  weight: 1.0 },
          { biome: this.Biome.PLAINS,        weight: 0.6 },
        ], MOUNTAIN_BIOME_CELL_SIZE);
      }
      return this.pickWeightedBiome(x, z, 53, [
        { biome: this.Biome.FOREST,       weight: 4 },
        { biome: this.Biome.BIRCH_FOREST, weight: 2 },
        { biome: this.Biome.TAIGA,        weight: 2 },
        { biome: this.Biome.PLAINS,       weight: 3 },
      ], 820);
    }

    // --- COLD zone ---
    // FIX: Added wet/dry split so cold areas have more variety
    if (wet) {
      return this.pickWeightedBiome(x, z, 61, [
        { biome: this.Biome.COLD_TAIGA, weight: 4 },
        { biome: this.Biome.TAIGA,      weight: 2 },
        { biome: this.Biome.ICE_PLAINS, weight: 2 },
      ], 900);
    }
    return this.pickWeightedBiome(x, z, 61, [
      { biome: this.Biome.ICE_PLAINS,  weight: 4 },
      { biome: this.Biome.COLD_TAIGA,  weight: 3 },
      { biome: this.Biome.TAIGA,       weight: 1 },
    ], 900);
  }

  variantBiomeFor(base, x, z, height, temperature, moisture, shape) {
    const hillSignal = this.biomeHillSignalAt(x, z, shape);
    const rare = this.biomeRegionRoll(x, z, 71);
    const reliefProvince = this.biomeChoiceRoll(x, z, 72, MOUNTAIN_BIOME_CELL_SIZE);
    const highRelief =
      reliefProvince > 0.46 &&
      (
        shape.mountainSignal > 0.56 ||
        height > this.seaLevel + 38 ||
        (hillSignal > 0.74 && shape.mountainSignal > 0.30)
      );
    const mutated = rare > 0.982;

    if (base === this.Biome.PLAINS) {
      if (rare > 0.955 || (temperature > 0.36 && moisture > 0.32 && this.biomeRegionRoll(x, z, 79) > 0.72)) return this.Biome.SUNFLOWER_PLAINS;
      return this.Biome.PLAINS;
    }

    if (base === this.Biome.DESERT) {
      if (mutated) return this.Biome.DESERT_M;
      if (highRelief) return this.Biome.DESERT_HILLS;
      return base;
    }

    if (base === this.Biome.FOREST) {
      if (moisture > 0.38 && moisture < 0.78 && this.biomeChoiceRoll(x, z, 73, 720) > 0.78) return this.Biome.FLOWER_FOREST;
      if (highRelief) return this.Biome.FOREST_HILLS;
      return base;
    }

    if (base === this.Biome.BIRCH_FOREST) {
      if (mutated && highRelief) return this.Biome.BIRCH_FOREST_HILLS_M;
      if (mutated) return this.Biome.BIRCH_FOREST_M;
      if (highRelief) return this.Biome.BIRCH_FOREST_HILLS;
      return base;
    }

    if (base === this.Biome.TAIGA) {
      if (mutated) return this.Biome.TAIGA_M;
      if (highRelief) return this.Biome.TAIGA_HILLS;
      return base;
    }

    if (base === this.Biome.COLD_TAIGA) {
      if (mutated) return this.Biome.COLD_TAIGA_M;
      if (highRelief) return this.Biome.COLD_TAIGA_HILLS;
      return base;
    }

    if (base === this.Biome.MEGA_TAIGA) {
      if (mutated && highRelief) return this.Biome.MEGA_SPRUCE_TAIGA_HILLS;
      if (mutated) return this.Biome.MEGA_SPRUCE_TAIGA;
      if (highRelief) return this.Biome.MEGA_TAIGA_HILLS;
      return base;
    }

    if (base === this.Biome.JUNGLE) {
      const edge = moisture < 0.54 || temperature < 0.54;
      if (mutated && edge) return this.Biome.JUNGLE_EDGE_M;
      if (mutated) return this.Biome.JUNGLE_M;
      if (edge) return this.Biome.JUNGLE_EDGE;
      if (highRelief) return this.Biome.JUNGLE_HILLS;
      return base;
    }

    if (base === this.Biome.ROOFED_FOREST) {
      if (mutated || highRelief) return this.Biome.ROOFED_FOREST_M;
      return base;
    }

    if (base === this.Biome.SWAMPLAND) {
      if (height > this.waterLevel + 8 || shape.mountainSignal > 0.28 || shape.plateauSignal > 0.38) {
        return moisture > 0.64 ? this.Biome.FOREST : this.Biome.PLAINS;
      }
      if (highRelief) return moisture > 0.64 ? this.Biome.FOREST_HILLS : this.Biome.PLAINS;
      if (mutated) return this.Biome.SWAMPLAND_M;
      return base;
    }

    if (base === this.Biome.SAVANNA) {
      if (shape.mountainSignal > 0.48 || (mutated && highRelief)) return this.Biome.SAVANNA_M;
      if (highRelief) return this.Biome.SAVANNA_PLATEAU;
      return base;
    }

    if (isMesaBiome(this.Biome, base)) {
      if (mutated && shape.peakNoise > 0.55) return this.Biome.MESA_BRYCE;
      if (mutated && base === this.Biome.MESA_PLATEAU_F) return this.Biome.MESA_PLATEAU_F_M;
      if (mutated && base === this.Biome.MESA_PLATEAU) return this.Biome.MESA_PLATEAU_M;
      if (highRelief && moisture > 0.22) return this.Biome.MESA_PLATEAU_F;
      if (highRelief) return this.Biome.MESA_PLATEAU;
      return base;
    }

    if (base === this.Biome.EXTREME_HILLS) {
      if (mutated) return this.Biome.EXTREME_HILLS_M;
      if (height > this.seaLevel + 34 || shape.mountainSignal > 0.60) return this.Biome.EXTREME_HILLS_PLUS;
      if (hillSignal < 0.30 && height <= this.seaLevel + 14 && shape.mountainSignal < 0.18) return this.Biome.EXTREME_HILLS_EDGE;
      return base;
    }

    if (base === this.Biome.ICE_PLAINS) {
      if (mutated && shape.peakNoise > 0.48) return this.Biome.ICE_SPIKES;
      if (highRelief) return this.Biome.ICE_MOUNTAINS;
      return base;
    }

    return base;
  }

  minecraft118MountainBiomeFor(x, z, height, temperature, moisture, shape) {
    const elevation = height - this.seaLevel;
    const mountain = shape.mountainSignal;
    const summit = shape.summitSignal ?? 0;
    const crest = shape.rangeCrest ?? 0;
    const rough = 1 - shape.erosion;
    const detail = Math.abs(shape.mountainDetail ?? 0);
    const highEnough = elevation > 32 || crest > 0.62 || summit > 0.24;
    if (mountain < 0.42 || !highEnough) return null;

    const plateau = (shape.plateauSignal ?? 0) * (1 - smoothstep(0.48, 0.72, mountain));
    const meadowClimate =
      temperature > 0.24 &&
      temperature < 0.62 &&
      moisture > 0.34 &&
      moisture < 0.78;
    if (
      meadowClimate &&
      elevation >= 18 &&
      elevation <= 64 &&
      (plateau > 0.24 || (shape.erosion > 0.52 && mountain < 0.62))
    ) {
      return this.Biome.MEADOW;
    }

    const coldSlope = temperature < 0.43;
    if (
      coldSlope &&
      elevation >= 42 &&
      mountain < 0.72 &&
      summit < 0.30 &&
      (
        moisture < 0.50 ||
        rough > 0.56 ||
        crest > 0.52 ||
        (shape.mountainScreeSignal ?? 0) > 0.16
      )
    ) {
      return this.Biome.SNOWY_SLOPES;
    }

    if (
      coldSlope &&
      moisture > 0.34 &&
      elevation >= 28 &&
      elevation <= 70 &&
      mountain < 0.72 &&
      summit < 0.30
    ) {
      return this.Biome.GROVE;
    }

    const peakBand =
      elevation >= 74 ||
      summit > 0.38 ||
      (crest > 0.74 && elevation > 52) ||
      mountain > 0.84;
    if (!peakBand && coldSlope && elevation >= 44) return this.Biome.SNOWY_SLOPES;
    if (!peakBand) return null;

    if ((temperature > 0.50 || moisture < 0.30) && (elevation > 76 || summit > 0.42 || mountain > 0.86)) return this.Biome.STONY_PEAKS;

    const jagged =
      summit > 0.42 ||
      crest > 0.78 ||
      shape.ridgedPeak > 0.68 ||
      detail > 0.42 ||
      rough > 0.72;
    if (jagged) return this.Biome.JAGGED_PEAKS;

    return this.Biome.FROZEN_PEAKS;
  }

  biomeAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.biomeCache.get(key);
    if (cached !== undefined) return cached;

    if (this.minecraft18BiomeSource) {
      const biome = minecraft18BiomeIdToVoxelBiome(this.Biome, this.minecraft18BiomeIdAt(x, z));
      this.biomeCache.set(key, biome);
      return biome;
    }

    if (this.minecraft26Terrain) {
      const officialBiome = this.minecraft26Terrain.biomeAt(x, z, this.rawTerrainHeight(x, z));
      const biome = minecraft26BiomeIdToVoxelBiome(this.Biome, officialBiome);
      this.biomeCache.set(key, biome);
      return biome;
    }

    const shape = this.terrainShapeAt(x, z);
    const height = this.rawTerrainHeight(x, z);
    const temperature = this.temperatureAt(x, z);
    const moisture = this.moistureAt(x, z);
    let biome;

    if (this.isMushroomIslandAt(x, z, shape)) {
      biome = height <= this.seaLevel + 1 ? this.Biome.MUSHROOM_SHORE : this.Biome.MUSHROOM_ISLAND;
      this.biomeCache.set(key, biome);
      return biome;
    }

    if (shape.continentalness < 0.16 || height < this.seaLevel - 25) {
      // FIX: Updated frozen threshold to match new cold band (0.28 instead of 0.22)
      biome = temperature < 0.26 ? this.Biome.FROZEN_OCEAN : this.Biome.DEEP_OCEAN;
      this.biomeCache.set(key, biome);
      return biome;
    }

    if (
      shape.continentalness < 0.28 ||
      height < this.seaLevel - 9 ||
      (height < this.seaLevel - 5 && shape.continentalness < 0.50)
    ) {
      // FIX: Updated frozen threshold to match new cold band
      biome = temperature < 0.26 ? this.Biome.FROZEN_OCEAN : this.Biome.OCEAN;
      this.biomeCache.set(key, biome);
      return biome;
    }

    const river = this.riverChannelAt(x, z, shape);
    const riverBank =
      shape.river > 0.32 &&
      shape.erosion > 0.40 &&
      shape.continentalness > 0.40 &&
      shape.continentalness < 0.80 &&
      shape.mountainSignal < 0.30 &&
      height <= this.waterLevel + 2;
    const carvedRiverValley =
      shape.river > 0.58 &&
      shape.erosion > 0.40 &&
      shape.continentalness > 0.40 &&
      shape.continentalness < 0.80 &&
      shape.mountainSignal < 0.32 &&
      height <= this.waterLevel + 8;
    if (river.isRiverColumn || riverBank || carvedRiverValley) {
      biome = temperature < 0.28 ? this.Biome.FROZEN_RIVER : this.Biome.RIVER;
      this.biomeCache.set(key, biome);
      return biome;
    }

    const tropicalWetCoast = temperature > 0.56 && moisture > 0.54;
    const coastline =
      height <= this.seaLevel + (tropicalWetCoast ? 1 : 2) &&
      shape.continentalness < (tropicalWetCoast ? 0.47 : 0.52) &&
      this.biomeRegionRoll(x, z, 91) > (tropicalWetCoast ? 0.55 : 0.1);
    if (coastline) {
      // FIX: Updated cold beach threshold
      if (temperature < 0.28) biome = this.Biome.COLD_BEACH;
      else if (shape.mountainSignal > 0.36 || (1 - shape.erosion) > 0.72) biome = this.Biome.STONE_BEACH;
      else biome = this.Biome.BEACH;
      this.biomeCache.set(key, biome);
      return biome;
    }

    // Keep true mountain biomes on cores and crest shoulders. Nearby highlands
    // use a larger windswept province so ranges have readable shoulders.
    const highlandProvince = this.biomeChoiceRoll(x, z, 89, MOUNTAIN_BIOME_CELL_SIZE);
    const mountainCoreBiome =
      (highlandProvince > 0.24 || shape.mountainSignal > 0.78) &&
      shape.mountainSignal > 0.64 &&
      (1 - shape.erosion) > 0.40 &&
      (height > this.seaLevel + 34 || shape.rangeCrest > 0.56 || (shape.summitSignal ?? 0) > 0.24);
    const mountainShoulderBiome =
      shape.mountainSignal > 0.54 &&
      (1 - shape.erosion) > 0.34 &&
      (height > this.seaLevel + 24 || shape.rangeCrest > 0.50) &&
      (highlandProvince > 0.46 || shape.mountainSignal > 0.74);
    const forceMountain = mountainCoreBiome || mountainShoulderBiome;
    const windsweptShoulderBiome =
      !forceMountain &&
      shape.continentalness > 0.42 &&
      shape.mountainSignal > 0.40 &&
      (1 - shape.erosion) > 0.28 &&
      (height > this.seaLevel + 18 || shape.rangeCrest > 0.44) &&
      highlandProvince > 0.38;

    const legacyMountainBiome = this.legacyMountainBiomeFor(x, z, height, temperature, moisture, shape);
    const modernPeakCore =
      forceMountain &&
      shape.mountainSignal > 0.72 &&
      (height > this.seaLevel + 58 || shape.rangeCrest > 0.70 || (shape.summitSignal ?? 0) > 0.34);
    if (legacyMountainBiome && (modernPeakCore || forceMountain || windsweptShoulderBiome)) {
      biome = legacyMountainBiome;
    } else {
      const base = forceMountain || windsweptShoulderBiome
        ? this.Biome.EXTREME_HILLS
        : this.weightedClimateBiomeAt(x, z, temperature, moisture, shape);
      biome = this.variantBiomeFor(base, x, z, height, temperature, moisture, shape);
    }

    if (isMountainBiome(this.Biome, biome) && shape.mountainSignal < 0.4 && height < this.seaLevel + 22) {
      // FIX: Updated cold threshold to match new cold band (0.28)
      biome = temperature < 0.28
        ? this.Biome.ICE_MOUNTAINS
        : (moisture > 0.46 ? this.Biome.FOREST_HILLS : this.Biome.PLAINS);
    }

    biome = this.altitudeAdjustedBiomeFor(biome, height);

    this.biomeCache.set(key, biome);
    return biome;
  }

  altitudeAdjustedBiomeFor(biome, height) {
    if (!isDesertBiome(this.Biome, biome)) return biome;

    const elevation = height - this.seaLevel;
    if (elevation >= 42) return this.Biome.EXTREME_HILLS;
    if (elevation >= 22) return this.Biome.EXTREME_HILLS_EDGE;
    if (elevation >= 12 && biome === this.Biome.DESERT) return this.Biome.DESERT_HILLS;
    return biome;
  }

  legacyMountainBiomeFor(x, z, height, temperature, moisture, shape) {
    const elevation = height - this.seaLevel;
    const mountain = shape.mountainSignal;
    const summit = shape.summitSignal ?? 0;
    const crest = shape.rangeCrest ?? 0;
    const highEnough = elevation > 26 || crest > 0.56 || summit > 0.20;
    if (mountain < 0.38 || !highEnough) return null;

    const plateau = (shape.plateauSignal ?? 0) > 0.34 || shape.erosion > 0.58;
    if (temperature < 0.24) {
      if (elevation > 54 || summit > 0.32 || crest > 0.72) return this.Biome.ICE_MOUNTAINS;
      return moisture > 0.44 ? this.Biome.COLD_TAIGA_HILLS : this.Biome.ICE_PLAINS;
    }
    if (temperature < 0.38) {
      if (moisture > 0.46) return this.Biome.TAIGA_HILLS;
      return elevation > 48 ? this.Biome.EXTREME_HILLS : this.Biome.TAIGA;
    }
    if (temperature > 0.62 && moisture < 0.40) {
      if (plateau && mountain > 0.52) {
        return moisture < 0.22 ? this.Biome.MESA_PLATEAU : this.Biome.SAVANNA_PLATEAU;
      }
      return moisture < 0.28 ? this.Biome.MESA : this.Biome.SAVANNA;
    }
    if (temperature > 0.54 && moisture > 0.58) return this.Biome.JUNGLE_HILLS;
    if (moisture > 0.58) return this.Biome.FOREST_HILLS;
    if (moisture > 0.44 && this.biomeChoiceRoll(x, z, 95, MOUNTAIN_BIOME_CELL_SIZE) > 0.58) {
      return this.Biome.EXTREME_HILLS_PLUS;
    }
    return this.Biome.EXTREME_HILLS;
  }

  minecraft18BiomeIdAt(x, z) {
    if (!this.minecraft18BiomeSource) return null;
    return this.minecraft18BiomeSource.getBiome(Math.floor(x), Math.floor(z), true);
  }

  minecraft26BiomeIdAt(x, z) {
    if (!this.minecraft26Terrain) return null;
    return this.minecraft26Terrain.biomeAt(x, z, this.rawTerrainHeight(x, z));
  }

  isMushroomIslandAt(x, z, shape) {
    if (shape.continentalness < 0.38 || shape.continentalness > 0.58) return false;
    const cellX = Math.floor(x / 640);
    const cellZ = Math.floor(z / 640);
    if (hashFloat(cellX, cellZ, this.seed ^ 0x6d15ea) < 0.986) return false;
    const islandPatch = normalizeNoise(this.biomeNoise.fbm2(x * 0.00072 + 431, z * 0.00072 - 263, 4, 2, 0.56));
    const islandCore = normalizeNoise(this.detailNoise.fbm2(x * 0.0024 - 83, z * 0.0024 + 211, 2));
    return islandPatch > 0.986 && islandCore > 0.42;
  }

  isCoastlineAt(x, z, shape = this.terrainShapeAt(x, z), height = this.terrainHeight(x, z)) {
    const key = columnKey(x, z);
    const cached = this.shoreCache.get(key);
    if (cached !== undefined) return cached;

    let shoreline = false;
    if (!this.shouldFillWaterAt(x, z, height) && height <= this.seaLevel + 2) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [4, 0],
        [-4, 0],
        [0, 4],
        [0, -4],
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ]) {
        const nx = x + dx;
        const nz = z + dz;
        const neighborShape = this.terrainShapeAt(nx, nz);
        // Coast detection must use the raw routed height. Using the
        // biome-adjusted height here lets adjacent beach columns recursively
        // ask each other for their final height.
        const neighborHeight = this.rawTerrainHeight(nx, nz);
        const naturalWater =
          neighborHeight <= this.waterLevel &&
          (
            this.isNaturalWaterColumn(neighborShape, neighborHeight) ||
            this.riverChannelAt(nx, nz, neighborShape).isRiverColumn
          );
        if (naturalWater) {
          shoreline = true;
          break;
        }
      }
    }

    this.shoreCache.set(key, shoreline);
    return shoreline;
  }

  isShorelineAt(x, z, shape = this.terrainShapeAt(x, z), height = this.terrainHeight(x, z)) {
    return this.isCoastlineAt(x, z, shape, height);
  }

  legacyTerrainBlock(block) {
    const B = this.Block;
    if (
      block === B.MOSS ||
      block === B.MEADOW_GRASS ||
      block === B.DRY_GRASS ||
      block === B.SAVANNA_GRASS ||
      block === B.JUNGLE_GRASS
    ) return B.GRASS;
    if (block === B.MUD) return B.DIRT;
    if (
      block === B.LIMESTONE ||
      block === B.BASALT ||
      block === B.SLATE ||
      block === B.GRANITE ||
      block === B.DIORITE ||
      block === B.ANDESITE ||
      block === B.DEEPSLATE
    ) return B.STONE;
    if (block === B.COPPER_ORE) return B.IRON_ORE;
    return block;
  }

  legacyPlantType(plant) {
    if (plant === "wildflower") return "poppy";
    if (plant === "clover") return "tall_grass";
    if (plant === "berry_bush") return "fern";
    if (plant === "savanna_shrub") return "dead_bush";
    return plant;
  }

  cachePlantType(key, plant) {
    const legacyPlant = this.legacyPlantType(plant);
    this.plantCache.set(key, legacyPlant);
    return legacyPlant;
  }

  surfaceBlocksFor(x, z, height, biomeId) {
    const cached = this.surfaceBlockCache.get(`${columnKey(x, z)},${biomeId}`);
    if (cached) return cached;

    const B = this.Biome;
    const biome = this.BIOMES[biomeId] ?? this.BIOMES[B.FOREST];
    const shape = this.terrainShapeAt(x, z);
    const steep = this.localSteepnessAt(x, z);
    const beachSandPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.039 + 25, z * 0.039 - 17, 2));
    const gravelPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.052 - 77, z * 0.052 + 43, 2));
    let top = biome.surface;
    let filler = biome.filler;

    if (biomeId === B.BEACH || biomeId === B.COLD_BEACH) {
      const shoreline = this.isShorelineAt(x, z, shape, height);
      if (!shoreline) {
        top = steep > 3 ? this.Block.STONE : (biomeId === B.COLD_BEACH ? this.Block.SNOW_GRASS : this.Block.GRASS);
        filler = steep > 3 ? this.Block.STONE : this.Block.DIRT;
      } else {
        top = this.Block.SAND;
        filler = this.Block.SAND;
      }
    } else if (biomeId === B.STONE_BEACH) {
      if (this.isShorelineAt(x, z, shape, height)) {
        top = steep > 2 || gravelPatch > 0.46 ? this.Block.STONE : this.Block.GRAVEL;
        filler = this.Block.GRAVEL;
      } else {
        top = steep > 3 ? this.Block.STONE : this.Block.GRASS;
        filler = steep > 3 ? this.Block.STONE : this.Block.DIRT;
      }
    } else if (biomeId === B.RIVER || biomeId === B.FROZEN_RIVER) {
      const riverData = this.riverChannelAt(x, z, shape);
      const wetRiver = riverData.isRiverColumn || this.shouldFillWaterAt(x, z, height);
      const bankDist = smoothstep(0.30, 0.90, shape.river);
      if (wetRiver) {
        // River bed varies: center is gravel/clay/sand mix, edges more sandy
        if (bankDist > 0.55) {
          top = gravelPatch > 0.44 ? this.Block.GRAVEL : this.Block.CLAY;
        } else {
          top = gravelPatch > 0.62 ? this.Block.GRAVEL : (beachSandPatch > 0.50 ? this.Block.SAND : this.Block.CLAY);
        }
        filler = gravelPatch > 0.52 ? this.Block.GRAVEL : this.Block.SAND;
      } else {
        // Sand and gravel belong on the submerged channel floor. Exposed
        // river banks use the surrounding grass/dirt surface in Minecraft.
        top = steep > 3 ? this.Block.STONE : this.Block.GRASS;
        filler = steep > 3 ? this.Block.STONE : this.Block.DIRT;
      }
    } else if (isOceanBiome(B, biomeId)) {
      if (height >= this.waterLevel) {
        const shoreline = this.isShorelineAt(x, z, shape, height);
        if (shoreline) {
          top = beachSandPatch > 0.32 ? this.Block.SAND : this.Block.GRAVEL;
          filler = this.Block.SAND;
        } else {
          top = steep > 3 ? this.Block.STONE : this.Block.GRASS;
          filler = steep > 3 ? this.Block.STONE : this.Block.DIRT;
        }
      } else {
        top = gravelPatch > 0.62 ? this.Block.GRAVEL : (beachSandPatch > 0.42 ? this.Block.SAND : this.Block.CLAY);
        filler = gravelPatch > 0.62 ? this.Block.GRAVEL : this.Block.SAND;
      }
    } else if (isSwampBiome(B, biomeId)) {
      const wetGround = this.shouldFillWaterAt(x, z, height);
      const clayPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.031 - 41, z * 0.031 + 67, 2));
      const muddyPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.057 + 109, z * 0.057 - 83, 2));
      const coarsePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.043 + 73, z * 0.043 - 51, 2));
      const deepMudPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.019 + 237, z * 0.019 - 191, 3));
      if (wetGround) {
        // Wet swamp floor: large clay beds, deep mud, silty banks
        if (deepMudPatch > 0.68) { top = this.Block.CLAY; filler = this.Block.CLAY; }
        else if (clayPatch > 0.44) { top = this.Block.CLAY; filler = this.Block.DIRT; }
        else { top = this.Block.DIRT; filler = this.Block.DIRT; }
      } else if (height <= this.waterLevel + 1) {
        if (deepMudPatch > 0.72) { top = this.Block.CLAY; filler = this.Block.CLAY; }
        else if (muddyPatch > 0.42 || coarsePatch > 0.58) { top = this.Block.DIRT; filler = this.Block.DIRT; }
        else { top = this.Block.GRASS; filler = this.Block.DIRT; }
      } else {
        // Dry swamp banks use the vanilla grass-over-dirt surface. Mud and
        // clay remain restricted to the waterline and submerged floor.
        top = this.Block.GRASS;
        filler = this.Block.DIRT;
      }
    } else if (biomeId === B.FLOWER_FOREST) {
      const mossPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.049 + 151, z * 0.049 - 193, 2));
      if (mossPatch > 0.64 && steep <= 2) {
        top = this.Block.MOSS;
        filler = this.Block.DIRT;
      }
    } else if (biomeId === B.PLAINS || biomeId === B.SUNFLOWER_PLAINS) {
      const meadowPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.036 + 193, z * 0.036 - 157, 2));
      const dryPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.047 - 271, z * 0.047 + 211, 2));
      if (steep >= 4) {
        top = this.Block.COARSE_DIRT;
        filler = this.Block.DIRT;
      } else if (biomeId === B.SUNFLOWER_PLAINS && meadowPatch > 0.54) {
        top = this.Block.MEADOW_GRASS;
        filler = this.Block.DIRT;
      } else if (dryPatch > 0.78) {
        top = this.Block.COARSE_DIRT;
        filler = this.Block.DIRT;
      }
    } else if (
      biomeId === B.FOREST ||
      biomeId === B.FOREST_HILLS ||
      biomeId === B.BIRCH_FOREST ||
      biomeId === B.BIRCH_FOREST_HILLS ||
      biomeId === B.BIRCH_FOREST_M ||
      biomeId === B.BIRCH_FOREST_HILLS_M ||
      biomeId === B.ROOFED_FOREST ||
      biomeId === B.ROOFED_FOREST_M
    ) {
      const mossPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.041 + 389, z * 0.041 - 337, 3));
      const rootPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.027 - 503, z * 0.027 + 449, 2));
      if (steep >= 5) {
        top = this.Block.STONE;
        filler = this.Block.STONE;
      } else if ((biomeId === B.ROOFED_FOREST || biomeId === B.ROOFED_FOREST_M) && rootPatch > 0.58) {
        top = this.Block.PODZOL;
        filler = this.Block.DIRT;
      } else if (mossPatch > 0.72 && steep <= 3) {
        top = this.Block.MOSS;
        filler = this.Block.DIRT;
      } else if (rootPatch > 0.76) {
        top = this.Block.COARSE_DIRT;
        filler = this.Block.DIRT;
      }
    } else if (isTaigaBiome(B, biomeId)) {
      const podzolPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.034 + 607, z * 0.034 - 557, 3));
      const stonePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.049 - 463, z * 0.049 + 631, 2));
      if (steep >= 5) {
        top = this.Block.STONE;
        filler = this.Block.STONE;
      } else if (stonePatch > 0.78 && height > this.seaLevel + 8) {
        top = this.Block.GRAVEL;
        filler = this.Block.DIRT;
      } else if (podzolPatch > 0.46) {
        top = this.Block.PODZOL;
        filler = this.Block.DIRT;
      }
    } else if (isSavannaBiome(B, biomeId)) {
      const limestonePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.039 + 719, z * 0.039 - 683, 2));
      const dustyPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.052 - 809, z * 0.052 + 743, 2));
      if (steep >= 5 || (height > this.seaLevel + 12 && limestonePatch > 0.82)) {
        top = this.Block.LIMESTONE;
        filler = this.Block.STONE;
      } else if (dustyPatch > 0.58 || biomeId === B.SAVANNA_M || biomeId === B.SAVANNA_PLATEAU_M) {
        top = this.Block.COARSE_DIRT;
        filler = this.Block.DIRT;
      } else if (height > this.seaLevel + 8) {
        top = this.Block.SAVANNA_GRASS;
        filler = this.Block.DIRT;
      }
    } else if (biomeId === B.MUSHROOM_ISLAND || biomeId === B.MUSHROOM_SHORE) {
      const clayPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.033 + 829, z * 0.033 - 773, 2));
      if (height <= this.waterLevel + 1 && clayPatch > 0.56) {
        top = this.Block.CLAY;
        filler = this.Block.CLAY;
      } else {
        top = this.Block.MYCELIUM;
        filler = this.Block.DIRT;
      }
    } else if (isMesaBiome(B, biomeId)) {
      const stripe = normalizeNoise(this.detailNoise.fbm2(x * 0.018 + height * 0.022, z * 0.018 - height * 0.017, 3));
      const stripeB = normalizeNoise(this.heightNoise.fbm2(x * 0.012 - height * 0.015, z * 0.012 + height * 0.019, 2));
      // Steep cliffs expose stone/hardened clay, flat tops get red sand or terracotta
      if (steep >= 5) {
        top = stripeB > 0.55 ? this.Block.TERRACOTTA : this.Block.STONE;
        filler = this.Block.TERRACOTTA;
      } else {
        top = biomeId === B.MESA || stripe > 0.60 ? this.Block.RED_SAND : this.Block.TERRACOTTA;
        filler = stripe > 0.74 ? this.Block.WHITE_TERRACOTTA : (stripeB > 0.62 ? this.Block.TERRACOTTA : this.Block.TERRACOTTA);
      }
    } else if (isDesertBiome(B, biomeId)) {
      const elevation = height - this.seaLevel;
      // Desert: steep cliff faces expose stone, moderate slopes expose sandstone
      if (steep >= 6 && elevation > 6) {
        top = this.Block.STONE;
        filler = this.Block.SANDSTONE;
      } else if (steep >= 4 && elevation > 8) {
        top = this.Block.SANDSTONE;
        filler = this.Block.SANDSTONE;
      } else {
        top = this.Block.SAND;
        filler = this.Block.SANDSTONE;
      }
    } else if (isMountainBiome(B, biomeId)) {
      const temperature = this.temperatureAt(x, z);
      const elevation = height - this.seaLevel;
      const stonePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.052 + 117, z * 0.052 - 73, 2));
      const orePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.082 + 201, z * 0.082 - 173, 2));
      const oreScatter = hashFloat(x, z - 1, this.seed ^ 0x0e0a1);
      const rockPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.038 - 89, z * 0.038 + 131, 3));
      const screePatch = clamp((shape.mountainScreeSignal ?? 0) * 0.58 + rockPatch * 0.42, 0, 1);
      const alpinePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.031 + 557, z * 0.031 - 601, 2));
      const rockVariant = hashFloat(x + 91, z - 47, this.seed ^ 0x4d1f2);
      const trueCliff =
        steep >= 5 ||
        (steep >= 4 && (shape.cliffSignal > 0.28 || screePatch > 0.54)) ||
        (steep >= 3 && screePatch > 0.76 && (shape.mountainRibSignal ?? 0) > 0.38);
      const classicExtremeHills = isClassicExtremeHillsBiome(B, biomeId);
      const pickStoneVariant = (base) => {
        if (screePatch > 0.72) return rockVariant < 0.28 ? this.Block.ANDESITE : (rockVariant < 0.52 ? this.Block.GRAVEL : this.Block.GRANITE ?? base);
        if (screePatch > 0.56) return rockVariant < 0.35 ? this.Block.LIMESTONE ?? base : (rockVariant < 0.6 ? this.Block.SLATE ?? base : base);
        return base;
      };
      if (biomeId === B.MEADOW) {
        const flowerPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.044 + 271, z * 0.044 - 233, 2));
        if (steep >= 5 || screePatch > 0.84) {
          top = pickStoneVariant(this.Block.STONE);
          filler = this.Block.STONE;
        } else if (steep >= 3 && flowerPatch < 0.36) {
          top = this.Block.COARSE_DIRT;
          filler = this.Block.DIRT;
        } else {
          top = this.Block.MEADOW_GRASS;
          filler = this.Block.DIRT;
        }
      } else if (biomeId === B.GROVE) {
        if (trueCliff && elevation > 8) {
          top = pickStoneVariant(this.Block.STONE);
          filler = this.Block.STONE;
        } else if (screePatch > 0.74) {
          top = this.Block.GRAVEL;
          filler = this.Block.STONE;
        } else {
          top = elevation > 18 || temperature < 0.36 ? this.Block.SNOW : this.Block.SNOW_GRASS;
          filler = this.Block.DIRT;
        }
      } else if (biomeId === B.SNOWY_SLOPES) {
        if (
          (trueCliff && elevation > 12) ||
          screePatch > 0.68 ||
          (elevation > 28 && stonePatch > 0.62) ||
          (shape.mountainRibSignal ?? 0) > 0.58
        ) {
          top = pickStoneVariant(this.Block.STONE);
          filler = this.Block.STONE;
        } else if (screePatch > 0.54) {
          top = this.Block.GRAVEL;
          filler = this.Block.STONE;
        } else {
          const powderLikePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.067 - 719, z * 0.067 + 701, 2));
          top = powderLikePatch > 0.82 ? this.Block.SNOW_GRASS : this.Block.SNOW;
          filler = this.Block.SNOW;
        }
      } else if (biomeId === B.FROZEN_PEAKS) {
        if (trueCliff && screePatch > 0.58) {
          top = pickStoneVariant(this.Block.STONE);
          filler = this.Block.STONE;
        } else {
          const icePatch = normalizeNoise(this.detailNoise.fbm2(x * 0.043 + 881, z * 0.043 - 827, 2));
          top = icePatch > 0.52 ? this.Block.PACKED_ICE : this.Block.SNOW;
          filler = icePatch > 0.42 ? this.Block.PACKED_ICE : this.Block.SNOW;
        }
      } else if (biomeId === B.JAGGED_PEAKS) {
        if (trueCliff || screePatch > 0.42 || stonePatch > 0.56) {
          top = pickStoneVariant(this.Block.STONE);
          filler = this.Block.STONE;
          if (top === this.Block.STONE) {
            if (orePatch > 0.56 && oreScatter < 0.18) top = this.Block.COAL_ORE;
            else if (orePatch > 0.64 && elevation > 18 && oreScatter < 0.13) top = this.Block.IRON_ORE;
          }
        } else {
          top = this.Block.SNOW;
          filler = this.Block.STONE;
        }
      } else if (biomeId === B.STONY_PEAKS) {
        top = pickStoneVariant(stonePatch > 0.70 ? this.Block.ANDESITE : this.Block.STONE);
        filler = this.Block.STONE;
        if (top === this.Block.STONE && orePatch > 0.58 && oreScatter < 0.12) top = this.Block.COAL_ORE;
      } else if (classicExtremeHills) {
        const edge = biomeId === B.EXTREME_HILLS_EDGE;
        const mutated = biomeId === B.EXTREME_HILLS_M || biomeId === B.EXTREME_HILLS_PLUS_M;
        const plus = biomeId === B.EXTREME_HILLS_PLUS || biomeId === B.EXTREME_HILLS_PLUS_M;
        const rib = shape.mountainRibSignal ?? 0;
        const ruggedness = clamp(
          screePatch * 0.44 +
          stonePatch * 0.34 +
          rib * 0.24 +
          (shape.cliffSignal ?? 0) * 0.18,
          0,
          1,
        );
        const snowLine = temperature < 0.28 ? 22 : (temperature < 0.38 ? 34 : 52);
        const snowyShelf =
          !mutated &&
          elevation > snowLine &&
          alpinePatch > (edge ? 0.74 : 0.62) &&
          screePatch < 0.54;
        const stoneFace =
          trueCliff ||
          (elevation > (edge ? 22 : 14) && ruggedness > (plus ? 0.44 : (edge ? 0.58 : 0.50))) ||
          (mutated && elevation > 10 && ruggedness > 0.36) ||
          (elevation > 34 && stonePatch > 0.50) ||
          (elevation > 20 && steep >= 3 && stonePatch > 0.44);

        if (stoneFace) {
          top = pickStoneVariant(stonePatch > 0.72 ? this.Block.ANDESITE : this.Block.STONE);
          filler = this.Block.STONE;
          if (top === this.Block.STONE) {
            if (orePatch > 0.60 && oreScatter < 0.14) top = this.Block.COAL_ORE;
            else if (orePatch > 0.68 && elevation > 18 && oreScatter < 0.09) top = this.Block.IRON_ORE;
          }
        } else if (elevation > (edge ? 18 : 14) && screePatch > (mutated ? 0.54 : 0.64)) {
          top = screePatch > 0.72 ? this.Block.GRAVEL : (this.Block.COARSE_DIRT ?? this.Block.DIRT);
          filler = screePatch > 0.72 ? this.Block.STONE : this.Block.DIRT;
        } else if (snowyShelf) {
          top = this.Block.SNOW;
          filler = elevation > snowLine + 12 && screePatch > 0.42 ? this.Block.STONE : this.Block.SNOW;
        } else if (elevation > 12 && alpinePatch > 0.72 && !mutated) {
          top = alpinePatch > 0.86 ? this.Block.MOSS : this.Block.MEADOW_GRASS;
          filler = this.Block.DIRT;
        } else if (temperature < 0.30 && elevation > 18 && !plus) {
          top = this.Block.SNOW_GRASS;
          filler = this.Block.DIRT;
        } else if (mutated) {
          top = stonePatch > 0.50 ? pickStoneVariant(this.Block.STONE) : (this.Block.COARSE_DIRT ?? this.Block.DIRT);
          filler = stonePatch > 0.40 ? this.Block.STONE : this.Block.DIRT;
        } else if (edge && elevation < 16) {
          top = this.Block.GRASS;
          filler = this.Block.DIRT;
        }
      } else if ((elevation > 34 || (elevation > 22 && temperature < 0.38)) && !trueCliff) {
        // Snow cap: keep snowy shelves snowy. This avoids grid-like stone
        // bands where moderate interpolation steps cross an otherwise flat cap.
        top = screePatch > 0.68 ? this.Block.GRAVEL : this.Block.SNOW;
        filler = screePatch > 0.78 ? this.Block.STONE : this.Block.SNOW;
      } else if (trueCliff && elevation > 8) {
        // Steep cliff faces: exposed stone with ore scatter, richer variety
        top = pickStoneVariant(this.Block.STONE);
        filler = this.Block.STONE;
        if (top === this.Block.STONE) {
          if (orePatch > 0.58 && oreScatter < 0.16) top = this.Block.COAL_ORE;
          else if (orePatch > 0.66 && elevation > 14 && oreScatter < 0.11) top = this.Block.IRON_ORE;
        }
      } else if ((elevation > 24 && screePatch > 0.44) || (shape.mountainSignal > 0.68 && screePatch > 0.50) || (elevation > 16 && screePatch > 0.80)) {
        // Upper rocky zone: exposed stone, occasional ore scatter
        top = pickStoneVariant(this.Block.STONE);
        filler = this.Block.STONE;
        if (top === this.Block.STONE) {
          if (orePatch > 0.60 && oreScatter < 0.13) top = this.Block.COAL_ORE;
          else if (orePatch > 0.68 && elevation > 18 && oreScatter < 0.08) top = this.Block.IRON_ORE;
        }
      } else if (elevation > 14 && (stonePatch > 0.44 || screePatch > 0.52)) {
        // Mid-elevation rocky patches with coarse transitions
        top = pickStoneVariant(this.Block.STONE);
        filler = this.Block.STONE;
        if (top === this.Block.STONE && orePatch > 0.63 && oreScatter < 0.11) top = this.Block.COAL_ORE;
      } else if (elevation > 10 && alpinePatch > 0.70 && steep <= 2) {
        top = alpinePatch > 0.84 ? this.Block.MOSS : this.Block.MEADOW_GRASS;
        filler = this.Block.DIRT;
      } else if (elevation > 10 && (stonePatch > 0.60 || screePatch > 0.42)) {
        top = screePatch > 0.55 ? this.Block.GRAVEL : (this.Block.COARSE_DIRT ?? this.Block.DIRT);
        filler = this.Block.DIRT;
      } else if (temperature < 0.32 && elevation > 18) {
        // Cold lower slopes: snow grass before the snowline
        top = this.Block.SNOW_GRASS;
        filler = this.Block.DIRT;
      }
      // else: keep biome's default grass surface
    } else if (isJungleBiome(B, biomeId)) {
      // Jungle: lush grass dominates; mud appears only in wet bank pockets.
      const jungleMud = normalizeNoise(this.detailNoise.fbm2(x * 0.038 + 317, z * 0.038 - 241, 3));
      const elevation = height - this.seaLevel;
      const wetBank = this.nearNaturalWater(x, z, height) || this.shouldFillWaterAt(x, z, height);
      if (steep >= 4) {
        top = this.Block.STONE;
        filler = this.Block.STONE;
      } else if (wetBank && elevation <= 2 && jungleMud > 0.68) {
        // Near-water jungle banks: clay/mud
        top = this.Block.CLAY;
        filler = this.Block.CLAY;
      } else if (wetBank && elevation <= 3 && jungleMud > 0.58) {
        top = this.Block.MUD ?? this.Block.DIRT;
        filler = this.Block.MUD ?? this.Block.DIRT;
      } else if (steep >= 3 && jungleMud > 0.72) {
        top = this.Block.COARSE_DIRT ?? this.Block.DIRT;
        filler = this.Block.DIRT;
      }
      // else: default JUNGLE_GRASS from biome definition
    } else if (isSnowyBiome(B, biomeId)) {
      top = biome.surface;
      filler = biome.filler;
      // Snow cap starts lower (seaLevel+18) so cold highlands always look snowy
      if (height - this.seaLevel > 18 && steep <= 4) {
        top = this.Block.SNOW;
      }
      // Steep snowy slopes expose stone
      if (steep >= 4) {
        top = this.Block.STONE;
        filler = this.Block.STONE;
      }
    }

    // Submerged land: grass-type surface below water level looks bad through water.
    // Replace it only when the column is actually wet, so dry inland basins keep
    // their biome surface instead of turning into stray clay patches.
    if (height < this.waterLevel && this.shouldFillWaterAt(x, z, height) && !isOceanBiome(B, biomeId) &&
        biomeId !== B.RIVER && biomeId !== B.FROZEN_RIVER && !isSwampBiome(B, biomeId)) {
      const grassLike = (
        top === this.Block.GRASS || top === this.Block.SNOW_GRASS ||
        top === this.Block.JUNGLE_GRASS || top === this.Block.DRY_GRASS ||
        top === this.Block.SAVANNA_GRASS || top === this.Block.MEADOW_GRASS ||
        top === this.Block.PODZOL || top === this.Block.MYCELIUM ||
        top === this.Block.SNOW || top === this.Block.COARSE_DIRT
      );
      if (grassLike) {
        top = gravelPatch > 0.52 ? this.Block.GRAVEL : this.Block.CLAY;
        filler = this.Block.GRAVEL;
      }
    }

    // Clay is a submerged floor material. Keep exposed banks on their biome's
    // ordinary grass/dirt (or gravel for ocean biomes) surface.
    if (top === this.Block.CLAY && !this.shouldFillWaterAt(x, z, height)) {
      if (isOceanBiome(B, biomeId) || isRiverBiome(B, biomeId)) {
        top = this.Block.GRAVEL;
        filler = this.Block.GRAVEL;
      } else {
        top = this.Block.GRASS;
        filler = this.Block.DIRT;
      }
    }

    top = this.legacyTerrainBlock(top);
    filler = this.legacyTerrainBlock(filler);

    const surface = { top, filler };
    this.surfaceBlockCache.set(`${columnKey(x, z)},${biomeId}`, surface);
    return surface;
  }

  caveDensityAt(x, y, z, surfaceHeight) {
    if (surfaceHeight > this.seaLevel + 2 && y >= surfaceHeight - 46) {
      const mouth = this.surfaceCaveTunnelStrength(x, y, z, surfaceHeight);
      if (mouth > 0.14) return -mouth;
    }

    if (y <= 4 || y >= surfaceHeight - 6) return 1;

    const deepBias = clamp((surfaceHeight - y) / Math.max(1, surfaceHeight - 6), 0, 1);
    const cavernDensity = this.cheeseCavernDensityAt(x, y, z, surfaceHeight, deepBias);
    const tunnelDensity = this.undergroundTunnelDensityAt(x, y, z, surfaceHeight, deepBias);
    const noodleDensity = this.noodleTunnelDensityAt(x, y, z, surfaceHeight, deepBias);
    const ravineDensity = this.isRavineAt(x, y, z, surfaceHeight) ? -0.65 : 1;
    let density = Math.min(cavernDensity, tunnelDensity, noodleDensity, ravineDensity);
    if (density <= 0) {
      const pillarStrength = this.cavePillarStrengthAt(x, y, z, surfaceHeight);
      if (pillarStrength > 0.56) density = Math.max(density, (pillarStrength - 0.56) * 1.8);
    }

    if (y > this.seaLevel - 2 && density > -0.24) return 1;
    return density;
  }

  isCaveAt(x, y, z, surfaceHeight) {
    return this.caveDensityAt(x, y, z, surfaceHeight) <= 0;
  }

  cheeseCavernDensityAt(x, y, z, surfaceHeight, deepBias) {
    const cellXSize = 116;
    const cellYSize = 48;
    const cellZSize = 116;
    const cellX = Math.floor(x / cellXSize);
    const cellY = Math.floor(y / cellYSize);
    const cellZ = Math.floor(z / cellZSize);
    let density = 1;

    for (let oz = -1; oz <= 1; oz += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = cellX + ox;
          const cy = cellY + oy;
          const cz = cellZ + oz;
          const chance = this.caveCellHash(cx, cy, cz, 0xc4a11);
          if (chance > 0.07 + deepBias * 0.17) continue;

          const centerX = cx * cellXSize + 18 + this.caveCellHash(cx, cy, cz, 0xc4a12) * (cellXSize - 36);
          const centerY = cy * cellYSize + 10 + this.caveCellHash(cx, cy, cz, 0xc4a13) * (cellYSize - 20);
          const centerZ = cz * cellZSize + 18 + this.caveCellHash(cx, cy, cz, 0xc4a14) * (cellZSize - 36);
          if (centerY < 8 || centerY > this.worldHeight - 22 || centerY > surfaceHeight - 16) continue;

          const radiusX = 7 + this.caveCellHash(cx, cy, cz, 0xc4a15) * 12;
          const radiusY = 3.5 + this.caveCellHash(cx, cy, cz, 0xc4a16) * 7.5;
          const radiusZ = 7 + this.caveCellHash(cx, cy, cz, 0xc4a17) * 12;
          const dx = x - centerX;
          const dy = y - centerY;
          const dz = z - centerZ;
          if (Math.abs(dx) > radiusX + 7 || Math.abs(dy) > radiusY + 4 || Math.abs(dz) > radiusZ + 7) continue;

          const warpX = sample3(this.caveCheeseNoise, x + centerX * 0.19, y, z - centerZ * 0.19, 0.04, 2) * 3.0;
          const warpY = sample3(this.caveCheeseNoise, x - centerZ * 0.11, y + centerY * 0.07, z, 0.056, 2) * 1.35;
          const warpZ = sample3(this.caveCheeseNoise, x - centerX * 0.17, y, z + centerZ * 0.17, 0.04, 2) * 3.0;
          const distance =
            ((dx + warpX) / radiusX) ** 2 +
            ((dy + warpY) / radiusY) ** 2 +
            ((dz + warpZ) / radiusZ) ** 2;
          const wallNoise =
            sample3(this.caveCheeseNoise, x + centerX * 0.13, y, z - centerZ * 0.13, 0.046, 3) * 0.16 +
            sample3(this.spaghettiNoise, x - centerX * 0.09, y, z + centerZ * 0.09, 0.086, 1) * 0.06;
          density = Math.min(density, distance - (0.93 + wallNoise));
        }
      }
    }

    return density;
  }

  cavePillarStrengthAt(x, y, z, surfaceHeight) {
    if (y < 10 || y > surfaceHeight - 10) return 0;
    const verticalMask = smoothstep(10, 28, y) * (1 - smoothstep(surfaceHeight - 34, surfaceHeight - 9, y));
    if (verticalMask <= 0) return 0;

    const columnField = Math.abs(sample3(this.spaghettiNoise, x + 73, y * 0.45, z - 41, 0.052, 2));
    const narrowColumn = 1 - smoothstep(0.018, 0.072, columnField);
    if (narrowColumn <= 0) return 0;

    const pocket = normalizeNoise(sample3(this.caveCheeseNoise, x - 113, y + 29, z + 157, 0.024, 2));
    const brokenTop = normalizeNoise(sample3(this.noodleNoise, x + 11, y - 7, z - 19, 0.085, 1));
    return clamp(narrowColumn * verticalMask * smoothstep(0.34, 0.72, pocket) * lerp(0.65, 1, brokenTop), 0, 1);
  }

  undergroundTunnelDensityAt(x, y, z, surfaceHeight, deepBias) {
    const cellSize = 96;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let density = 1;

    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const cx = cellX + ox;
        const cz = cellZ + oz;
        const wormCount = hashFloat(cx, cz, this.seed ^ 0x5a90) > 0.72 ? 2 : 1;

        for (let worm = 0; worm < wormCount; worm += 1) {
          const saltX = cx + worm * 23;
          const saltZ = cz - worm * 31;
          const chance = hashFloat(saltX, saltZ, this.seed ^ 0x5a97);
          if (chance > 0.68 + deepBias * 0.13) continue;

          const startX = cx * cellSize + 12 + hashFloat(saltX, saltZ, this.seed ^ 0x5a98) * (cellSize - 24);
          const startZ = cz * cellSize + 12 + hashFloat(saltX, saltZ, this.seed ^ 0x5a99) * (cellSize - 24);
          const angle = hashFloat(saltX, saltZ, this.seed ^ 0x5a9a) * Math.PI * 2;
          const dirX = Math.cos(angle);
          const dirZ = Math.sin(angle);
          const sideX = -dirZ;
          const sideZ = dirX;
          const length = 78 + hashFloat(saltX, saltZ, this.seed ^ 0x5a9b) * 138;
          const relX = x - startX;
          const relZ = z - startZ;
          const along = relX * dirX + relZ * dirZ;
          const sideProbe = relX * sideX + relZ * sideZ;
          const maxDrift = 18 + hashFloat(saltX, saltZ, this.seed ^ 0x5aa5) * 12;
          if (along < -maxDrift || along > length + maxDrift || Math.abs(sideProbe) > maxDrift + 9) continue;

          const maxTunnelY = Math.max(18, Math.min(surfaceHeight - 17, this.seaLevel + 56));
          if (maxTunnelY <= 13) continue;

          const startY = 10 + hashFloat(saltX, saltZ, this.seed ^ 0x5a9c) * (maxTunnelY - 10);
          const slope = (hashFloat(saltX, saltZ, this.seed ^ 0x5a9d) - 0.5) * 0.18;
          const phase = hashFloat(saltX, saltZ, this.seed ^ 0x5aa0) * Math.PI * 2;
          const wobbleScale = 5.5 + hashFloat(saltX, saltZ, this.seed ^ 0x5a9e) * 8.5;
          const tEstimate = clamp(along / length, 0, 1);

          for (let sample = -2; sample <= 2; sample += 1) {
            const t = clamp(tEstimate + sample * 0.055, 0, 1);
            const path = length * t;
            const turnNoise = this.spaghettiNoise.fbm2(
              saltX * 0.21 + t * 3.7 + worm * 5.3,
              saltZ * 0.21 - t * 3.1 - worm * 4.7,
              2,
              2,
              0.52,
            );
            const heightNoise = this.noodleNoise.fbm2(
              saltX * 0.17 - t * 2.9 + worm * 2.1,
              saltZ * 0.17 + t * 3.3 - worm * 1.7,
              2,
              2,
              0.5,
            );
            const sideOffset =
              Math.sin(t * Math.PI * (2.1 + hashFloat(saltX, saltZ, this.seed ^ 0x5aa6) * 2.4) + phase) * wobbleScale +
              turnNoise * (8 + deepBias * 3);
            const centerX = startX + dirX * path + sideX * sideOffset;
            const centerZ = startZ + dirZ * path + sideZ * sideOffset;
            const centerY =
              startY +
              (path - length * 0.5) * slope +
              Math.sin(t * Math.PI * (2.4 + hashFloat(saltX, saltZ, this.seed ^ 0x5aa7) * 2.2) + phase * 0.73) * (2.5 + deepBias * 4.5) +
              heightNoise * 3.2;
            if (centerY < 7 || centerY > surfaceHeight - 8) continue;

            const endFade = smoothstep(0.02, 0.13, t) * (1 - smoothstep(0.86, 0.99, t));
            if (endFade <= 0) continue;

            const branch =
              Math.max(0, Math.sin(t * Math.PI * (4.5 + hashFloat(saltX, saltZ, this.seed ^ 0x5aa2) * 3.5) + phase * 1.41)) *
              smoothstep(0.2, 0.5, t) *
              (1 - smoothstep(0.72, 0.94, t));
            const widthNoise = this.caveCheeseNoise.fbm2(x * 0.051 + y * 0.013, z * 0.051 - y * 0.017, 2);
            const radius = (1.55 + hashFloat(saltX, saltZ, this.seed ^ 0x5aa1) * 2.45 + branch * 0.75 + widthNoise * 0.28) * lerp(0.96, 1.18, deepBias);
            const dx = x - centerX;
            const dz = z - centerZ;
            const vertical = Math.abs(y - centerY) * (1.3 + hashFloat(saltX, saltZ, this.seed ^ 0x5aa4) * 0.18);
            const tunnelDistance = Math.sqrt(dx * dx + dz * dz + vertical * vertical);
            density = Math.min(density, tunnelDistance - radius * endFade);
          }
        }
      }
    }

    return density;
  }

  noodleTunnelDensityAt(x, y, z, surfaceHeight, deepBias) {
    const mcY = this.minecraftY(y);
    if (mcY < MINECRAFT_NOODLE_MIN_Y || mcY > MINECRAFT_NOODLE_MAX_Y || deepBias < 0.2) return 1;

    const cellSize = 88;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let density = 1;

    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const cx = cellX + ox;
        const cz = cellZ + oz;
        if (hashFloat(cx, cz, this.seed ^ 0x00d1e2) > 0.18) continue;

        const startX = cx * cellSize + 12 + hashFloat(cx, cz, this.seed ^ 0x00d1e3) * (cellSize - 24);
        const startZ = cz * cellSize + 12 + hashFloat(cx, cz, this.seed ^ 0x00d1e4) * (cellSize - 24);
        const angle = hashFloat(cx, cz, this.seed ^ 0x00d1e5) * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirZ = Math.sin(angle);
        const sideX = -dirZ;
        const sideZ = dirX;
        const length = 40 + hashFloat(cx, cz, this.seed ^ 0x00d1e6) * 58;
        const relX = x - startX;
        const relZ = z - startZ;
        const along = relX * dirX + relZ * dirZ;
        if (along < 0 || along > length) continue;

        const startY = 10 + hashFloat(cx, cz, this.seed ^ 0x00d1e7) * Math.max(8, Math.min(surfaceHeight - 26, this.seaLevel + 18));
        const targetY = startY + Math.sin(along * 0.075 + hashFloat(cx, cz, this.seed ^ 0x00d1e8) * Math.PI * 2) * 4;
        const across = Math.abs(relX * sideX + relZ * sideZ);
        const vertical = Math.abs(y - targetY) * 1.6;
        const endFade = smoothstep(0, 10, along) * (1 - smoothstep(length - 12, length, along));
        const radius = lerp(0.75, 1.25, deepBias) * endFade;
        density = Math.min(density, Math.sqrt(across * across + vertical * vertical) - radius);
      }
    }

    return density;
  }

  surfaceCaveMouthStrength(x, z, surfaceHeight) {
    return this.surfaceCaveTunnelStrength(x, surfaceHeight, z, surfaceHeight);
  }

  surfaceCaveTunnelStrength(x, y, z, surfaceHeight) {
    const cellSize = 52;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    const climate = this.climateAt(x, z);
    const mountainBias = surfaceHeight > this.seaLevel + 16 ? 0.1 : 0;
    const inlandBias = climate.continentalness > 0.54 ? 0.06 : 0;
    const chance = 0.66 + mountainBias + inlandBias;
    if (hashFloat(cellX, cellZ, this.seed ^ 0xc0a11) > chance) return 0;

    const startX = cellX * cellSize + 12 + hashFloat(cellX, cellZ, this.seed ^ 0xc0a12) * (cellSize - 24);
    const startZ = cellZ * cellSize + 12 + hashFloat(cellX, cellZ, this.seed ^ 0xc0a13) * (cellSize - 24);
    const angle = hashFloat(cellX, cellZ, this.seed ^ 0xc0a14) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const relX = x - startX;
    const relZ = z - startZ;
    const along = relX * dirX + relZ * dirZ;
    if (along < -5 || along > 58) return 0;

    const across = Math.abs(relX * sideX + relZ * sideZ);
    const width = 3.7 + smoothstep(0, 18, along) * 3.1;
    const wobble = Math.sin(along * 0.23 + hashFloat(cellX, cellZ, this.seed ^ 0xc0a15) * Math.PI * 2);
    const targetY = surfaceHeight - 0.25 - Math.max(0, along) * 0.46 - wobble * 1.15;
    const verticalRadius = 2.2 + smoothstep(6, 34, along) * 1.8;
    const horizontal = 1 - smoothstep(width * 0.55, width, across);
    const vertical = 1 - smoothstep(verticalRadius * 0.55, verticalRadius, Math.abs(y - targetY));
    const lengthFade = smoothstep(-3, 6, along) * (1 - smoothstep(50, 58, along));
    return clamp(horizontal * vertical * lengthFade, 0, 1);
  }

  isRavineAt(x, y, z, surfaceHeight) {
    const cellSize = 96;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    if (hashFloat(cellX, cellZ, this.seed ^ 0xca107) > 0.052) return false;

    const centerX = cellX * cellSize + 20 + hashFloat(cellX, cellZ, this.seed ^ 0xca108) * (cellSize - 40);
    const centerZ = cellZ * cellSize + 20 + hashFloat(cellX, cellZ, this.seed ^ 0xca109) * (cellSize - 40);
    const angle = hashFloat(cellX, cellZ, this.seed ^ 0xca10a) * Math.PI;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const relX = x - centerX;
    const relZ = z - centerZ;
    const along = relX * dirX + relZ * dirZ;
    const length = 58 + hashFloat(cellX, cellZ, this.seed ^ 0xca10b) * 72;
    if (Math.abs(along) > length) return false;

    const ravineY = Math.min(surfaceHeight - 24, 14 + hashFloat(cellX, cellZ, this.seed ^ 0xca10c) * (this.seaLevel + 22));
    const phase = hashFloat(cellX, cellZ, this.seed ^ 0xca10d) * Math.PI * 2;
    const t = (along + length) / (length * 2);
    const bend =
      Math.sin(t * Math.PI * (2.4 + hashFloat(cellX, cellZ, this.seed ^ 0xca10e) * 1.4) + phase) * 5.5 +
      this.spaghettiNoise.fbm2(cellX * 0.3 + t * 2.8, cellZ * 0.3 - t * 2.1, 2) * 4.5;
    const across = Math.abs(relX * sideX + relZ * sideZ - bend);
    const centerY =
      ravineY +
      Math.sin(t * Math.PI * 2.2 + phase * 0.6) * 2.2 +
      this.caveCheeseNoise.fbm2(cellX * 0.2 + t * 2.5, cellZ * 0.2 + t * 1.9, 2) * 2.5;
    const vertical = Math.abs(y - centerY) / 14.5;
    const width = (2.5 + Math.sin(t * Math.PI) * 5.8) * (1 - vertical * 0.56);
    return across < width && vertical < 1 && y < surfaceHeight - 8;
  }

  aquiferBlockAt(x, y, z, surfaceHeight) {
    if (y <= 4) return this.Block.STONE;
    if (y > Math.min(surfaceHeight - 16, this.seaLevel - 8)) return this.Block.AIR;

    const cellSize = 64;
    const cellYSize = 24;
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellYSize);
    const cellZ = Math.floor(z / cellSize);
    const aquiferChance = hashFloat(cellX, cellZ + cellY * 19, this.seed ^ 0xa91fe2);
    if (aquiferChance > 0.46) return this.Block.AIR;

    const fluidNoise = normalizeNoise(sample3(this.aquiferNoise, x + cellX * 17, y, z - cellZ * 13, 0.016, 2));
    const fluidLevel = Math.min(this.seaLevel - 8, 12 + Math.floor(fluidNoise * 34));
    if (y > fluidLevel) return this.Block.AIR;

    const floodedness = normalizeNoise(sample3(this.aquiferNoise, x - 37, y + 19, z + 23, 0.048, 2));
    const barrier = Math.abs(sample3(this.spaghettiNoise, x + 61, y - 43, z + 11, 0.06, 2));
    const lavaBlock = this.Block.EXTRA_LAVA ?? null;
    if (lavaBlock && this.minecraft118Y(y) < -24) {
      const lavaPocket = normalizeNoise(sample3(this.aquiferNoise, x + 211, y - 97, z - 149, 0.033, 2));
      const lavaDepth = smoothstep(-8, -48, this.minecraft118Y(y));
      if (floodedness > 0.6 && barrier > 0.1 && lavaPocket > lerp(0.84, 0.68, lavaDepth)) {
        return lavaBlock;
      }
    }
    if (floodedness > 0.55 && barrier > 0.08) return this.Block.WATER;
    return this.Block.AIR;
  }

  isNaturalWaterColumn(shape, height) {
    if (height > this.waterLevel) return false;
    if (shape.continentalness < 0.44) return true;
    if (height <= this.waterLevel - 1 && shape.continentalness < 0.50) return true;
    if (
      height <= this.waterLevel - 1 &&
      shape.continentalness < 0.53 &&
      shape.erosion > 0.56 &&
      (shape.riverBank ?? shape.river) > 0.18 &&
      shape.mountainSignal < 0.30
    ) {
      return true;
    }
    if (height <= this.waterLevel - 8 && shape.continentalness < 0.56 && shape.erosion > 0.58) return true;
    if (
      height <= this.waterLevel - 1 &&
      (shape.riverBank ?? shape.river) > 0.32 &&
      shape.erosion > 0.46 &&
      shape.continentalness > 0.44 &&
      shape.continentalness < 0.78 &&
      shape.mountainSignal < 0.36
    ) {
      return true;
    }
    if (
      shape.river > 0.56 &&
      shape.erosion > 0.46 &&
      shape.continentalness > 0.44 &&
      shape.continentalness < 0.78 &&
      shape.mountainSignal < 0.32
    ) {
      return true;
    }
    return false;
  }

  shouldFillWaterAt(x, z, height) {
    const key = columnKey(x, z) * 512 + (height & 0x1FF);
    const cached = this.waterFillCache.get(key);
    if (cached !== undefined) return cached;

    const shape = this.terrainShapeAt(x, z);
    const rawHeight = Math.floor(this.rawTerrainHeight(x, z));
    const biomeId = this.biomeAt(x, z);
    if (height < this.waterLevel) {
      this.waterFillCache.set(key, true);
      return true;
    }
    if ((isOceanBiome(this.Biome, biomeId) || isRiverBiome(this.Biome, biomeId)) && height <= this.waterLevel) {
      this.waterFillCache.set(key, true);
      return true;
    }
    if (this.riverChannelAt(x, z, shape).isRiverColumn) {
      this.waterFillCache.set(key, true);
      return true;
    }
    if (
      height <= this.waterLevel - 1 &&
      shape.river > 0.62 &&
      shape.erosion > 0.46 &&
      shape.continentalness > 0.44 &&
      shape.continentalness < 0.78 &&
      shape.mountainSignal < 0.36
    ) {
      this.waterFillCache.set(key, true);
      return true;
    }
    if (isSwampBiome(this.Biome, biomeId)) {
      if (height <= this.waterLevel - 1) {
        this.waterFillCache.set(key, true);
        return true;
      }
      if (height <= this.waterLevel) {
        const swampWet = normalizeNoise(this.detailNoise.fbm2(x * 0.028 + 71, z * 0.028 - 83, 3));
        const wet = swampWet < 0.40;
        this.waterFillCache.set(key, wet);
        return wet;
      }
      this.waterFillCache.set(key, false);
      return false;
    }
    if (height > this.waterLevel + 1) {
      this.waterFillCache.set(key, false);
      return false;
    }
    if (height > this.waterLevel && rawHeight > this.waterLevel) return false;
    const fillsWater = this.isNaturalWaterColumn(shape, height);
    this.waterFillCache.set(key, fillsWater);
    return fillsWater;
  }

  localSteepnessAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.steepnessCache.get(key);
    if (cached !== undefined) return cached;

    const center = this.terrainHeight(x, z);
    const steepness = Math.max(
      Math.abs(center - this.terrainHeight(x + 1, z)),
      Math.abs(center - this.terrainHeight(x - 1, z)),
      Math.abs(center - this.terrainHeight(x, z + 1)),
      Math.abs(center - this.terrainHeight(x, z - 1)),
    );
    this.steepnessCache.set(key, steepness);
    return steepness;
  }

  vegetationRoughnessAt(x, z) {
    const shape = this.terrainShapeAt(x, z);
    return (
      shape.mountainSignal * 2.75 +
      (1 - shape.erosion) * 0.95 +
      smoothstep(0.62, 0.92, shape.rangeNoise) * 0.7 +
      (shape.riverBank ?? shape.river) * 0.56
    );
  }

  treeTypeAt(x, z) {
    const key = columnKey(x, z);
    if (this.treeCache.has(key)) return this.treeCache.get(key);

    const groundY = this.terrainHeight(x, z);
    const biomeId = this.biomeAt(x, z);
    const swamp = isSwampBiome(this.Biome, biomeId);
    if ((!swamp && groundY < this.seaLevel) || (swamp && groundY < this.waterLevel - 2) || groundY >= this.worldHeight - 12) {
      this.treeCache.set(key, null);
      return null;
    }
    const biome = this.BIOMES[biomeId] ?? this.BIOMES[this.Biome.FOREST];
    if (!biome.tree) {
      this.treeCache.set(key, null);
      return null;
    }
    if (this.vegetationRoughnessAt(x, z) > 2.8) {
      this.treeCache.set(key, null);
      return null;
    }
    const forest = normalizeNoise(this.treeNoise.fbm2(x * 0.007 + 13, z * 0.007 - 11, 4));
    const heightComfort = swamp ? smoothstep(this.waterLevel - 2, this.waterLevel + 3, groundY) : smoothstep(this.seaLevel, this.seaLevel + 5, groundY);
    const threshold = biome.forestThreshold - heightComfort * 0.035;
    const chance = biome.treeChance * lerp(swamp ? 0.92 : 0.78, 1.18, heightComfort);
    let tree = forest >= threshold && hashFloat(x, z, this.seed ^ 0x51f15e) < chance ? biome.tree : null;
    if (biomeId === this.Biome.MEADOW && tree) {
      tree = hashFloat(x + 17, z - 29, this.seed ^ 0xbe35) < 0.45 ? "birch" : "oak";
    }
    this.treeCache.set(key, tree);
    return tree;
  }

  shouldGrowCactus(x, z) {
    const key = columnKey(x, z);
    const cached = this.cactusCache.get(key);
    if (cached !== undefined) return cached;

    const groundY = this.terrainHeight(x, z);
    if (groundY <= this.seaLevel || groundY >= this.worldHeight - 8) {
      this.cactusCache.set(key, false);
      return false;
    }
    if (this.vegetationRoughnessAt(x, z) > 1.8) {
      this.cactusCache.set(key, false);
      return false;
    }
    const biomeId = this.biomeAt(x, z);
    const grows =
      (isDesertBiome(this.Biome, biomeId) || isMesaBiome(this.Biome, biomeId)) &&
      hashFloat(x + 1, z, this.seed ^ 0x8f1) >= 0.5 &&
      hashFloat(x, z + 1, this.seed ^ 0x8f2) >= 0.5 &&
      hashFloat(x, z, this.seed ^ 0xcacc7) < (isDesertBiome(this.Biome, biomeId) ? 0.024 : 0.008);
    this.cactusCache.set(key, grows);
    return grows;
  }

  rockTypeAt(x, z) {
    const key = columnKey(x, z);
    if (this.rockCache.has(key)) return this.rockCache.get(key);

    const groundY = this.terrainHeight(x, z);
    if (groundY <= this.seaLevel + 1 || groundY >= this.worldHeight - 8) {
      this.rockCache.set(key, null);
      return null;
    }
    const biomeId = this.biomeAt(x, z);
    const mountainBiome = isMountainBiome(this.Biome, biomeId) || biomeId === this.Biome.ICE_MOUNTAINS;
    if (!mountainBiome && this.vegetationRoughnessAt(x, z) > 2.15) {
      this.rockCache.set(key, null);
      return null;
    }
    const scatter = hashFloat(x, z, this.seed ^ 0xb01d);
    const patch = normalizeNoise(this.detailNoise.fbm2(x * 0.026 + 45, z * 0.026 - 37, 2));
    const shape = this.terrainShapeAt(x, z);

    let rock = null;
    if (mountainBiome && groundY > this.seaLevel + 10 && patch + (shape.mountainScreeSignal ?? 0) * 0.45 > 0.78 && scatter < 0.018) {
      const variant = hashFloat(x + 41, z - 59, this.seed ^ 0xb01f);
      rock = variant < 0.34 ? this.Block.ANDESITE : (variant < 0.62 ? this.Block.GRANITE : this.Block.COBBLESTONE);
    } else if (isSavannaBiome(this.Biome, biomeId) && patch > 0.62 && scatter < 0.02) rock = this.Block.LIMESTONE;
    else if ((biomeId === this.Biome.FLOWER_FOREST || biomeId === this.Biome.SUNFLOWER_PLAINS) && patch > 0.68 && scatter < 0.012) rock = this.Block.MOSS;
    else if ((biomeId === this.Biome.FOREST || biomeId === this.Biome.FOREST_HILLS) && patch > 0.72 && scatter < 0.009) rock = this.Block.COBBLESTONE;
    else if (isMesaBiome(this.Biome, biomeId) && patch > 0.64 && scatter < 0.014) rock = this.Block.TERRACOTTA;
    rock = this.legacyTerrainBlock(rock);
    this.rockCache.set(key, rock);
    return rock;
  }

  plantTypeAt(x, z) {
    const key = columnKey(x, z);
    if (this.plantCache.has(key)) return this.plantCache.get(key);

    const groundY = this.terrainHeight(x, z);
    const biomeId = this.biomeAt(x, z);
    if (isSwampBiome(this.Biome, biomeId) && this.shouldFillWaterAt(x, z, groundY)) {
      const lilyField = normalizeNoise(this.detailNoise.fbm2(x * 0.044 + 301, z * 0.044 - 229, 2));
      const clearWater = hashFloat(x + 1, z, this.seed ^ 0x71c0) > 0.18 &&
        hashFloat(x - 1, z, this.seed ^ 0x71c1) > 0.18 &&
        hashFloat(x, z + 1, this.seed ^ 0x71c2) > 0.18 &&
        hashFloat(x, z - 1, this.seed ^ 0x71c3) > 0.18;
      const lilyChance = biomeId === this.Biome.SWAMPLAND_M ? 0.3 : 0.38;
      const lilyRoll = hashFloat(x, z, this.seed ^ 0x71c4);
      const hasWaterSurface = groundY <= this.waterLevel - 1;
      const notTooDeep = groundY >= this.waterLevel - 4;
      if (hasWaterSurface && notTooDeep && clearWater && lilyField > 0.3 && lilyRoll < lilyChance) {
        this.plantCache.set(key, "waterlily");
        return "waterlily";
      }
      return this.cachePlantType(key, null);
    }
    if (groundY < this.seaLevel || groundY >= this.worldHeight - 8) {
      return this.cachePlantType(key, null);
    }
    const scatter = hashFloat(x, z, this.seed ^ 0xf10a);
    const field = normalizeNoise(this.treeNoise.fbm2(x * 0.03 - 5, z * 0.03 + 9, 3));
    if (biomeId === this.Biome.MEADOW) {
      if (this.localSteepnessAt(x, z) > 3 || field < 0.30 || scatter > 0.58) {
        return this.cachePlantType(key, null);
      }
      const flower = hashFloat(x, z, this.seed ^ 0xf12d);
      let meadowPlant = "tall_grass";
      if (flower < 0.18) meadowPlant = "dandelion";
      else if (flower < 0.36) meadowPlant = "poppy";
      else if (flower < 0.54) meadowPlant = "wildflower";
      else if (flower < 0.68) meadowPlant = "clover";
      return this.cachePlantType(key, meadowPlant);
    }
    const mountainBiome = isMountainBiome(this.Biome, biomeId);
    if (this.vegetationRoughnessAt(x, z) > (mountainBiome ? 2.55 : 1.95)) {
      return this.cachePlantType(key, null);
    }
    if (mountainBiome || biomeId === this.Biome.ICE_SPIKES) {
      const elevation = groundY - this.seaLevel;
      if (
        biomeId !== this.Biome.ICE_SPIKES &&
        elevation <= 24 &&
        this.localSteepnessAt(x, z) <= 2 &&
        field > 0.50 &&
        scatter < (biomeId === this.Biome.EXTREME_HILLS_PLUS || biomeId === this.Biome.EXTREME_HILLS_EDGE ? 0.10 : 0.055)
      ) {
        const alpinePlant = hashFloat(x + 17, z - 23, this.seed ^ 0xf114);
        const plant = alpinePlant < 0.42 ? "fern" : "tall_grass";
        return this.cachePlantType(key, plant);
      }
      return this.cachePlantType(key, null);
    }
    if (biomeId === this.Biome.ICE_PLAINS || biomeId === this.Biome.ICE_MOUNTAINS) {
      return this.cachePlantType(key, null);
    }
    if (isOceanBiome(this.Biome, biomeId) || isRiverBiome(this.Biome, biomeId)) {
      return this.cachePlantType(key, null);
    }
    if (biomeId === this.Biome.BEACH || biomeId === this.Biome.COLD_BEACH || biomeId === this.Biome.STONE_BEACH) {
      return this.cachePlantType(key, null);
    }
    let plant = null;
    if (isDesertBiome(this.Biome, biomeId) || isMesaBiome(this.Biome, biomeId)) {
      if (field > 0.35 && scatter < 0.07) plant = "dead_bush";
      else if (this.nearNaturalWater(x, z, groundY) && scatter < 0.09) plant = "sugar_cane";
      return this.cachePlantType(key, plant);
    }
    if (isTaigaBiome(this.Biome, biomeId) && field > 0.42 && scatter < 0.045) plant = "berry_bush";
    else if ((biomeId === this.Biome.MUSHROOM_ISLAND || biomeId === this.Biome.MUSHROOM_SHORE || biomeId === this.Biome.ROOFED_FOREST || biomeId === this.Biome.ROOFED_FOREST_M) && scatter < 0.12) {
      plant = hashFloat(x, z, this.seed ^ 0xf113) < 0.46 ? "red_mushroom" : "brown_mushroom";
    }
    else if (!isSavannaBiome(this.Biome, biomeId) && this.nearNaturalWater(x, z, groundY) && scatter < 0.09) plant = "sugar_cane";
    if (plant) {
      return this.cachePlantType(key, plant);
    }
    if (isSwampBiome(this.Biome, biomeId)) {
      const bogPatch = normalizeNoise(this.detailNoise.fbm2(x * 0.037 + 173, z * 0.037 - 119, 2));
      if (this.nearNaturalWater(x, z, groundY) && scatter < 0.13) {
        plant = "sugar_cane";
      } else if (field > 0.34 && scatter < 0.23) {
        const swampPlant = hashFloat(x + 137, z - 251, this.seed ^ 0xf10e);
        if (swampPlant < 0.50) plant = "blue_orchid";
        else if (swampPlant < 0.82) plant = "tall_grass";
        else plant = swampPlant < 0.91 ? "brown_mushroom" : "red_mushroom";
      } else if (bogPatch > 0.68 && scatter < 0.045) {
        plant = hashFloat(x - 181, z + 97, this.seed ^ 0xf113) < 0.58 ? "brown_mushroom" : "red_mushroom";
      }
      return this.cachePlantType(key, plant);
    }
    // FIX: Plains grass coverage now matches real Minecraft Plains.
    // MC's "patch_grass_plain" placed feature reaches ~30-50% surface coverage with
    // dense tall grass. Old 0.18 * field-gate ≈ 9% was way too sparse.
    // 0.50 * ~0.55 field-pass-rate ≈ 27% effective coverage — feels like Plains.
    const chance =
      biomeId === this.Biome.PLAINS || biomeId === this.Biome.SUNFLOWER_PLAINS
        ? 0.50
        : isJungleBiome(this.Biome, biomeId)
          ? 0.16
          : (biomeId === this.Biome.FLOWER_FOREST
            ? 0.36
            : (isSavannaBiome(this.Biome, biomeId) ? 0.18 : biomeId === this.Biome.FOREST || biomeId === this.Biome.BIRCH_FOREST || biomeId === this.Biome.FOREST_HILLS || biomeId === this.Biome.BIRCH_FOREST_HILLS ? 0.14 : 0.08));
    // FIX: Lowered patch threshold (0.45 → 0.42) so vegetated areas are slightly
    // larger and patch boundaries less abrupt — matches MC's softer placement masks.
    if (field < 0.42 || scatter > chance) {
      return this.cachePlantType(key, null);
    }
    if (isJungleBiome(this.Biome, biomeId)) {
      const junglePlant = hashFloat(x, z, this.seed ^ 0xf10d);
      if (junglePlant < 0.08) plant = "melon";
      else plant = "tall_grass";
    } else if (isTaigaBiome(this.Biome, biomeId)) {
      plant = hashFloat(x, z, this.seed ^ 0xf10e) < 0.72 ? "fern" : "tall_grass";
    }
    if (biomeId === this.Biome.FLOWER_FOREST || biomeId === this.Biome.SUNFLOWER_PLAINS) {
      const flower = hashFloat(x, z, this.seed ^ 0xf10c);
      if (biomeId === this.Biome.SUNFLOWER_PLAINS && flower < 0.32) plant = "sunflower";
      else if (flower < 0.22) plant = "clover";
      else if (flower < 0.44) plant = "dandelion";
      else if (flower < 0.66) plant = "poppy";
      else if (biomeId === this.Biome.FLOWER_FOREST && flower < 0.86) plant = "wildflower";
      else plant = "tall_grass";
    } else if (isSavannaBiome(this.Biome, biomeId)) {
      const dryPlant = hashFloat(x, z, this.seed ^ 0xf112);
      if (dryPlant < 0.28) plant = "savanna_shrub";
      else if (dryPlant < 0.44) plant = "dead_bush";
      else plant = "tall_grass";
    } else if (!plant) {
      // FIX: Plains output is now ~80% tall_grass / ~20% flowers, matching real MC
      // where Plains is dominated by grass with occasional dandelions/poppies.
      // Old 38% grass was inverted — flowers should be the rarity, not grass.
      const r = hashFloat(x, z, this.seed ^ 0xf10b);
      if (hashFloat(x, z, this.seed ^ 0xf10f) < 0.012) plant = "pumpkin";
      else if (r < 0.78) plant = "tall_grass";
      else if (r < 0.90) plant = "dandelion";
      else plant = "poppy";
    }
    return this.cachePlantType(key, plant);
  }

  nearNaturalWater(x, z, height) {
    if (height > this.seaLevel + 2) return false;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighborHeight = this.terrainHeight(x + dx, z + dz);
      if (this.shouldFillWaterAt(x + dx, z + dz, neighborHeight)) return true;
    }
    return false;
  }

  oreBlockAt(x, y, z, surfaceHeight) {
    if (y > surfaceHeight - 5) return this.Block.STONE;

    const ore = this.minecraft118OreBlockAt(x, y, z, surfaceHeight);
    if (ore !== this.Block.STONE) return this.minecraft26Terrain ? ore : this.legacyTerrainBlock(ore);

    const vein = normalizeNoise(this.detailNoise.fbm2((x + y * 3) * 0.08, (z - y * 5) * 0.08, 3));
    const scatter = hashFloat(x + y * 17, z - y * 13, this.seed ^ 0x0a0e);
    const deepBand = normalizeNoise(this.weirdnessNoise.fbm2((x + y) * 0.035, (z - y) * 0.035, 3));

    if (vein < 0.18 && scatter < 0.012) return this.Block.GRAVEL;
    if (surfaceHeight > this.seaLevel + 18 && vein > 0.72 && scatter < 0.018) return this.Block.COBBLESTONE;
    if (surfaceHeight > this.seaLevel + 22 && y > surfaceHeight - 18 && deepBand > 0.74 && scatter < 0.035) return this.Block.COBBLESTONE;
    if (y < 15 && scatter < 0.18) return this.Block.GRAVEL;
    return this.Block.STONE;
  }

  minecraft118OreBlockAt(x, y, z, surfaceHeight) {
    const mcY = this.minecraft118Y(y);
    const biomeId = this.biomeAt(x, z);
    const exposedToAir = () => this.oreTouchesCaveAir(x, y, z, surfaceHeight);
    const redstoneOre = this.Block.EXTRA_REDSTONE_ORE;
    const lapisOre = this.Block.EXTRA_LAPIS_ORE;
    const emeraldOre = this.Block.EXTRA_EMERALD_ORE;

    // Diamond veins exist only below Minecraft Y=16. Their chance rises toward
    // bedrock, with a second deep-only pass matching modern Java generation.
    if (mcY <= 16 && (this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0xd1a00d, cellXZ: 13, cellY: 9,
      minR: 0.95, maxR: 1.45,
      minY: 1, maxY: 54,
      chance: 0.72, lowerYChance: 0.94,
      discardOnAir: 0.5,
    }) || this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0xd1a00e, cellXZ: 18, cellY: 12,
      minR: 1.15, maxR: 1.7,
      minY: 1, maxY: 54,
      chance: 0.36, lowerYChance: 0.94,
      discardOnAir: 1,
    }) || this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0xd1a00f, cellXZ: 30, cellY: 15,
      minR: 1.45, maxR: 2.05,
      minY: 1, maxY: 54,
      chance: 0.12, lowerYChance: 0.94,
      discardOnAir: 0.7,
    }) || this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0xd1a010, cellXZ: 17, cellY: 11,
      minR: 1.1, maxR: 1.65,
      minY: 1, maxY: 30,
      chance: 0.55,
      discardOnAir: 0.5,
    }))) {
      return this.Block.DIAMOND_ORE;
    }

    // Minecraft 26.2 placed-feature distributions that were previously absent
    // even though this clone already ships the corresponding blocks/textures.
    if (redstoneOre && (this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x7ed570,
      count: 4,
      size: 8,
      minY: -64,
      maxY: 15,
      exposedToAir,
    }) || this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x7ed571,
      count: 8,
      size: 8,
      minY: -64,
      peakY: -48,
      maxY: -32,
      exposedToAir,
    }))) {
      return redstoneOre;
    }

    if (lapisOre && (this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x1a915,
      count: 2,
      size: 7,
      minY: -32,
      peakY: 0,
      maxY: 32,
      exposedToAir,
    }) || this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x1a916,
      count: 4,
      size: 7,
      minY: -64,
      maxY: 64,
      discardOnAir: 1,
      exposedToAir,
    }))) {
      return lapisOre;
    }

    if (emeraldOre && isMountainBiome(this.Biome, biomeId) && this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0xe3e2a1d,
      count: 100,
      size: 3,
      minY: -16,
      peakY: 232,
      maxY: 480,
      exposedToAir,
    })) {
      return emeraldOre;
    }

    if (isMesaBiome(this.Biome, biomeId) && this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x901dba,
      count: 50,
      size: 9,
      minY: 32,
      maxY: 256,
      exposedToAir,
    })) {
      return this.Block.GOLD_ORE;
    }

    if (this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x901d,
      count: 4,
      size: 9,
      minY: -64,
      peakY: -16,
      maxY: 32,
      discardOnAir: 0.5,
      exposedToAir,
    }) || this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0x901d01,
      count: 0.5,
      size: 9,
      minY: -64,
      maxY: -48,
      discardOnAir: 0.5,
      exposedToAir,
    })) {
      return this.Block.GOLD_ORE;
    }

    if (this.oreFeaturePasses(x, y, z, mcY, {
      salt: 0xc011e2,
      count: 16,
      size: 10,
      minY: -16,
      peakY: 48,
      maxY: 112,
      exposedToAir,
    })) {
      return this.Block.COPPER_ORE;
    }

    if (isMountainBiome(this.Biome, biomeId) && this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0x1f0b18, cellXZ: 12, cellY: 10,
      minR: 1.35, maxR: 2.15,
      minY: this.seaLevel + 18, maxY: 9999,
      chance: 0.72,
    })) {
      return this.Block.IRON_ORE;
    }

    // Frequent compact deposits approximate Minecraft's usual 3-9 block iron
    // veins while preserving the lower and high-altitude distributions.
    if (this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0x1f0b10, cellXZ: 12, cellY: 10,
      minR: 1.25, maxR: 1.9,
      minY: 1, peakY: 53, maxY: 92,
      chance: 0.78,
    }) || this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0x1f0b11, cellXZ: 13, cellY: 11,
      minR: 1.2, maxR: 1.85,
      minY: 96, maxY: 9999,
      chance: 0.32, higherYChance: 0.7,
    })) {
      return this.Block.IRON_ORE;
    }

    // Coal begins at Minecraft y=0 and forms larger, more common veins than
    // iron, with an additional high-altitude distribution around y=96+.
    if (this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0xc0a1b0, cellXZ: 10, cellY: 9,
      minR: 1.6, maxR: 2.45,
      minY: 43, peakY: 106, maxY: 171,
      chance: 0.98,
    }) || this.oreBlobAt(x, y, z, surfaceHeight, {
      salt: 0xc0a1b1, cellXZ: 10, cellY: 8,
      minR: 1.7, maxR: 2.6,
      minY: 106, maxY: 9999,
      chance: 0.65, higherYChance: 0.42,
    })) {
      return this.Block.COAL_ORE;
    }

    return this.Block.STONE;
  }

  oreFeaturePasses(x, y, z, mcY, feature) {
    const distribution = feature.peakY === undefined
      ? uniformDistribution(mcY, feature.minY, feature.maxY)
      : triangleDistribution(mcY, feature.minY, feature.peakY, feature.maxY);
    if (distribution <= 0) return false;

    const worldSpan = Math.max(1, ((feature.maxY - feature.minY) / MINECRAFT_118_HEIGHT) * this.worldHeight);
    const baseChance = (feature.count * feature.size) / (ORE_CHUNK_AREA * worldSpan);
    const veinStrength = this.oreVeinStrengthAt(x, y, z, feature);
    const cluster = normalizeNoise(sample3(this.veinNoise, x + feature.salt * 0.013, y, z - feature.salt * 0.017, 0.11, 2));
    const clusterMultiplier = 0.36 + Math.pow(cluster, 1.8) * 0.88 + veinStrength * 1.72;
    const chance = baseChance * distribution * clusterMultiplier;
    const roll = hashFloat(x + y * 31, z - y * 19, this.seed ^ feature.salt) * lerp(1, 0.1, veinStrength);
    if (roll >= chance) return false;

    const discard = feature.discardOnAir ?? 0;
    if (discard > 0 && feature.exposedToAir?.() && hashFloat(x - y * 7, z + y * 11, this.seed ^ (feature.salt + 0x51d)) < discard) {
      return false;
    }

    return true;
  }

  oreVeinStrengthAt(x, y, z, feature) {
    const sizeT = clamp(feature.size / 17, 0, 1);
    const scale = lerp(0.145, 0.062, sizeT);
    const thickness = lerp(0.045, 0.11, sizeT);
    const veinField = sample3(
      this.veinNoise,
      x + feature.salt * 0.021,
      y - feature.salt * 0.009,
      z + feature.salt * 0.017,
      scale,
      2,
    );
    const ribbon = 1 - smoothstep(thickness, thickness * 3.2, Math.abs(veinField));
    if (ribbon <= 0) return 0;

    const pocket = normalizeNoise(sample3(
      this.veinNoise,
      x - feature.salt * 0.031,
      y + feature.salt * 0.015,
      z - feature.salt * 0.027,
      scale * 0.62,
      2,
    ));
    const brokenEdges = normalizeNoise(sample3(
      this.detailNoise,
      x + feature.salt * 0.007,
      y,
      z - feature.salt * 0.011,
      scale * 2.4,
      1,
    ));

    return clamp(ribbon * smoothstep(0.18, 0.72, pocket) * lerp(0.68, 1, brokenEdges), 0, 1);
  }

  oreBlobCellHash(cx, cy, cz, salt) {
    return hashFloat(cx + cy * 7349, cz - cy * 1931, this.seed ^ salt);
  }

  // Blob-based ore placement: deterministic ellipsoid centers per 3D cell,
  // noise-warped for organic edges. Produces discrete adjacent-block veins
  // instead of the scatter pattern from per-block probability.
  oreBlobAt(x, y, z, surfaceHeight, config) {
    const cellX = Math.floor(x / config.cellXZ);
    const cellY = Math.floor(y / config.cellY);
    const cellZ = Math.floor(z / config.cellXZ);
    const maxBY = Math.min(config.maxY, surfaceHeight - 6);

    for (let oz = -1; oz <= 1; oz += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = cellX + ox;
          const cy = cellY + oy;
          const cz = cellZ + oz;

          const bx = cx * config.cellXZ + this.oreBlobCellHash(cx, cy, cz, config.salt + 1) * config.cellXZ;
          const by = cy * config.cellY  + this.oreBlobCellHash(cx, cy, cz, config.salt + 2) * config.cellY;
          const bz = cz * config.cellXZ + this.oreBlobCellHash(cx, cy, cz, config.salt + 3) * config.cellXZ;

          if (by < config.minY || by > maxBY) continue;
          let chance = config.chance;
          if (config.peakY !== undefined) {
            chance *= triangleDistribution(by, config.minY, config.peakY, Math.min(config.maxY, maxBY));
          }
          if (config.higherYChance) {
            chance *= lerp(1 - config.higherYChance, 1, clamp((by - config.minY) / Math.max(1, maxBY - config.minY), 0, 1));
          }
          if (config.lowerYChance) {
            chance *= lerp(1, 1 - config.lowerYChance, clamp((by - config.minY) / Math.max(1, maxBY - config.minY), 0, 1));
          }
          if (this.oreBlobCellHash(cx, cy, cz, config.salt) > chance) continue;

          const r = config.minR + this.oreBlobCellHash(cx, cy, cz, config.salt + 4) * (config.maxR - config.minR);
          // Early reject before noise warp
          if (Math.abs(x - bx) > r + 2.5 || Math.abs(z - bz) > r + 2.5 || Math.abs(y - by) > r * 0.72 + 1.5) continue;

          // Noise warp for organic blob boundary
          const sf = config.salt * 1.3e-4;
          const ws = 0.18;
          const warpX = this.detailNoise.noise2(x * ws + sf,       z * ws + y * 0.093) * 2.0;
          const warpY = this.detailNoise.noise2(x * ws + sf + 3.1, z * ws - y * 0.071) * 0.9;
          const warpZ = this.detailNoise.noise2(x * ws - sf - 2.3, z * ws + y * 0.086) * 2.0;

          // Slightly flattened ellipsoid (0.62 Y scale → Minecraft-style flat blobs)
          const nx = (x - bx + warpX) / r;
          const ny = (y - by + warpY) / (r * 0.62);
          const nz = (z - bz + warpZ) / r;
          if (nx * nx + ny * ny + nz * nz > 1.0) continue;
          if (
            config.discardOnAir > 0 &&
            this.oreTouchesCaveAir(x, y, z, surfaceHeight) &&
            hashFloat(x - y * 7, z + y * 11, this.seed ^ (config.salt + 0x51d)) < config.discardOnAir
          ) {
            continue;
          }
          return true;
        }
      }
    }
    return false;
  }

  oreTouchesCaveAir(x, y, z, surfaceHeight) {
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (ny < 1 || ny >= this.worldHeight - 1) continue;
      if (ny > surfaceHeight) return true;
      if (this.isCaveAt(nx, ny, nz, surfaceHeight)) return true;
      if (this.aquiferBlockAt(nx, ny, nz, surfaceHeight) === this.Block.WATER) return true;
    }
    return false;
  }

}

function minecraft26BiomeIdToVoxelBiome(Biome, biomeId) {
  switch (biomeId) {
    case "mushroom_fields": return Biome.MUSHROOM_ISLAND;
    case "deep_frozen_ocean": return Biome.FROZEN_OCEAN;
    case "deep_cold_ocean":
    case "deep_ocean":
    case "deep_lukewarm_ocean": return Biome.DEEP_OCEAN;
    case "frozen_ocean": return Biome.FROZEN_OCEAN;
    case "cold_ocean":
    case "ocean":
    case "lukewarm_ocean":
    case "warm_ocean": return Biome.OCEAN;
    case "plains": return Biome.PLAINS;
    case "sunflower_plains": return Biome.SUNFLOWER_PLAINS;
    case "snowy_plains": return Biome.ICE_PLAINS;
    case "ice_spikes": return Biome.ICE_SPIKES;
    case "desert": return Biome.DESERT;
    case "forest": return Biome.FOREST;
    case "flower_forest": return Biome.FLOWER_FOREST;
    case "birch_forest": return Biome.BIRCH_FOREST;
    case "old_growth_birch_forest": return Biome.BIRCH_FOREST_M;
    case "dark_forest": return Biome.ROOFED_FOREST;
    case "pale_garden": return Biome.ROOFED_FOREST_M;
    case "taiga": return Biome.TAIGA;
    case "snowy_taiga": return Biome.COLD_TAIGA;
    case "old_growth_pine_taiga": return Biome.MEGA_SPRUCE_TAIGA;
    case "old_growth_spruce_taiga": return Biome.MEGA_TAIGA;
    case "savanna": return Biome.SAVANNA;
    case "savanna_plateau": return Biome.SAVANNA_PLATEAU;
    case "windswept_savanna": return Biome.SAVANNA_M;
    case "jungle": return Biome.JUNGLE;
    case "sparse_jungle": return Biome.JUNGLE_EDGE;
    case "bamboo_jungle": return Biome.JUNGLE_M;
    case "badlands": return Biome.MESA;
    case "wooded_badlands": return Biome.MESA_PLATEAU_F;
    case "eroded_badlands": return Biome.MESA_BRYCE;
    case "meadow": return Biome.MEADOW;
    case "grove": return Biome.GROVE;
    case "snowy_slopes": return Biome.SNOWY_SLOPES;
    case "jagged_peaks": return Biome.JAGGED_PEAKS;
    case "frozen_peaks": return Biome.FROZEN_PEAKS;
    case "stony_peaks": return Biome.STONY_PEAKS;
    case "windswept_gravelly_hills": return Biome.EXTREME_HILLS_M;
    case "windswept_forest": return Biome.EXTREME_HILLS_PLUS;
    case "windswept_hills": return Biome.EXTREME_HILLS;
    case "stony_shore": return Biome.STONE_BEACH;
    case "snowy_beach": return Biome.COLD_BEACH;
    case "beach": return Biome.BEACH;
    case "river": return Biome.RIVER;
    case "frozen_river": return Biome.FROZEN_RIVER;
    case "swamp": return Biome.SWAMPLAND;
    case "mangrove_swamp": return Biome.SWAMPLAND_M;
    case "cherry_grove": return Biome.FLOWER_FOREST;
    default: return Biome.PLAINS;
  }
}

function minecraft18BiomeIdToVoxelBiome(Biome, biomeId) {
  switch (biomeId) {
    case MC18BiomeID.OCEAN:
      return Biome.OCEAN;
    case MC18BiomeID.PLAINS:
      return Biome.PLAINS;
    case MC18BiomeID.DESERT:
      return Biome.DESERT;
    case MC18BiomeID.EXTREME_HILLS:
      return Biome.EXTREME_HILLS;
    case MC18BiomeID.FOREST:
      return Biome.FOREST;
    case MC18BiomeID.TAIGA:
      return Biome.TAIGA;
    case MC18BiomeID.SWAMPLAND:
      return Biome.SWAMPLAND;
    case MC18BiomeID.RIVER:
      return Biome.RIVER;
    case MC18BiomeID.HELL:
      return Biome.DESERT;
    case MC18BiomeID.SKY:
    case MC18BiomeID.VOID:
      return Biome.PLAINS;
    case MC18BiomeID.FROZEN_OCEAN:
      return Biome.FROZEN_OCEAN;
    case MC18BiomeID.FROZEN_RIVER:
      return Biome.FROZEN_RIVER;
    case MC18BiomeID.ICE_FLATS:
      return Biome.ICE_PLAINS;
    case MC18BiomeID.ICE_MOUNTAINS:
      return Biome.ICE_MOUNTAINS;
    case MC18BiomeID.MUSHROOM_ISLAND:
      return Biome.MUSHROOM_ISLAND;
    case MC18BiomeID.MUSHROOM_ISLAND_SHORE:
      return Biome.MUSHROOM_SHORE;
    case MC18BiomeID.BEACHES:
      return Biome.BEACH;
    case MC18BiomeID.DESERT_HILLS:
      return Biome.DESERT_HILLS;
    case MC18BiomeID.FOREST_HILLS:
      return Biome.FOREST_HILLS;
    case MC18BiomeID.TAIGA_HILLS:
      return Biome.TAIGA_HILLS;
    case MC18BiomeID.SMALLER_EXTREME_HILLS:
      return Biome.EXTREME_HILLS_EDGE;
    case MC18BiomeID.JUNGLE:
      return Biome.JUNGLE;
    case MC18BiomeID.JUNGLE_HILLS:
      return Biome.JUNGLE_HILLS;
    case MC18BiomeID.JUNGLE_EDGE:
      return Biome.JUNGLE_EDGE;
    case MC18BiomeID.DEEP_OCEAN:
      return Biome.DEEP_OCEAN;
    case MC18BiomeID.STONE_BEACH:
      return Biome.STONE_BEACH;
    case MC18BiomeID.COLD_BEACH:
      return Biome.COLD_BEACH;
    case MC18BiomeID.BIRCH_FOREST:
      return Biome.BIRCH_FOREST;
    case MC18BiomeID.BIRCH_FOREST_HILLS:
      return Biome.BIRCH_FOREST_HILLS;
    case MC18BiomeID.ROOFED_FOREST:
      return Biome.ROOFED_FOREST;
    case MC18BiomeID.TAIGA_COLD:
      return Biome.COLD_TAIGA;
    case MC18BiomeID.TAIGA_COLD_HILLS:
      return Biome.COLD_TAIGA_HILLS;
    case MC18BiomeID.REDWOOD_TAIGA:
      return Biome.MEGA_TAIGA;
    case MC18BiomeID.REDWOOD_TAIGA_HILLS:
      return Biome.MEGA_TAIGA_HILLS;
    case MC18BiomeID.EXTREME_HILLS_WITH_TREES:
      return Biome.EXTREME_HILLS_PLUS;
    case MC18BiomeID.SAVANNA:
      return Biome.SAVANNA;
    case MC18BiomeID.SAVANNA_ROCK:
      return Biome.SAVANNA_PLATEAU;
    case MC18BiomeID.MESA:
      return Biome.MESA;
    case MC18BiomeID.MESA_ROCK:
      return Biome.MESA_PLATEAU_F;
    case MC18BiomeID.MESA_CLEAR_ROCK:
      return Biome.MESA_PLATEAU;
    case MC18BiomeID.MUTATED_PLAINS:
      return Biome.SUNFLOWER_PLAINS;
    case MC18BiomeID.MUTATED_DESERT:
      return Biome.DESERT_M;
    case MC18BiomeID.MUTATED_EXTREME_HILLS:
      return Biome.EXTREME_HILLS_M;
    case MC18BiomeID.MUTATED_FOREST:
      return Biome.FLOWER_FOREST;
    case MC18BiomeID.MUTATED_TAIGA:
      return Biome.TAIGA_M;
    case MC18BiomeID.MUTATED_SWAMPLAND:
      return Biome.SWAMPLAND_M;
    case MC18BiomeID.MUTATED_ICE_FLATS:
      return Biome.ICE_SPIKES;
    case MC18BiomeID.MUTATED_JUNGLE:
      return Biome.JUNGLE_M;
    case MC18BiomeID.MUTATED_JUNGLE_EDGE:
      return Biome.JUNGLE_EDGE_M;
    case MC18BiomeID.MUTATED_BIRCH_FOREST:
      return Biome.BIRCH_FOREST_M;
    case MC18BiomeID.MUTATED_BIRCH_FOREST_HILLS:
      return Biome.BIRCH_FOREST_HILLS_M;
    case MC18BiomeID.MUTATED_ROOFED_FOREST:
      return Biome.ROOFED_FOREST_M;
    case MC18BiomeID.MUTATED_TAIGA_COLD:
      return Biome.COLD_TAIGA_M;
    case MC18BiomeID.MUTATED_REDWOOD_TAIGA:
      return Biome.MEGA_SPRUCE_TAIGA;
    case MC18BiomeID.MUTATED_REDWOOD_TAIGA_HILLS:
      return Biome.MEGA_SPRUCE_TAIGA_HILLS;
    case MC18BiomeID.MUTATED_EXTREME_HILLS_WITH_TREES:
      return Biome.EXTREME_HILLS_PLUS_M;
    case MC18BiomeID.MUTATED_SAVANNA:
      return Biome.SAVANNA_M;
    case MC18BiomeID.MUTATED_SAVANNA_ROCK:
      return Biome.SAVANNA_PLATEAU_M;
    case MC18BiomeID.MUTATED_MESA:
      return Biome.MESA_BRYCE;
    case MC18BiomeID.MUTATED_MESA_ROCK:
      return Biome.MESA_PLATEAU_F_M;
    case MC18BiomeID.MUTATED_MESA_CLEAR_ROCK:
      return Biome.MESA_PLATEAU_M;
    default:
      return Biome.PLAINS;
  }
}

function isDesertBiome(Biome, biomeId) {
  return biomeId === Biome.DESERT || biomeId === Biome.DESERT_HILLS || biomeId === Biome.DESERT_M;
}

function isOceanBiome(Biome, biomeId) {
  return biomeId === Biome.OCEAN || biomeId === Biome.DEEP_OCEAN || biomeId === Biome.FROZEN_OCEAN;
}

function isRiverBiome(Biome, biomeId) {
  return biomeId === Biome.RIVER || biomeId === Biome.FROZEN_RIVER;
}

function isMesaBiome(Biome, biomeId) {
  return (
    biomeId === Biome.MESA ||
    biomeId === Biome.MESA_PLATEAU_F ||
    biomeId === Biome.MESA_PLATEAU ||
    biomeId === Biome.MESA_BRYCE ||
    biomeId === Biome.MESA_PLATEAU_F_M ||
    biomeId === Biome.MESA_PLATEAU_M
  );
}

function isSwampBiome(Biome, biomeId) {
  return biomeId === Biome.SWAMPLAND || biomeId === Biome.SWAMPLAND_M;
}

function isSavannaBiome(Biome, biomeId) {
  return (
    biomeId === Biome.SAVANNA ||
    biomeId === Biome.SAVANNA_PLATEAU ||
    biomeId === Biome.SAVANNA_M ||
    biomeId === Biome.SAVANNA_PLATEAU_M
  );
}

function isJungleBiome(Biome, biomeId) {
  return (
    biomeId === Biome.JUNGLE ||
    biomeId === Biome.JUNGLE_HILLS ||
    biomeId === Biome.JUNGLE_EDGE ||
    biomeId === Biome.JUNGLE_M ||
    biomeId === Biome.JUNGLE_EDGE_M
  );
}

function isTaigaBiome(Biome, biomeId) {
  return (
    biomeId === Biome.TAIGA ||
    biomeId === Biome.TAIGA_HILLS ||
    biomeId === Biome.TAIGA_M ||
    biomeId === Biome.COLD_TAIGA ||
    biomeId === Biome.COLD_TAIGA_HILLS ||
    biomeId === Biome.COLD_TAIGA_M ||
    biomeId === Biome.MEGA_TAIGA ||
    biomeId === Biome.MEGA_TAIGA_HILLS ||
    biomeId === Biome.MEGA_SPRUCE_TAIGA ||
    biomeId === Biome.MEGA_SPRUCE_TAIGA_HILLS
  );
}

function isSnowyBiome(Biome, biomeId) {
  return (
    biomeId === Biome.GROVE ||
    biomeId === Biome.SNOWY_SLOPES ||
    biomeId === Biome.JAGGED_PEAKS ||
    biomeId === Biome.FROZEN_PEAKS ||
    biomeId === Biome.ICE_PLAINS ||
    biomeId === Biome.ICE_MOUNTAINS ||
    biomeId === Biome.ICE_SPIKES ||
    biomeId === Biome.COLD_TAIGA ||
    biomeId === Biome.COLD_TAIGA_HILLS ||
    biomeId === Biome.COLD_TAIGA_M
  );
}

function isClassicExtremeHillsBiome(Biome, biomeId) {
  return (
    biomeId === Biome.EXTREME_HILLS ||
    biomeId === Biome.EXTREME_HILLS_PLUS ||
    biomeId === Biome.EXTREME_HILLS_PLUS_M ||
    biomeId === Biome.EXTREME_HILLS_M ||
    biomeId === Biome.EXTREME_HILLS_EDGE
  );
}

function isMountainBiome(Biome, biomeId) {
  return (
    biomeId === Biome.MEADOW ||
    biomeId === Biome.GROVE ||
    biomeId === Biome.SNOWY_SLOPES ||
    biomeId === Biome.JAGGED_PEAKS ||
    biomeId === Biome.FROZEN_PEAKS ||
    biomeId === Biome.STONY_PEAKS ||
    biomeId === Biome.EXTREME_HILLS ||
    biomeId === Biome.EXTREME_HILLS_PLUS ||
    biomeId === Biome.EXTREME_HILLS_PLUS_M ||
    biomeId === Biome.EXTREME_HILLS_M ||
    biomeId === Biome.EXTREME_HILLS_EDGE
  );
}

class PerlinNoise {
  constructor(seed) {
    this.permutation = new Uint8Array(512);
    const source = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) source[i] = i;

    let state = seed >>> 0;
    for (let i = 255; i >= 0; i -= 1) {
      state = lcg(state);
      const r = state % (i + 1);
      const value = source[r];
      source[r] = source[i];
      source[i] = value;
    }

    for (let i = 0; i < 512; i += 1) {
      this.permutation[i] = source[i & 255];
    }
  }

  noise2(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = this.permutation[this.permutation[xi] + yi];
    const ab = this.permutation[this.permutation[xi] + yi + 1];
    const ba = this.permutation[this.permutation[xi + 1] + yi];
    const bb = this.permutation[this.permutation[xi + 1] + yi + 1];

    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let max = 0;

    for (let i = 0; i < octaves; i += 1) {
      sum += this.noise2(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return sum / max;
  }

  ridgedFbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let max = 0;

    for (let i = 0; i < octaves; i += 1) {
      const n = 1 - Math.abs(this.noise2(x * frequency, y * frequency));
      sum += n * n * amplitude;
      max += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return sum / max;
  }
}

function sample3(noise, x, y, z, scale, octaves = 3, lacunarity = 2, gain = 0.5) {
  const xy = noise.fbm2(x * scale + y * scale * 0.37, z * scale - y * scale * 0.23, octaves, lacunarity, gain);
  const yz = noise.fbm2((z + y * 0.71) * scale, (x - y * 0.43) * scale, octaves, lacunarity, gain);
  return (xy + yz) * 0.5;
}

function peaksAndValleysFromWeirdness(weirdness) {
  return 1 - Math.abs(3 * Math.abs(weirdness) - 2);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpClamped(value, inMin, inMax, outMin, outMax) {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, t);
}

function remap(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function halfNegativeValue(value) {
  return value < 0 ? value * 0.5 : value;
}

function quarterNegativeValue(value) {
  return value < 0 ? value * 0.25 : value;
}

function squeezeValue(value) {
  const x = clamp(value, -1, 1);
  return x / 2 - (x * x * x) / 24;
}

function grad2(hash, x, y) {
  switch (hash & 7) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    case 3:
      return -x - y;
    case 4:
      return x;
    case 5:
      return -x;
    case 6:
      return y;
    default:
      return -y;
  }
}

function normalizeNoise(value) {
  return value * 0.5 + 0.5;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function uniformDistribution(value, min, max) {
  return value >= min && value <= max ? 1 : 0;
}

function triangleDistribution(value, min, peak, max) {
  if (value < min || value > max) return 0;
  if (peak <= min) return 1 - smoothstep(min, max, value);
  if (peak >= max) return smoothstep(min, max, value);
  return value <= peak
    ? smoothstep(min, peak, value)
    : 1 - smoothstep(peak, max, value);
}

function mod(value, size) {
  return ((value % size) + size) % size;
}

function columnKey(x, z) {
  return (x & 0x3FFFF) * 262144 + (z & 0x3FFFF);
}

function trimMap(map, maxSize) {
  if (map.size <= maxSize) return;
  const excess = map.size - maxSize;
  const iter = map.keys();
  for (let i = 0; i < excess; i++) map.delete(iter.next().value);
}

function densityFieldIndex(gx, gy, gz) {
  return (gy * DENSITY_XZ_SIZE + gz) * DENSITY_XZ_SIZE + gx;
}

function lcg(value) {
  return (Math.imul(value, 1664525) + 1013904223) >>> 0;
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
