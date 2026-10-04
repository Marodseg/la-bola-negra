// La urna: caja de votación de casino, de caoba y latón, con ventana de cristal y portezuela.
// Render con Three.js y física real de las bolas con cannon-es.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as CANNON from 'cannon-es';
import { BALL_COLORS, MAX_BALLS } from './constants.js';

// ---------- Medidas (metros de mentira) ----------
const OUT_W = 2.6; // ancho exterior
const OUT_D = 1.5; // fondo exterior
const WALL = 0.1;
const PLINTH_H = 0.22;
const FEET_H = 0.06;
const Y0 = FEET_H + PLINTH_H; // arranque de la caja
const BOX_H = 1.95;
const LID_Y = Y0 + BOX_H - WALL; // cara inferior de la tapa
const IN_X = OUT_W / 2 - WALL; // 1.2
const IN_BACK = -OUT_D / 2 + WALL; // -0.65
const GLASS_Z = OUT_D / 2 - 0.13; // cara interior del cristal
const FLOOR_Y = Y0 + WALL;
const HOLE_R = 0.36;
const WIN = { x: 1.05, y0: Y0 + 0.3, y1: LID_Y - 0.14 }; // hueco de la ventana
const INNER_VOL = (2 * IN_X) * (GLASS_Z - IN_BACK) * (LID_Y - FLOOR_Y);
// Con MAX_BALLS bolas, la urna queda algo más que mediada.
const BALL_R = Math.cbrt((0.62 * 0.5 * INNER_VOL) / (MAX_BALLS * (4 / 3) * Math.PI));
const DROP_Y = LID_Y + WALL + 0.45;
const STEP = 1 / 60;

export function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// ---------- Texturas procedimentales ----------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function woodCanvas(seed, { base = '#4a2314', dark = '24,10,5', light = '128,70,40' } = {}) {
  const rand = rng(seed);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  // Vetas: líneas onduladas de distinto grosor y opacidad
  for (let i = 0; i < 220; i++) {
    const y = rand() * c.height;
    const amp = 2 + rand() * 7;
    const freq = 0.002 + rand() * 0.006;
    const phase = rand() * Math.PI * 2;
    const isLight = rand() < 0.3;
    g.strokeStyle = `rgba(${isLight ? light : dark},${0.04 + rand() * (isLight ? 0.12 : 0.22)})`;
    g.lineWidth = 0.5 + rand() * 2.5;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 8) {
      const yy = y + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.7 + phase * 2) * amp * 0.3;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  // Poro de la madera
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n * 0.8;
    img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function feltCanvas(seed) {
  const rand = rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#23402f';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    img.data[i] += n * 0.6;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.7;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function plaqueCanvas(text) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 180;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#e7c27a');
  grad.addColorStop(0.5, '#b8893e');
  grad.addColorStop(1, '#8a6224');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(60,35,10,.7)';
  g.lineWidth = 4;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.lineWidth = 1.5;
  g.strokeRect(24, 24, c.width - 48, c.height - 48);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 74px "Bodoni Moda Variable", "Bodoni 72", Didot, serif';
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  // Grabado: luz debajo, sombra encima
  g.fillStyle = 'rgba(255,235,180,.55)';
  g.fillText(text, c.width / 2 + 2, c.height / 2 + 4);
  g.fillStyle = '#3b2509';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  return c;
}

/** Círculo a lápiz rojo, trazado a mano, para señalar la bola de quien vota. */
function pencilCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(160,36,24,.95)';
  g.lineCap = 'round';
  g.lineWidth = 9;
  g.beginPath();
  for (let a = 0; a <= Math.PI * 2.25; a += 0.05) {
    const r = 96 + Math.sin(a * 3) * 4 + a * 2;
    const x = 128 + Math.cos(a - 1.2) * r;
    const y = 128 + Math.sin(a - 1.2) * r * 0.94;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  return c;
}

function texture(canvas, { repeat = [1, 1], rotate = false, color = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (rotate) {
    t.center.set(0.5, 0.5);
    t.rotation = Math.PI / 2;
  }
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- La urna ----------

export function createUrn(container, { onImpact, onReady } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  const lookAt = new THREE.Vector3(0, 1.22, 0.25);

  // Luz cálida de ventana, como un salón de casino por la tarde
  const sun = new THREE.DirectionalLight(0xffe6c4, 2.6);
  sun.position.set(-3.5, 6.5, 4.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 16 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x6b5a45, 0.7));

  // Sombra sobre el papel
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Materiales
  const woodH = new THREE.MeshPhysicalMaterial({
    map: texture(woodCanvas(7)), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25,
  });
  const woodV = new THREE.MeshPhysicalMaterial({
    map: texture(woodCanvas(11), { rotate: true }), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25,
  });
  const woodDark = new THREE.MeshPhysicalMaterial({
    map: texture(woodCanvas(23, { base: '#2c140a' })), roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3,
  });
  const felt = new THREE.MeshStandardMaterial({ map: texture(feltCanvas(3), { repeat: [3, 3] }), roughness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc0924a, metalness: 1, roughness: 0.3 });

  const urn = new THREE.Group();
  scene.add(urn);

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    urn.add(m);
    return m;
  }

  // Patas de latón y peana
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, FEET_H, 24), brass);
      foot.position.set(sx * (OUT_W / 2 + 0.05), FEET_H / 2, sz * (OUT_D / 2 + 0.05));
      foot.castShadow = true;
      urn.add(foot);
    }
  }
  box(OUT_W + 0.32, PLINTH_H, OUT_D + 0.3, woodDark, 0, FEET_H + PLINTH_H / 2, 0);
  box(OUT_W + 0.18, 0.04, OUT_D + 0.16, brass, 0, Y0 + 0.02, 0).castShadow = false;

  // Laterales, fondo y suelo
  const bodyH = BOX_H - WALL;
  box(WALL, bodyH, OUT_D, woodV, -OUT_W / 2 + WALL / 2, Y0 + bodyH / 2, 0);
  box(WALL, bodyH, OUT_D, woodV, OUT_W / 2 - WALL / 2, Y0 + bodyH / 2, 0);
  box(OUT_W - 2 * WALL, bodyH, WALL, woodH, 0, Y0 + bodyH / 2, -OUT_D / 2 + WALL / 2);
  box(OUT_W - 2 * WALL, WALL, OUT_D - WALL, woodH, 0, Y0 + WALL / 2, 0);

  // Fieltro verde por dentro
  const feltFloor = new THREE.Mesh(new THREE.PlaneGeometry(2 * IN_X, GLASS_Z - IN_BACK), felt);
  feltFloor.rotation.x = -Math.PI / 2;
  feltFloor.position.set(0, FLOOR_Y + 0.002, (GLASS_Z + IN_BACK) / 2);
  feltFloor.receiveShadow = true;
  urn.add(feltFloor);
  const feltBack = new THREE.Mesh(new THREE.PlaneGeometry(2 * IN_X, LID_Y - FLOOR_Y), felt);
  feltBack.position.set(0, (LID_Y + FLOOR_Y) / 2, IN_BACK + 0.002);
  feltBack.receiveShadow = true;
  urn.add(feltBack);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(GLASS_Z - IN_BACK, LID_Y - FLOOR_Y), felt);
    side.rotation.y = -s * Math.PI / 2;
    side.position.set(s * (IN_X - 0.002), (LID_Y + FLOOR_Y) / 2, (GLASS_Z + IN_BACK) / 2);
    side.receiveShadow = true;
    urn.add(side);
  }

  // Tapa con agujero redondo y biselado
  const lidShape = new THREE.Shape();
  const lw = OUT_W / 2 - 0.02;
  const ld = OUT_D / 2 - 0.02;
  lidShape.moveTo(-lw, -ld);
  lidShape.lineTo(lw, -ld);
  lidShape.lineTo(lw, ld);
  lidShape.lineTo(-lw, ld);
  lidShape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, HOLE_R, 0, Math.PI * 2, true);
  lidShape.holes.push(hole);
  const lidGeo = new THREE.ExtrudeGeometry(lidShape, {
    depth: WALL * 0.8, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 48,
  });
  const lid = new THREE.Mesh(lidGeo, new THREE.MeshPhysicalMaterial({
    map: texture(woodCanvas(31), { repeat: [0.4, 0.6] }), roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2,
  }));
  lid.rotation.x = -Math.PI / 2;
  lid.position.y = LID_Y + 0.02;
  lid.castShadow = true;
  lid.receiveShadow = true;
  urn.add(lid);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(HOLE_R + 0.02, 0.032, 16, 64), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = LID_Y + WALL + 0.035;
  ring.castShadow = true;
  urn.add(ring);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(HOLE_R, HOLE_R, WALL + 0.04, 48, 1, true), brass);
  sleeve.position.y = LID_Y + WALL / 2 + 0.02;
  urn.add(sleeve);

  // Marco delantero alrededor de la ventana
  const frameZ = OUT_D / 2 - WALL / 2;
  const fw = OUT_W - 2 * WALL;
  box(fw, WIN.y0 - Y0 - WALL, WALL, woodH, 0, Y0 + WALL + (WIN.y0 - Y0 - WALL) / 2, frameZ);
  box(fw, LID_Y - WIN.y1, WALL, woodH, 0, (WIN.y1 + LID_Y) / 2, frameZ);
  box(IN_X - WIN.x, WIN.y1 - WIN.y0, WALL, woodV, -(IN_X + WIN.x) / 2, (WIN.y0 + WIN.y1) / 2, frameZ);
  box(IN_X - WIN.x, WIN.y1 - WIN.y0, WALL, woodV, (IN_X + WIN.x) / 2, (WIN.y0 + WIN.y1) / 2, frameZ);
  // Esquineras de latón
  for (const sx of [-1, 1]) {
    for (const y of [Y0 + 0.12, LID_Y - 0.02]) {
      box(0.04, 0.2, 0.04, brass, sx * (OUT_W / 2 - 0.005), y, OUT_D / 2 - 0.005).castShadow = false;
    }
  }

  // Cristal
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * WIN.x, WIN.y1 - WIN.y0),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.08,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2, depthWrite: false,
    }),
  );
  glass.position.set(0, (WIN.y0 + WIN.y1) / 2, GLASS_Z + 0.01);
  glass.renderOrder = 5;
  urn.add(glass);

  // Portezuela abatible con placa y tirador
  const doorPivot = new THREE.Group();
  doorPivot.position.set(0, WIN.y0, OUT_D / 2 + 0.005);
  urn.add(doorPivot);
  const doorH = WIN.y1 - WIN.y0 + 0.02;
  const doorW = 2 * WIN.x + 0.02;
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.06), woodH);
  door.position.set(0, doorH / 2, 0.03);
  door.castShadow = true;
  door.receiveShadow = true;
  doorPivot.add(door);
  const inset = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.32, doorH - 0.32, 0.03), woodDark);
  inset.position.set(0, doorH / 2, 0.07);
  inset.castShadow = true;
  doorPivot.add(inset);
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.27),
    new THREE.MeshStandardMaterial({ map: texture(plaqueCanvas('VOTACIÓN')), metalness: 0.85, roughness: 0.35 }),
  );
  plaque.position.set(0, doorH * 0.62, 0.0865);
  doorPivot.add(plaque);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), brass);
  knob.position.set(0, doorH - 0.26, 0.13);
  knob.castShadow = true;
  doorPivot.add(knob);
  const escutcheon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 24), brass);
  escutcheon.rotation.x = Math.PI / 2;
  escutcheon.position.set(0, doorH * 0.3, 0.09);
  doorPivot.add(escutcheon);
  for (const sx of [-0.7, 0.7]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 16), brass);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(sx, 0, 0.02);
    doorPivot.add(hinge);
  }

  // Bolas: una malla instanciada por color
  const sphere = new THREE.SphereGeometry(BALL_R, 32, 20);
  const meshes = {
    blanca: new THREE.InstancedMesh(sphere, new THREE.MeshPhysicalMaterial({
      color: BALL_COLORS.blanca, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12,
    }), MAX_BALLS + 8),
    negra: new THREE.InstancedMesh(sphere, new THREE.MeshPhysicalMaterial({
      color: BALL_COLORS.negra, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05,
    }), MAX_BALLS + 8),
  };
  for (const m of Object.values(meshes)) {
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }

  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(pencilCanvas()), depthTest: false, transparent: true, opacity: 0 }));
  mark.scale.setScalar(BALL_R * 3.4);
  mark.renderOrder = 10;
  scene.add(mark);

  // ---------- Física ----------

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 12;
  const ballMat = new CANNON.Material('marfil');
  const woodMat = new CANNON.Material('madera');
  world.addContactMaterial(new CANNON.ContactMaterial(ballMat, ballMat, { friction: 0.05, restitution: 0.42 }));
  world.addContactMaterial(new CANNON.ContactMaterial(ballMat, woodMat, { friction: 0.08, restitution: 0.3 }));

  function wall(hx, hy, hz, x, y, z) {
    const b = new CANNON.Body({ mass: 0, material: woodMat });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    b.position.set(x, y, z);
    world.addBody(b);
  }
  const H2 = (LID_Y - FLOOR_Y) / 2 + 0.3;
  const midY = (LID_Y + FLOOR_Y) / 2;
  const depth2 = (GLASS_Z - IN_BACK) / 2 + 0.3;
  const midZ = (GLASS_Z + IN_BACK) / 2;
  wall(0.3, H2, depth2, -IN_X - 0.3, midY, midZ);
  wall(0.3, H2, depth2, IN_X + 0.3, midY, midZ);
  wall(IN_X + 0.3, H2, 0.3, 0, midY, IN_BACK - 0.3);
  wall(IN_X + 0.3, H2, 0.3, 0, midY, GLASS_Z + 0.3);
  wall(IN_X + 0.3, 0.3, depth2, 0, FLOOR_Y - 0.3, midZ);
  // Tapa: cuatro tablas alrededor del agujero
  const ly = LID_Y + 0.05;
  wall(IN_X, 0.05, (GLASS_Z - HOLE_R) / 2, 0, ly, (GLASS_Z + HOLE_R) / 2);
  wall(IN_X, 0.05, (-HOLE_R - IN_BACK) / 2, 0, ly, (IN_BACK - HOLE_R) / 2);
  wall((IN_X - HOLE_R) / 2, 0.05, HOLE_R, -(IN_X + HOLE_R) / 2, ly, 0);
  wall((IN_X - HOLE_R) / 2, 0.05, HOLE_R, (IN_X + HOLE_R) / 2, ly, 0);

  // Embudo invisible sobre el agujero: ninguna bola puede caer fuera.
  const FUNNEL = 16;
  const funnelTop = DROP_Y + 1.2;
  const funnelH = (funnelTop - (LID_Y + WALL)) / 2;
  for (let i = 0; i < FUNNEL; i++) {
    const a = (i / FUNNEL) * Math.PI * 2;
    const b = new CANNON.Body({ mass: 0, material: woodMat });
    b.addShape(new CANNON.Box(new CANNON.Vec3(((2 * Math.PI * HOLE_R) / FUNNEL) * 0.6, funnelH, 0.05)));
    b.position.set(Math.cos(a) * (HOLE_R + 0.05), LID_Y + WALL + funnelH, Math.sin(a) * (HOLE_R + 0.05));
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2 - a);
    world.addBody(b);
  }

  let balls = [];
  const queue = [];
  let spawnEvery = 40;
  let lastSpawn = 0;
  let simTime = 0;
  let acc = 0;
  let pourDone = null;

  function addBall(color, x, y, z, { vx = 0, vy = 0, vz = 0, mine = false } = {}) {
    const body = new CANNON.Body({
      mass: 1, material: ballMat, shape: new CANNON.Sphere(BALL_R),
      linearDamping: 0.05, angularDamping: 0.25, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.8,
    });
    body.position.set(x, y, z);
    body.velocity.set(vx, vy, vz);
    body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v > 0.9) onImpact?.(Math.min(1, (v - 0.9) / 5), { mine });
    });
    world.addBody(body);
    const ball = { body, color, mine };
    balls.push(ball);
    return ball;
  }

  function spawnFromQueue() {
    const item = queue.shift();
    const r = Math.random() * (HOLE_R - BALL_R * 1.15);
    const a = Math.random() * Math.PI * 2;
    const ball = addBall(item.color, Math.cos(a) * r, DROP_Y, Math.sin(a) * r, { vy: -2.5, mine: item.mine });
    // Al pasar la tapa recibe un empujoncito lateral, para que las bolas se repartan en vez de hacer montaña.
    const push = 1 + Math.random() * 1.8;
    const dir = Math.random() * Math.PI * 2;
    ball.kick = { x: Math.cos(dir) * push, z: Math.sin(dir) * push * 0.45 };
    if (!queue.length && pourDone) {
      const done = pourDone;
      pourDone = null;
      setTimeout(done, 1200);
    }
  }

  // ---------- Cámara y tamaño ----------

  let W = 0;
  let H = 0;
  let baseDist = 10;
  function resize() {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height || (rect.width === W && rect.height === H)) return;
    W = rect.width;
    H = rect.height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    baseDist = Math.max(1.5 / tan, (OUT_W / 2 + 0.4) / (tan * camera.aspect)) + 1;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  // Paralaje suave con el ratón cuando no se está girando la urna.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // Girar la urna arrastrando (ratón o dedo), con inercia. Tras unos segundos sin tocarla
  // vuelve sola al frente, para que siempre se pueda apuntar a la boca.
  const BASE_YAW = -0.32;
  const BASE_PITCH = 0.3;
  const YAW_LIMIT = 0.95; // unos 55° a cada lado: el cristal siempre se ve
  const PITCH_MIN = 0.04;
  const PITCH_MAX = 0.75;
  const RETURN_AFTER = 6000;
  const orbit = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, drag: null, touchedAt: -Infinity };
  const canvas = renderer.domElement;
  canvas.style.cursor = 'grab';

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    orbit.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    orbit.vYaw = orbit.vPitch = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const d = orbit.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    orbit.vYaw = -dx * 0.0045;
    orbit.vPitch = dy * 0.0035;
    orbit.yaw += orbit.vYaw;
    orbit.pitch += orbit.vPitch;
    orbit.touchedAt = performance.now();
  });
  const endDrag = (e) => {
    if (!orbit.drag || orbit.drag.id !== e.pointerId) return;
    orbit.drag = null;
    orbit.touchedAt = performance.now();
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function updateOrbit(t) {
    if (!orbit.drag) {
      // Inercia al soltar
      orbit.yaw += orbit.vYaw;
      orbit.pitch += orbit.vPitch;
      orbit.vYaw *= 0.92;
      orbit.vPitch *= 0.92;
      // Vuelta suave al frente
      if (t - orbit.touchedAt > RETURN_AFTER) {
        orbit.yaw *= 0.97;
        orbit.pitch *= 0.97;
      }
    }
    const yaw = BASE_YAW + orbit.yaw;
    if (yaw > YAW_LIMIT || yaw < -YAW_LIMIT) {
      orbit.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, yaw)) - BASE_YAW;
      orbit.vYaw = 0;
    }
    const pitch = BASE_PITCH + orbit.pitch;
    if (pitch > PITCH_MAX || pitch < PITCH_MIN) {
      orbit.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch)) - BASE_PITCH;
      orbit.vPitch = 0;
    }
  }

  function placeCamera(t) {
    // El paralaje se apaga mientras se gira la urna y vuelve poco a poco.
    const quiet = Math.min(1, Math.max(0, (t - orbit.touchedAt - 1500) / 3000));
    pointer.x += (pointer.tx * quiet - pointer.x) * 0.035;
    pointer.y += (pointer.ty * quiet - pointer.y) * 0.035;
    const sway = reducedMotion ? 0 : Math.sin(t * 0.00012) * 0.06 * quiet;
    const yaw = BASE_YAW + orbit.yaw + sway + pointer.x * 0.1;
    const pitch = BASE_PITCH + orbit.pitch + pointer.y * 0.04;
    camera.position.set(
      lookAt.x + Math.sin(yaw) * Math.cos(pitch) * baseDist,
      lookAt.y + Math.sin(pitch) * baseDist,
      lookAt.z + Math.cos(yaw) * Math.cos(pitch) * baseDist,
    );
    camera.lookAt(lookAt);
  }

  // ---------- Bucle ----------

  let doorT = 0;
  let doorFrom = 0;
  let doorTo = 0;
  let doorStart = 0;
  let doorDur = 1;
  let openedAt = -1;
  let visible = true;
  let last = 0;
  let readySent = false;
  const m4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(container);

  // Abre con un pequeño rebote, como una tapa de madera que llega al tope de sus bisagras.
  const easeDoor = (u) => 1 + 1.9 * (u - 1) ** 3 + 0.9 * (u - 1) ** 2;

  let markOpacity = 0;
  const eye = new THREE.Vector3();
  /** ¿Se ve la bola a través del cristal desde la cámara, o la tapa la madera de la caja? */
  function seenThroughGlass(p) {
    eye.copy(camera.position);
    if (eye.z <= GLASS_Z || p.z >= GLASS_Z) return true;
    const k = (GLASS_Z - eye.z) / (p.z - eye.z);
    const x = eye.x + (p.x - eye.x) * k;
    const y = eye.y + (p.y - eye.y) * k;
    return Math.abs(x) <= WIN.x && y >= WIN.y0 && y <= WIN.y1;
  }

  function frame(t) {
    requestAnimationFrame(frame);
    resize();
    if (!W) return;
    const dt = Math.min(0.1, last ? (t - last) / 1000 : STEP);
    last = t;

    // Pasos fijos de física. Las bolas salen al ritmo de la simulación, no del reloj:
    // en un dispositivo lento todo va a cámara lenta, pero nunca se atasca la boca de la urna.
    acc = Math.min(acc + dt, STEP * 4);
    while (acc >= STEP) {
      acc -= STEP;
      simTime += STEP * 1000;
      if (queue.length && simTime - lastSpawn >= spawnEvery) {
        lastSpawn = simTime;
        spawnFromQueue();
      }
      world.step(STEP);
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.kick && b.body.position.y < LID_Y - BALL_R) {
        b.body.velocity.x += b.kick.x;
        b.body.velocity.z += b.kick.z;
        b.kick = null;
      }
      if (b.body.position.y < -2) {
        world.removeBody(balls[i].body);
        balls.splice(i, 1);
      }
    }
    if (!visible) return;

    if (doorT !== doorTo) {
      const u = Math.min(1, (t - doorStart) / doorDur);
      doorT = u >= 1 ? doorTo : doorFrom + (doorTo - doorFrom) * easeDoor(u);
    }
    doorPivot.rotation.x = doorT * (Math.PI / 2);

    const n = { blanca: 0, negra: 0 };
    let mine = null;
    for (const b of balls) {
      pos.copy(b.body.position);
      quat.copy(b.body.quaternion);
      m4.compose(pos, quat, one);
      meshes[b.color].setMatrixAt(n[b.color]++, m4);
      if (b.mine) mine = b;
    }
    for (const c of ['blanca', 'negra']) {
      meshes[c].count = n[c];
      meshes[c].instanceMatrix.needsUpdate = true;
    }

    updateOrbit(t);
    placeCamera(t);
    if (mine && openedAt >= 0 && t > openedAt) {
      mark.position.copy(mine.body.position);
      // Nunca desaparece: si la madera tapa la bola, el círculo se queda atenuado.
      const target = Math.min(1, (t - openedAt) / 500) * (seenThroughGlass(mine.body.position) ? 1 : 0.45);
      markOpacity += (target - markOpacity) * 0.15;
      mark.material.opacity = markOpacity;
    } else {
      markOpacity = 0;
      mark.material.opacity = 0;
    }

    renderer.render(scene, camera);
    if (!readySent) {
      readySent = true;
      onReady?.();
    }
  }
  requestAnimationFrame(frame);

  // ---------- Proyección a pantalla ----------

  const tmp = new THREE.Vector3();
  function toScreen(x, y, z) {
    const rect = renderer.domElement.getBoundingClientRect();
    tmp.set(x, y, z).project(camera);
    return { x: rect.left + ((tmp.x + 1) / 2) * rect.width, y: rect.top + ((1 - tmp.y) / 2) * rect.height };
  }

  function counts() {
    const out = { blanca: 0, negra: 0 };
    for (const q of queue) out[q.color]++;
    for (const b of balls) out[b.color]++;
    return out;
  }

  return {
    /** Boca de la urna y zona donde se puede soltar la bola, en coordenadas de la ventana. */
    target() {
      resize();
      placeCamera(performance.now());
      camera.updateMatrixWorld();
      const mouth = toScreen(0, DROP_Y, 0);
      const side = toScreen(BALL_R, DROP_Y, 0);
      const pts = [
        toScreen(-OUT_W / 2, LID_Y + 0.6, 0), toScreen(OUT_W / 2, LID_Y + 0.6, 0),
        toScreen(-OUT_W / 2, 0, OUT_D / 2), toScreen(OUT_W / 2, 0, OUT_D / 2),
      ];
      return {
        mouth,
        radius: Math.hypot(side.x - mouth.x, side.y - mouth.y),
        box: {
          left: Math.min(...pts.map((p) => p.x)) - 20,
          right: Math.max(...pts.map((p) => p.x)) + 20,
          top: Math.min(...pts.map((p) => p.y)) - 30,
          bottom: Math.max(...pts.map((p) => p.y)) + 10,
        },
      };
    },

    drop(color, { mine = false } = {}) {
      return addBall(color, (Math.random() - 0.5) * 0.05, DROP_Y, (Math.random() - 0.5) * 0.05, { vy: -2.4, mine });
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
      // Como mínimo una bola cada dos pasos de física, para que no choquen al nacer.
      spawnEvery = Math.max(34, Math.min(130, duration / queue.length));
      return new Promise((resolve) => {
        const prev = pourDone;
        pourDone = () => { prev?.(); resolve(); };
      });
    },

    removeMine() {
      balls = balls.filter((b) => {
        if (!b.mine) return true;
        world.removeBody(b.body);
        return false;
      });
    },

    /** Abre la portezuela para el escrutinio. */
    open(duration = 1100) {
      doorFrom = doorT;
      doorTo = 1;
      doorStart = performance.now();
      doorDur = Math.max(1, reducedMotion ? 1 : duration);
      if (openedAt < 0) openedAt = performance.now() + doorDur * 0.8;
    },
  };
}
