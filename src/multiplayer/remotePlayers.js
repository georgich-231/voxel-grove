import * as THREE from "three";
import { PLAYER_SKIN_URL } from "../entityTextures.js";

const REMOTE_PLAYER_HEIGHT_SCALE = 0.9;
const PLAYER_TEXTURE_SIZE = 64;
const NAME_CANVAS_WIDTH = 320;
const NAME_CANVAS_HEIGHT = 80;
const REMOTE_SWING_DURATION = 0.34;

let sharedSkinTexture = null;

export class RemotePlayerManager {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map();
  }

  upsertPlayer(state) {
    if (!state?.id) return;
    let player = this.players.get(state.id);
    if (!player) {
      player = new RemotePlayer(state);
      this.players.set(state.id, player);
      this.scene.add(player.group);
    }
    player.applyState(state);
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    player.dispose(this.scene);
    this.players.delete(id);
  }

  update(dt) {
    for (const player of this.players.values()) {
      player.update(dt);
    }
  }

  clear() {
    for (const player of this.players.values()) {
      player.dispose(this.scene);
    }
    this.players.clear();
  }
}

class RemotePlayer {
  constructor(state) {
    this.id = state.id;
    this.name = state.name ?? "Player";
    this.isOp = Boolean(state.isOp);
    this.group = new THREE.Group();
    this.group.name = `remote-player-${this.id}`;
    this.group.scale.setScalar(REMOTE_PLAYER_HEIGHT_SCALE);

    const model = createPlayerModel();
    this.model = model;
    this.group.add(model.root);

    this.label = createNameLabel(this.name, this.isOp);
    this.label.position.set(0, 2.26, 0);
    this.group.add(this.label);

    this.position = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.pitch = 0;
    this.targetPitch = 0;
    this.walkTime = 0;
    this.swingTime = REMOTE_SWING_DURATION;
    this.lastSwingId = 0;
    this.miningTime = 0;
    this.action = {
      mining: false,
      using: false,
      swinging: false,
      swingId: 0,
      miningProgress: 0,
    };
    this.hasPosition = false;
    this.lastUpdateAt = performance.now();
    this.applyState(state);
  }

  applyState(state) {
    if (!state) return;
    if (state.name && state.name !== this.name) {
      this.name = state.name;
      updateNameLabel(this.label, this.name, this.isOp);
    }
    if (typeof state.isOp === "boolean" && state.isOp !== this.isOp) {
      this.isOp = state.isOp;
      updateNameLabel(this.label, this.name, this.isOp);
    }

    this.targetPosition.set(
      state.position?.x ?? this.targetPosition.x,
      state.position?.y ?? this.targetPosition.y,
      state.position?.z ?? this.targetPosition.z,
    );
    this.velocity.set(
      state.velocity?.x ?? 0,
      state.velocity?.y ?? 0,
      state.velocity?.z ?? 0,
    );
    this.targetYaw = Number.isFinite(state.yaw) ? state.yaw : this.targetYaw;
    this.targetPitch = Number.isFinite(state.pitch) ? state.pitch : this.targetPitch;
    this.mode = state.mode ?? "survival";
    this.inWater = Boolean(state.inWater);
    const action = state.action ?? {};
    const swingId = Number.isFinite(action.swingId) ? action.swingId : this.lastSwingId;
    if (swingId !== this.lastSwingId) {
      this.lastSwingId = swingId;
      this.swingTime = 0;
    }
    this.action = {
      mining: Boolean(action.mining),
      using: Boolean(action.using),
      swinging: Boolean(action.swinging),
      swingId,
      miningProgress: Number.isFinite(action.miningProgress) ? action.miningProgress : 0,
    };
    this.lastUpdateAt = performance.now();

    if (!this.hasPosition) {
      this.position.copy(this.targetPosition);
      this.group.position.copy(this.position);
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
      this.hasPosition = true;
    }
  }

  update(dt) {
    const blend = 1 - Math.pow(0.001, Math.min(1, dt * 9));
    this.position.lerp(this.targetPosition, blend);
    this.group.position.copy(this.position);
    this.yaw = lerpAngle(this.yaw, this.targetYaw, blend);
    this.pitch += (this.targetPitch - this.pitch) * blend;
    this.group.rotation.y = this.yaw + Math.PI;
    this.model.head.rotation.x = this.pitch * 0.55;

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = horizontalSpeed > 0.08 && this.mode !== "spectator";
    if (moving) this.walkTime += dt * Math.min(8, 3 + horizontalSpeed * 1.2);
    const walkSwing = moving ? Math.sin(this.walkTime) * 0.55 : 0;
    this.swingTime = Math.min(REMOTE_SWING_DURATION, this.swingTime + dt);
    this.miningTime = this.action.mining ? this.miningTime + dt : 0;
    const swingProgress = 1 - clamp01(this.swingTime / REMOTE_SWING_DURATION);
    const punchArc = Math.sin(swingProgress * Math.PI);
    const miningArc = this.action.mining
      ? 0.72 + 0.28 * Math.sin(this.miningTime * 19)
      : 0;
    const useArc = this.action.using ? 0.42 : 0;
    const rightAction = Math.max(punchArc, miningArc, useArc);
    const rightArmX = walkSwing * 0.42 - rightAction * 1.28;
    const rightArmZ = rightAction * (this.action.mining ? 0.28 : 0.16);
    this.model.rightArm.rotation.set(rightArmX, 0, rightArmZ);
    this.model.leftArm.rotation.set(-walkSwing, 0, 0);
    this.model.rightLeg.rotation.set(-walkSwing, 0, 0);
    this.model.leftLeg.rotation.set(walkSwing, 0, 0);

    const staleSeconds = (performance.now() - this.lastUpdateAt) / 1000;
    this.group.visible = staleSeconds < 20;
    this.model.root.visible = this.mode !== "spectator";
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material?.userData?.disposeMapWithMaterial) object.material.map?.dispose();
      if (object.material && object.material !== getSharedSkinMaterial()) object.material.dispose?.();
    });
  }
}

function createPlayerModel() {
  const material = getSharedSkinMaterial();
  const root = new THREE.Group();

  const rightLeg = makeBodyPart([4, 12, 4], {
    right: { x: 0, y: 20, w: 4, h: 12 },
    front: { x: 4, y: 20, w: 4, h: 12 },
    left: { x: 8, y: 20, w: 4, h: 12 },
    back: { x: 12, y: 20, w: 4, h: 12 },
    top: { x: 4, y: 16, w: 4, h: 4 },
    bottom: { x: 8, y: 16, w: 4, h: 4 },
  }, material);
  rightLeg.position.set(-2 / 16, 6 / 16, 0);
  root.add(rightLeg);

  const leftLeg = makeBodyPart([4, 12, 4], {
    right: { x: 0, y: 20, w: 4, h: 12 },
    front: { x: 4, y: 20, w: 4, h: 12 },
    left: { x: 8, y: 20, w: 4, h: 12 },
    back: { x: 12, y: 20, w: 4, h: 12 },
    top: { x: 4, y: 16, w: 4, h: 4 },
    bottom: { x: 8, y: 16, w: 4, h: 4 },
  }, material);
  leftLeg.position.set(2 / 16, 6 / 16, 0);
  root.add(leftLeg);

  const body = makeBodyPart([8, 12, 4], {
    right: { x: 16, y: 20, w: 4, h: 12 },
    front: { x: 20, y: 20, w: 8, h: 12 },
    left: { x: 28, y: 20, w: 4, h: 12 },
    back: { x: 32, y: 20, w: 8, h: 12 },
    top: { x: 20, y: 16, w: 8, h: 4 },
    bottom: { x: 28, y: 16, w: 8, h: 4 },
  }, material);
  body.position.set(0, 18 / 16, 0);
  root.add(body);

  const rightArm = makeBodyPart([4, 12, 4], armFaces(), material);
  rightArm.position.set(-6 / 16, 18 / 16, 0);
  root.add(rightArm);

  const leftArm = makeBodyPart([4, 12, 4], armFaces(), material);
  leftArm.position.set(6 / 16, 18 / 16, 0);
  root.add(leftArm);

  const head = makeBodyPart([8, 8, 8], {
    right: { x: 0, y: 8, w: 8, h: 8 },
    front: { x: 8, y: 8, w: 8, h: 8 },
    left: { x: 16, y: 8, w: 8, h: 8 },
    back: { x: 24, y: 8, w: 8, h: 8 },
    top: { x: 8, y: 0, w: 8, h: 8 },
    bottom: { x: 16, y: 0, w: 8, h: 8 },
  }, material);
  head.position.set(0, 28 / 16, 0);
  root.add(head);

  return { root, head, body, rightArm, leftArm, rightLeg, leftLeg };
}

function armFaces() {
  return {
    right: { x: 40, y: 20, w: 4, h: 12 },
    front: { x: 44, y: 20, w: 4, h: 12 },
    left: { x: 48, y: 20, w: 4, h: 12 },
    back: { x: 52, y: 20, w: 4, h: 12 },
    top: { x: 44, y: 16, w: 4, h: 4 },
    bottom: { x: 48, y: 16, w: 4, h: 4 },
  };
}

function makeBodyPart(sizePx, faces, material) {
  const scale = 1 / 16;
  const geometry = new THREE.BoxGeometry(sizePx[0] * scale, sizePx[1] * scale, sizePx[2] * scale);
  setBoxUVs(geometry, faces, PLAYER_TEXTURE_SIZE, PLAYER_TEXTURE_SIZE);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

function getSharedSkinTexture() {
  if (sharedSkinTexture) return sharedSkinTexture;
  sharedSkinTexture = new THREE.TextureLoader().load(PLAYER_SKIN_URL);
  sharedSkinTexture.magFilter = THREE.NearestFilter;
  sharedSkinTexture.minFilter = THREE.NearestFilter;
  sharedSkinTexture.generateMipmaps = false;
  sharedSkinTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedSkinTexture;
}

let sharedSkinMaterial = null;

function getSharedSkinMaterial() {
  if (sharedSkinMaterial) return sharedSkinMaterial;
  sharedSkinMaterial = new THREE.MeshLambertMaterial({
    map: getSharedSkinTexture(),
    alphaTest: 0.08,
    side: THREE.FrontSide,
  });
  return sharedSkinMaterial;
}

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
    const offset = i * 8;
    uvs[offset + 0] = u0; uvs[offset + 1] = v1;
    uvs[offset + 2] = u1; uvs[offset + 3] = v1;
    uvs[offset + 4] = u0; uvs[offset + 5] = v0;
    uvs[offset + 6] = u1; uvs[offset + 7] = v0;
  }
  geometry.attributes.uv.needsUpdate = true;
}

function createNameLabel(name, isOp = false) {
  const canvas = document.createElement("canvas");
  canvas.width = NAME_CANVAS_WIDTH;
  canvas.height = NAME_CANVAS_HEIGHT;
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  material.userData.disposeMapWithMaterial = true;
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.95, 0.5, 1);
  sprite.renderOrder = 30;
  updateNameLabel(sprite, name, isOp);
  return sprite;
}

function updateNameLabel(sprite, name, isOp = false) {
  const texture = sprite.material.map;
  const canvas = texture.image;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const x = 18;
  const y = 14;
  const width = canvas.width - 36;
  const height = 50;
  const gradient = ctx.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, "rgba(18, 25, 22, 0.86)");
  gradient.addColorStop(1, "rgba(5, 8, 7, 0.74)");
  ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
  roundRect(ctx, x + 3, y + 5, width, height, 10);
  ctx.fill();
  ctx.fillStyle = gradient;
  roundRect(ctx, x, y, width, height, 10);
  ctx.fill();
  ctx.strokeStyle = isOp ? "rgba(255, 231, 126, 0.88)" : "rgba(157, 232, 122, 0.54)";
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, width - 2, height - 2, 9);
  ctx.stroke();
  if (isOp) {
    ctx.fillStyle = "rgba(255, 231, 126, 0.95)";
    roundRect(ctx, x + 12, y + 14, 36, 22, 5);
    ctx.fill();
    ctx.fillStyle = "#1b1404";
    ctx.font = "900 13px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("OP", x + 30, y + 25);
  }
  ctx.font = "800 25px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f8fbff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.86)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 2;
  const textOffset = isOp ? 21 : 0;
  ctx.fillText(name, canvas.width / 2 + textOffset, canvas.height / 2 + 1, width - (isOp ? 82 : 42));
  ctx.shadowColor = "transparent";
  texture.needsUpdate = true;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
