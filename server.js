import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import admin from "firebase-admin";

const PORT = process.env.PORT || 10000;

// ---------- Player Colors (Lobby Selection) ----------
// WICHTIG (Christoph-Wunsch): KEINE automatische Farbe mehr beim Join.
// Jeder (auch Host) wählt seine Farbe aktiv in der Lobby.
// Reconnect via sessionToken behält die Farbe.
//
// 2–4 Spieler: alle 4 Farben sind grundsätzlich möglich.
// Die Turn-Reihenfolge läuft über room.state.activeColors (nur die tatsächlich
// im Match verwendeten Farben). Pieces existieren aber immer für alle 4 Farben.
const ALLOWED_COLORS = ["red", "blue", "green", "yellow"];

function roomUpdatePayload(room, playersOverride) {
  return {
    type: "room_update",
    players: Array.isArray(playersOverride) ? playersOverride : currentPlayersList(room),
    canStart: canStart(room),
    allowedColors: ALLOWED_COLORS,
  };
}

// ---------- Firebase (optional, but recommended for 100% Restore) ----------
// IMPORTANT: We do NOT remove the existing disk save/restore.
// Firebase is an additional, durable persistence layer.
const FIREBASE_ENABLED = String(process.env.FIREBASE_ENABLED || "").trim() === "1";
const FIREBASE_COLLECTION = process.env.FIREBASE_COLLECTION || "rooms";

let firestore = null;

function parseServiceAccountFromEnv() {
  // Supports either:
  // - FIREBASE_SERVICE_ACCOUNT_JSON: raw JSON string
  // - FIREBASE_SERVICE_ACCOUNT_B64: base64 encoded JSON
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  try {
    if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  } catch (_e) {}
  try {
    if (b64 && b64.trim().length > 10) {
      const json = Buffer.from(b64.trim(), "base64").toString("utf8");
      return JSON.parse(json);
    }
  } catch (_e) {}
  return null;
}

function initFirebaseIfConfigured() {
  if (!FIREBASE_ENABLED) return;
  try {
    if (firestore) return;
    const serviceAccount = parseServiceAccountFromEnv();
    if (!serviceAccount) {
      console.warn("[firebase] FIREBASE_ENABLED=1 but no service account JSON found. Falling back to disk only.");
      return;
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    firestore = admin.firestore();
    console.log("[firebase] Firestore enabled for persistence");
  } catch (e) {
    console.warn("[firebase] init failed, falling back to disk only:", e?.message || e);
    firestore = null;
  }
}

function docIdForRoom(code) {
  // Keep identical sanitization as disk filename
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 20) || "ROOM";
}

// ---------- Save / Restore (best-effort) ----------
// NOTE: On some hosts (z.B. Render free) kann das Dateisystem nach Restart leer sein.
// Daher zusätzlich "Export/Import" über WebSocket (Host kann JSON herunterladen/hochladen).
const SAVE_DIR = process.env.SAVE_DIR || path.join(process.cwd(), "saves");
try { fs.mkdirSync(SAVE_DIR, { recursive: true }); } catch (_e) {}

function savePathForRoom(code){
  const safe = String(code||"").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,20) || "ROOM";
  return path.join(SAVE_DIR, safe + ".json");
}

async function persistRoomState(room){
  // Disk persistence (kept as fallback)
  try{
    if(!room || !room.code || !room.state) return;

    // Revision counter (monotonic, used for stale snapshot protection)
    if (typeof room.state.rev !== "number") room.state.rev = 0;
    room.state.rev += 1;

    const file = savePathForRoom(room.code);
    const payload = { code: room.code, ts: Date.now(), state: room.state };
    fs.writeFileSync(file, JSON.stringify(payload));
  }catch(_e){}

  // Firestore persistence (durable)
  try{
    initFirebaseIfConfigured();
    if(!firestore || !room?.code || !room?.state) return;
    const docId = docIdForRoom(room.code);
    const now = Date.now();
    await firestore.collection(FIREBASE_COLLECTION).doc(docId).set({
      code: room.code,
      ts: now,
      rev: room.state.rev,
      state: room.state,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }catch(e){
    // We do NOT throw: game continues. Disk fallback still exists.
    console.warn("[firebase] persist failed:", e?.message || e);
  }
}

async function restoreRoomState(room){
  // Prefer Firestore when enabled; otherwise disk.
  try{
    initFirebaseIfConfigured();
    if (firestore && room?.code) {
      const docId = docIdForRoom(room.code);
      const snap = await firestore.collection(FIREBASE_COLLECTION).doc(docId).get();
      const data = snap.exists ? snap.data() : null;
      if (data?.state && typeof data.state === "object") {
        room.state = data.state;
        // Backward-compat + safety defaults
        if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
          room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
        } else {
          // Backward-compat: fehlende Farben auffüllen
          for (const c of ALLOWED_COLORS) {
            if (typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c] = false;
          }
        }
        if (!Array.isArray(room.state.activeColors)) room.state.activeColors = [];
        room.carryingByColor = room.state.carryingByColor;
        return true;
      }
    }
  } catch (e) {
    console.warn("[firebase] restore failed, trying disk:", e?.message || e);
  }

  try{
    if(!room || !room.code) return false;
    const file = savePathForRoom(room.code);
    if(!fs.existsSync(file)) return false;
    const raw = fs.readFileSync(file, "utf8");
    const payload = JSON.parse(raw);
    if(payload && payload.state && typeof payload.state === "object"){
      room.state = payload.state;
      if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
        room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
      } else {
        for (const c of ALLOWED_COLORS) {
          if (typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c] = false;
        }
      }
      if (!Array.isArray(room.state.activeColors)) room.state.activeColors = [];
      room.carryingByColor = room.state.carryingByColor;
      return true;
    }
  }catch(_e){}
  return false;
}

async function deletePersisted(room){
  // delete disk + firestore (if configured)
  try{
    if(!room || !room.code) return;
    const file = savePathForRoom(room.code);
    if(fs.existsSync(file)) fs.unlinkSync(file);
  }catch(_e){}

  try{
    initFirebaseIfConfigured();
    if(!firestore || !room?.code) return;
    const docId = docIdForRoom(room.code);
    await firestore.collection(FIREBASE_COLLECTION).doc(docId).delete();
  }catch(e){
    console.warn("[firebase] delete failed:", e?.message || e);
  }
}

// ---------- Rooms + Clients (müssen vor /health existieren) ----------
const clients = new Map(); // clientId -> {ws, room, name, sessionToken}
const rooms = new Map();   // code -> room

const app = express();
app.get("/", (_req, res) => res.status(200).send("barikade-server ok"));
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, ts: Date.now(), rooms: rooms.size, clients: clients.size })
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** ---------- Board graph (server authoritative path + legality) ---------- **/
const boardPath = path.join(process.cwd(), "board.json");
const BOARD = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
const NODES = new Map((BOARD.nodes || []).map(n => [n.id, n]));
const EDGES = BOARD.edges || [];
const ADJ = new Map();

for (const [a, b] of EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, new Set());
  if (!ADJ.has(b)) ADJ.set(b, new Set());
  ADJ.get(a).add(b);
  ADJ.get(b).add(a);
}

const STARTS = BOARD.meta?.starts || {};
const GOAL = BOARD.meta?.goal || null;

const HOUSE_BY_COLOR = (() => {
  const map = { red: [], blue: [], green: [], yellow: [] };
  for (const n of BOARD.nodes || []) {
    if (n.kind !== "house") continue;
    const c = String(n.flags?.houseColor || "").toLowerCase();
    const slot = Number(n.flags?.houseSlot || 0);
    if (!map[c]) map[c] = [];
    map[c].push([slot, n.id]);
  }
  for (const c of Object.keys(map)) {
    map[c].sort((a, b) => a[0] - b[0]);
    map[c] = map[c].map(x => x[1]);
  }
  return map;
})();

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 8);
}

/** ---------- Rooms ---------- **/
function makeRoom(code) {
  return {
    code,
    hostToken: null, // stable host identity (sessionToken)
    players: new Map(), // clientId -> {id,name,color,isHost,sessionToken,lastSeen}
    state: null,
    lastRollWasSix: false,
    // Backward-compat field. Source of truth is room.state.carryingByColor
    // because only room.state is persisted to disk/Firebase.
    carryingByColor: { red: false, blue: false, green: false, yellow: false },
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
  const coloredConnected = Array.from(room.players.values()).filter(p => p.color && isConnectedPlayer(p));
  return coloredConnected.length >= 2;
}

// Reconnect-Sicherheit:
// - Sobald weniger als 2 farbige Spieler verbunden sind, pausieren wir IMMER.
// - Entpausen passiert NUR explizit per Host-Button (msg.type === "resume").
function enforcePauseIfNotReady(room){
  try{
    if(!room?.state) return;
    const ready = canStart(room);
    if(!ready) room.state.paused = true;
  }catch(_e){}
}

// Legacy helper (auto-unpause ist absichtlich deaktiviert)
function resumeIfReady(room) {
  enforcePauseIfNotReady(room);
}


function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()) {
    const c = clients.get(p.id);
    if (c?.ws?.readyState === 1) {
      try { c.ws.send(msg); } catch (_e) {}
    }
  }
}

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_e) {}
}

function assignColorsRandom(room) {
  // remove offline placeholders on reset
  for (const p of Array.from(room.players.values())) {
    if (!isConnectedPlayer(p)) room.players.delete(p.id);
  }
  const connected = Array.from(room.players.values()).filter(p => isConnectedPlayer(p));
  for (const p of connected) p.color = null;
  if (connected.length === 0) return;
  if (connected.length > ALLOWED_COLORS.length) connected.length = ALLOWED_COLORS.length;

  // Zufällig verteilen, aber eindeutig
  shuffleInPlace(connected);
  const colors = [...ALLOWED_COLORS];
  shuffleInPlace(colors);
  for (let i = 0; i < connected.length; i++) {
    connected[i].color = colors[i];
  }
}

/** ---------- Game state ---------- **/
function initGameState(room, activeColors) {
  // Normalize activeColors (colors that are actually participating in turn order).
  activeColors = Array.isArray(activeColors) && activeColors.length
    ? activeColors.map(c => String(c).toLowerCase())
    : null;

  if (!activeColors) {
    const fromState = room?.state?.activeColors;
    if (Array.isArray(fromState) && fromState.length) {
      activeColors = fromState.map(c => String(c).toLowerCase());
    }
  }

  if (!activeColors) {
    // Fallback: connected players with a chosen color, in stable order.
    const order = ["red","blue","green","yellow"];
    activeColors = order.filter(col => room.players && [...room.players.values()].some(p => p && p.color === col));
    if (!activeColors.length) activeColors = ["red","blue"]; // last-resort fallback
  }

  // pieces 5 per color in house
  const pieces = [];
  for (const color of ["red", "blue"]) {
    const houses = (BOARD.nodes || [])
      .filter(n => n.kind === "house" && String(n.flags?.houseColor || "").toLowerCase() === color)
      .sort((a, b) => (a.flags?.houseSlot ?? 0) - (b.flags?.houseSlot ?? 0));

    for (let i = 0; i < 5; i++) {
      pieces.push({
        id: `p_${color}_${i + 1}`,
        label: i + 1,
        color,
        posKind: "house",
        houseId: houses[i]?.id || houses[0]?.id || null,
        nodeId: null,
      });
    }
  }

  // barricades: all run nodes
  const barricades = (BOARD.nodes || [])
    .filter(n => n.kind === "board" && n.flags?.run)
    .map(n => n.id);

  // activeColors = die Farben, die beim Spielstart tatsächlich mitspielen
  // (2–4). Falls nicht angegeben, aus den verbundenen Spielern ableiten.
  const act = Array.isArray(activeColors) && activeColors.length
    ? activeColors.filter(c => ALLOWED_COLORS.includes(c))
    : ALLOWED_COLORS.filter(c => Array.from(room.players.values()).some(p => isConnectedPlayer(p) && p.color === c));

  // Fallback: mindestens 2 Farben erzwingen (damit Turn-Cycle nicht kaputt geht)
  const active = (act.length >= 2) ? act : ALLOWED_COLORS.slice(0, 2);

  // choose starter (deterministic-ish: first active color)
  const turnColor = active[0] || "red";

  room.lastRollWasSix = false;
  // IMPORTANT: carrying must survive restart -> store in room.state (persisted)
  const carryingByColor = { red: false, blue: false, green: false, yellow: false };
  room.carryingByColor = carryingByColor; // backward-compat alias

  room.state = {
    started: true,
    paused: false,
    turnColor,
    phase: "need_roll", // need_roll | need_move | place_barricade
    rolled: null,
    pieces,
    barricades,
    goal: GOAL,
    carryingByColor,
    activeColors: active,
  };
}

function nextTurnColor(room, current) {
  const act = Array.isArray(room.state?.activeColors) && room.state.activeColors.length
    ? room.state.activeColors
    : ALLOWED_COLORS;
  const i = act.indexOf(current);
  if (i < 0) return act[0] || "red";
  return act[(i + 1) % act.length];
}
function getPiece(room, pieceId) {
  return room.state?.pieces?.find(p => p.id === pieceId) || null;
}

function occupiedByColor(room, color, excludePieceId = null) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.color !== color) continue;
    if (excludePieceId && p.id === excludePieceId) continue;
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function occupiedAny(room) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function nextFreeHouseId(room, color) {
  const homes = HOUSE_BY_COLOR[color] || [];
  if (!homes.length) return null;

  const used = new Set();
  for (const p of room.state.pieces) {
    if (p.color === color && p.posKind === "house" && p.houseId) used.add(p.houseId);
  }
  for (const hid of homes) {
    if (!used.has(hid)) return hid;
  }
  return homes[0] || null;
}

function sendPieceHome(room, piece) {
  piece.posKind = "house";
  piece.nodeId = null;
  piece.houseId = nextFreeHouseId(room, piece.color);
}

function isPlacableBarricade(room, nodeId) {
  const n = NODES.get(nodeId);
  if (!n || n.kind !== "board") return false;

  // goal tabu
  if (n.flags?.goal) return false;

  // not on existing barricade / pieces
  if (room.state.barricades.includes(nodeId)) return false;
  if (occupiedAny(room).has(nodeId)) return false;

  return true;
}

/** ---------- Path + legality (exact steps, no immediate backtrack, no revisits) ---------- **/
function computeAllTargets(room, startNodeId, steps, color, pieceId) {
  const blockedEnd = occupiedByColor(room, color, pieceId); // cannot END on own piece
  const barricades = new Set(room.state.barricades || []);
  const targets = new Map(); // nodeId -> path array

  function dfs(node, depth, prevNode, visited, pathArr) {
    if (depth === steps) {
      if (!blockedEnd.has(node)) {
        if (!targets.has(node)) targets.set(node, [...pathArr]);
      }
      return;
    }
    const neigh = ADJ.get(node);
    if (!neigh) return;

    for (const nx of neigh) {
      if (prevNode && nx === prevNode) continue; // no immediate backtrack
      if (visited.has(nx)) continue;             // no revisits

      // barricade cannot be passed through; only land
      if (barricades.has(nx) && (depth + 1) < steps) continue;

      // end can't be own piece
      if ((depth + 1) === steps && blockedEnd.has(nx)) continue;

      visited.add(nx);
      pathArr.push(nx);
      dfs(nx, depth + 1, node, visited, pathArr);
      pathArr.pop();
      visited.delete(nx);
    }
  }

  const visited = new Set([startNodeId]);
  dfs(startNodeId, 0, null, visited, [startNodeId]);
  return targets;
}

function pathForTarget(room, piece, targetId) {
  const color = piece.color;
  const roll = room.state.rolled;
  if (!(roll >= 1 && roll <= 6)) return { ok: false, msg: "no roll" };

  const startField = STARTS[color];
  if (!startField || !NODES.has(startField)) return { ok: false, msg: "missing start in board.meta.starts" };

  if (piece.posKind === "house") {
    const remaining = roll - 1;
    if (remaining < 0) return { ok: false, msg: "bad remaining" };

    if (remaining === 0) {
      if (targetId !== startField) return { ok: false, msg: "with roll=1 you must go to start" };
      return { ok: true, path: [startField] };
    }

    const targets = computeAllTargets(room, startField, remaining, color, piece.id);
    const p = targets.get(targetId);
    if (!p) return { ok: false, msg: "illegal target" };
    return { ok: true, path: p };
  }

  if (piece.posKind === "board") {
    const cur = piece.nodeId;
    if (!cur) return { ok: false, msg: "piece has no nodeId" };

    const targets = computeAllTargets(room, cur, roll, color, piece.id);
    const p = targets.get(targetId);
    if (!p) return { ok: false, msg: "illegal target" };
    return { ok: true, path: p };
  }

  return { ok: false, msg: "unknown piece pos" };
}

/** ---------- Protocol ---------- **/
function requireRoomState(room, ws) {
  if (!room.state) {
    send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" });
    return false;
  }
  return true;
}

function requireTurn(room, clientId, ws) {
  const me = room.players.get(clientId);
  if (!me?.color) { send(ws, { type: "error", code: "SPECTATOR", message: "Du hast keine Farbe" }); return false; }
  if (room.state.paused) { send(ws, { type: "error", code: "PAUSED", message: "Spiel pausiert" }); return false; }
  if (room.state.turnColor !== me.color) {
    send(ws, { type: "error", code: "NOT_YOUR_TURN", message: `Nicht dran. Dran: ${room.state.turnColor.toUpperCase()}` });
    return false;
  }
  return true;
}

/** ---------- WebSocket ---------- **/
wss.on("connection", (ws) => {
  const clientId = uid();
  clients.set(clientId, { ws, room: null, name: null, sessionToken: null });
  send(ws, { type: "hello", clientId });

  ws.on("message", async (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch (_e) { return; }
    const c = clients.get(clientId);
    if (!c) return;

    if (msg.type === "ping") { send(ws, { type: "pong" }); return; }

    // ---------- JOIN ----------
    if (msg.type === "join") {
      const roomCode = String(msg.room || "").trim().toUpperCase();
      const name = String(msg.name || "Spieler").slice(0, 32);
      const asHost = !!msg.asHost;
      const sessionToken = String(msg.sessionToken || "").slice(0, 60);
      const requestedColor = String(msg.requestedColor || "").toLowerCase().trim();

      if (!roomCode) { send(ws, { type: "error", code: "NO_ROOM", message: "Kein Raumcode" }); return; }

      // leave old room
      if (c.room) {
        const old = rooms.get(c.room);
        if (old) {
          old.players.delete(clientId);
          broadcast(old, roomUpdatePayload(old));
        }
      }

      // get/create room
      let room = rooms.get(roomCode);
      if (!room) { room = makeRoom(roomCode); rooms.set(roomCode, room); }

      // If server restarted / room.state missing, try to restore from disk (best-effort)
      if (!room.state) {
        const restored = await restoreRoomState(room);
        if (restored) {
          console.log(`[restore] room=${roomCode} restored state (firebase/disk)`);
        }
      }

      // reconnect via sessionToken
      let existing = null;
      if (sessionToken) {
        for (const p of room.players.values()) {
          if (p.sessionToken && p.sessionToken === sessionToken) { existing = p; break; }
        }
      }
      if (existing) {
        // Prevent a NEW client from kicking a currently-connected player that uses the same sessionToken.
        // If the old one is truly disconnected, reconnect still works (old ws not in room.clients).
        const existingWs = room.clients.get(existing.id);
        if (existingWs && existingWs.readyState === 1 && existing.id !== clientId) {
          safeSend(ws, { t: "error", code: "DUPLICATE_SESSION", message: "Diese Sitzung ist bereits verbunden (Session bereits aktiv)." });
          try { ws.close(4000, "DUPLICATE_SESSION"); } catch (_) {}
          return;
        }
        room.players.delete(existing.id);
      }
      const existingColor = existing?.color || null;

      
// host assignment (stable, server-chef):
// - host is bound to room.hostToken (sessionToken)
// - prevents race condition when BOTH players reconnect
let isHost = false;

// Establish hostToken once (first host join with sessionToken)
if (!room.hostToken) {
  if (existing?.isHost && existing?.sessionToken) {
    room.hostToken = existing.sessionToken;
  } else if (asHost && sessionToken) {
    room.hostToken = sessionToken;
  }
}

// Determine host strictly by token
if (room.hostToken && sessionToken && sessionToken === room.hostToken) {
  isHost = true;
}

// Ensure single-host: if true host joins, clear host flag on all others
if (isHost) {
  for (const p of room.players.values()) p.isHost = false;
}

// color assignment
// IMPORTANT CHANGE (requested):
// - KEINE automatische Farbe mehr beim Join.
// - Jeder (auch Host) waehlt seine Farbe aktiv in der Lobby.
// - Reconnect via sessionToken behaelt die vorherige Farbe.
// - Wunschfarbe kann beim Join mitgeschickt werden (requestedColor) und wird nur gesetzt,
//   wenn der Slot frei ist.
//
// NOTE: Das Board/Game-Logic in diesem Server arbeitet aktuell mit 2 Farben (red/blue).
//       Weitere Farben koennen spaeter additiv freigeschaltet werden.
//       (ALLOWED_COLORS ist global definiert.)

// If reconnecting via sessionToken, keep the exact previous color
let color = existing?.color || null;

// remove offline placeholders that hold a color, so slots become available
for (const p of Array.from(room.players.values())) {
  if (p.color && !isConnectedPlayer(p)) {
    room.players.delete(p.id);
  }
}

// Max 4 gleichzeitig verbundene Spieler pro Raum
{
  const connectedCount = Array.from(room.players.values()).filter(p => isConnectedPlayer(p)).length;
  if (!existing && connectedCount >= ALLOWED_COLORS.length) {
    send(clientId, { type: "error", code: "ROOM_FULL", message: `Raum ist voll (max ${ALLOWED_COLORS.length} Spieler).` });
    return;
  }
}

// If not reconnecting, honor requestedColor ONLY if free
if (!color) {
  const usedNow = new Set(Array.from(room.players.values()).map(p => p.color).filter(Boolean));
  const want = ALLOWED_COLORS.includes(requestedColor) ? requestedColor : null;
  if (want && !usedNow.has(want)) {
    color = want;
  } else {
    // stay spectator until player actively chooses
    color = null;
  }
}

room.players.set(clientId, { id: clientId, name, color, isHost, sessionToken, lastSeen: Date.now() });
      // Auto-unpause deaktiviert: Fortsetzen nur per Host (resume)
      c.room = roomCode; c.name = name; c.sessionToken = sessionToken;

      // Reconnect-Sicherheit: Wenn noch nicht wieder 2 Spieler verbunden sind,
      // pausieren wir den Raum sofort (auch nach Server-Restart/Restore).
      if (room.state) {
        enforcePauseIfNotReady(room);
        await persistRoomState(room);
      }

      console.log(`[join] room=${roomCode} name=${name} host=${isHost} color=${color} existing=${!!existing}`);

      send(ws, roomUpdatePayload(room));
      broadcast(room, roomUpdatePayload(room));


      if (room.state) send(ws, { type: "snapshot", state: room.state });
      return;
    }

    // ---------- ALL OTHER MESSAGES NEED ROOM ----------
    const roomCode = c.room;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (msg.type === "leave") {
      room.players.delete(clientId);
      c.room = null;
      send(ws, roomUpdatePayload(room, []));
      broadcast(room, roomUpdatePayload(room));
      return;
    }


    // ---------- CLAIM COLOR (DEPRECATED) ----------
    // Früher konnte der Host Slots anderen Spielern zuweisen.
    // Neuer Standard (dein Wunsch): Jeder wählt seine Farbe selbst in der Lobby.
    // Wir lassen den Message-Typ existieren, damit alte Clients nicht crashen,
    // aber wir blocken die Aktion mit einer klaren Fehlermeldung.
    if (msg.type === "claim_color") {
      send(ws, {
        type: "error",
        code: "DEPRECATED",
        message: "Slot-Zuweisung durch Host ist deaktiviert. Jeder Spieler wählt seine Farbe selbst (Lobby).",
      });
      return;
    }

    // ---------- REQUEST COLOR (Self, lobby only) ----------
    // Additive feature: player can request a preferred color BEFORE the game starts.
    // Does NOT remove/replace any existing logic (reconnect, pause/resume, save/restore stay unchanged).
    if (msg.type === "request_color") {
      // only in lobby (no running state yet)
      if (room.state) {
        send(ws, { type: "error", code: "GAME_STARTED", message: "Farbe nur vor Spielstart wählbar" });
        return;
      }

      const me = room.players.get(clientId);
      if (!me || !isConnectedPlayer(me)) {
        send(ws, { type: "error", code: "BAD_PLAYER", message: "Spieler nicht verbunden" });
        return;
      }

      const targetColor = String(msg.color || msg.targetColor || "").toLowerCase().trim();
      if (!ALLOWED_COLORS.includes(targetColor)) {
        send(ws, { type: "error", code: "BAD_COLOR", message: "Ungültige Farbe" });
        return;
      }

      // If I'm already that color -> ok
      if (me.color === targetColor) {
        send(ws, roomUpdatePayload(room));
        return;
      }

      // Check if slot is held
      let holderId = null;
      for (const p of room.players.values()) {
        if (p.color === targetColor) { holderId = p.id; break; }
      }
      if (holderId) {
        const holder = room.players.get(holderId);
        // connected holder blocks
        if (holder && isConnectedPlayer(holder)) {
          send(ws, { type: "error", code: "SLOT_IN_USE", message: "Slot ist gerade belegt" });
          return;
        }
        // offline placeholder -> remove
        if (holder && !isConnectedPlayer(holder)) room.players.delete(holderId);
      }

      // assign
      me.color = targetColor;

      broadcast(room, roomUpdatePayload(room));
      await persistRoomState(room);
      return;
    }

    // ---------- START / RESET ----------
    if (msg.type === "start") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann starten" }); return; }
      if (!canStart(room)) { send(ws, { type: "error", code: "NEED_2P", message: "Mindestens 2 Spieler nötig" }); return; }

      // aktive Farben anhand verbundener Spieler (mit gewählter Farbe)
      const act = Array.from(room.players.values())
        .filter(p => isConnectedPlayer(p) && ALLOWED_COLORS.includes(p.color))
        .map(p => p.color);
      const uniqueAct = ALLOWED_COLORS.filter(c => act.includes(c));
      if (uniqueAct.length < 2) {
        send(ws, { type: "error", code: "NEED_COLORS", message: "Mindestens 2 Spieler müssen eine Farbe wählen" });
        return;
      }

      initGameState(room, uniqueAct);
      await persistRoomState(room);
      console.log(`[start] room=${room.code} starter=${room.state.turnColor}`);
      broadcast(room, { type: "started", state: room.state });
      return;
    }

    if (msg.type === "reset") {
    // reset = neues Spiel, überschreibt Save
    await deletePersisted(room);

      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann resetten" }); return; }

      room.state = null;
      room.lastRollWasSix = false;
      room.carryingByColor = { red: false, blue: false, green: false, yellow: false };
      // Farben NICHT neu zufaellig zuweisen:
      // Neuer Standard: Spieler waehlen ihre Farbe selbst in der Lobby.
      // (Reconnect/Token bleibt damit konsistent.)

      console.log(`[reset] room=${room.code} by=host`);
      broadcast(room, roomUpdatePayload(room));
      broadcast(room, { type: "reset_done" });
      return;
    }

    // ---------- RESUME (Host) ----------
    // Reconnect-Sicherheit: Der Raum bleibt pausiert, bis der Host aktiv fortsetzt.
    // Wichtig: Nur fortsetzen, wenn wieder 2 farbige Spieler verbunden sind.
    if (msg.type === "resume") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann fortsetzen" }); return; }
      if (!room.state) { send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" }); return; }
      if (!canStart(room)) {
        room.state.paused = true;
        await persistRoomState(room);
        send(ws, { type: "error", code: "NEED_2P", message: "Warte auf 2 Spieler…" });
        broadcast(room, { type: "snapshot", state: room.state });
        return;
      }
      room.state.paused = false;
      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state });
      return;
    }

    // ---------- ROLL ----------
    if (msg.type === "roll_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_roll") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Zug beenden" });
        return;
      }

      const v = randInt(1, 6);
      console.log(`[roll] room=${room.code} by=${room.state.turnColor} value=${v}`);

      room.state.rolled = v;
      room.lastRollWasSix = (v === 6);
      room.state.phase = "need_move";
      await persistRoomState(room);
    broadcast(room, { type: "roll", value: v, state: room.state });
      return;
    }

    // ---------- END / SKIP ----------
    if (msg.type === "end_turn" || msg.type === "skip_turn") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase === "place_barricade") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Barikade platzieren" });
        return;
      }

      room.lastRollWasSix = false;
      room.state.rolled = null;
      room.state.phase = "need_roll";
      room.state.turnColor = nextTurnColor(room, room.state.turnColor);

      await persistRoomState(room);
    broadcast(room, { type: "move", state: room.state });
      broadcast(room, roomUpdatePayload(room));
      return;
    }

    // ---------- LEGAL TARGETS ----------
    if (msg.type === "legal_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_move") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln" });
        return;
      }

      const pieceId = String(msg.pieceId || "");
      const pc = getPiece(room, pieceId);
      if (!pc || pc.color !== room.state.turnColor) {
        send(ws, { type: "error", code: "BAD_PIECE", message: "Ungültige Figur" });
        return;
      }

      const roll = room.state.rolled;
      const startField = STARTS[pc.color];
      let targets = new Map();

      if (pc.posKind === "house") {
        const remaining = roll - 1;
        if (remaining === 0) targets = new Map([[startField, [startField]]]);
        else targets = computeAllTargets(room, startField, remaining, pc.color, pc.id);
      } else {
        targets = computeAllTargets(room, pc.nodeId, roll, pc.color, pc.id);
      }

      send(ws, { type: "legal", pieceId, targets: Array.from(targets.keys()) });
      return;
    }

    // ---------- MOVE ----------
    
  // ---------- EXPORT / IMPORT (Host only) ----------
  // export_state: Server sendet aktuellen room.state zurück (Host kann als JSON speichern)
  if (msg.type === "export_state") {
    if (!room) return;
    const me = room.players.get(clientId);
    if (!me?.isHost) return send(ws, { type: "error", code: "HOST_ONLY", message: "Nur Host" });
    if (!room.state) return send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" });
    return send(ws, { type: "export_state", code: room.code, state: room.state, ts: Date.now() });
  }

  // import_state: Host sendet state JSON zurück → Server setzt room.state und broadcastet snapshot
  if (msg.type === "import_state") {
    if (!room) return;
    const me = room.players.get(clientId);
    if (!me?.isHost) return send(ws, { type: "error", code: "HOST_ONLY", message: "Nur Host" });
    const st = msg.state;
    if (!st || typeof st !== "object") return send(ws, { type: "error", code: "BAD_STATE", message: "Ungültiger State" });

    // Minimal sanity: muss turnColor & phase besitzen
    if (!st.turnColor || !st.phase || !Array.isArray(st.pieces) || !Array.isArray(st.barricades)) {
      return send(ws, { type: "error", code: "BAD_STATE", message: "State-Format passt nicht" });
    }

    room.state = st;
    // wenn Spiel importiert ist, nicht pausieren (sonst lock)
    room.state.paused = false;
    await persistRoomState(room);
    broadcast(room, { type: "snapshot", state: room.state, players: currentPlayersList(room) });
    return;
  }

if (msg.type === "move_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_move") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln" });
        return;
      }

      const pieceId = String(msg.pieceId || "");
      const targetId = String(msg.targetId || "");
      const pc = getPiece(room, pieceId);

      if (!pc || pc.color !== room.state.turnColor) {
        send(ws, { type: "error", code: "BAD_PIECE", message: "Ungültige Figur" });
        return;
      }

      const res = pathForTarget(room, pc, targetId);
      if (!res.ok) {
        send(ws, { type: "error", code: "ILLEGAL", message: res.msg || "illegal" });
        return;
      }

      // apply move
      pc.posKind = "board";
      pc.nodeId = res.path[res.path.length - 1];

      const landed = pc.nodeId;

      // kick opponent on landing
      const kicked = [];
      for (const op of room.state.pieces) {
        if (op.posKind === "board" && op.nodeId === landed && op.color !== pc.color) {
          sendPieceHome(room, op);
          kicked.push(op.id);
        }
      }

      // landed on barricade?
      const barricades = room.state.barricades;
      const idx = barricades.indexOf(landed);
      let picked = false;

      if (idx >= 0) {
        barricades.splice(idx, 1);
        picked = true;
        // Persist the "carrying" flag inside state (so it survives restart)
        if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
  room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
        }
        room.state.carryingByColor[pc.color] = true;
        room.carryingByColor = room.state.carryingByColor; // compat alias
        room.state.phase = "place_barricade";
      } else {
        room.state.phase = "need_roll";
      }

      // if no barricade placement needed:
      if (!picked) {
        if (room.lastRollWasSix) {
          room.state.turnColor = pc.color; // extra roll
        } else {
          room.state.turnColor = nextTurnColor(room, pc.color);
        }
        room.state.phase = "need_roll";
        room.state.rolled = null;
      }

      console.log(`[move] room=${room.code} color=${pc.color} piece=${pc.id} to=${pc.nodeId} picked=${picked}`);
      broadcast(room, {
        type: "move",
        action: { pieceId: pc.id, path: res.path, pickedBarricade: picked, kickedPieces: kicked },
        state: room.state
      });
      // Persist after every successful move so a server restart has the newest possible state.
      await persistRoomState(room);
      return;
    }

    // ---------- PLACE BARRICADE (Host+Client) ----------
// ---------- PLACE BARRICADE (Host+Client) ----------
if (msg.type === "place_barricade") {
  if (!requireRoomState(room, ws)) return;

  if (room.state.phase !== "place_barricade") {
    send(ws, { type: "error", code: "BAD_PHASE", message: "Keine Barikade zu platzieren" });
    return;
  }

  const me = room.players.get(clientId);
  if (!me?.color) {
    send(ws, { type: "error", code: "SPECTATOR", message: "Du hast keine Farbe" });
    return;
  }

  const color = room.state.turnColor;

  // Zug über Spielerfarbe prüfen (Host/Client egal)
  if (me.color !== color) {
    send(ws, { type: "error", code: "NOT_YOUR_TURN", message: "Nicht dein Zug" });
    return;
  }

  // carrying flag is persisted in room.state
  if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
    room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
  }
  room.carryingByColor = room.state.carryingByColor; // compat alias

  if (!room.state.carryingByColor[color]) {
    send(ws, { type: "error", code: "NO_BARRICADE", message: "Du trägst keine Barikade" });
    return;
  }

  // ✅ Robust: viele mögliche Payload-Formate akzeptieren
  let nodeId = "";
  if (typeof msg.nodeId === "string") nodeId = msg.nodeId;
  else if (typeof msg.at === "string") nodeId = msg.at;
  else if (typeof msg.id === "string") nodeId = msg.id;
  else if (typeof msg.targetId === "string") nodeId = msg.targetId;
  else if (msg.node && typeof msg.node === "object" && typeof msg.node.id === "string") nodeId = msg.node.id;

  // falls aus irgendeinem Grund eine Zahl/Index kommt:
  if (!nodeId && (typeof msg.nodeId === "number" || typeof msg.at === "number" || typeof msg.id === "number")) {
    const idx = Number(msg.nodeId ?? msg.at ?? msg.id);
    const n = (BOARD.nodes || [])[idx];
    if (n?.id) nodeId = String(n.id);
  }

  nodeId = String(nodeId || "").trim();

  // 🔧 normalize ids (host/client may send "12" or "node_12" etc.)
  if (nodeId && !NODES.has(nodeId)) {
    const m = String(nodeId).match(/(\d+)/);
    if (/^\d+$/.test(nodeId)) nodeId = `n_${nodeId}`;
    else if (m) nodeId = `n_${m[1]}`;
  }

  // 🔧 fallback: if still unknown but coords exist, snap to nearest board node
  if (nodeId && !NODES.has(nodeId)) {
    let x = null, y = null;
    if (typeof msg.x === "number" && typeof msg.y === "number") { x = msg.x; y = msg.y; }
    else if (msg.pos && typeof msg.pos.x === "number" && typeof msg.pos.y === "number") { x = msg.pos.x; y = msg.pos.y; }
    if (x !== null && y !== null) {
      let best = null;
      let bestD = Infinity;
      for (const n of (BOARD.nodes || [])) {
        if (n.kind !== "board") continue;
        const dx = (n.x ?? 0) - x;
        const dy = (n.y ?? 0) - y;
        const d = dx*dx + dy*dy;
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best?.id) nodeId = best.id;
    }
  }

  if (!nodeId) {
    send(ws, { type: "error", code: "NO_NODE", message: "Kein Zielfeld" });
    return;
  }

  if (!isPlacableBarricade(room, nodeId)) {
    // Mini-Debug, damit du es im Render Log sofort siehst:
    const n = NODES.get(nodeId);
    console.log("[place_barricade] FAIL",
      "player=", me.color,
      "turn=", color,
      "nodeId=", nodeId,
      "exists=", !!n,
      "kind=", n?.kind
    );
    send(ws, { type: "error", code: "BAD_NODE", message: "Hier darf keine Barikade hin" });
    return;
  }

  // ✅ platzieren
  room.state.barricades.push(nodeId);
  room.state.carryingByColor[color] = false;
  room.carryingByColor = room.state.carryingByColor; // compat alias

  // ✅ weiter
  room.state.turnColor = room.lastRollWasSix ? color : nextTurnColor(room, color);
  room.state.phase = "need_roll";
  room.state.rolled = null;

  await persistRoomState(room);
  broadcast(room, { type: "snapshot", state: room.state });
  return;
}

    // fallback: unknown message
    return;
  }); // ✅ Ende ws.on("message")

  ws.on("close", async () => {
    const c = clients.get(clientId);
    if (!c) return;

    const roomCode = c.room;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const p = room.players.get(clientId);
        const wasColor = p?.color;
        const wasTurn = room.state?.turnColor;
        if (p) p.lastSeen = Date.now();

        // pause if active player disconnected
        if (room.state && wasColor && wasTurn && wasColor === wasTurn) {
          room.state.paused = true;
        }


        // Wenn wirklich niemand mehr verbunden ist → sicher pausieren (beide reconnect edge-case)
        if (room.state) {
          const anyConnected = Array.from(room.players.values()).some(pp => isConnectedPlayer(pp));
          if (!anyConnected) room.state.paused = true;
        }

        // Reconnect-Sicherheit: sobald <2 Spieler verbunden sind → pausiert
        enforcePauseIfNotReady(room);
        broadcast(room, roomUpdatePayload(room));
        if (room.state) await persistRoomState(room);
    broadcast(room, { type: "snapshot", state: room.state });
      }
    }

    clients.delete(clientId);
  });
});

server.listen(PORT, () => console.log("Barikade server listening on", PORT));
