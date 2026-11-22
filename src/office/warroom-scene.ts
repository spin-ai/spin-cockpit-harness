import * as THREE from "three";
import type { OfficeActor, OfficeModel, OfficeTone, OfficeZone } from "./model";
import { ZONE_LABEL } from "./motion";
import type { CoordinationStageView } from "../types";

/**
 * 作战室 · three.js 3D 舞台
 * 移植自 docs/prototype/warroom-3d.html（Three.js r149，MIT），并接上真实 OfficeModel：
 * - 长桌 / 主屏 / 复盘墙 / 发布闸门 / 通讯位对应真实 zone
 * - 角色位置、颜色、姓名牌来自 run / todo 的 tone / status，舞台不新增状态
 * - 文字留在 DOM / CanvasTexture，不用 WebGL 画字
 */

type MotionTier = "calm" | "full" | "off";
type Theme = "light" | "dark";

/** 机位：总览 / 大屏 / 长桌 / 工位（存在 prefs.view，和航母共用一份存储） */
export type WarRoomView = CoordinationStageView;

interface MountOptions {
  host: HTMLElement;
  getModel: () => OfficeModel;
  getSelected: () => string | null;
  getNow: () => number;
  getMotion: () => { tier: MotionTier; reduced: boolean; walk: number };
  getTheme: () => Theme;
  onSelect: (id: string) => void;
  onViewChange?: (view: WarRoomView) => void;
}

interface ActorSlot {
  group: THREE.Group;
  /** 髋以上的整套：站姿 y=0，坐姿整体下沉；腿单独转 */
  upper: THREE.Group;
  legs: { hip: THREE.Group; knee: THREE.Group }[];
  arms: { shoulder: THREE.Group; elbow: THREE.Group }[];
  /** 跟 tone 走的部位：肩线、胸标、耳机环 */
  accents: THREE.Mesh[];
  label: HTMLButtonElement;
  current: THREE.Vector3;
  target: THREE.Vector3;
  standing: boolean;
  accent: number;
  tone: OfficeTone;
}

export interface WarRoom3DApi {
  update: () => void;
  launch: () => void;
  setSelected: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  setMotion: (tier: MotionTier, reduced: boolean, walk: number) => void;
  setView: (view: WarRoomView) => void;
  dispose: () => void;
}

const TONE_HEX: Record<OfficeTone, number> = {
  run: 0x5fc89a,
  wait: 0xd9b878,
  review: 0x9c8ae0,
  fail: 0xd97a78,
  lead: 0x6fd6f5,
  neutral: 0x8f9aa3,
};

/* 站位：阶梯三排（前排落地、后两排各抬 0.34）+ 前排正中的指挥席 + 功能位；全部朝大屏。
   席位号从后往前排（座位数固定 6 个，先坐满离镜头最近的排，远处的空位看不出空）。 */
const SEATS: { x: number; z: number; y: number }[] = [
  { x: -4.3, z: 2.35, y: 0.68 }, { x: -1.45, z: 2.35, y: 0.68 }, { x: 1.45, z: 2.35, y: 0.68 }, { x: 4.3, z: 2.35, y: 0.68 },
  { x: -4.3, z: -0.15, y: 0.34 }, { x: -1.45, z: -0.15, y: 0.34 }, { x: 1.45, z: -0.15, y: 0.34 }, { x: 4.3, z: -0.15, y: 0.34 },
  { x: -4.3, z: -2.65, y: 0 }, { x: -1.45, z: -2.65, y: 0 }, { x: 1.45, z: -2.65, y: 0 }, { x: 4.3, z: -2.65, y: 0 },
];
/* 前排正中＝指挥席（FLIGHT），面朝大屏 */
const LEAD_SEAT = { x: 0, z: -2.65, y: 0 };
const STATION: Record<Exclude<OfficeZone, "desk" | "lead">, { x: number; z: number; y: number; standing: boolean }> = {
  review: { x: -6.7, z: -4.7, y: 0, standing: true },
  approval: { x: 6.7, z: -4.7, y: 0, standing: true },
  meeting: { x: 0, z: -5.05, y: 0, standing: true },
  tea: { x: -7.9, z: 0.5, y: 0, standing: true },
  standby: { x: 7.9, z: 0.5, y: 0, standing: true },
};

const PAL = {
  dark: {
    bg: 0x05080b, fog: 0x05080b, wall: 0x171c21, wall2: 0x111619, floor: 0x070a0d,
    ceil: 0x0a0d10, metal: 0x11161b, glow: 0x6fd6f5, glowCss: "#6fd6f5",
    panel: "#070a0d", panel2: "#04070a", ink: "#dbe8ee", ink2: "rgba(219,232,238,.66)",
    ink3: "rgba(219,232,238,.40)", green: "#7fd6a4", amber: "#d9b878", red: "#d97a78", purple: "#9c8ae0",
    amb: 0.10, hemi: 0.14, key: 0.4, spill: 0.7,
  },
  light: {
    bg: 0xdfe7ee, fog: 0xdfe7ee, wall: 0xc4ced7, wall2: 0xaeb9c3, floor: 0x12171d,
    ceil: 0xe6ecf2, metal: 0x2b333b, glow: 0x2f9fc4, glowCss: "#2f9fc4",
    panel: "#070b0e", panel2: "#04070a", ink: "#dbe8ee", ink2: "rgba(219,232,238,.66)",
    ink3: "rgba(219,232,238,.40)", green: "#5fc89a", amber: "#d9b878", red: "#d97a78", purple: "#9c8ae0",
    amb: 0.22, hemi: 0.26, key: 0.6, spill: 0.5,
  },
};

/* 人默认面朝 +z；整间大厅的人都朝着前方大屏（−z） */
const FACE_NEG_Z = Math.PI;

function targetOf(actor: OfficeActor, index: number): { x: number; y: number; z: number; standing: boolean; ry: number } {
  if (actor.zone === "lead") return { ...LEAD_SEAT, standing: false, ry: FACE_NEG_Z };
  if (actor.zone === "desk") {
    const seat = actor.seat ?? index;
    const s = SEATS[((seat % SEATS.length) + SEATS.length) % SEATS.length];
    return { ...s, standing: false, ry: FACE_NEG_Z };
  }
  const st = STATION[actor.zone] ?? STATION.standby;
  /* 同一个工位有多人时左右错开，别叠成一个人 */
  const spread = ((index % 3) - 1) * 0.85;
  return { ...st, x: st.x + spread, ry: FACE_NEG_Z };
}

export function mountWarRoom3D(options: MountOptions): WarRoom3DApi {
  const { host, getModel, getSelected, getNow, getMotion, getTheme, onSelect, onViewChange } = options;
  const doc = host.ownerDocument;
  host.innerHTML = "";

  const canvas = doc.createElement("canvas");
  canvas.className = "war3d-canvas";
  host.appendChild(canvas);
  const labelLayer = doc.createElement("div");
  labelLayer.className = "war3d-labels";
  host.appendChild(labelLayer);

  let theme: Theme = getTheme();
  let pal = PAL[theme];
  let motion = getMotion();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.LinearEncoding;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
  const rtScene = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: true });
  const rtA = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: false });
  const rtB = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: false });
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  quadScene.add(quad);
  const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.95 }, uKnee: { value: 0.06 } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b));
        float s = smoothstep(uThreshold, uThreshold + uKnee, l); gl_FragColor = vec4(c * s, 1.0); }`,
    depthTest: false, depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        vec3 s = texture2D(tDiffuse, vUv).rgb * .227027;
        s += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * .3162162;
        s += (texture2D(tDiffuse, vUv + uDir * 3.2308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2308).rgb) * .0702703;
        gl_FragColor = vec4(s, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tBloom: { value: null },
      uIntensity: { value: 0.18 }, uExposure: { value: 0.72 }, uVignette: { value: 0.55 },
    },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uIntensity; uniform float uExposure; uniform float uVignette; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main(){
        vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uIntensity;
        c *= uExposure; c = aces(c);
        vec2 p = vUv - 0.5;
        float v = smoothstep(0.92, 0.28, length(p));
        c *= mix(1.0, v, uVignette);
        gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  function renderPost() {
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    quad.material = brightMat;
    brightMat.uniforms.tDiffuse.value = rtScene.texture;
    renderer.setRenderTarget(rtA);
    renderer.render(quadScene, quadCam);
    quad.material = blurMat;
    blurMat.uniforms.tDiffuse.value = rtA.texture;
    blurMat.uniforms.uDir.value.set(1 / rtA.width, 0);
    renderer.setRenderTarget(rtB);
    renderer.render(quadScene, quadCam);
    blurMat.uniforms.tDiffuse.value = rtB.texture;
    blurMat.uniforms.uDir.value.set(0, 1 / rtA.height);
    renderer.setRenderTarget(rtA);
    renderer.render(quadScene, quadCam);
    compMat.uniforms.tScene.value = rtScene.texture;
    compMat.uniforms.tBloom.value = rtA.texture;
    quad.material = compMat;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.bg);
  scene.fog = new THREE.Fog(pal.fog, 13, 26);
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 80);
  /* 机位预设：都绕各自的 look 点做球面环绕（拖动只改 yaw / pitch），双击回总览 */
  const VIEWS: Record<WarRoomView, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
    overview: { pos: [0, 5.1, 10.4], look: [0, 1.05, -2.9], fov: 36 },
    screen: { pos: [0, 3.2, 2.6], look: [0, 2.65, -6.1], fov: 34 },
    desk: { pos: [-7.8, 3.1, 5.4], look: [0.8, 1.05, -1.4], fov: 36 },
    gate: { pos: [8.5, 3.0, 5.6], look: [-0.6, 1.25, -3.0], fov: 37 },
    /* 航母的机位落在同一份 prefs.view 里，这里只做兜底，避免脏值导致黑屏 */
    bow: { pos: [0, 5.1, 10.4], look: [0, 1.05, -2.9], fov: 36 },
    island: { pos: [0, 5.1, 10.4], look: [0, 1.05, -2.9], fov: 36 },
    landing: { pos: [0, 5.1, 10.4], look: [0, 1.05, -2.9], fov: 36 },
    top: { pos: [0, 5.1, 10.4], look: [0, 1.05, -2.9], fov: 36 },
  };
  const view: { key: WarRoomView; yaw: number; pitch: number; zoom: number } = { key: "overview", yaw: 0, pitch: 0, zoom: 1 };
  function resetOrbit() { view.yaw = 0; view.pitch = 0; view.zoom = 1; }
  const camTarget = new THREE.Vector3(0, 1.95, -2.4);

  function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const c = doc.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = maxAniso;
    t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  }
  function radialGlow(size: number, inner: string, outer: string) {
    return canvasTex(size, size, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }
  const softGlow = radialGlow(256, "rgba(120,220,250,.22)", "rgba(120,220,250,0)");

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = canvasTex(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#202a33");
    g.addColorStop(0.48, "#0d1419");
    g.addColorStop(1, "#070b0e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const s = ctx.createRadialGradient(w * 0.5, h * 0.44, 8, w * 0.5, h * 0.44, w * 0.34);
    s.addColorStop(0, "rgba(150,235,255,.95)");
    s.addColorStop(0.55, "rgba(110,210,240,.25)");
    s.addColorStop(1, "rgba(110,210,240,0)");
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(150,235,255,.85)";
    for (let i = 0; i < 3; i++) ctx.fillRect(w * 0.22 + i * w * 0.13, h * 0.10, w * 0.17, 5);
    ctx.fillStyle = "rgba(8,12,16,.92)";
    ctx.fillRect(0, h * 0.74, w, h * 0.26);
  });
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmremRT = pmrem.fromEquirectangular(envTex);
  scene.environment = pmremRT.texture;
  envTex.dispose();

  const MAT = {
    wall: new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 0.92, metalness: 0.02, envMapIntensity: 0.22 }),
    wall2: new THREE.MeshStandardMaterial({ color: pal.wall2, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.18 }),
    floor: new THREE.MeshStandardMaterial({ color: pal.floor, roughness: 0.52, metalness: 0.28, envMapIntensity: 0.55 }),
    ceil: new THREE.MeshStandardMaterial({ color: pal.ceil, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.12 }),
    metal: new THREE.MeshStandardMaterial({ color: pal.metal, roughness: 0.38, metalness: 0.72 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x11171d, roughness: 0.42, metalness: 0.5 }),
    chair: new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.68, metalness: 0.2 }),
    body: new THREE.MeshStandardMaterial({ color: 0xb9c7d2, roughness: 0.5, metalness: 0.12 }),
    emissive: (hex: number, i: number) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: i, roughness: 0.5, metalness: 0.1 }),
  };

  /* room */
  const room = new THREE.Group();
  scene.add(room);
  const RW = 19, RD = 13, RH = 4.6;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), MAT.floor);
  floor.material.transparent = true;
  floor.material.opacity = 0.9;
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);

  const tileTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(140,225,250,.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * w;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
    }
  });
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(5, 3.4);
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), new THREE.MeshBasicMaterial({
    map: tileTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  tiles.rotation.x = -Math.PI / 2;
  tiles.position.y = 0.006;
  room.add(tiles);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(RW, RH), MAT.wall);
  back.position.set(0, RH / 2, -RD / 2 + 0.1);
  back.receiveShadow = true;
  room.add(back);
  [-1, 1].forEach((s) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(RD, RH), MAT.wall2);
    w.position.set(s * (RW / 2 - 0.1), RH / 2, 0);
    w.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    room.add(w);
  });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), MAT.ceil);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, RH, 0);
  room.add(ceil);

  const stripMat = new THREE.MeshBasicMaterial({ map: softGlow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  [-3.2, 0, 3.2].forEach((x, i) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.5), stripMat);
    s.rotation.x = Math.PI / 2;
    s.position.set(x, RH - 0.04, -2 + (i - 1) * 1.2);
    room.add(s);
  });
  [-6.2, -3.1, 3.1, 6.2].forEach((x) => {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.06, RH, 0.04), MAT.metal);
    trim.position.set(x, RH / 2, -RD / 2 + 0.13);
    room.add(trim);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, RH - 0.5, 0.02), MAT.emissive(pal.glow, 0.45));
    s.position.set(x - 0.04, RH / 2, -RD / 2 + 0.15);
    room.add(s);
  });
  const htrim = new THREE.Mesh(new THREE.BoxGeometry(RW, 0.04, 0.04), MAT.metal);
  htrim.position.set(0, RH * 0.62, -RD / 2 + 0.13);
  room.add(htrim);
  [-1, 1].forEach((sgn) => {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.012, RD - 0.5), MAT.emissive(pal.glow, 0.5));
    led.position.set(sgn * (RW / 2 - 0.12), 0.07, 0);
    room.add(led);
  });
  [-3.4, 3.4].forEach((x) => {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, RD - 1.2), new THREE.MeshStandardMaterial({ color: 0x1b232a, roughness: 0.85, metalness: 0.1 }));
    rim.position.set(x, RH - 0.03, 0);
    room.add(rim);
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(RW, 0.06, 0.06), MAT.emissive(pal.glow, 0.55));
  base.position.set(0, 0.05, -RD / 2 + 0.12);
  room.add(base);

  const ceilLight = new THREE.PointLight(pal.glow, pal.spill * 0.06, 14, 2);
  ceilLight.position.set(0, RH - 0.4, -1.5);
  room.add(ceilLight);
  const ceilPanel = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.2), new THREE.MeshBasicMaterial({
    map: softGlow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  ceilPanel.rotation.x = Math.PI / 2;
  ceilPanel.position.set(0, RH - 0.02, -1.2);
  room.add(ceilPanel);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.6), new THREE.MeshBasicMaterial({
    map: softGlow, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.012, -3.4);
  room.add(pool);

  /* video wall */
  const wall = new THREE.Group();
  scene.add(wall);
  const VW = 10.4, VH = 3.9, VZ = -RD / 2 + 0.35;
  wall.position.set(0, 2.62, VZ);
  const wallFrame = new THREE.Mesh(new THREE.BoxGeometry(VW + 0.3, VH + 0.3, 0.2), MAT.metal);
  wallFrame.position.z = -0.03;
  wallFrame.castShadow = true;
  wall.add(wallFrame);
  const chamfer = new THREE.Mesh(new THREE.BoxGeometry(VW + 0.2, VH + 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x0d1216, roughness: 0.35, metalness: 0.8 }));
  chamfer.position.z = 0.02;
  wall.add(chamfer);
  const innerRim = new THREE.Mesh(new THREE.BoxGeometry(VW + 0.04, VH + 0.04, 0.06), new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 0.5, metalness: 0.6 }));
  innerRim.position.z = 0.055;
  wall.add(innerRim);
  const soundbar = new THREE.Mesh(new THREE.BoxGeometry(VW * 0.62, 0.11, 0.12), MAT.metal);
  soundbar.position.set(0, -VH / 2 - 0.24, 0.02);
  wall.add(soundbar);
  const sbLed = new THREE.Mesh(new THREE.BoxGeometry(VW * 0.16, 0.012, 0.012), MAT.emissive(pal.glow, 0.9));
  sbLed.position.set(0, -VH / 2 - 0.24, 0.09);
  wall.add(sbLed);

  const FONT_MONO = '"Geist Mono Variable", "SF Mono", Menlo, monospace';
  const FONT_SANS = '"Geist Variable", -apple-system, "PingFang SC", sans-serif';

  /* 发射：倒计时 → 点火升空 → 归位（和航母的弹射一样，是舞台演出，不进 State） */
  const T_COUNT = 4;
  const T_LIFT = 4.6;
  let launch: { start: number } | null = null;
  let hudDirty = true;
  let tLaunch = 0;
  function launchPhase() {
    if (!launch) return { phase: "idle" as const, count: 0, lift: 0, flame: 0, fade: 1 };
    const el = tLaunch - launch.start;
    if (el < T_COUNT) {
      return { phase: "countdown" as const, count: Math.max(0, Math.ceil(T_COUNT - el)), lift: 0, flame: el > T_COUNT - 1.2 ? 0.35 : 0.1, fade: 1 };
    }
    if (el < T_COUNT + T_LIFT) {
      const u = (el - T_COUNT) / T_LIFT;
      return { phase: "liftoff" as const, count: 0, lift: Math.pow(u, 1.55) * 2.9, flame: 1, fade: u > 0.72 ? Math.max(0, 1 - (u - 0.72) / 0.28) : 1 };
    }
    return { phase: "reset" as const, count: 0, lift: 0, flame: 0, fade: 0 };
  }

  const HUD_W = 2048;
  const HUD_H = 768;
  const hudCanvas = doc.createElement("canvas");
  hudCanvas.width = HUD_W;
  hudCanvas.height = HUD_H;
  const hudCtx = hudCanvas.getContext("2d")!;
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.encoding = THREE.sRGBEncoding;
  hudTex.anisotropy = maxAniso;
  let lastHudPaint = 0;

  /* ── 大屏：发射指挥台（检查单 / 发射场实时画面 / GO-NO-GO） ── */
  function drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const model = getModel();
    const P = pal;
    const lz = launchPhase();
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, P.panel);
    bg.addColorStop(1, P.panel2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(140,225,250,.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = "rgba(150,225,248,.022)";
    for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);

    const mono = (size: number) => `${size}px ${FONT_MONO}`;
    const sans = (size: number, weight = 500) => `${weight} ${size}px ${FONT_SANS}`;
    const M = 72;
    ctx.textBaseline = "middle";
    const d = new Date(getNow());
    const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const board = model.board;
    const rows = board.rows.slice(0, 4);
    const running = model.actors.filter((a) => a.tone === "run" || a.tone === "lead").length;
    const waiting = model.actors.filter((a) => a.tone === "wait").length;
    const review = model.actors.filter((a) => a.tone === "review").length;
    const failed = model.actors.filter((a) => a.tone === "fail").length;

    /* header */
    ctx.fillStyle = P.glowCss;
    ctx.font = `600 ${mono(24)}`;
    ctx.letterSpacing = "5px";
    ctx.fillText("LAUNCH CONTROL", M, 52);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = P.ink;
    ctx.font = `600 ${sans(38)}`;
    ctx.fillText(board.title || "等待发射窗口", M + 366, 52);
    ctx.fillStyle = P.amber;
    ctx.font = `600 ${mono(22)}`;
    ctx.letterSpacing = "2px";
    ctx.strokeStyle = "rgba(217,184,120,.42)";
    ctx.lineWidth = 2;
    ctx.strokeRect(M + 620, 30, 110, 44);
    ctx.fillText(board.key || "MISSION", M + 632, 52);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = P.ink2;
    ctx.font = `600 ${mono(24)}`;
    ctx.textAlign = "right";
    ctx.fillText(clock, w - M - 130, 52);
    ctx.fillStyle = P.glowCss;
    ctx.fillText(board.progress || "—", w - M, 52);
    ctx.textAlign = "left";
    ctx.strokeStyle = "rgba(140,220,245,.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, 84);
    ctx.lineTo(w - M, 84);
    ctx.stroke();

    /* 左：发射检查单 */
    ctx.fillStyle = P.ink3;
    ctx.font = `600 ${mono(20)}`;
    ctx.letterSpacing = "4px";
    ctx.fillText("检查单 · CHECKLIST", M, 116);
    ctx.letterSpacing = "0px";
    let sy = 168;
    const steps = rows.length ? rows : [{ key: "—", title: "没有进行中的任务", state: "todo" as const, tag: "待办" }];
    steps.forEach((row) => {
      const cx = M + 18;
      ctx.beginPath();
      ctx.arc(cx, sy, 15, 0, Math.PI * 2);
      ctx.fillStyle = row.state === "done" ? "rgba(95,200,160,.18)" : row.state === "doing" ? "rgba(214,175,110,.18)" : "#0a0f13";
      ctx.fill();
      ctx.strokeStyle = row.state === "done" ? "rgba(95,200,160,.62)" : row.state === "doing" ? "rgba(214,175,110,.68)" : "rgba(140,225,250,.28)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = row.state === "done" ? "#8fe0bb" : row.state === "doing" ? "#e6c48e" : P.ink3;
      ctx.font = `600 ${mono(16)}`;
      ctx.textAlign = "center";
      ctx.fillText(row.state === "done" ? "✓" : row.state === "doing" ? "◐" : "○", cx, sy + 1);
      ctx.textAlign = "left";
      ctx.fillStyle = P.ink;
      ctx.font = `500 ${sans(28)}`;
      ctx.fillText(row.title.slice(0, 11), M + 50, sy);
      ctx.fillStyle = P.ink3;
      ctx.font = `500 ${mono(20)}`;
      ctx.textAlign = "right";
      ctx.fillText(row.key, M + 404, sy);
      ctx.textAlign = "left";
      sy += 62;
    });

    /* 中：发射场实时画面 */
    const fx = 536, fy = 130, fw = 948, fh = 520;
    ctx.strokeStyle = "rgba(140,225,250,.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(fx, fy, fw, fh);
    drawPadFeed(ctx, fx + 3, fy + 3, fw - 6, fh - 6, lz);
    ctx.fillStyle = "rgba(6,10,14,.72)";
    ctx.fillRect(fx + 3, fy + 3, fw - 6, 42);
    ctx.fillStyle = P.glowCss;
    ctx.font = `600 ${mono(19)}`;
    ctx.letterSpacing = "3px";
    ctx.fillText("LIVE · 1 号工位", fx + 20, fy + 25);
    ctx.letterSpacing = "0px";
    ctx.textAlign = "right";
    ctx.fillStyle = lz.phase === "liftoff" ? "#ffce9b" : P.ink3;
    ctx.font = `600 ${mono(19)}`;
    ctx.fillText(lz.phase === "idle" ? "待令 · HOLD" : lz.phase === "countdown" ? "终端倒计时" : lz.phase === "liftoff" ? "已升空 · LIFTOFF" : "复位", fx + fw - 20, fy + 25);
    ctx.textAlign = "left";
    /* 倒计时数字压在画面底部 */
    const tMinus = lz.phase === "countdown" ? `T−00:00:0${lz.count}` : lz.phase === "liftoff" ? "T+00:00:00" : "T−00:00:00";
    ctx.fillStyle = "rgba(6,10,14,.66)";
    ctx.fillRect(fx + 3, fy + fh - 62, fw - 6, 59);
    ctx.fillStyle = lz.phase === "countdown" ? "#ffce9b" : lz.phase === "liftoff" ? "#8fe0bb" : P.ink2;
    ctx.font = `600 ${mono(40)}`;
    ctx.fillText(tMinus, fx + 22, fy + fh - 32);
    ctx.textAlign = "right";
    ctx.fillStyle = P.ink3;
    ctx.font = `600 ${mono(18)}`;
    ctx.fillText(
      lz.phase === "countdown" ? "ALL SYSTEMS GO" : lz.phase === "liftoff" ? "ASCENT NOMINAL" : "STANDBY",
      fx + fw - 22, fy + fh - 32,
    );
    ctx.textAlign = "left";

    /* 右：GO / NO-GO + 指标 */
    const rx = 1518;
    ctx.fillStyle = P.ink3;
    ctx.font = `600 ${mono(20)}`;
    ctx.letterSpacing = "4px";
    ctx.fillText("GO / NO-GO · 系统状态", rx, 116);
    ctx.letterSpacing = "0px";
    const zones = model.zones;
    const systems: [string, string, string, string][] = [
      ["PROP", "推进", running > 0 ? "GO" : "HOLD", running > 0 ? "green" : "amber"],
      ["GUID", "制导", board.percent > 0 ? "GO" : "HOLD", board.percent > 0 ? "green" : "amber"],
      ["TELM", "遥测", failed > 0 ? "NO-GO" : "GO", failed > 0 ? "red" : "green"],
      ["GATE", "发射许可", waiting > 0 || zones.waiting ? "HOLD" : "GO", waiting > 0 || zones.waiting ? "amber" : "green"],
      ["COMM", "通讯", model.terminals.running > 0 ? "GO" : "HOLD", model.terminals.running > 0 ? "green" : "amber"],
    ];
    systems.forEach(([tag, name, state, tone], i) => {
      const by = 148 + i * 66;
      const c = P[tone as "green" | "amber" | "red"];
      ctx.fillStyle = "rgba(140,225,250,.035)";
      ctx.fillRect(rx, by, 458, 56);
      ctx.strokeStyle = "rgba(140,225,250,.16)";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, by, 458, 56);
      ctx.fillStyle = c;
      ctx.fillRect(rx, by, 4, 56);
      ctx.fillStyle = P.ink3;
      ctx.font = `600 ${mono(17)}`;
      ctx.letterSpacing = "2px";
      ctx.fillText(tag, rx + 18, by + 20);
      ctx.letterSpacing = "0px";
      ctx.fillStyle = P.ink2;
      ctx.font = `500 ${sans(21)}`;
      ctx.fillText(name, rx + 18, by + 41);
      ctx.textAlign = "right";
      ctx.fillStyle = c;
      ctx.font = `600 ${mono(26)}`;
      ctx.letterSpacing = "2px";
      ctx.fillText(state, rx + 442, by + 30);
      ctx.letterSpacing = "0px";
      ctx.textAlign = "left";
    });

    const metrics: [string, number, string][] = [
      ["推进中", running, "green"],
      ["待许可", waiting, "amber"],
      ["待复核", review, "purple"],
      ["异常", failed, "red"],
    ];
    metrics.forEach(([k, v, tone], i) => {
      const bx = rx + (i % 2) * 240;
      const by = 494 + Math.floor(i / 2) * 76;
      ctx.strokeStyle = "rgba(140,225,250,.16)";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, 218, 66);
      ctx.fillStyle = "rgba(140,225,250,.04)";
      ctx.fillRect(bx, by, 218, 66);
      ctx.fillStyle = P.ink2;
      ctx.font = `500 ${sans(18)}`;
      ctx.fillText(k, bx + 13, by + 21);
      ctx.fillStyle = P[tone as "green" | "amber" | "purple" | "red"];
      ctx.font = `600 ${mono(30)}`;
      ctx.fillText(String(v), bx + 13, by + 47);
    });

    /* 底：发射时序 */
    ctx.strokeStyle = "rgba(140,220,245,.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, h - 76);
    ctx.lineTo(w - M, h - 76);
    ctx.stroke();
    ctx.fillStyle = P.glowCss;
    ctx.font = `600 ${mono(20)}`;
    ctx.letterSpacing = "4px";
    ctx.fillText("SEQ", M, h - 40);
    ctx.letterSpacing = "0px";
    const barX = M + 70, barW = 300;
    for (let i = 0; i < 4; i++) {
      const done = rows[i]?.state === "done";
      const doing = rows[i]?.state === "doing";
      ctx.fillStyle = done ? "rgba(95,200,160,.9)" : doing ? "rgba(214,175,110,.95)" : "rgba(140,225,250,.16)";
      ctx.fillRect(barX + i * (barW / 4 + 6), h - 50, barW / 4, 8);
    }
    ctx.fillStyle = P.ink2;
    ctx.font = `500 ${sans(20)}`;
    ctx.fillText(`${rows.filter((r) => r.state === "done").length} / ${Math.max(rows.length, 1)} 步完成`, barX + barW + 36, h - 40);
    ctx.textAlign = "right";
    ctx.fillStyle = P.amber;
    ctx.font = `600 ${sans(20)}`;
    const next = rows.find((r) => r.state !== "done");
    ctx.fillText(next ? `下一步：${next.title}` : "等待新的 Mission", w - M, h - 40);
    ctx.textAlign = "left";

    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.62);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.38)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  /* 发射场实时画面：夜空 / 塔架 / 探照灯 / 火箭 / 尾焰 / 烟雾 */
  function drawPadFeed(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lz: { phase: string; lift: number; flame: number }) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const cx = x + w * 0.52;
    const horizon = y + h * 0.82;
    const skyTop = y;
    /* 夜空 */
    const sky = ctx.createLinearGradient(0, skyTop, 0, horizon);
    sky.addColorStop(0, "#01040a");
    sky.addColorStop(0.55, "#061520");
    sky.addColorStop(1, "#0d2a39");
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, horizon - y);
    for (let i = 0; i < 140; i++) {
      const sx = x + ((i * 733) % w);
      const sy = skyTop + ((i * 311) % Math.max(1, horizon - skyTop - 60));
      const a = 0.12 + ((i * 37) % 70) / 300;
      ctx.fillStyle = `rgba(202,232,255,${a})`;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    /* 远山剪影 */
    ctx.fillStyle = "rgba(8,20,28,.9)";
    ctx.beginPath();
    ctx.moveTo(x, horizon);
    for (let i = 0; i <= 12; i++) {
      const px = x + (i / 12) * w;
      const py = horizon - 12 - Math.sin(i * 1.7) * 9 - (i % 3) * 3;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(x + w, horizon);
    ctx.closePath();
    ctx.fill();
    /* 地面 */
    const gr = ctx.createLinearGradient(0, horizon, 0, y + h);
    gr.addColorStop(0, "#0b1a22");
    gr.addColorStop(1, "#04080c");
    ctx.fillStyle = gr;
    ctx.fillRect(x, horizon, w, y + h - horizon);
    /* 探照灯（加法混合，只会变亮） */
    ctx.globalCompositeOperation = "lighter";
    const lamps = [0.2, 0.34, 0.7, 0.84];
    lamps.forEach((rx2, i) => {
      const lx = x + w * rx2;
      const ly = horizon - 4 - (i % 2) * 3;
      const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, 90);
      g.addColorStop(0, "rgba(178,220,245,.55)");
      g.addColorStop(0.35, "rgba(150,200,235,.16)");
      g.addColorStop(1, "rgba(150,200,235,0)");
      ctx.fillStyle = g;
      ctx.fillRect(lx - 90, ly - 90, 180, 180);
      const tilt = i < 2 ? 26 : -26;
      const cone = ctx.createLinearGradient(lx, ly, lx + tilt, horizon - h * 0.66);
      cone.addColorStop(0, "rgba(186,224,248,.16)");
      cone.addColorStop(1, "rgba(186,224,248,0)");
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(lx - 5, ly);
      ctx.lineTo(lx + tilt + 26, horizon - h * 0.66);
      ctx.lineTo(lx + tilt - 30, horizon - h * 0.66);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
    /* 发射台 */
    const padHalf = w * 0.13;
    ctx.fillStyle = "#0a141b";
    ctx.beginPath();
    ctx.moveTo(cx - padHalf, horizon + 2);
    ctx.lineTo(cx - padHalf * 0.82, horizon - 16);
    ctx.lineTo(cx + padHalf * 0.82, horizon - 16);
    ctx.lineTo(cx + padHalf, horizon + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(150,225,250,.22)";
    ctx.fillRect(cx - padHalf * 0.82, horizon - 16, padHalf * 1.64, 2);
    /* 塔架（在火箭左侧，带横撑与红色障碍灯） */
    const towerX = cx - w * 0.115;
    const towerBase = horizon - 12;
    const towerTop = towerBase - h * 0.62;
    const towerHalf = w * 0.028;
    ctx.strokeStyle = "rgba(158,196,216,.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(towerX - towerHalf, towerBase);
    ctx.lineTo(towerX - towerHalf * 0.5, towerTop);
    ctx.moveTo(towerX + towerHalf, towerBase);
    ctx.lineTo(towerX + towerHalf * 0.5, towerTop);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    const bays = 11;
    for (let i = 0; i <= bays; i++) {
      const k = i / bays;
      const yy = towerBase - (towerBase - towerTop) * k;
      const half = towerHalf * (1 - 0.5 * k);
      ctx.beginPath();
      ctx.moveTo(towerX - half, yy);
      ctx.lineTo(towerX + half, yy);
      ctx.stroke();
      if (i < bays) {
        const yy2 = towerBase - (towerBase - towerTop) * ((i + 1) / bays);
        const half2 = towerHalf * (1 - 0.5 * ((i + 1) / bays));
        ctx.beginPath();
        ctx.moveTo(towerX - half, yy);
        ctx.lineTo(towerX + half2, yy2);
        ctx.stroke();
      }
    }
    /* 摆臂 */
    ctx.strokeStyle = "rgba(158,196,216,.42)";
    ctx.lineWidth = 3;
    [0.42, 0.72].forEach((k) => {
      const yy = towerBase - (towerBase - towerTop) * k;
      ctx.beginPath();
      ctx.moveTo(towerX + towerHalf * 0.8, yy);
      ctx.lineTo(cx - w * 0.018, yy);
      ctx.stroke();
    });
    /* 塔顶障碍灯 */
    ctx.fillStyle = "rgba(255,96,72,.95)";
    ctx.beginPath();
    ctx.arc(towerX, towerTop - 3, 2.6, 0, Math.PI * 2);
    ctx.fill();
    /* 火箭 */
    const scale = Math.min(h / 480, w / 780) * 1.06;
    const groundY = horizon - 16;
    const rise = lz.lift * 120 * scale;
    drawRocket2D(ctx, cx, groundY - rise, scale, lz.flame);
    /* 尾焰 + 地面烟雾 */
    if (lz.flame > 0.02) {
      ctx.globalCompositeOperation = "lighter";
      const baseY = groundY - rise;
      const fh = 150 * scale * lz.flame;
      const fg = ctx.createLinearGradient(0, baseY, 0, baseY + fh);
      fg.addColorStop(0, "rgba(255,250,226,.98)");
      fg.addColorStop(0.35, "rgba(255,186,104,.8)");
      fg.addColorStop(1, "rgba(255,124,58,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(cx - 12 * scale, baseY);
      ctx.lineTo(cx + 12 * scale, baseY);
      ctx.lineTo(cx, baseY + fh);
      ctx.closePath();
      ctx.fill();
      const glow = ctx.createRadialGradient(cx, baseY + 8, 2, cx, baseY + 8, 190 * lz.flame);
      glow.addColorStop(0, "rgba(255,214,158,.6)");
      glow.addColorStop(0.4, "rgba(255,170,96,.22)");
      glow.addColorStop(1, "rgba(255,170,96,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 200, baseY - 120, 400, 400);
      const smokeK = Math.min(1, lz.lift / 2.2 + (lz.phase === "countdown" ? 0.35 : 0));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = (40 + lz.lift * 90 + i * 9) * scale;
        const px = cx + Math.cos(a) * r;
        const py = groundY - 6 + Math.sin(a) * r * 0.2;
        const sg = ctx.createRadialGradient(px, py, 1, px, py, 60 * scale);
        sg.addColorStop(0, `rgba(224,236,244,${0.28 * smokeK})`);
        sg.addColorStop(1, "rgba(224,236,244,0)");
        ctx.fillStyle = sg;
        ctx.fillRect(px - 70 * scale, py - 70 * scale, 140 * scale, 140 * scale);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    /* 扫描线 + 暗角 */
    ctx.fillStyle = "rgba(150,225,248,.045)";
    for (let yy = y; yy < y + h; yy += 4) ctx.fillRect(x, yy, w, 1);
    const vg = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.3, x + w / 2, y + h / 2, h * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /* 2D 火箭：整流罩 + 芯级 + 四枚助推 + 尾翼（baseY 是喷管所在高度） */
  function drawRocket2D(ctx: CanvasRenderingContext2D, cx: number, baseY: number, s: number, flame: number) {
    const W = 26 * s;
    const bodyH = 168 * s;
    const fairH = 34 * s;
    const noseH = 52 * s;
    const top = baseY - bodyH;
    /* 助推（左右各一枚可见，另两枚被遮） */
    [-1, 1].forEach((sd) => {
      const bx = cx + sd * (W / 2 + 4 * s) - (sd > 0 ? 0 : 11 * s);
      const bTop = baseY - bodyH * 0.72;
      const bg = ctx.createLinearGradient(bx, 0, bx + 11 * s, 0);
      bg.addColorStop(0, "#93a7b3");
      bg.addColorStop(0.45, "#e7f0f5");
      bg.addColorStop(1, "#8497a3");
      ctx.fillStyle = bg;
      ctx.fillRect(bx, bTop, 11 * s, baseY - bTop - 8 * s);
      ctx.fillStyle = "#d8e4ea";
      ctx.beginPath();
      ctx.moveTo(bx, bTop);
      ctx.lineTo(bx + 11 * s, bTop);
      ctx.lineTo(bx + 5.5 * s, bTop - 16 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#2b353d";
      ctx.fillRect(bx + s, baseY - 8 * s, 9 * s, 7 * s);
    });
    /* 芯级 */
    const cg = ctx.createLinearGradient(cx - W / 2, 0, cx + W / 2, 0);
    cg.addColorStop(0, "#7d909c");
    cg.addColorStop(0.22, "#cfdde5");
    cg.addColorStop(0.48, "#f4fafc");
    cg.addColorStop(0.72, "#d3e0e7");
    cg.addColorStop(1, "#75888f");
    ctx.fillStyle = cg;
    ctx.fillRect(cx - W / 2, top, W, bodyH);
    /* 级间段 + 红色环带 + 底部暗面 */
    ctx.fillStyle = "rgba(176,66,54,.88)";
    ctx.fillRect(cx - W / 2, top + bodyH * 0.58, W, 3.4 * s);
    ctx.fillStyle = "rgba(52,70,82,.55)";
    ctx.fillRect(cx - W / 2, top + bodyH * 0.34, W, 2.6 * s);
    ctx.fillRect(cx - W / 2, baseY - 9 * s, W, 9 * s);
    /* 整流罩 */
    ctx.fillStyle = "#eaf3f7";
    ctx.beginPath();
    ctx.moveTo(cx - W / 2, top + 2);
    ctx.lineTo(cx - W / 2, top - fairH);
    ctx.lineTo(cx, top - fairH - noseH);
    ctx.lineTo(cx + W / 2, top - fairH);
    ctx.lineTo(cx + W / 2, top + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(96,118,132,.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, top - fairH - noseH + 2);
    ctx.lineTo(cx, top - fairH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - W / 2, top - fairH);
    ctx.lineTo(cx + W / 2, top - fairH);
    ctx.stroke();
    /* 尾翼 */
    [-1, 1].forEach((sd) => {
      ctx.fillStyle = "#5f727d";
      ctx.beginPath();
      ctx.moveTo(cx + sd * W * 0.5, baseY - 22 * s);
      ctx.lineTo(cx + sd * (W * 0.5 + 8 * s), baseY - 6 * s);
      ctx.lineTo(cx + sd * W * 0.5, baseY - 4 * s);
      ctx.closePath();
      ctx.fill();
    });
    /* 喷管 */
    ctx.fillStyle = "#26303a";
    ctx.fillRect(cx - W * 0.3, baseY - 3 * s, W * 0.6, 6 * s);
    if (flame > 0.02) {
      ctx.fillStyle = "rgba(255,248,222,.95)";
      ctx.fillRect(cx - W * 0.26, baseY + 3 * s, W * 0.52, 4 * s);
    }
  }

  function paintHud() {
    drawHUD(hudCtx, HUD_W, HUD_H);
    hudTex.needsUpdate = true;
  }
  paintHud();

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ map: hudTex, fog: false }));
  screen.position.z = 0.09;
  wall.add(screen);

  /* 点火时从大屏方向打出来的暖光（照亮桌子和席位） */
  const launchLight = new THREE.PointLight(0xff9a52, 0, 15, 2);
  launchLight.position.set(0, 2.3, VZ + 1.1);
  scene.add(launchLight);

  const glareTex = canvasTex(1024, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w * 0.9, h);
    g.addColorStop(0, "rgba(220,245,255,.10)");
    g.addColorStop(0.28, "rgba(220,245,255,0)");
    g.addColorStop(0.72, "rgba(220,245,255,.05)");
    g.addColorStop(1, "rgba(220,245,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({
    map: glareTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glass.position.z = 0.1;
  wall.add(glass);

  const refl = new THREE.Group();
  refl.scale.y = -1;
  scene.add(refl);
  const reflScreen = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({
    map: hudTex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  reflScreen.position.set(0, 2.8, VZ + 0.12);
  refl.add(reflScreen);
  const reflLed = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.016, 0.016), new THREE.MeshBasicMaterial({
    color: pal.glow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  reflLed.position.set(0, 0.78, 0.5);
  refl.add(reflLed);

  /* 倒计时警示灯：点火前闪烁，升空时转白 */
  const beacons: THREE.Mesh[] = [];
  [[-6.7, 4.25], [-2.3, 4.25], [2.3, 4.25], [6.7, 4.25]].forEach(([x, y]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), new THREE.MeshStandardMaterial({ color: 0x7a2c24, emissive: 0xd0584e, emissiveIntensity: 0.15, roughness: 0.4 }));
    b.position.set(x, y, -RD / 2 + 0.22);
    room.add(b);
    beacons.push(b);
  });
  [-1, 1].forEach((sgn) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ color: 0x7a2c24, emissive: 0xd0584e, emissiveIntensity: 0.15, roughness: 0.4 }));
    b.position.set(sgn * (RW / 2 - 0.16), 4.0, -3.6);
    room.add(b);
    beacons.push(b);
  });

  /* desk */
  /* 阶梯控制台：三排台面朝大屏（前排最低，后排抬高），一排 8 台显示器 */
  const ROW_W = 13;
  const ROW_D = 0.94;
  const kbTex = canvasTex(256, 96, (ctx, w, h) => {
    ctx.fillStyle = "#10161b";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2b343d";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) ctx.fillRect(6 + c * 16.4, 8 + r * 15.6, 13.6, 12.4);
    ctx.fillStyle = "#39434d";
    ctx.fillRect(52, 8 + 4 * 15.6, 150, 12.4);
  });

  function monitorTexture(kind: "a" | "b" | "c") {
    return canvasTex(512, 288, (ctx, w, h) => {
      const P = pal;
      ctx.fillStyle = P.panel;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(140,225,250,.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.fillStyle = P.ink3;
      ctx.font = `600 13px ${FONT_MONO}`;
      ctx.letterSpacing = "3px";
      const model = getModel();
      const label = kind === "a" ? "RUN" : kind === "b" ? "QUEUE" : "REVIEW";
      ctx.fillText(label, 20, 26);
      ctx.letterSpacing = "0px";
      if (kind === "a" || kind === "c") {
        const rows = kind === "a" ? model.board.rows : [];
        ctx.strokeStyle = "rgba(140,225,250,.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const pts = rows.length ? rows.map((_, i) => 0.25 + (i / Math.max(1, rows.length)) * 0.6) : [0.3, 0.5, 0.42, 0.65, 0.55, 0.8, 0.72, 0.9];
        pts.forEach((p, i) => {
          const x = 24 + (i * (w - 48)) / Math.max(1, pts.length - 1);
          const y = h - 40 - p * (h - 90);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      if (kind === "b") {
        for (let i = 0; i < 8; i++) {
          const bh = 30 + ((i * 37) % 110);
          ctx.fillStyle = "rgba(140,225,250,.36)";
          ctx.fillRect(40 + i * 54, h - 46 - bh, 30, bh);
        }
        ctx.fillStyle = "rgba(219,232,238,.28)";
        ctx.fillRect(40, h - 42, w - 84, 2);
      }
      if (kind === "c") {
        ctx.fillStyle = "rgba(219,232,238,.42)";
        ctx.font = `500 15px ${FONT_MONO}`;
        ctx.fillText("FAIL 0 · RETRY 0", 24, h - 18);
      }
    });
  }

  /* 台面：显示器 + 键盘 + 鼠标 + 前脸灯带 */
  const monFaces: { mesh: THREE.Mesh; kind: "a" | "b" | "c" }[] = [];
  function consoleRow(z: number, baseY: number) {
    const g = new THREE.Group();
    g.position.set(0, baseY, z);
    const top = new THREE.Mesh(new THREE.BoxGeometry(ROW_W, 0.07, ROW_D), MAT.dark);
    top.position.y = 0.74;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(ROW_W, 0.66, 0.07), new THREE.MeshStandardMaterial({ color: 0x0d1216, roughness: 0.5, metalness: 0.55 }));
    apron.position.set(0, 0.44, -ROW_D / 2 + 0.035);
    g.add(apron);
    const led = new THREE.Mesh(new THREE.BoxGeometry(ROW_W - 0.1, 0.016, 0.016), MAT.emissive(pal.glow, 0.55));
    led.position.set(0, 0.70, -ROW_D / 2 - 0.005);
    g.add(led);
    const bevel = new THREE.Mesh(new THREE.BoxGeometry(ROW_W + 0.04, 0.022, ROW_D + 0.04), MAT.metal);
    bevel.position.y = 0.70;
    g.add(bevel);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(ROW_W - 1.0, 0.09, 0.26), new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.8, metalness: 0.3 }));
    cable.position.set(0, 0.33, -ROW_D / 2 + 0.28);
    g.add(cable);
    /* 一排 8 台显示器，纹理在 a / b / c 之间轮换 */
    const slots = 8;
    for (let i = 0; i < slots; i++) {
      const x = -ROW_W / 2 + 0.75 + (i * (ROW_W - 1.5)) / (slots - 1);
      const kind = (["a", "b", "c"] as const)[i % 3];
      const m = new THREE.Group();
      m.position.set(x, 0.80, -0.12);
      m.rotation.x = -0.06;
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.5, 0.045), MAT.metal);
      bezel.castShadow = true;
      m.add(bezel);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.07, 0.42), new THREE.MeshBasicMaterial({ map: monitorTexture(kind), fog: false }));
      face.position.z = 0.026;
      m.add(face);
      monFaces.push({ mesh: face, kind });
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), MAT.metal);
      stand.position.set(0, -0.3, -0.03);
      m.add(stand);
      g.add(m);
      if (i < slots - 1) {
        const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.2), new THREE.MeshBasicMaterial({ map: kbTex, fog: false }));
        kb.rotation.x = -Math.PI / 2;
        kb.position.set(x + 0.72, 0.78, 0.24);
        g.add(kb);
        const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), MAT.dark);
        mouse.scale.set(1, 0.5, 1.4);
        mouse.position.set(x + 0.72 + 0.36, 0.79, 0.24);
        g.add(mouse);
      }
    }
    scene.add(g);
    return g;
  }

  /* 阶梯：前排落地，后两排各抬 0.34；台沿有灯带，暗场里能看出层层抬高 */
  const stadiumMat = new THREE.MeshStandardMaterial({ color: 0x0f151a, roughness: 0.62, metalness: 0.3 });
  [
    { z0: -2.35, z1: 3.55, y0: 0, y1: 0.34 },
    { z0: 0.5, z1: 3.55, y0: 0.34, y1: 0.68 },
  ].forEach((b) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(13.6, b.y1 - b.y0, b.z1 - b.z0), stadiumMat);
    box.position.set(0, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    box.receiveShadow = true;
    scene.add(box);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.016, 0.016), MAT.emissive(pal.glow, 0.5));
    edge.position.set(0, b.y1 - 0.012, b.z0 + 0.008);
    scene.add(edge);
  });
  consoleRow(-3.6, 0);
  consoleRow(-1.1, 0.34);
  consoleRow(1.4, 0.68);

  /* 前墙两侧的辅助屏（遥测 / 追踪），让大屏不是孤零零一块 */
  function sideScreen(cx: number, title: string, accent: number) {
    const g = new THREE.Group();
    g.position.set(cx, 2.55, -RD / 2 + 0.14);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.05, 0.07), MAT.metal);
    g.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.92), new THREE.MeshBasicMaterial({
      map: canvasTex(256, 172, (ctx, w, h) => {
        ctx.fillStyle = "#060a0d";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(140,225,250,.14)";
        for (let x = 0; x < w; x += 22) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        ctx.fillStyle = "#8fe0c8";
        ctx.font = `600 15px ${FONT_MONO}`;
        ctx.letterSpacing = "2px";
        ctx.fillText(title, 14, 24);
        ctx.letterSpacing = "0px";
        ctx.strokeStyle = accent === 0xd9b878 ? "#d9b878" : "#6fd6f5";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const x = 14 + (i / 24) * (w - 28);
          const y = h - 34 - (Math.sin(i * 0.7) * 0.5 + 0.5) * (h - 70) * (0.4 + ((i * 13) % 40) / 60);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }),
      fog: false,
    }));
    face.position.z = 0.04;
    g.add(face);
    scene.add(g);
  }
  sideScreen(-6.55, "TELEMETRY", 0x6fd6f5);
  sideScreen(6.55, "TRACK", 0xd9b878);

  /* side stations: review wall / gate / comms */
  function stationPanel(cx: number, cz: number, rotY: number, title: string, sub: string, accent: number) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rotY;
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.55, 0.55), MAT.dark);
    body.position.y = 0.78;
    body.castShadow = true;
    g.add(body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({
      map: canvasTex(512, 256, (ctx, w, h) => {
        ctx.fillStyle = "#070b0e";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(140,225,250,.2)";
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.fillStyle = "#6fd6f5";
        ctx.font = `600 26px ${FONT_MONO}`;
        ctx.letterSpacing = "3px";
        ctx.fillText(title, 26, 58);
        ctx.letterSpacing = "0px";
        ctx.fillStyle = "rgba(219,232,238,.55)";
        ctx.font = `500 20px ${FONT_SANS}`;
        ctx.fillText(sub, 26, 102);
        ctx.fillStyle = "#8fe0bb";
        ctx.fillRect(26, 132, 120, 5);
        ctx.fillStyle = "#d9b878";
        ctx.fillRect(26, 148, 210, 5);
        ctx.fillStyle = "rgba(140,225,250,.16)";
        ctx.fillRect(26, 164, 300, 5);
      }),
      fog: false,
    }));
    face.position.set(0, 1.06, 0.283);
    g.add(face);
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.014, 0.014), MAT.emissive(accent, 0.8));
    led.position.set(0, 0.4, 0.29);
    g.add(led);
    scene.add(g);
    return g;
  }
  stationPanel(-7.25, -5.98, 0, "复盘墙 · REVIEW", "失败 / 返工 / 验收", 0x7d67d1);
  stationPanel(7.25, -5.98, 0, "发布闸门 · GATE", "GO / NO-GO · approval", 0xd9b878);

  /* chairs at all seats */
  function chairMesh() {
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.58, 0.08), MAT.chair);
    back.position.set(0, 0.78, 0.2);
    back.rotation.x = 0.06;
    g.add(back);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.02), new THREE.MeshStandardMaterial({ color: 0x0e1318, roughness: 0.9, metalness: 0.05 }));
    mesh.position.set(0, 0.8, 0.25);
    g.add(mesh);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.46), MAT.chair);
    seat.position.set(0, 0.44, 0);
    g.add(seat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 12), MAT.metal);
    stem.position.set(0, 0.26, 0);
    g.add(stem);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.024, 0.34), MAT.metal);
      arm.position.set(Math.sin(a) * 0.17, 0.09, Math.cos(a) * 0.17);
      arm.rotation.y = a;
      g.add(arm);
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), MAT.dark);
      wheel.position.set(Math.sin(a) * 0.33, 0.038, Math.cos(a) * 0.33);
      g.add(wheel);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    return g;
  }
  SEATS.forEach((s) => {
    const chair = chairMesh();
    chair.position.set(s.x, s.y, s.z);
    scene.add(chair);
  });
  const leadChair = chairMesh();
  leadChair.position.set(LEAD_SEAT.x, LEAD_SEAT.y, LEAD_SEAT.z);
  scene.add(leadChair);

  /* lights */
  const amb = new THREE.AmbientLight(0xbfd8e6, pal.amb);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0x9fd8f0, 0x0a0e12, pal.hemi);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xdff2ff, pal.key);
  key.position.set(3.5, 6.5, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -2;
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new THREE.DirectionalLight(pal.glow, 0.5);
  rim.position.set(-4, 3.4, 3);
  scene.add(rim);
  const screenLight = new THREE.PointLight(pal.glow, 1.1, 14, 2);
  screenLight.position.set(0, 2.6, VZ + 0.9);
  scene.add(screenLight);

  /* actors */
  const actors = new Map<string, ActorSlot>();
  const labelById = new Map<string, HTMLButtonElement>();

  /* 人：白色防静电工装 + 头戴耳机 + 工牌。
     按真人比例（身高 ~1.70）搭骨架：髋 / 膝 / 肩 / 肘四个关节，躯干用 Lathe 做轮廓，关节处补球避免断缝。 */
  const SKIN_MAT = new THREE.MeshStandardMaterial({ color: 0xdcb69c, roughness: 0.62, metalness: 0.01 });
  const EYE_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2422, roughness: 0.4, metalness: 0.1 });
  const HAIR_MATS = [0x241f1c, 0x2c2622, 0x1b1a1a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0.06 }));
  const SHOE_MAT = new THREE.MeshStandardMaterial({ color: 0x191d21, roughness: 0.5, metalness: 0.2 });
  const SOLE_MAT = new THREE.MeshStandardMaterial({ color: 0x0e1114, roughness: 0.85, metalness: 0.05 });
  const GEAR_MAT = new THREE.MeshStandardMaterial({ color: 0x1b232a, roughness: 0.4, metalness: 0.45 });
  const PAD_MAT = new THREE.MeshStandardMaterial({ color: 0x2b343d, roughness: 0.85, metalness: 0.05 });

  let actorSeq = 0;

  function createActor(actor: OfficeActor): ActorSlot {
    const variant = actorSeq++;
    const group = new THREE.Group();
    /* 个体差异：身高 ±2.5%、发型颜色 —— 一排人不会像复制粘贴 */
    group.scale.setScalar(0.975 + (variant % 4) * 0.017);
    const accent = TONE_HEX[actor.tone] ?? 0x8f9aa3;
    const accents: THREE.Mesh[] = [];
    const mark = (mesh: THREE.Mesh) => { accents.push(mesh); return mesh; };
    const suit = new THREE.MeshStandardMaterial({ color: 0xe2eaf1, roughness: 0.72, metalness: 0.03 });
    const suit2 = new THREE.MeshStandardMaterial({ color: 0xd3dde5, roughness: 0.74, metalness: 0.03 });
    const trouser = new THREE.MeshStandardMaterial({ color: 0xc2cedb, roughness: 0.8, metalness: 0.02 });
    const trouser2 = new THREE.MeshStandardMaterial({ color: 0xb6c3d1, roughness: 0.82, metalness: 0.02 });
    const hairMat = HAIR_MATS[variant % HAIR_MATS.length];
    const shadow = (m: THREE.Mesh) => { m.castShadow = true; return m; };
    const lathe = (pts: [number, number][], mat: THREE.Material, seg = 22) =>
      new THREE.Mesh(new THREE.LatheGeometry(pts.map(([y, r]) => new THREE.Vector2(r, y)), seg), mat);

    /* ---- 腿：髋 → 膝 → 踝（大腿小腿都是锥形，关节补球） ---- */
    const legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.083, 0.88, 0);
      const thigh = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.056, 0.40, 14), trouser));
      thigh.position.y = -0.21;
      hip.add(thigh);
      /* 大腿侧兜（贴在腿外侧，跟着腿一起摆） */
      const pkt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.062), trouser2);
      pkt.position.set(side * 0.062, -0.12, 0.004);
      hip.add(pkt);
      const hipCap = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), trouser);
      hipCap.scale.set(1, 0.9, 1);
      hip.add(hipCap);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.057, 12, 10), trouser);
      knee.add(kneeCap);
      const shin = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.042, 0.40, 14), trouser));
      shin.position.y = -0.215;
      knee.add(shin);
      /* 裤脚 + 工装反光条 */
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.049, 0.05, 12), trouser);
      cuff.position.y = -0.395;
      knee.add(cuff);
      const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.0505, 0.0505, 0.022, 12), new THREE.MeshStandardMaterial({ color: 0x9aa9b6, roughness: 0.35, metalness: 0.25 }));
      refl.position.y = -0.372;
      knee.add(refl);
      /* 鞋：鞋底 + 鞋面 + 圆鞋头 */
      const shoe = new THREE.Group();
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.026, 0.26), SOLE_MAT);
      sole.position.set(0, -0.445, 0.05);
      shoe.add(sole);
      const vamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.062, 0.19), SHOE_MAT);
      vamp.position.set(0, -0.404, 0.024);
      shoe.add(vamp);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.046, 14, 10), SHOE_MAT);
      toe.scale.set(1, 0.62, 0.95);
      toe.position.set(0, -0.408, 0.14);
      shoe.add(toe);
      knee.add(shoe);
      hip.add(knee);
      group.add(hip);
      return { hip, knee };
    });

    /* ---- 髋以上 ---- */
    const upper = new THREE.Group();
    group.add(upper);
    /* 胯 + 躯干（Lathe 轮廓再按椭圆压扁，才有胸腰差） */
    const pelvis = lathe([[-0.10, 0.098], [-0.04, 0.116], [0.04, 0.120], [0.10, 0.112]], trouser);
    pelvis.scale.set(1.14, 1, 0.84);
    upper.add(pelvis);
    const torso = shadow(lathe([
      [0.06, 0.110], [0.14, 0.116], [0.22, 0.110], [0.30, 0.120],
      [0.38, 0.137], [0.44, 0.142], [0.48, 0.134], [0.51, 0.110], [0.525, 0.072],
    ], suit));
    torso.scale.set(1.07, 1, 0.8);
    upper.add(torso);
    /* 肩：两个三角肌球把肩线撑出来 */
    [-1, 1].forEach((side) => {
      const delt = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 12), suit));
      delt.scale.set(1.1, 0.92, 0.94);
      delt.position.set(side * 0.132, 0.462, -0.004);
      upper.add(delt);
    });
    /* 腰带 + 前襟 + 胸袋 + 兜盖 */
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.03, 20), GEAR_MAT);
    belt.scale.set(1.13, 1, 0.84);
    belt.position.y = 0.062;
    upper.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.012), new THREE.MeshStandardMaterial({ color: 0x5c6a76, roughness: 0.35, metalness: 0.7 }));
    buckle.position.set(0, 0.062, 0.104);
    upper.add(buckle);
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.4, 0.012), GEAR_MAT);
    zip.position.set(0, 0.3, 0.116);
    upper.add(zip);
    [-1, 1].forEach((side) => {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.004, 0.04), suit2);
      flap.position.set(side * 0.056, 0.315, 0.112);
      upper.add(flap);
      const pocketBody = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.05, 0.004), suit2);
      pocketBody.position.set(side * 0.056, 0.285, 0.111);
      upper.add(pocketBody);
    });
    /* 领口 */
    const collar = lathe([[0.495, 0.088], [0.535, 0.072], [0.56, 0.062]], suit2);
    collar.scale.set(1.02, 1, 0.9);
    upper.add(collar);
    /* 肩章 + 工牌：tone 色 */
    const badge = mark(new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.034, 0.008), MAT.emissive(accent, 0.95)));
    badge.position.set(0.05, 0.4, 0.114);
    upper.add(badge);
    const lanyard = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.13, 0.007), GEAR_MAT);
    lanyard.position.set(0.05, 0.475, 0.118);
    lanyard.rotation.z = -0.2;
    upper.add(lanyard);

    /* ---- 颈 + 头 ---- */
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.1, 12), SKIN_MAT);
    neck.position.y = 0.555;
    upper.add(neck);
    const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.082, 20, 18), SKIN_MAT));
    head.scale.set(0.98, 1.1, 1.02);
    head.position.y = 0.695;
    upper.add(head);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 14), SKIN_MAT);
    jaw.scale.set(0.94, 0.84, 0.95);
    jaw.position.set(0, 0.662, 0.015);
    upper.add(jaw);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.028, 8), SKIN_MAT);
    nose.rotation.x = Math.PI / 2 + 0.3;
    nose.position.set(0, 0.691, 0.077);
    upper.add(nose);
    [-1, 1].forEach((side) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), SKIN_MAT);
      ear.scale.set(0.42, 1, 0.78);
      ear.position.set(side * 0.078, 0.69, 0.0);
      upper.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 8, 8), EYE_MAT);
      eye.scale.set(1, 0.66, 0.5);
      eye.position.set(side * 0.028, 0.705, 0.073);
      upper.add(eye);
    });
    /* 头发：顶部一层 + 后脑一片，正面留出发际线 */
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.0855, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
    hairTop.scale.set(0.99, 1.08, 1.02);
    hairTop.position.y = 0.702;
    hairTop.rotation.x = -0.12;
    upper.add(hairTop);
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.084, 18, 14), hairMat);
    hairBack.scale.set(0.98, 1.0, 0.86);
    hairBack.position.set(0, 0.691, -0.013);
    upper.add(hairBack);
    /* 耳机：头梁 + 耳罩 + 耳垫 + 通话杆 */
    const headBand = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 8, 22, Math.PI * 0.94), GEAR_MAT);
    headBand.rotation.z = -0.06;
    headBand.position.set(0, 0.696, 0.004);
    upper.add(headBand);
    [-1, 1].forEach((side) => {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.026, 14), GEAR_MAT);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.081, 0.683, 0.004);
      upper.add(cup);
      const pad = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 14), PAD_MAT);
      pad.rotation.y = Math.PI / 2;
      pad.position.set(side * 0.09, 0.683, 0.004);
      upper.add(pad);
      const ring = mark(new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0045, 6, 16), MAT.emissive(accent, 1.0)));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(side * 0.095, 0.683, 0.004);
      upper.add(ring);
    });
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.0035, 0.115, 6), GEAR_MAT);
    boom.position.set(0.05, 0.65, 0.05);
    boom.rotation.set(-0.5, 0, 0.62);
    upper.add(boom);
    const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 8, 8), PAD_MAT);
    micTip.position.set(0.015, 0.63, 0.09);
    upper.add(micTip);

    /* ---- 手臂：肩 → 肘 → 腕 → 手 ---- */
    const arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.158, 0.468, -0.004);
      shoulder.rotation.z = side * -0.14;
      const upperArm = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.039, 0.28, 12), suit));
      upperArm.position.y = -0.145;
      shoulder.add(upperArm);
      const armBand = mark(new THREE.Mesh(new THREE.CylinderGeometry(0.0455, 0.0455, 0.03, 14), MAT.emissive(accent, 0.85)));
      armBand.position.y = -0.225;
      shoulder.add(armBand);
      const elbow = new THREE.Group();
      elbow.position.y = -0.285;
      const elbowCap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), suit);
      elbow.add(elbowCap);
      const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.030, 0.25, 12), suit);
      foreArm.position.y = -0.13;
      elbow.add(foreArm);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, 0.026, 12), suit2);
      cuff.position.y = -0.255;
      elbow.add(cuff);
      const hand = new THREE.Group();
      hand.position.y = -0.29;
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.07, 0.024), SKIN_MAT);
      palm.position.y = -0.028;
      hand.add(palm);
      const finger = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), SKIN_MAT);
      finger.scale.set(0.9, 1.0, 0.55);
      finger.position.y = -0.07;
      hand.add(finger);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.028, 4, 8), SKIN_MAT);
      thumb.rotation.z = side * 0.9;
      thumb.position.set(side * -0.026, -0.028, 0.006);
      hand.add(thumb);
      elbow.add(hand);
      shoulder.add(elbow);
      upper.add(shoulder);
      return { shoulder, elbow };
    });

    group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    scene.add(group);

    const label = doc.createElement("button");
    label.type = "button";
    label.className = "war3d-label";
    label.addEventListener("click", () => onSelect(actor.id));
    labelLayer.appendChild(label);
    labelById.set(actor.id, label);

    const slot: ActorSlot = {
      group, upper, legs, arms, accents, label,
      current: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0, 0, 0),
      standing: false,
      accent,
      tone: actor.tone,
    };
    const t = targetOf(actor, 0);
    group.position.set(t.x, t.y, t.z);
    group.rotation.y = t.ry;
    slot.current.set(t.x, t.y, t.z);
    slot.target.set(t.x, t.y, t.z);
    applyPose(slot, t.standing);
    return slot;
  }

  /* 站 / 坐：髋高、髋膝角、肩肘角一起换；坐姿手落到台面上 */
  function applyPose(slot: ActorSlot, standing: boolean) {
    slot.standing = standing;
    if (standing) {
      for (const leg of slot.legs) { leg.hip.position.y = 0.88; leg.hip.rotation.x = 0; leg.knee.rotation.x = 0; }
      slot.upper.position.y = 0.88;
      slot.upper.rotation.x = 0;
      for (const arm of slot.arms) { arm.shoulder.rotation.x = 0; arm.elbow.rotation.x = -0.1; }
    } else {
      /* 坐姿：髋落到椅面，大腿前伸、小腿垂下；上身略前倾，手放到台面键盘上 */
      for (const leg of slot.legs) { leg.hip.position.y = 0.50; leg.hip.rotation.x = -Math.PI / 2; leg.knee.rotation.x = Math.PI / 2; }
      slot.upper.position.y = 0.50;
      slot.upper.rotation.x = -0.07;
      /* 打字姿势：上臂几乎垂下（肘落到台面高度），小臂水平前伸 */
      for (const arm of slot.arms) { arm.shoulder.rotation.x = -0.22; arm.elbow.rotation.x = -1.32; }
    }
  }

  function updateActor(slot: ActorSlot, actor: OfficeActor, index: number) {
    const t = targetOf(actor, index);
    slot.target.set(t.x, t.y, t.z);
    applyPose(slot, t.standing);
    slot.group.rotation.y += (t.ry - slot.group.rotation.y) * 0.18;
    const color = TONE_HEX[actor.tone] ?? 0x8f9aa3;
    if (color !== slot.accent) {
      slot.accent = color;
      for (const mesh of slot.accents) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.color.setHex(color);
        m.emissive.setHex(color);
      }
    }
    slot.tone = actor.tone;
    slot.label.dataset.tone = actor.tone;
    slot.label.innerHTML = `<i></i><b>${escapeHtml(actor.displayName)}</b><em>${escapeHtml(actor.statusLabel)}</em>`;
    slot.label.title = `${actor.displayName} · ${ZONE_LABEL[actor.zone]} · ${actor.statusLabel}`;
    slot.label.classList.toggle("sel", getSelected() === actor.id);
  }

  function syncActors() {
    const model = getModel();
    const seen = new Set<string>();
    model.actors.forEach((actor, index) => {
      seen.add(actor.id);
      let slot = actors.get(actor.id);
      if (!slot) {
        slot = createActor(actor);
        actors.set(actor.id, slot);
      }
      updateActor(slot, actor, index);
    });
    for (const [id, slot] of actors) {
      if (seen.has(id)) continue;
      scene.remove(slot.group);
      slot.label.remove();
      actors.delete(id);
      labelById.delete(id);
    }
  }

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  }

  function refreshHud() {
    paintHud();
    /* 三种小屏纹理各画一次，再分给所有同类型显示器 */
    const texs = { a: monitorTexture("a"), b: monitorTexture("b"), c: monitorTexture("c") };
    for (const { mesh, kind } of monFaces) {
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.map = texs[kind];
      m.needsUpdate = true;
    }
  }

  /* interaction */
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
    view.pitch = Math.max(-0.22, Math.min(0.6, view.pitch + (e.clientY - drag.y) * 0.0035));
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) { drag = null; canvas.style.cursor = ""; }
  };
  const onDoubleClick = () => {
    pointer.tx = 0;
    pointer.ty = 0;
    resetOrbit();
    view.key = "overview";
    onViewChange?.("overview");
  };
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("dblclick", onDoubleClick);

  function resize() {
    const w = Math.max(2, host.clientWidth);
    const h = Math.max(2, host.clientHeight);
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    const bw = Math.max(2, Math.floor(w * pr));
    const bh = Math.max(2, Math.floor(h * pr));
    rtScene.setSize(bw, bh);
    rtA.setSize(Math.max(2, Math.floor(bw / 2)), Math.max(2, Math.floor(bh / 2)));
    rtB.setSize(Math.max(2, Math.floor(bw / 2)), Math.max(2, Math.floor(bh / 2)));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new THREE.Clock();
  let t = 0;
  let rafId = 0;
  let disposed = false;

  function projectLabels() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const v = new THREE.Vector3();
    for (const [id, slot] of actors) {
      const label = labelById.get(id);
      if (!label) continue;
      v.set(slot.group.position.x, slot.group.position.y + (slot.standing ? 1.86 : 1.48), slot.group.position.z);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const visible = v.z < 1 && x > -80 && x < w + 80 && y > -40 && y < h + 40;
      /* 桌边近排的姓名牌挂在下颌，远排挂在头顶；两侧站位向左 / 右展开，减少互相压 */
      const near = slot.group.position.z > 0.5;
      const anchorX = slot.group.position.x < -2.2 ? "-100%" : slot.group.position.x > 2.2 ? "0%" : "-50%";
      const anchorY = near ? "0%" : "-100%";
      label.style.transform = `translate(${x}px, ${y + (near ? 10 : -2)}px) translate(${anchorX}, ${anchorY})`;
      label.style.opacity = visible ? "1" : "0";
      label.style.pointerEvents = visible ? "auto" : "none";
    }
  }

  function tick() {
    if (disposed) return;
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const anim = motion.tier !== "off" && !motion.reduced;
    if (anim) t += dt;
    if (anim && launch) tLaunch += dt;
    if (anim) {
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
    } else {
      pointer.x = 0;
      pointer.y = 0;
      view.yaw = 0;
      view.pitch = 0;
      view.zoom = 1;
    }
    /* 机位 = 预设 + 拖动的环绕角（绕预设 look 点转），再叠一点指针视差 */
    const preset = VIEWS[view.key] ?? VIEWS.overview;
    const offX = preset.pos[0] - preset.look[0];
    const offY = preset.pos[1] - preset.look[1];
    const offZ = preset.pos[2] - preset.look[2];
    const baseR = Math.hypot(offX, offY, offZ) || 1;
    const orbitYaw = Math.atan2(offX, offZ) + view.yaw + pointer.x * 0.05;
    const orbitPitch = Math.max(-0.3, Math.min(1.3, Math.asin(offY / baseR) + view.pitch - pointer.y * 0.02));
    const orbitR = baseR * view.zoom;
    const cosPitch = Math.cos(orbitPitch);
    camera.position.set(
      preset.look[0] + Math.sin(orbitYaw) * cosPitch * orbitR,
      preset.look[1] + Math.sin(orbitPitch) * orbitR,
      preset.look[2] + Math.cos(orbitYaw) * cosPitch * orbitR,
    );
    camTarget.set(preset.look[0], preset.look[1], preset.look[2]);
    camera.fov = preset.fov;
    camera.updateProjectionMatrix();
    const lz = launchPhase();
    const lifting = lz.phase === "liftoff";
    /* 点火瞬间抖一下镜头 */
    if (lifting && lz.lift < 0.25) {
      const k = (1 - lz.lift / 0.25) * 0.05;
      camera.position.x += Math.sin(tLaunch * 90) * k;
      camera.position.y += Math.cos(tLaunch * 78) * k;
    }
    camera.lookAt(camTarget);
    /* 点火：大屏方向打一束暖光，扫过桌面和席位 */
    launchLight.intensity = lz.flame * (lifting ? 4.2 : 1.3);
    launchLight.position.y = 2.3 + lz.flame * 0.3;
    /* 倒计时警示灯 */
    const blink = lz.phase === "countdown" ? (Math.sin(t * 12) > 0 ? 1 : 0.1) : lifting ? 1 : 0.22;
    beacons.forEach((b, i) => {
      const m = b.material as THREE.MeshStandardMaterial;
      const color = lifting ? 0xffd9b0 : lz.phase === "countdown" ? 0xd0584e : 0x2f9fc4;
      m.emissive.setHex(color);
      m.emissiveIntensity = (lifting ? 2.2 : 1.1) * blink * (0.85 + 0.15 * Math.sin(t * 2 + i));
    });
    /* 大屏在演出期间按 ~8fps 重画（其余时间只跟 model 变） */
    if (launch) {
      if (t - lastHudPaint > 0.12) { lastHudPaint = t; hudDirty = true; }
      if (lz.phase === "reset") { launch = null; hudDirty = true; }
    }
    if (hudDirty) { hudDirty = false; paintHud(); }
    const speed = anim ? Math.min(1, dt * (1000 / Math.max(300, motion.walk)) * 1.6) : 1;
    for (const slot of actors.values()) {
      slot.current.lerp(slot.target, speed);
      slot.group.position.set(slot.current.x, slot.current.y, slot.current.z);
    }
    renderPost();
    projectLabels();
  }

  function applyTheme(next: Theme) {
    if (next === theme) return;
    theme = next;
    pal = PAL[theme];
    scene.background = new THREE.Color(pal.bg);
    (scene.fog as THREE.Fog).color = new THREE.Color(pal.fog);
    MAT.wall.color.setHex(pal.wall);
    MAT.wall2.color.setHex(pal.wall2);
    MAT.floor.color.setHex(pal.floor);
    MAT.ceil.color.setHex(pal.ceil);
    MAT.metal.color.setHex(pal.metal);
    amb.intensity = pal.amb;
    hemi.intensity = pal.hemi;
    key.intensity = pal.key;
    rim.color.setHex(pal.glow);
    (base.material as THREE.MeshStandardMaterial).color.setHex(pal.glow);
    (base.material as THREE.MeshStandardMaterial).emissive.setHex(pal.glow);
    (reflLed.material as THREE.MeshBasicMaterial).color.setHex(pal.glow);
    (stripMat as THREE.MeshBasicMaterial).opacity = theme === "light" ? 0.62 : 0.5;
    (pool.material as THREE.MeshBasicMaterial).opacity = theme === "light" ? 0.4 : 0.55;
    refreshHud();
  }

  syncActors();
  refreshHud();
  tick();

  return {
    launch() {
      if (disposed) return;
      if (motion.tier === "off" || motion.reduced) return;
      if (launch) return;
      launch = { start: tLaunch };
      hudDirty = true;
    },
    update() {
      if (disposed) return;
      const model = getModel();
      syncActors();
      refreshHud();
      // keep selected highlight
      for (const [id, slot] of actors) slot.label.classList.toggle("sel", getSelected() === id);
      if (!model.actors.length) labelLayer.style.display = "none";
      else labelLayer.style.display = "";
    },
    setSelected() {
      for (const [id, slot] of actors) slot.label.classList.toggle("sel", getSelected() === id);
    },
    setTheme(next) {
      applyTheme(next);
    },
    setMotion(tier, reduced, walk) {
      motion = { tier, reduced, walk };
    },
    setView(next) {
      if (disposed) return;
      if (!VIEWS[next]) return;
      if (view.key === next) return;
      view.key = next;
      resetOrbit();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("dblclick", onDoubleClick);
      for (const slot of actors.values()) slot.label.remove();
      actors.clear();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      pmrem.dispose();
      rtScene.dispose();
      rtA.dispose();
      rtB.dispose();
      host.innerHTML = "";
    },
  };
}
