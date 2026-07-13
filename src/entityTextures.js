import steveTextureUrl from "./assets/entity/steve.png?url";
import chickenTextureUrl from "./assets/entity/chicken.png?url";
import cowTextureUrl from "./assets/entity/cow/cow.png?url";
import pigTextureUrl from "./assets/entity/pig/pig.png?url";

export const PLAYER_SKIN_URL = steveTextureUrl;
export const ENTITY_TEXTURE_URLS = Object.freeze({
  chicken: chickenTextureUrl,
  cow: cowTextureUrl,
  pig: pigTextureUrl,
});

// Procedural pixel-art entity textures laid out in the Minecraft 64x64 skin
// convention (or 64x32 for animals). Each texture is a 1024-bytes-ish canvas
// that the mob mesh maps onto its body cubes.

function createEntityCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function pseudoRandom(seed) {
  let state = seed | 0;
  return () => {
    state = Math.imul(state ^ (state >>> 13), 374761393) >>> 0;
    state = Math.imul(state ^ (state >>> 17), 1274126177) >>> 0;
    return ((state ^ (state >>> 16)) >>> 0) / 4294967295;
  };
}

// Tiny helper: paint a rectangle then sprinkle darker/lighter pixels for texture.
function speckle(ctx, x, y, w, h, base, dark, light, seed = 1) {
  fillRect(ctx, x, y, w, h, base);
  const rand = pseudoRandom(seed);
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const r = rand();
      if (r < 0.12) ctx.fillStyle = dark;
      else if (r < 0.22) ctx.fillStyle = light;
      else continue;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

// ─── Player (Steve-like 64x64 skin) ──────────────────────────────────────
//
// Layout follows the MC 1.8+ skin format. We only fill the regions actually
// used by our model (head, body, arms, legs — front/right faces).
export function createPlayerSkinCanvas() {
  const { canvas, ctx } = createEntityCanvas(64, 64);

  const skin = "#f9c9a0";
  const skinDark = "#d99c7a";
  const hair = "#3a2415";
  const hairDark = "#231408";
  const shirt = "#3aa3d1";
  const shirtDark = "#2a7daf";
  const pants = "#534aa3";
  const pantsDark = "#3a3478";
  const boots = "#42301c";
  const eyeWhite = "#ffffff";
  const eyeBlue = "#3669a3";
  const mouth = "#7a3b2c";

  // Head — top row of 64x64 layout: 8x8 squares around (8,8)..(24,16) area
  // Top (8..16, 0..8)
  speckle(ctx, 8, 0, 8, 8, hair, hairDark, "#52351f", 11);
  // Bottom (16..24, 0..8) - skin
  fillRect(ctx, 16, 0, 8, 8, skin);
  // Right (0..8, 8..16) - hair side
  speckle(ctx, 0, 8, 8, 8, hair, hairDark, "#52351f", 12);
  // Front (8..16, 8..16)
  fillRect(ctx, 8, 8, 8, 8, skin);
  // hair fringe at top of front face
  fillRect(ctx, 8, 8, 8, 2, hair);
  fillRect(ctx, 8, 9, 1, 1, hair);
  fillRect(ctx, 15, 9, 1, 1, hair);
  // eyes
  fillRect(ctx, 9, 12, 2, 2, eyeWhite);
  fillRect(ctx, 13, 12, 2, 2, eyeWhite);
  fillRect(ctx, 10, 12, 1, 2, eyeBlue);
  fillRect(ctx, 14, 12, 1, 2, eyeBlue);
  // mouth/beard
  fillRect(ctx, 10, 15, 4, 1, mouth);
  fillRect(ctx, 9, 14, 6, 1, "#a87257");
  // Left (16..24, 8..16) - hair side
  speckle(ctx, 16, 8, 8, 8, hair, hairDark, "#52351f", 13);
  // Back (24..32, 8..16)
  speckle(ctx, 24, 8, 8, 8, hair, hairDark, "#52351f", 14);

  // Body — front face (20..28, 20..32) 8w x 12h
  // Top (20..28, 16..20)
  fillRect(ctx, 20, 16, 8, 4, shirt);
  // Bottom (28..36, 16..20)
  fillRect(ctx, 28, 16, 8, 4, shirt);
  // Right (16..20, 20..32) sleeve
  speckle(ctx, 16, 20, 4, 12, shirtDark, "#1d5a82", "#52b0d8", 21);
  // Front (20..28, 20..32)
  speckle(ctx, 20, 20, 8, 12, shirt, shirtDark, "#52b0d8", 22);
  // belt
  fillRect(ctx, 20, 30, 8, 2, "#5a4a30");
  // Left (28..32, 20..32)
  speckle(ctx, 28, 20, 4, 12, shirtDark, "#1d5a82", "#52b0d8", 23);
  // Back (32..40, 20..32)
  speckle(ctx, 32, 20, 8, 12, shirt, shirtDark, "#52b0d8", 24);

  // Right arm — front (44..48, 20..32) 4w x 12h
  // Top (44..48, 16..20)
  fillRect(ctx, 44, 16, 4, 4, shirt);
  // Bottom (48..52, 16..20)
  fillRect(ctx, 48, 16, 4, 4, skin);
  // Right (40..44, 20..32)
  speckle(ctx, 40, 20, 4, 12, shirtDark, "#1d5a82", "#52b0d8", 31);
  // Front sleeve + hand
  speckle(ctx, 44, 20, 4, 8, shirt, shirtDark, "#52b0d8", 32);
  fillRect(ctx, 44, 28, 4, 4, skin);
  // Left (48..52, 20..32)
  speckle(ctx, 48, 20, 4, 12, shirtDark, "#1d5a82", "#52b0d8", 33);
  // Back (52..56, 20..32)
  speckle(ctx, 52, 20, 4, 8, shirt, shirtDark, "#52b0d8", 34);
  fillRect(ctx, 52, 28, 4, 4, skin);

  // Right leg — Top (4..8, 16..20)
  fillRect(ctx, 4, 16, 4, 4, pants);
  // Bottom (8..12, 16..20)
  fillRect(ctx, 8, 16, 4, 4, boots);
  // Right (0..4, 20..32)
  speckle(ctx, 0, 20, 4, 12, pantsDark, "#27225a", "#6b62c2", 41);
  // Front
  speckle(ctx, 4, 20, 4, 9, pants, pantsDark, "#6b62c2", 42);
  fillRect(ctx, 4, 29, 4, 3, boots);
  // Left
  speckle(ctx, 8, 20, 4, 9, pantsDark, "#27225a", "#6b62c2", 43);
  fillRect(ctx, 8, 29, 4, 3, "#2a1e10");
  // Back
  speckle(ctx, 12, 20, 4, 9, pants, pantsDark, "#6b62c2", 44);
  fillRect(ctx, 12, 29, 4, 3, boots);

  // Left arm/leg mirror in 1.8 layout — mirror right arm to (32..40)... but we
  // skip since model uses single texture.

  return canvas;
}

// ─── Chicken (64x32 layout) ──────────────────────────────────────────────
// Body 6x4x3, head 4x3x3, beak 2x2x2, wattle 2x1x2, legs 1x3x1 (×2), wings 1x4x3 (×2)
export function createChickenCanvas() {
  const { canvas, ctx } = createEntityCanvas(64, 32);
  fillRect(ctx, 0, 0, 64, 32, "rgba(0,0,0,0)");

  const feather = "#f5f5f5";
  const featherDim = "#d8d6c8";
  const featherShadow = "#a8a698";
  const beak = "#fbc02d";
  const beakDark = "#c79420";
  const wattle = "#d52d2d";
  const eyeBlack = "#1a1a1a";
  const eyeWhite = "#fff8e1";
  const leg = "#fbc02d";

  // Head (4x6 wide region in MC chicken layout) — at (0,0)..(20,9)
  // The chicken model has head at uv (0,0), body cubes spread further.
  // We draw simple monochrome white blocks plus beak/wattle/eye accents.
  // Head top
  speckle(ctx, 4, 0, 3, 3, feather, featherShadow, featherDim, 51);
  // Head front
  speckle(ctx, 4, 3, 3, 3, feather, featherShadow, featherDim, 52);
  // eyes
  fillRect(ctx, 4, 4, 1, 1, eyeBlack);
  fillRect(ctx, 6, 4, 1, 1, eyeBlack);
  // Head sides
  speckle(ctx, 0, 3, 4, 3, feather, featherShadow, featherDim, 53);
  speckle(ctx, 7, 3, 4, 3, feather, featherShadow, featherDim, 54);
  // Head bottom (wattle area)
  fillRect(ctx, 7, 0, 3, 3, feather);
  // Head back
  speckle(ctx, 11, 3, 3, 3, feather, featherShadow, featherDim, 55);

  // Beak
  fillRect(ctx, 14, 0, 2, 2, beak);
  fillRect(ctx, 16, 0, 2, 2, beakDark);
  fillRect(ctx, 14, 2, 4, 2, beak);

  // Wattle
  fillRect(ctx, 18, 0, 2, 1, wattle);
  fillRect(ctx, 18, 1, 2, 2, "#a82323");

  // Body — at (0,9)..(28,20)
  // Body top
  speckle(ctx, 4, 9, 6, 3, feather, featherShadow, featherDim, 61);
  // Body bottom
  speckle(ctx, 10, 9, 6, 3, feather, featherShadow, featherDim, 62);
  // Body sides
  speckle(ctx, 0, 12, 4, 8, feather, featherShadow, featherDim, 63);
  speckle(ctx, 4, 12, 6, 8, feather, featherShadow, featherDim, 64);
  speckle(ctx, 10, 12, 4, 8, feather, featherShadow, featherDim, 65);
  speckle(ctx, 14, 12, 6, 8, feather, featherShadow, featherDim, 66);

  // Wings — at (24,13)..(32,19)
  speckle(ctx, 24, 13, 4, 3, featherDim, featherShadow, feather, 71);
  fillRect(ctx, 24, 16, 4, 4, featherShadow);

  // Legs — at (26,1)..(34,9). Use thin vertical strips for the leg cube faces.
  fillRect(ctx, 26, 1, 1, 5, leg);
  fillRect(ctx, 27, 1, 1, 5, "#c89a25");
  fillRect(ctx, 28, 1, 1, 5, leg);
  fillRect(ctx, 26, 6, 3, 2, "#a87a18");

  return canvas;
}

// ─── Pig (64x32) ─────────────────────────────────────────────────────────
export function createPigCanvas() {
  const { canvas, ctx } = createEntityCanvas(64, 32);
  fillRect(ctx, 0, 0, 64, 32, "rgba(0,0,0,0)");

  const pink = "#f0a7a0";
  const pinkDark = "#c97c75";
  const pinkLight = "#f8c2bc";
  const snout = "#cd6f68";
  const eyeBlack = "#1a1a1a";
  const eyeWhite = "#fff5f0";
  const hoof = "#3d2218";

  // Head: 8x8x8 at (0,0)..(32,16)
  // Top
  speckle(ctx, 8, 0, 8, 8, pink, pinkDark, pinkLight, 81);
  // Bottom
  fillRect(ctx, 16, 0, 8, 8, "#9c5a55");
  // Right
  speckle(ctx, 0, 8, 8, 8, pink, pinkDark, pinkLight, 82);
  // Front
  speckle(ctx, 8, 8, 8, 8, pink, pinkDark, pinkLight, 83);
  // eyes
  fillRect(ctx, 10, 11, 2, 2, eyeWhite);
  fillRect(ctx, 14, 11, 2, 2, eyeWhite);
  fillRect(ctx, 10, 12, 1, 1, eyeBlack);
  fillRect(ctx, 15, 12, 1, 1, eyeBlack);
  // snout
  fillRect(ctx, 11, 14, 4, 2, snout);
  fillRect(ctx, 12, 14, 1, 1, eyeBlack);
  fillRect(ctx, 13, 14, 1, 1, eyeBlack);
  // Left
  speckle(ctx, 16, 8, 8, 8, pink, pinkDark, pinkLight, 84);
  // Back
  speckle(ctx, 24, 8, 8, 8, pink, pinkDark, pinkLight, 85);

  // Body: 10x16x8 at (28,8)..(56,24)
  // Top
  speckle(ctx, 28, 8, 10, 8, pink, pinkDark, pinkLight, 91);
  // Bottom
  speckle(ctx, 38, 8, 10, 8, pink, pinkDark, pinkLight, 92);
  // Sides
  speckle(ctx, 28, 16, 8, 8, pink, pinkDark, pinkLight, 93);
  speckle(ctx, 36, 16, 10, 8, pink, pinkDark, pinkLight, 94);
  speckle(ctx, 46, 16, 8, 8, pink, pinkDark, pinkLight, 95);
  speckle(ctx, 54, 16, 10, 8, pink, pinkDark, pinkLight, 96);

  // Legs: 4x6x4 — at (0,16)..(16,32)
  // Top
  fillRect(ctx, 4, 16, 4, 4, pink);
  // Bottom (hoof color from below)
  fillRect(ctx, 8, 16, 4, 4, hoof);
  // Sides + front + back
  speckle(ctx, 0, 20, 4, 6, pink, pinkDark, pinkLight, 101);
  speckle(ctx, 4, 20, 4, 5, pink, pinkDark, pinkLight, 102);
  fillRect(ctx, 4, 25, 4, 1, hoof);
  speckle(ctx, 8, 20, 4, 6, pink, pinkDark, pinkLight, 103);
  speckle(ctx, 12, 20, 4, 5, pink, pinkDark, pinkLight, 104);
  fillRect(ctx, 12, 25, 4, 1, hoof);

  return canvas;
}

// ─── Cow (64x32) ─────────────────────────────────────────────────────────
export function createCowCanvas() {
  const { canvas, ctx } = createEntityCanvas(64, 32);
  fillRect(ctx, 0, 0, 64, 32, "rgba(0,0,0,0)");

  const brown = "#4f3225";
  const brownDark = "#372319";
  const brownLight = "#6e4a30";
  const white = "#dcd5c5";
  const whiteDim = "#b8b1a3";
  const muzzle = "#cdb8a0";
  const horn = "#cfc6a8";
  const hoof = "#1a1208";
  const eyeBlack = "#0a0a0a";
  const eyeWhite = "#fff7e0";

  // Head (8x8x6) at (0,0)..(28,14)
  speckle(ctx, 6, 0, 8, 6, brown, brownDark, brownLight, 121);
  speckle(ctx, 14, 0, 8, 6, brown, brownDark, brownLight, 122);
  speckle(ctx, 0, 6, 6, 8, brown, brownDark, brownLight, 123);
  // Front face
  speckle(ctx, 6, 6, 8, 8, brown, brownDark, brownLight, 124);
  // muzzle area
  fillRect(ctx, 8, 11, 4, 3, muzzle);
  fillRect(ctx, 9, 12, 1, 1, eyeBlack);
  fillRect(ctx, 11, 12, 1, 1, eyeBlack);
  // eyes
  fillRect(ctx, 7, 8, 2, 2, eyeWhite);
  fillRect(ctx, 11, 8, 2, 2, eyeWhite);
  fillRect(ctx, 8, 9, 1, 1, eyeBlack);
  fillRect(ctx, 12, 9, 1, 1, eyeBlack);
  // horns
  fillRect(ctx, 6, 5, 1, 1, horn);
  fillRect(ctx, 13, 5, 1, 1, horn);
  speckle(ctx, 14, 6, 6, 8, brown, brownDark, brownLight, 125);
  speckle(ctx, 20, 6, 8, 8, brown, brownDark, brownLight, 126);

  // Body (10x12x8) at (18,16)..(58,32)
  // Body painted with brown/white patches to mimic Holstein cow.
  speckle(ctx, 18, 16, 12, 4, brown, brownDark, brownLight, 131);
  speckle(ctx, 30, 16, 12, 4, brown, brownDark, brownLight, 132);
  // Side patches
  speckle(ctx, 18, 20, 8, 12, brown, brownDark, brownLight, 133);
  // White patch
  fillRect(ctx, 19, 22, 3, 3, white);
  fillRect(ctx, 22, 24, 2, 2, whiteDim);
  speckle(ctx, 26, 20, 12, 12, brown, brownDark, brownLight, 134);
  fillRect(ctx, 28, 23, 4, 3, white);
  fillRect(ctx, 32, 25, 3, 2, whiteDim);
  speckle(ctx, 38, 20, 8, 12, brown, brownDark, brownLight, 135);
  fillRect(ctx, 39, 22, 3, 4, white);
  speckle(ctx, 46, 20, 12, 12, brown, brownDark, brownLight, 136);
  fillRect(ctx, 48, 23, 4, 3, white);
  fillRect(ctx, 52, 25, 3, 2, whiteDim);

  // Legs (4x12x4) at (0,16)..(16,32)
  fillRect(ctx, 4, 16, 4, 4, brown);
  fillRect(ctx, 8, 16, 4, 4, hoof);
  speckle(ctx, 0, 20, 4, 11, brown, brownDark, brownLight, 141);
  fillRect(ctx, 0, 30, 4, 1, hoof);
  speckle(ctx, 4, 20, 4, 11, brown, brownDark, brownLight, 142);
  fillRect(ctx, 4, 30, 4, 1, hoof);
  speckle(ctx, 8, 20, 4, 11, brown, brownDark, brownLight, 143);
  fillRect(ctx, 8, 30, 4, 1, hoof);
  speckle(ctx, 12, 20, 4, 11, brown, brownDark, brownLight, 144);
  fillRect(ctx, 12, 30, 4, 1, hoof);

  return canvas;
}
