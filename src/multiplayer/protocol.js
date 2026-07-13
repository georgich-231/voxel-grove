export const PROTOCOL_VERSION = 2;
export const DEFAULT_SERVER_PORT = 25565;
export const DEFAULT_MULTIPLAYER_URL = `ws://127.0.0.1:${DEFAULT_SERVER_PORT}`;
export const DEFAULT_PLAYER_NAME = "Player";
export const MAX_PLAYER_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 160;
export const MAX_COMMAND_LENGTH = 220;
export const MAX_BLOCK_CHANGE_HISTORY = 20000;
export const WORLD_MIN_XZ = -30000000;
export const WORLD_MAX_XZ = 30000000;
export const WORLD_MIN_Y = 0;
export const WORLD_MAX_Y = 255;
export const BLOCK_ID_MIN = 0;
export const BLOCK_ID_MAX = 65535;

export const MessageType = Object.freeze({
  JOIN: "join",
  WELCOME: "welcome",
  PLAYER_JOINED: "player_joined",
  PLAYER_LEFT: "player_left",
  PLAYER_STATE: "player_state",
  PLAYER_LIST: "player_list",
  BLOCK_CHANGE: "block_change",
  CHAT: "chat",
  COMMAND: "command",
  COMMAND_RESULT: "command_result",
  ADMIN_COMMAND: "admin_command",
  ERROR: "error",
});

export function encodeMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

export function parseMessage(raw) {
  const text = typeof raw === "string"
    ? raw
    : raw instanceof Uint8Array
      ? new TextDecoder().decode(raw)
      : String(raw ?? "");

  try {
    const message = JSON.parse(text);
    return isPlainObject(message) && typeof message.type === "string" ? message : null;
  } catch {
    return null;
  }
}

export function sanitizePlayerName(value, fallback = DEFAULT_PLAYER_NAME) {
  const raw = String(value ?? "").trim();
  const cleaned = raw
    .replace(/[^\w -]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_PLAYER_NAME_LENGTH)
    .trim();
  return cleaned || fallback;
}

export function sanitizeChatText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
}

export function sanitizeCommandText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\//, "")
    .trim()
    .slice(0, MAX_COMMAND_LENGTH);
}

export function normalizeServerUrl(value, fallback = DEFAULT_MULTIPLAYER_URL) {
  let text = String(value ?? "").trim();
  if (!text) text = fallback;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `ws://${text}`;

  try {
    const url = new URL(text);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function normalizeSeedText(value, fallback = "0") {
  const text = String(value ?? "").trim();
  const negative = text.startsWith("-");
  const digits = text.replace(/\D/g, "").slice(0, 19);
  if (!digits) return fallback;
  return `${negative ? "-" : ""}${digits}`;
}

export function createBlockKey(x, y, z) {
  return `${x},${y},${z}`;
}

export function parseBlockKey(key) {
  const [x, y, z] = String(key ?? "").split(",").map(Number);
  if (![x, y, z].every(Number.isInteger)) return null;
  return { x, y, z };
}

export function sanitizeBlockChange(change) {
  if (!isPlainObject(change)) return null;
  const x = sanitizeInteger(change.x, WORLD_MIN_XZ, WORLD_MAX_XZ, null);
  const y = sanitizeInteger(change.y, WORLD_MIN_Y, WORLD_MAX_Y, null);
  const z = sanitizeInteger(change.z, WORLD_MIN_XZ, WORLD_MAX_XZ, null);
  const block = sanitizeInteger(change.block, BLOCK_ID_MIN, BLOCK_ID_MAX, null);
  if (x === null || y === null || z === null || block === null) return null;

  const sanitized = {
    x,
    y,
    z,
    block,
    options: sanitizeBlockOptions(change.options),
  };

  if (typeof change.actorId === "string") sanitized.actorId = change.actorId.slice(0, 80);
  if (Number.isFinite(change.clientSeq)) sanitized.clientSeq = Math.max(0, Math.floor(change.clientSeq));
  if (Number.isFinite(change.serverSeq)) sanitized.serverSeq = Math.max(0, Math.floor(change.serverSeq));
  if (Number.isFinite(change.timestamp)) sanitized.timestamp = Math.max(0, Math.floor(change.timestamp));

  return sanitized;
}

export function sanitizeBlockOptions(options) {
  if (!isPlainObject(options)) return {};
  const sanitized = {};
  const waterLevel = sanitizeInteger(options.waterLevel, 0, 8, null);
  const lavaLevel = sanitizeInteger(options.lavaLevel, 0, 8, null);
  if (waterLevel !== null) sanitized.waterLevel = waterLevel;
  if (lavaLevel !== null) sanitized.lavaLevel = lavaLevel;
  if (typeof options.waterFalling === "boolean") sanitized.waterFalling = options.waterFalling;
  if (typeof options.lavaFalling === "boolean") sanitized.lavaFalling = options.lavaFalling;
  if (typeof options.falling === "boolean") sanitized.falling = options.falling;
  if (typeof options.isSource === "boolean") sanitized.isSource = options.isSource;
  return sanitized;
}

export function sanitizePlayerState(state) {
  if (!isPlainObject(state)) return null;
  const position = sanitizeVector3(state.position, {
    x: 0,
    y: 80,
    z: 0,
  });
  const velocity = sanitizeVector3(state.velocity, {
    x: 0,
    y: 0,
    z: 0,
  }, -128, 128);

  return {
    id: typeof state.id === "string" ? state.id.slice(0, 80) : null,
    name: sanitizePlayerName(state.name),
    position,
    velocity,
    yaw: sanitizeNumber(state.yaw, -Math.PI * 4, Math.PI * 4, 0),
    pitch: sanitizeNumber(state.pitch, -Math.PI / 2, Math.PI / 2, 0),
    mode: sanitizeGameMode(state.mode),
    onGround: Boolean(state.onGround),
    inWater: Boolean(state.inWater),
    heldItemId: sanitizeItemId(state.heldItemId),
    selectedHotbar: sanitizeInteger(state.selectedHotbar, 0, 8, 0),
    action: sanitizePlayerAction(state.action),
    updatedAt: Number.isFinite(state.updatedAt) ? Math.max(0, Math.floor(state.updatedAt)) : Date.now(),
  };
}

export function sanitizeJoinPayload(message) {
  if (!isPlainObject(message)) return null;
  return {
    protocolVersion: sanitizeInteger(message.protocolVersion, 1, 999, PROTOCOL_VERSION),
    name: sanitizePlayerName(message.name),
    state: sanitizePlayerState(message.state ?? {}),
  };
}

export function publicPlayerState(client) {
  const state = client?.state ? sanitizePlayerState(client.state) : sanitizePlayerState({});
  if (!state) return null;
  state.id = client.id;
  state.name = client.name;
  state.isOp = Boolean(client.isOp);
  return state;
}

export function publicPlayerListEntry(client) {
  const state = publicPlayerState(client);
  if (!state) return null;
  return {
    id: state.id,
    name: state.name,
    mode: state.mode,
    isOp: Boolean(state.isOp),
    position: state.position,
    updatedAt: state.updatedAt,
  };
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeVector3(value, fallback, min = WORLD_MIN_XZ, max = WORLD_MAX_XZ) {
  const raw = isPlainObject(value) ? value : {};
  return {
    x: sanitizeNumber(raw.x, min, max, fallback.x),
    y: sanitizeNumber(raw.y, -1024, 4096, fallback.y),
    z: sanitizeNumber(raw.z, min, max, fallback.z),
  };
}

function sanitizeGameMode(mode) {
  return mode === "creative" || mode === "spectator" ? mode : "survival";
}

function sanitizePlayerAction(action) {
  if (!isPlainObject(action)) {
    return {
      mining: false,
      using: false,
      swinging: false,
      swingId: 0,
      miningProgress: 0,
    };
  }

  return {
    mining: Boolean(action.mining),
    using: Boolean(action.using),
    swinging: Boolean(action.swinging),
    swingId: sanitizeInteger(action.swingId, 0, 1000000000, 0),
    miningProgress: sanitizeNumber(action.miningProgress, 0, 1, 0),
  };
}

function sanitizeItemId(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).toLowerCase().replace(/[^a-z0-9_:-]/g, "").slice(0, 64) || null;
}

function sanitizeInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function sanitizeNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
