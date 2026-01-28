// =======================
// barikade server.js
// =======================

import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import admin from "firebase-admin";

// -----------------------
const PORT = process.env.PORT || 10000;
const ALLOWED_COLORS = ["red", "blue", "green", "yellow"];

// -----------------------
// GLOBAL CLIENT MAP
// clientId -> { ws, room, name, sessionToken }
// -----------------------
const clients = new Map();

// -----------------------
// ROOMS
// code -> room
// -----------------------
const rooms = new Map();

// -----------------------
// EXPRESS
// -----------------------
const app = express();
app.get("/", (_req, res) => res.send("barikade-server ok"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, rooms: rooms.size, clients: clients.size })
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// -----------------------
// HELPERS
// -----------------------
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {}
}

function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()) {
    const c = clients.get(p.id);
    if (c?.ws?.readyState === 1) {
      try {
        c.ws.send(msg);
      } catch (_) {}
    }
  }
}

function isConnectedPlayer(p) {
  const c = clients.get(p.id);
  return !!(c?.ws && c.ws.readyState === 1);
}

function currentPlayersList(room) {
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color || null,
    isHost: !!p.isHost,
    connected: isConnectedPlayer(p),
    lastSeen: p.lastSeen || null
  }));
}

function canStart(room) {
  return Array.from(room.players.values())
    .filter(p => p.color && isConnectedPlayer(p)).length >= 2;
}

// -----------------------
// ROOM FACTORY
// -----------------------
function makeRoom(code) {
  return {
    code,
    hostToken: null,
    players: new Map(),
    state: null
  };
}

// -----------------------
// WS CONNECTION
// -----------------------
wss.on("connection", (ws) => {
  const clientId = uid();
  clients.set(clientId, { ws, room: null, name: null, sessionToken: null });

  send(ws, { type: "hello", clientId });

  ws.on("message", async (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch { return; }
    const c = clients.get(clientId);
    if (!c) return;

    // -----------------------
    // JOIN
    // -----------------------
    if (msg.type === "join") {
      const roomCode = String(msg.room || "").toUpperCase();
      const name = String(msg.name || "Spieler").slice(0, 32);
      const sessionToken = String(msg.sessionToken || "").slice(0, 60);
      const asHost = !!msg.asHost;

      if (!roomCode) {
        send(ws, { type: "error", message: "Kein Raumcode" });
        return;
      }

      // leave old room
      if (c.room) {
        const old = rooms.get(c.room);
        if (old) {
          old.players.delete(clientId);
          broadcast(old, {
            type: "room_update",
            players: currentPlayersList(old),
            canStart: canStart(old),
            allowedColors: ALLOWED_COLORS
          });
        }
      }

      let room = rooms.get(roomCode);
      if (!room) {
        room = makeRoom(roomCode);
        rooms.set(roomCode, room);
      }

      // -----------------------
      // RECONNECT LOGIC (FIXED)
      // -----------------------
      let existing = null;
      if (sessionToken) {
        for (const p of room.players.values()) {
          if (p.sessionToken === sessionToken) {
            existing = p;
            break;
          }
        }
      }

      if (existing) {
        // ✅ FIX: globale clients Map benutzen
        const existingWs = clients.get(existing.id)?.ws;

        if (existingWs && existingWs.readyState === 1 && existing.id !== clientId) {
          send(ws, {
            type: "error",
            code: "DUPLICATE_SESSION",
            message: "Diese Sitzung ist bereits verbunden."
          });
          try { ws.close(4000, "DUPLICATE_SESSION"); } catch (_) {}
          return;
        }

        room.players.delete(existing.id);
      }

      // -----------------------
      // HOST ASSIGNMENT
      // -----------------------
      let isHost = false;
      if (!room.hostToken && asHost && sessionToken) {
        room.hostToken = sessionToken;
      }
      if (room.hostToken && sessionToken === room.hostToken) {
        isHost = true;
      }
      if (isHost) {
        for (const p of room.players.values()) p.isHost = false;
      }

      room.players.set(clientId, {
        id: clientId,
        name,
        color: null,
        isHost,
        sessionToken,
        lastSeen: Date.now()
      });

      c.room = roomCode;
      c.name = name;
      c.sessionToken = sessionToken;

      const payload = {
        type: "room_update",
        players: currentPlayersList(room),
        canStart: canStart(room),
        allowedColors: ALLOWED_COLORS
      };

      send(ws, payload);
      broadcast(room, payload);
      return;
    }
  });

  ws.on("close", () => {
    const c = clients.get(clientId);
    if (!c) return;
    const room = rooms.get(c.room);
    if (room) {
      const p = room.players.get(clientId);
      if (p) p.lastSeen = Date.now();
    }
    clients.delete(clientId);
  });
});

// -----------------------
server.listen(PORT, () => {
  console.log("Barikade server listening on", PORT);
});
