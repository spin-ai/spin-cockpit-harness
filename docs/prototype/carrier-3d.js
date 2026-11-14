/* 福建舰 · 3D 仿真舞台
 * three.js 本地 vendor（MIT），无构建；所有几何/材质/贴图在运行时生成。
 */
(function () {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const params = new URLSearchParams(location.search);
  const DEBUG_CAM = params.get("cam") || "";
  const stageEl = $("#stage");
  const canvas = $("#scene");
  const hotspotsEl = $("#hotspots");
  const inspector = $("#inspector");
  const sunFlareEl = $("#sunFlare");
  const state = {
    mode: params.get("mode") === "config" ? "config" : "live",
    detail: params.get("detail") === "1",
    selected: params.get("select") || null,
    seq: Number(params.get("seq") || -1),
    motion: "calm",
    theme: params.get("theme") === "dark" ? "dark" : "light",
  };
  document.documentElement.dataset.theme = state.theme;

  const SHIP_YAW = -0.42;
  const DECK = [
    [0, 46], [4, 44.6], [7, 41.5], [9.5, 35], [10.8, 27], [11, 20],
    [11, -42], [6, -46], [-6, -46], [-12, -44.5], [-12, -30],
    [-18, -24], [-17, -8], [-12, 0], [-11, 22], [-7, 38],
  ];

  const PLANES = [
    { id: "lin", name: "林", kind: "j35", tone: "run", stateLabel: "已对位", task: "T-014 登录页校验", x: -4.2, z: 25, rot: 0, accent: 0x3f9a86 },
    { id: "zhou", name: "周", kind: "j15", tone: "run", stateLabel: "弹射中", task: "T-015 工作台空态", x: 2.2, z: 24, rot: 0, accent: 0x5b6cc0, launching: true },
    { id: "an", name: "安", kind: "j35", tone: "fail", stateLabel: "复飞", task: "T-011 npm test 退出码 1", x: -11.4, z: -10, rot: -0.32, accent: 0xb46a3c },
    { id: "qiao", name: "乔", kind: "j15", tone: "review", stateLabel: "已拦阻", task: "T-009 工作台空态验收", x: -9.4, z: -32, rot: -0.24, accent: 0x7d67d1 },
    { id: "bei", name: "北", kind: "j35", tone: "wait", stateLabel: "等放行", task: "T-013 数据迁移 · 等审批", x: 6.4, z: -20, rot: -0.1, accent: 0xa97a2f },
    { id: "man", name: "小满", kind: "j15", tone: "idle", stateLabel: "待命", task: "等待下一波次", x: 13.2, z: 14, rot: 0, accent: 0x6b7280 },
  ];
  const CREWS = [
    { id: "lan", name: "岚", chip: "弹射官", tone: "run", task: "主持本波次弹射", x: -0.6, z: 9, accent: 0xd9b45c, lead: true, detail: "弹射官决定谁上 1 / 2 / 3 号弹射位；对应场景里的 lead。" },
    { id: "safety", name: "安全官", chip: "甲板安全", tone: "wait", task: "盯 JBD 与甲板风", x: 5.4, z: 12, accent: 0xcf5f5d, detail: "安全官是升级闸门：甲板风或 JBD 异常时叫停。" },
    { id: "pri-fly", name: "塔台", chip: "PRI-FLY", tone: "run", task: "排序 1 架待回收", x: 8.4, z: 0, accent: 0x5b6cc0, island: true, detail: "塔台负责着舰排序；同一时刻只放一架进近。" },
    { id: "lso", name: "LSO", chip: "着舰", tone: "review", task: "3 道拦阻 · 下滑道 OK", x: -15.4, z: -40, accent: 0x7d67d1, white: true, detail: "LSO 对应 reviewer：只看产物与下滑道，不参与写代码。" },
  ];
  const FOCI = {
    deck: { title: "甲板态势", sub: "本波次 · 只读", kicker: "DECK", rows: [["甲板风", "25 kt"], ["侧风", "4 kt"], ["弹射能量", "106 MJ"], ["循环", "45 s"]], note: "甲板参数来自 run 记录和场景 prefs；改参数不改调度。", actions: ["打开 run 记录"] },
    lso: { title: "LSO · 着舰", sub: "串行闸门 · 通道 1", kicker: "RECOVERY", rows: [["拦阻索", "3 道"], ["下滑道", "OK"], ["进近速度", "142 kt"], ["待回收", "1 架"]], note: "着舰道是串行闸门：review / approval 必须排队，弹射位可以并行。", actions: ["打开验收队列", "放行下一架"] },
  };
  const SEQ = ["待命", "对位", "通电", "弹射", "起飞", "拦阻", "复位"];
  const SEQ_LOG = [
    "北在待命位排队；林、周已上弹射位",
    "林完成对位，JBD 升起，甲板清空",
    "EMALS 通电，弹射能量 106 MJ",
    "周 · CAT 2 开始行程，2.4 秒到舰首",
    "周离舰，进入空中；CAT 2 复位",
    "乔沿着舰道下滑，3 道拦阻成功",
    "拦阻索复位，弹射位与着舰道都空出来",
  ];

  /* ── three setup ───────────────────────────────────────── */
  if (!window.THREE) {
    $("#loading").textContent = "three.js 未加载：检查 vendor/three.min.js";
    return;
  }
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

  // JBD panels
  const jbdMat = new THREE.MeshStandardMaterial({ color: 0x414a4e, roughness: 0.85, metalness: 0.15 });
  [[-4.2, 11.8], [2.2, 11.8], [-12.4, -13.8]].forEach(([x, z]) => {
    const j = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.55, 1.2), jbdMat);
    j.position.set(x, 0.28, z);
    j.rotation.x = -0.34;
    j.castShadow = true;
    ship.add(j);
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
  PLANES.forEach((p) => {
    const mesh = makeJet(p.kind, p.id === "man");
    mesh.position.set(p.x, 0.74, p.z);
    mesh.rotation.y = Math.PI + p.rot; // model nose +Z; face bow (+Z)
    mesh.userData.base = { x: p.x, z: p.z, rot: p.rot };
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    ship.add(mesh);
    planeMeshes[p.id] = mesh;
  });
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
  PLANES.forEach((p) => {
    const mesh = planeMeshes[p.id];
    const left = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), navRed);
    left.position.set(-3.0, 0.1, -0.2); mesh.add(left);
    const right = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), navGreen);
    right.position.set(3.0, 0.1, -0.2); mesh.add(right);
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), planeAO);
    ao.rotation.x = -Math.PI / 2; ao.position.set(p.x, 0.065, p.z); ship.add(ao);
  });

  // deck crew
  const crewMeshes = {};
  CREWS.forEach((c) => {
    const g = new THREE.Group();
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 8), new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.7 }));
    vest.position.y = 0.4;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9c0a4, roughness: 0.8 }));
    head.position.y = 0.78;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 6), new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.6 }));
    helmet.position.y = 0.84; helmet.scale.y = 0.6;
    g.add(vest, head, helmet);
    g.position.set(c.x, 0, c.z);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    ship.add(g);
    crewMeshes[c.id] = g;
  });

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

  // config rings
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
  const ringGroup = new THREE.Group();
  ship.add(ringGroup);
  const ringAt = (x, z, r = 2.3) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.34, 40), ringMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.11, z);
    m.renderOrder = 3;
    m.visible = false;
    ringGroup.add(m);
    return m;
  };
  ringAt(-4.2, 24); ringAt(2.2, 23); ringAt(-11.4, -10); ringAt(12.6, 14); ringAt(12.6, -18);


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

  // afterburner glow for the launching jet
  (function addExhaust() {
    const tex = glowTexture("rgba(255,214,150,1)");
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffb45e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    sp.scale.set(2.2, 2.2, 1);
    sp.position.set(0, 0, -3.6);
    planeMeshes.zhou.add(sp);
    planeMeshes.zhou.userData.exhaust = sp;
  })();

  /* ── hotspots ──────────────────────────────────────────── */
  const hotspotDefs = [
    ...PLANES.map((p) => ({ id: p.id, kind: "plane", tone: p.tone, label: `<b>${p.name}</b>${p.stateLabel}`, dx: p.x < 0 ? -26 : 26, dy: -34, anchor: () => planeMeshes[p.id].position.clone().add(new THREE.Vector3(0, 2.9, 0)), plane: p })),
    ...CREWS.map((c) => ({ id: c.id, kind: "crew", tone: c.tone, label: `<b>${c.name}</b>${c.chip}`, dx: c.island ? 20 : c.x < 0 ? -30 : 30, dy: c.island ? -34 : 24, anchor: () => new THREE.Vector3(c.x, c.island ? 13 : 1.25, c.z), crew: c })),
    { id: "zone-cat1", kind: "zone", tone: "wait", zone: true, label: "<b>1</b>号弹射位 · 并发", dx: -20, dy: -44, anchor: () => new THREE.Vector3(-4.2, 1.1, 24) },
    { id: "zone-cat2", kind: "zone", tone: "wait", zone: true, label: "<b>2</b>号弹射位 · 并发", dx: 30, dy: -44, anchor: () => new THREE.Vector3(2.2, 1.1, 23) },
    { id: "zone-cat3", kind: "zone", tone: "wait", zone: true, label: "<b>3</b>号弹射位 · 并发", dx: -50, dy: 30, anchor: () => new THREE.Vector3(-11.4, 1.1, -10) },
    { id: "zone-elev1", kind: "zone", tone: "review", zone: true, label: "<b>升降机 1</b> · 补给", dx: 50, dy: -22, anchor: () => new THREE.Vector3(12.6, 1.1, 14) },
    { id: "zone-elev2", kind: "zone", tone: "review", zone: true, label: "<b>升降机 2</b> · 补给", dx: 50, dy: 26, anchor: () => new THREE.Vector3(12.6, 1.1, -18) },
    { id: "zone-land", kind: "zone", tone: "review", zone: true, label: "<b>着舰道</b> · 串行", dx: -40, dy: -26, anchor: () => new THREE.Vector3(-9.4, 1.0, -32) },
  ];
  const hotspotEls = {};
  hotspotDefs.forEach((h) => {
    const el = document.createElement("button");
    el.className = `hotspot ${h.kind} ${h.tone}`;
    el.dataset.id = h.id;
    el.innerHTML = `<i></i>${h.label}`;
    el.addEventListener("click", () => select(h.zone ? "deck" : h.id));
    hotspotsEl.appendChild(el);
    hotspotEls[h.id] = el;
  });
  const svgNS = "http://www.w3.org/2000/svg";
  const leadersEl = $("#leaders");
  const leaderLines = {};
  hotspotDefs.forEach((h) => {
    const line = document.createElementNS(svgNS, "line");
    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("r", "2.2");
    leadersEl.appendChild(line);
    leadersEl.appendChild(dot);
    leaderLines[h.id] = { line, dot };
  });

  /* ── inspector / selection ─────────────────────────────── */
  function planeInspector(p) {
    const tone = p.tone === "wait" ? "warn" : p.tone === "fail" ? "bad" : p.tone === "review" ? "" : "ok";
    return `
      <div class="insp-head"><div><b>${p.name} <span class="tag ${tone}">${p.stateLabel}</span></b><span>${p.kind === "j15" ? "J-15T · 弹射位" : "J-35 · 弹射位"}</span></div><button class="icon-btn" data-close-insp aria-label="收起">✕</button></div>
      <div class="insp-scroll">
        <div class="insp-sec"><h4>此刻</h4><div class="insp-row">任务<b>${p.task}</b></div><div class="insp-row">状态<b>${p.stateLabel}</b></div></div>
        <div class="insp-sec"><h4>舞台映射</h4><div class="insp-note">弹射位是并发位：${p.name} 的运行不占着舰道；只有 review / approval 才排进着舰道。中止不走「取消」，而是复飞后重新排队。</div></div>
        <div class="insp-actions"><button class="btn tiny" data-toast="打开 ${p.name} 的任务线程（原型）">打开任务</button><button class="btn tiny" data-toast="把 ${p.name} 换到另一个弹射位（原型）">换弹射位</button></div>
      </div>`;
  }
  function crewInspector(c) {
    return `
      <div class="insp-head"><div><b>${c.name} <span class="tag ${c.tone === "wait" ? "warn" : c.tone === "review" ? "" : "ok"}">${c.chip}</span></b><span>${c.task}</span></div><button class="icon-btn" data-close-insp aria-label="收起">✕</button></div>
      <div class="insp-scroll"><div class="insp-note">${c.detail}</div><div class="insp-actions"><button class="btn tiny" data-toast="打开 ${c.name} 的角色卡（原型）">打开角色</button></div></div>`;
  }
  function focusInspector(key) {
    const f = FOCI[key];
    if (!f) return "";
    return `<div class="insp-head"><div><b>${f.title}</b><span>${f.sub}</span></div><button class="icon-btn" data-close-insp aria-label="收起">✕</button></div>
      <div class="insp-scroll"><div class="insp-sec"><h4>${f.kicker}</h4>${f.rows.map(([k, v]) => `<div class="insp-row">${k}<b>${v}</b></div>`).join("")}</div>
      <div class="insp-sec"><h4>说明</h4><div class="insp-note">${f.note}</div></div>
      <div class="insp-actions">${f.actions.map((a) => `<button class="btn tiny" data-toast="${a}（原型）">${a}</button>`).join("")}</div></div>`;
  }
  function select(id) {
    state.selected = id;
    const p = PLANES.find((x) => x.id === id);
    const c = CREWS.find((x) => x.id === id);
    inspector.innerHTML = p ? planeInspector(p) : c ? crewInspector(c) : focusInspector(id);
    inspector.classList.add("open");
    $("#detailToggle").setAttribute("aria-expanded", "true");
    Object.entries(hotspotEls).forEach(([k, el]) => el.classList.toggle("sel", k === id));
    inspector.querySelectorAll("[data-close-insp]").forEach((b) => b.addEventListener("click", closeInspector));
    inspector.querySelectorAll("[data-toast]").forEach((b) => b.addEventListener("click", () => toast(b.dataset.toast)));
  }
  function closeInspector() {
    inspector.classList.remove("open");
    $("#detailToggle").setAttribute("aria-expanded", "false");
    state.selected = null;
    Object.values(hotspotEls).forEach((el) => el.classList.remove("sel"));
  }

  /* ── modes / sequence ──────────────────────────────────── */
  function setMode(mode) {
    state.mode = mode;
    stageEl.classList.toggle("config", mode === "config");
    $$("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    ringGroup.children.forEach((r) => { r.visible = mode === "config"; });
    if (mode === "config") $("#hintBar").innerHTML = "<b>配置模式</b> · 3 个弹射位 / 双升降机 / 着舰道，点标签看角色";
  }
  function renderSeq() {
    $("#seq").innerHTML = SEQ.map((s, i) => `<button class="seq-step ${state.seq === i ? "on" : ""} ${state.seq > i ? "done" : ""}" data-step="${i}"><b>${i + 1}</b>${s}</button>`).join('<span class="seq-arrow">›</span>');
    $$("#seq .seq-step").forEach((b) => b.addEventListener("click", () => setSeq(Number(b.dataset.step))));
    $("#seqLog").innerHTML = state.seq < 0 ? "选择一架飞机或点「演一遍弹射」" : `<b>${SEQ[state.seq]}</b> · ${SEQ_LOG[state.seq]}`;
  }
  function setSeq(i) {
    state.seq = Math.max(-1, Math.min(SEQ.length - 1, i));
    const zhou = planeMeshes.zhou;
    const base = zhou.userData.base;
    if (state.seq >= 4) {
      zhou.position.z = base.z + 22;
      zhou.position.y = 3.4;
    } else if (state.seq === 3) {
      zhou.position.z = base.z + 14;
      zhou.position.y = 2.1;
    } else {
      zhou.position.z = base.z;
      zhou.position.y = 0.74;
    }
    stageEl.classList.toggle("launching", state.seq >= 2 && state.seq <= 3);
    const ex = zhou.userData.exhaust;
    if (ex) { ex.material.opacity = state.seq >= 2 && state.seq <= 4 ? 0.9 : 0; ex.scale.setScalar(state.seq >= 2 && state.seq <= 4 ? 2.8 : 1.5); }
    stageEl.classList.toggle("has-review", state.seq >= 5);
    renderSeq();
  }
  let replayTimer = 0;
  function replay() {
    clearInterval(replayTimer);
    let i = 0;
    setSeq(0);
    replayTimer = setInterval(() => {
      i += 1;
      if (i >= SEQ.length) { clearInterval(replayTimer); setSeq(SEQ.length - 1); return; }
      setSeq(i);
    }, 1200);
  }
  $("#replayBtn").addEventListener("click", replay);

  /* ── theme / motion / view ─────────────────────────────── */
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
  function applyTheme(t) {
    state.theme = t;
    document.documentElement.dataset.theme = t;
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
  $("#themeBtn").addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));
  $("#motionSelect").addEventListener("change", (e) => { state.motion = e.target.value; });
  $("#detailToggle").addEventListener("click", () => {
    if (inspector.classList.contains("open")) closeInspector();
    else select(state.selected || "lin");
  });
  $$("#modeSeg button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  function setView(view) {
    $$(".view").forEach((v) => v.classList.toggle("on", v.dataset.view === view));
    $$(".tabs .tab[data-view]").forEach((t) => t.classList.toggle("on", t.dataset.view === view));
    if (view === "live") resize();
  }
  $$(".tabs .tab[data-view]").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $$("[data-view-go]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.viewGo)));

  /* ── toast / modal ─────────────────────────────────────── */
  let toastTimer = 0;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
  }
  $$("[data-toast]").forEach((b) => b.addEventListener("click", () => toast(b.dataset.toast)));
  const mask = $("#newMask");
  const closeNew = () => mask.classList.remove("on");
  $("#openNew").addEventListener("click", () => mask.classList.add("on"));
  $("#newClose").addEventListener("click", closeNew);
  $("#newCancel").addEventListener("click", closeNew);
  mask.addEventListener("mousedown", (e) => { if (e.target === mask) closeNew(); });
  $$(".modal-template").forEach((b) => b.addEventListener("click", () => {
    $$(".modal-template").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $("#newCreate").addEventListener("click", () => {
    const tpl = $(".modal-template.on")?.dataset.tpl;
    closeNew();
    if (tpl === "warroom") { location.href = "warroom.html"; return; }
    toast(tpl === "carrier" ? "已创建航母场景（3D 原型）" : "办公室舞台已上线，作战室 / 航母为舞台原型");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeInspector(); closeNew(); } });

  /* ── resize / hotspots / render ────────────────────────── */
  function resize() {
    const r = stageEl.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    state.w = w; state.h = h;
  }
  new ResizeObserver(resize).observe(stageEl);
  window.addEventListener("resize", resize);

  const v3 = new THREE.Vector3();
  function updateHotspots() {
    const W = state.w || 1, H = state.h || 1;
    const placed = [];
    const items = [];
    hotspotDefs.forEach((h) => {
      const el = hotspotEls[h.id];
      if (!el) return;
      if ((h.zone && state.mode !== "config") || (h.kind === "plane" && state.mode === "config")) {
        el.classList.add("hidden");
        leaderLines[h.id].line.style.display = "none";
        leaderLines[h.id].dot.style.display = "none";
        return;
      }
      v3.copy(h.anchor());
      ship.localToWorld(v3);
      v3.project(camera);
      if (v3.z > 1) { el.classList.add("hidden"); leaderLines[h.id].line.style.display = "none"; leaderLines[h.id].dot.style.display = "none"; return; }
      const ax = (v3.x * 0.5 + 0.5) * W;
      const ay = (-v3.y * 0.5 + 0.5) * H;
      if (ax < -120 || ax > W + 120 || ay < -80 || ay > H + 80) {
        el.classList.add("hidden"); leaderLines[h.id].line.style.display = "none"; leaderLines[h.id].dot.style.display = "none"; return;
      }
      el.classList.remove("hidden");
      items.push({ h, el, ax, ay, w: el.offsetWidth || 76, hh: el.offsetHeight || 22 });
    });
    items.sort((a, b) => a.ay - b.ay);
    items.forEach((it) => {
      const { h, el, ax, ay, w, hh } = it;
      const cands = [
        [h.dx || 0, h.dy || -32], [0, -56], [0, 56], [-48, -30], [48, -30], [-48, 30], [48, 30],
        [-92, 0], [92, 0], [0, -84], [0, 84], [-92, -46], [92, -46], [-92, 46], [92, 46],
      ];
      let best = null;
      for (const [dx, dy] of cands) {
        const cx = Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, ax + dx));
        const cy = Math.max(hh / 2 + 10, Math.min(H - hh / 2 - 10, ay + dy));
        const r = { l: cx - w / 2 - 4, t: cy - hh / 2 - 3, r: cx + w / 2 + 4, b: cy + hh / 2 + 3, cx, cy };
        if (!placed.some((p) => r.l < p.r && r.r > p.l && r.t < p.b && r.b > p.t)) { best = r; break; }
      }
      if (!best) {
        const cx = Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, ax + (h.dx || 0)));
        const cy = Math.max(hh / 2 + 10, Math.min(H - hh / 2 - 10, ay + (h.dy || -32)));
        best = { cx, cy, l: cx - w / 2, t: cy - hh / 2, r: cx + w / 2, b: cy + hh / 2 };
      }
      placed.push(best);
      el.style.left = `${best.cx}px`;
      el.style.top = `${best.cy}px`;
      const L = leaderLines[h.id];
      L.line.style.display = "";
      L.dot.style.display = "";
      L.line.setAttribute("x1", ax); L.line.setAttribute("y1", ay);
      L.line.setAttribute("x2", best.cx); L.line.setAttribute("y2", best.cy);
      L.dot.setAttribute("cx", ax); L.dot.setAttribute("cy", ay);
    });
  }

  const clock = new THREE.Clock();
  let t0 = 0;
  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    seaUniforms.uTime.value = t;
    skyUniforms.uTime.value = t;
    const amp = state.motion === "off" ? 0 : state.motion === "full" ? 2.4 : 1.1;
    if (DEBUG_CAM === "bow") {
      camera.position.set(-1, 6, 39);
      camera.lookAt(-3, 1.2, 24);
    } else if (DEBUG_CAM === "island") {
      camera.position.set(16, 9, 18);
      camera.lookAt(8.4, 4.5, 0);
    } else if (DEBUG_CAM === "water") {
      camera.position.set(42, 7, -8);
      camera.lookAt(2, -3.2, -22);
    } else if (DEBUG_CAM === "escort") {
      camera.position.set(-34, 8.5, 3);
      camera.lookAt(-50, -2.0, 24);
    } else {
      camera.position.x = 52 + Math.sin(t * 0.11) * amp;
      camera.position.y = 20 + Math.sin(t * 0.08 + 1.4) * amp * 0.35;
      camera.lookAt(1, 9, -5);
    }
    const mv = state.motion === "off" ? 0 : state.motion === "full" ? 1.5 : 1;
    ship.rotation.y = SHIP_YAW + Math.sin(t * 0.05) * 0.006;
    ship.position.y = Math.sin(t * 0.42) * 0.085 * mv;
    ship.rotation.z = Math.sin(t * 0.3) * 0.0032 * mv;
    escorts.forEach((e, i) => {
      e.m.position.y = -4.0 + Math.sin(t * 0.52 + i * 1.7) * 0.06 * mv;
      e.m.rotation.z = Math.sin(t * 0.41 + i) * 0.006 * mv;
    });
    updateHotspots();
    if (sunFlareEl) {
      const sp = SUN_DIR.clone().multiplyScalar(1200).project(camera);
      const sx = (sp.x * 0.5 + 0.5) * (state.w || 1);
      const sy = (-sp.y * 0.5 + 0.5) * (state.h || 1);
      const visible = sp.z < 1 && sx > -200 && sx < (state.w || 1) + 200 && sy > -200 && sy < (state.h || 1) + 200;
      sunFlareEl.style.left = `${sx}px`;
      sunFlareEl.style.top = `${sy}px`;
      sunFlareEl.style.opacity = visible && state.theme !== "dark" ? "0.9" : "0";
    }
    renderer.render(scene, camera);
  }


  // init
  applyTheme(state.theme);
  setMode(state.mode);
  setSeq(state.seq);
  if (params.get("view") === "gallery") setView("gallery");
  if (state.detail) select(state.selected || "lin");
  resize();
  $("#loading").classList.add("off");
  animate();
})();
