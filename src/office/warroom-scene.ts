import * as THREE from "three";
import type { OfficeActor, OfficeModel, OfficeTone, OfficeZone } from "./model";
import { ZONE_LABEL } from "./motion";

/**
 * 作战室 · three.js 3D 舞台
 * 移植自 docs/prototype/warroom-3d.html（Three.js r149，MIT），并接上真实 OfficeModel：
 * - 长桌 / 主屏 / 复盘墙 / 发布闸门 / 通讯位对应真实 zone
 * - 角色位置、颜色、姓名牌来自 run / todo 的 tone / status，舞台不新增状态
 * - 文字留在 DOM / CanvasTexture，不用 WebGL 画字
 */

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

interface ActorSlot {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  band: THREE.Mesh;
  visor: THREE.Mesh;
  label: HTMLButtonElement;
  current: THREE.Vector3;
  target: THREE.Vector3;
  standing: boolean;
  accent: number;
  tone: OfficeTone;
}

export interface WarRoom3DApi {
  update: () => void;
  setSelected: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  setMotion: (tier: MotionTier, reduced: boolean, walk: number) => void;
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

/* 站位：桌边 6 席 + 主控桌头 + 5 个功能位；都写死在这一个文件里，方便和 3D 房间对齐 */
const SEATS: { x: number; z: number; far?: boolean }[] = [
  { x: -3.0, z: -1.9, far: true },
  { x: 0, z: -2.05, far: true },
  { x: 3.0, z: -1.9, far: true },
  { x: -2.9, z: 1.35 },
  { x: 0, z: 1.5 },
  { x: 2.9, z: 1.35 },
];
const LEAD_SEAT = { x: -4.95, z: 0.35 };
const STATION: Record<Exclude<OfficeZone, "desk" | "lead">, { x: number; z: number; standing: boolean }> = {
  review: { x: -6.3, z: -4.2, standing: true },
  approval: { x: 6.3, z: -4.2, standing: true },
  meeting: { x: 0, z: -4.9, standing: true },
  tea: { x: -6.4, z: 3.2, standing: true },
  standby: { x: 6.4, z: 3.2, standing: true },
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

function targetOf(actor: OfficeActor, index: number): { x: number; z: number; standing: boolean } {
  if (actor.zone === "lead") return { x: LEAD_SEAT.x, z: LEAD_SEAT.z, standing: false };
  if (actor.zone === "desk") {
    const seat = actor.seat ?? index;
    const s = SEATS[((seat % SEATS.length) + SEATS.length) % SEATS.length];
    return { x: s.x, z: s.z, standing: false };
  }
  return STATION[actor.zone] ?? STATION.standby;
}

export function mountWarRoom3D(options: MountOptions): WarRoom3DApi {
  const { host, getModel, getSelected, getNow, getMotion, getTheme, onSelect } = options;
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
  camera.position.set(0, 3.05, 12.2);
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

  function drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const model = getModel();
    const P = pal;
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

    const mono = (s: number) => `${s}px ${FONT_MONO}`;
    const sans = (s: number, weight = 500) => `${weight} ${s}px ${FONT_SANS}`;
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

    ctx.fillStyle = P.glowCss;
    ctx.font = `600 ${mono(24)}`;
    ctx.letterSpacing = "5px";
    ctx.fillText("MISSION CONTROL", M, 52);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = P.ink;
    ctx.font = `600 ${sans(38)}`;
    ctx.fillText(board.title || "今日值班", M + 330, 52);
    ctx.fillStyle = P.amber;
    ctx.font = `600 ${mono(22)}`;
    ctx.letterSpacing = "2px";
    ctx.strokeStyle = "rgba(217,184,120,.42)";
    ctx.lineWidth = 2;
    ctx.strokeRect(M + 590, 30, 110, 44);
    ctx.fillText(board.key || "MISSION", M + 602, 52);
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

    ctx.fillStyle = P.ink3;
    ctx.font = `600 ${mono(20)}`;
    ctx.letterSpacing = "4px";
    ctx.fillText("值班步骤", M, 116);
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
      ctx.fillText(row.title.slice(0, 18), M + 50, sy);
      ctx.fillStyle = P.ink3;
      ctx.font = `500 ${mono(20)}`;
      ctx.textAlign = "right";
      ctx.fillText(row.key, M + 500, sy);
      ctx.textAlign = "left";
      sy += 62;
    });

    const rx = w - M - 400;
    ctx.fillStyle = P.ink3;
    ctx.font = `600 ${mono(20)}`;
    ctx.letterSpacing = "4px";
    ctx.textAlign = "right";
    ctx.fillText("实时指标", w - M, 116);
    ctx.letterSpacing = "0px";
    ctx.textAlign = "left";
    const metrics: [string, number, string, string][] = [
      ["运行中", running, "", "green"],
      ["待确认", waiting, "", "amber"],
      ["待验收", review, "", "purple"],
      ["失败", failed, "", "red"],
    ];
    metrics.forEach(([k, v, , tone], i) => {
      const bx = rx + (i % 2) * 210;
      const by = 150 + Math.floor(i / 2) * 104;
      ctx.strokeStyle = "rgba(140,225,250,.18)";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, 190, 90);
      ctx.fillStyle = "rgba(140,225,250,.04)";
      ctx.fillRect(bx, by, 190, 90);
      ctx.fillStyle = P.ink2;
      ctx.font = `500 ${sans(18)}`;
      ctx.fillText(k, bx + 14, by + 26);
      ctx.fillStyle = P[tone as "green" | "amber" | "purple" | "red"];
      ctx.font = `600 ${mono(40)}`;
      ctx.fillText(String(v), bx + 14, by + 64);
    });

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

  const hudTex = canvasTex(2048, 768, drawHUD);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ map: hudTex, fog: false }));
  screen.position.z = 0.09;
  wall.add(screen);

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

  /* globe */
  const globeGroup = new THREE.Group();
  globeGroup.position.set(0, 2.85, VZ + 0.5);
  scene.add(globeGroup);
  const globeMat = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: new THREE.Color(0x2b8fb0) },
      uNight: { value: new THREE.Color(0x04141c) },
      uGlow: { value: new THREE.Color(pal.glow) },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uDay; uniform vec3 uNight; uniform vec3 uGlow; uniform float uTime; varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y); }
      float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        vec3 n=normalize(vN); vec3 L=normalize(vec3(-0.55,0.45,0.62)); float d=dot(n,L);
        float lit=smoothstep(-0.35,0.55,d);
        float land=smoothstep(0.52,0.62,fbm(vec2(vUv.x*7.0,vUv.y*4.0)+3.0));
        vec3 base=mix(uNight,uDay,lit); base=mix(base,uGlow*0.85,land*lit*0.55);
        vec2 g=abs(fract(vUv*vec2(36.0,18.0))-0.5); float grid=smoothstep(0.455,0.5,max(g.x,g.y));
        base+=uGlow*grid*(0.10+0.18*lit); base+=uGlow*0.10*smoothstep(0.14,0.0,abs(d));
        vec3 V=normalize(-vP); float f=pow(1.0-abs(dot(n,V)),2.4); base+=uGlow*f*0.55;
        gl_FragColor=vec4(base,1.0);
      }`,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.88, 64, 64), globeMat);
  globeGroup.add(globe);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: new THREE.Color(pal.glow) } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vP=mv.xyz; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uGlow; varying vec3 vN; varying vec3 vP; void main(){ vec3 V=normalize(-vP); float f=pow(1.0-abs(dot(normalize(vN),V)),2.2); gl_FragColor=vec4(uGlow,f*0.55); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  });
  globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.97, 48, 48), atmoMat));
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.005, 8, 160), new THREE.MeshBasicMaterial({ color: pal.glow, transparent: true, opacity: 0.45 }));
  orbit.rotation.set(-Math.PI / 2 + 0.35, 0, 0.32);
  globeGroup.add(orbit);
  const sats = [0, 2.2, 4.1].map((a) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 12), new THREE.MeshBasicMaterial({ color: pal.glow }));
    s.userData.a = a;
    globeGroup.add(s);
    return s;
  });

  /* desk */
  const desk = new THREE.Group();
  scene.add(desk);
  const DW = 8.6, DD = 1.5, DY = 0.78;
  desk.position.set(0, 0, -0.3);
  const top = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.08, DD), MAT.dark);
  top.position.y = DY;
  top.castShadow = true;
  top.receiveShadow = true;
  desk.add(top);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.56, 0.08), new THREE.MeshStandardMaterial({ color: 0x0d1216, roughness: 0.5, metalness: 0.55 }));
  apron.position.set(0, DY - 0.33, DD / 2 - 0.04);
  desk.add(apron);
  const led = new THREE.Mesh(new THREE.BoxGeometry(DW - 0.1, 0.016, 0.016), MAT.emissive(pal.glow, 0.55));
  led.position.set(0, DY - 0.05, DD / 2 - 0.005);
  desk.add(led);
  const deskGlow = new THREE.Mesh(new THREE.PlaneGeometry(DW + 1, 1.4), new THREE.MeshBasicMaterial({
    map: softGlow, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  deskGlow.rotation.x = -Math.PI / 2;
  deskGlow.position.set(0, 0.014, DD / 2 + 0.55);
  desk.add(deskGlow);
  [-DW / 2 + 0.6, DW / 2 - 0.6].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, DY - 0.1, 0.12), MAT.metal);
    leg.position.set(x, (DY - 0.1) / 2, -DD / 2 + 0.2);
    desk.add(leg);
    const leg2 = leg.clone();
    leg2.position.z = DD / 2 - 0.2;
    desk.add(leg2);
  });
  const bevel = new THREE.Mesh(new THREE.BoxGeometry(DW + 0.05, 0.025, DD + 0.05), MAT.metal);
  bevel.position.y = DY - 0.055;
  desk.add(bevel);
  [-1, 1].forEach((s) => {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, DD + 0.02), MAT.metal);
    cheek.position.set(s * (DW / 2 - 0.02), DY - 0.3, 0);
    desk.add(cheek);
  });
  const tray = new THREE.Mesh(new THREE.BoxGeometry(DW - 1.2, 0.09, 0.28), new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.8, metalness: 0.3 }));
  tray.position.set(0, DY - 0.42, -DD / 2 + 0.3);
  desk.add(tray);

  const kbTex = canvasTex(256, 96, (ctx, w, h) => {
    ctx.fillStyle = "#10161b";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2b343d";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) ctx.fillRect(6 + c * 16.4, 8 + r * 15.6, 13.6, 12.4);
    ctx.fillStyle = "#39434d";
    ctx.fillRect(52, 8 + 4 * 15.6, 150, 12.4);
  });
  [-2.5, 0, 2.5].forEach((x) => {
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), new THREE.MeshBasicMaterial({ map: kbTex, fog: false }));
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(x, DY + 0.045, 0.3);
    desk.add(kb);
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), MAT.dark);
    mouse.scale.set(1, 0.55, 1.4);
    mouse.position.set(x + 0.42, DY + 0.05, 0.3);
    desk.add(mouse);
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
          const bh = 26 + Math.abs(Math.sin(i * 1.3)) * 120;
          ctx.fillStyle = "rgba(140,225,250,.35)";
          ctx.fillRect(24 + i * 56, h - 36 - bh, 36, bh);
        }
      }
      if (kind === "c") {
        ctx.strokeStyle = "rgba(140,225,250,.2)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(w - 84, h / 2 + 6, 48, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = pal.glowCss;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(w - 84, h / 2 + 6, 48, -Math.PI * 0.5, Math.PI * 0.45);
        ctx.stroke();
        ctx.fillStyle = P.ink;
        ctx.font = `600 30px ${FONT_MONO}`;
        ctx.fillText(`${model.actors.filter((a) => a.tone === "review").length}`, 24, 120);
        ctx.fillStyle = P.ink3;
        ctx.font = `500 13px ${FONT_MONO}`;
        ctx.fillText("REVIEW QUEUE", 24, 150);
      }
    });
  }
  const monMats = [monitorTexture("a"), monitorTexture("b"), monitorTexture("c")];
  const monFaces: THREE.Mesh[] = [];
  [-2.4, 0, 2.4].forEach((x, i) => {
    const g = new THREE.Group();
    g.position.set(x, DY + 0.27, -0.28);
    g.rotation.x = -0.08;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.56, 0.05), MAT.metal);
    bezel.castShadow = true;
    g.add(bezel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.47), new THREE.MeshBasicMaterial({ map: monMats[i], fog: false }));
    face.position.z = 0.03;
    g.add(face);
    monFaces.push(face);
    desk.add(g);
  });

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
    chair.position.set(s.x, 0, s.z);
    chair.rotation.y = s.far ? Math.PI : 0;
    scene.add(chair);
  });
  const leadChair = chairMesh();
  leadChair.position.set(LEAD_SEAT.x, 0, LEAD_SEAT.z);
  leadChair.rotation.y = Math.PI / 2;
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

  function createActor(actor: OfficeActor): ActorSlot {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.2, 8, 16), MAT.body);
    body.position.set(0, 0.92, 0);
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 20), new THREE.MeshStandardMaterial({ color: 0xd6e1ea, roughness: 0.45, metalness: 0.08 }));
    head.position.set(0, 1.2, 0);
    head.castShadow = true;
    group.add(head);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.19), new THREE.MeshStandardMaterial({ color: 0x8f9eab, roughness: 0.55, metalness: 0.15 }));
    sh.position.set(0, 1.03, 0);
    group.add(sh);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 20), MAT.metal);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 1.04, 0);
    group.add(collar);
    const hs = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.011, 6, 20, Math.PI * 1.15), MAT.metal);
    hs.rotation.set(Math.PI / 2, 0, Math.PI * 0.42);
    hs.position.set(0, 1.21, 0);
    group.add(hs);
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), MAT.metal);
    mic.rotation.z = 0.5;
    mic.position.set(0.11, 1.14, 0.02);
    group.add(mic);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.09), new THREE.MeshStandardMaterial({ color: 0x1d252d, roughness: 0.6, metalness: 0.25 }));
    pack.position.set(0, 0.94, 0.14);
    group.add(pack);
    const accent = TONE_HEX[actor.tone] ?? 0x8f9aa3;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.01), MAT.emissive(accent, 0.9));
    band.position.set(0, 1.02, 0.19);
    group.add(band);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.018), MAT.emissive(accent, 1.1));
    visor.position.set(0, 0.005, 0.128);
    head.add(visor);
    // accent shoulder stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.01), MAT.emissive(accent, 0.7));
    stripe.position.set(0, 0.82, 0.19);
    group.add(stripe);
    scene.add(group);

    const label = doc.createElement("button");
    label.type = "button";
    label.className = "war3d-label";
    label.addEventListener("click", () => onSelect(actor.id));
    labelLayer.appendChild(label);
    labelById.set(actor.id, label);

    const slot: ActorSlot = {
      group, body, head, band, visor, label,
      current: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0, 0, 0),
      standing: false,
      accent,
      tone: actor.tone,
    };
    const t = targetOf(actor, 0);
    group.position.set(t.x, 0, t.z);
    slot.current.set(t.x, 0, t.z);
    slot.target.set(t.x, 0, t.z);
    applyPose(slot, t.standing);
    return slot;
  }

  function applyPose(slot: ActorSlot, standing: boolean) {
    slot.standing = standing;
    slot.body.position.y = standing ? 1.16 : 0.92;
    slot.body.scale.y = standing ? 1.7 : 1;
    slot.head.position.y = standing ? 1.55 : 1.2;
  }

  function updateActor(slot: ActorSlot, actor: OfficeActor, index: number) {
    const t = targetOf(actor, index);
    slot.target.set(t.x, 0, t.z);
    applyPose(slot, t.standing);
    const color = TONE_HEX[actor.tone] ?? 0x8f9aa3;
    if (color !== slot.accent) {
      slot.accent = color;
      (slot.band.material as THREE.MeshStandardMaterial).color.setHex(color);
      (slot.band.material as THREE.MeshStandardMaterial).emissive.setHex(color);
      (slot.visor.material as THREE.MeshStandardMaterial).color.setHex(color);
      (slot.visor.material as THREE.MeshStandardMaterial).emissive.setHex(color);
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
    const next = canvasTex(2048, 768, drawHUD);
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = next;
    mat.needsUpdate = true;
    const reflMat = reflScreen.material as THREE.MeshBasicMaterial;
    reflMat.map?.dispose();
    reflMat.map = next;
    reflMat.needsUpdate = true;
    ["a", "b", "c"].forEach((k, i) => {
      const face = monFaces[i];
      if (!face) return;
      const tex = monitorTexture(k as "a" | "b" | "c");
      const m = face.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.map = tex;
      m.needsUpdate = true;
    });
  }

  /* interaction */
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
      v.set(slot.group.position.x, slot.standing ? 1.85 : 1.5, slot.group.position.z);
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
    if (anim) {
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      camera.position.x = pointer.x * 0.6;
      camera.position.y = 3.05 - pointer.y * 0.22;
    } else {
      pointer.x = 0;
      pointer.y = 0;
      camera.position.set(0, 3.05, 12.2);
    }
    camera.lookAt(camTarget);
    globe.rotation.y = t * 0.08;
    (globeMat.uniforms.uTime as { value: number }).value = t;
    orbit.rotation.z = 0.32 + t * 0.05;
    sats.forEach((s) => {
      const a = (s.userData.a as number) + t * 0.24;
      const r = 1.24, inc = 0.35;
      s.position.set(Math.cos(a) * r, Math.sin(a) * r * Math.sin(inc), Math.sin(a) * r * Math.cos(inc));
    });
    const speed = anim ? Math.min(1, dt * (1000 / Math.max(300, motion.walk)) * 1.6) : 1;
    for (const slot of actors.values()) {
      slot.current.lerp(slot.target, speed);
      slot.group.position.x = slot.current.x;
      slot.group.position.z = slot.current.z;
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
    (globeMat.uniforms.uGlow.value as THREE.Color).setHex(pal.glow);
    (atmoMat.uniforms.uGlow.value as THREE.Color).setHex(pal.glow);
    (base.material as THREE.MeshStandardMaterial).color.setHex(pal.glow);
    (base.material as THREE.MeshStandardMaterial).emissive.setHex(pal.glow);
    (led.material as THREE.MeshStandardMaterial).color.setHex(pal.glow);
    (led.material as THREE.MeshStandardMaterial).emissive.setHex(pal.glow);
    (reflLed.material as THREE.MeshBasicMaterial).color.setHex(pal.glow);
    (stripMat as THREE.MeshBasicMaterial).opacity = theme === "light" ? 0.62 : 0.5;
    (pool.material as THREE.MeshBasicMaterial).opacity = theme === "light" ? 0.4 : 0.55;
    (deskGlow.material as THREE.MeshBasicMaterial).opacity = theme === "light" ? 0.38 : 0.5;
    refreshHud();
  }

  syncActors();
  refreshHud();
  tick();

  return {
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
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
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
