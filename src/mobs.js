import * as THREE from "three";
import { ENTITY_TEXTURE_URLS } from "./entityTextures.js";

const SKIN_TEXTURE_CACHE = new Map();
const ENTITY_TEXTURE_LOADER = new THREE.TextureLoader();

function getEntityTexture(name) {
  let texture = SKIN_TEXTURE_CACHE.get(name);
  if (texture) return texture;
  const url = ENTITY_TEXTURE_URLS[name];
  if (!url) throw new Error(`Unknown entity texture ${name}`);
  texture = ENTITY_TEXTURE_LOADER.load(url);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  SKIN_TEXTURE_CACHE.set(name, texture);
  return texture;
}

function getEntityMaterial(name) {
  return new THREE.MeshLambertMaterial({
    map: getEntityTexture(name),
    transparent: true,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
}

function randomLootCount(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Three.js BoxGeometry UV mapping order:
// face 0 = +X (right), 1 = -X (left), 2 = +Y (top), 3 = -Y (bottom),
// 4 = +Z (front), 5 = -Z (back)
function setBoxUVs(geometry, faces, texW, texH) {
  const uvs = geometry.attributes.uv.array;
  const order = ["right", "left", "top", "bottom", "front", "back"];
  for (let i = 0; i < 6; i += 1) {
    const face = faces[order[i]];
    if (!face) continue;
    const u0 = face.x / texW;
    const v0 = 1 - (face.y + face.h) / texH;
    const u1 = (face.x + face.w) / texW;
    const v1 = 1 - face.y / texH;
    const flipY = face.flipY ?? false;
    const flipX = face.flipX ?? false;
    const offset = i * 8;
    // BoxGeometry winding: top-left, top-right, bottom-left, bottom-right.
    // Texture v decreases downward in Three uvs (v=1 at top), so we map
    // top-left of skin region to (u0, v1).
    let tl = [u0, v1];
    let tr = [u1, v1];
    let bl = [u0, v0];
    let br = [u1, v0];
    if (flipX) { [tl, tr] = [tr, tl]; [bl, br] = [br, bl]; }
    if (flipY) { [tl, bl] = [bl, tl]; [tr, br] = [br, tr]; }
    uvs[offset + 0] = tl[0]; uvs[offset + 1] = tl[1];
    uvs[offset + 2] = tr[0]; uvs[offset + 3] = tr[1];
    uvs[offset + 4] = bl[0]; uvs[offset + 5] = bl[1];
    uvs[offset + 6] = br[0]; uvs[offset + 7] = br[1];
  }
  geometry.attributes.uv.needsUpdate = true;
}

function cubeFaces(x, y, w, h, d) {
  return {
    right: { x, y: y + d, w: d, h },
    front: { x: x + d, y: y + d, w, h },
    left: { x: x + d + w, y: y + d, w: d, h },
    back: { x: x + d + w + d, y: y + d, w, h },
    top: { x: x + d, y, w, h: d },
    bottom: { x: x + d + w, y, w, h: d },
  };
}

function rotatedBodyFaces(x, y, w, h, d) {
  const faces = cubeFaces(x, y, w, h, d);
  return {
    right: faces.right,
    left: faces.left,
    top: faces.front,
    bottom: faces.back,
    front: faces.bottom,
    back: faces.top,
  };
}

// Build a Three mesh from a box (size in MC pixels at 1/16 scale).
function makeCube(sizePx, faces, texW, texH, material) {
  const [w, h, d] = sizePx;
  const scale = 1 / 16;
  const geometry = new THREE.BoxGeometry(w * scale, h * scale, d * scale);
  setBoxUVs(geometry, faces, texW, texH);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

// ─── Chicken model ───────────────────────────────────────────────────────
// Body 6x4x3 lying on side. Head 4x3x3 on top. Legs 1x3x1. Wings 1x4x3.
function buildChicken() {
  const tex = { w: 64, h: 32 };
  const mat = getEntityMaterial("chicken");

  const root = new THREE.Group();

  const body = makeCube([6, 8, 6], rotatedBodyFaces(0, 9, 6, 8, 6), tex.w, tex.h, mat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 8 / 16;
  root.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 11 / 16, 4 / 16);
  root.add(headPivot);
  const head = makeCube([4, 6, 3], cubeFaces(0, 0, 4, 6, 3), tex.w, tex.h, mat);
  head.position.y = 1 / 16;
  headPivot.add(head);

  const beak = makeCube([4, 2, 2], cubeFaces(14, 0, 4, 2, 2), tex.w, tex.h, mat);
  beak.position.set(0, 0, 3.5 / 16);
  headPivot.add(beak);

  const wattle = makeCube([2, 2, 2], cubeFaces(14, 4, 2, 2, 2), tex.w, tex.h, mat);
  wattle.position.set(0, -2 / 16, 2.5 / 16);
  headPivot.add(wattle);

  // Wings on either side of body
  const leftWing = makeCube([1, 4, 6], cubeFaces(24, 13, 1, 4, 6), tex.w, tex.h, mat);
  leftWing.position.set(4 / 16, 9 / 16, 0);
  root.add(leftWing);

  const rightWing = makeCube([1, 4, 6], cubeFaces(24, 13, 1, 4, 6), tex.w, tex.h, mat);
  rightWing.position.set(-4 / 16, 9 / 16, 0);
  root.add(rightWing);

  // Minecraft ChickenModel uses 3x5x3 legs; the previous one-pixel sticks made
  // chickens look detached and physically broken.
  const legUVFaces = cubeFaces(26, 0, 3, 5, 3);
  const leftLeg = makeCube([3, 5, 3], legUVFaces, tex.w, tex.h, mat);
  leftLeg.position.set(2 / 16, 2.5 / 16, 1 / 16);
  root.add(leftLeg);

  const rightLeg = makeCube([3, 5, 3], legUVFaces, tex.w, tex.h, mat);
  rightLeg.position.set(-2 / 16, 2.5 / 16, 1 / 16);
  root.add(rightLeg);

  root.scale.setScalar(0.75);

  return {
    root,
    parts: { body, head: headPivot, leftWing, rightWing, leftLeg, rightLeg },
    height: 0.7,
  };
}

// ─── Pig model ───────────────────────────────────────────────────────────
// Head 8x8x8, body 10x16x8 horizontal, legs 4x6x4 (×4)
function buildPig() {
  const tex = { w: 64, h: 32 };
  const mat = getEntityMaterial("pig");
  const root = new THREE.Group();

  const body = makeCube([10, 16, 8], rotatedBodyFaces(28, 8, 10, 16, 8), tex.w, tex.h, mat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 10 / 16;
  root.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 12 / 16, 8 / 16);
  root.add(headPivot);
  const head = makeCube([8, 8, 8], {
    top: { x: 8, y: 0, w: 8, h: 8 },
    bottom: { x: 16, y: 0, w: 8, h: 8 },
    front: { x: 8, y: 8, w: 8, h: 8 },
    back: { x: 24, y: 8, w: 8, h: 8 },
    left: { x: 16, y: 8, w: 8, h: 8 },
    right: { x: 0, y: 8, w: 8, h: 8 },
  }, tex.w, tex.h, mat);
  head.position.set(0, 0, 4 / 16);
  headPivot.add(head);

  const snout = makeCube([4, 3, 1], {
    right: { x: 10, y: 14, w: 1, h: 2 },
    left: { x: 14, y: 14, w: 1, h: 2 },
    top: { x: 11, y: 13, w: 4, h: 1 },
    bottom: { x: 11, y: 15, w: 4, h: 1 },
    front: { x: 11, y: 14, w: 4, h: 2 },
    back: { x: 11, y: 13, w: 4, h: 2 },
  }, tex.w, tex.h, mat);
  snout.position.set(0, -1.5 / 16, 8.5 / 16);
  headPivot.add(snout);

  const legUV = {
    top: { x: 4, y: 16, w: 4, h: 4 },
    bottom: { x: 8, y: 16, w: 4, h: 4 },
    front: { x: 4, y: 20, w: 4, h: 6 },
    back: { x: 12, y: 20, w: 4, h: 6 },
    left: { x: 8, y: 20, w: 4, h: 6 },
    right: { x: 0, y: 20, w: 4, h: 6 },
  };

  const legSize = [4, 6, 4];
  const legY = 3 / 16;
  const fl = makeCube(legSize, legUV, tex.w, tex.h, mat);
  fl.position.set(3 / 16, legY, 5 / 16);
  root.add(fl);
  const fr = makeCube(legSize, legUV, tex.w, tex.h, mat);
  fr.position.set(-3 / 16, legY, 5 / 16);
  root.add(fr);
  const bl = makeCube(legSize, legUV, tex.w, tex.h, mat);
  bl.position.set(3 / 16, legY, -5 / 16);
  root.add(bl);
  const br = makeCube(legSize, legUV, tex.w, tex.h, mat);
  br.position.set(-3 / 16, legY, -5 / 16);
  root.add(br);

  return {
    root,
    parts: { body, head: headPivot, snout, frontLeft: fl, frontRight: fr, backLeft: bl, backRight: br },
    height: 0.9,
  };
}

// ─── Cow model ───────────────────────────────────────────────────────────
// Head 8x8x6, body 12x10x8 horizontal, legs 4x12x4 (×4)
function buildCow() {
  const tex = { w: 64, h: 32 };
  const mat = getEntityMaterial("cow");
  const root = new THREE.Group();

  const body = makeCube([12, 18, 10], rotatedBodyFaces(18, 4, 12, 18, 10), tex.w, tex.h, mat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 17 / 16;
  root.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 19 / 16, 9 / 16);
  root.add(headPivot);
  const head = makeCube([8, 8, 6], {
    top: { x: 6, y: 0, w: 8, h: 6 },
    bottom: { x: 14, y: 0, w: 8, h: 6 },
    front: { x: 6, y: 6, w: 8, h: 8 },
    back: { x: 20, y: 6, w: 8, h: 8 },
    left: { x: 14, y: 6, w: 6, h: 8 },
    right: { x: 0, y: 6, w: 6, h: 8 },
  }, tex.w, tex.h, mat);
  head.position.set(0, 0, 3 / 16);
  headPivot.add(head);

  const hornFaces = cubeFaces(22, 0, 1, 3, 1);
  const leftHorn = makeCube([1, 3, 1], hornFaces, tex.w, tex.h, mat);
  leftHorn.position.set(4.5 / 16, 5.5 / 16, 2 / 16);
  headPivot.add(leftHorn);
  const rightHorn = makeCube([1, 3, 1], hornFaces, tex.w, tex.h, mat);
  rightHorn.position.set(-4.5 / 16, 5.5 / 16, 2 / 16);
  headPivot.add(rightHorn);

  const udder = makeCube([4, 6, 1], cubeFaces(52, 0, 4, 6, 1), tex.w, tex.h, mat);
  udder.position.set(0, 9 / 16, -5.5 / 16);
  root.add(udder);

  const legUV = {
    top: { x: 4, y: 16, w: 4, h: 4 },
    bottom: { x: 8, y: 16, w: 4, h: 4 },
    front: { x: 4, y: 20, w: 4, h: 12 },
    back: { x: 12, y: 20, w: 4, h: 12 },
    left: { x: 8, y: 20, w: 4, h: 12 },
    right: { x: 0, y: 20, w: 4, h: 12 },
  };
  const legSize = [4, 12, 4];
  const legY = 6 / 16;
  const fl = makeCube(legSize, legUV, tex.w, tex.h, mat);
  fl.position.set(3 / 16, legY, 6 / 16);
  root.add(fl);
  const fr = makeCube(legSize, legUV, tex.w, tex.h, mat);
  fr.position.set(-3 / 16, legY, 6 / 16);
  root.add(fr);
  const bl = makeCube(legSize, legUV, tex.w, tex.h, mat);
  bl.position.set(3 / 16, legY, -6 / 16);
  root.add(bl);
  const br = makeCube(legSize, legUV, tex.w, tex.h, mat);
  br.position.set(-3 / 16, legY, -6 / 16);
  root.add(br);

  return {
    root,
    parts: { body, head: headPivot, leftHorn, rightHorn, udder, frontLeft: fl, frontRight: fr, backLeft: bl, backRight: br },
    height: 1.4,
  };
}

// ─── Mob base class ──────────────────────────────────────────────────────
//
// AI loosely modelled on MC passive mobs:
//   - Pick a random horizontal goal direction every few seconds (wander).
//   - When recently hurt, "panic" — sprint in the opposite direction of the
//     last attacker for ~2 seconds (chickens flee on hit; pigs/cows in MC
//     also panic when damaged in 1.13+).
//   - Apply gravity each tick; collide against blocks.
//   - Hit by player: lose health, get knockback, run damage flash.
//   - On death: drop loot.

const HORIZONTAL_DRAG = 0.86;
const VERTICAL_DRAG = 0.98;
const MOB_GRAVITY = 24;
const MOB_STEP_HEIGHT = 0.62;
const MOB_EPSILON = 0.001;

class Mob {
  constructor(world, position, model) {
    this.world = world;
    this.model = model;
    this.root = model.root;
    this.parts = model.parts;
    this.height = model.height;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.targetYaw = this.yaw;
    this.onGround = false;
    this.inWater = false;
    this.health = 10;
    this.maxHealth = 10;
    this.hurtTimer = 0;
    this.deadTimer = 0;
    this.dead = false;
    this.removed = false;

    this.aiState = "idle";
    this.aiTimer = 0.5 + Math.random() * 1.2;
    this.moveDirection = new THREE.Vector3();
    this.walkSpeed = 0.6;
    this.panicSpeed = 1.4;
    this.panicTimer = 0;
    this.panicGoalTimer = 0;
    this.panicSource = null;
    this.jumpCooldown = 0;
    this.legPhase = Math.random() * Math.PI * 2;
    this.movedThisFrame = 0;

    // collision footprint as MC-style box (radius / height)
    this.radius = 0.3;
    this.eyeHeight = this.height * 0.85;

    this.materialCache = new Set();
    this.captureMaterials();
    this.applyTransform();
  }

  captureMaterials() {
    this.root.traverse((child) => {
      if (child.isMesh && child.material) this.materialCache.add(child.material);
    });
  }

  applyTransform() {
    this.root.position.set(this.position.x, this.position.y, this.position.z);
    this.root.rotation.y = this.yaw;
  }

  // ── AI ──
  update(dt, ctx) {
    if (this.removed) return false;
    if (this.dead) {
      this.deadTimer += dt;
      // Death animation: tip over + fade out
      const t = Math.min(1, this.deadTimer / 0.6);
      this.root.rotation.z = t * (Math.PI / 2);
      const opacity = 1 - t;
      for (const mat of this.materialCache) {
        mat.transparent = true;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
      if (this.deadTimer >= 0.65) this.removed = true;
      return !this.removed;
    }

    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.panicTimer = Math.max(0, this.panicTimer - dt);
    this.panicGoalTimer = Math.max(0, this.panicGoalTimer - dt);
    this.aiTimer -= dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    // Apply hit-flash tint
    const flashAmount = this.hurtTimer > 0 ? Math.min(1, this.hurtTimer / 0.25) : 0;
    for (const mat of this.materialCache) {
      mat.color = mat.color || new THREE.Color(0xffffff);
      mat.color.setRGB(1, 1 - flashAmount * 0.6, 1 - flashAmount * 0.6);
    }

    if (this.aiTimer <= 0) this.pickNewGoal(ctx);

    let moveStrength = 0;
    if (this.panicTimer > 0) {
      if (this.panicGoalTimer <= 0) {
        let awayAngle = Math.random() * Math.PI * 2;
        if (this.panicSource) {
          const dx = this.position.x - this.panicSource.x;
          const dz = this.position.z - this.panicSource.z;
          awayAngle = Math.atan2(dx, dz);
        }
        const scatter = (Math.random() - 0.5) * Math.PI * 0.35;
        const angle = awayAngle + scatter;
        this.moveDirection.set(Math.sin(angle), 0, Math.cos(angle));
        this.panicGoalTimer = 0.6 + Math.random() * 0.55;
      }
      this.targetYaw = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      moveStrength = this.panicSpeed;
    } else if (this.aiState === "wander") {
      this.targetYaw = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      moveStrength = this.walkSpeed;
    } else {
      moveStrength = 0;
    }

    // Smoothly turn toward target yaw.
    const yawDiff = wrapAngle(this.targetYaw - this.yaw);
    const turnRate = this.panicTimer > 0 ? 7 : 4;
    this.yaw += clampAbs(yawDiff, turnRate * dt);

    // Check water before applying motion.
    this.inWater = this.isInWater();

    // Translate desired motion into velocity.
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const desiredVx = forward.x * moveStrength;
    const desiredVz = forward.z * moveStrength;
    if (this.inWater) {
      this.velocity.x = lerp(this.velocity.x, desiredVx * 0.6, 0.18);
      this.velocity.z = lerp(this.velocity.z, desiredVz * 0.6, 0.18);
    } else {
      // Preserve the initial knockback while still letting panic navigation take
      // over immediately; previously mobs could appear frozen after being hit.
      const driveBlend = this.hurtTimer > 0 ? 0.08 : 0.32;
      this.velocity.x = lerp(this.velocity.x, desiredVx, driveBlend);
      this.velocity.z = lerp(this.velocity.z, desiredVz, driveBlend);
    }

    // Gravity.
    if (this.inWater) {
      this.velocity.y = Math.max(this.velocity.y - MOB_GRAVITY * dt * 0.18, -1.2);
      // Float at water surface
      if (this.velocity.y < 0 && this.atWaterSurface()) this.velocity.y = Math.max(this.velocity.y, 0.6);
    } else {
      this.velocity.y -= MOB_GRAVITY * dt;
    }

    // Apply per-tick drag.
    const ticks = dt * 20;
    this.velocity.x *= Math.pow(HORIZONTAL_DRAG, ticks);
    this.velocity.z *= Math.pow(HORIZONTAL_DRAG, ticks);
    this.velocity.y *= Math.pow(VERTICAL_DRAG, ticks);

    // Auto-jump if we hit a block while wandering.
    const beforeMoveY = this.position.y;
    const stuckHorizontal = this.moveCollide("x", this.velocity.x * dt) | this.moveCollide("z", this.velocity.z * dt);
    if (stuckHorizontal && this.onGround && this.jumpCooldown === 0 && moveStrength > 0) {
      this.velocity.y = 7.2;
      this.onGround = false;
      this.jumpCooldown = 0.4;
    }
    this.onGround = false;
    this.moveCollide("y", this.velocity.y * dt);
    this.movedThisFrame = Math.hypot(this.position.x - (this._lastX ?? this.position.x), this.position.z - (this._lastZ ?? this.position.z));
    this._lastX = this.position.x;
    this._lastZ = this.position.z;

    // Despawn out-of-world fall
    if (this.position.y < -8) this.removed = true;

    // Animate legs/wings.
    this._playerPos = ctx?.player?.position ?? null;
    this.updateAnimation(dt);
    this.applyTransform();
    return true;
  }

  pickNewGoal(ctx) {
    if (Math.random() < 0.22) {
      this.aiState = "idle";
      this.aiTimer = 1 + Math.random() * 2;
      this.moveDirection.set(0, 0, 0);
      return;
    }
    this.aiState = "wander";
    const angle = Math.random() * Math.PI * 2;
    this.moveDirection.set(Math.sin(angle), 0, Math.cos(angle));
    this.aiTimer = 1.5 + Math.random() * 3.5;
  }

  updateAnimation(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const swing = speed > 0.05 ? speed * 6 : 0;
    this.legPhase += dt * (swing > 0 ? swing : 1);
    const sway = Math.sin(this.legPhase) * Math.min(0.7, swing * 0.18);
    if (this.parts.frontLeft && this.parts.frontRight && this.parts.backLeft && this.parts.backRight) {
      this.parts.frontLeft.rotation.x = sway;
      this.parts.frontRight.rotation.x = -sway;
      this.parts.backLeft.rotation.x = -sway;
      this.parts.backRight.rotation.x = sway;
    } else if (this.parts.leftLeg && this.parts.rightLeg) {
      this.parts.leftLeg.rotation.x = sway;
      this.parts.rightLeg.rotation.x = -sway;
    }
    if (this.parts.leftWing && this.parts.rightWing) {
      const flapSpeed = this.onGround ? 1.5 : 18;
      const flapAmp = this.onGround ? 0.18 : 0.85;
      this.parts.leftWing.rotation.z = -Math.sin(this.legPhase * flapSpeed) * flapAmp;
      this.parts.rightWing.rotation.z = Math.sin(this.legPhase * flapSpeed) * flapAmp;
    }
    if (this.parts.head) {
      const idleBob = Math.sin(performance.now() * 0.002 + this.legPhase) * 0.06;
      if (this._playerPos) {
        const dx = this._playerPos.x - this.position.x;
        const dy = (this._playerPos.y + 1.6) - (this.position.y + this.eyeHeight);
        const dz = this._playerPos.z - this.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 8 && dist > 0.5) {
          const targetPitch = clampAbs(-Math.atan2(dy, dist), Math.PI / 4);
          const targetYaw = clampAbs(wrapAngle(Math.atan2(dx, dz) - this.yaw), Math.PI / 3);
          this.parts.head.rotation.x = lerp(this.parts.head.rotation.x, targetPitch, 0.1);
          this.parts.head.rotation.y = lerp(this.parts.head.rotation.y, targetYaw, 0.1);
        } else {
          this.parts.head.rotation.x = lerp(this.parts.head.rotation.x, idleBob, 0.05);
          this.parts.head.rotation.y = lerp(this.parts.head.rotation.y, 0, 0.05);
        }
      } else {
        this.parts.head.rotation.x = idleBob;
      }
    }
    // Reset death tilt when alive
    this.root.rotation.z = 0;
  }

  // ── Collision ──
  moveCollide(axis, amount) {
    if (!Number.isFinite(amount) || amount === 0) return false;
    const direction = Math.sign(amount);
    let remaining = Math.abs(amount);
    let blocked = false;
    while (remaining > 0) {
      const step = Math.min(0.1, remaining) * direction;
      const before = this.position[axis];
      this.position[axis] += step;
      if (this.collides()) {
        this.position[axis] = before;
        if (axis === "y") {
          if (direction < 0) this.onGround = true;
          this.velocity.y = 0;
        } else {
          this.velocity[axis] = 0;
          blocked = true;
        }
        return blocked;
      }
      remaining -= Math.abs(step);
    }
    return blocked;
  }

  collides() {
    const minX = this.position.x - this.radius + MOB_EPSILON;
    const maxX = this.position.x + this.radius - MOB_EPSILON;
    const minY = this.position.y + MOB_EPSILON;
    const maxY = this.position.y + this.height - MOB_EPSILON;
    const minZ = this.position.z - this.radius + MOB_EPSILON;
    const maxZ = this.position.z + this.radius - MOB_EPSILON;
    const ix0 = Math.floor(minX); const ix1 = Math.floor(maxX);
    const iy0 = Math.floor(minY); const iy1 = Math.floor(maxY);
    const iz0 = Math.floor(minZ); const iz1 = Math.floor(maxZ);
    for (let x = ix0; x <= ix1; x += 1) {
      for (let y = iy0; y <= iy1; y += 1) {
        for (let z = iz0; z <= iz1; z += 1) {
          if (this.world.isSolidBlock?.(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  isInWater() {
    return this.world.isWaterAt?.(
      this.position.x,
      this.position.y + this.height * 0.5,
      this.position.z,
    ) ?? false;
  }

  atWaterSurface() {
    return this.world.isWaterAt?.(this.position.x, this.position.y + this.height * 0.7, this.position.z) === false;
  }

  // ── Combat ──
  takeHit(damage, sourcePosition, knockback = 1) {
    if (this.dead || this.hurtTimer > 0) return;
    this.health -= damage;
    this.hurtTimer = 0.4;
    this.panicTimer = Math.max(this.panicTimer, 4 + Math.random() * 1.25);
    this.panicGoalTimer = 0.75;
    this.panicSource = sourcePosition ? sourcePosition.clone() : null;
    if (sourcePosition) {
      const dx = this.position.x - sourcePosition.x;
      const dz = this.position.z - sourcePosition.z;
      const len = Math.hypot(dx, dz) || 1;
      this.moveDirection.set(dx / len, 0, dz / len);
      this.targetYaw = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      this.velocity.x += (dx / len) * 4 * knockback;
      this.velocity.z += (dz / len) * 4 * knockback;
      this.velocity.y = Math.max(this.velocity.y, 4.4 * knockback);
    }
    if (this.health <= 0) {
      this.dead = true;
      this.deadTimer = 0;
      this.aiState = "dead";
      this.dropLoot();
    }
  }

  dropLoot() {
    // Override in subclass.
  }

  dispose() {
    this.root.traverse((child) => {
      if (child.isMesh) child.geometry?.dispose();
    });
    for (const mat of this.materialCache) mat.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function wrapAngle(a) {
  let result = a;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}
function clampAbs(value, max) {
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

// ─── Concrete species ────────────────────────────────────────────────────

export class Chicken extends Mob {
  constructor(world, position) {
    super(world, position, buildChicken());
    this.maxHealth = this.health = 4;
    this.radius = 0.2;
    this.eyeHeight = this.height * 0.85;
    this.walkSpeed = 0.5;
    this.panicSpeed = 3.2;
  }
  update(dt, ctx) {
    const result = super.update(dt, ctx);
    // Chickens fall slowly.
    if (this.velocity.y < 0 && !this.onGround && !this.inWater) {
      this.velocity.y *= 0.6;
    }
    return result;
  }
  dropLoot() {
    const drops = [];
    // Vanilla 1.8 counts without looting: 0-2 feathers, 1 raw chicken.
    const featherCount = randomLootCount(0, 2);
    if (featherCount > 0) drops.push({ id: "feather", count: featherCount });
    drops.push({ id: "raw_chicken", count: 1 });
    this._pendingDrops = drops;
  }
}

export class Pig extends Mob {
  constructor(world, position) {
    super(world, position, buildPig());
    this.maxHealth = this.health = 10;
    this.radius = 0.45;
    this.eyeHeight = this.height * 0.85;
    this.walkSpeed = 0.7;
    this.panicSpeed = 3.4;
  }
  dropLoot() {
    this._pendingDrops = [{ id: "raw_porkchop", count: randomLootCount(1, 3) }];
  }
}

export class Cow extends Mob {
  constructor(world, position) {
    super(world, position, buildCow());
    this.maxHealth = this.health = 10;
    this.radius = 0.45;
    this.eyeHeight = this.height * 0.85;
    this.walkSpeed = 0.6;
    this.panicSpeed = 3.2;
  }
  dropLoot() {
    const drops = [];
    // Vanilla 1.8 counts without looting: 0-2 leather, 1-3 raw beef.
    const leatherCount = randomLootCount(0, 2);
    if (leatherCount > 0) drops.push({ id: "leather", count: leatherCount });
    drops.push({ id: "raw_beef", count: randomLootCount(1, 3) });
    this._pendingDrops = drops;
  }
}

export const MOB_CLASSES = { chicken: Chicken, pig: Pig, cow: Cow };

// Approximate-AABB intersection used by raycasting from main.js.
export function rayIntersectsMob(mob, origin, direction, maxDistance) {
  const minX = mob.position.x - mob.radius;
  const maxX = mob.position.x + mob.radius;
  const minY = mob.position.y;
  const maxY = mob.position.y + mob.height;
  const minZ = mob.position.z - mob.radius;
  const maxZ = mob.position.z + mob.radius;

  const inv = { x: 1 / (direction.x || 1e-8), y: 1 / (direction.y || 1e-8), z: 1 / (direction.z || 1e-8) };
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const axis of ["x", "y", "z"]) {
    const lo = (axis === "x" ? minX : axis === "y" ? minY : minZ) - origin[axis];
    const hi = (axis === "x" ? maxX : axis === "y" ? maxY : maxZ) - origin[axis];
    let t1 = lo * inv[axis];
    let t2 = hi * inv[axis];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0) tmin = 0;
  if (tmin > maxDistance) return null;
  return tmin;
}
