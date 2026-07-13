import {
  DEFAULT_MULTIPLAYER_URL,
  MessageType,
  PROTOCOL_VERSION,
  encodeMessage,
  normalizeServerUrl,
  parseMessage,
  sanitizeBlockChange,
  sanitizeChatText,
  sanitizeCommandText,
  sanitizePlayerName,
  sanitizePlayerState,
} from "./protocol.js";
import { RemotePlayerManager } from "./remotePlayers.js";

const PLAYER_STATE_SEND_INTERVAL = 1 / 12;
const PLAYER_STATE_FORCE_INTERVAL = 2.5;
const CONNECT_TIMEOUT_MS = 8000;

export class MultiplayerClient {
  constructor(game, options = {}) {
    this.game = game;
    this.url = normalizeServerUrl(options.url, DEFAULT_MULTIPLAYER_URL);
    this.playerName = sanitizePlayerName(options.playerName);
    this.socket = null;
    this.clientId = null;
    this.serverName = null;
    this.seed = null;
    this.status = "idle";
    this.statusText = "Offline";
    this.connected = false;
    this.world = null;
    this.remotePlayers = null;
    this.pendingWelcome = null;
    this.pendingBlockChanges = [];
    this.lastSentState = null;
    this.playerStateElapsed = 0;
    this.playerStateForceElapsed = 0;
    this.localBlockSeq = 1;
    this.playerCount = 1;
    this.players = new Map();
    this.isOp = false;
  }

  connect() {
    if (this.socket) this.disconnect("Reconnecting");
    if (typeof WebSocket === "undefined") {
      return Promise.reject(new Error("This browser does not support WebSocket."));
    }

    this.status = "connecting";
    this.statusText = "Connecting";
    this.socket = new WebSocket(this.url);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.disconnect("Connection timed out");
        reject(new Error("Connection timed out."));
      }, CONNECT_TIMEOUT_MS);

      const settleResolve = (welcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(welcome);
      };

      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };

      this.socket.addEventListener("open", () => {
        this.send(MessageType.JOIN, {
          protocolVersion: PROTOCOL_VERSION,
          name: this.playerName,
          state: this.createLocalPlayerState(),
        });
      });

      this.socket.addEventListener("message", (event) => {
        const message = parseMessage(event.data);
        if (!message) return;
        if (message.type === MessageType.WELCOME) {
          this.handleWelcome(message);
          settleResolve(message);
          return;
        }
        this.handleMessage(message);
      });

      this.socket.addEventListener("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.status = "closed";
        this.statusText = wasConnected ? "Disconnected" : "Connection closed";
        this.playerCount = 1;
        this.players.clear();
        this.isOp = false;
        this.game.renderPlayerList?.();
        if (!settled) settleReject(new Error("Connection closed."));
      });

      this.socket.addEventListener("error", () => {
        this.status = "error";
        this.statusText = "Connection failed";
        if (!settled) settleReject(new Error("Connection failed."));
      });
    });
  }

  attachWorld(world) {
    this.world = world;
    if (!this.remotePlayers) this.remotePlayers = new RemotePlayerManager(this.game.scene);
    this.remotePlayers.clear();
    if (this.pendingWelcome) this.applyWelcome(this.pendingWelcome);
    for (const change of this.pendingBlockChanges.splice(0)) {
      this.applyRemoteBlockChange(change);
    }
    this.sendPlayerState(true);
  }

  disconnect(reason = "Disconnected") {
    if (this.socket) {
      try {
        this.socket.close(1000, reason);
      } catch {
        // The socket can already be closing; there is nothing useful to recover.
      }
    }
    this.socket = null;
    this.connected = false;
    this.status = "closed";
    this.statusText = "Offline";
    this.clientId = null;
    this.playerCount = 1;
    this.players.clear();
    this.isOp = false;
    this.pendingWelcome = null;
    this.pendingBlockChanges.length = 0;
    this.remotePlayers?.clear();
    this.game.renderPlayerList?.();
  }

  update(dt) {
    this.remotePlayers?.update(dt);
    if (!this.connected || !this.game.started || !this.game.player) return;
    this.playerStateElapsed += dt;
    this.playerStateForceElapsed += dt;
    if (this.playerStateElapsed >= PLAYER_STATE_SEND_INTERVAL) {
      this.playerStateElapsed = 0;
      this.sendPlayerState(this.playerStateForceElapsed >= PLAYER_STATE_FORCE_INTERVAL);
    }
  }

  recordLocalBlockChange(change) {
    if (!this.connected) return;
    const sanitized = sanitizeBlockChange({
      ...change,
      clientSeq: this.localBlockSeq,
    });
    if (!sanitized) return;
    this.localBlockSeq += 1;
    this.send(MessageType.BLOCK_CHANGE, { change: sanitized });
  }

  sendChat(text) {
    const clean = sanitizeChatText(text);
    if (!clean || !this.connected) return false;
    this.send(MessageType.CHAT, { text: clean });
    return true;
  }

  sendCommand(commandLine) {
    const command = sanitizeCommandText(commandLine);
    if (!command || !this.connected) return false;
    this.send(MessageType.COMMAND, { command });
    return true;
  }

  sendPlayerState(force = false) {
    if (!this.connected) return;
    const state = this.createLocalPlayerState();
    const comparable = JSON.stringify({
      p: [
        Math.round(state.position.x * 100),
        Math.round(state.position.y * 100),
        Math.round(state.position.z * 100),
      ],
      v: [
        Math.round(state.velocity.x * 10),
        Math.round(state.velocity.y * 10),
        Math.round(state.velocity.z * 10),
      ],
      yaw: Math.round(state.yaw * 100),
      pitch: Math.round(state.pitch * 100),
      mode: state.mode,
      heldItemId: state.heldItemId,
      action: [
        Boolean(state.action?.mining),
        Boolean(state.action?.using),
        Boolean(state.action?.swinging),
        Number(state.action?.swingId ?? 0),
        Math.round(Number(state.action?.miningProgress ?? 0) * 20),
      ],
    });
    if (!force && comparable === this.lastSentState) return;
    this.lastSentState = comparable;
    this.playerStateForceElapsed = 0;
    this.send(MessageType.PLAYER_STATE, { state });
  }

  createLocalPlayerState() {
    const state = this.game.getMultiplayerPlayerState?.() ?? {};
    return sanitizePlayerState({
      ...state,
      id: this.clientId,
      name: this.playerName,
      updatedAt: Date.now(),
    });
  }

  getStatusLabel() {
    if (!this.connected) return this.statusText;
    const count = Math.max(1, this.playerCount);
    return `${count} player${count === 1 ? "" : "s"}`;
  }

  handleWelcome(message) {
    this.connected = true;
    this.status = "connected";
    this.clientId = message.clientId;
    this.playerName = sanitizePlayerName(message.name, this.playerName);
    this.isOp = Boolean(message.isOp);
    this.seed = String(message.seed ?? "0");
    this.statusText = "Connected";
    this.pendingWelcome = message;
    this.applyWelcome(message);
  }

  applyWelcome(message) {
    if (!this.world || !this.remotePlayers) return;
    this.pendingWelcome = null;
    this.remotePlayers.clear();
    this.players.clear();
    this.rememberPlayer({
      id: this.clientId,
      name: this.playerName,
      mode: this.game.player?.mode ?? this.game.selectedMode ?? "survival",
      isOp: this.isOp,
      updatedAt: Date.now(),
    });
    for (const player of message.players ?? []) {
      this.rememberPlayer(player);
      this.remotePlayers.upsertPlayer(player);
    }
    this.applyPlayerList(message.playerList);
    for (const change of message.blockChanges ?? []) {
      this.applyRemoteBlockChange(change);
    }
    this.playerCount = Math.max(1, this.players.size || ((message.players?.length ?? 0) + 1));
    this.game.renderPlayerList?.();
    this.game.addChatMessage?.(`Connected to ${this.url}`, "system");
  }

  handleMessage(message) {
    if (message.type === MessageType.PLAYER_JOINED) {
      this.rememberPlayer(message.player);
      this.remotePlayers?.upsertPlayer(message.player);
      this.playerCount = Math.max(1, this.players.size || this.playerCount + 1);
      this.game.renderPlayerList?.();
      return;
    }

    if (message.type === MessageType.PLAYER_LEFT) {
      this.remotePlayers?.removePlayer(message.id);
      this.players.delete(message.id);
      this.playerCount = Math.max(1, this.players.size || this.playerCount - 1);
      this.game.renderPlayerList?.();
      return;
    }

    if (message.type === MessageType.PLAYER_STATE) {
      this.rememberPlayer(message.player);
      if (message.player?.id === this.clientId) {
        this.isOp = Boolean(message.player.isOp);
        this.game.renderPlayerList?.();
        return;
      }
      this.remotePlayers?.upsertPlayer(message.player);
      this.game.renderPlayerList?.();
      return;
    }

    if (message.type === MessageType.PLAYER_LIST) {
      this.applyPlayerList(message.players);
      this.game.renderPlayerList?.();
      return;
    }

    if (message.type === MessageType.BLOCK_CHANGE) {
      this.applyRemoteBlockChange(message.change);
      return;
    }

    if (message.type === MessageType.CHAT) {
      const from = sanitizePlayerName(message.from, "Server");
      const text = sanitizeChatText(message.text);
      if (text) this.game.addChatMessage?.(`${from}: ${text}`, from === "Server" ? "system" : "player");
      return;
    }

    if (message.type === MessageType.ERROR) {
      this.statusText = message.message ?? "Server error";
      this.game.addChatMessage?.(this.statusText, "system");
      return;
    }

    if (message.type === MessageType.COMMAND_RESULT) {
      const text = sanitizeChatText(message.message);
      if (text) this.game.addChatMessage?.(text, "system");
      return;
    }

    if (message.type === MessageType.ADMIN_COMMAND) {
      const command = sanitizeCommandText(message.command);
      if (command) this.game.executeServerAdminCommand?.(command, message.source);
    }
  }

  rememberPlayer(player) {
    if (!player?.id) return;
    const existing = this.players.get(player.id) ?? {};
    const entry = {
      ...existing,
      ...player,
      id: player.id,
      name: sanitizePlayerName(player.name, existing.name ?? "Player"),
      mode: player.mode ?? existing.mode ?? "survival",
      isOp: Boolean(player.isOp ?? existing.isOp),
      updatedAt: Number.isFinite(player.updatedAt) ? player.updatedAt : (existing.updatedAt ?? Date.now()),
    };
    this.players.set(entry.id, entry);
    if (entry.id === this.clientId) {
      this.playerName = entry.name;
      this.isOp = Boolean(entry.isOp);
    }
    this.playerCount = Math.max(1, this.players.size);
  }

  applyPlayerList(players) {
    if (!Array.isArray(players)) return;
    const next = new Map();
    for (const player of players) {
      if (!player?.id) continue;
      next.set(player.id, {
        id: player.id,
        name: sanitizePlayerName(player.name, "Player"),
        mode: player.mode ?? "survival",
        isOp: Boolean(player.isOp),
        position: player.position,
        updatedAt: Number.isFinite(player.updatedAt) ? player.updatedAt : Date.now(),
      });
    }
    this.players = next;
    const own = this.players.get(this.clientId);
    if (own) {
      this.playerName = own.name;
      this.isOp = Boolean(own.isOp);
    }
    this.playerCount = Math.max(1, this.players.size);
  }

  getPlayerList() {
    const ownId = this.clientId;
    const players = [...this.players.values()];
    if (ownId && !players.some((player) => player.id === ownId)) {
      players.push({
        id: ownId,
        name: this.playerName,
        mode: this.game.player?.mode ?? this.game.selectedMode ?? "survival",
        isOp: this.isOp,
        updatedAt: Date.now(),
      });
    }
    return players.sort((a, b) => {
      if (a.id === ownId) return -1;
      if (b.id === ownId) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }

  applyRemoteBlockChange(change) {
    const sanitized = sanitizeBlockChange(change);
    if (!sanitized) return;
    if (!this.world) {
      this.pendingBlockChanges.push(sanitized);
      return;
    }

    if (typeof this.world.applyRemoteBlockChange === "function") {
      this.world.applyRemoteBlockChange(sanitized);
      return;
    }

    this.world.setBlock(sanitized.x, sanitized.y, sanitized.z, sanitized.block, {
      ...sanitized.options,
      multiplayerRemote: true,
      skipWaterUpdate: true,
      skipLavaUpdate: true,
      skipLiquidInteractions: true,
    });
  }

  send(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(encodeMessage(type, payload));
    return true;
  }
}

export { DEFAULT_MULTIPLAYER_URL, normalizeServerUrl, sanitizePlayerName };
