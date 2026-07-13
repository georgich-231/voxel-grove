import * as THREE from "three";
import "./styles.css";
import {
  ATLAS_CELL_SIZE,
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  ATLAS_TILE_PADDING,
  ATLAS_TILE_SIZE,
  BLOCK_TEXTURE_FILES,
  BLOCK_TEXTURE_KEYS,
} from "./atlasKeys.js";
import {
  BIRCH_FOLIAGE_COLOR,
  SPRUCE_FOLIAGE_COLOR,
  biomeFoliageColor,
  biomeGrassColor,
  writePackedColor,
} from "./biomeColors.js";
import { BLOCK_TEXTURE_URL_BY_FILE } from "./blockTextureUrls.js";
import { Biome, createBiomeDefinitions } from "./biomes.js";
import {
  EXTRA_BLOCK_DEFINITIONS,
  EXTRA_BLOCK_DEFINITION_BY_BLOCK,
  RUNTIME_BLOCK_DEFINITIONS,
  DOOR_CLOSED_BLOCK_BY_OPEN,
  DOOR_OPEN_BLOCK_BY_CLOSED,
  DOOR_UPPER_BLOCK_BY_LOWER,
  DOOR_LOWER_BLOCK_BY_UPPER,
  TRAPDOOR_TOGGLE_BLOCK,
  getTrapdoorPlacementBlock,
  getExtraBlockFaceTexture,
  formatCreativeItemName,
  isCreativePlaceableBlockTexture,
  normalizeCreativeBlockItemId,
} from "./creativeContent.js";
import { getBlockShapeById } from "./blockShapes.js";
import { createOverworldGenerator } from "./worldgen.js";
import { MOB_CLASSES, rayIntersectsMob } from "./mobs.js";
import { PLAYER_SKIN_URL } from "./entityTextures.js";
import cloudsTextureUrl from "./assets/environment/clouds.png?url";
import moonPhasesTextureUrl from "./assets/environment/moon_phases.png?url";
import rainTextureUrl from "./assets/environment/rain.png?url";
import snowTextureUrl from "./assets/environment/snow.png?url";
import sunTextureUrl from "./assets/environment/sun.png?url";
import { waterMethods } from "./waterFlow.js";
import {
  DEFAULT_MULTIPLAYER_URL,
  MultiplayerClient,
  normalizeServerUrl,
  sanitizePlayerName,
} from "./multiplayer/client.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.0028 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);
      vec2 offset = center * dist * amount;
      float r = texture2D(tDiffuse, vUv - offset).r;
      vec4 g = texture2D(tDiffuse, vUv);
      float b = texture2D(tDiffuse, vUv + offset).b;
      gl_FragColor = vec4(r, g.g, b, g.a);
    }
  `,
};

const FOG_UNIFORMS = {
  fogColor: { value: new THREE.Color(0xc8deea) },
  fogNear: { value: 78 },
  fogFar: { value: 220 },
  fogEdgeBounds: { value: new THREE.Vector4(-128, -128, 128, 128) },
  fogEdgeWidth: { value: 32 },
  fogEdgeEnabled: { value: 1 },
  fogRadialStrength: { value: 0 },
};

const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    contrast: { value: 1.0 },
    brightness: { value: 1.0 },
    vignette: { value: 0.08 },
    warmth: { value: 0.4 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    uniform float vignette;
    uniform float warmth;
    varying vec2 vUv;

    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);

      // Split toning: subtly cool shadows, warm highlights
      float t = smoothstep(0.0, 1.0, luma);
      c *= mix(vec3(0.98, 0.99, 1.02), vec3(1.025, 1.005, 0.975), t);

      // Warm tint on bright surfaces
      float highlight = smoothstep(0.40, 0.90, luma);
      c.r += warmth * 0.012 * highlight;
      c.g += warmth * 0.004 * highlight;

      // Contrast
      c = (c - 0.5) * contrast + 0.5;

      // Brightness
      c *= brightness;

      // ACES filmic tone mapping — preserves rich midtones, tames blown highlights
      c = aces(c * 1.06);

      // Vignette
      vec2 uv2 = vUv - 0.5;
      float vig = 1.0 - vignette * dot(uv2, uv2) * 3.5;
      c *= clamp(vig, 0.0, 1.0);

      gl_FragColor = vec4(max(c, vec3(0.0)), texel.a);
    }
  `,
};

const ITEM_TEXTURE_URL_BY_KEY = createAssetUrlMap(
  import.meta.glob("./assets/items/*.png", { eager: true, import: "default", query: "?url" }),
);
const CREATIVE_BLOCK_TEXTURE_URL_BY_KEY = createAssetUrlMap(
  import.meta.glob("./assets/blocks/*.png", { eager: true, import: "default", query: "?url" }),
);
const BLOCK_TEXTURE_IMAGES = new Map();
const ENVIRONMENT_TEXTURES = [];
const EXTRUDED_ITEM_GEOMETRY_CACHE = new Map();
const EXTRUDED_ITEM_GEOMETRY_LOADS = new Map();
const HELD_ITEM_BASE_POSITION = Object.freeze({ x: 0.42, y: 0.02, z: 0.37 });
const HELD_TOOL_ROTATION = Object.freeze({ x: 0.65, y: -0.14, z: 0.16 });
const HELD_SPRITE_ROTATION = Object.freeze({ x: 0.7, y: -0.22, z: 0.14 });
const MAX_RENDER_PIXEL_RATIO = 2;
const POST_PROCESSING_MSAA_SAMPLES = 2;
const WORLD_TEXTURE_MIN_FILTER = THREE.LinearMipmapLinearFilter;
const BASE_TONE_MAPPING_EXPOSURE = 1.0;
const NIGHT_VISION_TONE_MAPPING_EXPOSURE = 1.04;
const TERRAIN_DYNAMIC_SHADOWS = false;
const MULTIPLAYER_URL_STORAGE_KEY = "voxel-grove.multiplayer-url.v1";
const MULTIPLAYER_NAME_STORAGE_KEY = "voxel-grove.multiplayer-name.v1";

const ENVIRONMENT_TEXTURE_LOADER = new THREE.TextureLoader();

const HIDDEN_CREATIVE_ITEM_TEXTURES = new Set([
  "fishing_rod_cast",
  "quiver",
  "ruby",
]);

const INTERNAL_CREATIVE_ITEM_IDS = new Set([
  "dry_grass",
  "jungle_grass",
  "meadow_grass",
  "savanna_grass",
  "snow_grass",
]);

const HIDDEN_ASSET_BACKED_BLOCK_TEXTURES = new Set([
  "lava_still",
  "water_still",
]);

function loadEnvironmentTexture(url, options = {}) {
  const texture = ENVIRONMENT_TEXTURE_LOADER.load(url, (loadedTexture) => {
    if (options.alphaFromBlack && loadedTexture.image) {
      loadedTexture.image = createAlphaCutoutCanvas(loadedTexture.image, options.blackThreshold ?? 20);
      loadedTexture.needsUpdate = true;
    }
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = WORLD_TEXTURE_MIN_FILTER;
  texture.generateMipmaps = true;
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(options.repeat[0], options.repeat[1]);
  }
  ENVIRONMENT_TEXTURES.push(texture);
  return texture;
}

function createAlphaCutoutCanvas(image, threshold) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const r = pixels.data[index];
    const g = pixels.data[index + 1];
    const b = pixels.data[index + 2];
    if (r <= threshold && g <= threshold && b <= threshold) {
      pixels.data[index + 3] = 0;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

function createRainColumnGeometry(width, height, repeatY) {
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const positions = [
    -halfW, -halfH, 0,
     halfW, -halfH, 0,
     halfW,  halfH, 0,
    -halfW,  halfH, 0,
  ];
  const uvs = [
    0, 0,
    1, 0,
    1, repeatY,
    0, repeatY,
  ];
  const indices = [0, 1, 2, 0, 2, 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createGroundSplashGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];

  const addStrip = (angle, length, width) => {
    const base = positions.length / 3;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const lx = dx * length * 0.5;
    const lz = dz * length * 0.5;
    const wx = px * width * 0.5;
    const wz = pz * width * 0.5;
    positions.push(
      -lx - wx, 0, -lz - wz,
       lx - wx, 0,  lz - wz,
       lx + wx, 0,  lz + wz,
      -lx + wx, 0, -lz + wz,
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  addStrip(0, 1.05, 0.055);
  addStrip(Math.PI * 0.5, 0.82, 0.045);
  addStrip(Math.PI * 0.25, 0.62, 0.04);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function wrapRepeatingWeatherCoord(center, local, span) {
  return local + Math.round((center - local) / span) * span;
}

const SUN_TEXTURE = loadEnvironmentTexture(sunTextureUrl, { alphaFromBlack: true, blackThreshold: 96 });
const MOON_PHASES_TEXTURE = loadEnvironmentTexture(moonPhasesTextureUrl, { alphaFromBlack: true, blackThreshold: 42 });
const CLOUD_TEXTURE = loadEnvironmentTexture(cloudsTextureUrl, { repeat: [1, 1] });
const RAIN_TEXTURE = loadEnvironmentTexture(rainTextureUrl);
const SNOW_TEXTURE = loadEnvironmentTexture(snowTextureUrl);
RAIN_TEXTURE.wrapS = THREE.ClampToEdgeWrapping;
RAIN_TEXTURE.wrapT = THREE.RepeatWrapping;
RAIN_TEXTURE.repeat.set(1, 1);
SNOW_TEXTURE.wrapS = THREE.ClampToEdgeWrapping;
SNOW_TEXTURE.wrapT = THREE.RepeatWrapping;
SNOW_TEXTURE.repeat.set(1, 1);

queueMicrotask(() => {
  loadNamedBlockTextures()
    .then(applyNamedBlockTextures)
    .catch((error) => {
      console.error(error);
    });
});

export const CHUNK_SIZE = 16;
const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const WORLD_HEIGHT = 320;
const SEA_LEVEL = 63;
const WATER_LEVEL = SEA_LEVEL;
export const WATER_MAX_DEPTH = 7;
const WATER_DEPTH_VISIBILITY_LIMIT = 18;
const WATER_LEVEL_STORE_MASK = 0x0f;
const WATER_FALLING_STORE_FLAG = 0x10;
const WATER_FLOW_INTERVAL = 0.05;
export const WATER_FLOW_UPDATES_PER_STEP = 512;
export const WATER_PLACED_FLOW_DELAY_TICKS = 5;
export const WATER_FLOW_PLAN_MAX_CELLS = 4096;
export const WATER_FLOW_PLAN_MAX_TICKS = WATER_PLACED_FLOW_DELAY_TICKS * WORLD_HEIGHT;
const WATER_ANIMATION_FRAMES_PER_SECOND = 6;
export const WATER_LEVEL_DECREASE = 1;
const LAVA_MAX_DEPTH = WATER_MAX_DEPTH;
const LAVA_LEVEL_DECREASE = WATER_LEVEL_DECREASE;
const LAVA_FLOW_INTERVAL = 0.05;
const LAVA_FLOW_UPDATES_PER_STEP = WATER_FLOW_UPDATES_PER_STEP;
const LAVA_PLACED_FLOW_DELAY_TICKS = WATER_PLACED_FLOW_DELAY_TICKS;
export const WATER_MAX_FLOW_DISTANCE = 5;
const LAVA_MAX_FLOW_DISTANCE = WATER_MAX_FLOW_DISTANCE;
export const LIQUID_HORIZONTAL_DIRECTIONS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);
const RENDER_DISTANCE = 8;
const MIN_RENDER_DISTANCE = 2;
// FIX: MAX_RENDER_DISTANCE doubled (16 → 32). The slider lets the user push the
// view out to far MC-Java distances. Combined with CHUNK_DATA_CACHE_LIMIT below
// (data-only LRU cache), backtracking through previously-visited chunks no longer
// pays for re-generation — only a mesh rebuild.
const MAX_RENDER_DISTANCE = 32;
const GRAPHICS_SETTINGS_STORAGE_KEY = "voxel-grove.graphics-settings.v1";
const DEFAULT_RESOLUTION_PRESET = "1280x720";
const RESOLUTION_PRESETS = Object.freeze([
  { id: "1280x720", label: "1280 x 720", width: 1280, height: 720 },
  { id: "1366x768", label: "1366 x 768", width: 1366, height: 768 },
  { id: "1600x900", label: "1600 x 900", width: 1600, height: 900 },
  { id: "1920x1080", label: "1920 x 1080", width: 1920, height: 1080 },
  { id: "2560x1440", label: "2560 x 1440", width: 2560, height: 1440 },
]);
const RESOLUTION_PRESET_BY_ID = new Map(RESOLUTION_PRESETS.map((preset) => [preset.id, preset]));
const TITLE_RENDER_DISTANCE = 5;

function readGraphicsSettings() {
  try {
    const raw = localStorage.getItem(GRAPHICS_SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeGraphicsSettings(settings) {
  try {
    localStorage.setItem(GRAPHICS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in strict/private contexts; settings still work for this session.
  }
}

function resolveResolutionPresetId(id) {
  return RESOLUTION_PRESET_BY_ID.has(id) ? id : DEFAULT_RESOLUTION_PRESET;
}

function renderResolutionOptions(selectedId) {
  return RESOLUTION_PRESETS.map((preset) => {
    const selected = preset.id === selectedId ? " selected" : "";
    return `<option value="${preset.id}"${selected}>${preset.label}</option>`;
  }).join("");
}

function savedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function savedBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
// Data-only LRU cache of evicted chunks. Each entry stores blocks, waterLevels,
// and its generation detail.
// (~96 KB each at 16x16x256). 1024 chunks is still reasonable on desktop and
// lets creative-mode block IDs grow beyond the old 8-bit range.
// and covers a 32x32 chunk neighbourhood (twice the max render distance) of recent
// state without any worldgen work on return.
const CHUNK_DATA_CACHE_LIMIT = 1024;
const MINECRAFT_SEED_MIN = -(1n << 63n);
const MINECRAFT_SEED_MAX = (1n << 63n) - 1n;
const TITLE_CHUNK_BUILD_BUDGET = 144;
const CHUNK_BUILD_BUDGET = 56;
const CHUNK_CREATE_BUDGET = 56;
const CHUNK_UPDATE_INTERVAL_SECONDS = 0.06;
const CHUNK_PLAY_TIME_BUDGET_MS = 9;
const CHUNK_LOADING_TIME_BUDGET_MS = 24;
const CHUNK_TITLE_TIME_BUDGET_MS = 24;
const NEAR_CHUNK_MESH_WITHOUT_NEIGHBORS_RADIUS = 2;
const MAX_CHUNK_MESH_WORKERS = 3;
const CHUNK_MESH_QUEUE_PER_WORKER = 10;
const MAX_CHUNK_GENERATION_WORKERS = 3;
const CHUNK_GENERATION_QUEUE_PER_WORKER = 18;
const SPAWN_LOADING_RADIUS = 6;
const SPAWN_READY_RADIUS = 1;
const SPAWN_MESH_READY_RADIUS = 0;
const FULL_DETAIL_CHUNK_RADIUS = 3;
const SURFACE_GENERATION_PRIORITY_OFFSET = 50000;
const FULL_DETAIL_GENERATION_PRIORITY_OFFSET = 100000;
const CHUNK_REMESH_PRIORITY_OFFSET = 100000;
const CHUNK_BACKGROUND_PREFETCH_RING = 1;
const CHUNK_RETENTION_RING = 4;
const WATER_WAVE_ANIMATION_CHUNKS = 7;
const TEXTURE_ANISOTROPY_LIMIT = 16;
const MINECRAFT_DAY_TICKS = 24000;
const DAY_LENGTH_SECONDS = 20 * 60;
const SKY_BODY_DISTANCE = 900;
const SUN_BODY_SIZE = 450;
const MOON_BODY_SIZE = 294;
const MOON_PHASE_COUNT = 8;
const MIN_SHADOW_VIEW_RADIUS = 96;
const SHADOW_VIEW_PADDING = 32;

const ChunkGenerationDetail = Object.freeze({
  NONE: "none",
  TERRAIN: "terrain",
  SURFACE: "surface",
  FULL: "full",
});

function chunkGenerationDetailRank(detail) {
  if (detail === ChunkGenerationDetail.FULL) return 3;
  if (detail === ChunkGenerationDetail.SURFACE) return 2;
  if (detail === ChunkGenerationDetail.TERRAIN) return 1;
  return 0;
}

function chunkHasGenerationDetail(chunk, detail) {
  return Boolean(chunk?.generated) &&
    chunkGenerationDetailRank(chunk.generationDetail) >= chunkGenerationDetailRank(detail);
}

function chunkHasVisibleMesh(chunk) {
  return Boolean(chunk?.mesh || chunk?.leafMesh || chunk?.torchMesh || chunk?.waterMesh || chunk?.lavaMesh);
}

function maxChunkGenerationDetail(a, b) {
  return chunkGenerationDetailRank(a) >= chunkGenerationDetailRank(b) ? a : b;
}

function chunkWorkerCounts() {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const workerBudget = Math.max(2, Math.min(6, Math.floor(cores) - 1));
  const generation = clamp(Math.ceil(workerBudget * 0.5), 1, MAX_CHUNK_GENERATION_WORKERS);
  const mesh = clamp(workerBudget - generation, 1, MAX_CHUNK_MESH_WORKERS);
  return { generation, mesh };
}
const MAX_SHADOW_VIEW_RADIUS = 420;
const CLOUD_HEIGHT = 156;
const CLOUD_TILE_SIZE = 176;
const CLOUD_GRID_RADIUS = 4;
const CLOUD_WIND_SPEED = 1.15;
const CLOUD_PUFF_GAP = 4;
const RAIN_GRID_RADIUS = 20;
const RAIN_GRID_SIZE = RAIN_GRID_RADIUS * 2 + 1;
const RAIN_PARTICLE_COUNT = RAIN_GRID_SIZE * RAIN_GRID_SIZE;
const SNOW_LAYERS_PER_CELL = 5;
const SNOW_PARTICLE_COUNT = RAIN_PARTICLE_COUNT * SNOW_LAYERS_PER_CELL;
const PRECIPITATION_COLUMN_CACHE_LIMIT = 8192;
const SPLASH_PARTICLE_COUNT = 48;
const GROUND_DROPLET_COUNT = 48;
const GROUND_DROPLET_SPOT_COUNT = 72;
const PRECIPITATION_RADIUS = 34;
const PRECIPITATION_HEIGHT = 36;
const PRECIPITATION_CEILING_ABOVE_CAMERA = 58;
const PRECIPITATION_FLOOR_BELOW_CAMERA = 32;
const RAIN_IMPACT_RADIUS = 8.5;
const RAIN_COLUMN_WIDTH = 0.38;
const RAIN_COLUMN_HEIGHT = 34;
const RAIN_TEXTURE_REPEAT_Y = 5;
const RAIN_TEXTURE_SCROLL_SPEED = 1.75;
const SNOW_COLUMN_WIDTH = 1.24;
const SNOW_COLUMN_HEIGHT = 3.8;
const SNOW_TEXTURE_REPEAT_Y = 1.0;
const SNOW_TEXTURE_SCROLL_SPEED = 0;
const RAIN_FALL_SPEED_MIN = 15;
const RAIN_FALL_SPEED_MAX = 23;
const SNOW_FALL_SPEED_MIN = 0.16;
const SNOW_FALL_SPEED_MAX = 0.34;
const SPLASH_LIFE_SECONDS = 0.24;
const GROUND_DROPLET_LIFE_SECONDS = 0.28;
const GROUND_DROPLET_SPOT_LIFE_SECONDS = 0.42;
const GROUND_DROPLET_GRAVITY = 13.5;
const THUNDER_LIGHTNING_MIN = 4;
const THUNDER_LIGHTNING_MAX = 20;
const WEATHER_FADE_IN_SPEED = 0.6;
const WEATHER_FADE_OUT_SPEED = 0.35;
const WEATHER_CLEAR_MIN_SECONDS = 6 * 60;
const WEATHER_CLEAR_MAX_SECONDS = 15 * 60;
const WEATHER_RAIN_MIN_SECONDS = 2 * 60;
const WEATHER_RAIN_MAX_SECONDS = 5 * 60;
const INTERACTION_REACH = 6;
const MAX_PASSIVE_MOBS = 20;
const PASSIVE_MOB_HERD_MIN = 2;
const PASSIVE_MOB_HERD_MAX = 4;
const PASSIVE_MOB_HERD_RADIUS = 5;
const PASSIVE_MOB_INITIAL_HERDS = 1;
const PASSIVE_MOB_INITIAL_SPAWN_DELAY = 7;
const PASSIVE_MOB_SPAWN_MIN_SECONDS = 34;
const PASSIVE_MOB_SPAWN_MAX_SECONDS = 55;
const TICKS_PER_SECOND = 20;
const PLAYER_HEIGHT = 1.8;
const PLAYER_EYE_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.3;
const PLAYER_EPSILON = 0.001;
const GRAVITY = 32;
const VERTICAL_DRAG_PER_TICK = 0.98;
const ITEM_ENTITY_RADIUS = 0.18;
const ITEM_ENTITY_HEIGHT = 0.28;
const ITEM_GRAVITY = 18;
const ITEM_AIR_DRAG_PER_TICK = 0.98;
const ITEM_GROUND_DRAG_PER_TICK = 0.68;
const ITEM_WATER_DRAG_PER_TICK = 0.82;
const ITEM_WATER_BUOYANCY = 5.2;
const ITEM_PICKUP_DELAY_SECONDS = 0.45;
const ITEM_THROW_PICKUP_DELAY_SECONDS = 1.6;
const ITEM_PICKUP_RADIUS = 1.05;
const ITEM_ATTRACT_RADIUS = 2.45;
const ITEM_ATTRACT_ACCELERATION = 18;
const ITEM_DESPAWN_SECONDS = 300;
const WATER_GRAVITY = 4.8;
const WATER_SWIM_SPEED = 2.35;
const WATER_SPRINT_SWIM_SPEED = 3.45;
const WATER_VERTICAL_SPEED = 5.2;
const WATER_SURFACE_VERTICAL_SPEED = 1.15;
const WATER_BREACH_SPEED = 8.5;
const WATER_BREACH_COOLDOWN_SECONDS = 0.42;
const WATER_BREACH_COAST_SECONDS = 0.12;
const WATER_BREACH_MIN_OFFSET = 0.035;
const WATER_BREACH_MAX_OFFSET = 0.15;
const WATER_BREACH_HOLD_SECONDS = 0.18;
const WATER_TAP_SUPPRESS_SECONDS = 0.38;
const WATER_BREACH_RESET_DEPTH = 0.85;
const WATER_SURFACE_APPROACH_OFFSET = 0.34;
const WATER_SURFACE_BOB_MAX_ABOVE = 0.78;
const WATER_HELD_SURFACE_SINK_SPEED = 2.35;
const WATER_SURFACE_BOB_SINK_SPEED = 3.25;
const WATER_SURFACE_BOB_MIN_DOWN_SPEED = 0.95;
const WATER_SINK_SPEED = 0.42;
const VINE_CLIMB_SPEED = 2.35;
const VINE_SLIDE_SPEED = 1.15;
const JUMP_SPEED = 8.4;
const WALK_SPEED = 4.317;
const SPRINT_SPEED = 5.612;
const SNEAK_SPEED = 1.3;
const FLY_SPEED = 10.89;
const FLY_SPRINT_SPEED = 21.78;
const DOUBLE_SPACE_MS = 750;
const MAX_HEALTH = 20;
const MAX_HUNGER = 20;
const MAX_SATURATION = 5;
const MAX_AIR_TICKS = 300;
const DAMAGE_INVULNERABILITY_SECONDS = 0.5;
const CACTUS_DAMAGE_INTERVAL_SECONDS = 0.5;
const DROWN_DAMAGE_INTERVAL_SECONDS = 1;
const STARVATION_DAMAGE_INTERVAL_SECONDS = 3;
const HEALTH_REGEN_INTERVAL_SECONDS = 4;
const HUNGER_EXHAUSTION_LIMIT = 4;
const SPRINT_EXHAUSTION_PER_METER = 0.1;
const WALK_EXHAUSTION_PER_METER = 0.01;
const SWIM_EXHAUSTION_PER_METER = 0.01;
const JUMP_EXHAUSTION = 0.05;
const SPRINT_JUMP_EXHAUSTION = 0.2;
const INVENTORY_SIZE = 36;
const CRAFT_SLOT_COUNT = 4;
const HOTBAR_SIZE = 9;
const HOTBAR_START = INVENTORY_SIZE - HOTBAR_SIZE;
const HOTBAR_SLOT_INDICES = Array.from({ length: HOTBAR_SIZE }, (_, index) => HOTBAR_START + index);
const MAIN_INVENTORY_SLOT_INDICES = Array.from({ length: HOTBAR_START }, (_, index) => index);
const PICKUP_SLOT_ORDER = [...HOTBAR_SLOT_INDICES, ...MAIN_INVENTORY_SLOT_INDICES];
const CRAFTING_INGREDIENT_SLOT_ORDER = [...MAIN_INVENTORY_SLOT_INDICES, ...HOTBAR_SLOT_INDICES];
const CREATIVE_ITEM_STACK_SIZE = 64;
const CREATIVE_TABS = Object.freeze([
  { id: "blocks", label: "Blocks" },
  { id: "decorations", label: "Decor" },
  { id: "redstone", label: "Redstone" },
  { id: "transport", label: "Transport" },
  { id: "misc", label: "Misc" },
  { id: "search", label: "Search" },
  { id: "food", label: "Food" },
  { id: "tools", label: "Tools" },
  { id: "combat", label: "Combat" },
  { id: "brewing", label: "Brewing" },
  { id: "materials", label: "Materials" },
]);
const BLOCK_BREAK_PARTICLE_COUNT = 28;
const BLOCK_BREAK_PARTICLE_LIFE_MIN = 0.45;
const BLOCK_BREAK_PARTICLE_LIFE_MAX = 0.78;
const SURVIVAL_BREAK_TIME_SCALE = 1;
const SURVIVAL_BLOCK_BREAK_DELAY_SECONDS = 6 / TICKS_PER_SECOND;
const FURNACE_COOK_SECONDS = 10;
const FURNACE_RECIPES = Object.freeze({
  // Food
  raw_beef: "beef_cooked",
  beef_raw: "beef_cooked",
  raw_chicken: "chicken_cooked",
  chicken_raw: "chicken_cooked",
  raw_porkchop: "porkchop_cooked",
  porkchop_raw: "porkchop_cooked",
  mutton_raw: "mutton_cooked",
  rabbit_raw: "rabbit_cooked",
  fish_cod_raw: "fish_cod_cooked",
  fish_salmon_raw: "fish_salmon_cooked",
  potato: "potato_baked",
  // Raw metals
  raw_iron: "iron_ingot",
  raw_copper: "copper_ingot",
  raw_gold: "gold_ingot",
  // Ores
  iron_ore: "iron_ingot",
  gold_ore: "gold_ingot",
  copper_ore: "copper_ingot",
  coal_ore: "coal",
  diamond_ore: "diamond",
  emerald_ore: "emerald",
  redstone_ore: "redstone_dust",
  lapis_ore: "dye_powder_blue",
  quartz_ore: "quartz",
  // Blocks
  cobblestone: "stone",
  sand: "glass",
  red_sand: "glass",
  log: "charcoal",
  spruce_log: "charcoal",
  birch_log: "charcoal",
  jungle_log: "charcoal",
  acacia_log: "charcoal",
  dark_oak_log: "charcoal",
  clay_ball: "brick",
  cactus: "dye_powder_green",
});
const FURNACE_FUELS = Object.freeze({
  coal: 80,
  charcoal: 80,
  log: 15,
  spruce_log: 15,
  birch_log: 15,
  jungle_log: 15,
  acacia_log: 15,
  dark_oak_log: 15,
  plank: 15,
  planks_oak: 15,
  planks_spruce: 15,
  planks_birch: 15,
  planks_jungle: 15,
  planks_acacia: 15,
  planks_big_oak: 15,
  stick: 5,
});
const DEFAULT_WORLD_SEED = "4095200884";
const LOCATE_BIOME_DEFAULT_RADIUS = 16384;
const LOCATE_BIOME_MAX_RADIUS = 65536;
const LOCATE_BIOME_NEAR_RADIUS = 4096;
const LOCATE_BIOME_MID_RADIUS = 8192;
const LOCATE_BIOME_NEAR_STEP = 16;
const LOCATE_BIOME_MID_STEP = 32;
const LOCATE_BIOME_FAR_STEP = 64;
const LOCATE_BIOME_REFINE_STEP = 8;
const DESTROY_STAGE_FILES = Array.from({ length: 10 }, (_, stage) => `destroy_stage_${stage}.png`);
const CHAT_COMMAND_DEFINITIONS = [
  {
    name: "help",
    usage: "/help",
    description: "Show every command.",
  },
  {
    name: "gamemode",
    aliases: ["gm"],
    usage: "/gamemode <survival|creative|spectator>",
    description: "Change your game mode.",
  },
  {
    name: "tp",
    usage: "/tp <x> <y> <z>",
    description: "Teleport, with ~ relative coordinates.",
  },
  {
    name: "give",
    usage: "/give <item> [count]",
    description: "Add an item stack to inventory.",
  },
  {
    name: "summon",
    usage: "/summon <entity> [x y z]",
    description: "Summon an entity.",
  },
  {
    name: "locatebiome",
    aliases: ["locate"],
    usage: "/locatebiome <biome> [radius]",
    description: "Find the nearest biome.",
  },
  {
    name: "time",
    usage: "/time <set|add|query> <value>",
    description: "Change or read the day time.",
  },
  {
    name: "weather",
    usage: "/weather [clear|rain|thunder] [seconds]",
    description: "Change the weather, or query current state.",
  },
  {
    name: "fly",
    usage: "/fly",
    description: "Toggle Creative flight.",
  },
  {
    name: "seed",
    usage: "/seed",
    description: "Print the current seed.",
  },
  {
    name: "clear",
    usage: "/clear",
    description: "Clear chat.",
  },
];
const GAME_MODE_ARGUMENTS = ["survival", "creative", "spectator"];
const CHAT_FADE_AFTER_SECONDS = 6;
const CHAT_FADE_DURATION_SECONDS = 1.2;
const MAX_LIGHT_LEVEL = 15;
const LIGHT_PROPAGATION_PADDING = MAX_LIGHT_LEVEL;
const MIN_LIGHT_FACTOR = 0.03;
const MAX_BLOCK_LIGHT_FACTOR = 1.86;
const BLOCK_LIGHT_GREEN_FACTOR = 0.86;
const BLOCK_LIGHT_BLUE_FACTOR = 0.66;
const DYNAMIC_BLOCK_LIGHT_COLOR = 0xffd49a;
const DEFAULT_WATER_TINT = 0x3f76e4;
const SHALLOW_WATER_TINT = 0x73d8ff;
const DEEP_WATER_TINT = 0x0f337f;
const SWAMP_WATER_TINT = 0x617b64;
const COLD_WATER_TINT = 0x3d57d6;
const FROZEN_WATER_TINT = 0x3938c9;
const UNDERWATER_WATER_TINT = 0x1e4f9f;
const WATER_DEPTH_ALPHA_MIN = 0.34;
const WATER_DEPTH_ALPHA_MAX = 0.62;
const WATER_SKY_LIGHT_LOSS_MIN = 7;
const WATER_SKY_LIGHT_LOSS_MAX = 14;
const DYNAMIC_BLOCK_LIGHT_COUNT = 6;
const DYNAMIC_BLOCK_LIGHT_RANGE = 30;
const DYNAMIC_BLOCK_LIGHT_INTENSITY = 3.1;
const DYNAMIC_BLOCK_LIGHT_UPDATE_SECONDS = 0.18;
const MINECRAFT_LIGHT_LEVELS = Object.freeze({
  torch: 14,
  furnace: 13,
  soulTorch: 10,
  redstoneTorch: 7,
  glowstone: 15,
  lava: 15,
  jackOLantern: 15,
});
let smoothLightingEnabled = true;
let fullBrightLightingEnabled = false;

export const Block = {
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

const BLOCKS = {
  [Block.GRASS]: {
    name: "Grass",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "dirt",
    top: 0x59a942,
    bottom: 0x7a5c38,
    side: 0x6f8142,
  },
  [Block.DIRT]: {
    name: "Dirt",
    solid: true,
    hardness: 0.5,
    material: "soil",
    drop: "dirt",
    top: 0x7d5c37,
    bottom: 0x63462d,
    side: 0x765535,
  },
  [Block.STONE]: {
    name: "Stone",
    solid: true,
    hardness: 1.5,
    miningTier: 0,
    drop: "cobblestone",
    top: 0x87939d,
    bottom: 0x66727b,
    side: 0x79848d,
  },
  [Block.SAND]: {
    name: "Sand",
    solid: true,
    hardness: 0.5,
    material: "soil",
    drop: "sand",
    top: 0xd9c878,
    bottom: 0xbca760,
    side: 0xcdba6f,
  },
  [Block.LOG]: {
    name: "Oak Log",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "log",
    top: 0x8c6338,
    bottom: 0x8c6338,
    side: 0x705031,
  },
  [Block.LEAVES]: {
    name: "Oak Leaves",
    solid: true,
    hardness: 0.2,
    material: "leaves",
    drop: "leaves",
    top: 0x4f9b49,
    bottom: 0x336f3a,
    side: 0x3f8743,
  },
  [Block.PLANK]: {
    name: "Oak Planks",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "plank",
    top: 0xb88642,
    bottom: 0x876031,
    side: 0xa7773a,
  },
  [Block.CLAY]: {
    name: "Clay",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "clay",
    top: 0xa7b8ac,
    bottom: 0x72877f,
    side: 0x8ca096,
  },
  [Block.BEDROCK]: {
    name: "Bedrock",
    solid: true,
    breakTime: Infinity,
    top: 0x303438,
    bottom: 0x1c1f22,
    side: 0x282c30,
  },
  [Block.CRAFTING_TABLE]: {
    name: "Crafting Table",
    solid: true,
    hardness: 2.5,
    material: "wood",
    drop: "crafting_table",
    top: 0xc69a56,
    bottom: 0x7d5831,
    side: 0x9c6d38,
  },
  [Block.PODZOL]: {
    name: "Podzol",
    solid: true,
    hardness: 0.5,
    material: "soil",
    drop: "podzol",
    top: 0x6d4a2d,
    bottom: 0x4c3927,
    side: 0x5a4330,
  },
  [Block.JUNGLE_GRASS]: {
    name: "Jungle Grass",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "mud",
    top: 0x46a23b,
    bottom: 0x4d3b2b,
    side: 0x526f37,
  },
  [Block.MUD]: {
    name: "Mud",
    solid: true,
    hardness: 0.5,
    material: "soil",
    drop: "mud",
    top: 0x5a4634,
    bottom: 0x3a2b22,
    side: 0x4d3b2d,
  },
  [Block.SANDSTONE]: {
    name: "Sandstone",
    solid: true,
    hardness: 0.8,
    miningTier: 0,
    drop: "sandstone",
    top: 0xd8c57d,
    bottom: 0xb79d59,
    side: 0xcab56f,
  },
  [Block.SPRUCE_LOG]: {
    name: "Spruce Log",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "spruce_log",
    top: 0x8a6a45,
    bottom: 0x8a6a45,
    side: 0x4d3424,
  },
  [Block.SPRUCE_LEAVES]: {
    name: "Spruce Leaves",
    solid: true,
    hardness: 0.2,
    material: "leaves",
    drop: "spruce_leaves",
    top: 0x2f6b46,
    bottom: 0x1f4e38,
    side: 0x265b3f,
  },
  [Block.JUNGLE_LOG]: {
    name: "Jungle Log",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "jungle_log",
    top: 0x9f7445,
    bottom: 0x9f7445,
    side: 0x755238,
  },
  [Block.JUNGLE_LEAVES]: {
    name: "Jungle Leaves",
    solid: true,
    hardness: 0.2,
    material: "leaves",
    drop: "jungle_leaves",
    top: 0x36a047,
    bottom: 0x1f7134,
    side: 0x2c8a3d,
  },
  [Block.CACTUS]: {
    name: "Cactus",
    solid: true,
    hardness: 0.4,
    drop: "cactus",
    top: 0x4aa852,
    bottom: 0x2f7a3e,
    side: 0x338b42,
  },
  [Block.WATER]: {
    name: "Water",
    solid: false,
    liquid: true,
    breakTime: Infinity,
    top: 0x5ca8df,
    bottom: 0x2f6fa8,
    side: 0x3f8ec8,
  },
  [Block.GRAVEL]: {
    name: "Gravel",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "gravel",
    top: 0x8c8a80,
    bottom: 0x68665f,
    side: 0x7c7a72,
  },
  [Block.COBBLESTONE]: {
    name: "Cobblestone",
    solid: true,
    hardness: 2.0,
    miningTier: 0,
    drop: "cobblestone",
    top: 0x777f84,
    bottom: 0x555d63,
    side: 0x687176,
  },
  [Block.COAL_ORE]: {
    name: "Coal Ore",
    solid: true,
    hardness: 3.0,
    miningTier: 0,
    drop: "coal",
    top: 0x6d777f,
    bottom: 0x4f5961,
    side: 0x626d75,
  },
  [Block.IRON_ORE]: {
    name: "Iron Ore",
    solid: true,
    hardness: 3.0,
    miningTier: 1,
    drop: "raw_iron",
    top: 0x8b7d6e,
    bottom: 0x675b50,
    side: 0x7b6c5f,
  },
  [Block.COPPER_ORE]: {
    name: "Copper Ore",
    solid: true,
    hardness: 3.0,
    miningTier: 1,
    drop: "raw_copper",
    top: 0x7b8278,
    bottom: 0x55615a,
    side: 0x6c746b,
  },
  [Block.GOLD_ORE]: {
    name: "Gold Ore",
    solid: true,
    hardness: 3.0,
    miningTier: 2,
    drop: "raw_gold",
    top: 0x92805a,
    bottom: 0x625640,
    side: 0x7d6c4b,
  },
  [Block.DIAMOND_ORE]: {
    name: "Diamond Ore",
    solid: true,
    hardness: 3.0,
    miningTier: 2,
    drop: "diamond",
    top: 0x6c9293,
    bottom: 0x4b696d,
    side: 0x5f8183,
  },
  [Block.RED_SAND]: {
    name: "Red Sand",
    solid: true,
    hardness: 0.5,
    material: "soil",
    drop: "red_sand",
    top: 0xc36f3d,
    bottom: 0x96502d,
    side: 0xb46035,
  },
  [Block.TERRACOTTA]: {
    name: "Terracotta",
    solid: true,
    hardness: 1.25,
    miningTier: 0,
    drop: "terracotta",
    top: 0xb66b4d,
    bottom: 0x834735,
    side: 0xa15d43,
  },
  [Block.WHITE_TERRACOTTA]: {
    name: "White Terracotta",
    solid: true,
    hardness: 1.25,
    miningTier: 0,
    drop: "white_terracotta",
    top: 0xd3b59f,
    bottom: 0x9b806e,
    side: 0xc0a08a,
  },
  [Block.SNOW_GRASS]: {
    name: "Snowy Grass",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "dirt",
    top: 0xf1f7f7,
    bottom: 0x7a5c38,
    side: 0xdce9e4,
  },
  [Block.SNOW]: {
    name: "Snow",
    solid: true,
    hardness: 0.2,
    material: "soil",
    drop: "snow",
    top: 0xf4fbfb,
    bottom: 0xb7c7ca,
    side: 0xdce9ea,
  },
  [Block.BIRCH_LOG]: {
    name: "Birch Log",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "birch_log",
    top: 0xc69c5e,
    bottom: 0xc69c5e,
    side: 0xd9d4bd,
  },
  [Block.BIRCH_LEAVES]: {
    name: "Birch Leaves",
    solid: true,
    hardness: 0.2,
    material: "leaves",
    drop: "birch_leaves",
    top: 0x78b84d,
    bottom: 0x4e7f35,
    side: 0x66a343,
  },
  [Block.MOSS]: {
    name: "Moss",
    solid: true,
    hardness: 0.1,
    material: "leaves",
    drop: "moss",
    top: 0x4f8f3a,
    bottom: 0x355f2c,
    side: 0x447b34,
  },
  [Block.WILDFLOWER]: {
    name: "Wildflower",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "wildflower",
    top: 0xf3cf4f,
    bottom: 0x336e2c,
    side: 0x4c9a3c,
  },
  [Block.FERN]: {
    name: "Fern",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "fern",
    top: 0x4aa348,
    bottom: 0x255c2c,
    side: 0x367a35,
  },
  [Block.MEADOW_GRASS]: {
    name: "Meadow Grass",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "dirt",
    top: 0x7fbc4f,
    bottom: 0x7a5c38,
    side: 0x729852,
  },
  [Block.DRY_GRASS]: {
    name: "Dry Grass",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "dirt",
    top: 0xa6a34f,
    bottom: 0x7a5c38,
    side: 0x8a7a40,
  },
  [Block.ACACIA_LOG]: {
    name: "Acacia Log",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "acacia_log",
    top: 0xa85f38,
    bottom: 0xa85f38,
    side: 0x6f4a35,
  },
  [Block.ACACIA_LEAVES]: {
    name: "Acacia Leaves",
    solid: true,
    hardness: 0.2,
    material: "leaves",
    drop: "acacia_leaves",
    top: 0x6f9440,
    bottom: 0x465f2d,
    side: 0x587638,
  },
  [Block.LIMESTONE]: {
    name: "Limestone",
    solid: true,
    hardness: 1.5,
    miningTier: 0,
    drop: "limestone",
    top: 0xb4b9aa,
    bottom: 0x858a80,
    side: 0xa1a79a,
  },
  [Block.BASALT]: {
    name: "Basalt",
    solid: true,
    hardness: 1.25,
    miningTier: 0,
    drop: "basalt",
    top: 0x3f464a,
    bottom: 0x22282c,
    side: 0x31383d,
  },
  [Block.SLATE]: {
    name: "Slate",
    solid: true,
    hardness: 1.5,
    miningTier: 0,
    drop: "slate",
    top: 0x5f6973,
    bottom: 0x39424b,
    side: 0x4c5660,
  },
  [Block.TALL_GRASS]: {
    name: "Tall Grass",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "tall_grass",
    top: 0x89bf48,
    bottom: 0x3f7430,
    side: 0x5f9a3d,
  },
  [Block.GRANITE]: {
    name: "Granite",
    solid: true,
    hardness: 1.5,
    miningTier: 0,
    drop: "granite",
    top: 0xa97968,
    bottom: 0x735044,
    side: 0x936858,
  },
  [Block.DIORITE]: {
    name: "Diorite",
    solid: true,
    hardness: 1.5,
    miningTier: 0,
    drop: "diorite",
    top: 0xc9cbc2,
    bottom: 0x8c9089,
    side: 0xb2b6ad,
  },
  [Block.ANDESITE]: {
    name: "Andesite",
    solid: true,
    hardness: 1.5,
    miningTier: 0,
    drop: "andesite",
    top: 0x919995,
    bottom: 0x676f6c,
    side: 0x7d8582,
  },
  [Block.DEEPSLATE]: {
    name: "Deepslate",
    solid: true,
    hardness: 3.0,
    miningTier: 0,
    drop: "deepslate",
    top: 0x555c61,
    bottom: 0x2f363b,
    side: 0x444c52,
  },
  [Block.ICE]: {
    name: "Ice",
    solid: true,
    hardness: 0.5,
    miningTier: 0,
    drop: "ice",
    top: 0xb8e7f3,
    bottom: 0x72aeca,
    side: 0x93d0e4,
  },
  [Block.PACKED_ICE]: {
    name: "Packed Ice",
    solid: true,
    hardness: 0.5,
    miningTier: 0,
    drop: "packed_ice",
    top: 0x95cae6,
    bottom: 0x4e8eb5,
    side: 0x70b5d8,
  },
  [Block.DANDELION]: {
    name: "Dandelion",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "dandelion",
    top: 0xf5d84b,
    bottom: 0x3b7a2f,
    side: 0x5e9a38,
  },
  [Block.POPPY]: {
    name: "Poppy",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "poppy",
    top: 0xd54535,
    bottom: 0x376d2c,
    side: 0x5c8d35,
  },
  [Block.BLUE_ORCHID]: {
    name: "Blue Orchid",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "blue_orchid",
    top: 0x6bb9e8,
    bottom: 0x2f6f38,
    side: 0x438a48,
  },
  [Block.DEAD_BUSH]: {
    name: "Dead Bush",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "dead_bush",
    top: 0xaa7c45,
    bottom: 0x6f4a2d,
    side: 0x8c6338,
  },
  [Block.BERRY_BUSH]: {
    name: "Berry Bush",
    solid: false,
    plant: true,
    breakTime: 0.25,
    drop: "berry_bush",
    top: 0xba3d4d,
    bottom: 0x2f6b38,
    side: 0x4a803a,
  },
  [Block.SUGAR_CANE]: {
    name: "Sugar Cane",
    solid: false,
    plant: true,
    breakTime: 0.15,
    drop: "sugar_cane",
    top: 0xa4d46b,
    bottom: 0x477f3b,
    side: 0x74ad4d,
  },
  [Block.PUMPKIN]: {
    name: "Pumpkin",
    solid: true,
    hardness: 1,
    material: "wood",
    drop: "pumpkin",
    top: 0xd48931,
    bottom: 0x8b501f,
    side: 0xb96525,
  },
  [Block.MELON]: {
    name: "Melon",
    solid: true,
    hardness: 1,
    material: "wood",
    drop: "melon",
    top: 0xa7bd49,
    bottom: 0x4c742f,
    side: 0x78a53f,
  },
  [Block.VINE]: {
    name: "Vine",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "vine",
    top: 0x4f9b3d,
    bottom: 0x27652e,
    side: 0x37813b,
  },
  [Block.COARSE_DIRT]: {
    name: "Coarse Dirt",
    solid: true,
    hardness: 0.5,
    material: "soil",
    drop: "coarse_dirt",
    top: 0x8a6b43,
    bottom: 0x5a3d27,
    side: 0x725336,
  },
  [Block.SAVANNA_GRASS]: {
    name: "Savanna Grass",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "dirt",
    top: 0xb4ad58,
    bottom: 0x7a5c38,
    side: 0x927f42,
  },
  [Block.CLOVER]: {
    name: "Clover",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "clover",
    top: 0xbce57a,
    bottom: 0x3f7f36,
    side: 0x6aaa4a,
  },
  [Block.SAVANNA_SHRUB]: {
    name: "Savanna Shrub",
    solid: false,
    plant: true,
    breakTime: 0.12,
    drop: "savanna_shrub",
    top: 0xc7b66b,
    bottom: 0x6d5f32,
    side: 0x9a873f,
  },
  [Block.DARK_OAK_LOG]: {
    name: "Dark Oak Log",
    solid: true,
    hardness: 2,
    material: "wood",
    drop: "dark_oak_log",
    top: 0x4a321f,
    bottom: 0x4a321f,
    side: 0x362515,
  },
  [Block.DARK_OAK_LEAVES]: {
    name: "Dark Oak Leaves",
    solid: true,
    hardness: 0.2,
    material: "leaves",
    drop: "dark_oak_leaves",
    top: 0x2f5f28,
    bottom: 0x1f431f,
    side: 0x285424,
  },
  [Block.MYCELIUM]: {
    name: "Mycelium",
    solid: true,
    hardness: 0.6,
    material: "soil",
    drop: "dirt",
    top: 0x8a7aa5,
    bottom: 0x6b5036,
    side: 0x745f63,
  },
  [Block.BROWN_MUSHROOM]: {
    name: "Brown Mushroom",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "brown_mushroom",
    top: 0x8f6f4a,
    bottom: 0x5b3d2b,
    side: 0x7a5638,
  },
  [Block.RED_MUSHROOM]: {
    name: "Red Mushroom",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "red_mushroom",
    top: 0xc7463d,
    bottom: 0xf2e4cf,
    side: 0xb13c37,
  },
  [Block.SUNFLOWER]: {
    name: "Sunflower",
    solid: false,
    plant: true,
    breakTime: 0.12,
    drop: "sunflower",
    top: 0xf3d34b,
    bottom: 0x487d32,
    side: 0xd6b63f,
  },
  [Block.WATERLILY]: {
    name: "Lily Pad",
    solid: false,
    plant: true,
    breakTime: 0.1,
    drop: "waterlily",
    top: 0x2f7f35,
    bottom: 0x255f2a,
    side: 0x2f7f35,
  },
};

const ITEMS = {
  grass: { name: "Grass Block", color: 0x59a942, block: Block.GRASS, maxStack: 64 },
  dirt: { name: "Dirt", color: 0x7d5c37, block: Block.DIRT, maxStack: 64 },
  stone: { name: "Stone", color: 0x87939d, block: Block.STONE, maxStack: 64 },
  sand: { name: "Sand", color: 0xd9c878, block: Block.SAND, maxStack: 64 },
  log: { name: "Oak Log", color: 0x8c6338, block: Block.LOG, maxStack: 64 },
  leaves: { name: "Oak Leaves", color: 0x4f9b49, block: Block.LEAVES, maxStack: 64 },
  plank: { name: "Oak Planks", color: 0xb88642, block: Block.PLANK, maxStack: 64 },
  clay: { name: "Clay", color: 0x8ca096, block: Block.CLAY, maxStack: 64 },
  crafting_table: { name: "Crafting Table", color: 0xc69a56, block: Block.CRAFTING_TABLE, maxStack: 64 },
  stick: { name: "Stick", color: 0xb7874d, maxStack: 64 },
  podzol: { name: "Podzol", color: 0x6d4a2d, block: Block.PODZOL, maxStack: 64 },
  jungle_grass: { name: "Jungle Grass", color: 0x46a23b, block: Block.JUNGLE_GRASS, maxStack: 64 },
  mud: { name: "Mud", color: 0x4d3b2d, block: Block.MUD, maxStack: 64 },
  sandstone: { name: "Sandstone", color: 0xcab56f, block: Block.SANDSTONE, maxStack: 64 },
  spruce_log: { name: "Spruce Log", color: 0x4d3424, block: Block.SPRUCE_LOG, maxStack: 64 },
  spruce_leaves: { name: "Spruce Leaves", color: 0x265b3f, block: Block.SPRUCE_LEAVES, maxStack: 64 },
  jungle_log: { name: "Jungle Log", color: 0x755238, block: Block.JUNGLE_LOG, maxStack: 64 },
  jungle_leaves: { name: "Jungle Leaves", color: 0x2c8a3d, block: Block.JUNGLE_LEAVES, maxStack: 64 },
  cactus: { name: "Cactus", color: 0x338b42, block: Block.CACTUS, maxStack: 64 },
  gravel: { name: "Gravel", color: 0x7c7a72, block: Block.GRAVEL, maxStack: 64 },
  cobblestone: { name: "Cobblestone", color: 0x687176, block: Block.COBBLESTONE, maxStack: 64 },
  coal_ore: { name: "Coal Ore", color: 0x4f5961, block: Block.COAL_ORE, maxStack: 64 },
  iron_ore: { name: "Iron Ore", color: 0x9a7b5f, block: Block.IRON_ORE, maxStack: 64 },
  copper_ore: { name: "Copper Ore", color: 0x9a6f55, block: Block.COPPER_ORE, maxStack: 64 },
  gold_ore: { name: "Gold Ore", color: 0xc59b3d, block: Block.GOLD_ORE, maxStack: 64 },
  diamond_ore: { name: "Diamond Ore", color: 0x52c7c7, block: Block.DIAMOND_ORE, maxStack: 64 },
  red_sand: { name: "Red Sand", color: 0xb46035, block: Block.RED_SAND, maxStack: 64 },
  terracotta: { name: "Terracotta", color: 0xa15d43, block: Block.TERRACOTTA, maxStack: 64 },
  white_terracotta: { name: "White Terracotta", color: 0xc0a08a, block: Block.WHITE_TERRACOTTA, maxStack: 64 },
  snow_grass: { name: "Snowy Grass", color: 0xdce9e4, block: Block.SNOW_GRASS, maxStack: 64 },
  snow: { name: "Snow", color: 0xf4fbfb, block: Block.SNOW, maxStack: 64 },
  birch_log: { name: "Birch Log", color: 0xd9d4bd, block: Block.BIRCH_LOG, maxStack: 64 },
  birch_leaves: { name: "Birch Leaves", color: 0x66a343, block: Block.BIRCH_LEAVES, maxStack: 64 },
  moss: { name: "Moss", color: 0x447b34, block: Block.MOSS, maxStack: 64 },
  wildflower: { name: "Wildflower", color: 0xf3cf4f, block: Block.WILDFLOWER, maxStack: 64 },
  fern: { name: "Fern", color: 0x367a35, block: Block.FERN, maxStack: 64 },
  meadow_grass: { name: "Meadow Grass", color: 0x7fbc4f, block: Block.MEADOW_GRASS, maxStack: 64 },
  dry_grass: { name: "Dry Grass", color: 0xa6a34f, block: Block.DRY_GRASS, maxStack: 64 },
  acacia_log: { name: "Acacia Log", color: 0x6f4a35, block: Block.ACACIA_LOG, maxStack: 64 },
  acacia_leaves: { name: "Acacia Leaves", color: 0x587638, block: Block.ACACIA_LEAVES, maxStack: 64 },
  limestone: { name: "Limestone", color: 0xa1a79a, block: Block.LIMESTONE, maxStack: 64 },
  basalt: { name: "Basalt", color: 0x31383d, block: Block.BASALT, maxStack: 64 },
  slate: { name: "Slate", color: 0x4c5660, block: Block.SLATE, maxStack: 64 },
  tall_grass: { name: "Tall Grass", color: 0x5f9a3d, block: Block.TALL_GRASS, maxStack: 64 },
  granite: { name: "Granite", color: 0x936858, block: Block.GRANITE, maxStack: 64 },
  diorite: { name: "Diorite", color: 0xb2b6ad, block: Block.DIORITE, maxStack: 64 },
  andesite: { name: "Andesite", color: 0x7d8582, block: Block.ANDESITE, maxStack: 64 },
  deepslate: { name: "Deepslate", color: 0x444c52, block: Block.DEEPSLATE, maxStack: 64 },
  ice: { name: "Ice", color: 0x93d0e4, block: Block.ICE, maxStack: 64 },
  packed_ice: { name: "Packed Ice", color: 0x70b5d8, block: Block.PACKED_ICE, maxStack: 64 },
  dandelion: { name: "Dandelion", color: 0xf5d84b, block: Block.DANDELION, maxStack: 64 },
  poppy: { name: "Poppy", color: 0xd54535, block: Block.POPPY, maxStack: 64 },
  blue_orchid: { name: "Blue Orchid", color: 0x6bb9e8, block: Block.BLUE_ORCHID, maxStack: 64 },
  dead_bush: { name: "Dead Bush", color: 0x8c6338, block: Block.DEAD_BUSH, maxStack: 64 },
  berry_bush: { name: "Berry Bush", color: 0x4a803a, block: Block.BERRY_BUSH, maxStack: 64 },
  sugar_cane: { name: "Sugar Cane", color: 0x74ad4d, block: Block.SUGAR_CANE, maxStack: 64 },
  pumpkin: { name: "Pumpkin", color: 0xb96525, block: Block.PUMPKIN, maxStack: 64 },
  melon: { name: "Melon", color: 0x78a53f, block: Block.MELON, maxStack: 64 },
  vine: { name: "Vine", color: 0x37813b, block: Block.VINE, maxStack: 64 },
  coarse_dirt: { name: "Coarse Dirt", color: 0x725336, block: Block.COARSE_DIRT, maxStack: 64 },
  savanna_grass: { name: "Savanna Grass", color: 0xb4ad58, block: Block.SAVANNA_GRASS, maxStack: 64 },
  clover: { name: "Clover", color: 0x6aaa4a, block: Block.CLOVER, maxStack: 64 },
  savanna_shrub: { name: "Savanna Shrub", color: 0x9a873f, block: Block.SAVANNA_SHRUB, maxStack: 64 },
  dark_oak_log: { name: "Dark Oak Log", color: 0x362515, block: Block.DARK_OAK_LOG, maxStack: 64 },
  dark_oak_leaves: { name: "Dark Oak Leaves", color: 0x285424, block: Block.DARK_OAK_LEAVES, maxStack: 64 },
  mycelium: { name: "Mycelium", color: 0x8a7aa5, block: Block.MYCELIUM, maxStack: 64 },
  brown_mushroom: { name: "Brown Mushroom", color: 0x7a5638, block: Block.BROWN_MUSHROOM, maxStack: 64 },
  red_mushroom: { name: "Red Mushroom", color: 0xb13c37, block: Block.RED_MUSHROOM, maxStack: 64 },
  sunflower: { name: "Sunflower", color: 0xf3d34b, block: Block.SUNFLOWER, maxStack: 64 },
  waterlily: { name: "Lily Pad", color: 0x2f7f35, block: Block.WATERLILY, maxStack: 64 },
  feather: { name: "Feather", color: 0xf2efe5, maxStack: 64 },
  leather: { name: "Leather", color: 0x9a6b3f, maxStack: 64 },
  raw_chicken: { name: "Raw Chicken", color: 0xe2b6a0, maxStack: 64 },
  raw_porkchop: { name: "Raw Porkchop", color: 0xf3a8a0, maxStack: 64 },
  raw_beef: { name: "Raw Beef", color: 0xc54f3a, maxStack: 64 },
  beef_cooked: { name: "Cooked Beef", color: 0x7a3a1e, maxStack: 64 },
  chicken_cooked: { name: "Cooked Chicken", color: 0xc8854a, maxStack: 64 },
  porkchop_cooked: { name: "Cooked Porkchop", color: 0xc26030, maxStack: 64 },
  raw_iron: { name: "Raw Iron", color: 0x9a7b5f, maxStack: 64 },
  raw_copper: { name: "Raw Copper", color: 0xb07045, maxStack: 64 },
  raw_gold: { name: "Raw Gold", color: 0xc59b3d, maxStack: 64 },
  copper_ingot: { name: "Copper Ingot", color: 0xc1804c, maxStack: 64 },
  wheat_seeds: { name: "Wheat Seeds", color: 0x7ea63d, maxStack: 64 },
  flint: { name: "Flint", color: 0x454554, maxStack: 64 },
};

registerExtraCreativeBlocks();
registerAssetBackedCreativeItems();
const CREATIVE_ITEM_IDS = Object.freeze(createCreativeItemIds());

const BIOMES = createBiomeDefinitions(Block);

const TREE_BLOCKS = {
  oak: {
    log: Block.LOG,
    leaves: Block.LEAVES,
  },
  spruce: {
    log: Block.SPRUCE_LOG,
    leaves: Block.SPRUCE_LEAVES,
  },
  jungle: {
    log: Block.JUNGLE_LOG,
    leaves: Block.JUNGLE_LEAVES,
  },
  birch: {
    log: Block.BIRCH_LOG,
    leaves: Block.BIRCH_LEAVES,
  },
  acacia: {
    log: Block.ACACIA_LOG,
    leaves: Block.ACACIA_LEAVES,
  },
  dark_oak: {
    log: Block.DARK_OAK_LOG,
    leaves: Block.DARK_OAK_LEAVES,
  },
};

const SPAWN_UNSAFE_GROUND = new Set([
  Block.LOG,
  Block.LEAVES,
  Block.SPRUCE_LOG,
  Block.SPRUCE_LEAVES,
  Block.JUNGLE_LOG,
  Block.JUNGLE_LEAVES,
  Block.BIRCH_LOG,
  Block.BIRCH_LEAVES,
  Block.ACACIA_LOG,
  Block.ACACIA_LEAVES,
  Block.DARK_OAK_LOG,
  Block.DARK_OAK_LEAVES,
  Block.CACTUS,
  Block.CRAFTING_TABLE,
]);

const LEAF_BLOCKS = new Set([
  Block.LEAVES,
  Block.SPRUCE_LEAVES,
  Block.JUNGLE_LEAVES,
  Block.BIRCH_LEAVES,
  Block.ACACIA_LEAVES,
  Block.DARK_OAK_LEAVES,
]);
const GRASS_TINT_BLOCKS = new Set([
  Block.GRASS,
  Block.JUNGLE_GRASS,
  Block.MEADOW_GRASS,
  Block.DRY_GRASS,
  Block.SAVANNA_GRASS,
]);
const GRASS_TINT_PLANTS = new Set([
  Block.FERN,
  Block.TALL_GRASS,
  Block.SUGAR_CANE,
  Block.CLOVER,
]);
const FOLIAGE_TINT_PLANTS = new Set([Block.VINE, Block.WATERLILY]);
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
for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
  if (definition.leaf) LEAF_BLOCKS.add(definition.block);
}
const LIGHT_OPACITY_MASK = new Uint8Array(512);
const BLOCK_LIGHT_SOURCE_MASK = new Uint8Array(512);
(function buildLightMasks() {
  for (let b = 0; b < 512; b++) {
    LIGHT_OPACITY_MASK[b] = getLightOpacity(b);
    BLOCK_LIGHT_SOURCE_MASK[b] = getBlockLightSource(b);
  }
})();
const FULL_BLOCK_BOUNDS = Object.freeze({
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
});
const CACTUS_BLOCK_BOUNDS = Object.freeze({
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
});

const LOG_ITEM_IDS = new Set(["log", "spruce_log", "jungle_log", "birch_log", "acacia_log", "dark_oak_log"]);

const PICKAXE_TIERS = Object.freeze({ wood: 0, stone: 1, iron: 2, diamond: 3, gold: 0 });

const LOG_TO_PLANK = Object.freeze({
  log: "planks_oak",
  spruce_log: "planks_spruce",
  birch_log: "planks_birch",
  jungle_log: "planks_jungle",
  acacia_log: "planks_acacia",
  dark_oak_log: "planks_big_oak",
});

const PLANK_ITEM_IDS = new Set(["plank", ...Object.values(LOG_TO_PLANK)]);

const BLOCK_ITEM_BY_BLOCK = new Map(
  Object.entries(ITEMS)
    .filter(([, item]) => item.block)
    .map(([id, item]) => [item.block, id]),
);

const HORIZONTAL_DIRECTIONS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);
const WALL_TORCH_SUPPORT_OFFSETS = Object.freeze({
  torch_on_wall_north: [0, 0, -1],
  torch_on_wall_south: [0, 0, 1],
  torch_on_wall_east: [1, 0, 0],
  torch_on_wall_west: [-1, 0, 0],
});

const VINE_FACE_DEFS = Object.freeze([
  {
    support: [-1, 0],
    normal: [1, 0, 0],
    vertices: [
      [0.032, 0, 1],
      [0.032, 1, 1],
      [0.032, 1, 0],
      [0.032, 0, 0],
    ],
  },
  {
    support: [1, 0],
    normal: [-1, 0, 0],
    vertices: [
      [0.968, 0, 0],
      [0.968, 1, 0],
      [0.968, 1, 1],
      [0.968, 0, 1],
    ],
  },
  {
    support: [0, -1],
    normal: [0, 0, 1],
    vertices: [
      [0, 0, 0.032],
      [0, 1, 0.032],
      [1, 1, 0.032],
      [1, 0, 0.032],
    ],
  },
  {
    support: [0, 1],
    normal: [0, 0, -1],
    vertices: [
      [1, 0, 0.968],
      [1, 1, 0.968],
      [0, 1, 0.968],
      [0, 0, 0.968],
    ],
  },
]);

const FACE_DEFS = [
  {
    name: "px",
    dir: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    shade: 0.60,
  },
  {
    name: "nx",
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    shade: 0.60,
  },
  {
    name: "py",
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    shade: 1,
  },
  {
    name: "ny",
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    shade: 0.50,
  },
  {
    name: "pz",
    dir: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
    shade: 0.80,
  },
  {
    name: "nz",
    dir: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    shade: 0.80,
  },
];

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
}

class Chunk {
  constructor(cx, cz, world, options = {}) {
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.blocks = new Uint16Array(CHUNK_AREA * WORLD_HEIGHT);
    this.waterLevels = new Uint8Array(CHUNK_AREA * WORLD_HEIGHT);
    this.mesh = null;
    this.leafMesh = null;
    this.torchMesh = null;
    this.waterMesh = null;
    this.lavaMesh = null;
    this.dirty = true;
    this.meshPending = false;
    this.remeshAfterPending = false;
    this.meshVersion = 0;
    this.generated = false;
    this.generationPending = false;
    this.generationVersion = 0;
    this.generationDetail = ChunkGenerationDetail.NONE;
    this.requestedGenerationDetail = ChunkGenerationDetail.NONE;
    this.highestBlockY = null;
    if (options.populate !== false) this.generateNow();
  }

  index(x, y, z) {
    return y * CHUNK_AREA + z * CHUNK_SIZE + x;
  }

  getLocal(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return Block.AIR;
    }
    return this.blocks[this.index(x, y, z)];
  }

  getWaterLevelLocal(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return null;
    }
    return decodeWaterLevelStore(this.waterLevels[this.index(x, y, z)]);
  }

  isWaterFallingLocal(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return false;
    }
    return decodeWaterFallingStore(this.waterLevels[this.index(x, y, z)]);
  }

  columnTopY(x, z) {
    const columnIndex = z * CHUNK_SIZE + x;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      if (this.blocks[y * CHUNK_AREA + columnIndex] !== Block.AIR) return y;
    }
    return -1;
  }

  getHighestBlockY() {
    if (this.highestBlockY !== null) return this.highestBlockY;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      const layerStart = y * CHUNK_AREA;
      for (let offset = 0; offset < CHUNK_AREA; offset += 1) {
        if (this.blocks[layerStart + offset] !== Block.AIR) {
          this.highestBlockY = y;
          return y;
        }
      }
    }
    this.highestBlockY = -1;
    return -1;
  }

  setLocal(x, y, z, block, liquidLevel = null, liquidFalling = false, markDirty = true) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return;
    }
    const index = this.index(x, y, z);
    const oldBlock = this.blocks[index];
    this.blocks[index] = block;
    this.waterLevels[index] = isLiquid(block) ? encodeWaterLevelStore(liquidLevel ?? 0, liquidFalling) : 0;
    if (block !== Block.AIR && (this.highestBlockY === null || y > this.highestBlockY)) {
      this.highestBlockY = y;
    } else if (oldBlock !== Block.AIR && block === Block.AIR && y === this.highestBlockY) {
      this.highestBlockY = null;
    }
    if (markDirty) this.markDirty();
  }

  markDirty() {
    this.dirty = true;
    this.meshVersion += 1;
  }

  generateNow(detail = ChunkGenerationDetail.FULL) {
    if (chunkHasGenerationDetail(this, detail)) return;
    this.populateTerrain(detail);
    if (detail !== ChunkGenerationDetail.TERRAIN) this.populateVegetation();
    this.generated = true;
    this.generationPending = false;
    this.generationDetail = detail;
    this.requestedGenerationDetail = maxChunkGenerationDetail(this.requestedGenerationDetail, detail);
    this.generationVersion += 1;
    this.markDirty();
  }

  applyGeneratedData(blocks, waterLevels, detail = ChunkGenerationDetail.FULL) {
    this.blocks = blocks;
    this.waterLevels = waterLevels;
    this.highestBlockY = null;
    this.generated = true;
    this.generationPending = false;
    this.generationDetail = detail;
    this.requestedGenerationDetail = maxChunkGenerationDetail(this.requestedGenerationDetail, detail);
    this.generationVersion += 1;
    this.markDirty();
  }

  populateTerrain(detail = ChunkGenerationDetail.FULL) {
    this.world.populateChunkTerrain(
      this.cx,
      this.cz,
      this.blocks,
      this.waterLevels,
      CHUNK_SIZE,
      CHUNK_AREA,
      {
        includeUndergroundFeatures: detail === ChunkGenerationDetail.FULL,
        fastSurface: detail === ChunkGenerationDetail.TERRAIN,
      },
    );
  }

  populateVegetation() {
    const worldX0 = this.cx * CHUNK_SIZE;
    const worldZ0 = this.cz * CHUNK_SIZE;
    const margin = 6;

    for (let wx = worldX0 - margin; wx < worldX0 + CHUNK_SIZE + margin; wx += 1) {
      for (let wz = worldZ0 - margin; wz < worldZ0 + CHUNK_SIZE + margin; wz += 1) {
        const groundY = this.world.terrainHeight(wx, wz);
        const treeType = this.world.treeTypeAt(wx, wz);
        if (treeType) {
          this.placeTreeSlice(wx, groundY + 1, wz, treeType);
          continue;
        }

        if (this.world.shouldGrowCactus(wx, wz)) {
          this.placeCactusSlice(wx, groundY + 1, wz);
          continue;
        }

        const rock = this.world.rockTypeAt(wx, wz);
        if (rock) {
          this.placeRockSlice(wx, groundY + 1, wz, rock);
          continue;
        }

        const plant = this.world.plantTypeAt(wx, wz);
        if (plant) {
          this.placePlantSlice(wx, groundY + 1, wz, plant);
        }
      }
    }
  }

  placeTreeSlice(wx, baseY, wz, treeType) {
    if (treeType === "spruce") {
      this.placeSpruceTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "jungle") {
      this.placeJungleTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "birch") {
      this.placeBirchTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "tall_birch") {
      this.placeTallBirchTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "acacia") {
      this.placeAcaciaTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "dark_oak") {
      this.placeDarkOakTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "mega_spruce") {
      this.placeMegaSpruceTreeSlice(wx, baseY, wz);
      return;
    }

    if (treeType === "swamp_oak") {
      this.placeSwampOakTreeSlice(wx, baseY, wz);
      return;
    }

    this.placeOakTreeSlice(wx, baseY, wz);
  }

  placeOakTreeSlice(wx, baseY, wz) {
    const large = hashFloat(wx, wz, this.world.seed ^ 0x0a0c) < 0.1;
    const height = (large ? 6 : 4) + hashInt(wx, wz, this.world.seed, large ? 4 : 3);
    const trunkTop = baseY + height - 1;

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.LOG, false);
    }

    if (large) {
      for (const [dx, dz, salt] of [
        [1, 0, 0x11],
        [-1, 0, 0x22],
        [0, 1, 0x33],
        [0, -1, 0x44],
      ]) {
        if (hashFloat(wx + dx, wz + dz, this.world.seed ^ (0xba2 + salt)) < 0.45) continue;
        const branchY = trunkTop - 2 + hashInt(wx + dx, wz + dz, this.world.seed ^ (0xba3 + salt), 2);
        const endX = wx + dx * 2;
        const endZ = wz + dz * 2;
        this.setWorldBlockIfInside(wx + dx, branchY, wz + dz, Block.LOG, false);
        this.setWorldBlockIfInside(endX, branchY, endZ, Block.LOG, false);
        this.placeLeafCluster(endX, branchY + 1, endZ, Block.LEAVES, 1, this.world.seed ^ (0x0a0d + salt));
      }
    }

    this.placeClassicLeafCanopy(wx, trunkTop, wz, Block.LEAVES, this.world.seed ^ 0x0a0e, {
      lowerCornerChance: large ? 0.48 : 0.28,
    });
  }

  placeSpruceTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.spruce;
    const height = 6 + hashInt(wx, wz, this.world.seed ^ 0x5f3759, 7);
    const trunkTop = baseY + height - 1;
    const leafStart = baseY + Math.max(2, Math.floor(height * 0.42));

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log, false);
    }

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

  placeJungleTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.jungle;
    const giant = hashFloat(wx, wz, this.world.seed ^ 0x1badb003) < 0.14;
    const height = (giant ? 13 : 7) + hashInt(wx, wz, this.world.seed ^ 0x1badb002, giant ? 5 : 4);
    const trunkTop = baseY + height - 1;

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log, false);
      if (giant) {
        this.setWorldBlockIfInside(wx + 1, baseY + dy, wz, blocks.log, false);
        this.setWorldBlockIfInside(wx, baseY + dy, wz + 1, blocks.log, false);
        this.setWorldBlockIfInside(wx + 1, baseY + dy, wz + 1, blocks.log, false);
      }
    }

    if (!giant) {
      this.placeClassicLeafCanopy(wx, trunkTop, wz, blocks.leaves, this.world.seed ^ 0x1badb004, {
        lowerCornerChance: 0.42,
        vineChance: 0.16,
      });
      return;
    }

    this.placeLeafDisk(wx, trunkTop - 1, wz, 3, blocks.leaves, 0.25, this.world.seed ^ 0x1badb005, true);
    this.placeLeafDisk(wx, trunkTop, wz, 3, blocks.leaves, 0.08, this.world.seed ^ 0x1badb006, true);
    this.placeLeafDisk(wx, trunkTop + 1, wz, 2, blocks.leaves, 0.2, this.world.seed ^ 0x1badb007, true);

    for (const [dx, dz, salt] of [
      [2, 0, 0x12],
      [-2, 0, 0x23],
      [0, 2, 0x34],
      [0, -2, 0x45],
    ]) {
      if (hashFloat(wx + dx, wz + dz, this.world.seed ^ (0x1badb008 + salt)) < 0.3) continue;
      const branchY = baseY + Math.floor(height * 0.48) + hashInt(wx + dx, wz + dz, this.world.seed ^ (0x77 + salt), 4);
      this.setWorldBlockIfInside(wx + Math.sign(dx), branchY, wz + Math.sign(dz), blocks.log, false);
      this.setWorldBlockIfInside(wx + dx, branchY + 1, wz + dz, blocks.log, false);
      this.placeLeafCluster(wx + dx, branchY + 2, wz + dz, blocks.leaves, 2, this.world.seed ^ (0x1badb009 + salt), 0.1, true);
    }
  }

  placeBirchTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.birch;
    const height = 5 + hashInt(wx, wz, this.world.seed ^ 0xb1f6, 3);
    const trunkTop = baseY + height - 1;

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log, false);
    }

    this.placeClassicLeafCanopy(wx, trunkTop, wz, blocks.leaves, this.world.seed ^ 0xb1f7, {
      lowerCornerChance: 0.34,
    });
  }

  placeTallBirchTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.birch;
    // Old-growth birches are taller than normal birches, but keeping the
    // vanilla-like variation to three blocks prevents occasional 13-block poles.
    const height = 9 + hashInt(wx, wz, this.world.seed ^ 0x7a11b17c, 3);
    const trunkTop = baseY + height - 1;

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log, false);
    }

    this.placeLeafDisk(wx, trunkTop - 2, wz, 2, blocks.leaves, 0.28, this.world.seed ^ 0x7a11b17d);
    this.placeLeafDisk(wx, trunkTop - 1, wz, 2, blocks.leaves, 0.12, this.world.seed ^ 0x7a11b17e);
    this.placeLeafDisk(wx, trunkTop, wz, 1, blocks.leaves, 0.08, this.world.seed ^ 0x7a11b17f);
    this.placeLeafCluster(wx, trunkTop + 1, wz, blocks.leaves, 1, this.world.seed ^ 0x7a11b180);
  }

  placeAcaciaTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.acacia;
    const height = 5 + hashInt(wx, wz, this.world.seed ^ 0xaca1, 3);
    const leanX = hashFloat(wx, wz, this.world.seed ^ 0xaca2) < 0.5 ? -1 : 1;
    const leanZ = hashFloat(wx, wz, this.world.seed ^ 0xaca3) < 0.5 ? -1 : 1;
    const fork = hashFloat(wx, wz, this.world.seed ^ 0xaca4) < 0.72;
    const bendStart = 2 + hashInt(wx, wz, this.world.seed ^ 0xaca7, 2);
    let topX = wx;
    let topZ = wz;

    for (let dy = 0; dy < height; dy += 1) {
      const lean = dy > bendStart ? Math.min(2, dy - bendStart) : 0;
      const bx = wx + lean * leanX;
      const bz = wz + (lean > 1 || dy === height - 1 ? leanZ : 0);
      topX = bx;
      topZ = bz;
      this.setWorldBlockIfInside(bx, baseY + dy, bz, blocks.log, false);
    }

    const canopyY = baseY + height - 1;
    this.placeAcaciaCanopy(topX, canopyY + 1, topZ, blocks.leaves, this.world.seed ^ 0xaca5);

    if (fork) {
      const forkX = wx - leanX;
      const forkZ = wz - leanZ;
      const forkY = baseY + Math.max(3, height - 2);
      this.setWorldBlockIfInside(wx, forkY, wz, blocks.log, false);
      this.setWorldBlockIfInside(forkX, forkY + 1, forkZ, blocks.log, false);
      this.setWorldBlockIfInside(forkX + Math.sign(forkX - wx), forkY + 2, forkZ, blocks.log, false);
      this.placeAcaciaCanopy(forkX, forkY + 2, forkZ, blocks.leaves, this.world.seed ^ 0xaca6);
    }
  }

  placeDarkOakTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.dark_oak;
    const height = 6 + hashInt(wx, wz, this.world.seed ^ 0xd4a0, 4);
    const trunkTop = baseY + height - 1;

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log, false);
      this.setWorldBlockIfInside(wx + 1, baseY + dy, wz, blocks.log, false);
      this.setWorldBlockIfInside(wx, baseY + dy, wz + 1, blocks.log, false);
      this.setWorldBlockIfInside(wx + 1, baseY + dy, wz + 1, blocks.log, false);
    }

    this.placeLeafDisk(wx, trunkTop - 2, wz, 3, blocks.leaves, 0.24, this.world.seed ^ 0xd4a1);
    this.placeLeafDisk(wx + 1, trunkTop - 1, wz + 1, 3, blocks.leaves, 0.12, this.world.seed ^ 0xd4a2);
    this.placeLeafDisk(wx, trunkTop, wz, 2, blocks.leaves, 0.08, this.world.seed ^ 0xd4a3);
    this.placeLeafCluster(wx + 1, trunkTop + 1, wz + 1, blocks.leaves, 1, this.world.seed ^ 0xd4a4);
  }

  placeMegaSpruceTreeSlice(wx, baseY, wz) {
    const blocks = TREE_BLOCKS.spruce;
    const height = 12 + hashInt(wx, wz, this.world.seed ^ 0x5f375a, 7);
    const trunkTop = baseY + height - 1;
    const leafStart = baseY + Math.max(4, Math.floor(height * 0.35));

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, blocks.log, false);
      this.setWorldBlockIfInside(wx + 1, baseY + dy, wz, blocks.log, false);
      this.setWorldBlockIfInside(wx, baseY + dy, wz + 1, blocks.log, false);
      this.setWorldBlockIfInside(wx + 1, baseY + dy, wz + 1, blocks.log, false);
    }

    for (let y = leafStart; y <= trunkTop + 1; y += 1) {
      const fromTop = trunkTop + 1 - y;
      const radius = clamp(Math.floor((fromTop + 3) / 2), 1, 4);
      this.placeLeafDisk(wx, y, wz, radius, blocks.leaves, radius > 2 ? 0.32 : 0.12, this.world.seed ^ (0x5f3760 + y));
    }
  }

  placeSwampOakTreeSlice(wx, baseY, wz) {
    const height = 5 + hashInt(wx, wz, this.world.seed ^ 0x5a0, 3);
    const trunkTop = baseY + height - 1;

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.LOG, false);
    }

    this.placeClassicLeafCanopy(wx, trunkTop, wz, Block.LEAVES, this.world.seed ^ 0x5a1, {
      lowerCornerChance: 0.48,
      vineChance: 0.24,
    });
  }

  placeClassicLeafCanopy(wx, trunkTopY, wz, leaves, seed, options = {}) {
    const lowerCornerChance = options.lowerCornerChance ?? 0.32;
    const vineChance = options.vineChance ?? 0;

    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
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

  placeLeafCluster(wx, y, wz, leaves, radius, seed, cornerChance = 0.15, vines = false) {
    this.placeLeafDisk(wx, y - 1, wz, Math.max(1, radius), leaves, cornerChance, seed ^ 0x44, vines);
    this.placeLeafDisk(wx, y, wz, radius, leaves, cornerChance, seed ^ 0x55, vines);
    this.placeLeafDisk(wx, y + 1, wz, Math.max(1, radius - 1), leaves, cornerChance, seed ^ 0x66, vines);
  }

  placeLeafDisk(wx, y, wz, radius, leaves, cornerChance, seed, vines = false) {
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

  placeAcaciaCanopy(wx, y, wz, leaves, seed) {
    this.placeLeafDisk(wx, y, wz, 2, leaves, 0.25, seed);
    this.placeLeafDisk(wx, y + 1, wz, 1, leaves, 0, seed ^ 0x17);
  }

  placeVineColumn(wx, y, wz, maxLength) {
    for (let drop = 0; drop < maxLength; drop += 1) {
      if (this.getWorldBlockIfInside(wx, y - drop, wz) !== Block.AIR) break;
      this.setWorldBlockIfInside(wx, y - drop, wz, Block.VINE, false);
    }
  }

  placeVineColumnFromLeaf(leafX, leafY, leafZ, outwardX, outwardZ, maxLength) {
    const directions = [];
    if (outwardX !== 0) directions.push([Math.sign(outwardX), 0]);
    if (outwardZ !== 0) directions.push([0, Math.sign(outwardZ)]);
    if (directions.length === 0) return;
    const [dx, dz] = directions.length === 1
      ? directions[0]
      : directions[hashFloat(leafX, leafZ, this.world.seed ^ leafY) < 0.5 ? 0 : 1];
    this.placeVineColumn(leafX + dx, leafY, leafZ + dz, maxLength);
  }

  setLeafIfReplaceable(wx, y, wz, leaves) {
    const existing = this.getWorldBlockIfInside(wx, y, wz);
    if (existing === Block.AIR || existing === leaves || existing === Block.VINE) {
      this.setWorldBlockIfInside(wx, y, wz, leaves, false);
    }
  }

  placeCactusSlice(wx, baseY, wz) {
    const height = 2 + hashInt(wx, wz, this.world.seed ^ 0xcac7, 3);

    for (let dy = 0; dy < height; dy += 1) {
      this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.CACTUS, false);
    }
  }

  placeRockSlice(wx, baseY, wz, block) {
    const radius = hashFloat(wx, wz, this.world.seed ^ 0xb01d) < 0.28 ? 2 : 1;
    const height = 1 + (radius === 2 && hashFloat(wx, wz, this.world.seed ^ 0xb01e) < 0.45 ? 1 : 0);

    for (let dy = 0; dy < height; dy += 1) {
      const layerRadius = Math.max(0, radius - dy);
      for (let ox = -layerRadius; ox <= layerRadius; ox += 1) {
        for (let oz = -layerRadius; oz <= layerRadius; oz += 1) {
          const distance = Math.abs(ox) + Math.abs(oz);
          if (distance > layerRadius + 1) continue;
          if (Math.abs(ox) === layerRadius && Math.abs(oz) === layerRadius && hashFloat(wx + ox, wz + oz, this.world.seed ^ dy) < 0.65) continue;
          if (this.getWorldBlockIfInside(wx + ox, baseY + dy, wz + oz) !== Block.AIR) continue;
          this.setWorldBlockIfInside(wx + ox, baseY + dy, wz + oz, block, false);
        }
      }
    }
  }

  placePlantSlice(wx, baseY, wz, plant) {
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
      this.setWorldBlockIfInside(wx, y, wz, Block.WATERLILY, false);
      return;
    }

    if (this.getWorldBlockIfInside(wx, baseY, wz) !== Block.AIR) return;

    if (
      GRASS_ONLY_PLANT_TYPES.has(plant) &&
      !GRASS_SURFACE_BLOCKS.has(this.getWorldBlockIfInside(wx, baseY - 1, wz))
    ) return;

    if (plant === "sugar_cane") {
      const height = 2 + hashInt(wx, wz, this.world.seed ^ 0x5ca1e, 3);
      for (let dy = 0; dy < height; dy += 1) {
        if (this.getWorldBlockIfInside(wx, baseY + dy, wz) !== Block.AIR) break;
        this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.SUGAR_CANE, false);
      }
      return;
    }

    if (plant === "tall_grass" && hashFloat(wx, wz, this.world.seed ^ 0xd0557) < 0.5) {
      for (let dy = 0; dy < 2; dy += 1) {
        if (this.getWorldBlockIfInside(wx, baseY + dy, wz) !== Block.AIR) break;
        this.setWorldBlockIfInside(wx, baseY + dy, wz, Block.TALL_GRASS, false);
      }
      return;
    }

    this.setWorldBlockIfInside(wx, baseY, wz, block, false);
  }

  getWorldBlockIfInside(wx, y, wz) {
    const lx = wx - this.cx * CHUNK_SIZE;
    const lz = wz - this.cz * CHUNK_SIZE;
    return this.getLocal(lx, y, lz);
  }

  setWorldBlockIfInside(wx, y, wz, block, markDirty = true, waterLevel = null) {
    const lx = wx - this.cx * CHUNK_SIZE;
    const lz = wz - this.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const index = this.index(lx, y, lz);
    this.blocks[index] = block;
    this.waterLevels[index] = isLiquid(block) ? encodeWaterLevelStore(waterLevel ?? 0, false) : 0;
    if (markDirty) this.markDirty();
  }

  rebuildMesh() {
    this.meshPending = false;
    this.remeshAfterPending = false;
    if (this.mesh) {
      this.world.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.leafMesh) {
      this.world.scene.remove(this.leafMesh);
      this.leafMesh.geometry.dispose();
      this.leafMesh = null;
    }
    if (this.torchMesh) {
      this.world.scene.remove(this.torchMesh);
      this.torchMesh.geometry.dispose();
      this.torchMesh = null;
    }
    if (this.waterMesh) {
      this.world.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }
    if (this.lavaMesh) {
      this.world.scene.remove(this.lavaMesh);
      this.lavaMesh.geometry.dispose();
      this.lavaMesh = null;
    }

    const solidBuffers = createMeshBuffers();
    const leafBuffers = createMeshBuffers();
    const torchBuffers = createMeshBuffers();
    const waterBuffers = createMeshBuffers();
    const lavaBuffers = createMeshBuffers();
    const worldX0 = this.cx * CHUNK_SIZE;
    const worldZ0 = this.cz * CHUNK_SIZE;
    const color = new THREE.Color();

    this.world.isMeshing = true;
    try {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          const topY = this.columnTopY(x, z);
          for (let y = 0; y <= topY; y += 1) {
            const block = this.getLocal(x, y, z);
            const wx = worldX0 + x;
            const wz = worldZ0 + z;
            if (block === Block.VINE) {
              pushVine(solidBuffers, this.world, wx, y, wz, block, color);
              continue;
            }
            if (isPlant(block)) {
              pushPlant(solidBuffers, this.world, wx, y, wz, block, color);
              continue;
            }
            const customShape = getBlockShapeForBlock(block);
            if (customShape) {
              const targetBuffers = isTorchCustomShapeBlock(block) ? torchBuffers : solidBuffers;
              pushCustomShape(targetBuffers, this.world, wx, y, wz, block, customShape, color);
              continue;
            }
            if (!isSolid(block) && !isLiquid(block)) continue;

            for (const face of FACE_DEFS) {
              const nx = wx + face.dir[0];
              const ny = y + face.dir[1];
              const nz = wz + face.dir[2];
              const neighbor = this.world.getBlock(nx, ny, nz);

              if (isLiquid(block)) {
                const sameLiquidNeighbor = isSameLiquid(neighbor, block);
                const neighborColumnReady = this.world.hasGeneratedChunkAt(nx, nz);
                const renderFallingTopCap = face.name === "py" && shouldRenderFallingLiquidTopCap(this.world, wx, y, wz, block);
                if (face.dir[1] === 0 && !neighborColumnReady) continue;
                if (sameLiquidNeighbor && !renderFallingTopCap) continue;
                if (!sameLiquidNeighbor && isFaceOccluding(neighbor)) continue;
                if (face.name === "py" && isFallingLiquidBlock(this.world, wx, y, wz, block) && !renderFallingTopCap) continue;
                const waterBlock = isWater(block);
                const variation = waterBlock
                  ? 1
                  : 0.92 + hashFloat(wx + face.dir[0] * 5, wz + face.dir[2] * 5, y + this.world.seed) * 0.08;
                const liquidBuffers = isLava(block) ? lavaBuffers : waterBuffers;
                const waterDepth = waterBlock ? getWaterColumnDepth(this.world, wx, y, wz) : 0;
                pushVoxelFace(liquidBuffers, this.world, wx, y, wz, block, face, color, {
                  topHeights: getLiquidFaceTopHeights(this.world, wx, y, wz, block, face),
                  variation,
                  ao: !waterBlock,
                  waveTop: true,
                  fullTileUv: true,
                  tintColor: waterBlock ? this.world.waterColorAt(wx, wz) : getLiquidTintColor(this.world, wx, wz, block),
                  waterDepth,
                  colorAlpha: waterBlock ? getWaterDepthAlpha(waterDepth) : null,
                  lightLevel: isLava(block) ? MAX_LIGHT_LEVEL : undefined,
                });
                continue;
              }

              const leafBlock = isLeafBlock(block);
              const neighborLeaf = leafBlock && isLeafBlock(neighbor);
              if (isFaceOccluding(neighbor)) {
                if (!neighborLeaf || !shouldRenderSharedLeafFace(face)) continue;
              }
              const variation = 0.9 + hashFloat(wx + face.dir[0] * 7, wz + face.dir[2] * 7, y + this.world.seed) * 0.16;
              const targetBuffers = leafBlock ? leafBuffers : solidBuffers;
              const submergedDepth = neighbor === Block.WATER ? getWaterDepthAbove(this.world, nx, ny, nz) : 0;
              pushVoxelFace(targetBuffers, this.world, wx, y, wz, block, face, color, {
                variation,
                ao: true,
                submergedDepth,
                waterTintColor: submergedDepth > 0 ? this.world.waterColorAt(nx, nz) : null,
              });
              if (hasGrassSideOverlay(block, face.name)) {
                pushVoxelFace(targetBuffers, this.world, wx, y, wz, block, face, color, {
                  variation,
                  ao: true,
                  textureKey: "grass_side_overlay",
                  tintColor: this.world.grassColorAt(wx, wz),
                  positionOffset: 0.0015,
                  submergedDepth,
                  waterTintColor: submergedDepth > 0 ? this.world.waterColorAt(nx, nz) : null,
                });
              }
            }
          }
        }
      }
    } finally {
      this.world.isMeshing = false;
    }

    if (solidBuffers.positions.length > 0) {
      this.mesh = new THREE.Mesh(createGeometryFromBuffers(solidBuffers), this.world.material);
      this.mesh.castShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.mesh.receiveShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.mesh.frustumCulled = true;
      this.mesh.matrixAutoUpdate = false;
      this.mesh.updateMatrix();
      this.world.scene.add(this.mesh);
    }

    if (leafBuffers.positions.length > 0) {
      this.leafMesh = new THREE.Mesh(createGeometryFromBuffers(leafBuffers), LEAF_MATERIAL);
      this.leafMesh.castShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.leafMesh.receiveShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.leafMesh.frustumCulled = true;
      this.leafMesh.matrixAutoUpdate = false;
      this.leafMesh.updateMatrix();
      this.leafMesh.renderOrder = 2;
      this.world.scene.add(this.leafMesh);
    }

    if (torchBuffers.positions.length > 0) {
      this.torchMesh = new THREE.Mesh(createGeometryFromBuffers(torchBuffers), TORCH_MATERIAL);
      this.torchMesh.castShadow = false;
      this.torchMesh.receiveShadow = false;
      this.torchMesh.frustumCulled = true;
      this.torchMesh.matrixAutoUpdate = false;
      this.torchMesh.updateMatrix();
      this.torchMesh.renderOrder = 3;
      this.world.scene.add(this.torchMesh);
    }

    if (waterBuffers.positions.length > 0) {
      this.waterMesh = new THREE.Mesh(createGeometryFromBuffers(waterBuffers), WATER_MATERIAL);
      this.waterMesh.castShadow = false;
      this.waterMesh.receiveShadow = false;
      this.waterMesh.frustumCulled = true;
      this.waterMesh.matrixAutoUpdate = false;
      this.waterMesh.updateMatrix();
      this.waterMesh.renderOrder = 4;
      this.world.scene.add(this.waterMesh);
    }
    if (lavaBuffers.positions.length > 0) {
      this.lavaMesh = new THREE.Mesh(createGeometryFromBuffers(lavaBuffers), LAVA_MATERIAL);
      this.lavaMesh.castShadow = false;
      this.lavaMesh.receiveShadow = false;
      this.lavaMesh.frustumCulled = true;
      this.lavaMesh.matrixAutoUpdate = false;
      this.lavaMesh.updateMatrix();
      this.lavaMesh.renderOrder = 4;
      this.world.scene.add(this.lavaMesh);
    }
    this.dirty = false;
  }

  createMeshSnapshot() {
    const width = CHUNK_SIZE + 2;
    const paddedArea = width * width;
    const blocks = new Uint16Array(width * WORLD_HEIGHT * width);
    const waterLevels = new Uint8Array(width * WORLD_HEIGHT * width);
    const skyLights = new Uint8Array(width * WORLD_HEIGHT * width);
    const blockLights = new Uint8Array(width * WORLD_HEIGHT * width);
    const grassColors = new Uint8Array(width * width * 3);
    const foliageColors = new Uint8Array(width * width * 3);
    const waterColors = new Uint8Array(width * width * 3);
    const generatedColumns = new Uint8Array(width * width);
    const columnTopY = new Uint8Array(width * width);
    const worldX0 = this.cx * CHUNK_SIZE;
    const worldZ0 = this.cz * CHUNK_SIZE;
    let colorWrite = 0;
    let maxSnapshotTopY = 0;

    for (let z = -1; z <= CHUNK_SIZE; z += 1) {
      for (let x = -1; x <= CHUNK_SIZE; x += 1) {
        const wx = worldX0 + x;
        const wz = worldZ0 + z;
        const sourceChunk = this.world.chunks.get(this.world.key(
          Math.floor(wx / CHUNK_SIZE),
          Math.floor(wz / CHUNK_SIZE),
        ));
        const generated = Boolean(sourceChunk?.generated);
        const columnIndex = (z + 1) * width + (x + 1);
        generatedColumns[columnIndex] = generated ? 1 : 0;
        writePackedColor(grassColors, colorWrite, this.world.grassColorAt(wx, wz));
        writePackedColor(foliageColors, colorWrite, this.world.foliageColorAt(wx, wz));
        writePackedColor(waterColors, colorWrite, this.world.waterColorAt(wx, wz) ?? DEFAULT_WATER_TINT);
        colorWrite += 3;

        if (!generated) continue;
        const sourceColumn = mod(wz, CHUNK_SIZE) * CHUNK_SIZE + mod(wx, CHUNK_SIZE);
        const sourceTopY = sourceChunk.getHighestBlockY();
        let topY = 0;
        for (let y = 0; y <= sourceTopY; y += 1) {
          const sourceIndex = y * CHUNK_AREA + sourceColumn;
          const snapshotIndex = y * paddedArea + columnIndex;
          const b = sourceChunk.blocks[sourceIndex];
          blocks[snapshotIndex] = b;
          waterLevels[snapshotIndex] = sourceChunk.waterLevels[sourceIndex];
          if (b !== 0) {
            topY = y;
            if (y > maxSnapshotTopY) maxSnapshotTopY = y;
          }
        }
        columnTopY[columnIndex] = topY;
      }
    }

    if (this.generationDetail !== ChunkGenerationDetail.FULL) {
      for (let z = -1; z <= CHUNK_SIZE; z += 1) {
        for (let x = -1; x <= CHUNK_SIZE; x += 1) {
          const columnIndex = (z + 1) * width + (x + 1);
          let skyLight = MAX_LIGHT_LEVEL;
          for (let y = maxSnapshotTopY + 1; y >= 0; y -= 1) {
            const index = y * paddedArea + columnIndex;
            skyLights[index] = skyLight;
            const opacity = LIGHT_OPACITY_MASK[blocks[index]];
            skyLight = skyLight > opacity ? skyLight - opacity : 0;
          }
        }
      }
      return {
        blocks,
        waterLevels,
        skyLights,
        blockLights,
        grassColors,
        foliageColors,
        waterColors,
        generatedColumns,
        columnTopY,
      };
    }

    const hasCoveredEdgeAirConnection = () => {
      const isTransparentSnapshotCell = (x, y, z) =>
        LIGHT_OPACITY_MASK[blocks[y * paddedArea + (z + 1) * width + (x + 1)]] < MAX_LIGHT_LEVEL;
      const columnTop = (x, z) => columnTopY[(z + 1) * width + (x + 1)] ?? 0;
      const edgePairs = [];
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        edgePairs.push([-1, z, 0, z], [CHUNK_SIZE, z, CHUNK_SIZE - 1, z]);
      }
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        edgePairs.push([x, -1, x, 0], [x, CHUNK_SIZE, x, CHUNK_SIZE - 1]);
      }

      for (const [ax, az, bx, bz] of edgePairs) {
        const coveredBelowY = Math.min(maxSnapshotTopY, Math.max(columnTop(ax, az), columnTop(bx, bz)) - 1);
        for (let y = 1; y <= coveredBelowY; y += 1) {
          if (isTransparentSnapshotCell(ax, y, az) && isTransparentSnapshotCell(bx, y, bz)) return true;
        }
      }
      return false;
    };

    // Geometry only needs one neighbor block, but sky/block light can travel
    // up to MAX_LIGHT_LEVEL blocks through caves and across chunk borders.
    const lightPadding = hasCoveredEdgeAirConnection() ? LIGHT_PROPAGATION_PADDING : 1;
    const lightWidth = CHUNK_SIZE + lightPadding * 2;
    const lightArea = lightWidth * lightWidth;
    let lightMaxY = 0;
    const minLightChunkX = Math.floor((worldX0 - lightPadding) / CHUNK_SIZE);
    const maxLightChunkX = Math.floor((worldX0 + CHUNK_SIZE + lightPadding - 1) / CHUNK_SIZE);
    const minLightChunkZ = Math.floor((worldZ0 - lightPadding) / CHUNK_SIZE);
    const maxLightChunkZ = Math.floor((worldZ0 + CHUNK_SIZE + lightPadding - 1) / CHUNK_SIZE);
    for (let lightCz = minLightChunkZ; lightCz <= maxLightChunkZ; lightCz += 1) {
      for (let lightCx = minLightChunkX; lightCx <= maxLightChunkX; lightCx += 1) {
        const chunk = this.world.chunks.get(this.world.key(lightCx, lightCz));
        if (chunk?.generated) lightMaxY = Math.max(lightMaxY, Math.min(WORLD_HEIGHT - 1, chunk.getHighestBlockY() + 1));
      }
    }
    const lightHeight = lightMaxY + 1;
    const lightSize = lightArea * lightHeight;
    const lightOpacities = new Uint8Array(lightSize);
    const propagatedSkyLights = new Uint8Array(lightSize);
    const propagatedBlockLights = new Uint8Array(lightSize);
    const DIRS6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const skyQueue = [];
    const lightQueue = [];
    for (let z = -lightPadding; z < CHUNK_SIZE + lightPadding; z += 1) {
      for (let x = -lightPadding; x < CHUNK_SIZE + lightPadding; x += 1) {
        let skyLight = MAX_LIGHT_LEVEL;
        const colBase = (z + lightPadding) * lightWidth + (x + lightPadding);
        const wx = worldX0 + x;
        const wz = worldZ0 + z;
        const chunk = this.world.chunks.get(this.world.key(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE)));
        const generatedColumn = Boolean(chunk?.generated);
        const chunkColumn = generatedColumn
          ? mod(wz, CHUNK_SIZE) * CHUNK_SIZE + mod(wx, CHUNK_SIZE)
          : 0;
        for (let y = lightMaxY; y >= 0; y -= 1) {
          const index = y * lightArea + colBase;
          const block = generatedColumn ? chunk.blocks[y * CHUNK_AREA + chunkColumn] : Block.STONE;
          const op = LIGHT_OPACITY_MASK[block];
          lightOpacities[index] = op;
          propagatedSkyLights[index] = skyLight;
          const src = BLOCK_LIGHT_SOURCE_MASK[block];
          if (src > 0) { propagatedBlockLights[index] = src; lightQueue.push(index); }
          skyLight = skyLight > op ? skyLight - op : 0;
        }
      }
    }

    for (let z = -lightPadding; z < CHUNK_SIZE + lightPadding; z += 1) {
      for (let x = -lightPadding; x < CHUNK_SIZE + lightPadding; x += 1) {
        const colBase = (z + lightPadding) * lightWidth + (x + lightPadding);
        for (let y = 0; y <= lightMaxY; y += 1) {
          const index = y * lightArea + colBase;
          const level = propagatedSkyLights[index];
          if (level <= 1 || lightOpacities[index] >= MAX_LIGHT_LEVEL) continue;
          for (let d = 0; d < 6; d += 1) {
            const dir = DIRS6[d];
            const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
            if (nx < -lightPadding || nx >= CHUNK_SIZE + lightPadding || ny < 0 || ny > lightMaxY || nz < -lightPadding || nz >= CHUNK_SIZE + lightPadding) continue;
            const nIdx = ny * lightArea + (nz + lightPadding) * lightWidth + (nx + lightPadding);
            if (lightOpacities[nIdx] < MAX_LIGHT_LEVEL && propagatedSkyLights[nIdx] < level - 1) {
              skyQueue.push(index);
              break;
            }
          }
        }
      }
    }

    // BFS: horizontal sky light propagation (fills under overhangs)
    {
      let qi = 0;
      while (qi < skyQueue.length) {
        const idx = skyQueue[qi++];
        const level = propagatedSkyLights[idx];
        if (level <= 1) continue;
        const iy = Math.floor(idx / lightArea);
        const flat = idx % lightArea;
        const iz = Math.floor(flat / lightWidth) - lightPadding;
        const ix = (flat % lightWidth) - lightPadding;
        for (let d = 0; d < 6; d++) {
          const dir = DIRS6[d];
          const nx = ix + dir[0], ny = iy + dir[1], nz = iz + dir[2];
          if (nx < -lightPadding || nx >= CHUNK_SIZE + lightPadding || ny < 0 || ny > lightMaxY || nz < -lightPadding || nz >= CHUNK_SIZE + lightPadding) continue;
          const nIdx = ny * lightArea + (nz + lightPadding) * lightWidth + (nx + lightPadding);
          if (lightOpacities[nIdx] >= MAX_LIGHT_LEVEL) continue;
          const newLevel = level - 1;
          if (propagatedSkyLights[nIdx] < newLevel) {
            propagatedSkyLights[nIdx] = newLevel;
            skyQueue.push(nIdx);
          }
        }
      }
    }

    // BFS: block light propagation from sources
    {
      let qi = 0;
      while (qi < lightQueue.length) {
        const idx = lightQueue[qi++];
        const level = propagatedBlockLights[idx];
        if (level <= 1) continue;
        const iy = Math.floor(idx / lightArea);
        const flat = idx % lightArea;
        const iz = Math.floor(flat / lightWidth) - lightPadding;
        const ix = (flat % lightWidth) - lightPadding;
        for (let d = 0; d < 6; d++) {
          const dir = DIRS6[d];
          const nx = ix + dir[0], ny = iy + dir[1], nz = iz + dir[2];
          if (nx < -lightPadding || nx >= CHUNK_SIZE + lightPadding || ny < 0 || ny > lightMaxY || nz < -lightPadding || nz >= CHUNK_SIZE + lightPadding) continue;
          const nIdx = ny * lightArea + (nz + lightPadding) * lightWidth + (nx + lightPadding);
          if (lightOpacities[nIdx] >= MAX_LIGHT_LEVEL) continue;
          const newLevel = level - 1;
          if (propagatedBlockLights[nIdx] < newLevel) {
            propagatedBlockLights[nIdx] = newLevel;
            lightQueue.push(nIdx);
          }
        }
      }
    }

    for (let y = 0; y <= lightMaxY; y += 1) {
      for (let z = -1; z <= CHUNK_SIZE; z += 1) {
        for (let x = -1; x <= CHUNK_SIZE; x += 1) {
          const snapshotIndex = y * paddedArea + (z + 1) * width + (x + 1);
          const lightIndex = y * lightArea + (z + lightPadding) * lightWidth + (x + lightPadding);
          skyLights[snapshotIndex] = propagatedSkyLights[lightIndex];
          blockLights[snapshotIndex] = propagatedBlockLights[lightIndex];
        }
      }
    }

    return { blocks, waterLevels, skyLights, blockLights, grassColors, foliageColors, waterColors, generatedColumns, columnTopY };
  }

  applyMeshData(meshData) {
    if (this.mesh) {
      this.world.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.leafMesh) {
      this.world.scene.remove(this.leafMesh);
      this.leafMesh.geometry.dispose();
      this.leafMesh = null;
    }
    if (this.torchMesh) {
      this.world.scene.remove(this.torchMesh);
      this.torchMesh.geometry.dispose();
      this.torchMesh = null;
    }
    if (this.waterMesh) {
      this.world.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }
    if (this.lavaMesh) {
      this.world.scene.remove(this.lavaMesh);
      this.lavaMesh.geometry.dispose();
      this.lavaMesh = null;
    }

    if (meshData.solid.positions.length > 0) {
      this.mesh = new THREE.Mesh(createGeometryFromBuffers(meshData.solid), this.world.material);
      this.mesh.castShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.mesh.receiveShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.mesh.frustumCulled = true;
      this.mesh.matrixAutoUpdate = false;
      this.mesh.updateMatrix();
      this.world.scene.add(this.mesh);
    }

    if (meshData.leaf?.positions.length > 0) {
      this.leafMesh = new THREE.Mesh(createGeometryFromBuffers(meshData.leaf), LEAF_MATERIAL);
      this.leafMesh.castShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.leafMesh.receiveShadow = TERRAIN_DYNAMIC_SHADOWS;
      this.leafMesh.frustumCulled = true;
      this.leafMesh.matrixAutoUpdate = false;
      this.leafMesh.updateMatrix();
      this.leafMesh.renderOrder = 2;
      this.world.scene.add(this.leafMesh);
    }

    if (meshData.torch?.positions.length > 0) {
      this.torchMesh = new THREE.Mesh(createGeometryFromBuffers(meshData.torch), TORCH_MATERIAL);
      this.torchMesh.castShadow = false;
      this.torchMesh.receiveShadow = false;
      this.torchMesh.frustumCulled = true;
      this.torchMesh.matrixAutoUpdate = false;
      this.torchMesh.updateMatrix();
      this.torchMesh.renderOrder = 3;
      this.world.scene.add(this.torchMesh);
    }

    if (meshData.water.positions.length > 0) {
      this.waterMesh = new THREE.Mesh(createGeometryFromBuffers(meshData.water), WATER_MATERIAL);
      this.waterMesh.castShadow = false;
      this.waterMesh.receiveShadow = false;
      this.waterMesh.frustumCulled = true;
      this.waterMesh.matrixAutoUpdate = false;
      this.waterMesh.updateMatrix();
      this.waterMesh.renderOrder = 4;
      this.world.scene.add(this.waterMesh);
    }
    if (meshData.lava?.positions.length > 0) {
      this.lavaMesh = new THREE.Mesh(createGeometryFromBuffers(meshData.lava), LAVA_MATERIAL);
      this.lavaMesh.castShadow = false;
      this.lavaMesh.receiveShadow = false;
      this.lavaMesh.frustumCulled = true;
      this.lavaMesh.matrixAutoUpdate = false;
      this.lavaMesh.updateMatrix();
      this.lavaMesh.renderOrder = 4;
      this.world.scene.add(this.lavaMesh);
    }

    const shouldRemesh = this.remeshAfterPending;
    this.remeshAfterPending = false;
    this.meshPending = false;
    this.dirty = false;
    if (shouldRemesh) this.markDirty();
  }

  dispose() {
    if (this.mesh) {
      this.world.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.leafMesh) {
      this.world.scene.remove(this.leafMesh);
      this.leafMesh.geometry.dispose();
      this.leafMesh = null;
    }
    if (this.torchMesh) {
      this.world.scene.remove(this.torchMesh);
      this.torchMesh.geometry.dispose();
      this.torchMesh = null;
    }
    if (this.waterMesh) {
      this.world.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }
    if (this.lavaMesh) {
      this.world.scene.remove(this.lavaMesh);
      this.lavaMesh.geometry.dispose();
      this.lavaMesh = null;
    }
  }
}

function compareChunkWorkerTasks(a, b) {
  return a.priority - b.priority || a.id - b.id;
}

function takeNextChunkWorkerTask(queue) {
  if (queue.length <= 1) return queue.shift();
  let bestIndex = 0;
  let best = queue[0];
  for (let i = 1; i < queue.length; i += 1) {
    if (compareChunkWorkerTasks(queue[i], best) < 0) {
      bestIndex = i;
      best = queue[i];
    }
  }
  return queue.splice(bestIndex, 1)[0];
}

function updateQueuedChunkWorkerTaskPriority(queue, key, priority) {
  const task = queue.find((entry) => entry.key === key);
  if (!task) return false;
  task.priority = priority;
  return true;
}

function updateQueuedChunkGenerationTask(queue, key, priority, detail) {
  const task = queue.find((entry) => entry.key === key);
  if (!task) return false;
  task.priority = Math.min(task.priority, priority);
  task.detail = maxChunkGenerationDetail(task.detail, detail);
  task.payload.detail = task.detail;
  return true;
}

function compareChunkApplyTasksByDistance(a, b, pcx, pcz) {
  const adx = a.cx - pcx;
  const adz = a.cz - pcz;
  const bdx = b.cx - pcx;
  const bdz = b.cz - pcz;
  return (adx * adx + adz * adz) - (bdx * bdx + bdz * bdz);
}

class ChunkMeshWorkerPool {
  constructor(world) {
    this.world = world;
    this.queue = [];
    this.active = new Map();
    this.workers = [];
    this.nextId = 1;
    this.disabled = typeof Worker === "undefined";
    this.desiredWorkerCount = this.disabled ? 0 : chunkWorkerCounts().mesh;
  }

  ensureWorkers() {
    if (!this.available || this.workers.length > 0) return;

    for (let i = 0; i < this.desiredWorkerCount; i += 1) {
      const worker = new Worker(new URL("./chunkMesher.js", import.meta.url), { type: "module" });
      const slot = { worker, busy: false, taskId: null };
      worker.onmessage = (event) => this.handleMessage(slot, event.data);
      worker.onerror = (event) => this.handleWorkerFailure(slot, event);
      this.workers.push(slot);
    }
  }

  get available() {
    return !this.disabled && this.desiredWorkerCount > 0;
  }

  get workerCount() {
    return this.workers.length || this.desiredWorkerCount;
  }

  get queuedTaskCount() {
    return this.queue.length + this.active.size;
  }

  schedule(chunk, priority = 0) {
    if (!this.available) return false;
    this.ensureWorkers();
    const key = this.world.key(chunk.cx, chunk.cz);
    if (chunk.meshPending) {
      updateQueuedChunkWorkerTaskPriority(this.queue, key, priority);
      return true;
    }
    if (this.queue.length >= Math.max(1, this.workerCount) * CHUNK_MESH_QUEUE_PER_WORKER) {
      let worstIndex = 0;
      for (let i = 1; i < this.queue.length; i += 1) {
        if (compareChunkWorkerTasks(this.queue[worstIndex], this.queue[i]) < 0) {
          worstIndex = i;
        }
      }
      const worst = this.queue[worstIndex];
      if (!worst || priority >= worst.priority) return false;
      this.queue.splice(worstIndex, 1);
      const droppedChunk = this.world.chunks.get(worst.key);
      if (droppedChunk) {
        droppedChunk.meshPending = false;
        droppedChunk.dirty = true;
      }
    }

    const snapshot = chunk.createMeshSnapshot();
    const id = this.nextId;
    this.nextId += 1;

    chunk.meshPending = true;
    this.queue.push({
      id,
      key,
      cx: chunk.cx,
      cz: chunk.cz,
      version: chunk.meshVersion,
      priority,
      payload: {
        id,
        cx: chunk.cx,
        cz: chunk.cz,
        seed: this.world.seed,
        heightmapOnly: chunk.generationDetail !== ChunkGenerationDetail.FULL,
        smoothLighting: smoothLightingEnabled,
        fullBrightLighting: fullBrightLightingEnabled,
        blocks: snapshot.blocks,
        waterLevels: snapshot.waterLevels,
        skyLights: snapshot.skyLights,
        blockLights: snapshot.blockLights,
        grassColors: snapshot.grassColors,
        foliageColors: snapshot.foliageColors,
        waterColors: snapshot.waterColors,
        generatedColumns: snapshot.generatedColumns,
        columnTopY: snapshot.columnTopY,
      },
    });
    this.pump();
    return true;
  }

  pump() {
    if (!this.available) return;

    for (const slot of this.workers) {
      if (slot.busy || this.queue.length === 0) continue;
      const task = takeNextChunkWorkerTask(this.queue);
      slot.busy = true;
      slot.taskId = task.id;
      this.active.set(task.id, task);
      slot.worker.postMessage(task.payload, [
        task.payload.blocks.buffer,
        task.payload.waterLevels.buffer,
        task.payload.skyLights.buffer,
        task.payload.blockLights.buffer,
        task.payload.grassColors.buffer,
        task.payload.foliageColors.buffer,
        task.payload.waterColors.buffer,
        task.payload.generatedColumns.buffer,
        task.payload.columnTopY.buffer,
      ]);
    }
  }

  handleMessage(slot, data) {
    slot.busy = false;
    slot.taskId = null;
    const task = this.active.get(data.id);
    if (task) {
      this.active.delete(data.id);
      const chunk = this.world.chunks.get(task.key);
      if (chunk) {
        if (data.error) {
          console.warn("Chunk meshing worker failed:", data.error);
          chunk.meshPending = false;
          chunk.dirty = true;
        } else if (chunk.meshVersion === task.version) {
          this.world.enqueueMeshApply(chunk, data, task.version);
        } else {
          chunk.meshPending = false;
          chunk.dirty = true;
        }
      }
    }
    this.pump();
  }

  pruneQueuedOutside(pcx, pcz, maxDistance) {
    const retained = [];
    for (const task of this.queue) {
      if (Math.max(Math.abs(task.cx - pcx), Math.abs(task.cz - pcz)) <= maxDistance) {
        retained.push(task);
        continue;
      }
      const chunk = this.world.chunks.get(task.key);
      if (chunk) {
        chunk.meshPending = false;
        chunk.dirty = true;
      }
    }
    this.queue = retained;
  }

  handleWorkerFailure(slot, event) {
    const failedTask = slot.taskId !== null ? this.active.get(slot.taskId) : null;
    console.warn(
      "Chunk meshing worker failed:",
      event.message || event,
      failedTask
        ? `chunk=${failedTask.cx},${failedTask.cz} heightmapOnly=${failedTask.payload.heightmapOnly}`
        : "",
    );
    event.preventDefault?.();
    slot.worker.terminate();
    this.workers = this.workers.filter((entry) => entry !== slot);

    if (slot.taskId !== null) {
      const task = this.active.get(slot.taskId);
      this.active.delete(slot.taskId);
      const chunk = task ? this.world.chunks.get(task.key) : null;
      if (chunk) {
        chunk.meshPending = false;
        chunk.dirty = true;
      }
    }

    if (this.workers.length === 0) {
      this.disabled = true;
      for (const task of this.queue) {
        const chunk = this.world.chunks.get(task.key);
        if (chunk) {
          chunk.meshPending = false;
          chunk.dirty = true;
        }
      }
      this.queue = [];
      return;
    }

    this.pump();
  }

  dispose() {
    for (const slot of this.workers) {
      slot.worker.terminate();
    }

    for (const task of [...this.queue, ...this.active.values()]) {
      const chunk = this.world.chunks.get(task.key);
      if (chunk) chunk.meshPending = false;
    }

    this.queue = [];
    this.active.clear();
    this.workers = [];
    this.disabled = true;
  }
}

class ChunkGenerationWorkerPool {
  constructor(world) {
    this.world = world;
    this.queue = [];
    this.active = new Map();
    this.workers = [];
    this.nextId = 1;
    this.disabled = typeof Worker === "undefined";
    this.desiredWorkerCount = this.disabled ? 0 : chunkWorkerCounts().generation;
  }

  ensureWorkers() {
    if (!this.available || this.workers.length > 0) return;

    for (let i = 0; i < this.desiredWorkerCount; i += 1) {
      const worker = new Worker(new URL("./chunkGenerator.js", import.meta.url), { type: "module" });
      const slot = { worker, busy: false, taskId: null };
      worker.onmessage = (event) => this.handleMessage(slot, event.data);
      worker.onerror = (event) => this.handleWorkerFailure(slot, event);
      this.workers.push(slot);
    }
  }

  get available() {
    return !this.disabled && this.desiredWorkerCount > 0;
  }

  get workerCount() {
    return this.workers.length || this.desiredWorkerCount;
  }

  get queuedTaskCount() {
    return this.queue.length + this.active.size;
  }

  schedule(chunk, priority = 0, detail = ChunkGenerationDetail.FULL) {
    if (!this.available || chunkHasGenerationDetail(chunk, detail)) return false;
    this.ensureWorkers();
    const key = this.world.key(chunk.cx, chunk.cz);
    chunk.requestedGenerationDetail = maxChunkGenerationDetail(chunk.requestedGenerationDetail, detail);
    if (chunk.generationPending) {
      updateQueuedChunkGenerationTask(
        this.queue,
        key,
        priority,
        chunk.requestedGenerationDetail,
      );
      return true;
    }
    if (this.queue.length >= Math.max(1, this.workerCount) * CHUNK_GENERATION_QUEUE_PER_WORKER) {
      return false;
    }

    const id = this.nextId;
    this.nextId += 1;
    chunk.generationPending = true;
    this.queue.push({
      id,
      key,
      cx: chunk.cx,
      cz: chunk.cz,
      version: chunk.generationVersion,
      priority,
      detail: chunk.requestedGenerationDetail,
      payload: {
        id,
        cx: chunk.cx,
        cz: chunk.cz,
        seed: this.world.seed,
        biomeSeed: this.world.seedText,
        detail: chunk.requestedGenerationDetail,
      },
    });
    this.pump();
    return true;
  }

  pump() {
    if (!this.available) return;

    for (const slot of this.workers) {
      if (slot.busy || this.queue.length === 0) continue;
      const task = takeNextChunkWorkerTask(this.queue);
      slot.busy = true;
      slot.taskId = task.id;
      this.active.set(task.id, task);
      slot.worker.postMessage(task.payload);
    }
  }

  handleMessage(slot, data) {
    slot.busy = false;
    slot.taskId = null;
    const task = this.active.get(data.id);
    if (task) {
      this.active.delete(data.id);
      const chunk = this.world.chunks.get(task.key);
      if (chunk) {
        if (data.error) {
          console.warn("Chunk generation worker failed:", data.error);
          chunk.generationPending = false;
        } else if (
          chunk.generationVersion === task.version &&
          !chunkHasGenerationDetail(chunk, data.detail ?? task.detail)
        ) {
          this.world.enqueueGeneratedChunkApply(chunk, data, task.version);
        } else {
          chunk.generationPending = false;
        }
      }
    }
    this.pump();
  }

  pruneQueuedOutside(pcx, pcz, maxDistance) {
    const retained = [];
    for (const task of this.queue) {
      if (Math.max(Math.abs(task.cx - pcx), Math.abs(task.cz - pcz)) <= maxDistance) {
        retained.push(task);
        continue;
      }
      const chunk = this.world.chunks.get(task.key);
      if (chunk) {
        chunk.generationPending = false;
        chunk.requestedGenerationDetail = chunk.generationDetail;
      }
    }
    this.queue = retained;
  }

  handleWorkerFailure(slot, event) {
    console.warn("Chunk generation worker failed:", event.message || event);
    event.preventDefault?.();
    slot.worker.terminate();
    this.workers = this.workers.filter((entry) => entry !== slot);

    if (slot.taskId !== null) {
      const task = this.active.get(slot.taskId);
      this.active.delete(slot.taskId);
      const chunk = task ? this.world.chunks.get(task.key) : null;
      if (chunk) {
        chunk.generationPending = false;
        chunk.requestedGenerationDetail = chunk.generationDetail;
      }
    }

    if (this.workers.length === 0) {
      this.disabled = true;
      for (const task of this.queue) {
        const chunk = this.world.chunks.get(task.key);
        if (chunk) {
          chunk.generationPending = false;
          chunk.requestedGenerationDetail = chunk.generationDetail;
        }
      }
      this.queue = [];
      return;
    }

    this.pump();
  }

  dispose() {
    for (const slot of this.workers) slot.worker.terminate();
    for (const task of [...this.queue, ...this.active.values()]) {
      const chunk = this.world.chunks.get(task.key);
      if (chunk) chunk.generationPending = false;
    }

    this.queue = [];
    this.active.clear();
    this.workers = [];
    this.disabled = true;
  }
}

class VoxelWorld {
  constructor(scene, seedText = DEFAULT_WORLD_SEED) {
    this.scene = scene;
    this.material = WORLD_MATERIAL;
    this.seedText = normalizeWorldSeedText(seedText);
    this.seed = minecraftSeedHash(this.seedText);
    this.generator = createOverworldGenerator({
      seed: this.seed,
      biomeSeed: this.seedText,
      Block,
      Biome,
      BIOMES,
      worldHeight: WORLD_HEIGHT,
      seaLevel: SEA_LEVEL,
      waterLevel: WATER_LEVEL,
    });
    this.chunks = new Map();
    // chunkDataCache: key -> { blocks: Uint16Array, waterLevels: Uint8Array }
    // Map iteration order is insertion order, so deleting+resetting on access
    // gives us LRU semantics.
    this.chunkDataCache = new Map();
    this.modified = new Map();
    this.modifiedWaterLevels = new Map();
    this.modifiedWaterFalling = new Set();
    this.modifiedLavaLevels = new Map();
    this.precipitationColumnVersions = new Map();
    this.precipitationRevision = 0;
    this.blockLightSources = new Map();
    this.dynamicBlockLightTimer = 0;
    this.dynamicBlockLights = this.createDynamicBlockLightPool();
    this.waterSources = new Set();
    this.waterQueue = [];
    this.waterQueueHead = 0;
    this.waterQueued = new Map();
    this.waterTick = 0;
    this.waterFlowPlanQueue = [];
    this.waterFlowPlanQueueHead = 0;
    this.waterFlowPlanQueued = new Map();
    this.waterFlowPlanToken = 0;
    this.lavaLevels = new Map();
    this.lavaSources = new Set();
    this.lavaQueue = [];
    this.lavaQueueHead = 0;
    this.lavaQueued = new Map();
    this.lavaTick = 0;
    this.waterSourceConversion = true;
    this.lavaSourceConversion = false;
    this.spawnPoint = null;
    this.isMeshing = false;
    this.asyncGenerationEnabled = false;
    this.asyncMeshingEnabled = false;
    this.framePressure = 0;
    this.generatedChunkApplyQueue = [];
    this.meshApplyQueue = [];
    this.generationWorkerPool = new ChunkGenerationWorkerPool(this);
    this.meshWorkerPool = new ChunkMeshWorkerPool(this);
  }

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  precipitationColumnKey(wx, wz) {
    return `${wx},${wz}`;
  }

  getPrecipitationColumnVersion(wx, wz) {
    return this.precipitationColumnVersions.get(this.precipitationColumnKey(wx, wz)) ?? 0;
  }

  markPrecipitationColumnDirty(wx, wz) {
    const key = this.precipitationColumnKey(wx, wz);
    this.precipitationColumnVersions.set(key, (this.precipitationColumnVersions.get(key) ?? 0) + 1);
    this.precipitationRevision += 1;
  }

  createDynamicBlockLightPool() {
    const lights = [];
    for (let i = 0; i < DYNAMIC_BLOCK_LIGHT_COUNT; i += 1) {
      const light = new THREE.PointLight(DYNAMIC_BLOCK_LIGHT_COLOR, 0, DYNAMIC_BLOCK_LIGHT_RANGE, 0.45);
      light.visible = false;
      light.castShadow = false;
      this.scene.add(light);
      lights.push(light);
    }
    return lights;
  }

  getChunk(cx, cz, options = {}) {
    const key = this.key(cx, cz);
    const requestedDetail = options.detail ?? ChunkGenerationDetail.FULL;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const populate = options.populate ?? true;
      // Restore from data cache if available — avoids running worldgen again
      // for any chunk the player has visited recently.
      const cached = this.takeCachedChunkData(key);
      if (cached) {
        chunk = new Chunk(cx, cz, this, { populate: false });
        chunk.applyGeneratedData(cached.blocks, cached.waterLevels, cached.generationDetail);
        if (populate && !chunkHasGenerationDetail(chunk, requestedDetail)) {
          chunk.generateNow(requestedDetail);
        }
        this.applySavedModifications(chunk);
      } else {
        // Construct first, then generate at the requested detail. Passing
        // populate=true into Chunk always used generateNow()'s FULL default,
        // even for an explicit surface/terrain request.
        chunk = new Chunk(cx, cz, this, { populate: false });
        if (populate) chunk.generateNow(requestedDetail);
        if (chunk.generated) this.applySavedModifications(chunk);
      }
      this.chunks.set(key, chunk);
      this.markLoadedChunkNeighborsDirty(cx, cz);
    } else if (!chunkHasGenerationDetail(chunk, requestedDetail) && options.generate !== false) {
      const cached = this.takeCachedChunkData(key);
      if (cached) {
        chunk.applyGeneratedData(cached.blocks, cached.waterLevels, cached.generationDetail);
      }
      if (!chunkHasGenerationDetail(chunk, requestedDetail)) chunk.generateNow(requestedDetail);
      this.applySavedModifications(chunk);
      this.markLoadedChunkNeighborsDirty(cx, cz);
    }
    return chunk;
  }

  createPendingChunk(cx, cz) {
    const key = this.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz, this, { populate: false });
      // If we have cached data for this position, restore it now so the async
      // generator doesn't get scheduled for a chunk we already know.
      const cached = this.takeCachedChunkData(key);
      if (cached) {
        chunk.applyGeneratedData(cached.blocks, cached.waterLevels, cached.generationDetail);
        this.applySavedModifications(chunk);
        this.markLoadedChunkNeighborsDirty(cx, cz);
      }
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  takeCachedChunkData(key) {
    const cached = this.chunkDataCache.get(key);
    if (!cached) return null;
    this.chunkDataCache.delete(key);
    return cached;
  }

  storeCachedChunkData(key, chunk) {
    if (!chunk.generated || !chunk.blocks || !chunk.waterLevels) return;
    if (this.chunkDataCache.has(key)) this.chunkDataCache.delete(key);
    this.chunkDataCache.set(key, {
      blocks: chunk.blocks,
      waterLevels: chunk.waterLevels,
      generationDetail: chunk.generationDetail,
    });
    while (this.chunkDataCache.size > CHUNK_DATA_CACHE_LIMIT) {
      const oldestKey = this.chunkDataCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.chunkDataCache.delete(oldestKey);
    }
  }

  markLoadedChunkNeighborsDirty(cx, cz) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighbor = this.chunks.get(this.key(cx + dx, cz + dz));
      if (!neighbor) continue;
      if (neighbor.meshPending) {
        neighbor.remeshAfterPending = true;
    } else if (neighbor.mesh || neighbor.leafMesh || neighbor.torchMesh || neighbor.waterMesh || neighbor.lavaMesh) {
      neighbor.markDirty();
    }
    }
  }

  chunkHasGeneratedHorizontalNeighbors(chunk) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (!this.chunks.get(this.key(chunk.cx + dx, chunk.cz + dz))?.generated) return false;
    }
    return true;
  }

  bootstrapSpawnChunks(position, radius = SPAWN_READY_RADIUS) {
    const pcx = Math.floor(position.x / CHUNK_SIZE);
    const pcz = Math.floor(position.z / CHUNK_SIZE);
    const coords = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        coords.push({ cx: pcx + dx, cz: pcz + dz, distanceSq: dx * dx + dz * dz });
      }
    }
    coords.sort((a, b) => a.distanceSq - b.distanceSq);

    for (const coord of coords) {
      const chunk = this.createPendingChunk(coord.cx, coord.cz);
      if (!chunk.generated) {
        chunk.generateNow(ChunkGenerationDetail.TERRAIN);
        this.applySavedModifications(chunk);
        this.markLoadedChunkNeighborsDirty(chunk.cx, chunk.cz);
      }
    }

    const center = this.chunks.get(this.key(pcx, pcz));
    if (center?.generated && center.dirty) center.rebuildMesh();
  }

  ensureChunksAround(position, renderDistance = RENDER_DISTANCE, buildBudget = CHUNK_BUILD_BUDGET, options = {}) {
    const startedAt = performance.now();
    const pcx = Math.floor(position.x / CHUNK_SIZE);
    const pcz = Math.floor(position.z / CHUNK_SIZE);
    const usingAsyncGeneration = this.asyncGenerationEnabled && this.generationWorkerPool?.available;
    const usingAsyncMeshing = this.asyncMeshingEnabled && this.meshWorkerPool?.available;
    const deferMeshingUntilChunksReady = options.deferMeshingUntilChunksReady ?? false;
    const requireMeshNeighbors = options.requireMeshNeighbors ?? true;
    const creationBudgetOverride = options.createBudget ?? null;
    const timeBudgetMs = options.timeBudgetMs ?? (usingAsyncMeshing ? CHUNK_PLAY_TIME_BUDGET_MS : 8);
    const travelDirection = options.travelDirection ?? null;
    const travelLength = travelDirection ? Math.hypot(travelDirection.x ?? 0, travelDirection.z ?? 0) : 0;
    const travelX = travelLength > 0.001 ? (travelDirection.x ?? 0) / travelLength : 0;
    const travelZ = travelLength > 0.001 ? (travelDirection.z ?? 0) / travelLength : 0;
    const generationPadding = Math.max(0, options.generationPadding ?? 1);
    const leadChunks = usingAsyncGeneration ? Math.max(0, options.leadChunks ?? CHUNK_BACKGROUND_PREFETCH_RING) : 0;
    const generationDistance = renderDistance + generationPadding + leadChunks;
    if (usingAsyncGeneration) {
      this.generationWorkerPool.pruneQueuedOutside(pcx, pcz, generationDistance);
    }
    if (usingAsyncMeshing) {
      this.meshWorkerPool.pruneQueuedOutside(pcx, pcz, renderDistance + 1);
    }
    let buildsRemaining = buildBudget <= 0
      ? 0
      : usingAsyncMeshing
        ? this.meshWorkerPool.workerCount * CHUNK_MESH_QUEUE_PER_WORKER
        : buildBudget;
    let createsRemaining = creationBudgetOverride ?? (
      buildBudget <= 0
        ? 0
        : usingAsyncGeneration
          ? Math.max(
            0,
            this.generationWorkerPool.workerCount * CHUNK_GENERATION_QUEUE_PER_WORKER -
              this.generationWorkerPool.queuedTaskCount,
          )
          : usingAsyncMeshing
            ? Math.max(1, Math.min(2, CHUNK_CREATE_BUDGET, Math.ceil(renderDistance * 0.35), buildBudget))
          : Math.max(CHUNK_CREATE_BUDGET, Math.min(buildBudget * 2, renderDistance + buildBudget))
    );
    if (creationBudgetOverride !== null && usingAsyncGeneration) {
      createsRemaining = Math.min(
        createsRemaining,
        Math.max(
          0,
          this.generationWorkerPool.workerCount * CHUNK_GENERATION_QUEUE_PER_WORKER -
            this.generationWorkerPool.queuedTaskCount,
        ),
      );
    }

    if (creationBudgetOverride === null && !usingAsyncGeneration && usingAsyncMeshing && this.framePressure > 0.032) {
      createsRemaining = Math.min(createsRemaining, 1);
      buildsRemaining = Math.min(buildsRemaining, 1);
    } else if (creationBudgetOverride === null && !usingAsyncGeneration && usingAsyncMeshing && this.framePressure > 0.024) {
      createsRemaining = Math.min(createsRemaining, 1);
    }

    const hasFrameBudget = () => performance.now() - startedAt < timeBudgetMs;
    const coords = [];

    for (let dz = -generationDistance; dz <= generationDistance; dz += 1) {
      for (let dx = -generationDistance; dx <= generationDistance; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dz));
        if (distance > renderDistance + 1) {
          const ahead = dx * travelX + dz * travelZ;
          const backgroundLead = Math.min(leadChunks, CHUNK_BACKGROUND_PREFETCH_RING);
          const withinBackgroundRing = distance <= renderDistance + 1 + backgroundLead;
          const withinTravelLead = ahead > renderDistance && distance - ahead <= Math.max(1, leadChunks);
          if (!withinBackgroundRing && !withinTravelLead) continue;
        }
        const distanceSq = dx * dx + dz * dz;
        const forward = dx * travelX + dz * travelZ;
        const visiblePriorityLimit = renderDistance * renderDistance * 2 + 1;
        const prefetchPriority = visiblePriorityLimit + distanceSq +
          Math.max(0, distance - renderDistance) * visiblePriorityLimit -
          Math.max(0, forward) * 0.5;
        coords.push({
          cx: pcx + dx,
          cz: pcz + dz,
          dx,
          dz,
          distance,
          distanceSq,
          priority: distance <= renderDistance ? distanceSq : prefetchPriority,
        });
      }
    }

    coords.sort((a, b) => a.priority - b.priority || a.distance - b.distance || a.distanceSq - b.distanceSq || a.dz - b.dz || a.dx - b.dx);
    const deferReadyDistance = renderDistance + (requireMeshNeighbors ? Math.min(1, generationPadding) : 0);
    const shouldDeferMeshing = deferMeshingUntilChunksReady && coords.some((coord) =>
      coord.distance <= deferReadyDistance && !this.chunks.get(this.key(coord.cx, coord.cz))?.generated,
    );

    let frameBudgetSpent = false;
    for (const coord of coords) {
      let chunk = this.chunks.get(this.key(coord.cx, coord.cz));
      const targetGenerationDetail = coord.distance <= FULL_DETAIL_CHUNK_RADIUS
        ? ChunkGenerationDetail.FULL
        : ChunkGenerationDetail.SURFACE;
      const hasVisibleMesh = chunkHasVisibleMesh(chunk);
      const desiredGenerationDetail = !chunk?.generated
        ? coord.distance <= SPAWN_READY_RADIUS
          ? ChunkGenerationDetail.TERRAIN
          : ChunkGenerationDetail.SURFACE
        : hasVisibleMesh
          ? targetGenerationDetail
          : chunk.generationDetail;
      if (!chunkHasGenerationDetail(chunk, desiredGenerationDetail)) {
        if (usingAsyncGeneration) {
          if (!chunk) {
            if (createsRemaining <= 0) continue;
            if (!hasFrameBudget()) {
              frameBudgetSpent = true;
              break;
            }
            chunk = this.createPendingChunk(coord.cx, coord.cz);
          }
          if (!chunkHasGenerationDetail(chunk, desiredGenerationDetail)) {
            const wasPending = chunk.generationPending;
            const needsDetailUpgrade =
              chunkGenerationDetailRank(desiredGenerationDetail) >
              chunkGenerationDetailRank(chunk.requestedGenerationDetail);
            if (!wasPending && createsRemaining <= 0) continue;
            if (!wasPending || needsDetailUpgrade) {
              const generationPriority = desiredGenerationDetail === ChunkGenerationDetail.FULL
                ? coord.priority + FULL_DETAIL_GENERATION_PRIORITY_OFFSET
                : desiredGenerationDetail === ChunkGenerationDetail.SURFACE
                  ? coord.priority + SURFACE_GENERATION_PRIORITY_OFFSET
                  : coord.priority;
              if (this.generationWorkerPool.schedule(chunk, generationPriority, desiredGenerationDetail) && !wasPending) {
                createsRemaining -= 1;
              }
            }
          }
        } else if (!chunk) {
          if (createsRemaining <= 0) continue;
          if (!hasFrameBudget()) {
            frameBudgetSpent = true;
            break;
          }
          chunk = this.getChunk(coord.cx, coord.cz);
          createsRemaining -= 1;
        } else if (!chunkHasGenerationDetail(chunk, desiredGenerationDetail)) {
          if (!hasFrameBudget()) {
            frameBudgetSpent = true;
            break;
          }
          chunk.generateNow(desiredGenerationDetail);
          this.applySavedModifications(chunk);
          this.markLoadedChunkNeighborsDirty(chunk.cx, chunk.cz);
        }
      }

      if (shouldDeferMeshing) continue;
      if (!chunk.generated) continue;

      if (coord.distance <= renderDistance && chunk.dirty && buildsRemaining > 0) {
        if (chunk.meshPending) continue;
        if (
          requireMeshNeighbors &&
          coord.distance > NEAR_CHUNK_MESH_WITHOUT_NEIGHBORS_RADIUS &&
          !this.chunkHasGeneratedHorizontalNeighbors(chunk)
        ) continue;
        if (!hasFrameBudget()) {
          frameBudgetSpent = true;
          break;
        }
        if (usingAsyncMeshing) {
          const meshPriority = coord.distanceSq + (hasVisibleMesh ? CHUNK_REMESH_PRIORITY_OFFSET : 0);
          if (!this.meshWorkerPool.schedule(chunk, meshPriority)) continue;
        } else {
          chunk.rebuildMesh();
        }
        buildsRemaining -= 1;
      }
    }

    if (!frameBudgetSpent && !shouldDeferMeshing && buildsRemaining > 0) {
      for (const chunk of this.chunks.values()) {
        const dx = chunk.cx - pcx;
        const dz = chunk.cz - pcz;
        const distance = Math.max(Math.abs(dx), Math.abs(dz));
        if (distance <= renderDistance && chunk.generated && chunk.dirty && buildsRemaining > 0) {
          if (chunk.meshPending) continue;
          if (
            requireMeshNeighbors &&
            distance > NEAR_CHUNK_MESH_WITHOUT_NEIGHBORS_RADIUS &&
            !this.chunkHasGeneratedHorizontalNeighbors(chunk)
          ) continue;
          if (!hasFrameBudget()) break;
          if (usingAsyncMeshing) {
            const meshPriority = dx * dx + dz * dz +
              (chunkHasVisibleMesh(chunk) ? CHUNK_REMESH_PRIORITY_OFFSET : 0);
            if (!this.meshWorkerPool.schedule(chunk, meshPriority)) continue;
          } else {
            chunk.rebuildMesh();
          }
          buildsRemaining -= 1;
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > renderDistance + CHUNK_RETENTION_RING + leadChunks) {
        // Stash block/waterLevel arrays in the LRU cache before disposing the
        // chunk's GPU meshes. If the player walks back, getChunk() will pull from
        // the cache instead of running worldgen.
        if (chunk.generated && !chunk.meshPending && !chunk.generationPending) {
          this.storeCachedChunkData(key, chunk);
        }
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    return buildsRemaining;
  }

  findSpawnPoint(originX = 0, originZ = 0, maxRadius = 128) {
    if (this.spawnPoint) return this.spawnPoint.clone();

    if (this.generator.minecraft26Terrain) {
      const coarseStep = 64;
      const modernRadius = Math.max(maxRadius, 2048);
      let coarseBest = null;
      for (let radius = 0; radius <= modernRadius && !coarseBest; radius += coarseStep) {
        for (let dz = -radius; dz <= radius; dz += coarseStep) {
          for (let dx = -radius; dx <= radius; dx += coarseStep) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = originX + dx;
            const z = originZ + dz;
            const groundY = this.terrainHeight(x, z);
            const candidate = this.safeSpawnPointAt(x, groundY, z);
            if (!candidate) continue;
            const distanceSq = dx * dx + dz * dz;
            if (!coarseBest || distanceSq < coarseBest.distanceSq) {
              coarseBest = { point: candidate, distanceSq };
            }
          }
        }
      }

      if (coarseBest) {
        let best = coarseBest;
        const centerX = Math.floor(coarseBest.point.x);
        const centerZ = Math.floor(coarseBest.point.z);
        for (let z = centerZ - coarseStep; z <= centerZ + coarseStep; z += 4) {
          for (let x = centerX - coarseStep; x <= centerX + coarseStep; x += 4) {
            const groundY = this.terrainHeight(x, z);
            const candidate = this.safeSpawnPointAt(x, groundY, z);
            if (!candidate) continue;
            const dx = x - originX;
            const dz = z - originZ;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq < best.distanceSq) best = { point: candidate, distanceSq };
          }
        }
        this.spawnPoint = best.point.clone();
        return best.point.clone();
      }
    }

    let best = null;
    const searchStep = 4;
    for (let radius = 0; radius <= maxRadius; radius += searchStep) {
      for (let dz = -radius; dz <= radius; dz += searchStep) {
        for (let dx = -radius; dx <= radius; dx += searchStep) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = originX + dx;
          const z = originZ + dz;
          const groundY = this.terrainHeight(x, z);
          const candidate = this.safeSpawnPointAt(x, groundY, z);
          if (!candidate) continue;
          const distanceSq = dx * dx + dz * dz;
          if (!best || distanceSq < best.distanceSq) best = { point: candidate, distanceSq };
        }
      }

      if (best) {
        const coarsePoint = best.point;
        for (let z = Math.floor(coarsePoint.z) - searchStep + 1; z <= Math.floor(coarsePoint.z) + searchStep - 1; z += 1) {
          for (let x = Math.floor(coarsePoint.x) - searchStep + 1; x <= Math.floor(coarsePoint.x) + searchStep - 1; x += 1) {
            const groundY = this.terrainHeight(x, z);
            const candidate = this.safeSpawnPointAt(x, groundY, z);
            if (!candidate) continue;
            const dx = x - originX;
            const dz = z - originZ;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq < best.distanceSq) best = { point: candidate, distanceSq };
          }
        }
        this.spawnPoint = best.point.clone();
        return best.point.clone();
      }
    }

    const fallbackGroundY = this.terrainHeight(originX, originZ);
    this.spawnPoint = new THREE.Vector3(originX + 0.5, fallbackGroundY + 6, originZ + 0.5);
    return this.spawnPoint.clone();
  }

  safeSpawnPointAt(x, groundY, z) {
    if (groundY <= WATER_LEVEL || groundY >= WORLD_HEIGHT - 4) return null;
    if (this.shouldFillWaterAt(x, z, groundY)) return null;
    if (this.localSteepnessAt(x, z) > 2) return null;

    const biomeId = this.biomeAt(x, z);
    const ground = this.surfaceBlocksFor(x, z, groundY, biomeId).top;
    if (!isSpawnGround(ground)) return null;
    if (this.generator.surfaceCaveMouthStrength(x, z, groundY) > 0.12) return null;

    // Spawn selection runs before surrounding chunks necessarily exist, so use
    // deterministic decoration queries to reserve the player's full body and
    // shoulder space instead of discovering a trunk/cactus after generation.
    if (
      this.treeTypeAt(x, z) ||
      this.shouldGrowCactus(x, z) ||
      this.rockTypeAt(x, z) ||
      this.plantTypeAt(x, z)
    ) return null;
    for (let dz = -3; dz <= 3; dz += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        if (this.treeTypeAt(x + dx, z + dz)) return null;
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && this.shouldGrowCactus(x + dx, z + dz)) return null;
        if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && this.rockTypeAt(x + dx, z + dz)) return null;
      }
    }

    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighborGroundY = this.terrainHeight(x + dx, z + dz);
      if (Math.abs(neighborGroundY - groundY) > 2) return null;
      if (this.shouldFillWaterAt(x + dx, z + dz, neighborGroundY)) return null;
    }

    return new THREE.Vector3(x + 0.5, groundY + 1, z + 0.5);
  }

  markAllChunksDirty() {
    for (const chunk of this.chunks.values()) {
      chunk.markDirty();
    }
  }

  chunkBuildStats(position, renderDistance) {
    const pcx = Math.floor(position.x / CHUNK_SIZE);
    const pcz = Math.floor(position.z / CHUNK_SIZE);
    let total = 0;
    let ready = 0;

    for (let dz = -renderDistance; dz <= renderDistance; dz += 1) {
      for (let dx = -renderDistance; dx <= renderDistance; dx += 1) {
        total += 1;
        const chunk = this.chunks.get(this.key(pcx + dx, pcz + dz));
        if (chunk?.generated && !chunk.dirty) ready += 1;
      }
    }

    return { ready, total };
  }

  chunkGeneratedStats(position, renderDistance) {
    const pcx = Math.floor(position.x / CHUNK_SIZE);
    const pcz = Math.floor(position.z / CHUNK_SIZE);
    let total = 0;
    let ready = 0;

    for (let dz = -renderDistance; dz <= renderDistance; dz += 1) {
      for (let dx = -renderDistance; dx <= renderDistance; dx += 1) {
        total += 1;
        const chunk = this.chunks.get(this.key(pcx + dx, pcz + dz));
        if (chunk?.generated) ready += 1;
      }
    }

    return { ready, total };
  }

  enqueueGeneratedChunkApply(chunk, chunkData, version) {
    this.generatedChunkApplyQueue.push({
      key: this.key(chunk.cx, chunk.cz),
      cx: chunk.cx,
      cz: chunk.cz,
      version,
      chunkData,
    });
  }

  processGeneratedChunkApplyQueue(timeBudgetMs = 3, focusPosition = null) {
    const startedAt = performance.now();
    if (focusPosition && this.generatedChunkApplyQueue.length > 1) {
      const pcx = Math.floor(focusPosition.x / CHUNK_SIZE);
      const pcz = Math.floor(focusPosition.z / CHUNK_SIZE);
      this.generatedChunkApplyQueue.sort((a, b) => compareChunkApplyTasksByDistance(a, b, pcx, pcz));
    }
    while (this.generatedChunkApplyQueue.length > 0 && performance.now() - startedAt < timeBudgetMs) {
      const task = this.generatedChunkApplyQueue.shift();
      const chunk = this.chunks.get(task.key);
      const detail = task.chunkData.detail ?? ChunkGenerationDetail.FULL;
      if (
        !chunk ||
        chunk.generationVersion !== task.version ||
        chunkHasGenerationDetail(chunk, detail)
      ) continue;
      chunk.applyGeneratedData(task.chunkData.blocks, task.chunkData.waterLevels, detail);
      this.applySavedModifications(chunk);
      this.markLoadedChunkNeighborsDirty(chunk.cx, chunk.cz);
    }
  }

  enqueueMeshApply(chunk, meshData, version) {
    this.meshApplyQueue.push({
      key: this.key(chunk.cx, chunk.cz),
      cx: chunk.cx,
      cz: chunk.cz,
      version,
      meshData,
    });
  }

  processMeshApplyQueue(timeBudgetMs = 2.5, focusPosition = null) {
    const startedAt = performance.now();
    if (focusPosition && this.meshApplyQueue.length > 1) {
      const pcx = Math.floor(focusPosition.x / CHUNK_SIZE);
      const pcz = Math.floor(focusPosition.z / CHUNK_SIZE);
      this.meshApplyQueue.sort((a, b) => compareChunkApplyTasksByDistance(a, b, pcx, pcz));
    }
    while (this.meshApplyQueue.length > 0 && performance.now() - startedAt < timeBudgetMs) {
      const task = this.meshApplyQueue.shift();
      const chunk = this.chunks.get(task.key);
      if (!chunk) continue;
      if (chunk.meshVersion === task.version) {
        chunk.applyMeshData(task.meshData);
      } else {
        chunk.meshPending = false;
        chunk.dirty = true;
      }
    }
  }

  terrainHeight(x, z) {
    return this.generator.terrainHeight(x, z);
  }

  hasGeneratedChunkAt(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    return Boolean(this.chunks.get(this.key(cx, cz))?.generated);
  }

  isSolidBlock(x, y, z) {
    const wx = Math.floor(x);
    const wy = Math.floor(y);
    const wz = Math.floor(z);
    if (wy < 0) return true;
    if (wy >= WORLD_HEIGHT) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk?.generated) return true;
    const block = chunk.getLocal(mod(wx, CHUNK_SIZE), wy, mod(wz, CHUNK_SIZE));
    return isSolid(block);
  }

  isWaterAt(x, y, z) {
    const block = this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return block === Block.WATER;
  }

  rawTerrainHeight(x, z) {
    return this.generator.rawTerrainHeight(x, z);
  }

  populateChunkTerrain(cx, cz, blocks, waterLevels, chunkSize, chunkArea, options = {}) {
    this.generator.populateChunkTerrain(cx, cz, blocks, waterLevels, chunkSize, chunkArea, options);
  }

  terrainShapeAt(x, z) {
    return this.generator.terrainShapeAt(x, z);
  }

  moistureAt(x, z) {
    return this.generator.moistureAt(x, z);
  }

  temperatureAt(x, z) {
    return this.generator.temperatureAt(x, z);
  }

  climateAt(x, z) {
    return this.generator.climateAt(x, z);
  }

  biomeAt(x, z) {
    return this.generator.biomeAt(x, z);
  }

  grassColorAt(x, z) {
    return biomeGrassColor(this.biomeAt(x, z));
  }

  foliageColorAt(x, z) {
    return biomeFoliageColor(this.biomeAt(x, z));
  }

  waterColorAt(x, z) {
    const b = this.biomeAt(x, z);
    if (b === Biome.SWAMPLAND || b === Biome.SWAMPLAND_M) return SWAMP_WATER_TINT;
    if (b === Biome.FROZEN_OCEAN || b === Biome.FROZEN_RIVER) return FROZEN_WATER_TINT;
    if (
      b === Biome.ICE_PLAINS ||
      b === Biome.ICE_MOUNTAINS ||
      b === Biome.ICE_SPIKES ||
      b === Biome.COLD_TAIGA ||
      b === Biome.COLD_TAIGA_HILLS ||
      b === Biome.COLD_TAIGA_M ||
      b === Biome.COLD_BEACH
    ) {
      return COLD_WATER_TINT;
    }
    return DEFAULT_WATER_TINT;
  }

  surfaceBlocksFor(x, z, height, biomeId) {
    return this.generator.surfaceBlocksFor(x, z, height, biomeId);
  }

  isNaturalWaterColumn(shape, height) {
    return this.generator.isNaturalWaterColumn(shape, height);
  }

  shouldFillWaterAt(x, z, height) {
    return this.generator.shouldFillWaterAt(x, z, height);
  }

  localSteepnessAt(x, z) {
    return this.generator.localSteepnessAt(x, z);
  }

  treeTypeAt(x, z) {
    return this.generator.treeTypeAt(x, z);
  }

  shouldGrowCactus(x, z) {
    return this.generator.shouldGrowCactus(x, z);
  }

  rockTypeAt(x, z) {
    return this.generator.rockTypeAt(x, z);
  }

  plantTypeAt(x, z) {
    return this.generator.plantTypeAt(x, z);
  }

  oreBlockAt(x, y, z, surfaceHeight) {
    return this.generator.oreBlockAt(x, y, z, surfaceHeight);
  }

  minecraftY(y) {
    return this.generator.minecraftY(y);
  }

  minecraft118Y(y) {
    return this.generator.minecraft118Y(y);
  }

  caveDensityAt(x, y, z, surfaceHeight) {
    return this.generator.caveDensityAt(x, y, z, surfaceHeight);
  }

  isCaveAt(x, y, z, surfaceHeight) {
    return this.generator.isCaveAt(x, y, z, surfaceHeight);
  }

  isRavineAt(x, y, z, surfaceHeight) {
    return this.generator.isRavineAt(x, y, z, surfaceHeight);
  }

  surfaceCaveMouthStrength(x, z, surfaceHeight) {
    return this.generator.surfaceCaveMouthStrength(x, z, surfaceHeight);
  }

  aquiferBlockAt(x, y, z, surfaceHeight) {
    return this.generator.aquiferBlockAt(x, y, z, surfaceHeight);
  }

  getBlock(wx, y, wz) {
    if (y < 0 || y >= WORLD_HEIGHT) return Block.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk || !chunk.generated) {
      if (this.isMeshing) return Block.AIR;
      if (this.asyncGenerationEnabled && this.generationWorkerPool?.available) {
        chunk = chunk ?? this.createPendingChunk(cx, cz);
        if (!chunk.generated && !chunk.generationPending) {
          this.generationWorkerPool.schedule(chunk, 0, ChunkGenerationDetail.TERRAIN);
        }
        return Block.AIR;
      }
      chunk = this.getChunk(cx, cz);
    }
    const lx = mod(wx, CHUNK_SIZE);
    const lz = mod(wz, CHUNK_SIZE);
    return chunk.getLocal(lx, y, lz);
  }

  getLoadedBlock(wx, y, wz) {
    if (y < 0 || y >= WORLD_HEIGHT) return Block.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return Block.AIR;
    return chunk.getLocal(mod(wx, CHUNK_SIZE), y, mod(wz, CHUNK_SIZE));
  }


  getLoadedWaterLevelStore(wx, y, wz) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return 0;
    return chunk.waterLevels[chunk.index(mod(wx, CHUNK_SIZE), y, mod(wz, CHUNK_SIZE))];
  }

  getSkyLightLevel(wx, y, wz) {
    if (y >= WORLD_HEIGHT) return MAX_LIGHT_LEVEL;
    if (y < 0) return 0;

    let light = MAX_LIGHT_LEVEL;
    for (let sy = WORLD_HEIGHT - 1; sy > y && light > 0; sy -= 1) {
      light -= getLightOpacity(this.getLoadedBlock(wx, sy, wz));
    }
    return clamp(Math.floor(light), 0, MAX_LIGHT_LEVEL);
  }

  getBlockLightLevel(wx, y, wz) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const key = `${wx},${y},${wz}`;
    return this.blockLightSources.get(key)?.level ?? getBlockLightSource(this.getLoadedBlock(wx, y, wz));
  }

  getCombinedLightLevel(wx, y, wz) {
    return Math.max(this.getSkyLightLevel(wx, y, wz), this.getBlockLightLevel(wx, y, wz));
  }

  waterSurfaceHeightAt(wx, y, wz) {
    if (this.getBlock(wx, y, wz) !== Block.WATER) return null;
    return getWaterSurfaceHeight(this, wx, y, wz);
  }

  lavaSurfaceHeightAt(wx, y, wz) {
    if (!isLava(this.getBlock(wx, y, wz))) return null;
    return getLavaSurfaceHeight(this, wx, y, wz);
  }

  waterSurfaceYAt(wx, y, wz) {
    const height = this.waterSurfaceHeightAt(wx, y, wz);
    return height === null ? null : y + height;
  }

  lavaSurfaceYAt(wx, y, wz) {
    const height = this.lavaSurfaceHeightAt(wx, y, wz);
    return height === null ? null : y + height;
  }

  createBlockChangePayload(wx, y, wz, block, options = {}, previousBlock = Block.AIR) {
    const change = {
      x: Math.floor(wx),
      y: Math.floor(y),
      z: Math.floor(wz),
      block,
      previousBlock,
      options: {},
    };

    if (block === Block.WATER) {
      change.options.waterLevel = options.waterLevel ?? 0;
      change.options.waterFalling = Boolean(options.waterFalling ?? options.falling ?? false);
      change.options.isSource = options.isSource ?? (change.options.waterLevel === 0 && !change.options.waterFalling);
    } else if (isLava(block)) {
      change.options.lavaLevel = options.lavaLevel ?? 0;
      change.options.lavaFalling = Boolean(options.lavaFalling ?? options.falling ?? false);
      change.options.isSource = options.isSource ?? (change.options.lavaLevel === 0 && !change.options.lavaFalling);
    }

    return change;
  }

  setBlock(wx, y, wz, block, options = {}) {
    if (y <= 0 || y >= WORLD_HEIGHT) return false;
    const key = `${wx},${y},${wz}`;
    const current = this.getBlock(wx, y, wz);

    if (!options.skipLiquidInteractions) {
      if (block === Block.WATER && isLava(current)) {
        return this.mixWaterIntoLava(wx, y, wz, options.direction ?? null);
      }
      if (isLava(block) && current === Block.WATER) {
        return this.mixLavaIntoWater(wx, y, wz, options.direction ?? null);
      }
    }

    if (block === Block.WATER && current !== block && isWaterBreakableBlock(current)) {
      this.onFluidBreakBlock?.(current, wx, y, wz, block, options);
    }

    this.modified.set(key, block);
    if (block === Block.WATER) {
      const level = options.waterLevel ?? 0;
      this.modifiedWaterLevels.set(key, level);
      if (options.waterFalling) this.modifiedWaterFalling.add(key);
      else this.modifiedWaterFalling.delete(key);
      this.modifiedLavaLevels.delete(key);
      this.lavaLevels.delete(key);
      this.lavaSources.delete(key);
      const isSource = options.isSource ?? (level === 0);
      if (isSource) this.waterSources.add(key);
      else this.waterSources.delete(key);
    } else if (isLava(block)) {
      const level = options.lavaLevel ?? 0;
      const falling = Boolean(options.lavaFalling ?? options.falling ?? false);
      this.modifiedWaterLevels.delete(key);
      if (falling) this.modifiedWaterFalling.add(key);
      else this.modifiedWaterFalling.delete(key);
      this.modifiedLavaLevels.set(key, level);
      this.lavaLevels.set(key, level);
      this.waterSources.delete(key);
      const isSource = options.isSource ?? (level === 0);
      if (isSource) this.lavaSources.add(key);
      else this.lavaSources.delete(key);
    } else {
      this.modifiedWaterLevels.delete(key);
      this.modifiedWaterFalling.delete(key);
      this.modifiedLavaLevels.delete(key);
      this.waterSources.delete(key);
      this.lavaLevels.delete(key);
      this.lavaSources.delete(key);
    }

    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    chunk.setLocal(
      mod(wx, CHUNK_SIZE),
      y,
      mod(wz, CHUNK_SIZE),
      block,
      options.waterLevel ?? options.lavaLevel ?? null,
      options.waterFalling ?? options.lavaFalling ?? options.falling ?? false,
    );
    if (current !== block) this.markPrecipitationColumnDirty(wx, wz);
    this.updateBlockLightSource(key, block, wx, y, wz);
    const isLightSourceChange = getBlockLightSource(current) > 0 || getBlockLightSource(block) > 0;
    this.markChunkAndNeighborsDirty(wx, wz, isLightSourceChange);
    if (!options.skipWaterUpdate) {
      if (block === Block.WATER) {
        const level = options.waterLevel ?? 0;
        const isSource = options.isSource ?? (level === 0);
        if (isSource && (options.precomputeWaterFlow ?? true)) {
          this.scheduleWaterFlowPlan(wx, y, wz);
        } else {
          this.queueWater(wx, y, wz, WATER_PLACED_FLOW_DELAY_TICKS);
        }
      } else {
        this.queueWaterAround(wx, y, wz, WATER_PLACED_FLOW_DELAY_TICKS);
      }
    }
    if (!options.skipLavaUpdate) {
      if (isLava(block)) this.queueLava(wx, y, wz, LAVA_PLACED_FLOW_DELAY_TICKS);
      else this.queueLavaAround(wx, y, wz, LAVA_PLACED_FLOW_DELAY_TICKS);
    }
    if (!options.skipLiquidInteractions) this.resolveLiquidInteractionsAround(wx, y, wz);
    if (!options.multiplayerRemote && typeof this.onBlockChanged === "function") {
      this.onBlockChanged(this.createBlockChangePayload(wx, y, wz, block, options, current));
    }
    return true;
  }

  applyRemoteBlockChange(change) {
    const wx = Math.floor(change.x);
    const y = Math.floor(change.y);
    const wz = Math.floor(change.z);
    const block = change.block;
    const options = change.options ?? {};
    if (y <= 0 || y >= WORLD_HEIGHT) return false;

    const key = `${wx},${y},${wz}`;
    this.modified.set(key, block);
    if (block === Block.WATER) {
      const level = options.waterLevel ?? 0;
      this.modifiedWaterLevels.set(key, level);
      if (options.waterFalling) this.modifiedWaterFalling.add(key);
      else this.modifiedWaterFalling.delete(key);
      this.modifiedLavaLevels.delete(key);
      this.lavaLevels.delete(key);
      this.lavaSources.delete(key);
      const isSource = options.isSource ?? (level === 0 && !options.waterFalling);
      if (isSource) this.waterSources.add(key);
      else this.waterSources.delete(key);
    } else if (isLava(block)) {
      const level = options.lavaLevel ?? 0;
      const falling = Boolean(options.lavaFalling ?? options.falling ?? false);
      this.modifiedWaterLevels.delete(key);
      if (falling) this.modifiedWaterFalling.add(key);
      else this.modifiedWaterFalling.delete(key);
      this.modifiedLavaLevels.set(key, level);
      this.lavaLevels.set(key, level);
      this.waterSources.delete(key);
      const isSource = options.isSource ?? (level === 0 && !falling);
      if (isSource) this.lavaSources.add(key);
      else this.lavaSources.delete(key);
    } else {
      this.modifiedWaterLevels.delete(key);
      this.modifiedWaterFalling.delete(key);
      this.modifiedLavaLevels.delete(key);
      this.waterSources.delete(key);
      this.lavaLevels.delete(key);
      this.lavaSources.delete(key);
    }

    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.key(cx, cz));
    let current = Block.AIR;
    if (chunk?.generated) {
      const lx = mod(wx, CHUNK_SIZE);
      const lz = mod(wz, CHUNK_SIZE);
      current = chunk.getLocal(lx, y, lz);
      chunk.setLocal(
        lx,
        y,
        lz,
        block,
        options.waterLevel ?? options.lavaLevel ?? null,
        options.waterFalling ?? options.lavaFalling ?? options.falling ?? false,
      );
      if (current !== block) this.markPrecipitationColumnDirty(wx, wz);
      const isLightSourceChange = getBlockLightSource(current) > 0 || getBlockLightSource(block) > 0;
      this.markChunkAndNeighborsDirty(wx, wz, isLightSourceChange);
    }

    this.updateBlockLightSource(key, block, wx, y, wz);
    return true;
  }

  updateBlockLightSource(key, block, wx, y, wz) {
    const lightLevel = getBlockLightSource(block);
    if (lightLevel > 0 && isDynamicBlockLightSource(block)) {
      const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id ?? "";
      this.blockLightSources.set(key, { x: wx, y, z: wz, level: lightLevel, id });
    }
    else this.blockLightSources.delete(key);
    this.dynamicBlockLightTimer = 0;
  }

  getLavaLevel(wx, y, wz) {
    if (y < 0 || y >= WORLD_HEIGHT) return null;
    if (!isLava(this.getBlock(wx, y, wz))) return null;
    const key = `${wx},${y},${wz}`;
    if (this.lavaLevels.has(key)) return this.lavaLevels.get(key);
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.key(cx, cz));
    return chunk?.getWaterLevelLocal(mod(wx, CHUNK_SIZE), y, mod(wz, CHUNK_SIZE)) ?? 0;
  }

  isLavaFallingAt(wx, y, wz) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    if (!isLava(this.getBlock(wx, y, wz))) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk || !chunk.generated) {
      if (this.chunkDataCache.has(key)) {
        chunk = this.getChunk(cx, cz);
      } else {
        return false;
      }
    }
    return chunk.isWaterFallingLocal(mod(wx, CHUNK_SIZE), y, mod(wz, CHUNK_SIZE));
  }

  setLavaBlock(wx, y, wz, level, options = {}) {
    if (y <= 0 || y >= WORLD_HEIGHT) return false;
    const current = this.getBlock(wx, y, wz);
    const nextLevel = clamp(level, 0, LAVA_MAX_DEPTH);
    const nextFalling = Boolean(options.falling ?? options.lavaFalling ?? false);

    if (current === Block.WATER) {
      return this.mixLavaIntoWater(wx, y, wz, options.direction ?? null);
    }
    if (isSolid(current) && !isLava(current)) return false;
    if (isLava(current) && (this.getLavaLevel(wx, y, wz) ?? 0) <= nextLevel) return false;
    if (!isLava(current) && this.canCreateBasaltAt(wx, y, wz)) {
      return this.setBlock(wx, y, wz, Block.BASALT, { skipLiquidInteractions: true });
    }

    const lavaBlock = getExtraBlockByItemId("lava");
    if (!lavaBlock) return false;
    const placed = this.setBlock(wx, y, wz, lavaBlock, {
      lavaLevel: nextLevel,
      lavaFalling: nextFalling,
      skipLavaUpdate: true,
      isSource: options.isSource ?? false,
    });
    if (!placed) return false;
    this.queueLava(wx, y, wz, LAVA_PLACED_FLOW_DELAY_TICKS);
    return true;
  }

  queueLava(wx, y, wz, delayTicks = LAVA_PLACED_FLOW_DELAY_TICKS) {
    if (y <= 0 || y >= WORLD_HEIGHT) return;
    const key = `${wx},${y},${wz}`;
    const dueTick = this.lavaTick + Math.max(0, delayTicks | 0);
    const queuedTick = this.lavaQueued.get(key);
    if (queuedTick !== undefined && queuedTick <= dueTick) return;
    this.lavaQueued.set(key, dueTick);
    const previousDueTick = this.lavaQueue[this.lavaQueue.length - 1]?.dueTick ?? -Infinity;
    this.lavaQueue.push({ wx, y, wz, key, dueTick });
    if (dueTick < previousDueTick) this.sortLavaQueue();
  }

  sortLavaQueue() {
    const processed = this.lavaQueueHead > 0 ? this.lavaQueue.slice(0, this.lavaQueueHead) : [];
    const pending = this.lavaQueue.slice(this.lavaQueueHead).sort((a, b) => a.dueTick - b.dueTick);
    this.lavaQueue = processed.concat(pending);
  }

  queueLavaAround(wx, y, wz, delayTicks = LAVA_PLACED_FLOW_DELAY_TICKS) {
    this.queueLava(wx, y, wz, delayTicks);
    this.queueLava(wx, y + 1, wz, delayTicks);
    this.queueLava(wx, y - 1, wz, delayTicks);
    this.queueLava(wx + 1, y, wz, delayTicks);
    this.queueLava(wx - 1, y, wz, delayTicks);
    this.queueLava(wx, y, wz + 1, delayTicks);
    this.queueLava(wx, y, wz - 1, delayTicks);
  }

  stepLava(maxUpdates = LAVA_FLOW_UPDATES_PER_STEP) {
    let updates = 0;
    this.lavaTick += 1;
    while (updates < maxUpdates && this.lavaQueueHead < this.lavaQueue.length) {
      const item = this.lavaQueue[this.lavaQueueHead];
      if (item.dueTick > this.lavaTick) break;
      this.lavaQueueHead += 1;
      if (this.lavaQueued.get(item.key) !== item.dueTick) continue;
      this.lavaQueued.delete(item.key);
      this.updateLavaAt(item.wx, item.y, item.wz);
      updates += 1;
    }
    if (this.lavaQueueHead > 2048 || this.lavaQueueHead >= this.lavaQueue.length) {
      this.lavaQueue = this.lavaQueue.slice(this.lavaQueueHead);
      this.lavaQueueHead = 0;
      if (this.lavaQueue.length > 1) this.lavaQueue.sort((a, b) => a.dueTick - b.dueTick);
    }
  }

  updateLavaAt(wx, y, wz) {
    const block = this.getBlock(wx, y, wz);
    if (!isLava(block)) return;
    if (this.getBlock(wx, y + 1, wz) === Block.WATER && this.mixWaterIntoLava(wx, y, wz, [0, -1, 0])) return;
    if (this.getBlock(wx, y - 1, wz) === Block.WATER) {
      this.mixLavaIntoWater(wx, y - 1, wz, [0, -1, 0]);
    }

    const key = `${wx},${y},${wz}`;
    const level = this.getLavaLevel(wx, y, wz) ?? 0;
    const fedFromAbove = isLava(this.getBlock(wx, y + 1, wz));
    const isFalling = this.isLavaFallingAt(wx, y, wz);
    const isTrueSource = this.isLavaSourceAt(wx, y, wz);
    if (!isTrueSource && this.lavaSourceConversion && this.canCreateSourceLava(wx, y, wz)) {
      this.setBlock(wx, y, wz, block, {
        lavaLevel: 0,
        isSource: true,
        skipLavaUpdate: true,
      });
      this.queueLavaAround(wx, y, wz);
      return;
    }

    if (!isTrueSource && !fedFromAbove) {
      if (level === 0) {
        this.setBlock(wx, y, wz, Block.AIR);
        return;
      }
      let hasSupplier = false;
      let strongestLevel = Infinity;
      for (const [dx, dz] of LIQUID_HORIZONTAL_DIRECTIONS) {
        const neighbor = this.getBlock(wx + dx, y, wz + dz);
        if (!isLava(neighbor)) continue;
        const neighborLevel = this.getLavaLevel(wx + dx, y, wz + dz) ?? 0;
        if (neighborLevel < level) {
          hasSupplier = true;
          strongestLevel = Math.min(strongestLevel, neighborLevel);
          if (neighborLevel === 0) break;
        }
      }
      if (hasSupplier) {
        const updatedLevel = clamp(strongestLevel + LAVA_LEVEL_DECREASE, 0, LAVA_MAX_DEPTH);
        if (updatedLevel > level) {
          this.setBlock(wx, y, wz, block, {
            lavaLevel: updatedLevel,
            isSource: false,
            skipLiquidInteractions: true,
          });
          return;
        }
      }
      if (!hasSupplier) {
        this.setBlock(wx, y, wz, Block.AIR);
        return;
      }
    }

    const below = this.getBlock(wx, y - 1, wz);
    if (!isLava(below) && this.canLiquidFlowInto(below, block)) {
      const fallLevel = isTrueSource ? 0 : level;
      this.setLavaBlock(wx, y - 1, wz, fallLevel, {
        isSource: false,
        falling: true,
        direction: [0, -1, 0],
      });
      return;
    }

    // Mid-column falling lava: same rule as water. A falling lava block that
    // still has lava beneath it is just part of the column and must not spread
    // sideways — only the bottom block (on a solid floor) spreads outward.
    if (isFalling && isLava(below)) {
      return;
    }

    const flowLevel = isTrueSource || isFalling ? 0 : level;
    if (flowLevel >= LAVA_MAX_DEPTH) return;
    const nextLevel = flowLevel + LAVA_LEVEL_DECREASE;

    for (const [dx, dz] of this.getLiquidFlowDirections(wx, y, wz, block, { spreadAll: isFalling })) {
      const nx = wx + dx;
      const nz = wz + dz;
      const target = this.getBlock(nx, y, nz);
      if (!this.canLiquidFlowInto(target, block)) continue;
      if (isLava(target) && (this.getLavaLevel(nx, y, nz) ?? 0) <= nextLevel) continue;
      if (!this.setLavaBlock(nx, y, nz, nextLevel, { isSource: false, direction: [dx, 0, dz] })) continue;
      const targetBelow = this.getBlock(nx, y - 1, nz);
      if (this.canLiquidFallInto(targetBelow, block)) {
        this.setLavaBlock(nx, y - 1, nz, nextLevel, {
          isSource: false,
          falling: true,
          direction: [0, -1, 0],
        });
      }
    }
  }

  canLiquidFlowInto(block, liquidBlock) {
    if (block === Block.AIR || isReplaceablePlacementBlock(block)) return true;
    if (liquidBlock === Block.WATER) return block === Block.WATER || isLava(block);
    if (isLava(liquidBlock)) return isLava(block) || block === Block.WATER;
    return false;
  }

  canLiquidFallInto(block, liquidBlock) {
    if (liquidBlock === Block.WATER && block === Block.WATER) return false;
    if (isLava(liquidBlock) && isLava(block)) return false;
    return this.canLiquidFlowInto(block, liquidBlock);
  }

  getLiquidFlowDirections(wx, y, wz, liquidBlock, options = {}) {
    if (options.spreadAll) {
      return LIQUID_HORIZONTAL_DIRECTIONS.filter(([dx, dz]) =>
        this.canLiquidFlowInto(this.getBlock(wx + dx, y, wz + dz), liquidBlock),
      );
    }

    const maxDistance = this.getLiquidMaxFlowDistance(liquidBlock);
    let bestWeight = Infinity;
    const bestDirections = [];

    for (const [dx, dz] of LIQUID_HORIZONTAL_DIRECTIONS) {
      const target = this.getBlock(wx + dx, y, wz + dz);
      if (!this.canLiquidFlowInto(target, liquidBlock)) continue;

      const belowTarget = this.getBlock(wx + dx, y - 1, wz + dz);
      const weight = this.canLiquidFallInto(belowTarget, liquidBlock)
        ? 0
        : this.getMinLiquidFlowDownDistance(
          wx + dx,
          y,
          wz + dz,
          1,
          [dx, dz],
          liquidBlock,
          maxDistance,
          new Set([`${wx},${y},${wz}`]),
        );

      if (weight < bestWeight) {
        bestWeight = weight;
        bestDirections.length = 0;
      }
      if (weight === bestWeight) bestDirections.push([dx, dz]);
    }

    return bestDirections;
  }

  getMinLiquidFlowDownDistance(wx, y, wz, depth, previousDirection, liquidBlock, maxDistance, visited) {
    if (depth > maxDistance) return Infinity;
    const positionKey = `${wx},${y},${wz}`;
    if (visited.has(positionKey)) return Infinity;
    visited.add(positionKey);

    let best = Infinity;
    for (const [dx, dz] of LIQUID_HORIZONTAL_DIRECTIONS) {
      if (dx === -previousDirection[0] && dz === -previousDirection[1]) continue;
      const nx = wx + dx;
      const nz = wz + dz;
      const target = this.getBlock(nx, y, nz);
      if (!this.canLiquidFlowInto(target, liquidBlock)) continue;

      const below = this.getBlock(nx, y - 1, nz);
      if (this.canLiquidFallInto(below, liquidBlock)) {
        best = Math.min(best, depth);
        continue;
      }

      if (depth < maxDistance) {
        const branchVisited = new Set(visited);
        const candidate = this.getMinLiquidFlowDownDistance(
          nx,
          y,
          nz,
          depth + 1,
          [dx, dz],
          liquidBlock,
          maxDistance,
          branchVisited,
        );
        best = Math.min(best, candidate);
      }
    }

    return best;
  }

  getLiquidMaxFlowDistance(liquidBlock) {
    return isLava(liquidBlock) ? LAVA_MAX_FLOW_DISTANCE : WATER_MAX_FLOW_DISTANCE;
  }

  isLavaSourceAt(wx, y, wz) {
    if (!isLava(this.getBlock(wx, y, wz))) return false;
    if ((this.getLavaLevel(wx, y, wz) ?? 0) !== 0) return false;
    if (this.isLavaFallingAt(wx, y, wz)) return false;
    return this.lavaSources.has(`${wx},${y},${wz}`);
  }

  mixWaterIntoLava(wx, y, wz, direction = null) {
    if (!isLava(this.getBlock(wx, y, wz))) return false;
    const reactionBlock = this.isLavaSourceAt(wx, y, wz) ? getObsidianBlock() : Block.COBBLESTONE;
    return this.setBlock(wx, y, wz, reactionBlock, { skipLiquidInteractions: true });
  }

  mixLavaIntoWater(wx, y, wz, direction = null) {
    if (this.getBlock(wx, y, wz) !== Block.WATER) return false;
    const flowsDown = !direction || direction[1] < 0;
    const reactionBlock = flowsDown ? Block.STONE : Block.COBBLESTONE;
    return this.setBlock(wx, y, wz, reactionBlock, { skipLiquidInteractions: true });
  }

  canCreateBasaltAt(wx, y, wz) {
    if (!this.isSoulSoilLikeBlock(this.getBlock(wx, y - 1, wz))) return false;
    return LIQUID_HORIZONTAL_DIRECTIONS.some(([dx, dz]) => this.isBlueIceLikeBlock(this.getBlock(wx + dx, y, wz + dz)));
  }

  isSoulSoilLikeBlock(block) {
    return EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id === "soul_soil";
  }

  isBlueIceLikeBlock(block) {
    return EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id === "blue_ice";
  }

  resolveLiquidInteractionsAround(wx, y, wz) {
    let changed = false;
    for (const [dx, dy, dz] of [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      changed = this.resolveLiquidInteractionAt(wx + dx, y + dy, wz + dz) || changed;
    }
    return changed;
  }

  resolveLiquidInteractionAt(wx, y, wz) {
    const block = this.getBlock(wx, y, wz);
    if (isLava(block)) {
      if (this.getBlock(wx, y - 1, wz) === Block.WATER) {
        return this.mixLavaIntoWater(wx, y - 1, wz, [0, -1, 0]);
      }
      if (this.getBlock(wx, y + 1, wz) === Block.WATER) {
        return this.mixWaterIntoLava(wx, y, wz, [0, -1, 0]);
      }
      for (const [dx, dz] of LIQUID_HORIZONTAL_DIRECTIONS) {
        if (this.getBlock(wx + dx, y, wz + dz) === Block.WATER) {
          return this.mixWaterIntoLava(wx, y, wz, [-dx, 0, -dz]);
        }
      }
      return false;
    }

    if (block !== Block.WATER) return false;
    if (isLava(this.getBlock(wx, y + 1, wz))) {
      return this.mixLavaIntoWater(wx, y, wz, [0, -1, 0]);
    }
    if (isLava(this.getBlock(wx, y - 1, wz))) {
      return this.mixWaterIntoLava(wx, y - 1, wz, [0, -1, 0]);
    }

    let changed = false;
    for (const [dx, dz] of LIQUID_HORIZONTAL_DIRECTIONS) {
      if (isLava(this.getBlock(wx + dx, y, wz + dz))) {
        changed = this.mixWaterIntoLava(wx + dx, y, wz + dz, [dx, 0, dz]) || changed;
      }
    }
    return changed;
  }

  hardenLavaAt(wx, y, wz) {
    return this.mixWaterIntoLava(wx, y, wz);
  }

  canCreateSourceLava(wx, y, wz) {
    if (!this.lavaSourceConversion) return false;
    const below = this.getBlock(wx, y - 1, wz);
    if (!isSolid(below) && !this.isLavaSourceAt(wx, y - 1, wz)) return false;

    let sources = 0;
    for (const [dx, dz] of LIQUID_HORIZONTAL_DIRECTIONS) {
      if (this.isLavaSourceAt(wx + dx, y, wz + dz)) sources += 1;
    }

    return sources >= 2;
  }

  markChunkAndNeighborsDirty(wx, wz, forceAllNeighbors = false) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = mod(wx, CHUNK_SIZE);
    const lz = mod(wz, CHUNK_SIZE);
    const coords = [[cx, cz]];
    if (forceAllNeighbors || lx === 0) coords.push([cx - 1, cz]);
    if (forceAllNeighbors || lx === CHUNK_SIZE - 1) coords.push([cx + 1, cz]);
    if (forceAllNeighbors || lz === 0) coords.push([cx, cz - 1]);
    if (forceAllNeighbors || lz === CHUNK_SIZE - 1) coords.push([cx, cz + 1]);

    for (const [dirtyCx, dirtyCz] of coords) {
      const chunk = this.chunks.get(this.key(dirtyCx, dirtyCz));
      if (chunk) chunk.markDirty();
    }
  }

  applySavedModifications(chunk) {
    for (const [position, block] of this.modified) {
      const [wx, y, wz] = position.split(",").map(Number);
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cz = Math.floor(wz / CHUNK_SIZE);
      if (cx !== chunk.cx || cz !== chunk.cz) continue;
      chunk.setLocal(
        mod(wx, CHUNK_SIZE),
        y,
        mod(wz, CHUNK_SIZE),
        block,
        this.modifiedWaterLevels.get(position) ?? this.modifiedLavaLevels.get(position) ?? null,
        this.modifiedWaterFalling.has(position),
      );
      this.updateBlockLightSource(position, block, wx, y, wz);
    }
  }

  updateDynamicBlockLights(center, dt = 0) {
    if (!this.dynamicBlockLights?.length) return;
    this.dynamicBlockLightTimer -= dt;
    if (this.dynamicBlockLightTimer > 0) return;
    this.dynamicBlockLightTimer = DYNAMIC_BLOCK_LIGHT_UPDATE_SECONDS;

    if (!center || this.blockLightSources.size === 0) {
      for (const light of this.dynamicBlockLights) {
        light.visible = false;
        light.intensity = 0;
      }
      return;
    }

    const candidates = [];
    const maxDistanceSq = (DYNAMIC_BLOCK_LIGHT_RANGE + 8) ** 2;
    for (const source of this.blockLightSources.values()) {
      const dx = source.x + 0.5 - center.x;
      const dy = source.y + 0.5 - center.y;
      const dz = source.z + 0.5 - center.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > maxDistanceSq) continue;
      candidates.push({ source, distanceSq });
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);

    for (let i = 0; i < this.dynamicBlockLights.length; i += 1) {
      const light = this.dynamicBlockLights[i];
      const candidate = candidates[i];
      if (!candidate) {
        light.visible = false;
        light.intensity = 0;
        continue;
      }

      const { source } = candidate;
      const levelScale = clamp(source.level / MINECRAFT_LIGHT_LEVELS.torch, 0.45, 1.15);
      const supportOffset = WALL_TORCH_SUPPORT_OFFSETS[source.id] ?? null;
      const isLitFurnace = source.id.startsWith("furnace_lit");
      const lightX = source.x + 0.5 - (supportOffset?.[0] ?? 0) * 0.24;
      const lightZ = source.z + 0.5 - (supportOffset?.[2] ?? 0) * 0.24;
      light.position.set(lightX, source.y + (isLitFurnace ? 0.5 : 0.74), lightZ);
      light.distance = DYNAMIC_BLOCK_LIGHT_RANGE * levelScale;
      light.intensity = DYNAMIC_BLOCK_LIGHT_INTENSITY * levelScale;
      light.visible = true;
    }
  }

  dispose() {
    this.generationWorkerPool?.dispose();
    this.meshWorkerPool?.dispose();
    for (const light of this.dynamicBlockLights ?? []) {
      this.scene.remove(light);
      light.dispose?.();
    }
    this.dynamicBlockLights = [];
    this.generatedChunkApplyQueue.length = 0;
    this.meshApplyQueue.length = 0;
    for (const chunk of this.chunks.values()) {
      chunk.dispose();
    }
    this.chunks.clear();
    this.chunkDataCache?.clear();
  }
}

Object.assign(VoxelWorld.prototype, waterMethods);

class Inventory {
  constructor() {
    this.slots = Array(INVENTORY_SIZE).fill(null);
    this.craftSlots = Array(CRAFT_SLOT_COUNT).fill(null);
    this.tableSlots = Array(9).fill(null);
    this.armorSlots = {
      helmet: null,
      chestplate: null,
      leggings: null,
      boots: null,
    };
    this.cursor = null;
  }

  addItem(id, count = 1, slotOrder = PICKUP_SLOT_ORDER) {
    let remaining = count;
    const item = ITEMS[id];
    if (!item) return count;

    for (const index of slotOrder) {
      if (remaining <= 0) break;
      const slot = this.slots[index];
      if (!slot || slot.id !== id || slot.count >= item.maxStack) continue;
      const moved = Math.min(item.maxStack - slot.count, remaining);
      slot.count += moved;
      remaining -= moved;
    }

    for (const index of slotOrder) {
      if (remaining <= 0) break;
      if (this.slots[index]) continue;
      const moved = Math.min(item.maxStack, remaining);
      this.slots[index] = createStack(id, moved);
      remaining -= moved;
    }

    return remaining;
  }

  canAddItem(id, count = 1, slotOrder = PICKUP_SLOT_ORDER) {
    let remaining = count;
    const item = ITEMS[id];
    if (!item) return false;

    for (const index of slotOrder) {
      if (remaining <= 0) return true;
      const slot = this.slots[index];
      if (!slot || slot.id !== id || slot.count >= item.maxStack) continue;
      remaining -= Math.min(item.maxStack - slot.count, remaining);
    }

    for (const index of slotOrder) {
      if (remaining <= 0) return true;
      if (this.slots[index]) continue;
      remaining -= Math.min(item.maxStack, remaining);
    }

    return remaining <= 0;
  }
}

class Player {
  constructor(world, camera, mode = "survival") {
    this.world = world;
    this.camera = camera;
    this.mode = mode;
    this.position = this.world.findSpawnPoint();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI * 0.2;
    this.pitch = -0.12;
    this.onGround = false;
    this.isFlying = mode === "spectator";
    this.inWater = false;
    this.eyeInWater = false;
    this.hitHorizontalWaterWall = false;
    this.waterBreachCooldown = 0;
    this.waterBreachCoast = 0;
    this.waterJumpHoldTime = 0;
    this.waterTapSuppress = 0;
    this.waterBreachLocked = false;
    this.jumpQueued = false;
    this.lastSpaceTap = -Infinity;
    this.fallDistance = 0;
    this.landedFallDistance = 0;
    this.didJumpThisFrame = false;
    this.didSprintJumpThisFrame = false;
    this.keys = new Set();
    this.sprintingAllowed = true;
  }

  update(dt) {
    this.landedFallDistance = 0;
    this.didJumpThisFrame = false;
    this.didSprintJumpThisFrame = false;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();

    if (this.keys.has("KeyW")) wish.add(forward);
    if (this.keys.has("KeyS")) wish.sub(forward);
    if (this.keys.has("KeyD")) wish.add(right);
    if (this.keys.has("KeyA")) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    if (this.mode === "spectator") {
      const flySpeed = this.isSprinting() ? FLY_SPRINT_SPEED : FLY_SPEED;
      const vertical = Number(this.keys.has("Space")) - Number(this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
      this.velocity.set(wish.x * flySpeed, vertical * flySpeed * 0.75, wish.z * flySpeed);
      this.position.addScaledVector(this.velocity, dt);
      this.onGround = false;
      this.inWater = false;
      this.eyeInWater = false;
      this.hitHorizontalWaterWall = false;
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      this.camera.position.set(this.position.x, this.position.y + PLAYER_EYE_HEIGHT, this.position.z);
      return;
    }

    this.inWater = this.isBodyInWater();
    this.eyeInWater = this.isEyeInWater();
    this.waterBreachCooldown = Math.max(0, this.waterBreachCooldown - dt);
    this.waterBreachCoast = Math.max(0, this.waterBreachCoast - dt);
    this.waterTapSuppress = Math.max(0, this.waterTapSuppress - dt);
    const jumpHeld = this.keys.has("Space");
    this.waterJumpHoldTime = jumpHeld ? this.waterJumpHoldTime + dt : 0;
    const breachedSurfaceOffset = jumpHeld && this.waterBreachLocked ? this.waterSurfaceOffset(1.25) : null;
    const isBobbingAtSurface =
      !this.inWater &&
      jumpHeld &&
      this.waterBreachLocked &&
      this.velocity.y <= 0 &&
      breachedSurfaceOffset !== null &&
      breachedSurfaceOffset > -WATER_SURFACE_BOB_MAX_ABOVE &&
      breachedSurfaceOffset < PLAYER_EYE_HEIGHT + 0.32 &&
      !this.hasSolidFooting();
    if (isBobbingAtSurface) this.inWater = true;

    if (this.mode === "creative" && this.isFlying) {
      const flySpeed = this.isSprinting() ? FLY_SPRINT_SPEED : FLY_SPEED;
      const vertical = Number(this.keys.has("Space")) - Number(this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
      this.velocity.set(wish.x * flySpeed, vertical * flySpeed * 0.75, wish.z * flySpeed);
      this.onGround = false;
    } else if (this.inWater) {
      const swimSpeed = this.isSprinting() ? WATER_SPRINT_SWIM_SPEED : WATER_SWIM_SPEED;
      const verticalInput = Number(this.keys.has("Space")) - Number(this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
      const surfaceOffset = isBobbingAtSurface ? breachedSurfaceOffset : this.waterSurfaceOffset();
      if (
        !jumpHeld ||
        this.eyeInWater ||
        (surfaceOffset !== null && surfaceOffset > WATER_BREACH_RESET_DEPTH)
      ) {
        this.waterBreachLocked = false;
      }
      this.velocity.x = lerp(this.velocity.x, wish.x * swimSpeed, 0.28);
      this.velocity.z = lerp(this.velocity.z, wish.z * swimSpeed, 0.28);

      if (verticalInput !== 0) {
        if (verticalInput > 0 && this.shouldBreachWater(surfaceOffset)) {
          this.velocity.y = WATER_BREACH_SPEED;
          this.waterBreachCooldown = WATER_BREACH_COOLDOWN_SECONDS;
          this.waterBreachCoast = WATER_BREACH_COAST_SECONDS;
          this.waterBreachLocked = true;
        } else if (verticalInput > 0 && this.waterBreachLocked && surfaceOffset !== null) {
          if (this.waterBreachCoast > 0) {
            this.velocity.y = Math.max(this.velocity.y, WATER_SURFACE_VERTICAL_SPEED);
          } else if (surfaceOffset < 0) {
            this.velocity.y = Math.min(
              lerp(this.velocity.y, -WATER_SURFACE_BOB_SINK_SPEED, 0.36),
              -WATER_SURFACE_BOB_MIN_DOWN_SPEED,
            );
          } else {
            this.velocity.y = lerp(this.velocity.y, -WATER_HELD_SURFACE_SINK_SPEED, 0.26);
          }
        } else {
          const speed =
            verticalInput > 0 && surfaceOffset !== null && surfaceOffset < WATER_SURFACE_APPROACH_OFFSET
              ? WATER_SURFACE_VERTICAL_SPEED
              : WATER_VERTICAL_SPEED;
          this.velocity.y = lerp(this.velocity.y, verticalInput * speed, 0.42);
        }
      } else if (this.velocity.y < -WATER_SINK_SPEED) {
        // Preserve fall momentum on water entry — the 0.94 drag bleeds it off naturally
      } else {
        this.velocity.y = Math.max(this.velocity.y - WATER_GRAVITY * dt, -WATER_SINK_SPEED);
      }
      this.velocity.multiplyScalar(0.94);
      this.onGround = false;
    } else if (this.isBodyInVine()) {
      const movingSpeed = this.isSneaking() ? SNEAK_SPEED : (this.isSprinting() ? SPRINT_SPEED : WALK_SPEED);
      const verticalInput = Number(this.keys.has("Space")) - Number(this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
      this.velocity.x = wish.x * movingSpeed * 0.72;
      this.velocity.z = wish.z * movingSpeed * 0.72;
      if (verticalInput > 0) {
        this.velocity.y = VINE_CLIMB_SPEED;
      } else if (verticalInput < 0) {
        this.velocity.y = -VINE_CLIMB_SPEED;
      } else {
        this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt * 0.08, -VINE_SLIDE_SPEED);
      }
      this.onGround = false;
    } else {
      const movingSpeed = this.isSneaking() ? SNEAK_SPEED : (this.isSprinting() ? SPRINT_SPEED : WALK_SPEED);
      this.velocity.x = wish.x * movingSpeed;
      this.velocity.z = wish.z * movingSpeed;

      let jumped = false;
      if ((this.jumpQueued || this.keys.has("Space")) && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
        jumped = true;
        this.didJumpThisFrame = true;
        this.didSprintJumpThisFrame = this.isSprinting();
      }

      if (!jumped) {
        this.velocity.y = (this.velocity.y - GRAVITY * dt) * Math.pow(VERTICAL_DRAG_PER_TICK, dt * TICKS_PER_SECOND);
      }
    }

    this.jumpQueued = false;
    this.onGround = false;
    this.hitHorizontalWaterWall = false;
    const beforeMoveY = this.position.y;
    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("z", this.velocity.z * dt);
    this.moveAxis("y", this.velocity.y * dt);
    this.updateFallDistance(beforeMoveY);

    if (this.position.y < -20) {
      this.position.copy(this.world.findSpawnPoint());
      this.velocity.set(0, 0, 0);
    }

    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.position.set(this.position.x, this.position.y + PLAYER_EYE_HEIGHT, this.position.z);
  }

  updateFallDistance(beforeMoveY) {
    const fallingDelta = Math.max(0, beforeMoveY - this.position.y);
    const cancelsFall =
      this.mode === "spectator" ||
      (this.mode === "creative" && this.isFlying) ||
      this.inWater ||
      this.eyeInWater ||
      this.isBodyInVine();

    if (cancelsFall) {
      this.fallDistance = 0;
      return;
    }

    if (this.onGround) {
      this.landedFallDistance = this.fallDistance + fallingDelta;
      this.fallDistance = 0;
      return;
    }

    if (fallingDelta > 0) {
      this.fallDistance += fallingDelta;
    }
  }

  isBodyInWater() {
    const minX = Math.floor(this.position.x - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxX = Math.floor(this.position.x + PLAYER_RADIUS - PLAYER_EPSILON);
    const minZ = Math.floor(this.position.z - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxZ = Math.floor(this.position.z + PLAYER_RADIUS - PLAYER_EPSILON);
    const minY = Math.floor(this.position.y + 0.1);
    const maxY = Math.floor(this.position.y + PLAYER_HEIGHT * 0.72);
    const ankleY = this.position.y + 0.04;

    for (const px of [this.position.x, this.position.x - PLAYER_RADIUS * 0.72, this.position.x + PLAYER_RADIUS * 0.72]) {
      for (const pz of [this.position.z, this.position.z - PLAYER_RADIUS * 0.72, this.position.z + PLAYER_RADIUS * 0.72]) {
        if (this.isPointInWater(px, ankleY, pz)) return true;
      }
    }

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (this.isPointInWater(x + 0.5, this.position.y + 0.35, z + 0.5)) return true;
          if (this.isPointInWater(x + 0.5, y + 0.5, z + 0.5)) return true;
        }
      }
    }

    return false;
  }

  isEyeInWater() {
    return this.isPointInWater(this.position.x, this.position.y + PLAYER_EYE_HEIGHT, this.position.z);
  }

  isBodyInVine() {
    const minX = Math.floor(this.position.x - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxX = Math.floor(this.position.x + PLAYER_RADIUS - PLAYER_EPSILON);
    const minZ = Math.floor(this.position.z - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxZ = Math.floor(this.position.z + PLAYER_RADIUS - PLAYER_EPSILON);
    const minY = Math.floor(this.position.y + 0.1);
    const maxY = Math.floor(this.position.y + PLAYER_HEIGHT - 0.08);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (isClimbableBlock(this.world.getBlock(x, y, z))) return true;
        }
      }
    }

    return false;
  }

  isPointInWater(x, y, z) {
    const wx = Math.floor(x);
    const wy = Math.floor(y);
    const wz = Math.floor(z);
    if (this.world.getBlock(wx, wy, wz) !== Block.WATER) return false;
    const surfaceY = this.world.waterSurfaceYAt(wx, wy, wz) ?? wy + 1;
    return y <= surfaceY;
  }

  waterSurfaceOffset(extraBelow = 0) {
    const minX = Math.floor(this.position.x - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxX = Math.floor(this.position.x + PLAYER_RADIUS - PLAYER_EPSILON);
    const minZ = Math.floor(this.position.z - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxZ = Math.floor(this.position.z + PLAYER_RADIUS - PLAYER_EPSILON);
    let surfaceY = null;

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let y = Math.floor(this.position.y + PLAYER_HEIGHT); y >= Math.floor(this.position.y - extraBelow); y -= 1) {
          const candidate = this.world.waterSurfaceYAt(x, y, z);
          if (candidate === null) continue;
          surfaceY = surfaceY === null ? candidate : Math.max(surfaceY, candidate);
        }
      }
    }

    return surfaceY === null ? null : surfaceY - this.position.y;
  }

  hasSolidFooting(drop = 0.08) {
    const minX = Math.floor(this.position.x - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxX = Math.floor(this.position.x + PLAYER_RADIUS - PLAYER_EPSILON);
    const minZ = Math.floor(this.position.z - PLAYER_RADIUS + PLAYER_EPSILON);
    const maxZ = Math.floor(this.position.z + PLAYER_RADIUS - PLAYER_EPSILON);
    const y = Math.floor(this.position.y - drop);

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (isSolid(this.world.getBlock(x, y, z))) return true;
      }
    }

    return false;
  }

  shouldBreachWater(surfaceOffset) {
    if (surfaceOffset === null) return false;
    if (this.eyeInWater) return false;
    if (this.waterBreachLocked) return false;
    if (this.waterJumpHoldTime < WATER_BREACH_HOLD_SECONDS) return false;
    if (this.waterTapSuppress > 0) return false;
    if (surfaceOffset < WATER_BREACH_MIN_OFFSET || surfaceOffset > WATER_BREACH_MAX_OFFSET) return false;
    if (this.waterBreachCooldown > 0) return false;

    return !this.collidesAt(this.position.x, this.position.y + 0.42, this.position.z);
  }

  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const direction = Math.sign(amount);
    let remaining = Math.abs(amount);

    while (remaining > 0) {
      const step = Math.min(0.05, remaining) * direction;
      const before = this.position.clone();
      this.position[axis] += step;

      if (this.collides()) {
        this.position.copy(before);

        if (axis !== "y" && this.tryStepUp(axis, step, before)) {
          remaining -= Math.abs(step);
          continue;
        }

        this.position[axis] = Math.round(this.position[axis] * 1000) / 1000;

        if (axis === "y") {
          if (direction < 0) this.onGround = true;
          this.velocity.y = 0;
        } else {
          if (this.inWater) this.hitHorizontalWaterWall = true;
          this.velocity[axis] = 0;
        }
        return true;
      }

      remaining -= Math.abs(step);
    }

    return false;
  }

  tryStepUp(axis, step, before) {
    const maxStep = 0.62;
    if (!this.onGround) return false;

    for (let lift = 0.1; lift <= maxStep; lift += 0.1) {
      this.position.copy(before);
      this.position.y += lift;
      if (this.collides()) continue;
      this.position[axis] += step;
      if (!this.collides()) {
        this.velocity.y = Math.max(this.velocity.y, this.inWater ? 1.6 : 0);
        return true;
      }
    }

    this.position.copy(before);
    return false;
  }

  collides() {
    return this.collidesAt(this.position.x, this.position.y, this.position.z);
  }

  collidesAt(px, py, pz, maxYOverride = null) {
    const minAabbX = px - PLAYER_RADIUS + PLAYER_EPSILON;
    const maxAabbX = px + PLAYER_RADIUS - PLAYER_EPSILON;
    const minAabbY = py + PLAYER_EPSILON;
    const maxAabbY = maxYOverride ?? py + PLAYER_HEIGHT - PLAYER_EPSILON;
    const minAabbZ = pz - PLAYER_RADIUS + PLAYER_EPSILON;
    const maxAabbZ = pz + PLAYER_RADIUS - PLAYER_EPSILON;
    const minX = Math.floor(minAabbX);
    const maxX = Math.floor(maxAabbX);
    const minY = Math.floor(minAabbY);
    const maxY = Math.floor(maxAabbY);
    const minZ = Math.floor(minAabbZ);
    const maxZ = Math.floor(maxAabbZ);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const block = this.world.getBlock(x, y, z);
          if (isSolid(block) && !isLava(block) && blockIntersectsAabb(block, x, y, z, minAabbX, minAabbY, minAabbZ, maxAabbX, maxAabbY, maxAabbZ)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  handleKeyDown(code) {
    if (this.mode === "spectator") {
      this.keys.add(code);
      return;
    }

    if (code === "Space" && !this.keys.has("Space")) {
      const now = performance.now();
      if (this.mode === "creative" && now - this.lastSpaceTap <= DOUBLE_SPACE_MS) {
        this.isFlying = !this.isFlying;
        this.velocity.y = 0;
        this.onGround = false;
        this.lastSpaceTap = 0;
      } else {
        this.jumpQueued = true;
        this.lastSpaceTap = now;
      }
    }

    this.keys.add(code);
  }

  handleKeyUp(code) {
    this.keys.delete(code);
    if (code === "Space") {
      if (this.inWater || this.waterBreachLocked || this.waterSurfaceOffset(1.25) !== null) {
        this.waterTapSuppress = WATER_TAP_SUPPRESS_SECONDS;
      }
      this.waterJumpHoldTime = 0;
      this.waterBreachLocked = false;
    }
  }

  isSprinting() {
    return this.sprintingAllowed && (this.keys.has("ControlLeft") || this.keys.has("ControlRight"));
  }

  isSneaking() {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0021;
    this.pitch -= dy * 0.0021;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }
}

class DroppedItem {
  constructor(game, id, count, position, velocity = new THREE.Vector3(), options = {}) {
    this.game = game;
    this.id = id;
    this.count = count;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.pickupDelay = options.pickupDelay ?? ITEM_PICKUP_DELAY_SECONDS;
    this.onGround = false;
    this.bobSeed = Math.random() * Math.PI * 2;
    this.material = game.createDroppedItemMaterial(id);
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(0.42, 0.42, 0.42);
    this.sprite.position.copy(this.position);
    this.sprite.castShadow = true;
    this.sprite.userData.droppedItem = this;
  }

  update(dt) {
    this.age += dt;
    this.pickupDelay = Math.max(0, this.pickupDelay - dt);
    if (this.age >= ITEM_DESPAWN_SECONDS) return false;

    this.applyPlayerAttraction(dt);
    const inWater = isWater(this.game.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y), Math.floor(this.position.z)));

    if (inWater) {
      this.velocity.y += ITEM_WATER_BUOYANCY * dt;
      this.velocity.multiplyScalar(Math.pow(ITEM_WATER_DRAG_PER_TICK, dt * TICKS_PER_SECOND));
    } else {
      this.velocity.y -= ITEM_GRAVITY * dt;
      const drag = this.onGround ? ITEM_GROUND_DRAG_PER_TICK : ITEM_AIR_DRAG_PER_TICK;
      const horizontalDrag = Math.pow(drag, dt * TICKS_PER_SECOND);
      this.velocity.x *= horizontalDrag;
      this.velocity.z *= horizontalDrag;
      this.velocity.y *= Math.pow(ITEM_AIR_DRAG_PER_TICK, dt * TICKS_PER_SECOND);
    }

    this.onGround = false;
    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("y", this.velocity.y * dt);
    this.moveAxis("z", this.velocity.z * dt);
    this.updateSprite();
    return true;
  }

  applyPlayerAttraction(dt) {
    const player = this.game.player;
    if (!player || player.mode === "spectator" || this.pickupDelay > 0) return;

    const target = new THREE.Vector3(
      player.position.x,
      player.position.y + PLAYER_HEIGHT * 0.45,
      player.position.z,
    );
    const toPlayer = target.sub(this.position);
    const distance = toPlayer.length();
    if (distance <= 0.001 || distance > ITEM_ATTRACT_RADIUS) return;

    const strength = smoothstep(ITEM_ATTRACT_RADIUS, ITEM_PICKUP_RADIUS * 0.35, distance);
    this.velocity.addScaledVector(toPlayer.normalize(), ITEM_ATTRACT_ACCELERATION * strength * dt);
  }

  moveAxis(axis, amount) {
    if (amount === 0) return;
    const direction = Math.sign(amount);
    let remaining = Math.abs(amount);

    while (remaining > 0) {
      const step = Math.min(0.06, remaining) * direction;
      const before = this.position[axis];
      this.position[axis] += step;

      if (this.collidesAt(this.position.x, this.position.y, this.position.z)) {
        this.position[axis] = before;
        if (axis === "y") {
          if (direction < 0) this.onGround = true;
          this.velocity.y = 0;
        } else {
          this.velocity[axis] *= -0.18;
          if (Math.abs(this.velocity[axis]) < 0.08) this.velocity[axis] = 0;
        }
        return;
      }

      remaining -= Math.abs(step);
    }
  }

  collidesAt(px, py, pz) {
    const minAabbX = px - ITEM_ENTITY_RADIUS + PLAYER_EPSILON;
    const maxAabbX = px + ITEM_ENTITY_RADIUS - PLAYER_EPSILON;
    const minAabbY = py - ITEM_ENTITY_HEIGHT * 0.5 + PLAYER_EPSILON;
    const maxAabbY = py + ITEM_ENTITY_HEIGHT * 0.5 - PLAYER_EPSILON;
    const minAabbZ = pz - ITEM_ENTITY_RADIUS + PLAYER_EPSILON;
    const maxAabbZ = pz + ITEM_ENTITY_RADIUS - PLAYER_EPSILON;
    const minX = Math.floor(minAabbX);
    const maxX = Math.floor(maxAabbX);
    const minY = Math.floor(minAabbY);
    const maxY = Math.floor(maxAabbY);
    const minZ = Math.floor(minAabbZ);
    const maxZ = Math.floor(maxAabbZ);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const block = this.game.world.getBlock(x, y, z);
          if (isSolid(block) && blockIntersectsAabb(block, x, y, z, minAabbX, minAabbY, minAabbZ, maxAabbX, maxAabbY, maxAabbZ)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  pickupBoundsOverlap(player) {
    const playerMinX = player.position.x - PLAYER_RADIUS - ITEM_PICKUP_RADIUS;
    const playerMaxX = player.position.x + PLAYER_RADIUS + ITEM_PICKUP_RADIUS;
    const playerMinY = player.position.y - 0.5;
    const playerMaxY = player.position.y + PLAYER_HEIGHT + 0.5;
    const playerMinZ = player.position.z - PLAYER_RADIUS - ITEM_PICKUP_RADIUS;
    const playerMaxZ = player.position.z + PLAYER_RADIUS + ITEM_PICKUP_RADIUS;
    const minX = this.position.x - ITEM_ENTITY_RADIUS;
    const maxX = this.position.x + ITEM_ENTITY_RADIUS;
    const minY = this.position.y - ITEM_ENTITY_HEIGHT * 0.5;
    const maxY = this.position.y + ITEM_ENTITY_HEIGHT * 0.5;
    const minZ = this.position.z - ITEM_ENTITY_RADIUS;
    const maxZ = this.position.z + ITEM_ENTITY_RADIUS;

    return (
      maxX > playerMinX &&
      minX < playerMaxX &&
      maxY > playerMinY &&
      minY < playerMaxY &&
      maxZ > playerMinZ &&
      minZ < playerMaxZ
    );
  }

  updateSprite() {
    const bob = Math.sin(this.age * 5.1 + this.bobSeed) * 0.035;
    this.sprite.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.sprite.material.rotation = this.age * 2.1 + this.bobSeed;
  }

  dispose() {
    this.game.scene.remove(this.sprite);
    this.material.dispose();
  }
}

class FallingBlock {
  constructor(game, block, x, y, z) {
    this.game = game;
    this.block = block;
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.age = 0;
    const geometry = buildFallingBlockGeometry(block);
    this.mesh = new THREE.Mesh(geometry, WORLD_MATERIAL);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.position.copy(this.position);
    this.geometry = geometry;
  }

  update(dt) {
    this.age += dt;
    if (this.age > 30) return false;
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -32) this.velocity.y = -32;
    let remaining = -this.velocity.y * dt;
    while (remaining > 0) {
      const step = Math.min(0.25, remaining);
      const nextY = this.position.y - step;
      const blockBelowY = Math.floor(nextY);
      const belowBlock = this.game.world.getBlock(this.position.x, blockBelowY, this.position.z);
      if (isFallingBlockFragile(belowBlock)) {
        this.game.destroyFallingBlockFragileAt(this.position.x, blockBelowY, this.position.z);
        this.position.y = nextY;
        remaining -= step;
        continue;
      }
      if (isSolid(belowBlock)) {
        const restY = blockBelowY + 1;
        this.position.y = restY;
        this.land();
        return false;
      }
      this.position.y = nextY;
      remaining -= step;
    }
    this.mesh.position.copy(this.position);
    return true;
  }

  land() {
    const placeX = this.position.x;
    const placeY = Math.round(this.position.y);
    const placeZ = this.position.z;
    const existing = this.game.world.getBlock(placeX, placeY, placeZ);
    if (isFallingBlockFragile(existing)) {
      this.game.destroyFallingBlockFragileAt(placeX, placeY, placeZ);
    }
    if (existing === Block.AIR || isReplaceablePlacementBlock(existing) || isFallingBlockFragile(existing)) {
      this.game.world.setBlock(placeX, placeY, placeZ, this.block);
      this.game.scheduleFallingBlockCheck(placeX, placeY + 1, placeZ);
    } else {
      const drop = getBlockDrop(this.block);
      if (drop) {
        const pos = new THREE.Vector3(placeX + 0.5, placeY + 0.5, placeZ + 0.5);
        this.game.spawnDroppedItem(drop, 1, pos, new THREE.Vector3(0, 1, 0));
      }
    }
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.geometry.dispose();
  }
}

class Game {
  constructor() {
    this.root = document.querySelector("#app");
    this.clock = new THREE.Clock();
    this.inventory = new Inventory();
    this.selectedHotbar = 0;
    this.selectedMode = "survival";
    this.creativeTab = "blocks";
    this.creativeSearchQuery = "";
    this.recipeSearchQuery2x2 = "";
    this.recipeSearchQuery3x3 = "";
    this.allowCheats = false;
    this.worldCreateOpen = false;
    this.currentSeedText = DEFAULT_WORLD_SEED;
    this.started = false;
    this.inventoryOpen = false;
    this.paused = false;
    this.invDragActive = false;
    this.invDragSlots = new Map();
    this.invDragConsumedEvent = false;
    this.settingsOpen = false;
    this.chatOpen = false;
    this.chatMessages = [];
    this.chatSuggestions = [];
    this.chatSuggestionIndex = 0;
    this.playerListVisible = false;
    this.renderDistance = RENDER_DISTANCE;
    this.fieldOfView = 72;
    this.mouseSensitivity = 1;
    this.shadowsEnabled = true;
    this.cloudsEnabled = true;
    this.smoothLightingEnabled = true;
    this.depthOfFieldEnabled = false;
    this.antialiasEnabled = true;
    this.anisotropicEnabled = true;
    this.chromaticAberrationEnabled = false;
    this.bloomEnabled = true;
    this.resolutionPreset = DEFAULT_RESOLUTION_PRESET;
    this.loadGraphicsSettings();
    this.loadingWorld = false;
    this.loadingTargetRadius = SPAWN_LOADING_RADIUS;
    this.loadingReadyRadius = SPAWN_READY_RADIUS;
    this.loadingReady = 0;
    this.loadingTotal = 1;
    this.loadingStartedAt = 0;
    this.loadingPendingReset = false;
    this.isMining = false;
    this.miningTarget = null;
    this.miningElapsed = 0;
    this.miningBreakCooldown = 0;
    this.rightMouseHeld = false;
    this.lastChunkUpdate = 0;
    this.waterElapsed = 0;
    this.lavaElapsed = 0;
    this.nightVisionActive = false;
    this.timeOfDay = 1000;
    this.worldAgeTicks = 1000;
    this.weather = "clear";
    this.weatherTimer = randomRange(WEATHER_CLEAR_MIN_SECONDS, WEATHER_CLEAR_MAX_SECONDS);
    this.cloudScroll = 0;
    this.precipitationTime = 0;
    this.precipitationStrength = 0;
    this.precipitationColumnCache = new Map();
    this._rainPrecipitationRevision = -1;
    this._snowPrecipitationRevision = -1;
    this.thunderTimer = 0;
    this.rainWindAngle = 0;
    this.rainWindX = 0;
    this.rainWindZ = 0;
    this.skyLightFactor = 1;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = MAX_SATURATION;
    this.exhaustion = 0;
    this.airTicks = MAX_AIR_TICKS;
    this.damageInvulnerability = 0;
    this.cactusDamageTimer = 0;
    this.drownDamageTimer = 0;
    this.starvationTimer = 0;
    this.healthRegenTimer = 0;
    this.lastSurvivalPosition = null;
    this.multiplayer = null;
    this.multiplayerOpen = false;
    this.multiplayerUrl = normalizeServerUrl(localStorage.getItem(MULTIPLAYER_URL_STORAGE_KEY), DEFAULT_MULTIPLAYER_URL);
    this.multiplayerName = sanitizePlayerName(
      localStorage.getItem(MULTIPLAYER_NAME_STORAGE_KEY),
      `Player${Math.floor(Math.random() * 900 + 100)}`,
    );

    this.root.innerHTML = `
      <main class="game-shell">
        <canvas class="game-canvas" aria-label="Voxel Grove world"></canvas>
        <div class="underwater-overlay" aria-hidden="true"></div>
        <div class="damage-flash" aria-hidden="true"></div>
        <div class="lightning-flash" aria-hidden="true"></div>
        <section class="title-screen" aria-label="Voxel Grove title screen">
          <div class="title-panorama" aria-hidden="true">
            <div class="title-stars"></div>
            <div class="title-horizon"></div>
            <div class="title-ground"></div>
          </div>
          <div class="title-content">
            <div class="title-logo-area">
              <h1 class="game-title"><span class="title-word-1">Voxel</span><span class="title-word-2">Grove</span></h1>
              <p class="game-edition">Alpha</p>
            </div>
            <div class="title-menu">
              <button class="play-button mc-button" type="button">Singleplayer</button>
              <button class="server-button mc-button" type="button">Servers</button>
              <button class="title-settings-button mc-button mc-button--secondary" type="button">Options...</button>
            </div>
            <p class="title-copyright">Copyright 2025 Voxel Grove. All rights reserved.</p>
          </div>
          <section class="world-create-window" aria-label="Create world" hidden>
            <div class="world-create-panel">
              <div class="create-heading">
                <span>Create World</span>
                <span class="seed-preview"></span>
              </div>
              <label class="world-field">
                <span>Seed</span>
                <div class="seed-row">
                  <input class="seed-input" value="" maxlength="20" inputmode="numeric" pattern="-?[0-9]*" placeholder="Random seed" aria-label="World seed" />
                  <button class="random-button" type="button" aria-label="Random seed">#</button>
                </div>
              </label>
              <div class="world-field">
                <span>Game Mode</span>
                <div class="mode-row" role="group" aria-label="Game mode">
                  <button class="mode-button is-selected" type="button" data-mode="survival" aria-pressed="true">
                    Survival
                  </button>
                  <button class="mode-button" type="button" data-mode="creative" aria-pressed="false">
                    Creative
                  </button>
                </div>
              </div>
              <label class="cheats-toggle">
                <span>Allow Cheats</span>
                <input class="cheats-input" type="checkbox" aria-label="Allow cheats" />
              </label>
              <div class="create-actions">
                <button class="create-back-button" type="button">Back</button>
                <button class="create-start-button start-button" type="button">Start World</button>
              </div>
            </div>
          </section>
          <section class="multiplayer-window" aria-label="Join server" hidden>
            <div class="world-create-panel">
              <div class="create-heading">
                <span>Join Server</span>
                <span class="server-preview">WebSocket</span>
              </div>
              <label class="world-field">
                <span>Address</span>
                <input class="server-url-input" value="${this.multiplayerUrl}" maxlength="96" spellcheck="false" autocomplete="off" aria-label="Server address" />
              </label>
              <label class="world-field">
                <span>Name</span>
                <input class="player-name-input" value="${this.multiplayerName}" maxlength="16" spellcheck="false" autocomplete="off" aria-label="Player name" />
              </label>
              <div class="host-controls">
                <button class="host-server-button start-button" type="button">Host LAN Server</button>
                <button class="stop-host-server-button create-back-button" type="button" hidden>Stop Hosting</button>
                <div class="host-address-list" aria-live="polite"></div>
              </div>
              <div class="multiplayer-status-message" aria-live="polite"></div>
              <div class="create-actions">
                <button class="server-back-button" type="button">Back</button>
                <button class="join-server-button start-button" type="button">Join Server</button>
              </div>
            </div>
          </section>
        </section>
        <div class="hud" aria-hidden="true">
          <div class="crosshair"></div>
          <div class="target-label"></div>
          <div class="break-meter"><div class="break-meter-fill"></div></div>
          <div class="pause-note">Paused</div>
          <div class="coordinates-status"></div>
          <div class="world-status"></div>
          <div class="chat-panel">
            <div class="chat-messages" aria-live="polite"></div>
            <form class="chat-form" hidden>
              <input class="chat-input" autocomplete="off" spellcheck="false" maxlength="160" aria-label="Chat" />
            </form>
            <div class="chat-suggestions" hidden></div>
          </div>
          <section class="player-list-overlay" aria-label="Players in world" hidden>
            <div class="player-list-panel">
              <div class="player-list-header">
                <span>Players</span>
                <span class="player-list-count">0 online</span>
              </div>
              <div class="player-list-rows"></div>
            </div>
          </section>
          <div class="survival-bars" hidden>
            <div class="secondary-row">
              <div class="armor-bar"></div>
              <div class="air-bubbles"></div>
            </div>
            <div class="status-row">
              <div class="health-bar"></div>
              <div class="hunger-bar"></div>
            </div>
            <div class="experience-strip" aria-hidden="true">
              <div class="experience-fill"></div>
              <span class="experience-label">0</span>
            </div>
          </div>
          <div class="hotbar"></div>
        </div>
        <div class="death-screen" hidden aria-modal="true" role="dialog" aria-label="You died">
          <h1 class="death-title">You Died!</h1>
          <p class="death-score">Score: <span class="death-score-value">0</span></p>
          <div class="death-buttons">
            <button class="death-respawn-button mc-button" type="button">Respawn</button>
            <button class="death-title-button mc-button mc-button--secondary" type="button">Title screen</button>
          </div>
        </div>
        <div class="inventory-overlay" hidden>
          <section class="inventory-panel" aria-label="Inventory">
            <button class="inventory-close" type="button" aria-label="Close inventory">x</button>
            <div class="creative-inventory" hidden>
              <div class="creative-tabs" role="tablist" aria-label="Creative inventory tabs"></div>
              <label class="creative-search">
                <input class="creative-search-input" autocomplete="off" spellcheck="false" maxlength="48" placeholder="Search" aria-label="Search creative inventory" />
              </label>
              <div class="creative-grid" aria-label="Creative item list"></div>
            </div>
            <div class="survival-crafting">
              <div class="crafting-area">
                <div class="craft-grid" aria-label="2 by 2 crafting grid"></div>
                <div class="craft-arrow" aria-hidden="true"></div>
                <div class="craft-output" aria-label="Crafting output"></div>
              </div>
              <aside class="recipe-guide recipe-guide-2x2" aria-label="Crafting guide">
                <div class="recipe-guide-title">Recipes</div>
                <label class="recipe-search">
                  <input class="recipe-search-input recipe-search-input-2x2" autocomplete="off" spellcheck="false" maxlength="48" placeholder="Search" aria-label="Search crafting recipes" />
                </label>
                <div class="recipe-guide-list recipe-guide-list-2x2"></div>
              </aside>
            </div>
            <div class="inventory-grid" aria-label="Inventory slots"></div>
          </section>
        </div>
        <div class="cursor-stack" aria-hidden="true"><span class="slot-count"></span></div>
        <div class="anvil-overlay" hidden>
          <section class="anvil-panel" aria-label="Anvil">
            <header class="anvil-header">
              <h2 class="anvil-title">Repair &amp; Name</h2>
              <button class="anvil-close" type="button" aria-label="Close anvil">x</button>
            </header>
            <div class="anvil-body">
              <div class="anvil-slot anvil-slot-input" aria-label="Input slot"></div>
              <div class="anvil-plus">+</div>
              <div class="anvil-slot anvil-slot-material" aria-label="Material slot"></div>
              <div class="anvil-arrow">&rarr;</div>
              <div class="anvil-slot anvil-slot-output" aria-label="Output slot"></div>
            </div>
            <label class="anvil-name-label">
              <span>Name</span>
              <input class="anvil-name-input" type="text" maxlength="35" placeholder="Item name" />
            </label>
            <p class="anvil-cost">Cost: <span>0</span> levels</p>
          </section>
        </div>
        <div class="furnace-overlay" hidden>
          <section class="furnace-panel" aria-label="Furnace">
            <header class="furnace-header">
              <h2 class="furnace-title">Furnace</h2>
              <button class="furnace-close" type="button" aria-label="Close furnace">x</button>
            </header>
            <div class="furnace-body">
              <div class="furnace-col-left">
                <div class="furnace-slot furnace-slot-input" aria-label="Input"><span class="slot-count"></span></div>
                <div class="furnace-flame-wrap">
                  <div class="furnace-flame"><div class="furnace-flame-fill"></div></div>
                </div>
                <div class="furnace-slot furnace-slot-fuel" aria-label="Fuel"><span class="slot-count"></span></div>
              </div>
              <div class="furnace-col-mid">
                <div class="furnace-arrow-wrap">
                  <div class="furnace-arrow"><div class="furnace-arrow-fill"></div></div>
                </div>
              </div>
              <div class="furnace-col-right">
                <div class="furnace-slot furnace-slot-output" aria-label="Output"><span class="slot-count"></span></div>
              </div>
            </div>
            <div class="furnace-inv-area">
              <div class="furnace-inv-grid" aria-label="Inventory"></div>
            </div>
          </section>
        </div>
        <div class="crafting-table-overlay" hidden>
          <section class="crafting-table-panel" aria-label="Crafting Table">
            <div class="crafting-table-header">
              <h2 class="crafting-table-title">Crafting</h2>
              <button class="crafting-table-close" type="button" aria-label="Close crafting table">x</button>
            </div>
            <div class="crafting-table-workspace">
              <aside class="recipe-guide recipe-guide-3x3" aria-label="Crafting guide">
                <div class="recipe-guide-title">Recipes</div>
                <label class="recipe-search">
                  <input class="recipe-search-input recipe-search-input-3x3" autocomplete="off" spellcheck="false" maxlength="48" placeholder="Search" aria-label="Search crafting recipes" />
                </label>
                <div class="recipe-guide-list recipe-guide-list-3x3"></div>
              </aside>
              <div class="crafting-table-craft-area">
                <div class="crafting-table-grid" aria-label="Crafting grid"></div>
                <div class="crafting-table-arrow" aria-hidden="true"></div>
                <div class="crafting-table-output" aria-label="Crafting output"></div>
              </div>
            </div>
            <div class="crafting-table-inv-area">
              <div class="crafting-table-inv-grid" aria-label="Inventory"></div>
            </div>
          </section>
        </div>
        <div class="pause-overlay" hidden>
          <section class="pause-panel" aria-label="Pause menu">
            <h2 class="pause-title">Paused</h2>
            <div class="pause-actions">
              <button class="resume-button" type="button">Back to Game</button>
              <button class="settings-button" type="button" aria-expanded="false">Settings</button>
              <button class="title-button" type="button">Title Screen</button>
            </div>
          </section>
        </div>
        <div class="settings-overlay" hidden>
          <section class="settings-panel" aria-label="Settings">
            <div class="settings-header">
              <h2 class="settings-title">Settings</h2>
              <button class="settings-close-button" type="button" aria-label="Close settings">x</button>
            </div>
            <div class="settings-grid">
              <label class="setting-row setting-row--select">
                <span>Resolution</span>
                <span class="resolution-value">${RESOLUTION_PRESET_BY_ID.get(this.resolutionPreset)?.label ?? "1280 x 720"}</span>
                <select class="resolution-select setting-select" aria-label="Resolution">
                  ${renderResolutionOptions(this.resolutionPreset)}
                </select>
              </label>
              <label class="setting-row">
                <span>Render Distance</span>
                <span class="render-distance-value">${this.renderDistance} chunks</span>
                <input class="render-distance-input" type="range" min="${MIN_RENDER_DISTANCE}" max="${MAX_RENDER_DISTANCE}" step="1" value="${this.renderDistance}" aria-label="Render distance" />
              </label>
              <label class="setting-row">
                <span>Field of View</span>
                <span class="fov-value">72</span>
                <input class="fov-input" type="range" min="55" max="95" step="1" value="72" aria-label="Field of view" />
              </label>
              <label class="setting-row">
                <span>Mouse Sensitivity</span>
                <span class="sensitivity-value">100%</span>
                <input class="sensitivity-input" type="range" min="40" max="180" step="5" value="100" aria-label="Mouse sensitivity" />
              </label>
              <label class="setting-toggle">
                <span>Smooth Lighting</span>
                <input class="smooth-lighting-input" type="checkbox" checked aria-label="Smooth lighting" />
              </label>
              <label class="setting-toggle">
                <span>Shadows</span>
                <input class="shadow-input" type="checkbox" checked aria-label="Shadows" />
              </label>
              <label class="setting-toggle">
                <span>Clouds</span>
                <input class="cloud-input" type="checkbox" checked aria-label="Clouds" />
              </label>
              <label class="setting-toggle">
                <span>Depth of Field</span>
                <input class="dof-input" type="checkbox" aria-label="Depth of field" />
              </label>
              <label class="setting-toggle">
                <span>Anti-aliasing</span>
                <input class="aa-input" type="checkbox" checked aria-label="Anti-aliasing" />
              </label>
              <label class="setting-toggle">
                <span>Anisotropic Filtering</span>
                <input class="aniso-input" type="checkbox" checked aria-label="Anisotropic filtering" />
              </label>
              <label class="setting-toggle">
                <span>Chromatic Aberration</span>
                <input class="ca-input" type="checkbox" aria-label="Chromatic aberration" />
              </label>
              <label class="setting-toggle">
                <span>Bloom</span>
                <input class="bloom-input" type="checkbox" checked aria-label="Bloom" />
              </label>
            </div>
          </section>
        </div>
        <div class="loading-overlay" hidden>
          <section class="loading-panel" aria-label="Loading world">
            <h2 class="loading-title">Loading World</h2>
            <div class="loading-text">Building spawn chunks</div>
            <div class="loading-bar" aria-hidden="true"><div class="loading-bar-fill"></div></div>
            <div class="loading-count">0 / 169 chunks</div>
          </section>
        </div>
      </main>
    `;

    this.canvas = this.root.querySelector(".game-canvas");
    this.canvas.tabIndex = -1;
    this.underwaterOverlay = this.root.querySelector(".underwater-overlay");
    this.damageFlash = this.root.querySelector(".damage-flash");
    this.lightningFlash = this.root.querySelector(".lightning-flash");
    this.titleScreen = this.root.querySelector(".title-screen");
    this.playButton = this.root.querySelector(".play-button");
    this.serverButton = this.root.querySelector(".server-button");
    this.worldCreateWindow = this.root.querySelector(".world-create-window");
    this.multiplayerWindow = this.root.querySelector(".multiplayer-window");
    this.createBackButton = this.root.querySelector(".create-back-button");
    this.serverBackButton = this.root.querySelector(".server-back-button");
    this.joinServerButton = this.root.querySelector(".join-server-button");
    this.startButton = this.root.querySelector(".create-start-button");
    this.titleSettingsButton = this.root.querySelector(".title-settings-button");
    this.randomButton = this.root.querySelector(".random-button");
    this.seedInput = this.root.querySelector(".seed-input");
    this.serverUrlInput = this.root.querySelector(".server-url-input");
    this.playerNameInput = this.root.querySelector(".player-name-input");
    this.hostServerButton = this.root.querySelector(".host-server-button");
    this.stopHostServerButton = this.root.querySelector(".stop-host-server-button");
    this.hostAddressList = this.root.querySelector(".host-address-list");
    this.multiplayerStatusMessage = this.root.querySelector(".multiplayer-status-message");
    this.seedPreview = this.root.querySelector(".seed-preview");
    this.cheatsInput = this.root.querySelector(".cheats-input");
    this.modeButtons = [...this.root.querySelectorAll(".mode-button")];
    this.hud = this.root.querySelector(".hud");
    this.targetLabel = this.root.querySelector(".target-label");
    this.breakMeter = this.root.querySelector(".break-meter");
    this.breakMeterFill = this.root.querySelector(".break-meter-fill");
    this.pauseNote = this.root.querySelector(".pause-note");
    this.hotbar = this.root.querySelector(".hotbar");
    this.coordinatesStatus = this.root.querySelector(".coordinates-status");
    this.status = this.root.querySelector(".world-status");
    this.chatPanel = this.root.querySelector(".chat-panel");
    this.chatMessagesElement = this.root.querySelector(".chat-messages");
    this.chatForm = this.root.querySelector(".chat-form");
    this.chatInput = this.root.querySelector(".chat-input");
    this.chatSuggestionsElement = this.root.querySelector(".chat-suggestions");
    this.playerListOverlay = this.root.querySelector(".player-list-overlay");
    this.playerListCount = this.root.querySelector(".player-list-count");
    this.playerListRows = this.root.querySelector(".player-list-rows");
    this.survivalBars = this.root.querySelector(".survival-bars");
    this.healthBar = this.root.querySelector(".health-bar");
    this.hungerBar = this.root.querySelector(".hunger-bar");
    this.experienceFill = this.root.querySelector(".experience-fill");
    this.experienceLabel = this.root.querySelector(".experience-label");
    this.airBubbles = this.root.querySelector(".air-bubbles");
    this.armorBar = this.root.querySelector(".armor-bar");
    this.deathScreen = this.root.querySelector(".death-screen");
    this.deathScoreValue = this.root.querySelector(".death-score-value");
    this.deathRespawnButton = this.root.querySelector(".death-respawn-button");
    this.deathTitleButton = this.root.querySelector(".death-title-button");
    this.inventoryOverlay = this.root.querySelector(".inventory-overlay");
    this.inventoryPanel = this.root.querySelector(".inventory-panel");
    this.creativeInventory = this.root.querySelector(".creative-inventory");
    this.creativeTabs = this.root.querySelector(".creative-tabs");
    this.creativeSearchInput = this.root.querySelector(".creative-search-input");
    this.creativeGrid = this.root.querySelector(".creative-grid");
    this.survivalCrafting = this.root.querySelector(".survival-crafting");
    this.craftingArea = this.root.querySelector(".crafting-area");
    this.inventoryGrid = this.root.querySelector(".inventory-grid");
    this.craftGrid = this.root.querySelector(".craft-grid");
    this.craftOutput = this.root.querySelector(".craft-output");
    this.recipeSearchInput2x2 = this.root.querySelector(".recipe-search-input-2x2");
    this.recipeGuideList2x2 = this.root.querySelector(".recipe-guide-list-2x2");
    this.cursorStack = this.root.querySelector(".cursor-stack");
    this.inventoryClose = this.root.querySelector(".inventory-close");
    this.anvilOverlay = this.root.querySelector(".anvil-overlay");
    this.anvilCloseButton = this.root.querySelector(".anvil-close");
    this.furnaceOverlay = this.root.querySelector(".furnace-overlay");
    this.furnaceCloseButton = this.root.querySelector(".furnace-close");
    this.craftingTableOverlay = this.root.querySelector(".crafting-table-overlay");
    this.craftingTableClose = this.root.querySelector(".crafting-table-close");
    this.craftingTableGrid = this.root.querySelector(".crafting-table-grid");
    this.craftingTableOutput = this.root.querySelector(".crafting-table-output");
    this.craftingTableInvGrid = this.root.querySelector(".crafting-table-inv-grid");
    this.recipeSearchInput3x3 = this.root.querySelector(".recipe-search-input-3x3");
    this.recipeGuideList3x3 = this.root.querySelector(".recipe-guide-list-3x3");
    this.furnaceSlotInput = this.root.querySelector(".furnace-slot-input");
    this.furnaceSlotFuel = this.root.querySelector(".furnace-slot-fuel");
    this.furnaceSlotOutput = this.root.querySelector(".furnace-slot-output");
    this.furnaceFlameFill = this.root.querySelector(".furnace-flame-fill");
    this.furnaceArrowFill = this.root.querySelector(".furnace-arrow-fill");
    this.furnaceInvGrid = this.root.querySelector(".furnace-inv-grid");
    this.pauseOverlay = this.root.querySelector(".pause-overlay");
    this.resumeButton = this.root.querySelector(".resume-button");
    this.settingsButton = this.root.querySelector(".settings-button");
    this.titleButton = this.root.querySelector(".title-button");
    this.settingsOverlay = this.root.querySelector(".settings-overlay");
    this.settingsPanel = this.root.querySelector(".settings-panel");
    this.settingsCloseButton = this.root.querySelector(".settings-close-button");
    this.resolutionSelect = this.root.querySelector(".resolution-select");
    this.resolutionValue = this.root.querySelector(".resolution-value");
    this.renderDistanceInput = this.root.querySelector(".render-distance-input");
    this.renderDistanceValue = this.root.querySelector(".render-distance-value");
    this.fovInput = this.root.querySelector(".fov-input");
    this.fovValue = this.root.querySelector(".fov-value");
    this.sensitivityInput = this.root.querySelector(".sensitivity-input");
    this.sensitivityValue = this.root.querySelector(".sensitivity-value");
    this.smoothLightingInput = this.root.querySelector(".smooth-lighting-input");
    this.shadowInput = this.root.querySelector(".shadow-input");
    this.cloudInput = this.root.querySelector(".cloud-input");
    this.dofInput = this.root.querySelector(".dof-input");
    this.antialiasInput = this.root.querySelector(".aa-input");
    this.anisotropicInput = this.root.querySelector(".aniso-input");
    this.chromaticAberrationInput = this.root.querySelector(".ca-input");
    this.bloomInput = this.root.querySelector(".bloom-input");
    this.loadingOverlay = this.root.querySelector(".loading-overlay");
    this.loadingText = this.root.querySelector(".loading-text");
    this.loadingBarFill = this.root.querySelector(".loading-bar-fill");
    this.loadingCount = this.root.querySelector(".loading-count");

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(this.getRenderPixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x8fc7ee);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = BASE_TONE_MAPPING_EXPOSURE;
    this.renderer.shadowMap.enabled = this.shadowsEnabled && TERRAIN_DYNAMIC_SHADOWS;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.configureTextureQuality();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fcbe6);
    this.scene.fog = new THREE.Fog(0xc8deea, 78, 220);
    this.droppedItems = [];
    this.droppedItemTextures = new Map();
    this.breakParticles = [];
    this.breakParticleTextures = new Map();
    this.furnaces = new Map();
    this.activeFurnaceKey = null;
    this.craftingTableOpen = false;
    this.mobs = [];
    this.mobSpawnTimer = PASSIVE_MOB_INITIAL_SPAWN_DELAY;
    this.handSwingProgress = 0;
    this.handSwingActive = false;
    this.handSwingSequence = 0;
    this.handBreakElapsed = 0;
    this.damageFlashTimer = 0;
    this.defaultFog = {
      color: new THREE.Color(0xc8deea),
      near: 78,
      far: 220,
    };
    this.underwaterFog = {
      color: new THREE.Color(DEFAULT_WATER_TINT),
      near: 4,
      far: 42,
    };
    this.isUnderwaterView = false;

    // FIX: Initial camera far set to cover the cloud grid so clouds are visible
    // from the first frame — setRenderDistance() raises this further as needed.
    this.camera = new THREE.PerspectiveCamera(this.fieldOfView, innerWidth / innerHeight, 0.05, 1200);
    this.scene.add(this.camera);
    this.applyRenderDistanceEffects({ updateWorld: false });

    this.dofFocusDistance = 8;
    this.setupPostProcessing();

    this.sun = new THREE.DirectionalLight(0xffedc8, 2.35);
    this.sun.position.set(42, 82, 34);
    this.sun.castShadow = this.shadowsEnabled && TERRAIN_DYNAMIC_SHADOWS;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -96;
    this.sun.shadow.camera.right = 96;
    this.sun.shadow.camera.top = 96;
    this.sun.shadow.camera.bottom = -96;
    this.sun.shadow.bias = -0.00004;
    this.sun.shadow.normalBias = 0.075;
    this.sun.shadow.radius = 2.35;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.updateShadowCameraForRenderDistance();
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun);
    this.ambientLight = new THREE.AmbientLight(0xcfdccb, 0.2);
    this.scene.add(this.ambientLight);
    this.fillLight = new THREE.HemisphereLight(0xcfe7ff, 0x2f4029, 0.18);
    this.scene.add(this.fillLight);

    this.createSkyDome();
    this.createBreakOverlay();
    this.createTargetOutline();
    this.createSkyDetails();
    this.createHandViewmodel();
    this.updateSeedPreview();
    this.resetWorld(this.currentSeedText);
    this.buildHotbar();
    this.buildVitalBars();
    this.buildInventoryUi();
    this.buildCraftingTableUi();
    this.buildFurnaceUi();
    this.renderInventory();
    this.renderVitals();
    this.updateSettingsUi();
    this.bindEvents();
    this.applyResolutionToDesktopWindow();
    this.animate();
  }

  createSkyDetails() {
    this.createSunAndMoon();
    this.createCloudDeck();
    this.createPrecipitation();
    this.updateSkyCycle(0);
  }

  createSunAndMoon() {
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SUN_TEXTURE,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      alphaTest: 0.08,
      depthWrite: false,
      depthTest: true,
      fog: false,
    }));
    this.sunSprite.scale.set(SUN_BODY_SIZE, SUN_BODY_SIZE, 1);
    this.sunSprite.renderOrder = -1;
    this.scene.add(this.sunSprite);

    this.moonTexture = MOON_PHASES_TEXTURE;
    this.moonTexture.repeat.set(0.25, 0.5);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.moonTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      alphaTest: 0.08,
      depthWrite: false,
      depthTest: true,
      fog: false,
    }));
    this.moonSprite.scale.set(MOON_BODY_SIZE, MOON_BODY_SIZE, 1);
    this.moonSprite.renderOrder = -1;
    this.scene.add(this.moonSprite);
  }

  createCloudDeck() {
    this.cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xe6ecef,
      emissive: 0xdde5e8,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      side: THREE.FrontSide,
      fog: false,
    });

    const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.clouds = new THREE.Group();
    this.clouds.position.set(0, CLOUD_HEIGHT, 0);
    this.cloudBounds = [];
    this.cloudPuffCount = 0;
    for (let dz = -CLOUD_GRID_RADIUS; dz <= CLOUD_GRID_RADIUS; dz += 1) {
      for (let dx = -CLOUD_GRID_RADIUS; dx <= CLOUD_GRID_RADIUS; dx += 1) {
        const sparse = hashFloat(dx, dz, 0xc10d5) < 0.36 && (Math.abs(dx) + Math.abs(dz)) > 1;
        if (sparse) continue;
        const puffCount = 2 + hashInt(dx + 91, dz - 47, 0xc10d6, 3);
        const tileX = dx * CLOUD_TILE_SIZE;
        const tileZ = dz * CLOUD_TILE_SIZE;
        for (let puff = 0; puff < puffCount; puff += 1) {
          const baseSalt = 0xc1000 + puff * 97;
          const width = 28 + hashFloat(dx * 7 + puff, dz * 11 - puff, baseSalt) * 52;
          const depth = 18 + hashFloat(dx * 13 - puff, dz * 5 + puff, baseSalt + 1) * 30;
          const height = 2.4 + hashFloat(dx * 3 + puff, dz * 17 - puff, baseSalt + 2) * 3.4;

          for (let attempt = 0; attempt < 10; attempt += 1) {
            const salt = baseSalt + attempt * 0x5f3759;
            const offsetX = (hashFloat(dx + puff * 3 + attempt * 11, dz - puff * 5, salt + 3) - 0.5) * CLOUD_TILE_SIZE * 0.9;
            const offsetZ = (hashFloat(dx - puff * 4, dz + puff * 2 + attempt * 13, salt + 4) - 0.5) * CLOUD_TILE_SIZE * 0.9;
            const x = tileX + offsetX;
            const z = tileZ + offsetZ;
            const bounds = createCloudPuffBounds(x, z, width, depth, CLOUD_PUFF_GAP);
            if (this.cloudBounds.some((placed) => cloudPuffBoundsOverlap(bounds, placed))) continue;

            const offsetY = hashFloat(dx + puff, dz - puff + attempt, salt + 5) * 1.4;
            const cloud = new THREE.Mesh(cloudGeometry, this.cloudMaterial);
            cloud.position.set(x, height * 0.5 + offsetY, z);
            // Base world coords for wind-independent identity (group is at world origin)
            cloud.userData.baseX = x;
            cloud.userData.baseZ = z;
            cloud.scale.set(width, height, depth);
            cloud.renderOrder = 0;
            cloud.castShadow = false;
            cloud.receiveShadow = false;
            cloud.matrixAutoUpdate = false;
            cloud.updateMatrix();
            this.clouds.add(cloud);
            this.cloudBounds.push(bounds);
            this.cloudPuffCount += 1;
            break;
          }
        }
      }
    }
    this.clouds.visible = this.cloudsEnabled;
    this.scene.add(this.clouds);
  }

  createPrecipitation() {
    const seed = this.world?.seed ?? 0x71ce;

    // ── Rain: InstancedMesh (1 draw call for all drops) ──────────────
    // Each streak is a thin vertical plane, 0.13 wide × 1.8 tall.
    const rainGeo = createRainColumnGeometry(RAIN_COLUMN_WIDTH, RAIN_COLUMN_HEIGHT, RAIN_TEXTURE_REPEAT_Y);
    this.rainMaterial = new THREE.MeshBasicMaterial({
      map: RAIN_TEXTURE,
      color: 0xb7d5ee,
      transparent: true,
      opacity: 0,
      alphaTest: 0.01,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.rainMesh = new THREE.InstancedMesh(rainGeo, this.rainMaterial, RAIN_PARTICLE_COUNT);
    this.rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 7;
    this.rainMesh.count = 0;
    this.rainMesh.visible = false;
    this.scene.add(this.rainMesh);
    this.rainGroup = this.rainMesh;
    this.rainParticles = [{ scale: new THREE.Vector3(1, RAIN_COLUMN_HEIGHT, 1) }];

    // Per-rain-particle data
    this.rainData = [];
    for (let gz = -RAIN_GRID_RADIUS; gz <= RAIN_GRID_RADIUS; gz += 1) {
      for (let gx = -RAIN_GRID_RADIUS; gx <= RAIN_GRID_RADIUS; gx += 1) {
        const i = this.rainData.length;
        this.rainData.push({
          gridX: gx,
          gridZ: gz,
          distance: Math.hypot(gx, gz),
          fade: 1 - smoothstep(RAIN_GRID_RADIUS * 0.68, RAIN_GRID_RADIUS, Math.hypot(gx, gz)),
          offsetX: (hashFloat(i, 31, seed) - 0.5) * 0.18,
          offsetZ: (hashFloat(i, 47, seed) - 0.5) * 0.18,
          phase: hashFloat(i, 43, 0x75ea),
          speed: lerp(RAIN_FALL_SPEED_MIN, RAIN_FALL_SPEED_MAX, hashFloat(i, 59, 0x71a1)),
          slant: lerp(-0.035, 0.035, hashFloat(i, 71, 0x71a7)),
          splashTimer: hashFloat(i, 83, seed) * 1.45,
          cachedWorldX: null,
          cachedWorldZ: null,
          cachedSurfaceVersion: -1,
          terrainY: 0,
          precipType: "none",
        });
      }
    }
    this._rainDummy = new THREE.Object3D();

    // ── Snow: individual Sprites (350, good enough) ──────────────────
    const snowGeo = createRainColumnGeometry(SNOW_COLUMN_WIDTH, SNOW_COLUMN_HEIGHT, SNOW_TEXTURE_REPEAT_Y);
    this.snowMaterial = new THREE.MeshBasicMaterial({
      map: SNOW_TEXTURE,
      color: 0xeaf3f6,
      transparent: true,
      opacity: 0,
      alphaTest: 0.035,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.snowMesh = new THREE.InstancedMesh(snowGeo, this.snowMaterial, SNOW_PARTICLE_COUNT);
    this.snowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 7;
    this.snowMesh.count = 0;
    this.snowMesh.visible = false;
    this.scene.add(this.snowMesh);
    this.snowGroup = this.snowMesh;
    this.snowParticles = [];
    this.snowData = [];
    for (let gz = -RAIN_GRID_RADIUS; gz <= RAIN_GRID_RADIUS; gz += 1) {
      for (let gx = -RAIN_GRID_RADIUS; gx <= RAIN_GRID_RADIUS; gx += 1) {
        for (let layer = 0; layer < SNOW_LAYERS_PER_CELL; layer += 1) {
          const i = this.snowData.length;
          const phase = mod(hashFloat(i, 43, 0x75e1) + layer / SNOW_LAYERS_PER_CELL, 1);
          this.snowData.push({
            gridX: gx,
            gridZ: gz,
            layer,
            distance: Math.hypot(gx, gz),
            fade: 1 - smoothstep(RAIN_GRID_RADIUS * 0.68, RAIN_GRID_RADIUS, Math.hypot(gx, gz)),
            offsetX: (hashFloat(i, 19, seed + 1) - 0.5) * 0.95,
            offsetZ: (hashFloat(i, 29, seed + 1) - 0.5) * 0.95,
            phase,
            speed: lerp(SNOW_FALL_SPEED_MIN, SNOW_FALL_SPEED_MAX, hashFloat(i, 61, 0x5105)),
            drift: hashFloat(i, 67, 0xd22f) * Math.PI * 2,
            driftB: hashFloat(i, 83, 0xd23f) * Math.PI * 2,
            slant: lerp(-0.02, 0.02, hashFloat(i, 97, 0x5105)),
            density: hashFloat(i, 113, seed + 1),
            cachedWorldX: null,
            cachedWorldZ: null,
            cachedSurfaceVersion: -1,
            terrainY: 0,
            precipType: "none",
          });
        }
      }
    }
    this._snowDummy = new THREE.Object3D();
    for (let i = 0; i < SNOW_PARTICLE_COUNT; i += 1) {
      this._snowDummy.scale.set(0, 0, 0);
      this._snowDummy.updateMatrix();
      this.snowMesh.setMatrixAt(i, this._snowDummy.matrix);
    }
    this.snowMesh.instanceMatrix.needsUpdate = true;

    // ── Splashes: InstancedMesh pool of flat rings ───────────────────
    // Horizontal quads that fade in/out when rain drops hit ground.
    const splashGeo = createGroundSplashGeometry();
    this.splashMaterial = new THREE.MeshBasicMaterial({
      color: 0x6f8792,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.splashMesh = new THREE.InstancedMesh(splashGeo, this.splashMaterial, SPLASH_PARTICLE_COUNT);
    this.splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 8;
    this.splashMesh.visible = false;
    this.scene.add(this.splashMesh);
    this._splashDummy = new THREE.Object3D();
    this._splashColors = new THREE.InstancedBufferAttribute(
      new Float32Array(SPLASH_PARTICLE_COUNT * 4), 4
    );

    this.splashData = [];
    for (let i = 0; i < SPLASH_PARTICLE_COUNT; i += 1) {
      this.splashData.push({ active: false, x: 0, y: 0, z: 0, life: 0 });
      // hide by default
      this._splashDummy.scale.set(0, 0, 0);
      this._splashDummy.updateMatrix();
      this.splashMesh.setMatrixAt(i, this._splashDummy.matrix);
    }
    this.splashMesh.instanceMatrix.needsUpdate = true;
    this._splashPoolIdx = 0;

    const dropletSpotGeo = new THREE.CircleGeometry(1, 7);
    dropletSpotGeo.rotateX(-Math.PI / 2);
    this.groundDropletSpotMaterial = new THREE.MeshBasicMaterial({
      color: 0x345c6c,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.groundDropletSpotMesh = new THREE.InstancedMesh(dropletSpotGeo, this.groundDropletSpotMaterial, GROUND_DROPLET_SPOT_COUNT);
    this.groundDropletSpotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.groundDropletSpotMesh.frustumCulled = false;
    this.groundDropletSpotMesh.renderOrder = 8.5;
    this.groundDropletSpotMesh.visible = false;
    this.scene.add(this.groundDropletSpotMesh);
    this._groundDropletSpotDummy = new THREE.Object3D();
    this.groundDropletSpotData = [];
    for (let i = 0; i < GROUND_DROPLET_SPOT_COUNT; i += 1) {
      this.groundDropletSpotData.push({ active: false, x: 0, y: 0, z: 0, life: 0, size: 0, stretch: 1, squash: 1, rotation: 0 });
      this._groundDropletSpotDummy.scale.set(0, 0, 0);
      this._groundDropletSpotDummy.updateMatrix();
      this.groundDropletSpotMesh.setMatrixAt(i, this._groundDropletSpotDummy.matrix);
    }
    this.groundDropletSpotMesh.instanceMatrix.needsUpdate = true;
    this._groundDropletSpotPoolIdx = 0;

    const dropletGeo = new THREE.SphereGeometry(1, 4, 3);
    this.groundDropletMaterial = new THREE.MeshBasicMaterial({
      color: 0x5d8da0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      fog: true,
    });
    this.groundDropletMesh = new THREE.InstancedMesh(dropletGeo, this.groundDropletMaterial, GROUND_DROPLET_COUNT);
    this.groundDropletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.groundDropletMesh.frustumCulled = false;
    this.groundDropletMesh.renderOrder = 9;
    this.groundDropletMesh.visible = false;
    this.scene.add(this.groundDropletMesh);
    this._groundDropletDummy = new THREE.Object3D();
    this.groundDropletData = [];
    for (let i = 0; i < GROUND_DROPLET_COUNT; i += 1) {
      this.groundDropletData.push({ active: false, x: 0, y: 0, z: 0, groundY: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 0 });
      this._groundDropletDummy.scale.set(0, 0, 0);
      this._groundDropletDummy.updateMatrix();
      this.groundDropletMesh.setMatrixAt(i, this._groundDropletDummy.matrix);
    }
    this.groundDropletMesh.instanceMatrix.needsUpdate = true;
    this._groundDropletPoolIdx = 0;
  }

  getRenderPixelRatio() {
    return clamp(window.devicePixelRatio || 1, 1, MAX_RENDER_PIXEL_RATIO);
  }

  getPostProcessingSamples() {
    if (!this.antialiasEnabled) return 0;
    return Math.min(POST_PROCESSING_MSAA_SAMPLES, this.renderer.capabilities.maxSamples ?? 0);
  }

  updatePostProcessingSamples() {
    if (!this.composer) return;
    const samples = this.getPostProcessingSamples();
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (!target || target.samples === samples) continue;
      target.samples = samples;
      target.dispose();
    }
  }

  configureTextureQuality() {
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const anisotropy = this.anisotropicEnabled
      ? Math.max(1, Math.min(TEXTURE_ANISOTROPY_LIMIT, maxAnisotropy))
      : 1;
    const minFilter = WORLD_TEXTURE_MIN_FILTER;

    BLOCK_ATLAS.texture.magFilter = THREE.NearestFilter;
    BLOCK_ATLAS.texture.minFilter = minFilter;
    BLOCK_ATLAS.texture.generateMipmaps = true;
    BLOCK_ATLAS.texture.anisotropy = anisotropy;
    BLOCK_ATLAS.texture.needsUpdate = true;

    for (const texture of [WATER_TEXTURE, LAVA_TEXTURE, ...ENVIRONMENT_TEXTURES]) {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = minFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  }

  setupPostProcessing() {
    const pixelRatio = this.renderer.getPixelRatio();
    const w = innerWidth;
    const h = innerHeight;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.updatePostProcessingSamples();

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: this.dofFocusDistance,
      aperture: 0.00008,
      maxblur: 0.006,
    });
    this.bokehPass.enabled = this.depthOfFieldEnabled;
    this.composer.addPass(this.bokehPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.24,  // strength
      0.48,  // radius
      0.88,  // threshold — only torch/lava/sun disc bloom, not general sky
    );
    this.bloomPass.enabled = this.bloomEnabled;
    this.composer.addPass(this.bloomPass);

    this.smaaPass = new SMAAPass(w * pixelRatio, h * pixelRatio);
    this.smaaPass.enabled = this.antialiasEnabled;
    this.composer.addPass(this.smaaPass);

    this.chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaticAberrationPass.enabled = this.chromaticAberrationEnabled;
    this.composer.addPass(this.chromaticAberrationPass);

    this.colorGradePass = new ShaderPass(ColorGradeShader);
    this.composer.addPass(this.colorGradePass);

    // OutputPass converts the linear render-target colors to sRGB and applies
    // the renderer's tone mapping. Without it, composer output looks too dark
    // because intermediate passes write linear data that the screen interprets
    // as sRGB.
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  postProcessingActive() {
    return Boolean(
      this.composer && (
        (this.bokehPass && this.bokehPass.enabled) ||
        (this.bloomPass && this.bloomPass.enabled) ||
        (this.smaaPass && this.smaaPass.enabled) ||
        (this.chromaticAberrationPass && this.chromaticAberrationPass.enabled) ||
        (this.colorGradePass && this.colorGradePass.enabled !== false)
      )
    );
  }

  updateDepthOfFieldFocus() {
    if (!this.bokehPass || !this.bokehPass.enabled) return;
    let target = null;
    try {
      target = this.raycastBlock({ includeWater: true });
    } catch {
      target = null;
    }
    const desired = target && target.point
      ? this.camera.position.distanceTo(target.point)
      : Math.min(this.camera.far * 0.5, 32);
    // Smooth focus so DoF doesn't snap when target changes.
    this.dofFocusDistance += (desired - this.dofFocusDistance) * 0.25;
    const uniforms = this.bokehPass.uniforms;
    if (uniforms) {
      uniforms.focus.value = this.dofFocusDistance;
      uniforms.nearClip.value = this.camera.near;
      uniforms.farClip.value = this.camera.far;
    }
  }

  createSkyDome() {
    const skyGeometry = new THREE.SphereGeometry(230, 48, 24);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x78a7d8) },
        horizonColor: { value: new THREE.Color(0xc4d9e8) },
        groundColor: { value: new THREE.Color(0xd1cab0) },
        sunDirection: { value: new THREE.Vector3(0.58, 0.82, 0).normalize() },
        daylight: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vWorldDirection;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldDirection;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform vec3 sunDirection;
        uniform float daylight;

        float hash3f(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float hashf(float n) {
          return fract(sin(n) * 43758.5453123);
        }

        float starField(vec3 dir) {
          vec3 n = normalize(dir) * 96.0;
          vec3 id = floor(n);
          vec3 gv = fract(n) - 0.5;
          float h = hash3f(id);
          float visible = step(0.989, h);
          float size = 0.06 + hash3f(id + 7.3) * 0.04;
          float twinkle = 0.75 + 0.25 * sin(hashf(id.x + id.y * 137.0 + id.z * 7.0) * 6.2832);
          return visible * twinkle * (1.0 - smoothstep(size * 0.3, size, length(gv)));
        }

        void main() {
          vec3 dir = normalize(vWorldDirection);
          float h = dir.y;

          // Sky gradient — non-linear blend gives richer blue at zenith
          float heightMix = pow(max(smoothstep(-0.06, 0.72, h), 0.0), 0.75);
          float horizonBand = 1.0 - smoothstep(0.0, 0.28, abs(h));
          vec3 sky = mix(horizonColor, topColor, heightMix);
          sky = mix(sky, groundColor, max(0.0, -h) * 1.8);

          float sunDot = max(0.0, dot(dir, sunDirection));
          float horizFactor = clamp(1.0 - abs(h) * 2.5, 0.0, 1.0);

          // Focused Mie lobe — warm glow only close to the sun disc
          float mie = pow(sunDot, 28.0) * daylight * 0.38 * (0.85 + horizonBand * 0.15);
          sky += vec3(1.0, 0.78, 0.44) * mie;

          // Rayleigh scatter — reddish limb along the horizon near the sun
          float rayleigh = pow(sunDot, 22.0) * horizFactor * daylight * 0.055;
          sky += vec3(1.0, 0.65, 0.25) * rayleigh;

          // Sun halo — tight, stays within a few degrees of the disc
          float sunEdgeGlow = pow(sunDot, 140.0) * 0.16 * daylight;
          float sunCoreGlow = pow(sunDot, 280.0) * 0.10 * daylight;
          sky += vec3(1.0, 0.94, 0.78) * (sunEdgeGlow + sunCoreGlow);

          // Solar twilight band — vivid orange/red at the horizon toward the sun
          float sunHorizon = clamp(1.0 - abs(sunDirection.y) * 3.2, 0.0, 1.0);
          sunHorizon = sunHorizon * sunHorizon;
          vec3 dirFlat = vec3(dir.x, 0.0, dir.z);
          vec3 sunFlat = vec3(sunDirection.x, 0.0, sunDirection.z);
          float sunSideHoriz = max(0.0, dot(
            dirFlat / max(length(dirFlat), 0.0001),
            sunFlat / max(length(sunFlat), 0.0001)
          ));
          float twilight = pow(sunSideHoriz, 1.6) * horizFactor * sunHorizon;
          vec3 twilightColor = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.68, 0.22), daylight);
          sky += twilightColor * twilight * 0.65;

          // Anti-solar band — purple/mauve glow opposite the sun at dusk/dawn
          float antiSolar = max(0.0, dot(
            dirFlat / max(length(dirFlat), 0.0001),
            -sunFlat / max(length(sunFlat), 0.0001)
          ));
          float antiTwilight = pow(antiSolar, 2.2) * horizFactor * sunHorizon;
          sky += vec3(0.42, 0.25, 0.55) * antiTwilight * 0.28;

          // Stars + deep night sky
          float nightFactor = clamp(1.0 - daylight * 2.2, 0.0, 1.0);
          if (nightFactor > 0.001 && h > -0.04) {
            // Blend in deep blue-indigo night sky
            vec3 nightSky = vec3(0.005, 0.008, 0.030);
            float nightBlend = nightFactor * smoothstep(-0.04, 0.35, h);
            sky = mix(sky, nightSky * (1.0 + horizonBand * 0.5), nightBlend * 0.85);

            float s = starField(dir) * nightFactor * smoothstep(-0.04, 0.18, h);
            sky += vec3(0.88, 0.92, 1.0) * s;
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.skyDome = new THREE.Mesh(skyGeometry, this.skyMaterial);
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);
  }

  createBreakOverlay() {
    this.breakMaterial = new THREE.MeshBasicMaterial({
      map: CRACK_TEXTURES[0],
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.01,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      side: THREE.DoubleSide,
    });
    this.breakOverlay = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.breakMaterial);
    this.breakOverlay.visible = false;
    this.breakOverlay.renderOrder = 20;
    this.scene.add(this.breakOverlay);
    this.breakStage = 0;
    this.breakOverlayBoundsKey = "";
  }

  createTargetOutline() {
    const geometry = createSelectionOutlineGeometry([FULL_BLOCK_BOUNDS]);
    const material = new THREE.LineBasicMaterial({
      color: 0x0b0f14,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.targetOutline = new THREE.LineSegments(geometry, material);
    this.targetOutline.visible = false;
    this.targetOutline.renderOrder = 19;
    this.targetOutlineShapeKey = "";
    this.scene.add(this.targetOutline);
  }

  createHandViewmodel() {
    // Separate scene + camera for the first-person hand. Rendered after the
    // main pass with autoClear disabled so the arm stays in front of fog and
    // depth-tested geometry.
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 4);
    this.handCamera.position.set(0, 0, 0);

    const skinTexture = new THREE.TextureLoader().load(PLAYER_SKIN_URL);
    skinTexture.magFilter = THREE.NearestFilter;
    skinTexture.minFilter = THREE.NearestFilter;
    skinTexture.generateMipmaps = false;
    skinTexture.colorSpace = THREE.SRGBColorSpace;
    this.playerSkinTexture = skinTexture;

    const armMaterial = new THREE.MeshBasicMaterial({
      map: skinTexture,
      transparent: false,
      side: THREE.FrontSide,
    });
    this.handArmMaterial = armMaterial;

    // Right arm cube: 4×12×4 MC pixels.
    const armWidth = 0.38;
    const armHeight = 0.88;
    const armDepth = 0.36;
    const armGeometry = new THREE.BoxGeometry(armWidth, armHeight, armDepth);
    // UV map the right arm region of the player skin atlas.
    // Right arm sleeve front face is (44..48, 20..32). Hand bottom is the skin.
    const armFaces = {
      right: { x: 44, y: 24, w: 4, h: 8 },
      left: { x: 44, y: 24, w: 4, h: 8 },
      top: { x: 44, y: 28, w: 4, h: 4 },
      bottom: { x: 44, y: 28, w: 4, h: 4 },
      front: { x: 44, y: 24, w: 4, h: 8 },
      back: { x: 44, y: 24, w: 4, h: 8 },
    };
    setHandArmUVs(armGeometry, armFaces, 64, 64);

    this.handArm = new THREE.Mesh(armGeometry, armMaterial);
    this.handArmDefaultPosition = new THREE.Vector3(0.82, -0.9, -1.34);
    this.handArmDefaultRotation = new THREE.Euler(-1.02, -0.44, -0.26);
    this.handArm.position.copy(this.handArmDefaultPosition);
    this.handArm.rotation.copy(this.handArmDefaultRotation);
    this.handScene.add(this.handArm);

    const handLight = new THREE.HemisphereLight(0xffffff, 0x4a4a4a, 1.0);
    this.handScene.add(handLight);
    const handKey = new THREE.DirectionalLight(0xfff4d8, 0.6);
    handKey.position.set(0.6, 1, 0.6);
    this.handScene.add(handKey);
  }

  clearHeldItemMesh() {
    if (this.heldItemMesh) {
      this.handArm.remove(this.heldItemMesh);
      this.heldItemMesh.geometry.dispose();
      const oldMats = Array.isArray(this.heldItemMesh.material)
        ? this.heldItemMesh.material : [this.heldItemMesh.material];
      for (const m of oldMats) {
        if (m.userData?.disposeMapWithMaterial) m.map?.dispose();
        m.dispose();
      }
      this.heldItemMesh = null;
      this.heldItemBaseColor = null;
    }
  }

  createHeldBlockMesh(blockId) {
    const geometry = buildFallingBlockGeometry(blockId);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    geometry.translate(-center.x, -center.y, -center.z);
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
    const scale = getBlockShapeForBlock(blockId) ? 0.56 : 0.36;
    geometry.scale(scale / maxDimension, scale / maxDimension, scale / maxDimension);

    const customShape = Boolean(getBlockShapeForBlock(blockId));
    const material = new THREE.MeshLambertMaterial({
      map: BLOCK_ATLAS.texture,
      vertexColors: true,
      alphaTest: 0.08,
      side: customShape ? THREE.DoubleSide : THREE.FrontSide,
      toneMapped: false,
    });
    material.userData.sharedMap = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(HELD_ITEM_BASE_POSITION.x, HELD_ITEM_BASE_POSITION.y, HELD_ITEM_BASE_POSITION.z);
    mesh.rotation.set(customShape ? 0.72 : 0.3, customShape ? 0.35 : Math.PI / 4, customShape ? -0.18 : 0.2);
    return mesh;
  }

  createHeldSpriteMesh(itemId, item, isBlockItem = false) {
    const handheldTool = this.isHandheldToolItem(itemId, item);
    if (handheldTool) return this.createHeldToolMesh(itemId);

    const spriteUrl = ITEM_SPRITES.get(itemId) ?? item.textureUrl ?? null;
    const size = isBlockItem ? 0.52 : 0.64;
    const geometry = new THREE.PlaneGeometry(size, size);
    let material;

    if (spriteUrl) {
      const tex = new THREE.TextureLoader().load(spriteUrl);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshLambertMaterial({
        map: tex,
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.08,
        side: THREE.DoubleSide,
        depthWrite: true,
        toneMapped: false,
      });
      material.userData.disposeMapWithMaterial = true;
      this.heldItemBaseColor = 0xffffff;
    } else {
      material = new THREE.MeshLambertMaterial({
        color: item.color ?? 0xffffff,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.heldItemBaseColor = item.color ?? 0xffffff;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(HELD_ITEM_BASE_POSITION.x, HELD_ITEM_BASE_POSITION.y, HELD_ITEM_BASE_POSITION.z);
    mesh.rotation.set(HELD_SPRITE_ROTATION.x, HELD_SPRITE_ROTATION.y, isBlockItem ? 0.08 : HELD_SPRITE_ROTATION.z);
    return mesh;
  }

  createHeldToolMesh(itemId) {
    const size = 0.72;
    const depth = 0.09;
    const textureUrl = ITEM_TEXTURE_URL_BY_KEY.get(itemId) ?? ITEM_SPRITES.get(itemId);
    const cachedGeometry = getCachedExtrudedItemGeometry(itemId, size, depth);
    const geometry = cachedGeometry ?? createFallbackHeldToolGeometry(itemId, size, depth);
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.extrudedItem = Boolean(cachedGeometry);
    mesh.userData.heldTool = true;
    mesh.position.set(HELD_ITEM_BASE_POSITION.x, HELD_ITEM_BASE_POSITION.y, HELD_ITEM_BASE_POSITION.z);
    mesh.rotation.set(HELD_TOOL_ROTATION.x, HELD_TOOL_ROTATION.y, HELD_TOOL_ROTATION.z);
    this.heldItemBaseColor = 0xffffff;
    if (!cachedGeometry && textureUrl) {
      requestExtrudedItemGeometry(itemId, textureUrl, size, depth, (loadedGeometry) => {
        if (this.heldItemMesh !== mesh) return;
        mesh.geometry.dispose();
        mesh.geometry = loadedGeometry.clone();
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        mesh.userData.extrudedItem = true;
      });
    }
    return mesh;
  }

  isHandheldToolItem(itemId, item) {
    return Boolean(item?.tool)
      || /(?:^|_)(?:sword|pickaxe|shovel|axe|hoe)$/.test(itemId)
      || /^(shears|flint_and_steel|fishing_rod|carrot_on_a_stick|stick)$/.test(itemId);
  }

  shouldRenderHeldBlockAsSprite(blockId) {
    return !getBlockShapeForBlock(blockId) && isPlant(blockId);
  }

  updateHeldItemMesh() {
    if (!this.handArm) return;
    const slot = this.inventory?.slots[HOTBAR_START + this.selectedHotbar];
    const itemId = slot?.id ?? null;
    if (itemId === this._lastHeldItemId) return;
    this._lastHeldItemId = itemId;

    this.clearHeldItemMesh();

    if (!itemId) {
      if (this.handArmMaterial) this.handArmMaterial.visible = true;
      return;
    }
    const item = ITEMS[itemId];
    if (!item) return;

    const blockId = item.block ?? getExtraBlockByItemId(itemId);
    const isBlock = blockId != null;
    if (this.handArmMaterial) this.handArmMaterial.visible = false;

    if (isBlock && !this.shouldRenderHeldBlockAsSprite(blockId)) {
      this.heldItemMesh = this.createHeldBlockMesh(blockId);
      this.heldItemBaseColor = 0xffffff;
    } else {
      this.heldItemMesh = this.createHeldSpriteMesh(itemId, item, isBlock);
    }

    this.handArm.add(this.heldItemMesh);
    this.heldItemMesh.userData.basePosition = this.heldItemMesh.position.clone();
    this.heldItemMesh.userData.baseRotation = this.heldItemMesh.rotation.clone();
  }

  triggerHandSwing() {
    this.handSwingProgress = 0;
    this.handSwingActive = true;
    this.handSwingSequence = (this.handSwingSequence ?? 0) + 1;
  }

  updateHandSwing(dt) {
    if (!this.handArm) return;
    const breaking = this.isMining && this.miningTarget && this.player?.mode === "survival";
    if (this.handSwingActive) {
      this.handSwingProgress = Math.min(1, this.handSwingProgress + dt / 0.3);
      if (this.handSwingProgress >= 1) {
        this.handSwingActive = false;
        this.handSwingProgress = 0;
      }
    }
    this.handBreakElapsed = breaking ? this.handBreakElapsed + dt : 0;
    const t = this.handSwingProgress;
    const swingArc = t > 0 ? Math.sin(t * Math.PI) : 0;
    const breakArc = breaking ? 0.5 + 0.5 * Math.sin(this.handBreakElapsed * 24) : 0;
    const walkDip = -(this.cameraBobHandY ?? 0) * 1.4;
    const sprintTarget = (this.player?.isSprinting() && this.player?.onGround) ? 0.16 : 0;
    this.handArmSprintLean = lerp(this.handArmSprintLean ?? 0, sprintTarget, Math.min(1, dt * 7));
    const holdingSelectedItem = Boolean(this.heldItemMesh && this.handArmMaterial && !this.handArmMaterial.visible);
    if (holdingSelectedItem) {
      const swingSweep = Math.sin(t * Math.PI);
      const swingFollowThrough = t > 0 ? Math.sin(t * Math.PI * 0.5) : 0;
      const itemSwing = Math.min(1, swingSweep + breakArc * 0.55);
      const itemBasePosition = this.heldItemMesh.userData.basePosition ?? this.heldItemMesh.position;
      const itemBaseRotation = this.heldItemMesh.userData.baseRotation ?? this.heldItemMesh.rotation;
      this.heldItemMesh.position.set(
        itemBasePosition.x - itemSwing * 0.05,
        itemBasePosition.y - itemSwing * 0.08,
        itemBasePosition.z + itemSwing * 0.02,
      );
      this.heldItemMesh.rotation.set(
        itemBaseRotation.x + itemSwing * 0.32,
        itemBaseRotation.y - itemSwing * 0.16,
        itemBaseRotation.z + itemSwing * 0.5,
      );
      this.handArm.position.set(
        this.handArmDefaultPosition.x - swingSweep * 0.12 - breakArc * 0.06,
        this.handArmDefaultPosition.y - swingSweep * 0.46 - breakArc * 0.24 + walkDip,
        this.handArmDefaultPosition.z - swingSweep * 0.10 - breakArc * 0.08,
      );
      this.handArm.rotation.set(
        this.handArmDefaultRotation.x - swingSweep * 0.34 - breakArc * 0.18 - this.handArmSprintLean * 0.45,
        this.handArmDefaultRotation.y - swingSweep * 0.22 - breakArc * 0.1,
        this.handArmDefaultRotation.z + swingSweep * 0.24 + swingFollowThrough * 0.08 + breakArc * 0.08,
      );
      return;
    }
    this.handArm.position.set(
      this.handArmDefaultPosition.x - swingArc * 0.035 - breakArc * 0.045,
      this.handArmDefaultPosition.y + swingArc * 0.07 + breakArc * 0.055 + walkDip,
      this.handArmDefaultPosition.z - swingArc * 0.08 - breakArc * 0.10,
    );
    this.handArm.rotation.set(
      this.handArmDefaultRotation.x - swingArc * 0.52 - breakArc * 0.22 - this.handArmSprintLean,
      this.handArmDefaultRotation.y - swingArc * 0.22 - breakArc * 0.12,
      this.handArmDefaultRotation.z + swingArc * 0.10 + breakArc * 0.08,
    );
  }

  updateHeldItemLightColor(brightness, warmth = 0) {
    if (!this.heldItemMesh || this.heldItemBaseColor == null) return;
    const base = new THREE.Color(this.heldItemBaseColor);
    const lr = clamp(base.r * brightness * (1 + warmth), 0, 1);
    const lg = clamp(base.g * brightness, 0, 1);
    const lb = clamp(base.b * brightness * (1 - warmth), 0, 1);
    const mats = Array.isArray(this.heldItemMesh.material)
      ? this.heldItemMesh.material : [this.heldItemMesh.material];
    for (const mat of mats) {
      if (mat?.color) mat.color.setRGB(lr, lg, lb);
    }
  }

  updateHandLighting() {
    if (!this.handArmMaterial || !this.world || !this.camera) return;
    if (this.nightVisionActive) {
      this.handArmMaterial.color.setRGB(1, 1, 1);
      this.updateHeldItemLightColor(1, 0);
      return;
    }

    const wx = Math.floor(this.camera.position.x);
    const wy = Math.floor(this.camera.position.y);
    const wz = Math.floor(this.camera.position.z);
    const skyLevel = this.world.getSkyLightLevel(wx, wy, wz) / MAX_LIGHT_LEVEL;
    const sky = skyLevel * (this.skyLightFactor ?? 1);
    let torch = 0;
    for (const light of this.world.dynamicBlockLights ?? []) {
      if (!light.visible || light.intensity <= 0 || light.distance <= 0) continue;
      const distance = this.camera.position.distanceTo(light.position);
      const falloff = clamp(1 - distance / light.distance, 0, 1);
      torch = Math.max(torch, Math.pow(falloff, 0.55) * clamp(light.intensity / DYNAMIC_BLOCK_LIGHT_INTENSITY, 0, 1));
    }

    const light = Math.max(sky, torch * 0.95);
    const brightness = clamp(0.16 + light * 0.84, 0.16, 1);
    const warmth = torch * (1 - sky) * 0.05;
    this.handArmMaterial.color.setRGB(
      clamp(brightness * (1 + warmth), 0, 1),
      brightness,
      clamp(brightness * (1 - warmth), 0, 1),
    );
    this.updateHeldItemLightColor(brightness, warmth);
  }

  updateCameraBob(dt) {
    this.cameraBobPhase = this.cameraBobPhase ?? 0;
    this.cameraBobAmplitude = this.cameraBobAmplitude ?? 0;

    if (!this.started || !this.player) {
      this.cameraBobAmplitude = 0;
      this.cameraBobHandY = 0;
      return;
    }

    const active = this.player.mode !== "spectator" &&
      !(this.player.mode === "creative" && this.player.isFlying);
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const moving = active && this.player.onGround && speed > 0.5;
    // Halved amplitudes relative to original for a subtler, Minecraft-like feel.
    const targetAmp = moving ? (this.player.isSprinting() ? 0.032 : 0.02) : 0;

    this.cameraBobAmplitude += (targetAmp - this.cameraBobAmplitude) * Math.min(1, dt * 10);
    // ~0.45 gives ~2 steps/sec at normal walk speed (~4.3 m/s), matching Minecraft cadence.
    if (moving) this.cameraBobPhase += speed * dt * 0.45;

    const a = this.cameraBobAmplitude;
    this.cameraBobHandY = Math.abs(Math.sin(this.cameraBobPhase * Math.PI)) * a;

    if (a < 0.001) {
      this.camera.rotation.z = 0;
      return;
    }
    const bobY = this.cameraBobHandY;

    // Minecraft-style: vertical position bob + a gentle roll (z-rotation sway)
    // rather than the more jarring lateral position offset.
    const sway = Math.sin(this.cameraBobPhase * Math.PI / 2) * a * 0.4;
    this.camera.position.y += bobY;
    // Apply as camera roll so the horizon tilts gently instead of the whole view shifting sideways.
    this.camera.rotation.z = sway * 0.6;
  }

  resetWorld(seed, mode = this.selectedMode, initialRenderDistance = TITLE_RENDER_DISTANCE, buildBudget = TITLE_CHUNK_BUILD_BUDGET) {
    this.clearDroppedItems();
    this.clearBlockBreakParticles();
    this.clearMobs();
    this.clearFallingBlocks();
    this.furnaces?.clear();
    this.mobSpawnTimer = PASSIVE_MOB_INITIAL_SPAWN_DELAY;
    if (this.world) this.world.dispose();
    this.currentSeedText = normalizeWorldSeedText(seed);
    this.world = new VoxelWorld(this.scene, this.currentSeedText);
    this.precipitationColumnCache?.clear();
    this._rainPrecipitationRevision = -1;
    this._snowPrecipitationRevision = -1;
    this.world.onFluidBreakBlock = (block, x, y, z) => this.handleFluidBreakBlock(block, x, y, z);
    this.world.onBlockChanged = (change) => this.handleWorldBlockChanged(change);
    const asyncWarmup = !this.loadingWorld && !this.started && buildBudget > 0;
    this.player = new Player(this.world, this.camera, mode);
    this.world.asyncGenerationEnabled = this.loadingWorld || this.started || asyncWarmup;
    this.world.asyncMeshingEnabled = this.loadingWorld || this.started || asyncWarmup;
    if (this.loadingWorld) {
      this.world.bootstrapSpawnChunks(this.player.position);
    }
    const warmupOptions = {
      timeBudgetMs: this.loadingWorld ? CHUNK_LOADING_TIME_BUDGET_MS : 2400,
    };
    if (asyncWarmup) {
      warmupOptions.createBudget = buildBudget;
      warmupOptions.deferMeshingUntilChunksReady = true;
    }
    this.world.ensureChunksAround(this.player.position, initialRenderDistance, buildBudget, warmupOptions);
    if (asyncWarmup) {
      this.world.asyncGenerationEnabled = false;
      this.world.asyncMeshingEnabled = false;
    }
    this.player.update(0);
    this.resetSurvivalStats();
    this.applyVisionMode();
  }

  buildHotbar() {
    this.hotbar.innerHTML = "";
    for (let index = 0; index < HOTBAR_SIZE; index += 1) {
      const slot = document.createElement("div");
      slot.className = "hotbar-slot";
      slot.dataset.index = String(index);
      slot.innerHTML = `<span class="slot-count"></span>`;
      if (index === this.selectedHotbar) slot.classList.add("is-selected");
      this.hotbar.append(slot);
    }
    this.renderHotbar();
  }

  buildVitalBars() {
    const buildCells = (element, className) => {
      if (!element) return;
      element.innerHTML = "";
      for (let index = 0; index < 10; index += 1) {
        const cell = document.createElement("span");
        cell.className = className;
        cell.dataset.index = String(index);
        element.append(cell);
      }
    };

    buildCells(this.healthBar, "health-cell");
    buildCells(this.hungerBar, "hunger-cell");
    buildCells(this.airBubbles, "air-cell");
    buildCells(this.armorBar, "armor-cell");
  }

  buildInventoryUi() {
    this.craftGrid.innerHTML = "";
    this.inventoryGrid.innerHTML = "";
    this.creativeTabs.innerHTML = "";
    this.creativeGrid.innerHTML = "";

    for (const tab of CREATIVE_TABS) {
      const button = document.createElement("button");
      button.className = "creative-tab";
      button.type = "button";
      button.dataset.tab = tab.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-label", tab.label);
      button.textContent = tab.label;
      this.creativeTabs.append(button);
    }

    for (let i = 0; i < CRAFT_SLOT_COUNT; i += 1) {
      const slot = document.createElement("button");
      slot.className = "inventory-slot";
      slot.type = "button";
      slot.dataset.area = "craft";
      slot.dataset.index = String(i);
      slot.setAttribute("aria-label", `Crafting slot ${i + 1}`);
      slot.innerHTML = `<span class="slot-count"></span>`;
      this.craftGrid.append(slot);
    }

    for (let i = 0; i < INVENTORY_SIZE; i += 1) {
      const slot = document.createElement("button");
      slot.className = "inventory-slot";
      slot.type = "button";
      slot.dataset.area = "inventory";
      slot.dataset.index = String(i);
      slot.setAttribute("aria-label", `Inventory slot ${i + 1}`);
      slot.innerHTML = `<span class="slot-count"></span>`;
      if (i >= HOTBAR_START) slot.classList.add("is-hotbar-slot");
      this.inventoryGrid.append(slot);
    }

    this.craftOutput.innerHTML = `<button class="inventory-slot output-slot" type="button" aria-label="Crafting result"><span class="slot-count"></span></button>`;
  }

  buildCraftingTableUi() {
    if (!this.craftingTableGrid || !this.craftingTableInvGrid || !this.craftingTableOutput) return;
    this.craftingTableGrid.innerHTML = "";
    this.craftingTableInvGrid.innerHTML = "";

    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("button");
      slot.className = "inventory-slot";
      slot.type = "button";
      slot.dataset.area = "table";
      slot.dataset.index = String(i);
      slot.setAttribute("aria-label", `Crafting slot ${i + 1}`);
      slot.innerHTML = `<span class="slot-count"></span>`;
      this.craftingTableGrid.append(slot);
    }

    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = document.createElement("button");
      slot.className = "inventory-slot";
      slot.type = "button";
      slot.dataset.area = "ct-inventory";
      slot.dataset.index = String(i);
      slot.setAttribute("aria-label", `Inventory slot ${i + 1}`);
      slot.innerHTML = `<span class="slot-count"></span>`;
      if (i >= HOTBAR_START) slot.classList.add("is-hotbar-slot");
      this.craftingTableInvGrid.append(slot);
    }

    this.craftingTableOutput.innerHTML = `<button class="inventory-slot output-slot" type="button" aria-label="Crafting result"><span class="slot-count"></span></button>`;

    this.craftingTableGrid.addEventListener("click", (event) => this.handleInventoryClick(event));
    this.craftingTableGrid.addEventListener("contextmenu", (event) => this.handleInventoryRightClick(event));
    this.craftingTableInvGrid.addEventListener("click", (event) => this.handleInventoryClick(event));
    this.craftingTableInvGrid.addEventListener("contextmenu", (event) => this.handleInventoryRightClick(event));
  }

  buildFurnaceUi() {
    if (!this.furnaceInvGrid) return;
    this.furnaceInvGrid.innerHTML = "";
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = document.createElement("button");
      slot.className = "inventory-slot";
      slot.type = "button";
      slot.dataset.area = "furnace-inventory";
      slot.dataset.index = String(i);
      slot.setAttribute("aria-label", `Inventory slot ${i + 1}`);
      slot.innerHTML = `<span class="slot-count"></span>`;
      if (i >= HOTBAR_START) slot.classList.add("is-hotbar-slot");
      this.furnaceInvGrid.append(slot);
    }
    this.furnaceInvGrid.addEventListener("click", (event) => this.handleInventoryClick(event));
    this.furnaceInvGrid.addEventListener("contextmenu", (event) => this.handleInventoryRightClick(event));
  }

  bindEvents() {
    addEventListener("resize", () => this.resize());

    this.playButton.addEventListener("click", () => this.openWorldCreateWindow());
    this.serverButton.addEventListener("click", () => this.openMultiplayerWindow());
    this.createBackButton.addEventListener("click", () => this.closeWorldCreateWindow());
    this.serverBackButton.addEventListener("click", () => this.closeMultiplayerWindow());

    this.startButton.addEventListener("click", () => {
      if (this.started || this.loadingWorld) return;
      this.beginLoadingWorld();
    });

    this.joinServerButton.addEventListener("click", () => this.beginMultiplayerWorld());
    this.hostServerButton.addEventListener("click", () => this.startDesktopHostServer());
    this.stopHostServerButton.addEventListener("click", () => this.stopDesktopHostServer());
    this.serverUrlInput.addEventListener("input", () => {
      this.setMultiplayerStatus("");
    });
    this.playerNameInput.addEventListener("input", () => {
      const sanitized = sanitizePlayerName(this.playerNameInput.value, "");
      if (this.playerNameInput.value !== sanitized) this.playerNameInput.value = sanitized;
      this.setMultiplayerStatus("");
    });
    this.multiplayerWindow.addEventListener("keydown", (event) => {
      if (event.code === "Enter") {
        event.preventDefault();
        this.beginMultiplayerWorld();
      }
      if (event.code === "Escape") {
        event.preventDefault();
        this.closeMultiplayerWindow();
      }
    });

    this.randomButton.addEventListener("click", () => {
      this.seedInput.value = randomMinecraftSeedText();
      this.updateSeedPreview();
    });
    this.seedInput.addEventListener("input", () => {
      const sanitized = sanitizeNumericSeedInput(this.seedInput.value);
      if (this.seedInput.value !== sanitized) this.seedInput.value = sanitized;
      this.updateSeedPreview();
    });
    this.cheatsInput.addEventListener("change", () => {
      this.allowCheats = this.cheatsInput.checked;
    });

    this.titleSettingsButton.addEventListener("click", () => this.openSettingsWindow());

    this.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.setSelectedMode(button.dataset.mode);
      });
    });

    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === this.canvas;
      if (this.loadingWorld) return;
      if (this.started && !locked && !this.inventoryOpen && !this.paused && !this.chatOpen && this.deathScreen?.hidden !== false) {
        this.openPauseMenu();
      }
      this.pauseNote.classList.toggle("is-visible", this.started && !locked && !this.inventoryOpen && !this.paused && !this.chatOpen);
    });

    this.canvas.addEventListener("click", () => {
      if (this.started && !this.inventoryOpen && !this.paused && !this.chatOpen && document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    });

    addEventListener("mousemove", (event) => {
      this.positionCursorStack(event);
      if (!this.started || document.pointerLockElement !== this.canvas) return;
      this.player.look(event.movementX * this.mouseSensitivity, event.movementY * this.mouseSensitivity);
    });

    addEventListener(
      "wheel",
      (event) => {
        if (!this.started || this.inventoryOpen || this.paused || this.chatOpen) return;
        event.preventDefault();
        this.selectHotbarSlot(this.selectedHotbar + (event.deltaY > 0 ? 1 : -1));
      },
      { passive: false },
    );

    addEventListener("keydown", (event) => {
      if (this.anvilOverlay && !this.anvilOverlay.hidden && event.code === "Escape") {
        event.preventDefault();
        this.closeAnvilMenu();
        return;
      }
      if (this.furnaceOverlay && !this.furnaceOverlay.hidden && event.code === "Escape") {
        event.preventDefault();
        this.closeFurnaceMenu();
        return;
      }
      if (this.craftingTableOverlay && !this.craftingTableOverlay.hidden && event.code === "Escape") {
        event.preventDefault();
        this.closeCraftingTable();
        return;
      }
      if (this.settingsOpen && event.code === "Escape") {
        event.preventDefault();
        this.closeSettingsWindow();
        return;
      }
      if (this.chatOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          this.closeChat();
        }
        return;
      }
      if (isTextInputTarget(event.target)) return;
      if (!this.started) return;
      if (event.code === "Tab") {
        event.preventDefault();
        if (!this.inventoryOpen && !this.paused && !this.settingsOpen) this.showPlayerList();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        if (this.inventoryOpen) {
          this.closeInventory();
        } else if (this.paused) {
          this.resumeGame();
        } else {
          this.openPauseMenu();
        }
        return;
      }
      if ((this.inventoryOpen || this.isCraftingTableOpen()) && /Digit[1-9]/.test(event.code)) {
        event.preventDefault();
        this.handleInventoryNumberKey(Number(event.code.replace("Digit", "")) - 1);
        return;
      }
      if ((this.inventoryOpen || this.isCraftingTableOpen() || this.isFurnaceOpen()) && event.code === "KeyQ") {
        event.preventDefault();
        this.dropHoveredInventoryItem(event.ctrlKey || event.metaKey);
        return;
      }
      if (this.paused) return;
      if ((event.code === "KeyT" || event.code === "Slash") && !this.inventoryOpen) {
        event.preventDefault();
        this.openChat(event.code === "Slash" ? "/" : "");
        return;
      }
      if (event.code === "KeyE") {
        event.preventDefault();
        this.toggleInventory();
        return;
      }
      if (this.inventoryOpen) return;
      if (/Digit[1-9]/.test(event.code)) {
        this.selectHotbarSlot(Number(event.code.replace("Digit", "")) - 1);
        return;
      }
      if (event.code === "KeyQ") {
        event.preventDefault();
        this.dropSelectedItem(event.ctrlKey || event.metaKey);
        return;
      }
      if (event.code === "Space") event.preventDefault();
      if (event.code === "ControlLeft" || event.code === "ControlRight") event.preventDefault();
      this.player.handleKeyDown(event.code);
    });

    addEventListener("keyup", (event) => {
      if (isTextInputTarget(event.target)) return;
      if (event.code === "Tab") {
        event.preventDefault();
        this.hidePlayerList();
        return;
      }
      if (!this.player) return;
      this.player.handleKeyUp(event.code);
    });

    this.inventoryClose.addEventListener("click", () => this.closeInventory());
    this.deathRespawnButton.addEventListener("click", () => this.respawnPlayer());
    this.deathTitleButton.addEventListener("click", () => {
      this.deathScreen.hidden = true;
      this.returnToTitleScreen();
    });
    this.anvilCloseButton?.addEventListener("click", () => this.closeAnvilMenu());
    this.anvilOverlay?.addEventListener("click", (event) => {
      if (event.target === this.anvilOverlay) this.closeAnvilMenu();
    });
    this.furnaceCloseButton?.addEventListener("click", () => this.closeFurnaceMenu());
    this.furnaceOverlay?.addEventListener("click", (event) => {
      if (event.target === this.furnaceOverlay) {
        if (this.inventory?.cursor) { this.dropCursorItemsInWorld(); return; }
        this.closeFurnaceMenu();
      }
    });
    this.furnaceOverlay?.addEventListener("contextmenu", (event) => event.preventDefault());
    this.furnaceOverlay?.addEventListener("pointerdown", (event) => this.onInvPointerDown(event));
    this.furnaceOverlay?.addEventListener("pointermove", (event) => this.onInvPointerMove(event));
    this.furnaceOverlay?.addEventListener("pointerup", (event) => this.onInvPointerUp(event));
    this.furnaceSlotInput?.addEventListener("click", (event) => this.furnaceSlotClick("input", event));
    this.furnaceSlotInput?.addEventListener("contextmenu", (event) => { event.preventDefault(); this.furnaceSlotRightClick("input", event); });
    this.furnaceSlotFuel?.addEventListener("click", (event) => this.furnaceSlotClick("fuel", event));
    this.furnaceSlotFuel?.addEventListener("contextmenu", (event) => { event.preventDefault(); this.furnaceSlotRightClick("fuel", event); });
    this.furnaceSlotOutput?.addEventListener("click", (event) => this.furnaceSlotClick("output", event));
    this.furnaceSlotOutput?.addEventListener("contextmenu", (event) => { event.preventDefault(); this.furnaceSlotClick("output", event); });
    this.craftingTableClose?.addEventListener("click", () => this.closeCraftingTable());
    this.craftingTableOverlay?.addEventListener("click", (event) => {
      if (event.target === this.craftingTableOverlay) this.closeCraftingTable();
    });
    this.craftingTableOutput?.addEventListener("click", (event) => this.takeCraftingTableOutput(event));
    this.craftingTableOutput?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.takeCraftingTableOutput(event);
    });
    this.craftingTableOverlay?.addEventListener("contextmenu", (event) => event.preventDefault());
    this.craftingTableOverlay?.addEventListener("pointerover", (event) => this.trackHoveredInventorySlot(event));
    this.creativeTabs.addEventListener("click", (event) => {
      const tab = event.target.closest(".creative-tab");
      if (!tab) return;
      this.creativeTab = tab.dataset.tab ?? "blocks";
      if (this.creativeTab === "search") this.creativeSearchInput.focus();
      this.renderInventory();
    });
    this.creativeSearchInput.addEventListener("input", () => {
      this.creativeSearchQuery = this.creativeSearchInput.value.trim().toLowerCase();
      if (this.creativeSearchQuery) this.creativeTab = "search";
      this.renderInventory();
    });
    this.creativeGrid.addEventListener("click", (event) => this.handleInventoryClick(event));
    this.creativeGrid.addEventListener("contextmenu", (event) => this.handleInventoryRightClick(event));
    this.recipeSearchInput2x2?.addEventListener("input", () => {
      this.recipeSearchQuery2x2 = this.recipeSearchInput2x2.value.trim().toLowerCase();
      this.renderInventory();
    });
    this.recipeSearchInput3x3?.addEventListener("input", () => {
      this.recipeSearchQuery3x3 = this.recipeSearchInput3x3.value.trim().toLowerCase();
      this.renderCraftingTable();
    });
    this.recipeGuideList2x2?.addEventListener("click", (event) => this.handleRecipeGuideClick(event, 2));
    this.recipeGuideList3x3?.addEventListener("click", (event) => this.handleRecipeGuideClick(event, 3));
    this.inventoryGrid.addEventListener("click", (event) => this.handleInventoryClick(event));
    this.craftGrid.addEventListener("click", (event) => this.handleInventoryClick(event));
    this.inventoryGrid.addEventListener("contextmenu", (event) => this.handleInventoryRightClick(event));
    this.craftGrid.addEventListener("contextmenu", (event) => this.handleInventoryRightClick(event));
    this.inventoryOverlay.addEventListener("contextmenu", (event) => event.preventDefault());
    this.inventoryOverlay.addEventListener("pointerover", (event) => this.trackHoveredInventorySlot(event));
    // Drag painting (hold right-click to place one item per slot)
    this.inventoryOverlay.addEventListener("pointerdown", (event) => this.onInvPointerDown(event));
    this.inventoryOverlay.addEventListener("pointermove", (event) => this.onInvPointerMove(event));
    this.inventoryOverlay.addEventListener("pointerup", (event) => this.onInvPointerUp(event));
    this.craftingTableOverlay?.addEventListener("pointerdown", (event) => this.onInvPointerDown(event));
    this.craftingTableOverlay?.addEventListener("pointermove", (event) => this.onInvPointerMove(event));
    this.craftingTableOverlay?.addEventListener("pointerup", (event) => this.onInvPointerUp(event));
    // Click outside inventory panel to drop cursor items
    this.inventoryOverlay.addEventListener("click", (event) => {
      if (event.target === this.inventoryOverlay && this.inventory?.cursor) {
        this.dropCursorItemsInWorld();
      }
    });
    this.craftOutput.addEventListener("click", (event) => this.takeCraftingOutput(event));
    this.craftOutput.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.takeCraftingOutput(event);
    });
    this.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitChat();
    });
    this.chatInput.addEventListener("input", () => this.updateChatSuggestions());
    this.chatInput.addEventListener("keydown", (event) => this.handleChatSuggestionKey(event));
    this.chatSuggestionsElement.addEventListener("mousedown", (event) => {
      const item = event.target.closest(".chat-suggestion");
      if (!item) return;
      event.preventDefault();
      this.applyChatSuggestion(Number(item.dataset.index));
    });
    this.resumeButton.addEventListener("click", () => this.resumeGame());
    this.settingsButton.addEventListener("click", () => this.openSettingsWindow());
    this.titleButton.addEventListener("click", () => this.returnToTitleScreen());
    this.settingsCloseButton.addEventListener("click", () => this.closeSettingsWindow());
    this.settingsOverlay.addEventListener("click", (event) => {
      if (event.target === this.settingsOverlay) this.closeSettingsWindow();
    });
    this.resolutionSelect.addEventListener("change", (event) => {
      this.setResolutionPreset(event.target.value);
    });
    this.renderDistanceInput.addEventListener("input", (event) => {
      this.setRenderDistance(Number(event.target.value));
    });
    this.fovInput.addEventListener("input", (event) => {
      this.setFieldOfView(Number(event.target.value));
    });
    this.sensitivityInput.addEventListener("input", (event) => {
      this.setMouseSensitivity(Number(event.target.value));
    });
    this.smoothLightingInput.addEventListener("change", (event) => {
      this.setSmoothLighting(event.target.checked);
    });
    this.shadowInput.addEventListener("change", (event) => {
      this.setShadows(event.target.checked);
    });
    this.cloudInput.addEventListener("change", (event) => {
      this.setClouds(event.target.checked);
    });
    this.dofInput.addEventListener("change", (event) => {
      this.setDepthOfField(event.target.checked);
    });
    this.antialiasInput.addEventListener("change", (event) => {
      this.setAntialiasing(event.target.checked);
    });
    this.anisotropicInput.addEventListener("change", (event) => {
      this.setAnisotropic(event.target.checked);
    });
    this.chromaticAberrationInput.addEventListener("change", (event) => {
      this.setChromaticAberration(event.target.checked);
    });
    this.bloomInput.addEventListener("change", (event) => {
      this.setBloom(event.target.checked);
    });

    this.canvas.addEventListener("mousedown", (event) => {
      if (!this.started || this.inventoryOpen || this.paused || this.chatOpen || document.pointerLockElement !== this.canvas) return;
      if (this.player.mode === "spectator") return;
      if (event.button === 0) {
        // Mob hit takes precedence over block mining when both are in reach.
        const mobHit = this.raycastMob();
        const blockHit = this.raycastBlock();
        const mobIsCloser = mobHit && (!blockHit || mobHit.distance < this.cameraToBlockDistance(blockHit) - 0.05);
        if (mobIsCloser) {
          this.attackMob(mobHit.mob);
          return;
        }
        if (this.player.mode === "creative") {
          this.breakTargetBlock();
        } else {
          if (blockHit && isInstantBreakBlock(blockHit.block)) {
            this.finishBreakingBlock(blockHit);
          } else {
            this.startMining();
          }
        }
        // Always swing the arm for an attack/punch action.
        this.triggerHandSwing();
      }
      if (event.button === 2) {
        this.rightMouseHeld = true;
        this.placeRepeatTimer = 0.3;
        if (!this.interactTargetBlock() && !this.useSelectedItem()) this.placeTargetBlock();
        this.triggerHandSwing();
      }
    });

    addEventListener("mouseup", (event) => {
      if (event.button === 0) this.stopMining();
      if (event.button === 2) this.rightMouseHeld = false;
    });

    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  start() {
    this.started = true;
    this.paused = false;
    this.loadingWorld = false;
    if (this.world) {
      this.world.asyncGenerationEnabled = true;
      this.world.asyncMeshingEnabled = true;
    }
    this.loadingOverlay.hidden = true;
    this.pauseOverlay.hidden = true;
    if (this.deathScreen) this.deathScreen.hidden = true;
    this.titleScreen.style.display = "none";
    this.hud.classList.add("is-visible");
    this.renderVitals();
    this.canvas.focus({ preventScroll: true });
    this.canvas.requestPointerLock();
    this.multiplayer?.sendPlayerState(true);
  }

  beginLoadingWorld() {
    this.disconnectMultiplayer("Starting singleplayer");
    this.loadingWorld = true;
    this.closeWorldCreateWindow();
    this.loadingTargetRadius = Math.min(Math.max(SPAWN_LOADING_RADIUS, SPAWN_READY_RADIUS), this.renderDistance);
    this.loadingReadyRadius = Math.min(SPAWN_READY_RADIUS, this.loadingTargetRadius);
    this.loadingReady = 0;
    this.loadingTotal = (this.loadingTargetRadius * 2 + 1) ** 2;
    this.loadingStartedAt = performance.now();
    this.inventory = new Inventory();
    this.allowCheats = this.cheatsInput.checked;
    const seed = this.prepareWorldSeed();
    this.paused = false;
    this.pauseOverlay.hidden = true;
    this.closeSettingsWindow();
    this.loadingOverlay.hidden = false;
    this.updateLoadingUi();
    this.loadingPendingReset = true;
    requestAnimationFrame(() => {
      if (!this.loadingWorld) return;
      this.resetWorld(seed, this.selectedMode, this.loadingTargetRadius, 0);
      this.renderInventory();
      this.loadingPendingReset = false;
    });
  }

  updateLoadingWorld() {
    if (!this.loadingWorld || !this.world || !this.player) return;
    if (this.loadingPendingReset) return;
    this.world.ensureChunksAround(this.player.position, this.loadingTargetRadius, 96, {
      deferMeshingUntilChunksReady: false,
      requireMeshNeighbors: false,
      createBudget: 96,
      timeBudgetMs: CHUNK_LOADING_TIME_BUDGET_MS,
      leadChunks: 0,
      generationPadding: 0,
    });
    const targetStats = this.world.chunkBuildStats(this.player.position, this.loadingTargetRadius);
    const readyStats = this.world.chunkGeneratedStats(this.player.position, this.loadingReadyRadius);
    const visibleStats = this.world.chunkBuildStats(this.player.position, SPAWN_MESH_READY_RADIUS);
    this.loadingReady = targetStats.ready;
    this.loadingTotal = targetStats.total;
    this.updateLoadingUi();

    if (
      readyStats.ready >= readyStats.total &&
      visibleStats.ready >= visibleStats.total &&
      performance.now() - this.loadingStartedAt > 450
    ) {
      this.start();
    }
  }

  updateLoadingUi() {
    const progress = clamp(this.loadingReady / Math.max(1, this.loadingTotal), 0, 1);
    this.loadingText.textContent = "Building spawn chunks";
    this.loadingCount.textContent = `${this.loadingReady} / ${this.loadingTotal} chunks`;
    this.loadingBarFill.style.transform = `scaleX(${progress})`;
  }

  resetSurvivalStats() {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = MAX_SATURATION;
    this.exhaustion = 0;
    this.airTicks = MAX_AIR_TICKS;
    this.damageInvulnerability = 0;
    this.cactusDamageTimer = 0;
    this.drownDamageTimer = 0;
    this.starvationTimer = 0;
    this.healthRegenTimer = 0;
    this.lastSurvivalPosition = this.player?.position.clone() ?? null;
    if (this.player) this.player.fallDistance = 0;
    this.renderVitals();
  }

  renderVitals() {
    if (!this.survivalBars || !this.healthBar || !this.hungerBar || !this.airBubbles) return;
    const visible = Boolean(this.started && this.player?.mode === "survival");
    this.survivalBars.hidden = !visible;

    const showAir = this.airTicks < MAX_AIR_TICKS || Boolean(this.player?.eyeInWater);
    this.airBubbles.hidden = !showAir;

    this.renderVitalCells(this.healthBar.children, this.health, MAX_HEALTH);
    // Hunger depletes left-to-right: reverse cell order so index 0 empties first
    this.renderVitalCells([...this.hungerBar.children].reverse(), this.hunger, MAX_HUNGER);
    // Discrete air bubbles: snap to whole bubbles, rightmost pops first
    this.renderAirBubbles();
    this.renderArmorBar();
  }

  renderArmorBar() {
    if (!this.armorBar) return;
    const armorPoints = this.getArmorPoints();
    this.armorBar.classList.toggle("has-armor", armorPoints > 0);
    this.renderVitalCells(this.armorBar.children, armorPoints, 20);
  }

  renderAirBubbles() {
    const fullBubbles = Math.floor(this.airTicks / MAX_AIR_TICKS * 10);
    [...this.airBubbles.children].forEach((cell, index) => {
      const isFull = index < fullBubbles;
      const wasFull = cell.classList.contains("is-full");
      if (isFull) {
        clearTimeout(cell._popTimeout);
        cell.classList.remove("is-popping", "is-empty");
        cell.classList.add("is-full");
      } else if (wasFull) {
        cell.classList.remove("is-full");
        cell.classList.add("is-popping");
        clearTimeout(cell._popTimeout);
        cell._popTimeout = setTimeout(() => {
          cell.classList.remove("is-popping");
          cell.classList.add("is-empty");
        }, 500);
      } else if (!cell.classList.contains("is-popping")) {
        cell.classList.remove("is-full");
        cell.classList.add("is-empty");
      }
    });
  }

  renderVitalCells(cells, value, maxValue) {
    const units = clamp(value / Math.max(1, maxValue) * 20, 0, 20);
    [...cells].forEach((cell, index) => {
      const filled = units - index * 2;
      cell.classList.toggle("is-full", filled >= 2);
      cell.classList.toggle("is-half", filled > 0 && filled < 2);
      cell.classList.toggle("is-empty", filled <= 0);
    });
  }

  getArmorPoints() {
    if (!this.inventory?.armorSlots) return 0;
    return Object.values(this.inventory.armorSlots)
      .reduce((sum, stack) => sum + (ITEMS[stack?.id]?.armor?.points ?? 0), 0);
  }

  addExhaustion(amount) {
    if (this.player?.mode !== "survival" || amount <= 0) return;
    this.exhaustion += amount;
    while (this.exhaustion >= HUNGER_EXHAUSTION_LIMIT) {
      this.exhaustion -= HUNGER_EXHAUSTION_LIMIT;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  heal(amount) {
    if (amount <= 0 || this.health <= 0) return;
    this.health = clamp(this.health + amount, 0, MAX_HEALTH);
    this.renderVitals();
  }

  applyDamage(amount, source = "generic", options = {}) {
    if (this.player?.mode !== "survival" || amount <= 0 || this.health <= 0) return false;
    if (!options.ignoreInvulnerability && this.damageInvulnerability > 0) return false;

    const armorReduction = clamp(this.getArmorPoints() * 0.04, 0, 0.8);
    const finalAmount = options.ignoreArmor ? amount : Math.max(0.5, amount * (1 - armorReduction));
    this.health = clamp(this.health - finalAmount, 0, MAX_HEALTH);
    this.damageInvulnerability = options.ignoreInvulnerability ? this.damageInvulnerability : DAMAGE_INVULNERABILITY_SECONDS;
    if (source !== "starvation") this.addExhaustion(0.1);
    this.triggerDamageFlash(Math.min(1.4, finalAmount / 4));
    this.renderVitals();

    if (this.health <= 0) this.showDeathScreen();
    return true;
  }

  showDeathScreen() {
    if (!this.deathScreen) return;
    this.deathScreen.hidden = false;
    if (this.survivalBars) this.survivalBars.hidden = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  respawnPlayer() {
    if (!this.player || !this.world) return;
    if (this.deathScreen) this.deathScreen.hidden = true;
    this.player.position.copy(this.world.findSpawnPoint());
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;
    this.player.landedFallDistance = 0;
    this.resetSurvivalStats();
    this.world.ensureChunksAround(this.player.position, this.renderDistance, Math.max(16, Math.ceil(this.renderDistance * 1.25)));
    this.canvas.focus({ preventScroll: true });
    this.canvas.requestPointerLock?.();
  }

  updateSurvivalStats(dt) {
    if (!this.player || this.player.mode !== "survival") {
      this.lastSurvivalPosition = this.player?.position.clone() ?? null;
      this.renderVitals();
      return;
    }

    this.damageInvulnerability = Math.max(0, this.damageInvulnerability - dt);

    // Hunger gate: can't sprint when hunger is too low
    this.player.sprintingAllowed = this.hunger > 6;

    const position = this.player.position;
    if (this.lastSurvivalPosition) {
      const dx = position.x - this.lastSurvivalPosition.x;
      const dz = position.z - this.lastSurvivalPosition.z;
      const horizontalDistance = Math.hypot(dx, dz);
      if (this.player.inWater) {
        this.addExhaustion(horizontalDistance * SWIM_EXHAUSTION_PER_METER);
      } else if (this.player.isSprinting() && horizontalDistance > 0.001) {
        this.addExhaustion(horizontalDistance * SPRINT_EXHAUSTION_PER_METER);
      } else if (horizontalDistance > 0.001) {
        this.addExhaustion(horizontalDistance * WALK_EXHAUSTION_PER_METER);
      }
    }
    this.lastSurvivalPosition = position.clone();

    if (this.player.didJumpThisFrame) {
      this.addExhaustion(this.player.didSprintJumpThisFrame ? SPRINT_JUMP_EXHAUSTION : JUMP_EXHAUSTION);
    }

    if (this.player.landedFallDistance > 3) {
      this.applyDamage(Math.floor(this.player.landedFallDistance - 3), "fall");
      this.player.landedFallDistance = 0;
    }

    this.updateAirSupply(dt);
    this.updateHazardDamage(dt);
    this.updateHungerHealth(dt);
    this.renderVitals();
  }

  updateAirSupply(dt) {
    if (this.player.eyeInWater) {
      this.airTicks = Math.max(0, this.airTicks - dt * TICKS_PER_SECOND);
      if (this.airTicks <= 0) {
        this.drownDamageTimer += dt;
        if (this.drownDamageTimer >= DROWN_DAMAGE_INTERVAL_SECONDS) {
          this.applyDamage(2, "drowning", { ignoreInvulnerability: true });
          this.drownDamageTimer = 0;
        }
      } else {
        this.drownDamageTimer = 0;
      }
      return;
    }

    this.airTicks = Math.min(MAX_AIR_TICKS, this.airTicks + dt * TICKS_PER_SECOND * 8);
    this.drownDamageTimer = 0;
  }

  updateHazardDamage(dt) {
    if (this.isPlayerTouchingBlock(Block.CACTUS)) {
      this.cactusDamageTimer += dt;
      if (this.cactusDamageTimer >= CACTUS_DAMAGE_INTERVAL_SECONDS) {
        this.applyDamage(1, "cactus");
        this.cactusDamageTimer = 0;
      }
    } else {
      this.cactusDamageTimer = CACTUS_DAMAGE_INTERVAL_SECONDS;
    }
  }

  updateHungerHealth(dt) {
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      this.healthRegenTimer += dt;
      if (this.healthRegenTimer >= HEALTH_REGEN_INTERVAL_SECONDS) {
        this.heal(1);
        this.addExhaustion(3);
        this.healthRegenTimer = 0;
      }
    } else {
      this.healthRegenTimer = 0;
    }

    if (this.hunger <= 0 && this.health > 1) {
      this.starvationTimer += dt;
      if (this.starvationTimer >= STARVATION_DAMAGE_INTERVAL_SECONDS) {
        this.applyDamage(1, "starvation", { ignoreInvulnerability: true });
        this.starvationTimer = 0;
      }
    } else {
      this.starvationTimer = 0;
    }
  }

  isPlayerTouchingBlock(targetBlock) {
    const minAabbX = this.player.position.x - PLAYER_RADIUS + PLAYER_EPSILON;
    const maxAabbX = this.player.position.x + PLAYER_RADIUS - PLAYER_EPSILON;
    const minAabbY = this.player.position.y + PLAYER_EPSILON;
    const maxAabbY = this.player.position.y + PLAYER_HEIGHT - PLAYER_EPSILON;
    const minAabbZ = this.player.position.z - PLAYER_RADIUS + PLAYER_EPSILON;
    const maxAabbZ = this.player.position.z + PLAYER_RADIUS - PLAYER_EPSILON;

    for (let x = Math.floor(minAabbX); x <= Math.floor(maxAabbX); x += 1) {
      for (let y = Math.floor(minAabbY); y <= Math.floor(maxAabbY); y += 1) {
        for (let z = Math.floor(minAabbZ); z <= Math.floor(maxAabbZ); z += 1) {
          const block = this.world.getBlock(x, y, z);
          if (block === targetBlock && blockIntersectsAabb(block, x, y, z, minAabbX, minAabbY, minAabbZ, maxAabbX, maxAabbY, maxAabbZ)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  handleWorldBlockChanged(change) {
    this.multiplayer?.recordLocalBlockChange(change);
  }

  getMultiplayerPlayerState() {
    const selected = this.getSelectedHotbarStack?.();
    const mining = Boolean(this.isMining && this.miningTarget && this.player?.mode === "survival");
    const miningProgress = mining && this.miningTarget
      ? clamp(this.miningElapsed / Math.max(0.001, getBlockBreakTime(this.raycastBlock()?.block ?? Block.AIR, selected?.slot?.id)), 0, 1)
      : 0;
    return {
      position: {
        x: this.player?.position.x ?? 0,
        y: this.player?.position.y ?? 80,
        z: this.player?.position.z ?? 0,
      },
      velocity: {
        x: this.player?.velocity.x ?? 0,
        y: this.player?.velocity.y ?? 0,
        z: this.player?.velocity.z ?? 0,
      },
      yaw: this.player?.yaw ?? 0,
      pitch: this.player?.pitch ?? 0,
      mode: this.player?.mode ?? this.selectedMode,
      onGround: Boolean(this.player?.onGround),
      inWater: Boolean(this.player?.inWater),
      heldItemId: selected?.slot?.id ?? null,
      selectedHotbar: this.selectedHotbar,
      action: {
        mining,
        using: Boolean(this.rightMouseHeld),
        swinging: Boolean(this.handSwingActive),
        swingId: this.handSwingSequence ?? 0,
        miningProgress,
      },
    };
  }

  disconnectMultiplayer(reason = "Disconnected") {
    this.multiplayer?.disconnect(reason);
    this.multiplayer = null;
  }

  openWorldCreateWindow() {
    this.closeMultiplayerWindow();
    this.worldCreateOpen = true;
    this.titleScreen.classList.add("is-creating");
    this.worldCreateWindow.hidden = false;
    this.updateSeedPreview();
    this.seedInput.focus({ preventScroll: true });
  }

  closeWorldCreateWindow() {
    this.worldCreateOpen = false;
    this.titleScreen.classList.remove("is-creating");
    this.worldCreateWindow.hidden = true;
  }

  openMultiplayerWindow() {
    this.closeWorldCreateWindow();
    this.multiplayerOpen = true;
    this.titleScreen.classList.add("is-multiplayer");
    this.multiplayerWindow.hidden = false;
    this.serverUrlInput.value = this.multiplayerUrl;
    this.playerNameInput.value = this.multiplayerName;
    this.setMultiplayerStatus("");
    this.refreshDesktopHostInfo();
    this.serverUrlInput.focus({ preventScroll: true });
  }

  closeMultiplayerWindow() {
    this.multiplayerOpen = false;
    this.titleScreen.classList.remove("is-multiplayer");
    if (this.multiplayerWindow) this.multiplayerWindow.hidden = true;
  }

  setMultiplayerStatus(text, tone = "normal") {
    if (!this.multiplayerStatusMessage) return;
    this.multiplayerStatusMessage.textContent = text;
    this.multiplayerStatusMessage.dataset.tone = tone;
  }

  async refreshDesktopHostInfo() {
    const desktop = window.voxelGroveDesktop;
    if (!desktop?.getServerInfo) {
      this.renderHostServerInfo({ running: false, unavailable: true });
      return;
    }

    try {
      this.renderHostServerInfo(await desktop.getServerInfo());
    } catch {
      this.renderHostServerInfo({ running: false });
    }
  }

  renderHostServerInfo(info = {}) {
    if (!this.hostServerButton || !this.stopHostServerButton || !this.hostAddressList) return;
    const running = Boolean(info.running);
    this.hostServerButton.hidden = running;
    this.stopHostServerButton.hidden = !running;

    if (running) {
      const friendUrls = info.lanUrls?.length ? info.lanUrls.join(" or ") : "your LAN IP with this port";
      this.hostAddressList.textContent = `You: ${info.localUrl} | Friends: ${friendUrls}`;
      if (info.localUrl) {
        this.serverUrlInput.value = info.localUrl;
        this.multiplayerUrl = info.localUrl;
      }
      return;
    }

    this.hostAddressList.textContent = info.unavailable
      ? "Built-in hosting is available in the desktop app."
      : "";
  }

  getServerPortFromInput() {
    try {
      const url = new URL(normalizeServerUrl(this.serverUrlInput.value, DEFAULT_MULTIPLAYER_URL));
      return Number(url.port) || 25565;
    } catch {
      return 25565;
    }
  }

  async startDesktopHostServer() {
    const desktop = window.voxelGroveDesktop;
    if (!desktop?.startServer) {
      this.setMultiplayerStatus("Desktop app hosting is not available in this browser window. Use npm run server.", "error");
      return;
    }

    this.setMultiplayerStatus("Starting local server...", "normal");
    try {
      const info = await desktop.startServer({
        port: this.getServerPortFromInput(),
        seed: this.currentSeedText || "0",
      });
      this.renderHostServerInfo(info);
      this.setMultiplayerStatus("Hosting is running. Click Join Server to enter.", "normal");
    } catch (error) {
      this.setMultiplayerStatus(error?.message || "Could not start hosting.", "error");
    }
  }

  async stopDesktopHostServer() {
    const desktop = window.voxelGroveDesktop;
    if (!desktop?.stopServer) return;
    try {
      const info = await desktop.stopServer();
      this.renderHostServerInfo(info);
      this.setMultiplayerStatus("Hosting stopped.", "normal");
    } catch (error) {
      this.setMultiplayerStatus(error?.message || "Could not stop hosting.", "error");
    }
  }

  beginMultiplayerWorld() {
    if (this.started || this.loadingWorld) return;
    const url = normalizeServerUrl(this.serverUrlInput.value, DEFAULT_MULTIPLAYER_URL);
    const playerName = sanitizePlayerName(this.playerNameInput.value, this.multiplayerName);
    this.multiplayerUrl = url;
    this.multiplayerName = playerName;
    localStorage.setItem(MULTIPLAYER_URL_STORAGE_KEY, url);
    localStorage.setItem(MULTIPLAYER_NAME_STORAGE_KEY, playerName);
    this.serverUrlInput.value = url;
    this.playerNameInput.value = playerName;
    this.setMultiplayerStatus("Connecting...", "normal");

    this.disconnectMultiplayer("Joining another server");
    const client = new MultiplayerClient(this, { url, playerName });
    this.multiplayer = client;

    client.connect()
      .then((welcome) => this.beginLoadingMultiplayerWorld(client, welcome))
      .catch((error) => {
        if (this.multiplayer === client) this.multiplayer = null;
        this.setMultiplayerStatus(error?.message || "Could not connect.", "error");
      });
  }

  beginLoadingMultiplayerWorld(client, welcome) {
    if (this.multiplayer !== client) return;
    const seed = String(welcome.seed ?? "0");
    this.loadingWorld = true;
    this.closeMultiplayerWindow();
    this.loadingTargetRadius = Math.min(Math.max(SPAWN_LOADING_RADIUS, SPAWN_READY_RADIUS), this.renderDistance);
    this.loadingReadyRadius = Math.min(SPAWN_READY_RADIUS, this.loadingTargetRadius);
    this.loadingReady = 0;
    this.loadingTotal = (this.loadingTargetRadius * 2 + 1) ** 2;
    this.loadingStartedAt = performance.now();
    this.inventory = new Inventory();
    this.allowCheats = false;
    this.paused = false;
    this.pauseOverlay.hidden = true;
    this.closeSettingsWindow();
    this.loadingOverlay.hidden = false;
    this.updateLoadingUi();
    this.loadingPendingReset = true;

    requestAnimationFrame(() => {
      if (!this.loadingWorld || this.multiplayer !== client) return;
      this.currentSeedText = seed;
      this.resetWorld(seed, this.selectedMode, this.loadingTargetRadius, 0);
      client.attachWorld(this.world);
      this.renderInventory();
      this.loadingPendingReset = false;
    });
  }

  updateMultiplayerStatusLine(baseText) {
    const label = this.multiplayer?.connected ? this.multiplayer.getStatusLabel() : null;
    return label ? `${baseText} | Server ${label}` : baseText;
  }

  prepareWorldSeed() {
    const seed = this.seedInput.value.trim() ? normalizeWorldSeedText(this.seedInput.value) : randomMinecraftSeedText();
    this.seedInput.value = seed;
    this.currentSeedText = seed;
    this.updateSeedPreview();
    return seed;
  }

  updateSeedPreview() {
    if (!this.seedPreview) return;
    const seed = this.seedInput.value.trim();
    this.seedPreview.textContent = seed ? `Seed ${formatSeedPreview(seed)}` : "Random seed";
  }

  openPauseMenu() {
    if (!this.started || this.inventoryOpen || this.chatOpen) return;
    this.paused = true;
    this.stopMining();
    this.hidePlayerList();
    this.player.keys.clear();
    this.pauseOverlay.hidden = false;
    this.pauseNote.classList.remove("is-visible");
    this.updateSettingsUi();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  resumeGame() {
    if (!this.started) return;
    this.paused = false;
    this.pauseOverlay.hidden = true;
    if (!this.inventoryOpen && !this.chatOpen) this.canvas.requestPointerLock();
  }

  openSettingsWindow() {
    this.settingsOpen = true;
    this.settingsOverlay.hidden = false;
    this.settingsButton.setAttribute("aria-expanded", "true");
    this.updateSettingsUi();
  }

  closeSettingsWindow() {
    this.settingsOpen = false;
    this.settingsOverlay.hidden = true;
    this.settingsButton.setAttribute("aria-expanded", "false");
  }

  openChat(prefill = "") {
    if (!this.started || this.paused || this.inventoryOpen || this.settingsOpen) return;
    this.chatOpen = true;
    this.stopMining();
    this.hidePlayerList();
    this.player.keys.clear();
    this.chatPanel.classList.add("is-open");
    this.chatForm.hidden = false;
    this.chatInput.value = prefill;
    this.updateChatSuggestions();
    this.updateChatMessageVisibility();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    requestAnimationFrame(() => {
      this.chatInput.focus({ preventScroll: true });
      this.chatInput.setSelectionRange(this.chatInput.value.length, this.chatInput.value.length);
    });
  }

  closeChat(options = {}) {
    const refocus = options.refocus ?? true;
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatPanel.classList.remove("is-open");
    this.chatForm.hidden = true;
    this.chatSuggestionsElement.hidden = true;
    this.chatSuggestions = [];
    this.chatInput.blur();
    if (refocus && this.started && !this.paused && !this.inventoryOpen && !this.settingsOpen) {
      this.canvas.requestPointerLock();
    }
    this.updateChatMessageVisibility();
  }

  showPlayerList() {
    if (!this.started || !this.playerListOverlay) return;
    this.playerListVisible = true;
    this.playerListOverlay.hidden = false;
    this.renderPlayerList();
  }

  hidePlayerList() {
    this.playerListVisible = false;
    if (this.playerListOverlay) this.playerListOverlay.hidden = true;
  }

  renderPlayerList() {
    if (!this.playerListRows || !this.playerListCount) return;
    const players = this.getVisiblePlayerList();
    this.playerListCount.textContent = `${players.length} online`;
    this.playerListRows.innerHTML = "";

    for (const player of players) {
      const row = document.createElement("div");
      row.className = "player-list-row";
      row.classList.toggle("is-self", Boolean(player.isSelf));
      row.classList.toggle("is-op", Boolean(player.isOp));
      row.innerHTML = `
        <span class="player-list-name"></span>
        <span class="player-list-badges"></span>
        <span class="player-list-mode"></span>
      `;
      row.querySelector(".player-list-name").textContent = player.name;
      const badges = row.querySelector(".player-list-badges");
      if (player.isSelf) {
        const badge = document.createElement("span");
        badge.className = "player-list-badge";
        badge.textContent = "You";
        badges.append(badge);
      }
      if (player.isOp) {
        const badge = document.createElement("span");
        badge.className = "player-list-badge player-list-badge-op";
        badge.textContent = "OP";
        badges.append(badge);
      }
      row.querySelector(".player-list-mode").textContent = gameModeLabel(player.mode ?? "survival");
      this.playerListRows.append(row);
    }
  }

  getVisiblePlayerList() {
    if (this.multiplayer?.connected) {
      const ownId = this.multiplayer.clientId;
      return this.multiplayer.getPlayerList().map((player) => ({
        ...player,
        isSelf: player.id === ownId,
      }));
    }

    return [{
      id: "local",
      name: this.multiplayerName || "Player",
      mode: this.player?.mode ?? this.selectedMode,
      isOp: this.canUseCheatCommands(),
      isSelf: true,
    }];
  }

  updateChatSuggestions() {
    this.chatSuggestions = getChatSuggestions(this.chatInput.value, this.canUseCheatCommands());
    this.chatSuggestionIndex = clamp(this.chatSuggestionIndex, 0, Math.max(0, this.chatSuggestions.length - 1));
    this.renderChatSuggestions();
  }

  renderChatSuggestions() {
    this.chatSuggestionsElement.innerHTML = "";
    this.chatSuggestionsElement.hidden = this.chatSuggestions.length === 0;
    this.chatSuggestions.forEach((suggestion, index) => {
      const item = document.createElement("button");
      item.className = "chat-suggestion";
      item.type = "button";
      item.dataset.index = String(index);
      item.classList.toggle("is-selected", index === this.chatSuggestionIndex);
      item.innerHTML = `<span class="chat-suggestion-label"></span><span class="chat-suggestion-detail"></span>`;
      item.querySelector(".chat-suggestion-label").textContent = suggestion.label;
      item.querySelector(".chat-suggestion-detail").textContent = suggestion.detail;
      this.chatSuggestionsElement.append(item);
    });
  }

  handleChatSuggestionKey(event) {
    if (event.code === "Tab") {
      if (this.chatSuggestions.length === 0) this.updateChatSuggestions();
      if (this.chatSuggestions.length > 0) {
        event.preventDefault();
        this.applyChatSuggestion(this.chatSuggestionIndex);
      }
      return;
    }

    if (event.code === "ArrowDown" && this.chatSuggestions.length > 0) {
      event.preventDefault();
      this.chatSuggestionIndex = (this.chatSuggestionIndex + 1) % this.chatSuggestions.length;
      this.renderChatSuggestions();
      return;
    }

    if (event.code === "ArrowUp" && this.chatSuggestions.length > 0) {
      event.preventDefault();
      this.chatSuggestionIndex = mod(this.chatSuggestionIndex - 1, this.chatSuggestions.length);
      this.renderChatSuggestions();
    }
  }

  applyChatSuggestion(index) {
    const suggestion = this.chatSuggestions[index];
    if (!suggestion) return;
    this.chatInput.value = suggestion.completion;
    this.chatInput.focus({ preventScroll: true });
    this.chatInput.setSelectionRange(this.chatInput.value.length, this.chatInput.value.length);
    this.updateChatSuggestions();
  }

  submitChat() {
    const text = this.chatInput.value.trim();
    if (!text) {
      this.closeChat();
      return;
    }

    if (text.startsWith("/")) {
      const commandLine = text.slice(1);
      const command = commandLine.trim().split(/\s+/)[0]?.toLowerCase();
      if (this.multiplayer?.connected && command !== "clear") {
        this.multiplayer.sendCommand(commandLine);
      } else {
        this.executeChatCommand(commandLine);
      }
    } else if (this.multiplayer?.connected) {
      this.multiplayer.sendChat(text);
    } else {
      this.addChatMessage(`Player: ${text}`);
    }
    this.closeChat();
  }

  addChatMessage(text, type = "player") {
    this.chatMessages.push({ text, type, createdAt: performance.now() });
    this.chatMessages = this.chatMessages.slice(-8);
    this.renderChatMessages();
    this.updateChatMessageVisibility();
  }

  renderChatMessages() {
    this.chatMessagesElement.innerHTML = "";
    for (const message of this.chatMessages) {
      const line = document.createElement("div");
      line.className = `chat-line ${message.type === "system" ? "is-system" : ""}`;
      line.textContent = message.text;
      line.dataset.createdAt = String(message.createdAt ?? performance.now());
      this.chatMessagesElement.append(line);
    }
  }

  updateChatMessageVisibility() {
    const now = performance.now();
    for (const line of this.chatMessagesElement.children) {
      if (this.chatOpen) {
        line.style.opacity = "1";
        continue;
      }

      const createdAt = Number(line.dataset.createdAt ?? now);
      const ageSeconds = (now - createdAt) / 1000;
      const fade = clamp((ageSeconds - CHAT_FADE_AFTER_SECONDS) / CHAT_FADE_DURATION_SECONDS, 0, 1);
      line.style.opacity = String(1 - fade);
    }
  }

  executeChatCommand(commandLine) {
    const parts = commandLine.trim().split(/\s+/).filter(Boolean);
    const command = parts.shift()?.toLowerCase();
    if (!command) return;

    if (command === "help") {
      this.showHelp();
      return;
    }

    if (command === "clear") {
      this.chatMessages = [];
      this.renderChatMessages();
      return;
    }

    if (!this.canUseCheatCommands() && isCheatCommand(command)) {
      this.addChatMessage("Cheats are not enabled in this world.", "system");
      return;
    }

    if (command === "seed") {
      this.addChatMessage(`Seed: ${this.currentSeedText} (${this.world.seed})`, "system");
      return;
    }

    if (command === "gamemode" || command === "gm") {
      const mode = parseGameMode(parts[0]);
      if (!mode) {
        this.addChatMessage("Usage: /gamemode <survival|creative|spectator>", "system");
        return;
      }
      this.setPlayerMode(mode);
      return;
    }

    if (command === "time") {
      this.executeTimeCommand(parts);
      return;
    }

    if (command === "weather") {
      this.executeWeatherCommand(parts);
      return;
    }

    if (command === "locatebiome" || command === "locate") {
      this.executeLocateBiomeCommand(command, parts);
      return;
    }

    if (command === "fly") {
      if (this.player.mode !== "creative") {
        this.addChatMessage("Fly is available in Creative.", "system");
        return;
      }
      this.player.isFlying = !this.player.isFlying;
      this.player.velocity.y = 0;
      this.addChatMessage(`Flying ${this.player.isFlying ? "enabled" : "disabled"}`, "system");
      return;
    }

    if (command === "tp") {
      const next = parseTeleport(parts, this.player.position);
      if (!next) {
        this.addChatMessage("Usage: /tp <x> <y> <z>", "system");
        return;
      }
      this.player.position.copy(next);
      this.player.velocity.set(0, 0, 0);
      this.world.ensureChunksAround(this.player.position, this.renderDistance, Math.max(16, Math.ceil(this.renderDistance * 1.25)));
      this.addChatMessage(`Teleported to ${Math.round(next.x)} ${Math.round(next.y)} ${Math.round(next.z)}`, "system");
      return;
    }

    if (command === "give") {
      const itemId = normalizeItemId(parts[0]);
      const requestedCount = Number(parts[1] ?? 64);
      const count = Number.isFinite(requestedCount) ? clamp(Math.floor(requestedCount), 1, 64) : 64;
      if (!itemId || !ITEMS[itemId]) {
        this.addChatMessage("Usage: /give <item> [count]", "system");
        return;
      }
      const remaining = this.inventory.addItem(itemId, count);
      const added = count - remaining;
      this.renderInventory();
      this.addChatMessage(`Gave ${added} ${ITEMS[itemId].name}`, "system");
      return;
    }

    if (command === "summon") {
      this.executeSummonCommand(parts);
      return;
    }

    this.addChatMessage(`Unknown command: /${command}`, "system");
  }

  executeServerAdminCommand(commandLine, source = "Server") {
    const text = String(commandLine ?? "").replace(/^\//, "").trim();
    if (!text) return;
    const previousAllowCheats = this.allowCheats;
    this.allowCheats = true;
    this.executeChatCommand(text);
    this.allowCheats = previousAllowCheats;
    this.multiplayer?.sendPlayerState(true);
  }

  executeSummonCommand(parts) {
    const entityId = normalizeEntityId(parts[0]);
    if (!entityId || !MOB_CLASSES[entityId]) {
      this.addChatMessage("Usage: /summon <chicken|pig|cow> [x y z]", "system");
      return;
    }

    const positionParts = parts.slice(1);
    const position = parseOptionalPosition(positionParts, this.player.position);
    if (!position) {
      this.addChatMessage("Usage: /summon <entity> [x y z]", "system");
      return;
    }

    position.y = clamp(position.y, 1, WORLD_HEIGHT - 2);
    const mob = this.spawnMob(entityId, position);
    if (!mob) {
      this.addChatMessage(`Could not summon ${entityId}`, "system");
      return;
    }
    mob.yaw = this.player.yaw + Math.PI;
    mob.targetYaw = mob.yaw;
    mob.applyTransform();
    this.addChatMessage(`Summoned ${entityId}`, "system");
  }

  executeLocateBiomeCommand(command, parts) {
    const biomeParts = command === "locate" && parts[0]?.toLowerCase() === "biome" ? parts.slice(1) : parts;
    const locateParts = [...biomeParts];
    let maxRadius = LOCATE_BIOME_DEFAULT_RADIUS;
    const radiusToken = locateParts[locateParts.length - 1];
    if (/^\d+$/.test(radiusToken ?? "")) {
      maxRadius = clamp(Number(radiusToken), LOCATE_BIOME_NEAR_STEP, LOCATE_BIOME_MAX_RADIUS);
      locateParts.pop();
    }
    const biomeId = normalizeBiomeId(locateParts.join(" "));
    if (!biomeId) {
      this.addChatMessage("Usage: /locatebiome <biome> [radius]", "system");
      return;
    }

    const biomeName = BIOMES[biomeId].name;
    const found = this.findNearestBiome(biomeId, maxRadius);
    if (!found) {
      this.addChatMessage(`Could not find ${biomeName} within ${maxRadius.toLocaleString()} blocks`, "system");
      return;
    }

    this.addChatMessage(`Nearest ${biomeName}: ${found.x} ${found.y} ${found.z} (${found.distance} blocks)`, "system");
  }

  findNearestBiome(biomeId, maxRadius = LOCATE_BIOME_DEFAULT_RADIUS) {
    const originX = Math.floor(this.player.position.x);
    const originZ = Math.floor(this.player.position.z);
    const radiusLimit = clamp(Math.floor(maxRadius), LOCATE_BIOME_NEAR_STEP, LOCATE_BIOME_MAX_RADIUS);
    const maxRadiusSq = radiusLimit * radiusLimit;
    let best = null;

    const sample = (x, z) => {
      const dx = x - originX;
      const dz = z - originZ;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > maxRadiusSq) return;
      if (this.world.biomeAt(x, z) !== biomeId) return;
      if (best && distanceSq >= best.distanceSq) return;
      best = {
        x,
        y: this.world.terrainHeight(x, z) + 1,
        z,
        distanceSq,
      };
    };

    const refineAroundBest = (coarseStep) => {
      if (!best) return;
      const centerX = best.x;
      const centerZ = best.z;
      const refineRadius = Math.max(48, coarseStep * 2);
      for (let z = centerZ - refineRadius; z <= centerZ + refineRadius; z += LOCATE_BIOME_REFINE_STEP) {
        for (let x = centerX - refineRadius; x <= centerX + refineRadius; x += LOCATE_BIOME_REFINE_STEP) {
          sample(x, z);
        }
      }
    };

    const finish = (coarseStep) => {
      refineAroundBest(coarseStep);
      return { ...best, distance: Math.round(Math.sqrt(best.distanceSq)) };
    };

    const searchBand = (fromRadius, toRadius, step) => {
      const limit = Math.min(radiusLimit, toRadius);
      if (limit < step) return false;
      const start = Math.max(step, Math.ceil(fromRadius / step) * step);
      for (let radius = start; radius <= limit; radius += step) {
        for (let offset = -radius; offset <= radius; offset += step) {
          sample(originX + offset, originZ - radius);
          sample(originX + offset, originZ + radius);
          sample(originX - radius, originZ + offset);
          sample(originX + radius, originZ + offset);
        }
        if (best) return true;
      }
      return false;
    };

    sample(originX, originZ);
    if (best) return finish(LOCATE_BIOME_REFINE_STEP);

    if (searchBand(0, LOCATE_BIOME_NEAR_RADIUS, LOCATE_BIOME_NEAR_STEP)) return finish(LOCATE_BIOME_NEAR_STEP);
    if (searchBand(LOCATE_BIOME_NEAR_RADIUS + 1, LOCATE_BIOME_MID_RADIUS, LOCATE_BIOME_MID_STEP)) return finish(LOCATE_BIOME_MID_STEP);
    if (searchBand(LOCATE_BIOME_MID_RADIUS + 1, radiusLimit, LOCATE_BIOME_FAR_STEP)) return finish(LOCATE_BIOME_FAR_STEP);

    return null;
  }

  executeTimeCommand(parts) {
    const action = String(parts[0] ?? "").toLowerCase();
    if (action === "query") {
      this.addChatMessage(`Day time is ${Math.floor(this.timeOfDay)}`, "system");
      return;
    }
    if (action === "set") {
      const ticks = parseTimeValue(parts[1]);
      if (ticks === null) {
        this.addChatMessage("Usage: /time set <day|noon|night|midnight|ticks>", "system");
        return;
      }
      this.setTimeOfDay(ticks);
      return;
    }
    if (action === "add") {
      const ticks = Number(parts[1]);
      if (!Number.isFinite(ticks)) {
        this.addChatMessage("Usage: /time add <ticks>", "system");
        return;
      }
      this.addTime(ticks);
      return;
    }
    this.addChatMessage("Usage: /time <set|add|query> <value>", "system");
  }

  executeWeatherCommand(parts) {
    if (parts[0] === undefined) {
      const remaining = Math.ceil(this.weatherTimer);
      const biome = this.world && this.player
        ? this.world.biomeAt(Math.floor(this.player.position.x), Math.floor(this.player.position.z))
        : null;
      const precipType = this.weather !== "clear" && biome && this.isSnowingAt(
        Math.floor(this.player?.position.x ?? 0),
        Math.floor(this.player?.position.z ?? 0),
      ) ? "Snow" : weatherLabel(this.weather);
      this.addChatMessage(`Weather: ${precipType} — ${remaining}s remaining`, "system");
      return;
    }
    const weather = parseWeatherType(parts[0]);
    const duration = parts[1] === undefined ? null : Number(parts[1]);
    if (!weather || (parts[1] !== undefined && !Number.isFinite(duration))) {
      this.addChatMessage("Usage: /weather [clear|rain|thunder] [seconds]", "system");
      return;
    }
    this.setWeather(weather, duration);
  }

  canUseCheatCommands() {
    return this.allowCheats || Boolean(this.multiplayer?.isOp);
  }

  showHelp() {
    this.chatMessages = [];
    this.renderChatMessages();
    this.addChatMessage(this.canUseCheatCommands() ? "Commands:" : "Commands: cheats disabled", "system");
    for (const command of getAvailableChatCommandDefinitions(this.canUseCheatCommands())) {
      const aliases = command.aliases?.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : "";
      this.addChatMessage(`${command.usage}${aliases} - ${command.description}`, "system");
    }
  }

  setPlayerMode(mode) {
    const nextMode = parseGameMode(mode);
    if (!nextMode || !this.player) return false;
    this.player.mode = nextMode;
    this.player.velocity.set(0, 0, 0);
    this.player.isFlying = nextMode === "spectator" || (nextMode === "creative" && this.player.isFlying);
    if (nextMode === "survival") this.player.isFlying = false;
    if (nextMode === "spectator") {
      this.player.inWater = false;
      this.player.eyeInWater = false;
      this.updateUnderwaterView();
    }
    this.stopMining();
    if (nextMode !== "spectator") this.setSelectedMode(nextMode);
    this.applyVisionMode();
    this.renderInventory();
    this.renderVitals();
    this.multiplayer?.sendPlayerState(true);
    this.renderPlayerList();
    this.addChatMessage(`Set own game mode to ${gameModeLabel(nextMode)}`, "system");
    return true;
  }

  applyVisionMode() {
    const nightVision = Boolean(this.player?.mode === "spectator");
    if (nightVision === this.nightVisionActive) return;

    this.nightVisionActive = nightVision;
    fullBrightLightingEnabled = nightVision;
    this.renderer.toneMappingExposure = nightVision ? NIGHT_VISION_TONE_MAPPING_EXPOSURE : BASE_TONE_MAPPING_EXPOSURE;
    WORLD_MATERIAL.emissiveIntensity = 0;
    LEAF_MATERIAL.emissiveIntensity = 0;
    WATER_MATERIAL.emissiveIntensity = 0;
    this.updateSkyCycle(0);
    this.updateFogForView();
    if (this.world) {
      this.world.markAllChunksDirty();
      if (this.player) {
        const activeRenderDistance = this.started ? this.renderDistance : TITLE_RENDER_DISTANCE;
        this.world.ensureChunksAround(this.player.position, activeRenderDistance, Math.max(16, Math.ceil(activeRenderDistance * 1.25)));
      }
    }
  }

  loadGraphicsSettings() {
    const settings = readGraphicsSettings();
    this.resolutionPreset = resolveResolutionPresetId(settings.resolutionPreset);
    this.renderDistance = Math.round(savedNumber(settings.renderDistance, this.renderDistance, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE));
    this.fieldOfView = Math.round(savedNumber(settings.fieldOfView, this.fieldOfView, 55, 95));
    this.mouseSensitivity = savedNumber(settings.mouseSensitivity, this.mouseSensitivity, 0.4, 1.8);
    this.smoothLightingEnabled = savedBoolean(settings.smoothLighting, this.smoothLightingEnabled);
    this.shadowsEnabled = savedBoolean(settings.shadows, this.shadowsEnabled);
    this.cloudsEnabled = savedBoolean(settings.clouds, this.cloudsEnabled);
    this.depthOfFieldEnabled = savedBoolean(settings.depthOfField, this.depthOfFieldEnabled);
    this.antialiasEnabled = savedBoolean(settings.antialiasing, this.antialiasEnabled);
    this.anisotropicEnabled = savedBoolean(settings.anisotropic, this.anisotropicEnabled);
    this.chromaticAberrationEnabled = savedBoolean(settings.chromaticAberration, this.chromaticAberrationEnabled);
    this.bloomEnabled = savedBoolean(settings.bloom, this.bloomEnabled);
    smoothLightingEnabled = this.smoothLightingEnabled;
  }

  saveGraphicsSettings() {
    writeGraphicsSettings({
      resolutionPreset: this.resolutionPreset,
      renderDistance: this.renderDistance,
      fieldOfView: this.fieldOfView,
      mouseSensitivity: this.mouseSensitivity,
      smoothLighting: this.smoothLightingEnabled,
      shadows: this.shadowsEnabled,
      clouds: this.cloudsEnabled,
      depthOfField: this.depthOfFieldEnabled,
      antialiasing: this.antialiasEnabled,
      anisotropic: this.anisotropicEnabled,
      chromaticAberration: this.chromaticAberrationEnabled,
      bloom: this.bloomEnabled,
    });
  }

  applyResolutionToDesktopWindow() {
    const desktopApi = window.voxelGroveDesktop;
    if (!desktopApi?.setResolution) return;
    desktopApi.setResolution(this.resolutionPreset).catch((error) => {
      console.warn("Could not apply desktop resolution", error);
    });
  }

  updateSettingsUi() {
    this.renderDistanceInput.value = String(this.renderDistance);
    this.renderDistanceValue.textContent = `${this.renderDistance} chunks`;
    this.fovInput.value = String(this.fieldOfView);
    this.fovValue.textContent = String(this.fieldOfView);
    this.sensitivityInput.value = String(Math.round(this.mouseSensitivity * 100));
    this.sensitivityValue.textContent = `${Math.round(this.mouseSensitivity * 100)}%`;
    const resolution = RESOLUTION_PRESET_BY_ID.get(this.resolutionPreset) ?? RESOLUTION_PRESET_BY_ID.get(DEFAULT_RESOLUTION_PRESET);
    this.resolutionSelect.value = resolution.id;
    this.resolutionValue.textContent = resolution.label;
    this.smoothLightingInput.checked = this.smoothLightingEnabled;
    this.shadowInput.checked = this.shadowsEnabled;
    this.cloudInput.checked = this.cloudsEnabled;
    if (this.dofInput) this.dofInput.checked = this.depthOfFieldEnabled;
    if (this.antialiasInput) this.antialiasInput.checked = this.antialiasEnabled;
    if (this.anisotropicInput) this.anisotropicInput.checked = this.anisotropicEnabled;
    if (this.chromaticAberrationInput) this.chromaticAberrationInput.checked = this.chromaticAberrationEnabled;
    if (this.bloomInput) this.bloomInput.checked = this.bloomEnabled;
  }

  setResolutionPreset(presetId) {
    const resolution = RESOLUTION_PRESET_BY_ID.get(presetId) ?? RESOLUTION_PRESET_BY_ID.get(DEFAULT_RESOLUTION_PRESET);
    this.resolutionPreset = resolution.id;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
    this.applyResolutionToDesktopWindow();
  }

  updateShadowCameraForRenderDistance() {
    if (!this.sun?.shadow?.camera) return;
    const radius = clamp(
      this.renderDistance * CHUNK_SIZE + SHADOW_VIEW_PADDING,
      MIN_SHADOW_VIEW_RADIUS,
      MAX_SHADOW_VIEW_RADIUS,
    );
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.far = Math.max(260, radius * 2.4);
    camera.updateProjectionMatrix();
  }

  applyRenderDistanceEffects({ updateWorld = true } = {}) {
    const chunkReach = this.renderDistance * CHUNK_SIZE;
    const fogFar = Math.max(28, chunkReach - 2);
    const fogNear = Math.max(8, Math.round(fogFar * 0.72));
    this.defaultFog.near = fogNear;
    this.defaultFog.far = fogFar;
    this.updateFogForView();
    this.updateShadowCameraForRenderDistance();
    // FIX: camera.far must always cover the cloud grid radius regardless of
    // chunk-render distance, otherwise clouds disappear when the user lowers
    // their render distance (they were "tied to chunk distance" before).
    const cloudReach = (CLOUD_GRID_RADIUS + 1) * CLOUD_TILE_SIZE + 200;
    this.camera.far = Math.max(360, fogFar + 140, cloudReach);
    this.camera.updateProjectionMatrix();
    if (updateWorld && this.world && this.player) {
      this.world.ensureChunksAround(this.player.position, this.renderDistance, Math.max(10, Math.ceil(this.renderDistance * 1.2)), {
        leadChunks: CHUNK_BACKGROUND_PREFETCH_RING,
      });
    }
  }

  setRenderDistance(distance) {
    this.renderDistance = clamp(Math.round(distance), MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE);
    this.updateSettingsUi();
    this.saveGraphicsSettings();
    this.applyRenderDistanceEffects();
  }

  setFieldOfView(value) {
    this.fieldOfView = clamp(Math.round(value), 55, 95);
    this.camera.fov = this.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setMouseSensitivity(value) {
    this.mouseSensitivity = clamp(Math.round(value), 40, 180) / 100;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setSmoothLighting(enabled) {
    this.smoothLightingEnabled = Boolean(enabled);
    smoothLightingEnabled = this.smoothLightingEnabled;
    if (this.world && this.player) {
      this.world.markAllChunksDirty();
      const activeRenderDistance = this.started ? this.renderDistance : TITLE_RENDER_DISTANCE;
      this.world.ensureChunksAround(this.player.position, activeRenderDistance, Math.max(16, Math.ceil(activeRenderDistance * 1.25)));
    }
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setShadows(enabled) {
    this.shadowsEnabled = Boolean(enabled);
    this.renderer.shadowMap.enabled = this.shadowsEnabled && TERRAIN_DYNAMIC_SHADOWS;
    this.sun.castShadow = this.shadowsEnabled && TERRAIN_DYNAMIC_SHADOWS;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setClouds(enabled) {
    this.cloudsEnabled = Boolean(enabled);
    if (this.clouds) this.clouds.visible = this.cloudsEnabled;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setDepthOfField(enabled) {
    this.depthOfFieldEnabled = Boolean(enabled);
    if (this.bokehPass) this.bokehPass.enabled = this.depthOfFieldEnabled;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setAntialiasing(enabled) {
    this.antialiasEnabled = Boolean(enabled);
    if (this.smaaPass) this.smaaPass.enabled = this.antialiasEnabled;
    this.updatePostProcessingSamples();
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setAnisotropic(enabled) {
    this.anisotropicEnabled = Boolean(enabled);
    this.configureTextureQuality();
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setChromaticAberration(enabled) {
    this.chromaticAberrationEnabled = Boolean(enabled);
    if (this.chromaticAberrationPass) this.chromaticAberrationPass.enabled = this.chromaticAberrationEnabled;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  setBloom(enabled) {
    this.bloomEnabled = Boolean(enabled);
    if (this.bloomPass) this.bloomPass.enabled = this.bloomEnabled;
    this.updateSettingsUi();
    this.saveGraphicsSettings();
  }

  updateTimeAndWeather(dt) {
    const gameTicks = dt * TICKS_PER_SECOND;
    this.timeOfDay = mod(this.timeOfDay + gameTicks, MINECRAFT_DAY_TICKS);
    this.worldAgeTicks += gameTicks;

    this.weatherTimer -= dt;
    if (this.weatherTimer > 0) return;

    if (this.weather === "clear") {
      this.setWeather(Math.random() < 0.16 ? "thunder" : "rain", randomRange(WEATHER_RAIN_MIN_SECONDS, WEATHER_RAIN_MAX_SECONDS), false);
    } else {
      this.setWeather("clear", randomRange(WEATHER_CLEAR_MIN_SECONDS, WEATHER_CLEAR_MAX_SECONDS), false);
    }
  }

  setTimeOfDay(ticks, announce = true) {
    this.timeOfDay = mod(Math.floor(ticks), MINECRAFT_DAY_TICKS);
    const day = Math.floor(this.worldAgeTicks / MINECRAFT_DAY_TICKS);
    this.worldAgeTicks = day * MINECRAFT_DAY_TICKS + this.timeOfDay;
    this.updateSkyCycle(0);
    if (announce) this.addChatMessage(`Set the time to ${Math.floor(this.timeOfDay)}`, "system");
  }

  addTime(ticks, announce = true) {
    const amount = Math.floor(ticks);
    this.timeOfDay = mod(this.timeOfDay + amount, MINECRAFT_DAY_TICKS);
    this.worldAgeTicks += amount;
    this.updateSkyCycle(0);
    if (announce) this.addChatMessage(`Added ${amount} ticks to the time`, "system");
  }

  setWeather(weather, durationSeconds = null, announce = true) {
    const nextWeather = parseWeatherType(weather);
    if (!nextWeather) return false;
    const fallback = nextWeather === "clear"
      ? randomRange(WEATHER_CLEAR_MIN_SECONDS, WEATHER_CLEAR_MAX_SECONDS)
      : randomRange(WEATHER_RAIN_MIN_SECONDS, WEATHER_RAIN_MAX_SECONDS);
    const wasWeather = this.weather;
    this.weather = nextWeather;
    this.weatherTimer = durationSeconds === null ? fallback : clamp(Number(durationSeconds), 1, 60 * 60);
    // Reset thunder timer when entering a thunderstorm
    if (nextWeather === "thunder") {
      this.thunderTimer = randomRange(2, 8);
    }
    // If transitioning to clear, let fade-out handle it (don't hard-reset strength)
    if (nextWeather !== "clear" && wasWeather === "clear") {
      this.precipitationStrength = announce ? 1 : 0.18;
    }
    this.updateSkyCycle(0);
    this.updatePrecipitation(0);
    if (announce) this.addChatMessage(`Weather changed to ${weatherLabel(nextWeather)}`, "system");
    return true;
  }

  updateSkyCycle(dt) {
    const phase = this.timeOfDay / MINECRAFT_DAY_TICKS;
    const solarAngle = (phase - 0.25) * Math.PI * 2;
    const sunDirection = new THREE.Vector3(Math.sin(solarAngle), Math.cos(solarAngle), 0).normalize();
    const moonDirection = sunDirection.clone().multiplyScalar(-1);
    const daylight = smoothstep(-0.08, 0.22, sunDirection.y);
    const night = 1 - daylight;
    this.skyNightFactor = night;
    const weatherDim = this.weather === "clear" ? 1 : (this.weather === "thunder" ? 0.28 : 0.56);
    const visibleLight = this.nightVisionActive ? 1 : lerp(0.025, 1, daylight) * weatherDim;
    this.skyLightFactor = visibleLight;

    const dayTop = new THREE.Color(0x78a7d8);
    const dayHorizon = new THREE.Color(0xc4d9e8);
    const nightTop = new THREE.Color(0x03070d);
    const nightHorizon = new THREE.Color(0x080f18);
    const rainTop = new THREE.Color(0x516675).lerp(new THREE.Color(0x02050a), night);
    const rainHorizon = new THREE.Color(0x83919a).lerp(new THREE.Color(0x050b16), night);
    const thunderTop = new THREE.Color(0x1d2730).lerp(new THREE.Color(0x02050b), night);
    const thunderHorizon = new THREE.Color(0x313b44).lerp(new THREE.Color(0x040812), night);
    const weatherTop = this.weather === "thunder" ? thunderTop : rainTop;
    const weatherHorizon = this.weather === "thunder" ? thunderHorizon : rainHorizon;
    const stormMix = this.weather === "clear" ? 0 : (this.weather === "thunder" ? 0.98 : 0.78);
    const topColor = dayTop.clone().lerp(nightTop, night).lerp(weatherTop, stormMix);
    const horizonColor = dayHorizon.clone().lerp(nightHorizon, night).lerp(weatherHorizon, stormMix);
    const weatherGround = this.weather === "thunder"
      ? new THREE.Color(0x1d262e).lerp(new THREE.Color(0x010205), night)
      : new THREE.Color(0x546266).lerp(new THREE.Color(0x020409), night);
    const groundColor = new THREE.Color(0xd1cab0).lerp(new THREE.Color(0x010305), night).lerp(weatherGround, stormMix);

    // Sunset/sunrise horizon tint — peaks when sun is near the horizon
    const sunsetFactor = smoothstep(0, 0.22, daylight) * (1 - smoothstep(0.22, 0.58, daylight)) * (1 - stormMix);
    horizonColor.lerp(new THREE.Color(0xe89552), sunsetFactor * 0.28);
    topColor.lerp(new THREE.Color(0xc87848), sunsetFactor * 0.08);

    this.skyMaterial.uniforms.topColor.value.copy(topColor);
    this.skyMaterial.uniforms.horizonColor.value.copy(horizonColor);
    this.skyMaterial.uniforms.groundColor.value.copy(groundColor);
    this.skyMaterial.uniforms.sunDirection.value.copy(sunDirection);
    this.skyMaterial.uniforms.daylight.value = daylight;

    const daylightIntensity = lerp(0, 2.62, Math.pow(daylight, 0.82)) * weatherDim;
    const moonlightIntensity = smoothstep(-0.04, 0.32, moonDirection.y) * (this.weather === "clear" ? 0.08 : (this.weather === "thunder" ? 0.015 : 0.03));
    const useMoonLight = moonlightIntensity > daylightIntensity && daylight < 0.14;
    const activeLightDirection = useMoonLight ? moonDirection : sunDirection;
    const targetSource = this.player?.position ?? this.camera.position;
    const shadowSpan = this.sun.shadow.camera.right - this.sun.shadow.camera.left;
    const shadowMapSize = this.sun.shadow.mapSize.width || 2048;
    const shadowSnap = Math.max(0.0625, shadowSpan / shadowMapSize);
    const targetX = snapToStep(targetSource.x, shadowSnap);
    const targetY = snapToStep(targetSource.y, shadowSnap * 4);
    const targetZ = snapToStep(targetSource.z, shadowSnap);
    this.sunTarget.position.set(targetX, targetY, targetZ);
    this.sun.position.copy(this.sunTarget.position).addScaledVector(activeLightDirection, 130);
    this.sun.target.updateMatrixWorld();
    // Sun color: amber at night → deep orange at sunrise → warm white at noon
    const sunriseOrangeFactor = smoothstep(0, 0.24, daylight) * (1 - smoothstep(0.24, 0.6, daylight));
    const sunLightColor = new THREE.Color(0xffddb2)
      .lerp(new THREE.Color(0xff9a52), sunriseOrangeFactor * 0.48)
      .lerp(new THREE.Color(0xfff8e8), smoothstep(0.24, 0.7, daylight));
    this.sun.color.copy(useMoonLight ? new THREE.Color(0x9fb8ff) : sunLightColor);
    this.sun.intensity = this.nightVisionActive ? 2.1 : Math.max(daylightIntensity, moonlightIntensity);
    const ambientWeather = this.weather === "clear" ? 1 : (this.weather === "thunder" ? 0.5 : 0.74);
    this.ambientLight.intensity = this.nightVisionActive ? 0.62 : lerp(0.012, 0.36, daylight) * ambientWeather;
    this.ambientLight.color.copy(new THREE.Color(0xcfdccb).lerp(new THREE.Color(0x536f96), night).lerp(new THREE.Color(0xa4b8c2), stormMix));
    this.fillLight.intensity = this.nightVisionActive ? 1.35 : lerp(0.015, 0.5, daylight) * ambientWeather;
    this.fillLight.color.copy(new THREE.Color(0xcfe7ff).lerp(new THREE.Color(0x3a527a), night).lerp(new THREE.Color(0x9fb9c8), stormMix));
    this.fillLight.groundColor.copy(new THREE.Color(0x2f4029).lerp(new THREE.Color(0x090f1a), night));

    const terrainBrightness = this.nightVisionActive ? 1 : clamp(visibleLight, this.weather === "clear" ? 0.024 : 0.014, 0.9);
    const terrainTint = new THREE.Color(0xf2f2f2)
      .lerp(new THREE.Color(0x9aabc4), night * 0.42)
      .lerp(this.weather === "thunder" ? new THREE.Color(0x7d888f) : new THREE.Color(0xa7b4b8), stormMix * 0.3)
      .multiplyScalar(terrainBrightness);
    WORLD_MATERIAL.uniforms.dayNight.value.copy(terrainTint);
    LEAF_MATERIAL.uniforms.dayNight.value.copy(terrainTint);
    WATER_MATERIAL.uniforms.colorTint.value.copy(terrainTint);

    this.sunSprite.position.copy(this.camera.position).addScaledVector(sunDirection, SKY_BODY_DISTANCE);
    this.sunSprite.material.color.copy(sunLightColor);
    this.sunSprite.material.opacity = smoothstep(-0.02, 0.16, sunDirection.y) * (this.weather === "clear" ? 1 : (this.weather === "thunder" ? 0.04 : 0.12));
    this.moonSprite.position.copy(this.camera.position).addScaledVector(moonDirection, SKY_BODY_DISTANCE);
    this.moonSprite.material.opacity = smoothstep(-0.02, 0.18, moonDirection.y) * (this.weather === "clear" ? 1 : (this.weather === "thunder" ? 0.04 : 0.12));
    this.updateMoonPhase();

    this.defaultFog.color.copy(horizonColor);
    this.scene.background.copy(topColor);
    this.currentClearColor = horizonColor;
    this.updateFogForView();

    if (this.cloudMaterial) {
      const clearCloudColor = new THREE.Color(0xe1e7e9).lerp(new THREE.Color(0x4a5360), night);
      const rainCloudColor = new THREE.Color(0x75818a).lerp(new THREE.Color(0x0d1420), night);
      const thunderCloudColor = new THREE.Color(0x303941).lerp(new THREE.Color(0x060a10), night);
      const clearCloudEmissive = new THREE.Color(0xdde5e8).lerp(new THREE.Color(0x1f2a3d), night);
      const rainCloudEmissive = new THREE.Color(0x4f5d66).lerp(new THREE.Color(0x02060d), night);
      const thunderCloudEmissive = new THREE.Color(0x1c2630).lerp(new THREE.Color(0x010308), night);
      this.cloudMaterial.opacity = (this.weather === "clear" ? 0.74 : 0.94) * lerp(0.72, 1, daylight);
      this.cloudMaterial.color.copy(clearCloudColor).lerp(this.weather === "thunder" ? thunderCloudColor : rainCloudColor, stormMix);
      this.cloudMaterial.emissive.copy(clearCloudEmissive).lerp(this.weather === "thunder" ? thunderCloudEmissive : rainCloudEmissive, stormMix);
      this.cloudMaterial.emissiveIntensity = lerp(0.18, 0.08, night) * (1 - stormMix * night * 0.72);
    }
  }

  updateMoonPhase() {
    if (!this.moonTexture) return;
    const phase = mod(Math.floor(this.worldAgeTicks / MINECRAFT_DAY_TICKS), MOON_PHASE_COUNT);
    const column = phase % 4;
    const row = Math.floor(phase / 4);
    this.moonTexture.offset.set(column * 0.25, row === 0 ? 0.5 : 0);
  }

  updateClouds(dt) {
    if (!this.clouds) return;
    this.cloudScroll += dt * CLOUD_WIND_SPEED;

    // Different world seeds start with clouds at different positions in the pattern.
    const seedOffset = ((this.world?.seed ?? 0) & 0xffff) / 0xffff * CLOUD_TILE_SIZE;
    const windX = this.cloudScroll + seedOffset;

    // The group's X position encodes the total wind drift. Each puff's LOCAL
    // position is its fixed "base world X at wind=0", so puff world X =
    // group.position.x + puff.position.x = windX + baseX. Puffs drift in +X
    // as time passes — correct world-fixed behaviour, not camera-relative.
    this.clouds.position.set(windX, CLOUD_HEIGHT, 0);

    // Camera expressed in group-local space for the wrap test.
    const camLocalX = this.camera.position.x - windX;
    const camLocalZ = this.camera.position.z;
    const gridSpan = (2 * CLOUD_GRID_RADIUS + 1) * CLOUD_TILE_SIZE;

    for (const cloud of this.clouds.children) {
      let moved = false;
      const dx = cloud.position.x - camLocalX;
      if (dx > gridSpan * 0.5) {
        cloud.position.x -= gridSpan;
        moved = true;
      } else if (dx < -gridSpan * 0.5) {
        cloud.position.x += gridSpan;
        moved = true;
      }
      const dz = cloud.position.z - camLocalZ;
      if (dz > gridSpan * 0.5) {
        cloud.position.z -= gridSpan;
        moved = true;
      } else if (dz < -gridSpan * 0.5) {
        cloud.position.z += gridSpan;
        moved = true;
      }
      if (moved) cloud.updateMatrix();
    }

    this.clouds.visible = this.cloudsEnabled;
  }

  updatePrecipitationLegacy(dt) {
    if (!this.rainMesh || !this.snowGroup) return;
    this.precipitationTime += dt;

    const precipitating = this.weather !== "clear";
    const playerX = Math.floor(this.player?.position.x ?? this.camera.position.x);
    const playerZ = Math.floor(this.player?.position.z ?? this.camera.position.z);
    const snowing = precipitating && this.isSnowingAt(playerX, playerZ);

    // Smooth fade in/out
    const targetStrength = precipitating ? 1 : 0;
    const fadeSpeed = precipitating ? WEATHER_FADE_IN_SPEED : WEATHER_FADE_OUT_SPEED;
    if (dt > 0) {
      this.precipitationStrength = clamp(
        this.precipitationStrength + (targetStrength - this.precipitationStrength) * Math.min(1, dt * fadeSpeed),
        0, 1,
      );
    }

    const alpha = this.precipitationStrength;
    const active = alpha > 0.01;
    this.rainMesh.visible = active && !snowing;
    this.snowGroup.visible = active && snowing;
    if (this.splashMesh) this.splashMesh.visible = active && !snowing;

    // Thunder: random lightning bolts
    if (this.weather === "thunder" && dt > 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.triggerLightning();
        this.thunderTimer = randomRange(THUNDER_LIGHTNING_MIN, THUNDER_LIGHTNING_MAX);
      }
    }

    if (!active) {
      // Update fading splashes even during clear-fade-out
      if (this.splashMesh) this._updateSplashes(dt);
      return;
    }

    const base = this.camera.position;
    const rainYaw = this.player?.yaw ?? this.camera.rotation.y;

    // Slow wind rotation drives streak slant; direction changes gradually
    this.rainWindAngle += dt * 0.018;
    const windStrength = this.weather === "thunder" ? 3.2 : 1.8;
    this.rainWindX = Math.cos(this.rainWindAngle) * windStrength;
    this.rainWindZ = Math.sin(this.rainWindAngle) * windStrength;
    const windSlant = Math.atan2(
      Math.sqrt(this.rainWindX * this.rainWindX + this.rainWindZ * this.rainWindZ),
      RAIN_FALL_SPEED_MAX,
    ) * 0.55;

    // ── Rain ─────────────────────────────────────────────────────────
    if (!snowing && this.rainMesh) {
      RAIN_TEXTURE.offset.y = mod(this.precipitationTime * RAIN_TEXTURE_SCROLL_SPEED, 1);
      const isThunder = this.weather === "thunder";
      const night = clamp(this.skyNightFactor ?? 0, 0, 1);
      const rainColor = isThunder
        ? new THREE.Color(0x85aacc).lerp(new THREE.Color(0x26384f), night)
        : new THREE.Color(0xadd4ff).lerp(new THREE.Color(0x2d4a72), night);
      this.rainMaterial.color.copy(rainColor);
      this.rainMaterial.opacity = (isThunder ? 0.68 : 0.52) * alpha;

      const dummy = this._rainDummy;
      let splashNeedUpdate = false;

      for (let i = 0; i < RAIN_PARTICLE_COUNT; i += 1) {
        const data = this.rainData[i];

        // World position of this drop
        const worldX = Math.round(base.x + data.x + this.rainWindX);
        const worldZ = Math.round(base.z + data.z + this.rainWindZ);

        // Cache terrain height; only recompute when integer XZ changes
        if (worldX !== data.cachedWorldX || worldZ !== data.cachedWorldZ) {
          data.cachedWorldX = worldX;
          data.cachedWorldZ = worldZ;
          data.terrainY = this.world ? (this.world.terrainHeight(worldX, worldZ) ?? 0) : 0;
        }
        const groundY = data.terrainY;

        const fall = mod(data.y + this.precipitationTime * data.speed, PRECIPITATION_HEIGHT);
        const particleWorldY = base.y + PRECIPITATION_HEIGHT * 0.52 - fall;

        // Underground / shelter check: hide if particle is below terrain surface
        if (particleWorldY < groundY - 0.5) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          this.rainMesh.setMatrixAt(i, dummy.matrix);
          data.prevBelow = true;
          continue;
        }

        // Spawn a ground splash when this drop just crossed the terrain surface
        if (data.prevBelow === false && particleWorldY <= groundY + 1.5 && particleWorldY >= groundY - 0.5) {
          this._spawnSplash(worldX + 0.5, groundY + 0.04, worldZ + 0.5);
          splashNeedUpdate = true;
        }
        data.prevBelow = false;

        // Clamp streaks so they don't penetrate the ground
        const clampedY = Math.max(particleWorldY, groundY + 0.05);
        const sway = Math.sin(this.precipitationTime * 1.8 + data.drift) * 0.22;

        dummy.position.set(
          base.x + data.x + this.rainWindX + sway,
          clampedY,
          base.z + data.z + this.rainWindZ + sway * 0.4,
        );
        // Face camera yaw + wind slant
        dummy.rotation.set(0, rainYaw, data.slant + windSlant);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.rainMesh.setMatrixAt(i, dummy.matrix);
      }

      this.rainMesh.instanceMatrix.needsUpdate = true;
      if (this.splashMesh) this._updateSplashes(dt);
    }

    // ── Snow ─────────────────────────────────────────────────────────
    if (snowing) {
      const snowBase = this.weather === "thunder" ? 0.72 : 0.82;
      for (let i = 0; i < this.snowParticles.length; i += 1) {
        const sprite = this.snowParticles[i];
        const data = sprite.userData;

        const worldX = Math.round(base.x + data.x);
        const worldZ = Math.round(base.z + data.z);
        if (worldX !== data.cachedWorldX || worldZ !== data.cachedWorldZ) {
          data.cachedWorldX = worldX;
          data.cachedWorldZ = worldZ;
          data.terrainY = this.world ? (this.world.terrainHeight(worldX, worldZ) ?? 0) : 0;
        }
        const groundY = data.terrainY;

        const fall = mod(data.y + this.precipitationTime * data.speed, PRECIPITATION_HEIGHT);
        const particleWorldY = base.y + PRECIPITATION_HEIGHT * 0.52 - fall;

        if (particleWorldY < groundY - 0.3) {
          sprite.visible = false;
          continue;
        }
        sprite.visible = true;

        // Two-frequency drift gives organic flutter
        const drift =
          Math.sin(this.precipitationTime * 0.72 + data.drift) * 2.2 +
          Math.sin(this.precipitationTime * 1.45 + data.driftB) * 0.9;
        const driftZ = Math.cos(this.precipitationTime * 0.55 + data.drift) * 1.4;

        const clampedY = Math.max(particleWorldY, groundY + 0.1);
        sprite.position.set(
          base.x + data.x + drift,
          clampedY,
          base.z + data.z + driftZ,
        );
        sprite.material.opacity = snowBase * alpha;
      }
    }
  }

  precipitationColumnStateAt(x, z) {
    if (!this.world) return { surfaceY: 0, type: "none", version: 0 };
    const wx = Math.floor(x);
    const wz = Math.floor(z);
    const version = this.world.getPrecipitationColumnVersion(wx, wz);
    const key = `${wx},${wz}`;
    const cached = this.precipitationColumnCache?.get(key);
    if (cached && cached.version === version) return cached;

    const state = {
      version,
      surfaceY: this.precipitationSurfaceYAt(wx, wz),
      type: this.precipitationTypeAt(wx, wz),
    };
    this.precipitationColumnCache.set(key, state);

    if (this.precipitationColumnCache.size > PRECIPITATION_COLUMN_CACHE_LIMIT) {
      let removed = 0;
      for (const oldKey of this.precipitationColumnCache.keys()) {
        this.precipitationColumnCache.delete(oldKey);
        removed += 1;
        if (removed >= 512) break;
      }
    }

    return state;
  }

  refreshPrecipitationColumnData(data, worldX, worldZ, revisionChanged) {
    let needsRefresh = worldX !== data.cachedWorldX || worldZ !== data.cachedWorldZ;

    if (!needsRefresh && revisionChanged && this.world) {
      const version = this.world.getPrecipitationColumnVersion(worldX, worldZ);
      needsRefresh = version !== data.cachedSurfaceVersion;
    }

    if (!needsRefresh) return;

    const state = this.precipitationColumnStateAt(worldX, worldZ);
    data.cachedWorldX = worldX;
    data.cachedWorldZ = worldZ;
    data.cachedSurfaceVersion = state.version;
    data.terrainY = state.surfaceY;
    data.precipType = state.type;
  }

  updatePrecipitation(dt) {
    if (!this.rainMesh || !this.snowMesh) return;
    this.precipitationTime += dt;

    const precipitating = this.weather !== "clear";
    const targetStrength = precipitating ? 1 : 0;
    const fadeSpeed = precipitating ? WEATHER_FADE_IN_SPEED : WEATHER_FADE_OUT_SPEED;
    const previousStrength = this.precipitationStrength;
    if (dt > 0) {
      this.precipitationStrength = clamp(
        this.precipitationStrength + (targetStrength - this.precipitationStrength) * Math.min(1, dt * fadeSpeed),
        0, 1,
      );
    }
    if (Math.abs(previousStrength - this.precipitationStrength) > 0.002) {
      this.updateFogForView();
    }

    const alpha = this.precipitationStrength;
    const active = alpha > 0.01;
    const worldRevision = this.world?.precipitationRevision ?? 0;

    if (this.weather === "thunder" && dt > 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.triggerLightning();
        this.thunderTimer = randomRange(THUNDER_LIGHTNING_MIN, THUNDER_LIGHTNING_MAX);
      }
    }

    if (!active) {
      this.rainMesh.count = 0;
      this.rainMesh.visible = false;
      this.snowMesh.count = 0;
      this.snowMesh.visible = false;
      if (this.splashMesh) this._updateSplashes(dt);
      if (this.groundDropletSpotMesh) this._updateGroundDropletSpots(dt);
      if (this.groundDropletMesh) this._updateGroundDroplets(dt);
      this._lastRainDrawn = 0;
      this._lastSnowDrawn = 0;
      return;
    }

    const base = this.camera.position;
    const baseX = Math.floor(base.x);
    const baseZ = Math.floor(base.z);
    const precipitationCeilingY = Math.max(CLOUD_HEIGHT - 3, base.y + PRECIPITATION_CEILING_ABOVE_CAMERA);
    const precipitationFloorY = base.y - PRECIPITATION_FLOOR_BELOW_CAMERA;
    const centerPrecipType = this.precipitationTypeAt(baseX, baseZ);

    if (centerPrecipType !== "rain") {
      this.rainMesh.count = 0;
      this.rainMesh.visible = false;
    }
    if (centerPrecipType !== "snow") {
      this.snowMesh.count = 0;
      this.snowMesh.visible = false;
    }

    if (centerPrecipType !== "rain" && centerPrecipType !== "snow") {
      if (this.splashMesh) this._updateSplashes(dt);
      if (this.groundDropletSpotMesh) this._updateGroundDropletSpots(dt);
      if (this.groundDropletMesh) this._updateGroundDroplets(dt);
      this._lastRainDrawn = 0;
      this._lastSnowDrawn = 0;
      return;
    }

    this.rainWindAngle += dt * 0.018;
    const snowing = centerPrecipType === "snow";
    const windStrength = this.weather === "thunder"
      ? (snowing ? 1.6 : 4.8)
      : (snowing ? 0.9 : 2.7);
    this.rainWindX = Math.cos(this.rainWindAngle) * windStrength;
    this.rainWindZ = Math.sin(this.rainWindAngle) * windStrength;
    const windSlant = Math.atan2(
      Math.hypot(this.rainWindX, this.rainWindZ),
      RAIN_FALL_SPEED_MAX,
    ) * (this.weather === "thunder" ? (snowing ? 0.32 : 0.8) : (snowing ? 0.22 : 0.62));

    let rainDrawn = 0;
    if (centerPrecipType === "rain") {
      const revisionChanged = worldRevision !== this._rainPrecipitationRevision;
      RAIN_TEXTURE.offset.y = mod(this.precipitationTime * RAIN_TEXTURE_SCROLL_SPEED, 1);
      const night = clamp(this.skyNightFactor ?? 0, 0, 1);
      const rainColor = this.weather === "thunder"
        ? new THREE.Color(0x9cafbd).lerp(new THREE.Color(0x26384f), night)
        : new THREE.Color(0xb5c2cc).lerp(new THREE.Color(0x2d4a72), night);
      this.rainMaterial.color.copy(rainColor);
      this.rainMaterial.opacity = (this.weather === "thunder" ? 0.52 : 0.38) * alpha;

      const dummy = this._rainDummy;
      for (let i = 0; i < RAIN_PARTICLE_COUNT; i += 1) {
        const data = this.rainData[i];
        const fade = data.fade;
        if (fade <= 0.02) continue;

        const worldX = baseX + data.gridX;
        const worldZ = baseZ + data.gridZ;
        this.refreshPrecipitationColumnData(data, worldX, worldZ, revisionChanged);

        const groundY = data.terrainY;
        const topY = precipitationCeilingY + data.phase * 6;
        const bottomY = Math.max(groundY + 0.05, precipitationFloorY);
        const columnHeight = topY - bottomY;

        if (data.precipType !== "rain" || columnHeight <= 0.5) continue;

        data.splashTimer -= dt * (this.weather === "thunder" ? 1.7 : 1);
        if (data.distance < RAIN_IMPACT_RADIUS && data.splashTimer <= 0) {
          this._spawnSplash(worldX + 0.5, groundY + 0.04, worldZ + 0.5);
          data.splashTimer = randomRange(0.72, this.weather === "thunder" ? 1.0 : 1.75);
        }

        const windOffset = mod(this.precipitationTime * data.speed * 0.03 + data.phase, 1) - 0.5;
        const columnX = worldX + 0.5 + data.offsetX + this.rainWindX * 0.045 + windOffset * this.rainWindX * 0.08;
        const columnZ = worldZ + 0.5 + data.offsetZ + this.rainWindZ * 0.045 + windOffset * this.rainWindZ * 0.08;
        const widthScale = lerp(0.42, 1.0, fade);

        dummy.position.set(columnX, (topY + bottomY) * 0.5, columnZ);
        dummy.rotation.set(0, this.camera.rotation.y, data.slant + windSlant * 0.18);
        dummy.scale.set(widthScale, columnHeight / RAIN_COLUMN_HEIGHT, 1);
        dummy.updateMatrix();
        this.rainMesh.setMatrixAt(rainDrawn, dummy.matrix);
        rainDrawn += 1;
      }
      this.rainMesh.count = rainDrawn;
      this.rainMesh.visible = rainDrawn > 0;
      if (rainDrawn > 0) this.rainMesh.instanceMatrix.needsUpdate = true;
      this._rainPrecipitationRevision = worldRevision;
    }

    let snowDrawn = 0;
    if (centerPrecipType === "snow") {
      const revisionChanged = worldRevision !== this._snowPrecipitationRevision;
      SNOW_TEXTURE.offset.y = mod(this.precipitationTime * SNOW_TEXTURE_SCROLL_SPEED, 1);
      this.snowMaterial.color.setHex(this.weather === "thunder" ? 0xdbe7ec : 0xf0f6f8);
      this.snowMaterial.opacity = (this.weather === "thunder" ? 0.44 : 0.34) * alpha;
      const snowDummy = this._snowDummy;
      for (let i = 0; i < SNOW_PARTICLE_COUNT; i += 1) {
        const data = this.snowData[i];
        const fade = data.fade;
        if (fade <= 0.02) continue;

        const surfaceX = wrapRepeatingWeatherCoord(base.x, data.gridX + data.offsetX, RAIN_GRID_SIZE);
        const surfaceZ = wrapRepeatingWeatherCoord(base.z, data.gridZ + data.offsetZ, RAIN_GRID_SIZE);
        const worldX = Math.floor(surfaceX);
        const worldZ = Math.floor(surfaceZ);
        this.refreshPrecipitationColumnData(data, worldX, worldZ, revisionChanged);

        const groundY = data.terrainY;
        const topY = precipitationCeilingY + data.phase * 8;
        const bottomY = Math.max(groundY + 0.12, precipitationFloorY);
        const fallRange = topY - bottomY;

        if (fallRange <= 0.5 || data.precipType === "none") continue;

        const flutter =
          Math.sin(this.precipitationTime * 0.28 + data.drift) * 0.32 +
          Math.sin(this.precipitationTime * 0.52 + data.driftB) * 0.14;
        const flutterZ =
          Math.cos(this.precipitationTime * 0.25 + data.driftB) * 0.24 +
          Math.sin(this.precipitationTime * 0.2 + data.drift) * 0.12;
        const fall = mod(data.phase * fallRange + this.precipitationTime * data.speed, fallRange);
        const flakeY = topY - fall;
        const fallOffset = fall / fallRange - 0.5;
        const columnX = surfaceX + flutter + this.rainWindX * 0.012 + fallOffset * this.rainWindX * 0.025;
        const columnZ = surfaceZ + flutterZ + this.rainWindZ * 0.012 + fallOffset * this.rainWindZ * 0.025;
        const widthScale = lerp(0.72, 1.36, fade) * lerp(0.9, 1.16, data.density);
        const heightScale = lerp(0.86, 1.18, data.density);

        snowDummy.position.set(columnX, flakeY, columnZ);
        snowDummy.rotation.set(0, this.camera.rotation.y, data.slant + windSlant * 0.035);
        snowDummy.scale.set(widthScale, heightScale, 1);
        snowDummy.updateMatrix();
        this.snowMesh.setMatrixAt(snowDrawn, snowDummy.matrix);
        snowDrawn += 1;
      }
      this.snowMesh.count = snowDrawn;
      this.snowMesh.visible = snowDrawn > 0;
      if (snowDrawn > 0) this.snowMesh.instanceMatrix.needsUpdate = true;
      this._snowPrecipitationRevision = worldRevision;
    }

    if (this.splashMesh) this._updateSplashes(dt);
    if (this.groundDropletSpotMesh) this._updateGroundDropletSpots(dt);
    if (this.groundDropletMesh) this._updateGroundDroplets(dt);
    this._lastRainDrawn = rainDrawn;
    this._lastSnowDrawn = snowDrawn;
  }

  _spawnSplash(x, y, z) {
    if (!this.splashMesh) return;
    if (!this.canSpawnGroundRainImpactAt(x, y, z)) return;
    const idx = this._splashPoolIdx % SPLASH_PARTICLE_COUNT;
    this._splashPoolIdx += 1;
    this.splashData[idx] = { active: true, x, y, z, life: 0 };
    this._spawnGroundDropletSpot(x, y, z);
    this._spawnGroundDroplets(x, y, z);
  }

  canSpawnGroundRainImpactAt(x, y, z) {
    if (!this.world) return false;
    const block = this.world.getBlock(Math.floor(x), Math.floor(y - 0.08), Math.floor(z));
    if (block === Block.AIR || block === Block.WATER || isPlant(block) || isLeafBlock(block)) return false;
    return isSolid(block);
  }

  _spawnGroundDropletSpot(x, y, z) {
    if (!this.groundDropletSpotMesh || !this.groundDropletSpotData) return;
    const idx = this._groundDropletSpotPoolIdx % GROUND_DROPLET_SPOT_COUNT;
    this._groundDropletSpotPoolIdx += 1;
    const angle = randomRange(0, Math.PI * 2);
    const offset = randomRange(0, 0.18);
    this.groundDropletSpotData[idx] = {
      active: true,
      x: x + Math.cos(angle) * offset,
      y: y + 0.012,
      z: z + Math.sin(angle) * offset,
      life: 0,
      size: randomRange(0.032, this.weather === "thunder" ? 0.072 : 0.055),
      stretch: randomRange(1.15, 1.9),
      squash: randomRange(0.55, 0.92),
      rotation: randomRange(0, Math.PI * 2),
    };
  }

  _spawnGroundDroplets(x, y, z) {
    if (!this.groundDropletMesh || !this.groundDropletData) return;
    const count = Math.random() < (this.weather === "thunder" ? 0.58 : 0.24) ? 1 : 0;
    for (let n = 0; n < count; n += 1) {
      const idx = this._groundDropletPoolIdx % GROUND_DROPLET_COUNT;
      this._groundDropletPoolIdx += 1;
      const angle = randomRange(0, Math.PI * 2);
      const speed = randomRange(0.08, this.weather === "thunder" ? 0.32 : 0.24);
      const radius = randomRange(0.015, 0.12);
      this.groundDropletData[idx] = {
        active: true,
        x: x + Math.cos(angle) * radius,
        y: y + 0.024,
        z: z + Math.sin(angle) * radius,
        groundY: y + 0.014,
        vx: Math.cos(angle) * speed,
        vy: randomRange(0.62, this.weather === "thunder" ? 1.35 : 1.05),
        vz: Math.sin(angle) * speed,
        life: 0,
        size: randomRange(0.012, this.weather === "thunder" ? 0.028 : 0.022),
      };
    }
  }

  _updateSplashes(dt) {
    if (!this.splashMesh || !this.splashData) return;
    let anyActive = false;
    let matrixNeedsUpdate = false;
    const dummy = this._splashDummy;
    const alpha = this.precipitationStrength;
    this.splashMaterial.opacity = 0;

    for (let i = 0; i < SPLASH_PARTICLE_COUNT; i += 1) {
      const s = this.splashData[i];
      if (!s.active) {
        continue;
      }
      s.life += dt / SPLASH_LIFE_SECONDS;
      if (s.life >= 1) {
        s.active = false;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.splashMesh.setMatrixAt(i, dummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }
      anyActive = true;

      // Expand outward as it ages, fade in then out
      const t = s.life;
      const scale = lerp(0.055, 0.28, t);
      const opacity = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * 0.16 * alpha;
      this.splashMaterial.opacity = Math.max(this.splashMaterial.opacity, opacity);

      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.set(scale, 1, scale);
      dummy.updateMatrix();
      this.splashMesh.setMatrixAt(i, dummy.matrix);
      matrixNeedsUpdate = true;
    }
    if (matrixNeedsUpdate) this.splashMesh.instanceMatrix.needsUpdate = true;
    this.splashMesh.visible = anyActive && this.precipitationStrength > 0.01;
  }

  _updateGroundDropletSpots(dt) {
    if (!this.groundDropletSpotMesh || !this.groundDropletSpotData) return;
    let anyActive = false;
    let matrixNeedsUpdate = false;
    const dummy = this._groundDropletSpotDummy;
    const weatherAlpha = clamp(this.precipitationStrength ?? 0, 0, 1);
    this.groundDropletSpotMaterial.opacity = 0;

    for (let i = 0; i < GROUND_DROPLET_SPOT_COUNT; i += 1) {
      const spot = this.groundDropletSpotData[i];
      if (!spot.active) {
        continue;
      }

      spot.life += dt / GROUND_DROPLET_SPOT_LIFE_SECONDS;
      if (spot.life >= 1) {
        spot.active = false;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.groundDropletSpotMesh.setMatrixAt(i, dummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      const fade = (1 - smoothstep(0.28, 1, spot.life)) * weatherAlpha;
      if (fade <= 0.01) {
        spot.active = false;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.groundDropletSpotMesh.setMatrixAt(i, dummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      anyActive = true;
      const size = spot.size * lerp(0.7, 1.25, smoothstep(0, 0.32, spot.life));
      this.groundDropletSpotMaterial.opacity = Math.max(this.groundDropletSpotMaterial.opacity, fade * 0.18);
      dummy.position.set(spot.x, spot.y, spot.z);
      dummy.rotation.set(0, spot.rotation, 0);
      dummy.scale.set(size * spot.stretch, 1, size * spot.squash);
      dummy.updateMatrix();
      this.groundDropletSpotMesh.setMatrixAt(i, dummy.matrix);
      matrixNeedsUpdate = true;
    }

    if (matrixNeedsUpdate) this.groundDropletSpotMesh.instanceMatrix.needsUpdate = true;
    this.groundDropletSpotMesh.visible = anyActive;
  }

  _updateGroundDroplets(dt) {
    if (!this.groundDropletMesh || !this.groundDropletData) return;
    let anyActive = false;
    let matrixNeedsUpdate = false;
    const dummy = this._groundDropletDummy;
    const weatherAlpha = clamp(this.precipitationStrength ?? 0, 0, 1);
    this.groundDropletMaterial.opacity = 0;

    for (let i = 0; i < GROUND_DROPLET_COUNT; i += 1) {
      const drop = this.groundDropletData[i];
      if (!drop.active) {
        continue;
      }

      drop.life += dt / GROUND_DROPLET_LIFE_SECONDS;
      drop.vy -= GROUND_DROPLET_GRAVITY * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      drop.z += drop.vz * dt;

      if (drop.life >= 1 || (drop.vy < 0 && drop.y <= drop.groundY)) {
        drop.active = false;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.groundDropletMesh.setMatrixAt(i, dummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      const fade = Math.sin(drop.life * Math.PI) * weatherAlpha;
      if (fade <= 0.01) {
        drop.active = false;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.groundDropletMesh.setMatrixAt(i, dummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      anyActive = true;
      const size = drop.size * lerp(1.0, 0.35, drop.life);
      this.groundDropletMaterial.opacity = Math.max(this.groundDropletMaterial.opacity, fade * 0.28);
      dummy.position.set(drop.x, drop.y, drop.z);
      dummy.scale.set(size, size * 1.1, size);
      dummy.updateMatrix();
      this.groundDropletMesh.setMatrixAt(i, dummy.matrix);
      matrixNeedsUpdate = true;
    }

    if (matrixNeedsUpdate) this.groundDropletMesh.instanceMatrix.needsUpdate = true;
    this.groundDropletMesh.visible = anyActive;
  }

  triggerLightning() {
    if (this.lightningFlash) {
      this.lightningFlash.classList.remove("is-active");
      void this.lightningFlash.offsetWidth; // force reflow to restart animation
      this.lightningFlash.classList.add("is-active");
    }
    // Briefly spike sun intensity to simulate sky-illumination
    if (this.sun) {
      const base = this.sun.intensity;
      this.sun.intensity = Math.max(base, 4.5);
      setTimeout(() => { if (this.sun) this.sun.intensity = base; }, 120);
    }
  }

  precipitationSurfaceYAt(x, z) {
    if (!this.world) return 0;
    const wx = Math.floor(x);
    const wz = Math.floor(z);
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      const block = this.world.getBlock(wx, y, wz);
      if (block === Block.AIR || isPlant(block)) continue;
      if (block === Block.WATER || isSolid(block)) return y + 1;
    }
    return 1;
  }

  precipitationTypeAt(x, z) {
    if (!this.world || this.weather === "clear") return "none";
    const wx = Math.floor(x);
    const wz = Math.floor(z);
    const biomeId = this.world.biomeAt(wx, wz);
    if (isDryWeatherBiome(biomeId)) return "none";
    return this.isSnowingAt(wx, wz) ? "snow" : "rain";
  }

  isSnowingAt(x, z) {
    if (!this.world) return false;
    const biomeId = this.world.biomeAt(Math.floor(x), Math.floor(z));
    if (isDryWeatherBiome(biomeId)) return false;
    if (isSnowWeatherBiome(biomeId)) return true;
    const height = this.world.terrainHeight(Math.floor(x), Math.floor(z));
    const temperature = this.world.temperatureAt(Math.floor(x), Math.floor(z));
    const altitudeAdjustedTemperature = temperature - Math.max(0, height - SEA_LEVEL - 18) * 0.005;
    return altitudeAdjustedTemperature < 0.16;
  }

  returnToTitleScreen() {
    this.disconnectMultiplayer("Returned to title");
    this.stopMining();
    this.started = false;
    this.loadingWorld = false;
    this.loadingPendingReset = false;
    this.paused = false;
    this.inventoryOpen = false;
    this.pauseOverlay.hidden = true;
    this.loadingOverlay.hidden = true;
    if (this.deathScreen) this.deathScreen.hidden = true;
    this.closeWorldCreateWindow();
    this.closeMultiplayerWindow();
    this.closeSettingsWindow();
    this.closeChat({ refocus: false });
    this.hidePlayerList();
    this.inventoryOverlay.hidden = true;
    this.cursorStack.classList.remove("is-visible");
    this.hud.classList.remove("is-visible");
    this.pauseNote.classList.remove("is-visible");
    this.titleScreen.style.display = "";
    this.player.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.resetWorld(this.seedInput.value.trim() ? this.seedInput.value : this.currentSeedText, this.selectedMode);
  }

  toggleInventory() {
    if (this.inventoryOpen) {
      this.closeInventory();
    } else {
      this.openInventory();
    }
  }

  openInventory() {
    this.closeChat({ refocus: false });
    this.hidePlayerList();
    this.inventoryOpen = true;
    this.stopMining();
    document.exitPointerLock();
    this.inventoryOverlay.hidden = false;
    this.renderInventory();
  }

  closeInventory() {
    if (this.inventory.cursor) {
      if (this.player?.mode === "creative") {
        this.inventory.cursor = null;
      } else {
        const remaining = this.inventory.addItem(this.inventory.cursor.id, this.inventory.cursor.count);
        this.inventory.cursor = remaining > 0 ? createStack(this.inventory.cursor.id, remaining) : null;
        if (this.inventory.cursor) {
          this.renderInventory();
          return;
        }
      }
    }

    this.inventoryOpen = false;
    this.inventoryOverlay.hidden = true;
    this.renderInventory();
    if (this.started && !this.chatOpen) this.canvas.requestPointerLock();
  }

  positionCursorStack(event) {
    if (!event) return;
    this.cursorStack.style.left = `${event.clientX}px`;
    this.cursorStack.style.top = `${event.clientY}px`;
  }

  isCraftingTableOpen() {
    return Boolean(this.craftingTableOverlay && !this.craftingTableOverlay.hidden);
  }

  onInvPointerDown(event) {
    if (event.button !== 2) return;
    if (!this.inventory?.cursor) return;
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.classList.contains("output-slot")) return;
    const context = this.getInventorySlotContext(slot);
    if (!context?.slots || Number.isNaN(context.index) || context.area === "creative") return;
    this.invDragActive = true;
    this.invDragSlots = new Map();
    this._tryAddDragSlot(context);
  }

  onInvPointerMove(event) {
    if (!this.invDragActive) return;
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.classList.contains("output-slot")) return;
    const context = this.getInventorySlotContext(slot);
    if (!context?.slots || Number.isNaN(context.index) || context.area === "creative") return;
    this._tryAddDragSlot(context);
  }

  _tryAddDragSlot(context) {
    const key = `${context.area}:${context.index}`;
    if (this.invDragSlots.has(key)) return;
    const cursor = this.inventory.cursor;
    if (!cursor) return;
    const slotStack = context.slots[context.index];
    if (slotStack && slotStack.id !== cursor.id) return;
    if (slotStack && slotStack.count >= (ITEMS[slotStack.id]?.maxStack ?? 64)) return;
    this.invDragSlots.set(key, context);
  }

  onInvPointerUp(event) {
    if (!this.invDragActive) return;
    this.invDragActive = false;
    if (event.button !== 2 || this.invDragSlots.size <= 1) {
      this.invDragSlots = new Map();
      return;
    }
    const cursor = this.inventory.cursor;
    if (cursor) {
      let changed = false;
      for (const [, ctx] of this.invDragSlots) {
        if (!cursor || cursor.count <= 0) break;
        const slotStack = ctx.slots[ctx.index];
        if (!slotStack) {
          ctx.slots[ctx.index] = createStack(cursor.id, 1);
          cursor.count -= 1;
          changed = true;
        } else if (slotStack.id === cursor.id && slotStack.count < (ITEMS[slotStack.id]?.maxStack ?? 64)) {
          slotStack.count += 1;
          cursor.count -= 1;
          changed = true;
        }
      }
      if (cursor.count <= 0) this.inventory.cursor = null;
      if (changed) {
        this.invDragConsumedEvent = true;
        if (this.isCraftingTableOpen()) this.renderCraftingTable();
        else if (this.isFurnaceOpen()) this.renderFurnaceUI();
        else this.renderInventory();
      }
    }
    this.invDragSlots = new Map();
  }

  dropCursorItemsInWorld() {
    const cursor = this.inventory.cursor;
    if (!cursor) return;
    this.spawnThrownItemStack(cursor.id, cursor.count, 3.5, 1.0);
    this.inventory.cursor = null;
    if (this.isCraftingTableOpen()) this.renderCraftingTable();
    else if (this.isFurnaceOpen()) this.renderFurnaceUI();
    else this.renderInventory();
  }

  spawnThrownItemStack(id, count = 1, forwardSpeed = 4.8, upwardSpeed = 1.25) {
    if (!id || count <= 0) return null;
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    direction.normalize();
    const position = this.camera.position.clone().addScaledVector(direction, 0.68);
    position.y -= 0.16;
    const velocity = direction.clone().multiplyScalar(forwardSpeed).add(new THREE.Vector3(0, upwardSpeed, 0));
    if (this.player?.velocity) {
      velocity.x += this.player.velocity.x * 0.25;
      velocity.y += this.player.velocity.y * 0.08;
      velocity.z += this.player.velocity.z * 0.25;
    }
    return this.spawnDroppedItem(id, count, position, velocity, { pickupDelay: ITEM_THROW_PICKUP_DELAY_SECONDS });
  }

  trackHoveredInventorySlot(event) {
    const slot = event.target.closest(".inventory-slot");
    if (slot) this.hoveredInventorySlot = slot;
  }

  getActiveInventorySlotElement() {
    const focused = document.activeElement?.closest?.(".inventory-slot");
    if (focused) return focused;
    const hovered = document.querySelector(".inventory-slot:hover");
    return hovered ?? this.hoveredInventorySlot ?? null;
  }

  getInventorySlotContext(slot) {
    if (!slot) return null;
    if (slot.classList.contains("output-slot")) {
      if (this.craftingTableOutput?.contains(slot)) {
        return {
          area: "table-output",
          output: true,
          isCraftingTable: true,
          slots: this.inventory.tableSlots,
          getResult: getCraftingResult3x3,
        };
      }
      if (this.craftOutput?.contains(slot)) {
        return {
          area: "craft-output",
          output: true,
          isCraftingTable: false,
          slots: this.inventory.craftSlots,
          getResult: getCraftingResult,
        };
      }
      return null;
    }

    const area = slot.dataset.area;
    const index = Number(slot.dataset.index);
    if (area === "creative") return { area, isCraftingTable: false };
    if (Number.isNaN(index)) return null;
    const slots = area === "craft" ? this.inventory.craftSlots
      : area === "table" ? this.inventory.tableSlots
      : (area === "inventory" || area === "ct-inventory" || area === "furnace-inventory") ? this.inventory.slots
      : null;
    if (!slots) return null;
    return {
      area,
      index,
      slots,
      isCraftingTable: area === "table" || area === "ct-inventory",
      isFurnaceInventory: area === "furnace-inventory",
    };
  }

  renderRecipeGuide(container, recipes, activeSlots, gridSize) {
    if (!container) return;
    const fragment = document.createDocumentFragment();
    const searchQuery = gridSize === 3 ? this.recipeSearchQuery3x3 : this.recipeSearchQuery2x2;
    const visibleRecipes = recipes.filter((recipe) => ITEMS[recipe.result] && recipeMatchesRecipeSearch(recipe, searchQuery));

    for (const recipe of visibleRecipes) {
      const craftable = this.canAutofillRecipe(recipe, activeSlots);
      const button = document.createElement("button");
      button.className = "recipe-entry";
      button.type = "button";
      button.dataset.recipeId = recipe.id;
      button.classList.toggle("is-craftable", craftable);
      button.classList.toggle("is-missing", !craftable);
      button.setAttribute("aria-label", `${ITEMS[recipe.result].name} recipe`);
      button.setAttribute("aria-disabled", String(!craftable));
      button.title = this.getRecipeGuideTitle(recipe, craftable);

      const pattern = document.createElement("span");
      pattern.className = "recipe-pattern";
      pattern.style.setProperty("--recipe-grid-size", String(gridSize));
      for (const ingredient of getRecipeGridCells(recipe, gridSize)) {
        const cell = document.createElement("span");
        cell.className = "recipe-pattern-cell";
        const displayId = getRecipeIngredientDisplayId(ingredient);
        if (displayId && ITEMS[displayId]) {
          const sprite = ITEM_SPRITES.get(displayId);
          if (sprite) cell.style.setProperty("--slot-image", `url("${sprite}")`);
          cell.title = ITEMS[displayId].name;
        } else {
          cell.classList.add("is-empty");
        }
        pattern.append(cell);
      }

      const arrow = document.createElement("span");
      arrow.className = "recipe-entry-arrow";

      const resultSlot = document.createElement("span");
      resultSlot.className = "recipe-result-slot";
      resultSlot.innerHTML = `<span class="slot-count"></span>`;
      this.renderStackSlot(resultSlot, createStack(recipe.result, recipe.count), { showSingleCount: true });

      const name = document.createElement("span");
      name.className = "recipe-entry-name";
      name.textContent = ITEMS[recipe.result].name;

      button.append(pattern, arrow, resultSlot, name);
      fragment.append(button);
    }

    if (!visibleRecipes.length) {
      const empty = document.createElement("div");
      empty.className = "recipe-empty-message";
      empty.textContent = "No recipes";
      fragment.append(empty);
    }

    container.replaceChildren(fragment);
  }

  getRecipeGuideTitle(recipe, craftable) {
    const result = ITEMS[recipe.result]?.name ?? recipe.result;
    const ingredients = getRecipeIngredientList(recipe)
      .map((ingredient) => getRecipeIngredientLabel(ingredient))
      .join(", ");
    return `${result} x${recipe.count ?? 1} | ${ingredients}${craftable ? "" : " | Missing ingredients"}`;
  }

  handleRecipeGuideClick(event, gridSize) {
    const button = event.target.closest(".recipe-entry");
    if (!button) return;
    const recipe = RECIPE_BY_ID.get(button.dataset.recipeId);
    if (!recipe) return;

    const slots = gridSize === 3 ? this.inventory.tableSlots : this.inventory.craftSlots;
    const applied = this.autofillRecipe(recipe, slots, gridSize);
    if (!applied) {
      button.classList.remove("is-denied");
      void button.offsetWidth;
      button.classList.add("is-denied");
      return;
    }

    if (gridSize === 3) this.renderCraftingTable();
    else this.renderInventory();
  }

  canAutofillRecipe(recipe, activeSlots = []) {
    if (!recipe || !ITEMS[recipe.result]) return false;
    const counts = new Map();
    const addStack = (stack) => {
      if (!stack) return;
      counts.set(stack.id, (counts.get(stack.id) ?? 0) + stack.count);
    };
    for (const stack of this.inventory.slots) addStack(stack);
    for (const stack of activeSlots) addStack(stack);
    if (this.inventory.cursor) addStack(this.inventory.cursor);

    for (const ingredient of getRecipeIngredientList(recipe)) {
      const id = takeRecipeIngredientFromCounts(counts, ingredient);
      if (!id) return false;
    }

    return true;
  }

  autofillRecipe(recipe, slots, gridSize) {
    if (!recipe || !slots) return false;
    const inventorySnapshot = cloneStackArray(this.inventory.slots);
    const gridSnapshot = cloneStackArray(slots);
    const cursorSnapshot = cloneStack(this.inventory.cursor);
    const restore = () => {
      this.inventory.slots = inventorySnapshot;
      for (let index = 0; index < slots.length; index += 1) slots[index] = gridSnapshot[index] ?? null;
      this.inventory.cursor = cursorSnapshot;
    };

    if (this.inventory.cursor) {
      const cursor = this.inventory.cursor;
      this.inventory.cursor = null;
      const remaining = this.inventory.addItem(cursor.id, cursor.count);
      if (remaining > 0) {
        restore();
        return false;
      }
    }

    for (let index = 0; index < slots.length; index += 1) {
      const stack = slots[index];
      if (!stack) continue;
      slots[index] = null;
      const remaining = this.inventory.addItem(stack.id, stack.count);
      if (remaining > 0) {
        restore();
        return false;
      }
    }

    const cells = getRecipeGridCells(recipe, gridSize);
    for (let index = 0; index < Math.min(cells.length, slots.length); index += 1) {
      const ingredient = cells[index];
      if (!ingredient) continue;
      const itemId = this.takeRecipeIngredientFromInventory(ingredient);
      if (!itemId) {
        restore();
        return false;
      }
      slots[index] = createStack(itemId, 1);
    }

    return true;
  }

  takeRecipeIngredientFromInventory(ingredient) {
    for (const slotIndex of CRAFTING_INGREDIENT_SLOT_ORDER) {
      const stack = this.inventory.slots[slotIndex];
      if (!stack || !recipeIngredientMatches(stack.id, ingredient)) continue;
      const itemId = stack.id;
      stack.count -= 1;
      if (stack.count <= 0) this.inventory.slots[slotIndex] = null;
      return itemId;
    }
    return null;
  }

  dropHoveredInventoryItem(fullStack = false) {
    if (!this.started || this.chatOpen || this.player?.mode === "spectator") return false;
    const cursor = this.inventory.cursor;
    if (cursor) {
      const count = fullStack ? cursor.count : 1;
      this.spawnThrownItemStack(cursor.id, count);
      cursor.count -= count;
      if (cursor.count <= 0) this.inventory.cursor = null;
      this.renderCraftingContext(this.isCraftingTableOpen());
      return true;
    }

    const slot = this.getActiveInventorySlotElement();
    const context = this.getInventorySlotContext(slot);
    if (!context || context.output || context.area === "creative" || !context.slots) return false;
    const stack = context.slots[context.index];
    if (!stack) return false;

    const count = fullStack ? stack.count : 1;
    this.spawnThrownItemStack(stack.id, count);
    stack.count -= count;
    if (stack.count <= 0) context.slots[context.index] = null;
    this.renderCraftingContext(context.isCraftingTable);
    return true;
  }

  handleInventoryClick(event) {
    this.positionCursorStack(event);
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.classList.contains("output-slot")) return;

    const area = slot.dataset.area;
    if (area === "creative") {
      this.takeCreativeItem(slot.dataset.itemId, { quickMove: event.shiftKey });
      this.renderInventory();
      return;
    }

    const index = Number(slot.dataset.index);
    const isCraftingTable = area === "table" || area === "ct-inventory";
    const isFurnaceInv = area === "furnace-inventory";
    const slots = area === "craft" ? this.inventory.craftSlots
      : area === "table" ? this.inventory.tableSlots
      : this.inventory.slots;
    if (!slots || Number.isNaN(index)) return;

    if (event.detail >= 2 && this.inventory.cursor) {
      this.collectMatchingStacksToCursor(isCraftingTable);
      if (isCraftingTable) this.renderCraftingTable();
      else if (isFurnaceInv) this.renderFurnaceUI();
      else this.renderInventory();
      return;
    }

    if (event.shiftKey && !this.inventory.cursor) {
      if (isFurnaceInv) this.quickMoveFurnaceSlot(index);
      else if (area === "inventory" || area === "ct-inventory") this.quickMoveInventorySlot(index);
      else this.quickMoveCraftingInput(slots, index);
      if (isCraftingTable) this.renderCraftingTable();
      else if (isFurnaceInv) this.renderFurnaceUI();
      else this.renderInventory();
      return;
    }

    this.swapCursorWithSlot(slots, index);
    if (isCraftingTable) this.renderCraftingTable();
    else if (isFurnaceInv) this.renderFurnaceUI();
    else this.renderInventory();
  }

  handleInventoryRightClick(event) {
    event.preventDefault();
    if (this.invDragConsumedEvent) { this.invDragConsumedEvent = false; return; }
    this.positionCursorStack(event);
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.classList.contains("output-slot")) return;

    const area = slot.dataset.area;
    if (area === "creative") {
      if (this.inventory.cursor) {
        // Right-click discards cursor item in creative
        this.inventory.cursor = null;
        this.renderInventory();
        return;
      }
      this.takeCreativeItem(slot.dataset.itemId, { single: true, quickMove: event.shiftKey });
      this.renderInventory();
      return;
    }

    const index = Number(slot.dataset.index);
    const isCraftingTable = area === "table" || area === "ct-inventory";
    const isFurnaceInv = area === "furnace-inventory";
    const slots = area === "craft" ? this.inventory.craftSlots
      : area === "table" ? this.inventory.tableSlots
      : this.inventory.slots;
    if (!slots || Number.isNaN(index)) return;

    if (event.shiftKey && !this.inventory.cursor) {
      if (area === "inventory" || area === "ct-inventory" || isFurnaceInv) this.quickMoveInventorySlot(index);
      else this.quickMoveCraftingInput(slots, index);
      if (isCraftingTable) this.renderCraftingTable();
      else if (isFurnaceInv) this.renderFurnaceUI();
      else this.renderInventory();
      return;
    }

    this.splitCursorWithSlot(slots, index);
    if (isCraftingTable) this.renderCraftingTable();
    else if (isFurnaceInv) this.renderFurnaceUI();
    else this.renderInventory();
  }

  swapCursorWithSlot(slots, index) {
    const slotStack = slots[index];
    const cursor = this.inventory.cursor;

    if (!cursor && slotStack) {
      this.inventory.cursor = slotStack;
      slots[index] = null;
      return;
    }

    if (cursor && !slotStack) {
      slots[index] = cursor;
      this.inventory.cursor = null;
      return;
    }

    if (!cursor || !slotStack) return;

    if (cursor.id === slotStack.id) {
      const maxStack = ITEMS[cursor.id].maxStack;
      const moved = Math.min(maxStack - slotStack.count, cursor.count);
      slotStack.count += moved;
      cursor.count -= moved;
      if (cursor.count <= 0) this.inventory.cursor = null;
      return;
    }

    slots[index] = cursor;
    this.inventory.cursor = slotStack;
  }

  splitCursorWithSlot(slots, index) {
    const slotStack = slots[index];
    const cursor = this.inventory.cursor;

    if (!cursor && slotStack) {
      const taken = Math.ceil(slotStack.count / 2);
      this.inventory.cursor = createStack(slotStack.id, taken);
      slotStack.count -= taken;
      if (slotStack.count <= 0) slots[index] = null;
      return;
    }

    if (!cursor) return;

    if (!slotStack) {
      slots[index] = createStack(cursor.id, 1);
      cursor.count -= 1;
      if (cursor.count <= 0) this.inventory.cursor = null;
      return;
    }

    if (slotStack.id !== cursor.id || slotStack.count >= ITEMS[slotStack.id].maxStack) return;
    slotStack.count += 1;
    cursor.count -= 1;
    if (cursor.count <= 0) this.inventory.cursor = null;
  }

  takeCreativeItem(itemId, options = {}) {
    const item = ITEMS[itemId];
    if (!item) return;
    const count = options.single ? 1 : Math.min(item.maxStack ?? CREATIVE_ITEM_STACK_SIZE, CREATIVE_ITEM_STACK_SIZE);
    const stack = createStack(itemId, count);
    if (!stack) return;

    if (options.quickMove) {
      const selectedSlot = HOTBAR_START + this.selectedHotbar;
      const targetIndex = this.inventory.slots[selectedSlot] ? HOTBAR_SLOT_INDICES.find((index) => !this.inventory.slots[index]) : selectedSlot;
      this.inventory.slots[targetIndex ?? selectedSlot] = stack;
      return;
    }

    this.inventory.cursor = stack;
  }

  quickMoveInventorySlot(index) {
    const targetIndices = index >= HOTBAR_START ? MAIN_INVENTORY_SLOT_INDICES : HOTBAR_SLOT_INDICES;
    this.moveStackToSlots(index, targetIndices);
  }

  quickMoveFurnaceSlot(index) {
    if (!this.activeFurnaceKey) { this.quickMoveInventorySlot(index); return; }
    const state = this.getFurnaceState(this.activeFurnaceKey);
    const source = this.inventory.slots[index];
    if (!source) return;
    const maxStack = ITEMS[source.id]?.maxStack ?? 64;
    if (FURNACE_RECIPES[source.id]) {
      if (!state.inputStack) {
        state.inputStack = createStack(source.id, source.count);
        this.inventory.slots[index] = null;
        return;
      } else if (state.inputStack.id === source.id && state.inputStack.count < maxStack) {
        const moved = Math.min(maxStack - state.inputStack.count, source.count);
        state.inputStack.count += moved;
        source.count -= moved;
        if (source.count <= 0) this.inventory.slots[index] = null;
        return;
      }
    }
    if (FURNACE_FUELS[source.id]) {
      if (!state.fuelStack) {
        state.fuelStack = createStack(source.id, source.count);
        this.inventory.slots[index] = null;
        return;
      } else if (state.fuelStack.id === source.id && state.fuelStack.count < maxStack) {
        const moved = Math.min(maxStack - state.fuelStack.count, source.count);
        state.fuelStack.count += moved;
        source.count -= moved;
        if (source.count <= 0) this.inventory.slots[index] = null;
        return;
      }
    }
    this.quickMoveInventorySlot(index);
  }

  moveStackToSlots(sourceIndex, targetIndices) {
    const source = this.inventory.slots[sourceIndex];
    if (!source) return;
    const item = ITEMS[source.id];
    if (!item) return;

    for (const targetIndex of targetIndices) {
      if (source.count <= 0) break;
      if (targetIndex === sourceIndex) continue;
      const target = this.inventory.slots[targetIndex];
      if (!target || target.id !== source.id || target.count >= item.maxStack) continue;
      const moved = Math.min(item.maxStack - target.count, source.count);
      target.count += moved;
      source.count -= moved;
    }

    for (const targetIndex of targetIndices) {
      if (source.count <= 0) break;
      if (targetIndex === sourceIndex || this.inventory.slots[targetIndex]) continue;
      this.inventory.slots[targetIndex] = createStack(source.id, source.count);
      source.count = 0;
    }

    if (source.count <= 0) this.inventory.slots[sourceIndex] = null;
  }

  quickMoveCraftingInput(slots, index) {
    const source = slots[index];
    if (!source) return;
    const remaining = this.inventory.addItem(source.id, source.count);
    slots[index] = remaining > 0 ? createStack(source.id, remaining) : null;
  }

  handleInventoryNumberKey(hotbarIndex) {
    const hotbarSlotIndex = HOTBAR_START + hotbarIndex;
    const slot = this.getActiveInventorySlotElement();
    const context = this.getInventorySlotContext(slot);
    if (!context) return false;

    if (context.output) {
      const changed = this.craftOutputToHotbar(context, hotbarSlotIndex);
      if (changed) this.renderCraftingContext(context.isCraftingTable);
      return changed;
    }

    if (context.area === "creative") {
      const itemId = slot.dataset.itemId;
      const item = ITEMS[itemId];
      if (!item) return false;
      this.inventory.slots[hotbarSlotIndex] = createStack(
        itemId,
        Math.min(item.maxStack ?? CREATIVE_ITEM_STACK_SIZE, CREATIVE_ITEM_STACK_SIZE),
      );
      this.renderInventory();
      return true;
    }

    if (context.slots === this.inventory.slots && context.index === hotbarSlotIndex) return false;
    const source = context.slots[context.index];
    const hotbar = this.inventory.slots[hotbarSlotIndex];
    context.slots[context.index] = hotbar;
    this.inventory.slots[hotbarSlotIndex] = source;
    this.renderCraftingContext(context.isCraftingTable);
    return true;
  }

  craftOutputToHotbar(context, hotbarSlotIndex) {
    const result = context.getResult(context.slots);
    if (!result) return false;
    const target = this.inventory.slots[hotbarSlotIndex];
    const maxStack = ITEMS[result.id]?.maxStack ?? CREATIVE_ITEM_STACK_SIZE;
    if (target && target.id !== result.id) return false;
    if (target && target.count + result.count > maxStack) return false;

    if (target) target.count += result.count;
    else this.inventory.slots[hotbarSlotIndex] = result;
    this.consumeCraftingIngredients(context.slots);
    return true;
  }

  isFurnaceOpen() {
    return Boolean(this.furnaceOverlay && !this.furnaceOverlay.hidden);
  }

  renderCraftingContext(isCraftingTable) {
    if (isCraftingTable || this.isCraftingTableOpen()) this.renderCraftingTable();
    else if (this.isFurnaceOpen()) this.renderFurnaceUI();
    else this.renderInventory();
  }

  quickCraftOutputToInventory(slots, getResult) {
    if (this.inventory.cursor) return false;
    let crafted = false;

    for (let guard = 0; guard < 128; guard += 1) {
      const result = getResult(slots);
      if (!result) break;
      if (!this.inventory.canAddItem(result.id, result.count)) break;
      const remaining = this.inventory.addItem(result.id, result.count);
      if (remaining > 0) break;
      this.consumeCraftingIngredients(slots);
      crafted = true;
    }

    return crafted;
  }

  consumeCraftingIngredients(slots) {
    for (let i = 0; i < slots.length; i += 1) {
      const stack = slots[i];
      if (!stack) continue;
      stack.count -= 1;
      if (stack.count <= 0) slots[i] = null;
    }
  }

  collectMatchingStacksToCursor(includeTableSlots = false) {
    const cursor = this.inventory.cursor;
    if (!cursor) return false;
    const maxStack = ITEMS[cursor.id]?.maxStack ?? CREATIVE_ITEM_STACK_SIZE;
    if (cursor.count >= maxStack) return false;
    const slotGroups = includeTableSlots
      ? [this.inventory.slots, this.inventory.tableSlots]
      : [this.inventory.slots, this.inventory.craftSlots];
    let movedAny = false;

    for (const slots of slotGroups) {
      for (let index = 0; index < slots.length; index += 1) {
        if (cursor.count >= maxStack) return movedAny;
        const stack = slots[index];
        if (!stack || stack.id !== cursor.id) continue;
        const moved = Math.min(maxStack - cursor.count, stack.count);
        cursor.count += moved;
        stack.count -= moved;
        if (stack.count <= 0) slots[index] = null;
        movedAny = movedAny || moved > 0;
      }
    }

    return movedAny;
  }

  takeCraftingOutput(event) {
    this.positionCursorStack(event);
    if (event?.shiftKey) {
      this.quickCraftOutputToInventory(this.inventory.craftSlots, getCraftingResult);
      this.renderInventory();
      return;
    }

    const result = getCraftingResult(this.inventory.craftSlots);
    if (!result) return;
    if (!this.canCursorAccept(result)) return;

    if (this.inventory.cursor) {
      this.inventory.cursor.count += result.count;
    } else {
      this.inventory.cursor = result;
    }

    this.consumeCraftingIngredients(this.inventory.craftSlots);

    this.renderInventory();
  }

  canCursorAccept(stack) {
    const cursor = this.inventory.cursor;
    if (!cursor) return true;
    return cursor.id === stack.id && cursor.count + stack.count <= ITEMS[stack.id].maxStack;
  }

  updateHotbarSelection() {
    [...this.hotbar.children].forEach((slot, index) => {
      slot.classList.toggle("is-selected", index === this.selectedHotbar);
    });
  }

  selectHotbarSlot(index) {
    this.selectedHotbar = mod(index, HOTBAR_SIZE);
    this.updateHotbarSelection();
    this.updateHeldItemMesh();
  }

  renderHotbar() {
    [...this.hotbar.children].forEach((slot, index) => {
      const stack = this.player?.mode === "spectator" ? null : this.inventory.slots[HOTBAR_START + index];
      this.renderStackSlot(slot, stack, { showSingleCount: false, hideCount: this.player?.mode === "creative" });
      slot.classList.toggle("is-selected", index === this.selectedHotbar);
    });
    this.updateHeldItemMesh();
  }

  renderInventory() {
    const creative = this.player?.mode === "creative";
    this.inventoryPanel.classList.toggle("is-creative", creative);
    this.creativeInventory.hidden = !creative;
    if (this.survivalCrafting) this.survivalCrafting.hidden = creative;
    this.craftingArea.hidden = creative;
    if (this.recipeSearchInput2x2 && this.recipeSearchInput2x2.value !== this.recipeSearchQuery2x2) {
      this.recipeSearchInput2x2.value = this.recipeSearchQuery2x2;
    }
    if (creative) this.renderCreativeInventory();

    const craftResult = getCraftingResult(this.inventory.craftSlots);

    [...this.craftGrid.children].forEach((slot, index) => {
      this.renderStackSlot(slot, this.inventory.craftSlots[index]);
    });

    [...this.inventoryGrid.children].forEach((slot, index) => {
      this.renderStackSlot(slot, this.inventory.slots[index]);
      slot.classList.toggle("is-hotbar-selected", index === HOTBAR_START + this.selectedHotbar);
    });

    this.renderStackSlot(this.craftOutput.querySelector(".output-slot"), craftResult, {
      showSingleCount: true,
    });
    if (!creative) this.renderRecipeGuide(this.recipeGuideList2x2, getRecipeGuideRecipes(2), this.inventory.craftSlots, 2);
    this.renderStackSlot(this.cursorStack, this.inventory.cursor);
    this.cursorStack.classList.toggle("is-visible", Boolean(this.inventory.cursor));
    this.renderHotbar();
  }

  renderCreativeInventory() {
    const query = this.creativeSearchQuery.trim().toLowerCase();
    const activeTab = query ? "search" : this.creativeTab;
    [...this.creativeTabs.children].forEach((tab) => {
      const selected = tab.dataset.tab === activeTab;
      tab.classList.toggle("is-selected", selected);
      tab.setAttribute("aria-selected", String(selected));
    });

    const fragment = document.createDocumentFragment();
    const itemIds = getCreativeItemIds(activeTab, query);
    for (const itemId of itemIds) {
      const slot = document.createElement("button");
      slot.className = "inventory-slot creative-slot";
      slot.type = "button";
      slot.dataset.area = "creative";
      slot.dataset.itemId = itemId;
      slot.setAttribute("aria-label", ITEMS[itemId].name);
      slot.innerHTML = `<span class="slot-count"></span>`;
      this.renderStackSlot(slot, createStack(itemId, 1), { showSingleCount: false });
      fragment.append(slot);
    }

    this.creativeGrid.replaceChildren(fragment);
  }

  renderStackSlot(element, stack, options = {}) {
    const countElement = element.querySelector(".slot-count");
    element.classList.toggle("is-empty", !stack);

    if (!stack) {
      element.style.removeProperty("--slot-color");
      element.style.removeProperty("--slot-image");
      element.removeAttribute("title");
      if (countElement) countElement.textContent = "";
      return;
    }

    const item = ITEMS[stack.id];
    if (!item) return;
    element.style.setProperty("--slot-color", `#${item.color.toString(16).padStart(6, "0")}`);
    const sprite = ITEM_SPRITES.get(stack.id);
    if (sprite) element.style.setProperty("--slot-image", `url("${sprite}")`);
    else element.style.removeProperty("--slot-image");
    element.title = item.name;
    if (countElement) {
      countElement.textContent = !options.hideCount && (stack.count > 1 || options.showSingleCount) ? String(stack.count) : "";
    }
  }

  setSelectedMode(mode) {
    this.selectedMode = mode === "creative" ? "creative" : "survival";
    this.modeButtons.forEach((button) => {
      const selected = button.dataset.mode === this.selectedMode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  breakTargetBlock() {
    if (this.player.mode === "spectator") return;
    const hit = this.raycastBlock();
    if (!hit || hit.block === Block.BEDROCK) return;
    this.finishBreakingBlock(hit);
  }

  getSelectedHotbarStack() {
    if (!this.inventory || this.player?.mode === "spectator") return null;
    const slotIndex = HOTBAR_START + this.selectedHotbar;
    const slot = this.inventory.slots[slotIndex];
    return slot ? { slot, slotIndex, item: ITEMS[slot.id] } : null;
  }

  useSelectedItem() {
    const selected = this.getSelectedHotbarStack();
    if (!selected?.item) return false;
    const { slot, slotIndex, item } = selected;

    if (item.food) return this.consumeFood(slot, slotIndex, item);
    if (item.armor) return this.equipArmorFromHotbar(slot, slotIndex, item);
    if (item.bucket) return this.useBucket(slot, slotIndex, item);
    if (item.spawn) return this.useSpawnEgg(slot, slotIndex);
    return false;
  }

  interactTargetBlock() {
    const hit = this.raycastBlock({ includeWater: false });
    if (!hit) return false;

    if (hit.block === Block.CRAFTING_TABLE) {
      this.openCraftingTable();
      return true;
    }

    if (isFurnaceBlock(hit.block)) {
      return this.interactWithFurnace(hit.position);
    }

    if (isAnvilBlock(hit.block)) {
      this.openAnvilMenu();
      return true;
    }

    const toggledTrapdoor = getTrapdoorToggleBlock(hit.block);
    if (toggledTrapdoor) {
      this.world.setBlock(hit.position.x, hit.position.y, hit.position.z, toggledTrapdoor);
      return true;
    }

    const toggledDoor = getDoorToggleBlock(hit.block);
    if (toggledDoor) {
      this.world.setBlock(hit.position.x, hit.position.y, hit.position.z, toggledDoor);
      const upperOffset = isDoorLowerBlock(hit.block) ? 1 : isDoorUpperBlock(hit.block) ? -1 : 0;
      if (upperOffset !== 0) {
        const partnerY = hit.position.y + upperOffset;
        const partner = this.world.getBlock(hit.position.x, partnerY, hit.position.z);
        const partnerToggled = getDoorToggleBlock(partner);
        if (partnerToggled) this.world.setBlock(hit.position.x, partnerY, hit.position.z, partnerToggled);
      }
      return true;
    }

    return false;
  }

  openAnvilMenu() {
    if (!this.anvilOverlay) return;
    this.anvilOverlay.hidden = false;
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeAnvilMenu() {
    if (!this.anvilOverlay) return;
    this.anvilOverlay.hidden = true;
    this.paused = false;
    if (this.started) this.canvas.requestPointerLock();
  }

  openCraftingTable() {
    if (!this.craftingTableOverlay) return;
    this.craftingTableOverlay.hidden = false;
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderCraftingTable();
  }

  closeCraftingTable() {
    if (!this.craftingTableOverlay) return;
    if (this.inventory.cursor) {
      const remaining = this.inventory.addItem(this.inventory.cursor.id, this.inventory.cursor.count);
      this.inventory.cursor = remaining > 0 ? createStack(this.inventory.cursor.id, remaining) : null;
    }
    for (let i = 0; i < this.inventory.tableSlots.length; i++) {
      const s = this.inventory.tableSlots[i];
      if (!s) continue;
      const remaining = this.inventory.addItem(s.id, s.count);
      this.inventory.tableSlots[i] = remaining > 0 ? createStack(s.id, remaining) : null;
    }
    this.craftingTableOverlay.hidden = true;
    this.paused = false;
    this.renderInventory();
    if (this.started) this.canvas.requestPointerLock();
  }

  renderCraftingTable() {
    if (!this.craftingTableOverlay || this.craftingTableOverlay.hidden) return;
    const result = getCraftingResult3x3(this.inventory.tableSlots);
    if (this.recipeSearchInput3x3 && this.recipeSearchInput3x3.value !== this.recipeSearchQuery3x3) {
      this.recipeSearchInput3x3.value = this.recipeSearchQuery3x3;
    }

    [...this.craftingTableGrid.children].forEach((slot, i) => {
      this.renderStackSlot(slot, this.inventory.tableSlots[i]);
    });
    [...this.craftingTableInvGrid.children].forEach((slot, i) => {
      this.renderStackSlot(slot, this.inventory.slots[i]);
      slot.classList.toggle("is-hotbar-selected", i === HOTBAR_START + this.selectedHotbar);
    });
    this.renderStackSlot(this.craftingTableOutput.querySelector(".output-slot"), result, { showSingleCount: true });
    this.renderRecipeGuide(this.recipeGuideList3x3, getRecipeGuideRecipes(3), this.inventory.tableSlots, 3);
    this.renderStackSlot(this.cursorStack, this.inventory.cursor);
    this.cursorStack.classList.toggle("is-visible", Boolean(this.inventory.cursor));
  }

  takeCraftingTableOutput(event) {
    this.positionCursorStack(event);
    if (event?.shiftKey) {
      this.quickCraftOutputToInventory(this.inventory.tableSlots, getCraftingResult3x3);
      this.renderCraftingTable();
      return;
    }

    const result = getCraftingResult3x3(this.inventory.tableSlots);
    if (!result) return;
    if (!this.canCursorAccept(result)) return;

    if (this.inventory.cursor) {
      this.inventory.cursor.count += result.count;
    } else {
      this.inventory.cursor = result;
    }

    this.consumeCraftingIngredients(this.inventory.tableSlots);

    this.renderCraftingTable();
  }

  interactWithFurnace(position) {
    this.openFurnaceMenu(position);
    return true;
  }

  openFurnaceMenu(position) {
    if (!this.furnaceOverlay) return;
    this.activeFurnaceKey = `${position.x},${position.y},${position.z}`;
    this.furnaceOverlay.hidden = false;
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderFurnaceUI();
  }

  closeFurnaceMenu() {
    if (!this.furnaceOverlay) return;
    if (this.inventory?.cursor) {
      const remaining = this.inventory.addItem(this.inventory.cursor.id, this.inventory.cursor.count);
      this.inventory.cursor = remaining > 0 ? createStack(this.inventory.cursor.id, remaining) : null;
    }
    this.furnaceOverlay.hidden = true;
    this.activeFurnaceKey = null;
    this.paused = false;
    if (this.started) this.canvas.requestPointerLock();
  }

  renderFurnaceUI() {
    if (!this.furnaceOverlay || this.furnaceOverlay.hidden || !this.activeFurnaceKey) return;
    const state = this.getFurnaceState(this.activeFurnaceKey);

    this.renderStackSlot(this.furnaceSlotInput, state.inputStack);
    this.renderStackSlot(this.furnaceSlotFuel, state.fuelStack);
    this.renderStackSlot(this.furnaceSlotOutput, state.output);

    const fuelPct = (state.maxFuel > 0 && state.fuel > 0) ? Math.min(1, state.fuel / state.maxFuel) * 100 : 0;
    if (this.furnaceFlameFill) this.furnaceFlameFill.style.height = `${fuelPct}%`;

    const canCook = state.inputStack && FURNACE_RECIPES[state.inputStack.id];
    const cookPct = canCook ? Math.min(1, state.progress / FURNACE_COOK_SECONDS) * 100 : 0;
    if (this.furnaceArrowFill) this.furnaceArrowFill.style.width = `${cookPct}%`;

    if (this.furnaceInvGrid) {
      [...this.furnaceInvGrid.children].forEach((slot, i) => {
        this.renderStackSlot(slot, this.inventory.slots[i]);
        slot.classList.toggle("is-hotbar-selected", i === HOTBAR_START + this.selectedHotbar);
      });
    }

    this.renderStackSlot(this.cursorStack, this.inventory.cursor);
    this.cursorStack.classList.toggle("is-visible", Boolean(this.inventory.cursor));
  }

  furnaceSlotClick(slotType, event) {
    if (!this.activeFurnaceKey) return;
    const state = this.getFurnaceState(this.activeFurnaceKey);
    const cursor = this.inventory.cursor;

    if (slotType === "output") {
      if (!state.output) return;
      if (event?.shiftKey) {
        const remaining = this.inventory.addItem(state.output.id, state.output.count);
        state.output = remaining > 0 ? createStack(state.output.id, remaining) : null;
      } else if (!cursor) {
        this.inventory.cursor = state.output;
        state.output = null;
      } else if (cursor.id === state.output.id) {
        const maxStack = ITEMS[cursor.id]?.maxStack ?? 64;
        const moved = Math.min(maxStack - cursor.count, state.output.count);
        cursor.count += moved;
        state.output.count -= moved;
        if (state.output.count <= 0) state.output = null;
      }
      this.renderFurnaceUI();
      return;
    }

    const currentStack = slotType === "input" ? state.inputStack : state.fuelStack;
    const setStack = (v) => { if (slotType === "input") state.inputStack = v; else state.fuelStack = v; };
    const canPlace = (id) => slotType === "input" ? Boolean(FURNACE_RECIPES[id]) : Boolean(FURNACE_FUELS[id]);

    if (!cursor && currentStack) {
      this.inventory.cursor = currentStack;
      setStack(null);
    } else if (cursor && !currentStack) {
      if (canPlace(cursor.id)) { setStack(cursor); this.inventory.cursor = null; }
    } else if (cursor && currentStack) {
      if (cursor.id === currentStack.id && canPlace(cursor.id)) {
        const maxStack = ITEMS[cursor.id]?.maxStack ?? 64;
        const moved = Math.min(maxStack - currentStack.count, cursor.count);
        currentStack.count += moved;
        cursor.count -= moved;
        if (cursor.count <= 0) this.inventory.cursor = null;
      } else if (canPlace(cursor.id)) {
        this.inventory.cursor = currentStack;
        setStack(cursor);
      }
    }

    this.renderFurnaceUI();
  }

  furnaceSlotRightClick(slotType, event) {
    if (!this.activeFurnaceKey) return;
    const state = this.getFurnaceState(this.activeFurnaceKey);
    const cursor = this.inventory.cursor;
    const currentStack = slotType === "input" ? state.inputStack : state.fuelStack;
    const setStack = (v) => { if (slotType === "input") state.inputStack = v; else state.fuelStack = v; };
    const canPlace = (id) => slotType === "input" ? Boolean(FURNACE_RECIPES[id]) : Boolean(FURNACE_FUELS[id]);

    if (!cursor && currentStack) {
      const taken = Math.ceil(currentStack.count / 2);
      this.inventory.cursor = createStack(currentStack.id, taken);
      currentStack.count -= taken;
      if (currentStack.count <= 0) setStack(null);
    } else if (cursor && canPlace(cursor.id)) {
      if (!currentStack) {
        setStack(createStack(cursor.id, 1));
        cursor.count -= 1;
        if (cursor.count <= 0) this.inventory.cursor = null;
      } else if (currentStack.id === cursor.id && currentStack.count < (ITEMS[cursor.id]?.maxStack ?? 64)) {
        currentStack.count += 1;
        cursor.count -= 1;
        if (cursor.count <= 0) this.inventory.cursor = null;
      }
    }

    this.renderFurnaceUI();
  }

  getFurnaceState(key) {
    let state = this.furnaces.get(key);
    if (!state) {
      state = {
        inputStack: null,  // {id, count} – items in input slot
        fuelStack: null,   // {id, count} – fuel items in fuel slot
        output: null,      // {id, count} – cooked output
        fuel: 0,           // seconds of current burn remaining
        maxFuel: 80,       // max seconds for current fuel (for flame height)
        progress: 0,       // cook progress (0 to FURNACE_COOK_SECONDS)
      };
      this.furnaces.set(key, state);
    }
    return state;
  }

  describeFurnaceState(state) {
    if (state.output) return `Furnace output: ${ITEMS[state.output.id]?.name ?? state.output.id} x${state.output.count}`;
    if (state.inputStack) {
      const percent = Math.round((state.progress / FURNACE_COOK_SECONDS) * 100);
      return `Furnace cooking ${ITEMS[state.inputStack.id]?.name ?? state.inputStack.id}: ${percent}%`;
    }
    if (state.fuel > 0) return `Furnace has ${state.fuel.toFixed(1)}s fuel.`;
    return "Furnace is empty.";
  }

  updateFurnaces(dt) {
    if (!this.furnaces?.size) return;
    let uiDirty = false;
    for (const [key, state] of this.furnaces) {
      if (!state.inputStack) continue;
      const outputId = FURNACE_RECIPES[state.inputStack.id];
      if (!outputId) continue;
      const outputFull = state.output && state.output.id === outputId
        && state.output.count >= (ITEMS[state.output.id]?.maxStack ?? 64);
      if (outputFull) continue;

      // Try to ignite from fuel slot if current burn is out
      if (state.fuel <= 0 && state.fuelStack) {
        const burnTime = FURNACE_FUELS[state.fuelStack.id];
        if (burnTime) {
          state.fuel = burnTime;
          state.maxFuel = burnTime;
          state.fuelStack.count -= 1;
          if (state.fuelStack.count <= 0) state.fuelStack = null;
          if (this.activeFurnaceKey === key) uiDirty = true;
          // Just ignited — swap to lit block texture
          const [ix, iy, iz] = key.split(",").map(Number);
          const litBlock = getFurnaceLitBlock(this.world.getBlock(ix, iy, iz));
          if (litBlock != null) this.world.setBlock(ix, iy, iz, litBlock);
        }
      }

      if (state.fuel <= 0) {
        // No fuel – progress decays at double speed
        if (state.progress > 0) {
          state.progress = Math.max(0, state.progress - dt * 2);
          if (this.activeFurnaceKey === key) uiDirty = true;
        }
        continue;
      }

      const fuelWas = state.fuel;
      state.fuel = Math.max(0, state.fuel - dt);
      if (fuelWas > 0 && state.fuel <= 0) {
        // Fuel just ran out — swap to unlit block texture
        const [ux, uy, uz] = key.split(",").map(Number);
        const unlitBlock = getFurnaceUnlitBlock(this.world.getBlock(ux, uy, uz));
        if (unlitBlock != null) this.world.setBlock(ux, uy, uz, unlitBlock);
      }
      state.progress += dt;
      if (this.activeFurnaceKey === key) uiDirty = true;

      if (state.progress < FURNACE_COOK_SECONDS) continue;

      // Produce one output item
      state.progress = 0;
      state.inputStack.count -= 1;
      if (state.inputStack.count <= 0) state.inputStack = null;

      if (state.output && state.output.id === outputId) {
        state.output.count += 1;
      } else if (!state.output) {
        state.output = createStack(outputId, 1);
      }

      const [x, y, z] = key.split(",").map(Number);
      this.spawnBlockBreakParticles(this.world.getBlock(x, y, z), new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0));
    }
    if (uiDirty) this.renderFurnaceUI();
  }

  consumeFood(slot, slotIndex, item) {
    if (this.player.mode !== "survival") return true;
    if (this.hunger >= MAX_HUNGER && !item.food.alwaysEdible) return false;
    this.hunger = clamp(this.hunger + item.food.hunger, 0, MAX_HUNGER);
    this.saturation = clamp(this.saturation + item.food.saturation, 0, MAX_SATURATION);
    this.consumeSelectedHotbarItem(slot, slotIndex, item.food.containerItem ?? null);
    this.renderVitals();
    return true;
  }

  equipArmorFromHotbar(slot, slotIndex, item) {
    const armorSlot = item.armor.slot;
    const previous = this.inventory.armorSlots[armorSlot];
    this.inventory.armorSlots[armorSlot] = slot;
    this.inventory.slots[slotIndex] = previous;
    this.renderInventory();
    this.renderVitals();
    return true;
  }

  useBucket(slot, slotIndex, item) {
    if (item.bucket === "milk") {
      if (this.player.mode === "survival") this.consumeSelectedHotbarItem(slot, slotIndex, "bucket_empty");
      return true;
    }

    if (item.bucket === "empty") {
      const hit = this.raycastBlock({ includeWater: true });
      if (!hit || (hit.block !== Block.WATER && !isLava(hit.block))) return false;
      const replacement = hit.block === Block.WATER ? "bucket_water" : "bucket_lava";
      const removed = this.world.setBlock(hit.position.x, hit.position.y, hit.position.z, Block.AIR);
      if (!removed) return false;
      if (this.player.mode === "survival") this.consumeSelectedHotbarItem(slot, slotIndex, replacement);
      return true;
    }

    const hit = this.raycastBlock({ includeWater: true });
    if (!hit) return false;
    const place = isReplaceablePlacementBlock(hit.block) || hit.block === Block.WATER ? hit.position : hit.placePosition;
    if (!place || this.intersectsPlayer(place.x, place.y, place.z, Block.WATER)) return false;
    const block = item.bucket === "water" ? Block.WATER : getExtraBlockByItemId("lava");
    if (!block) return false;
    const placed = this.world.setBlock(
      place.x,
      place.y,
      place.z,
      block,
      item.bucket === "water" ? { waterLevel: 0, isSource: true } : { lavaLevel: 0, isSource: true },
    );
    if (!placed) return false;
    if (this.player.mode === "survival") this.consumeSelectedHotbarItem(slot, slotIndex, "bucket_empty");
    return true;
  }

  useSpawnEgg(slot, slotIndex) {
    const hit = this.raycastBlock({ includeWater: true });
    if (!hit) return false;
    const place = hit.placePosition ?? new THREE.Vector3(hit.position.x, hit.position.y + 1, hit.position.z);
    const species = ["chicken", "pig", "cow"][Math.floor(Math.random() * 3)];
    const mob = this.spawnMob(species, new THREE.Vector3(place.x + 0.5, place.y, place.z + 0.5));
    if (!mob) return false;
    if (this.player.mode === "survival") this.consumeSelectedHotbarItem(slot, slotIndex);
    return true;
  }

  consumeSelectedHotbarItem(slot, slotIndex, replacementId = null) {
    if (replacementId && ITEMS[replacementId]) {
      this.inventory.slots[slotIndex] = createStack(replacementId, 1);
      this.renderInventory();
      return;
    }

    slot.count -= 1;
    if (slot.count <= 0) this.inventory.slots[slotIndex] = null;
    this.renderInventory();
  }

  placeTargetBlock() {
    if (this.player.mode === "spectator") return;
    const hit = this.raycastBlock();
    if (!hit) return;
    const selected = this.getSelectedPlaceStack();
    if (!selected?.block) return;
    let blockToPlace = selected.block;
    const replaceTarget = isReplaceablePlacementBlock(hit.block);
    let place = replaceTarget ? hit.position : hit.placePosition;
    if (selected.block === Block.CACTUS && isCactusBaseBlock(hit.block)) {
      const above = new THREE.Vector3(hit.position.x, hit.position.y + 1, hit.position.z);
      const aboveBlock = this.world.getBlock(above.x, above.y, above.z);
      if (aboveBlock === Block.AIR || isReplaceablePlacementBlock(aboveBlock)) place = above;
    }
    const trapdoorBlock = this.getTrapdoorPlacementBlockForHit(selected.slot.id, hit);
    if (trapdoorBlock != null) blockToPlace = trapdoorBlock;
    // Wall torch: if placing a floor torch on a vertical face, use the wall variant
    if (selected.slot.id === "torch_on" && hit.normal && hit.normal.y === 0) {
      const facing = wallTorchFacingFromNormal(hit.normal);
      const wallBlock = getBlockByDefinitionId(`torch_on_wall_${facing}`);
      if (wallBlock != null) blockToPlace = wallBlock;
    }
    // Furnace: orient front face toward the player
    if (selected.slot.id === "furnace") {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const facingBlock = getBlockByDefinitionId(furnaceIdFromLookDir(dir));
      if (facingBlock != null) blockToPlace = facingBlock;
    }
    if (!place) return;
    if (this.intersectsPlayer(place.x, place.y, place.z, blockToPlace)) return;
    const existing = this.world.getBlock(place.x, place.y, place.z);
    if (existing !== Block.AIR && existing !== Block.WATER && !isReplaceablePlacementBlock(existing)) return;
    if (blockToPlace === Block.CACTUS && existing === Block.WATER) return;
    if (!this.canPlaceBlockAt(blockToPlace, place.x, place.y, place.z)) return;

    if (isDoorLowerBlock(blockToPlace)) {
      const upperBlock = getDoorUpperBlock(blockToPlace);
      const aboveExisting = this.world.getBlock(place.x, place.y + 1, place.z);
      if (upperBlock == null || (aboveExisting !== Block.AIR && aboveExisting !== Block.WATER && !isReplaceablePlacementBlock(aboveExisting))) {
        return;
      }
      const placedLower = this.world.setBlock(place.x, place.y, place.z, blockToPlace);
      if (!placedLower) return;
      this.world.setBlock(place.x, place.y + 1, place.z, upperBlock);
      this.scheduleFallingBlockCheck(place.x, place.y + 2, place.z);
      if (this.player.mode === "survival") {
        selected.slot.count -= 1;
        if (selected.slot.count <= 0) this.inventory.slots[selected.slotIndex] = null;
        this.renderInventory();
      }
      return;
    }

    const replacedFluid = existing === Block.WATER || isLava(existing) ? {
      block: existing,
      waterLevel: existing === Block.WATER ? this.world.getWaterLevel(place.x, place.y, place.z) : null,
      waterFalling: existing === Block.WATER ? this.world.isWaterFallingAt(place.x, place.y, place.z) : false,
      lavaLevel: isLava(existing) ? this.world.getLavaLevel(place.x, place.y, place.z) : null,
      lavaFalling: isLava(existing) ? this.world.isLavaFallingAt(place.x, place.y, place.z) : false,
    } : null;
    const placed = this.world.setBlock(place.x, place.y, place.z, blockToPlace);
    if (!placed) return;
    if (isWaterBreakableBlock(blockToPlace) && replacedFluid?.block === Block.WATER) {
      this.world.setBlock(place.x, place.y, place.z, Block.WATER, {
        waterLevel: replacedFluid.waterLevel ?? 0,
        waterFalling: replacedFluid.waterFalling,
        isSource: (replacedFluid.waterLevel ?? 0) === 0 && !replacedFluid.waterFalling,
      });
    }
    this.updateUnsupportedPlantsAround(place.x, place.y, place.z, this.player.mode === "survival");
    this.scheduleFallingBlockCheck(place.x, place.y + 1, place.z);
    if (isFallingGravityBlock(blockToPlace)) this.scheduleFallingBlockCheck(place.x, place.y, place.z);
    if (this.player.mode !== "survival") return;

    selected.slot.count -= 1;
    if (selected.slot.count <= 0) this.inventory.slots[selected.slotIndex] = null;
    this.renderInventory();
  }

  getTrapdoorPlacementBlockForHit(itemId, hit, open = false) {
    if (itemId !== "trapdoor" && itemId !== "iron_trapdoor") return null;
    const normal = hit.normal ?? new THREE.Vector3(0, 1, 0);
    const half = Math.abs(normal.y) > 0.5
      ? (normal.y > 0 ? "bottom" : "top")
      : ((hit.local?.y ?? 0.5) >= 0.5 ? "top" : "bottom");
    const side = Math.abs(normal.y) > 0.5 ? this.getTrapdoorSideFromView() : getTrapdoorSideFromPlacementNormal(normal);
    return getTrapdoorPlacementBlock(itemId, half, side, open);
  }

  getTrapdoorSideFromView() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    if (Math.abs(direction.x) > Math.abs(direction.z)) {
      return direction.x > 0 ? "west" : "east";
    }
    return direction.z > 0 ? "north" : "south";
  }

  canPlaceBlockAt(block, x, y, z) {
    if (block === Block.CACTUS) return this.canCactusStayAt(x, y, z);
    if (block === Block.VINE) return this.canVineStayAt(x, y, z);
    if (block === Block.WATERLILY) return this.canWaterlilyStayAt(x, y, z);
    const extraId = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
    if (extraId === "torch_on") return this.canTorchOccupyAt(x, y, z) && this.canFloorTorchStayAt(x, y, z);
    if (getWallTorchSupportOffset(block)) return this.canTorchOccupyAt(x, y, z) && this.canWallTorchStayAt(block, x, y, z);
    if (extraId === "ladder") return this.canLadderStayAt(x, y, z);
    return true;
  }

  canTorchOccupyAt(x, y, z) {
    const block = this.world.getBlock(x, y, z);
    return !isLava(block);
  }

  canCactusStayAt(x, y, z) {
    const below = this.world.getBlock(x, y - 1, z);
    if (!isCactusBaseBlock(below)) return false;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighbor = this.world.getBlock(x + dx, y, z + dz);
      if (isSolid(neighbor) || isWater(neighbor)) return false;
    }
    return true;
  }

  canVineStayAt(x, y, z) {
    if (this.world.getBlock(x, y + 1, z) === Block.VINE) return true;
    for (const [dx, dz] of HORIZONTAL_DIRECTIONS) {
      if (isVineSupportBlock(this.world.getBlock(x + dx, y, z + dz))) return true;
    }
    return false;
  }

  canTallGrassStayAt(x, y, z) {
    return isSolid(this.world.getBlock(x, y - 1, z));
  }

  canSugarCaneStayAt(x, y, z) {
    const below = this.world.getBlock(x, y - 1, z);
    return isSolid(below) || below === Block.SUGAR_CANE;
  }

  canWaterlilyStayAt(x, y, z) {
    return this.world.getBlock(x, y - 1, z) === Block.WATER;
  }

  canLadderStayAt(x, y, z) {
    for (const [dx, dz] of HORIZONTAL_DIRECTIONS) {
      if (isFaceOccluding(this.world.getBlock(x + dx, y, z + dz))) return true;
    }
    return false;
  }

  canFloorTorchStayAt(x, y, z) {
    return isFaceOccluding(this.world.getBlock(x, y - 1, z));
  }

  canWallTorchStayAt(block, x, y, z) {
    const supportOffset = getWallTorchSupportOffset(block);
    if (!supportOffset) return false;
    return isFaceOccluding(this.world.getBlock(x + supportOffset[0], y + supportOffset[1], z + supportOffset[2]));
  }

  updateUnsupportedPlantsAround(x, y, z, dropItems = false) {
    const queue = [];
    const queued = new Set();
    const enqueue = (px, py, pz) => {
      if (py <= 0 || py >= WORLD_HEIGHT) return;
      const key = `${px},${py},${pz}`;
      if (queued.has(key)) return;
      queued.add(key);
      queue.push({ x: px, y: py, z: pz });
    };
    const enqueueAround = (px, py, pz) => {
      for (let oy = -1; oy <= 2; oy += 1) {
        enqueue(px, py + oy, pz);
        for (const [dx, dz] of HORIZONTAL_DIRECTIONS) enqueue(px + dx, py + oy, pz + dz);
      }
    };

    enqueueAround(x, y, z);
    let checks = 0;
    while (queue.length > 0 && checks < 160) {
      checks += 1;
      const next = queue.shift();
      const block = this.world.getBlock(next.x, next.y, next.z);
      const extraId = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id ?? "";
      const wallTorchDir = getWallTorchSupportOffset(block);
      const unsupported =
        (block === Block.CACTUS && !this.canCactusStayAt(next.x, next.y, next.z)) ||
        (block === Block.VINE && !this.canVineStayAt(next.x, next.y, next.z)) ||
        (block === Block.TALL_GRASS && !this.canTallGrassStayAt(next.x, next.y, next.z)) ||
        (block === Block.SUGAR_CANE && !this.canSugarCaneStayAt(next.x, next.y, next.z)) ||
        (block === Block.WATERLILY && !this.canWaterlilyStayAt(next.x, next.y, next.z)) ||
        (extraId === "ladder" && !this.canLadderStayAt(next.x, next.y, next.z)) ||
        (extraId === "torch_on" && !this.canFloorTorchStayAt(next.x, next.y, next.z)) ||
        (wallTorchDir != null && !this.canWallTorchStayAt(block, next.x, next.y, next.z));
      if (!unsupported) continue;

      const removed = this.world.setBlock(next.x, next.y, next.z, Block.AIR);
      if (!removed) continue;
      if (dropItems) {
        const drop = getBlockDrop(block);
        if (drop) this.spawnDroppedItem(drop, 1, new THREE.Vector3(next.x + 0.5, next.y + 0.45, next.z + 0.5));
      }
      enqueueAround(next.x, next.y, next.z);
    }
  }

  getSelectedPlaceStack() {
    if (this.player.mode === "spectator") return null;

    const slotIndex = HOTBAR_START + this.selectedHotbar;
    const slot = this.inventory.slots[slotIndex];
    const block = slot ? ITEMS[slot.id]?.block : null;
    return block ? { slot, slotIndex, block } : null;
  }

  updateTargetLabel() {
    if (!this.started || this.inventoryOpen || this.paused || this.chatOpen) {
      this.targetLabel.classList.remove("is-visible");
      return;
    }

    const hit = this.raycastBlock({ includeWater: true });
    const name = hit ? BLOCKS[hit.block]?.name : null;
    this.targetLabel.textContent = name ?? "";
    this.targetLabel.classList.toggle("is-visible", Boolean(name));
  }

  updateTargetOutline() {
    if (!this.targetOutline) return;
    if (!this.started || this.inventoryOpen || this.paused || this.chatOpen || this.player?.mode === "spectator") {
      this.targetOutline.visible = false;
      return;
    }

    const hit = this.raycastBlock();
    if (!hit || hit.block === Block.AIR || hit.block === Block.WATER || isLava(hit.block)) {
      this.targetOutline.visible = false;
      return;
    }

    const boxes = getSelectionBoxesForBlock(hit.block);
    const shapeKey = `${hit.block}:${boxes.map(outlineBoxKey).join("|")}`;
    if (shapeKey !== this.targetOutlineShapeKey) {
      this.targetOutline.geometry.dispose();
      this.targetOutline.geometry = createSelectionOutlineGeometry(boxes);
      this.targetOutlineShapeKey = shapeKey;
    }
    this.targetOutline.position.set(hit.position.x + 0.5, hit.position.y + 0.5, hit.position.z + 0.5);
    this.targetOutline.visible = true;
  }

  updateCoordinatesStatus() {
    if (!this.player || !this.coordinatesStatus) return;
    const x = Math.floor(this.player.position.x);
    const y = Math.floor(this.player.position.y);
    const z = Math.floor(this.player.position.z);
    this.coordinatesStatus.textContent = `XYZ: ${x} / ${y} / ${z}`;
  }

  updateUnderwaterView() {
    const underwater = Boolean(this.started && this.player?.eyeInWater);

    if (underwater && this.player) {
      const eyeY = this.player.position.y + PLAYER_EYE_HEIGHT;
      const depth = Math.max(0, SEA_LEVEL + 1 - eyeY);
      const opacity = Math.min(0.52, 0.28 + depth * 0.012);
      this.underwaterOverlay.style.setProperty("--underwater-opacity", opacity.toFixed(3));
    }

    if (underwater === this.isUnderwaterView) return;
    this.isUnderwaterView = underwater;
    this.underwaterOverlay.classList.toggle("is-visible", underwater);
    this.updateFogForView();
  }

  updateFogForView() {
    if (this.isUnderwaterView) {
      this.scene.fog.color.copy(this.underwaterFog.color);
      this.scene.fog.near = this.underwaterFog.near;
      this.scene.fog.far = this.underwaterFog.far;
      FOG_UNIFORMS.fogEdgeEnabled.value = 0;
      FOG_UNIFORMS.fogRadialStrength.value = 1;
      this.renderer.setClearColor(DEFAULT_WATER_TINT);
    } else if (this.nightVisionActive) {
      this.scene.fog.color.copy(this.defaultFog.color);
      this.scene.fog.near = this.defaultFog.near;
      this.scene.fog.far = this.defaultFog.far;
      FOG_UNIFORMS.fogEdgeEnabled.value = 1;
      FOG_UNIFORMS.fogRadialStrength.value = 1;
      this.renderer.setClearColor(this.currentClearColor ?? 0x8fc7ee);
    } else {
      const night = clamp(this.skyNightFactor ?? 0, 0, 1);
      const strength = clamp(this.precipitationStrength ?? 0, this.weather === "clear" ? 0 : 0.3, 1);
      const stormFog = this.weather === "clear" ? 0 : (this.weather === "thunder" ? 0.62 : 0.38) * strength;
      const rainFogTint = new THREE.Color(0x81909a).lerp(new THREE.Color(0x050b14), night);
      const thunderFogTint = new THREE.Color(0x47505a).lerp(new THREE.Color(0x04070d), night);
      const fogTint = this.weather === "clear"
        ? this.defaultFog.color
        : (this.weather === "thunder" ? thunderFogTint : rainFogTint);
      this.scene.fog.color.copy(this.defaultFog.color).lerp(fogTint, stormFog * 0.55);
      this.scene.fog.near = lerp(this.defaultFog.near, Math.max(8, this.defaultFog.near * 0.45), stormFog);
      this.scene.fog.far = lerp(this.defaultFog.far, Math.max(44, this.defaultFog.far * 0.54), stormFog);
      FOG_UNIFORMS.fogEdgeEnabled.value = 1;
      FOG_UNIFORMS.fogRadialStrength.value = 1;
      this.renderer.setClearColor(this.currentClearColor ?? 0x8fc7ee);
    }
    this.updateChunkEdgeFogBounds();
    syncWorldFogUniforms(this.scene.fog);
  }

  updateChunkEdgeFogBounds() {
    if (!this.player) return;
    const activeRenderDistance = this.started ? this.renderDistance : TITLE_RENDER_DISTANCE;
    const chunkX = Math.floor(this.player.position.x / CHUNK_SIZE);
    const chunkZ = Math.floor(this.player.position.z / CHUNK_SIZE);
    FOG_UNIFORMS.fogEdgeBounds.value.set(
      (chunkX - activeRenderDistance) * CHUNK_SIZE,
      (chunkZ - activeRenderDistance) * CHUNK_SIZE,
      (chunkX + activeRenderDistance + 1) * CHUNK_SIZE,
      (chunkZ + activeRenderDistance + 1) * CHUNK_SIZE,
    );
    FOG_UNIFORMS.fogEdgeWidth.value = clamp(activeRenderDistance * CHUNK_SIZE * 0.28, 32, 64);
  }

  animateWater(timeSeconds) {
    if (!this.world) return;

    // Keep water shader uniforms in sync with sky state
    WATER_MATERIAL.uniforms.time.value = timeSeconds;
    if (this.skyMaterial) {
      WATER_MATERIAL.uniforms.skyTint.value.copy(this.skyMaterial.uniforms.horizonColor.value);
    }

    this.animateLiquidTexture(WATER_TEXTURE, timeSeconds, true);
    this.animateLiquidTexture(LAVA_TEXTURE, timeSeconds * 0.75, false);

    const pcx = this.player ? Math.floor(this.player.position.x / CHUNK_SIZE) : 0;
    const pcz = this.player ? Math.floor(this.player.position.z / CHUNK_SIZE) : 0;

    for (const chunk of this.world.chunks.values()) {
      if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) > WATER_WAVE_ANIMATION_CHUNKS) continue;
      this.animateLiquidMesh(chunk.waterMesh, timeSeconds, 1);
      this.animateLiquidMesh(chunk.lavaMesh, timeSeconds * 0.65, 0.45);
    }
  }

  animateLiquidTexture(texture, timeSeconds, useWaterFallback) {
    const frameCount = Math.max(1, texture.userData.frameCount ?? 32);
    const frame = Math.floor(timeSeconds * WATER_ANIMATION_FRAMES_PER_SECOND) % frameCount;
    if (texture.userData.frame === frame) return;

    if (texture.userData.sourceImage) {
      drawLiquidFrame(texture, frame);
    } else if (useWaterFallback && !texture.userData.staticAtlas) {
      drawAnimatedWaterTexture(texture.userData.ctx, texture.userData.size, frame);
    }
    texture.userData.frame = frame;
    texture.needsUpdate = true;
  }

  animateLiquidMesh(mesh, timeSeconds, amplitude = 1) {
    if (!mesh) return;
    const position = mesh.geometry.getAttribute("position");
    const wave = mesh.geometry.getAttribute("waterWave");
    if (!position || !wave) return;
    if (!mesh.geometry.userData.basePositions) {
      mesh.geometry.userData.basePositions = position.array.slice();
    }
    const base = mesh.geometry.userData.basePositions;

    for (let i = 0; i < position.count; i += 1) {
      const offset = i * 3;
      if (wave.getX(i) <= 0) {
        position.array[offset + 1] = base[offset + 1];
        continue;
      }
      const x = base[offset];
      const z = base[offset + 2];
      const ripple =
        Math.sin((x + z) * 1.6 + timeSeconds * 1.55) * 0.018 +
        Math.sin((x - z) * 2.2 + timeSeconds * 0.95) * 0.011;
      position.array[offset + 1] = base[offset + 1] + ripple * amplitude;
    }

    position.needsUpdate = true;
  }

  startMining() {
    this.isMining = true;
    this.miningTarget = null;
    this.miningElapsed = 0;
    this.miningBreakCooldown = 0;
    this.handBreakElapsed = 0;
  }

  stopMining() {
    this.isMining = false;
    this.miningTarget = null;
    this.miningElapsed = 0;
    this.miningBreakCooldown = 0;
    this.handBreakElapsed = 0;
    this.breakMeter.classList.remove("is-visible");
    this.breakMeterFill.style.width = "0%";
    this.hideBreakOverlay();
  }

  updateMining(dt) {
    if (!this.isMining || this.player.mode !== "survival") return;
    if (this.miningBreakCooldown > 0) {
      this.miningBreakCooldown = Math.max(0, this.miningBreakCooldown - dt);
      this.breakMeter.classList.remove("is-visible");
      this.hideBreakOverlay();
      return;
    }
    const hit = this.raycastBlock();

    if (!hit || hit.block === Block.BEDROCK) {
      this.miningTarget = null;
      this.miningElapsed = 0;
      this.breakMeter.classList.remove("is-visible");
      this.hideBreakOverlay();
      return;
    }

    const target = blockPositionKey(hit.position);
    if (target !== this.miningTarget) {
      this.miningTarget = target;
      this.miningElapsed = 0;
    }

    const breakTime = getBlockBreakTime(hit.block, this.getSelectedHotbarStack()?.slot?.id);
    this.miningElapsed += dt;
    const progress = clamp(this.miningElapsed / breakTime, 0, 1);
    this.breakMeter.classList.add("is-visible");
    this.breakMeterFill.style.width = `${progress * 100}%`;
    this.showBreakOverlay(hit, progress);

    if (progress >= 1) {
      this.finishBreakingBlock(hit);
      this.miningTarget = null;
      this.miningElapsed = 0;
      this.miningBreakCooldown = SURVIVAL_BLOCK_BREAK_DELAY_SECONDS;
      this.hideBreakOverlay();
    }
  }

  showBreakOverlay(hit, progress) {
    const stage = clamp(Math.floor(progress * CRACK_TEXTURES.length), 0, CRACK_TEXTURES.length - 1);
    const bounds = getSelectionBoundsForBlock(hit.block);
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const centerY = (bounds.minY + bounds.maxY) * 0.5;
    const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
    const expand = 0.018;
    this.breakOverlay.position.set(hit.position.x + centerX, hit.position.y + centerY, hit.position.z + centerZ);
    this.breakOverlay.scale.set(
      Math.max(0.02, bounds.maxX - bounds.minX + expand),
      Math.max(0.02, bounds.maxY - bounds.minY + expand),
      Math.max(0.02, bounds.maxZ - bounds.minZ + expand),
    );
    this.breakMaterial.color.setHex(getBreakOverlayTintColor(hit.block, hit.normal));
    this.breakOverlay.visible = true;
    if (stage !== this.breakStage) {
      this.breakStage = stage;
      this.breakMaterial.map = CRACK_TEXTURES[stage];
      this.breakMaterial.needsUpdate = true;
    }
  }

  hideBreakOverlay() {
    if (this.breakOverlay) this.breakOverlay.visible = false;
  }

  finishBreakingBlock(hit) {
    const brokenBlock = hit.block;
    const removed = this.world.setBlock(hit.position.x, hit.position.y, hit.position.z, Block.AIR);
    if (!removed) return;
    if (isFurnaceBlock(brokenBlock)) this.furnaces.delete(blockPositionKey(hit.position));

    this.spawnBlockBreakParticles(brokenBlock, hit.position, hit.normal);

    if (isDoorLowerBlock(brokenBlock)) {
      this.world.setBlock(hit.position.x, hit.position.y + 1, hit.position.z, Block.AIR);
    } else if (isDoorUpperBlock(brokenBlock)) {
      this.world.setBlock(hit.position.x, hit.position.y - 1, hit.position.z, Block.AIR);
    }

    if (this.player.mode === "survival") {
      const heldId = this.getSelectedHotbarStack()?.slot?.id ?? null;
      const drop = getBlockDrop(brokenBlock, heldId);
      if (drop) {
        const dropPosition = new THREE.Vector3(hit.position.x + 0.5, hit.position.y + 0.56, hit.position.z + 0.5);
        const dropVelocity = new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          1.8 + Math.random() * 0.7,
          (Math.random() - 0.5) * 1.2,
        );
        this.spawnDroppedItem(drop, 1, dropPosition, dropVelocity, { pickupDelay: ITEM_PICKUP_DELAY_SECONDS });
      }
    }
    this.updateUnsupportedPlantsAround(hit.position.x, hit.position.y, hit.position.z, this.player.mode === "survival");
    this.scheduleFallingBlockCheck(hit.position.x, hit.position.y + 1, hit.position.z);
  }

  scheduleFallingBlockCheck(x, y, z) {
    if (!this.fallingBlockQueue) this.fallingBlockQueue = [];
    if (!this.fallingBlockQueued) this.fallingBlockQueued = new Set();
    const key = `${x},${y},${z}`;
    if (this.fallingBlockQueued.has(key)) return;
    this.fallingBlockQueued.add(key);
    this.fallingBlockQueue.push({ x, y, z, key });
  }

  updateFallingBlockChecks() {
    if (!this.fallingBlockQueue?.length) return;
    const queue = this.fallingBlockQueue;
    this.fallingBlockQueue = [];
    for (const item of queue) {
      this.fallingBlockQueued?.delete(item.key);
      const block = this.world.getBlock(item.x, item.y, item.z);
      if (!isFallingGravityBlock(block)) continue;
      const belowBlock = this.world.getBlock(item.x, item.y - 1, item.z);
      if (isFallingBlockFragile(belowBlock)) {
        this.destroyFallingBlockFragileAt(item.x, item.y - 1, item.z);
      } else if (belowBlock !== Block.AIR) {
        continue;
      }
      this.world.setBlock(item.x, item.y, item.z, Block.AIR);
      this.spawnFallingBlock(block, item.x, item.y, item.z);
      this.scheduleFallingBlockCheck(item.x, item.y + 1, item.z);
    }
  }

  destroyFallingBlockFragileAt(x, y, z) {
    const block = this.world.getBlock(x, y, z);
    if (!isFallingBlockFragile(block)) return false;
    const removed = this.world.setBlock(x, y, z, Block.AIR);
    if (!removed) return false;
    this.spawnBlockBreakParticles(block, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0));
    this.updateUnsupportedPlantsAround(x, y, z, false);
    return true;
  }

  handleFluidBreakBlock(block, x, y, z) {
    if (!isWaterBreakableBlock(block)) return;
    this.spawnBlockBreakParticles(block, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0));
    const drop = getBlockDrop(block);
    if (drop) {
      this.spawnDroppedItem(
        drop,
        1,
        new THREE.Vector3(x + 0.5, y + 0.42, z + 0.5),
        new THREE.Vector3((Math.random() - 0.5) * 0.45, 0.7, (Math.random() - 0.5) * 0.45),
        { pickupDelay: ITEM_PICKUP_DELAY_SECONDS },
      );
    }
  }

  spawnFallingBlock(block, x, y, z) {
    if (!this.fallingBlocks) this.fallingBlocks = [];
    const entity = new FallingBlock(this, block, x, y, z);
    this.scene.add(entity.mesh);
    this.fallingBlocks.push(entity);
  }

  updateFallingBlocks(dt) {
    this.updateFallingBlockChecks();
    if (!this.fallingBlocks?.length) return;
    for (let index = this.fallingBlocks.length - 1; index >= 0; index -= 1) {
      const entity = this.fallingBlocks[index];
      const alive = entity.update(dt);
      if (!alive) {
        this.fallingBlocks.splice(index, 1);
        entity.dispose();
      }
    }
  }

  clearFallingBlocks() {
    if (!this.fallingBlocks) return;
    for (const entity of this.fallingBlocks) entity.dispose();
    this.fallingBlocks.length = 0;
  }

  createDroppedItemMaterial(id) {
    let texture = this.droppedItemTextures.get(id);
    const sprite = ITEM_SPRITES.get(id);
    if (!texture && sprite) {
      texture = new THREE.TextureLoader().load(sprite);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.droppedItemTextures.set(id, texture);
    }

    const textured = Boolean(texture);
    return new THREE.SpriteMaterial({
      map: texture ?? null,
      color: textured ? 0xffffff : (ITEMS[id]?.color ?? 0xffffff),
      transparent: textured,
      alphaTest: textured ? 0.1 : 0,
      depthWrite: true,
      depthTest: true,
    });
  }

  createBlockParticleTexture(block, faceName = "py") {
    const textureKey = getFaceTextureKey(block, faceName);
    const region = BLOCK_ATLAS.regions.get(textureKey) ?? BLOCK_ATLAS.regions.get("stone");
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_TILE_SIZE;
    canvas.height = ATLAS_TILE_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(BLOCK_ATLAS.canvas, region.x, region.y, region.size, region.size, 0, 0, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    return texture;
  }

  getBlockParticleTexture(block, normal = null) {
    const faceName = faceNameFromNormal(normal) ?? "py";
    const key = `${block}:${faceName}`;
    let texture = this.breakParticleTextures.get(key);
    if (!texture) {
      texture = this.createBlockParticleTexture(block, faceName);
      this.breakParticleTextures.set(key, texture);
    }
    return texture;
  }

  spawnBlockBreakParticles(block, position, normal = null) {
    if (!block || block === Block.AIR || block === Block.WATER) return;
    const texture = this.getBlockParticleTexture(block, normal);

    for (let i = 0; i < BLOCK_BREAK_PARTICLE_COUNT; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        alphaTest: 0.08,
        depthWrite: true,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      const offset = new THREE.Vector3(Math.random(), Math.random(), Math.random());
      sprite.position.set(position.x + offset.x, position.y + offset.y, position.z + offset.z);
      const scale = randomRange(0.07, 0.12);
      sprite.scale.set(scale, scale, 1);
      sprite.renderOrder = 4;

      const burst = offset.clone().subScalar(0.5);
      if (burst.lengthSq() < 0.001) burst.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5);
      burst.normalize();
      const normalBoost = normal ? normal.clone().multiplyScalar(randomRange(0.45, 1.15)) : new THREE.Vector3();
      const velocity = burst.multiplyScalar(randomRange(1.3, 3.2)).add(normalBoost);
      velocity.y += randomRange(1.15, 2.8);

      this.scene.add(sprite);
      this.breakParticles.push({
        sprite,
        velocity,
        age: 0,
        life: randomRange(BLOCK_BREAK_PARTICLE_LIFE_MIN, BLOCK_BREAK_PARTICLE_LIFE_MAX),
        spin: randomRange(-7, 7),
      });
    }
  }

  updateBlockBreakParticles(dt) {
    for (let index = this.breakParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.breakParticles[index];
      particle.age += dt;
      if (particle.age >= particle.life) {
        this.removeBlockBreakParticleAt(index);
        continue;
      }

      particle.velocity.y -= 9.8 * dt;
      particle.velocity.multiplyScalar(Math.pow(0.82, dt * TICKS_PER_SECOND));
      particle.sprite.position.addScaledVector(particle.velocity, dt);
      particle.sprite.material.rotation += particle.spin * dt;
      particle.sprite.material.opacity = clamp(1 - particle.age / particle.life, 0, 1);
    }
  }

  removeBlockBreakParticleAt(index) {
    const [particle] = this.breakParticles.splice(index, 1);
    if (!particle) return;
    this.scene.remove(particle.sprite);
    particle.sprite.material.dispose();
  }

  clearBlockBreakParticles() {
    if (!this.breakParticles) return;
    for (let index = this.breakParticles.length - 1; index >= 0; index -= 1) {
      this.removeBlockBreakParticleAt(index);
    }
  }

  spawnDroppedItem(id, count, position, velocity = new THREE.Vector3(), options = {}) {
    if (!ITEMS[id] || count <= 0) return null;
    let remaining = count;
    const maxStack = ITEMS[id].maxStack ?? 64;

    for (const item of this.droppedItems) {
      if (remaining <= 0) break;
      if (item.id !== id || item.count >= maxStack) continue;
      if (item.position.distanceToSquared(position) > 1.1) continue;
      const moved = Math.min(maxStack - item.count, remaining);
      item.count += moved;
      item.pickupDelay = Math.max(item.pickupDelay, options.pickupDelay ?? ITEM_PICKUP_DELAY_SECONDS);
      item.velocity.addScaledVector(velocity, moved / Math.max(1, count));
      remaining -= moved;
    }

    if (remaining <= 0) return null;
    const item = new DroppedItem(this, id, remaining, position, velocity, options);
    this.droppedItems.push(item);
    this.scene.add(item.sprite);
    return item;
  }

  updateDroppedItems(dt) {
    for (let index = this.droppedItems.length - 1; index >= 0; index -= 1) {
      const item = this.droppedItems[index];
      const alive = item.update(dt);
      const pickedUp = alive && this.tryPickupDroppedItem(item);
      if (!alive || pickedUp) this.removeDroppedItemAt(index);
    }
  }

  tryPickupDroppedItem(item) {
    if (!this.player || this.player.mode === "spectator" || item.pickupDelay > 0) return false;
    if (!item.pickupBoundsOverlap(this.player)) return false;

    const remaining = this.inventory.addItem(item.id, item.count);
    if (remaining === item.count) return false;
    item.count = remaining;
    this.renderInventory();
    if (remaining <= 0) return true;

    item.pickupDelay = ITEM_PICKUP_DELAY_SECONDS;
    return false;
  }

  removeDroppedItemAt(index) {
    const [item] = this.droppedItems.splice(index, 1);
    item?.dispose();
  }

  clearDroppedItems() {
    if (!this.droppedItems) return;
    for (const item of this.droppedItems) item.dispose();
    this.droppedItems.length = 0;
  }

  clearMobs() {
    if (!this.mobs) return;
    for (const mob of this.mobs) mob.dispose();
    this.mobs.length = 0;
  }

  spawnMob(species, position) {
    const Cls = MOB_CLASSES[species];
    if (!Cls) return null;
    const mob = new Cls(this.world, position);
    this.scene.add(mob.root);
    this.mobs.push(mob);
    return mob;
  }

  findPassiveMobSpawnPosition(wx, wz) {
    const groundY = this.world.terrainHeight(wx, wz);
    if (groundY <= WATER_LEVEL || groundY >= WORLD_HEIGHT - 4) return null;

    const ground = this.world.getBlock(wx, groundY, wz);
    if (!isSpawnGround(ground)) return null;
    if (this.world.getBlock(wx, groundY + 1, wz) !== Block.AIR) return null;
    if (this.world.getBlock(wx, groundY + 2, wz) !== Block.AIR) return null;

    return new THREE.Vector3(wx + 0.5, groundY + 1.0, wz + 0.5);
  }

  attemptPassiveMobSpawn() {
    if (this.mobs.length >= MAX_PASSIVE_MOBS) return 0;
    if (!this.player) return 0;
    const minRadius = 14;
    const maxRadius = 40;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      const wx = Math.floor(this.player.position.x + Math.sin(angle) * radius);
      const wz = Math.floor(this.player.position.z + Math.cos(angle) * radius);
      const centerPosition = this.findPassiveMobSpawnPosition(wx, wz);
      if (!centerPosition) continue;

      const biome = this.world.biomeAt(wx, wz);
      const species = pickPassiveMobForBiome(biome);
      if (!species) continue;

      const herdTarget = Math.min(
        MAX_PASSIVE_MOBS - this.mobs.length,
        PASSIVE_MOB_HERD_MIN + Math.floor(Math.random() * (PASSIVE_MOB_HERD_MAX - PASSIVE_MOB_HERD_MIN + 1)),
      );
      let spawned = 0;
      for (let herdAttempt = 0; herdAttempt < herdTarget * 7 && spawned < herdTarget; herdAttempt += 1) {
        let sx = wx;
        let sz = wz;
        if (herdAttempt > 0) {
          const spreadAngle = Math.random() * Math.PI * 2;
          const spread = 1 + Math.random() * PASSIVE_MOB_HERD_RADIUS;
          sx += Math.round(Math.sin(spreadAngle) * spread);
          sz += Math.round(Math.cos(spreadAngle) * spread);
        }

        const position = herdAttempt === 0 ? centerPosition.clone() : this.findPassiveMobSpawnPosition(sx, sz);
        if (!position) continue;
        if (this.mobs.some((mob) => !mob.removed && mob.position.distanceToSquared(position) < 1.0)) continue;

        const mob = this.spawnMob(species, position);
        if (!mob) continue;
        mob.yaw = Math.random() * Math.PI * 2;
        mob.targetYaw = mob.yaw;
        mob.applyTransform();
        spawned += 1;
      }
      if (spawned > 0) return spawned;
    }
    return 0;
  }

  verticalRangesOverlap(yA, heightA, yB, heightB) {
    return yA < yB + heightB && yA + heightA > yB;
  }

  mobCanMoveHorizontally(mob, dx, dz) {
    const beforeX = mob.position.x;
    const beforeZ = mob.position.z;
    mob.position.x += dx;
    mob.position.z += dz;
    const canMove = !mob.collides();
    mob.position.x = beforeX;
    mob.position.z = beforeZ;
    return canMove;
  }

  playerCanMoveHorizontally(dx, dz) {
    if (!this.player) return false;
    return !this.player.collidesAt(
      this.player.position.x + dx,
      this.player.position.y,
      this.player.position.z + dz,
    );
  }

  chooseMobPairPushDirection(a, b, nx, nz, probeDistance) {
    const candidates = [
      [nx, nz],
      [-nz, nx],
      [nz, -nx],
      [-nx, -nz],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [cx, cz] of candidates) {
      if (
        this.mobCanMoveHorizontally(a, cx * probeDistance, cz * probeDistance) ||
        this.mobCanMoveHorizontally(b, -cx * probeDistance, -cz * probeDistance)
      ) {
        return [cx, cz];
      }
    }
    return [nx, nz];
  }

  choosePlayerMobPushDirection(mob, nx, nz, probeDistance) {
    const candidates = [
      [nx, nz],
      [-nz, nx],
      [nz, -nx],
      [-nx, -nz],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [cx, cz] of candidates) {
      if (
        this.mobCanMoveHorizontally(mob, cx * probeDistance, cz * probeDistance) ||
        this.playerCanMoveHorizontally(-cx * probeDistance, -cz * probeDistance)
      ) {
        return [cx, cz];
      }
    }
    return [nx, nz];
  }

  pushMobPair(a, b) {
    if (a.dead || b.dead || a.removed || b.removed) return false;
    if (!this.verticalRangesOverlap(a.position.y, a.height, b.position.y, b.height)) return false;
    const minDistance = a.radius + b.radius;
    let dx = a.position.x - b.position.x;
    let dz = a.position.z - b.position.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= minDistance) return false;
    let separationDistance = distance;
    let exactOverlap = false;
    if (distance < 0.0001) {
      const angle = hashFloat(Math.floor(a.position.x * 16), Math.floor(a.position.z * 16), this.world.seed) * Math.PI * 2;
      dx = Math.sin(angle);
      dz = Math.cos(angle);
      separationDistance = 0;
      distance = 1;
      exactOverlap = true;
    }

    let nx = dx / distance;
    let nz = dz / distance;
    const push = (minDistance - separationDistance) * 0.52 + 0.002;
    if (exactOverlap) {
      [nx, nz] = this.chooseMobPairPushDirection(a, b, nx, nz, Math.min(0.35, push));
    }
    a.moveCollide("x", nx * push);
    a.moveCollide("z", nz * push);
    b.moveCollide("x", -nx * push);
    b.moveCollide("z", -nz * push);
    a.velocity.x += nx * 0.08;
    a.velocity.z += nz * 0.08;
    b.velocity.x -= nx * 0.08;
    b.velocity.z -= nz * 0.08;
    a.applyTransform();
    b.applyTransform();
    return true;
  }

  pushPlayerAndMob(mob) {
    if (!this.player || mob.dead || mob.removed) return false;
    if (this.player.mode === "spectator") return false;
    if (!this.verticalRangesOverlap(mob.position.y, mob.height, this.player.position.y, PLAYER_HEIGHT)) return false;
    const minDistance = mob.radius + PLAYER_RADIUS;
    let dx = mob.position.x - this.player.position.x;
    let dz = mob.position.z - this.player.position.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= minDistance) return false;
    let separationDistance = distance;
    let exactOverlap = false;
    if (distance < 0.0001) {
      const angle = this.player.yaw + Math.PI;
      dx = Math.sin(angle);
      dz = Math.cos(angle);
      separationDistance = 0;
      distance = 1;
      exactOverlap = true;
    }

    let nx = dx / distance;
    let nz = dz / distance;
    const overlap = minDistance - separationDistance;
    const mobPush = overlap * 0.62 + 0.002;
    const playerPush = overlap * 0.38;
    if (exactOverlap) {
      [nx, nz] = this.choosePlayerMobPushDirection(mob, nx, nz, Math.min(0.35, mobPush));
    }
    mob.moveCollide("x", nx * mobPush);
    mob.moveCollide("z", nz * mobPush);
    this.player.moveAxis("x", -nx * playerPush);
    this.player.moveAxis("z", -nz * playerPush);
    mob.velocity.x += nx * 0.12;
    mob.velocity.z += nz * 0.12;
    this.player.velocity.x -= nx * 0.04;
    this.player.velocity.z -= nz * 0.04;
    mob.applyTransform();
    this.camera.position.set(this.player.position.x, this.player.position.y + PLAYER_EYE_HEIGHT, this.player.position.z);
    return true;
  }

  resolveEntityPushes() {
    if (!this.mobs?.length) return;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < this.mobs.length; i += 1) {
        const mob = this.mobs[i];
        for (let j = i + 1; j < this.mobs.length; j += 1) {
          this.pushMobPair(mob, this.mobs[j]);
        }
        this.pushPlayerAndMob(mob);
      }
    }
  }

  updateMobs(dt) {
    if (!this.mobs.length && this.player && this.started && !this.paused) {
      this.mobSpawnTimer = Math.max(0, this.mobSpawnTimer - dt);
      if (this.mobSpawnTimer <= 0) {
        for (let i = 0; i < PASSIVE_MOB_INITIAL_HERDS; i += 1) this.attemptPassiveMobSpawn();
        this.mobSpawnTimer = PASSIVE_MOB_SPAWN_MIN_SECONDS;
      }
    } else {
      this.mobSpawnTimer = Math.max(0, this.mobSpawnTimer - dt);
      if (this.mobSpawnTimer <= 0) {
        this.attemptPassiveMobSpawn();
        this.mobSpawnTimer = PASSIVE_MOB_SPAWN_MIN_SECONDS + Math.random() * (PASSIVE_MOB_SPAWN_MAX_SECONDS - PASSIVE_MOB_SPAWN_MIN_SECONDS);
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i -= 1) {
      const mob = this.mobs[i];
      const alive = mob.update(dt, { player: this.player });

      // Despawn mobs the player has wandered far from.
      if (this.player && mob.position.distanceTo(this.player.position) > 96) {
        mob.removed = true;
      }

      if (mob.removed) {
        if (mob._pendingDrops) {
          for (const drop of mob._pendingDrops) {
            const dropPos = new THREE.Vector3(mob.position.x, mob.position.y + 0.5, mob.position.z);
            const dropVel = new THREE.Vector3(
              (Math.random() - 0.5) * 1.6,
              1.6 + Math.random() * 0.6,
              (Math.random() - 0.5) * 1.6,
            );
            this.spawnDroppedItem(drop.id, drop.count, dropPos, dropVel, { pickupDelay: 0.6 });
          }
          mob._pendingDrops = null;
        }
        mob.dispose();
        this.mobs.splice(i, 1);
      }
    }

    this.resolveEntityPushes();
  }

  cameraToBlockDistance(blockHit) {
    if (!blockHit) return Infinity;
    const center = new THREE.Vector3(blockHit.position.x + 0.5, blockHit.position.y + 0.5, blockHit.position.z + 0.5);
    return center.distanceTo(this.camera.position);
  }

  raycastMob(maxDistance = INTERACTION_REACH) {
    if (!this.mobs.length) return null;
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    direction.normalize();
    const origin = this.camera.position.clone();
    let nearest = null;
    let nearestT = Infinity;
    for (const mob of this.mobs) {
      if (mob.dead || mob.removed) continue;
      const t = rayIntersectsMob(mob, origin, direction, maxDistance);
      if (t === null || t === undefined) continue;
      if (t < nearestT) {
        nearestT = t;
        nearest = mob;
      }
    }
    return nearest ? { mob: nearest, distance: nearestT } : null;
  }

  attackMob(mob) {
    const sourcePos = new THREE.Vector3(this.player.position.x, this.player.position.y + PLAYER_EYE_HEIGHT * 0.55, this.player.position.z);
    const itemId = this.getSelectedHotbarStack()?.slot?.id;
    const damage = ITEMS[itemId]?.weaponDamage ?? 1;
    mob.takeHit(damage, sourcePos, clamp(damage / 2, 1, 4));
    this.triggerHandSwing();
  }

  updateMobPlayerContact(dt) {
    // Passive mobs (chicken/pig/cow) don't attack the player. This hook
    // exists so when we add hostile mobs later they can deal damage on
    // contact and apply knockback to the camera.
  }

  triggerDamageFlash(strength = 1) {
    this.damageFlashTimer = Math.min(0.6, 0.4 * strength);
    if (this.damageFlash) {
      this.damageFlash.classList.remove("is-active");
      // Force reflow so the animation can replay.
      void this.damageFlash.offsetWidth;
      this.damageFlash.classList.add("is-active");
    }
  }

  updateDamageFlash(dt) {
    this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
  }

  dropSelectedItem(fullStack = false) {
    if (!this.started || this.paused || this.inventoryOpen || this.chatOpen || this.player.mode === "spectator") return false;

    let itemId = null;
    let dropCount = 1;
    if (this.player.mode === "creative") {
      const slot = this.inventory.slots[HOTBAR_START + this.selectedHotbar];
      itemId = slot?.id ?? null;
      dropCount = fullStack ? (slot?.count ?? 1) : 1;
    } else {
      const slotIndex = HOTBAR_START + this.selectedHotbar;
      const slot = this.inventory.slots[slotIndex];
      if (!slot) return false;
      itemId = slot.id;
      dropCount = fullStack ? slot.count : 1;
      slot.count -= dropCount;
      if (slot.count <= 0) this.inventory.slots[slotIndex] = null;
      this.renderInventory();
    }

    if (!itemId) return false;
    this.spawnThrownItemStack(itemId, dropCount);
    return true;
  }

  raycastBlock(options = {}) {
    const includeWater = options.includeWater ?? false;
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const origin = this.camera.position.clone();
    let previousAirBlock = null;

    for (let distance = 0; distance <= INTERACTION_REACH; distance += 0.05) {
      const point = origin.clone().addScaledVector(direction, distance);
      const blockPosition = new THREE.Vector3(
        Math.floor(point.x),
        Math.floor(point.y),
        Math.floor(point.z),
      );
      const block = this.world.getBlock(blockPosition.x, blockPosition.y, blockPosition.z);
      const customShape = getBlockShapeForBlock(block);
      const localX = point.x - blockPosition.x;
      const localY = point.y - blockPosition.y;
      const localZ = point.z - blockPosition.z;
      const hitsSolid = !customShape && isSolid(block) && pointInsideBlockBounds(block, blockPosition.x, blockPosition.y, blockPosition.z, point);
      const hitsPlant = isPlant(block) && pointInsideBlockBounds(block, blockPosition.x, blockPosition.y, blockPosition.z, point);
      const hitsWater = includeWater && isWater(block);
      const hitsLava = includeWater && isLava(block);
      const hitsCustom = customShape ? pointInsideShape(customShape, localX, localY, localZ) : false;

      if (hitsSolid || hitsPlant || hitsWater || hitsLava || hitsCustom) {
        if (!previousAirBlock) {
          return {
            position: blockPosition,
            normal: new THREE.Vector3(0, 1, 0),
            placePosition: null,
            block,
            point: point.clone(),
            local: new THREE.Vector3(localX, localY, localZ),
          };
        }

        const normal = previousAirBlock.clone().sub(blockPosition);
        normal.x = clamp(normal.x, -1, 1);
        normal.y = clamp(normal.y, -1, 1);
        normal.z = clamp(normal.z, -1, 1);
        if (normal.lengthSq() === 0) normal.set(0, 1, 0);
        return {
          position: blockPosition,
          normal,
          placePosition: previousAirBlock.clone(),
          block,
          point: point.clone(),
          local: new THREE.Vector3(localX, localY, localZ),
        };
      }

      if ((block === Block.AIR || isWater(block) || isLava(block) || isReplaceablePlacementBlock(block)) && !hitsCustom) {
        previousAirBlock = blockPosition;
      }
    }

    return null;
  }

  intersectsPlayer(x, y, z, block = Block.STONE) {
    return blockIntersectsAabb(
      block,
      x,
      y,
      z,
      this.player.position.x - PLAYER_RADIUS,
      this.player.position.y,
      this.player.position.z - PLAYER_RADIUS,
      this.player.position.x + PLAYER_RADIUS,
      this.player.position.y + PLAYER_HEIGHT,
      this.player.position.z + PLAYER_RADIUS,
    );
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.getRenderPixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.composer) {
      const pixelRatio = this.renderer.getPixelRatio();
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(innerWidth, innerHeight);
      if (this.smaaPass) {
        this.smaaPass.setSize(innerWidth * pixelRatio, innerHeight * pixelRatio);
      }
      this.updatePostProcessingSamples();
    }
    if (this.handCamera) {
      this.handCamera.aspect = innerWidth / innerHeight;
      this.handCamera.updateProjectionMatrix();
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.045);
    const locked = document.pointerLockElement === this.canvas;
    if (this.world) this.world.framePressure = dt;
    if (this.world) this.world.processGeneratedChunkApplyQueue(this.started ? 4 : 8, this.player?.position);

    if (this.loadingWorld) {
      this.updateLoadingWorld();
    }

    if (this.started) {
      if (!this.paused && !this.inventoryOpen && !this.chatOpen && locked) {
        this.player.update(dt);
        this.updateCameraBob(dt);
        this.updateMining(dt);
        if (this.rightMouseHeld) {
          this.placeRepeatTimer = (this.placeRepeatTimer ?? 0.3) - dt;
          if (this.placeRepeatTimer <= 0) {
            if (!this.useSelectedItem()) this.placeTargetBlock();
            this.placeRepeatTimer = 0.25;
          }
        }
      }
      this.updateFurnaces(dt);
      if (!this.paused) {
        this.updateSurvivalStats(dt);
        this.updateDroppedItems(dt);
        this.updateBlockBreakParticles(dt);
        this.updateFallingBlocks(dt);
        this.updateMobs(dt);
        this.updateMobPlayerContact(dt);
        this.updateDamageFlash(dt);
        this.updateTimeAndWeather(dt);
        this.waterElapsed += dt;
        while (this.waterElapsed >= WATER_FLOW_INTERVAL) {
          this.world.stepWater();
          this.waterElapsed -= WATER_FLOW_INTERVAL;
        }
        this.lavaElapsed += dt;
        while (this.lavaElapsed >= LAVA_FLOW_INTERVAL) {
          this.world.stepLava();
          this.lavaElapsed -= LAVA_FLOW_INTERVAL;
        }
      }
    } else {
      this.updateTimeAndWeather(dt);
    }

    if (this.started && this.player && this.fieldOfView != null) {
      const targetFov = this.player.isSprinting() ? this.fieldOfView + 15 : this.fieldOfView;
      const blendSpeed = Math.min(1, dt * 7);
      this.camera.fov += (targetFov - this.camera.fov) * blendSpeed;
      this.camera.updateProjectionMatrix();
    }

    this.multiplayer?.update(dt);
    if (this.playerListVisible) this.renderPlayerList();
    this.updateTargetLabel();
    this.updateTargetOutline();
    this.updateUnderwaterView();
    this.applyVisionMode();
    this.updateSkyCycle(dt);
    this.updateChunkEdgeFogBounds();
    this.world.updateDynamicBlockLights(this.camera.position, dt);
    this.animateWater(performance.now() * 0.001);
    this.updateClouds(dt);
    this.updatePrecipitation(dt);
    this.updateChatMessageVisibility();
    this.skyDome.position.copy(this.camera.position);

    this.lastChunkUpdate += dt;
    const streamChunkX = Math.floor(this.player.position.x / CHUNK_SIZE);
    const streamChunkZ = Math.floor(this.player.position.z / CHUNK_SIZE);
    const enteredNewChunk =
      streamChunkX !== this.lastStreamChunkX ||
      streamChunkZ !== this.lastStreamChunkZ;
    if (this.lastChunkUpdate > CHUNK_UPDATE_INTERVAL_SECONDS || enteredNewChunk) {
      if (!this.loadingWorld && (!this.started || !this.paused)) {
        const activeRenderDistance = this.started ? this.renderDistance : TITLE_RENDER_DISTANCE;
        const horizontalSpeed = this.player ? Math.hypot(this.player.velocity.x, this.player.velocity.z) : 0;
        const fastTravel = this.started && (
          this.player.mode === "spectator" ||
          (this.player.mode === "creative" && this.player.isFlying) ||
          horizontalSpeed > SPRINT_SPEED
        );
        const buildBudget = this.started
          ? Math.max(8, Math.ceil(activeRenderDistance * (fastTravel ? 1.8 : 1.0)))
          : Math.ceil(TITLE_CHUNK_BUILD_BUDGET / 8);
        this.world.ensureChunksAround(this.player.position, activeRenderDistance, buildBudget, {
          timeBudgetMs: this.started ? CHUNK_PLAY_TIME_BUDGET_MS : CHUNK_TITLE_TIME_BUDGET_MS,
          travelDirection: this.started ? { x: this.player.velocity.x, z: this.player.velocity.z } : null,
          leadChunks: fastTravel ? clamp(Math.ceil(horizontalSpeed / 4), 3, 6) : CHUNK_BACKGROUND_PREFETCH_RING,
        });
      }
      const mode = gameModeLabel(this.player.mode);
      const flight = (this.player.mode === "spectator" || (this.player.mode === "creative" && this.player.isFlying)) ? " Fly" : "";
      const swim = this.player.inWater && this.player.mode === "survival" ? " Swim" : "";
      const biome = BIOMES[this.world.biomeAt(Math.floor(this.player.position.x), Math.floor(this.player.position.z))]?.name;
      const cheats = this.allowCheats ? " | Cheats" : "";
      this.updateCoordinatesStatus();
      this.status.textContent = this.updateMultiplayerStatusLine(
        `${mode}${flight}${swim}${cheats} | ${biome} | ${this.renderDistance} chunks | Loaded ${this.world.chunks.size}`,
      );
      this.lastStreamChunkX = streamChunkX;
      this.lastStreamChunkZ = streamChunkZ;
      this.lastChunkUpdate = 0;
    }

    this.world.processGeneratedChunkApplyQueue(this.started ? 3 : 6, this.player?.position);
    this.world.processMeshApplyQueue(this.started ? 4 : 6, this.player?.position);
    if (this.postProcessingActive()) {
      this.updateDepthOfFieldFocus();
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.started && this.handScene && this.player.mode !== "spectator") {
      this.updateHandSwing(dt);
      this.updateHandLighting();
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCamera);
      this.renderer.autoClear = true;
    }
  }
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
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

export function isSolid(block) {
  return block !== Block.AIR && BLOCKS[block]?.solid;
}

function isWater(block) {
  return block === Block.WATER;
}

export function isLava(block) {
  return EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id === "lava";
}

function isLiquid(block) {
  return isWater(block) || isLava(block);
}

function isSameLiquid(a, b) {
  return (isWater(a) && isWater(b)) || (isLava(a) && isLava(b));
}

function isSpawnGround(block) {
  return isSolid(block) && !SPAWN_UNSAFE_GROUND.has(block);
}

function isPlant(block) {
  return Boolean(BLOCKS[block]?.plant);
}

function isInstantBreakBlock(block) {
  return isPlant(block) || (BLOCKS[block]?.breakTime ?? 1) <= 0.12;
}

function isReplaceablePlacementBlock(block) {
  return isPlant(block) || isLava(block);
}

function isCactusBaseBlock(block) {
  return block === Block.SAND || block === Block.RED_SAND || block === Block.CACTUS;
}

function isLeafBlock(block) {
  return LEAF_BLOCKS.has(block);
}

function shouldRenderSharedLeafFace(face) {
  return face.dir[0] > 0 || face.dir[1] > 0 || face.dir[2] > 0;
}

function isVineSupportBlock(block) {
  return isFaceOccluding(block) || isLeafBlock(block);
}

function isClimbableBlock(block) {
  return block === Block.VINE || EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id === "ladder";
}

function getWallTorchSupportOffset(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
  return WALL_TORCH_SUPPORT_OFFSETS[id] ?? null;
}

const FURNACE_BLOCK_IDS = new Set([
  "furnace", "furnace_south", "furnace_east", "furnace_west",
  "furnace_lit", "furnace_lit_south", "furnace_lit_east", "furnace_lit_west",
]);

function isFurnaceBlock(block) {
  return FURNACE_BLOCK_IDS.has(EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id);
}

function getFurnaceLitBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
  const litId = id === "furnace" ? "furnace_lit"
    : id === "furnace_south" ? "furnace_lit_south"
    : id === "furnace_east" ? "furnace_lit_east"
    : id === "furnace_west" ? "furnace_lit_west"
    : null;
  return litId ? getBlockByDefinitionId(litId) : null;
}

function getFurnaceUnlitBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
  const unlitId = id === "furnace_lit" ? "furnace"
    : id === "furnace_lit_south" ? "furnace_south"
    : id === "furnace_lit_east" ? "furnace_east"
    : id === "furnace_lit_west" ? "furnace_west"
    : null;
  return unlitId ? getBlockByDefinitionId(unlitId) : null;
}

function getDoorToggleBlock(block) {
  return DOOR_OPEN_BLOCK_BY_CLOSED.get(block) ?? DOOR_CLOSED_BLOCK_BY_OPEN.get(block) ?? null;
}

function isDoorBlock(block) {
  return DOOR_OPEN_BLOCK_BY_CLOSED.has(block) || DOOR_CLOSED_BLOCK_BY_OPEN.has(block);
}

function getDoorUpperBlock(block) {
  return DOOR_UPPER_BLOCK_BY_LOWER.get(block) ?? null;
}

function getDoorLowerBlock(block) {
  return DOOR_LOWER_BLOCK_BY_UPPER.get(block) ?? null;
}

function isDoorUpperBlock(block) {
  return DOOR_LOWER_BLOCK_BY_UPPER.has(block);
}

function isDoorLowerBlock(block) {
  return DOOR_UPPER_BLOCK_BY_LOWER.has(block);
}

function getTrapdoorToggleBlock(block) {
  return TRAPDOOR_TOGGLE_BLOCK.get(block) ?? null;
}

function getTrapdoorSideFromPlacementNormal(normal) {
  if (!normal) return "south";
  if (normal.x > 0.5) return "west";
  if (normal.x < -0.5) return "east";
  if (normal.z > 0.5) return "north";
  if (normal.z < -0.5) return "south";
  return "south";
}

function isAnvilBlock(block) {
  return EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id === "anvil";
}

function isFallingGravityBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
  return id === "anvil";
}

function isFaceOccluding(block) {
  if (EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.transparent) return false;
  return isSolid(block) && block !== Block.CACTUS;
}

function getLightOpacity(block) {
  const extra = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block);
  if (extra?.plant) return 0;
  if (extra && !extra.solid && !extra.liquid) return 0;
  if (extra?.transparent) return 1;
  if (block === Block.AIR || isPlant(block)) return 0;
  if (block === Block.WATER || isLeafBlock(block) || block === Block.ICE) return 1;
  return MAX_LIGHT_LEVEL;
}

function getBlockLightSource(block) {
  const extra = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block);
  if (extra?.id === "torch_on" || extra?.id?.startsWith("torch_on_wall_")) return MINECRAFT_LIGHT_LEVELS.torch;
  if (extra?.id?.startsWith("furnace_lit")) return MINECRAFT_LIGHT_LEVELS.furnace;
  if (extra?.id?.includes("redstone_torch")) return MINECRAFT_LIGHT_LEVELS.redstoneTorch;
  if (extra && /glowstone|sea_lantern|lamp_on|lava/.test(extra.id)) return MAX_LIGHT_LEVEL;
  if (block === Block.WATER) return 0;
  return 0;
}

function isDynamicBlockLightSource(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id ?? "";
  return id === "torch_on" ||
    id.startsWith("torch_on_wall_") ||
    /redstone_torch|glowstone|sea_lantern|lamp_on/.test(id) ||
    id.startsWith("furnace_lit");
}

function isTorchBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id ?? "";
  return id === "torch_on" || id.startsWith("torch_on_wall_") || id.includes("redstone_torch");
}

function isWaterBreakableBlock(block) {
  return isTorchBlock(block);
}

function isTorchCustomShapeBlock(block) {
  return isTorchBlock(block);
}

function isFallingBlockFragile(block) {
  return isTorchBlock(block);
}

function getFaceLightLevel(world, wx, y, wz, face) {
  const lx = wx + face.dir[0];
  const ly = y + face.dir[1];
  const lz = wz + face.dir[2];
  if (typeof world.getCombinedLightLevel === "function") {
    return world.getCombinedLightLevel(lx, ly, lz);
  }
  return MAX_LIGHT_LEVEL;
}

function minecraftLightFactor(level) {
  return skyLightFactor(level);
}

function skyLightFactor(level) {
  if (fullBrightLightingEnabled) return 1;
  return minecraftBrightnessFactor(level);
}

function blockLightFactor(level) {
  if (fullBrightLightingEnabled) return 1;
  if (level <= 0) return 0;
  return minecraftBrightnessFactor(level) * MAX_BLOCK_LIGHT_FACTOR;
}

function minecraftBrightnessFactor(level) {
  const normalized = clamp(level / MAX_LIGHT_LEVEL, 0, 1);
  const darkness = 1 - normalized;
  const vanilla = normalized / (darkness * 3 + 1);
  return MIN_LIGHT_FACTOR + vanilla * (1 - MIN_LIGHT_FACTOR);
}

function attenuateSkyLightForWater(sky, waterDepth) {
  if (waterDepth <= 0 || sky <= 0) return sky;
  const t = smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, waterDepth);
  const loss = Math.round(lerp(WATER_SKY_LIGHT_LOSS_MIN, WATER_SKY_LIGHT_LOSS_MAX, t));
  return clamp(sky - loss, 0, MAX_LIGHT_LEVEL);
}

function computeLightColors(world, wx, y, wz, optLevel = null, waterDepth = 0) {
  if (fullBrightLightingEnabled) return { r: 1, g: 1, b: 1, blockIntensity: 1 };
  let sky;
  let block;
  if (optLevel != null) {
    sky = 0;
    block = optLevel;
  } else {
    sky = world.getSkyLightLevel?.(wx, y, wz) ?? MAX_LIGHT_LEVEL;
    block = world.getBlockLightLevel?.(wx, y, wz) ?? 0;
    sky = attenuateSkyLightForWater(sky, waterDepth);
  }
  const sf = skyLightFactor(sky);
  const bf = blockLightFactor(block);
  // Full-bright previews and lava stay neutral; terrain block light stays neutral too.
  if (optLevel != null) {
    const light = Math.max(sf, bf);
    return { r: light, g: light, b: light, blockIntensity: 0 };
  }
  // For terrain: sky in RGB, block light intensity in alpha for night-time torch support
  return { r: sf, g: sf, b: sf, blockIntensity: bf };
}

function blockLightColorFactors(level) {
  const light = blockLightFactor(level);
  return {
    r: light,
    g: light * BLOCK_LIGHT_GREEN_FACTOR,
    b: light * BLOCK_LIGHT_BLUE_FACTOR,
  };
}

function getFaceLightColors(world, wx, y, wz, face, optLevel = null, waterDepth = 0) {
  return computeLightColors(world, wx + face.dir[0], y + face.dir[1], wz + face.dir[2], optLevel, waterDepth);
}

function getBlockBounds(block) {
  return block === Block.CACTUS ? CACTUS_BLOCK_BOUNDS : FULL_BLOCK_BOUNDS;
}

function blockIntersectsAabb(block, blockX, blockY, blockZ, minX, minY, minZ, maxX, maxY, maxZ) {
  const shape = getBlockShapeForBlock(block);
  if (shape) return shapeIntersectsAabb(shape, blockX, blockY, blockZ, minX, minY, minZ, maxX, maxY, maxZ);

  const bounds = getBlockBounds(block);
  return (
    blockX + bounds.maxX > minX &&
    blockX + bounds.minX < maxX &&
    blockY + bounds.maxY > minY &&
    blockY + bounds.minY < maxY &&
    blockZ + bounds.maxZ > minZ &&
    blockZ + bounds.minZ < maxZ
  );
}

function shapeIntersectsAabb(shape, blockX, blockY, blockZ, minX, minY, minZ, maxX, maxY, maxZ) {
  const boxes = shape.collision ?? shape.boxes;
  if (!boxes) return false;
  for (const box of boxes) {
    const localMinX = box.minX ?? box.bounds?.[0] ?? 0;
    const localMinY = box.minY ?? box.bounds?.[1] ?? 0;
    const localMinZ = box.minZ ?? box.bounds?.[2] ?? 0;
    const localMaxX = box.maxX ?? box.bounds?.[3] ?? 1;
    const localMaxY = box.maxY ?? box.bounds?.[4] ?? 1;
    const localMaxZ = box.maxZ ?? box.bounds?.[5] ?? 1;
    if (
      blockX + localMaxX > minX &&
      blockX + localMinX < maxX &&
      blockY + localMaxY > minY &&
      blockY + localMinY < maxY &&
      blockZ + localMaxZ > minZ &&
      blockZ + localMinZ < maxZ
    ) {
      return true;
    }
  }
  return false;
}

function pointInsideBlockBounds(block, blockX, blockY, blockZ, point) {
  const bounds = getBlockBounds(block);
  return (
    point.x >= blockX + bounds.minX &&
    point.x <= blockX + bounds.maxX &&
    point.y >= blockY + bounds.minY &&
    point.y <= blockY + bounds.maxY &&
    point.z >= blockZ + bounds.minZ &&
    point.z <= blockZ + bounds.maxZ
  );
}

function pointInsideShape(shape, lx, ly, lz) {
  const boxes = shape.selection ?? shape.boxes ?? shape.collision;
  if (!boxes) return false;
  for (const box of boxes) {
    const minX = box.minX ?? box.bounds?.[0] ?? 0;
    const minY = box.minY ?? box.bounds?.[1] ?? 0;
    const minZ = box.minZ ?? box.bounds?.[2] ?? 0;
    const maxX = box.maxX ?? box.bounds?.[3] ?? 1;
    const maxY = box.maxY ?? box.bounds?.[4] ?? 1;
    const maxZ = box.maxZ ?? box.bounds?.[5] ?? 1;
    if (lx >= minX && lx <= maxX && ly >= minY && ly <= maxY && lz >= minZ && lz <= maxZ) {
      return true;
    }
  }
  return false;
}

function normalizeSelectionBox(box) {
  return {
    minX: box.minX ?? box.bounds?.[0] ?? 0,
    minY: box.minY ?? box.bounds?.[1] ?? 0,
    minZ: box.minZ ?? box.bounds?.[2] ?? 0,
    maxX: box.maxX ?? box.bounds?.[3] ?? 1,
    maxY: box.maxY ?? box.bounds?.[4] ?? 1,
    maxZ: box.maxZ ?? box.bounds?.[5] ?? 1,
  };
}

function getSelectionBoxesForBlock(block) {
  const shape = getBlockShapeForBlock(block);
  const boxes = shape ? (shape.selection ?? shape.boxes ?? shape.collision) : null;
  if (boxes?.length) return boxes.map(normalizeSelectionBox);
  return [normalizeSelectionBox(getBlockBounds(block))];
}

function getSelectionBoundsForBlock(block) {
  const boxes = getSelectionBoxesForBlock(block);
  const bounds = { minX: 1, minY: 1, minZ: 1, maxX: 0, maxY: 0, maxZ: 0 };
  for (const box of boxes) {
    bounds.minX = Math.min(bounds.minX, box.minX);
    bounds.minY = Math.min(bounds.minY, box.minY);
    bounds.minZ = Math.min(bounds.minZ, box.minZ);
    bounds.maxX = Math.max(bounds.maxX, box.maxX);
    bounds.maxY = Math.max(bounds.maxY, box.maxY);
    bounds.maxZ = Math.max(bounds.maxZ, box.maxZ);
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY || bounds.maxZ < bounds.minZ) {
    return normalizeSelectionBox(FULL_BLOCK_BOUNDS);
  }
  return bounds;
}

function outlineBoxKey(box) {
  const normalized = normalizeSelectionBox(box);
  return [
    normalized.minX,
    normalized.minY,
    normalized.minZ,
    normalized.maxX,
    normalized.maxY,
    normalized.maxZ,
  ].map((value) => value.toFixed(4)).join(",");
}

function createSelectionOutlineGeometry(boxes) {
  const positions = [];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const expand = 0.006;

  for (const rawBox of boxes?.length ? boxes : [FULL_BLOCK_BOUNDS]) {
    const box = normalizeSelectionBox(rawBox);
    const minX = box.minX - 0.5 - expand;
    const minY = box.minY - 0.5 - expand;
    const minZ = box.minZ - 0.5 - expand;
    const maxX = box.maxX - 0.5 + expand;
    const maxY = box.maxY - 0.5 + expand;
    const maxZ = box.maxZ - 0.5 + expand;
    const corners = [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, minY, maxZ],
      [minX, minY, maxZ],
      [minX, maxY, minZ],
      [maxX, maxY, minZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ],
    ];

    for (const [a, b] of edges) {
      positions.push(...corners[a], ...corners[b]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function getLeafTintColor(world, wx, wz, block) {
  if (block === Block.BIRCH_LEAVES) return BIRCH_FOLIAGE_COLOR;
  if (block === Block.SPRUCE_LEAVES) return SPRUCE_FOLIAGE_COLOR;
  if (block === Block.DARK_OAK_LEAVES) return 0x285424;
  return world.foliageColorAt(wx, wz);
}

function getBlockTintColor(world, wx, wz, block, faceName) {
  if (isLeafBlock(block)) return getLeafTintColor(world, wx, wz, block);
  if (GRASS_TINT_BLOCKS.has(block) && faceName === "py") return world.grassColorAt(wx, wz);
  return null;
}

function hasGrassSideOverlay(block, faceName) {
  return GRASS_TINT_BLOCKS.has(block) && faceName !== "py" && faceName !== "ny";
}

function getPlantTintColor(world, wx, wz, block) {
  if (GRASS_TINT_PLANTS.has(block)) return world.grassColorAt(wx, wz);
  if (FOLIAGE_TINT_PLANTS.has(block)) return world.foliageColorAt(wx, wz);
  return null;
}

function setPackedTintedColor(color, light, packedColor, options = {}) {
  let r;
  let g;
  let b;
  const lr = typeof light === "object" ? light.r : light;
  const lg = typeof light === "object" ? light.g : light;
  const lb = typeof light === "object" ? light.b : light;
  if (packedColor === null) {
    r = lr;
    g = lg;
    b = lb;
  } else {
    r = (((packedColor >> 16) & 0xff) / 255) * lr;
    g = (((packedColor >> 8) & 0xff) / 255) * lg;
    b = ((packedColor & 0xff) / 255) * lb;
  }

  if (options.waterDepth > 0) {
    const water = getWaterDepthTintColor(packedColor ?? DEFAULT_WATER_TINT, options.waterDepth);
    r = water.r * lr;
    g = water.g * lg;
    b = water.b * lb;
  }

  if (options.submergedDepth > 0) {
    const t = smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, options.submergedDepth);
    const water = unpackColor(options.waterTintColor ?? UNDERWATER_WATER_TINT);
    const haze = lerp(0.18, 0.58, t);
    const visibility = lerp(0.9, 0.66, t);
    const avgLight = (lr + lg + lb) / 3;
    r = lerp(r, water.r * avgLight, haze) * visibility;
    g = lerp(g, water.g * avgLight, haze) * visibility;
    b = lerp(b, water.b * avgLight, haze) * lerp(0.98, 0.94, t);
  }

  color.setRGB(r, g, b);
}

function getWaterDepthAlpha(depth) {
  const t = smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, depth);
  return lerp(WATER_DEPTH_ALPHA_MIN, WATER_DEPTH_ALPHA_MAX, Math.pow(t, 0.58));
}

function getWaterDepthTintColor(packedColor, depth) {
  const t = Math.pow(smoothstep(1, WATER_DEPTH_VISIBILITY_LIMIT, depth), 0.82);
  const base = unpackColor(packedColor ?? DEFAULT_WATER_TINT);
  const shallow = mixColor(base, unpackColor(SHALLOW_WATER_TINT), 0.82);
  const deep = mixColor(base, unpackColor(DEEP_WATER_TINT), 0.9);
  return mixColor(shallow, deep, t);
}

function mixColor(a, b, t) {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

function getWaterDepthTintSample(depth) {
  const color = new THREE.Color();
  setPackedTintedColor(color, { r: 1, g: 1, b: 1 }, DEFAULT_WATER_TINT, { waterDepth: depth });
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    alpha: getWaterDepthAlpha(depth),
    luminance: color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722,
  };
}

function getSubmergedDepthTintSample(depth, packedColor = 0xd9c878) {
  const color = new THREE.Color();
  setPackedTintedColor(color, { r: 1, g: 1, b: 1 }, packedColor, {
    submergedDepth: depth,
    waterTintColor: DEFAULT_WATER_TINT,
  });
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    luminance: color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722,
  };
}

function getUnderwaterLightColorSample(depth) {
  return computeLightColors({
    getSkyLightLevel: () => MAX_LIGHT_LEVEL,
    getBlockLightLevel: () => 0,
  }, 0, 0, 0, null, depth);
}

function getUnderwaterLitSubmergedTintSample(depth, packedColor = 0xd9c878) {
  const color = new THREE.Color();
  const light = getUnderwaterLightColorSample(depth);
  setPackedTintedColor(color, light, packedColor, {
    submergedDepth: depth,
    waterTintColor: DEFAULT_WATER_TINT,
  });
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    luminance: color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722,
  };
}

function unpackColor(packedColor) {
  return {
    r: ((packedColor >> 16) & 0xff) / 255,
    g: ((packedColor >> 8) & 0xff) / 255,
    b: (packedColor & 0xff) / 255,
  };
}

function createMeshBuffers() {
  return {
    positions: [],
    normals: [],
    colors: [],
    uvs: [],
    waves: [],
    indices: [],
    vertexCount: 0,
  };
}

function createGeometryFromBuffers(buffers) {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = buffers.vertexCount ?? Math.floor((buffers.positions?.length ?? 0) / 3);
  const colorItemSize = vertexCount > 0 && buffers.colors?.length === vertexCount * 4 ? 4 : 3;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, colorItemSize));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
  if (buffers.waves.length > 0) {
    geometry.setAttribute("waterWave", new THREE.Float32BufferAttribute(buffers.waves, 1));
  }
  if (ArrayBuffer.isView(buffers.indices)) {
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  } else {
    geometry.setIndex(buffers.indices);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function pushVoxelFace(buffers, world, wx, y, wz, block, face, color, options = {}) {
  const topHeight = options.topHeight ?? 1;
  const topHeights = options.topHeights ?? null;
  const variation = options.variation ?? 1;
  const useAo = options.ao ?? true;
  const waveTop = options.waveTop ?? false;
  const bounds = getBlockBounds(block);
  const packedTint = options.tintColor ?? getBlockTintColor(world, wx, wz, block, face.name);
  const positionOffset = options.positionOffset ?? 0;
  const textureKey = options.textureKey ?? getFaceTextureKey(block, face.name);
  const textureRegion = BLOCK_ATLAS.regions.get(textureKey);
  const lightColors = getFaceLightColors(
    world,
    wx,
    y,
    wz,
    face,
    options.lightLevel ?? null,
    options.submergedDepth ?? 0,
  );
  const cornerLight = face.corners.map((corner) =>
    useAo ? getVertexAmbientOcclusion(world, wx, y, wz, face, corner) : 1,
  );
  // terrain faces split sky (rgb) and block light (alpha) for night-time torch rendering
  const hasBlockLightSplit = options.lightLevel === undefined && typeof options.colorAlpha !== "number";

  face.corners.forEach((corner, cornerIndex) => {
    const localX = corner[0] === 1 ? bounds.maxX : bounds.minX;
    const localZ = corner[2] === 1 ? bounds.maxZ : bounds.minZ;
    const localY = corner[1] === 1 ? (topHeights?.[cornerIndex] ?? Math.min(bounds.maxY, topHeight)) : bounds.minY;
    const tintScale = face.shade * variation * cornerLight[cornerIndex];
    const tint = { r: tintScale * lightColors.r, g: tintScale * lightColors.g, b: tintScale * lightColors.b };
    const waterTintColor = options.waterTintColor ?? options.tintColor ?? DEFAULT_WATER_TINT;
    setPackedTintedColor(color, tint, packedTint, {
      waterDepth: options.waterDepth ?? 0,
      submergedDepth: options.submergedDepth ?? 0,
      waterTintColor,
    });
    buffers.positions.push(
      wx + localX + face.dir[0] * positionOffset,
      y + localY + face.dir[1] * positionOffset,
      wz + localZ + face.dir[2] * positionOffset,
    );
    buffers.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    if (typeof options.colorAlpha === "number") {
      buffers.colors.push(color.r, color.g, color.b, clamp(options.colorAlpha, 0, 1));
    } else if (hasBlockLightSplit) {
      buffers.colors.push(color.r, color.g, color.b, tintScale * lightColors.blockIntensity);
    } else {
      buffers.colors.push(color.r, color.g, color.b);
    }
    const uv = options.fullTileUv
      ? getFullTileUv(cornerIndex, options.uvShift ?? [0, 0])
      : leafBlockUv(block, textureRegion, cornerIndex, wx, y, wz, face, world.seed, options.uvShift ?? [0, 0]);
    buffers.uvs.push(...uv);
    buffers.waves.push(waveTop && corner[1] === 1 ? 1 : 0);
  });

  if (cornerLight[0] + cornerLight[2] > cornerLight[1] + cornerLight[3]) {
    buffers.indices.push(
      buffers.vertexCount,
      buffers.vertexCount + 1,
      buffers.vertexCount + 3,
      buffers.vertexCount + 1,
      buffers.vertexCount + 2,
      buffers.vertexCount + 3,
    );
  } else {
    buffers.indices.push(
      buffers.vertexCount,
      buffers.vertexCount + 1,
      buffers.vertexCount + 2,
      buffers.vertexCount,
      buffers.vertexCount + 2,
      buffers.vertexCount + 3,
    );
  }
  buffers.vertexCount += 4;
}

function getBlockShapeForBlock(block) {
  const id = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block)?.id;
  return id ? getBlockShapeById(id) : null;
}

function buildFallingBlockGeometry(block) {
  const shape = getBlockShapeForBlock(block);
  const buffers = createMeshBuffers();
  const color = new THREE.Color();
  if (shape) {
    for (const box of shape.boxes ?? []) {
      pushShapeBoxLocal(buffers, box, color);
    }
  } else {
    const previewWorld = createHeldBlockPreviewWorld();
    for (const face of FACE_DEFS) {
      pushVoxelFace(buffers, previewWorld, 0, 0, 0, block, face, color, {
        ao: false,
        variation: 1,
        lightLevel: MAX_LIGHT_LEVEL,
      });
      if (hasGrassSideOverlay(block, face.name)) {
        pushVoxelFace(buffers, previewWorld, 0, 0, 0, block, face, color, {
          ao: false,
          variation: 1,
          lightLevel: MAX_LIGHT_LEVEL,
          textureKey: "grass_side_overlay",
          tintColor: previewWorld.grassColorAt(0, 0),
          positionOffset: 0.0015,
        });
      }
    }
  }
  return createGeometryFromBuffers(buffers);
}

function createHeldBlockPreviewWorld() {
  return {
    seed: 0,
    getBlock: () => Block.AIR,
    getSkyLightLevel: () => MAX_LIGHT_LEVEL,
    getBlockLightLevel: () => 0,
    getCombinedLightLevel: () => MAX_LIGHT_LEVEL,
    grassColorAt: () => 0x59a942,
    foliageColorAt: () => 0x59ae30,
    getWaterColor: () => null,
  };
}

function pushShapeBoxLocal(buffers, box, color) {
  for (const face of FACE_DEFS) {
    const faceSpec = normalizeShapeFaceSpec(box.faces?.[face.name]);
    if (!faceSpec) continue;
    pushShapeBoxFace(buffers, 0, 0, 0, face, faceSpec, box.bounds, { r: 1, g: 1, b: 1 }, color);
  }
}

function pushCustomShape(buffers, world, wx, y, wz, block, shape, color) {
  for (const box of shape.boxes ?? []) {
    pushShapeBox(buffers, world, wx, y, wz, block, box, color);
  }
  const lightColors = computeLightColors(world, wx, y, wz);
  for (const quad of shape.quads ?? []) {
    pushShapeQuad(buffers, wx, y, wz, quad, lightColors, color);
  }
}

function pushShapeBox(buffers, world, wx, y, wz, block, box, color) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = box.bounds;
  const lightColors = computeLightColors(world, wx, y, wz);
  for (const face of FACE_DEFS) {
    const faceSpec = normalizeShapeFaceSpec(box.faces?.[face.name]);
    if (!faceSpec) continue;
    const touchesEdge = shapeFaceTouchesEdge(face, minX, minY, minZ, maxX, maxY, maxZ);
    if (touchesEdge) {
      const neighbor = world.getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
      if (isFaceOccluding(neighbor) && neighbor !== block) continue;
    }
    pushShapeBoxFace(buffers, wx, y, wz, face, faceSpec, box.bounds, lightColors, color);
  }
}

function normalizeShapeFaceSpec(value) {
  if (!value) return null;
  if (typeof value === "string") return { texture: value, uv: null, rotation: 0, shade: null };
  return { texture: value.texture, uv: value.uv ?? null, rotation: value.rotation ?? 0, shade: value.shade ?? null };
}

function shapeFaceTouchesEdge(face, minX, minY, minZ, maxX, maxY, maxZ) {
  if (face.name === "px") return maxX >= 0.999;
  if (face.name === "nx") return minX <= 0.001;
  if (face.name === "py") return maxY >= 0.999;
  if (face.name === "ny") return minY <= 0.001;
  if (face.name === "pz") return maxZ >= 0.999;
  if (face.name === "nz") return minZ <= 0.001;
  return false;
}

function pushShapeBoxFace(buffers, wx, y, wz, face, faceSpec, bounds, lightColors, color) {
  const region = BLOCK_ATLAS.regions.get(faceSpec.texture) ?? BLOCK_ATLAS.regions.get("stone");
  const shade = faceSpec.shade ?? face.shade;
  const tintBase = { r: shade * lightColors.r, g: shade * lightColors.g, b: shade * lightColors.b };
  const shapeBlockIntensity = lightColors.blockIntensity != null ? shade * lightColors.blockIntensity : null;
  const start = buffers.vertexCount;
  setPackedTintedColor(color, tintBase, null);
  const cornerUv = computeShapeCornerUv(face, region, bounds, faceSpec);
  face.corners.forEach((corner, cornerIndex) => {
    const localX = corner[0] === 1 ? bounds[3] : bounds[0];
    const localY = corner[1] === 1 ? bounds[4] : bounds[1];
    const localZ = corner[2] === 1 ? bounds[5] : bounds[2];
    buffers.positions.push(wx + localX, y + localY, wz + localZ);
    buffers.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    if (shapeBlockIntensity != null) {
      buffers.colors.push(color.r, color.g, color.b, shapeBlockIntensity);
    } else {
      buffers.colors.push(color.r, color.g, color.b);
    }
    const uv = cornerUv[cornerIndex];
    buffers.uvs.push(uv[0], uv[1]);
    buffers.waves.push(0);
  });
  buffers.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  buffers.vertexCount += 4;
}

function pushShapeQuad(buffers, wx, y, wz, quad, lightColors, color) {
  const faceSpec = normalizeShapeFaceSpec(quad.face);
  if (!faceSpec) return;
  const region = BLOCK_ATLAS.regions.get(faceSpec.texture) ?? BLOCK_ATLAS.regions.get("stone");
  const shade = faceSpec.shade ?? 1;
  const tintBase = { r: shade * lightColors.r, g: shade * lightColors.g, b: shade * lightColors.b };
  const quadBlockIntensity = lightColors.blockIntensity != null ? shade * lightColors.blockIntensity : null;
  const start = buffers.vertexCount;
  const cornerUv = computeShapeQuadUv(region, faceSpec);
  const normal = normalizeQuadNormal(quad.normal ?? computeQuadNormal(quad.vertices));
  setPackedTintedColor(color, tintBase, null);

  quad.vertices.forEach((vertex, cornerIndex) => {
    buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
    buffers.normals.push(normal[0], normal[1], normal[2]);
    if (quadBlockIntensity != null) {
      buffers.colors.push(color.r, color.g, color.b, quadBlockIntensity);
    } else {
      buffers.colors.push(color.r, color.g, color.b);
    }
    const uv = cornerUv[cornerIndex];
    buffers.uvs.push(uv[0], uv[1]);
    buffers.waves.push(0);
  });
  buffers.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  buffers.vertexCount += 4;
}

function computeShapeQuadUv(region, faceSpec) {
  const partial = faceSpec.uv ? computeExplicitShapeUv(region, faceSpec.uv) : [
    [region.u0, region.v0],
    [region.u0, region.v1],
    [region.u1, region.v1],
    [region.u1, region.v0],
  ];
  return rotateShapeCornerUv(partial, faceSpec.rotation ?? 0);
}

function computeQuadNormal(vertices) {
  const a = vertices[0];
  const b = vertices[1];
  const c = vertices[2];
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  return [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ];
}

function normalizeQuadNormal(normal) {
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

function computeShapeCornerUv(face, region, bounds, faceSpec) {
  const partial = faceSpec.uv ? computeExplicitShapeUv(region, faceSpec.uv) : computeShapePartialUv(face, region, bounds);
  return rotateShapeCornerUv(partial, faceSpec.rotation ?? 0);
}

function computeExplicitShapeUv(region, uv) {
  const uSpan = region.u1 - region.u0;
  const vSpan = region.v1 - region.v0;
  const u0 = region.u0 + uSpan * (uv[0] / 16);
  const u1 = region.u0 + uSpan * (uv[2] / 16);
  const v0 = region.v0 + vSpan * (1 - uv[3] / 16);
  const v1 = region.v0 + vSpan * (1 - uv[1] / 16);
  return [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ];
}

function rotateShapeCornerUv(uv, rotation) {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 0) return uv;
  if (r === 90) return [uv[1], uv[2], uv[3], uv[0]];
  if (r === 180) return [uv[2], uv[3], uv[0], uv[1]];
  if (r === 270) return [uv[3], uv[0], uv[1], uv[2]];
  return uv;
}

function computeShapePartialUv(face, region, bounds) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const uSpan = region.u1 - region.u0;
  const vSpan = region.v1 - region.v0;
  let u0;
  let u1;
  let v0;
  let v1;
  if (face.name === "px") {
    u0 = region.u0 + uSpan * minZ;
    u1 = region.u0 + uSpan * maxZ;
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  } else if (face.name === "nx") {
    u0 = region.u0 + uSpan * (1 - maxZ);
    u1 = region.u0 + uSpan * (1 - minZ);
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  } else if (face.name === "py") {
    u0 = region.u0 + uSpan * (1 - maxZ);
    u1 = region.u0 + uSpan * (1 - minZ);
    v0 = region.v0 + vSpan * minX;
    v1 = region.v0 + vSpan * maxX;
  } else if (face.name === "ny") {
    u0 = region.u0 + uSpan * minZ;
    u1 = region.u0 + uSpan * maxZ;
    v0 = region.v0 + vSpan * minX;
    v1 = region.v0 + vSpan * maxX;
  } else if (face.name === "pz") {
    u0 = region.u0 + uSpan * (1 - maxX);
    u1 = region.u0 + uSpan * (1 - minX);
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  } else {
    u0 = region.u0 + uSpan * minX;
    u1 = region.u0 + uSpan * maxX;
    v0 = region.v0 + vSpan * minY;
    v1 = region.v0 + vSpan * maxY;
  }
  return [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ];
}

function pushPlant(buffers, world, wx, y, wz, block, color) {
  if (block === Block.WATERLILY) {
    pushWaterlily(buffers, world, wx, y, wz, block, color);
    return;
  }

  const textureKey = getFaceTextureKey(block, "py");
  const textureRegion = BLOCK_ATLAS.regions.get(textureKey);
  const shade = 0.86 + hashFloat(wx, wz, y + world.seed) * 0.08;
  const ao = getTopFaceContactShadow(world, wx, y - 1, wz, [1, 1, 1]);
  const lightColors = computeLightColors(world, wx, y + 1, wz);
  const tintScale = shade * lerp(0.82, 1, ao);
  const tint = { r: tintScale * lightColors.r, g: tintScale * lightColors.g, b: tintScale * lightColors.b };
  const plantBlockIntensity = tintScale * lightColors.blockIntensity;
  setPackedTintedColor(color, tint, getPlantTintColor(world, wx, wz, block));

  const planes = [
    [
      [0.12, 0, 0.12],
      [0.88, 0, 0.88],
      [0.88, 0.86, 0.88],
      [0.12, 0.86, 0.12],
    ],
    [
      [0.88, 0, 0.12],
      [0.12, 0, 0.88],
      [0.12, 0.86, 0.88],
      [0.88, 0.86, 0.12],
    ],
  ];
  const uvBounds = getAtlasUvBounds(textureRegion);
  const uvs = [
    [uvBounds.u0, uvBounds.v0],
    [uvBounds.u1, uvBounds.v0],
    [uvBounds.u1, uvBounds.v1],
    [uvBounds.u0, uvBounds.v1],
  ];

  for (const plane of planes) {
    const start = buffers.vertexCount;
    for (let i = 0; i < 4; i += 1) {
      const vertex = plane[i];
      buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
      buffers.normals.push(0, 1, 0);
      buffers.colors.push(color.r, color.g, color.b, plantBlockIntensity);
      buffers.uvs.push(...uvs[i]);
      buffers.waves.push(0);
    }
    buffers.indices.push(
      start,
      start + 1,
      start + 2,
      start,
      start + 2,
      start + 3,
      start + 2,
      start + 1,
      start,
      start + 3,
      start + 2,
      start,
    );
    buffers.vertexCount += 4;
  }
}

function pushWaterlily(buffers, world, wx, y, wz, block, color) {
  const textureRegion = BLOCK_ATLAS.regions.get("waterlily") ?? BLOCK_ATLAS.regions.get("leaves");
  const shade = 0.9 + hashFloat(wx, wz, y + world.seed) * 0.08;
  const lightColors = computeLightColors(world, wx, y + 1, wz);
  const lilyBlockIntensity = shade * lightColors.blockIntensity;
  setPackedTintedColor(color, {
    r: shade * lightColors.r,
    g: shade * lightColors.g,
    b: shade * lightColors.b,
  }, getPlantTintColor(world, wx, wz, block));
  const inset = 0.06;
  const py = 0.035;
  const vertices = [
    [inset, py, 1 - inset],
    [1 - inset, py, 1 - inset],
    [1 - inset, py, inset],
    [inset, py, inset],
  ];
  const uvBounds = getAtlasUvBounds(textureRegion);
  const uvs = [
    [uvBounds.u0, uvBounds.v1],
    [uvBounds.u1, uvBounds.v1],
    [uvBounds.u1, uvBounds.v0],
    [uvBounds.u0, uvBounds.v0],
  ];
  const start = buffers.vertexCount;

  for (let i = 0; i < 4; i += 1) {
    const vertex = vertices[i];
    buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
    buffers.normals.push(0, 1, 0);
    buffers.colors.push(color.r, color.g, color.b, lilyBlockIntensity);
    buffers.uvs.push(...uvs[i]);
    buffers.waves.push(0);
  }
  buffers.indices.push(
    start,
    start + 1,
    start + 2,
    start,
    start + 2,
    start + 3,
    start + 2,
    start + 1,
    start,
    start + 3,
    start + 2,
    start,
  );
  buffers.vertexCount += 4;
}

function pushVine(buffers, world, wx, y, wz, block, color) {
  const textureRegion = BLOCK_ATLAS.regions.get("vine");
  const shade = 0.88 + hashFloat(wx, wz, y + world.seed) * 0.08;
  const lightColors = computeLightColors(world, wx, y + 1, wz);
  const vineBlockIntensity = shade * lightColors.blockIntensity;
  setPackedTintedColor(color, {
    r: shade * lightColors.r,
    g: shade * lightColors.g,
    b: shade * lightColors.b,
  }, getPlantTintColor(world, wx, wz, block));
  const faces = getVineFaces(world, wx, y, wz);
  const renderFaces = faces.length > 0 ? faces : VINE_FACE_DEFS;
  const uvBounds = getAtlasUvBounds(textureRegion);
  const uvs = [
    [uvBounds.u0, uvBounds.v0],
    [uvBounds.u0, uvBounds.v1],
    [uvBounds.u1, uvBounds.v1],
    [uvBounds.u1, uvBounds.v0],
  ];

  for (const face of renderFaces) {
    const start = buffers.vertexCount;
    for (let i = 0; i < 4; i += 1) {
      const vertex = face.vertices[i];
      buffers.positions.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
      buffers.normals.push(...face.normal);
      buffers.colors.push(color.r, color.g, color.b, vineBlockIntensity);
      buffers.uvs.push(...uvs[i]);
      buffers.waves.push(0);
    }
    buffers.indices.push(
      start,
      start + 1,
      start + 2,
      start,
      start + 2,
      start + 3,
      start + 2,
      start + 1,
      start,
      start + 3,
      start + 2,
      start,
    );
    buffers.vertexCount += 4;
  }
}

function getVineFaces(world, wx, y, wz) {
  const direct = getVineFacesAtY(world, wx, y, wz);
  if (direct.length > 0) return direct;

  for (let oy = 1; oy <= 5; oy += 1) {
    if (world.getBlock(wx, y + oy, wz) !== Block.VINE) break;
    const inherited = getVineFacesAtY(world, wx, y + oy, wz);
    if (inherited.length > 0) return inherited;
  }

  return [];
}

function getVineFacesAtY(world, wx, y, wz) {
  return VINE_FACE_DEFS.filter((face) => {
    const [dx, dz] = face.support;
    return isVineSupportBlock(world.getBlock(wx + dx, y, wz + dz));
  });
}

function getLiquidTintColor(world, wx, wz, block) {
  if (isWater(block)) return world.waterColorAt?.(wx, wz) ?? null;
  return null;
}

function getWaterSurfaceHeight(world, wx, y, wz) {
  return getLiquidSurfaceHeight(world, wx, y, wz, Block.WATER);
}

function getLavaSurfaceHeight(world, wx, y, wz) {
  return getLiquidSurfaceHeight(world, wx, y, wz, world.getBlock(wx, y, wz));
}

function getLiquidSurfaceHeight(world, wx, y, wz, liquidBlock) {
  const state = getLiquidFluidState(world, wx, y, wz, liquidBlock);
  if (!state) return 0;
  if (getLiquidFluidState(world, wx, y + 1, wz, liquidBlock)) return 1;
  if (state.falling) return 1;
  if (typeof state.getRenderHeight === "function") return state.getRenderHeight(WATER_MAX_DEPTH);
  const level = getFluidStateLevel(state) ?? 0;
  return Math.max(1 / 16, ((8 - level) * 14) / 128);
}

function isFallingWaterBlock(world, wx, y, wz) {
  return isFallingLiquidBlock(world, wx, y, wz, Block.WATER);
}

function isFallingLiquidBlock(world, wx, y, wz, liquidBlock) {
  const state = getLiquidFluidState(world, wx, y, wz, liquidBlock);
  return Boolean(state?.falling);
}

function shouldRenderFallingLiquidTopCap(world, wx, y, wz, liquidBlock) {
  if (!isFallingLiquidBlock(world, wx, y, wz, liquidBlock)) return false;
  if (!getLiquidFluidState(world, wx, y + 1, wz, liquidBlock)) return false;
  return !isFallingLiquidBlock(world, wx, y + 1, wz, liquidBlock);
}

function getLiquidLevel(world, wx, y, wz, liquidBlock) {
  return getFluidStateLevel(getLiquidFluidState(world, wx, y, wz, liquidBlock));
}

function getWaterDepthAbove(world, wx, y, wz) {
  if (!getLiquidFluidState(world, wx, y, wz, Block.WATER)) return 0;
  let depth = 0;
  for (let sy = y; sy < WORLD_HEIGHT && depth < WATER_DEPTH_VISIBILITY_LIMIT; sy += 1) {
    if (!getLiquidFluidState(world, wx, sy, wz, Block.WATER)) break;
    depth += 1;
  }
  return depth;
}

function getWaterColumnDepth(world, wx, y, wz) {
  if (!getLiquidFluidState(world, wx, y, wz, Block.WATER)) return 0;
  let depth = getWaterDepthAbove(world, wx, y, wz);
  for (let sy = y - 1; sy >= 0 && depth < WATER_DEPTH_VISIBILITY_LIMIT; sy -= 1) {
    if (!getLiquidFluidState(world, wx, sy, wz, Block.WATER)) break;
    depth += 1;
  }
  return depth;
}

function getWaterFaceTopHeights(world, wx, y, wz, face) {
  return getLiquidFaceTopHeights(world, wx, y, wz, Block.WATER, face);
}

function getLiquidFaceTopHeights(world, wx, y, wz, liquidBlock, face) {
  return face.corners.map((corner) => (corner[1] === 1 ? getLiquidCornerHeight(world, wx, y, wz, liquidBlock, corner) : 0));
}

function getWaterCornerHeight(world, wx, y, wz, corner) {
  return getLiquidCornerHeight(world, wx, y, wz, Block.WATER, corner);
}

function getLiquidCornerHeight(world, wx, y, wz, liquidBlock, corner) {
  const sx = corner[0] === 1 ? 1 : -1;
  const sz = corner[2] === 1 ? 1 : -1;
  const offsets = [
    [sx, 0],
    [0, sz],
    [sx, sz],
  ];

  // Any falling-water column at this corner pins it to full block height.
  // Both adjacent cells observe the same 4 cells, so they always agree.
  if (isFallingLiquidBlock(world, wx, y, wz, liquidBlock)) return 1;
  for (const [ox, oz] of offsets) {
    if (isFallingLiquidBlock(world, wx + ox, y, wz + oz, liquidBlock)) return 1;
  }

  const samples = [getLiquidSurfaceHeight(world, wx, y, wz, liquidBlock)];
  for (const [ox, oz] of offsets) {
    if (getLiquidFluidState(world, wx + ox, y, wz + oz, liquidBlock)) {
      samples.push(getLiquidSurfaceHeight(world, wx + ox, y, wz + oz, liquidBlock));
    }
  }

  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function getLiquidFluidState(world, wx, y, wz, liquidBlock) {
  const state = world.getFluidState?.(wx, y, wz);
  if (!state || state.isEmpty?.() || state.empty) return null;
  return getFluidStateId(state) === getLiquidFluidId(liquidBlock) ? state : null;
}

function getLiquidFluidId(liquidBlock) {
  if (isWater(liquidBlock)) return "water";
  if (isLava(liquidBlock)) return "lava";
  return null;
}

function getFluidStateId(state) {
  return state?.type?.id ?? state?.fluidId ?? null;
}

function getFluidStateLevel(state) {
  if (!state) return null;
  if (typeof state.getLevel === "function") return state.getLevel(WATER_MAX_DEPTH);
  return state.level ?? null;
}

function getVertexAmbientOcclusion(world, wx, y, wz, face, corner) {
  if (!smoothLightingEnabled) return 1;
  const axes = getFacePlaneAxes(face.dir);
  const sideA = sampleAoBlock(world, wx, y, wz, face.dir, axes[0], corner);
  const sideB = sampleAoBlock(world, wx, y, wz, face.dir, axes[1], corner);
  const diagonal = sampleAoBlock(world, wx, y, wz, face.dir, axes[0], corner, axes[1]);
  const ao = sideA && sideB ? 0 : 3 - Number(sideA) - Number(sideB) - Number(diagonal);
  let light = 0.68 + ao * 0.1067;

  if (face.name === "py") {
    light *= getTopFaceContactShadow(world, wx, y, wz, corner);
  } else if (face.name !== "ny") {
    light *= getSideFaceContactShadow(world, wx, y, wz, face, corner);
  }

  return clamp(light, 0.45, 1);
}

function getTopFaceContactShadow(world, wx, y, wz, corner) {
  let shadow = 1;
  const sx = corner[0] === 1 ? 1 : -1;
  const sz = corner[2] === 1 ? 1 : -1;
  const sideX = isSolid(world.getBlock(wx + sx, y + 1, wz));
  const sideZ = isSolid(world.getBlock(wx, y + 1, wz + sz));
  const diagonal = isSolid(world.getBlock(wx + sx, y + 1, wz + sz));
  const oppositeX = isSolid(world.getBlock(wx - sx, y + 1, wz));
  const oppositeZ = isSolid(world.getBlock(wx, y + 1, wz - sz));

  if (isSolid(world.getBlock(wx, y + 2, wz))) shadow *= 0.7;
  if (sideX) shadow *= 0.8;
  if (sideZ) shadow *= 0.8;
  if (diagonal) shadow *= 0.88;
  if ((sideX && oppositeZ) || (sideZ && oppositeX) || (sideX && sideZ)) shadow *= 0.68;

  return shadow;
}

function getSideFaceContactShadow(world, wx, y, wz, face, corner) {
  let shadow = 1;
  const above = isSolid(world.getBlock(wx, y + 1, wz));
  const ledge = isSolid(world.getBlock(wx + face.dir[0], y + 1, wz + face.dir[2]));
  const belowLedge = isSolid(world.getBlock(wx + face.dir[0], y - 1, wz + face.dir[2]));
  const sideAxis = face.dir[0] !== 0 ? 2 : 0;
  const side = corner[sideAxis] === 1 ? 1 : -1;
  const sideBlock = sideAxis === 2
    ? isSolid(world.getBlock(wx + face.dir[0], y, wz + side))
    : isSolid(world.getBlock(wx + side, y, wz + face.dir[2]));

  if (above) shadow *= 0.9;
  if (ledge) shadow *= 0.86;
  if (belowLedge) shadow *= 0.94;
  if (sideBlock) shadow *= 0.92;
  return shadow;
}

function getFacePlaneAxes(dir) {
  if (dir[0] !== 0) return [1, 2];
  if (dir[1] !== 0) return [0, 2];
  return [0, 1];
}

function sampleAoBlock(world, wx, y, wz, dir, axisA, corner, axisB = null) {
  const offset = [dir[0], dir[1], dir[2]];
  offset[axisA] += corner[axisA] === 1 ? 1 : -1;
  if (axisB !== null) offset[axisB] += corner[axisB] === 1 ? 1 : -1;
  return isSolid(world.getBlock(wx + offset[0], y + offset[1], wz + offset[2]));
}

function getFaceColor(block, faceName) {
  const definition = BLOCKS[block] ?? BLOCKS[Block.STONE];
  if (faceName === "py") return definition.top;
  if (faceName === "ny") return definition.bottom;
  return definition.side;
}

function getFaceTextureKey(block, faceName) {
  const extraTexture = getExtraBlockFaceTexture(block, faceName);
  if (extraTexture) return extraTexture;

  if (block === Block.GRASS) {
    if (faceName === "py") return "grass_top";
    if (faceName === "ny") return "dirt";
    return "dirt";
  }

  if (block === Block.LOG) return faceName === "py" || faceName === "ny" ? "log_top" : "log_side";
  if (block === Block.SPRUCE_LOG) return faceName === "py" || faceName === "ny" ? "spruce_log_top" : "spruce_log_side";
  if (block === Block.JUNGLE_LOG) return faceName === "py" || faceName === "ny" ? "jungle_log_top" : "jungle_log_side";
  if (block === Block.ACACIA_LOG) return faceName === "py" || faceName === "ny" ? "acacia_log_top" : "acacia_log_side";
  if (block === Block.DARK_OAK_LOG) return faceName === "py" || faceName === "ny" ? "dark_oak_log_top" : "dark_oak_log_side";
  if (block === Block.CRAFTING_TABLE) {
    if (faceName === "py") return "crafting_top";
    if (faceName === "nz") return "crafting_front";
    return "crafting_side";
  }
  if (block === Block.PODZOL) {
    if (faceName === "py") return "podzol_top";
    if (faceName === "ny") return "dirt";
    return "podzol_side";
  }
  if (block === Block.JUNGLE_GRASS) {
    if (faceName === "py") return "jungle_grass_top";
    if (faceName === "ny") return "mud";
    return "mud";
  }
  if (block === Block.MEADOW_GRASS) {
    if (faceName === "py") return "meadow_grass_top";
    if (faceName === "ny") return "dirt";
    return "dirt";
  }
  if (block === Block.SAVANNA_GRASS) {
    if (faceName === "py") return "savanna_grass_top";
    if (faceName === "ny") return "coarse_dirt";
    return "coarse_dirt";
  }
  if (block === Block.DRY_GRASS) {
    if (faceName === "py") return "dry_grass_top";
    if (faceName === "ny") return "dirt";
    return "dirt";
  }
  if (block === Block.CACTUS) return faceName === "py" || faceName === "ny" ? "cactus_top" : "cactus_side";
  if (block === Block.BIRCH_LOG) return faceName === "py" || faceName === "ny" ? "birch_log_top" : "birch_log_side";
  if (block === Block.SNOW_GRASS) {
    if (faceName === "py") return "snow";
    if (faceName === "ny") return "dirt";
    return "snow_grass_side";
  }
  if (block === Block.MYCELIUM) {
    if (faceName === "py") return "mycelium_top";
    if (faceName === "ny") return "dirt";
    return "mycelium_side";
  }
  if (block === Block.WATER) return "water";
  if (block === Block.DIRT) return "dirt";
  if (block === Block.STONE) return "stone";
  if (block === Block.SAND) return "sand";
  if (block === Block.SANDSTONE) return "sandstone";
  if (block === Block.GRAVEL) return "gravel";
  if (block === Block.COBBLESTONE) return "cobblestone";
  if (block === Block.COAL_ORE) return "coal_ore";
  if (block === Block.IRON_ORE) return "iron_ore";
  if (block === Block.COPPER_ORE) return "copper_ore";
  if (block === Block.GOLD_ORE) return "gold_ore";
  if (block === Block.DIAMOND_ORE) return "diamond_ore";
  if (block === Block.RED_SAND) return "red_sand";
  if (block === Block.TERRACOTTA) return "terracotta";
  if (block === Block.WHITE_TERRACOTTA) return "white_terracotta";
  if (block === Block.SNOW) return "snow";
  if (block === Block.BIRCH_LEAVES) return "birch_leaves";
  if (block === Block.ACACIA_LEAVES) return "acacia_leaves";
  if (block === Block.DARK_OAK_LEAVES) return "dark_oak_leaves";
  if (block === Block.MOSS) return "moss";
  if (block === Block.WILDFLOWER) return "wildflower";
  if (block === Block.FERN) return "fern";
  if (block === Block.TALL_GRASS) return "tall_grass";
  if (block === Block.GRANITE) return "granite";
  if (block === Block.DIORITE) return "diorite";
  if (block === Block.ANDESITE) return "andesite";
  if (block === Block.DEEPSLATE) return "deepslate";
  if (block === Block.ICE) return "ice";
  if (block === Block.PACKED_ICE) return "packed_ice";
  if (block === Block.DANDELION) return "dandelion";
  if (block === Block.POPPY) return "poppy";
  if (block === Block.BLUE_ORCHID) return "blue_orchid";
  if (block === Block.DEAD_BUSH) return "dead_bush";
  if (block === Block.BERRY_BUSH) return "berry_bush";
  if (block === Block.SUGAR_CANE) return "sugar_cane";
  if (block === Block.PUMPKIN) return faceName === "py" || faceName === "ny" ? "pumpkin_top" : "pumpkin_side";
  if (block === Block.MELON) return faceName === "py" || faceName === "ny" ? "melon_top" : "melon_side";
  if (block === Block.VINE) return "vine";
  if (block === Block.COARSE_DIRT) return "coarse_dirt";
  if (block === Block.CLOVER) return "clover";
  if (block === Block.SAVANNA_SHRUB) return "savanna_shrub";
  if (block === Block.BROWN_MUSHROOM) return "brown_mushroom";
  if (block === Block.RED_MUSHROOM) return "red_mushroom";
  if (block === Block.SUNFLOWER) return "sunflower";
  if (block === Block.WATERLILY) return "waterlily";
  if (block === Block.LIMESTONE) return "limestone";
  if (block === Block.BASALT) return "basalt";
  if (block === Block.SLATE) return "slate";
  if (block === Block.LEAVES) return "leaves";
  if (block === Block.SPRUCE_LEAVES) return "spruce_leaves";
  if (block === Block.JUNGLE_LEAVES) return "jungle_leaves";
  if (block === Block.PLANK) return "plank";
  if (block === Block.CLAY) return "clay";
  if (block === Block.MUD) return "mud";
  if (block === Block.BEDROCK) return "bedrock";
  return "stone";
}

function getItemTextureKey(id) {
  if (id === "grass") return "grass_top";
  if (id === "dirt") return "dirt";
  if (id === "stone") return "stone";
  if (id === "sand") return "sand";
  if (id === "log") return "log_side";
  if (id === "spruce_log") return "spruce_log_side";
  if (id === "jungle_log") return "jungle_log_side";
  if (id === "birch_log") return "birch_log_side";
  if (id === "acacia_log") return "acacia_log_side";
  if (id === "leaves") return "leaves";
  if (id === "spruce_leaves") return "spruce_leaves";
  if (id === "jungle_leaves") return "jungle_leaves";
  if (id === "birch_leaves") return "birch_leaves";
  if (id === "acacia_leaves") return "acacia_leaves";
  if (id === "plank") return "plank";
  if (id === "clay") return "clay";
  if (id === "crafting_table") return "crafting_top";
  if (id === "podzol") return "podzol_top";
  if (id === "jungle_grass") return "jungle_grass_top";
  if (id === "mud") return "mud";
  if (id === "sandstone") return "sandstone";
  if (id === "cactus") return "cactus_side";
  if (id === "gravel") return "gravel";
  if (id === "cobblestone") return "cobblestone";
  if (id === "coal_ore") return "coal_ore";
  if (id === "iron_ore") return "iron_ore";
  if (id === "copper_ore") return "copper_ore";
  if (id === "gold_ore") return "gold_ore";
  if (id === "diamond_ore") return "diamond_ore";
  if (id === "red_sand") return "red_sand";
  if (id === "terracotta") return "terracotta";
  if (id === "white_terracotta") return "white_terracotta";
  if (id === "snow_grass") return "snow";
  if (id === "snow") return "snow";
  if (id === "moss") return "moss";
  if (id === "wildflower") return "wildflower";
  if (id === "fern") return "fern";
  if (id === "meadow_grass") return "meadow_grass_top";
  if (id === "dry_grass") return "dry_grass_top";
  if (id === "coarse_dirt") return "coarse_dirt";
  if (id === "savanna_grass") return "savanna_grass_top";
  if (id === "clover") return "clover";
  if (id === "savanna_shrub") return "savanna_shrub";
  if (id === "limestone") return "limestone";
  if (id === "basalt") return "basalt";
  if (id === "slate") return "slate";
  if (id === "tall_grass") return "tall_grass";
  if (id === "granite") return "granite";
  if (id === "diorite") return "diorite";
  if (id === "andesite") return "andesite";
  if (id === "deepslate") return "deepslate";
  if (id === "ice") return "ice";
  if (id === "packed_ice") return "packed_ice";
  if (id === "dandelion") return "dandelion";
  if (id === "poppy") return "poppy";
  if (id === "blue_orchid") return "blue_orchid";
  if (id === "dead_bush") return "dead_bush";
  if (id === "berry_bush") return "berry_bush";
  if (id === "sugar_cane") return "sugar_cane";
  if (id === "pumpkin") return "pumpkin_side";
  if (id === "melon") return "melon_side";
  if (id === "vine") return "vine";
  if (id === "waterlily") return "waterlily";
  if (id === "coal_ore") return "coal_ore";
  if (id === "iron_ore") return "iron_ore";
  if (id === "copper_ore") return "iron_ore";
  if (id === "gold_ore") return "gold_ore";
  if (id === "diamond_ore") return "diamond_ore";
  if (id === "raw_iron") return "iron_ore";
  if (id === "raw_copper") return "iron_ore";
  if (id === "raw_gold") return "gold_ore";
  if (id === "copper_ingot") return "gold_ore";
  return "plank";
}

function getFaceUv(region, cornerIndex, shift = [0, 0]) {
  const { u0, u1, v0, v1 } = getAtlasUvBounds(region);
  const uv = [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ][cornerIndex];
  return [uv[0] + shift[0], uv[1] + shift[1]];
}

function leafBlockUv(block, region, cornerIndex, wx, y, wz, face, seed, shift = [0, 0]) {
  if (!isLeafBlock(block)) return getFaceUv(region, cornerIndex, shift);
  const { u0, u1, v0, v1 } = getAtlasUvBounds(region);
  let [u, v] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ][cornerIndex];
  const salt = face.name.charCodeAt(0) * 31 + face.name.charCodeAt(1);
  const variant = Math.floor(hashFloat(wx + y * 17, wz - y * 31, seed ^ salt ^ 0x1eaf) * 8) & 7;
  if (variant & 1) u = 1 - u;
  if (variant & 2) v = 1 - v;
  if (variant & 4) [u, v] = [v, 1 - u];
  return [lerp(u0, u1, u) + shift[0], lerp(v0, v1, v) + shift[1]];
}

function getAtlasUvBounds(region) {
  const uInset = (region.u1 - region.u0) / (ATLAS_TILE_SIZE * 2);
  const vInset = (region.v1 - region.v0) / (ATLAS_TILE_SIZE * 2);
  return {
    u0: region.u0 + uInset,
    u1: region.u1 - uInset,
    v0: region.v0 + vInset,
    v1: region.v1 - vInset,
  };
}

function getFullTileUv(cornerIndex, shift = [0, 0]) {
  const inset = 0.001;
  const uv = [
    [inset, inset],
    [inset, 1 - inset],
    [1 - inset, 1 - inset],
    [1 - inset, inset],
  ][cornerIndex];
  return [uv[0] + shift[0], uv[1] + shift[1]];
}

function getTextureFile(key) {
  return BLOCK_TEXTURE_FILES[key] ?? BLOCK_TEXTURE_FILES.stone;
}

async function loadNamedBlockTextures() {
  const uniqueFiles = new Set([...BLOCK_TEXTURE_KEYS.map(getTextureFile), ...DESTROY_STAGE_FILES]);
  await Promise.all(
    [...uniqueFiles].map(async (file) => {
      const url = BLOCK_TEXTURE_URL_BY_FILE.get(file);
      if (!url) {
        console.warn(`Missing block texture file: ${file}`);
        return;
      }

      const image = new Image();
      image.decoding = "async";
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(`Failed to load block texture: ${file}`));
      });
      image.src = url;
      await loaded;
      BLOCK_TEXTURE_IMAGES.set(file, image);
    }),
  );
}

function createAtlasRegion(index, atlasWidth, atlasHeight) {
  const cellX = (index % ATLAS_COLUMNS) * ATLAS_CELL_SIZE;
  const cellY = Math.floor(index / ATLAS_COLUMNS) * ATLAS_CELL_SIZE;
  const x = cellX + ATLAS_TILE_PADDING;
  const y = cellY + ATLAS_TILE_PADDING;

  return {
    x,
    y,
    size: ATLAS_TILE_SIZE,
    u0: x / atlasWidth,
    u1: (x + ATLAS_TILE_SIZE) / atlasWidth,
    v0: 1 - (y + ATLAS_TILE_SIZE) / atlasHeight,
    v1: 1 - y / atlasHeight,
  };
}

function padAtlasTile(ctx, x, y, size = ATLAS_TILE_SIZE, padding = ATLAS_TILE_PADDING) {
  if (padding <= 0) return;

  ctx.drawImage(ctx.canvas, x, y, size, 1, x, y - padding, size, padding);
  ctx.drawImage(ctx.canvas, x, y + size - 1, size, 1, x, y + size, size, padding);
  ctx.drawImage(ctx.canvas, x, y, 1, size, x - padding, y, padding, size);
  ctx.drawImage(ctx.canvas, x + size - 1, y, 1, size, x + size, y, padding, size);

  ctx.drawImage(ctx.canvas, x, y, 1, 1, x - padding, y - padding, padding, padding);
  ctx.drawImage(ctx.canvas, x + size - 1, y, 1, 1, x + size, y - padding, padding, padding);
  ctx.drawImage(ctx.canvas, x, y + size - 1, 1, 1, x - padding, y + size, padding, padding);
  ctx.drawImage(ctx.canvas, x + size - 1, y + size - 1, 1, 1, x + size, y + size, padding, padding);
}

function isFallbackLeafTextureKey(key) {
  return (
    key === "leaves" ||
    key === "spruce_leaves" ||
    key === "jungle_leaves" ||
    key === "birch_leaves" ||
    key === "acacia_leaves" ||
    key === "dark_oak_leaves"
  );
}

function cutFallbackLeafAlpha(ctx, x, y, size) {
  for (let i = 0; i < 14; i += 1) {
    const dx = (i * 5 + 3) % size;
    const dy = (i * 7 + 2) % size;
    ctx.clearRect(x + dx, y + dy, 1, 1);
  }
}

function prepareLeafTextureTile(ctx, key, x, y, size) {
  if (!LEAF_TEXTURE_KEYS.has(key)) return;
  const image = ctx.getImageData(x, y, size, size);
  const data = image.data;
  const fallbackColors = {
    leaves: hexToRgb("#3f8540"),
    spruce_leaves: hexToRgb("#26583d"),
    jungle_leaves: hexToRgb("#2c8d3d"),
    birch_leaves: hexToRgb("#6eaa45"),
    acacia_leaves: hexToRgb("#587638"),
    dark_oak_leaves: hexToRgb("#285424"),
  };
  const fallback = fallbackColors[key] ?? fallbackColors.leaves;
  const source = new Uint8ClampedArray(data);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const offset = (py * size + px) * 4;
      if (source[offset + 3] >= 128) {
        data[offset + 3] = 255;
        continue;
      }

      let r = 0;
      let g = 0;
      let b = 0;
      let samples = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const sx = px + ox;
          const sy = py + oy;
          if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue;
          const sampleOffset = (sy * size + sx) * 4;
          if (source[sampleOffset + 3] < 24) continue;
          r += source[sampleOffset];
          g += source[sampleOffset + 1];
          b += source[sampleOffset + 2];
          samples += 1;
        }
      }

      const fillR = samples > 0 ? Math.round(r / samples) : fallback.r;
      const fillG = samples > 0 ? Math.round(g / samples) : fallback.g;
      const fillB = samples > 0 ? Math.round(b / samples) : fallback.b;
      data[offset] = fillR;
      data[offset + 1] = fillG;
      data[offset + 2] = fillB;
      data[offset + 3] = 0;
    }
  }

  ctx.putImageData(image, x, y);
}

function drawAtlasTile(ctx, key, x, y, size = ATLAS_TILE_SIZE) {
  const image = BLOCK_TEXTURE_IMAGES.get(getTextureFile(key));
  ctx.imageSmoothingEnabled = false;

  if (image) {
    ctx.drawImage(
      image,
      0,
      0,
      ATLAS_TILE_SIZE,
      ATLAS_TILE_SIZE,
      x,
      y,
      size,
      size,
    );
    prepareLeafTextureTile(ctx, key, x, y, size);
    padAtlasTile(ctx, x, y, size);
    return;
  }

  drawBlockTexture(ctx, key, x, y, size);
  if (key !== "grass_side_overlay") {
    polishTextureTile(ctx, key, x, y, size);
    if (isFallbackLeafTextureKey(key)) cutFallbackLeafAlpha(ctx, x, y, size);
    prepareLeafTextureTile(ctx, key, x, y, size);
  }
  padAtlasTile(ctx, x, y, size);
}

function createBlockTextureAtlas() {
  const keys = BLOCK_TEXTURE_KEYS;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLUMNS * ATLAS_CELL_SIZE;
  canvas.height = ATLAS_ROWS * ATLAS_CELL_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const regions = new Map();

  keys.forEach((key, index) => {
    const region = createAtlasRegion(index, canvas.width, canvas.height);
    regions.set(key, region);
    drawAtlasTile(ctx, key, region.x, region.y, region.size);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = WORLD_TEXTURE_MIN_FILTER;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;

  return { canvas, texture, regions, size: ATLAS_TILE_SIZE };
}

function applyNamedBlockTextures() {
  const atlasCtx = BLOCK_ATLAS.canvas.getContext("2d");
  atlasCtx.imageSmoothingEnabled = false;
  atlasCtx.clearRect(0, 0, BLOCK_ATLAS.canvas.width, BLOCK_ATLAS.canvas.height);

  for (const key of BLOCK_TEXTURE_KEYS) {
    const region = BLOCK_ATLAS.regions.get(key);
    drawAtlasTile(atlasCtx, key, region.x, region.y, region.size);
  }

  BLOCK_ATLAS.texture.needsUpdate = true;

  drawAtlasTile(WATER_TEXTURE.userData.ctx, "water", 0, 0, WATER_TEXTURE.userData.size);
  applyNaturalWaterTextureTone(WATER_TEXTURE.userData.ctx, WATER_TEXTURE.userData.size);
  WATER_TEXTURE.needsUpdate = true;
  drawAtlasTile(LAVA_TEXTURE.userData.ctx, "lava_still", 0, 0, LAVA_TEXTURE.userData.size);
  LAVA_TEXTURE.needsUpdate = true;

  refreshCrackTextures();
  refreshItemSprites();
}

function createWaterTexture() {
  return createLiquidTexture("water", "water_still.png");
}

function createLavaTexture() {
  return createLiquidTexture("lava_still", "lava_still.png");
}

function createLiquidTexture(textureKey, animatedFile) {
  const size = ATLAS_TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  drawAtlasTile(ctx, textureKey, 0, 0, size);
  if (textureKey === "water") applyNaturalWaterTextureTone(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = WORLD_TEXTURE_MIN_FILTER;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.userData = { canvas, ctx, size, frame: 0, staticAtlas: false, sourceImage: null, frameCount: 1, textureKey };
  loadAnimatedLiquidSource(texture, animatedFile);
  return texture;
}

function loadAnimatedLiquidSource(texture, file) {
  const url = BLOCK_TEXTURE_URL_BY_FILE.get(file);
  if (!url) return;
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    texture.userData.sourceImage = image;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const frames = Math.max(1, Math.floor(sourceHeight / Math.max(1, sourceWidth)));
    texture.userData.frameCount = frames;
    drawLiquidFrame(texture, 0);
    texture.needsUpdate = true;
  };
  image.src = url;
}

function drawWaterFrame(texture, frame) {
  drawLiquidFrame(texture, frame);
}

function drawLiquidFrame(texture, frame) {
  const { ctx, size, sourceImage, frameCount } = texture.userData;
  if (!sourceImage) return;
  const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
  const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
  const frameHeight = sourceHeight / Math.max(1, frameCount);
  const safeFrame = ((frame % frameCount) + frameCount) % frameCount;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(
    sourceImage,
    0,
    safeFrame * frameHeight,
    sourceWidth,
    frameHeight,
    0,
    0,
    size,
    size,
  );
  if (texture.userData.textureKey === "water") applyNaturalWaterTextureTone(ctx, size);
}

function drawAnimatedWaterTexture(ctx, size, frame) {
  const px = (dx, dy, color, width = 1, height = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(dx, dy, width, height);
  };
  const palette = ["#244f64", "#2d5b72", "#386a82", "#487d94", "#5d91a8"];
  const highlight = "rgba(150, 198, 212, 0.5)";
  const dark = "rgba(25, 64, 82, 0.72)";

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const swirlA = Math.sin((x + frame * 0.75) * 0.45 + y * 0.18);
      const swirlB = Math.cos((y - frame * 0.5) * 0.38 + x * 0.22);
      const noise = hashFloat(x + frame, y - frame, 116);
      const pick = clamp(Math.floor((swirlA + swirlB + noise * 1.35 + 3) * 0.62), 0, palette.length - 1);
      px(x, y, palette[pick]);
    }
  }

  for (let i = 0; i < 5; i += 1) {
    const y = mod(i * 5 + Math.floor(frame * 0.8), size);
    const x = mod(i * 11 + Math.floor(frame * 0.35), size);
    px(x, y, highlight, 4, 1);
    if (x + 4 > size) px(0, y, highlight, x + 4 - size, 1);
  }

  for (let i = 0; i < 5; i += 1) {
    const y = mod(i * 9 - Math.floor(frame * 0.55), size);
    const x = mod(i * 7 + Math.floor(frame * 0.45), size);
    px(x, y, dark, 3, 1);
    if (x + 3 > size) px(0, y, dark, x + 3 - size, 1);
  }
  applyNaturalWaterTextureTone(ctx, size);
}

function applyNaturalWaterTextureTone(ctx, size) {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(data[index], data[index + 1], data[index + 2]);
    const hue = lerp(h, 0.57, 0.45);
    const saturation = clamp(s * 0.58, 0, 0.74);
    const lightness = clamp(l * 0.78, 0.16, 0.48);
    const [r, g, b] = hslToRgb(hue, saturation, lightness);
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }

  ctx.putImageData(image, 0, 0);
}

const PLANT_TEXTURE_KEYS = new Set([
  "wildflower",
  "fern",
  "tall_grass",
  "dandelion",
  "poppy",
  "blue_orchid",
  "dead_bush",
  "berry_bush",
  "sugar_cane",
  "vine",
  "clover",
  "savanna_shrub",
]);

const LEAF_TEXTURE_KEYS = new Set(["leaves", "spruce_leaves", "jungle_leaves", "birch_leaves", "acacia_leaves", "dark_oak_leaves"]);

function polishTextureTile(ctx, key, x, y, size) {
  const image = ctx.getImageData(x, y, size, size);
  const tone = getTextureTone(key);
  const tint = hexToRgb(tone.tint);
  const data = image.data;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;

    const [h, s, l] = rgbToHsl(data[index], data[index + 1], data[index + 2]);
    const contrastLightness = 0.5 + (l - 0.5) * tone.contrast + tone.lightness;
    const liftedLightness = l < 0.18 ? lerp(contrastLightness, 0.22, 0.35) : contrastLightness;
    const [rr, gg, bb] = hslToRgb(h, clamp(s * tone.saturation, 0, 1), clamp(liftedLightness, 0.04, 0.96));

    data[index] = Math.round(lerp(rr, tint.r, tone.tintMix));
    data[index + 1] = Math.round(lerp(gg, tint.g, tone.tintMix));
    data[index + 2] = Math.round(lerp(bb, tint.b, tone.tintMix));
  }

  ctx.putImageData(image, x, y);
  drawMaterialPolish(ctx, key, x, y, size);
}

function getTextureTone(key) {
  if (PLANT_TEXTURE_KEYS.has(key)) {
    return { tint: "#7faa61", tintMix: 0.08, saturation: 0.82, contrast: 0.78, lightness: 0.02 };
  }
  if (LEAF_TEXTURE_KEYS.has(key)) {
    return { tint: "#5f8750", tintMix: 0.1, saturation: 0.78, contrast: 0.72, lightness: 0.018 };
  }
  if (key.includes("grass") || key === "moss" || key === "podzol_top") {
    return { tint: "#7aa15b", tintMix: 0.09, saturation: 0.76, contrast: 0.72, lightness: 0.018 };
  }
  if (key.includes("log") || key === "plank" || key.includes("crafting")) {
    return { tint: "#9a7350", tintMix: 0.08, saturation: 0.76, contrast: 0.76, lightness: 0.01 };
  }
  if (key.includes("sand") || key.includes("terracotta")) {
    return { tint: "#d0bd7b", tintMix: 0.08, saturation: 0.68, contrast: 0.72, lightness: 0.02 };
  }
  if (key === "snow" || key === "snow_grass_side" || key.includes("ice")) {
    return { tint: "#d8edf0", tintMix: 0.1, saturation: 0.58, contrast: 0.66, lightness: 0.025 };
  }
  if (key.includes("ore")) {
    return { tint: "#8c9088", tintMix: 0.07, saturation: 0.82, contrast: 0.76, lightness: 0.012 };
  }
  if (key === "water") {
    return { tint: "#5da2c6", tintMix: 0.12, saturation: 0.74, contrast: 0.7, lightness: 0.015 };
  }
  if (key === "bedrock" || key === "basalt" || key === "deepslate") {
    return { tint: "#4d5458", tintMix: 0.1, saturation: 0.54, contrast: 0.68, lightness: 0.025 };
  }
  if (key === "dirt" || key === "coarse_dirt" || key === "mud" || key === "podzol_side") {
    return { tint: "#795d43", tintMix: 0.09, saturation: 0.72, contrast: 0.74, lightness: 0.014 };
  }
  return { tint: "#8d938c", tintMix: 0.08, saturation: 0.62, contrast: 0.72, lightness: 0.014 };
}

function drawMaterialPolish(ctx, key, x, y, size) {
  if (PLANT_TEXTURE_KEYS.has(key) || LEAF_TEXTURE_KEYS.has(key)) return;

  const px = (dx, dy, color, width = 1, height = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + dx, y + dy, width, height);
  };
  const speck = (count, light, dark, seed) => {
    for (let i = 0; i < count; i += 1) {
      const sx = hashInt(i, seed, seed + 1, size);
      const sy = hashInt(i, seed + 2, seed + 3, size);
      px(sx, sy, i % 3 === 0 ? light : dark);
    }
  };

  if (key.includes("grass") || key === "moss") {
    speck(8, "rgba(204, 226, 142, 0.18)", "rgba(38, 85, 39, 0.14)", 701);
    return;
  }

  if (key === "dirt" || key === "coarse_dirt" || key === "mud" || key === "podzol_side") {
    speck(8, "rgba(189, 151, 101, 0.18)", "rgba(61, 42, 30, 0.16)", 711);
    return;
  }

  if (key.includes("sand") || key.includes("terracotta")) {
    speck(12, "rgba(255, 239, 172, 0.22)", "rgba(133, 100, 63, 0.18)", 731);
    return;
  }

  if (key.includes("stone") || key === "gravel" || key === "cobblestone" || key === "limestone" || key === "slate") {
    for (let i = 0; i < 4; i += 1) {
      const sx = hashInt(i, 721, 722, size - 6);
      const sy = 3 + hashInt(i, 723, 724, size - 5);
      px(sx, sy, "rgba(36, 40, 42, 0.18)", 6, 1);
      px(sx + 1, sy + 1, "rgba(229, 232, 222, 0.12)", 4, 1);
    }
    return;
  }

  if (key.includes("log_side")) {
    for (let ix = 3; ix < size; ix += 5) {
      px(ix, 0, "rgba(50, 32, 21, 0.2)", 1, size);
      px(ix + 1, 0, "rgba(224, 175, 111, 0.12)", 1, size);
    }
    return;
  }

  if (key === "plank" || key.includes("crafting")) {
    for (let row = 4; row < size; row += 4) px(0, row, "rgba(76, 48, 25, 0.2)", size, 1);
    return;
  }

  if (key === "snow" || key.includes("ice")) {
    speck(9, "rgba(255, 255, 255, 0.32)", "rgba(118, 163, 179, 0.14)", 741);
    return;
  }

  if (key === "water") {
    for (let i = 0; i < 4; i += 1) {
      const sx = hashInt(i, 751, 752, size - 3);
      const sy = hashInt(i, 753, 754, size);
      px(sx, sy, "rgba(224, 249, 255, 0.34)", 3, 1);
    }
  }
}

function hexToRgb(hex) {
  const value = typeof hex === "number" ? hex : Number.parseInt(hex.replace("#", ""), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }

  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const hueToRgb = (p, q, tInput) => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

function drawBlockTexture(ctx, key, x, y, size) {
  if (size !== 32) {
    const tile = document.createElement("canvas");
    tile.width = 32;
    tile.height = 32;
    const tileCtx = tile.getContext("2d");
    tileCtx.imageSmoothingEnabled = false;
    drawBlockTexture(tileCtx, key, 0, 0, 32);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, 0, 0, 32, 32, x, y, size, size);
    return;
  }

  const px = (dx, dy, color, width = 1, height = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + dx, y + dy, width, height);
  };
  const fillNoise = (base, palette, seed) => {
    px(0, 0, base, size, size);
    const baseRgb = hexToRgb(base);
    for (let iy = 0; iy < size; iy += 1) {
      for (let ix = 0; ix < size; ix += 1) {
        const pick = Math.floor(hashFloat(ix, iy, seed) * palette.length);
        const chosen = hexToRgb(palette[pick]);
        const blend = 0.32 + hashFloat(ix + seed, iy - seed, seed + 91) * 0.18;
        px(ix, iy, rgbToCss({
          r: Math.round(lerp(baseRgb.r, chosen.r, blend)),
          g: Math.round(lerp(baseRgb.g, chosen.g, blend)),
          b: Math.round(lerp(baseRgb.b, chosen.b, blend)),
        }));
      }
    }
  };
  const drawOre = (seed, palette) => {
    drawBlockTexture(ctx, "stone", x, y, size);
    for (let i = 0; i < 18; i += 1) {
      const sx = hashInt(i, seed, seed + 1, size - 4);
      const sy = hashInt(i, seed + 2, seed + 3, size - 4);
      const color = palette[i % palette.length];
      px(sx, sy, color, 2 + (i % 2), 2);
      if (i % 4 === 0) px(sx + 1, sy + 1, "#eaf7f4", 1, 1);
    }
  };
  const cutLeafHoles = (seed, count = 28) => {
    for (let i = 0; i < count; i += 1) {
      const sx = hashInt(i, seed, seed + 1, size - 2);
      const sy = hashInt(i, seed + 2, seed + 3, size - 2);
      const holeSize = i % 5 === 0 ? 2 : 1;
      ctx.clearRect(x + sx, y + sy, holeSize, holeSize);
    }
  };

  if (key === "grass_top") {
    fillNoise("#4d9a3c", ["#3f8435", "#4f9e3c", "#65b74a", "#6cc45b", "#2f6f31"], 11);
    for (let i = 0; i < 24; i += 1) {
      const sx = hashInt(i, 91, 12, size);
      const sy = hashInt(i, 43, 13, size);
      px(sx, sy, "#7dbf61", 1, 2);
    }
    return;
  }

  if (key === "grass_side") {
    fillNoise("#7a5736", ["#6c4a2d", "#7e5a38", "#8c6742", "#5b3d28"], 21);
    for (let ix = 0; ix < size; ix += 1) {
      const grassDepth = 6 + hashInt(ix, 9, 22, 5);
      px(ix, 0, "#5daf45", 1, grassDepth);
      if (ix % 3 === 0) px(ix, grassDepth - 1, "#76c95b", 1, 2);
    }
    for (let i = 0; i < 24; i += 1) {
      px(hashInt(i, 1, 23, size), 12 + hashInt(i, 2, 24, 17), "#4e341f", 1, 2);
    }
    return;
  }

  if (key === "grass_side_overlay") {
    ctx.clearRect(x, y, size, size);
    for (let ix = 0; ix < size; ix += 1) {
      const grassDepth = 4 + hashInt(ix, 9, 22, 6);
      for (let iy = 0; iy < grassDepth; iy += 1) {
        const shade = 110 + hashInt(ix + iy, 13, 23, 58);
        px(ix, iy, `rgba(${shade}, ${shade}, ${shade}, 1)`);
      }
    }
    return;
  }

  if (key === "dirt") {
    fillNoise("#715031", ["#5c3f27", "#6d4b2f", "#7c5837", "#8a6745", "#4f3322"], 31);
    for (let i = 0; i < 24; i += 1) px(hashInt(i, 4, 32, size), hashInt(i, 5, 33, size), "#8f6d4d", 2, 1);
    return;
  }

  if (key === "stone") {
    fillNoise("#7d8992", ["#6a747c", "#77838c", "#87949e", "#9aa5ad", "#59636b"], 41);
    for (let i = 0; i < 7; i += 1) {
      const sx = hashInt(i, 8, 42, size - 7);
      const sy = hashInt(i, 9, 43, size - 3);
      px(sx, sy, "#59646b", 7, 1);
      px(sx + 3, sy + 1, "#68747b", 1, 4);
    }
    return;
  }

  if (key === "granite") {
    fillNoise("#936858", ["#805849", "#956958", "#aa7a67", "#bf917d", "#68483d"], 142);
    for (let i = 0; i < 30; i += 1) {
      px(hashInt(i, 42, 143, size), hashInt(i, 43, 144, size), i % 3 === 0 ? "#d0a292" : "#5f4037", 1, 1);
    }
    return;
  }

  if (key === "diorite") {
    fillNoise("#b2b6ad", ["#8e948e", "#aeb4ad", "#c8cbc3", "#e0e2da", "#737973"], 145);
    for (let i = 0; i < 38; i += 1) {
      px(hashInt(i, 44, 146, size), hashInt(i, 45, 147, size), i % 4 === 0 ? "#f5f6ef" : "#5f6760", 1, 1);
    }
    return;
  }

  if (key === "andesite") {
    fillNoise("#7d8582", ["#676f6c", "#77807d", "#8c9491", "#9ca5a1", "#535c59"], 148);
    for (let i = 0; i < 8; i += 1) {
      const sy = hashInt(i, 46, 149, size - 2);
      px(hashInt(i, 47, 150, 10), sy, "#59615e", 18, 1);
    }
    return;
  }

  if (key === "deepslate") {
    fillNoise("#444c52", ["#2e363b", "#394249", "#48525a", "#596269", "#22292e"], 151);
    for (let i = 0; i < 9; i += 1) {
      const sy = 2 + i * 4;
      px(0, sy, "#222a30", size, 1);
      px(hashInt(i, 48, 152, 12), sy + 1, "#64707a", 12, 1);
    }
    return;
  }

  if (key === "ice") {
    fillNoise("#93d0e4", ["#72b7d5", "#8fd3e7", "#b7eef7", "#d8fbff", "#5a9fca"], 153);
    for (let i = 0; i < 8; i += 1) {
      const sx = hashInt(i, 49, 154, size - 10);
      const sy = hashInt(i, 50, 155, size - 2);
      px(sx, sy, "rgba(245, 255, 255, 0.92)", 10, 1);
      if (i % 2 === 0) px(sx + 2, sy + 1, "rgba(72, 143, 183, 0.7)", 6, 1);
    }
    return;
  }

  if (key === "packed_ice") {
    fillNoise("#70b5d8", ["#4f91bc", "#66afd5", "#84c8e7", "#a1def1", "#376f9f"], 156);
    for (let i = 0; i < 10; i += 1) {
      const sx = hashInt(i, 51, 157, size - 8);
      const sy = hashInt(i, 52, 158, size - 2);
      px(sx, sy, i % 2 === 0 ? "#d5f8ff" : "#2d729f", 8, 1);
    }
    return;
  }

  if (key === "cobblestone") {
    fillNoise("#697177", ["#555d63", "#636c72", "#737c82", "#838c91", "#4b5359"], 44);
    for (let row = 5; row < size; row += 7) px(0, row, "#444c52", size, 1);
    for (let col = 4; col < size; col += 8) px(col, 0, "#4c545a", 1, size);
    for (let i = 0; i < 18; i += 1) px(hashInt(i, 6, 45, size), hashInt(i, 7, 46, size), "#a4adb1", 1, 1);
    return;
  }

  if (key === "gravel") {
    fillNoise("#837f76", ["#6c6861", "#7c7971", "#908d84", "#a29e94", "#55524d"], 47);
    for (let i = 0; i < 44; i += 1) {
      const sx = hashInt(i, 8, 48, size);
      const sy = hashInt(i, 9, 49, size);
      px(sx, sy, i % 3 === 0 ? "#b8b3a8" : "#4c4a45", 1, 1);
    }
    return;
  }

  if (key === "coal_ore") {
    drawOre(131, ["#1c1e20", "#2b2d2e", "#0f1011"]);
    return;
  }

  if (key === "iron_ore") {
    drawOre(141, ["#b88962", "#d09b73", "#8f624a"]);
    return;
  }

  if (key === "copper_ore") {
    drawOre(151, ["#c77f57", "#4cae8e", "#e09d68", "#327969"]);
    return;
  }

  if (key === "gold_ore") {
    drawOre(161, ["#d5a53c", "#f0c45b", "#9e7830"]);
    return;
  }

  if (key === "diamond_ore") {
    drawOre(171, ["#42c9d0", "#78f1f1", "#1e8e99"]);
    return;
  }

  if (key === "sand") {
    fillNoise("#d4c173", ["#c7b368", "#d9c878", "#e2d58d", "#bda65f", "#efe0a1"], 51);
    for (let i = 0; i < 24; i += 1) px(hashInt(i, 10, 52, size), hashInt(i, 11, 53, size), "#f5e9b2", 1, 1);
    return;
  }

  if (key === "red_sand") {
    fillNoise("#b86435", ["#9d512d", "#b86135", "#c87442", "#d6874f", "#834329"], 54);
    for (let i = 0; i < 24; i += 1) px(hashInt(i, 10, 55, size), hashInt(i, 11, 56, size), "#e5a06a", 1, 1);
    return;
  }

  if (key === "sandstone") {
    fillNoise("#c9b16a", ["#bca35f", "#ceb976", "#d9c783", "#a98d4e", "#eadcaa"], 56);
    for (let row = 6; row < size; row += 8) px(0, row, "#9e8449", size, 1);
    for (let i = 0; i < 10; i += 1) {
      const sx = hashInt(i, 12, 57, size - 8);
      const sy = 2 + hashInt(i, 13, 58, size - 4);
      px(sx, sy, "#eadcaa", 8, 1);
    }
    return;
  }

  if (key === "terracotta") {
    fillNoise("#a75e43", ["#8d4b37", "#a45b40", "#b86c4e", "#c87b58", "#743b2d"], 58);
    for (let row = 5; row < size; row += 9) px(0, row, "#7b4030", size, 1);
    return;
  }

  if (key === "white_terracotta") {
    fillNoise("#bfa08a", ["#a98a76", "#bb9c86", "#d0b49e", "#8f7364", "#ddc1aa"], 59);
    for (let row = 6; row < size; row += 10) px(0, row, "#8f7465", size, 1);
    return;
  }

  if (key === "log_side") {
    fillNoise("#704d2e", ["#5d3d25", "#6c492d", "#7b5534", "#8c643f"], 61);
    for (let ix = 2; ix < size; ix += 6) {
      px(ix, 0, "#4f321f", 2, size);
      px(ix + 2, 0, "#90683f", 1, size);
    }
    px(19, 10, "#3f281a", 6, 5);
    px(20, 11, "#9b7346", 3, 2);
    return;
  }

  if (key === "log_top") {
    fillNoise("#9b7244", ["#8d6338", "#a67b48", "#bd8d55", "#75502f"], 71);
    ctx.strokeStyle = "#684626";
    ctx.lineWidth = 2;
    for (const radius of [5, 9, 13]) {
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size / 2, radius, radius * 0.82, 0.15, 0, Math.PI * 2);
      ctx.stroke();
    }
    px(15, 15, "#4e321f", 3, 3);
    return;
  }

  if (key === "spruce_log_side") {
    fillNoise("#4b3324", ["#352419", "#442e20", "#543a27", "#61442e"], 72);
    for (let ix = 1; ix < size; ix += 5) {
      px(ix, 0, "#24180f", 2, size);
      if (ix + 2 < size) px(ix + 2, 0, "#6a4c35", 1, size);
    }
    px(20, 6, "#24180f", 5, 10);
    return;
  }

  if (key === "spruce_log_top") {
    fillNoise("#80633f", ["#6f5234", "#866845", "#9a7b51", "#5c432b"], 73);
    ctx.strokeStyle = "#4c3521";
    ctx.lineWidth = 2;
    for (const radius of [4, 8, 12]) {
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size / 2, radius, radius * 0.9, -0.12, 0, Math.PI * 2);
      ctx.stroke();
    }
    px(15, 15, "#2e2015", 3, 3);
    return;
  }

  if (key === "jungle_log_side") {
    fillNoise("#76543a", ["#684832", "#77543a", "#8b6443", "#5a3e2c"], 74);
    for (let iy = 2; iy < size; iy += 7) px(0, iy, "#4b3324", size, 2);
    for (let i = 0; i < 14; i += 1) {
      px(hashInt(i, 14, 75, size), hashInt(i, 15, 76, size), "#a1774d", 2, 1);
    }
    return;
  }

  if (key === "jungle_log_top") {
    fillNoise("#a77b4b", ["#8c633b", "#a77b4b", "#bd925d", "#6f4d31"], 77);
    ctx.strokeStyle = "#684725";
    ctx.lineWidth = 2;
    for (const radius of [5, 10, 14]) {
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size / 2, radius, radius * 0.75, 0.28, 0, Math.PI * 2);
      ctx.stroke();
    }
    px(15, 15, "#55371f", 3, 3);
    return;
  }

  if (key === "birch_log_side") {
    fillNoise("#d8d1b7", ["#c8c0a7", "#d7d0b8", "#eee7cf", "#aaa18e"], 78);
    for (let iy = 3; iy < size; iy += 7) {
      px(0, iy, "#2b2927", 9 + hashInt(iy, 5, 79, 12), 2);
    }
    for (let i = 0; i < 18; i += 1) {
      px(hashInt(i, 16, 80, size), hashInt(i, 17, 81, size), "#f8f3dc", 1, 3);
    }
    return;
  }

  if (key === "birch_log_top") {
    fillNoise("#c69b5d", ["#a97742", "#c39158", "#d7ad6e", "#7d5635"], 82);
    ctx.strokeStyle = "#6a4528";
    ctx.lineWidth = 2;
    for (const radius of [4, 8, 12]) {
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size / 2, radius, radius * 0.84, 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (key === "acacia_log_side") {
    fillNoise("#6d4933", ["#563626", "#67452f", "#7c5339", "#8c6043"], 83);
    for (let ix = 3; ix < size; ix += 7) {
      px(ix, 0, "#392419", 2, size);
      px(ix + 2, 0, "#a76539", 1, size);
    }
    for (let i = 0; i < 10; i += 1) px(hashInt(i, 18, 84, size), hashInt(i, 19, 85, size), "#2d1d15", 4, 2);
    return;
  }

  if (key === "acacia_log_top") {
    fillNoise("#a75f38", ["#88492d", "#a65f39", "#c47745", "#6b3927"], 86);
    ctx.strokeStyle = "#5c3322";
    ctx.lineWidth = 2;
    for (const radius of [4, 8, 12]) {
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size / 2, radius, radius * 0.8, -0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (key === "leaves") {
    fillNoise("#3e8742", ["#2f6d34", "#3f8540", "#4b9a4d", "#58ad56", "#285d30"], 81);
    for (let i = 0; i < 34; i += 1) {
      px(hashInt(i, 20, 82, size), hashInt(i, 21, 83, size), "#75c96a", 2, 1);
    }
    cutLeafHoles(181, 30);
    return;
  }

  if (key === "spruce_leaves") {
    fillNoise("#285c3f", ["#1e4934", "#26583d", "#326c48", "#3e7a50", "#173728"], 84);
    for (let i = 0; i < 46; i += 1) {
      const sx = hashInt(i, 22, 85, size);
      const sy = hashInt(i, 23, 86, size);
      px(sx, sy, "#68a064", 1, 2);
    }
    cutLeafHoles(184, 24);
    return;
  }

  if (key === "jungle_leaves") {
    fillNoise("#2d8c3e", ["#1f7433", "#2c8d3d", "#38a54a", "#4bbf5a", "#176428"], 87);
    for (let i = 0; i < 52; i += 1) {
      px(hashInt(i, 24, 88, size), hashInt(i, 25, 89, size), "#81d36b", 2, 1);
    }
    cutLeafHoles(187, 34);
    return;
  }

  if (key === "birch_leaves") {
    fillNoise("#70ad46", ["#5c943b", "#6eaa45", "#83bf53", "#9bd56a", "#4a7e32"], 90);
    for (let i = 0; i < 40; i += 1) {
      px(hashInt(i, 24, 91, size), hashInt(i, 25, 92, size), "#cae985", 2, 1);
    }
    cutLeafHoles(190, 28);
    return;
  }

  if (key === "acacia_leaves") {
    fillNoise("#5d7d39", ["#465f2d", "#587638", "#6f9440", "#7fa64b", "#394f25"], 93);
    for (let i = 0; i < 34; i += 1) {
      px(hashInt(i, 25, 94, size), hashInt(i, 26, 95, size), i % 3 === 0 ? "#a9be6a" : "#334821", 2, 1);
    }
    cutLeafHoles(193, 30);
    return;
  }

  if (key === "plank") {
    fillNoise("#a8783b", ["#986a33", "#aa793a", "#b98745", "#c79853", "#81562b"], 91);
    for (let row = 7; row < size; row += 8) px(0, row, "#65421f", size, 2);
    for (let row = 1; row < size; row += 8) {
      const seam = 7 + hashInt(row, 12, 92, 18);
      px(seam, row, "#6f4924", 2, 6);
    }
    for (let i = 0; i < 16; i += 1) px(hashInt(i, 22, 93, size), hashInt(i, 23, 94, size), "#50331b", 1, 1);
    return;
  }

  if (key === "podzol_top") {
    fillNoise("#6a482d", ["#5a3d28", "#6b4a2f", "#7c5938", "#4b3322", "#8b704a"], 95);
    for (let i = 0; i < 44; i += 1) {
      const sx = hashInt(i, 26, 96, size);
      const sy = hashInt(i, 27, 97, size);
      px(sx, sy, i % 3 === 0 ? "#2d4a2c" : "#a68a5e", 1, 2);
    }
    return;
  }

  if (key === "podzol_side") {
    fillNoise("#5b412e", ["#4b3324", "#5a402d", "#6d5138", "#3e2a1d"], 98);
    for (let ix = 0; ix < size; ix += 1) {
      const needleDepth = 4 + hashInt(ix, 28, 99, 5);
      px(ix, 0, "#6f5b39", 1, needleDepth);
      if (ix % 4 === 0) px(ix, needleDepth, "#2e4f32", 1, 1);
    }
    return;
  }

  if (key === "jungle_grass_top") {
    fillNoise("#45a53d", ["#2f8332", "#3e9b39", "#51b846", "#6acb52", "#26772f"], 104);
    for (let i = 0; i < 30; i += 1) {
      px(hashInt(i, 29, 105, size), hashInt(i, 30, 106, size), "#85c866", 1, 2);
    }
    return;
  }

  if (key === "jungle_grass_side") {
    fillNoise("#4d3c2d", ["#403125", "#4d3a2b", "#5d4735", "#36291f"], 107);
    for (let ix = 0; ix < size; ix += 1) {
      const grassDepth = 7 + hashInt(ix, 31, 108, 7);
      px(ix, 0, "#49a23e", 1, grassDepth);
      if (ix % 2 === 0) px(ix, grassDepth - 1, "#83d163", 1, 3);
    }
    return;
  }

  if (key === "clay") {
    fillNoise("#8fa096", ["#778a83", "#889b92", "#a2b4aa", "#6f817a", "#b4c4bb"], 101);
    for (let i = 0; i < 6; i += 1) {
      const sy = 4 + i * 5;
      px(3 + hashInt(i, 24, 102, 7), sy, "#c5d2c9", 18, 1);
      px(9 + hashInt(i, 25, 103, 7), sy + 1, "#667870", 10, 1);
    }
    return;
  }

  if (key === "snow") {
    fillNoise("#eef7f7", ["#dce9ea", "#edf7f7", "#f8ffff", "#c8d6d8", "#e5f0f1"], 106);
    for (let i = 0; i < 16; i += 1) px(hashInt(i, 26, 107, size), hashInt(i, 27, 108, size), "#ffffff", 2, 1);
    return;
  }

  if (key === "snow_grass_side") {
    drawBlockTexture(ctx, "grass_side", x, y, size);
    for (let ix = 0; ix < size; ix += 1) {
      const snowDepth = 4 + hashInt(ix, 28, 109, 3);
      px(ix, 0, "#edf7f7", 1, snowDepth);
    }
    return;
  }

  if (key === "mud") {
    fillNoise("#4c3a2b", ["#3b2c23", "#463529", "#594434", "#2f241d", "#66503c"], 109);
    for (let i = 0; i < 20; i += 1) {
      px(hashInt(i, 32, 110, size), hashInt(i, 33, 111, size), "#7b6048", 2, 1);
    }
    return;
  }

  if (key === "moss") {
    fillNoise("#467d35", ["#355f2c", "#437837", "#519044", "#63a94f", "#2d4f26"], 110);
    for (let i = 0; i < 32; i += 1) {
      px(hashInt(i, 30, 111, size), hashInt(i, 31, 112, size), i % 4 === 0 ? "#7dbb62" : "#335a2b", 1, 1);
    }
    return;
  }

  if (key === "meadow_grass_top") {
    fillNoise("#78b94e", ["#5fa441", "#74b74c", "#8ccf5c", "#a3db72", "#4f8f38"], 125);
    for (let i = 0; i < 28; i += 1) {
      px(hashInt(i, 31, 126, size), hashInt(i, 32, 127, size), i % 5 === 0 ? "#dcca6b" : "#a7d876", 1, 1);
    }
    return;
  }

  if (key === "meadow_grass_side") {
    drawBlockTexture(ctx, "grass_side", x, y, size);
    for (let ix = 0; ix < size; ix += 1) {
      const grassDepth = 5 + hashInt(ix, 34, 128, 6);
      px(ix, 0, ix % 4 === 0 ? "#c7e978" : "#76b34d", 1, grassDepth);
    }
    return;
  }

  if (key === "dry_grass_top") {
    fillNoise("#a3a14d", ["#8c863f", "#a6a34f", "#b9b45c", "#c6bd70", "#746e34"], 129);
    for (let i = 0; i < 18; i += 1) px(hashInt(i, 33, 130, size), hashInt(i, 34, 131, size), "#c8bf72", 1, 2);
    return;
  }

  if (key === "dry_grass_side") {
    drawBlockTexture(ctx, "dirt", x, y, size);
    for (let ix = 0; ix < size; ix += 1) {
      const grassDepth = 4 + hashInt(ix, 35, 132, 5);
      px(ix, 0, ix % 3 === 0 ? "#c1b65f" : "#93853e", 1, grassDepth);
    }
    return;
  }

  if (key === "coarse_dirt") {
    fillNoise("#735337", ["#5c3f27", "#735337", "#8a6b43", "#a18455", "#49301f"], 131);
    for (let i = 0; i < 28; i += 1) {
      px(hashInt(i, 35, 133, size), hashInt(i, 36, 134, size), i % 3 === 0 ? "#a98e64" : "#4e3727", 2, 1);
    }
    return;
  }

  if (key === "savanna_grass_top") {
    fillNoise("#afa852", ["#8f8840", "#a9a14b", "#bdb55c", "#cdc26f", "#746c33"], 139);
    for (let i = 0; i < 22; i += 1) {
      px(hashInt(i, 37, 140, size), hashInt(i, 38, 141, size), i % 4 === 0 ? "#cbc678" : "#867b41", 1, 2);
    }
    return;
  }

  if (key === "savanna_grass_side") {
    drawBlockTexture(ctx, "coarse_dirt", x, y, size);
    for (let ix = 0; ix < size; ix += 1) {
      const grassDepth = 4 + hashInt(ix, 39, 142, 5);
      px(ix, 0, ix % 5 === 0 ? "#d0c56e" : "#9d9145", 1, grassDepth);
    }
    return;
  }

  if (key === "limestone") {
    fillNoise("#a4aa9d", ["#8e9488", "#a1a89a", "#b9beaf", "#c9cebf", "#777e74"], 133);
    for (let i = 0; i < 7; i += 1) {
      const sy = 3 + i * 4;
      px(hashInt(i, 36, 134, 8), sy, "#d7dbc9", 18, 1);
      px(8 + hashInt(i, 37, 135, 8), sy + 1, "#7c8278", 14, 1);
    }
    return;
  }

  if (key === "basalt") {
    fillNoise("#31383d", ["#22282c", "#2c3338", "#394047", "#434b51", "#161b1e"], 136);
    for (let ix = 1; ix < size; ix += 5) px(ix, 0, "#1a1f22", 2, size);
    for (let i = 0; i < 10; i += 1) px(hashInt(i, 38, 137, size), hashInt(i, 39, 138, size), "#596269", 1, 5);
    return;
  }

  if (key === "slate") {
    fillNoise("#4c5660", ["#39424b", "#46505a", "#59636d", "#69737d", "#2c343c"], 139);
    for (let i = 0; i < 6; i += 1) {
      const sy = 2 + i * 5;
      px(0, sy, "#2d353d", size, 1);
      px(hashInt(i, 40, 140, 10), sy + 1, "#74808a", 16, 1);
    }
    return;
  }

  if (key === "cactus_side") {
    fillNoise("#2f8a42", ["#267338", "#2f8740", "#3a9d4a", "#47ac56", "#1f6231"], 112);
    for (let ix = 4; ix < size; ix += 8) {
      px(ix, 0, "#1f5e30", 2, size);
      px(ix + 2, 0, "#62bd68", 1, size);
    }
    for (let i = 0; i < 28; i += 1) {
      px(hashInt(i, 34, 113, size), hashInt(i, 35, 114, size), "#d8f0bd", 1, 1);
    }
    return;
  }

  if (key === "cactus_top") {
    fillNoise("#4cab53", ["#399346", "#46a651", "#5fbb60", "#2f7b3d"], 115);
    ctx.strokeStyle = "#266c36";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x + size / 2, y + size / 2, 10, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    px(15, 15, "#e7f5c9", 2, 2);
    return;
  }

  if (key === "water") {
    fillNoise("#3f93d1", ["#317fbd", "#3f93d1", "#56a9df", "#74c1ee", "#2d6fa8"], 116);
    for (let i = 0; i < 18; i += 1) {
      const sx = hashInt(i, 36, 117, size - 6);
      const sy = hashInt(i, 37, 118, size);
      px(sx, sy, "rgba(199, 238, 255, 0.7)", 6, 1);
    }
    return;
  }

  if (key === "bedrock") {
    fillNoise("#26292d", ["#15171a", "#202429", "#30343a", "#3d4147", "#0d0f11"], 111);
    return;
  }

  if (key === "wildflower") {
    for (let i = 0; i < 9; i += 1) {
      const sx = 5 + hashInt(i, 36, 122, 7);
      const height = 11 + hashInt(i, 37, 123, 8);
      px(sx, 30 - height, "#2f7b34", 1, height);
      px(sx - 1, 29 - height, i % 2 === 0 ? "#f4d44e" : "#e879a7", 3, 3);
      px(sx, 30 - height, "#fff4a4", 1, 1);
    }
    return;
  }

  if (key === "dandelion") {
    for (let i = 0; i < 8; i += 1) {
      const sx = 4 + hashInt(i, 41, 159, 11);
      const height = 10 + hashInt(i, 42, 160, 8);
      px(sx, 30 - height, "#3e8735", 1, height);
      px(sx - 1, 28 - height, "#f2d94c", 3, 3);
      px(sx, 29 - height, "#fff4a4", 1, 1);
    }
    return;
  }

  if (key === "poppy") {
    for (let i = 0; i < 7; i += 1) {
      const sx = 5 + hashInt(i, 43, 161, 10);
      const height = 10 + hashInt(i, 44, 162, 9);
      px(sx, 30 - height, "#367b33", 1, height);
      px(sx - 1, 28 - height, "#c7352d", 3, 3);
      px(sx, 29 - height, "#2b1615", 1, 1);
    }
    return;
  }

  if (key === "blue_orchid") {
    for (let i = 0; i < 7; i += 1) {
      const sx = 4 + hashInt(i, 45, 163, 12);
      const height = 9 + hashInt(i, 46, 164, 8);
      px(sx, 30 - height, "#3a8b45", 1, height);
      px(sx - 1, 28 - height, "#65bbe6", 3, 3);
      px(sx, 29 - height, "#d8f6ff", 1, 1);
    }
    return;
  }

  if (key === "clover") {
    for (let i = 0; i < 14; i += 1) {
      const sx = 3 + hashInt(i, 44, 173, 18);
      const sy = 20 + hashInt(i, 45, 174, 9);
      px(sx, sy, "#4d923e", 1, 8);
      px(sx - 1, sy - 1, "#8ed46a", 2, 2);
      px(sx + 1, sy, "#bce57a", 2, 1);
      if (i % 5 === 0) px(sx, sy - 2, "#eef5b4", 1, 1);
    }
    return;
  }

  if (key === "dead_bush") {
    for (let i = 0; i < 8; i += 1) {
      const sx = 5 + hashInt(i, 47, 165, 12);
      const height = 8 + hashInt(i, 48, 166, 10);
      px(sx, 30 - height, "#8a5f36", 1, height);
      px(sx - 2, 29 - height + 3, "#b07c45", 2, 1);
      px(sx + 1, 28 - height + 5, "#6b4729", 2, 1);
    }
    return;
  }

  if (key === "savanna_shrub") {
    for (let i = 0; i < 12; i += 1) {
      const sx = 4 + hashInt(i, 49, 175, 15);
      const height = 7 + hashInt(i, 50, 176, 11);
      px(sx, 30 - height, "#7d6734", 1, height);
      px(sx - 2, 29 - height + 2, "#b7a255", 3, 1);
      px(sx + 1, 28 - height + 5, i % 3 === 0 ? "#d4c579" : "#8f7a3d", 3, 1);
    }
    return;
  }

  if (key === "berry_bush") {
    for (let i = 0; i < 18; i += 1) {
      const sx = 4 + hashInt(i, 49, 167, 16);
      const sy = 12 + hashInt(i, 50, 168, 16);
      px(sx, sy, i % 3 === 0 ? "#6ead4e" : "#2f7337", 3, 4);
      if (i % 4 === 0) px(sx + 1, sy + 1, "#c93b4d", 1, 1);
    }
    return;
  }

  if (key === "fern") {
    for (let i = 0; i < 8; i += 1) {
      const sx = 5 + i * 3;
      const height = 9 + hashInt(i, 38, 124, 11);
      px(sx, 30 - height, "#2f7c35", 1, height);
      for (let leaf = 0; leaf < 4; leaf += 1) {
        const ly = 31 - height + leaf * 4;
        px(sx - 2, ly, "#4da64b", 2, 1);
        px(sx + 1, ly + 1, "#3c913f", 2, 1);
      }
    }
    return;
  }

  if (key === "sugar_cane") {
    for (let i = 0; i < 4; i += 1) {
      const sx = 6 + i * 5;
      px(sx, 5, "#5c9a43", 2, 25);
      px(sx + 2, 5, "#a8db6d", 1, 25);
      for (let sy = 9; sy < 30; sy += 7) px(sx - 1, sy, "#d8ef91", 5, 1);
    }
    return;
  }

  if (key === "vine") {
    for (let i = 0; i < 6; i += 1) {
      const sx = 4 + i * 4;
      const height = 17 + hashInt(i, 51, 169, 12);
      px(sx, 31 - height, "#2f7a32", 1, height);
      for (let leaf = 0; leaf < 5; leaf += 1) {
        const ly = 31 - height + leaf * 5 + hashInt(i + leaf, 52, 170, 2);
        px(sx - 1, ly, "#59a94c", 2, 2);
      }
    }
    return;
  }

  if (key === "tall_grass") {
    for (let i = 0; i < 10; i += 1) {
      const sx = 3 + hashInt(i, 39, 141, 12);
      const height = 13 + hashInt(i, 40, 142, 13);
      px(sx, 30 - height, i % 2 === 0 ? "#72ad43" : "#4e8f35", 1, height);
      if (i % 3 === 0) px(sx + 1, 30 - height + 4, "#a4c85c", 1, 7);
    }
    return;
  }

  if (key === "pumpkin_side") {
    fillNoise("#b96525", ["#9d4d1f", "#b96525", "#cf7a2f", "#e18d3a", "#783816"], 171);
    for (let ix = 4; ix < size; ix += 7) {
      px(ix, 0, "#753816", 2, size);
      px(ix + 2, 0, "#e19a43", 1, size);
    }
    px(13, 4, "#5b2b12", 6, 3);
    return;
  }

  if (key === "pumpkin_top") {
    fillNoise("#d48931", ["#b96525", "#cf7a2f", "#e6993e", "#9d4d1f"], 172);
    ctx.strokeStyle = "#7a3a16";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x + size / 2, y + size / 2, 12, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    px(14, 13, "#4f321e", 4, 6);
    return;
  }

  if (key === "melon_side") {
    fillNoise("#78a53f", ["#5f8733", "#73a13d", "#8ab84e", "#a7c95d", "#466c2d"], 173);
    for (let ix = 3; ix < size; ix += 6) {
      px(ix, 0, "#3f6627", 2, size);
      if (ix + 2 < size) px(ix + 2, 0, "#b8d76d", 1, size);
    }
    return;
  }

  if (key === "melon_top") {
    fillNoise("#a7bd49", ["#7fa13a", "#9fbc48", "#bdd35a", "#5f8430"], 174);
    ctx.strokeStyle = "#446d28";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x + size / 2, y + size / 2, 12, 10, 0.18, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (key === "crafting_top") {
    fillNoise("#b88745", ["#a67537", "#b78342", "#c89655", "#90602f"], 121);
    px(4, 4, "#54361d", 24, 2);
    px(4, 14, "#54361d", 24, 2);
    px(4, 24, "#54361d", 24, 2);
    px(4, 4, "#54361d", 2, 22);
    px(14, 4, "#54361d", 2, 22);
    px(24, 4, "#54361d", 2, 22);
    px(8, 8, "#e2bd76", 4, 4);
    px(18, 18, "#e2bd76", 4, 4);
    return;
  }

  if (key === "crafting_side") {
    drawBlockTexture(ctx, "plank", x, y, size);
    px(7, 9, "#2f2217", 18, 2);
    px(9, 17, "#e1c077", 4, 7);
    px(18, 12, "#d8d0bd", 7, 3);
    px(21, 15, "#47301c", 2, 8);
  }
}

function createItemSprites() {
  const sprites = new Map();

  for (const id of Object.keys(ITEMS)) {
    if (ITEMS[id].textureUrl) {
      sprites.set(id, ITEMS[id].textureUrl);
      continue;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    if (id === "stick") {
      drawStickIcon(ctx);
    } else if (id === "feather") {
      drawFeatherIcon(ctx);
    } else if (id === "leather") {
      drawLeatherIcon(ctx);
    } else if (id === "raw_chicken") {
      drawRawFoodIcon(ctx, "#e2b6a0", "#b78876");
    } else if (id === "raw_porkchop") {
      drawRawFoodIcon(ctx, "#f3a8a0", "#c47770");
    } else if (id === "raw_beef") {
      drawRawFoodIcon(ctx, "#c54f3a", "#86372a");
    } else {
      drawBlockIcon(ctx, getItemTextureKey(id));
    }

    sprites.set(id, canvas.toDataURL("image/png"));
  }

  return sprites;
}

function refreshItemSprites() {
  const sprites = createItemSprites();
  ITEM_SPRITES.clear();
  for (const [id, sprite] of sprites) ITEM_SPRITES.set(id, sprite);

  if (window.__game) {
    if (window.__game.inventoryOpen) window.__game.renderInventory();
    else window.__game.renderHotbar();
  }
}

function drawBlockIcon(ctx, textureKey) {
  const region = BLOCK_ATLAS.regions.get(textureKey);
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(12, 36, 25, 4);
  ctx.drawImage(BLOCK_ATLAS.canvas, region.x, region.y, region.size, region.size, 9, 7, 30, 30);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.strokeRect(9.5, 7.5, 30, 30);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.strokeRect(8.5, 6.5, 32, 32);
}

function drawStickIcon(ctx) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(15, 36, 24, 4);
  ctx.translate(24, 24);
  ctx.rotate(-0.72);
  ctx.fillStyle = "#765033";
  ctx.fillRect(-4, -20, 8, 40);
  ctx.fillStyle = "#bd8b57";
  ctx.fillRect(-2, -19, 3, 38);
  ctx.fillStyle = "#4b311f";
  ctx.fillRect(-4, -20, 8, 3);
  ctx.fillRect(-4, 17, 8, 3);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawFeatherIcon(ctx) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(15, 38, 22, 3);
  ctx.translate(24, 24);
  ctx.rotate(-0.55);
  // shaft
  ctx.fillStyle = "#c5b894";
  ctx.fillRect(-1, -18, 2, 36);
  // barbs
  ctx.fillStyle = "#f7f3e6";
  for (let y = -16; y <= 14; y += 2) {
    const half = Math.max(2, 9 - Math.abs(y) * 0.45);
    ctx.fillRect(-half, y, half * 2, 2);
  }
  ctx.fillStyle = "rgba(180, 170, 140, 0.6)";
  for (let y = -14; y <= 12; y += 4) {
    const half = Math.max(1, 8 - Math.abs(y) * 0.42);
    ctx.fillRect(-half + 1, y + 1, half * 2 - 2, 1);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawLeatherIcon(ctx) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(10, 38, 28, 3);
  // hide-shape silhouette
  ctx.fillStyle = "#6f4a2a";
  ctx.beginPath();
  ctx.moveTo(12, 14);
  ctx.lineTo(36, 12);
  ctx.lineTo(40, 24);
  ctx.lineTo(36, 36);
  ctx.lineTo(28, 38);
  ctx.lineTo(20, 36);
  ctx.lineTo(10, 32);
  ctx.lineTo(8, 22);
  ctx.closePath();
  ctx.fill();
  // top highlight
  ctx.fillStyle = "#9a6b3f";
  ctx.beginPath();
  ctx.moveTo(14, 16);
  ctx.lineTo(34, 14);
  ctx.lineTo(36, 22);
  ctx.lineTo(20, 22);
  ctx.lineTo(12, 22);
  ctx.closePath();
  ctx.fill();
  // stitches
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(13, 17);
  ctx.lineTo(35, 15);
  ctx.moveTo(11, 32);
  ctx.lineTo(35, 34);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRawFoodIcon(ctx, base, edge) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(10, 38, 28, 3);
  // chunky meat blob
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(14, 14);
  ctx.lineTo(34, 12);
  ctx.lineTo(40, 24);
  ctx.lineTo(34, 36);
  ctx.lineTo(18, 38);
  ctx.lineTo(10, 30);
  ctx.lineTo(10, 20);
  ctx.closePath();
  ctx.fill();
  // outline
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  // marbling
  ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
  ctx.fillRect(16, 18, 10, 2);
  ctx.fillRect(20, 24, 14, 2);
  ctx.fillRect(14, 30, 12, 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(14, 22, 6, 1);
  ctx.fillRect(22, 28, 8, 1);
}

function createCrackTextures() {
  const textures = [];

  for (let stage = 0; stage < 10; stage += 1) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    drawCrackStageTexture(ctx, size, stage);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.userData = { canvas, ctx, size, stage };
    textures.push(texture);
  }

  return textures;
}

function refreshCrackTextures() {
  for (const texture of CRACK_TEXTURES) {
    const { ctx, size, stage } = texture.userData;
    drawCrackStageTexture(ctx, size, stage);
    texture.needsUpdate = true;
  }
}

function drawCrackStageTexture(ctx, size, stage) {
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  const image = BLOCK_TEXTURE_IMAGES.get(DESTROY_STAGE_FILES[stage]);
  if (image) {
    ctx.drawImage(image, 0, 0, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE, 0, 0, size, size);
    return;
  }
  drawFallbackCrackTexture(ctx, size, stage);
}

function drawFallbackCrackTexture(ctx, size, stage) {
  ctx.strokeStyle = `rgba(24, 20, 18, ${0.4 + stage * 0.055})`;
  ctx.lineWidth = 1 + Math.floor(stage / 3);
  ctx.lineCap = "square";

  const branches = 3 + stage;
  for (let i = 0; i < branches; i += 1) {
    const startX = 30 + Math.sin(i * 2.1) * (3 + stage);
    const startY = 30 + Math.cos(i * 1.7) * (3 + stage);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    const segments = 2 + Math.floor(stage / 2);
    for (let j = 0; j < segments; j += 1) {
      const angle = i * 1.75 + j * 0.75 + hashFloat(i, j, 500 + stage) * 1.4;
      const length = 5 + stage * 1.1 + hashFloat(i, j, 600 + stage) * 8;
      ctx.lineTo(startX + Math.cos(angle) * length * (j + 1), startY + Math.sin(angle) * length * (j + 1));
    }
    ctx.stroke();
  }
}

function getBlockBreakTime(block, itemId = null) {
  const blockDef = BLOCKS[block];
  const h = blockDef?.hardness;
  if (h !== undefined) {
    const tool = itemId ? ITEMS[itemId]?.tool : null;
    const material = getBlockMaterialKind(block);
    if (tool?.kind === "pickaxe" && material === "stone") {
      const required = blockDef.miningTier ?? 0;
      const pickTier = PICKAXE_TIERS[tool.tier] ?? 0;
      return minecraftBreakTimeSeconds(h, tool.speed, pickTier >= required);
    }
    if (tool?.kind === "shovel" && material === "soil") return minecraftBreakTimeSeconds(h, tool.speed, true);
    if (tool?.kind === "axe" && material === "wood") return minecraftBreakTimeSeconds(h, tool.speed, true);
    if (tool?.kind === "hoe" && material === "leaves") return minecraftBreakTimeSeconds(h, tool.speed, true);
    if (tool?.kind === "shears" && material === "leaves") return minecraftBreakTimeSeconds(h, tool.speed, true);
    return minecraftBreakTimeSeconds(h, 1, blockDef.miningTier == null);
  }
  const base = blockDef?.breakTime ?? 1;
  if (!Number.isFinite(base)) return base;
  const speed = getSelectedToolSpeed(itemId, block);
  return minecraftTickRoundedBreakSeconds(base / speed);
}

function minecraftBreakTimeSeconds(hardness, speedMultiplier, canHarvest) {
  const divisor = canHarvest ? 30 : 100;
  return minecraftTickRoundedBreakSeconds((hardness * divisor) / Math.max(1, speedMultiplier) / TICKS_PER_SECOND);
}

function minecraftTickRoundedBreakSeconds(seconds) {
  if (!Number.isFinite(seconds)) return seconds;
  return Math.max(1, Math.ceil(seconds * SURVIVAL_BREAK_TIME_SCALE * TICKS_PER_SECOND)) / TICKS_PER_SECOND;
}

function getBreakOverlayTintColor(block, normal = null) {
  const blockDef = BLOCKS[block];
  const faceName = faceNameFromNormal(normal);
  if (faceName === "py") return blockDef?.top ?? blockDef?.side ?? 0x4f4a43;
  if (faceName === "ny") return blockDef?.bottom ?? blockDef?.side ?? 0x4f4a43;
  return blockDef?.side ?? blockDef?.top ?? 0x4f4a43;
}

function getBlockDrop(block, itemId = null) {
  const miningTier = BLOCKS[block]?.miningTier;
  if (miningTier != null) {
    const tool = itemId ? ITEMS[itemId]?.tool : null;
    const pickTier = tool?.kind === "pickaxe" ? (PICKAXE_TIERS[tool.tier] ?? 0) : -1;
    if (pickTier < miningTier) return null;
  }
  // Gravel: 10% flint, 90% gravel (vanilla rate)
  if (block === Block.GRAVEL) return Math.random() < 0.1 ? "flint" : "gravel";
  // Tall grass / fern: 12.5% wheat seeds, otherwise nothing (vanilla rate)
  if (block === Block.TALL_GRASS || block === Block.FERN) return Math.random() < 0.125 ? "wheat_seeds" : null;
  // Leaf blocks: shears return the leaf item; otherwise 2% stick, 98% nothing
  if (block === Block.LEAVES || block === Block.SPRUCE_LEAVES || block === Block.JUNGLE_LEAVES ||
      block === Block.BIRCH_LEAVES || block === Block.ACACIA_LEAVES || block === Block.DARK_OAK_LEAVES) {
    if (ITEMS[itemId]?.tool?.kind === "shears") return BLOCKS[block]?.drop ?? null;
    return Math.random() < 0.02 ? "stick" : null;
  }
  if (isFurnaceBlock(block)) return "furnace";
  return BLOCKS[block]?.drop ?? BLOCK_ITEM_BY_BLOCK.get(block) ?? null;
}

function getSelectedToolSpeed(itemId, block) {
  const tool = ITEMS[itemId]?.tool;
  if (!tool) return 1;
  const material = getBlockMaterialKind(block);
  if (tool.kind === "pickaxe" && material === "stone") return tool.speed;
  if (tool.kind === "shovel" && material === "soil") return tool.speed;
  if (tool.kind === "axe" && material === "wood") return tool.speed;
  if (tool.kind === "hoe" && material === "plant") return Math.max(1.5, tool.speed * 0.45);
  return 1;
}

function getBlockMaterialKind(block) {
  const definition = BLOCKS[block];
  const extra = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block);
  if (definition?.material) return definition.material;
  const name = `${definition?.name ?? ""} ${extra?.id ?? ""}`.toLowerCase();
  if (definition?.plant || extra?.plant) return "plant";
  if (/log|plank|wood|bookshelf|chest|jukebox|noteblock|fence|door|trapdoor|crafting_table|barrel|workbench/.test(name)) return "wood";
  if (/dirt|grass|sand|gravel|clay|mud|snow|farmland|soul/.test(name)) return "soil";
  return "stone";
}

function getExtraBlockByItemId(itemId) {
  return EXTRA_BLOCK_DEFINITIONS.find((definition) => definition.id === itemId)?.block ?? null;
}

function getBlockByDefinitionId(id) {
  return RUNTIME_BLOCK_DEFINITIONS.find((d) => d.id === id)?.block ?? null;
}

function furnaceIdFromLookDir(dir) {
  // The furnace front faces the player — opposite of the look direction
  if (Math.abs(dir.z) >= Math.abs(dir.x)) {
    return dir.z > 0 ? "furnace" : "furnace_south";
  }
  return dir.x > 0 ? "furnace_west" : "furnace_east";
}

function wallTorchFacingFromNormal(normal) {
  // normal points away from the wall face. The wall is in the OPPOSITE direction.
  if (normal.x > 0) return "west";   // hit +x face → wall is to the west of torch
  if (normal.x < 0) return "east";   // hit -x face → wall is to the east
  if (normal.z > 0) return "north";  // hit +z face → wall is to the north
  return "south";                     // hit -z face → wall is to the south
}

function getObsidianBlock() {
  return getExtraBlockByItemId("obsidian") ?? Block.COBBLESTONE;
}

function createStack(id, count = 1) {
  if (!id || !ITEMS[id]) return null;
  return { id, count };
}

function cloneStack(stack) {
  return stack ? { id: stack.id, count: stack.count } : null;
}

function cloneStackArray(stacks) {
  return stacks.map((stack) => cloneStack(stack));
}

function faceNameFromNormal(normal) {
  if (!normal) return null;
  if (normal.x > 0.5) return "px";
  if (normal.x < -0.5) return "nx";
  if (normal.y > 0.5) return "py";
  if (normal.y < -0.5) return "ny";
  if (normal.z > 0.5) return "pz";
  if (normal.z < -0.5) return "nz";
  return null;
}

function createAssetUrlMap(modules) {
  return new Map(
    Object.entries(modules)
      .map(([path, url]) => {
        const file = path.split(/[\\/]/).pop();
        const key = file?.replace(/\.png$/i, "");
        return key ? [key, url] : null;
      })
      .filter(Boolean),
  );
}

function registerExtraCreativeBlocks() {
  for (const definition of RUNTIME_BLOCK_DEFINITIONS) {
    BLOCKS[definition.block] = {
      name: definition.name,
      solid: definition.solid,
      liquid: definition.liquid,
      plant: definition.plant,
      breakTime: definition.breakTime,
      drop: definition.itemId ?? definition.id,
      top: definition.color,
      bottom: definition.color,
      side: definition.color,
    };

    if (definition.internal || ITEMS[definition.id]?.block) continue;
    ITEMS[definition.id] = {
      name: definition.name,
      color: definition.color,
      block: definition.block,
      maxStack: 64,
      textureUrl: CREATIVE_BLOCK_TEXTURE_URL_BY_KEY.get(definition.texture),
      creativeCategory: definition.category,
      creativeSource: "blocks",
      creative: definition.internal ? false : true,
    };
  }
}

function registerAssetBackedCreativeItems() {
  const textureAliases = {
    beef_raw: "raw_beef",
    book_enchanted: "enchanted_book",
    book_normal: "book",
    book_writable: "writable_book",
    book_written: "written_book",
    bow_standby: "bow",
    chicken_raw: "raw_chicken",
    porkchop_raw: "raw_porkchop",
    firework_charge: "firework_star",
    fireworks: "firework_rocket",
    fishing_rod_uncast: "fishing_rod",
    map_empty: "empty_map",
    map_filled: "map",
    melon_speckled: "glistering_melon_slice",
    reeds: "sugar_cane",
    potion_bottle_drinkable: "potion",
    potion_bottle_empty: "glass_bottle",
    potion_bottle_splash: "splash_potion",
    seeds_melon: "melon_seeds",
    seeds_pumpkin: "pumpkin_seeds",
    seeds_wheat: "wheat_seeds",
    deadbush: "dead_bush",
    tallgrass: "tall_grass",
    flower_dandelion: "dandelion",
    flower_rose: "poppy",
    flower_blue_orchid: "blue_orchid",
    mushroom_brown: "brown_mushroom",
    mushroom_red: "red_mushroom",
    double_plant_sunflower_front: "sunflower",
    minecart_normal: "minecart",
    wooden_armorstand: "armor_stand",
  };

  for (const [textureKey, url] of ITEM_TEXTURE_URL_BY_KEY) {
    if (isHiddenCreativeItemTexture(textureKey)) continue;
    const id = textureAliases[textureKey] ?? textureKey;
    const existing = ITEMS[id];
    if (existing) {
      existing.textureUrl = url;
      existing.creativeCategory ??= getCreativeCategory(id, existing, "items");
      existing.searchText = createCreativeSearchText(id, existing.name);
      continue;
    }

    const item = {
      name: formatCreativeItemName(id),
      color: creativeColorFromId(id),
      maxStack: 64,
      textureUrl: url,
      creativeCategory: getCreativeCategory(id, null, "items"),
      creativeSource: "items",
    };
    item.searchText = createCreativeSearchText(id, item.name);
    ITEMS[id] = item;
  }

  for (const [textureKey, url] of CREATIVE_BLOCK_TEXTURE_URL_BY_KEY) {
    if (isHiddenCreativeBlockTexture(textureKey)) continue;
    const id = textureAliases[textureKey] ?? normalizeCreativeBlockItemId(textureKey);
    if (ITEMS[id]) {
      ITEMS[id].searchText ??= createCreativeSearchText(id, ITEMS[id].name);
      continue;
    }

    const item = {
      name: formatCreativeItemName(id),
      color: creativeColorFromId(id),
      maxStack: 64,
      textureUrl: url,
      creativeCategory: getCreativeCategory(id, null, "blocks"),
      creativeSource: "blocks",
    };
    item.searchText = createCreativeSearchText(id, item.name);
    ITEMS[id] = item;
  }

  for (const [id, item] of Object.entries(ITEMS)) {
    applyVanillaCreativeItemBehavior(id, item);
    item.creativeCategory ??= getCreativeCategory(id, item, item.block ? "blocks" : "items");
    item.searchText ??= createCreativeSearchText(id, item.name);
  }
}

function createCreativeItemIds() {
  return Object.keys(ITEMS)
    .filter((id) => ITEMS[id].creative !== false)
    .sort((a, b) => {
      const categoryOrder = CREATIVE_TABS.findIndex((tab) => tab.id === ITEMS[a].creativeCategory)
        - CREATIVE_TABS.findIndex((tab) => tab.id === ITEMS[b].creativeCategory);
      if (categoryOrder !== 0) return categoryOrder;
      const blockOrder = Number(Boolean(ITEMS[b].block)) - Number(Boolean(ITEMS[a].block));
      if (blockOrder !== 0) return blockOrder;
      return ITEMS[a].name.localeCompare(ITEMS[b].name);
    });
}

function getCreativeItemIds(tabId, query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  return CREATIVE_ITEM_IDS.filter((id) => {
    const item = ITEMS[id];
    if (!item) return false;
    const inTab = tabId === "search" || item.creativeCategory === tabId;
    const matchesQuery = !normalizedQuery || item.searchText.includes(normalizedQuery);
    return inTab && matchesQuery;
  });
}

function isHiddenCreativeItemTexture(key) {
  return (
    key.includes("_overlay") ||
    key.startsWith("empty_armor_slot_") ||
    HIDDEN_CREATIVE_ITEM_TEXTURES.has(key) ||
    /^banner_/.test(key) ||
    /^bow_pulling_/.test(key)
  );
}

function isHiddenCreativeBlockTexture(key) {
  return HIDDEN_ASSET_BACKED_BLOCK_TEXTURES.has(key) || !isCreativePlaceableBlockTexture(key);
}

function applyVanillaCreativeItemBehavior(id, item) {
  if (INTERNAL_CREATIVE_ITEM_IDS.has(id)) item.creative = false;
  item.maxStack ??= getDefaultMaxStack(id);
  if (id === "torch_on") {
    item.name = "Torch";
    item.searchText = createCreativeSearchText(id, item.name);
  }

  const food = getFoodBehavior(id);
  if (food) item.food = food;

  const tool = getToolBehavior(id);
  if (tool) item.tool = tool;

  const weaponDamage = getWeaponDamage(id);
  if (weaponDamage) item.weaponDamage = weaponDamage;

  const armor = getArmorBehavior(id);
  if (armor) {
    item.armor = armor;
    item.maxStack = 1;
  }

  if (/bucket_empty|bucket_water|bucket_lava|bucket_milk/.test(id)) {
    item.bucket = id.replace("bucket_", "");
    item.maxStack = 1;
  }

  if (id === "spawn_egg") {
    item.spawn = "passive";
    item.maxStack = 64;
  }

  if (/sword|pickaxe|shovel|axe|hoe|bow|fishing_rod|flint_and_steel|shears|carrot_on_a_stick/.test(id)) {
    item.maxStack = 1;
  }
}

function getDefaultMaxStack(id) {
  if (/bucket|sword|pickaxe|shovel|axe|hoe|bow|fishing_rod|flint_and_steel|shears|helmet|chestplate|leggings|boots|boat|minecart|bed|saddle|horse_armor|mushroom_stew|rabbit_stew|potion/.test(id)) return 1;
  if (/snowball|egg|ender_pearl/.test(id)) return 16;
  return 64;
}

function getFoodBehavior(id) {
  const foods = {
    apple: [4, 2.4],
    apple_golden: [4, 9.6, true],
    bread: [5, 6],
    beef_cooked: [8, 12.8],
    raw_beef: [3, 1.8],
    beef_raw: [3, 1.8],
    chicken_cooked: [6, 7.2],
    raw_chicken: [2, 1.2],
    chicken_raw: [2, 1.2],
    porkchop_cooked: [8, 12.8],
    raw_porkchop: [3, 1.8],
    porkchop_raw: [3, 1.8],
    cookie: [2, 0.4],
    carrot: [4, 4.8],
    carrot_golden: [6, 14.4, true],
    potato: [1, 0.6],
    potato_baked: [5, 6],
    potato_poisonous: [2, 1.2],
    melon: [2, 1.2],
    pumpkin_pie: [8, 4.8],
    mushroom_stew: [6, 7.2],
    rabbit_stew: [10, 12],
    fish_cod_raw: [2, 0.4],
    fish_cod_cooked: [5, 6],
    fish_salmon_raw: [2, 0.4],
    fish_salmon_cooked: [6, 9.6],
    fish_clownfish_raw: [1, 0.2],
    fish_pufferfish_raw: [1, 0.2],
  };
  const entry = foods[id];
  return entry ? { hunger: entry[0], saturation: entry[1], alwaysEdible: Boolean(entry[2]) } : null;
}

function getToolBehavior(id) {
  if (id === "shears") return { kind: "shears", tier: "iron", speed: 15 };
  const match = id.match(/^(wood|stone|iron|diamond|gold)_(pickaxe|shovel|axe|hoe)$/);
  if (!match) return null;
  const tier = match[1];
  const kind = match[2];
  const speeds = { wood: 2, stone: 4, iron: 6, diamond: 8, gold: 12 };
  return { kind, tier, speed: speeds[tier] ?? 1 };
}

function getWeaponDamage(id) {
  const sword = id.match(/^(wood|stone|iron|diamond|gold)_sword$/);
  if (sword) return ({ wood: 4, gold: 4, stone: 5, iron: 6, diamond: 7 })[sword[1]] ?? 4;
  const tool = getToolBehavior(id);
  if (!tool) return 0;
  if (tool.kind === "axe") return ({ wood: 7, gold: 7, stone: 9, iron: 9, diamond: 9 })[tool.tier] ?? 7;
  if (tool.kind === "pickaxe") return ({ wood: 2, gold: 2, stone: 3, iron: 4, diamond: 5 })[tool.tier] ?? 2;
  return 1;
}

function getArmorBehavior(id) {
  const match = id.match(/^(leather|chainmail|iron|diamond|gold)_(helmet|chestplate|leggings|boots)$/);
  if (!match) return null;
  const material = match[1];
  const slot = match[2];
  const pointsBySlot = {
    leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
    chainmail: { helmet: 2, chestplate: 5, leggings: 4, boots: 1 },
    iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
    diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
    gold: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
  };
  return { slot, material, points: pointsBySlot[material]?.[slot] ?? 1 };
}

function getCreativeCategory(id, item = null, source = "items") {
  if (source === "blocks" || item?.block) {
    if (/flower|grass|sapling|leaves|mushroom|vine|bush|fern|cactus|reeds|sugar_cane|melon|pumpkin|cake|bed|torch|plant|crop|carrot|potato|wheat/.test(id)) {
      return "decorations";
    }
    if (/redstone|repeater|comparator|piston|lever|button|pressure|trip|daylight|rail|detector|activator/.test(id)) return "redstone";
    if (/rail|minecart/.test(id)) return "transport";
    return "blocks";
  }

  if (/apple|bread|beef|chicken|porkchop|fish|cookie|carrot|potato|melon|mushroom_stew|rabbit|mutton|pumpkin_pie/.test(id)) return "food";
  if (/pickaxe|shovel|axe|hoe|shears|flint_and_steel|fishing_rod|carrot_on_a_stick/.test(id)) return "tools";
  if (/sword|bow|arrow|helmet|chestplate|leggings|boots|horse_armor/.test(id)) return "combat";
  if (/potion|brewing|blaze|nether_wart|ghast_tear|magma_cream|spider_eye|glass_bottle|fermented/.test(id)) return "brewing";
  if (/minecart|boat|saddle/.test(id)) return "transport";
  if (/redstone|repeater|comparator|fireworks|firework_charge/.test(id)) return "redstone";
  if (/coal|charcoal|diamond|emerald|ingot|nugget|quartz|stick|feather|leather|dye|bone|string|paper|book|slimeball|ender|clay|brick|flint|gunpowder|wheat|seeds|sugar|egg/.test(id)) {
    return "materials";
  }
  return "misc";
}

function createCreativeSearchText(id, name) {
  return `${id} ${name}`.toLowerCase().replaceAll("_", " ");
}

function isTextInputTarget(target) {
  if (!target) return false;
  const element = target.closest?.("input, textarea, select, [contenteditable='true']");
  return Boolean(element);
}

function creativeColorFromId(id) {
  const hash = hashString(id);
  const r = 76 + (hash & 0x7f);
  const g = 76 + ((hash >> 8) & 0x7f);
  const b = 76 + ((hash >> 16) & 0x7f);
  return (r << 16) | (g << 8) | b;
}

function compactGrid(ids, cols) {
  const rows = ids.length / cols;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (ids[r * cols + c] !== null) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < 0) return { ids: [], w: 0, h: 0 };
  const w = maxC - minC + 1, h = maxR - minR + 1;
  const out = [];
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      out.push(ids[r * cols + c]);
  return { ids: out, w, h };
}

function getCraftingResult3x3(slots) {
  const ids = slots.map((s) => s?.id ?? null);
  const normIds = ids.map((id) => (id && PLANK_ITEM_IDS.has(id) ? "plank" : id));
  const { ids: cids, w, h } = compactGrid(normIds, 3);
  if (w === 0) return null;

  for (const [pattern, result, count] of CRAFTING_TABLE_RECIPES) {
    const ph = pattern.length, pw = pattern[0].length;
    if (pw !== w || ph !== h) continue;
    const flat = pattern.flat();
    if (flat.every((v, i) => v === cids[i])) return createStack(result, count ?? 1);
  }

  const shapelessResult = getGuideShapelessCraftingResult(slots, TABLE_GUIDE_SHAPELESS_RECIPES);
  if (shapelessResult) return shapelessResult;

  if (w <= 2 && h <= 2) {
    const rawCompact = compactGrid(ids, 3);
    const sq = [];
    for (let r = 0; r < rawCompact.h; r++) {
      sq.push(rawCompact.ids[r * rawCompact.w] ?? null);
      sq.push(rawCompact.w > 1 ? (rawCompact.ids[r * rawCompact.w + 1] ?? null) : null);
    }
    while (sq.length < 4) sq.push(null);
    // getCraftingResult expects slot objects ({id}), not raw id strings.
    return getCraftingResult(sq.map((id) => (id ? { id } : null)));
  }

  return null;
}

const P = "plank";
const S = "stick";
const C = "cobblestone";
const R = "redstone_dust";
const CRAFTING_TABLE_RECIPES = [
  // ── Pickaxes ──────────────────────────────────────────────
  [[ ["plank","plank","plank"],[null,S,null],[null,S,null] ],         "wood_pickaxe", 1],
  [[ ["cobblestone","cobblestone","cobblestone"],[null,S,null],[null,S,null] ], "stone_pickaxe", 1],
  [[ ["iron_ingot","iron_ingot","iron_ingot"],[null,S,null],[null,S,null] ],    "iron_pickaxe", 1],
  [[ ["gold_ingot","gold_ingot","gold_ingot"],[null,S,null],[null,S,null] ],    "gold_pickaxe", 1],
  [[ ["diamond","diamond","diamond"],[null,S,null],[null,S,null] ],             "diamond_pickaxe", 1],
  // ── Swords ───────────────────────────────────────────────
  [[ ["plank"],[    "plank"],[S] ],      "wood_sword", 1],
  [[ ["cobblestone"],["cobblestone"],[S] ], "stone_sword", 1],
  [[ ["iron_ingot"],["iron_ingot"],[S] ],  "iron_sword", 1],
  [[ ["gold_ingot"],["gold_ingot"],[S] ],  "gold_sword", 1],
  [[ ["diamond"],["diamond"],[S] ],        "diamond_sword", 1],
  // ── Shovels ──────────────────────────────────────────────
  [[ ["plank"],[S],[S] ],       "wood_shovel", 1],
  [[ ["cobblestone"],[S],[S] ], "stone_shovel", 1],
  [[ ["iron_ingot"],[S],[S] ],  "iron_shovel", 1],
  [[ ["gold_ingot"],[S],[S] ],  "gold_shovel", 1],
  [[ ["diamond"],[S],[S] ],     "diamond_shovel", 1],
  // ── Axes (right-hand) ────────────────────────────────────
  [[ ["plank","plank"],["plank",S],[null,S] ],        "wood_axe", 1],
  [[ ["cobblestone","cobblestone"],["cobblestone",S],[null,S] ], "stone_axe", 1],
  [[ ["iron_ingot","iron_ingot"],["iron_ingot",S],[null,S] ],    "iron_axe", 1],
  [[ ["gold_ingot","gold_ingot"],["gold_ingot",S],[null,S] ],    "gold_axe", 1],
  [[ ["diamond","diamond"],["diamond",S],[null,S] ],             "diamond_axe", 1],
  // ── Axes (left-hand mirror) ──────────────────────────────
  [[ ["plank","plank"],[S,"plank"],[S,null] ],        "wood_axe", 1],
  [[ ["cobblestone","cobblestone"],[S,"cobblestone"],[S,null] ], "stone_axe", 1],
  [[ ["iron_ingot","iron_ingot"],[S,"iron_ingot"],[S,null] ],    "iron_axe", 1],
  [[ ["gold_ingot","gold_ingot"],[S,"gold_ingot"],[S,null] ],    "gold_axe", 1],
  [[ ["diamond","diamond"],[S,"diamond"],[S,null] ],             "diamond_axe", 1],
  // ── Hoes (right-hand) ────────────────────────────────────
  [[ ["plank","plank"],[null,S],[null,S] ],        "wood_hoe", 1],
  [[ ["cobblestone","cobblestone"],[null,S],[null,S] ], "stone_hoe", 1],
  [[ ["iron_ingot","iron_ingot"],[null,S],[null,S] ],  "iron_hoe", 1],
  [[ ["gold_ingot","gold_ingot"],[null,S],[null,S] ],  "gold_hoe", 1],
  [[ ["diamond","diamond"],[null,S],[null,S] ],        "diamond_hoe", 1],
  // ── Hoes (left-hand mirror) ──────────────────────────────
  [[ ["plank","plank"],[S,null],[S,null] ],        "wood_hoe", 1],
  [[ ["cobblestone","cobblestone"],[S,null],[S,null] ], "stone_hoe", 1],
  [[ ["iron_ingot","iron_ingot"],[S,null],[S,null] ],   "iron_hoe", 1],
  [[ ["gold_ingot","gold_ingot"],[S,null],[S,null] ],   "gold_hoe", 1],
  [[ ["diamond","diamond"],[S,null],[S,null] ],         "diamond_hoe", 1],
  // ── Furnace ──────────────────────────────────────────────
  [[ ["cobblestone","cobblestone","cobblestone"],["cobblestone",null,"cobblestone"],["cobblestone","cobblestone","cobblestone"] ], "furnace", 1],
  // ── Torches ──────────────────────────────────────────────
  [[ ["coal"],[S] ], "torch_on", 4],
  [[ ["charcoal"],[S] ], "torch_on", 4],
  [[ [P,P,P],[P,P,P] ], "trapdoor", 2],
  [[ ["iron_ingot","iron_ingot"],["iron_ingot","iron_ingot"] ], "iron_trapdoor", 1],
  [[ [P,null,P],[P,P,P] ], "boat", 1],
  [[ [P,P,P],[P,P,P],[null,S,null] ], "sign", 3],
  [[ [S,null,S],[S,S,S],[S,null,S] ], "ladder", 3],
  [[ [P,null,P],[null,P,null] ], "bowl", 4],
  [[ ["wool_colored_white","wool_colored_white","wool_colored_white"],[P,P,P] ], "bed", 1],
  [[ [P,P,P],["book","book","book"],[P,P,P] ], "bookshelf", 1],
  [[ ["sugar_cane","sugar_cane","sugar_cane"] ], "paper", 3],
  [[ ["wheat","wheat","wheat"] ], "bread", 1],
  [[ [null,S,"string"],[S,null,"string"],[null,S,"string"] ], "bow", 1],
  [[ ["flint"],[S],["feather"] ], "arrow", 4],
  [[ ["iron_ingot",null,"iron_ingot"],[null,"iron_ingot",null] ], "bucket_empty", 1],
  [[ ["iron_ingot",null,"iron_ingot"],["iron_ingot",null,"iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"] ], "cauldron", 1],
  [[ ["iron_block","iron_block","iron_block"],[null,"iron_ingot",null],["iron_ingot","iron_ingot","iron_ingot"] ], "anvil", 1],
  [[ ["brick",null,"brick"],[null,"brick",null] ], "flower_pot", 1],
  [[ ["gunpowder","sand","gunpowder"],["sand","gunpowder","sand"],["gunpowder","sand","gunpowder"] ], "tnt", 1],
  [[ ["glass","glass","glass"],["glass","glass","glass"] ], "glass_pane", 16],
  [[ ["iron_ingot","iron_ingot","iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"] ], "iron_bars", 16],
  [[ ["iron_ingot",null,"iron_ingot"],["iron_ingot",S,"iron_ingot"],["iron_ingot",null,"iron_ingot"] ], "rail", 16],
  [[ ["gold_ingot",null,"gold_ingot"],["gold_ingot",S,"gold_ingot"],["gold_ingot",R,"gold_ingot"] ], "powered_rail", 6],
  [[ ["iron_ingot",null,"iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"] ], "minecart", 1],
  [[ [S],[C] ], "lever", 1],
  [[ [R],[S] ], "redstone_torch", 1],
  [[ ["redstone_torch",R,"redstone_torch"],["stone","stone","stone"] ], "repeater", 1],
  [[ [null,"redstone_torch",null],["redstone_torch","quartz","redstone_torch"],["stone","stone","stone"] ], "comparator", 1],
  [[ [P,P,P],[C,"iron_ingot",C],[C,R,C] ], "piston", 1],
  [[ [C,C,C],[C,null,C],[C,R,C] ], "dropper", 1],
  [[ [C,C,C],[C,"bow",C],[C,R,C] ], "dispenser", 1],
  [[ [P,P,P],[P,R,P],[P,P,P] ], "noteblock", 1],
  [[ [P,P,P],[P,"diamond",P],[P,P,P] ], "jukebox", 1],
  [[ [null,"blaze_rod",null],[C,C,C] ], "brewing_stand", 1],
  [[ [null,"book",null],["diamond","obsidian","diamond"],["obsidian","obsidian","obsidian"] ], "enchanting_table", 1],
  [[ ["gold_ingot","gold_ingot","gold_ingot"],["gold_ingot","apple","gold_ingot"],["gold_ingot","gold_ingot","gold_ingot"] ], "apple_golden", 1],
  [[ ["gold_nugget","gold_nugget","gold_nugget"],["gold_nugget","carrot","gold_nugget"],["gold_nugget","gold_nugget","gold_nugget"] ], "carrot_golden", 1],
  [[ ["gold_nugget","gold_nugget","gold_nugget"],["gold_nugget","melon","gold_nugget"],["gold_nugget","gold_nugget","gold_nugget"] ], "glistering_melon_slice", 1],
  [[ ["iron_ingot","iron_ingot","iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"] ], "iron_block", 1],
  [[ ["gold_ingot","gold_ingot","gold_ingot"],["gold_ingot","gold_ingot","gold_ingot"],["gold_ingot","gold_ingot","gold_ingot"] ], "gold_block", 1],
  [[ ["diamond","diamond","diamond"],["diamond","diamond","diamond"],["diamond","diamond","diamond"] ], "diamond_block", 1],
  [[ ["emerald","emerald","emerald"],["emerald","emerald","emerald"],["emerald","emerald","emerald"] ], "emerald_block", 1],
  [[ ["coal","coal","coal"],["coal","coal","coal"],["coal","coal","coal"] ], "coal_block", 1],
  [[ [R,R,R],[R,R,R],[R,R,R] ], "redstone_block", 1],
  [[ ["gold_nugget","gold_nugget","gold_nugget"],["gold_nugget","gold_nugget","gold_nugget"],["gold_nugget","gold_nugget","gold_nugget"] ], "gold_ingot", 1],
  [[ [P,P],[P,P],[P,P] ], "door_wood", 3],
  [[ ["iron_ingot","iron_ingot"],["iron_ingot","iron_ingot"],["iron_ingot","iron_ingot"] ], "door_iron", 3],
  [[ ["leather","leather","leather"],["leather",null,"leather"] ], "leather_helmet", 1],
  [[ ["leather",null,"leather"],["leather","leather","leather"],["leather","leather","leather"] ], "leather_chestplate", 1],
  [[ ["leather","leather","leather"],["leather",null,"leather"],["leather",null,"leather"] ], "leather_leggings", 1],
  [[ ["leather",null,"leather"],["leather",null,"leather"] ], "leather_boots", 1],
  [[ ["iron_ingot","iron_ingot","iron_ingot"],["iron_ingot",null,"iron_ingot"] ], "iron_helmet", 1],
  [[ ["iron_ingot",null,"iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"],["iron_ingot","iron_ingot","iron_ingot"] ], "iron_chestplate", 1],
  [[ ["iron_ingot","iron_ingot","iron_ingot"],["iron_ingot",null,"iron_ingot"],["iron_ingot",null,"iron_ingot"] ], "iron_leggings", 1],
  [[ ["iron_ingot",null,"iron_ingot"],["iron_ingot",null,"iron_ingot"] ], "iron_boots", 1],
  [[ ["gold_ingot","gold_ingot","gold_ingot"],["gold_ingot",null,"gold_ingot"] ], "gold_helmet", 1],
  [[ ["gold_ingot",null,"gold_ingot"],["gold_ingot","gold_ingot","gold_ingot"],["gold_ingot","gold_ingot","gold_ingot"] ], "gold_chestplate", 1],
  [[ ["gold_ingot","gold_ingot","gold_ingot"],["gold_ingot",null,"gold_ingot"],["gold_ingot",null,"gold_ingot"] ], "gold_leggings", 1],
  [[ ["gold_ingot",null,"gold_ingot"],["gold_ingot",null,"gold_ingot"] ], "gold_boots", 1],
  [[ ["diamond","diamond","diamond"],["diamond",null,"diamond"] ], "diamond_helmet", 1],
  [[ ["diamond",null,"diamond"],["diamond","diamond","diamond"],["diamond","diamond","diamond"] ], "diamond_chestplate", 1],
  [[ ["diamond","diamond","diamond"],["diamond",null,"diamond"],["diamond",null,"diamond"] ], "diamond_leggings", 1],
  [[ ["diamond",null,"diamond"],["diamond",null,"diamond"] ], "diamond_boots", 1],
];

function getCraftingResult(slots) {
  const ids = slots.map((slot) => slot?.id ?? null);
  const filled = ids.filter(Boolean);

  if (filled.length === 1 && LOG_ITEM_IDS.has(filled[0])) {
    return createStack(LOG_TO_PLANK[filled[0]] ?? "planks_oak", 4);
  }

  const norm = ids.map((id) => (id && PLANK_ITEM_IDS.has(id) ? "plank" : id));

  if (norm[0] === "plank" && norm[2] === "plank" && !norm[1] && !norm[3]) {
    return createStack("stick", 4);
  }

  if (norm[1] === "plank" && norm[3] === "plank" && !norm[0] && !norm[2]) {
    return createStack("stick", 4);
  }

  if (filled.length === 4 && filled.every((id) => PLANK_ITEM_IDS.has(id))) {
    return createStack("crafting_table", 1);
  }

  // Torch: coal/charcoal on top, stick below in same column
  if ((norm[0] === "coal" || norm[0] === "charcoal") && norm[2] === "stick" && !norm[1] && !norm[3]) {
    return createStack("torch_on", 4);
  }
  if ((norm[1] === "coal" || norm[1] === "charcoal") && norm[3] === "stick" && !norm[0] && !norm[2]) {
    return createStack("torch_on", 4);
  }

  if (filled.length === 4 && filled.every((id) => id === "sand")) {
    return createStack("sandstone", 1);
  }

  if (filled.length === 4 && filled.every((id) => id === "red_sand")) {
    return createStack("red_sandstone_normal", 1);
  }

  if (filled.length === 4 && filled.every((id) => id === "brick")) {
    return createStack("bricks", 1);
  }

  if (filled.length === 4 && filled.every((id) => id === "stone")) {
    return createStack("stone_bricks", 4);
  }

  if (filled.length === 4 && filled.every((id) => id === "string")) {
    return createStack("wool_colored_white", 1);
  }

  if (
    (ids[0] === "iron_ingot" && ids[3] === "iron_ingot" && !ids[1] && !ids[2]) ||
    (ids[1] === "iron_ingot" && ids[2] === "iron_ingot" && !ids[0] && !ids[3])
  ) {
    return createStack("shears", 1);
  }

  if (filled.length === 2 && filled.includes("flint") && filled.includes("iron_ingot")) {
    return createStack("flint_and_steel", 1);
  }

  if (filled.length === 4 && filled.filter((id) => id === "dirt").length === 2 && filled.filter((id) => id === "gravel").length === 2) {
    return createStack("coarse_dirt", 4);
  }

  if (filled.length === 2 && filled.includes("cobblestone") && filled.includes("vine")) {
    return createStack("cobblestone_mossy", 1);
  }

  if (filled.length === 2 && filled.includes("stone_bricks") && filled.includes("vine")) {
    return createStack("stonebrick_mossy", 1);
  }

  return null;
}

function createGuideRecipe(id, size, pattern, result, count = 1) {
  return Object.freeze({ id, size, type: "shaped", pattern, result, count });
}

function createGuideShapelessRecipe(id, size, ingredients, result, count = 1) {
  return Object.freeze({ id, size, type: "shapeless", ingredients, result, count });
}

function recipeIngredientMatches(actualId, ingredient) {
  if (ingredient == null) return actualId == null;
  if (!actualId) return false;
  if (Array.isArray(ingredient)) return ingredient.some((entry) => recipeIngredientMatches(actualId, entry));
  if (ingredient === P) return PLANK_ITEM_IDS.has(actualId);
  if (ingredient === "any_log") return LOG_ITEM_IDS.has(actualId);
  return actualId === ingredient;
}

function getRecipeIngredientCandidates(ingredient) {
  if (ingredient == null) return [];
  if (Array.isArray(ingredient)) return ingredient.flatMap((entry) => getRecipeIngredientCandidates(entry));
  if (ingredient === P) return [...PLANK_ITEM_IDS];
  if (ingredient === "any_log") return [...LOG_ITEM_IDS];
  return [ingredient];
}

function takeRecipeIngredientFromCounts(counts, ingredient) {
  for (const itemId of getRecipeIngredientCandidates(ingredient)) {
    const count = counts.get(itemId) ?? 0;
    if (count <= 0) continue;
    if (count === 1) counts.delete(itemId);
    else counts.set(itemId, count - 1);
    return itemId;
  }

  for (const [itemId, count] of counts) {
    if (count <= 0 || !recipeIngredientMatches(itemId, ingredient)) continue;
    if (count === 1) counts.delete(itemId);
    else counts.set(itemId, count - 1);
    return itemId;
  }

  return null;
}

function getRecipeIngredientList(recipe) {
  if (!recipe) return [];
  return recipe.type === "shapeless"
    ? [...recipe.ingredients]
    : recipe.pattern.flat().filter(Boolean);
}

function getRecipeGridCells(recipe, gridSize) {
  const cells = Array(gridSize * gridSize).fill(null);
  if (!recipe) return cells;
  if (recipe.type === "shapeless") {
    recipe.ingredients.slice(0, cells.length).forEach((ingredient, index) => {
      cells[index] = ingredient;
    });
    return cells;
  }

  const patternHeight = recipe.pattern.length;
  const patternWidth = recipe.pattern[0]?.length ?? 0;
  const offsetX = Math.max(0, Math.floor((gridSize - patternWidth) / 2));
  const offsetY = Math.max(0, Math.floor((gridSize - patternHeight) / 2));
  for (let r = 0; r < patternHeight; r += 1) {
    for (let c = 0; c < patternWidth; c += 1) {
      const target = (r + offsetY) * gridSize + c + offsetX;
      if (target >= 0 && target < cells.length) cells[target] = recipe.pattern[r][c] ?? null;
    }
  }
  return cells;
}

function getRecipeIngredientDisplayId(ingredient) {
  if (!ingredient) return null;
  if (Array.isArray(ingredient)) return ingredient.find((id) => ITEMS[id]) ?? getRecipeIngredientDisplayId(ingredient[0]);
  if (ingredient === P) return "plank";
  if (ingredient === "any_log") return "log";
  return ingredient;
}

function getRecipeIngredientLabel(ingredient) {
  const displayId = getRecipeIngredientDisplayId(ingredient);
  if (!displayId) return "Empty";
  if (ingredient === P) return "Any planks";
  if (ingredient === "any_log") return "Any log";
  return ITEMS[displayId]?.name ?? displayId;
}

function normalizeRecipeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/[_-]+/g, " ");
}

function recipeMatchesRecipeSearch(recipe, query = "") {
  const normalizedQuery = normalizeRecipeSearchText(query);
  if (!normalizedQuery) return true;
  const ingredients = getRecipeIngredientList(recipe);
  const searchText = [
    recipe.id,
    recipe.result,
    ITEMS[recipe.result]?.name,
    ...ingredients.map((ingredient) => getRecipeIngredientDisplayId(ingredient)),
    ...ingredients.map((ingredient) => getRecipeIngredientLabel(ingredient)),
  ]
    .filter(Boolean)
    .map((value) => normalizeRecipeSearchText(value))
    .join(" ");
  return searchText.includes(normalizedQuery);
}

function shouldShowTableRecipeInGuide(entry, seenResults) {
  const result = entry[1];
  if (!ITEMS[result]) return false;
  if ((result.endsWith("_axe") || result.endsWith("_hoe")) && seenResults.has(result)) return false;
  seenResults.add(result);
  return true;
}

function getGuideShapelessCraftingResult(slots, recipes) {
  const filled = slots.map((slot) => slot?.id ?? null).filter(Boolean);
  if (!filled.length) return null;

  for (const recipe of recipes) {
    if (recipe.type !== "shapeless" || recipe.ingredients.length !== filled.length) continue;
    const counts = new Map();
    for (const itemId of filled) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    if (!recipe.ingredients.every((ingredient) => takeRecipeIngredientFromCounts(counts, ingredient))) continue;
    return createStack(recipe.result, recipe.count ?? 1);
  }

  return null;
}

function getRecipeGuideRecipes(gridSize) {
  return CRAFTING_GUIDE_RECIPES.filter((recipe) => recipe.size <= gridSize);
}

const TWO_BY_TWO_GUIDE_RECIPES = Object.freeze([
  createGuideRecipe("guide_planks_oak", 2, [["log"]], "planks_oak", 4),
  createGuideRecipe("guide_planks_spruce", 2, [["spruce_log"]], "planks_spruce", 4),
  createGuideRecipe("guide_planks_birch", 2, [["birch_log"]], "planks_birch", 4),
  createGuideRecipe("guide_planks_jungle", 2, [["jungle_log"]], "planks_jungle", 4),
  createGuideRecipe("guide_planks_acacia", 2, [["acacia_log"]], "planks_acacia", 4),
  createGuideRecipe("guide_planks_dark_oak", 2, [["dark_oak_log"]], "planks_big_oak", 4),
  createGuideRecipe("guide_stick", 2, [[P], [P]], "stick", 4),
  createGuideRecipe("guide_crafting_table", 2, [[P, P], [P, P]], "crafting_table", 1),
  createGuideRecipe("guide_torch_coal", 2, [["coal"], [S]], "torch_on", 4),
  createGuideRecipe("guide_torch_charcoal", 2, [["charcoal"], [S]], "torch_on", 4),
  createGuideRecipe("guide_sandstone", 2, [["sand", "sand"], ["sand", "sand"]], "sandstone", 1),
  createGuideRecipe("guide_red_sandstone", 2, [["red_sand", "red_sand"], ["red_sand", "red_sand"]], "red_sandstone_normal", 1),
  createGuideRecipe("guide_bricks", 2, [["brick", "brick"], ["brick", "brick"]], "bricks", 1),
  createGuideRecipe("guide_stone_bricks", 2, [["stone", "stone"], ["stone", "stone"]], "stone_bricks", 4),
  createGuideRecipe("guide_white_wool", 2, [["string", "string"], ["string", "string"]], "wool_colored_white", 1),
  createGuideRecipe("guide_shears", 2, [[null, "iron_ingot"], ["iron_ingot", null]], "shears", 1),
  createGuideShapelessRecipe("guide_flint_and_steel", 2, ["flint", "iron_ingot"], "flint_and_steel", 1),
  createGuideShapelessRecipe("guide_coarse_dirt", 2, ["dirt", "dirt", "gravel", "gravel"], "coarse_dirt", 4),
  createGuideShapelessRecipe("guide_mossy_cobblestone", 2, ["cobblestone", "vine"], "cobblestone_mossy", 1),
  createGuideShapelessRecipe("guide_mossy_stone_bricks", 2, ["stone_bricks", "vine"], "stonebrick_mossy", 1),
]);

const seenGuideResults = new Set();
const TABLE_GUIDE_RECIPES = Object.freeze(CRAFTING_TABLE_RECIPES
  .filter((entry) => shouldShowTableRecipeInGuide(entry, seenGuideResults))
  .map(([pattern, result, count], index) => createGuideRecipe(`guide_table_${index}_${result}`, 3, pattern, result, count ?? 1)));

const TABLE_GUIDE_SHAPELESS_RECIPES = Object.freeze([
  createGuideShapelessRecipe("guide_book", 3, ["paper", "paper", "paper", "leather"], "book", 1),
  createGuideShapelessRecipe("guide_pumpkin_pie", 3, ["pumpkin", "sugar", "egg"], "pumpkin_pie", 1),
  createGuideShapelessRecipe("guide_mushroom_stew", 3, ["bowl", "brown_mushroom", "red_mushroom"], "mushroom_stew", 1),
  createGuideShapelessRecipe("guide_sticky_piston", 3, ["piston", "slimeball"], "sticky_piston", 1),
  createGuideShapelessRecipe("guide_iron_from_block", 3, ["iron_block"], "iron_ingot", 9),
  createGuideShapelessRecipe("guide_gold_from_block", 3, ["gold_block"], "gold_ingot", 9),
  createGuideShapelessRecipe("guide_diamond_from_block", 3, ["diamond_block"], "diamond", 9),
  createGuideShapelessRecipe("guide_emerald_from_block", 3, ["emerald_block"], "emerald", 9),
  createGuideShapelessRecipe("guide_coal_from_block", 3, ["coal_block"], "coal", 9),
  createGuideShapelessRecipe("guide_redstone_from_block", 3, ["redstone_block"], R, 9),
  createGuideShapelessRecipe("guide_gold_nuggets_from_ingot", 3, ["gold_ingot"], "gold_nugget", 9),
].filter((recipe) => ITEMS[recipe.result]));

const CRAFTING_GUIDE_RECIPES = Object.freeze([
  ...TWO_BY_TWO_GUIDE_RECIPES,
  ...TABLE_GUIDE_RECIPES,
  ...TABLE_GUIDE_SHAPELESS_RECIPES,
].filter((recipe) => ITEMS[recipe.result]));

const RECIPE_BY_ID = Object.freeze(new Map(CRAFTING_GUIDE_RECIPES.map((recipe) => [recipe.id, recipe])));

function blockPositionKey(position) {
  return `${position.x},${position.y},${position.z}`;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function encodeWaterLevelStore(level = 0, falling = false) {
  const storedLevel = clamp((level ?? 0) + 1, 1, WATER_MAX_DEPTH + 1);
  return storedLevel | (falling ? WATER_FALLING_STORE_FLAG : 0);
}

function decodeWaterLevelStore(stored) {
  const storedLevel = stored & WATER_LEVEL_STORE_MASK;
  return storedLevel > 0 ? storedLevel - 1 : null;
}

function decodeWaterFallingStore(stored) {
  return (stored & WATER_FALLING_STORE_FLAG) !== 0;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function snapToStep(value, step) {
  return Math.round(value / step) * step;
}

function createCloudPuffBounds(x, z, width, depth, gap = 0) {
  return {
    minX: x - width * 0.5 - gap,
    maxX: x + width * 0.5 + gap,
    minZ: z - depth * 0.5 - gap,
    maxZ: z + depth * 0.5 + gap,
  };
}

function cloudPuffBoundsOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function countCloudPuffOverlaps(bounds) {
  let overlaps = 0;
  for (let i = 0; i < bounds.length; i += 1) {
    for (let j = i + 1; j < bounds.length; j += 1) {
      if (cloudPuffBoundsOverlap(bounds[i], bounds[j])) overlaps += 1;
    }
  }
  return overlaps;
}

export function mod(value, size) {
  return ((value % size) + size) % size;
}

function parseGameMode(value) {
  const mode = String(value ?? "").toLowerCase();
  if (mode === "0" || mode === "s" || mode === "survival") return "survival";
  if (mode === "1" || mode === "c" || mode === "creative") return "creative";
  if (mode === "3" || mode === "sp" || mode === "spectator") return "spectator";
  return null;
}

function parseTimeValue(value) {
  const text = String(value ?? "").toLowerCase();
  if (text === "day") return 1000;
  if (text === "noon") return 6000;
  if (text === "night") return 13000;
  if (text === "midnight") return 18000;
  const ticks = Number(text);
  return Number.isFinite(ticks) ? ticks : null;
}

function parseWeatherType(value) {
  const weather = String(value ?? "").toLowerCase();
  if (weather === "clear" || weather === "rain" || weather === "thunder") return weather;
  return null;
}

function weatherLabel(weather) {
  if (weather === "thunder") return "Thunder";
  if (weather === "rain") return "Rain";
  return "Clear";
}

function isDryWeatherBiome(biomeId) {
  return biomeId === Biome.DESERT ||
    biomeId === Biome.DESERT_HILLS ||
    biomeId === Biome.DESERT_M ||
    biomeId === Biome.SAVANNA ||
    biomeId === Biome.SAVANNA_PLATEAU ||
    biomeId === Biome.SAVANNA_M ||
    biomeId === Biome.SAVANNA_PLATEAU_M ||
    biomeId === Biome.MESA ||
    biomeId === Biome.MESA_PLATEAU_F ||
    biomeId === Biome.MESA_PLATEAU ||
    biomeId === Biome.MESA_BRYCE ||
    biomeId === Biome.MESA_PLATEAU_F_M ||
    biomeId === Biome.MESA_PLATEAU_M;
}

function isSnowWeatherBiome(biomeId) {
  return biomeId === Biome.ICE_PLAINS ||
    biomeId === Biome.ICE_MOUNTAINS ||
    biomeId === Biome.ICE_SPIKES ||
    biomeId === Biome.COLD_TAIGA ||
    biomeId === Biome.COLD_TAIGA_HILLS ||
    biomeId === Biome.COLD_TAIGA_M ||
    biomeId === Biome.FROZEN_OCEAN ||
    biomeId === Biome.FROZEN_RIVER ||
    biomeId === Biome.COLD_BEACH;
}

function isCheatCommand(command) {
  return ["gamemode", "gm", "fly", "tp", "give", "summon", "locate", "locatebiome", "time", "weather"].includes(command);
}

function getChatSuggestions(value, cheatsEnabled = true) {
  if (!value.startsWith("/")) return [];
  const body = value.slice(1);
  const endsWithSpace = /\s$/.test(body);
  const parts = body.split(/\s+/).filter(Boolean);
  const commandPrefix = parts[0] ?? "";

  if (parts.length <= 1 && !endsWithSpace) {
    return getChatCommandEntries(cheatsEnabled)
      .filter((entry) => entry.name.startsWith(commandPrefix.toLowerCase()))
      .slice(0, 7)
      .map((entry) => ({
        label: `/${entry.name}`,
        detail: entry.detail,
        completion: `/${entry.name}${entry.needsArgument ? " " : ""}`,
      }));
  }

  const commandName = resolveChatCommandName(commandPrefix);
  if (!cheatsEnabled && isCheatCommand(commandName)) return [];
  const argPrefix = endsWithSpace ? "" : (parts[1] ?? "").toLowerCase();
  const commandText = commandPrefix || commandName;

  if (commandName === "gamemode" || commandName === "gm") {
    if (!endsWithSpace && GAME_MODE_ARGUMENTS.includes(argPrefix)) return [];
    return GAME_MODE_ARGUMENTS
      .filter((mode) => mode.startsWith(argPrefix))
      .map((mode) => ({
        label: mode,
        detail: "game mode",
        completion: `/${commandText} ${mode}`,
      }));
  }

  if (commandName === "locatebiome") {
    const rawCommandName = commandPrefix.toLowerCase();
    const usingLocateSubcommand = rawCommandName === "locate" && parts[1]?.toLowerCase() === "biome";
    if (rawCommandName === "locate" && parts.length <= 2 && !usingLocateSubcommand) {
      const entries = [{
        label: "biome",
        detail: "biome search",
        completion: `/${commandPrefix} biome `,
      }];
      for (const suggestion of getBiomeSuggestions(argPrefix, `/${commandPrefix}`, false)) entries.push(suggestion);
      return entries
        .filter((entry) => entry.label.toLowerCase().startsWith(argPrefix))
        .slice(0, 7);
    }

    const biomePrefix = normalizeBiomeSearchText(
      usingLocateSubcommand ? (endsWithSpace ? "" : (parts[2] ?? "")) : argPrefix,
    );
    const completionPrefix = usingLocateSubcommand ? `/${commandPrefix} biome` : `/${commandText}`;
    return getBiomeSuggestions(biomePrefix, completionPrefix);
  }

  if (commandName === "give") {
    return Object.entries(ITEMS)
      .filter(([id, item]) => id.startsWith(argPrefix) || item.name.toLowerCase().startsWith(argPrefix))
      .slice(0, 7)
      .map(([id, item]) => ({
        label: id,
        detail: item.name,
        completion: `/${commandText} ${id} `,
      }));
  }

  if (commandName === "summon") {
    return Object.keys(MOB_CLASSES)
      .filter((id) => id.startsWith(argPrefix))
      .map((id) => ({
        label: id,
        detail: "entity",
        completion: `/${commandText} ${id} `,
      }));
  }

  if (commandName === "time") {
    if (parts.length <= 2) {
      return ["set", "add", "query"]
        .filter((action) => action.startsWith(argPrefix))
        .map((action) => ({
          label: action,
          detail: "time command",
          completion: `/${commandText} ${action}${action === "query" ? "" : " "}`,
        }));
    }
    if (parts[1]?.toLowerCase() === "set" && parts.length <= 3) {
      const valuePrefix = endsWithSpace ? "" : (parts[2] ?? "").toLowerCase();
      return ["day", "noon", "night", "midnight"]
        .filter((value) => value.startsWith(valuePrefix))
        .map((value) => ({
          label: value,
          detail: "time preset",
          completion: `/${commandText} set ${value}`,
        }));
    }
  }

  if (commandName === "weather") {
    return ["clear", "rain", "thunder"]
      .filter((weather) => weather.startsWith(argPrefix))
      .map((weather) => ({
        label: weather,
        detail: "weather",
        completion: `/${commandText} ${weather} `,
      }));
  }

  if (commandName === "tp" && parts.length <= 2) {
    return [{
      label: "~ ~ ~",
      detail: "relative position",
      completion: `/${commandText} ~ ~ ~`,
    }];
  }

  return [];
}

function getAvailableChatCommandDefinitions(cheatsEnabled = true) {
  return CHAT_COMMAND_DEFINITIONS.filter((definition) => cheatsEnabled || !isCheatCommand(definition.name));
}

function getChatCommandEntries(cheatsEnabled = true) {
  return getAvailableChatCommandDefinitions(cheatsEnabled).flatMap((definition) => {
    const needsArgument = definition.usage.includes("<");
    const entries = [{
      name: definition.name,
      detail: definition.description,
      needsArgument,
    }];
    for (const alias of definition.aliases ?? []) {
      entries.push({
        name: alias,
        detail: `Alias for /${definition.name}`,
        needsArgument,
      });
    }
    return entries;
  });
}

function resolveChatCommandName(command) {
  const normalized = String(command ?? "").toLowerCase();
  const definition = CHAT_COMMAND_DEFINITIONS.find((entry) =>
    entry.name === normalized || entry.aliases?.includes(normalized),
  );
  return definition?.name ?? normalized;
}

function getBiomeSuggestions(prefix, completionPrefix, trailingSpace = true) {
  return Object.entries(BIOMES)
    .filter(([id, biome]) => {
      const name = normalizeBiomeSearchText(biome.name);
      return id.startsWith(prefix) || name.startsWith(prefix);
    })
    .slice(0, 7)
    .map(([id, biome]) => ({
      label: id,
      detail: biome.name,
      completion: `${completionPrefix} ${id}${trailingSpace ? " " : ""}`,
    }));
}

function gameModeLabel(mode) {
  if (mode === "creative") return "Creative";
  if (mode === "spectator") return "Spectator";
  return "Survival";
}

function parseCoordinate(value, current) {
  if (value?.startsWith("~")) {
    const offsetText = value.slice(1);
    const offset = offsetText ? Number(offsetText) : 0;
    return Number.isFinite(offset) ? current + offset : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTeleport(parts, position) {
  if (parts.length < 3) return null;
  const x = parseCoordinate(parts[0], position.x);
  const y = parseCoordinate(parts[1], position.y);
  const z = parseCoordinate(parts[2], position.z);
  if (x === null || y === null || z === null) return null;
  return new THREE.Vector3(x, clamp(y, 1, WORLD_HEIGHT - 2), z);
}

function parseOptionalPosition(parts, position) {
  if (parts.length === 0) return position.clone();
  if (parts.length < 3) return null;
  const x = parseCoordinate(parts[0], position.x);
  const y = parseCoordinate(parts[1], position.y);
  const z = parseCoordinate(parts[2], position.z);
  if (x === null || y === null || z === null) return null;
  return new THREE.Vector3(x, y, z);
}

function normalizeBiomeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/\+/g, "_plus")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeBiomeId(value) {
  const normalized = normalizeBiomeSearchText(value);
  if (!normalized) return null;
  if (BIOMES[normalized]) return normalized;
  if (normalized === "swamp") return Biome.SWAMPLAND;
  if (normalized === "mountains") return Biome.EXTREME_HILLS;

  for (const [id, biome] of Object.entries(BIOMES)) {
    if (normalizeBiomeSearchText(biome.name) === normalized) return id;
  }

  const match = Object.entries(BIOMES)
    .find(([id, biome]) => id.startsWith(normalized) || normalizeBiomeSearchText(biome.name).startsWith(normalized));
  return match?.[0] ?? null;
}

function normalizeItemId(value) {
  if (!value) return null;
  const id = value.toLowerCase().replace(/^minecraft:/, "").replaceAll("-", "_");
  const aliases = {
    beef: "raw_beef",
    beef_raw: "raw_beef",
    chicken_raw: "raw_chicken",
    porkchop_raw: "raw_porkchop",
    cooked_beef: "beef_cooked",
    cooked_chicken: "chicken_cooked",
    cooked_porkchop: "porkchop_cooked",
  };
  return aliases[id] ?? id;
}

function normalizeEntityId(value) {
  if (!value) return null;
  return value.toLowerCase().replace(/^minecraft:/, "").replaceAll("-", "_");
}

function normalizeWorldSeedText(value) {
  const seed = sanitizeNumericSeedInput(value);
  return seed && seed !== "-" ? seed : "0";
}

function minecraftSeedHash(value) {
  const seed = normalizeWorldSeedText(value);
  try {
    const parsed = BigInt(seed);
    if (parsed >= MINECRAFT_SEED_MIN && parsed <= MINECRAFT_SEED_MAX) {
      return Number(BigInt.asUintN(32, parsed));
    }
    return Number(BigInt.asUintN(32, clampBigInt(parsed, MINECRAFT_SEED_MIN, MINECRAFT_SEED_MAX)));
  } catch {
    return 0;
  }
}

function sanitizeNumericSeedInput(value) {
  const text = String(value ?? "").trim();
  const negative = text.startsWith("-");
  const digits = text.replace(/\D/g, "").slice(0, 19);
  if (!digits) return negative ? "-" : "";
  return `${negative ? "-" : ""}${digits}`;
}

function clampBigInt(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function randomMinecraftSeedText() {
  const high = BigInt(Math.floor(Math.random() * 0x80000000));
  const low = BigInt(Math.floor(Math.random() * 0x100000000));
  let value = (high << 32n) | low;
  if (Math.random() < 0.5) value = -value;
  return value.toString();
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function formatSeedPreview(seed) {
  const normalized = normalizeWorldSeedText(seed);
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 7)}...${normalized.slice(-6)}`;
}

function lcg(value) {
  return (Math.imul(value, 1664525) + 1013904223) >>> 0;
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashInt(x, z, seed, max) {
  return Math.floor(hashFloat(x, z, seed) * max);
}

function pickPassiveMobForBiome(biomeId) {
  // Avoid spawning land mobs in pure ocean / frozen biomes.
  if (typeof biomeId !== "string") return null;
  if (biomeId.includes("ocean") || biomeId.includes("frozen") || biomeId.includes("ice") || biomeId.includes("river")) return null;
  if (biomeId.includes("desert") || biomeId.includes("mesa")) {
    return Math.random() < 0.7 ? "chicken" : null;
  }
  if (biomeId.includes("swamp")) {
    return Math.random() < 0.6 ? "chicken" : null;
  }
  // Generic plains/forest/savanna/jungle: pick one of three.
  const roll = Math.random();
  if (roll < 0.42) return "cow";
  if (roll < 0.78) return "pig";
  return "chicken";
}

function setHandArmUVs(geometry, faces, texW, texH) {
  const uvs = geometry.attributes.uv.array;
  const order = ["right", "left", "top", "bottom", "front", "back"];
  for (let i = 0; i < 6; i += 1) {
    const face = faces[order[i]];
    if (!face) continue;
    const u0 = face.x / texW;
    const v0 = 1 - (face.y + face.h) / texH;
    const u1 = (face.x + face.w) / texW;
    const v1 = 1 - face.y / texH;
    const off = i * 8;
    uvs[off + 0] = u0; uvs[off + 1] = v1;
    uvs[off + 2] = u1; uvs[off + 3] = v1;
    uvs[off + 4] = u0; uvs[off + 5] = v0;
    uvs[off + 6] = u1; uvs[off + 7] = v0;
  }
  geometry.attributes.uv.needsUpdate = true;
}

function createFallbackHeldToolGeometry(itemId, size = 0.82, depth = 0.09) {
  if (/(?:^|_)pickaxe$/.test(itemId)) return createPickaxeVoxelGeometry(itemId, size, depth);

  const palette = getPickaxePalette(itemId);
  const buffers = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    vertexCount: 0,
  };
  const rects = [];
  const add = (x0, y0, x1, y1, color) => rects.push([x0, y0, x1, y1, color]);
  const addHandle = () => {
    const handle = [
      [4.6, 13.5, 6.4, 15.5],
      [5.8, 12.0, 7.6, 14.0],
      [7.0, 10.5, 8.8, 12.5],
      [8.2, 9.0, 10.0, 11.0],
      [9.4, 7.5, 11.2, 9.5],
    ];
    handle.forEach((rect, index) => add(...rect, index % 2 ? palette.handleLight : palette.handle));
  };
  const kind = itemId.match(/(?:^|_)(sword|shovel|axe|hoe)$/)?.[1] ?? itemId;

  if (kind === "sword") {
    add(7.2, 10.8, 8.8, 15.5, palette.handle);
    add(6.2, 11.6, 9.8, 13.1, palette.handleLight);
    add(4.6, 9.6, 11.4, 11.0, palette.binding);
    add(6.8, 2.0, 9.2, 10.2, palette.head);
    add(7.3, 0.8, 8.7, 2.0, palette.headLight);
    add(8.8, 2.0, 9.6, 10.0, palette.headDark);
  } else {
    addHandle();
    if (kind === "shovel") {
      add(9.4, 4.0, 12.6, 7.2, palette.head);
      add(10.0, 2.8, 12.0, 4.2, palette.headLight);
      add(11.8, 5.2, 13.2, 7.8, palette.headDark);
    } else if (kind === "axe") {
      add(8.4, 3.0, 13.0, 5.2, palette.headLight);
      add(9.0, 4.6, 14.0, 8.4, palette.head);
      add(12.2, 7.4, 14.4, 10.2, palette.headDark);
      add(9.4, 5.2, 11.4, 7.4, palette.binding);
    } else if (kind === "hoe") {
      add(7.8, 3.2, 13.8, 5.2, palette.headLight);
      add(11.8, 4.8, 13.8, 8.4, palette.head);
      add(12.8, 7.6, 14.4, 10.0, palette.headDark);
    } else {
      add(8.4, 4.0, 12.6, 6.0, palette.head);
      add(9.2, 5.4, 11.2, 7.4, palette.binding);
    }
  }

  for (const [x0, y0, x1, y1, color] of rects) {
    const bounds = [
      (x0 / 16 - 0.5) * size,
      (0.5 - y1 / 16) * size,
      -depth * 0.5,
      (x1 / 16 - 0.5) * size,
      (0.5 - y0 / 16) * size,
      depth * 0.5,
    ];
    pushColoredCuboid(buffers, bounds, color);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPickaxeVoxelGeometry(itemId, size = 0.82, depth = 0.09) {
  const palette = getPickaxePalette(itemId);
  const buffers = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    vertexCount: 0,
  };

  const addPixelRect = (x0, y0, x1, y1, color) => {
    const bounds = [
      (x0 / 16 - 0.5) * size,
      (0.5 - y1 / 16) * size,
      -depth * 0.5,
      (x1 / 16 - 0.5) * size,
      (0.5 - y0 / 16) * size,
      depth * 0.5,
    ];
    pushColoredCuboid(buffers, bounds, color);
  };

  const handle = [
    [4.4, 13.6, 6.3, 15.6],
    [5.6, 12.1, 7.5, 14.1],
    [6.8, 10.6, 8.7, 12.6],
    [8.0, 9.1, 9.9, 11.1],
    [9.2, 7.6, 11.1, 9.6],
    [10.1, 6.1, 11.9, 8.0],
  ];
  handle.forEach((rect, index) => addPixelRect(...rect, index % 2 ? palette.handleLight : palette.handle));

  addPixelRect(1.8, 4.0, 4.0, 5.8, palette.headDark);
  addPixelRect(3.0, 2.6, 10.5, 4.4, palette.headLight);
  addPixelRect(4.1, 4.0, 12.8, 6.0, palette.head);
  addPixelRect(10.6, 5.4, 13.7, 7.4, palette.headDark);
  addPixelRect(12.6, 6.8, 14.7, 11.2, palette.head);
  addPixelRect(13.6, 10.0, 15.0, 12.4, palette.headDark);
  addPixelRect(9.0, 5.5, 11.0, 7.2, palette.binding);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function extrudedItemGeometryKey(itemId, size, depth) {
  return `${itemId}:${size}:${depth}`;
}

function getCachedExtrudedItemGeometry(itemId, size, depth) {
  const geometry = EXTRUDED_ITEM_GEOMETRY_CACHE.get(extrudedItemGeometryKey(itemId, size, depth));
  return geometry ? geometry.clone() : null;
}

function requestExtrudedItemGeometry(itemId, textureUrl, size, depth, onLoad) {
  const key = extrudedItemGeometryKey(itemId, size, depth);
  const cached = EXTRUDED_ITEM_GEOMETRY_CACHE.get(key);
  if (cached) {
    onLoad(cached);
    return;
  }

  const existing = EXTRUDED_ITEM_GEOMETRY_LOADS.get(key);
  if (existing) {
    existing.push(onLoad);
    return;
  }

  EXTRUDED_ITEM_GEOMETRY_LOADS.set(key, [onLoad]);
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const geometry = createExtrudedItemGeometryFromImage(image, size, depth);
    EXTRUDED_ITEM_GEOMETRY_CACHE.set(key, geometry);
    const callbacks = EXTRUDED_ITEM_GEOMETRY_LOADS.get(key) ?? [];
    EXTRUDED_ITEM_GEOMETRY_LOADS.delete(key);
    callbacks.forEach((callback) => callback(geometry));
  };
  image.onerror = () => {
    EXTRUDED_ITEM_GEOMETRY_LOADS.delete(key);
  };
  image.src = textureUrl;
}

function createExtrudedItemGeometryFromImage(image, size, depth) {
  const sampleSize = 16;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, sampleSize, sampleSize);
  ctx.drawImage(image, 0, 0, sampleSize, sampleSize);
  const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  const buffers = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    vertexCount: 0,
  };

  for (let y = 0; y < sampleSize; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) {
      const offset = (y * sampleSize + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha < 24) continue;
      const colorHex = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
      const bounds = [
        (x / sampleSize - 0.5) * size,
        (0.5 - (y + 1) / sampleSize) * size,
        -depth * 0.5,
        ((x + 1) / sampleSize - 0.5) * size,
        (0.5 - y / sampleSize) * size,
        depth * 0.5,
      ];
      pushColoredCuboid(buffers, bounds, colorHex);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function getPickaxePalette(itemId) {
  const material = itemId.split("_")[0];
  const palettes = {
    diamond: { headLight: 0x45f2dc, head: 0x19c8bd, headDark: 0x087f86 },
    iron: { headLight: 0xe4e4dc, head: 0xb7b8af, headDark: 0x73756f },
    stone: { headLight: 0x9b9b93, head: 0x6f706b, headDark: 0x474943 },
    gold: { headLight: 0xffe46b, head: 0xd9a726, headDark: 0x9a6b14 },
    wood: { headLight: 0x9a6a31, head: 0x6f461f, headDark: 0x3f2814 },
  };
  const head = palettes[material] ?? palettes.wood;
  return {
    ...head,
    handleLight: 0x9b6a31,
    handle: 0x6a431f,
    binding: 0x4c2f17,
  };
}

function pushColoredCuboid(buffers, bounds, colorHex) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const faces = [
    { normal: [0, 0, 1], shade: 1, corners: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]] },
    { normal: [0, 0, -1], shade: 0.55, corners: [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]] },
    { normal: [1, 0, 0], shade: 0.72, corners: [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]] },
    { normal: [-1, 0, 0], shade: 0.62, corners: [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]] },
    { normal: [0, 1, 0], shade: 0.88, corners: [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]] },
    { normal: [0, -1, 0], shade: 0.5, corners: [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]] },
  ];
  const color = new THREE.Color(colorHex);

  for (const face of faces) {
    const start = buffers.vertexCount;
    for (const corner of face.corners) {
      buffers.positions.push(corner[0], corner[1], corner[2]);
      buffers.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      buffers.colors.push(color.r * face.shade, color.g * face.shade, color.b * face.shade);
    }
    buffers.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    buffers.vertexCount += 4;
  }
}

function hashFloat(x, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ (seed | 0);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const BLOCK_ATLAS = createBlockTextureAtlas();
const WATER_TEXTURE = createWaterTexture();
const LAVA_TEXTURE = createLavaTexture();
const ITEM_SPRITES = createItemSprites();
const CRACK_TEXTURES = createCrackTextures();
const RADIAL_FOG_FRAGMENT = `
  float radialFogFactor(vec3 worldPosition) {
    float fogRange = max(fogFar - fogNear, 0.0001);
    float horizontalDistance = length(worldPosition.xz - cameraPosition.xz);
    float fogProgress = clamp((horizontalDistance - fogNear) / fogRange, 0.0, 1.0);
    float radialFog = smoothstep(0.0, 1.0, fogProgress) * fogRadialStrength;
    if (fogEdgeEnabled < 0.5) return radialFog;

    float distanceToEdge = min(
      min(worldPosition.x - fogEdgeBounds.x, fogEdgeBounds.z - worldPosition.x),
      min(worldPosition.z - fogEdgeBounds.y, fogEdgeBounds.w - worldPosition.z)
    );
    float edgeCurtain = 1.0 - smoothstep(2.0, fogEdgeWidth, distanceToEdge);
    float edgeLeadIn = (1.0 - smoothstep(fogEdgeWidth, fogEdgeWidth * 1.5, distanceToEdge)) * 0.18;
    return clamp(max(radialFog, max(edgeCurtain, edgeLeadIn)), 0.0, 1.0);
  }
`;
// Shared vertex/fragment shaders for terrain materials.
// Sky light (rgb) is dimmed by the dayNight uniform; block light (alpha) always shows through.
const TERRAIN_VERT = `
  attribute vec4 color;
  varying vec4 vColor;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vColor = color;
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;
const TERRAIN_FRAG = `
  uniform sampler2D map;
  uniform vec3 dayNight;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec4 fogEdgeBounds;
  uniform float fogEdgeWidth;
  uniform float fogEdgeEnabled;
  uniform float fogRadialStrength;
  varying vec4 vColor;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${RADIAL_FOG_FRAGMENT}
  vec3 blockLightColor(vec3 lightColor, float blockIntensity) {
    float hi = max(max(lightColor.r, lightColor.g), lightColor.b);
    float lo = min(min(lightColor.r, lightColor.g), lightColor.b);
    vec3 tintHue = hi > 0.0001 ? lightColor / hi : vec3(1.0);
    float tintAmount = smoothstep(0.08, 0.22, (hi - lo) / max(hi, 0.0001));
    vec3 warmLight = vec3(1.0, ${BLOCK_LIGHT_GREEN_FACTOR.toFixed(2)}, ${BLOCK_LIGHT_BLUE_FACTOR.toFixed(2)});
    return blockIntensity * mix(warmLight, tintHue, tintAmount);
  }
  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < 0.5) discard;
    vec3 skyLight = vColor.rgb * dayNight;
    float bl = vColor.a;
    vec3 blockLight = blockLightColor(vColor.rgb, bl);
    vec3 litColor = tex.rgb * max(skyLight, blockLight);
    float fogFactor = radialFogFactor(vWorldPosition);
    gl_FragColor = vec4(mix(litColor, fogColor, fogFactor), 1.0);
  }
`;
// Torch shader: sky light at full strength (no day/night dimming), block light always active
const TORCH_FRAG = `
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec4 fogEdgeBounds;
  uniform float fogEdgeWidth;
  uniform float fogEdgeEnabled;
  uniform float fogRadialStrength;
  varying vec4 vColor;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${RADIAL_FOG_FRAGMENT}
  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < 0.5) discard;
    float bl = vColor.a;
    vec3 blockLight = vec3(bl);
    vec3 litColor = tex.rgb * max(vColor.rgb, blockLight);
    float fogFactor = radialFogFactor(vWorldPosition);
    gl_FragColor = vec4(mix(litColor, fogColor, fogFactor), 1.0);
  }
`;
const WORLD_MATERIAL = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: BLOCK_ATLAS.texture },
    dayNight: { value: new THREE.Color(1, 1, 1) },
    ...FOG_UNIFORMS,
  },
  vertexShader: TERRAIN_VERT,
  fragmentShader: TERRAIN_FRAG,
  side: THREE.FrontSide,
});
WORLD_MATERIAL.emissiveIntensity = 0;
const TORCH_MATERIAL = new THREE.ShaderMaterial({
  uniforms: { map: { value: BLOCK_ATLAS.texture }, ...FOG_UNIFORMS },
  vertexShader: TERRAIN_VERT,
  fragmentShader: TORCH_FRAG,
  side: THREE.FrontSide,
  toneMapped: false,
});
const LEAF_MATERIAL = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: BLOCK_ATLAS.texture },
    dayNight: { value: new THREE.Color(1, 1, 1) },
    ...FOG_UNIFORMS,
  },
  vertexShader: TERRAIN_VERT,
  fragmentShader: TERRAIN_FRAG,
  side: THREE.DoubleSide,
});
LEAF_MATERIAL.emissiveIntensity = 0;
const WATER_MATERIAL = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: WATER_TEXTURE },
    colorTint: { value: new THREE.Color(0xffffff) },
    time: { value: 0 },
    skyTint: { value: new THREE.Color(0x78a7d8) },
    ...FOG_UNIFORMS,
  },
  vertexShader: `
    #include <common>
    attribute vec4 color;
    attribute float waterWave;
    varying vec4 vColor;
    varying vec3 vWorldPos;
    varying vec2 vUv;
    void main() {
      vColor = color;
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    #include <common>
    uniform sampler2D map;
    uniform vec3 colorTint;
    uniform float time;
    uniform vec3 sunDir;
    uniform vec3 skyTint;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec4 fogEdgeBounds;
    uniform float fogEdgeWidth;
    uniform float fogEdgeEnabled;
    uniform float fogRadialStrength;
    varying vec4 vColor;
    varying vec3 vWorldPos;
    varying vec2 vUv;
    ${RADIAL_FOG_FRAGMENT}
    void main() {
      // World-coherent UV ripple — seamless across chunk boundaries
      float t = time * 0.28;
      vec2 ripple;
      ripple.x = sin(vWorldPos.x * 0.82 + vWorldPos.z * 0.40 + t * 1.05) * 0.024
               + cos(vWorldPos.z * 1.18 + t * 0.72) * 0.013;
      ripple.y = cos(vWorldPos.z * 0.82 + vWorldPos.x * 0.36 + t * 0.88) * 0.019
               + sin(vWorldPos.x * 1.08 + t * 1.28) * 0.010;

      vec4 texel = texture2D(map, vUv + ripple);
      vec3 c = texel.rgb * vColor.rgb * colorTint;
      float fogFactor = radialFogFactor(vWorldPos);
      gl_FragColor = vec4(mix(c, fogColor, fogFactor), texel.a * clamp(vColor.a, 0.0, 1.0));
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const LAVA_MATERIAL = new THREE.MeshLambertMaterial({
  map: LAVA_TEXTURE,
  vertexColors: true,
  emissive: 0xff5a16,
  emissiveIntensity: 0.22,
  transparent: true,
  opacity: 0.9,
  depthWrite: true,
  side: THREE.FrontSide,
});

function syncWorldFogUniforms(fog) {
  if (!fog) return;
  FOG_UNIFORMS.fogColor.value.copy(fog.color);
  FOG_UNIFORMS.fogNear.value = fog.near;
  FOG_UNIFORMS.fogFar.value = fog.far;
}

function getAtlasAlphaStats(key) {
  const region = BLOCK_ATLAS.regions.get(key);
  if (!region) return null;
  const ctx = BLOCK_ATLAS.canvas.getContext("2d");
  const image = ctx.getImageData(region.x, region.y, region.size, region.size);
  let transparent = 0;
  let opaque = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] < 16) transparent += 1;
    if (image.data[index] > 240) opaque += 1;
  }
  return {
    transparent,
    opaque,
    pixels: region.size * region.size,
  };
}

window.__gameDebug = {
  getTopFaceContactShadow,
  getWaterCornerHeight,
  getWaterSurfaceHeight,
  getBlockNames: () => Object.values(BLOCKS).map((block) => block.name),
  getCreativeItems: () => CREATIVE_ITEM_IDS.map((id) => ({ id, name: ITEMS[id]?.name ?? id })),
  getBlockIdByItemId: (id) => ITEMS[id]?.block ?? getExtraBlockByItemId(id),
  getBlockNameById: (id) => BLOCKS[id]?.name ?? null,
  getBlockBreakTime: (block, itemId = null) => getBlockBreakTime(block, itemId),
  getBlockBreakDelay: () => SURVIVAL_BLOCK_BREAK_DELAY_SECONDS,
  getTicksPerSecond: () => TICKS_PER_SECOND,
  getFurnaceRecipes: () => ({ ...FURNACE_RECIPES }),
  getCraftingResult: (slots) => getCraftingResult(slots),
  getCraftingResult3x3: (slots) => getCraftingResult3x3(slots),
  getCraftingGuideRecipes: (gridSize = 3) => getRecipeGuideRecipes(gridSize).map((recipe) => ({
    id: recipe.id,
    result: recipe.result,
    count: recipe.count,
    size: recipe.size,
  })),
  getBreakOverlayState: () => ({
    visible: Boolean(window.__game.breakOverlay?.visible),
    color: window.__game.breakMaterial?.color?.getHex?.() ?? null,
    opacity: window.__game.breakMaterial?.opacity ?? null,
    scale: {
      x: window.__game.breakOverlay?.scale.x ?? null,
      y: window.__game.breakOverlay?.scale.y ?? null,
      z: window.__game.breakOverlay?.scale.z ?? null,
    },
  }),
  getSelectionBoxesByDefinitionId: (id) => {
    const shape = getBlockShapeById(id);
    return (shape?.selection ?? shape?.boxes ?? shape?.collision ?? []).map((box) => ({ ...box }));
  },
  getBlockAtlasTileSize: () => BLOCK_ATLAS.size,
  getAtlasAlphaStats,
  getBiomeIds: () => Object.keys(BIOMES),
  getLightLevels: () => ({ ...MINECRAFT_LIGHT_LEVELS, max: MAX_LIGHT_LEVEL }),
  getSkyLightLevel: (x, y, z) => window.__game.world.getSkyLightLevel(x, y, z),
  getBlockLightLevel: (x, y, z) => window.__game.world.getBlockLightLevel(x, y, z),
  getCombinedLightLevel: (x, y, z) => window.__game.world.getCombinedLightLevel(x, y, z),
  getMinecraftLightFactor: (level) => minecraftLightFactor(level),
  getLightColorFactors: (x, y, z, optLevel = null, waterDepth = 0) =>
    computeLightColors(window.__game.world, x, y, z, optLevel, waterDepth),
  getBlockLightColorFactors: (level) => blockLightColorFactors(level),
  getDefaultWaterTint: () => DEFAULT_WATER_TINT,
  getWaterDepthTintSample,
  getSubmergedDepthTintSample,
  getUnderwaterLightColorSample,
  getUnderwaterLitSubmergedTintSample,
  getActiveDynamicBlockLights: () => window.__game.world.dynamicBlockLights
    .filter((light) => light.visible && light.intensity > 0)
    .map((light) => ({ x: light.position.x, y: light.position.y, z: light.position.z, intensity: light.intensity, distance: light.distance, color: light.color.getHex() })),
  getTargetOutlineState: () => ({
    visible: Boolean(window.__game.targetOutline?.visible),
    x: window.__game.targetOutline?.position.x ?? null,
    y: window.__game.targetOutline?.position.y ?? null,
    z: window.__game.targetOutline?.position.z ?? null,
  }),
  getTargetOutlineLocalBounds: () => {
    const outline = window.__game.targetOutline;
    if (!outline?.geometry) return null;
    outline.geometry.computeBoundingBox();
    const box = outline.geometry.boundingBox;
    return box ? {
      minX: box.min.x + 0.5,
      minY: box.min.y + 0.5,
      minZ: box.min.z + 0.5,
      maxX: box.max.x + 0.5,
      maxY: box.max.y + 0.5,
      maxZ: box.max.z + 0.5,
    } : null;
  },
  getHandMaterialColor: () => ({
    r: window.__game.handArmMaterial?.color.r ?? null,
    g: window.__game.handArmMaterial?.color.g ?? null,
    b: window.__game.handArmMaterial?.color.b ?? null,
  }),
  isFullBrightLighting: () => fullBrightLightingEnabled,
  getMinecraftY: (y) => window.__game.world.minecraftY(y),
  getMinecraft118Y: (y) => window.__game.world.minecraft118Y(y),
  getCaveDensity: (x, y, z) => window.__game.world.caveDensityAt(x, y, z, window.__game.world.terrainHeight(x, z)),
  isRavineAt: (x, y, z) => window.__game.world.isRavineAt(x, y, z, window.__game.world.terrainHeight(x, z)),
  getDroppedItemCount: () => window.__game.droppedItems.length,
  getDroppedItemMaterialState: (id) => {
    const material = window.__game.createDroppedItemMaterial(id);
    const state = {
      color: material.color.getHex(),
      hasMap: Boolean(material.map),
      transparent: material.transparent,
      alphaTest: material.alphaTest,
    };
    material.dispose();
    return state;
  },
  dropSelectedItem: () => window.__game.dropSelectedItem(),
  spawnDroppedItem: (id, count = 1, x = window.__game.player.position.x, y = window.__game.player.position.y + 1, z = window.__game.player.position.z) =>
    Boolean(window.__game.spawnDroppedItem(id, count, new THREE.Vector3(x, y, z))),
  getWeather: () => window.__game.weather,
  getTimeOfDay: () => window.__game.timeOfDay,
  getEnvironmentTextureStatus: () => ({
    sun: Boolean(SUN_TEXTURE.image),
    moon: Boolean(MOON_PHASES_TEXTURE.image),
    rain: Boolean(RAIN_TEXTURE.image),
    snow: Boolean(SNOW_TEXTURE.image),
    clouds: Boolean(CLOUD_TEXTURE.image),
  }),
  getSkyMaterialState: () => ({
    sunSize: SUN_BODY_SIZE,
    moonSize: MOON_BODY_SIZE,
    cloudHeight: CLOUD_HEIGHT,
    cloudTileSize: CLOUD_TILE_SIZE,
    cloudPuffCount: window.__game.cloudPuffCount ?? 0,
    cloudOverlapCount: countCloudPuffOverlaps(window.__game.cloudBounds ?? []),
    cloudMaterialType: window.__game.cloudMaterial?.type ?? null,
    blockAtlasMipmapSafe: BLOCK_ATLAS.texture.minFilter === WORLD_TEXTURE_MIN_FILTER && BLOCK_ATLAS.texture.generateMipmaps === true && ATLAS_TILE_PADDING > 0,
    blockAtlasMinFilter: BLOCK_ATLAS.texture.minFilter,
    blockAtlasAnisotropy: BLOCK_ATLAS.texture.anisotropy,
    blockAtlasPadding: ATLAS_TILE_PADDING,
    terrainDynamicShadows: TERRAIN_DYNAMIC_SHADOWS,
    smaaEnabled: window.__game.smaaPass?.enabled ?? null,
    rendererPixelRatio: window.__game.renderer?.getPixelRatio?.() ?? null,
    rendererToneMapping: window.__game.renderer?.toneMapping ?? null,
    postProcessingSamples: window.__game.composer?.renderTarget1?.samples ?? null,
    fogEdgeBounds: FOG_UNIFORMS.fogEdgeBounds.value.toArray(),
    fogEdgeWidth: FOG_UNIFORMS.fogEdgeWidth.value,
    fogEdgeEnabled: FOG_UNIFORMS.fogEdgeEnabled.value,
    fogRadialStrength: FOG_UNIFORMS.fogRadialStrength.value,
    sunDepthTest: window.__game.sunSprite?.material.depthTest ?? null,
    moonDepthTest: window.__game.moonSprite?.material.depthTest ?? null,
    sunRenderOrder: window.__game.sunSprite?.renderOrder ?? null,
    shadowFar: window.__game.sun?.shadow.camera.far ?? null,
    shadowNormalBias: window.__game.sun?.shadow.normalBias ?? null,
    rainParticles: RAIN_PARTICLE_COUNT,
    rainMaterialType: window.__game.rainMaterial?.type ?? null,
    rainTextureWrapT: RAIN_TEXTURE.wrapT,
    rainTextureOffsetY: RAIN_TEXTURE.offset.y,
    rainOpacity: window.__game.rainMaterial?.opacity ?? null,
    rainHeight: window.__game.rainParticles?.[0]?.scale.y ?? null,
    rainDrawn: window.__game._lastRainDrawn ?? 0,
    snowMaterialType: window.__game.snowMaterial?.type ?? null,
    snowTextureIsSnow: window.__game.snowMaterial?.map === SNOW_TEXTURE,
    snowTextureIsRain: window.__game.snowMaterial?.map === RAIN_TEXTURE,
    snowTextureWrapS: SNOW_TEXTURE.wrapS,
    snowTextureWrapT: SNOW_TEXTURE.wrapT,
    snowTextureRepeatY: SNOW_TEXTURE.repeat.y,
    snowTextureScrollSpeed: SNOW_TEXTURE_SCROLL_SPEED,
    snowTextureOffsetY: SNOW_TEXTURE.offset.y,
    snowDrawn: window.__game._lastSnowDrawn ?? 0,
    snowVisible: Boolean(window.__game.snowGroup?.visible),
    splashVisible: Boolean(window.__game.splashMesh?.visible),
    groundDropletSpots: window.__game.groundDropletSpotData?.filter((spot) => spot.active).length ?? 0,
    groundDroplets: window.__game.groundDropletData?.filter((drop) => drop.active).length ?? 0,
    precipitationStrength: window.__game.precipitationStrength ?? null,
    skyBackgroundHex: window.__game.scene.background?.getHex?.() ?? null,
    leafTransparent: LEAF_MATERIAL.transparent,
    leafOpacity: LEAF_MATERIAL.opacity,
    leafDepthWrite: LEAF_MATERIAL.depthWrite,
    leafAlphaTest: LEAF_MATERIAL.alphaTest,
  }),
  getWorldHeight: () => WORLD_HEIGHT,
  getMaxBuildY: () => WORLD_HEIGHT - 1,
  getSeaLevel: () => SEA_LEVEL,
  getMaxRenderDistance: () => MAX_RENDER_DISTANCE,
  getTitleRenderDistance: () => TITLE_RENDER_DISTANCE,
};
window.__game = new Game();
