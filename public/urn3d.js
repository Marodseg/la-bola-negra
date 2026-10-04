// La urna en 3D: cristal con refracción (Three.js) y bolas con física real (cannon-es).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as CANNON from '/vendor/cannon-es/cannon-es.js';

/** Número máximo de bolas dentro de la urna. Por encima, cada bola representa varios votos. */
export const MAX_BALLS = 150;

const R = 1; // radio interior
const HEIGHT = 2.3; // altura del cristal
const WALL = 0.07; // grosor del cristal
const FLOOR = 0.1; // altura del fondo interior
// Con MAX_BALLS bolas, la urna queda llena algo más de la mitad.
const BALL_R = Math.cbrt((0.62 * 0.52 * Math.PI * R * R * (HEIGHT - FLOOR)) / (MAX_BALLS * (4 / 3) * Math.PI));
const DROP_Y = HEIGHT + 0.7;
const STEP = 1 / 60;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

export function createUrn(container, { onImpact } = {}) {
  if (!webglAvailable()) return null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Render ----------

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'stage-canvas';
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const lookAt = new THREE.Vector3(0, 1.45, 0);

  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(-3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.4);
  rim.position.set(4, 3, -5);
  scene.add(rim);

  // Cristal: perfil de revolución con grosor, borde redondeado y fondo grueso.
  function glassProfile() {
    const pts = [];
    const outer = R + WALL;
    const c = 0.16;
    pts.push(new THREE.Vector2(0, 0));
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(outer - c + Math.cos(a) * c, c + Math.sin(a) * c));
    }
    pts.push(new THREE.Vector2(outer, HEIGHT));
    for (let i = 1; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      pts.push(new THREE.Vector2(R + WALL / 2 + Math.cos(a) * (WALL / 2), HEIGHT + Math.sin(a) * (WALL / 2)));
    }
    pts.push(new THREE.Vector2(R, HEIGHT));
    const ci = 0.08;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - ci + Math.cos(a) * ci, FLOOR + ci - Math.sin(a) * ci));
    }
    pts.push(new THREE.Vector2(0, FLOOR));
    return pts;
  }

  // Cristal fino: casi invisible, solo reflejos. Más fiable en móviles que la transmisión real.
  const glassGeo = new THREE.LatheGeometry(glassProfile(), 96);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 3;
  scene.add(glass);

  // Brillo en los bordes del cristal (efecto Fresnel)
  const fresnelMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: { strength: { value: 0.55 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float strength; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * f * strength, f * strength);
      }`,
  });
  const fresnel = new THREE.Mesh(glassGeo, fresnelMat);
  fresnel.renderOrder = 4;
  scene.add(fresnel);

  // Humo dentro de la urna: la mantiene secreta hasta que votas.
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1d, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.93, depthWrite: false,
  });
  const smoke = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.005, R - 0.005, HEIGHT - FLOOR - 0.02, 96, 1, true), smokeMat);
  smoke.position.y = FLOOR + (HEIGHT - FLOOR) / 2;
  smoke.renderOrder = 2;
  const smokeTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.005, 96), smokeMat);
  smokeTop.rotation.x = -Math.PI / 2;
  smokeTop.position.y = HEIGHT - 0.12;
  smokeTop.renderOrder = 2;
  scene.add(smoke, smokeTop);

  // Aro luminoso en la boca
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(R + WALL / 2, WALL / 2 + 0.004, 12, 160),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = HEIGHT;
  lip.renderOrder = 4;
  scene.add(lip);

  // Fondo interior mate, para que las bolas destaquen
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(R, 96),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85, metalness: 0, envMapIntensity: 0.4 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = FLOOR + 0.002;
  scene.add(base);

  // Pedestal
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.32, R + 0.4, 0.22, 96),
    new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: 0.45, metalness: 0.25, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.25 }),
  );
  pedestal.position.y = -0.11;
  scene.add(pedestal);

  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(R + 0.32, 0.006, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.001;
  scene.add(edge);

  // Sombra de contacto
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry((R + 0.4) * 3.4, (R + 0.4) * 3.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.225;
  scene.add(shadow);

  // Bolas: una malla instanciada por color.
  const sphere = new THREE.SphereGeometry(BALL_R, 40, 28);
  const meshes = {
    blanca: new THREE.InstancedMesh(sphere, new THREE.MeshPhysicalMaterial({
      color: 0xf3efe7, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0.3, sheenColor: new THREE.Color(0xffffff),
    }), MAX_BALLS + 8),
    negra: new THREE.InstancedMesh(sphere, new THREE.MeshPhysicalMaterial({
      color: 0x060606, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03,
    }), MAX_BALLS + 8),
  };
  for (const m of Object.values(meshes)) {
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }

  // Aro dorado que señala tu bola
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(BALL_R * 1.3, BALL_R * 1.55, 64),
    new THREE.MeshBasicMaterial({ color: 0xf1cf7f, transparent: true, opacity: 0, depthTest: false }),
  );
  ring.renderOrder = 10;
  scene.add(ring);

  // ---------- Física ----------

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 12;
  const ballMat = new CANNON.Material('bola');
  const wallMat = new CANNON.Material('cristal');
  world.addContactMaterial(new CANNON.ContactMaterial(ballMat, ballMat, { friction: 0.06, restitution: 0.32 }));
  world.addContactMaterial(new CANNON.ContactMaterial(ballMat, wallMat, { friction: 0.04, restitution: 0.38 }));

  const SEGMENTS = 32;
  const segW = ((2 * Math.PI * (R + WALL)) / SEGMENTS) * 1.15;
  const wallH = HEIGHT + 1.2;
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const body = new CANNON.Body({ mass: 0, material: wallMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(segW / 2, wallH / 2, 0.15)));
    body.position.set(Math.cos(a) * (R + 0.15), wallH / 2, Math.sin(a) * (R + 0.15));
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2 - a);
    world.addBody(body);
  }
  const floor = new CANNON.Body({ mass: 0, material: wallMat });
  floor.addShape(new CANNON.Box(new CANNON.Vec3(R + 0.5, 0.25, R + 0.5)));
  floor.position.set(0, FLOOR - 0.25, 0);
  world.addBody(floor);

  /** @type {{ body: CANNON.Body, color: 'blanca'|'negra', mine: boolean }[]} */
  let balls = [];
  let queue = [];
  let spawnEvery = 40;
  let lastSpawn = 0;
  let pourDone = null;

  function addBall(color, x, y, z, { vx = 0, vy = 0, vz = 0, mine = false } = {}) {
    const body = new CANNON.Body({
      mass: 1,
      material: ballMat,
      shape: new CANNON.Sphere(BALL_R),
      linearDamping: 0.04,
      angularDamping: 0.2,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.8,
    });
    body.position.set(x, y, z);
    body.velocity.set(vx, vy, vz);
    body.angularVelocity.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
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
    const rr = Math.sqrt(Math.random()) * (R - BALL_R * 1.4);
    const a = Math.random() * Math.PI * 2;
    addBall(item.color, Math.cos(a) * rr, DROP_Y + Math.random() * 0.3, Math.sin(a) * rr, {
      vy: -1.5 - Math.random(), mine: item.mine,
    });
    if (!queue.length && pourDone) {
      const done = pourDone;
      pourDone = null;
      setTimeout(done, 1000);
    }
  }

  // ---------- Tamaño y cámara ----------

  let W = 0;
  let H = 0;
  let baseDist = 9;
  function resize() {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height || (rect.width === W && rect.height === H)) return;
    W = rect.width;
    H = rect.height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // Encaja la urna (con hueco arriba para las bolas que caen) en cualquier proporción.
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfH = 1.85;
    const halfW = R + 0.55;
    baseDist = Math.max(halfH / tan, halfW / (tan * camera.aspect)) + R;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  // Paralaje suave con el ratón
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  function placeCamera(t) {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    const sway = reducedMotion ? 0 : Math.sin(t * 0.00018) * 0.18;
    const yaw = sway + pointer.x * 0.16;
    const pitch = 0.2 + pointer.y * 0.05;
    camera.position.set(
      Math.sin(yaw) * baseDist,
      lookAt.y + Math.sin(pitch) * baseDist,
      Math.cos(yaw) * Math.cos(pitch) * baseDist,
    );
    camera.lookAt(lookAt);
  }

  // ---------- Bucle ----------

  let frost = 1;
  let frostFrom = 1;
  let frostTo = 1;
  let frostStart = 0;
  let frostDuration = 1;
  let revealedAt = -1;
  let visible = true;
  let last = 0;
  const m4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(container);

  function frame(t) {
    requestAnimationFrame(frame);
    resize();
    if (!W) return;
    const dt = Math.min(0.1, last ? (t - last) / 1000 : STEP);
    last = t;

    // Aunque el dispositivo vaya a pocos fotogramas, la urna se llena al ritmo previsto.
    for (let k = 0; k < 4 && queue.length && t - lastSpawn >= spawnEvery; k++) {
      lastSpawn = t - lastSpawn > spawnEvery * 6 ? t : lastSpawn + spawnEvery;
      spawnFromQueue();
    }
    world.step(STEP, dt, 4);

    for (let i = balls.length - 1; i >= 0; i--) {
      if (balls[i].body.position.y < -3) {
        world.removeBody(balls[i].body);
        balls.splice(i, 1);
      }
    }
    if (!visible) return;

    if (frost !== frostTo) {
      const u = Math.min(1, (t - frostStart) / frostDuration);
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      frost = u >= 1 ? frostTo : frostFrom + (frostTo - frostFrom) * e;
    }
    smokeMat.opacity = 0.93 * frost;
    smoke.visible = smokeTop.visible = frost > 0.002;

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

    placeCamera(t);

    if (mine && revealedAt >= 0 && t > revealedAt) {
      ring.position.copy(mine.body.position);
      ring.quaternion.copy(camera.quaternion);
      const pulse = 0.5 + 0.5 * Math.sin(t / 360);
      ring.material.opacity = Math.min(1, (t - revealedAt) / 600) * (0.55 + 0.45 * pulse);
      ring.scale.setScalar(1 + pulse * 0.08);
    } else {
      ring.material.opacity = 0;
    }

    renderer.render(scene, camera);
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

  // ---------- API ----------

  return {
    /** Boca de la urna y zona donde soltar la bola, en coordenadas de la ventana. */
    target() {
      resize();
      placeCamera(performance.now());
      camera.updateMatrixWorld();
      const mouth = toScreen(0, DROP_Y, 0);
      const side = toScreen(BALL_R, DROP_Y, 0);
      const tl = toScreen(-(R + WALL), HEIGHT + 0.6, 0);
      const br = toScreen(R + WALL, 0, 0);
      return {
        mouth,
        radius: Math.abs(side.x - mouth.x),
        box: { left: tl.x - 30, right: br.x + 30, top: tl.y - 40, bottom: br.y + 20 },
      };
    },

    drop(color, { mine = false } = {}) {
      return addBall(color, 0, DROP_Y, 0, { vy: -2.2, vx: (Math.random() - 0.5) * 0.3, mine });
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
      spawnEvery = Math.max(16, Math.min(120, duration / queue.length));
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

    /** 1 = urna llena de humo (secreta), 0 = cristal limpio. */
    setFrost(value, duration = 1400) {
      frostFrom = frost;
      frostTo = value;
      frostStart = performance.now();
      frostDuration = Math.max(1, duration);
      if (duration <= 1) frost = value;
      if (value === 0 && revealedAt < 0) revealedAt = performance.now() + duration * 0.7;
    },
  };
}
