// La urna: un tarro de cristal con física real (matter.js) dibujado a mano en un <canvas>.
const { Engine, Composite, Bodies, Body, Events } = window.Matter;

/** Número máximo de bolas dentro de la urna. Por encima, cada bola representa varios votos. */
export const MAX_BALLS = 150;

const STEP = 1000 / 60;

export function createUrn(canvas, { onImpact } = {}) {
  const ctx = canvas.getContext('2d');
  const engine = Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 6 });
  engine.gravity.y = 1;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let geo = null;
  let sprites = null;
  let balls = [];
  let queue = [];
  let spawnEvery = 40;
  let lastSpawn = 0;
  let pourDone = null;
  let frost = 1;
  let frostFrom = 1;
  let frostTo = 1;
  let frostStart = 0;
  let frostDuration = 1;
  let revealedAt = -1;
  let lastTs = 0;
  let acc = 0;

  // ---------- Geometría ----------

  function computeGeometry(w, h) {
    const g = {
      cx: w / 2,
      top: h * 0.1,
      mouthW: w * 0.36,
      neckH: h * 0.05,
      bodyW: w * 0.68,
      bottom: h * 0.95,
      t: Math.max(8, w * 0.022),
    };
    g.shoulderY = g.top + g.neckH + h * 0.11;
    g.cornerR = g.bodyW * 0.24;
    const area = g.bodyW * (g.bottom - g.shoulderY);
    // Con MAX_BALLS bolas, la urna queda llena a dos tercios.
    g.r = Math.sqrt((0.56 * area) / (MAX_BALLS * Math.PI));
    g.outline = buildOutline(g);
    return g;
  }

  function quad(a, c, b, u) {
    const v = 1 - u;
    return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
  }

  function buildOutline(g) {
    const xm = g.cx - g.mouthW / 2;
    const xb = g.cx - g.bodyW / 2;
    const neckEnd = [xm, g.top + g.neckH];
    const left = [[xm, g.top], neckEnd];
    for (let i = 1; i <= 8; i++) left.push(quad(neckEnd, [xb, g.top + g.neckH], [xb, g.shoulderY], i / 8));
    left.push([xb, g.bottom - g.cornerR]);
    for (let i = 1; i <= 8; i++) {
      const a = Math.PI - (i / 8) * (Math.PI / 2);
      left.push([xb + g.cornerR + Math.cos(a) * g.cornerR, g.bottom - g.cornerR + Math.sin(a) * g.cornerR]);
    }
    left.push([g.cx, g.bottom]);
    const right = left.slice(0, -1).reverse().map(([x, y]) => [2 * g.cx - x, y]);
    return left.concat(right);
  }

  function buildWalls(g) {
    const inside = [g.cx, (g.shoulderY + g.bottom) / 2];
    const walls = [];
    for (let i = 0; i < g.outline.length - 1; i++) {
      const [x1, y1] = g.outline[i];
      const [x2, y2] = g.outline[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      let nx = dy / len;
      let ny = -dx / len;
      if (nx * (mx - inside[0]) + ny * (my - inside[1]) < 0) { nx = -nx; ny = -ny; }
      walls.push(Bodies.rectangle(mx + nx * g.t / 2, my + ny * g.t / 2, len + g.t, g.t, {
        isStatic: true, angle: Math.atan2(dy, dx), friction: 0.1, restitution: 0.25,
      }));
    }
    return walls;
  }

  function outlinePath(close) {
    const p = new Path2D();
    geo.outline.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    if (close) p.closePath();
    return p;
  }

  // ---------- Sprites de las bolas ----------

  function makeSprite(color, r) {
    const size = Math.ceil(r * 2 * dpr) + 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const R = (size - 2) / 2;
    const o = size / 2;
    const grad = g.createRadialGradient(o - R * 0.35, o - R * 0.4, R * 0.05, o, o, R);
    if (color === 'blanca') {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.45, '#f1ece2');
      grad.addColorStop(0.85, '#c3bbad');
      grad.addColorStop(1, '#8f877b');
    } else {
      grad.addColorStop(0, '#6d6d6d');
      grad.addColorStop(0.3, '#262626');
      grad.addColorStop(0.75, '#0b0b0b');
      grad.addColorStop(1, '#000000');
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(o, o, R, 0, Math.PI * 2);
    g.fill();
    // Brillo especular
    const spec = g.createRadialGradient(o - R * 0.38, o - R * 0.45, 0, o - R * 0.38, o - R * 0.45, R * 0.45);
    spec.addColorStop(0, color === 'blanca' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spec;
    g.beginPath();
    g.arc(o, o, R, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  // ---------- Bolas ----------

  function addBall(color, x, y, { vx = 0, vy = 0, mine = false } = {}) {
    const body = Bodies.circle(x, y, geo.r, {
      restitution: 0.34, friction: 0.03, frictionStatic: 0.4, frictionAir: 0.006, density: 0.0016, slop: 0.02,
    });
    body.plugin.color = color;
    body.plugin.mine = mine;
    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.2);
    Composite.add(engine.world, body);
    balls.push(body);
    return body;
  }

  function spawnFromQueue() {
    const item = queue.shift();
    const spread = geo.mouthW / 2 - geo.r * 1.6;
    addBall(item.color, geo.cx + (Math.random() * 2 - 1) * spread, geo.top - geo.r * 2.5, {
      vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 2, mine: item.mine,
    });
    if (!queue.length && pourDone) {
      const done = pourDone;
      pourDone = null;
      setTimeout(done, 900);
    }
  }

  // ---------- Tamaño ----------

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || (rect.width === W && rect.height === H)) return;
    const old = geo;
    W = rect.width;
    H = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    geo = computeGeometry(W, H);
    sprites = { blanca: makeSprite('blanca', geo.r), negra: makeSprite('negra', geo.r) };

    Composite.clear(engine.world, false);
    Composite.add(engine.world, buildWalls(geo));
    const previous = balls;
    balls = [];
    for (const b of previous) {
      const s = geo.bodyW / old.bodyW;
      addBall(b.plugin.color, geo.cx + (b.position.x - old.cx) * s, geo.bottom - (old.bottom - b.position.y) * s, {
        mine: b.plugin.mine,
      });
    }
  }

  // ---------- Colisiones con sonido ----------

  Events.on(engine, 'collisionStart', (event) => {
    if (!onImpact) return;
    let strongest = 0;
    let mine = false;
    for (const { bodyA, bodyB } of event.pairs) {
      const speed = Math.hypot(bodyA.velocity.x - bodyB.velocity.x, bodyA.velocity.y - bodyB.velocity.y);
      if (speed > strongest) {
        strongest = speed;
        mine = bodyA.plugin.mine || bodyB.plugin.mine;
      }
    }
    if (strongest > 1.6) onImpact(Math.min(1, (strongest - 1.6) / 9), { mine, glass: false });
  });

  // ---------- Dibujo ----------

  function draw(now) {
    const g = geo;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Sombra sobre la mesa
    ctx.save();
    ctx.translate(g.cx, g.bottom + g.t * 0.8);
    ctx.scale(1, 0.14);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, g.bodyW * 0.62);
    shadow.addColorStop(0, 'rgba(0,0,0,0.65)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, g.bodyW * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const body = outlinePath(true);

    // Cristal (fondo)
    const back = ctx.createLinearGradient(g.cx - g.bodyW / 2, 0, g.cx + g.bodyW / 2, 0);
    back.addColorStop(0, 'rgba(255,255,255,0.07)');
    back.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    back.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = back;
    ctx.fill(body);

    // Bolas
    const sinceReveal = revealedAt < 0 ? -1 : now - revealedAt;
    for (const b of balls) {
      const { x, y } = b.position;
      ctx.drawImage(sprites[b.plugin.color], x - g.r - 1 / dpr, y - g.r - 1 / dpr, g.r * 2 + 2 / dpr, g.r * 2 + 2 / dpr);
      if (b.plugin.mine && sinceReveal >= 0) {
        const pulse = 0.55 + 0.45 * Math.sin(now / 380);
        ctx.strokeStyle = `rgba(232, 193, 106, ${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = Math.max(2, g.r * 0.22);
        ctx.shadowColor = 'rgba(232, 193, 106, 0.9)';
        ctx.shadowBlur = 8 + 8 * pulse;
        ctx.beginPath();
        ctx.arc(x, y, g.r + ctx.lineWidth * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // Cristal esmerilado: la urna es secreta hasta que votas
    if (frost > 0.002) {
      ctx.save();
      ctx.clip(body);
      ctx.globalAlpha = frost;
      const fog = ctx.createLinearGradient(0, g.top, 0, g.bottom);
      fog.addColorStop(0, 'rgba(40, 34, 30, 0.86)');
      fog.addColorStop(1, 'rgba(22, 18, 16, 0.97)');
      ctx.fillStyle = fog;
      ctx.fill(body);
      ctx.fillStyle = 'rgba(232, 193, 106, 0.22)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const mid = (g.shoulderY + g.bottom) / 2;
      ctx.font = `600 ${Math.round(g.bodyW * 0.32)}px "Playfair Display", Georgia, serif`;
      ctx.fillText('?', g.cx, mid - g.bodyW * 0.04);
      ctx.font = `600 ${Math.max(10, Math.round(g.bodyW * 0.045))}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(232, 193, 106, 0.4)';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3em';
      ctx.fillText('URNA SECRETA', g.cx, mid + g.bodyW * 0.18);
      ctx.restore();
    }

    // Reflejos del cristal
    ctx.save();
    ctx.clip(body);
    const softStreak = (x, y, w, hgt, alpha) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(w / hgt, 1);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, hgt / 2);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, hgt / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const bodyH = g.bottom - g.shoulderY;
    softStreak(g.cx - g.bodyW * 0.33, g.shoulderY + bodyH * 0.45, g.bodyW * 0.16, bodyH * 0.95, 0.16);
    softStreak(g.cx + g.bodyW * 0.32, g.shoulderY + bodyH * 0.35, g.bodyW * 0.05, bodyH * 0.6, 0.1);
    ctx.restore();

    // Contorno del cristal
    const edge = outlinePath(false);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = g.t;
    ctx.stroke(edge);
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = Math.max(1.5, g.t * 0.22);
    ctx.stroke(edge);

    // Aro de latón en la boca
    const rimW = g.mouthW + g.t * 2.4;
    const rimH = g.t * 1.5;
    const brass = ctx.createLinearGradient(0, g.top - rimH / 2, 0, g.top + rimH / 2);
    brass.addColorStop(0, '#f6dc9a');
    brass.addColorStop(0.45, '#c9a14e');
    brass.addColorStop(1, '#7a5a22');
    ctx.fillStyle = brass;
    roundRect(g.cx - rimW / 2, g.top - rimH / 2, rimW, rimH, rimH / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(g.cx - g.mouthW / 2 + g.t * 0.2, g.top - rimH * 0.12, g.mouthW - g.t * 0.4, rimH * 0.3, rimH * 0.15);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Bucle ----------

  function frame(ts) {
    requestAnimationFrame(frame);
    resize();
    if (!geo) return;
    const dt = Math.min(64, lastTs ? ts - lastTs : STEP);
    lastTs = ts;

    if (queue.length && ts - lastSpawn >= spawnEvery) {
      lastSpawn = ts;
      spawnFromQueue();
    }

    acc += dt;
    while (acc >= STEP) {
      Engine.update(engine, STEP);
      acc -= STEP;
    }

    // Por si alguna bola escapa de la urna
    for (let i = balls.length - 1; i >= 0; i--) {
      if (balls[i].position.y > H + 200) {
        Composite.remove(engine.world, balls[i]);
        balls.splice(i, 1);
      }
    }

    if (frost !== frostTo) {
      const u = Math.min(1, (ts - frostStart) / frostDuration);
      const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      frost = frostFrom + (frostTo - frostFrom) * eased;
      if (u >= 1) frost = frostTo;
    }

    draw(ts);
  }
  requestAnimationFrame(frame);

  // ---------- API ----------

  function counts() {
    const out = { blanca: queue.filter((q) => q.color === 'blanca').length, negra: 0 };
    out.negra = queue.length - out.blanca;
    for (const b of balls) out[b.plugin.color]++;
    return out;
  }

  return {
    get radius() { return geo?.r ?? 10; },

    /** Punto de entrada de la urna y su caja, en coordenadas de la ventana. */
    target() {
      resize();
      const rect = canvas.getBoundingClientRect();
      return {
        mouth: { x: rect.left + geo.cx, y: rect.top + geo.top - geo.r * 2.5 },
        box: {
          left: rect.left + geo.cx - geo.bodyW / 2 - 24,
          right: rect.left + geo.cx + geo.bodyW / 2 + 24,
          top: rect.top + geo.top - 60,
          bottom: rect.top + geo.bottom + 16,
        },
        radius: geo.r,
      };
    },

    /** Echa una bola en la boca de la urna. */
    drop(color, { mine = false, vx = 0, vy = 3 } = {}) {
      resize();
      return addBall(color, geo.cx, geo.top - geo.r * 2.5, { vx, vy, mine });
    },

    /** Vierte bolas hasta que la urna tenga `target` ({ blanca, negra }). Solo añade, nunca quita. */
    pourTo(target, { mineColor = null, duration = 3200 } = {}) {
      const have = counts();
      const items = [];
      for (const color of ['blanca', 'negra']) {
        for (let i = have[color]; i < target[color]; i++) items.push({ color, mine: false });
      }
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      if (mineColor) {
        const idx = items.findIndex((it) => it.color === mineColor);
        if (idx >= 0) items[idx].mine = true;
      }
      if (!items.length) return Promise.resolve();
      queue.push(...items);
      spawnEvery = Math.max(14, Math.min(110, duration / queue.length));
      return new Promise((resolve) => {
        const prev = pourDone;
        pourDone = () => { prev?.(); resolve(); };
      });
    },

    /** Saca de la urna la bola del votante (si el voto no se pudo registrar). */
    removeMine() {
      balls = balls.filter((b) => {
        if (!b.plugin.mine) return true;
        Composite.remove(engine.world, b);
        return false;
      });
    },

    /** 1 = cristal esmerilado (secreto), 0 = transparente. */
    setFrost(value, duration = 1200) {
      frostFrom = frost;
      frostTo = value;
      frostStart = performance.now();
      frostDuration = Math.max(1, duration);
      if (duration <= 1) frost = value;
      if (value === 0 && revealedAt < 0) revealedAt = performance.now() + duration * 0.6;
    },
  };
}
