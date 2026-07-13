import { Identifier } from "deepslate";
import {
  DensityFunction,
  NoiseGeneratorSettings,
  RandomState,
  WorldgenRegistries,
} from "deepslate/worldgen";

import { MINECRAFT_26_2_WORLDGEN } from "./generated/minecraft26WorldgenData.js";
import {
  createMinecraft26OverworldBiomeParameters,
  sampleMinecraft26SurfaceBiome,
} from "./minecraft26BiomeSource.js";

export const MINECRAFT_26_2_TERRAIN_TARGET = Object.freeze({
  version: "26.2",
  minY: 0,
  height: 320,
  maxYExclusive: 320,
  seaLevel: 63,
  engineYOffset: 0,
});

const CACHE_LIMIT = 65536;
const PRELIMINARY_SURFACE_GRID = 8;
const HIGH_TERRAIN_COMPRESSION_START = MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 80;
const EROSION_SAMPLE_RADIUS = 24;
let registriesLoaded = false;
let generatorSettings = null;

export class Minecraft26OverworldTerrain {
  constructor({ seed, worldHeight }) {
    if (worldHeight !== MINECRAFT_26_2_TERRAIN_TARGET.height) {
      throw new Error(
        `Minecraft ${MINECRAFT_26_2_TERRAIN_TARGET.version} terrain requires a ` +
        `${MINECRAFT_26_2_TERRAIN_TARGET.height}-block world height; received ${worldHeight}.`,
      );
    }

    ensureMinecraft26Registries();
    this.seed = parseMinecraftSeed(seed);
    this.worldHeight = worldHeight;
    this.settings = generatorSettings;
    this.randomState = new RandomState(this.settings, this.seed);
    this.biomeParameters = createMinecraft26OverworldBiomeParameters();
    this.base3dNoise = WorldgenRegistries.DENSITY_FUNCTION
      .getOrThrow(Identifier.parse("minecraft:overworld/base_3d_noise"))
      .mapAll(this.randomState.createVisitor(this.settings.noise, false));
    this.surfaceDetailNoise = this.randomState.getOrCreateNoise(Identifier.parse("minecraft:surface"));
    this.surfaceSecondaryNoise = this.randomState.getOrCreateNoise(Identifier.parse("minecraft:surface_secondary"));
    this.preliminarySurfaceCache = new Map();
    this.baseHeightCache = new Map();
    this.heightCache = new Map();
    this.shapeCache = new Map();
    this.riverBiomeCache = new Map();
    this.transientDensityCaches = collectTransientDensityCaches(this.randomState.router);
  }

  minecraftY(engineY) {
    return engineY - MINECRAFT_26_2_TERRAIN_TARGET.engineYOffset;
  }

  engineY(minecraftY) {
    return minecraftY + MINECRAFT_26_2_TERRAIN_TARGET.engineYOffset;
  }

  shapeAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.shapeCache.get(key);
    if (cached) return cached;

    const context = DensityFunction.context(x, 0, z);
    const signedContinentalness = this.randomState.router.continents.compute(context);
    const signedErosion = this.randomState.router.erosion.compute(context);
    const ridges = this.randomState.router.ridges.compute(context);
    const ridgesFolded = peaksAndValleys(ridges);
    const continentalness = normalizeSigned(signedContinentalness);
    const erosion = normalizeSigned(signedErosion);
    const inland = smoothstep(-0.11, 0.55, signedContinentalness);
    const lowErosion = 1 - smoothstep(-0.78, -0.375, signedErosion);
    const mountainSignal = clamp(
      inland * lowErosion * smoothstep(0.22, 0.92, ridgesFolded),
      0,
      1,
    );
    const valley = (1 - smoothstep(-0.96, -0.62, ridgesFolded)) * inland;
    const summitSignal = smoothstep(0.62, 0.98, ridgesFolded) * lowErosion * inland;
    const rangeCrest = smoothstep(0.38, 0.92, ridgesFolded) * lowErosion * inland;
    const river = clamp(
      (1 - smoothstep(-0.985, -0.86, ridgesFolded)) * inland * smoothstep(-0.42, 0.78, signedErosion),
      0,
      1,
    );
    // Distort only the small and medium scale landforms. Continents and biome
    // climate stay on the official router, while the detail stops lining up on
    // obvious world-axis bands.
    const warpX = this.surfaceSecondaryNoise.sample(x * 0.0075 + 173, 0, z * 0.0075 - 229) * 22;
    const warpZ = this.surfaceSecondaryNoise.sample(x * 0.0075 - 367, 0, z * 0.0075 + 311) * 22;
    const wx = x + warpX;
    const wz = z + warpZ;
    // Keep valleys tied to Minecraft's own peaks-and-valleys/erosion router.
    // A second custom river network made the terrain feel like a different
    // generator and could disagree with the biome source at transitions.
    const drainageSignal = river;
    const ribNoise = 1 - Math.abs(
      this.surfaceDetailNoise.sample(wx * 0.030 + 271, 0, wz * 0.014 - 193),
    );
    const mountainBreak = this.surfaceSecondaryNoise.sample(wx * 0.022 - 419, 0, wz * 0.022 + 347);
    const mountainDetail = clamp(
      (mountainBreak * 0.62 + (ribNoise - 0.5) * 0.38) * smoothstep(0.22, 0.72, mountainSignal),
      -1,
      1,
    );
    const mountainRibSignal = clamp(
      smoothstep(0.58, 0.92, ribNoise) * rangeCrest * (1 - drainageSignal * 0.55),
      0,
      1,
    );

    const shape = {
      continentalness,
      erosion,
      weirdness: ridges,
      peaksAndValleys: ridgesFolded,
      ridge: smoothstep(0.18, 0.72, Math.abs(ridges)),
      river,
      riverBank: river,
      valley,
      valleyFloor: valley * smoothstep(-0.34, 0.76, signedErosion),
      drainageSignal,
      peakNoise: normalizeSigned(ridgesFolded),
      ridgedPeak: normalizeSigned(ridgesFolded),
      rangeCrest,
      rangeNoise: normalizeSigned(ridges),
      upliftNoise: normalizeSigned(ridgesFolded),
      summitSignal,
      saddleSignal: clamp(mountainSignal * (1 - summitSignal), 0, 1),
      mountainDetail,
      mountainRibSignal,
      mountainPocketNoise: 0.5,
      mountainScreeSignal: clamp(rangeCrest * 0.45 + summitSignal * 0.35, 0, 1),
      mountainSignal,
      foldedRidge: smoothstep(-0.08, 0.72, ridgesFolded) * inland * lowErosion,
      plateauSignal: clamp(inland * smoothstep(0.42, 0.82, signedErosion) * (1 - mountainSignal), 0, 1),
      cliffSignal: clamp(rangeCrest * (1 - erosion), 0, 1),
      signedContinentalness,
      signedErosion,
      ridges,
      ridgesFolded,
      offset: this.randomState.router.depth.compute(context),
      factor: 1,
      jaggedness: rangeCrest,
      warpX,
      warpZ,
    };
    setLimitedCache(this.shapeCache, key, shape);
    return shape;
  }

  rawHeightAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;

    let height = this.baseHeightAt(x, z);
    if (
      height >= MINECRAFT_26_2_TERRAIN_TARGET.seaLevel &&
      height <= MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 27 &&
      this.shapeAt(x, z).signedContinentalness < -0.11
    ) {
      const supportRadius = 12;
      let landSupport = 0;
      for (const [ox, oz] of [
        [-supportRadius, 0], [supportRadius, 0], [0, -supportRadius], [0, supportRadius],
        [-supportRadius, -supportRadius], [supportRadius, -supportRadius],
        [-supportRadius, supportRadius], [supportRadius, supportRadius],
      ]) {
        if (this.baseHeightAt(x + ox, z + oz) >= MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 2) landSupport += 1;
      }
      if (landSupport < 3) height = MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 2;
    }

    setLimitedCache(this.heightCache, key, height);
    return height;
  }

  riverBiomeInfluenceAt(x, z) {
    // Official surface rivers occupy the deep valleys slice of the
    // peaks-and-valleys spline. This cheap router gate avoids running several
    // climate lookups for every ordinary terrain column; the broader -0.62
    // cutoff still includes the four-to-eight-block river shoulders.
    return this.riverBiomeInfluenceFromShape(this.shapeAt(x, z));
  }

  riverBiomeInfluenceFromShape(shape) {
    if (shape.ridgesFolded > -0.62 || shape.signedContinentalness < -0.24) return 0;

    const valleyInfluence = smoothstep(-0.62, -0.88, shape.ridgesFolded);
    const nearInland = shape.signedContinentalness <= 0.03;
    const ordinaryRiverErosion =
      shape.signedErosion >= -0.375 && shape.signedErosion <= 0.55;
    if (ordinaryRiverErosion) return valleyInfluence;
    // Low-erosion valley slices remain rivers near the coast/inland boundary,
    // as at the reported location. Extreme positive-erosion inland valleys
    // become swamps or frozen rivers in Minecraft's parameter table.
    if (nearInland && shape.signedErosion <= 0.55) return valleyInfluence;
    return 0;
  }

  isRiverBiomeAtSeaLevel(x, z) {
    const quartX = Math.floor(x / 4);
    const quartZ = Math.floor(z / 4);
    const key = `${quartX},${quartZ}`;
    const cached = this.riverBiomeCache.get(key);
    if (cached !== undefined) return cached;
    const biome = sampleMinecraft26SurfaceBiome(
      this.biomeParameters,
      this.randomState.sampler,
      quartX * 4,
      MINECRAFT_26_2_TERRAIN_TARGET.seaLevel,
      quartZ * 4,
    );
    const river = biome === "river" || biome === "frozen_river";
    setLimitedCache(this.riverBiomeCache, key, river);
    return river;
  }

  baseHeightAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.baseHeightCache.get(key);
    if (cached !== undefined) return cached;

    const grid = PRELIMINARY_SURFACE_GRID;
    const x0 = Math.floor(x / grid) * grid;
    const z0 = Math.floor(z / grid) * grid;
    const tx = (x - x0) / grid;
    const tz = (z - z0) / grid;
    const samples = [];
    let localMin = Infinity;
    let localMax = -Infinity;
    for (let oz = -1; oz <= 2; oz += 1) {
      const row = [];
      for (let ox = -1; ox <= 2; ox += 1) {
        const value = this.preliminarySurfaceAt(x0 + ox * grid, z0 + oz * grid);
        row.push(value);
        localMin = Math.min(localMin, value);
        localMax = Math.max(localMax, value);
      }
      samples.push(row);
    }
    const preliminary = clamp(bicubic(samples, tx, tz), localMin, localMax);
    const centralSamples = [samples[1][1], samples[1][2], samples[2][1], samples[2][2]];
    const coarseSpan = Math.max(...centralSamples) - Math.min(...centralSamples);
    const relief = Math.max(
      smoothstep(MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 18, 150, preliminary),
      smoothstep(5, 24, coarseSpan),
    );
    const baseNoise = this.base3dNoise.compute(
      DensityFunction.context(Math.floor(x), Math.round(preliminary), Math.floor(z)),
    );
    const baseDetail = baseNoise * lerp(6.3, 18, relief);
    const surfaceDetail =
      this.surfaceDetailNoise.sample(x * 0.35, 0, z * 0.35) * 1.7 +
      this.surfaceSecondaryNoise.sample(x * 0.9, 0, z * 0.9) * 0.9 +
      this.surfaceSecondaryNoise.sample(x * 4.5, 0, z * 4.5) * 0.22;
    // Broad, coordinate-shifted detail breaks up the long planar ramps that
    // otherwise make high terrain read as concentric voxel pyramids.
    const broadDetail = relief * (
      this.surfaceSecondaryNoise.sample(x * 0.02 + 173, 0, z * 0.02 - 211) * 3 +
      this.surfaceDetailNoise.sample(x * 0.035 - 307, 0, z * 0.035 + 419)
    );
    const shape = this.shapeAt(x, z);
    const geomorphology = this.geomorphologyAt(x, z, preliminary, shape, {
      west: lerp(samples[1][0], samples[2][0], tz),
      east: lerp(samples[1][3], samples[2][3], tz),
      north: lerp(samples[0][1], samples[0][2], tx),
      south: lerp(samples[3][1], samples[3][2], tx),
      radius: 12,
      localRelief: localMax - localMin,
    });
    let minecraftHeight = preliminary + baseDetail + broadDetail + surfaceDetail + geomorphology.heightDelta;
    if (minecraftHeight > HIGH_TERRAIN_COMPRESSION_START) {
      minecraftHeight = HIGH_TERRAIN_COMPRESSION_START +
        (minecraftHeight - HIGH_TERRAIN_COMPRESSION_START) * 0.65;
    }

    // Ocean and deep-ocean continentalness may have underwater hills, but the
    // surface-detail pass must never lift those hills into dotted land chains.
    const continentalness = shape.signedContinentalness;
    if (continentalness < -0.455) {
      minecraftHeight = Math.min(minecraftHeight, MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 12);
    } else if (continentalness < -0.19) {
      minecraftHeight = Math.min(minecraftHeight, MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 2);
    } else {
      // The preliminary router can put strong inland valleys at ocean-floor
      // heights. The old hard floor raised every such column to Y=65, creating
      // perfectly flat 128x128 regions even across hill and river biomes.
      // Use Minecraft's erosion/valley signals plus coherent surface noise so
      // inland lowlands remain near sea level without becoming a flat plate.
      const inlandShelf = smoothstep(-0.19, 0.03, continentalness);
      const lowlandRoll =
        this.surfaceSecondaryNoise.sample(
          x * 0.018 + 541,
          0,
          z * 0.018 - 613,
        ) * 4.8 +
        this.surfaceDetailNoise.sample(
          x * 0.041 - 173,
          0,
          z * 0.041 + 227,
        ) * 2.2;
      const valleyStrength = clamp(Math.max(shape.river, shape.valleyFloor * 0.72), 0, 1);
      const ordinaryLowland = MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 2 +
        lowlandRoll +
        baseNoise * 9 +
        (1 - shape.erosion) * shape.peaksAndValleys * 3.2;
      const riverLowland = MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 3 +
        this.surfaceSecondaryNoise.sample(
          x * 0.012 + 541,
          0,
          z * 0.012 - 613,
        ) * 1.8 + baseNoise * 2.2;
      const inlandTarget = lerp(ordinaryLowland, riverLowland, smoothstep(0.14, 0.72, valleyStrength));
      const shelfVariation = this.surfaceSecondaryNoise.sample(
        x * 0.018 + 541,
        0,
        z * 0.018 - 613,
      ) * 2;
      const inlandFloor = MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 32 +
        inlandShelf * (inlandTarget - (MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 32) + shelfVariation);
      minecraftHeight = Math.max(minecraftHeight, inlandFloor);
    }

    let height = clamp(
      Math.round(this.engineY(minecraftHeight)),
      1,
      this.worldHeight - 2,
    );

    // The biome builder and terrain height approximation must agree about
    // rivers. Carve the official router's river valley plus a narrow shoulder
    // using the shape already sampled for this column, avoiding another
    // shape-cache lookup in the terrain hot path.
    const riverInfluence = this.riverBiomeInfluenceFromShape(shape);
    if (riverInfluence > 0) {
      const bedVariation = this.surfaceSecondaryNoise.sample(
        x * 0.085 + 977,
        0,
        z * 0.085 - 811,
      );
      const centerDepth = 4.2 + bedVariation * 1.4;
      const channel = smoothstep(0.22, 0.92, riverInfluence);
      const riverBed = lerp(
        MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 1,
        MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - centerDepth,
        channel,
      );
      height = Math.min(height, Math.round(riverBed));
    }
    setLimitedCache(this.baseHeightCache, key, height);
    return height;
  }

  geomorphologyAt(x, z, preliminary, shape = this.shapeAt(x, z), neighborhood = null) {
    const radius = neighborhood?.radius ?? EROSION_SAMPLE_RADIUS;
    const west = neighborhood?.west ?? this.preliminarySurfaceAt(x - radius, z);
    const east = neighborhood?.east ?? this.preliminarySurfaceAt(x + radius, z);
    const north = neighborhood?.north ?? this.preliminarySurfaceAt(x, z - radius);
    const south = neighborhood?.south ?? this.preliminarySurfaceAt(x, z + radius);
    const neighborhoodMean = (west + east + north + south) * 0.25;
    const localRelief = neighborhood?.localRelief ?? (
      Math.max(west, east, north, south, preliminary) -
      Math.min(west, east, north, south, preliminary)
    );
    const slope = Math.hypot(east - west, south - north) / (radius * 2);
    const concavity = clamp((neighborhoodMean - preliminary) / 18, -1, 1);
    const inland = smoothstep(-0.08, 0.22, shape.signedContinentalness);
    const highland = smoothstep(
      MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 14,
      MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 82,
      preliminary,
    );

    // Analytic erosion proxy: zero-crossing corridors become broad tributary
    // valleys, and naturally concave/slope-heavy areas receive the strongest
    // incision. This is seamless across chunks unlike a per-chunk simulation.
    const drainage = shape.drainageSignal ?? 0;
    const drainageCorridor = smoothstep(0.04, 0.40, drainage);
    const incision = drainageCorridor * inland * (1 - highland * 0.38) * clamp(
      2.2 + Math.max(0, concavity) * 5.2 + slope * 7 + localRelief * 0.035,
      0,
      9.5,
    );
    const floodplain = smoothstep(0.12, 0.52, drainage) * inland * (1 - highland) *
      (1.25 + Math.max(0, concavity) * 1.75);

    // Thermal-erosion style talus relaxation softens only the most abrupt
    // broad router transitions while keeping real cliffs and summit faces.
    const talus = smoothstep(22, 68, localRelief) * smoothstep(0.34, 1.15, slope) *
      smoothstep(MINECRAFT_26_2_TERRAIN_TARGET.seaLevel + 18, 150, preliminary);
    const talusRelaxation = (neighborhoodMean - preliminary) * talus * 0.11;

    const mountainGate = smoothstep(0.20, 0.76, shape.mountainSignal);
    const mountainRibs = mountainGate * (1 - drainageCorridor * 0.72) * (
      (shape.mountainDetail ?? 0) * 4.8 + (shape.mountainRibSignal ?? 0) * 3.6
    );
    const foothillGate = smoothstep(0.08, 0.36, shape.mountainSignal) *
      (1 - smoothstep(0.50, 0.82, shape.mountainSignal));
    const foothills = foothillGate * this.surfaceDetailNoise.sample(
      (x + shape.warpX) * 0.012 + 887,
      0,
      (z + shape.warpZ) * 0.012 - 821,
    ) * 3.4;

    return {
      heightDelta: talusRelaxation + mountainRibs + foothills - incision - floodplain,
      drainage,
      drainageCorridor,
      localRelief,
      slope,
      concavity,
    };
  }

  preliminarySurfaceAt(x, z) {
    const key = columnKey(x, z);
    const cached = this.preliminarySurfaceCache.get(key);
    if (cached !== undefined) return cached;
    const value = this.randomState.router.preliminarySurfaceLevel.compute(
      DensityFunction.context(Math.floor(x), 0, Math.floor(z)),
    );
    setLimitedCache(this.preliminarySurfaceCache, key, value);
    return value;
  }

  densityAt(x, engineY, z) {
    return (this.rawHeightAt(x, z) + 0.5 - engineY) / 8;
  }

  officialDensityAt(x, engineY, z) {
    const context = DensityFunction.context(x, this.minecraftY(engineY), z);
    return this.randomState.router.finalDensity.compute(context);
  }

  surfaceDepthAt(x, z) {
    return this.randomState.surfaceSystem.getSurfaceDepth(Math.floor(x), Math.floor(z));
  }

  rawBiomeAt(x, z, engineY = this.rawHeightAt(x, z)) {
    return sampleMinecraft26SurfaceBiome(
      this.biomeParameters,
      this.randomState.sampler,
      x,
      this.minecraftY(engineY),
      z,
    );
  }

  biomeAt(x, z, engineY = this.rawHeightAt(x, z)) {
    const minecraftY = this.minecraftY(engineY);
    const center = this.rawBiomeAt(x, z, engineY);
    if (minecraftY < MINECRAFT_26_2_TERRAIN_TARGET.seaLevel) {
      const continentalness = this.shapeAt(x, z).signedContinentalness;
      // Only the ocean/coast continentalness bands become ocean biomes.
      // Inland river valleys can have floors well below sea level; replacing
      // every submerged biome by depth erased those rivers and mislabeled
      // inland lakes as deep ocean.
      if (continentalness >= -0.11) return center;
      return this.oceanBiomeAt(x, minecraftY, z);
    }
    // Surface biomes already come from Minecraft's quart-coordinate
    // multi-noise parameter list. A second 64-block majority filter replaced
    // roughly a third of sampled columns and created artificial boundaries.
    return center;
  }

  oceanBiomeAt(x, minecraftY, z) {
    const target = this.randomState.sampler.sample(
      Math.floor(x / 4),
      Math.floor(minecraftY / 4),
      Math.floor(z / 4),
    );
    const deep = minecraftY <= MINECRAFT_26_2_TERRAIN_TARGET.seaLevel - 12;
    if (target.temperature <= -0.45) return deep ? "deep_frozen_ocean" : "frozen_ocean";
    if (target.temperature <= -0.15) return deep ? "deep_cold_ocean" : "cold_ocean";
    if (target.temperature <= 0.2) return deep ? "deep_ocean" : "ocean";
    if (target.temperature <= 0.55) return deep ? "deep_lukewarm_ocean" : "lukewarm_ocean";
    return "warm_ocean";
  }

  populateChunk(cx, cz, blocks, waterLevels, Block, chunkSize = 16, chunkArea = 256) {
    if (chunkSize !== 16 || chunkArea !== 256) {
      throw new Error("Minecraft Java terrain generation requires 16x16 chunks.");
    }

    blocks.fill(Block.AIR);
    waterLevels.fill(0);
    const heights = new Int16Array(chunkArea);
    heights.fill(1);
    const worldX0 = cx * chunkSize;
    const worldZ0 = cz * chunkSize;

    for (let z = 0; z < chunkSize; z += 1) {
      for (let x = 0; x < chunkSize; x += 1) {
        const columnIndex = z * chunkSize + x;
        const worldX = worldX0 + x;
        const worldZ = worldZ0 + z;
        const topSolidY = this.rawHeightAt(worldX, worldZ);

        for (let engineY = 0; engineY < this.worldHeight; engineY += 1) {
          let block = engineY <= topSolidY ? Block.STONE : Block.AIR;
          if (engineY > topSolidY && engineY <= MINECRAFT_26_2_TERRAIN_TARGET.seaLevel) {
            block = Block.WATER;
          }
          if (engineY <= 4 && block === Block.STONE && bedrockAt(this.seed, worldX, engineY, worldZ)) {
            block = Block.BEDROCK;
          }
          const index = engineY * chunkArea + columnIndex;
          blocks[index] = block;
          waterLevels[index] = block === Block.WATER || block === Block.EXTRA_LAVA ? 1 : 0;
        }

        heights[columnIndex] = topSolidY;
      }
    }

    clearTransientDensityCaches(this.transientDensityCaches);
    return heights;
  }
}

function ensureMinecraft26Registries() {
  if (registriesLoaded) return;
  WorldgenRegistries.NOISE.clear();
  WorldgenRegistries.DENSITY_FUNCTION.clear();

  for (const [resourceId, json] of MINECRAFT_26_2_WORLDGEN.noise) {
    const id = Identifier.parse(resourceId);
    WorldgenRegistries.NOISE.register(id, () => WorldgenRegistries.NOISE.parse(json));
  }
  for (const [resourceId, json] of MINECRAFT_26_2_WORLDGEN.densityFunctions) {
    const id = Identifier.parse(resourceId);
    WorldgenRegistries.DENSITY_FUNCTION.register(
      id,
      () => WorldgenRegistries.DENSITY_FUNCTION.parse(json),
    );
  }

  const raw = MINECRAFT_26_2_WORLDGEN.settings;
  generatorSettings = NoiseGeneratorSettings.fromJson(raw);
  registriesLoaded = true;
}

function parseMinecraftSeed(value) {
  try {
    return BigInt.asIntN(64, BigInt(value));
  } catch {
    return 0n;
  }
}

function bedrockAt(seed, x, engineY, z) {
  if (engineY === 0) return true;
  const mixed = BigInt.asUintN(
    64,
    seed ^ BigInt(x) * 341873128712n ^ BigInt(z) * 132897987541n ^ BigInt(engineY) * 42317861n,
  );
  return Number(mixed & 0xffffn) / 0xffff < (5 - engineY) / 5;
}

function collectTransientDensityCaches(router) {
  const caches = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.values instanceof Map) caches.push(value.values);
    for (const [key, child] of Object.entries(value)) {
      if (key === "noise" || key === "noiseData" || key === "holder") continue;
      if (child instanceof DensityFunction) visit(child);
    }
  };
  for (const density of Object.values(router)) visit(density);
  return caches;
}

function clearTransientDensityCaches(caches) {
  for (const cache of caches) cache.clear();
}

function peaksAndValleys(value) {
  return -(Math.abs(Math.abs(value) - 2 / 3) - 1 / 3) * 3;
}

function normalizeSigned(value) {
  return clamp(value * 0.5 + 0.5, 0, 1);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function bicubic(samples, tx, tz) {
  const rows = samples.map((row) => cubic(row[0], row[1], row[2], row[3], tx));
  return cubic(rows[0], rows[1], rows[2], rows[3], tz);
}

function cubic(p0, p1, p2, p3, t) {
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const c = -0.5 * p0 + 0.5 * p2;
  return ((a * t + b) * t + c) * t + p1;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function columnKey(x, z) {
  return `${Math.floor(x)},${Math.floor(z)}`;
}

function setLimitedCache(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
