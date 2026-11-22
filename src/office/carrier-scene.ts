// @ts-nocheck
// 场景主体移植自 docs/prototype/carrier-3d.js（three.js r149，MIT）；运行时数据由 React 外壳注入。
import * as THREE from "three";
import type { OfficeActor, OfficeModel, OfficeTone, OfficeZone } from "./model";
import type { CoordinationStageView } from "../types";
import { ZONE_LABEL } from "./motion";

type MotionTier = "calm" | "full" | "off";
type Theme = "light" | "dark";

/** 舞台机位预设：总览 / 舰首 / 舰岛 / 着舰道 / 俯视（存进场景 prefs 的 view） */
export type CarrierView = CoordinationStageView;

interface MountOptions {
  host: HTMLElement;
  getModel: () => OfficeModel;
  getSelected: () => string | null;
  getNow: () => number;
  getMotion: () => { tier: MotionTier; reduced: boolean; walk: number };
  getTheme: () => Theme;
  onSelect: (id: string) => void;
  /** 双击复位时把机位同步回 React（下拉框要跟着变） */
  onViewChange?: (view: CarrierView) => void;
}

export interface Carrier3DApi {
  launch: () => void;
  land: () => void;
  setView: (view: CarrierView) => void;
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
  const { host, getModel, getSelected, getMotion, getTheme, onSelect, onViewChange } = options;
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
    // landing gear（单独成组：离舰后整组收进机腹）
    const gear = new THREE.Group();
    g.add(gear);
    g.userData.gear = gear;
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x11171a, roughness: 0.7, metalness: 0.2 });
    const strutMat = metalMat;
    const noseGear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48), strutMat);
    noseGear.position.set(0, -0.4, 1.25); gear.add(noseGear);
    const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10), wheelMat);
    noseWheel.rotation.z = Math.PI / 2; noseWheel.position.set(0, -0.64, 1.25); gear.add(noseWheel);
    [-1, 1].forEach((s) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5), strutMat);
      strut.position.set(s * 0.62, -0.4, -0.7); gear.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 10), wheelMat);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 0.62, -0.66, -0.7); gear.add(wheel);
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

    // hull number（抬高到水线以上，别被浪挡掉）
    x.save();
    x.fillStyle = "rgba(236,238,233,.92)";
    x.font = "700 74px 'Helvetica Neue', Arial, sans-serif";
    x.textAlign = "center";
    x.fillText(String(number), 512, 116);
    x.restore();

    // draft marks near bow
    x.fillStyle = "rgba(232,236,232,.62)";
    x.font = "600 15px monospace";
    for (let i = 0; i < 5; i++) {
      x.fillRect(760, 46 + i * 26, 26, 2);
      x.fillText(String(i + 2), 790, 52 + i * 26);
    }
    // anchor recess
    x.fillStyle = "rgba(16,23,26,.7)";
    x.beginPath(); x.ellipse(180, 84, 34, 20, -0.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = "rgba(32,41,45,.9)";
    x.beginPath(); x.ellipse(180, 84, 25, 13, -0.2, 0, Math.PI * 2); x.fill();

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
    /* 一条统一的尺度线：龙骨 / 甲板 / 舰首楔形都从这里推，任何部件都不会互相插进去 */
    const LEN = isSupply ? 19.5 : 15.5;
    const BEAM = 3.3;
    const HB = BEAM / 2;
    const KEEL_Y = -0.85;
    const DECK_Y = 0.55;
    const BOW_START = LEN / 2 - 2.9;
    const BOW_TIP = LEN / 2;
    const STERN_Z = -LEN / 2;
    const number = isSupply ? "886" : "101";

    const hullTex = makeEscortHullTexture(kind, number);
    const deckTex = makeEscortDeckTexture(kind);
    const sideMat = new THREE.MeshStandardMaterial({ map: hullTex, color: 0xa9b2b6, roughness: 0.82, metalness: 0.16, envMapIntensity: 0.45 });
    const topMat = new THREE.MeshStandardMaterial({ map: deckTex, color: 0x8c969a, roughness: 0.95, metalness: 0.05, envMapIntensity: 0.16 });
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x5a2b24, roughness: 0.92 });
    const supMat = new THREE.MeshStandardMaterial({ color: 0x808b90, roughness: 0.72, metalness: 0.2, envMapIntensity: 0.42 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3c474c, roughness: 0.6, metalness: 0.4, envMapIntensity: 0.8 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x0e1a20, roughness: 0.2, metalness: 0.66, emissive: 0x33210f, emissiveIntensity: 0.32 });
    const warm = new THREE.MeshBasicMaterial({ color: 0xffc37e, toneMapped: false });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9da8ac, roughness: 0.55, metalness: 0.42 });

    /* ── 舰体：直舷段（带涂装与舷号）+ 插入式舰首楔形 ── */
    const bodyLen = BOW_START - STERN_Z;
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(BEAM, DECK_Y - KEEL_Y, bodyLen),
      [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat],
    );
    hull.position.set(0, (DECK_Y + KEEL_Y) / 2, (BOW_START + STERN_Z) / 2);
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);

    (function bowSection() {
      /* 五面楔形：两舷 / 底面 / 甲板，截面与直舷段完全对齐，不再是一根戳在外面的圆锥。
         两舷沿用船体的涂装 UV，舰首和舯部是同一种钢板色。 */
      const A = [-HB, DECK_Y, BOW_START];
      const B = [HB, DECK_Y, BOW_START];
      const C = [-HB, KEEL_Y, BOW_START];
      const D = [HB, KEEL_Y, BOW_START];
      const T = [0, DECK_Y + 0.26, BOW_TIP];
      const U = [0, KEEL_Y + 0.28, BOW_TIP - 0.6];
      const hullCenter = [0, (DECK_Y + KEEL_Y) / 2, BOW_START - 1.5];
      const side: number[] = [];
      const uvOf = (p: number[]) => [(BOW_START - p[2]) / bodyLen, (p[1] - KEEL_Y) / (DECK_Y - KEEL_Y)];
      const pushFace = (pts: number[][], withUV: boolean) => {
        const [a, b, c] = pts;
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let cx = 0, cy = 0, cz = 0;
        for (const p of pts) { cx += p[0] / pts.length; cy += p[1] / pts.length; cz += p[2] / pts.length; }
        const out = n[0] * (cx - hullCenter[0]) + n[1] * (cy - hullCenter[1]) + n[2] * (cz - hullCenter[2]);
        const ordered = out >= 0 ? pts : [pts[0], ...pts.slice(1).reverse()];
        const tris = ordered.length === 3
          ? [ordered]
          : [[ordered[0], ordered[1], ordered[2]], [ordered[0], ordered[2], ordered[3]]];
        for (const tri of tris) {
          for (const p of tri) side.push(...p);
          if (withUV) for (const p of tri) sideUV.push(...uvOf(p));
        }
      };
      const sideUV: number[] = [];
      pushFace([A, C, U, T], true);    // 左舷
      pushFace([B, D, U, T], true);    // 右舷
      const sideGeo = new THREE.BufferGeometry();
      sideGeo.setAttribute("position", new THREE.Float32BufferAttribute(side, 3));
      sideGeo.setAttribute("uv", new THREE.Float32BufferAttribute(sideUV, 2));
      sideGeo.computeVertexNormals();
      const bow = new THREE.Mesh(sideGeo, sideMat);
      bow.castShadow = true;
      g.add(bow);
      /* 舰首底面 */
      const btm: number[] = [];
      const btmPush = (tri: number[][]) => { for (const p of tri) btm.push(...p); };
      btmPush([C, D, U]);
      const btmGeo = new THREE.BufferGeometry();
      btmGeo.setAttribute("position", new THREE.Float32BufferAttribute(btm, 3));
      btmGeo.computeVertexNormals();
      g.add(new THREE.Mesh(btmGeo, bottomMat));
      /* 舰首甲板：沿用主甲板的 UV 投影 */
      const deckGeo = new THREE.BufferGeometry();
      deckGeo.setAttribute("position", new THREE.Float32BufferAttribute([...A, ...T, ...B], 3));
      deckGeo.setAttribute("uv", new THREE.Float32BufferAttribute([
        0, 1,
        0.5, (BOW_TIP - STERN_Z) / bodyLen,
        1, 1,
      ], 2));
      deckGeo.computeVertexNormals();
      const bowDeck = new THREE.Mesh(deckGeo, topMat);
      bowDeck.receiveShadow = true;
      g.add(bowDeck);
      // 首柱
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.1, DECK_Y + 0.3 - (KEEL_Y + 0.28), 0.12), dark);
      stem.position.set(0, (DECK_Y + 0.3 + KEEL_Y + 0.28) / 2, BOW_TIP - 0.22);
      g.add(stem);
    })();

    // 舷墙 / 尾封板
    const transom = new THREE.Mesh(new THREE.BoxGeometry(BEAM + 0.04, 0.12, 0.12), dark);
    transom.position.set(0, DECK_Y + 0.04, STERN_Z + 0.06);
    g.add(transom);

    /* ── 上层建筑：尺寸先定，窗户再贴到真实面上 ── */
    const zSup = isSupply ? -4.6 : -1.2;
    const bridgeW = isSupply ? 2.24 : 2.3;
    const bridgeH = isSupply ? 1.65 : 1.45;
    const bridgeD = isSupply ? 3.0 : 3.6;
    const b2W = isSupply ? 1.7 : 1.76;
    const b2H = isSupply ? 0.9 : 0.95;
    const b2D = isSupply ? 2.1 : 2.3;
    const b1Y = DECK_Y + bridgeH / 2;
    const b2Y = DECK_Y + bridgeH + b2H / 2;
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(bridgeW, bridgeH, bridgeD), supMat);
    b1.position.set(0, b1Y, zSup);
    b1.castShadow = true;
    g.add(b1);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(b2W, b2H, b2D), supMat);
    b2.position.set(0, b2Y, zSup);
    b2.castShadow = true;
    g.add(b2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b2W + 0.22, 0.09, b2D + 0.28), dark);
    roof.position.set(0, b2Y + b2H / 2 + 0.045, zSup);
    g.add(roof);

    const addWindow = (w, h, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), winMat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      g.add(m);
    };
    // 舰桥正脸（b2 前壁）
    addWindow(b2W - 0.42, 0.3, 0, b2Y + 0.04, zSup + b2D / 2 + 0.014, 0);
    // b2 两舷 + 下层舰桥两舷（贴在各自真实外皮上，不再悬空）
    [-1, 1].forEach((s) => {
      addWindow(b2D - 0.5, 0.28, s * (b2W / 2 + 0.014), b2Y + 0.04, zSup, s * Math.PI / 2);
      addWindow(bridgeD - 1.2, 0.3, s * (bridgeW / 2 + 0.014), DECK_Y + bridgeH * 0.58, zSup, s * Math.PI / 2);
    });
    // 舰桥门 + 舱室暖光条
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x39464b, roughness: 0.6, metalness: 0.35 }));
    door.position.set(0.62, DECK_Y + 0.26, zSup + bridgeD / 2 + 0.012);
    g.add(door);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.07), warm);
    strip.position.set(-0.3, DECK_Y + bridgeH * 0.16, zSup + bridgeD / 2 + 0.014);
    g.add(strip);
    if (!isSupply) {
      // 相控阵面板
      [-1, 1].forEach((s) => {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(bridgeD - 1.7, 0.5), new THREE.MeshStandardMaterial({ color: 0x0f222d, roughness: 0.42, metalness: 0.55, emissive: 0x050f16, emissiveIntensity: 0.45 }));
        a.rotation.y = s * Math.PI / 2;
        a.position.set(s * (bridgeW / 2 + 0.014), DECK_Y + bridgeH * 0.3, zSup);
        g.add(a);
      });
    }

    /* ── 桅杆 / 雷达 ── */
    const mastZ = isSupply ? zSup - bridgeD / 2 - 0.8 : -3.3;
    const mastTop = DECK_Y + 3.3;
    [-0.3, 0.3].forEach((dx) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.05, mastTop - DECK_Y, 5), railMat);
      p.position.set(dx, (mastTop + DECK_Y) / 2, mastZ);
      g.add(p);
    });
    for (let i = 0; i < 5; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.03, 0.03), railMat);
      bar.position.set(0, DECK_Y + 0.62 + i * 0.6, mastZ);
      g.add(bar);
    }
    const radar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.26), dark);
    radar.position.set(0, mastTop + 0.04, mastZ);
    g.add(radar);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), supMat);
    dome.position.set(0, mastTop - 0.34, mastZ - 0.5);
    g.add(dome);

    if (!isSupply) {
      // 主炮（炮塔 + 指向舰首的炮管）
      const gunZ = BOW_START - 1.1;
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.56, 0.46, 12), new THREE.MeshStandardMaterial({ color: 0x6d787c, roughness: 0.7, metalness: 0.32 }));
      turret.position.set(0, DECK_Y + 0.23, gunZ);
      turret.castShadow = true;
      g.add(turret);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.1, 8), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, DECK_Y + 0.42, gunZ + 1.25);
      g.add(barrel);
      // 垂发
      const vlsZ = 1.7;
      const vls = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.26, 2.3), dark);
      vls.position.set(0, DECK_Y + 0.13, vlsZ);
      g.add(vls);
      const cellMat = new THREE.MeshStandardMaterial({ color: 0x161e22, roughness: 0.72 });
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cell = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), cellMat);
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(-0.63 + i * 0.42, DECK_Y + 0.265, vlsZ - 0.82 + j * 0.42);
        g.add(cell);
      }
      // 烟囱 + 后部平台（近防炮）
      const funnel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.9, 1.15), dark);
      funnel.position.set(0, DECK_Y + 0.45, -2.4);
      funnel.castShadow = true;
      g.add(funnel);
      const fcap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.1), new THREE.MeshBasicMaterial({ color: 0x11181b }));
      fcap.position.set(0, DECK_Y + 0.93, -2.4);
      g.add(fcap);
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.72, 1.0), supMat);
      hangar.position.set(0, DECK_Y + 0.36, -4.4);
      hangar.castShadow = true;
      g.add(hangar);
      const ciws = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.28, 10), supMat);
      ciws.position.set(0, DECK_Y + 1.0, -4.4);
      g.add(ciws);
      const ciwsDome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dark);
      ciwsDome.position.set(0, DECK_Y + 1.14, -4.4);
      g.add(ciwsDome);
      // 飞行甲板标线
      const padY = DECK_Y + 0.012;
      const padMat = new THREE.MeshStandardMaterial({ color: 0x4d575b, roughness: 0.94 });
      const pad = new THREE.Mesh(new THREE.CircleGeometry(1.18, 28), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, padY, -6.2);
      g.add(pad);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.14, 28), new THREE.MeshBasicMaterial({ color: 0xe6e7dc, transparent: true, opacity: 0.6 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, padY + 0.004, -6.2);
      g.add(ring);
      const hMat = new THREE.MeshBasicMaterial({ color: 0xe6e7dc, transparent: true, opacity: 0.66 });
      const h1 = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.72), hMat);
      h1.rotation.x = -Math.PI / 2; h1.position.set(-0.2, padY + 0.005, -6.2); g.add(h1);
      const h2 = h1.clone(); h2.position.x = 0.2; g.add(h2);
      const h3 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.09), hMat);
      h3.rotation.x = -Math.PI / 2; h3.position.set(0, padY + 0.005, -6.2); g.add(h3);
    } else {
      // 货柜（两列三排，留出舷边通道）
      const colors = [0x7a4a32, 0x345a6e, 0x4e6a4a, 0x8a6a3a, 0x5c4c6a, 0x6a5348];
      for (let i = 0; i < 6; i++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.82, 1.95), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.78, metalness: 0.2 }));
        box.position.set((i % 2 ? 0.7 : -0.7), DECK_Y + 0.41, 5.35 - Math.floor(i / 2) * 2.15);
        box.castShadow = true;
        g.add(box);
      }
      // 吊机：立柱在两舷、吊臂朝上朝前，不穿货柜也不穿舰桥
      [-1, 1].forEach((s) => {
        const postZ = -2.35;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.5, 7), new THREE.MeshStandardMaterial({ color: 0xb38a3e, roughness: 0.62, metalness: 0.3 }));
        post.position.set(s * 1.25, DECK_Y + 1.25, postZ);
        post.castShadow = true;
        g.add(post);
        const dirB = new THREE.Vector3(s * 0.34, 0.3, 0.88).normalize();
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 3.1, 6), new THREE.MeshStandardMaterial({ color: 0xb38a3e, roughness: 0.62, metalness: 0.3 }));
        boom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirB);
        boom.position.set(s * 1.25, DECK_Y + 2.5, postZ).addScaledVector(dirB, 1.5);
        boom.castShadow = true;
        g.add(boom);
      });
    }

    /* ── 舷侧栏杆 ── */
    const railY = DECK_Y + 0.32;
    const z0 = STERN_Z + 0.25;
    const z1 = BOW_START - 0.35;
    const railPts: number[] = [];
    [-1, 1].forEach((s) => {
      railPts.push(s * (HB - 0.04), railY, z0, s * (HB - 0.04), railY, z1);
      railPts.push(s * (HB - 0.04), railY - 0.3, z0, s * (HB - 0.04), railY - 0.3, z1);
      railPts.push(s * (HB - 0.04), railY - 0.3, z0, s * (HB - 0.04), railY, z0);
      railPts.push(s * (HB - 0.04), railY - 0.3, z1, s * (HB - 0.04), railY, z1);
    });
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute("position", new THREE.Float32BufferAttribute(railPts, 3));
    g.add(new THREE.LineSegments(railGeo, new THREE.LineBasicMaterial({ color: 0xc8d2d4, transparent: true, opacity: 0.42 })));
    for (let i = 0; i <= 8; i++) {
      const z = z0 + (z1 - z0) * (i / 8);
      [-1, 1].forEach((s) => {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 4), railMat);
        p.position.set(s * (HB - 0.04), DECK_Y + 0.16, z);
        g.add(p);
      });
    }

    /* ── 航行灯 / 桅灯 / 水线泡沫 ── */
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff5a4e, toneMapped: false }));
    navR.position.set(-(HB - 0.06), DECK_Y + bridgeH * 0.82, zSup + bridgeD / 2);
    g.add(navR);
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0x74e29a, toneMapped: false }));
    navG.position.set(HB - 0.06, DECK_Y + bridgeH * 0.82, zSup + bridgeD / 2);
    g.add(navG);
    const mastLight = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), warm);
    mastLight.position.set(0, mastTop + 0.16, mastZ);
    g.add(mastLight);

    const wlMat = new THREE.MeshBasicMaterial({ color: 0xdfeef4, transparent: true, opacity: 0.24, depthWrite: false });
    [-1, 1].forEach((s) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, bodyLen - 0.6), wlMat);
      w.position.set(s * (HB + 0.02), -0.34, (BOW_START + STERN_Z) / 2);
      g.add(w);
    });

    // escort wakes/foam planes are intentionally not added: at this camera
    // angle they read as large grey rectangles over the water.

    return g;
  }

  const escorts = [
    { m: makeEscort("destroyer"), x: -52, z: 22, ry: -0.4 },
    { m: makeEscort("supply"), x: -96, z: 6, ry: -0.44 },
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
    { x: -11.4, z: -10, rot: 0.55, dx: 0.52, dz: 0.85 },
  ];
  /* 弹射节奏：蓄力 → 行程（加速）→ 离舰（持续加速爬升、拐弯离场） */
  const T_TENSION = 0.8;
  const T_STROKE = 1.15;
  const V_LIFT = 24;
  const ACC_AIR = 9;
  const TURN_RATE = -0.135;
  const CLIMB = 26;
  const FLIGHT_END = 6.4;
  /* 着舰节奏：进场（下滑 + 拉平）→ 拦阻（滑跑减速）→ 滑回机位 */
  const T_APPROACH = 2.4;
  const T_ROLLOUT = 1.5;
  const APPROACH = 46;
  const APPROACH_ALT = 11;
  /** 沿甲板方向射线与甲板轮廓求交：每种弹射位的真实行程，飞机一定从甲板边缘离舰 */
  function deckRun(x: number, z: number, dx: number, dz: number) {
    let best = Infinity;
    for (let i = 0; i < DECK.length; i++) {
      const [ax, az] = DECK[i];
      const [bx, bz] = DECK[(i + 1) % DECK.length];
      const ex = bx - ax, ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-6) continue;
      const t = ((ax - x) * ez - (az - z) * ex) / den;
      const u = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 2 && u >= -0.02 && u <= 1.02) best = Math.min(best, t);
    }
    if (!Number.isFinite(best)) best = 20;
    return Math.max(8, Math.min(64, best - 1.2));
  }
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
    flight: { start: number; cat: number; mode: "auto" | "demo"; run: number } | null;
    landing: { start: number; mode: "auto" | "demo" } | null;
    airborne: boolean;
    dirX: number;
    dirZ: number;
    gearK: number;
  }
  const entries = new Map<string, Entry>();

  /* 甲板地勤：作训服 + 岗位色马甲 + 防护头盔，不是「一根柱子加一个球」 */
  function makeCrew(accent: number, white = false) {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2f3f4c, roughness: 0.9, metalness: 0.03 });
    const jer = new THREE.Color(white ? 0xe2e8ea : accent).multiplyScalar(0.86);
    const jersey = new THREE.MeshStandardMaterial({ color: jer, roughness: 0.68, metalness: 0.05 });
    const jerseyDark = new THREE.MeshStandardMaterial({ color: jer.clone().multiplyScalar(0.7), roughness: 0.7, metalness: 0.05 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a179, roughness: 0.92 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x141a1f, roughness: 0.66, metalness: 0.28 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.64, metalness: 0.24 });
    const lens = new THREE.MeshStandardMaterial({ color: 0x0b1216, roughness: 0.2, metalness: 0.7, envMapIntensity: 1.4 });
    const tape = new THREE.MeshStandardMaterial({ color: 0xdfe6e6, roughness: 0.36, metalness: 0.12 });

    /* 靴子 + 裤腿（两条腿微微分开站，不是一根柱子） */
    [-1, 1].forEach((s) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.05, 0.128), bootMat);
      b.position.set(s * 0.055, 0.025, 0.016);
      g.add(b);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.044, 0.3, 8), cloth);
      leg.position.set(s * 0.055, 0.2, 0);
      g.add(leg);
    });
    /* 腰胯 */
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.1, 10), cloth);
    hips.position.y = 0.355;
    g.add(hips);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.113, 0.117, 0.035, 10), strap);
    belt.position.y = 0.392;
    g.add(belt);
    /* 躯干（作训服） + 救生马甲 + 反光带 */
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.113, 0.107, 0.26, 10), cloth);
    torso.position.y = 0.5;
    g.add(torso);
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.124, 0.132, 0.2, 10), jersey);
    vest.position.y = 0.5;
    g.add(vest);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.122, 0.05, 10), jerseyDark);
    collar.position.y = 0.622;
    g.add(collar);
    const tapeBand = new THREE.Mesh(new THREE.CylinderGeometry(0.134, 0.136, 0.018, 10), tape);
    tapeBand.position.y = 0.552;
    g.add(tapeBand);
    /* 肩章 + 手臂 + 手 */
    [-1, 1].forEach((s) => {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.1), jerseyDark);
      pad.position.set(s * 0.104, 0.612, 0);
      g.add(pad);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.029, 0.25, 8), cloth);
      arm.position.set(s * 0.148, 0.487, 0.006);
      arm.rotation.z = s * 0.1;
      g.add(arm);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.029, 0.03, 8), jerseyDark);
      cuff.position.set(s * 0.16, 0.375, 0.008);
      g.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.031, 7, 5), skin);
      hand.position.set(s * 0.163, 0.348, 0.01);
      g.add(hand);
    });
    /* 脖子 / 头 / 防护头盔（壳 + 帽檐 + 耳罩 + 护目镜 + 下颌带） */
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.037, 0.045, 7), skin);
    neck.position.y = 0.652;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.078, 10, 8), skin);
    head.position.y = 0.714;
    head.scale.set(0.95, 1.06, 0.97);
    g.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.081, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), jersey);
    helmet.position.y = 0.736;
    g.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.0855, 0.02, 12, 1, true), jersey);
    brim.position.y = 0.716;
    g.add(brim);
    [-1, 1].forEach((s) => {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.02, 8), strap);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * 0.081, 0.712, 0.002);
      g.add(cup);
    });
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.03, 0.012), lens);
    goggles.position.set(0, 0.744, 0.086);
    goggles.rotation.x = -0.12;
    g.add(goggles);
    const chinStrap = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.058, 0.046), strap);
    chinStrap.position.set(0.046, 0.686, 0.075);
    chinStrap.rotation.z = 0.2;
    g.add(chinStrap);

    g.scale.setScalar(2.05);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
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
      label.addEventListener("click", () => onSelect(actor.id));
      return { crew, ring: ringFor(tone, 1.2), label, line, dot, anchorX: 0, anchorY: 0, target: LEAD, cur: { x: LEAD.x, y: 0, z: LEAD.z, rot: 0 }, tone, prevTone: tone, prevCat: -1, flight: null, landing: null, airborne: false, dirX: 0, dirZ: 1, gearK: 0 };
    }
    const kind = planeKind(actor, index);
    const mesh = makeJet(kind, false);
    mesh.position.set(0, 0.74, 0);
    /* YXZ：先偏航再俯仰，飞机拐弯爬升时姿态才不会歪 */
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = CAT[0].rot;
    mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    /* 左红右绿：机头朝 +z 时左翼在 +x */
    const left = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), navRed);
    left.position.set(3.0, 0.1, -0.2);
    mesh.add(left);
    const right = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), navGreen);
    right.position.set(-3.0, 0.1, -0.2);
    mesh.add(right);
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), planeAO);
    ao.rotation.x = -Math.PI / 2;
    ao.position.y = -0.675;
    mesh.add(ao);
    mesh.userData.ao = ao;
    ship.add(mesh);
    const exhaust = new THREE.Sprite(new THREE.SpriteMaterial({
      map: EXHAUST_TEX, color: 0xffb45e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    exhaust.scale.set(2.2, 2.2, 1);
    exhaust.position.set(0, 0, -3.6);
    mesh.add(exhaust);
    label.addEventListener("click", () => onSelect(actor.id));
    return { plane: mesh, ring: ringFor(tone, 2.2), label, line, dot, exhaust, anchorX: 0, anchorY: 0, target: CAT[0], cur: { x: CAT[0].x, y: 0.74, z: CAT[0].z, rot: CAT[0].rot }, tone, prevTone: tone, prevCat: -1, flight: null, landing: null, airborne: false, dirX: 0, dirZ: 1, gearK: 0 };
  }

  let firstSync = true;
  /** 落回甲板：飞行结束后瞬移回机位（那时飞机已飞出画面，不会看到瞬移） */
  function parkPlane(entry: Entry) {
    if (!entry.plane) return;
    const t = entry.target;
    entry.flight = null;
    entry.landing = null;
    entry.airborne = false;
    entry.gearK = 0;
    entry.cur.x = t.x;
    entry.cur.y = 0.74;
    entry.cur.z = t.z;
    entry.cur.rot = t.rot;
    entry.plane.position.set(t.x, 0.74, t.z);
    entry.plane.rotation.set(0, t.rot, 0);
    entry.ring.position.set(t.x, 0.11, t.z);
    entry.ring.visible = true;
    if (entry.exhaust) entry.exhaust.material.opacity = 0;
    const gear = entry.plane.userData.gear;
    if (gear) { gear.scale.y = 1; gear.visible = true; }
    const ao = entry.plane.userData.ao;
    if (ao) ao.visible = true;
    if (entry.steam) { entry.steam.removeFromParent(); entry.steam = undefined; }
  }

  function startFlight(entry: Entry, catIdx: number, mode: "auto" | "demo") {
    if (!entry.plane || !entry.exhaust) return;
    if (motion.tier === "off" || motion.reduced) return;
    const base = CAT[catIdx] || CAT[0];
    const dl = Math.hypot(base.dx ?? 0, base.dz ?? 1) || 1;
    const dx = (base.dx ?? 0) / dl;
    const dz = (base.dz ?? 1) / dl;
    entry.flight = { start: tFlight, cat: Math.max(0, catIdx), mode, run: deckRun(base.x, base.z, dx, dz) };
    entry.airborne = false;
    entry.gearK = 0;
    entry.dirX = dx;
    entry.dirZ = dz;
    if (!cine) cine = { entry, start: tFlight };
    entry.cur.x = base.x;
    entry.cur.z = base.z;
    entry.cur.y = 0.74;
    entry.cur.rot = Math.atan2(dx, dz);
    entry.plane.position.set(base.x, 0.74, base.z);
    entry.plane.rotation.set(0, entry.cur.rot, 0);
    const gear = entry.plane.userData.gear;
    if (gear) { gear.scale.y = 1; gear.visible = true; }
    const ao = entry.plane.userData.ao;
    if (ao) ao.visible = true;
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

  /** 着舰：从舰艉后方对正下滑道进场 → 拦阻 → 滑回自己的机位 */
  function startLanding(entry: Entry, mode: "auto" | "demo") {
    if (!entry.plane) return;
    if (motion.tier === "off" || motion.reduced) return;
    if (entry.landing) return;
    entry.flight = null;
    entry.landing = { start: tFlight, mode };
    entry.airborne = false;
    entry.gearK = 0;
    const dir = { x: Math.sin(LAND.rot), z: Math.cos(LAND.rot) };
    entry.dirX = dir.x;
    entry.dirZ = dir.z;
    entry.cur.x = LAND.x - dir.x * APPROACH;
    entry.cur.z = LAND.z - dir.z * APPROACH;
    entry.cur.y = APPROACH_ALT;
    entry.cur.rot = LAND.rot;
    entry.plane.position.set(entry.cur.x, entry.cur.y, entry.cur.z);
    entry.plane.rotation.set(-0.06, LAND.rot, 0);
    entry.ring.position.set(LAND.x, 0.11, LAND.z);
    entry.ring.visible = false;
    const gear = entry.plane.userData.gear;
    if (gear) { gear.scale.y = 1; gear.visible = true; }
    const ao = entry.plane.userData.ao;
    if (ao) ao.visible = false;
    if (entry.exhaust) entry.exhaust.material.opacity = 0.16;
    if (entry.steam) { entry.steam.removeFromParent(); entry.steam = undefined; }
    if (!cine) cine = { entry, start: tFlight };
  }

  function landDemo() {
    const list = [...entries.values()].filter((e) => e.plane && !e.flight && !e.landing);
    if (!list.length) return;
    const review = list.find((e) => e.tone === "review" || e.target === LAND);
    startLanding(review ?? list[0], "demo");
  }

  function launchDemo() {
    const list = [...entries.values()].filter((e) => e.plane && !e.flight && !e.landing);
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
      seen.add(actor.id);
      let entry = entries.get(actor.id);
      if (!entry) {
        entry = createEntry(actor, index);
        entries.set(actor.id, entry);
      }
      const target = targetFor(actor, counters);
      entry.target = target;
      entry.tone = actor.tone;
      entry.label.dataset.tone = actor.tone;
      entry.label.innerHTML = `<i></i><b>${escapeHtml(actor.displayName)}</b><em>${escapeHtml(actor.statusLabel)}</em>`;
      entry.label.title = `${actor.displayName} · ${ZONE_LABEL[actor.zone]} · ${actor.statusLabel}`;
      entry.label.classList.toggle("sel", getSelected() === actor.id);
      (entry.ring.material as THREE.MeshBasicMaterial).color.setHex(TONE_HEX[actor.tone] ?? 0x8f9aa3);
      const catIdx = CAT.indexOf(target);
      if (entry.plane) {
        if (entry.flight && catIdx < 0) entry.flight = null;
        const becameRun = actor.tone === "run" && entry.prevTone !== "run";
        const enteredCat = actor.tone === "run" && catIdx >= 0 && entry.prevCat !== catIdx;
        if (!firstSync && !entry.flight && !entry.airborne && !entry.landing && (becameRun || enteredCat)) {
          startFlight(entry, Math.max(0, catIdx), "auto");
        }
        /* 进入 review / approval = 回到着舰道：放一次降落，落到自己的机位 */
        const becameReview = actor.tone === "review" && entry.prevTone !== "review";
        if (!firstSync && !entry.flight && !entry.airborne && !entry.landing && becameReview) {
          startLanding(entry, "auto");
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
        v.set(LEAD.x, 2.2, LEAD.z);
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

  /* 机位预设：都是世界坐标（舰体只会轻微起伏），拖动时绕 look 点环绕 */
  const VIEWS: Record<CarrierView, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
    overview: { pos: [52, 20, 64], look: [1, 9, -5], fov: 36 },
    bow: { pos: [-44, 12, 24], look: [-2, 4, 12], fov: 38 },
    island: { pos: [44, 14, 28], look: [6, 5, 1], fov: 30 },
    landing: { pos: [27, 8, -52], look: [2, 2.5, -28], fov: 34 },
    top: { pos: [2, 152, 6], look: [2, 0, 2], fov: 40 },
  };
  const view: { key: CarrierView; yaw: number; pitch: number; zoom: number } = { key: "overview", yaw: 0, pitch: 0, zoom: 1 };
  function resetOrbit() { view.yaw = 0; view.pitch = 0; view.zoom = 1; }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let drag: { id: number; x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    /* 只有按在画布上才拖视角，点姓名牌不抢事件 */
    if (e.button !== 0 || e.target !== canvas) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.style.cursor = "grabbing";
  };
  const onPointerMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
    if (!drag || e.pointerId !== drag.id) return;
    view.yaw -= (e.clientX - drag.x) * 0.005;
    view.pitch = Math.max(-0.32, Math.min(0.95, view.pitch + (e.clientY - drag.y) * 0.004));
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) { drag = null; canvas.style.cursor = ""; }
  };
  /* 双击回到总览机位（拖动过的角度一并复位） */
  const onDoubleClick = () => {
    pointer.tx = 0;
    pointer.ty = 0;
    view.key = "overview";
    resetOrbit();
    onViewChange?.("overview");
  };
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("pointerleave", onPointerUp);
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
  let cine: { entry: Entry; start: number } | null = null;
  const camPos = new THREE.Vector3(52, 20, 64);
  const camLook = new THREE.Vector3(1, 9, -5);
  let camFov = 36;
  let camRoll = 0;
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
    /* 机位 = 预设机位 + 拖动的环绕角（绕预设 look 点转），再叠一点呼吸和指针视差 */
    const preset = VIEWS[view.key] ?? VIEWS.overview;
    const offX = preset.pos[0] - preset.look[0];
    const offY = preset.pos[1] - preset.look[1];
    const offZ = preset.pos[2] - preset.look[2];
    const baseR = Math.hypot(offX, offY, offZ) || 1;
    const orbitYaw = Math.atan2(offX, offZ) + view.yaw;
    const orbitPitch = Math.max(-0.32, Math.min(1.35, Math.asin(offY / baseR) + view.pitch));
    const orbitR = baseR * view.zoom;
    const cosPitch = Math.cos(orbitPitch);
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
        const dx = entry.dirX;
        const dz = entry.dirZ;
        const heading0 = Math.atan2(dx, dz);
        const el = tFlight - flight.start;
        let y = 0.74;
        let dist = 0;
        let pitch = 0;
        let roll = 0;
        let airborne = false;
        if (el < T_TENSION) {
          /* 蓄力：机轮锁死，机体轻微抖动，尾喷口升温 */
          launchingCats.add(flight.cat);
          roll = Math.sin(el * 46) * 0.004;
          if (entry.exhaust) entry.exhaust.material.opacity = 0.25 + (el / T_TENSION) * 0.4;
        } else if (el < T_TENSION + T_STROKE) {
          /* 行程：电磁弹射，二次方加速；到甲板末端刚好抬起机头 */
          const p = (el - T_TENSION) / T_STROKE;
          dist = flight.run * Math.pow(p, 2.05);
          pitch = -0.11 * p * p;
          shake = Math.max(shake, (1 - p) * 0.65);
          launchingCats.add(flight.cat);
          if (entry.exhaust) {
            entry.exhaust.material.opacity = 0.85;
            entry.exhaust.scale.setScalar(2.6 + p * 1.2);
          }
        } else {
          /* 离舰：持续加速、拉起、拐弯，真的飞出画面 */
          airborne = true;
          const u = el - T_TENSION - T_STROKE;
          /* 沿圆弧积分：不会随帧率漂移 */
          const steps = 10;
          const h = u / steps;
          let px = 0;
          let pz = 0;
          for (let i = 0; i < steps; i++) {
            const th = TURN_RATE * (i + 0.5) * h;
            const vi = V_LIFT + ACC_AIR * (i + 0.5) * h;
            px += Math.sin(th) * vi * h;
            pz += Math.cos(th) * vi * h;
          }
          const c0 = Math.cos(heading0);
          const s0 = Math.sin(heading0);
          const arcX = c0 * px + s0 * pz;
          const arcZ = -s0 * px + c0 * pz;
          const startX = base.x + s0 * flight.run;
          const startZ = base.z + c0 * flight.run;
          y = 0.74 + CLIMB * (1 - Math.exp(-0.72 * u));
          pitch = -(0.2 + 0.26 * Math.exp(-1.1 * u));
          roll = 0.19 * Math.min(1, u / 1.3);
          entry.cur.rot = heading0 + TURN_RATE * u;
          entry.cur.x = startX + arcX;
          entry.cur.z = startZ + arcZ;
          if (entry.exhaust) {
            entry.exhaust.material.opacity = 0.65 * Math.exp(-0.35 * u) + 0.12;
            entry.exhaust.scale.setScalar(3.0 - Math.min(1, u / 3) * 0.9);
          }
          if (u > FLIGHT_END) { startLanding(entry, "auto"); continue; }
        }
        entry.airborne = airborne;
        if (!airborne) {
          entry.cur.x = base.x + dx * dist;
          entry.cur.z = base.z + dz * dist;
          entry.cur.rot = heading0;
        }
        entry.cur.y = y;
        entry.plane.position.set(entry.cur.x, y, entry.cur.z);
        entry.plane.rotation.set(pitch, entry.cur.rot, roll);
        entry.ring.visible = false;
        /* 起落架：离舰后 0.9s 内收起 */
        const gear = entry.plane.userData.gear;
        if (gear) {
          const u = el - T_TENSION - T_STROKE;
          const k = airborne ? Math.min(1, Math.max(0, u / 0.9)) : 0;
          entry.gearK = k;
          gear.scale.y = Math.max(0.06, 1 - k * 1.02);
          gear.visible = k < 0.9;
        }
        const ao = entry.plane.userData.ao;
        if (ao) ao.visible = !airborne;
        if (entry.steam) {
          const sp = Math.min(1, el / 2.4);
          entry.steam.material.opacity = Math.max(0, 0.45 * (1 - sp));
          entry.steam.scale.setScalar(2.4 + sp * 5.5);
          if (el > 2.6) { entry.steam.removeFromParent(); entry.steam = undefined; }
        }
      } else if (entry.landing) {
        /* 着舰：对正下滑 → 拉平接地 → 拦阻滑跑 */
        const landing = entry.landing;
        const el = tFlight - landing.start;
        const dir = { x: Math.sin(LAND.rot), z: Math.cos(LAND.rot) };
        let along = 0;
        let y = 0.74;
        let pitch = 0;
        if (el < T_APPROACH) {
          const p = el / T_APPROACH;
          along = -APPROACH * (1 - p);
          y = 0.74 + (APPROACH_ALT - 0.74) * Math.pow(1 - p, 1.7);
          pitch = -0.05 - 0.07 * Math.sin(Math.PI * Math.min(1, p * 1.15));
          if (entry.exhaust) entry.exhaust.material.opacity = 0.16;
        } else {
          /* 拦阻索咬住：1 秒内从进场速度刹停，只往前滑几米 */
          const q = Math.min(1, (el - T_APPROACH) / T_ROLLOUT);
          along = 8.5 * (1 - Math.pow(1 - q, 2.4));
          y = 0.74 - Math.sin(q * Math.PI) * 0.08;
          pitch = 0.02 * q;
          if (!entry.steam && q < 0.6) {
            const smoke = new THREE.Sprite(new THREE.SpriteMaterial({
              map: STEAM_TEX, color: 0xdff0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
            }));
            smoke.position.set(LAND.x, 0.55, LAND.z);
            smoke.scale.set(1.6, 1.6, 1);
            ship.add(smoke);
            entry.steam = smoke;
          }
          if (entry.steam) {
            entry.steam.material.opacity = Math.max(0, 0.3 * (1 - q));
            entry.steam.scale.setScalar(1.6 + q * 4.2);
          }
          if (entry.exhaust) entry.exhaust.material.opacity = 0;
          if (q >= 1) {
            /* 停稳后交回普通走位：滑回自己该在的机位 */
            entry.landing = null;
            entry.ring.visible = true;
            entry.cur.x = LAND.x + dir.x * along;
            entry.cur.z = LAND.z + dir.z * along;
            entry.cur.y = 0.74;
            entry.cur.rot = LAND.rot;
            entry.plane.position.set(entry.cur.x, 0.74, entry.cur.z);
            entry.plane.rotation.set(0, LAND.rot, 0);
            const aoLand = entry.plane.userData.ao;
            if (aoLand) aoLand.visible = true;
            continue;
          }
        }
        entry.cur.x = LAND.x + dir.x * along;
        entry.cur.z = LAND.z + dir.z * along;
        entry.cur.y = y;
        entry.cur.rot = LAND.rot;
        entry.plane.position.set(entry.cur.x, y, entry.cur.z);
        entry.plane.rotation.set(pitch, LAND.rot, 0);
        entry.ring.visible = false;
        const geoLand = entry.plane.userData.gear;
        if (geoLand) { geoLand.scale.y = 1; geoLand.visible = true; }
        const aoLand = entry.plane.userData.ao;
        if (aoLand) aoLand.visible = false;
      } else {
        entry.airborne = false;
        entry.cur.x += (t.x - entry.cur.x) * speed;
        entry.cur.z += (t.z - entry.cur.z) * speed;
        entry.cur.y += (0.74 - entry.cur.y) * speed;
        entry.cur.rot += (t.rot - entry.cur.rot) * speed;
        entry.plane.position.set(entry.cur.x, entry.cur.y, entry.cur.z);
        entry.plane.rotation.y = entry.cur.rot;
        entry.plane.rotation.x += (0 - entry.plane.rotation.x) * speed;
        entry.plane.rotation.z += (0 - entry.plane.rotation.z) * speed;
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
    scene.updateMatrixWorld(true);

    /* 弹射 / 着舰镜头：各自有固定的跟拍窗口，结束后回总览 */
    if (cine) {
      const el = tFlight - cine.start;
      const alive = (Boolean(cine.entry.flight) && el < T_TENSION + T_STROKE + 2.7)
        || (Boolean(cine.entry.landing) && el < T_APPROACH + T_ROLLOUT + 0.3);
      if (!alive) cine = null;
    }
    const desiredPos = new THREE.Vector3(
      preset.look[0] + Math.sin(orbitYaw) * cosPitch * orbitR + Math.sin(tAnim * 0.11) * amp + pointer.x * 1.4,
      preset.look[1] + Math.sin(orbitPitch) * orbitR + Math.sin(tAnim * 0.08 + 1.4) * amp * 0.35 - pointer.y * 0.8,
      preset.look[2] + Math.cos(orbitYaw) * cosPitch * orbitR,
    );
    const desiredLook = new THREE.Vector3(preset.look[0], preset.look[1], preset.look[2]);
    let desiredFov = preset.fov;
    let desiredRoll = 0;
    if (cine && cine.entry.plane && cine.entry.landing) {
      /* 着舰镜头：机位在左舷外侧、进场道旁边，看飞机沿下滑道对正、拉平、咬住拦阻索 */
      const entry = cine.entry;
      const p = new THREE.Vector3();
      entry.plane.getWorldPosition(p);
      const dir = new THREE.Vector3(Math.sin(LAND.rot), 0, Math.cos(LAND.rot)).applyQuaternion(ship.quaternion).normalize();
      const perp = new THREE.Vector3(dir.z, 0, -dir.x);
      const anchor = new THREE.Vector3(LAND.x, 0, LAND.z);
      ship.localToWorld(anchor);
      /* 跟在下滑道后上方：飞机沿下滑线压向甲板，拦阻后一路跟到停稳 */
      desiredPos.copy(p).addScaledVector(dir, -15).addScaledVector(perp, -5).add(new THREE.Vector3(0, 5.2, 0));
      desiredLook.copy(p).addScaledVector(dir, 7).add(new THREE.Vector3(0, -1.2, 0));
      desiredFov = 35;
      desiredRoll = 0.012;
    } else if (cine && cine.entry.plane && cine.entry.flight) {
      const entry = cine.entry;
      const flight = entry.flight;
      const base = CAT[flight.cat] || CAT[0];
      const p = new THREE.Vector3();
      entry.plane.getWorldPosition(p);
      const dir = new THREE.Vector3(entry.dirX, 0, entry.dirZ).applyQuaternion(ship.quaternion).normalize();
      const perp = new THREE.Vector3(dir.z, 0, -dir.x);
      const el = tFlight - cine.start;
      if (!entry.airborne) {
        /* 弹射：贴着舷侧低机位，机头在画面里抬起来 */
        const anchor = new THREE.Vector3(base.x, 0, base.z);
        ship.localToWorld(anchor);
        desiredPos.copy(anchor).addScaledVector(perp, 10).addScaledVector(dir, -16).add(new THREE.Vector3(0, 4.4, 0));
        desiredLook.copy(p).addScaledVector(dir, 5).add(new THREE.Vector3(0, 1.1, 0));
        desiredFov = 34;
        desiredRoll = 0.01;
      } else {
        /* 离舰：机位钉在舰首外侧，机头抬起后从画面里飞出去（镜头不追着飞机跑，航母一直在画面里） */
        const u = Math.max(0, el - T_TENSION - T_STROKE);
        const recede = Math.min(1, u / 4.5);
        const anchor = new THREE.Vector3(base.x + entry.dirX * flight.run, 0, base.z + entry.dirZ * flight.run);
        ship.localToWorld(anchor);
        desiredPos.copy(anchor).addScaledVector(perp, 48 + recede * 6).addScaledVector(dir, -30 - recede * 6).add(new THREE.Vector3(0, 19 + recede * 3, 0));
        desiredLook.copy(anchor).addScaledVector(dir, -12).add(new THREE.Vector3(0, 2.5 + recede * 2, 0));
        desiredFov = 34 + recede * 4;
        desiredRoll = 0.026;
      }
    }
    const ease = cine ? Math.min(1, dt * 4.4) : Math.min(1, dt * 2.2);
    camPos.lerp(desiredPos, ease);
    camLook.lerp(desiredLook, ease);
    camFov += (desiredFov - camFov) * ease;
    camRoll += (desiredRoll - camRoll) * ease;
    camera.position.copy(camPos);
    if (shake > 0) {
      camera.position.x += Math.sin(tAnim * 96) * 0.18 * shake;
      camera.position.y += Math.cos(tAnim * 83) * 0.12 * shake;
    }
    camera.lookAt(camLook);
    camera.rotateZ(camRoll);
    if (Math.abs(camera.fov - camFov) > 0.01) {
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }
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
    land() {
      if (disposed) return;
      landDemo();
    },
    setView(next) {
      if (disposed) return;
      if (!VIEWS[next]) return;
      view.key = next;
      resetOrbit();
    },
    update() {
      if (disposed) return;
      syncActors();
    },
    setSelected() {
      const model = getModel();
      for (const actor of model.actors) {
        entries.get(actor.id)?.label.classList.toggle("sel", getSelected() === actor.id);
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
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("pointerleave", onPointerUp);
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
