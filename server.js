let isAnimatingMove = false; // FIX: verhindert Klick-Crash nach Refactor

(() => {
  const $ = (id) => document.getElementById(id);

  function debugLog(...args){
    try{ console.log(...args); }catch(_e){}
    const el = document.getElementById('debugLog');
    if(el){
      try{
        el.textContent += args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' ') + "\n";
        el.scrollTop = el.scrollHeight;
      }catch(_e){}
    }
  }

  // ===== Glücksrad (nur Optik) =====
let wheelOverlay = null;
let wheelAnimId = 0;

function ensureWheelOverlay(){
  if(wheelOverlay) return wheelOverlay;
  const ov = document.createElement("div");
  ov.id = "wheelOverlay";
  ov.style.position = "fixed";
  ov.style.inset = "0";
  ov.style.background = "rgba(0,0,0,0.45)";
  ov.style.backdropFilter = "blur(2px)";
  ov.style.display = "none";
  ov.style.zIndex = "9999";
  ov.style.alignItems = "center";
  ov.style.justifyContent = "center";

  const card = document.createElement("div");
  card.style.width = "min(420px, 92vw)";
  card.style.borderRadius = "22px";
  card.style.padding = "18px 16px 14px";
  card.style.background = "rgba(18,22,30,0.92)";
  card.style.boxShadow = "0 10px 40px rgba(0,0,0,0.45)";
  card.style.border = "1px solid rgba(255,255,255,0.10)";

  const title = document.createElement("div");
  title.textContent = "Glücksrad entscheidet Startspieler…";
  title.style.fontSize = "16px";
  title.style.fontWeight = "700";
  title.style.margin = "0 0 10px 0";
  title.style.opacity = "0.95";

  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.width = "min(360px, 84vw)";
  wrap.style.aspectRatio = "1 / 1";
  wrap.style.margin = "0 auto";

  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 720;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.borderRadius = "50%";
  canvas.style.boxShadow = "inset 0 0 0 10px rgba(255,255,255,0.06), 0 18px 40px rgba(0,0,0,0.35)";
  canvas.style.background = "rgba(255,255,255,0.03)";
  canvas.id = "wheelCanvas";

  // pointer
  const pointer = document.createElement("div");
  pointer.style.position = "absolute";
  pointer.style.left = "50%";
  pointer.style.top = "-6px";
  pointer.style.transform = "translateX(-50%)";
  pointer.style.width = "0";
  pointer.style.height = "0";
  pointer.style.borderLeft = "16px solid transparent";
  pointer.style.borderRight = "16px solid transparent";
  pointer.style.borderBottom = "26px solid rgba(255,255,255,0.92)";
  pointer.style.filter = "drop-shadow(0 6px 10px rgba(0,0,0,0.55))";

  const subtitle = document.createElement("div");
  subtitle.id = "wheelSubtitle";
  subtitle.style.marginTop = "12px";
  subtitle.style.textAlign = "center";
  subtitle.style.fontSize = "14px";
  subtitle.style.opacity = "0.85";
  subtitle.textContent = "Dreht…";

  wrap.appendChild(canvas);
  wrap.appendChild(pointer);

  card.appendChild(title);
  card.appendChild(wrap);
  card.appendChild(subtitle);
  ov.appendChild(card);
  document.body.appendChild(ov);

  wheelOverlay = ov;
  return ov;
}

function colorCss(color){
  // keep in sync with server ALLOWED_COLORS
  switch(String(color||"").toLowerCase()){
    case "red": return "#ff3b3b";
    case "blue": return "#3b82ff";
    case "green": return "#22c55e";
    case "yellow": return "#fbbf24";
    default: return "#94a3b8";
  }
}
function colorLabel(color){
  switch(String(color||"").toLowerCase()){
    case "red": return "Rot";
    case "blue": return "Blau";
    case "green": return "Grün";
    case "yellow": return "Gelb";
    default: return String(color||"");
  }
}

function drawWheel(ctx, colors, rot){
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const cx = W/2, cy = H/2;
  const r = Math.min(W,H)*0.42;
  ctx.clearRect(0,0,W,H);

  // subtle glossy radial
  const grd = ctx.createRadialGradient(cx, cy, r*0.1, cx, cy, r*1.25);
  grd.addColorStop(0, "rgba(255,255,255,0.16)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.05)");
  grd.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(cx, cy, r*1.18, 0, Math.PI*2); ctx.fill();

  const n = Math.max(2, colors.length);
  const step = (Math.PI*2)/n;

  for(let i=0;i<n;i++){
    const a0 = rot + i*step - Math.PI/2;
    const a1 = a0 + step;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,a0,a1,false);
    ctx.closePath();
    ctx.fillStyle = colorCss(colors[i]);
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;

    // text
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(a0 + step/2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 10;
    ctx.fillText(colorLabel(colors[i]).toUpperCase(), r*0.92, 0);
    ctx.restore();
  }

  // center cap
  ctx.beginPath();
  ctx.arc(cx,cy,r*0.18,0,Math.PI*2);
  ctx.fillStyle = "rgba(15,18,24,0.85)";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.stroke();
}

function showWheelStart(activeColors, starterColor, endsAt){
  const ov = ensureWheelOverlay();
  const canvas = document.getElementById("wheelCanvas");
  const sub = document.getElementById("wheelSubtitle");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const colors = (Array.isArray(activeColors) && activeColors.length) ? activeColors.slice() : ["red","blue"];

  const n = colors.length;
  const idx = Math.max(0, colors.indexOf(String(starterColor||"").toLowerCase()));
  const step = (Math.PI*2)/n;

  // target rotation so that the center of winning segment lands at pointer (top).
  // Pointer is at -90deg, our draw starts at rot - 90deg, so align via rot.
  const winCenter = idx*step + step/2;
  // set final rotation such that winCenter maps to 0 angle in our local coordinates.
  const baseTarget = -winCenter;

  const now = Date.now();
  const t0 = now;
  const tEnd = Math.max(now + 4000, Number(endsAt)||now+10000); // safety
  const dur = Math.max(3000, tEnd - t0);

  // add extra spins for drama
  const extraSpins = 8 * Math.PI * 2; // 8 full rotations
  const startRot = 0;
  const finalRot = baseTarget + extraSpins;

  ov.style.display = "flex";
  let lastRot = 0;

  function easeOutCubic(x){ return 1 - Math.pow(1-x,3); }

  function frame(){
    const t = Date.now();
    const p = Math.min(1, (t - t0)/dur);
    const e = easeOutCubic(p);
    const rot = startRot + (finalRot - startRot)*e;
    lastRot = rot;
    drawWheel(ctx, colors, rot);
    if(sub){
      const leftMs = Math.max(0, tEnd - t);
      sub.textContent = leftMs>0 ? `Dreht… (${Math.ceil(leftMs/1000)}s)` : `${colorLabel(starterColor)} beginnt!`;
    }
    if(p < 1){
      wheelAnimId = requestAnimationFrame(frame);
    } else {
      drawWheel(ctx, colors, finalRot);
      if(sub) sub.textContent = `${colorLabel(starterColor)} beginnt!`;
      // keep overlay a short moment, then hide (server will also send wheel_done)
      setTimeout(()=>{ hideWheel(); }, 2000);
    }
  }
  try{ cancelAnimationFrame(wheelAnimId); }catch(_e){}
  wheelAnimId = requestAnimationFrame(frame);
}

function hideWheel(){
  if(!wheelOverlay) return;
  wheelOverlay.style.display = "none";
}

  // ===== UI refs =====
  const canvas = $("c");
  const ctx = canvas.getContext("2d");
  const toastEl = $("toast");
  const netBannerEl = $("netBanner");
  const debugToggle = $("debugToggle");
  const debugLogEl = $("debugLog");

  const rollBtn = $("rollBtn");
  const startBtn = $("startBtn");
  const endBtn  = $("endBtn");
  const skipBtn = $("skipBtn");
  const resetBtn= $("resetBtn");
  const resumeBtn = $("resumeBtn");
  // Host tools (Save/Load) - host only
  const hostTools = $("hostTools");
  const saveBtn = $("saveBtn");
  const loadBtn = $("loadBtn");
  const restoreBtn = $("restoreBtn");
  const loadFile = $("loadFile");
  const autoSaveInfo = $("autoSaveInfo");

  // Notfall: Farben tauschen (Host-only)
  let swapColorsBtn = $("swapColorsBtn");
  try{
    // Falls index.html den Button noch nicht hat, erzeugen wir ihn sicher per JS,
    // damit du nur game.js tauschen musst.
    if(!swapColorsBtn && hostTools){
      swapColorsBtn = document.createElement("button");
      swapColorsBtn.id = "swapColorsBtn";
      swapColorsBtn.className = "btn";
      swapColorsBtn.textContent = "🔁 Rot ↔ Blau";
      hostTools.appendChild(swapColorsBtn);
    }
  }catch(_e){}
  const diceEl  = $("diceCube");
  const turnText= $("turnText");
  const turnDot = $("turnDot");
  const boardInfo = $("boardInfo");
  const barrInfo  = $("barrInfo");

  // ===== Legendary Dice (visual only, isolated) =====
  // Additive: inject styles from JS so du musst NICHT die index.html anfassen.
  // Entfernt keine Funktion – nur Optik für den Würfel.
  function ensureLegendaryDiceStyles(){
    try{
      if(document.getElementById("legendaryDiceStyles")) return;
      const style = document.createElement("style");
      style.id = "legendaryDiceStyles";
      style.textContent = `
        /* Legendary Dice – additive, should not affect gameplay */
        #diceCube{
          position: relative;
          transform-style: preserve-3d;
          will-change: transform, filter;
          filter: drop-shadow(0 10px 22px rgba(0,0,0,.55));
        }
        #diceCube.legend-roll{
          animation: legendRoll 650ms cubic-bezier(.2,.9,.2,1) both;
        }
        #diceCube.legend-ping{
          animation: legendPing 420ms cubic-bezier(.2,.9,.2,1) both;
        }
        #diceCube.legend-crit6::after{
          content:"";
          position:absolute; inset:-14px;
          border-radius: 18px;
          background: radial-gradient(circle at 50% 50%, rgba(255,255,255,.35), rgba(255,255,255,0) 60%);
          filter: blur(0px);
          animation: critGlow 950ms ease-out both;
          pointer-events:none;
          mix-blend-mode: screen;
        }
        #diceCube.legend-crit1::after{
          content:"";
          position:absolute; inset:-16px;
          border-radius: 18px;
          background: radial-gradient(circle at 50% 60%, rgba(255,80,80,.28), rgba(255,80,80,0) 62%);
          animation: critRed 950ms ease-out both;
          pointer-events:none;
          mix-blend-mode: screen;
        }
        /* If older CSS misses .shake, provide a safe fallback */
        #diceCube.shake{
          animation: diceShake 280ms ease-in-out both;
        }
        @keyframes diceShake{
          0%{ transform: translate3d(0,0,0) rotate(0deg) scale(1); }
          20%{ transform: translate3d(-2px,1px,0) rotate(-4deg) scale(1.02); }
          40%{ transform: translate3d(2px,-1px,0) rotate(4deg) scale(1.03); }
          60%{ transform: translate3d(-1px,-2px,0) rotate(-3deg) scale(1.02); }
          80%{ transform: translate3d(1px,2px,0) rotate(3deg) scale(1.01); }
          100%{ transform: translate3d(0,0,0) rotate(0deg) scale(1); }
        }
        @keyframes legendRoll{
          0%{ transform: translate3d(0,0,0) rotateX(0deg) rotateY(0deg) scale(1); filter: drop-shadow(0 10px 22px rgba(0,0,0,.55)); }
          45%{ transform: translate3d(0,-6px,0) rotateX(520deg) rotateY(620deg) scale(1.10); filter: drop-shadow(0 16px 30px rgba(0,0,0,.55)); }
          70%{ transform: translate3d(0,-2px,0) rotateX(760deg) rotateY(840deg) scale(1.06); }
          100%{ transform: translate3d(0,0,0) rotateX(720deg) rotateY(720deg) scale(1); }
        }
        @keyframes legendPing{
          0%{ transform: translate3d(0,0,0) scale(1); }
          40%{ transform: translate3d(0,-2px,0) scale(1.08); }
          100%{ transform: translate3d(0,0,0) scale(1); }
        }
        @keyframes critGlow{
          0%{ opacity:0; transform: scale(.92); }
          25%{ opacity:1; transform: scale(1); }
          100%{ opacity:0; transform: scale(1.14); }
        }
        @keyframes critRed{
          0%{ opacity:0; transform: scale(.92); }
          25%{ opacity:1; transform: scale(1); }
          100%{ opacity:0; transform: scale(1.18); }
        }
      `;
      document.head.appendChild(style);
    }catch(_e){}
  }

  // call once (safe)
  ensureLegendaryDiceStyles();

  // ===== Dice realism: Pips etwas weiter nach innen + mehr Tiefe (nur Optik, safe) =====
  function ensureRealisticPipStyles(){
    try{
      if(document.getElementById("diceRealisticPipStyles")) return;
      const style = document.createElement("style");
      style.id = "diceRealisticPipStyles";
      style.textContent = `
        /* Pips: runder, mehr Tiefe, weniger 'aufgeklebt' */
        #diceCube .pip, #diceCube .dot, #diceCube .spot,
        #diceCube [class*="pip"], #diceCube [class*="dot"], #diceCube [class*="spot"]{
          border-radius: 999px !important;
          box-shadow:
            inset 0 2px 4px rgba(255,255,255,.22),
            inset 0 -5px 10px rgba(0,0,0,.55),
            0 2px 6px rgba(0,0,0,.35) !important;
          filter: saturate(1.05);
        }
        /* Würfelfläche: leichte Mikro-Struktur (wenn Face-Element existiert) */
        #diceCube .face, #diceCube .side, #diceCube .cube-face{
          overflow: hidden;
        }
        #diceCube .face::before, #diceCube .side::before, #diceCube .cube-face::before{
          content:"";
          position:absolute; inset:0;
          background:
            radial-gradient(circle at 30% 25%, rgba(255,255,255,.18), rgba(255,255,255,0) 40%),
            radial-gradient(circle at 70% 75%, rgba(0,0,0,.12), rgba(0,0,0,0) 45%);
          pointer-events:none;
          mix-blend-mode: overlay;
        }
      
        /* Glossy finish: specular highlight + subtle edge vignette */
        #diceCube .face::after, #diceCube .side::after, #diceCube .cube-face::after{
          content:"";
          position:absolute; inset:0;
          background:
            radial-gradient(circle at 28% 22%, rgba(255,255,255,.38), rgba(255,255,255,0) 45%),
            linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,0) 42%),
            radial-gradient(circle at 70% 78%, rgba(0,0,0,.18), rgba(0,0,0,0) 55%);
          pointer-events:none;
          mix-blend-mode: screen;
          opacity:.85;
        }
`;
      document.head.appendChild(style);
    }catch(_e){}
  }

  // Schiebt gefundene Pip-Elemente ein Stück nach innen (Samsung/Tablet safe).
  // Wir ändern NUR ein zusätzliches transform translate auf den Pips – keine Logik.
  
  // Pips auf echte Würfel-Optik zentrieren:
  // Wir remappen die Pip-Zentren Richtung Mitte (tablet/pc/handy identisch),
  // statt nur "translate" zu stapeln. Rein visuell, keine Spiel-Logik.
  function centerPipsRealistically(){
    try{
      if(!diceEl) return;

      const pipSel = [
        ".pip",".dot",".spot",
        "[data-pip]","[data-dot]","[data-spot]",
        "[class*='pip']","[class*='dot']","[class*='spot']"
      ].join(",");

      const all = Array.from(diceEl.querySelectorAll(pipSel));

      // Filter: wirklich nur kleine runde Punkte
      const pips = all.filter(el=>{
        const r = el.getBoundingClientRect();
        if(!(r.width>0 && r.height>0)) return false;
        if(r.width>90 || r.height>90) return false; // keine großen Elemente
        const cs = getComputedStyle(el);
        const br = cs.borderRadius || "";
        const looksRound = br.includes("999") || br.includes("%") || (parseFloat(br)||0) >= Math.min(r.width, r.height)/2 - 2;
        return looksRound;
      });

      if(!pips.length) return;

      // --- V8: Snap in ein zentriertes inneres 3x3 Raster (realistische Würfel-Geometrie) ---
      // Innerer Bereich (ohne "Rand/Rundung"): desto kleiner, desto "mittiger" wirken die Augen.
      const inset = 0.19;           // 19% Rand -> echte Würfeloptik
      const grid = [0, 0.5, 1];     // 3x3 Raster im inneren Quadrat

      // Hilfsfunktion: finde nächstes Raster-Index (0/1/2) aus aktueller relativer Position 0..1
      const snapIdx = (t) => (t < 0.35 ? 0 : (t > 0.65 ? 2 : 1));

      // Wir positionieren immer relativ zum jeweiligen Face-Parent
      const byParent = new Map();
      for(const pip of pips){
        const parent = pip.parentElement;
        if(!parent) continue;
        if(!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(pip);
      }

      for(const [parent, arr] of byParent.entries()){
        const pr = parent.getBoundingClientRect();
        if(pr.width <= 0 || pr.height <= 0) continue;

        const parentCS = getComputedStyle(parent);
        if(parentCS.position === "static") parent.style.position = "relative";

        const innerLeft = pr.width  * inset;
        const innerTop  = pr.height * inset;
        const innerW    = pr.width  * (1 - inset*2);
        const innerH    = pr.height * (1 - inset*2);

        for(const pip of arr){
          if(pip.dataset && pip.dataset.pipCenteredV8 === "1") continue;

          const rr = pip.getBoundingClientRect();
          if(rr.width <= 0 || rr.height <= 0) continue;

          pip.style.position = "absolute";

          // aktuelles Zentrum relativ im Parent
          const cx = rr.left + rr.width/2;
          const cy = rr.top  + rr.height/2;
          const rx = (cx - pr.left) / pr.width;   // 0..1
          const ry = (cy - pr.top)  / pr.height;  // 0..1

          // Grobe Zuordnung zu Rasterzelle (links/mitte/rechts, oben/mitte/unten)
          const ix = snapIdx(rx);
          const iy = snapIdx(ry);

          // Zielzentrum im inneren Raster
          const tx = innerLeft + innerW * grid[ix];
          const ty = innerTop  + innerH * grid[iy];

          // Links/Top so setzen, dass pip zentriert ist
          pip.style.left = `${(tx - rr.width/2).toFixed(1)}px`;
          pip.style.top  = `${(ty - rr.height/2).toFixed(1)}px`;

          // Überschreibe translate, falls vorhanden (sonst verschiebt Samsung Internet es wieder)
          const st = pip.style.transform || "";
          pip.style.transform = st
            .replace(/translate3d\([^)]+\)/g, "")
            .replace(/translate\([^)]+\)/g, "")
            .trim();

          pip.dataset.pipCenteredV8 = "1";
        }
      }
    }catch(_e){}
  }

  ensureRealisticPipStyles();



  // nach dem Rendern ein paar mal versuchen (weil der Würfel/DOM manchmal später kommt)
  try{
    let triesP=0;
    const tp=setInterval(()=>{
      triesP++;
      centerPipsRealistically();
      if(triesP>25) clearInterval(tp);
    }, 120);
  }catch(_e){}


  // Online
  const serverLabel = $("serverLabel");
  const roomCodeInp = $("roomCode");
  const hostBtn = $("hostBtn");
  const joinBtn = $("joinBtn");
  const leaveBtn= $("leaveBtn");
  const netStatus = $("netStatus");
  const netPlayersEl = $("netPlayers");
  const myColorEl = $("myColor");

  // Color picker (A1.1)
  // NOTE: Manche index.html Versionen enthalten die Elemente nicht.
  // Damit du NUR game.js tauschen musst, erzeugen wir sie sicher per JS.
  let colorPickWrap = $("colorPick");
  let btnPickRed = $("pickRed");
  let btnPickBlue = $("pickBlue");
  let btnPickGreen = $("pickGreen");
  let btnPickYellow = $("pickYellow");

  // Server can tell which colors are currently supported online.
  // (Additiv: if missing, fallback to red/blue)
  let allowedColorsOnline = new Set(["red","blue"]);

  let _colorPickBound = false;

  function bindColorPickHandlers(){
    if(_colorPickBound) return;
    if(!btnPickRed || !btnPickBlue) return;
    _colorPickBound = true;
    btnPickRed.addEventListener("click", ()=> requestColor("red"));
    btnPickBlue.addEventListener("click", ()=> requestColor("blue"));
    if(btnPickGreen) btnPickGreen.addEventListener("click", ()=> requestColor("green"));
    if(btnPickYellow) btnPickYellow.addEventListener("click", ()=> requestColor("yellow"));
  }

  function ensureColorPickerUI(){
    try{
      if(colorPickWrap && btnPickRed && btnPickBlue) return;

      // Wir haengen den Farbwähler unter die Online-Buttons (Host/Beitreten/Trennen),
      // wenn moeglich.
      const anchor = leaveBtn?.parentElement || hostBtn?.parentElement || document.body;
      if(!anchor) return;

      // Wrapper
      colorPickWrap = document.createElement('div');
      colorPickWrap.id = 'colorPick';
      colorPickWrap.style.marginTop = '10px';
      colorPickWrap.style.display = 'block';

      const title = document.createElement('div');
      title.textContent = 'Farbe wählen (vor Spielstart)';
      title.style.fontWeight = '700';
      title.style.opacity = '0.9';
      title.style.marginBottom = '6px';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.flexWrap = 'wrap';

      const mkBtn = (id, label) => {
        const b = document.createElement('button');
        b.id = id;
        b.className = 'btn';
        b.type = 'button';
        b.textContent = label;
        b.style.minWidth = '110px';
        return b;
      };

      btnPickRed = mkBtn('pickRed', '🔴 Rot');
      btnPickBlue = mkBtn('pickBlue', '🔵 Blau');
      // Falls du spaeter 3/4 Spieler aktivierst, sind die Buttons schon vorbereitet.
      btnPickGreen = mkBtn('pickGreen', '🟢 Grün');
      btnPickYellow = mkBtn('pickYellow', '🟡 Gelb');
      // Sichtbar lassen – online ggf. automatisch gesperrt ("bald").

      row.appendChild(btnPickRed);
      row.appendChild(btnPickBlue);
      row.appendChild(btnPickGreen);
      row.appendChild(btnPickYellow);

      const hint = document.createElement('div');
      hint.id = 'colorPickHint';
      hint.style.marginTop = '6px';
      hint.style.opacity = '0.75';
      hint.style.fontSize = '12px';
      hint.textContent = 'Du kannst die Wunschfarbe auch offline auswählen – sie wird beim Join gesendet.';

      colorPickWrap.appendChild(title);
      colorPickWrap.appendChild(row);
      colorPickWrap.appendChild(hint);

      // Einfügen: nach der Button-Reihe (Host/Beitreten/Trennen)
      // Einfügen: nach der Button-Reihe (Host/Beitreten/Trennen)
      // WICHTIG: anchor ist oft die Button-Reihe selbst (Flex). Dann würde der Picker unsichtbar "weggequetscht".
      // Deshalb: wenn anchor eine Zeile ist -> nach der Zeile einfügen.
      if(anchor && anchor.insertAdjacentElement){
        anchor.insertAdjacentElement('afterend', colorPickWrap);
      }else{
        anchor.appendChild(colorPickWrap);
      }

      // Handler erst NACH dem Erzeugen binden.
      // (Wenn Elemente im HTML vorhanden sind, bindet das spaeter auch.)
      bindColorPickHandlers();
    }catch(_e){}
  }

  // sofort versuchen, UI zu erzeugen (rein additiv)
  ensureColorPickerUI();
  // Wichtig: Manche HTML-Versionen haben #colorPick initial auf display:none.
  // Wenn man noch OFFLINE ist, kam frueher kein room_update -> UI blieb unsichtbar.
  // Daher initial einmal aktualisieren.
  try{ updateColorPickUI(); }catch(_e){}

  // Overlay
  const overlay = $("overlay");
  const overlayTitle = $("overlayTitle");
  const overlaySub = $("overlaySub");
  const overlayHint = $("overlayHint");
  const overlayOk = $("overlayOk");

  const CSS = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const COLORS = {
    node: CSS("--node"), stroke: CSS("--stroke"),
    edge: CSS("--edge"),
    goal: CSS("--goal"), run: CSS("--run"),
    red: CSS("--red"), blue: CSS("--blue"), green: CSS("--green"), yellow: CSS("--yellow"),
  };

  const DEFAULT_PLAYERS = ["red","blue","green","yellow"];
  const PLAYER_NAME = {red:"Rot", blue:"Blau", green:"Grün", yellow:"Gelb"};

  let PLAYERS = ["red","blue"];
  function setPlayers(arg){
    if(Array.isArray(arg)){
      const order = {red:0, blue:1, green:2, yellow:3};
      const uniq=[], seen=new Set();
      for(const c of arg){
        if(!order.hasOwnProperty(c)) continue;
        if(seen.has(c)) continue;
        seen.add(c); uniq.push(c);
      }
      uniq.sort((a,b)=>order[a]-order[b]);
      PLAYERS = uniq.length ? uniq : ["red","blue"];
      return;
    }
    const n = Math.max(2, Math.min(4, Number(arg)||2));
    PLAYERS = DEFAULT_PLAYERS.slice(0, n);
  }

  // ===== Board =====
  let board=null, nodeById=new Map(), adj=new Map(), runNodes=new Set();
  let goalNodeId=null, startNodeId={red:null,blue:null,green:null,yellow:null};

  // Camera
  let dpr=1, view={x:40,y:40,s:1,_fittedOnce:false};

  const AUTO_CENTER_ALWAYS = true; // immer beim Start zentrieren (überschreibt gespeicherte Ansicht)
  let pointerMap=new Map(), isPanning=false, panStart=null;

  // ===== View persistence (Tablet-safe) =====
  const VIEW_KEY = "barikade_view_v2";
  let lastTapTs = 0;
  let lastTapPos = null;

  function saveView(){
    try{
      const data = { x:view.x, y:view.y, s:view.s, ts:Date.now() };
      localStorage.setItem(VIEW_KEY, JSON.stringify(data));
    }catch(_e){}
  }
  function loadView(){
    try{
      const raw = localStorage.getItem(VIEW_KEY);
      if(!raw) return false;
      const v = JSON.parse(raw);
      if(!v || typeof v!=="object") return false;
      if(typeof v.x!=="number" || typeof v.y!=="number" || typeof v.s!=="number") return false;
      // sanity
      if(!(v.s>0.05 && v.s<20)) return false;
      view.x = v.x; view.y = v.y; view.s = v.s;
      view._fittedOnce = true; // we have an explicit view
      return true;
    }catch(_e){ return false; }
  }
  function clearView(){
    try{ localStorage.removeItem(VIEW_KEY); }catch(_e){}
    view._fittedOnce = false;
  }

  // ===== Game state =====
  let phase = "need_roll";            // need_roll | need_move | placing_barricade | game_over
  let legalTargets = [];
  let placingChoices = [];

  function setPhase(p){ phase=p; if(state) state.phase=p; }
  function setPlacingChoices(arr){
    placingChoices = Array.isArray(arr) ? arr : [];
    if(state) state.placingChoices = [...placingChoices];
  }

  let selected=null;
  let legalMovesAll=[];
  let legalMovesByPiece=new Map();
  let state=null;

  function clearLocalState(){
    state = null;
    legalMovesByPiece = new Map();
    // UI reset
    if(turnText) turnText.textContent = '–';
    if(turnDot) turnDot.className = 'dot';
    lastDiceFace = 0;
    if(diceEl) diceEl.setAttribute('data-face','0');
    updateStartButton();
    draw();
  }

  // ===== FX (safe, visual only) =====
  let lastDiceFace = 0;
  let _diceFlickerTimer = null;
  let _diceFlickerStop = null;

  let lastMoveFx = null;
  let moveGhostFx = null;

  // ===== Animation loop for move FX =====
  // Ohne requestAnimationFrame wird nur 1 Frame gezeichnet → wirkt wie Teleport.
  // Das Loop läuft nur solange FX aktiv sind (CPU-schonend) und sorgt auch dafür,
  // dass die Figur am Endfeld sofort sichtbar bleibt.
  let _raf = null;
  function _fxActive(now=performance.now()){
    try{
      if(lastMoveFx && lastMoveFx.pts && (now - lastMoveFx.t0) < 900) return true;
      if(moveGhostFx && moveGhostFx.pts && (now - moveGhostFx.t0) < (moveGhostFx.dur||0)) return true;
    }catch(_e){}
    return false;
  }
  function requestDrawLoop(){
    if(_raf!=null) return;
    _raf = requestAnimationFrame(function step(){
      _raf = null;
      if(!board || !state) return;
      draw();
      if(_fxActive()) requestDrawLoop();
    });
  }

  // Step-by-step move animation (visual override so it doesn't look like teleport)
  let moveAnim = null;   // { pieceId, color, nodes:[{x,y,id}], t0, stepMs, hop, totalMs }
  let animPieceId = null;
  let rafDrawId = 0;

  // ===== Online =====
  const SERVER_URL = "wss://spiel-server.onrender.com";
  if(serverLabel) serverLabel.textContent = SERVER_URL;

  let ws=null;
  let netMode="offline";
  let netCanStart=false;    // offline | host | client
  let roomCode="";
  let clientId="";
  let lastNetPlayers=[];
  let rosterById=new Map();
  let myColor=null;

  let reconnectTimer=null;
  let reconnectAttempt=0;
  let pendingIntents=[];

  // ===== Host Auto-Save (Browser) =====
  // Robust against Render sleep/restart: host stores last server snapshot in localStorage.
  function autosaveKey(){
    const rc = roomCode || (roomCodeInp ? normalizeRoomCode(roomCodeInp.value) : "");
    return `barikade_host_autosave_${rc || "room"}`;
  }
  function setAutoSaveInfo(text){
    if(!autoSaveInfo) return;
    autoSaveInfo.style.display = text ? "block" : "none";
    autoSaveInfo.textContent = text ? `Auto‑Save: ${text}` : "";
  }
  function writeHostAutosave(serverState){
    // only host writes autosave
    if(netMode === "offline" || !isMeHost()) return;
    if(!serverState || typeof serverState !== "object") return;
    try{
      const payload = { room: roomCode || "", ts: Date.now(), state: serverState };
      localStorage.setItem(autosaveKey(), JSON.stringify(payload));
      const t = new Date(payload.ts);
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      setAutoSaveInfo(`${hh}:${mm}:${ss}`);
    }catch(_e){ /* ignore */ }
  }
  function readHostAutosave(){
    try{
      const raw = localStorage.getItem(autosaveKey());
      if(!raw) return null;
      const v = JSON.parse(raw);
      if(!v || typeof v !== "object") return null;
      if(!v.state || typeof v.state !== "object") return null;
      return v;
    }catch(_e){ return null; }
  }

  function randId(len=10){
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s=""; for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
    return s;
  }
  function normalizeRoomCode(s){
    return (s||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
  }
  function safeJsonParse(s){ try{ return JSON.parse(s); }catch(_e){ return null; } }

  // ===== Wunschfarbe (Lobby) =====
  // Additiv: beeinflusst Reconnect/Save NICHT. Nur ein Wunsch vor Spielstart.
  function reqColorKey(){
    const rc = roomCode || (roomCodeInp ? normalizeRoomCode(roomCodeInp.value) : "");
    return "barikade_requested_color_" + (rc || "room");
  }
  function getRequestedColor(){
    try{
      const v = localStorage.getItem(reqColorKey()) || localStorage.getItem("barikade_requested_color") || "";
      const c = String(v).toLowerCase().trim();
      return (c==="red"||c==="blue"||c==="green"||c==="yellow") ? c : null;
    }catch(_e){ return null; }
  }
  function setRequestedColor(c){
    const v = (c==="red"||c==="blue"||c==="green"||c==="yellow") ? c : "";
    try{
      if(v) localStorage.setItem(reqColorKey(), v); else localStorage.removeItem(reqColorKey());
      // global fallback for old sessions
      if(v) localStorage.setItem("barikade_requested_color", v);
    }catch(_e){}
  }

  function isLobbyPhase(){
    // Server-Game nutzt state.started
    return !(state && state.started);
  }

  function usedColorsSet(){
    const used = new Set();
    for(const pl of (lastNetPlayers||[])){
      if(pl && pl.color) used.add(String(pl.color).toLowerCase());
    }
    return used;
  }

  function updateColorPickUI(){
    // Falls UI fehlt (alte index.html), nacherzeugen.
    if(!colorPickWrap || !btnPickRed || !btnPickBlue){
      ensureColorPickerUI();
    }
    if(!colorPickWrap) return;

    // Farbauswahl nur vor Spielstart (Lobby). Auch offline anzeigen,
    // damit man die Wunschfarbe schon VOR dem Verbinden festlegen kann.
    const show = isLobbyPhase();
    colorPickWrap.style.display = show ? "block" : "none";
    if(!show) return;

    const used = usedColorsSet();
    const want = getRequestedColor();

    // Online-Server unterstuetzt aktuell nur Rot/Blau (server.js: ALLOWED_COLORS).
    // Gruen/Gelb bleiben sichtbar (falls du spaeter 3/4 Spieler aktivierst),
    // sind aber online gesperrt, damit man keinen Server-Fehler provoziert.
    const onlineLimited = (netMode !== "offline");
    const onlineAllowed = allowedColorsOnline || new Set(["red","blue"]);

    function configBtn(btn, color){
      if(!btn) return;
      const c = String(color).toLowerCase();
      const mine = (myColor === c);
      const takenByOther = used.has(c) && !mine;

      const supportedOnline = !onlineLimited || onlineAllowed.has(c);

      btn.disabled = takenByOther || !supportedOnline;
      btn.style.opacity = (takenByOther || !supportedOnline) ? "0.4" : "1";

      // active mark: current wish or my assigned color
      const active = (want === c) || mine;
      btn.classList.toggle("active", !!active);

      // label add: show lock
      const base = (c==="red") ? "🔴 Rot" : (c==="blue") ? "🔵 Blau" : (c==="green") ? "🟢 Grün" : "🟡 Gelb";
      if(!supportedOnline){
        btn.textContent = base + " (bald)";
      } else {
        btn.textContent = takenByOther ? (base + " 🔒") : base;
      }
    }

    configBtn(btnPickRed, "red");
    configBtn(btnPickBlue, "blue");
    configBtn(btnPickGreen, "green");
    configBtn(btnPickYellow, "yellow");
  }


  function setNetStatus(text, good){
    if(!netStatus) return;
    netStatus.textContent = text;
    netStatus.style.color = good ? "var(--green)" : "var(--muted)";
  }

  function wsSend(obj){
    if(!ws || ws.readyState!==1) return false;
    try{ ws.send(JSON.stringify(obj)); return true; }catch(_e){ return false; }
  }

  function setNetPlayers(list){
    lastNetPlayers = Array.isArray(list) ? list : [];
    rosterById = new Map();
    for(const p of lastNetPlayers){ if(p && p.id) rosterById.set(p.id, p); }

    const me = rosterById.get(clientId);
    myColor = (me && me.color) ? me.color : null;

    if(myColorEl){
      myColorEl.textContent = myColor ? PLAYER_NAME[myColor] : "–";
      myColorEl.style.color = myColor ? COLORS[myColor] : "var(--muted)";
    updateStartButton();
    }
    updateColorPickUI();

    // Host: keep state players in sync with chosen colors
    if(netMode==="host" && state){
      const active = getActiveColors();
      const prev = Array.isArray(state.players) ? state.players : [];
      const same = prev.length===active.length && prev.every((c,i)=>c===active[i]);
      if(!same){
        setPlayers(active);
        state.players = [...PLAYERS];
        state.pieces = state.pieces || {};
        for(const c of PLAYERS){
          if(!state.pieces[c]) state.pieces[c] = Array.from({length:5},()=>({pos:"house"}));
        }
        if(!state.players.includes(state.currentPlayer)){
          state.currentPlayer = state.players[0];
          setPhase("need_roll");
          state.dice=null;
        }
        broadcastState("snapshot");
      }
    }

    if(netPlayersEl){
      if(!lastNetPlayers.length){ netPlayersEl.textContent="–"; return; }
      const parts = lastNetPlayers.map(p=>{
        const name = p.name || p.id || "Spieler";
        const role = p.role ? `(${p.role})` : "";
        const col  = p.color ? `· ${PLAYER_NAME[p.color]}` : "";
        const con  = (p.connected===false) ? " ✖" : " ✔";
        return `${name} ${role} ${col}${con}`;
      });
      netPlayersEl.textContent = parts.join(" · ");
    }

    // host-only controls visibility
    updateHostToolsUI();
  }

  function updateStartButton(){
    if(!startBtn) return;
    const me = rosterById.get(clientId);
    const amHost = !!(me && me.isHost);
    const hasState = !!(state && state.started);
    startBtn.disabled = !(amHost && netCanStart && !hasState);
    startBtn.textContent = hasState ? 'Spiel läuft' : 'Spiel starten';
  }

  function isMeHost(){
    const me = rosterById.get(clientId);
    return !!(me && me.isHost);
  }

  // Host-only UI block (Save/Load)
  function updateHostToolsUI(){
    const show = (netMode !== "offline") && isMeHost();
    if(hostTools) hostTools.style.display = show ? "flex" : "none";
    if(autoSaveInfo) autoSaveInfo.style.display = show ? "block" : "none";
    if(restoreBtn){
      const has = !!readHostAutosave();
      restoreBtn.disabled = !(show && has);
      restoreBtn.style.opacity = (show && has) ? "1" : "0.6";
    }
  }

  function scheduleReconnect(){
    if(reconnectTimer) return;
    reconnectAttempt++;
    const delay = Math.min(12000, 600 * Math.pow(1.6, reconnectAttempt));
    setNetStatus(`Reconnect in ${Math.round(delay/1000)}s…`, false);
    reconnectTimer = setTimeout(()=>{ reconnectTimer=null; connectWS(); }, delay);
  }
  function stopReconnect(){
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
    reconnectAttempt = 0;
  }

  function connectWS(){
    if(!roomCode) return;
    if(ws && (ws.readyState===0 || ws.readyState===1)) return;

    setNetStatus("Verbinden…", false);
    
    view._fittedOnce = false;
try{ ws = new WebSocket(SERVER_URL); }
    catch(_e){ setNetStatus("WebSocket nicht möglich", false); scheduleReconnect(); return; }

    ws.onopen = () => {
      stopReconnect();
      hideNetBanner();
      setNetStatus("Verbunden – join…", true);

      const sessionToken = getSessionToken();
      wsSend({
        type: "join",
        room: roomCode,
        name: (netMode === "host" ? "Host" : "Client"),
        asHost: (netMode === "host"),
        sessionToken,
        requestedColor: getRequestedColor(),
        ts: Date.now()
      });
    };

    ws.onmessage = (ev) => {
      const msg = (typeof ev.data==="string") ? safeJsonParse(ev.data) : null;
      if(!msg) return;
      const type = msg.type;

      if(type==="hello"){
        if(msg.clientId) clientId = msg.clientId;
        return;
      }
      if(type==="room_update"){
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        if(Array.isArray(msg.allowedColors)){
          const s = new Set();
          for(const c of msg.allowedColors){
            const cc = String(c||"").toLowerCase().trim();
            if(cc) s.add(cc);
          }
          if(s.size) allowedColorsOnline = s;
        }
        netCanStart = !!msg.canStart;
        updateStartButton();
        return;
      }
      if(type==="snapshot" || type==="started" || type==="place_barricade"){
        if(msg.state){
          applyRemoteState(msg.state);
          writeHostAutosave(msg.state);

          // Glücksrad anzeigen, falls vorhanden (rein UI)
          if(msg.state.wheel && msg.state.wheel.starterColor){
            showWheelStart(
              msg.state.wheel.activeColors || msg.state.activeColors || [],
              msg.state.wheel.starterColor,
              msg.state.wheel.endsAt
            );
          }
        }
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        return;
      }
      if(type==="wheel_done"){
  if(msg.state){
    applyRemoteState(msg.state);
    writeHostAutosave(msg.state);
  }
  hideWheel();
  if(Array.isArray(msg.players)) setNetPlayers(msg.players);
  return;
}

if(type==="roll"){
        // (108/26) small suspense + particles
        if(typeof msg.value==="number") setDiceFaceAnimated(msg.value);
        if(msg.state){
          applyRemoteState(msg.state);
          writeHostAutosave(msg.state);
        }
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        return;
      }
      if(type==="move"){
        // (7/8/109) animate path + destination glow
        if(msg.action) queueMoveFx(msg.action);
        if(msg.state){
          applyRemoteState(msg.state);
          writeHostAutosave(msg.state);
        }
        if(Array.isArray(msg.players)) setNetPlayers(msg.players);
        return;
      }

      // Host Save/Load: server sends back a JSON snapshot for download
      if(type==="export_state"){
        pendingSaveExport = false;
        const ok = downloadJSON(msg.state ?? null, `barikade_save_${roomCode || "room"}.json`);
        toast(ok ? "Save heruntergeladen" : "Save fehlgeschlagen");
        return;
      }

      if(type==="error"){
        const code = msg.code || "";
        const message = msg.message || "Server-Fehler";
        // If server has no running game state (e.g. after restart), unlock manual start.
        if(code==="NO_STATE" || /Spiel nicht gestartet/i.test(message)){
          debugLog("[server:NO_STATE]", code, message);
          // WICHTIG: lokalen Snapshot NICHT löschen – sonst kann man nach Reconnect nichts mehr sichern.
          // Falls gerade ein Save angefordert wurde, mache stattdessen einen Offline-Save aus dem letzten Snapshot.
          if(pendingSaveExport && state){
            pendingSaveExport = false;
            const st = serializeState();
            const ok = downloadJSON(st, `barikade_save_offline_${roomCode || "room"}.json`);
            toast(ok ? "Server ohne Spielstand – Offline-Save heruntergeladen" : "Offline-Save fehlgeschlagen");
            return;
          }
          pendingSaveExport = false;
          // UI-Hinweis statt Reset:
          const hasAuto = !!readHostAutosave();
          if(isMeHost() && hasAuto){
            showNetBanner("Server war offline/sleep (kein Spielstand). Klicke als Host auf \"Restore\" (Auto‑Save) oder \"Load\" (JSON).");
          }else{
            showNetBanner("Kein Spielstand am Server. Nutze Load (JSON) oder starte neu.");
          }
          updateHostToolsUI();
          return;
        }
        toast(message);
        return;
      }
      if(type==="pong") return;
    };

    ws.onerror = () => { setNetStatus("Fehler – Reconnect…", false); showNetBanner("Verbindungsfehler – Reconnect läuft…"); };
    ws.onclose = () => {
      setNetStatus("Getrennt – Reconnect…", false);
      showNetBanner("Verbindung getrennt – Reconnect läuft…");
      if(netMode!=="offline") scheduleReconnect();
    };
  }

  function disconnectWS(){
    stopReconnect();
    if(ws){
      try{ ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null; ws.close(); }catch(_e){}
      ws=null;
    }
    setNetStatus("Offline", false);
    hideNetBanner();
    updateHostToolsUI();
  }

  function saveSession(){
    try{
      localStorage.setItem("barikade_room", roomCode||"");
      localStorage.setItem("barikade_mode", netMode||"offline");
      localStorage.setItem("barikade_clientId", clientId||"");
    }catch(_e){}
  }
  function loadSession(){
    try{
      return {
        r: localStorage.getItem("barikade_room")||"",
        m: localStorage.getItem("barikade_mode")||"offline",
        id: localStorage.getItem("barikade_clientId")||""
      };
    }catch(_e){ return {r:"", m:"offline", id:""}; }
  }

  // Server uses sessionToken to reconnect a "slot" (same color) after refresh.
  function getSessionToken(){
    try{
      let t = localStorage.getItem("barikade_sessionToken") || "";
      if(!t){
        t = "S-" + randId(16);
        localStorage.setItem("barikade_sessionToken", t);
      }
      return t;
    }catch(_e){
      return "S-" + randId(16);
    }
  }

  function chooseColor(color){
    // Store requested color for this room (used on join + reconnect)
    try{
      if(currentRoom){
        localStorage.setItem("barikade_reqColor_"+currentRoom, String(color));
      }
    }catch(_e){}

    // If online & already connected, ask server immediately
    if(netMode==="online" && ws && ws.readyState===1){
      wsSend({type:"request_color", room: currentRoom, sessionToken: sessionToken, color: String(color)});
    } else {
      // If not connected yet, we reconnect so the next join includes requestedColor
      toast("Farbe gespeichert. Beim Beitreten/Reconnect wird sie angefragt.");
    }
  }

  function getActiveColors(){
    if(netMode==="offline") return [...PLAYERS];
    const order=["red","blue","green","yellow"];
    const colors=[], seen=new Set();
    for(const p of lastNetPlayers){
      if(!p || !p.color) continue;
      if(seen.has(p.color)) continue;
      seen.add(p.color);
      colors.push(p.color);
    }
    colors.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    return colors.length>=2 ? colors : ["red","blue"];
  }

  // ===== State sync =====
  function applyRemoteState(remote){
    const st = (typeof remote==="string") ? safeJsonParse(remote) : remote;
    if(!st || typeof st!=="object") return;

    // --- Server-state adapter (serverfinal protocol) ---
    // server state: {turnColor, phase, rolled, pieces:[{id,color,posKind,houseId,nodeId}], barricades:[...], goal}
    if(st.turnColor && Array.isArray(st.pieces) && Array.isArray(st.barricades)){
      const server = st;
      // In Online-Mode we ALWAYS render all 4 Farben (auch wenn nicht gewählt),
      // damit Gelb/Grün im Haus sichtbar bleiben.
      const players = ["red","blue","green","yellow"];
      setPlayers(players);
      const piecesByColor = {red:[], blue:[], green:[], yellow:[]};
      // ensure 5 slots per color
      for(const c of players) piecesByColor[c] = Array.from({length:5}, ()=>({pos:"house"}));

      for(const pc of server.pieces){
        if(!pc || !pc.color || !piecesByColor[pc.color]) continue;
        // pc.label is 1..5
        const idx = Math.max(0, Math.min(4, Number(pc.label||1)-1));
        let pos = "house";
        if(pc.posKind==="board" && pc.nodeId) pos = String(pc.nodeId);
        else if(pc.posKind==="goal") pos = "goal";
        else pos = "house";
        piecesByColor[pc.color][idx] = {pos, pieceId: pc.id};
      }

      state = {
        started: true,
        players,
        currentPlayer: server.turnColor,
        dice: (server.rolled==null ? null : Number(server.rolled)),
        phase: server.phase,
        placingChoices: [],
        pieces: Object.fromEntries(players.map(c => [c, piecesByColor[c] || []])),
        barricades: new Set(server.barricades.map(String)),
        winner: null,
        goalNodeId: server.goal ? String(server.goal) : goalNodeId,
        // optional info from server (used by some UIs)
        activeColors: Array.isArray(server.activeColors) ? server.activeColors.slice() : null
      };

      // map phases
      const ph = server.phase;
      if(ph==="need_roll") phase="need_roll";
      else if(ph==="need_move") phase="need_move";
      else if(ph==="place_barricade") phase="placing_barricade";
      else phase="need_roll";

      // show dice
      setDiceFaceAnimated(state.dice==null ? 0 : Number(state.dice));
      if(barrInfo) barrInfo.textContent = String(state.barricades.size);

      // in online mode we let the server validate moves, so don't compute legalTargets
      legalTargets = [];
      legalMovesAll = [];
      legalMovesByPiece = new Map();
      placingChoices = [];
      updateTurnUI(); updateStartButton(); draw();
      ensureFittedOnce();
      return;
    }

    if(st.barricades && Array.isArray(st.barricades)) st.barricades = new Set(st.barricades);
    state = st;

    if(st.players && Array.isArray(st.players) && st.players.length>=2) setPlayers(st.players);

    if(typeof st.phase === "string") phase = st.phase;
    else phase = st.winner ? "game_over" : (st.dice==null ? "need_roll" : "need_move");

    placingChoices = Array.isArray(st.placingChoices) ? st.placingChoices : [];

    if(phase==="need_move" && st.dice!=null && !st.winner){
      legalMovesAll = computeLegalMoves(st.currentPlayer, st.dice);
      legalMovesByPiece = new Map();
      for(const m of legalMovesAll){
        const idx = m.piece.index;
        if(!legalMovesByPiece.has(idx)) legalMovesByPiece.set(idx, []);
        legalMovesByPiece.get(idx).push(m);
      }
      legalTargets = legalMovesAll;
    }else{
      legalTargets = [];
      legalMovesAll = [];
      legalMovesByPiece = new Map();
      if(phase!=="placing_barricade") selected=null;
    }

    if(barrInfo) barrInfo.textContent = String(state.barricades?.size ?? 0);
    setDiceFaceAnimated(state.dice==null ? 0 : Number(state.dice));
    updateTurnUI(); updateStartButton(); draw();
      ensureFittedOnce();
  }

  function serializeState(){
    const st = JSON.parse(JSON.stringify(state));
    if(state.barricades instanceof Set) st.barricades = Array.from(state.barricades);
    st.players = state?.players ? [...state.players] : [...PLAYERS];
    st.phase = phase;
    st.placingChoices = Array.isArray(placingChoices) ? [...placingChoices] : [];
    return st;
  }

  function broadcastState(kind="state"){
    if(netMode!=="host") return;
    wsSend({type:kind, room:roomCode, state:serializeState(), ts:Date.now()});
  }

  function sendIntent(intent){
    const msg = {type:"intent", room:roomCode, clientId, intent, ts:Date.now()};
    if(!wsSend(msg)) pendingIntents.push(msg);
  }

  // ===== Game =====
  
  function downloadJSON(obj, filename){
    try{
      const payload = JSON.stringify(obj ?? null, null, 2);
      const blob = new Blob([payload], {type:"application/json"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || "barikade_save.json";
      a.click();
      setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(_e){} }, 1200);
      return true;
    }catch(_e){
      return false;
    }
  }

function toast(msg){
    if(!toastEl) return;
    toastEl.textContent=msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t=setTimeout(()=>toastEl.classList.remove("show"), 1200);
  }


  // ===== Visual helpers (safe) =====
  function showNetBanner(text){
    if(!netBannerEl) return;
    netBannerEl.textContent = text || "";
    netBannerEl.classList.add("show");
  }
  function hideNetBanner(){
    if(!netBannerEl) return;
    netBannerEl.classList.remove("show");
  }

  function spawnDiceParticles(){
    if(!diceEl) return;
    const host = diceEl.parentElement;
    if(!host) return;
    const rect = diceEl.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const cx = (rect.left - hostRect.left) + rect.width/2;
    const cy = (rect.top - hostRect.top) + rect.height/2;

    const count = 12;
    for(let i=0;i<count;i++){
      const el = document.createElement("div");
      el.className = "diceParticle";
      el.style.left = (cx-3) + "px";
      el.style.top  = (cy-3) + "px";
      const ang = Math.random()*Math.PI*2;
      const dist = 14 + Math.random()*20;
      const dx = Math.cos(ang)*dist;
      const dy = Math.sin(ang)*dist;
      el.style.setProperty("--dx", dx.toFixed(1) + "px");
      el.style.setProperty("--dy", dy.toFixed(1) + "px");
      host.appendChild(el);
      setTimeout(()=>{ try{ el.remove(); }catch(_e){} }, 650);
    }
  }

  function setDiceFaceAnimated(v){
    if(!diceEl) return;
    const face = (v>=1 && v<=6) ? v : 0;

    // clear any previous roll timers (visual only)
    try{
      if(_diceFlickerTimer){ clearInterval(_diceFlickerTimer); _diceFlickerTimer=null; }
      if(_diceFlickerStop){ clearTimeout(_diceFlickerStop); _diceFlickerStop=null; }
    }catch(_e){}

    // reset helper classes
    try{
      diceEl.classList.remove("legend-roll","legend-ping","legend-crit6","legend-crit1");
    }catch(_e){}

    if(face===0){
      diceEl.dataset.face = "0";
      lastDiceFace = 0;
      return;
    }

    const sameAsBefore = (face === lastDiceFace);
    lastDiceFace = face;

    // start legendary roll animation
    // - flicker faces quickly for suspense
    // - then settle on final face and keep it until next roll
    try{
      // restart animation class reliably
      diceEl.classList.remove("legend-roll");
      void diceEl.offsetWidth;
      diceEl.classList.add("legend-roll");

      // also keep old shake (if CSS exists)
      diceEl.classList.remove("shake");
      void diceEl.offsetWidth;
      diceEl.classList.add("shake");
    }catch(_e){}

    // Flicker: 10–14 quick random faces (visual only)
    const t0 = performance.now();
    _diceFlickerTimer = setInterval(()=>{
      try{
        const r = 1 + Math.floor(Math.random()*6);
        diceEl.dataset.face = String(r);
      }catch(_e){}
      // hard stop safety
      if(performance.now() - t0 > 520){
        try{ clearInterval(_diceFlickerTimer); }catch(_e){}
        _diceFlickerTimer=null;
      }
    }, 45);

    // particles (existing)
    try{ spawnDiceParticles(); }catch(_e){}

    // settle on real result
    _diceFlickerStop = setTimeout(()=>{
      try{
        if(_diceFlickerTimer){ clearInterval(_diceFlickerTimer); _diceFlickerTimer=null; }
      }catch(_e){}
      try{
        diceEl.dataset.face = String(face);
        diceEl.classList.remove("shake");
        // if same face, give a small ping so it still feels alive
        if(sameAsBefore){
          diceEl.classList.remove("legend-ping");
          void diceEl.offsetWidth;
          diceEl.classList.add("legend-ping");
        }
        // crit effects
        if(face===6) diceEl.classList.add("legend-crit6");
        if(face===1) diceEl.classList.add("legend-crit1");
        // remove crit classes after a moment (visual only)
        setTimeout(()=>{
          try{ diceEl.classList.remove("legend-crit6","legend-crit1","legend-ping"); }catch(_e){}
        }, 1000);
      }catch(_e){}
    }, 560);
  }

  function parseColorFromPieceId(pieceId){
    const s = String(pieceId||"");
    // expected: p_red_1, p_blue_3 ...
    if(s.includes("red")) return "red";
    if(s.includes("blue")) return "blue";
    if(s.includes("green")) return "green";
    if(s.includes("yellow")) return "yellow";
    return null;
  }

  function queueMoveFx(action){
    if(!action || !board) return;
    const path = Array.isArray(action.path) ? action.path.map(String) : [];
    if(path.length < 2) return;

    const color = parseColorFromPieceId(action.pieceId) || "white";

    // Build WORLD nodes for the path (screen coords are calculated during draw so zoom/pan stays correct)
    const nodes=[];
    for(const id of path){
      const n = nodeById.get(String(id));
      if(!n) continue;
      nodes.push({ x:n.x, y:n.y, id:String(id) });
    }
    if(nodes.length < 2) return;

    const steps = nodes.length - 1;

    // Per-step duration (tweak feel here). Total scales with steps so it never looks like teleport.
    const stepMs = 220; // 180..260 feels good
    const totalMs = Math.min(2400, Math.max(420, steps * stepMs));

    const now = performance.now();

    // Trail/highlight (optional)
    const pts = nodes.map(n => worldToScreen(n));
    lastMoveFx = { color: color || "white", pts, t0: now, dur: totalMs };

    // Disable old sliding-ghost (we render the real piece as a visual override)
    moveGhostFx = null;

    // Real piece animation override
    moveAnim = {
      pieceId: String(action.pieceId),
      color: color || "white",
      nodes,
      t0: now,
      stepMs,
      hop: 16,       // hop height in px-ish (scaled with zoom below)
      totalMs
    };
    animPieceId = moveAnim.pieceId;
    isAnimatingMove = true;

    requestDraw();
  }

  function showOverlay(title, sub, hint){
    overlayTitle.textContent=title;
    overlaySub.textContent=sub||"";
    overlayHint.textContent=hint||"";
    overlay.classList.add("show");
  }
  function hideOverlay(){ overlay.classList.remove("show"); }
  overlayOk.addEventListener("click", hideOverlay);

  async function loadBoard(){
    const res = await fetch("board.json", {cache:"no-store"});
    if(!res.ok) throw new Error("board.json nicht gefunden");
    return await res.json();
  }

  function buildGraph(){
    nodeById.clear(); adj.clear(); runNodes.clear();
    goalNodeId=null;
    startNodeId={red:null,blue:null,green:null,yellow:null};

    for(const n of board.nodes){
      nodeById.set(n.id, n);
      if(n.kind==="board"){
        adj.set(n.id, []);
        if(n.flags?.run) runNodes.add(n.id);
        if(n.flags?.goal) goalNodeId=n.id;
        if(n.flags?.startColor) startNodeId[n.flags.startColor]=n.id;
      }
    }
    for(const e of board.edges||[]){
      const a=String(e[0]), b=String(e[1]);
      if(!adj.has(a)||!adj.has(b)) continue;
      adj.get(a).push(b); adj.get(b).push(a);
    }
    if(board.meta?.goal) goalNodeId=board.meta.goal;
    if(board.meta?.starts){
      for(const c of DEFAULT_PLAYERS) if(board.meta.starts[c]) startNodeId[c]=board.meta.starts[c];
    }
    if(boardInfo) boardInfo.textContent = `${[...adj.keys()].length} Felder`;
  }

  // ===== View / Fit-to-screen (Tablet / Zoom-Fix) =====
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function computeBounds(){
    if(!board || !Array.isArray(board.nodes) || board.nodes.length===0) return null;
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const n of board.nodes){
      if(typeof n.x!=="number" || typeof n.y!=="number") continue;
      if(n.x<minX) minX=n.x; if(n.x>maxX) maxX=n.x;
      if(n.y<minY) minY=n.y; if(n.y>maxY) maxY=n.y;
    }
    if(!isFinite(minX)) return null;
    return {minX,maxX,minY,maxY};
  }

  function fitBoardToView(){
    const b = computeBounds();
    if(!b) return;
    const rect = canvas.getBoundingClientRect();
    const vw = rect.width, vh = rect.height;
    if(vw < 20 || vh < 20) return;

    const pad = 70; // world units
    const minX = b.minX - pad, maxX = b.maxX + pad;
    const minY = b.minY - pad, maxY = b.maxY + pad;
    const bw = (maxX - minX);
    const bh = (maxY - minY);

    const s = Math.min(vw / bw, vh / bh);
    view.s = clamp(s, 0.28, 3.2);

    const leftPx = (vw - bw * view.s) / 2;
    const topPx  = (vh - bh * view.s) / 2;
    view.x = (leftPx / view.s) - minX;
    view.y = (topPx  / view.s) - minY;
    saveView();
  }

  function ensureFittedOnce(){
    if(view._fittedOnce) return;
    fitBoardToView();
    view._fittedOnce = true;
    draw();
  }


  function newGame(){
    const active = getActiveColors();
    setPlayers(active);

    state={
      players:[...PLAYERS],
      currentPlayer:PLAYERS[0],
      dice:null,
      phase:"need_roll",
      placingChoices:[],
      pieces:Object.fromEntries(PLAYERS.map(c=>[c, Array.from({length:5},()=>({pos:"house"}))])),
      barricades:new Set(),
      winner:null
    };

    // 🔥 BRUTAL: Barikaden starten auf ALLEN RUN-Feldern (außer Ziel)
    for(const id of runNodes){
      if(id===goalNodeId) continue;
      state.barricades.add(id);
    }

    if(barrInfo) barrInfo.textContent=String(state.barricades.size);
    setPhase("need_roll");
    /* dice handled via data-face */
    legalTargets=[]; setPlacingChoices([]);
    selected=null; legalMovesAll=[]; legalMovesByPiece=new Map();
    updateTurnUI(); updateStartButton(); draw();
    try{ ensureFittedOnce(); }catch(_e){}
  }

  function updateTurnUI(){
    // Guard: can be called before we have a snapshot/state
    // (e.g. right after reconnect/assign or after a NO_STATE error)
    if(!state){
      if(turnText) turnText.textContent = "Spiel nicht gestartet";
      if(turnDot) turnDot.style.background = "#555";
      if(rollBtn) rollBtn.disabled = true;
      if(endBtn)  endBtn.disabled  = true;
      if(skipBtn) skipBtn.disabled = true;
      updateColorPickUI();
      return;
    }

    const c=state.currentPlayer;
    turnText.textContent = state.winner ? `${PLAYER_NAME[state.winner]} gewinnt!` : `${PLAYER_NAME[c]} ist dran`;
    turnDot.style.background = COLORS[c];

    const isMyTurn = (netMode==="offline") ? true : (myColor && myColor===state.currentPlayer);
    rollBtn.disabled = (phase!=="need_roll") || !isMyTurn;
    endBtn.disabled  = (phase==="need_roll"||phase==="placing_barricade"||phase==="game_over") || !isMyTurn;
    if(skipBtn) skipBtn.disabled = (phase==="placing_barricade"||phase==="game_over") || !isMyTurn;

    // While a move animation is running, lock the controls so the next action can't happen mid-hop
    if(isAnimatingMove){
      rollBtn.disabled = true;
      endBtn.disabled  = true;
      if(skipBtn) skipBtn.disabled = true;
    }

    updateColorPickUI();
  }

  function endTurn(){
    if(state && state.dice === 6 && !state.winner){
      state.dice = null;
      setDiceFaceAnimated(0);

      legalTargets=[]; setPlacingChoices([]);
      selected=null; legalMovesAll=[]; legalMovesByPiece=new Map();
      setPhase("need_roll");
      updateTurnUI(); updateStartButton(); draw();
      toast("6! Nochmal würfeln");
      return;
    }
    nextPlayer();
  }

  function nextPlayer(){
    const order = state.players?.length ? state.players : PLAYERS;
    const idx = order.indexOf(state.currentPlayer);
    state.currentPlayer = order[(idx+1)%order.length];
    state.dice=null;
    setDiceFaceAnimated(0);
    legalTargets=[]; setPlacingChoices([]);
    selected=null; legalMovesAll=[]; legalMovesByPiece=new Map();
    setPhase("need_roll");
    updateTurnUI(); updateStartButton(); draw();
  }

  function rollDice(){
    if(phase!=="need_roll") return;
    state.dice = 1 + Math.floor(Math.random()*6);
    setDiceFaceAnimated(state.dice);

    toast(`Wurf: ${state.dice}`);

    legalMovesAll = computeLegalMoves(state.currentPlayer, state.dice);
    legalMovesByPiece = new Map();
    for(const m of legalMovesAll){
      const idx = m.piece.index;
      if(!legalMovesByPiece.has(idx)) legalMovesByPiece.set(idx, []);
      legalMovesByPiece.get(idx).push(m);
    }
    legalTargets = legalMovesAll;

    if(legalMovesAll.length===0){
      toast("Kein Zug möglich – Zug verfällt");
      endTurn();
      return;
    }
    setPhase("need_move");
    updateTurnUI(); updateStartButton(); draw();
  }

  function pieceAtBoardNode(nodeId, color){
    const arr = state.pieces[color];
    for(let i=0;i<arr.length;i++){
      if(arr[i].pos === nodeId) return {color, index:i};
    }
    return null;
  }
  function selectPiece(sel){
    selected = sel;
    toast(`${PLAYER_NAME[sel.color]} Figur ${sel.index+1} gewählt`);
  }
  function trySelectAtNode(node){
      if (!state || !state.currentPlayer) { return false; }
if(!node) return false;
    const c = state.currentPlayer;
    if(node.kind === "board"){
      const p = pieceAtBoardNode(node.id, c);
      if(p){ selectPiece(p); return true; }
      return false;
    }
    if(node.kind === "house" && node.flags?.houseColor === c && node.flags?.houseSlot){
      const idx = Number(node.flags.houseSlot) - 1;
      if(idx>=0 && idx<5){
        if(state.pieces[c][idx].pos === "house"){
          selectPiece({color:c, index:idx});
          return true;
        }else{
          toast("Diese Figur ist nicht im Haus");
          return true;
        }
      }
    }
    return false;
  }

  // Fallback selection (important for tablets / house-flag mismatches):
  // If tapping a piece doesn't "hit" its node reliably, select the closest piece of the CURRENT player.
  function trySelectAtPiece(wp){
    if(!state || !state.currentPlayer || !board) return false;
    const c = state.currentPlayer;
    const r=Math.max(16, board.ui?.nodeRadius || 20);
    const hitR=(r+14)/view.s; // a bit bigger than node hit radius
    let best=null, bd=Infinity;

    for(let i=0;i<5;i++){
      const p = state.pieces?.[c]?.[i];
      if(!p) continue;
      if(p.pos === "home") continue;

      const nid = (p.pos === "house") ? p.houseId : p.nodeId;
      if(!nid) continue;
      const n = nodeById.get(String(nid));
      if(!n) continue;

      const d=Math.hypot(n.x-wp.x, n.y-wp.y);
      if(d < hitR && d < bd){
        bd = d;
        best = { color: c, index: i };
      }
    }
    if(best){
      selectPiece(best);
      return true;
    }
    return false;
  }


  function anyPiecesAtNode(nodeId){
    const res=[];
    for(const c of getActiveColors()){
      const arr=state.pieces[c];
      for(let i=0;i<arr.length;i++) if(arr[i].pos===nodeId) res.push({color:c,index:i});
    }
    return res;
  }

  function enumeratePaths(startId, steps){
    const results=[];
    const visited=new Set([startId]);
    function dfs(curr, remaining, path){
      if(remaining===0){ results.push([...path]); return; }
      for(const nb of (adj.get(curr)||[])){
        if(visited.has(nb)) continue;
        if(state.barricades.has(nb) && remaining>1) continue; // cannot pass barricade
        visited.add(nb); path.push(nb);
        dfs(nb, remaining-1, path);
        path.pop(); visited.delete(nb);
      }
    }
    dfs(startId, steps, [startId]);
    return results;
  }

  function computeLegalMoves(color, dice){
    const moves=[];
    for(let i=0;i<5;i++){
      const pc=state.pieces[color][i];
      if(typeof pc.pos==="string" && adj.has(pc.pos)){
        for(const p of enumeratePaths(pc.pos, dice)){
          moves.push({piece:{color,index:i}, path:p, toId:p[p.length-1], fromHouse:false});
        }
      }
    }
    const start=startNodeId[color];
    const hasHouse = state.pieces[color].some(p=>p.pos==="house");
    if(hasHouse && start && !state.barricades.has(start)){
      const remaining=dice-1;
      if(remaining===0){
        for(let i=0;i<5;i++) if(state.pieces[color][i].pos==="house"){
          moves.push({piece:{color,index:i}, path:[start], toId:start, fromHouse:true});
        }
      }else{
        const paths=enumeratePaths(start, remaining);
        for(let i=0;i<5;i++) if(state.pieces[color][i].pos==="house"){
          for(const p of paths) moves.push({piece:{color,index:i}, path:p, toId:p[p.length-1], fromHouse:true});
        }
      }
    }
    const seen=new Set(), uniq=[];
    for(const m of moves){
      const k=`${m.piece.color}:${m.piece.index}->${m.toId}:${m.fromHouse?'H':'B'}`;
      if(seen.has(k)) continue;
      seen.add(k); uniq.push(m);
    }
    return uniq;
  }

  function checkWin(){
    for(const c of getActiveColors()){
      if(state.pieces[c].filter(p=>p.pos==="goal").length===5){ state.winner=c; return; }
    }
  }

  // 🔥 BRUTAL placements: any node (except goal, no duplicates)
  function computeBarricadePlacements(){
    const choices=[];
    for(const id of adj.keys()){
      if(id===goalNodeId) continue;
      if(state.barricades.has(id)) continue;
      choices.push(id);
    }
    setPlacingChoices(choices);
  }

  function movePiece(move){
    const {color,index}=move.piece;
    const toId=move.toId;

    // hit enemies
    const enemies = anyPiecesAtNode(toId).filter(p=>p.color!==color);
    for(const e of enemies) state.pieces[e.color][e.index].pos="house";

    const landsOnBarr = state.barricades.has(toId);
    state.pieces[color][index].pos=toId;

    if(toId===goalNodeId){
      state.pieces[color][index].pos="goal";
      toast("Ziel erreicht!");
      checkWin();
      if(state.winner){
        setPhase("game_over"); updateTurnUI(); updateStartButton(); draw();
        showOverlay("🎉 Spiel vorbei", `${PLAYER_NAME[state.winner]} gewinnt!`, "Tippe Reset für ein neues Spiel.");
        return;
      }
      endTurn();
      return;
    }

    if(landsOnBarr){
      state.barricades.delete(toId);
      if(barrInfo) barrInfo.textContent=String(state.barricades.size);
      setPhase("placing_barricade");
      computeBarricadePlacements();
      updateTurnUI(); updateStartButton(); draw();
      toast("Barikade eingesammelt – jetzt neu platzieren");
      return;
    }

    endTurn();
  }

  function placeBarricade(nodeId){
    if(phase!=="placing_barricade") return;
    if(nodeId===goalNodeId){ toast("Ziel ist gesperrt"); return; }
    if(!placingChoices.includes(nodeId)){ toast("Hier darf keine Barikade hin"); return; }
    state.barricades.add(nodeId);
    if(barrInfo) barrInfo.textContent=String(state.barricades.size);
    setPlacingChoices([]);
    toast("Barikade platziert");
    endTurn();
  }

  // ===== Rendering =====
  function resize(){
    dpr=Math.max(1, Math.min(2.5, window.devicePixelRatio||1));
    const r=canvas.getBoundingClientRect();
    canvas.width=Math.floor(r.width*dpr);
    canvas.height=Math.floor(r.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
    // Mobile browsers report unstable canvas size during load/orientation.
    setTimeout(()=>{ if(!view._fittedOnce) { try{ ensureFittedOnce(); }catch(_e){} } }, 80);

  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", ()=>{
    // force re-fit after rotation/addressbar changes
    view._fittedOnce = false;
    setTimeout(()=>{ try{ resize(); ensureFittedOnce(); }catch(_e){} }, 200);
  });

  function worldToScreen(p){ return {x:(p.x+view.x)*view.s, y:(p.y+view.y)*view.s}; }
  function screenToWorld(p){ return {x:p.x/view.s-view.x, y:p.y/view.s-view.y}; }

  function drawBarricadeIcon(x,y,r){
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,0.85)";
    ctx.strokeStyle="rgba(230,237,243,0.9)";
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.arc(x,y,r*0.95,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function drawSelectionRing(x,y,r){
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x,y,r*1.05,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
  function drawHousePieces(node, x, y, r){
    const color = node.flags && node.flags.houseColor;
    const slot = Number(node.flags && node.flags.houseSlot);
    if(!color || !slot) return;
    const idx = slot - 1;
    if(!state?.pieces?.[color]) return;
    if(state.pieces[color][idx].pos !== "house") return;

    ctx.save();
    // (27) subtle gradient for pieces
    const g = ctx.createRadialGradient(x - r*0.18, y - r*0.18, r*0.15, x, y, r*0.75);
    g.addColorStop(0, "rgba(255,255,255,0.45)");
    g.addColorStop(0.35, COLORS[color]);
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r*0.55, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawStack(arr, x, y, r){
    const p = arr[0];
    ctx.save();
    // (27) subtle gradient for pieces
    const g = ctx.createRadialGradient(x - r*0.22, y - r*0.22, r*0.2, x, y, r*1.15);
    g.addColorStop(0, "rgba(255,255,255,0.45)");
    g.addColorStop(0.4, COLORS[p.color]);
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r*0.95, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    if(arr.length > 1){
      ctx.fillStyle="rgba(0,0,0,0.65)";
      ctx.beginPath();
      ctx.arc(x, y, r*0.45, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle="rgba(230,237,243,0.95)";
      ctx.font="bold 14px system-ui";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(String(arr.length), x, y);
    }
    ctx.restore();
  }

  // Request a redraw on the next animation frame (prevents spamming draw() calls)
  function requestDraw(){
    if(rafDrawId) return;
    rafDrawId = requestAnimationFrame(() => {
      rafDrawId = 0;
      draw();
    });
  }



  function draw(){
    if(!board||!state) return;
    const rect=canvas.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);

    // grid
    const grid=Math.max(10,(board.ui?.gridSize||20))*view.s;
    ctx.save();
    ctx.strokeStyle="rgba(28,36,51,0.75)";
    ctx.lineWidth=1;
    const ox=(view.x*view.s)%grid, oy=(view.y*view.s)%grid;
    for(let x=-ox;x<rect.width;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,rect.height);ctx.stroke();}
    for(let y=-oy;y<rect.height;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(rect.width,y);ctx.stroke();}
    ctx.restore();

    // edges
    ctx.save();
    ctx.lineWidth=3; ctx.strokeStyle=COLORS.edge;
    for(const e of board.edges||[]){
      const a=nodeById.get(String(e[0])), b=nodeById.get(String(e[1]));
      if(!a||!b||a.kind!=="board"||b.kind!=="board") continue;
      const sa=worldToScreen(a), sb=worldToScreen(b);
      ctx.beginPath();ctx.moveTo(sa.x,sa.y);ctx.lineTo(sb.x,sb.y);ctx.stroke();
    }
    ctx.restore();

    // (109) last move trail + (8) destination glow
    const nowFx = performance.now();
    if(lastMoveFx && lastMoveFx.pts && nowFx - lastMoveFx.t0 < 900){
      const age = (nowFx - lastMoveFx.t0);
      const a = Math.max(0, 1 - age/900);
      const col = COLORS[lastMoveFx.color] || lastMoveFx.color || 'rgba(255,255,255,0.9)';
      ctx.save();
      ctx.globalAlpha = 0.55 * a;
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastMoveFx.pts[0].x, lastMoveFx.pts[0].y);
      for(let i=1;i<lastMoveFx.pts.length;i++) ctx.lineTo(lastMoveFx.pts[i].x, lastMoveFx.pts[i].y);
      ctx.stroke();
      // destination glow
      const end = lastMoveFx.pts[lastMoveFx.pts.length-1];
      ctx.globalAlpha = 0.35 * a;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 22, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    // (7) step-by-step hop animation (visual override so it doesn't look like teleport)
    

const r=Math.max(16, board.ui?.nodeRadius || 20);

    // nodes
    for(const n of board.nodes){
      const s=worldToScreen(n);
      let fill=COLORS.node;
      if(n.kind==="board"){
        if(n.id===goalNodeId) fill=COLORS.goal;
        else if(n.flags?.startColor) fill=COLORS.node; // ✅ neutral start fields
        else if(n.flags?.run) fill=COLORS.run;
      }else if(n.kind==="house"){
        fill=COLORS[n.flags?.houseColor]||COLORS.node;
      }

      ctx.beginPath(); ctx.fillStyle=fill; ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.fill();
      ctx.lineWidth=3; ctx.strokeStyle=COLORS.stroke; ctx.stroke();

      if(n.kind==="house" && n.flags?.houseSlot){
        ctx.fillStyle="rgba(0,0,0,0.55)";
        ctx.beginPath(); ctx.arc(s.x,s.y,r*0.55,0,Math.PI*2); ctx.fill();
        ctx.fillStyle="rgba(230,237,243,0.95)";
        ctx.font="bold 13px system-ui";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(n.flags.houseSlot), s.x, s.y);
        drawHousePieces(n, s.x, s.y, r);

        if(selected && n.flags && n.flags.houseColor===selected.color && Number(n.flags.houseSlot)===selected.index+1){
          drawSelectionRing(s.x, s.y, r*0.85);
        }
      }

      if(n.kind==="board" && state.barricades.has(n.id)){
        drawBarricadeIcon(s.x,s.y,r);
      }
    }

    if(phase==="placing_barricade"){
      ctx.save();
      ctx.lineWidth=6;
      ctx.strokeStyle="rgba(255,209,102,0.9)";
      ctx.setLineDash([10,7]);
      for(const id of placingChoices){
        const n=nodeById.get(id); if(!n) continue;
        const s=worldToScreen(n);
        ctx.beginPath(); ctx.arc(s.x,s.y,r+7,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }

    // pieces stacked
    const stacks=new Map();
    // Show ALL colors always (also unchosen)
    for(const c of PLAYERS){
      const pcs=state.pieces[c];
      for(let i=0;i<pcs.length;i++){
        const pc = pcs[i];
        const pos = pc.pos;
        const pid = pc.pieceId;
        if(animPieceId && pid === animPieceId){
          continue; // draw as animated override, not as a stack at the target
        }
        if(typeof pos==="string" && adj.has(pos)){
          if(!stacks.has(pos)) stacks.set(pos, []);
          stacks.get(pos).push({color:c,index:i});
        }
      }
    }
    for(const [nodeId, arr] of stacks.entries()){
      const n=nodeById.get(nodeId); if(!n) continue;
      const s=worldToScreen(n);
      drawStack(arr, s.x, s.y, r);
    }

    // ===== animated moving piece (drawn ON TOP of nodes & pieces) =====
    if(moveAnim){
      const now = performance.now();
      const t = now - moveAnim.t0;

      if(t >= moveAnim.totalMs){
        // Animation finished: clear override BEFORE next render, otherwise the piece may stay hidden
        // because stacks skipped animPieceId in the current frame.
        moveAnim = null;
        animPieceId = null;
        isAnimatingMove = false;
        // UI re-evaluate (buttons etc.)
        updateTurnUI();
        // Force one extra frame so the final stack is drawn immediately.
        requestDraw();
      } else {
        const nodes = moveAnim.nodes;
        const steps = nodes.length - 1;
        const f = Math.max(0, Math.min(1, t / moveAnim.totalMs)); // 0..1
        const segF = f * steps;
        const seg = Math.min(steps - 1, Math.floor(segF));
        const u = segF - seg; // 0..1 within current segment

        const a = nodes[seg];
        const b = nodes[seg+1];

        // linear world interpolation
        const wx = a.x + (b.x - a.x) * u;
        const wy = a.y + (b.y - a.y) * u;

        // convert to screen
        const sp = worldToScreen({x:wx, y:wy});

        // hop curve: 0..1..0 each step
        const hop = Math.sin(Math.PI * u);
        const hopPx = (moveAnim.hop || 16) * (0.85 + 0.15*view.s);
        const yHop = sp.y - hop * hopPx;

        // force top-layer drawing (client sometimes had composite state left over)
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // make it CLEARLY in front: slightly bigger + shadow
        const col = COLORS[moveAnim.color] || moveAnim.color || 'rgba(255,255,255,0.95)';
        const rr = 18;

        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 5;

        // solid + subtle highlight (less transparent than before)
        ctx.fillStyle = col;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(sp.x, yHop, rr, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();

        // small top highlight
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(sp.x - rr*0.25, yHop - rr*0.35, rr*0.45, 0, Math.PI*2);
        ctx.fill();

        ctx.restore();

        // keep animating
        requestDraw();
      }
    }
if(selected){
      const pc = state.pieces[selected.color]?.[selected.index];
      if(pc && typeof pc.pos==="string" && adj.has(pc.pos)){
        const n = nodeById.get(pc.pos);
        if(n){
          const s = worldToScreen(n);
          drawSelectionRing(s.x, s.y, r);
        }
      }
    }
  }

  // ===== Interaction =====
  function pointerPos(ev){
    const r=canvas.getBoundingClientRect();
    return {x:ev.clientX-r.left, y:ev.clientY-r.top};
  }
  function hitNode(wp){
    const r=Math.max(16, board.ui?.nodeRadius || 20);
    const hitR=(r+10)/view.s;
    let best=null, bd=Infinity;
    for(const n of board.nodes){
      const d=Math.hypot(n.x-wp.x, n.y-wp.y);
      if(d<hitR && d<bd){best=n; bd=d;}
    }
    return best;
  }

  function onPointerDown(ev){
      if (!state) { return; }
canvas.setPointerCapture(ev.pointerId);
    const sp=pointerPos(ev);
    // double-tap (or double-click) to auto-fit board (tablet safe)
    const nowTs = Date.now();
    if(pointerMap.size===0){
      if(lastTapPos && (nowTs - lastTapTs) < 350){
        const dx = sp.x - lastTapPos.x, dy = sp.y - lastTapPos.y;
        if((dx*dx + dy*dy) < (28*28)){
          // fit + persist
          clearView();
          try{ ensureFittedOnce(); }catch(_e){}
          saveView();
          lastTapTs = 0; lastTapPos = null;
          return;
        }
      }
      lastTapTs = nowTs;
      lastTapPos = {x:sp.x,y:sp.y};
    }
    pointerMap.set(ev.pointerId, {x:sp.x,y:sp.y});
    if(pointerMap.size===2){ isPanning=false; panStart=null; return; }

    const wp=screenToWorld(sp);
    const hit=hitNode(wp);

    const isMyTurn = (netMode!=="client") || (myColor && myColor===state.currentPlayer);
    if(netMode==="client" && (!myColor || !isMyTurn) && (phase==="placing_barricade" || phase==="need_move" || phase==="need_roll")){
      toast(!myColor ? "Bitte Farbe wählen" : "Du bist nicht dran");
      return;
    }

if(phase==="placing_barricade" && hit && hit.kind==="board"){
  // ONLINE: Server entscheidet immer (Host + Client senden)
  if(netMode!=="offline"){
    wsSend({type:"place_barricade", nodeId: hit.id, ts:Date.now()});
    return;
  }

  // OFFLINE: lokal platzieren
  placeBarricade(hit.id);
  return;
}

    if(phase==="need_move"){
      if(trySelectAtNode(hit)) { draw(); return; }
      if(!selected && trySelectAtPiece(wp)) { draw(); return; }
      if(selected && hit && hit.kind==="board"){
        if(netMode!=="offline"){
          const pid = state?.pieces?.[selected.color]?.[selected.index]?.pieceId;
          if(!pid){ toast("PieceId fehlt"); return; }
          wsSend({type:"move_request", pieceId: pid, targetId: hit.id, ts:Date.now()});
          return;
        }
        const list = legalMovesByPiece.get(selected.index) || [];
        const m = list.find(x => x.toId===hit.id);
        if(m){
          if(netMode==="client"){ wsSend({type:"move_request", pieceId: (state.pieces[selected.color][selected.index].pieceId), targetId: hit.id, ts:Date.now()}); return; }
          movePiece(m);
          if(netMode==="host") broadcastState("state");
          draw();
          return;
        }
        toast("Ungültiges Zielfeld (bitte neu zählen)");
        return;
      }
    }

    isPanning=true;
    panStart={sx:sp.x,sy:sp.y,vx:view.x,vy:view.y};
  }

  function onPointerMove(ev){
    if(!pointerMap.has(ev.pointerId)) return;
    const sp=pointerPos(ev);
    pointerMap.set(ev.pointerId, {x:sp.x,y:sp.y});

    if(pointerMap.size===2){
      const pts=[...pointerMap.values()];
      const a=pts[0], b=pts[1];
      if(!onPointerMove._pinch){
        onPointerMove._pinch={d0:Math.hypot(a.x-b.x,a.y-b.y), s0:view.s};
      }
      const pz=onPointerMove._pinch;
      const d1=Math.hypot(a.x-b.x,a.y-b.y);
      const factor=d1/Math.max(10,pz.d0);
      view.s=Math.max(0.25, Math.min(3.2, pz.s0*factor));
      draw(); return;
    } else { onPointerMove._pinch=null; }

    if(isPanning && panStart){
      const dx=(sp.x-panStart.sx)/view.s;
      const dy=(sp.y-panStart.sy)/view.s;
      view.x=panStart.vx+dx;
      view.y=panStart.vy+dy;
      draw();
    }
  }
  function onPointerUp(ev){
    if(pointerMap.has(ev.pointerId)) pointerMap.delete(ev.pointerId);
    if(pointerMap.size===0){ isPanning=false; panStart=null; onPointerMove._pinch=null; saveView(); }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  // ===== Buttons =====
  debugToggle && debugToggle.addEventListener("click", () => {
    if(!debugLogEl) return;
    const show = debugLogEl.style.display !== "block";
    debugLogEl.style.display = show ? "block" : "none";
  });

  startBtn && startBtn.addEventListener("click", () => {
    if(netMode!=="host"){ toast("Nur Host kann starten"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    if(state && state.started){ toast("Spiel läuft bereits"); return; }
    if(!netCanStart){ toast("Mindestens 2 Spieler nötig"); return; }
    wsSend({type:"start", ts:Date.now()});
    toast("Glücksrad startet…");
  });

  // Host-only: unpause / continue after reconnect (server-side paused flag)
  resumeBtn && resumeBtn.addEventListener("click", () => {
    if(netMode!=="host"){ toast("Nur Host kann fortsetzen"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({type:"resume", ts:Date.now()});
  });

  rollBtn.addEventListener("click", () => {
    if(netMode!=="offline"){
      if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
      // server checks turn
      wsSend({type:"roll_request", ts:Date.now()});
      return;
    }
    rollDice();
    if(netMode==="host") broadcastState("state");
  });

  endBtn.addEventListener("click", () => {
    if(netMode!=="offline"){
      if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
      wsSend({type:"end_turn", ts:Date.now()});
      return;
    }
    if(phase!=="placing_barricade" && phase!=="game_over") nextPlayer();
    if(netMode==="host") broadcastState("state");
  });

  if(skipBtn) skipBtn.addEventListener("click", () => {
    if(netMode!=="offline"){
      if(!myColor){ toast("Bitte Farbe wählen"); return; }
      if(myColor!==state.currentPlayer){ toast("Du bist nicht dran"); return; }
      if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
      wsSend({type:"skip_turn", ts:Date.now()});
      return;
    }
    if(phase!=="placing_barricade" && phase!=="game_over"){ toast("Runde ausgesetzt"); nextPlayer(); }
    if(netMode==="host") broadcastState("state");
  });

  resetBtn.addEventListener("click", () => {
    if(netMode==="offline"){
      newGame();
      return;
    }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({type:"reset", ts:Date.now()});
  });

  // Online actions
  hostBtn.addEventListener("click", () => {
    netMode = "host";
    clientId = clientId || ("H-" + randId(8));
    roomCode = normalizeRoomCode(roomCodeInp.value) || randId(6);
    roomCodeInp.value = roomCode;
    saveSession();
    connectWS();
    toast("Host gestartet – teile den Raumcode");
  });

  joinBtn.addEventListener("click", () => {
    netMode = "client";
    clientId = clientId || ("C-" + randId(8));
    roomCode = normalizeRoomCode(roomCodeInp.value);
    if(!roomCode){ toast("Bitte Raumcode eingeben"); return; }
    saveSession();
    connectWS();
    toast("Beitreten…");
  });

  

  // Farbauswahl (nur Lobby): Wunsch speichern + an Server schicken
  function requestColor(color){
    const c = String(color||"").toLowerCase();
    if(!(c==="red"||c==="blue"||c==="green"||c==="yellow")) return;
    setRequestedColor(c);
    updateColorPickUI();
    if(ws && ws.readyState===1){
      wsSend({ type:"request_color", color: c, ts: Date.now() });
    } else {
      toast("Wunschfarbe gespeichert (wird beim Join gesendet)");
    }
  }

  // Handlers werden zentral ueber bindColorPickHandlers() gebunden,
  // damit es auch funktioniert, wenn die Buttons erst per JS erzeugt wurden.
  bindColorPickHandlers();
leaveBtn.addEventListener("click", () => {
    netMode = "offline";
    saveSession();
    disconnectWS();
    setNetPlayers([]);
    updateHostToolsUI();
    toast("Offline");
  });

  // Host tools (Save/Load) – only host can use
  if(saveBtn) saveBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }

    // Allow Save even during reconnect / offline WS, using the last known snapshot in memory.
    if(!ws || ws.readyState!==1){
      if(!state){
        toast("Kein Spielstand im Speicher");
        return;
      }
      const st = serializeState();
      const ok = downloadJSON(st, `barikade_save_offline_${roomCode || "room"}.json`);
      toast(ok ? "Offline-Save heruntergeladen" : "Save fehlgeschlagen");
      return;
    }

    pendingSaveExport = true;
    wsSend({ type:"export_state", ts: Date.now() });
    toast("Save angefordert…");
  });

  if(loadBtn) loadBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    if(!loadFile) return;
    loadFile.value = "";
    loadFile.click();
  });

  if(loadFile) loadFile.addEventListener("change", async () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    const f = loadFile.files && loadFile.files[0];
    if(!f) return;
    const text = await f.text();
    let st = null;
    try { st = JSON.parse(text); } catch(_e) { toast("Ungültige JSON"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({ type:"import_state", state: st, ts: Date.now() });
    toast("Load gesendet…");
  });

  // Host tool: Restore last Auto-Save from browser (useful after server sleep/restart on Render)
  if(restoreBtn) restoreBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    const v = readHostAutosave();
    if(!v || !v.state){ toast("Kein Auto‑Save gefunden"); return; }
    if(!ws || ws.readyState!==1){
      // even if offline, allow downloading the autosave so nothing is lost
      const ok = downloadJSON(v.state, `barikade_restore_offline_${roomCode || "room"}.json`);
      toast(ok ? "Nicht verbunden – Restore als Datei gespeichert" : "Restore fehlgeschlagen");
      return;
    }
    wsSend({ type:"import_state", state: v.state, ts: Date.now(), reason:"host_autosave_restore" });
    toast("Auto‑Save wiederherstellen…");
  });

  // Host tool: Notfall – Farben tauschen (Rot ↔ Blau)
  if(swapColorsBtn) swapColorsBtn.addEventListener("click", () => {
    if(!isMeHost()) { toast("Nur Host"); return; }
    if(!ws || ws.readyState!==1){ toast("Nicht verbunden"); return; }
    wsSend({ type:"swap_colors", ts: Date.now() });
    toast("Farben tauschen…");
  });


  // (Legacy) In aelteren Offline-Versionen gab es chooseColor().
  // Wir binden hier NICHT doppelt, um keine Doppel-Sends zu erzeugen.

  // ===== Host: intent processing =====
  function colorOf(id){
    const p = rosterById.get(id) || null;
    return p && p.color ? p.color : null;
  }
  function roleOf(id){
    const p = rosterById.get(id) || null;
    return p && p.role ? p.role : null;
  }
  function handleRemoteIntent(intent, senderId=""){
    const senderColor = colorOf(senderId);
    const mustBeTurnPlayer = () => senderColor && senderColor===state.currentPlayer;

    const t = intent.type;
    if(t==="roll"){
      if(!mustBeTurnPlayer()) return;
      rollDice(); broadcastState("state"); return;
    }
    if(t==="end"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="placing_barricade" && phase!=="game_over") nextPlayer();
      broadcastState("state"); return;
    }
    if(t==="skip"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="placing_barricade" && phase!=="game_over"){ toast("Runde ausgesetzt"); nextPlayer(); }
      broadcastState("state"); return;
    }
    if(t==="reset"){
      if(roleOf(senderId)!=="host") return;
      newGame(); broadcastState("snapshot"); return;
    }
    if(t==="move"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="need_move") return;

      const toId = intent.toId;
      const pieceIndex = Number(intent.pieceIndex);
      if(!toId || !(pieceIndex>=0 && pieceIndex<5)) return;

      const list = legalMovesByPiece.get(pieceIndex) || [];
      const m = list.find(x=>x.toId===toId && x.piece.color===senderColor);
      if(m){ movePiece(m); broadcastState("state"); return; }
      return;
    }
    if(t==="placeBarricade"){
      if(!mustBeTurnPlayer()) return;
      if(phase!=="placing_barricade") return;
      placeBarricade(intent.nodeId);
      broadcastState("state");
      return;
    }
  }

  // ===== Init =====
  (async function init(){
    try{
      board = await loadBoard();
      buildGraph();
      resize();

      // restore previous view if available (optional)
      let hadSavedView = false;
      if(AUTO_CENTER_ALWAYS){
        clearView();
        hadSavedView = false;
      }else{
        hadSavedView = loadView();
      }

      // auto center
      if(AUTO_CENTER_ALWAYS || !hadSavedView){
      const xs = board.nodes.map(n=>n.x), ys=board.nodes.map(n=>n.y);
      const minX=Math.min(...xs), maxX=Math.max(...xs);
      const minY=Math.min(...ys), maxY=Math.max(...ys);
      const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
      const rect = canvas.getBoundingClientRect();
      const bw=(maxX-minX)+200, bh=(maxY-minY)+200;
      const sx=rect.width/Math.max(200,bw), sy=rect.height/Math.max(200,bh);
      view.s = Math.max(0.35, Math.min(1.4, Math.min(sx,sy)));
      view.x = (rect.width/2)/view.s - cx;
      view.y = (rect.height/2)/view.s - cy;

      }

      // ensure board is on-screen immediately
      view._fittedOnce = false;
      try{ ensureFittedOnce(); }catch(_e){}

      const sess = loadSession();
      clientId = sess.id || "";
      if(sess.r){ roomCode = normalizeRoomCode(sess.r); roomCodeInp.value = roomCode; }
      if(sess.m==="host" || sess.m==="client"){
        netMode = sess.m;
        setNetStatus("Reconnect…", false);
        connectWS();
      }
      if(netMode==="offline"){
        newGame();
      }
      toast("Bereit. Online: Host/Beitreten.");
    }catch(err){
      showOverlay("Fehler","Board konnte nicht geladen werden", String(err.message||err));
      console.error(err);
    }
  })();
})();

// ===== UI PATCH: Würfel in die Status-Box über "Board / Barikaden" docken (nur Optik) =====
(function dockDiceIntoStatusCard(){
  function tryDock(){
    const dice = document.getElementById("diceCube");
    const boardInfo = document.getElementById("boardInfo"); // "112 Felder"
    if(!dice || !boardInfo) return false;

    // Container finden, in dem "Board/Barikaden" stehen (Status-Card)
    let card =
      boardInfo.closest(".card") ||
      boardInfo.closest(".panel") ||
      boardInfo.closest("section") ||
      (boardInfo.parentElement && boardInfo.parentElement.parentElement) ||
      boardInfo.parentElement;

    if(!card) return false;

    // Dock-Wrapper (falls schon vorhanden -> wiederverwenden)
    let dock = document.getElementById("diceDockStatus");
    if(!dock){
      dock = document.createElement("div");
      dock.id = "diceDockStatus";
      dock.style.display = "flex";
      dock.style.justifyContent = "flex-end";   // rechts
      dock.style.alignItems = "flex-start";
      dock.style.margin = "10px 0 12px 0";
    } else {
      dock.innerHTML = "";
    }

    // Inner Wrapper für "richtig groß"
    const big = document.createElement("div");
    big.style.transform = "scale(2.8)";          // Größe (fett)
    big.style.transformOrigin = "right top";
    big.style.pointerEvents = "none";            // Anzeige-only (Buttons bleiben oben)
    big.appendChild(dice);

    dock.appendChild(big);

    // Position: direkt über der Zeile, die boardInfo enthält
    const row = boardInfo.closest("div") || boardInfo;
    if(row && row.parentElement){
      row.parentElement.insertBefore(dock, row);
      return true;
    }
    return false;
  }

  // Mehrere Versuche, weil UI teils dynamisch aufgebaut wird
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const ok = tryDock();
    if(ok || tries > 30) clearInterval(t);
  }, 100);

  window.addEventListener("load", () => { tryDock(); });
})();



/* ===== UI PATCH V2 (nur Optik, KEIN Gameplay): Würfel wirklich in "Status" docken + Fixed/Absolute überschreiben ===== */
(function forceDiceDockIntoStatus(){
  function setImportant(el, prop, value){
    try{ el.style.setProperty(prop, value, "important"); }catch(_e){ try{ el.style[prop]=value; }catch(__e){} }
  }
  function findStatusCardByBoardInfo(){
    const boardInfo = document.getElementById("boardInfo");
    if(!boardInfo) return null;
    return (
      boardInfo.closest(".card") ||
      boardInfo.closest(".panel") ||
      boardInfo.closest("section") ||
      boardInfo.closest("div") ||
      null
    );
  }

  function tryDock(){
    const dice = document.getElementById("diceCube");
    const boardInfo = document.getElementById("boardInfo");
    if(!dice || !boardInfo) return false;

    const card = findStatusCardByBoardInfo();
    if(!card) return false;

    // Überschreibe mögliche Header-Fixierungen (damit ein Umhängen auch sichtbar wird)
    setImportant(dice, "position", "static");
    setImportant(dice, "top", "auto");
    setImportant(dice, "right", "auto");
    setImportant(dice, "bottom", "auto");
    setImportant(dice, "left", "auto");
    setImportant(dice, "margin", "0");
    setImportant(dice, "z-index", "10");
    // Falls im Header per flex "klein gedrückt"
    setImportant(dice, "flex", "0 0 auto");

    // Dock-Wrapper
    let dock = document.getElementById("diceDockStatusV2");
    if(!dock){
      dock = document.createElement("div");
      dock.id = "diceDockStatusV2";
      dock.style.display = "flex";
      dock.style.justifyContent = "flex-end";
      dock.style.alignItems = "flex-start";
      dock.style.gap = "12px";
      dock.style.margin = "10px 0 14px 0";
    } else {
      dock.innerHTML = "";
    }

    // Groß darstellen (ohne 3D-Transforms zu zerstören)
    const big = document.createElement("div");
    setImportant(big, "transform", "scale(2.9)");
    setImportant(big, "transform-origin", "right top");
    // Anzeige-only (würfeln bleibt Button)
    setImportant(big, "pointer-events", "none");
    big.appendChild(dice);
    dock.appendChild(big);

    // Einfügen: direkt NACH der Status-Überschrift, sonst über boardInfo-Zeile
    const statusTitle = Array.from(card.querySelectorAll("h1,h2,h3,div,span"))
      .find(n => (n.textContent||"").trim() === "Status");
    if(statusTitle && statusTitle.parentElement){
      // nach dem Titel einfügen
      if(statusTitle.nextSibling){
        statusTitle.parentElement.insertBefore(dock, statusTitle.nextSibling);
      } else {
        statusTitle.parentElement.appendChild(dock);
      }
      return true;
    }

    // Fallback: über der Board-Zeile
    const row = boardInfo.closest("div") || boardInfo;
    row.parentElement && row.parentElement.insertBefore(dock, row);
    return true;
  }

  // oft wird UI dynamisch gerendert → mehrfach versuchen + nach jedem Resize
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    const ok = tryDock();
    if(ok || tries > 80) clearInterval(iv);
  }, 120);

  window.addEventListener("load", () => { tryDock(); });
  window.addEventListener("resize", () => { tryDock(); });
})();



/* ===== UI PATCH V3 (nur Optik): Dock via "Status" Überschrift (falls IDs/Struktur am PC anders sind) ===== */
(function forceDiceDockByStatusTitle(){
  function setImportant(el, prop, value){
    try{ el.style.setProperty(prop, value, "important"); }catch(_e){ try{ el.style[prop]=value; }catch(__e){} }
  }
  function findStatusTitleEl(){
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,span,p,button"));
    for(const el of candidates){
      const t = (el.textContent || "").trim();
      if(t === "Status"){
        // prefer headings or bold-looking
        return el;
      }
    }
    return null;
  }
  function tryDock(){
    const dice = document.getElementById("diceCube") || document.querySelector("#diceCube") || document.querySelector(".diceCube") || null;
    if(!dice) return false;

    const titleEl = findStatusTitleEl();
    if(!titleEl) return false;

    // card/container: nearest big box on the right
    let card = titleEl.closest(".card") || titleEl.closest(".panel") || titleEl.closest("section") || titleEl.closest("div");
    if(!card) return false;

    // create/reuse dock
    let dock = document.getElementById("diceDockStatusV3");
    if(!dock){
      dock = document.createElement("div");
      dock.id = "diceDockStatusV3";
      setImportant(dock, "display", "flex");
      setImportant(dock, "justify-content", "flex-end");
      setImportant(dock, "align-items", "flex-start");
      setImportant(dock, "margin", "10px 0 12px 0");
    } else {
      dock.innerHTML = "";
    }

    const big = document.createElement("div");
    setImportant(big, "transform", "scale(2.8)");
    setImportant(big, "transform-origin", "right top");
    setImportant(big, "pointer-events", "none");
    big.appendChild(dice);
    dock.appendChild(big);

    // override dice positioning so it can't stick to header
    setImportant(dice, "position", "static");
    setImportant(dice, "top", "auto");
    setImportant(dice, "right", "auto");
    setImportant(dice, "left", "auto");
    setImportant(dice, "bottom", "auto");
    setImportant(dice, "margin", "0");
    setImportant(dice, "z-index", "1");

    // insert dock right after title
    if(titleEl.parentElement){
      // if title is within a header row, insert after that row; else directly after title
      const headerRow = titleEl.closest("div") || titleEl;
      headerRow.parentElement.insertBefore(dock, headerRow.nextSibling);
      return true;
    }
    return false;
  }

  let tries=0;
  const t=setInterval(()=>{
    tries++;
    const ok=tryDock();
    if(ok || tries>50) clearInterval(t);
  }, 120);

  window.addEventListener("load", ()=>{ tryDock(); });
})();




/* ===== UI PATCH V4 (nur Optik): Würfel bekommt eigenen Bereich in der Status-Box (kein Überlappen) ===== */
(function diceOwnAreaInStatus(){
  function setImp(el, prop, val){
    try{ el.style.setProperty(prop, val, "important"); }catch(_e){ try{ el.style[prop]=val; }catch(__e){} }
  }

  function findStatusTitle(card){
    if(!card) return null;
    // suche einen Titel-Knoten mit Text "Status"
    const candidates = Array.from(card.querySelectorAll("h1,h2,h3,h4,div,span,strong"));
    return candidates.find(n => (n.textContent||"").trim() === "Status") || null;
  }

  function tryDock(){
    const dice = document.getElementById("diceCube");
    const boardInfo = document.getElementById("boardInfo");
    if(!dice || !boardInfo) return false;

    // Status-Card finden
    let card =
      boardInfo.closest(".card") ||
      boardInfo.closest(".panel") ||
      boardInfo.closest("section") ||
      boardInfo.parentElement?.parentElement ||
      boardInfo.parentElement;

    if(!card) return false;

    // Würfel von "oben festgeklebt" lösen (nur Anzeige!)
    setImp(dice, "position", "relative");
    setImp(dice, "top", "auto");
    setImp(dice, "right", "auto");
    setImp(dice, "bottom", "auto");
    setImp(dice, "left", "auto");
    setImp(dice, "margin", "0");
    setImp(dice, "z-index", "2");
    setImp(dice, "pointer-events", "none");

    // Dock-Wrapper mit FESTER HÖHE, damit Platz reserviert wird
    let dock = document.getElementById("diceDockStatus");
    if(!dock){
      dock = document.createElement("div");
      dock.id = "diceDockStatus";
    } else {
      dock.innerHTML = "";
    }

    setImp(dock, "display", "flex");
    setImp(dock, "justify-content", "flex-end");
    setImp(dock, "align-items", "center");
    setImp(dock, "width", "100%");
    // <<< HIER entsteht der Platz, damit nix überlappt >>>
    setImp(dock, "height", "170px");            // genug Platz für großen Würfel
    setImp(dock, "min-height", "170px");
    setImp(dock, "margin", "8px 0 8px 0");

    // Inner Wrapper (Skalierung)
    const big = document.createElement("div");
    setImp(big, "transform", "scale(2.8)");
    setImp(big, "transform-origin", "right center");
    setImp(big, "width", "72px");               // Basisfläche (Layout)
    setImp(big, "height", "72px");

    big.appendChild(dice);
    dock.appendChild(big);

    // Einfügen: direkt NACH dem "Status"-Titel, sonst ganz oben in die Card
    const title = findStatusTitle(card);
    if(title && title.parentElement){
      title.parentElement.insertBefore(dock, title.nextSibling);
      return true;
    }

    // Fallback: vor die Zeile von boardInfo
    const row = boardInfo.closest("div") || boardInfo;
    if(row && row.parentElement){
      row.parentElement.insertBefore(dock, row);
      return true;
    }

    return false;
  }

  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const ok = tryDock();
    if(ok || tries > 60) clearInterval(t);
  }, 120);

  window.addEventListener("load", () => { tryDock(); });
})();



/* ===== UI PATCH V5 (Samsung Internet safe): Würfel bekommt eigenen Bereich in Status-Box, keine Überlappung =====
   - rein visuell, KEIN Gameplay
   - robust über "Status" Überschrift oder #boardInfo
*/
(function diceStatusDockV5(){
  function setImp(el, prop, value){
    if(!el) return;
    try { el.style.setProperty(prop, value, "important"); }
    catch(_e){ try { el.style[prop] = value; } catch(__e){} }
  }

  function findStatusCard(){
    // 1) über #boardInfo (stabil)
    const boardInfo = document.getElementById("boardInfo");
    if(boardInfo){
      const c = boardInfo.closest(".card") || boardInfo.closest(".panel") || boardInfo.closest("section") || boardInfo.parentElement;
      if(c) return c;
    }
    // 2) über Überschrift "Status"
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,span,p"))
      .filter(el => (el.textContent||"").trim() === "Status");
    for(const h of headings){
      const c = h.closest(".card") || h.closest(".panel") || h.closest("section") || h.parentElement;
      if(c) return c;
    }
    return null;
  }

  function dock(){
    const dice = document.getElementById("diceCube");
    const card = findStatusCard();
    if(!dice || !card) return false;

    // Samsung/Tablet: Transform + overflow kann clippen → overflow sichtbar machen
    setImp(card, "overflow", "visible");

    // Dock Zone erstellen (nimmt echten Platz ein)
    let zone = document.getElementById("diceStatusZoneV5");
    if(!zone){
      zone = document.createElement("div");
      zone.id = "diceStatusZoneV5";
      zone.style.display = "flex";
      zone.style.justifyContent = "flex-end";
      zone.style.alignItems = "flex-start";
      zone.style.margin = "10px 0 14px 0";
      zone.style.paddingRight = "6px";
      zone.style.overflow = "visible";
      // Reservierter Platz -> nichts überlappt
      zone.style.height = "170px";
    } else {
      zone.innerHTML = "";
    }

    // Würfel "ent-fixieren"
    setImp(dice, "position", "static");
    setImp(dice, "top", "auto");
    setImp(dice, "right", "auto");
    setImp(dice, "left", "auto");
    setImp(dice, "bottom", "auto");
    setImp(dice, "margin", "0");
    setImp(dice, "zIndex", "1");
    setImp(dice, "pointerEvents", "none"); // Anzeige-only

    // Größe: Samsung Internet kann "zoom" besser rechnen als transform (wir setzen beides)
    const big = document.createElement("div");
    big.style.overflow = "visible";
    big.style.transformOrigin = "right top";
    big.style.pointerEvents = "none";
    big.style.zoom = "2.6";              // Samsung/Chromium-friendly
    big.style.transform = "scale(2.6)";  // Fallback, falls zoom ignoriert wird
    big.appendChild(dice);

    zone.appendChild(big);

    // Einfügen: direkt nach dem "Status"-Titel, sonst ganz oben im Card-Content
    // Wir suchen das Status-Label im Card
    let statusLabel = null;
    const inside = Array.from(card.querySelectorAll("*"));
    statusLabel = inside.find(el => (el.textContent||"").trim() === "Status");
    if(statusLabel && statusLabel.parentElement){
      // Wenn direkt nach dem Label schon unsere Zone sitzt, ok
      if(zone.parentElement !== statusLabel.parentElement){
        statusLabel.parentElement.insertBefore(zone, statusLabel.nextSibling);
      } else if(zone.previousSibling !== statusLabel){
        statusLabel.parentElement.insertBefore(zone, statusLabel.nextSibling);
      }
    } else {
      // fallback: ganz oben
      card.insertBefore(zone, card.firstChild);
    }

    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const ok = dock();
    if(ok || tries > 80) clearInterval(timer);
  }, 120);

  window.addEventListener("load", () => { dock(); });
  // Wenn die UI später neu gerendert wird:
  document.addEventListener("visibilitychange", () => { if(!document.hidden) dock(); });
})();
