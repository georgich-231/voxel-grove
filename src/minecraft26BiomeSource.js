import { Climate } from "deepslate/worldgen";

const FULL = new Climate.Param(-1, 1);
const TEMPERATURES = ranges([[-1, -0.45], [-0.45, -0.15], [-0.15, 0.2], [0.2, 0.55], [0.55, 1]]);
const HUMIDITIES = ranges([[-1, -0.35], [-0.35, -0.1], [-0.1, 0.1], [0.1, 0.3], [0.3, 1]]);
const EROSIONS = ranges([[-1, -0.78], [-0.78, -0.375], [-0.375, -0.2225], [-0.2225, 0.05], [0.05, 0.45], [0.45, 0.55], [0.55, 1]]);
const FROZEN = TEMPERATURES[0];
const UNFROZEN = span(TEMPERATURES[1], TEMPERATURES[4]);
const MUSHROOM_FIELDS_CONTINENTALNESS = param(-1.2, -1.05);
const DEEP_OCEAN_CONTINENTALNESS = param(-1.05, -0.455);
const OCEAN_CONTINENTALNESS = param(-0.455, -0.19);
const COAST_CONTINENTALNESS = param(-0.19, -0.11);
const INLAND_CONTINENTALNESS = param(-0.11, 0.55);
const NEAR_INLAND_CONTINENTALNESS = param(-0.11, 0.03);
const MID_INLAND_CONTINENTALNESS = param(0.03, 0.3);
const FAR_INLAND_CONTINENTALNESS = param(0.3, 1);

const OCEANS = [
  ["deep_frozen_ocean", "deep_cold_ocean", "deep_ocean", "deep_lukewarm_ocean", "warm_ocean"],
  ["frozen_ocean", "cold_ocean", "ocean", "lukewarm_ocean", "warm_ocean"],
];
const MIDDLE_BIOMES = [
  ["snowy_plains", "snowy_plains", "snowy_plains", "snowy_taiga", "taiga"],
  ["plains", "plains", "forest", "taiga", "old_growth_spruce_taiga"],
  ["flower_forest", "plains", "forest", "birch_forest", "dark_forest"],
  ["savanna", "savanna", "forest", "jungle", "jungle"],
  ["desert", "desert", "desert", "desert", "desert"],
];
const MIDDLE_BIOMES_VARIANT = [
  ["ice_spikes", null, "snowy_taiga", null, null],
  [null, null, null, null, "old_growth_pine_taiga"],
  ["sunflower_plains", null, null, "old_growth_birch_forest", null],
  [null, null, "plains", "sparse_jungle", "bamboo_jungle"],
  [null, null, null, null, null],
];
const PLATEAU_BIOMES = [
  ["snowy_plains", "snowy_plains", "snowy_plains", "snowy_taiga", "snowy_taiga"],
  ["meadow", "meadow", "forest", "taiga", "old_growth_spruce_taiga"],
  ["meadow", "meadow", "meadow", "meadow", "pale_garden"],
  ["savanna_plateau", "savanna_plateau", "forest", "forest", "jungle"],
  ["badlands", "badlands", "badlands", "wooded_badlands", "wooded_badlands"],
];
const PLATEAU_BIOMES_VARIANT = [
  ["ice_spikes", null, null, null, null],
  ["cherry_grove", null, "meadow", "meadow", "old_growth_pine_taiga"],
  ["cherry_grove", "cherry_grove", "forest", "birch_forest", null],
  [null, null, null, null, null],
  ["eroded_badlands", "eroded_badlands", null, null, null],
];
const SHATTERED_BIOMES = [
  ["windswept_gravelly_hills", "windswept_gravelly_hills", "windswept_hills", "windswept_forest", "windswept_forest"],
  ["windswept_gravelly_hills", "windswept_gravelly_hills", "windswept_hills", "windswept_forest", "windswept_forest"],
  ["windswept_hills", "windswept_hills", "windswept_hills", "windswept_forest", "windswept_forest"],
  [null, null, null, null, null],
  [null, null, null, null, null],
];
const WEIRDNESS_SLICES = [
  ["mid", -1, -0.93333334],
  ["high", -0.93333334, -0.7666667],
  ["peaks", -0.7666667, -0.56666666],
  ["high", -0.56666666, -0.4],
  ["mid", -0.4, -0.26666668],
  ["low", -0.26666668, -0.05],
  ["valleys", -0.05, 0.05],
  ["low", 0.05, 0.26666668],
  ["mid", 0.26666668, 0.4],
  ["high", 0.4, 0.56666666],
  ["peaks", 0.56666666, 0.7666667],
  ["high", 0.7666667, 0.93333334],
  ["mid", 0.93333334, 1],
];

let cachedParameters = null;

export function createMinecraft26OverworldBiomeParameters() {
  if (cachedParameters) return cachedParameters;
  const entries = [];
  const builder = new Minecraft26OverworldBiomeBuilder((point, biome) => {
    entries.push([point, () => biome]);
  });
  builder.addBiomes();
  cachedParameters = new Climate.Parameters(entries);
  return cachedParameters;
}

export function sampleMinecraft26SurfaceBiome(parameters, sampler, x, minecraftY, z) {
  const quartX = Math.floor(x / 4);
  const quartY = Math.floor(minecraftY / 4);
  const quartZ = Math.floor(z / 4);
  return parameters.find(sampler.sample(quartX, quartY, quartZ));
}

class Minecraft26OverworldBiomeBuilder {
  constructor(add) {
    this.add = add;
  }

  addBiomes() {
    this.addOffCoastBiomes();
    for (const [slice, min, max] of WEIRDNESS_SLICES) {
      this[`add${capitalize(slice)}`](param(min, max));
    }
  }

  addOffCoastBiomes() {
    this.addSurface(FULL, FULL, MUSHROOM_FIELDS_CONTINENTALNESS, FULL, FULL, "mushroom_fields");
    for (let temperature = 0; temperature < TEMPERATURES.length; temperature += 1) {
      this.addSurface(TEMPERATURES[temperature], FULL, DEEP_OCEAN_CONTINENTALNESS, FULL, FULL, OCEANS[0][temperature]);
      this.addSurface(TEMPERATURES[temperature], FULL, OCEAN_CONTINENTALNESS, FULL, FULL, OCEANS[1][temperature]);
    }
  }

  addPeaks(weirdness) {
    this.forClimate((temperature, humidity, ti, hi) => {
      const middle = this.pickMiddle(ti, hi, weirdness);
      const middleOrBadlands = this.pickMiddleOrBadlands(ti, hi, weirdness);
      const middleOrBadlandsOrSlope = this.pickMiddleOrBadlandsOrSlope(ti, hi, weirdness);
      const plateau = this.pickPlateau(ti, hi, weirdness);
      const shattered = this.pickShattered(ti, hi, weirdness);
      const shatteredOrSavanna = this.maybeWindsweptSavanna(ti, hi, weirdness, shattered);
      const peak = this.pickPeak(ti, hi, weirdness);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[0], weirdness, peak);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[1], weirdness, middleOrBadlandsOrSlope);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[1], weirdness, peak);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), span(EROSIONS[2], EROSIONS[3]), weirdness, middle);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[2], weirdness, plateau);
      this.addSurface(temperature, humidity, MID_INLAND_CONTINENTALNESS, EROSIONS[3], weirdness, middleOrBadlands);
      this.addSurface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[3], weirdness, plateau);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], weirdness, middle);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[5], weirdness, shatteredOrSavanna);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], weirdness, shattered);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, middle);
    });
  }

  addHigh(weirdness) {
    this.forClimate((temperature, humidity, ti, hi) => {
      const middle = this.pickMiddle(ti, hi, weirdness);
      const middleOrBadlands = this.pickMiddleOrBadlands(ti, hi, weirdness);
      const middleOrBadlandsOrSlope = this.pickMiddleOrBadlandsOrSlope(ti, hi, weirdness);
      const plateau = this.pickPlateau(ti, hi, weirdness);
      const shattered = this.pickShattered(ti, hi, weirdness);
      const middleOrSavanna = this.maybeWindsweptSavanna(ti, hi, weirdness, middle);
      const slope = this.pickSlope(ti, hi, weirdness);
      const peak = this.pickPeak(ti, hi, weirdness);
      this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[1]), weirdness, middle);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[0], weirdness, slope);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[0], weirdness, peak);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[1], weirdness, middleOrBadlandsOrSlope);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[1], weirdness, slope);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), span(EROSIONS[2], EROSIONS[3]), weirdness, middle);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[2], weirdness, plateau);
      this.addSurface(temperature, humidity, MID_INLAND_CONTINENTALNESS, EROSIONS[3], weirdness, middleOrBadlands);
      this.addSurface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[3], weirdness, plateau);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], weirdness, middle);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[5], weirdness, middleOrSavanna);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], weirdness, shattered);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, middle);
    });
  }

  addMid(weirdness) {
    this.addSurface(FULL, FULL, COAST_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[2]), weirdness, "stony_shore");
    this.addSurface(span(TEMPERATURES[1], TEMPERATURES[2]), FULL, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "swamp");
    this.addSurface(span(TEMPERATURES[3], TEMPERATURES[4]), FULL, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "mangrove_swamp");
    this.forClimate((temperature, humidity, ti, hi) => {
      const middle = this.pickMiddle(ti, hi, weirdness);
      const middleOrBadlands = this.pickMiddleOrBadlands(ti, hi, weirdness);
      const middleOrBadlandsOrSlope = this.pickMiddleOrBadlandsOrSlope(ti, hi, weirdness);
      const shattered = this.pickShattered(ti, hi, weirdness);
      const plateau = this.pickPlateau(ti, hi, weirdness);
      const beach = this.pickBeach(ti);
      const middleOrSavanna = this.maybeWindsweptSavanna(ti, hi, weirdness, middle);
      const shatteredCoast = this.pickShatteredCoast(ti, hi, weirdness);
      const slope = this.pickSlope(ti, hi, weirdness);
      this.addSurface(temperature, humidity, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[0], weirdness, slope);
      this.addSurface(temperature, humidity, span(NEAR_INLAND_CONTINENTALNESS, MID_INLAND_CONTINENTALNESS), EROSIONS[1], weirdness, middleOrBadlandsOrSlope);
      this.addSurface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[1], weirdness, ti === 0 ? slope : plateau);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[2], weirdness, middle);
      this.addSurface(temperature, humidity, MID_INLAND_CONTINENTALNESS, EROSIONS[2], weirdness, middleOrBadlands);
      this.addSurface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[2], weirdness, plateau);
      this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[3], weirdness, middle);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[3], weirdness, middleOrBadlands);
      if (weirdness.max < 0) {
        this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[4], weirdness, beach);
        this.addSurface(temperature, humidity, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], weirdness, middle);
      } else {
        this.addSurface(temperature, humidity, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], weirdness, middle);
      }
      this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[5], weirdness, shatteredCoast);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[5], weirdness, middleOrSavanna);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], weirdness, shattered);
      this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[6], weirdness, weirdness.max < 0 ? beach : middle);
      if (ti === 0) this.addSurface(temperature, humidity, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, middle);
    });
  }

  addLow(weirdness) {
    this.addSurface(FULL, FULL, COAST_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[2]), weirdness, "stony_shore");
    this.addSurface(span(TEMPERATURES[1], TEMPERATURES[2]), FULL, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "swamp");
    this.addSurface(span(TEMPERATURES[3], TEMPERATURES[4]), FULL, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "mangrove_swamp");
    this.forClimate((temperature, humidity, ti, hi) => {
      const middle = this.pickMiddle(ti, hi, weirdness);
      const middleOrBadlands = this.pickMiddleOrBadlands(ti, hi, weirdness);
      const middleOrBadlandsOrSlope = this.pickMiddleOrBadlandsOrSlope(ti, hi, weirdness);
      const beach = this.pickBeach(ti);
      const middleOrSavanna = this.maybeWindsweptSavanna(ti, hi, weirdness, middle);
      const shatteredCoast = this.pickShatteredCoast(ti, hi, weirdness);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[1]), weirdness, middleOrBadlands);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), span(EROSIONS[0], EROSIONS[1]), weirdness, middleOrBadlandsOrSlope);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, span(EROSIONS[2], EROSIONS[3]), weirdness, middle);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), span(EROSIONS[2], EROSIONS[3]), weirdness, middleOrBadlands);
      this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, span(EROSIONS[3], EROSIONS[4]), weirdness, beach);
      this.addSurface(temperature, humidity, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], weirdness, middle);
      this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[5], weirdness, shatteredCoast);
      this.addSurface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[5], weirdness, middleOrSavanna);
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], weirdness, middle);
      this.addSurface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[6], weirdness, beach);
      if (ti === 0) this.addSurface(temperature, humidity, span(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, middle);
    });
  }

  addValleys(weirdness) {
    const negative = weirdness.max < 0;
    this.addSurface(FROZEN, FULL, COAST_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[1]), weirdness, negative ? "stony_shore" : "frozen_river");
    this.addSurface(UNFROZEN, FULL, COAST_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[1]), weirdness, negative ? "stony_shore" : "river");
    this.addSurface(FROZEN, FULL, NEAR_INLAND_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[1]), weirdness, "frozen_river");
    this.addSurface(UNFROZEN, FULL, NEAR_INLAND_CONTINENTALNESS, span(EROSIONS[0], EROSIONS[1]), weirdness, "river");
    this.addSurface(FROZEN, FULL, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), span(EROSIONS[2], EROSIONS[5]), weirdness, "frozen_river");
    this.addSurface(UNFROZEN, FULL, span(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), span(EROSIONS[2], EROSIONS[5]), weirdness, "river");
    this.addSurface(FROZEN, FULL, COAST_CONTINENTALNESS, EROSIONS[6], weirdness, "frozen_river");
    this.addSurface(UNFROZEN, FULL, COAST_CONTINENTALNESS, EROSIONS[6], weirdness, "river");
    this.addSurface(span(TEMPERATURES[1], TEMPERATURES[2]), FULL, span(INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "swamp");
    this.addSurface(span(TEMPERATURES[3], TEMPERATURES[4]), FULL, span(INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "mangrove_swamp");
    this.addSurface(FROZEN, FULL, span(INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], weirdness, "frozen_river");
    this.forClimate((temperature, humidity, ti, hi) => {
      this.addSurface(temperature, humidity, span(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), span(EROSIONS[0], EROSIONS[1]), weirdness, this.pickMiddleOrBadlands(ti, hi, weirdness));
    });
  }

  forClimate(callback) {
    for (let ti = 0; ti < TEMPERATURES.length; ti += 1) {
      for (let hi = 0; hi < HUMIDITIES.length; hi += 1) {
        callback(TEMPERATURES[ti], HUMIDITIES[hi], ti, hi);
      }
    }
  }

  addSurface(temperature, humidity, continentalness, erosion, weirdness, biome) {
    this.add(Climate.parameters(temperature, humidity, continentalness, erosion, point(0), weirdness, 0), biome);
    this.add(Climate.parameters(temperature, humidity, continentalness, erosion, point(1), weirdness, 0), biome);
  }

  pickMiddle(ti, hi, weirdness) {
    if (weirdness.max < 0) return MIDDLE_BIOMES[ti][hi];
    return MIDDLE_BIOMES_VARIANT[ti][hi] ?? MIDDLE_BIOMES[ti][hi];
  }

  pickMiddleOrBadlands(ti, hi, weirdness) {
    return ti === 4 ? this.pickBadlands(hi, weirdness) : this.pickMiddle(ti, hi, weirdness);
  }

  pickMiddleOrBadlandsOrSlope(ti, hi, weirdness) {
    return ti === 0 ? this.pickSlope(ti, hi, weirdness) : this.pickMiddleOrBadlands(ti, hi, weirdness);
  }

  maybeWindsweptSavanna(ti, hi, weirdness, fallback) {
    return ti > 1 && hi < 4 && weirdness.max >= 0 ? "windswept_savanna" : fallback;
  }

  pickShatteredCoast(ti, hi, weirdness) {
    const biome = weirdness.max >= 0 ? this.pickMiddle(ti, hi, weirdness) : this.pickBeach(ti);
    return this.maybeWindsweptSavanna(ti, hi, weirdness, biome);
  }

  pickBeach(ti) {
    if (ti === 0) return "snowy_beach";
    if (ti === 4) return "desert";
    return "beach";
  }

  pickBadlands(hi, weirdness) {
    if (hi < 2) return weirdness.max < 0 ? "badlands" : "eroded_badlands";
    if (hi < 3) return "badlands";
    return "wooded_badlands";
  }

  pickPlateau(ti, hi, weirdness) {
    const variant = PLATEAU_BIOMES_VARIANT[ti][hi];
    return weirdness.max >= 0 && variant ? variant : PLATEAU_BIOMES[ti][hi];
  }

  pickPeak(ti, hi, weirdness) {
    if (ti <= 2) return weirdness.max < 0 ? "jagged_peaks" : "frozen_peaks";
    if (ti === 3) return "stony_peaks";
    return this.pickBadlands(hi, weirdness);
  }

  pickSlope(ti, hi, weirdness) {
    if (ti >= 3) return this.pickPlateau(ti, hi, weirdness);
    return hi <= 1 ? "snowy_slopes" : "grove";
  }

  pickShattered(ti, hi, weirdness) {
    return SHATTERED_BIOMES[ti][hi] ?? this.pickMiddle(ti, hi, weirdness);
  }
}

function param(min, max = min) {
  return new Climate.Param(min, max);
}

function point(value) {
  return param(value);
}

function span(left, right) {
  return param(left.min, right.max);
}

function ranges(values) {
  return values.map(([min, max]) => param(min, max));
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
