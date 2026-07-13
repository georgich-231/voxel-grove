import { randomUUID } from "node:crypto";
import {
  DEFAULT_SERVER_PORT,
  MAX_BLOCK_CHANGE_HISTORY,
  MessageType,
  PROTOCOL_VERSION,
  createBlockKey,
  encodeMessage,
  normalizeSeedText,
  parseMessage,
  publicPlayerListEntry,
  publicPlayerState,
  sanitizeBlockChange,
  sanitizeChatText,
  sanitizeCommandText,
  sanitizeJoinPayload,
  sanitizePlayerName,
  sanitizePlayerState,
} from "../src/multiplayer/protocol.js";
import { WebSocketServer } from "ws";

export function readServerOptions(argv = [], env = {}) {
  const parsed = {
    host: env.HOST || "0.0.0.0",
    port: Number(env.PORT || DEFAULT_SERVER_PORT),
    seed: normalizeSeedText(env.VG_SEED || env.WORLD_SEED || "0"),
    ops: parseOpsList(env.VOXEL_GROVE_OPS || env.VG_OPS || env.OPS || ""),
    autoOpFirstPlayer: env.VOXEL_GROVE_AUTO_OP === "1" || env.VG_AUTO_OP === "1",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host" && argv[i + 1]) parsed.host = argv[++i];
    else if (arg === "--port" && argv[i + 1]) parsed.port = Number(argv[++i]);
    else if (arg === "--seed" && argv[i + 1]) parsed.seed = normalizeSeedText(argv[++i], parsed.seed);
    else if (arg === "--op" && argv[i + 1]) parsed.ops.push(sanitizePlayerName(argv[++i]));
    else if (arg === "--ops" && argv[i + 1]) parsed.ops.push(...parseOpsList(argv[++i]));
    else if (arg === "--auto-op-first") parsed.autoOpFirstPlayer = true;
  }

  if (!Number.isInteger(parsed.port) || parsed.port < 0 || parsed.port > 65535) {
    parsed.port = DEFAULT_SERVER_PORT;
  }

  return parsed;
}

function parseOpsList(value) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((name) => sanitizePlayerName(name, ""))
    .filter(Boolean);
}

export function startMultiplayerServer(options = {}) {
  const serverOptions = {
    host: options.host || "0.0.0.0",
    port: Number.isInteger(Number(options.port)) ? Number(options.port) : DEFAULT_SERVER_PORT,
    seed: normalizeSeedText(options.seed, "0"),
    ops: Array.isArray(options.ops) ? options.ops : [],
    autoOpFirstPlayer: Boolean(options.autoOpFirstPlayer),
  };
  const log = typeof options.log === "function" ? options.log : () => {};
  const server = new WebSocketServer({ host: serverOptions.host, port: serverOptions.port });
  const clients = new Map();
  const blockChanges = new Map();
  const ops = new Set(serverOptions.ops.map((name) => sanitizePlayerName(name, "").toLowerCase()).filter(Boolean));
  let serverSequence = 1;
  let stopped = false;

  server.on("connection", (socket, request) => {
    const client = {
      id: randomUUID(),
      socket,
      name: "Player",
      joined: false,
      isOp: false,
      state: null,
      remoteAddress: request.socket.remoteAddress,
    };
    clients.set(socket, client);

    socket.on("message", (raw) => handleMessage(client, raw));
    socket.on("close", () => removeClient(client));
    socket.on("error", () => removeClient(client));
  });

  return new Promise((resolve, reject) => {
    const failBeforeListening = (error) => {
      server.off("listening", finishListening);
      reject(error);
    };
    const finishListening = () => {
      server.off("error", failBeforeListening);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : serverOptions.port;
      const controller = {
        server,
        seed: serverOptions.seed,
        host: serverOptions.host,
        port,
        url: `ws://127.0.0.1:${port}`,
        get playerCount() {
          return joinedClients().length;
        },
        executeConsoleCommand(commandLine) {
          return executeAdminCommand(commandLine, null);
        },
        getPlayerList() {
          return playerList();
        },
        stop,
      };
      server.on("error", (error) => log("Multiplayer server error:", error));
      resolve(controller);
    };

    server.once("error", failBeforeListening);
    server.once("listening", finishListening);
  });

  function handleMessage(client, raw) {
    const message = parseMessage(raw);
    if (!message) {
      sendError(client, "Malformed message.");
      return;
    }

    if (message.type === MessageType.JOIN) {
      handleJoin(client, message);
      return;
    }

    if (!client.joined) {
      sendError(client, "Join before sending game messages.");
      return;
    }

    if (message.type === MessageType.PLAYER_STATE) {
      handlePlayerState(client, message);
    } else if (message.type === MessageType.BLOCK_CHANGE) {
      handleBlockChange(client, message);
    } else if (message.type === MessageType.CHAT) {
      handleChat(client, message);
    } else if (message.type === MessageType.COMMAND) {
      handleCommand(client, message);
    } else {
      sendError(client, `Unknown message type: ${message.type}`);
    }
  }

  function handleJoin(client, message) {
    const payload = sanitizeJoinPayload(message);
    if (!payload) {
      sendError(client, "Invalid join payload.");
      return;
    }

    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      send(client, {
        type: MessageType.ERROR,
        message: `Protocol mismatch. Server uses ${PROTOCOL_VERSION}.`,
        fatal: true,
      });
      client.socket.close(1002, "Protocol mismatch");
      return;
    }

    client.name = uniquePlayerName(payload.name, client.id);
    client.isOp = ops.has(client.name.toLowerCase())
      || (serverOptions.autoOpFirstPlayer && joinedClients().length === 0);
    if (client.isOp) ops.add(client.name.toLowerCase());
    client.state = sanitizePlayerState({
      ...payload.state,
      id: client.id,
      name: client.name,
      updatedAt: Date.now(),
    });
    client.joined = true;

    send(client, {
      type: MessageType.WELCOME,
      protocolVersion: PROTOCOL_VERSION,
      clientId: client.id,
      name: client.name,
      isOp: client.isOp,
      seed: serverOptions.seed,
      players: joinedClients()
        .filter((other) => other.id !== client.id)
        .map(publicPlayerState)
        .filter(Boolean),
      playerList: playerList(),
      blockChanges: [...blockChanges.values()],
      serverTime: Date.now(),
    });

    broadcast({
      type: MessageType.PLAYER_JOINED,
      player: publicPlayerState(client),
    }, client);

    broadcastChat("Server", `${client.name} joined.`);
    broadcastPlayerList();
  }

  function handlePlayerState(client, message) {
    const state = sanitizePlayerState({
      ...message.state,
      id: client.id,
      name: client.name,
      updatedAt: Date.now(),
    });
    if (!state) return;
    client.state = state;
    broadcast({
      type: MessageType.PLAYER_STATE,
      player: publicPlayerState(client),
    }, client);
  }

  function handleBlockChange(client, message) {
    const change = sanitizeBlockChange(message.change);
    if (!change) {
      sendError(client, "Invalid block change.");
      return;
    }

    const authoritativeChange = {
      ...change,
      actorId: client.id,
      serverSeq: serverSequence,
      timestamp: Date.now(),
    };
    serverSequence += 1;

    const key = createBlockKey(change.x, change.y, change.z);
    if (blockChanges.has(key)) blockChanges.delete(key);
    blockChanges.set(key, authoritativeChange);
    trimBlockChangeHistory();

    broadcast({
      type: MessageType.BLOCK_CHANGE,
      change: authoritativeChange,
    });
  }

  function handleChat(client, message) {
    const text = sanitizeChatText(message.text);
    if (!text) return;
    broadcastChat(client.name, text);
  }

  function handleCommand(client, message) {
    const command = sanitizeCommandText(message.command);
    if (!command) return;
    executeAdminCommand(command, client);
  }

  function removeClient(client) {
    if (!clients.has(client.socket)) return;
    clients.delete(client.socket);

    if (!client.joined) return;
    broadcast({
      type: MessageType.PLAYER_LEFT,
      id: client.id,
      name: client.name,
    });
    broadcastChat("Server", `${client.name} left.`);
    broadcastPlayerList();
  }

  function joinedClients() {
    return [...clients.values()].filter((client) => client.joined);
  }

  function playerList() {
    return joinedClients()
      .map(publicPlayerListEntry)
      .filter(Boolean);
  }

  function broadcastPlayerList() {
    broadcast({
      type: MessageType.PLAYER_LIST,
      players: playerList(),
      timestamp: Date.now(),
    });
  }

  function uniquePlayerName(name, ownId) {
    const base = sanitizePlayerName(name);
    const names = new Set(
      joinedClients()
        .filter((client) => client.id !== ownId)
        .map((client) => client.name.toLowerCase()),
    );
    if (!names.has(base.toLowerCase())) return base;

    for (let i = 2; i <= 99; i += 1) {
      const candidate = sanitizePlayerName(`${base}${i}`);
      if (!names.has(candidate.toLowerCase())) return candidate;
    }

    return `${base.slice(0, 12)}${Math.floor(Math.random() * 900 + 100)}`;
  }

  function executeAdminCommand(commandLine, actor) {
    const raw = sanitizeCommandText(commandLine);
    const messages = [];
    const reply = (message) => {
      if (!message) return;
      if (actor) sendCommandResult(actor, message);
      else messages.push(message);
    };
    const parts = raw.split(/\s+/).filter(Boolean);
    const command = parts.shift()?.toLowerCase();
    if (!command) return { messages, stop: false };
    const source = actor?.name ?? "Console";

    if (command === "help" || command === "?") {
      reply("Commands: help, list, seed, op, deop, ops, say, kick, gamemode, tp, give, time, weather, stop");
      reply("Examples: op Steve | gamemode creative Steve | tp Steve 0 90 0 | time set day");
      return { messages, stop: false };
    }

    if (command === "list" || command === "players") {
      const players = playerList();
      const names = players.map((player) => `${player.name}${player.isOp ? " [OP]" : ""}`);
      reply(`${players.length} player${players.length === 1 ? "" : "s"} online: ${names.join(", ") || "none"}`);
      return { messages, stop: false };
    }

    if (command === "seed") {
      reply(`Seed: ${serverOptions.seed}`);
      return { messages, stop: false };
    }

    if (actor && !actor.isOp) {
      reply("You do not have permission to use that command.");
      return { messages, stop: false };
    }

    if (command === "op") {
      const name = sanitizePlayerName(parts.join(" "), "");
      if (!name) {
        reply("Usage: op <player>");
        return { messages, stop: false };
      }
      ops.add(name.toLowerCase());
      const target = findClientByName(name);
      if (target) {
        target.isOp = true;
        sendCommandResult(target, "You are now an operator.");
      }
      broadcastPlayerList();
      broadcastChat("Server", `${name} is now an operator.`);
      reply(`${name} is now an operator.`);
      return { messages, stop: false };
    }

    if (command === "deop") {
      const name = sanitizePlayerName(parts.join(" "), "");
      if (!name) {
        reply("Usage: deop <player>");
        return { messages, stop: false };
      }
      ops.delete(name.toLowerCase());
      const target = findClientByName(name);
      if (target) {
        target.isOp = false;
        sendCommandResult(target, "You are no longer an operator.");
      }
      broadcastPlayerList();
      broadcastChat("Server", `${name} is no longer an operator.`);
      reply(`${name} is no longer an operator.`);
      return { messages, stop: false };
    }

    if (command === "ops") {
      reply(`Operators: ${[...ops].sort().join(", ") || "none"}`);
      return { messages, stop: false };
    }

    if (command === "say") {
      const text = sanitizeChatText(parts.join(" "));
      if (!text) {
        reply("Usage: say <message>");
        return { messages, stop: false };
      }
      broadcastChat("Server", text);
      reply(`Said: ${text}`);
      return { messages, stop: false };
    }

    if (command === "kick") {
      const target = findClientByName(parts[0]);
      if (!target) {
        reply("Usage: kick <player> [reason]");
        return { messages, stop: false };
      }
      const reason = sanitizeChatText(parts.slice(1).join(" ")) || "Kicked by an operator.";
      sendCommandResult(target, reason);
      target.socket.close(1000, reason);
      reply(`Kicked ${target.name}.`);
      return { messages, stop: false };
    }

    if (command === "stop") {
      broadcastChat("Server", `Server stopping by ${source}.`);
      if (actor) {
        reply("Stopping server.");
        queueMicrotask(() => stop());
        return { messages, stop: false };
      }
      messages.push("Stopping server.");
      return { messages, stop: true };
    }

    if (command === "time") {
      if (!parts.length || !["set", "add", "query"].includes(parts[0])) {
        reply("Usage: time <set|add|query> <value>");
        return { messages, stop: false };
      }
      if (parts[0] === "query" && actor) {
        sendAdminCommand(actor, `time ${parts.join(" ")}`, source);
        return { messages, stop: false };
      }
      if (parts[0] === "query") {
        reply("The server does not track time locally; use time set/add to broadcast a change.");
        return { messages, stop: false };
      }
      broadcastAdminCommand(`time ${parts.join(" ")}`, source);
      reply(`Ran /time ${parts.join(" ")}.`);
      return { messages, stop: false };
    }

    if (command === "weather") {
      if (!parts.length) {
        reply("Usage: weather <clear|rain|thunder> [seconds]");
        return { messages, stop: false };
      }
      broadcastAdminCommand(`weather ${parts.join(" ")}`, source);
      reply(`Ran /weather ${parts.join(" ")}.`);
      return { messages, stop: false };
    }

    if (command === "gamemode" || command === "gm") {
      const mode = parseServerGameMode(parts[0]);
      const target = parts[1] ? findClientByName(parts[1]) : actor;
      if (!mode || !target) {
        reply(actor ? "Usage: gamemode <survival|creative|spectator> [player]" : "Usage: gamemode <survival|creative|spectator> <player>");
        return { messages, stop: false };
      }
      sendAdminCommand(target, `gamemode ${mode}`, source);
      reply(`Set ${target.name} to ${mode}.`);
      return { messages, stop: false };
    }

    if (command === "tp" || command === "teleport") {
      const { target, coords } = parseTargetedPositionCommand(parts, actor);
      if (!target || coords.length < 3) {
        reply(actor ? "Usage: tp [player] <x> <y> <z>" : "Usage: tp <player> <x> <y> <z>");
        return { messages, stop: false };
      }
      sendAdminCommand(target, `tp ${coords.slice(0, 3).join(" ")}`, source);
      reply(`Teleported ${target.name}.`);
      return { messages, stop: false };
    }

    if (command === "give") {
      const { target, itemParts } = parseTargetedItemCommand(parts, actor);
      if (!target || itemParts.length < 1) {
        reply(actor ? "Usage: give [player] <item> [count]" : "Usage: give <player> <item> [count]");
        return { messages, stop: false };
      }
      sendAdminCommand(target, `give ${itemParts.slice(0, 2).join(" ")}`, source);
      reply(`Gave ${target.name} ${itemParts[0]}${itemParts[1] ? ` x${itemParts[1]}` : ""}.`);
      return { messages, stop: false };
    }

    reply(`Unknown command: /${command}`);
    return { messages, stop: false };
  }

  function sendCommandResult(client, message) {
    send(client, {
      type: MessageType.COMMAND_RESULT,
      message: sanitizeChatText(message),
    });
  }

  function sendAdminCommand(client, command, source) {
    send(client, {
      type: MessageType.ADMIN_COMMAND,
      command: sanitizeCommandText(command),
      source: sanitizePlayerName(source, "Server"),
      timestamp: Date.now(),
    });
  }

  function broadcastAdminCommand(command, source) {
    broadcast({
      type: MessageType.ADMIN_COMMAND,
      command: sanitizeCommandText(command),
      source: sanitizePlayerName(source, "Server"),
      timestamp: Date.now(),
    });
  }

  function findClientByName(name) {
    const query = sanitizePlayerName(name, "").toLowerCase();
    if (!query) return null;
    const joined = joinedClients();
    return joined.find((client) => client.name.toLowerCase() === query)
      ?? joined.find((client) => client.name.toLowerCase().startsWith(query))
      ?? null;
  }

  function parseServerGameMode(mode) {
    const value = String(mode ?? "").toLowerCase();
    if (value === "0" || value === "s" || value === "survival") return "survival";
    if (value === "1" || value === "c" || value === "creative") return "creative";
    if (value === "3" || value === "sp" || value === "spectator") return "spectator";
    return null;
  }

  function parseTargetedPositionCommand(parts, actor) {
    const possibleTarget = findClientByName(parts[0]);
    if (possibleTarget && parts.length >= 4) {
      return { target: possibleTarget, coords: parts.slice(1) };
    }
    return { target: actor, coords: parts };
  }

  function parseTargetedItemCommand(parts, actor) {
    const possibleTarget = findClientByName(parts[0]);
    if (possibleTarget && parts.length >= 2) {
      return { target: possibleTarget, itemParts: parts.slice(1) };
    }
    return { target: actor, itemParts: parts };
  }

  function trimBlockChangeHistory() {
    while (blockChanges.size > MAX_BLOCK_CHANGE_HISTORY) {
      const oldestKey = blockChanges.keys().next().value;
      if (oldestKey === undefined) break;
      blockChanges.delete(oldestKey);
    }
  }

  function broadcastChat(from, text) {
    broadcast({
      type: MessageType.CHAT,
      from,
      text: sanitizeChatText(text),
      timestamp: Date.now(),
    });
  }

  function broadcast(message, exceptClient = null) {
    for (const client of clients.values()) {
      if (client === exceptClient) continue;
      send(client, message);
    }
  }

  function sendError(client, message) {
    send(client, {
      type: MessageType.ERROR,
      message,
    });
  }

  function send(client, message) {
    if (client.socket.readyState !== 1) return;
    client.socket.send(encodeMessage(message.type, omitType(message)));
  }

  function omitType(message) {
    const { type, ...payload } = message;
    return payload;
  }

  function stop() {
    if (stopped) return Promise.resolve();
    stopped = true;
    for (const client of clients.values()) {
      try {
        client.socket.close(1001, "Server stopped");
      } catch {
        // Ignore sockets that are already gone.
      }
    }
    clients.clear();
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}
