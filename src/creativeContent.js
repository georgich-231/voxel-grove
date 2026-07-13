const BLOCK_ASSET_MODULES = import.meta.glob("./assets/blocks/*.png", { eager: true, query: "?url", import: "default" });

export const EXTRA_BLOCK_ID_START = 72;

const BUILT_IN_BLOCK_ITEM_IDS = new Set(["waterlily"]);

const CUSTOM_SHAPE_IDS = new Set([
  "anvil",
  "iron_bars",
  "glass_pane",
  "torch_on",
  "trapdoor",
  "iron_trapdoor",
  "door_wood",
  "door_spruce",
  "door_birch",
  "door_jungle",
  "door_acacia",
  "door_dark_oak",
  "door_iron",
]);

export const TRAPDOOR_ITEM_IDS = Object.freeze(["trapdoor", "iron_trapdoor"]);
export const TRAPDOOR_HALVES = Object.freeze(["bottom", "top"]);
export const TRAPDOOR_SIDES = Object.freeze(["north", "south", "east", "west"]);
const LEGACY_TRAPDOOR_HALF = "bottom";
const LEGACY_TRAPDOOR_SIDE = "south";

const REPRESENTATIVE_BLOCK_TEXTURE_ALIASES = Object.freeze({
  anvil_top_damaged_0: "anvil",
  bed_head_top: "bed",
  brewing_stand: "brewing_stand",
  cake_top: "cake",
  cauldron_side: "cauldron",
  comparator_off: "comparator",
  daylight_detector_top: "daylight_detector",
  dispenser_front_horizontal: "dispenser",
  door_acacia_lower: "door_acacia",
  door_birch_lower: "door_birch",
  door_dark_oak_lower: "door_dark_oak",
  door_iron_lower: "door_iron",
  door_jungle_lower: "door_jungle",
  door_spruce_lower: "door_spruce",
  door_wood_lower: "door_wood",
  dropper_front_horizontal: "dropper",
  enchanting_table_top: "enchanting_table",
  endframe_top: "end_portal_frame",
  farmland_dry: "farmland",
  furnace_front_off: "furnace",
  hay_block_side: "hay_block",
  hopper_outside: "hopper",
  jukebox_side: "jukebox",
  lava_still: "lava",
  piston_top_normal: "piston",
  piston_top_sticky: "sticky_piston",
  pumpkin_face_on: "jack_o_lantern",
  quartz_block_top: "quartz_block",
  rail_activator: "activator_rail",
  rail_detector: "detector_rail",
  rail_golden: "powered_rail",
  rail_normal: "rail",
  redstone_lamp_off: "redstone_lamp",
  redstone_torch_on: "redstone_torch",
  repeater_off: "repeater",
  trip_wire_source: "tripwire_hook",
  tnt_side: "tnt",
});

const HIDDEN_CREATIVE_BLOCK_TEXTURES = new Set([
  "endframe_eye",
  "fire_layer_0",
  "fire_layer_1",
  "itemframe_background",
  "lava_flow",
  "portal",
  "comparator_on",
  "redstone_dust_cross",
  "redstone_dust_line",
  "repeater_on",
  "trip_wire",
  "water_flow",
  "water_still",
]);

const CREATIVE_TEXTURE_FRAGMENT_TOKEN = /(^|_)(top|bottom|side|front|back|inner|base|stem|cross|line|feet|head|lower|upper|powered|unpowered|connected|disconnected|horizontal|vertical|snowed|turned|wet|dry|eye|source)(_|$)/;

const LEGACY_COLOR_NAMES = Object.freeze({
  black: "Black",
  blue: "Blue",
  brown: "Brown",
  cyan: "Cyan",
  gray: "Gray",
  green: "Green",
  light_blue: "Light Blue",
  lime: "Lime",
  magenta: "Magenta",
  orange: "Orange",
  pink: "Pink",
  purple: "Purple",
  red: "Red",
  silver: "Light Gray",
  white: "White",
  yellow: "Yellow",
});

const LEGACY_WOOD_NAMES = Object.freeze({
  acacia: "Acacia",
  big_oak: "Dark Oak",
  birch: "Birch",
  jungle: "Jungle",
  oak: "Oak",
  spruce: "Spruce",
});

const CREATIVE_NAME_OVERRIDES = Object.freeze({
  armor_stand: "Armor Stand",
  activator_rail: "Activator Rail",
  apple_golden: "Golden Apple",
  brick: "Brick",
  bricks: "Bricks",
  book: "Book",
  book_and_quill: "Book and Quill",
  bucket_empty: "Bucket",
  bucket_lava: "Lava Bucket",
  bucket_milk: "Milk Bucket",
  bucket_water: "Water Bucket",
  carrot_golden: "Golden Carrot",
  clay_ball: "Clay Ball",
  cobblestone_mossy: "Mossy Cobblestone",
  comparator: "Redstone Comparator",
  daylight_detector: "Daylight Sensor",
  detector_rail: "Detector Rail",
  door_wood: "Oak Door",
  dye_powder_silver: "Light Gray Dye",
  empty_map: "Empty Map",
  enchanted_book: "Enchanted Book",
  ender_eye: "Eye of Ender",
  end_portal_frame: "End Portal Frame",
  endframe_top: "End Portal Frame",
  experience_bottle: "Bottle o' Enchanting",
  fireball: "Fire Charge",
  firework_charge: "Firework Star",
  firework_star: "Firework Star",
  firework_rocket: "Firework Rocket",
  fireworks: "Firework Rocket",
  fish_clownfish_raw: "Clownfish",
  fish_cod_cooked: "Cooked Cod",
  fish_cod_raw: "Raw Cod",
  fish_pufferfish_raw: "Pufferfish",
  fish_salmon_cooked: "Cooked Salmon",
  fish_salmon_raw: "Raw Salmon",
  flower_allium: "Allium",
  flower_blue_orchid: "Blue Orchid",
  flower_dandelion: "Dandelion",
  flower_houstonia: "Azure Bluet",
  flower_oxeye_daisy: "Oxeye Daisy",
  flower_paeonia: "Peony",
  flower_pot: "Flower Pot",
  flower_rose: "Poppy",
  flower_tulip_orange: "Orange Tulip",
  flower_tulip_pink: "Pink Tulip",
  flower_tulip_red: "Red Tulip",
  flower_tulip_white: "White Tulip",
  glistering_melon_slice: "Glistering Melon Slice",
  glass_silver: "Light Gray Stained Glass",
  glass_bottle: "Glass Bottle",
  grass: "Grass Block",
  hardened_clay: "Terracotta",
  ice_packed: "Packed Ice",
  jack_o_lantern: "Jack o'Lantern",
  lapis_block: "Lapis Lazuli Block",
  map: "Map",
  melon_seeds: "Melon Seeds",
  mob_spawner: "Spawner",
  minecart_normal: "Minecart",
  minecart_chest: "Minecart with Chest",
  minecart_command_block: "Minecart with Command Block",
  minecart_furnace: "Minecart with Furnace",
  minecart_hopper: "Minecart with Hopper",
  minecart_tnt: "Minecart with TNT",
  mutton_cooked: "Cooked Mutton",
  mutton_raw: "Raw Mutton",
  nether_brick: "Nether Bricks",
  netherbrick: "Nether Brick",
  noteblock: "Note Block",
  piston: "Piston",
  potato_baked: "Baked Potato",
  potato_poisonous: "Poisonous Potato",
  potion: "Potion",
  potion_bottle_drinkable: "Potion",
  potion_bottle_empty: "Glass Bottle",
  potion_bottle_splash: "Splash Potion",
  powered_rail: "Powered Rail",
  prismarine_dark: "Dark Prismarine",
  prismarine_rough: "Prismarine",
  pumpkin_seeds: "Pumpkin Seeds",
  quartz_block: "Block of Quartz",
  quartz_block_chiseled: "Chiseled Quartz Block",
  quartz_block_lines: "Pillar Quartz Block",
  rail: "Rail",
  rabbit_cooked: "Cooked Rabbit",
  rabbit_raw: "Raw Rabbit",
  redstone_lamp: "Redstone Lamp",
  redstone_torch: "Redstone Torch",
  repeater: "Redstone Repeater",
  seeds_melon: "Melon Seeds",
  seeds_pumpkin: "Pumpkin Seeds",
  seeds_wheat: "Wheat Seeds",
  slime: "Slime Block",
  snow_grass: "Snowy Grass Block",
  splash_potion: "Splash Potion",
  spider_eye_fermented: "Fermented Spider Eye",
  stone_andesite: "Andesite",
  stone_andesite_smooth: "Polished Andesite",
  stone_diorite: "Diorite",
  stone_diorite_smooth: "Polished Diorite",
  stone_granite: "Granite",
  stone_granite_smooth: "Polished Granite",
  stonebrick: "Stone Bricks",
  stonebrick_carved: "Chiseled Stone Bricks",
  stonebrick_cracked: "Cracked Stone Bricks",
  stonebrick_mossy: "Mossy Stone Bricks",
  sticky_piston: "Sticky Piston",
  torch_on: "Torch",
  tripwire_hook: "Tripwire Hook",
  waterlily: "Lily Pad",
  wheat_seeds: "Wheat Seeds",
  writable_book: "Book and Quill",
  written_book: "Written Book",
});

export const CREATIVE_BLOCK_TEXTURE_KEYS = Object.freeze(
  Object.keys(BLOCK_ASSET_MODULES)
    .map((path) => path.split(/[\\/]/).pop()?.replace(/\.png$/i, ""))
    .filter(Boolean)
    .sort(),
);

const seenTextureDerivedBlockIds = new Set();
const TEXTURE_DERIVED_DEFINITIONS = CREATIVE_BLOCK_TEXTURE_KEYS
  .filter(isCreativePlaceableBlockTexture)
  .map((textureKey) => {
    const id = normalizeCreativeBlockItemId(textureKey);
    return { id, textureKey };
  })
  .filter(({ id }) => {
    if (BUILT_IN_BLOCK_ITEM_IDS.has(id)) return false;
    if (seenTextureDerivedBlockIds.has(id)) return false;
    seenTextureDerivedBlockIds.add(id);
    return true;
  });

const SYNTHETIC_DEFINITIONS = [
  { id: "glass_pane", textureKey: "glass" },
  { id: "furnace_south",     textureKey: "furnace_front_off", internal: true },
  { id: "furnace_east",      textureKey: "furnace_front_off", internal: true },
  { id: "furnace_west",      textureKey: "furnace_front_off", internal: true },
  { id: "furnace_lit",       textureKey: "furnace_front_on",  internal: true },
  { id: "furnace_lit_south", textureKey: "furnace_front_on",  internal: true },
  { id: "furnace_lit_east",  textureKey: "furnace_front_on",  internal: true },
  { id: "furnace_lit_west",  textureKey: "furnace_front_on",  internal: true },
];

const ALL_DEFINITION_SOURCES = [...TEXTURE_DERIVED_DEFINITIONS, ...SYNTHETIC_DEFINITIONS];

export const EXTRA_BLOCK_DEFINITIONS = Object.freeze(
  ALL_DEFINITION_SOURCES.map(({ id, textureKey, internal: srcInternal }, index) => {
    const customShape = CUSTOM_SHAPE_IDS.has(id);
    const plant = !customShape && isPlantLikeCreativeBlock(id, textureKey);
    const leaf = isLeafLikeCreativeBlock(id, textureKey);
    const liquid = id === "lava";
    return Object.freeze({
      id,
      block: EXTRA_BLOCK_ID_START + index,
      constant: `EXTRA_${toBlockConstant(id, index)}`,
      name: formatCreativeItemName(id),
      texture: textureKey,
      textures: getCreativeBlockFaceTextures(id, textureKey),
      solid: !plant && !liquid,
      liquid,
      plant,
      leaf,
      customShape,
      transparent: customShape || liquid || /glass|ice|web|ladder|door/.test(id),
      internal: liquid || Boolean(srcInternal),
      breakTime: getCreativeBlockBreakTime(id),
      color: creativeColorFromId(id),
      category: getCreativeBlockCategory(id),
    });
  }),
);

export function getExtraBlockFaceTexture(block, faceName) {
  const definition = EXTRA_BLOCK_DEFINITION_BY_BLOCK.get(block);
  if (!definition) return null;
  return definition.textures?.[faceName] ?? definition.texture;
}

export const DOOR_ITEM_IDS = Object.freeze([
  "door_wood",
  "door_spruce",
  "door_birch",
  "door_jungle",
  "door_acacia",
  "door_dark_oak",
  "door_iron",
]);

const DOOR_CLOSED_BLOCK_BY_ITEM = new Map(
  EXTRA_BLOCK_DEFINITIONS
    .filter((definition) => DOOR_ITEM_IDS.includes(definition.id))
    .map((definition) => [definition.id, definition.block]),
);
const TRAPDOOR_CLOSED_BLOCK_BY_ITEM = new Map(
  EXTRA_BLOCK_DEFINITIONS
    .filter((definition) => TRAPDOOR_ITEM_IDS.includes(definition.id))
    .map((definition) => [definition.id, definition.block]),
);

const STATEFUL_BLOCK_ID_START = EXTRA_BLOCK_ID_START + EXTRA_BLOCK_DEFINITIONS.length;

const STATEFUL_DEFINITION_SOURCES = [];
for (const id of DOOR_ITEM_IDS) {
  if (!DOOR_CLOSED_BLOCK_BY_ITEM.has(id)) continue;
  STATEFUL_DEFINITION_SOURCES.push({
    id: `${id}_upper`,
    itemId: id,
    constantSuffix: "UPPER",
    nameSuffix: "Upper",
    texture: `${id}_upper`,
    solid: true,
  });
  STATEFUL_DEFINITION_SOURCES.push({
    id: `${id}_open`,
    itemId: id,
    constantSuffix: "OPEN",
    nameSuffix: "Open",
    texture: `${id}_lower`,
    solid: true,
  });
  STATEFUL_DEFINITION_SOURCES.push({
    id: `${id}_open_upper`,
    itemId: id,
    constantSuffix: "OPEN_UPPER",
    nameSuffix: "Open Upper",
    texture: `${id}_upper`,
    solid: true,
  });
}

function getTrapdoorStateId(itemId, half = LEGACY_TRAPDOOR_HALF, side = LEGACY_TRAPDOOR_SIDE, open = false) {
  if (half === LEGACY_TRAPDOOR_HALF && side === LEGACY_TRAPDOOR_SIDE) {
    return open ? `${itemId}_open` : itemId;
  }
  return `${itemId}_${half}_${side}${open ? "_open" : ""}`;
}

for (const itemId of TRAPDOOR_ITEM_IDS) {
  if (!TRAPDOOR_CLOSED_BLOCK_BY_ITEM.has(itemId)) continue;
  for (const half of TRAPDOOR_HALVES) {
    for (const side of TRAPDOOR_SIDES) {
      for (const open of [false, true]) {
        const id = getTrapdoorStateId(itemId, half, side, open);
        if (id === itemId) continue;
        STATEFUL_DEFINITION_SOURCES.push({
          id,
          itemId,
          constantSuffix: `${toBlockConstant(half)}_${toBlockConstant(side)}${open ? "_OPEN" : ""}`,
          nameSuffix: `${formatCreativeItemName(half)} ${formatCreativeItemName(side)}${open ? " Open" : ""}`,
          texture: itemId,
          solid: true,
        });
      }
    }
  }
}

for (const facing of ["north", "south", "east", "west"]) {
  const cap = facing.charAt(0).toUpperCase() + facing.slice(1);
  STATEFUL_DEFINITION_SOURCES.push({
    id: `torch_on_wall_${facing}`,
    itemId: "torch_on",
    constantSuffix: `WALL_${facing.toUpperCase()}`,
    nameSuffix: `Wall ${cap}`,
    texture: "torch_on",
    solid: false,
    breakTime: 0.12,
  });
}

export const STATEFUL_BLOCK_DEFINITIONS = Object.freeze(
  STATEFUL_DEFINITION_SOURCES.map((source, index) => Object.freeze({
    id: source.id,
    itemId: source.itemId,
    block: STATEFUL_BLOCK_ID_START + index,
    constant: `STATE_${toBlockConstant(source.itemId, index)}_${source.constantSuffix}`,
    name: `${formatCreativeItemName(source.itemId)} ${source.nameSuffix}`,
    texture: source.texture,
    solid: source.solid ?? false,
    plant: false,
    leaf: false,
    customShape: true,
    transparent: true,
    internal: true,
    breakTime: source.breakTime ?? 3,
    color: creativeColorFromId(source.itemId),
    category: "decorations",
  })),
);

export const RUNTIME_BLOCK_DEFINITIONS = Object.freeze([...EXTRA_BLOCK_DEFINITIONS, ...STATEFUL_BLOCK_DEFINITIONS]);

export const EXTRA_BLOCK_DEFINITION_BY_BLOCK = Object.freeze(
  new Map(RUNTIME_BLOCK_DEFINITIONS.map((definition) => [definition.block, definition])),
);

const STATEFUL_BLOCK_BY_ID = new Map(STATEFUL_BLOCK_DEFINITIONS.map((definition) => [definition.id, definition.block]));

const TRAPDOOR_STATE_BY_BLOCK_MUTABLE = new Map();
const TRAPDOOR_BLOCK_BY_STATE_KEY_MUTABLE = new Map();
for (const itemId of TRAPDOOR_ITEM_IDS) {
  if (!TRAPDOOR_CLOSED_BLOCK_BY_ITEM.has(itemId)) continue;
  for (const half of TRAPDOOR_HALVES) {
    for (const side of TRAPDOOR_SIDES) {
      for (const open of [false, true]) {
        const id = getTrapdoorStateId(itemId, half, side, open);
        const block = id === itemId ? TRAPDOOR_CLOSED_BLOCK_BY_ITEM.get(itemId) : STATEFUL_BLOCK_BY_ID.get(id);
        if (block == null) continue;
        const state = Object.freeze({ itemId, half, side, open });
        TRAPDOOR_STATE_BY_BLOCK_MUTABLE.set(block, state);
        TRAPDOOR_BLOCK_BY_STATE_KEY_MUTABLE.set(`${itemId}:${half}:${side}:${open ? 1 : 0}`, block);
      }
    }
  }
}

export const TRAPDOOR_STATE_BY_BLOCK = Object.freeze(TRAPDOOR_STATE_BY_BLOCK_MUTABLE);

export function getTrapdoorPlacementBlock(itemId, half = LEGACY_TRAPDOOR_HALF, side = LEGACY_TRAPDOOR_SIDE, open = false) {
  return TRAPDOOR_BLOCK_BY_STATE_KEY_MUTABLE.get(`${itemId}:${half}:${side}:${open ? 1 : 0}`) ?? null;
}

export const DOOR_OPEN_BLOCK_BY_CLOSED = Object.freeze(new Map(
  DOOR_ITEM_IDS.flatMap((id) => {
    const closedLower = DOOR_CLOSED_BLOCK_BY_ITEM.get(id);
    const openLower = STATEFUL_BLOCK_BY_ID.get(`${id}_open`);
    const closedUpper = STATEFUL_BLOCK_BY_ID.get(`${id}_upper`);
    const openUpper = STATEFUL_BLOCK_BY_ID.get(`${id}_open_upper`);
    const out = [];
    if (closedLower != null && openLower != null) out.push([closedLower, openLower]);
    if (closedUpper != null && openUpper != null) out.push([closedUpper, openUpper]);
    return out;
  }),
));

export const DOOR_CLOSED_BLOCK_BY_OPEN = Object.freeze(new Map(
  [...DOOR_OPEN_BLOCK_BY_CLOSED].map(([closed, open]) => [open, closed]),
));

export const DOOR_UPPER_BLOCK_BY_LOWER = Object.freeze(new Map(
  DOOR_ITEM_IDS.flatMap((id) => {
    const closedLower = DOOR_CLOSED_BLOCK_BY_ITEM.get(id);
    const closedUpper = STATEFUL_BLOCK_BY_ID.get(`${id}_upper`);
    const openLower = STATEFUL_BLOCK_BY_ID.get(`${id}_open`);
    const openUpper = STATEFUL_BLOCK_BY_ID.get(`${id}_open_upper`);
    const out = [];
    if (closedLower != null && closedUpper != null) out.push([closedLower, closedUpper]);
    if (openLower != null && openUpper != null) out.push([openLower, openUpper]);
    return out;
  }),
));

export const DOOR_LOWER_BLOCK_BY_UPPER = Object.freeze(new Map(
  [...DOOR_UPPER_BLOCK_BY_LOWER].map(([lower, upper]) => [upper, lower]),
));

export const TRAPDOOR_TOGGLE_BLOCK = Object.freeze(new Map([
  ...[...TRAPDOOR_STATE_BY_BLOCK_MUTABLE.entries()].flatMap(([block, state]) => {
    const partner = TRAPDOOR_BLOCK_BY_STATE_KEY_MUTABLE.get(`${state.itemId}:${state.half}:${state.side}:${state.open ? 0 : 1}`);
    return partner != null ? [[block, partner]] : [];
  }),
]));

export function isCreativePlaceableBlockTexture(key) {
  if (REPRESENTATIVE_BLOCK_TEXTURE_ALIASES[key]) return true;
  return (
    !key.startsWith("destroy_stage_") &&
    !key.includes("_overlay") &&
    !HIDDEN_CREATIVE_BLOCK_TEXTURES.has(key) &&
    !CREATIVE_TEXTURE_FRAGMENT_TOKEN.test(key) &&
    !/_stage_\d+$/.test(key) &&
    !/_(top|bottom|side|back|end|inner|base|stem|cross|feet|head|powered|unpowered|lower|upper|connected|disconnected|horizontal|vertical)$/.test(key) &&
    !/_(front|face|lamp|torch)_(on|off)$/.test(key) &&
    !/_(top|bottom|side|front|back|end)_damaged_\d+$/.test(key)
  );
}

export function normalizeCreativeBlockItemId(key) {
  const aliases = {
    ...REPRESENTATIVE_BLOCK_TEXTURE_ALIASES,
    brick: "bricks",
    deadbush: "dead_bush",
    double_plant_sunflower_front: "sunflower",
    flower_blue_orchid: "blue_orchid",
    flower_dandelion: "dandelion",
    flower_rose: "poppy",
    mushroom_brown: "brown_mushroom",
    mushroom_red: "red_mushroom",
    reeds: "sugar_cane",
    stonebrick: "stone_bricks",
    tallgrass: "tall_grass",
    // Deduplicate block textures whose canonical item already exists in ITEMS
    sandstone_normal: "sandstone",
    stone_andesite: "andesite",
    stone_diorite: "diorite",
    stone_granite: "granite",
    ice_packed: "packed_ice",
  };
  return aliases[key] ?? key;
}

export function formatCreativeItemName(id) {
  if (CREATIVE_NAME_OVERRIDES[id]) return CREATIVE_NAME_OVERRIDES[id];
  const wool = id.match(/^wool_colored_(.+)$/);
  if (wool) return `${formatLegacyColorName(wool[1])} Wool`;
  const glass = id.match(/^glass_(.+)$/);
  if (glass) return `${formatLegacyColorName(glass[1])} Stained Glass`;
  const terracotta = id.match(/^hardened_clay_stained_(.+)$/);
  if (terracotta) return `${formatLegacyColorName(terracotta[1])} Terracotta`;
  const planks = id.match(/^planks_(.+)$/);
  if (planks) return `${formatLegacyWoodName(planks[1])} Planks`;
  const log = id.match(/^log_(.+)$/);
  if (log) return `${formatLegacyWoodName(log[1])} Log`;
  const leaves = id.match(/^leaves_(.+)$/);
  if (leaves) return `${formatLegacyWoodName(leaves[1])} Leaves`;
  const sapling = id.match(/^sapling_(.+)$/);
  if (sapling) return `${formatLegacyWoodName(sapling[1])} Sapling`;
  const sandstone = id.match(/^(red_)?sandstone_(normal|smooth|carved)$/);
  if (sandstone) {
    const prefix = sandstone[1] ? "Red " : "";
    const kind = sandstone[2];
    if (kind === "normal") return `${prefix}Sandstone`;
    if (kind === "smooth") return `Smooth ${prefix}Sandstone`;
    return `Chiseled ${prefix}Sandstone`;
  }
  const dye = id.match(/^dye_powder_(.+)$/);
  if (dye) return `${formatLegacyColorName(dye[1])} Dye`;
  return id
    .replace(/^record_/, "music_disc_")
    .replace(/^wood_/, "wooden_")
    .replace(/^gold_((?:sword|pickaxe|shovel|axe|hoe|helmet|chestplate|leggings|boots|horse_armor))$/, "golden_$1")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLegacyColorName(key) {
  return LEGACY_COLOR_NAMES[key] ?? formatTitleName(key);
}

function formatLegacyWoodName(key) {
  return LEGACY_WOOD_NAMES[key] ?? formatTitleName(key);
}

function formatTitleName(key) {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function creativeColorFromId(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const r = 76 + (hash & 0x7f);
  const g = 76 + ((hash >> 8) & 0x7f);
  const b = 76 + ((hash >> 16) & 0x7f);
  return (r << 16) | (g << 8) | b;
}

function isPlantLikeCreativeBlock(id, textureKey) {
  if (id === "lava") return false;
  return /flower|sapling|dead_bush|fern|tall_grass|mushroom|reeds|sugar_cane|torch|ladder|vine|waterlily|web|rail|redstone_dust|repeater|comparator|lever|trip_wire/.test(id)
    || /flower|sapling|deadbush|tallgrass|reeds|torch|ladder|vine|waterlily|web|rail|redstone_dust|repeater|comparator|lever/.test(textureKey);
}

function isLeafLikeCreativeBlock(id, textureKey) {
  return id.includes("leaves") || textureKey.includes("leaves");
}

function getCreativeBlockFaceTextures(id, textureKey) {
  if (id === "furnace") {
    return { py: "furnace_top", ny: "furnace_top", nz: "furnace_front_off", px: "furnace_side", nx: "furnace_side", pz: "furnace_side" };
  }
  if (id === "furnace_south") {
    return { py: "furnace_top", ny: "furnace_top", pz: "furnace_front_off", px: "furnace_side", nx: "furnace_side", nz: "furnace_side" };
  }
  if (id === "furnace_east") {
    return { py: "furnace_top", ny: "furnace_top", px: "furnace_front_off", nz: "furnace_side", pz: "furnace_side", nx: "furnace_side" };
  }
  if (id === "furnace_west") {
    return { py: "furnace_top", ny: "furnace_top", nx: "furnace_front_off", nz: "furnace_side", pz: "furnace_side", px: "furnace_side" };
  }
  if (id === "furnace_lit") {
    return { py: "furnace_top", ny: "furnace_top", nz: "furnace_front_on", px: "furnace_side", nx: "furnace_side", pz: "furnace_side" };
  }
  if (id === "furnace_lit_south") {
    return { py: "furnace_top", ny: "furnace_top", pz: "furnace_front_on", px: "furnace_side", nx: "furnace_side", nz: "furnace_side" };
  }
  if (id === "furnace_lit_east") {
    return { py: "furnace_top", ny: "furnace_top", px: "furnace_front_on", nz: "furnace_side", pz: "furnace_side", nx: "furnace_side" };
  }
  if (id === "furnace_lit_west") {
    return { py: "furnace_top", ny: "furnace_top", nx: "furnace_front_on", nz: "furnace_side", pz: "furnace_side", px: "furnace_side" };
  }
  if (id === "dispenser") {
    return { py: "furnace_top", ny: "furnace_top", nz: "dispenser_front_horizontal", px: "furnace_side", nx: "furnace_side", pz: "furnace_side" };
  }
  if (id === "dropper") {
    return { py: "furnace_top", ny: "furnace_top", nz: "dropper_front_horizontal", px: "furnace_side", nx: "furnace_side", pz: "furnace_side" };
  }
  if (id === "tnt") return { py: "tnt_top", ny: "tnt_bottom", px: "tnt_side", nx: "tnt_side", pz: "tnt_side", nz: "tnt_side" };
  if (id === "hay_block") return { py: "hay_block_top", ny: "hay_block_top", px: "hay_block_side", nx: "hay_block_side", pz: "hay_block_side", nz: "hay_block_side" };
  if (id === "quartz_block") return { py: "quartz_block_top", ny: "quartz_block_bottom", px: "quartz_block_side", nx: "quartz_block_side", pz: "quartz_block_side", nz: "quartz_block_side" };
  if (id === "jukebox") return { py: "jukebox_top", ny: "jukebox_side", px: "jukebox_side", nx: "jukebox_side", pz: "jukebox_side", nz: "jukebox_side" };
  if (id === "bed") return { py: "bed_head_top", ny: "bed_feet_top", px: "bed_head_side", nx: "bed_head_side", pz: "bed_head_end", nz: "bed_feet_end" };
  if (id === "piston") return { py: "piston_top_normal", ny: "piston_bottom", px: "piston_side", nx: "piston_side", pz: "piston_side", nz: "piston_side" };
  if (id === "sticky_piston") return { py: "piston_top_sticky", ny: "piston_bottom", px: "piston_side", nx: "piston_side", pz: "piston_side", nz: "piston_side" };
  if (id === "jack_o_lantern") return { py: "pumpkin_top", ny: "pumpkin_top", px: "pumpkin_side", nx: "pumpkin_side", pz: "pumpkin_side", nz: "pumpkin_face_on" };
  if (id.startsWith("door_")) return { py: textureKey, ny: textureKey, px: textureKey, nx: textureKey, pz: textureKey, nz: textureKey };
  return null;
}

function getCreativeBlockBreakTime(id) {
  if (/flower|sapling|dead_bush|fern|tall_grass|mushroom|reeds|sugar_cane|torch|ladder|vine|waterlily|web|rail|redstone_dust|repeater|comparator|lever/.test(id)) return 0.12;
  if (id === "lava") return 100;
  if (/glass|ice|glowstone|sea_lantern|lamp/.test(id)) return 0.45;
  if (/log|planks|bookshelf|chest|jukebox|noteblock|fence|trapdoor|door/.test(id)) return 3;
  if (/dirt|sand|gravel|clay|farmland|soul_sand|snow/.test(id)) return 0.75;
  if (/obsidian/.test(id)) return 50;
  if (/ore|stone|brick|netherrack|quartz|prismarine|sandstone|bedrock|block|anvil|furnace|dispenser|hopper/.test(id)) return 2.8;
  return 1.2;
}

function getCreativeBlockCategory(id) {
  if (/flower|sapling|leaves|mushroom|vine|bush|fern|cactus|reeds|sugar_cane|melon|pumpkin|cake|bed|torch|plant|crop|carrot|potato|wheat|waterlily|web/.test(id)) return "decorations";
  if (/redstone|repeater|comparator|piston|lever|button|pressure|trip|daylight|rail|detector|activator|command_block/.test(id)) return "redstone";
  if (/rail|minecart/.test(id)) return "transport";
  return "blocks";
}

function toBlockConstant(id, index) {
  const normalized = id.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return normalized || `BLOCK_${index}`;
}
