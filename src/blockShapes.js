// Shape definitions for non-cube blocks: anvils, doors, iron bars, glass panes,
// and trapdoors. Each shape is a list of cuboid boxes (relative coordinates in
// the [0,1]^3 block-local space) plus per-face texture overrides. The chunk
// mesher iterates the boxes and emits world-space face quads using the same
// lighting/AO machinery used for full cubes.
//
// Shape lookup is keyed by the runtime block id string (the `id` field on
// EXTRA_BLOCK_DEFINITIONS / STATEFUL_BLOCK_DEFINITIONS). The mesh path resolves
// numeric block ids to definition ids via EXTRA_BLOCK_DEFINITION_BY_BLOCK.

const ANVIL_BASE = "anvil_base";
const ANVIL_TOP = "anvil_top_damaged_0";

function uniformFaces(textureKey) {
  return { px: textureKey, nx: textureKey, py: textureKey, ny: textureKey, pz: textureKey, nz: textureKey };
}

function topAndSides(topKey, sideKey, bottomKey = sideKey) {
  return { px: sideKey, nx: sideKey, pz: sideKey, nz: sideKey, py: topKey, ny: bottomKey };
}

function modelFace(textureKey, uv, rotation = 0) {
  return { texture: textureKey, uv, rotation, shade: 1 };
}

const MODEL_FACE_CORNERS = Object.freeze({
  px: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  nx: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  py: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  ny: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  pz: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  nz: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
});

const MODEL_FACE_DIRS = Object.freeze({
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
});

const TORCH_FACE = Object.freeze(modelFace("torch_on", [0, 0, 16, 16]));
const TORCH_TOP_FACE = Object.freeze(modelFace("torch_on", [7, 6, 9, 8]));
const TORCH_BOTTOM_FACE = Object.freeze(modelFace("torch_on", [7, 13, 9, 15]));

function rotatePointAroundZ(point, origin, degrees) {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  return [
    origin[0] + dx * cos - dy * sin,
    origin[1] + dx * sin + dy * cos,
    point[2],
  ];
}

function rotatePointAroundBlockY(point, degrees) {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - 0.5;
  const dz = point[2] - 0.5;
  return [
    0.5 + dx * cos + dz * sin,
    point[1],
    0.5 - dx * sin + dz * cos,
  ];
}

function rotateDirectionAroundBlockY(dir, degrees) {
  const rotated = rotatePointAroundBlockY([0.5 + dir[0], 0.5 + dir[1], 0.5 + dir[2]], degrees);
  return [rotated[0] - 0.5, rotated[1] - 0.5, rotated[2] - 0.5];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function boxFromModelElement(element, localCorner) {
  return [
    (localCorner[0] ? element.to[0] : element.from[0]) / 16,
    (localCorner[1] ? element.to[1] : element.from[1]) / 16,
    (localCorner[2] ? element.to[2] : element.from[2]) / 16,
  ];
}

function transformModelPoint(point, elementRotation, yRotation) {
  let transformed = point;
  if (elementRotation?.axis === "z") {
    transformed = rotatePointAroundZ(
      transformed,
      elementRotation.origin.map((value) => value / 16),
      elementRotation.angle,
    );
  }
  if (yRotation) transformed = rotatePointAroundBlockY(transformed, yRotation);
  return transformed;
}

function makeModelElementQuads(elements, yRotation = 0) {
  const quads = [];
  for (const element of elements) {
    for (const [faceName, faceSpec] of Object.entries(element.faces)) {
      const vertices = MODEL_FACE_CORNERS[faceName].map((corner) =>
        transformModelPoint(boxFromModelElement(element, corner), element.rotation, yRotation)
      );
      const normal = rotateDirectionAroundBlockY(MODEL_FACE_DIRS[faceName], yRotation);
      quads.push({ vertices, normal, face: faceSpec });
    }
  }
  return quads;
}

function makeSelectionFromQuads(quads, padding = 0.025) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const quad of quads) {
    for (const vertex of quad.vertices) {
      minX = Math.min(minX, vertex[0]);
      minY = Math.min(minY, vertex[1]);
      minZ = Math.min(minZ, vertex[2]);
      maxX = Math.max(maxX, vertex[0]);
      maxY = Math.max(maxY, vertex[1]);
      maxZ = Math.max(maxZ, vertex[2]);
    }
  }

  return [{
    minX: clamp01(minX - padding),
    minY: clamp01(minY - padding),
    minZ: clamp01(minZ - padding),
    maxX: clamp01(maxX + padding),
    maxY: clamp01(maxY + padding),
    maxZ: clamp01(maxZ + padding),
  }];
}

function anvilFace(textureKey, uv, rotation = 0) {
  return { texture: textureKey, uv, rotation };
}

const ANVIL_SHAPE = {
  collision: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }],
  boxes: [
    {
      bounds: [2 / 16, 0 / 16, 2 / 16, 14 / 16, 4 / 16, 14 / 16],
      faces: {
        ny: anvilFace(ANVIL_BASE, [2, 2, 14, 14], 180),
        py: anvilFace(ANVIL_BASE, [2, 2, 14, 14], 180),
        nz: anvilFace(ANVIL_BASE, [2, 12, 14, 16]),
        pz: anvilFace(ANVIL_BASE, [2, 12, 14, 16]),
        nx: anvilFace(ANVIL_BASE, [0, 2, 4, 14], 90),
        px: anvilFace(ANVIL_BASE, [4, 2, 0, 14], 270),
      },
    },
    {
      bounds: [4 / 16, 4 / 16, 3 / 16, 12 / 16, 5 / 16, 13 / 16],
      faces: {
        ny: anvilFace(ANVIL_BASE, [4, 3, 12, 13], 180),
        py: anvilFace(ANVIL_BASE, [4, 3, 12, 13], 180),
        nz: anvilFace(ANVIL_BASE, [4, 11, 12, 12]),
        pz: anvilFace(ANVIL_BASE, [4, 11, 12, 12]),
        nx: anvilFace(ANVIL_BASE, [4, 3, 5, 13], 90),
        px: anvilFace(ANVIL_BASE, [5, 3, 4, 13], 270),
      },
    },
    {
      bounds: [6 / 16, 5 / 16, 4 / 16, 10 / 16, 10 / 16, 12 / 16],
      faces: {
        ny: anvilFace(ANVIL_BASE, [10, 12, 6, 4], 180),
        py: anvilFace(ANVIL_BASE, [10, 12, 6, 4], 180),
        nz: anvilFace(ANVIL_BASE, [6, 6, 10, 11]),
        pz: anvilFace(ANVIL_BASE, [6, 6, 10, 11]),
        nx: anvilFace(ANVIL_BASE, [5, 4, 10, 12], 90),
        px: anvilFace(ANVIL_BASE, [10, 4, 5, 12], 270),
      },
    },
    {
      bounds: [3 / 16, 10 / 16, 0 / 16, 13 / 16, 16 / 16, 16 / 16],
      faces: {
        ny: anvilFace(ANVIL_BASE, [3, 0, 13, 16], 180),
        py: anvilFace(ANVIL_TOP, [3, 0, 13, 16], 180),
        nz: anvilFace(ANVIL_BASE, [3, 0, 13, 6]),
        pz: anvilFace(ANVIL_BASE, [3, 0, 13, 6]),
        nx: anvilFace(ANVIL_BASE, [10, 0, 16, 16], 90),
        px: anvilFace(ANVIL_BASE, [16, 0, 10, 16], 270),
      },
    },
  ],
};

function makeBarsShape(textureKey, topTextureKey = textureKey) {
  return {
    collision: [
      { minX: 7 / 16, minY: 0, minZ: 0, maxX: 9 / 16, maxY: 1, maxZ: 1 },
      { minX: 0, minY: 0, minZ: 7 / 16, maxX: 1, maxY: 1, maxZ: 9 / 16 },
    ],
    boxes: [
      {
        bounds: [7 / 16, 0, 0, 9 / 16, 1, 1],
        faces: { px: textureKey, nx: textureKey, py: topTextureKey, ny: topTextureKey, pz: textureKey, nz: textureKey },
      },
      {
        bounds: [0, 0, 7 / 16, 1, 1, 9 / 16],
        faces: { px: textureKey, nx: textureKey, py: topTextureKey, ny: topTextureKey, pz: textureKey, nz: textureKey },
      },
    ],
  };
}

function makeTrapdoorShape(textureKey, half = "bottom") {
  const minY = half === "top" ? 13 / 16 : 0;
  const maxY = half === "top" ? 1 : 3 / 16;
  return {
    collision: [{ minX: 0, minY, minZ: 0, maxX: 1, maxY, maxZ: 1 }],
    boxes: [
      {
        bounds: [0, minY, 0, 1, maxY, 1],
        faces: uniformFaces(textureKey),
      },
    ],
  };
}

function makeOpenTrapdoorShape(textureKey, side = "south") {
  const boundsBySide = {
    north: [0, 0, 0, 1, 1, 3 / 16],
    south: [0, 0, 13 / 16, 1, 1, 1],
    west: [0, 0, 0, 3 / 16, 1, 1],
    east: [13 / 16, 0, 0, 1, 1, 1],
  };
  const bounds = boundsBySide[side] ?? boundsBySide.south;
  return {
    collision: [{ minX: bounds[0], minY: bounds[1], minZ: bounds[2], maxX: bounds[3], maxY: bounds[4], maxZ: bounds[5] }],
    boxes: [
      {
        bounds,
        faces: uniformFaces(textureKey),
      },
    ],
  };
}

function makeDoorShape(lowerTexture, upperTexture, isUpper) {
  const textureKey = isUpper ? upperTexture : lowerTexture;
  return {
    collision: [{ minX: 0, minY: 0, minZ: 0, maxX: 3 / 16, maxY: 1, maxZ: 1 }],
    boxes: [
      {
        bounds: [0, 0, 0, 3 / 16, 1, 1],
        faces: uniformFaces(textureKey),
      },
    ],
  };
}

function makeOpenDoorShape(lowerTexture, upperTexture, isUpper) {
  const textureKey = isUpper ? upperTexture : lowerTexture;
  return {
    collision: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 3 / 16 }],
    boxes: [
      {
        bounds: [0, 0, 0, 1, 1, 3 / 16],
        faces: uniformFaces(textureKey),
      },
    ],
  };
}

const DOOR_VARIANTS = ["wood", "spruce", "birch", "jungle", "acacia", "dark_oak", "iron"];

const SHAPES_BY_ID = new Map();

SHAPES_BY_ID.set("anvil", ANVIL_SHAPE);
SHAPES_BY_ID.set("iron_bars", makeBarsShape("iron_bars"));
SHAPES_BY_ID.set("glass_pane", makeBarsShape("glass", "glass_pane_top"));
SHAPES_BY_ID.set("trapdoor", makeTrapdoorShape("trapdoor", "bottom"));
SHAPES_BY_ID.set("trapdoor_open", makeOpenTrapdoorShape("trapdoor", "south"));
SHAPES_BY_ID.set("iron_trapdoor", makeTrapdoorShape("iron_trapdoor", "bottom"));
SHAPES_BY_ID.set("iron_trapdoor_open", makeOpenTrapdoorShape("iron_trapdoor", "south"));

for (const variant of DOOR_VARIANTS) {
  const lower = `door_${variant}_lower`;
  const upper = `door_${variant}_upper`;
  SHAPES_BY_ID.set(`door_${variant}`, makeDoorShape(lower, upper, false));
  SHAPES_BY_ID.set(`door_${variant}_upper`, makeDoorShape(lower, upper, true));
  SHAPES_BY_ID.set(`door_${variant}_open`, makeOpenDoorShape(lower, upper, false));
  SHAPES_BY_ID.set(`door_${variant}_open_upper`, makeOpenDoorShape(lower, upper, true));
}

const FLOOR_TORCH_SHAPE = {
  collision: [],
  selection: [{ minX: 7 / 16, minY: 0, minZ: 7 / 16, maxX: 9 / 16, maxY: 10 / 16, maxZ: 9 / 16 }],
  boxes: [
    {
      bounds: [7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16],
      faces: { py: TORCH_TOP_FACE, ny: TORCH_BOTTOM_FACE },
    },
    {
      bounds: [7 / 16, 0, 0, 9 / 16, 1, 1],
      faces: { px: TORCH_FACE, nx: TORCH_FACE },
    },
    {
      bounds: [0, 0, 7 / 16, 1, 1, 9 / 16],
      faces: { pz: TORCH_FACE, nz: TORCH_FACE },
    },
  ],
};

SHAPES_BY_ID.set("torch_on", FLOOR_TORCH_SHAPE);

// Wall torch shapes: one per facing direction.
// The torch is attached to the wall face and protrudes into the open air.
// Facing = the direction the wall is in (relative to the torch block position).
const WALL_TORCH_ELEMENTS = Object.freeze([
  {
    from: [-1, 3.5, 7],
    to: [1, 13.5, 9],
    rotation: { origin: [0, 3.5, 8], axis: "z", angle: -22.5 },
    faces: { ny: TORCH_BOTTOM_FACE, py: TORCH_TOP_FACE },
  },
  {
    from: [-1, 3.5, 0],
    to: [1, 19.5, 16],
    rotation: { origin: [0, 3.5, 8], axis: "z", angle: -22.5 },
    faces: { nx: TORCH_FACE, px: TORCH_FACE },
  },
  {
    from: [-8, 3.5, 7],
    to: [8, 19.5, 9],
    rotation: { origin: [0, 3.5, 8], axis: "z", angle: -22.5 },
    faces: { nz: TORCH_FACE, pz: TORCH_FACE },
  },
]);

const WALL_TORCH_FACING_ROTATION = {
  west: 0,
  east: 180,
  north: -90,
  south: 90,
};

const WALL_TORCH_SELECTION_BY_FACING = Object.freeze({
  north: [{ minX: 0.35, minY: 0.2, minZ: 0, maxX: 0.65, maxY: 0.8, maxZ: 0.625 }],
  south: [{ minX: 0.35, minY: 0.2, minZ: 0.375, maxX: 0.65, maxY: 0.8, maxZ: 1 }],
  east: [{ minX: 0.375, minY: 0.2, minZ: 0.35, maxX: 1, maxY: 0.8, maxZ: 0.65 }],
  west: [{ minX: 0, minY: 0.2, minZ: 0.35, maxX: 0.625, maxY: 0.8, maxZ: 0.65 }],
});

for (const [facing, rotation] of Object.entries(WALL_TORCH_FACING_ROTATION)) {
  const quads = makeModelElementQuads(WALL_TORCH_ELEMENTS, rotation);
  SHAPES_BY_ID.set(`torch_on_wall_${facing}`, {
    collision: [],
    selection: WALL_TORCH_SELECTION_BY_FACING[facing] ?? makeSelectionFromQuads(quads),
    boxes: [],
    quads,
  });
}

function getTrapdoorStateShapeById(id) {
  const match = /^(iron_trapdoor|trapdoor)(?:_(top|bottom)_(north|south|east|west)(?:_(open))?)?$/.exec(id ?? "");
  if (!match) return null;
  const [, textureKey, half = "bottom", side = "south", open] = match;
  return open ? makeOpenTrapdoorShape(textureKey, side) : makeTrapdoorShape(textureKey, half);
}

export function getBlockShapeById(id) {
  if (!id) return null;
  return SHAPES_BY_ID.get(id) ?? getTrapdoorStateShapeById(id);
}

export function isCustomShapeId(id) {
  return SHAPES_BY_ID.has(id) || Boolean(getTrapdoorStateShapeById(id));
}

export const FALLING_BLOCK_IDS = new Set(["anvil"]);

export const ANVIL_MENU_BLOCK_IDS = new Set(["anvil"]);

export const TRAPDOOR_TOGGLE = new Map([
  ["trapdoor", "trapdoor_open"],
  ["trapdoor_open", "trapdoor"],
  ["iron_trapdoor", "iron_trapdoor_open"],
  ["iron_trapdoor_open", "iron_trapdoor"],
]);

export const DOOR_OPEN_BY_CLOSED_ID = new Map();
export const DOOR_CLOSED_BY_OPEN_ID = new Map();
export const DOOR_UPPER_BY_LOWER_ID = new Map();
export const DOOR_LOWER_BY_UPPER_ID = new Map();
for (const variant of DOOR_VARIANTS) {
  DOOR_OPEN_BY_CLOSED_ID.set(`door_${variant}`, `door_${variant}_open`);
  DOOR_OPEN_BY_CLOSED_ID.set(`door_${variant}_upper`, `door_${variant}_open_upper`);
  DOOR_CLOSED_BY_OPEN_ID.set(`door_${variant}_open`, `door_${variant}`);
  DOOR_CLOSED_BY_OPEN_ID.set(`door_${variant}_open_upper`, `door_${variant}_upper`);
  DOOR_UPPER_BY_LOWER_ID.set(`door_${variant}`, `door_${variant}_upper`);
  DOOR_UPPER_BY_LOWER_ID.set(`door_${variant}_open`, `door_${variant}_open_upper`);
  DOOR_LOWER_BY_UPPER_ID.set(`door_${variant}_upper`, `door_${variant}`);
  DOOR_LOWER_BY_UPPER_ID.set(`door_${variant}_open_upper`, `door_${variant}_open`);
}
