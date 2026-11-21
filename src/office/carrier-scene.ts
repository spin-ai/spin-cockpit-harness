// @ts-nocheck
// 场景主体移植自 docs/prototype/carrier-3d.js（three.js r149，MIT）；运行时数据由 React 外壳注入。
import * as THREE from "three";
import type { OfficeActor, OfficeModel, OfficeTone, OfficeZone } from "./model";
import { ZONE_LABEL } from "./motion";

type MotionTier = "calm" | "full" | "off";
type Theme = "light" | "dark";

interface MountOptions {
  host: HTMLElement;
  getModel: () => OfficeModel;
  getSelected: () => string | null;
  getNow: () => number;
  getMotion: () => { tier: MotionTier; reduced: boolean; walk: number };
  getTheme: () => Theme;
  onSelect: (id: string) => void;
}

export interface Carrier3DApi {
  launch: () => void;
  update: () => void;
  setSelected: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  setMotion: (tier: MotionTier, reduced: boolean, walk: number) => void;
  dispose: () => void;
}

/**
 * 航母 · 电磁弹射 3D 舞台。
 * 场景 / 舰体 / 甲板 / 舰载机移植自 docs/prototype/carrier-3d.js（three.js r149，MIT），
 * 数据换成真实 OfficeModel：弹射位 = 并发 run，着舰道 = review / approval 串行闸门。
 */
export function mountCarrier3D(options: MountOptions): Carrier3DApi {
  const { host, getModel, getSelected, getMotion, getTheme, onSelect } = options;
  const doc = host.ownerDocument;
  host.innerHTML = "";
  const canvas = doc.createElement("canvas");
  canvas.className = "carrier3d-canvas";
  host.appendChild(canvas);
  const labelLayer = doc.createElement("div");
  labelLayer.className = "carrier3d-labels";
  host.appendChild(labelLayer);
  const SVGNS = "http://www.w3.org/2000/svg";
  const leaderSvg = doc.createElementNS(SVGNS, "svg");
  leaderSvg.setAttribute("class", "carrier3d-leaders");
  leaderSvg.setAttribute("aria-hidden", "true");
  host.appendChild(leaderSvg);
  let theme: Theme = getTheme();
  let motion = getMotion();

  const SHIP_YAW = -0.42;
  const DECK: [number, number][] = [
    [0, 46], [4, 44.6], [7, 41.5], [9.5, 35], [10.8, 27], [11, 20],
    [11, -42], [6, -46], [-6, -46], [-12, -44.5], [-12, -30],
    [-18, -24], [-17, -8], [-12, 0], [-11, 22], [-7, 38],
  ];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xa98870, 170, 920);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 3000);
  camera.position.set(52, 20, 64);
  camera.lookAt(1, 9, -5);

  const SUN_DIR = new THREE.Vector3(-0.5, 0.13, -0.86).normalize();
  const skyUniforms = {
    uTop: { value: new THREE.Color(0x081c31) },
    uHorizon: { value: new THREE.Color(0xe08a52) },
    uSun: { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color(0xff9e5e) },
    uCloud: { value: new THREE.Color(0x4a3a32) },
    uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 48, 28),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uSun, uSunColor, uCloud;
        uniform float uTime;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for(int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.42));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          col = mix(col, uSunColor, smoothstep(0.25, 0.98, sd) * 0.32);
          col += uSunColor * pow(sd, 900.0) * 2.2;
          col += uSunColor * pow(sd, 22.0) * 0.34;
          vec2 cp = d.xz / (max(d.y, 0.012) + 0.12);
          float band = exp(-pow((d.y - 0.10) / 0.075, 2.0));
          float cl = fbm(cp * 0.72 + vec2(uTime * 0.004, 1.7));
          cl = smoothstep(0.38, 0.60, cl) * smoothstep(0.015, 0.12, d.y) * (1.0 - smoothstep(0.34, 0.62, d.y));
          cl += smoothstep(0.46, 0.63, fbm(cp * 1.9 + vec2(4.0, uTime * 0.006))) * band * 0.65;
          vec3 cloudCol = mix(uCloud, uSunColor, 0.22 + 0.36 * sd);
          col = mix(col, cloudCol, clamp(cl, 0.0, 1.0) * 0.78);
          col = mix(col, uHorizon, smoothstep(0.1, -0.015, d.y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0x9fb6c9, 0x0e1c27, 0.26);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9e5e, 3.35);
  sun.position.copy(SUN_DIR.clone().multiplyScalar(120));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0x9fc6e6, 0.8);
  fill.position.set(55, 34, 72);
  scene.add(fill);
  const topFill = new THREE.DirectionalLight(0x9fb6c9, 0.45);
  topFill.position.set(8, 55, 18);
  scene.add(topFill);

  function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, "rgba(255,255,255,.35)");
    g.addColorStop(1, outer);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function makeFoamTexture(w = 512, h = 512, fade = true, radial = false) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const px = Math.random() * w, py = Math.random() * h;
      const rw = 3 + Math.random() * 26, rh = 1 + Math.random() * 7;
      x.fillStyle = `rgba(234,246,250,${0.04 + Math.random() * 0.28})`;
      x.beginPath(); x.ellipse(px, py, rw, rh, Math.random() * Math.PI, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 110; i++) {
      const px = Math.random() * w, py = Math.random() * h;
      x.strokeStyle = `rgba(245,252,255,${0.05 + Math.random() * 0.22})`;
      x.lineWidth = 0.8 + Math.random() * 4;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + 12, py + 3, px + 18 + Math.random() * 28, py + 1); x.stroke();
    }
    if (fade) {
      x.globalCompositeOperation = "destination-in";
      if (radial) {
        const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(255,255,255,.95)");
        g.addColorStop(0.55, "rgba(255,255,255,.6)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g;
      } else {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.18, "rgba(255,255,255,.85)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g;
      }
      x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = "source-over";
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture("rgba(255,246,226,1)"), color: 0xfff3d8, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.48,
  }));
  sunSprite.position.copy(SUN_DIR.clone().multiplyScalar(1250));
  sunSprite.scale.set(130, 130, 1);
  scene.add(sunSprite);

  // HDR-ish environment for metal / canopy reflections
  function makeEnvCanvas(night) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
    const x = c.getContext("2d");
    const sky = x.createLinearGradient(0, 0, 0, 512);
    if (night) {
      sky.addColorStop(0, "#01050c"); sky.addColorStop(0.44, "#0a1826");
      sky.addColorStop(0.5, "#183247"); sky.addColorStop(0.56, "#061520"); sky.addColorStop(1, "#01060b");
    } else {
      sky.addColorStop(0, "#173a5e"); sky.addColorStop(0.42, "#c98a62");
      sky.addColorStop(0.5, "#f0b579"); sky.addColorStop(0.56, "#7b5b48"); sky.addColorStop(1, "#020d15");
    }
    x.fillStyle = sky; x.fillRect(0, 0, 1024, 512);
    const u = (Math.atan2(SUN_DIR.z, SUN_DIR.x) / (Math.PI * 2) + 0.5) * 1024;
    const v = (0.5 - Math.asin(SUN_DIR.y) / Math.PI) * 512;
    const g = x.createRadialGradient(u, v, 2, u, v, night ? 100 : 220);
    g.addColorStop(0, night ? "rgba(210,232,250,.95)" : "rgba(255,236,200,1)");
    g.addColorStop(0.15, night ? "rgba(160,190,220,.3)" : "rgba(255,198,132,.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 180; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
      x.fillRect(Math.random() * 1024, Math.random() * 300, 1 + Math.random() * 80, 1 + Math.random() * 10);
    }
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envLight = pmrem.fromEquirectangular(makeEnvCanvas(false)).texture;
  const envDark = pmrem.fromEquirectangular(makeEnvCanvas(true)).texture;
  scene.environment = envLight;

  /* ── sea ───────────────────────────────────────────────── */
  const seaUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x03111c) },
    uShallow: { value: new THREE.Color(0x0a2a3d) },
    uSky: { value: new THREE.Color(0x6b93aa) },
    uSun: { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color(0xff9e5e) },
    uHorizon: { value: new THREE.Color(0xd38a5c) },
    uFog: { value: new THREE.Color(0xa98870) },
    uFogNear: { value: 180 },
    uFogFar: { value: 950 },
    uShipYaw: { value: SHIP_YAW },
    uHullCenter: { value: new THREE.Vector2(-3.5, 0) },
    uHullHalf: { value: new THREE.Vector2(15.0, 46.0) },
  };
  const seaGeo = new THREE.PlaneGeometry(4000, 4000, 420, 420);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, new THREE.ShaderMaterial({
    uniforms: seaUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      float wave(vec2 p){
        return sin(p.x * 0.085 + uTime * 0.62) * 0.38
             + sin(p.y * 0.115 - uTime * 0.47) * 0.26
             + sin((p.x + p.y) * 0.038 + uTime * 0.31) * 0.46
             + sin((p.x - p.y) * 0.21 + uTime * 1.1) * 0.08;
      }
      void main(){
        vec3 p = position;
        float h = wave(p.xz);
        p.y += h;
        vWave = h;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uDeep, uShallow, uSky, uSun, uSunColor, uFog, uHorizon;
      uniform float uTime, uFogNear, uFogFar, uShipYaw;
      uniform vec2 uHullCenter, uHullHalf;
      varying vec3 vWorld;
      varying float vWave;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      float surf(vec2 p){
        return sin(p.x * 0.024 + p.y * 0.011 + uTime * 0.22) * 0.55
             + sin(p.x * 0.061 - p.y * 0.037 + uTime * 0.34) * 0.28
             + sin(p.x * 0.145 + p.y * 0.093 + uTime * 0.61) * 0.11
             + (noise(p * 0.09 + vec2(uTime * 0.02, 0.0)) - 0.5) * 0.2;
      }
      float detail(vec2 p){
        return noise(p * 0.055 + vec2(uTime * 0.018, 0.0)) * 0.55
             + noise(p * 0.16 - vec2(0.0, uTime * 0.026)) * 0.3
             + noise(p * 0.5 + vec2(uTime * 0.04, uTime * 0.012)) * 0.15;
      }
      void main(){
        vec3 nGeo = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (nGeo.y < 0.0) nGeo = -nGeo;
        vec2 p = vWorld.xz;
        float e = 1.6;
        float d0 = detail(p);
        float dx = detail(p + vec2(e, 0.0)) - d0;
        float dz = detail(p + vec2(0.0, e)) - d0;
        vec3 nDetail = normalize(vec3(-dx * 3.2, 1.0, -dz * 3.2));
        vec3 n = normalize(mix(nGeo, nDetail, 0.28));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.5);
        vec3 col = mix(uDeep, uShallow, smoothstep(-1.2, 1.3, vWave) * 0.72 + 0.12);
        vec3 skyRef = mix(uHorizon, uSky, smoothstep(0.0, 0.18, n.y));
        col = mix(col, skyRef, fres * 0.34);
        vec3 sunDir = normalize(uSun);
        vec3 hv = normalize(viewDir + sunDir);
        float nh = max(dot(n, hv), 0.0);
        float spec = pow(nh, 720.0);
        float broad = pow(nh, 22.0);
        float glintMask = smoothstep(0.42, 0.92, detail(p * 7.0 + vec2(uTime * 0.22, 0.0)));
        vec2 toSun = normalize(sunDir.xz);
        vec2 toFrag = normalize(vWorld.xz - cameraPosition.xz);
        float path = pow(max(dot(toFrag, toSun), 0.0), 5.0);
        float sparkle = step(0.988, noise(p * 4.2 + vec2(uTime * 0.5, 0.0))) * pow(nh, 10.0) * 5.0;
        col += uSunColor * (spec * 3.2 + broad * 0.16 * (0.2 + path) * glintMask + sparkle * (0.25 + path * 0.9) + path * 0.025);
        float crest = smoothstep(0.82, 1.32, vWave);
        float foamNoise = smoothstep(0.42, 0.8, noise(p * 0.55 + vec2(uTime * 0.035, 0.0)));
        col = mix(col, vec3(0.68, 0.78, 0.84), crest * foamNoise * 0.24);
        // near-hull foam ring, done in the sea shader so it never becomes a
        // free-standing plane or billboard layer
        vec2 q = p - uHullCenter;
        float cs = cos(uShipYaw), sn = sin(uShipYaw);
        vec2 lp = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
        float hd = length(vec2(lp.x / uHullHalf.x, lp.y / uHullHalf.y));
        float hullFoam = smoothstep(1.17, 1.02, hd) * smoothstep(0.985, 1.005, hd);
        float nearFoam = hullFoam * (0.32 + 0.68 * foamNoise);
        col = mix(col, vec3(0.62, 0.70, 0.75), nearFoam * 0.32);
        float dist = length(vWorld.xz - cameraPosition.xz);
        col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sea.position.y = -4.35;
  scene.add(sea);

  /* ── deck texture ──────────────────────────────────────── */
  const TEX_W = 2048, TEX_H = 1024;
  const deckCanvas = document.createElement("canvas");
  deckCanvas.width = TEX_W;
  deckCanvas.height = TEX_H;
  const dc = deckCanvas.getContext("2d");
  const DX = (x) => ((x + 22) / 44) * TEX_W;
  const DY = (z) => ((52 - z) / 104) * TEX_H;
  const deckPath = () => {
    dc.beginPath();
    DECK.forEach(([x, z], i) => { const px = DX(x), py = DY(z); i ? dc.lineTo(px, py) : dc.moveTo(px, py); });
    dc.closePath();
  };
  function strip(x1, z1, x2, z2, width, fill, stroke = null) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const px = (dz / len) * width / 2, pz = (-dx / len) * width / 2;
    dc.beginPath();
    dc.moveTo(DX(x1 + px), DY(z1 + pz));
    dc.lineTo(DX(x2 + px), DY(z2 + pz));
    dc.lineTo(DX(x2 - px), DY(z2 - pz));
    dc.lineTo(DX(x1 - px), DY(z1 - pz));
    dc.closePath();
    if (fill) { dc.fillStyle = fill; dc.fill(); }
    if (stroke) { dc.strokeStyle = stroke; dc.lineWidth = 3; dc.stroke(); }
  }
  function drawDeckTexture() {
    dc.clearRect(0, 0, TEX_W, TEX_H);
    dc.save();
    deckPath();
    dc.clip();
    const g = dc.createLinearGradient(0, 0, TEX_W, TEX_H);
    g.addColorStop(0, "#566166");
    g.addColorStop(0.45, "#485257");
    g.addColorStop(1, "#3d474b");
    dc.fillStyle = g;
    dc.fillRect(0, 0, TEX_W, TEX_H);

    // non-skid grain
    for (let i = 0; i < 26000; i++) {
      const v = Math.random();
      dc.fillStyle = v > 0.55 ? `rgba(255,255,255,${0.02 + Math.random() * 0.05})` : `rgba(0,0,0,${0.03 + Math.random() * 0.08})`;
      const s = 1 + Math.random() * 2.2;
      dc.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, s, s);
    }
    // panel seams / tie downs
    dc.strokeStyle = "rgba(16,22,26,.26)";
    dc.lineWidth = 1.4;
    for (let x = -18; x <= 18; x += 6) {
      dc.beginPath(); dc.moveTo(DX(x), DY(44)); dc.lineTo(DX(x), DY(-44)); dc.stroke();
    }
    for (let z = -40; z <= 40; z += 12) {
      dc.beginPath(); dc.moveTo(DX(-20), DY(z)); dc.lineTo(DX(20), DY(z)); dc.stroke();
    }
    dc.fillStyle = "rgba(10,16,20,.34)";
    for (let x = -16; x <= 16; x += 3.2) {
      for (let z = -42; z <= 42; z += 3.2) {
        dc.beginPath(); dc.arc(DX(x), DY(z), 1.2, 0, Math.PI * 2); dc.fill();
      }
    }

    // angled landing area
    strip(-14, -42, 4, 18, 7.5, "rgba(28,36,41,.55)");
    strip(-14, -42, 4, 18, 7.5, null, "rgba(238,238,230,.72)");
    for (let t = 0.06; t < 1; t += 0.055) {
      const x = -14 + (4 + 14) * t, z = -42 + (18 + 42) * t;
      const dx = 18, dz = 60, l = Math.hypot(dx, dz);
      const px = (dz / l) * 2.4, pz = (-dx / l) * 2.4;
      dc.strokeStyle = "rgba(235,236,228,.7)";
      dc.lineWidth = 2.4;
      dc.beginPath(); dc.moveTo(DX(x + px), DY(z + pz)); dc.lineTo(DX(x - px), DY(z - pz)); dc.stroke();
    }
    // 3 wires
    [0.12, 0.2, 0.28].forEach((t) => {
      const x = -14 + 18 * t, z = -42 + 60 * t;
      const dx = 18, dz = 60, l = Math.hypot(dx, dz);
      const px = (dz / l) * 4.2, pz = (-dx / l) * 4.2;
      dc.strokeStyle = "rgba(228,232,234,.9)";
      dc.lineWidth = 3;
      dc.beginPath(); dc.moveTo(DX(x + px), DY(z + pz)); dc.lineTo(DX(x - px), DY(z - pz)); dc.stroke();
    });
    dc.font = "700 22px monospace";
    dc.fillStyle = "rgba(238,238,230,.7)";
    dc.fillText("3 · 2 · 1 WIRE", DX(-15), DY(-47));

    // bow catapults
    strip(-4.2, 40, -3.2, 12, 1.7, "rgba(32,40,45,.65)", "rgba(217,180,92,.8)");
    strip(2.2, 40, 3.2, 12, 1.7, "rgba(32,40,45,.65)", "rgba(217,180,92,.8)");
    strip(-12, -14, 3, 12, 1.5, "rgba(32,40,45,.65)", "rgba(217,180,92,.8)");
    dc.font = "700 26px monospace";
    dc.fillStyle = "rgba(217,180,92,.82)";
    dc.save(); dc.translate(DX(-5.4), DY(9)); dc.rotate(-0.06); dc.fillText("CAT 1", 0, 0); dc.restore();
    dc.save(); dc.translate(DX(1.2), DY(9)); dc.rotate(-0.06); dc.fillText("CAT 2", 0, 0); dc.restore();
    dc.save(); dc.translate(DX(-10.4), DY(-6)); dc.rotate(-0.4); dc.fillText("CAT 3", 0, 0); dc.restore();
    dc.font = "700 16px monospace";
    dc.fillStyle = "rgba(238,238,230,.5)";
    dc.fillText("EMALS", DX(-5.4), DY(17));
    dc.fillText("EMALS", DX(1.4), DY(17));

    // JBD hazard
    [[-5.4, 10.5], [0.8, 10.5], [-12.6, -13]].forEach(([x, z]) => {
      dc.save(); dc.translate(DX(x), DY(z)); dc.rotate(-0.05);
      for (let i = 0; i < 7; i++) { dc.fillStyle = i % 2 ? "rgba(217,180,92,.9)" : "rgba(46,54,59,.9)"; dc.fillRect(-44 + i * 13, -6, 13, 14); }
      dc.restore();
    });

    // elevators
    [[12.8, 14], [12.8, -18]].forEach(([x, z]) => {
      dc.setLineDash([9, 7]);
      dc.strokeStyle = "rgba(217,180,92,.8)";
      dc.lineWidth = 2.5;
      dc.strokeRect(DX(x - 3.4), DY(z - 4.2), DX(x + 3.4) - DX(x - 3.4), DY(z + 4.2) - DY(z - 4.2));
      dc.setLineDash([]);
    });

    // yellow deck-edge / taxi lines
    dc.strokeStyle = "rgba(217,180,92,.85)";
    dc.lineWidth = 4;
    dc.beginPath();
    dc.moveTo(DX(-10.2), DY(38)); dc.lineTo(DX(-10.2), DY(18)); dc.lineTo(DX(-16.2), DY(-22));
    dc.stroke();
    dc.beginPath();
    dc.moveTo(DX(9.6), DY(38)); dc.lineTo(DX(9.6), DY(-36));
    dc.stroke();
    // parking boxes (starboard aft)
    dc.strokeStyle = "rgba(240,240,232,.55)";
    dc.lineWidth = 2.2;
    [[7.4, -34], [7.4, -27], [7.4, -20], [-3.8, -38]].forEach(([x, z], i) => {
      dc.save(); dc.translate(DX(x), DY(z)); dc.rotate(-0.05);
      dc.strokeRect(-34, -26, 68, 52);
      dc.font = "700 16px monospace"; dc.fillStyle = "rgba(240,240,232,.5)"; dc.fillText("P" + (i + 1), -28, -32);
      dc.restore();
    });
    dc.font = "700 17px monospace";
    dc.fillStyle = "rgba(217,180,92,.78)";
    dc.fillText("ELEV 1", DX(12.8), DY(8));
    dc.fillText("ELEV 2", DX(12.8), DY(-24));

    // numbers / name
    dc.textAlign = "center";
    dc.fillStyle = "rgba(248,246,238,.98)";
    dc.font = "800 225px monospace";
    dc.fillText("18", DX(0), DY(33));
    dc.font = "600 26px monospace";
    dc.fillStyle = "rgba(242,240,232,.55)";
    dc.fillText("福建", DX(0), DY(-42.5));
    dc.textAlign = "left";

    // tire marks / stains
    dc.strokeStyle = "rgba(8,12,14,.35)";
    dc.lineWidth = 5;
    [[-13.4, -38, 2.2, 12], [-14.8, -40, 1.4, 10], [-11.8, -36, 3.4, 14]].forEach(([x1, z1, x2, z2]) => {
      dc.beginPath(); dc.moveTo(DX(x1), DY(z1)); dc.lineTo(DX(x2), DY(z2)); dc.stroke();
    });
    for (let i = 0; i < 20; i++) {
      dc.fillStyle = `rgba(10,16,20,${0.05 + Math.random() * 0.1})`;
      dc.beginPath(); dc.ellipse(Math.random() * TEX_W, Math.random() * TEX_H, 20 + Math.random() * 60, 8 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2); dc.fill();
    }
    dc.restore();
    dc.save(); deckPath(); dc.strokeStyle = "rgba(220,230,235,.62)"; dc.lineWidth = 4; dc.stroke(); dc.restore();

      const tex = new THREE.CanvasTexture(deckCanvas);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  function makeNumberTexture(text, size = 256) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d");
    x.clearRect(0, 0, size, size);
    x.fillStyle = "rgba(244,242,234,.96)";
    x.font = `800 ${size * 0.55}px monospace`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(text, size / 2, size / 2 + size * 0.02);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function makeWindowsTexture(cols = 12) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#10161b"; x.fillRect(0, 0, 512, 64);
    for (let i = 0; i < cols; i++) {
      const on = Math.random() > 0.22;
      x.fillStyle = on ? (Math.random() > 0.25 ? "#ffd9a6" : "#9fd3e6") : "#26333d";
      x.fillRect(12 + i * (488 / cols), 16, (488 / cols) * 0.58, 30);
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  /* ── carrier ───────────────────────────────────────────── */
  const ship = new THREE.Group();
  ship.rotation.y = SHIP_YAW;
  scene.add(ship);

  const deckShape = new THREE.Shape();
  DECK.forEach(([x, z], i) => { i ? deckShape.lineTo(x, -z) : deckShape.moveTo(x, -z); });

  const hullGeo = new THREE.ExtrudeGeometry(deckShape, { depth: 5, bevelEnabled: false, curveSegments: 1 });
  hullGeo.rotateX(-Math.PI / 2);
  function makeHullTexture() {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
    const x = c.getContext("2d");
    x.fillStyle = "#273136"; x.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${Math.random() * 0.05})` : `rgba(10,18,22,${Math.random() * 0.09})`;
      x.fillRect(Math.random() * 1024, Math.random() * 512, 2 + Math.random() * 30, 1 + Math.random() * 5);
    }
    // vertical plating seams
    x.strokeStyle = "rgba(4,8,10,.62)"; x.lineWidth = 3;
    for (let i = 0; i < 1024; i += 58) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); }
    x.strokeStyle = "rgba(154,168,174,.13)"; x.lineWidth = 1;
    for (let i = 2; i < 1024; i += 58) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); }
    for (let i = 0; i < 34; i++) {
      const x0 = Math.random() * 1024, y0 = 140 + Math.random() * 300, h = 30 + Math.random() * 120;
      const sg = x.createLinearGradient(x0, y0, x0, y0 + h);
      sg.addColorStop(0, "rgba(176,188,192,.10)"); sg.addColorStop(1, "rgba(176,188,192,0)");
      x.fillStyle = sg; x.fillRect(x0, y0, 1 + Math.random() * 4, h);
    }
    x.strokeStyle = "rgba(10,17,21,.34)"; x.lineWidth = 2;
    for (let y = 40; y < 512; y += 52) { x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke(); }
    // rust / grime streaks
    for (let i = 0; i < 45; i++) {
      const x0 = Math.random() * 1024, y0 = 120 + Math.random() * 300, h = 30 + Math.random() * 150;
      const g = x.createLinearGradient(x0, y0, x0, y0 + h);
      g.addColorStop(0, "rgba(88,52,32,.28)"); g.addColorStop(1, "rgba(88,52,32,0)");
      x.fillStyle = g; x.fillRect(x0, y0, 3 + Math.random() * 8, h);
    }
    // darker waterline
    const g2 = x.createLinearGradient(0, 400, 0, 512);
    g2.addColorStop(0, "rgba(5,12,16,0)"); g2.addColorStop(1, "rgba(5,12,16,.55)");
    x.fillStyle = g2; x.fillRect(0, 400, 1024, 112);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2f383d, map: makeHullTexture(), roughness: 0.9, metalness: 0.1, envMapIntensity: 0.35 });
  // ExtrudeGeometry cap group (index 0) is the horizontal top/bottom face.  The
  // deck texture is clipped to the deck outline, so wherever that clipping and
  // the hull outline do not line up the grey cap shows up as a flat shelf under
  // the deck edge.  Keep the cap dark; only the side plating should be grey.
  const hullCapMat = new THREE.MeshStandardMaterial({ color: 0x151c20, roughness: 0.98, metalness: 0.02, visible: false });
  const hull = new THREE.Mesh(hullGeo, [hullCapMat, hullMat]);
  hull.position.y = -5;
  hull.castShadow = true;
  hull.receiveShadow = true;
  ship.add(hull);
  // hangar floor removed: it is a large plane under the deck and can poke
  // out past the bow at low camera angles.

  // hull number 18 on both sides, boat bay, draft marks
  (function hullDetails() {
    const numTex = makeNumberTexture("18", 256);
    [-1, 1].forEach((sd) => {
      const num = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), new THREE.MeshBasicMaterial({ map: numTex, transparent: true, opacity: 0.82 }));
      num.rotation.y = sd * Math.PI / 2;
      num.position.set(sd * 11.03, -1.9, 27);
      ship.add(num);
    });
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x121a1e, roughness: 0.85, metalness: 0.15 });
    const bay = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 4.2), bayMat);
    bay.position.set(11.02, -2.5, -27);
    ship.add(bay);
    const bayEdge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.85, 4.35), new THREE.MeshBasicMaterial({ color: 0x9a7c45, transparent: true, opacity: 0.5 }));
    bayEdge.position.set(11.09, -2.5, -27); ship.add(bayEdge);
    const draftC = document.createElement("canvas"); draftC.width = 64; draftC.height = 256;
    const dx = draftC.getContext("2d");
    dx.fillStyle = "rgba(220,226,222,.55)"; dx.font = "600 15px monospace";
    for (let i = 0; i < 6; i++) {
      dx.fillRect(8, 20 + i * 36, 22, 2);
      dx.fillText(String(i + 1), 36, 27 + i * 36);
    }
    const dt = new THREE.CanvasTexture(draftC);
    [1, -1].forEach((sd) => {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 3.2), new THREE.MeshBasicMaterial({ map: dt, transparent: true, opacity: 0.6 }));
      d.rotation.y = sd * Math.PI / 2; d.position.set(sd * 11.04, -3.0, 36); ship.add(d);
    });
  })();

  const redBand = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0x6d332a, roughness: 0.8 }));
  redBand.position.y = -4.72;
  redBand.scale.y = 0.12;
  ship.add(redBand);

  function makeDeckSurface() {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const x = c.getContext("2d");
    x.fillStyle = "#808080"; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 22000; i++) {
      x.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${Math.random() * 0.25})` : `rgba(0,0,0,${Math.random() * 0.3})`;
      x.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(28,28,28,${0.04 + Math.random() * 0.12})`;
      x.lineWidth = 1 + Math.random() * 3;
      x.beginPath(); x.moveTo(Math.random() * 512, Math.random() * 512); x.lineTo(Math.random() * 512, Math.random() * 512); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 6);
    return t;
  }
  const deckSurface = makeDeckSurface();
  const deckMat = new THREE.MeshStandardMaterial({
    map: drawDeckTexture(), color: 0x5c666a, transparent: true, alphaTest: 0.45,
    roughness: 1, metalness: 0, envMapIntensity: 0.05,
    bumpMap: deckSurface, bumpScale: 0.025,
  });
  // The deck used to be a 44x104 rectangle with a clipped texture.  The
  // rectangle is wider than the hull, so any texture/UV mismatch leaves a
  // deck-coloured slab sticking out over the water.  Build the deck from the
  // same DECK outline as the hull and map UVs with the same DX/DY projection.
  const deckGeo = new THREE.ShapeGeometry(deckShape, 1);
  {
    const p = deckGeo.attributes.position;
    const uv = deckGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i); // local y = -z
      uv.setXY(i, (x + 22) / 44, (52 - y) / 104);
    }
    uv.needsUpdate = true;
  }
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.03;
  deck.receiveShadow = true;
  ship.add(deck);

  // deck number / name decals (unlit so they stay legible at dusk)
  const deckNumber = new THREE.Mesh(
    new THREE.PlaneGeometry(10.5, 10.5),
    new THREE.MeshBasicMaterial({ map: makeNumberTexture("18", 512), transparent: true, toneMapped: false, depthWrite: false }),
  );
  deckNumber.rotation.x = -Math.PI / 2;
  deckNumber.rotation.z = Math.PI;
  deckNumber.position.set(0, 0.07, 32);
  ship.add(deckNumber);
  const deckName = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 1.6),
    new THREE.MeshBasicMaterial({ map: (() => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 160;
      const x = c.getContext("2d"); x.clearRect(0, 0, 512, 160);
      x.fillStyle = "rgba(246,244,236,.9)"; x.font = "700 92px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("福建", 256, 84);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
    })(), transparent: true, toneMapped: false, depthWrite: false }),
  );
  deckName.rotation.x = -Math.PI / 2;
  deckName.position.set(0, 0.07, -41.5);
  ship.add(deckName);

  // 3D deck markings (stay legible even when the texture is in shadow)
  const markWhite = new THREE.MeshBasicMaterial({ color: 0xf2efe4, toneMapped: false, transparent: true, opacity: 0.9 });
  const markYellow = new THREE.MeshBasicMaterial({ color: 0xd9b45c, toneMapped: false, transparent: true, opacity: 0.9 });
  const strip3d = (x1, z1, x2, z2, w, mat, y = 0.075) => {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, len), mat);
    m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(dx, dz);
    ship.add(m);
    return m;
  };
  // angled landing area edges
  const ax1 = -14, az1 = -42, ax2 = 4, az2 = 18;
  const adx = ax2 - ax1, adz = az2 - az1, alen = Math.hypot(adx, adz);
  const px = (adz / alen) * 3.7, pz = (-adx / alen) * 3.7;
  strip3d(ax1 + px, az1 + pz, ax2 + px, az2 + pz, 0.28, markWhite);
  strip3d(ax1 - px, az1 - pz, ax2 - px, az2 - pz, 0.28, markWhite);
  // dashed centerline
  for (let i = 0; i < 18; i++) {
    const t0 = i / 18, t1 = t0 + 0.032;
    strip3d(ax1 + adx * t0, az1 + adz * t0, ax1 + adx * t1, az1 + adz * t1, 0.28, markWhite, 0.078);
  }
  // catapult tracks
  strip3d(-4.2, 40, -3.2, 12, 0.5, markYellow);
  strip3d(2.2, 40, 3.2, 12, 0.5, markYellow);
  strip3d(-12.6, -13.5, 3.4, 12, 0.5, markYellow);
  // small safety / edge dashes
  for (let z = -40; z <= 38; z += 5) {
    strip3d(9.9, z, 9.9, z + 2.2, 0.26, markYellow);
  }
  // deck text decals
  const deckText = (text, x, z, size = 2.4, rot = 0) => {
    const c = document.createElement("canvas"); c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = "rgba(246,244,236,.95)";
    g.font = "700 76px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rot;
    m.position.set(x, 0.085, z);
    ship.add(m);
  };
  deckText("CAT 1", -4, 8, 2.0, 0);
  deckText("CAT 2", 2.4, 8, 2.0, 0);
  deckText("CAT 3", -9, -6, 2.0, -0.3);
  deckText("EMALS", -4, 18, 1.4, 0);
  deckText("EMALS", 2.4, 18, 1.4, 0);

  // bright deck edge outline
  const deckEdge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(DECK.map(([x, z]) => new THREE.Vector3(x * 1.02, 0.09, z * 1.01))),
    new THREE.LineBasicMaterial({ color: 0xe9e6da, transparent: true, opacity: 0.38 }),
  );
  ship.add(deckEdge);

  // island
  const island = new THREE.Group();
  island.position.set(8.4, 0, 0);
  ship.add(island);
  function makeIslandTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const x = c.getContext("2d");
    x.fillStyle = "#818b8e"; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${Math.random() * 0.05})` : `rgba(14,22,26,${Math.random() * 0.07})`;
      x.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 24, 1 + Math.random() * 4);
    }
    x.strokeStyle = "rgba(30,40,44,.32)"; x.lineWidth = 1.6;
    for (let i = 0; i < 512; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); }
    for (let j = 0; j < 512; j += 80) { x.beginPath(); x.moveTo(0, j); x.lineTo(512, j); x.stroke(); }
    x.fillStyle = "rgba(24,32,36,.35)";
    for (let i = 8; i < 512; i += 16) for (let j = 8; j < 512; j += 16) x.fillRect(i, j, 1.1, 1.1);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4);
    return t;
  }
  const islandSkin = makeIslandTexture();
  const grey = new THREE.MeshStandardMaterial({ map: islandSkin, color: 0xc7cccd, roughness: 0.76, metalness: 0.2, envMapIntensity: 0.5 });
  const greyDark = new THREE.MeshStandardMaterial({ color: 0x586266, roughness: 0.76, metalness: 0.22 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18242c, roughness: 0.28, metalness: 0.65 });
  const addBox = (w, h, d, x, y, z, mat, group = island) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  addBox(6.2, 3.4, 12, 0, 1.7, 0, grey);
  addBox(4.4, 2.2, 8, 0, 4.5, 0, grey);
  addBox(0.16, 0.72, 6.6, -3.18, 4.9, 0, glass);
  addBox(0.16, 0.5, 3.2, 3.2, 2.4, 3.4, glass);
  addBox(0.16, 0.5, 3.2, 3.2, 2.4, -3.4, glass);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.4, 8), greyDark);
  mast.position.set(0, 8.6, 0);
  mast.castShadow = true;
  island.add(mast);
  addBox(1.4, 1.5, 0.7, 0, 7.7, 0, greyDark);
  addBox(0.7, 1.1, 1.4, 0, 8.4, 0, greyDark);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), grey);
  dome.position.set(0, 12.1, 0);
  island.add(dome);
  addBox(2.8, 0.24, 3.4, -3.4, 3.6, 0, greyDark);
  addBox(0.25, 0.6, 0.25, -4.7, 3.2, 0, greyDark);
  const numberMat = new THREE.MeshBasicMaterial({ map: makeNumberTexture("18"), transparent: true, depthWrite: false, toneMapped: false });
  const numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), numberMat);
  numberPlane.position.set(3.46, 2.1, 0);
  numberPlane.rotation.y = Math.PI / 2;
  island.add(numberPlane);

  // lit bridge windows
  const winMat = new THREE.MeshBasicMaterial({ map: makeWindowsTexture(14), transparent: true, toneMapped: false });
  const winF = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 0.62), winMat);
  winF.position.set(0, 4.9, 4.03); island.add(winF);
  const winSlope = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.7), winMat);
  winSlope.position.set(0, 5.35, 4.16); winSlope.rotation.x = -0.22; island.add(winSlope);
  (function islandAESA() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 160;
    const g = c.getContext("2d");
    g.fillStyle = "#1a2c38"; g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "rgba(118,170,198,.5)"; g.lineWidth = 2;
    for (let i = 8; i < 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 160); g.stroke(); }
    for (let j = 8; j < 160; j += 16) { g.beginPath(); g.moveTo(0, j); g.lineTo(256, j); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.4), new THREE.MeshStandardMaterial({ map: t, color: 0x8aa6b6, roughness: 0.35, metalness: 0.5, emissive: 0x0a1822, emissiveIntensity: 0.5 }));
    m.position.set(0, 7.2, 5.09); island.add(m);
  })();
  const winS = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 0.62), winMat);
  winS.rotation.y = Math.PI / 2; winS.position.set(2.22, 4.9, 0); island.add(winS);
  const winP = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 0.62), winMat);
  winP.rotation.y = -Math.PI / 2; winP.position.set(-2.22, 4.9, 0); island.add(winP);

  // island radars and details
  const aesaMat = new THREE.MeshStandardMaterial({ color: 0x1d3546, roughness: 0.36, metalness: 0.62, emissive: 0x071724, emissiveIntensity: 0.6 });
  addBox(0.16, 1.5, 2.8, 3.12, 7.2, 2.4, aesaMat, island);
  addBox(0.16, 1.5, 2.8, -3.12, 7.2, 2.4, aesaMat, island);
  addBox(1.1, 1.1, 0.16, 0, 6.3, 3.1, aesaMat, island);
  addBox(2.6, 1.2, 3.2, 0, 6.2, -4.1, greyDark, island);
  addBox(4.4, 2.8, 1.5, 0, 7.2, 4.3, grey, island);
  const aesaHousing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x2a4658, roughness: 0.4, metalness: 0.5 }));
  aesaHousing.position.set(0, 7.2, 4.98); island.add(aesaHousing);
  addBox(2.8, 0.16, 3.4, 0, 6.86, -4.1, new THREE.MeshStandardMaterial({ color: 0x161e22, roughness: 0.96 }), island);
  const dome2 = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), grey);
  dome2.position.set(2.9, 6.6, -3.2); island.add(dome2);
  const ciwsMat = new THREE.MeshStandardMaterial({ color: 0x4f5c61, roughness: 0.62, metalness: 0.4 });
  [[3.4, 5.5], [-3.4, 5.5], [3.4, -5.5]].forEach(([x, z]) => {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 10), ciwsMat);
    base.position.set(x, 0.85, z); island.add(base);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 8), ciwsMat);
    gun.rotation.x = Math.PI / 2.6; gun.position.set(x, 1.3, z); island.add(gun);
  });
  const floodMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, toneMapped: false });
  [-4.5, -1.5, 1.5, 4.5].forEach((z) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), floodMat);
    l.position.set(-3.2, 5.65, z); island.add(l);
  });
  const islandLight = new THREE.PointLight(0xffd2a0, 0, 1, 2);
  islandLight.position.set(4, 7, 0); scene.add(islandLight);
  const islandLight2 = new THREE.PointLight(0xffd2a0, 0, 1, 2);
  islandLight2.position.set(5, 6, -6); scene.add(islandLight2);

  // island ladder / railing / antennas
  (function islandDetails() {
    const railMat2 = new THREE.MeshStandardMaterial({ color: 0x899397, roughness: 0.6, metalness: 0.35 });
    for (let y = 0.9; y < 4.2; y += 0.5) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.035, 0.035), railMat2);
      rung.position.set(2.35, y, 6.03); island.add(rung);
    }
    const railA = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.035, 0.035), railMat2);
    railA.position.set(2.35, 4.4, 6.03); island.add(railA);
    [-0.6, 0.6].forEach((dx) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 3.6, 0.035), railMat2);
      post.position.set(2.35 + dx, 2.5, 6.03); island.add(post);
    });
    const topRailPts = [
      new THREE.Vector3(-2.1, 5.7, 3.9), new THREE.Vector3(2.1, 5.7, 3.9),
      new THREE.Vector3(2.1, 5.7, -3.9), new THREE.Vector3(-2.1, 5.7, -3.9),
    ];
    const topRail = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(topRailPts), new THREE.LineBasicMaterial({ color: 0xaab4b7, transparent: true, opacity: 0.5 }));
    island.add(topRail);
    for (let i = 0; i < 3; i++) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 2.5 + i * 0.5, 4), railMat2);
      ant.position.set(-0.7 + i * 0.7, 11 + i * 0.2, 0.4 - i * 0.4); island.add(ant);
    }
  })();

  // Thin catwalk ring. The old rim was a solid deck-shaped slab and read as
  // a grey layer; this one is a hollow ring only a few tenths of a metre wide.
  (function deckCatwalk() {
    const outer = new THREE.Shape();
    DECK.forEach(([x, z], i) => { const px = x * 1.022, pz = z * 1.01; i ? outer.lineTo(px, -pz) : outer.moveTo(px, -pz); });
    const inner = new THREE.Path();
    DECK.forEach(([x, z], i) => { i ? inner.lineTo(x, -z) : inner.moveTo(x, -z); });
    outer.holes.push(inner);
    const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1d262a, roughness: 0.92, metalness: 0.08 }));
    ring.position.y = -0.14;
    ring.receiveShadow = true;
    ship.add(ring);
  })();

  // deck edge railing posts + line
  const railMat = new THREE.LineBasicMaterial({ color: 0xaeb9bd, transparent: true, opacity: 0.32 });
  const railPts = DECK.map(([x, z]) => new THREE.Vector3(x * 1.035, 0.95, z * 1.02));
  const railLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(railPts), railMat);
  ship.add(railLine);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8b969a, roughness: 0.7 });
  for (let i = 0; i < DECK.length; i++) {
    const a = DECK[i], b = DECK[(i + 1) % DECK.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.floor(len / 4));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const x = (a[0] + (b[0] - a[0]) * t) * 1.035;
      const z = (a[1] + (b[1] - a[1]) * t) * 1.02;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 4), postMat);
      p.position.set(x, 0.47, z);
      ship.add(p);
    }
  }

  // hull sponsons are intentionally not added as flat slabs; they read as
  // floating grey shelves at this scale. Keep the hull side clean.

  // hull panel seams + life rafts
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x222b2f, transparent: true, opacity: 0.55 });
  for (let z = -30; z <= 16; z += 5.2) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.9, 0.09), seamMat);
    seam.position.set(11.03, -2.2, z); ship.add(seam);
  }
  const hSeam = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 48), seamMat);
  hSeam.position.set(11.04, -1.6, -8); ship.add(hSeam);
  const raftMat = new THREE.MeshStandardMaterial({ color: 0xd7d9d2, roughness: 0.7 });
  for (let z = -24; z <= 12; z += 6) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8), raftMat);
    r.rotation.z = Math.PI / 2; r.position.set(11.15, -0.9, z); r.castShadow = true; ship.add(r);
  }

  // bow anchor recesses
  const anchorMat = new THREE.MeshStandardMaterial({ color: 0x1c2428, roughness: 0.7, metalness: 0.4 });
  [-2.8, 2.8].forEach((x) => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.2), anchorMat);
    a.position.set(x, -1.0, 43.5); ship.add(a);
  });

  // soft contact shadow under the island
  (function islandAO() {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "rgba(0,0,0,.6)"); g.addColorStop(0.6, "rgba(0,0,0,.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(15, 19), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.7 }));
    m.rotation.x = -Math.PI / 2; m.position.set(8.4, 0.055, 0); ship.add(m);
  })();

  // deck edge / centerline lights
  const edgeLightMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false });
  const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x9fe0b0, toneMapped: false });
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const x = -14 + 18 * t, z = -42 + 60 * t;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), greenLightMat);
    l.position.set(x, 0.16, z); ship.add(l);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.065, 5, 4), edgeLightMat);
    e.position.set(x - 2.4, 0.16, z); ship.add(e);
  }
  for (let z = -42; z <= 42; z += 6) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), edgeLightMat);
    l.position.set(10.4, 0.16, z); ship.add(l);
  }


  // elevators
  const elevCanvas = document.createElement("canvas");
  elevCanvas.width = 256; elevCanvas.height = 512;
  const elevCtx = elevCanvas.getContext("2d");
  elevCtx.fillStyle = "#252d31"; elevCtx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 4200; i++) {
    elevCtx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.075)";
    elevCtx.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 4, 1 + Math.random() * 2);
  }
  elevCtx.strokeStyle = "rgba(8,12,14,.55)"; elevCtx.lineWidth = 2;
  for (let i = 0; i < 256; i += 46) { elevCtx.beginPath(); elevCtx.moveTo(i, 0); elevCtx.lineTo(i, 512); elevCtx.stroke(); }
  for (let i = 0; i < 512; i += 64) { elevCtx.beginPath(); elevCtx.moveTo(0, i); elevCtx.lineTo(256, i); elevCtx.stroke(); }
  elevCtx.strokeStyle = "rgba(217,180,92,.32)"; elevCtx.lineWidth = 3;
  elevCtx.strokeRect(10, 10, 236, 492);
  const elevTex = new THREE.CanvasTexture(elevCanvas);
  elevTex.encoding = THREE.sRGBEncoding;
  const elevMat = new THREE.MeshBasicMaterial({ map: elevTex, toneMapped: true });
  const elevEdgeMat = new THREE.LineBasicMaterial({ color: 0xd9b45c, transparent: true, opacity: 0.85 });
  [[12.6, 14], [12.6, -18]].forEach(([x, z]) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 8.4), elevMat);
    e.position.set(x, 0.15, z);
    e.receiveShadow = true; e.castShadow = true;
    ship.add(e);
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(e.geometry), elevEdgeMat);
    line.position.copy(e.position);
    ship.add(line);
  });

  // arresting wires
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xd5dde1, roughness: 0.35, metalness: 0.8 });
  [-30, -34.5, -39].forEach((z) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 11, 6), wireMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(-9.5, 0.18, z);
    ship.add(w);
  });

  // JBD panels（弹射时抬起，平时卧倒）
  const jbdMat = new THREE.MeshStandardMaterial({ color: 0x414a4e, roughness: 0.85, metalness: 0.15 });
  const jbds: THREE.Mesh[] = [];
  [[-4.2, 11.8], [2.2, 11.8], [-12.4, -13.8]].forEach(([x, z]) => {
    const j = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.55, 1.2), jbdMat);
    j.position.set(x, 0.28, z);
    j.rotation.x = -0.34;
    j.castShadow = true;
    ship.add(j);
    jbds.push(j);
  });

  // jets
  function makeJetTexture(kind) {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const x = c.getContext("2d");
    const base = kind === "j15" ? "#748184" : "#5e6c71";
    x.fillStyle = base; x.fillRect(0, 0, 512, 512);
    // paint mottling
    for (let i = 0; i < 1600; i++) {
      x.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${Math.random() * 0.045})` : `rgba(12,20,24,${Math.random() * 0.07})`;
      x.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 28, 1 + Math.random() * 3);
    }
    // panel lines
    x.strokeStyle = "rgba(28,38,42,.42)"; x.lineWidth = 1.4;
    for (let i = 0; i < 512; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); }
    for (let j = 0; j < 512; j += 64) { x.beginPath(); x.moveTo(0, j); x.lineTo(512, j); x.stroke(); }
    x.strokeStyle = "rgba(28,38,42,.25)"; x.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const x0 = Math.random() * 512, y0 = Math.random() * 512;
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + 90, y0 + 30); x.stroke();
    }
    // rivets
    x.fillStyle = "rgba(18,26,30,.5)";
    for (let i = 8; i < 512; i += 16) for (let j = 8; j < 512; j += 16) x.fillRect(i, j, 1.2, 1.2);
    // walkway / grip strip
    x.fillStyle = "rgba(32,40,44,.5)"; x.fillRect(0, 214, 512, 26);
    // warning stripe
    x.fillStyle = "rgba(176,72,56,.5)"; x.fillRect(0, 380, 512, 8);
    x.fillStyle = "rgba(217,180,92,.5)"; x.fillRect(0, 390, 512, 4);
    // grime
    for (let i = 0; i < 24; i++) {
      x.fillStyle = `rgba(24,22,18,${0.03 + Math.random() * 0.08})`;
      x.beginPath(); x.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 48, 2 + Math.random() * 12, Math.random() * Math.PI, 0, Math.PI * 2); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.4, 1.4);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function makeStarTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 256, 256);
    const cx = 128, cy = 128, outer = 88, inner = 34;
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath();
    x.fillStyle = "#b8352f"; x.fill();
    x.strokeStyle = "#e0b45a"; x.lineWidth = 9; x.stroke();
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function makeWingGeo(points, sign, thickness = 0.08) {
    const sh = new THREE.Shape();
    points.forEach(([x, z], i) => {
      const px = x * sign;
      i ? sh.lineTo(px, -z) : sh.moveTo(px, -z);
    });
    const geo = new THREE.ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }

  const starTex = makeStarTexture();
  function makeJet(kind, folded = false) {
    const g = new THREE.Group();
    const tex = makeJetTexture(kind);
    const bodyMat = new THREE.MeshStandardMaterial({
      map: tex, color: kind === "j15" ? 0x4c585d : 0x394549,
      roughness: 0.64, metalness: 0.38, envMapIntensity: 0.72,
      bumpMap: tex, bumpScale: 0.004,
    });
    const wingMat = bodyMat.clone(); wingMat.side = THREE.DoubleSide; wingMat.color.multiplyScalar(0.82); wingMat.roughness = 0.78;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x384449, roughness: 0.55, metalness: 0.45, envMapIntensity: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x667175, roughness: 0.34, metalness: 0.85, envMapIntensity: 1.2 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x081820, roughness: 0.05, metalness: 0.92, envMapIntensity: 2.2 });
    const tailMat = new THREE.MeshStandardMaterial({
      map: tex, color: kind === "j15" ? 0x4c585d : 0x354044,
      roughness: 0.64, metalness: 0.36, envMapIntensity: 0.7, side: THREE.DoubleSide,
    });
    const len = kind === "j15" ? 4.7 : 4.1;
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.44, len, 16, 1), bodyMat);
    fus.rotation.x = Math.PI / 2;
    fus.castShadow = true;
    g.add(fus);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.35, 16), bodyMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = len / 2 + 0.62;
    nose.castShadow = true;
    g.add(nose);
    const radome = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 12), darkMat);
    radome.rotation.x = Math.PI / 2; radome.position.z = len / 2 + 1.18; g.add(radome);
    // dorsal spine
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 2.2), bodyMat);
    spine.position.set(0, 0.32, -0.45); spine.castShadow = true; g.add(spine);
    // chines / leading-edge extensions
    [-1, 1].forEach((s) => {
      const chine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 2.1), bodyMat);
      chine.position.set(s * 0.34, 0.04, 0.65); chine.rotation.y = s * 0.04; g.add(chine);
    });
    // intakes
    [-1, 1].forEach((s) => {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 1.15), darkMat);
      intake.position.set(s * 0.42, -0.06, 0.3); intake.castShadow = true; g.add(intake);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), metalMat);
      lip.position.set(s * 0.42, -0.06, 0.9); lip.rotation.y = Math.PI / 2; g.add(lip);
    });
    // cockpit
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10), glassMat);
    canopy.scale.set(0.72, 0.5, 1.45);
    canopy.position.set(0, 0.3, 0.72);
    g.add(canopy);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 1.15), darkMat);
    frame.position.set(0, 0.12, 0.7); g.add(frame);
    // wings
    const j15Wing = [[0, 1.18], [0.3, 1.12], [3.05, -0.8], [3.28, -1.02], [0, -1.3]];
    const j35Wing = [[0, 1.08], [2.9, -0.5], [3.18, -0.92], [0, -1.22]];
    const wingPts = kind === "j15" ? j15Wing : j35Wing;
    [-1, 1].forEach((s) => {
      const wing = new THREE.Mesh(makeWingGeo(wingPts, s), wingMat);
      wing.position.y = 0.02;
      wing.rotation.z = folded ? s * 1.18 : 0;
      wing.castShadow = true;
      g.add(wing);
      // wingtip rail / light base
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), metalMat);
      tip.rotation.x = Math.PI / 2; tip.position.set(s * 3.02, 0.03, -0.7); g.add(tip);
      if (!folded) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.55), darkMat);
        pylon.position.set(s * 1.75, -0.12, -0.25); g.add(pylon);
        const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.25, 8), metalMat);
        missile.rotation.x = Math.PI / 2; missile.position.set(s * 1.75, -0.22, -0.35); g.add(missile);
        const mNose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 8), metalMat);
        mNose.rotation.x = Math.PI / 2; mNose.position.set(s * 1.75, -0.22, 0.35); g.add(mNose);
        [0, 1].forEach((k) => {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.18), darkMat);
          fin.position.set(s * 1.75 + (k ? 0.1 : -0.1), -0.22, -0.7); g.add(fin);
        });
      }
    });
    // panel / flap / slat lines on the wings
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x1a2327, transparent: true, opacity: 0.5, toneMapped: false });
    [-1, 1].forEach((s) => {
      [ -0.95, -0.1, 0.55 ].forEach((z) => {
        const l = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.012, 0.025), lineMat);
        l.position.set(s * 1.55, 0.085, z); g.add(l);
      });
      const flap = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.025, 0.2), darkMat);
      flap.position.set(s * 1.25, 0.06, -1.16); g.add(flap);
      const slat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.018, 0.12), metalMat);
      slat.position.set(s * 1.25, 0.07, 0.78); g.add(slat);
    });
    // fuselage panel rings
    [-0.65, 0.2, 1.0].forEach((z) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.01, 4, 24), lineMat);
      ring.scale.y = 0.82; ring.position.z = z; g.add(ring);
    });
    // pilot helmet
    const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), darkMat);
    pilot.position.set(0, 0.38, 0.78); g.add(pilot);

    // horizontal stabilizers
    [-1, 1].forEach((s) => {
      const h = new THREE.Mesh(makeWingGeo([[0, 0.75], [1.35, -0.35], [1.5, -0.55], [0, -0.68]], s, 0.07), wingMat);
      h.position.set(0, 0.12, -1.78); h.castShadow = true; g.add(h);
    });
    // twin canted tails
    [-1, 1].forEach((s) => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.25, 0.92), tailMat);
      fin.position.set(s * 0.56, 0.62, -1.78);
      fin.rotation.z = s * 0.2;
      fin.castShadow = true;
      g.add(fin);
      const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.9, 0.1), darkMat);
      rudder.position.set(s * 0.6, 0.62, -2.25); g.add(rudder);
      // star insignia
      const star = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: starTex, transparent: true, depthWrite: false, toneMapped: false }));
      star.position.set(s * 0.615, 0.64, -1.72);
      star.rotation.y = s * Math.PI / 2;
      g.add(star);
    });
    // canards (J-15 only)
    if (kind === "j15") {
      [-1, 1].forEach((s) => {
        const c = new THREE.Mesh(makeWingGeo([[0, 0.55], [0.8, -0.15], [0.9, -0.28], [0, -0.35]], s, 0.06), wingMat);
        c.position.set(0, 0.1, 1.0); c.castShadow = true; g.add(c);
      });
    }
    // engines
    [-1, 1].forEach((s) => {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.55, 12, 1, true), darkMat);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(s * 0.27, 0, -len / 2 - 0.22);
      g.add(nozzle);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), new THREE.MeshBasicMaterial({ color: 0x24140e, toneMapped: false }));
      inner.position.set(s * 0.27, 0, -len / 2 - 0.5); g.add(inner);
    });
    // landing gear
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x11171a, roughness: 0.7, metalness: 0.2 });
    const strutMat = metalMat;
    const noseGear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48), strutMat);
    noseGear.position.set(0, -0.4, 1.25); g.add(noseGear);
    const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10), wheelMat);
    noseWheel.rotation.z = Math.PI / 2; noseWheel.position.set(0, -0.64, 1.25); g.add(noseWheel);
    [-1, 1].forEach((s) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5), strutMat);
      strut.position.set(s * 0.62, -0.4, -0.7); g.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 10), wheelMat);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 0.62, -0.66, -0.7); g.add(wheel);
    });
    // nose pitot
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4), metalMat);
    pitot.rotation.x = Math.PI / 2; pitot.position.set(0, 0.02, len / 2 + 1.35); g.add(pitot);
    // side number
    [-1, 1].forEach((s) => {
      const c = document.createElement("canvas"); c.width = 256; c.height = 128;
      const x = c.getContext("2d");
      x.clearRect(0, 0, 256, 128);
      x.fillStyle = "rgba(236,240,236,.82)"; x.font = "700 72px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("18", 128, 64);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
      decal.position.set(s * 0.37, 0.14, 0.95);
      decal.rotation.y = s * Math.PI / 2;
      g.add(decal);
    });
    g.scale.setScalar(1.24);
    return g;
  }

  const planeMeshes = {};
  const navRed = new THREE.MeshBasicMaterial({ color: 0xff5a4e, toneMapped: false });
  const navGreen = new THREE.MeshBasicMaterial({ color: 0x74e29a, toneMapped: false });
  const planeAO = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.8 });
  })();
  // deck tractors
  (function makeTractors() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb9873a, roughness: 0.62, metalness: 0.25 });
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x2b3337, roughness: 0.4, metalness: 0.4 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x101518, roughness: 0.8 });
    [[6.8, -2.5, 0.35], [4.3, -29, -0.3]].forEach(([x, z, ry]) => {
      const t = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.45, 2.1), bodyMat);
      body.position.y = 0.4; t.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.9), cabMat);
      cab.position.set(0, 0.95, -0.4); t.add(cab);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 1.0), bodyMat);
      roof.position.set(0, 1.32, -0.4); t.add(roof);
      [[-0.55, 0.55], [0.55, 0.55], [-0.55, -0.65], [0.55, -0.65]].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 10), tyre);
        w.rotation.z = Math.PI / 2; w.position.set(wx, 0.22, wz); t.add(w);
      });
      t.position.set(x, 0.03, z); t.rotation.y = ry; t.traverse((o) => { if (o.isMesh) o.castShadow = true; }); ship.add(t);
    });
  })();

  // deck hatches and tie-down rings
  (function deckFittings() {
    const hatchMat = new THREE.MeshStandardMaterial({ color: 0x252d31, roughness: 0.8, metalness: 0.2 });
    [[2.5, 2], [6, -6], [0, -18], [-4, -30], [5, 20]].forEach(([x, z]) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 1.2), hatchMat);
      h.position.set(x, 0.09, z); ship.add(h);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.02, 1.34), new THREE.MeshBasicMaterial({ color: 0x596368 }));
      rim.position.set(x, 0.08, z); ship.add(rim);
    });
    const ringMat2 = new THREE.MeshStandardMaterial({ color: 0x3d464a, roughness: 0.6, metalness: 0.5 });
    for (let i = 0; i < 16; i++) {
      const x = -16 + (i % 4) * 7 + Math.random() * 2;
      const z = -36 + Math.floor(i / 4) * 18 + Math.random() * 3;
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 4, 10), ringMat2);
      r.rotation.x = Math.PI / 2; r.position.set(x, 0.08, z); ship.add(r);
    }
  })();

  // sea interaction: waterline outline + island reflection (no billboard foam)
  (function seaInteraction() {
    // waterline outline
    const wlPts = DECK.map(([x, z]) => new THREE.Vector3(x * 1.02, -4.28, z * 1.01));
    const wl = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(wlPts), new THREE.LineBasicMaterial({ color: 0xdcecf4, transparent: true, opacity: 0.45 }));
    ship.add(wl);


    // warm island light reflected on the water
    const rc = document.createElement("canvas"); rc.width = 64; rc.height = 256;
    const rx = rc.getContext("2d");
    const rg = rx.createLinearGradient(0, 0, 0, 256);
    rg.addColorStop(0, "rgba(255,196,120,.55)");
    rg.addColorStop(1, "rgba(255,196,120,0)");
    rx.fillStyle = rg; rx.fillRect(0, 0, 64, 256);
    const rt = new THREE.CanvasTexture(rc);
    const refl = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 30), new THREE.MeshBasicMaterial({ map: rt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 }));
    refl.rotation.x = -Math.PI / 2;
    refl.position.set(0, -4.24, -2);
    refl.renderOrder = 2;
    ship.add(refl);
  })();
  /* ── escorts (distant scale reference) ─────────────────── */
  /* ── escorts ──────────────────────────────────────────── */
  const foamTex = makeFoamTexture(512, 512, true, false);
  const foamRadialTex = makeFoamTexture(256, 256, true, true);
  const foamPlainTex = makeFoamTexture(256, 256, false, false);

  function makeEscortHullTexture(kind, number) {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 256;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#7c878b");
    g.addColorStop(0.5, "#687377");
    g.addColorStop(1, "#4b555a");
    x.fillStyle = g; x.fillRect(0, 0, 1024, 256);

    // plating seams
    for (let i = 0; i < 26; i++) {
      const px = Math.random() * 1024;
      x.strokeStyle = `rgba(18,26,30,${0.12 + Math.random() * 0.2})`;
      x.lineWidth = 1 + Math.random() * 2;
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px + (Math.random() - 0.5) * 12, 256); x.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const py = Math.random() * 210;
      x.strokeStyle = `rgba(20,28,32,${0.1 + Math.random() * 0.16})`;
      x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(0, py); x.lineTo(1024, py); x.stroke();
    }
    // rust / grime streaks
    for (let i = 0; i < 70; i++) {
      const px = Math.random() * 1024, py = Math.random() * 190;
      x.fillStyle = Math.random() > 0.55 ? `rgba(108,62,42,${0.04 + Math.random() * 0.12})` : `rgba(22,30,34,${0.04 + Math.random() * 0.1})`;
      x.fillRect(px, py, 1 + Math.random() * 2.5, 8 + Math.random() * 52);
    }
    // red anti-fouling waterline
    x.fillStyle = "#5a2b24"; x.fillRect(0, 212, 1024, 44);
    x.fillStyle = "#7c3a30"; x.fillRect(0, 212, 1024, 5);
    x.fillStyle = "rgba(12,18,20,.35)"; x.fillRect(0, 205, 1024, 7);

    // hull number
    x.save();
    x.fillStyle = "rgba(236,238,233,.92)";
    x.font = "700 82px 'Helvetica Neue', Arial, sans-serif";
    x.textAlign = "center";
    x.fillText(String(number), 512, 150);
    x.restore();

    // draft marks near bow
    x.fillStyle = "rgba(232,236,232,.65)";
    x.font = "600 15px monospace";
    for (let i = 0; i < 5; i++) {
      x.fillRect(760, 70 + i * 26, 26, 2);
      x.fillText(String(i + 2), 790, 76 + i * 26);
    }
    // anchor recess
    x.fillStyle = "rgba(16,23,26,.7)";
    x.beginPath(); x.ellipse(160, 120, 34, 20, -0.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = "rgba(32,41,45,.9)";
    x.beginPath(); x.ellipse(160, 120, 25, 13, -0.2, 0, Math.PI * 2); x.fill();

    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function makeEscortDeckTexture(kind) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 1024;
    const x = c.getContext("2d");
    x.fillStyle = "#596367"; x.fillRect(0, 0, 512, 1024);
    // deck plating
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = `rgba(18,26,30,${0.12 + Math.random() * 0.16})`;
      x.lineWidth = 2;
      const px = Math.random() * 512;
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px, 1024); x.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const py = Math.random() * 1024;
      x.strokeStyle = "rgba(18,26,30,.16)"; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(0, py); x.lineTo(512, py); x.stroke();
    }
    // non-skid noise
    for (let i = 0; i < 5000; i++) {
      x.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${0.02 + Math.random() * 0.05})` : `rgba(0,0,0,${0.03 + Math.random() * 0.07})`;
      x.fillRect(Math.random() * 512, Math.random() * 1024, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }
    // centerline / walkway
    x.strokeStyle = "rgba(232,232,220,.5)"; x.lineWidth = 3;
    x.setLineDash([14, 12]);
    x.beginPath(); x.moveTo(256, 40); x.lineTo(256, 980); x.stroke();
    x.setLineDash([]);
    if (kind === "destroyer") {
      // VLS grid
      x.fillStyle = "rgba(22,30,34,.8)";
      x.fillRect(150, 340, 212, 210);
      x.strokeStyle = "rgba(160,170,170,.35)"; x.lineWidth = 2;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) x.strokeRect(160 + i * 49, 350 + j * 49, 40, 40);
      // helo circle
      x.strokeStyle = "rgba(235,236,225,.65)"; x.lineWidth = 5;
      x.beginPath(); x.arc(256, 760, 108, 0, Math.PI * 2); x.stroke();
      x.fillStyle = "rgba(235,236,225,.75)"; x.font = "700 118px 'Helvetica Neue', Arial, sans-serif"; x.textAlign = "center";
      x.fillText("H", 256, 800);
      // bow safety lines
      x.strokeStyle = "rgba(217,180,92,.6)"; x.lineWidth = 4;
      x.beginPath(); x.moveTo(90, 80); x.lineTo(90, 300); x.moveTo(422, 80); x.lineTo(422, 300); x.stroke();
    } else {
      // cargo deck markings
      for (let i = 0; i < 3; i++) {
        x.strokeStyle = "rgba(217,180,92,.55)"; x.lineWidth = 3;
        x.strokeRect(80, 260 + i * 190, 352, 160);
      }
      x.strokeStyle = "rgba(235,236,225,.5)"; x.lineWidth = 4;
      x.beginPath(); x.arc(256, 860, 84, 0, Math.PI * 2); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function makeEscort(kind) {
    const g = new THREE.Group();
    const isSupply = kind === "supply";
    const len = isSupply ? 18 : 14;
    const number = isSupply ? "886" : "101";

    const hullTex = makeEscortHullTexture(kind, number);
    const deckTex = makeEscortDeckTexture(kind);
    const sideMat = new THREE.MeshStandardMaterial({ map: hullTex, color: 0x3f4a4f, roughness: 0.8, metalness: 0.2, envMapIntensity: 0.5 });
    const topMat = new THREE.MeshStandardMaterial({ map: deckTex, color: 0x3a454a, roughness: 0.95, metalness: 0.05, envMapIntensity: 0.16 });
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x5a2b24, roughness: 0.92 });
    const supMat = new THREE.MeshStandardMaterial({ color: 0x465257, roughness: 0.72, metalness: 0.28, envMapIntensity: 0.55 });
    const bowMat = new THREE.MeshStandardMaterial({ color: 0x3f4a4f, roughness: 0.78, metalness: 0.22, envMapIntensity: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2f3a3f, roughness: 0.6, metalness: 0.45, envMapIntensity: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x101a20, roughness: 0.16, metalness: 0.7, emissive: 0x1a2a33, emissiveIntensity: 0.35 });
    const warm = new THREE.MeshBasicMaterial({ color: 0xffc37e, toneMapped: false });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9da8ac, roughness: 0.55, metalness: 0.42 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, len), [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
    hull.position.y = -0.2; hull.castShadow = true; hull.receiveShadow = true; g.add(hull);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 4), bowMat);
    bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4;
    bow.position.set(0, 0.34, len / 2 + 1.4); bow.castShadow = true; g.add(bow);

    // stern transom / deck edge
    const stern = new THREE.Mesh(new THREE.BoxGeometry(3.22, 0.16, 0.4), dark);
    stern.position.set(0, 0.42, -len / 2); g.add(stern);

    // superstructure
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.35, isSupply ? 3.2 : 3.8), supMat);
    bridge.position.set(0, 1.1, isSupply ? -5.2 : -1.2); bridge.castShadow = true; g.add(bridge);
    const bridge2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 2.6), supMat);
    bridge2.position.set(0, 2.15, isSupply ? -5.2 : -1.2); bridge2.castShadow = true; g.add(bridge2);
    const bridgeTop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 2.8), dark);
    bridgeTop.position.set(0, 2.66, isSupply ? -5.2 : -1.2); g.add(bridgeTop);

    // bridge windows
    const winMat = new THREE.MeshStandardMaterial({ color: 0x0d181e, roughness: 0.18, metalness: 0.65, emissive: 0x2a1b0e, emissiveIntensity: 0.45 });
    const winF = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.32), winMat);
    winF.position.set(0, 2.2, (isSupply ? -5.2 : -1.2) + (isSupply ? 1.61 : 1.91)); g.add(winF);
    [-1, 1].forEach((s) => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.3), winMat);
      w.rotation.y = s * Math.PI / 2;
      w.position.set(s * 1.11, 2.2, isSupply ? -5.2 : -1.2); g.add(w);
    });
    // side window bands / bridge texture
    [-1, 1].forEach((sd) => {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(isSupply ? 2.4 : 3.0, 0.26), winMat);
      band.rotation.y = sd * Math.PI / 2;
      band.position.set(sd * 1.113, 1.72, isSupply ? -5.2 : -1.2); g.add(band);
    });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.55), new THREE.MeshStandardMaterial({ color: 0x39464b, roughness: 0.6, metalness: 0.35 }));
    door.position.set(0.65, 0.85, (isSupply ? -5.2 : -1.2) + (isSupply ? 1.61 : 1.91)); g.add(door);

    // warm cabin strip
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.08), warm);
    strip.position.set(0, 1.55, (isSupply ? -5.2 : -1.2) + (isSupply ? 1.62 : 1.92)); g.add(strip);

    // mast / radar
    const mastZ = isSupply ? -5.8 : -1.9;
    [-0.34, 0.34].forEach((dx) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3.6, 5), railMat);
      p.position.set(dx, 4.4, mastZ); g.add(p);
    });
    for (let i = 0; i < 5; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.035, 0.035), railMat);
      bar.position.set(0, 2.9 + i * 0.7, mastZ); g.add(bar);
    }
    const radar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.3), dark);
    radar.position.set(0, 5.9, mastZ); g.add(radar);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), supMat);
    dome.position.set(0, 5.5, mastZ - 0.5); g.add(dome);

    // AESA panels on bridge sides
    [-1, 1].forEach((s) => {
      const a = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.48), new THREE.MeshStandardMaterial({ color: 0x173346, roughness: 0.38, metalness: 0.55, emissive: 0x06131d, emissiveIntensity: 0.5 }));
      a.rotation.y = s * Math.PI / 2;
      a.position.set(s * 1.112, 1.55, isSupply ? -5.2 : -1.2); g.add(a);
    });

    if (!isSupply) {
      // VLS block
      const vls = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.26, 2.1), dark);
      vls.position.set(0, 0.55, 2.1); g.add(vls);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cell = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshStandardMaterial({ color: 0x151d21, roughness: 0.7 }));
        cell.rotation.x = -Math.PI / 2; cell.position.set(-0.6 + i * 0.4, 0.69, 1.5 + j * 0.4); g.add(cell);
      }
      // main gun
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0x7a8589, roughness: 0.68, metalness: 0.35 }));
      turret.position.set(0, 0.72, 4.6); g.add(turret);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8), dark);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.9, 5.8); g.add(barrel);
      // CIWS
      const ciws = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 10), supMat);
      ciws.position.set(0, 1.0, -4.5); g.add(ciws);
      const ciwsDome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dark);
      ciwsDome.position.set(0, 1.15, -4.5); g.add(ciwsDome);
      // funnel
      const funnel = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.85, 1.3), dark);
      funnel.position.set(0, 1.55, -3.4); g.add(funnel);
      const fcap = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.1, 1.24), new THREE.MeshBasicMaterial({ color: 0x11181b }));
      fcap.position.set(0, 1.99, -3.4); g.add(fcap);
      // helo pad
      const pad = new THREE.Mesh(new THREE.CircleGeometry(1.25, 28), new THREE.MeshStandardMaterial({ color: 0x454f53, roughness: 0.92 }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.43, -6.1); g.add(pad);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.2, 28), new THREE.MeshBasicMaterial({ color: 0xe6e7dc, transparent: true, opacity: 0.65 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.445, -6.1); g.add(ring);
      const hMat = new THREE.MeshBasicMaterial({ color: 0xe6e7dc, transparent: true, opacity: 0.7 });
      const h1 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.8), hMat); h1.rotation.x = -Math.PI / 2; h1.position.set(-0.22, 0.45, -6.1); g.add(h1);
      const h2 = h1.clone(); h2.position.x = 0.22; g.add(h2);
      const h3 = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.1), hMat); h3.rotation.x = -Math.PI / 2; h3.position.set(0, 0.45, -6.1); g.add(h3);
      // hangar
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.72, 2.2), supMat);
      hangar.position.set(0, 0.88, -5.4); g.add(hangar);
    } else {
      // cargo containers
      const colors = [0x7a4a32, 0x345a6e, 0x4e6a4a, 0x8a6a3a, 0x5c4c6a];
      for (let i = 0; i < 6; i++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.72, 2.1), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.78, metalness: 0.22 }));
        box.position.set(-0.6 + (i % 2) * 1.2, 0.75, -1.6 + Math.floor(i / 2) * 2.2);
        box.castShadow = true; g.add(box);
      }
      // cranes
      [2.8, -3.4].forEach((z) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.4, 6), new THREE.MeshStandardMaterial({ color: 0xb38a3e, roughness: 0.65, metalness: 0.3 }));
        post.position.set(1.35, 1.8, z); g.add(post);
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0xb38a3e, roughness: 0.65, metalness: 0.3 }));
        boom.rotation.z = Math.PI / 2.7; boom.position.set(2.1, 3.1, z); g.add(boom);
      });
    }

    // deck railings
    const railPts = [
      -1.58, 0.5, -len / 2, 1.58, 0.5, -len / 2, 1.58, 0.5, len / 2 - 3,
    ];
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      -1.58, 0.5, -len / 2, -1.58, 0.5, len / 2 - 3,
      1.58, 0.5, -len / 2, 1.58, 0.5, len / 2 - 3,
    ], 3));
    const rail = new THREE.LineSegments(railGeo, new THREE.LineBasicMaterial({ color: 0xc8d2d4, transparent: true, opacity: 0.45 }));
    g.add(rail);
    for (let i = 0; i < 9; i++) {
      const z = -len / 2 + 1 + i * (len - 4) / 8;
      [-1.57, 1.57].forEach((x) => {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 4), railMat);
        p.position.set(x, 0.25, z); g.add(p);
      });
    }

    // nav lights
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff5a4e, toneMapped: false }));
    navR.position.set(-1.5, 0.65, len / 2 - 1); g.add(navR);
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0x74e29a, toneMapped: false }));
    navG.position.set(1.5, 0.65, len / 2 - 1); g.add(navG);
    const mastLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), warm); mastLight.position.set(0, 6.05, mastZ); g.add(mastLight);

    // waterline foam strip
    const wlMat = new THREE.MeshBasicMaterial({ color: 0xdfeef4, transparent: true, opacity: 0.28, depthWrite: false });
    [-1.61, 1.61].forEach((x) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len - 1), wlMat);
      w.position.set(x, -0.325, 0); g.add(w);
    });

    // escort wakes/foam planes are intentionally not added: at this camera
    // angle they read as large grey rectangles over the water.

    return g;
  }

  const escorts = [
    { m: makeEscort("destroyer"), x: -52, z: 22, ry: -0.4 },
    { m: makeEscort("supply"), x: -40, z: 52, ry: -0.4 },
  ];
  escorts.forEach((e) => { e.m.position.set(e.x, -4.0, e.z); e.m.rotation.y = e.ry; scene.add(e.m); });

  /* ── 真实角色 → 甲板机位 ───────────────────────────────── */
  const TONE_HEX: Record<OfficeTone, number> = {
    run: 0x5fc89a, wait: 0xd9b878, review: 0x9c8ae0, fail: 0xd97a78, lead: 0x6fd6f5, neutral: 0x8f9aa3,
  };
  const EXHAUST_TEX = glowTexture("rgba(255,214,150,1)");
  const STEAM_TEX = glowTexture("rgba(235,248,255,1)");
  interface Slot { x: number; z: number; rot: number; dx?: number; dz?: number }
  const CAT: Slot[] = [
    { x: -4.2, z: 25, rot: 0, dx: 0, dz: 1 },
    { x: 2.2, z: 24, rot: 0, dx: 0, dz: 1 },
    { x: -11.4, z: -10, rot: -0.32, dx: 0.52, dz: 0.85 },
  ];
  const HOLD: Slot[] = [
    { x: 6.4, z: -20, rot: -0.1 },
    { x: 9.0, z: 7, rot: 0 },
  ];
  const ELEV: Slot[] = [
    { x: 12.6, z: 14, rot: 0 },
    { x: 12.6, z: -18, rot: 0 },
  ];
  const PARK: Slot[] = [
    { x: 5.2, z: -38, rot: 0 },
    { x: -2.2, z: -38, rot: 0 },
    { x: 0.5, z: 8, rot: 0 },
  ];
  const LAND: Slot = { x: -9.4, z: -32, rot: -0.24 };
  const WAVE: Slot = { x: -14.5, z: -16, rot: -0.5 };
  const CENTER: Slot = { x: 0, z: -4, rot: 0 };
  const LEAD: Slot = { x: -0.6, z: 9, rot: 0 };

  interface Entry {
    plane?: THREE.Group;
    crew?: THREE.Group;
    ring: THREE.Mesh;
    label: HTMLButtonElement;
    line: SVGLineElement;
    dot: SVGCircleElement;
    exhaust?: THREE.Sprite;
    steam?: THREE.Sprite;
    anchorX: number;
    anchorY: number;
    target: Slot;
    cur: { x: number; y: number; z: number; rot: number };
    tone: OfficeTone;
    prevTone: OfficeTone;
    prevCat: number;
    flight: { start: number; cat: number; mode: "auto" | "demo" } | null;
    airborne: boolean;
  }
  const entries = new Map<string, Entry>();

  function makeCrew(accent: number, white = false) {
    const g = new THREE.Group();
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 8), new THREE.MeshStandardMaterial({ color: white ? 0xd8dde0 : accent, roughness: 0.7 }));
    vest.position.y = 0.4;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9c0a4, roughness: 0.8 }));
    head.position.y = 0.78;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 6), new THREE.MeshStandardMaterial({ color: white ? 0xe9edf0 : accent, roughness: 0.6 }));
    helmet.position.y = 0.84;
    helmet.scale.y = 0.6;
    g.add(vest, head, helmet);
    g.scale.setScalar(2.3);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    return g;
  }

  function ringFor(tone: OfficeTone, radius: number) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + 0.32, 40),
      new THREE.MeshBasicMaterial({ color: TONE_HEX[tone], transparent: true, opacity: 0.82, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.11;
    ring.renderOrder = 3;
    ship.add(ring);
    return ring;
  }

  function makeLabel() {
    const label = doc.createElement("button");
    label.type = "button";
    label.className = "carrier3d-label";
    labelLayer.appendChild(label);
    return label;
  }

  function makeLeader() {
    const line = doc.createElementNS(SVGNS, "line") as SVGLineElement;
    const dot = doc.createElementNS(SVGNS, "circle") as SVGCircleElement;
    dot.setAttribute("r", "2.4");
    leaderSvg.appendChild(line);
    leaderSvg.appendChild(dot);
    return { line, dot };
  }

  function targetFor(actor: OfficeActor, counters: Record<string, number>): Slot {
    if (actor.zone === "lead") return LEAD;
    let list: Slot[] = PARK;
    let key = "park";
    if (actor.zone === "desk") {
      if (actor.tone === "run") { list = CAT; key = "cat"; }
      else if (actor.tone === "wait") { list = HOLD; key = "hold"; }
      else if (actor.tone === "review") { list = [LAND]; key = "land"; }
      else if (actor.tone === "fail") { list = [WAVE]; key = "wave"; }
      else if (actor.tone === "neutral") { list = ELEV; key = "elev"; }
    } else if (actor.zone === "approval") { list = HOLD; key = "hold"; }
    else if (actor.zone === "review") { list = [LAND]; key = "land"; }
    else if (actor.zone === "meeting") { list = [CENTER]; key = "center"; }
    else if (actor.zone === "tea" || actor.zone === "standby") { list = ELEV; key = "elev"; }
    const n = counters[key] ?? 0;
    counters[key] = n + 1;
    return list[n % list.length];
  }

  function planeKind(actor: OfficeActor, index: number) {
    if (actor.role === "reviewer") return "j35";
    return index % 2 === 0 ? "j35" : "j15";
  }

  function createEntry(actor: OfficeActor, index: number): Entry {
    const tone = actor.tone;
    const label = makeLabel();
    const { line, dot } = makeLeader();
    if (actor.zone === "lead") {
      const crew = makeCrew(TONE_HEX.lead);
      crew.position.set(LEAD.x, 0, LEAD.z);
      ship.add(crew);
      label.addEventListener("click", () => onSelect(actor.agent.id));
      return { crew, ring: ringFor(tone, 1.2), label, line, dot, anchorX: 0, anchorY: 0, target: LEAD, cur: { x: LEAD.x, y: 0, z: LEAD.z, rot: 0 }, tone, prevTone: tone, prevCat: -1, flight: null, airborne: false };
    }
    const kind = planeKind(actor, index);
    const mesh = makeJet(kind, false);
    mesh.position.set(0, 0.74, 0);
    mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    const left = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), navRed);
    left.position.set(-3.0, 0.1, -0.2);
    mesh.add(left);
    const right = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), navGreen);
    right.position.set(3.0, 0.1, -0.2);
    mesh.add(right);
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), planeAO);
    ao.rotation.x = -Math.PI / 2;
    ao.position.y = -0.675;
    mesh.add(ao);
    ship.add(mesh);
    const exhaust = new THREE.Sprite(new THREE.SpriteMaterial({
      map: EXHAUST_TEX, color: 0xffb45e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    exhaust.scale.set(2.2, 2.2, 1);
    exhaust.position.set(0, 0, -3.6);
    mesh.add(exhaust);
    label.addEventListener("click", () => onSelect(actor.agent.id));
    return { plane: mesh, ring: ringFor(tone, 2.2), label, line, dot, exhaust, anchorX: 0, anchorY: 0, target: CAT[0], cur: { x: CAT[0].x, y: 0.74, z: CAT[0].z, rot: CAT[0].rot }, tone, prevTone: tone, prevCat: -1, flight: null, airborne: false };
  }

  let firstSync = true;
  function startFlight(entry: Entry, catIdx: number, mode: "auto" | "demo") {
    if (!entry.plane || !entry.exhaust) return;
    if (motion.tier === "off" || motion.reduced) return;
    const base = CAT[catIdx] || CAT[0];
    entry.flight = { start: tFlight, cat: Math.max(0, catIdx), mode };
    entry.airborne = false;
    entry.cur.x = base.x;
    entry.cur.z = base.z;
    entry.cur.y = 0.74;
    entry.cur.rot = base.rot;
    entry.plane.position.set(base.x, 0.74, base.z);
    entry.plane.rotation.set(0, Math.PI + base.rot, 0);
    entry.ring.position.set(base.x, 0.11, base.z);
    entry.ring.visible = false;
    if (entry.steam) { entry.steam.removeFromParent(); entry.steam = undefined; }
    const steam = new THREE.Sprite(new THREE.SpriteMaterial({
      map: STEAM_TEX, color: 0xeaf6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    steam.position.set(base.x, 0.5, base.z);
    steam.scale.set(2.4, 2.4, 1);
    ship.add(steam);
    entry.steam = steam;
  }

  function launchDemo() {
    const list = [...entries.values()].filter((e) => e.plane && !e.flight);
    if (!list.length) return;
    const running = list.find((e) => e.tone === "run" && CAT.includes(e.target));
    const target = running ?? list[0];
    const idx = Math.max(0, CAT.indexOf(target.target));
    startFlight(target, idx, "demo");
  }

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  }

  function syncActors() {
    const model = getModel();
    const counters: Record<string, number> = {};
    const seen = new Set<string>();
    model.actors.forEach((actor, index) => {
      seen.add(actor.agent.id);
      let entry = entries.get(actor.agent.id);
      if (!entry) {
        entry = createEntry(actor, index);
        entries.set(actor.agent.id, entry);
      }
      const target = targetFor(actor, counters);
      entry.target = target;
      entry.tone = actor.tone;
      entry.label.dataset.tone = actor.tone;
      entry.label.innerHTML = `<i></i><b>${escapeHtml(actor.displayName)}</b><em>${escapeHtml(actor.statusLabel)}</em>`;
      entry.label.title = `${actor.displayName} · ${ZONE_LABEL[actor.zone]} · ${actor.statusLabel}`;
      entry.label.classList.toggle("sel", getSelected() === actor.agent.id);
      (entry.ring.material as THREE.MeshBasicMaterial).color.setHex(TONE_HEX[actor.tone] ?? 0x8f9aa3);
      const catIdx = CAT.indexOf(target);
      if (entry.plane) {
        if (entry.flight && catIdx < 0) entry.flight = null;
        if (entry.airborne && (actor.tone !== "run" || catIdx < 0)) {
          entry.airborne = false;
        }
        const becameRun = actor.tone === "run" && entry.prevTone !== "run";
        const enteredCat = actor.tone === "run" && catIdx >= 0 && entry.prevCat !== catIdx;
        if (!firstSync && !entry.flight && !entry.airborne && (becameRun || enteredCat)) {
          startFlight(entry, Math.max(0, catIdx), "auto");
        }
      }
      entry.prevTone = actor.tone;
      entry.prevCat = catIdx;
    });
    firstSync = false;
    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      entry.label.remove();
      entry.line.remove();
      entry.dot.remove();
      entry.ring.remove();
      entry.plane?.removeFromParent();
      entry.crew?.removeFromParent();
      entries.delete(id);
    }
  }

  /* 甲板上固定的安全官 / LSO，只做空间参照，不参与状态 */
  [[5.4, 12, 0xcf5f5d, false], [-15.4, -40, 0x7d67d1, true]].forEach(([x, z, accent, white]) => {
    const g = makeCrew(accent as number, white as boolean);
    g.position.set(x as number, 0, z as number);
    ship.add(g);
  });

  function projectLabels() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const v = new THREE.Vector3();
    const items: { entry: Entry; ax: number; ay: number; lw: number; lh: number }[] = [];
    for (const entry of entries.values()) {
      if (entry.plane) {
        v.set(0, 2.9, 0);
        entry.plane.localToWorld(v);
      } else {
        v.set(LEAD.x, 2.5, LEAD.z);
        ship.localToWorld(v);
      }
      v.project(camera);
      const ax = (v.x * 0.5 + 0.5) * w;
      const ay = (-v.y * 0.5 + 0.5) * h;
      const visible = v.z < 1 && ax > -140 && ax < w + 140 && ay > -90 && ay < h + 90;
      entry.anchorX = ax;
      entry.anchorY = ay;
      if (!visible) {
        entry.label.style.opacity = "0";
        entry.label.style.pointerEvents = "none";
        entry.line.style.display = "none";
        entry.dot.style.display = "none";
        continue;
      }
      entry.line.style.display = "";
      entry.dot.style.display = "";
      items.push({ entry, ax, ay, lw: entry.label.offsetWidth || 92, lh: entry.label.offsetHeight || 22 });
    }
    items.sort((a, b) => a.ay - b.ay);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const candidates = [
      [-40, -34], [40, -34], [0, -48], [-84, -12], [84, -12], [-84, 24], [84, 24],
      [0, 34], [-128, -24], [128, -24], [-128, 30], [128, 30], [0, -78], [0, 70],
    ];
    for (const it of items) {
      const { entry, ax, ay, lw, lh } = it;
      const preferLeft = entry.plane ? entry.plane.position.x < 0 : true;
      const ordered = preferLeft ? candidates : candidates.map(([dx, dy]) => [-dx, dy]);
      let chosen: { cx: number; cy: number } | null = null;
      for (const [dx, dy] of ordered) {
        const cx = Math.max(lw / 2 + 8, Math.min(w - lw / 2 - 8, ax + dx));
        const cy = Math.max(lh / 2 + 8, Math.min(h - lh / 2 - 8, ay + dy));
        const box = { l: cx - lw / 2 - 5, r: cx + lw / 2 + 5, t: cy - lh / 2 - 4, b: cy + lh / 2 + 4 };
        if (!placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) {
          placed.push(box);
          chosen = { cx, cy };
          break;
        }
      }
      if (!chosen) {
        const cx = Math.max(lw / 2 + 8, Math.min(w - lw / 2 - 8, ax + (preferLeft ? -40 : 40)));
        const cy = Math.max(lh / 2 + 8, Math.min(h - lh / 2 - 8, ay - 34));
        chosen = { cx, cy };
        placed.push({ l: cx - lw / 2, r: cx + lw / 2, t: cy - lh / 2, b: cy + lh / 2 });
      }
      entry.label.style.transform = `translate(${chosen.cx}px, ${chosen.cy}px) translate(-50%, -50%)`;
      entry.label.style.opacity = "1";
      entry.label.style.pointerEvents = "auto";
      entry.line.setAttribute("x1", String(ax));
      entry.line.setAttribute("y1", String(ay));
      entry.line.setAttribute("x2", String(chosen.cx));
      entry.line.setAttribute("y2", String(chosen.cy));
      entry.dot.setAttribute("cx", String(ax));
      entry.dot.setAttribute("cy", String(ay));
    }
  }

  /* ── 主题 / 尺寸 / 动效 ───────────────────────────────── */
  const THEME = {
    light: {
      skyTop: 0x081c31, horizon: 0xe08a52, sunColor: 0xff9e5e, cloud: 0x4a3a32, sunIntensity: 3.6,
      hemiSky: 0x9fb6c9, hemiGround: 0x0b1822, hemi: 0.2, fill: 0.8, island: [9, 5],
      deep: 0x031624, shallow: 0x0c3a52, seaSky: 0x4b738b, fog: 0xa98870,
      fogNear: 170, fogFar: 920, exposure: 0.8, sunScale: 130, sunOpacity: 0.48,
    },
    dark: {
      skyTop: 0x01050c, horizon: 0x0a1826, sunColor: 0xbfd8f0, cloud: 0x070e16, sunIntensity: 0.35,
      hemiSky: 0x1d3448, hemiGround: 0x03080d, hemi: 0.16, fill: 0.42, island: [26, 16],
      deep: 0x01070d, shallow: 0x041820, seaSky: 0x163244, fog: 0x081722,
      fogNear: 140, fogFar: 850, exposure: 0.92, sunScale: 92, sunOpacity: 0.28,
    },
  };
  function applyTheme(t: Theme) {
    theme = t;
    const c = THEME[t];
    skyUniforms.uTop.value.setHex(c.skyTop);
    skyUniforms.uHorizon.value.setHex(c.horizon);
    skyUniforms.uSunColor.value.setHex(c.sunColor);
    skyUniforms.uCloud.value.setHex(c.cloud);
    sun.color.setHex(c.sunColor);
    sun.intensity = c.sunIntensity;
    hemi.color.setHex(c.hemiSky);
    hemi.groundColor.setHex(c.hemiGround);
    hemi.intensity = c.hemi;
    fill.intensity = c.fill;
    islandLight.intensity = c.island[0];
    islandLight2.intensity = c.island[1];
    seaUniforms.uDeep.value.setHex(c.deep);
    seaUniforms.uShallow.value.setHex(c.shallow);
    seaUniforms.uSky.value.setHex(c.seaSky);
    seaUniforms.uFog.value.setHex(c.fog);
    seaUniforms.uHorizon.value.setHex(c.horizon);
    seaUniforms.uFogNear.value = c.fogNear;
    seaUniforms.uFogFar.value = c.fogFar;
    scene.fog.color.setHex(c.fog);
    scene.fog.near = c.fogNear;
    scene.fog.far = c.fogFar;
    renderer.toneMappingExposure = c.exposure;
    scene.environment = t === "dark" ? envDark : envLight;
    sunSprite.material.color.setHex(c.sunColor);
    sunSprite.material.opacity = c.sunOpacity;
    sunSprite.scale.set(c.sunScale, c.sunScale, 1);
  }
  applyTheme(theme);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointerMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
  };
  const onDoubleClick = () => { pointer.tx = 0; pointer.ty = 0; };
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("dblclick", onDoubleClick);

  function resize() {
    const w = Math.max(2, host.clientWidth);
    const h = Math.max(2, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new THREE.Clock();
  let tAnim = 0;
  let tFlight = 0;
  let rafId = 0;
  let disposed = false;
  function animate() {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const anim = motion.tier !== "off" && !motion.reduced;
    if (anim) {
      tAnim += dt;
      /* 弹射用独立时钟：卡帧时放慢而不是直接跳到结尾，60fps 下就是真实时间 */
      tFlight += Math.min(rawDt, 0.2);
    }
    seaUniforms.uTime.value = tAnim;
    skyUniforms.uTime.value = tAnim;
    const amp = anim ? 1.1 : 0;
    if (anim) {
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
    } else {
      pointer.x = 0;
      pointer.y = 0;
    }
    camera.position.x = 52 + Math.sin(tAnim * 0.11) * amp + pointer.x * 1.4;
    camera.position.y = 20 + Math.sin(tAnim * 0.08 + 1.4) * amp * 0.35 - pointer.y * 0.8;
    camera.lookAt(1, 9, -5);
    const mv = anim ? 1 : 0;
    ship.rotation.y = SHIP_YAW + Math.sin(tAnim * 0.05) * 0.006 * mv;
    ship.position.y = Math.sin(tAnim * 0.42) * 0.085 * mv;
    ship.rotation.z = Math.sin(tAnim * 0.3) * 0.0032 * mv;
    escorts.forEach((e, i) => {
      e.m.position.y = -4.0 + Math.sin(tAnim * 0.52 + i * 1.7) * 0.06 * mv;
      e.m.rotation.z = Math.sin(tAnim * 0.41 + i) * 0.006 * mv;
    });
    const speed = anim ? Math.min(1, dt * (1000 / Math.max(300, motion.walk)) * 1.8) : 1;
    const launchingCats = new Set<number>();
    let shake = 0;
    for (const entry of entries.values()) {
      if (!entry.plane) continue;
      const t = entry.target;
      if (entry.flight) {
        const flight = entry.flight;
        const base = CAT[flight.cat] || CAT[0];
        const dx = base.dx ?? 0;
        const dz = base.dz ?? 1;
        const el = tFlight - flight.start;
        let y = 0.74;
        let dist = 0;
        let pitch = 0;
        if (el < 0.8) {
          launchingCats.add(flight.cat);
          if (entry.exhaust) entry.exhaust.material.opacity = (el / 0.8) * 0.55;
        } else if (el < 2.2) {
          launchingCats.add(flight.cat);
          const p = (el - 0.8) / 1.4;
          const e = p * p;
          dist = e * 20;
          y = 0.74 + e * 0.22;
          pitch = -0.04 * e;
          shake = Math.max(shake, (1 - p) * 0.9);
          if (entry.exhaust) {
            entry.exhaust.material.opacity = 0.9;
            entry.exhaust.scale.setScalar(2.4 + e * 0.9);
          }
        } else if (el < 3.4) {
          const p = (el - 2.2) / 1.2;
          const e = 1 - Math.pow(1 - p, 3);
          dist = 20 + e * 5;
          y = 0.74 + e * 2.6;
          pitch = -0.04 - e * 0.22;
          if (entry.exhaust) {
            entry.exhaust.material.opacity = 0.9 * (1 - p) + 0.25;
            entry.exhaust.scale.setScalar(3.3 - e * 0.6);
          }
        } else {
          if (flight.mode === "auto") {
            entry.airborne = true;
            entry.ring.visible = false;
            dist = 25;
            y = 3.34;
            pitch = -0.26;
          } else {
            entry.flight = null;
            entry.airborne = false;
          }
          if (entry.exhaust) entry.exhaust.material.opacity = flight.mode === "auto" ? 0.28 : 0;
        }
        entry.cur.x = base.x + dx * dist;
        entry.cur.z = base.z + dz * dist;
        entry.cur.y = y;
        entry.cur.rot = base.rot;
        entry.plane.position.set(entry.cur.x, y, entry.cur.z);
        entry.plane.rotation.y = Math.PI + base.rot;
        entry.plane.rotation.x = pitch;
        entry.ring.position.set(base.x, 0.11, base.z);
        if (entry.steam) {
          const sp = Math.min(1, el / 2.4);
          entry.steam.material.opacity = Math.max(0, 0.45 * (1 - sp));
          entry.steam.scale.setScalar(2.4 + sp * 5.5);
          if (el > 2.6) { entry.steam.removeFromParent(); entry.steam = undefined; }
        }
      } else if (entry.airborne) {
        entry.cur.y = 3.34 + Math.sin(tAnim * 1.6 + entry.cur.x) * 0.08;
        entry.plane.position.set(entry.cur.x, entry.cur.y, entry.cur.z);
        entry.plane.rotation.x = -0.26;
        entry.ring.visible = false;
        if (entry.exhaust) entry.exhaust.material.opacity = 0.16;
      } else {
        entry.cur.x += (t.x - entry.cur.x) * speed;
        entry.cur.z += (t.z - entry.cur.z) * speed;
        entry.cur.y += (0.74 - entry.cur.y) * speed;
        entry.cur.rot += (t.rot - entry.cur.rot) * speed;
        entry.plane.position.set(entry.cur.x, entry.cur.y, entry.cur.z);
        entry.plane.rotation.y = Math.PI + entry.cur.rot;
        entry.plane.rotation.x += (0 - entry.plane.rotation.x) * speed;
        entry.ring.visible = entry.cur.y < 1.4;
        if (entry.exhaust) entry.exhaust.material.opacity = 0;
      }
      entry.ring.position.x = entry.cur.x;
      entry.ring.position.z = entry.cur.z;
    }
    jbds.forEach((j, i) => {
      const up = launchingCats.has(i) ? -1.18 : -0.34;
      j.rotation.x += (up - j.rotation.x) * Math.min(1, dt * 7);
    });
    if (shake > 0) {
      camera.position.x += Math.sin(tAnim * 96) * 0.18 * shake;
      camera.position.y += Math.cos(tAnim * 83) * 0.12 * shake;
    }
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    projectLabels();
  }

  syncActors();
  animate();

  return {
    launch() {
      if (disposed) return;
      launchDemo();
    },
    update() {
      if (disposed) return;
      syncActors();
    },
    setSelected() {
      const model = getModel();
      for (const actor of model.actors) {
        entries.get(actor.agent.id)?.label.classList.toggle("sel", getSelected() === actor.agent.id);
      }
    },
    setTheme(next) {
      if (next !== theme) applyTheme(next);
    },
    setMotion(tier, reduced, walk) {
      motion = { tier, reduced, walk };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("dblclick", onDoubleClick);
      for (const entry of entries.values()) entry.label.remove();
      entries.clear();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      pmrem.dispose();
      envLight.dispose();
      envDark.dispose();
      host.innerHTML = "";
    },
  };
}
