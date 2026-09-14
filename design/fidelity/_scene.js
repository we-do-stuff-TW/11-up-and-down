/* ==============================================================
   立體牌桌・仿真度比較原型   design/fidelity
   --------------------------------------------------------------
   同一個場景，差別只在「加了哪幾層」。
   桌布／木沿／書房／骰子的貼圖與幾何是 pull.py 從 docs/index.html 原封不動抄過來的，
   所以「A 現在」就是線上現在的樣子——比較才有意義。
   牌面是這一頁自己畫的簡化版（真的那份要人像 SVG 與整套字型），
   這一頁比的是紙、光、邊，不是牌面設計。

   每一層都掛在 FX 上：label 是名字、hint 是「它到底改了什麼」、set(on) 是開關。
   加新的一層就往 FX 裡多寫一條，UI 與預設會自己長出來。
   ============================================================== */
/* 不用 import map：一份文件只吃得下一張，外層（例如 claude.ai 的 Artifact）如果自己有一張，
   我們這張就會被丟掉，`from "three"` 解不開，整個 module 一行都不會跑、畫面全黑。
   jsdelivr 的 `/+esm` 會把套件裡的裸名改寫成絕對路徑，而且每個 addon 都指向
   同一個 `/npm/three@0.186.0/+esm`，所以全部共用同一個 three 實體。 */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.186.0/+esm";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/controls/OrbitControls.js/+esm";
import { RectAreaLightUniformsLib } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/lights/RectAreaLightUniformsLib.js/+esm";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/EffectComposer.js/+esm";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/RenderPass.js/+esm";
import { GTAOPass } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/GTAOPass.js/+esm";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm";
import { BokehPass } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/BokehPass.js/+esm";
import { ShaderPass } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/ShaderPass.js/+esm";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/postprocessing/OutputPass.js/+esm";

/* ================= 尺度與渲染器 ================= */
/* 世界單位：一張牌寬 = 1。全部照 docs/index.html 的常數 */
const CARD_W = 1, CARD_H = 1.4146, THICK = .007, Y0 = .0008, AO_OP = .58;
const FELT_R = 4.46, R_CHAIR = 6.7;    /* TABLE_H 在抄過來的貼圖那段裡 */
const R_SEAT = 4.32, R_PLAY = 1.06, R_FAN = 3.16, R_DECK = 3.66, R_PILE = 2.42;
const HAND_Y = .60, HAND_Z = 3.02, HAND_PITCH = -1.04, HAND_S = .72;
const HAND_R = 1.9, HAND_LIFT = .042, HAND_POP = .016, HAND_RISE = .052;
const ROOM_RX = 14, ROOM_ZB = -13, ROOM_ZF = 14, ROOM_CEIL = 8.7;
const N = 4, ME = 0;                                  /* 這一頁固定演 4 人局、我坐 0 號 */

const CANVAS = document.getElementById("gl");
const R = new THREE.WebGLRenderer({canvas:CANVAS, antialias:true, powerPreference:"high-performance"});
R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
R.shadowMap.enabled = true;
R.shadowMap.type = THREE.PCFShadowMap;
R.toneMapping = THREE.AgXToneMapping;
R.toneMappingExposure = .98;
RectAreaLightUniformsLib.init();

/* 抄過來的那三段吃這個（原版是 3D 呈現層的狀態物件） */
const S = {maxAniso: R.capabilities.getMaxAnisotropy(), xs:1};
let dieGeo = null;              /* 抄過來的骰子那段吃這兩個 */
const dieFaceMats = {};

/*==TEX==*/

/*==ROOM==*/

/*==DICE==*/

/* ================= 小工具 ================= */
const polar  = (r, a) => ({x: r * Math.sin(a), z: r * Math.cos(a)});
const side   = a => ({x: Math.cos(a), z: -Math.sin(a)});
const ang    = i => i * Math.PI * 2 / N;
const cv2    = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };

/* 高度圖轉法線圖。微結構（亞麻紋、絨毛、木孔）都是先畫一張灰階高度，再由這裡轉成法線——
   bumpMap 是每格取一次差分、會糊；normalMap 是預先算好的，同樣的圖細節多很多。 */
function normalFromHeight(cv, strength){
  const w = cv.width, h = cv.height, g = cv.getContext("2d");
  const src = g.getImageData(0, 0, w, h).data;
  const [out, og] = cv2(w, h), im = og.createImageData(w, h), d = im.data;
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
    const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
    const L = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    d[i] = (dx / L * .5 + .5) * 255; d[i+1] = (dy / L * .5 + .5) * 255; d[i+2] = (1 / L * .5 + .5) * 255; d[i+3] = 255;
  }
  og.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = S.maxAniso;
  return t;
}

/* ================= 牌面（簡化版） ================= */
/* 四個花色，畫在 24×24 的格子裡再縮放——跟本體共用同一組造型觀念，但這裡只求形狀對 */
function pip(g, s, x, y, r, col){
  g.save(); g.translate(x, y); g.scale(r / 12, r / 12); g.fillStyle = col; g.beginPath();
  if(s === 0){ g.moveTo(0,-11); g.bezierCurveTo(-9,-2,-11,1,-11,4); g.bezierCurveTo(-11,9,-6,10,-3,7.5);
    g.bezierCurveTo(-2.4,11,-3.8,12.5,-5.6,13.5); g.lineTo(5.6,13.5);
    g.bezierCurveTo(3.8,12.5,2.4,11,3,7.5); g.bezierCurveTo(6,10,11,9,11,4); g.bezierCurveTo(11,1,9,-2,0,-11); }
  else if(s === 1){ g.moveTo(0,12); g.bezierCurveTo(-11,3,-11,-4,-11,-6.5); g.bezierCurveTo(-11,-11,-6,-12,-3,-9.5);
    g.bezierCurveTo(-1.6,-8.2,-.6,-6.6,0,-5.2); g.bezierCurveTo(.6,-6.6,1.6,-8.2,3,-9.5);
    g.bezierCurveTo(6,-12,11,-11,11,-6.5); g.bezierCurveTo(11,-4,11,3,0,12); }
  else if(s === 2){ g.moveTo(0,-12); g.quadraticCurveTo(4,-5,9,0); g.quadraticCurveTo(4,5,0,12);
    g.quadraticCurveTo(-4,5,-9,0); g.quadraticCurveTo(-4,-5,0,-12); }
  else { g.arc(0,-5.5,4.6,0,7); g.closePath(); g.moveTo(-4.8,4.2); g.arc(-5.4,2.4,4.6,0,7); g.closePath();
    g.moveTo(6,4.2); g.arc(5.4,2.4,4.6,0,7); g.closePath();
    g.moveTo(-1.6,3); g.bezierCurveTo(-1.2,7,-2.4,10.6,-5,12.6); g.lineTo(5,12.6);
    g.bezierCurveTo(2.4,10.6,1.2,7,1.6,3); }
  g.fill(); g.restore();
}
const RANKS = {7:"7", 8:"8", 9:"9", 10:"10", 11:"J", 12:"Q", 13:"K", 14:"A"};
/* 點數排版：每一格是 (x, y) 佔紙面的比例，負的 y 代表那一顆要倒過來畫 */
const PIPS = {
  7:[[.5,.20],[.5,.5],[.5,.80],[.28,.20],[.72,.20],[.28,.80],[.72,.80]],
  8:[[.28,.20],[.72,.20],[.28,.42],[.72,.42],[.28,.62],[.72,.62],[.28,.80],[.72,.80]],
  9:[[.5,.5],[.28,.20],[.72,.20],[.28,.40],[.72,.40],[.28,.62],[.72,.62],[.28,.80],[.72,.80]],
  10:[[.5,.34],[.5,.66],[.28,.20],[.72,.20],[.28,.40],[.72,.40],[.28,.62],[.72,.62],[.28,.80],[.72,.80]],
  14:[[.5,.5]]
};
const PAPER = "#F4EEDD", INK = "#1A1714", RED = "#A32B25", GOLD = "#C9A552";
function faceTex(rank, suit){
  const W = 384, H = 543, [cv, g] = cv2(W, H);
  const col = (suit === 1 || suit === 2) ? RED : INK;
  /* 紙：奶白底、極淡的斑、左上一點斜光 */
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  const mot = sampler(noiseField(128, 7, 3, rank * 31 + suit), 128);
  const im = g.getImageData(0, 0, W, H), d = im.data;
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
    const k = 1 + (mot(x / W * 2, y / H * 2) - .5) * .055, i = (y * W + x) * 4;
    d[i] *= k; d[i+1] *= k; d[i+2] *= k;
  }
  g.putImageData(im, 0, 0);
  /* 金雙框 */
  g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(13, 13, W - 26, H - 26);
  g.lineWidth = 1.2; g.strokeRect(22, 22, W - 44, H - 44);
  /* 角標：點數＋小花色，兩個角對稱 */
  const corner = (flip) => {
    g.save(); if(flip){ g.translate(W, H); g.rotate(Math.PI); }
    g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.font = "600 62px Georgia,'Times New Roman',serif";
    g.fillText(RANKS[rank], 48, 88);
    pip(g, suit, 48, 120, 19, col);
    g.restore();
  };
  corner(false); corner(true);
  /* 中央 */
  if(rank >= 11 && rank <= 13){
    /* 宮廷牌：這一頁不做人像，畫一塊有花紋的框＋字母，讀得出是誰就好 */
    g.strokeStyle = GOLD; g.lineWidth = 2;
    g.strokeRect(W * .22, H * .18, W * .56, H * .64);
    g.fillStyle = "rgba(163,43,37,.06)"; g.fillRect(W * .22, H * .18, W * .56, H * .64);
    g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "600 128px Georgia,'Times New Roman',serif";
    g.fillText(RANKS[rank], W / 2, H * .46);
    pip(g, suit, W / 2, H * .66, 40, col);
  } else {
    for(const [px, py] of (PIPS[rank] || PIPS[9])){
      const up = py < .5;
      g.save(); g.translate(px * W, py * H); if(!up) g.rotate(Math.PI);
      pip(g, suit, 0, 0, rank === 14 ? 58 : 30, col); g.restore();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = S.maxAniso;
  return t;
}
/* 牌背：深紅、細菱格、金框 */
function backTex(){
  const W = 384, H = 543, [cv, g] = cv2(W, H);
  g.fillStyle = "#8E2B2B"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,235,205,.16)"; g.lineWidth = 1;
  for(let i = -H; i < W + H; i += 13){
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke();
    g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.stroke();
  }
  g.fillStyle = PAPER; g.fillRect(0, 0, W, 14); g.fillRect(0, H - 14, W, 14);
  g.fillRect(0, 0, 14, H); g.fillRect(W - 14, 0, 14, H);
  g.strokeStyle = GOLD; g.lineWidth = 2; g.strokeRect(20, 20, W - 40, H - 40);
  g.save(); g.translate(W / 2, H / 2); g.rotate(Math.PI / 4);
  g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(-52, -52, 104, 104); g.restore();
  g.fillStyle = GOLD; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "600 46px Georgia,serif"; g.fillText("11", W / 2, H / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = S.maxAniso;
  return t;
}
/* 亞麻壓紋：真牌表面是一層交叉的細凸紋（cambric finish）——
   側光一照，整張牌會有一層極細的織理。這是「像真牌」最關鍵的一層微結構。 */
function linenHeight(){
  const n = 512, [cv, g] = cv2(n, n);
  g.fillStyle = "#808080"; g.fillRect(0, 0, n, n);
  g.lineWidth = 1.6;
  for(let i = 0; i < n; i += 4){
    g.strokeStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.moveTo(i, 0); g.lineTo(i, n); g.stroke();
    g.strokeStyle = "rgba(0,0,0,.42)";      g.beginPath(); g.moveTo(i + 2, 0); g.lineTo(i + 2, n); g.stroke();
  }
  for(let i = 0; i < n; i += 4){
    g.strokeStyle = "rgba(255,255,255,.30)"; g.beginPath(); g.moveTo(0, i); g.lineTo(n, i); g.stroke();
    g.strokeStyle = "rgba(0,0,0,.24)";      g.beginPath(); g.moveTo(0, i + 2); g.lineTo(n, i + 2); g.stroke();
  }
  return cv;
}
/* 絨毛：一根一根短毛，方向大致一致——絨布的高光會沿著毛的方向拉成一道，不是一個點 */
function napHeight(){
  const n = 512, [cv, g] = cv2(n, n), rnd = mulberry32(77);
  g.fillStyle = "#808080"; g.fillRect(0, 0, n, n);
  for(let i = 0; i < 26000; i++){
    const x = rnd() * n, y = rnd() * n, a = (rnd() - .5) * .5, L = 3 + rnd() * 5;
    g.strokeStyle = rnd() > .5 ? "rgba(255,255,255,.16)" : "rgba(0,0,0,.16)";
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * L, y + Math.cos(a) * L); g.stroke();
  }
  return cv;
}
/* 木孔：胡桃木的導管——一顆一顆細長的凹孔，順著年輪方向 */
function poreHeight(){
  const w = 1024, h = 256, [cv, g] = cv2(w, h), rnd = mulberry32(91);
  g.fillStyle = "#808080"; g.fillRect(0, 0, w, h);
  for(let i = 0; i < 5200; i++){
    const x = rnd() * w, y = rnd() * h, L = 2 + rnd() * 9;
    g.fillStyle = "rgba(0,0,0,.34)";
    g.beginPath(); g.ellipse(x, y, L, .8, 0, 0, 7); g.fill();
  }
  return cv;
}
/* 牌的側邊：一疊牌的側面是一層一層的紙緣，不是一片白。橫向極細的明暗條 */
function edgeHeight(){
  const w = 8, h = 256, [cv, g] = cv2(w, h);
  for(let y = 0; y < h; y++){
    const k = y % 4;
    g.fillStyle = k === 0 ? "#d8d8d8" : k === 2 ? "#6a6a6a" : "#9a9a9a";
    g.fillRect(0, y, w, 1);
  }
  return cv;
}

/* ================= 場景 ================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07050a);
scene.environment = makeEnv(R);
scene.environmentIntensity = .42;

const camera = new THREE.PerspectiveCamera(40, 1, .1, 80);
camera.position.set(0, 7.75, 8.75);
const FOCUS = new THREE.Vector3(0, 0, .35);

/* 四個視角。判斷材質得貼近看——牌面的亞麻紋、骰子的凹點、椅子的滾邊
   在牌局視角上只有幾個畫素寬，看不出差別。 */
const VIEWS = [
  {k:"game",  name:"牌局",     pos:[0, 7.75, 8.75],   tgt:[0, 0, .35]},
  {k:"cards", name:"牌面",     pos:[.18, 1.10, 6.02], tgt:[.05, .46, 3.00]},
  {k:"dice",  name:"骰子",     pos:[.25, 1.05, .75],  tgt:[-.02, .12, -.72]},
  {k:"chair", name:"椅子",     pos:[5.9, 1.15, 9.9],  tgt:[.2, -1.15, 6.5]},
  {k:"room",  name:"房間",     pos:[3.6, 3.05, 10.6], tgt:[.4, .55, 1.2]}
];
let view = "game";
function setView(k){
  const v = VIEWS.find(x => x.k === k) || VIEWS[0];
  view = v.k;
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  controls.target.set(v.tgt[0], v.tgt[1], v.tgt[2]);
  controls.update();
  dirty = 4; accN = 0;
  for(const b of elView.children) b.classList.toggle("go", b.dataset.k === view);
}

const controls = new OrbitControls(camera, CANVAS);
controls.target.copy(FOCUS);
controls.enableDamping = true; controls.dampingFactor = .08;
controls.minDistance = 3.5; controls.maxDistance = 24;
controls.maxPolarAngle = Math.PI * .495;
controls.addEventListener("change", () => { dirty = 3; accN = 0; });

/* ---- 桌子（照 docs/index.html 的 build()） ---- */
const table = new THREE.Group(); scene.add(table);

/* 桌布的顏色是算出來的：王牌花色給色相、局數給深度（原版 paintTable → feltColor）。
   這一頁固定演「王牌方塊、第 6 局」那一桌：oklch(.254 .0545 20) */
function oklchLin(L, C, h){
  const r = h * Math.PI / 180, a = C * Math.cos(r), b = C * Math.sin(r);
  const l_ = L + .3963377774*a + .2158037573*b, m_ = L - .1055613458*a - .0638541728*b, s_ = L - .0894841775*a - 1.2914855480*b;
  const l = l_*l_*l_, m = m_*m_*m_, q = s_*s_*s_;
  return [Math.max(0, 4.0767416621*l - 3.3077115913*m + 0.2309699292*q),
          Math.max(0, -1.2684380046*l + 2.6097574011*m - 0.3413193965*q),
          Math.max(0, -0.0041960863*l - 0.7034186147*m + 1.7076147010*q)];
}
const FC = oklchLin(.254, .0545, 20);

const nap = fieldTex(noiseField(256, 64, 2, 3), 256, {repeat:16});
const feltMap = feltTex();
const feltBase = new THREE.MeshPhysicalMaterial({map:feltMap, roughness:1, metalness:0,
  bumpMap:nap, bumpScale:.0035, sheen:.22, sheenRoughness:.9, sheenColor:new THREE.Color(0x000000)});
feltBase.color.setRGB(FC[0] * .92, FC[1] * .92, FC[2] * .92, THREE.LinearSRGBColorSpace);
feltBase.sheenColor.setRGB(FC[0] * 1.6, FC[1] * 1.6, FC[2] * 1.6, THREE.LinearSRGBColorSpace);
const napN = normalFromHeight(napHeight(), 2.2); napN.repeat.set(9, 9);
const feltMicro = new THREE.MeshPhysicalMaterial({map:feltMap, roughness:.97, metalness:0,
  normalMap:napN, normalScale:new THREE.Vector2(.55, .55),
  sheen:.46, sheenRoughness:.62, sheenColor:new THREE.Color(0x7a6a52),
  anisotropy:.45, anisotropyRotation:Math.PI / 2, specularIntensity:.18});
feltMicro.color.copy(feltBase.color);
feltMicro.sheenColor.setRGB(FC[0] * 1.35, FC[1] * 1.35, FC[2] * 1.30, THREE.LinearSRGBColorSpace);
const felt = new THREE.Mesh(new THREE.CircleGeometry(FELT_R, 160), feltBase);
felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true;
table.add(felt);

/* 桌沿：Lathe 的剖面照原版一模一樣 */
const LIP = .016, EDGE_W = .46, DEPTH = .30, R0 = .13;
const prof = [];
prof.push(new THREE.Vector2(FELT_R - .30, -DEPTH));
prof.push(new THREE.Vector2(FELT_R + EDGE_W - .04, -DEPTH));
prof.push(new THREE.Vector2(FELT_R + EDGE_W, -DEPTH + .04));
for(let i = 7; i >= 0; i--){
  const a = i / 7 * Math.PI / 2;
  prof.push(new THREE.Vector2(FELT_R + EDGE_W - R0 + Math.sin(a) * R0, LIP + .004 - R0 + Math.cos(a) * R0));
}
prof.push(new THREE.Vector2(FELT_R + .06, LIP + .004));
prof.push(new THREE.Vector2(FELT_R - .01, LIP));
prof.push(new THREE.Vector2(FELT_R - .01, -.02));
const woodMap = woodTex(); woodMap.anisotropy = S.maxAniso;
const woodBase = new THREE.MeshPhysicalMaterial({map:woodMap, roughness:.52, metalness:0,
  bumpMap:woodMap, bumpScale:.0012, clearcoat:.38, clearcoatRoughness:.32});
const poreN = normalFromHeight(poreHeight(), 1.5); poreN.repeat.set(3, 1);
const woodMicro = new THREE.MeshPhysicalMaterial({map:woodMap, roughness:.40, metalness:0,
  normalMap:poreN, normalScale:new THREE.Vector2(.7, .7),
  clearcoat:.62, clearcoatRoughness:.16, clearcoatNormalMap:poreN,
  clearcoatNormalScale:new THREE.Vector2(.25, .25), envMapIntensity:1.15});
const rim = new THREE.Mesh(new THREE.LatheGeometry(prof, 220), woodBase);
rim.receiveShadow = rim.castShadow = true;
table.add(rim);

/* 銅鑲線：木沿與桌布之間一圈細銅線（家具上叫 stringing）。
   真的賭場桌與古董牌桌都有這一道——少了它，木頭與布的交界只是一條裂縫 */
const inlay = new THREE.Mesh(new THREE.TorusGeometry(FELT_R - .005, .012, 8, 260),
  new THREE.MeshStandardMaterial({color:0xC9A552, metalness:.92, roughness:.26}));
inlay.rotation.x = Math.PI / 2; inlay.position.y = LIP - .004;
inlay.visible = false; table.add(inlay);

const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.7, TABLE_H - DEPTH, 48),
  new THREE.MeshStandardMaterial({color:0x17140f, roughness:.85, metalness:0}));
leg.position.y = -DEPTH - (TABLE_H - DEPTH) / 2;
leg.castShadow = leg.receiveShadow = true;
table.add(leg);

/* ---- 書房 ---- */
const room = buildRoom(R, scene);

/* ---- 燈（照原版） ---- */
scene.add(new THREE.HemisphereLight(0x3a2a1c, 0x0e0906, .26));
const lamp = new THREE.SpotLight(0xfff0dc, 88, 30, 1.02, .9, 2);
lamp.position.set(-.3, 7.4, 1.0);
lamp.target.position.set(0, 0, .35);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 2; lamp.shadow.camera.far = 16;
lamp.shadow.bias = -.0005; lamp.shadow.normalBias = .012; lamp.shadow.radius = 3;
scene.add(lamp, lamp.target);
const LAMP_I = lamp.intensity;

const fill = new THREE.DirectionalLight(0xbcc8dc, .14);
fill.position.set(2.4, 3.2, 6.5);
scene.add(fill);

/* 面光源：燈罩是一個有面積的東西，不是一個點。
   點光源在牌面上留一個小圓亮斑；面光源留的是一塊柔和、有形狀的反光——
   牌與桌布的「濕潤感」差別就在這裡。three 的 RectAreaLight 不投影子，
   所以聚光燈留著出影子、強度降下來，兩盞合起來用。 */
const area = new THREE.RectAreaLight(0xffeccd, 0, 3.6, 3.6);
area.position.set(0, 5.6, .2);
area.lookAt(0, 0, .2);
scene.add(area);

/* ================= 椅子 ================= */
const chairsBasic = [], chairsPlus = [];
for(let i = 0; i < N; i++){
  const a = ang(i), p = polar(R_CHAIR, a);
  const c = room.chair();
  c.position.set(p.x, -TABLE_H, p.z); c.rotation.y = a + Math.PI;
  scene.add(c); chairsBasic.push(c);
}

/* 補足細節的椅子：滾邊、釘扣凹陷、收分的腳、扶手木蓋、椅背冠條，
   每張再各自歪一點——四張椅子角度一模一樣，一眼就知道是複製出來的 */
const VELVET_N = normalFromHeight(napHeight(), 1.4); VELVET_N.repeat.set(4, 4);
const MOSS2 = new THREE.MeshPhysicalMaterial({color:0x17332a, roughness:.82, metalness:0,
  sheen:.75, sheenRoughness:.55, sheenColor:new THREE.Color(0x6f9c82),
  normalMap:VELVET_N, normalScale:new THREE.Vector2(.45, .45)});
const WAL = new THREE.MeshPhysicalMaterial({color:0x3c2718, roughness:.42, metalness:0, clearcoat:.5, clearcoatRoughness:.28});
const BRASS2 = new THREE.MeshStandardMaterial({color:0xC9A552, metalness:.9, roughness:.3});
const BTN = new THREE.MeshPhysicalMaterial({color:0x122720, roughness:.6, sheen:.5, sheenColor:new THREE.Color(0x5f8a72)});

function rr(w, h, r){    /* 圓角矩形路徑，給滾邊的管子用 */
  const pts = [], seg = 6;
  const cor = [[w/2 - r, h/2 - r, 0], [-w/2 + r, h/2 - r, Math.PI/2], [-w/2 + r, -h/2 + r, Math.PI], [w/2 - r, -h/2 + r, -Math.PI/2]];
  for(const [cx, cy, a0] of cor)
    for(let k = 0; k <= seg; k++){ const a = a0 + k / seg * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cy + Math.sin(a) * r)); }
  return pts;
}
function welt(w, h, r, y, mat){   /* 滾邊：沿圓角矩形繞一圈的細管 */
  const curve = new THREE.CatmullRomCurve3(rr(w, h, r), true);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, .028, 8, true), mat);
  m.position.y = y; m.castShadow = true; return m;
}
function mesh(geo, mat, x, y, z){ const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function rboxGeo2(w, h, d, rad){
  const R2 = Math.min(rad, w/2 - .01, h/2 - .01, d/2 - .01);
  const sw = w - 2*R2, sh = h - 2*R2, cr = Math.max(.01, Math.min(R2, sw/2, sh/2));
  const s = new THREE.Shape();
  s.moveTo(-sw/2 + cr, -sh/2); s.lineTo(sw/2 - cr, -sh/2); s.quadraticCurveTo(sw/2, -sh/2, sw/2, -sh/2 + cr);
  s.lineTo(sw/2, sh/2 - cr); s.quadraticCurveTo(sw/2, sh/2, sw/2 - cr, sh/2); s.lineTo(-sw/2 + cr, sh/2);
  s.quadraticCurveTo(-sw/2, sh/2, -sw/2, sh/2 - cr); s.lineTo(-sw/2, -sh/2 + cr); s.quadraticCurveTo(-sw/2, -sh/2, -sw/2 + cr, -sh/2);
  const g = new THREE.ExtrudeGeometry(s, {depth:d - 2*R2, bevelEnabled:true, bevelThickness:R2, bevelSize:R2, bevelSegments:4, curveSegments:6});
  g.center(); return g;
}
function chairPlus(seed){
  /* 尺寸完全照原版 chair()（腳 .42、座框 y .67、坐墊 y 1.16、椅背 y 1.98 後仰 .13、
     扶手 x ±.99 y 1.36），只是每一塊都補上真家具會有的東西。 */
  const g = new THREE.Group(), rnd = mulberry32(seed), legs = .42;
  /* 腳：上粗下細（收分）＋銅腳套。原版是等徑圓柱，那是桌腳不是椅腳 */
  for(const sx of [-1, 1]) for(const sz of [-1, 1]){
    g.add(mesh(new THREE.CylinderGeometry(.095, .056, legs, 16), WAL, sx * .82, legs / 2, sz * .75));
    g.add(mesh(new THREE.CylinderGeometry(.060, .056, .055, 16), BRASS2, sx * .82, .028, sz * .75));
  }
  /* 座框＋前裙板 */
  g.add(mesh(rboxGeo2(1.80, .50, 1.76, .06), WAL, 0, legs + .25, 0));
  g.add(mesh(rboxGeo2(1.66, .30, .09, .035), WAL, 0, legs + .25, .90));
  /* 坐墊：原版是一塊圓角盒。真的軟包中間會鼓起來，外圈一道滾邊把布收住 */
  g.add(mesh(rboxGeo2(2.00, .52, 1.96, .17), MOSS2, 0, legs + .74, .02));
  const dome = mesh(new THREE.SphereGeometry(1.0, 36, 18), MOSS2, 0, legs + .74 + .26 - .11, .02);
  dome.scale.set(.99, .11, .97); g.add(dome);
  g.add(welt(2.01, 1.97, .19, legs + .74, MOSS2));
  /* 椅背：滾邊一圈、六顆釘扣各自沉進去、頂上一條木冠條 */
  const back = new THREE.Group();
  back.position.set(0, legs + 1.56, -.86); back.rotation.x = -.13;
  back.add(mesh(rboxGeo2(2.00, 1.80, .46, .17), MOSS2, 0, 0, 0));
  const bw = welt(2.00, 1.80, .19, 0, MOSS2);
  bw.rotation.x = Math.PI / 2; bw.position.z = .14; back.add(bw);
  for(const sx of [-.52, 0, .52]) for(const yy of [-.02, .58]){
    const bulge = mesh(new THREE.SphereGeometry(.15, 18, 12), MOSS2, sx, yy, .14);
    bulge.scale.set(1, 1, .30); back.add(bulge);
    const btn = mesh(new THREE.CylinderGeometry(.050, .058, .04, 14), BTN, sx, yy, .215);
    btn.rotation.x = Math.PI / 2; back.add(btn);
  }
  back.add(mesh(rboxGeo2(2.06, .18, .52, .08), WAL, 0, .97, 0));
  g.add(back);
  /* 扶手：軟包＋木蓋（原版只有軟包，所以看起來像兩塊綠磚） */
  for(const sx of [-1, 1]){
    g.add(mesh(rboxGeo2(.40, .70, 1.86, .13), MOSS2, sx * .99, legs + .94, -.06));
    g.add(mesh(rboxGeo2(.44, .10, 1.92, .05), WAL, sx * .99, legs + 1.315, -.06));
  }
  /* 四張椅子角度一模一樣，一眼就知道是複製出來的 */
  g.rotation.y = (rnd() - .5) * .13;
  g.position.x = (rnd() - .5) * .10;
  return g;
}
for(let i = 0; i < N; i++){
  const a = ang(i), p = polar(R_CHAIR, a);
  const holder = new THREE.Group();
  holder.position.set(p.x, -TABLE_H, p.z); holder.rotation.y = a + Math.PI;
  holder.add(chairPlus(i * 17 + 3));
  holder.visible = false;
  scene.add(holder); chairsPlus.push(holder);
}

/* ================= 牌 ================= */
const geoCache2 = new Map();
/* 圓角、有厚度，三個群組分別吃正面／背面／側邊三種材質（照 docs/index.html 的 cardGeo）。
   多一個 bow：拱起來一點。分組必須在拱之前算完——拱過之後 z 已經分不出三個面了。 */
function cardGeoMake(depth, bow){
  const key = depth.toFixed(4) + ":" + (bow || 0);
  if(geoCache2.has(key)) return geoCache2.get(key);
  const w = CARD_W, h = CARD_H, r = .058, x = -w/2, y = -h/2;
  const sh = new THREE.Shape();
  sh.moveTo(x + r, y);
  sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(sh, {depth, bevelEnabled:false, curveSegments:bow ? 12 : 5, steps:1});
  g.translate(0, 0, -depth / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const z0 = [];
  for(let i = 0; i < pos.count; i++){
    z0.push(pos.getZ(i));
    const u = (pos.getX(i) - x) / w, v = (pos.getY(i) - y) / h;
    uv.setXY(i, pos.getZ(i) < 0 ? 1 - u : u, v);
  }
  uv.needsUpdate = true;
  const kind = t => {
    const a = z0[t], b = z0[t+1], c = z0[t+2];
    if(a !== b || b !== c) return 2;
    return a > 0 ? 0 : 1;
  };
  g.clearGroups();
  let start = 0, cur = kind(0);
  for(let t = 3; t <= pos.count; t += 3){
    const k = t < pos.count ? kind(t) : -1;
    if(k !== cur){ g.addGroup(start, t - start, cur); start = t; cur = k; }
  }
  if(bow) for(let i = 0; i < pos.count; i++){
    const u = (pos.getX(i) - x) / w - .5;
    pos.setZ(i, pos.getZ(i) + (1 - 4 * u * u) * bow);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  geoCache2.set(key, g);
  return g;
}

/* 壓紋的節距要挑過：一張牌寬 205 格時，近拍剛好一格 2 個畫素——正好落在取樣極限上，
   會冒出摩爾紋（看起來像數位髒污，不像布）。收到約 100 格、一格 4～5 個畫素就乾淨了。 */
const linenN = normalFromHeight(linenHeight(), 1.9); linenN.repeat.set(.8, 1.13);
const edgeN = normalFromHeight(edgeHeight(), 1.0); edgeN.repeat.set(1, 1);
const edgeMap = new THREE.CanvasTexture(edgeHeight());
edgeMap.wrapS = edgeMap.wrapT = THREE.RepeatWrapping; edgeMap.colorSpace = THREE.SRGBColorSpace;

const paperMat = (map, o) => new THREE.MeshPhysicalMaterial(Object.assign(
  {map, roughness:.88, metalness:0, specularIntensity:.26, envMapIntensity:.9}, o || {}));
const BACK_T = backTex();
const M_BACK = paperMat(BACK_T, {roughness:.84, specularIntensity:.30});
const M_EDGE = paperMat(null, {color:0xE9E1CC, roughness:.96});
const faceCache = new Map();
function M_FACE(rank, suit){
  const k = rank + ":" + suit;
  if(!faceCache.has(k)) faceCache.set(k, paperMat(faceTex(rank, suit)));
  return faceCache.get(k);
}
/* micro 開關要一次改到所有紙材質，所以集中登記 */
const PAPERS = [M_BACK];
const microOn = {v:false};
function paperMicro(on){
  for(const m of PAPERS.concat(Array.from(faceCache.values()))){
    m.normalMap = on ? linenN : null;
    m.normalScale.set(.55, .55);
    /* 關鍵在這一層：牌的表面有一層極薄的塗佈，掠射角會沿著織理反一道光。
       只給 normalMap 是看不出來的——紙太粗糙，漫射光把起伏吃掉了。 */
    m.clearcoat = on ? .34 : 0;
    m.clearcoatRoughness = .30;
    m.clearcoatNormalMap = on ? linenN : null;
    if(m.clearcoatNormalScale) m.clearcoatNormalScale.set(.95, .95);
    m.sheen = on ? .14 : 0;
    m.sheenRoughness = .45;
    m.sheenColor.setHex(0xffffff);
    m.specularIntensity = on ? .42 : .26;
    m.roughness = on ? .78 : .88;
    m.needsUpdate = true;
  }
  M_EDGE.map = on ? edgeMap : null;
  M_EDGE.normalMap = on ? edgeN : null;
  M_EDGE.color.setHex(on ? 0xD9D0B8 : 0xE9E1CC);
  M_EDGE.needsUpdate = true;
}

const AO_GEO = new THREE.PlaneGeometry(1.16, 1.60);
const AO_MAT = new THREE.MeshBasicMaterial({map:aoTex(), transparent:true, depthWrite:false, opacity:AO_OP});
const aoDecals = [];
function card(rank, suit, faceUp, o){
  o = o || {};
  const geo = cardGeoMake(o.thick || THICK, o.bow || 0);
  const front = (rank ? M_FACE(rank, suit) : M_BACK);
  const m = new THREE.Mesh(geo, [front, M_BACK, M_EDGE]);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = faceUp ? 0 : Math.PI;
  const holder = new THREE.Object3D(); holder.rotation.order = "YXZ"; holder.add(m);
  if(o.ao !== false){
    const d = new THREE.Mesh(AO_GEO, AO_MAT.clone());
    d.position.z = -((o.thick || THICK) / 2 + .0006);
    holder.add(d); aoDecals.push(d);
  }
  holder.position.set(o.x || 0, o.y || 0, o.z || 0);
  holder.rotation.set(o.rx === undefined ? -Math.PI / 2 : o.rx, o.ry || 0, o.rz || 0);
  if(o.s) holder.scale.setScalar(o.s);
  scene.add(holder);
  return holder;
}

/* ---- 檯面上那一墩（照 playSlot） ---- */
const TRICK = [[13, 0], [9, 1], [12, 2], [8, 3]];
TRICK.forEach(([r, s], i) => {
  const a = i * Math.PI * 2 / N, p = polar(Math.max(R_PLAY, .72 / (Math.PI * 2 / N)), a);
  card(r, s, true, {x:p.x, z:p.z, y:Y0 + THICK / 2 + i * (THICK + .0015),
    ry:Math.sin(a) * .5 + (((i * 37) % 9) - 4) * .014});
});

/* ---- 對手的手牌：背面朝上的小扇形（照 fanSlot） ---- */
for(let i = 1; i < N; i++){
  const a = ang(i), p = polar(R_FAN, a), sd = side(a), n = 5;
  for(let k = 0; k < n; k++){
    const dx = Math.min(.19, 1.45 / n), off = (k - (n - 1) / 2) * dx;
    card(0, 0, false, {x:p.x + sd.x * off, z:p.z + sd.z * off, y:Y0 + THICK / 2 + k * .0025,
      ry:a + off * .13, s:.74});
  }
}

/* ---- 我的手牌：握在手裡的扇形（照 handSlot） ---- */
const MY = [[14, 0], [13, 3], [11, 1], [9, 2], [8, 0], [7, 3]];
const handHolders = [];
function layHand(bow){
  for(const h of handHolders){ scene.remove(h); }
  handHolders.length = 0;
  const n = MY.length;
  let dx = Math.max(.236, Math.min(.40, 2.6 / n));
  dx = Math.min(dx, 1.40 * HAND_R / (n - 1));
  MY.forEach(([r, s], k) => {
    const th = (k - (n - 1) / 2) * (dx / HAND_R);
    const px = HAND_R * Math.sin(th), drop = HAND_R * (Math.cos(th) - 1);
    const up = k === 2;                               /* 一張推出來：比得到「能出的牌」浮起的樣子 */
    const lift = k * HAND_LIFT + (up ? HAND_POP : 0), rise = up ? HAND_RISE : 0;
    const HP_C = Math.cos(HAND_PITCH), HP_S = Math.sin(HAND_PITCH);
    handHolders.push(card(r, s, true, {
      x:px, y:HAND_Y + (drop + rise) * HP_C - lift * HP_S, z:HAND_Z + (drop + rise) * HP_S + lift * HP_C,
      rx:HAND_PITCH, rz:-th, s:HAND_S, ao:false, bow:bow}));
  });
}
layHand(0);

/* ---- 贏得的墩：右手邊兩疊（照 pileSlot 的觀念，簡化成固定兩疊） ---- */
for(let col = 0; col < 2; col++){
  const a = ang(ME) + 20 * Math.PI / 180 + col * .30 + .24;
  const p = polar(R_PILE, a);
  for(let k = 0; k < 4; k++)
    card(0, 0, false, {x:p.x, z:p.z, y:Y0 + THICK * .7 * k + col * .0026 + .0013,
      ry:a + (((k * 53) % 13) - 6) * .010, s:.70});
}

/* ---- 牌庫與王牌（照 deckSpot） ---- */
const A_DECK = -Math.min(Math.PI / 2 * .55, 50 * Math.PI / 180);
const DS = polar(R_DECK, A_DECK);
const deckAligned = new THREE.Group(), deckJitter = new THREE.Group();
scene.add(deckAligned, deckJitter);
const rndDeck = mulberry32(5);
for(let k = 0; k < 18; k++){
  const y = Y0 + THICK / 2 + k * THICK;
  const a = card(0, 0, false, {x:DS.x, z:DS.z, y, ry:A_DECK + .06, ao:k === 0});
  deckAligned.attach(a);
  /* 一疊真的牌不會每張對齊：每張歪一點、偏一點，整疊的輪廓才不是一塊白磚 */
  const b = card(0, 0, false, {x:DS.x + (rndDeck() - .5) * .022, z:DS.z + (rndDeck() - .5) * .022,
    y, ry:A_DECK + .06 + (rndDeck() - .5) * .022, ao:k === 0});
  deckJitter.attach(b);
}
deckJitter.visible = false;
/* 王牌：斜插在牌庫底下 */
card(11, 2, true, {x:DS.x + .62, z:DS.z + .30, y:Y0 + THICK / 2, ry:A_DECK + 1.25});

/* ================= 骰子與叫墩環 ================= */
const BID_R0 = .92, BID_R1 = 1.06, BID_Z = -.72;
const ringM = new THREE.Mesh(new THREE.RingGeometry(BID_R0, BID_R1, 120, 1),
  new THREE.MeshStandardMaterial({color:0x4b3d23, emissive:0xE3BF6A, emissiveIntensity:.16, roughness:.5, metalness:.55}));
ringM.rotation.x = -Math.PI / 2; ringM.position.set(0, .003, BID_Z); scene.add(ringM);
const DICE = [];
[[3, -.62, .10], [5, .58, -.16]].forEach(([v, dx, dz]) => {
  const d = dieMesh(v);
  d.position.set(dx, DIE_A / 2, BID_Z + dz);
  d.rotation.y = (dx + dz) * 1.7;
  scene.add(d); DICE.push(d);
});
/* 骰子的微結構：bumpMap 換成法線圖（同一份坑的高度圖，細節多一倍），
   再把邊角的透光烘進顏色——象牙骰子側光下邊緣會亮一線 */
const dieNormals = {};
function dieMicro(on){
  for(let v = 1; v <= 6; v++){
    const m = dieFaceMats[v];
    if(!m) continue;
    if(on && !dieNormals[v]){
      const [c, g] = cv2(256, 256);
      g.drawImage(diePaint(v, true).image, 0, 0);
      dieNormals[v] = normalFromHeight(c, 5.5);
    }
    m.bumpMap = on ? null : diePaint(v, true);
    m.normalMap = on ? dieNormals[v] : null;
    if(m.normalScale) m.normalScale.set(1.35, 1.35);
    m.roughness = on ? .22 : .34;
    m.clearcoat = on ? .66 : .42;
    m.clearcoatRoughness = on ? .10 : .20;
    m.sheen = on ? .18 : 0;
    m.needsUpdate = true;
  }
}

/* ================= 書：層板裡的深度變化 ================= */
/* 書櫃是一顆 InstancedMesh。原版每本書深度一樣、齊齊站在層板前緣，
   所以整面牆看起來像一張貼圖。這裡把每本的深度與前後位置各自動一點。 */
const bookMeshes = [];
scene.traverse(o => { if(o.isInstancedMesh) bookMeshes.push(o); });
const bookBase = bookMeshes.map(im => {
  const arr = [];
  const m = new THREE.Matrix4();
  for(let i = 0; i < im.count; i++){ im.getMatrixAt(i, m); arr.push(m.clone()); }
  return arr;
});
function booksVary(on){
  const m = new THREE.Matrix4(), t = new THREE.Matrix4();
  bookMeshes.forEach((im, bi) => {
    const rnd = mulberry32(404 + bi);
    for(let i = 0; i < im.count; i++){
      m.copy(bookBase[bi][i]);
      if(on){
        const dz = (rnd() - .5) * .30, sy = 1 + (rnd() - .5) * .10, sz = .82 + rnd() * .30;
        t.makeTranslation(0, 0, dz);
        m.premultiply(t);
        m.scale(new THREE.Vector3(1, sy, sz));
      }
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  });
}

/* ================= 後處理 ================= */
let comp = null, bokeh = null, grain = null, gtao = null;
const GRAIN = {
  uniforms:{tDiffuse:{value:null}, amount:{value:.034}, seed:{value:0}, vig:{value:.22}},
  vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
  fragmentShader:`
    uniform sampler2D tDiffuse; uniform float amount, seed, vig; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      /* 暗角：鏡頭邊緣自然的衰減，四個角沉下去，視線就被收到桌子中央 */
      vec2 q = vUv - .5;
      float r = length(q * vec2(1.05, 1.25));
      c.rgb *= 1. - vig * smoothstep(.28, .82, r);
      /* 顆粒：暗部多、亮部少——底片就是這樣，亮部的銀粒子已經飽和了 */
      float l = dot(c.rgb, vec3(.299, .587, .114));
      float n = hash(vUv * 1024. + seed) - .5;
      c.rgb += n * amount * (1.2 - l);
      gl_FragColor = c;
    }`
};
function rebuildComposer(){
  if(comp){ comp.dispose(); comp = null; }
  bokeh = null; gtao = null;
  const w = CANVAS.clientWidth, h = CANVAS.clientHeight;
  const need = FX.ao.on || FX.bloom.on || FX.dof.on || FX.grain.on || FX.refine.on;
  if(!need || !w || !h) return;
  const rt = new THREE.WebGLRenderTarget(w * R.getPixelRatio(), h * R.getPixelRatio(),
    {type:THREE.HalfFloatType, samples:4});
  comp = new EffectComposer(R, rt);
  comp.addPass(new RenderPass(scene, camera));
  if(FX.ao.on){
    const g = new GTAOPass(scene, camera, w, h);
    /* 半徑用世界單位：牌與桌布的縫隙只有 .007，半徑開大就整張桌子一起變暗；
       取 .32（約三分之一張牌寬）——牌緣、書櫃層板、椅子與地板的交界剛好吃到 */
    /* 半徑與強度是量出來的：radius .32／scale 1.1 幾乎看不到（AO 緩衝一片白），
       radius .85／scale 2.0 才真的把牌壓回桌面、把書櫃壓出深度。 */
    try{ g.updateGtaoMaterial({radius:.85, distanceExponent:1.2, thickness:1, scale:2.0, samples:16,
      distanceFallOff:1, screenSpaceRadius:false}); }catch(e){}
    try{ g.updatePdMaterial({lumaPhi:10, depthPhi:2, normalPhi:3, radius:4, radiusExponent:1, rings:2, samples:16}); }catch(e){}
    g.blendIntensity = 1.0;
    gtao = g;
    comp.addPass(g);
  }
  if(FX.bloom.on){
    /* 只有真的很亮的東西才該暈開：火、燈罩、銅。threshold 壓在 .82 以上 */
    /* threshold 是「色調映射之前」的線性亮度：.82 會把打亮的牌面整片吃進去，
       牌就整張發光了。門檻拉到 1.3 以上，只有火、燈罩、蠟燭過得去。 */
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), .34, .70, 1.30));
  }
  if(FX.dof.on){
    bokeh = new BokehPass(scene, camera, {focus:camera.position.distanceTo(FOCUS), aperture:.00055, maxblur:.0085});
    comp.addPass(bokeh);
  }
  comp.addPass(new OutputPass());
  if(FX.grain.on){ grain = new ShaderPass(GRAIN); comp.addPass(grain); }
  comp.renderToScreen = !FX.refine.on;
  comp.setSize(w, h);
}

/* ---- 靜止時精算：抖動取樣、疊起來平均 ---- */
/* 這一層不動就不畫（dirty flag），所以「停手之後」有大把時間可以燒。
   每一格把鏡頭抖半個畫素、把結果平均進累積圖——停手兩秒之後，
   鋸齒、陰影雜訊、AO 雜訊全部收斂掉，接近離線算繪的乾淨度。
   壁爐的火會一直跳，但它只佔畫面一小角、而且平均起來就是「火在燒」，不重置累積。 */
const REFINE_MAX = 24;
let accA = null, accB = null, accN = 0;
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const QUAD_VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";
const blendMat = new THREE.ShaderMaterial({uniforms:{tNew:{value:null}, tAcc:{value:null}, k:{value:1}},
  vertexShader:QUAD_VS, depthTest:false, depthWrite:false,
  fragmentShader:`uniform sampler2D tNew, tAcc; uniform float k; varying vec2 vUv;
    void main(){ gl_FragColor = mix(texture2D(tAcc, vUv), texture2D(tNew, vUv), k); }`});
const showMat = new THREE.ShaderMaterial({uniforms:{t:{value:null}}, vertexShader:QUAD_VS,
  depthTest:false, depthWrite:false,
  fragmentShader:"uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }"});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blendMat);
const quadScene = new THREE.Scene(); quadScene.add(quad);
function accTargets(){
  const w = Math.max(1, Math.round(CANVAS.clientWidth * R.getPixelRatio()));
  const h = Math.max(1, Math.round(CANVAS.clientHeight * R.getPixelRatio()));
  if(accA && accA.width === w && accA.height === h) return;
  if(accA) accA.dispose();
  if(accB) accB.dispose();
  const o = {type:THREE.HalfFloatType, depthBuffer:false, stencilBuffer:false};
  accA = new THREE.WebGLRenderTarget(w, h, o);
  accB = new THREE.WebGLRenderTarget(w, h, o);
  accN = 0;
}
const halton = (i, b) => { let f = 1, r = 0; while(i > 0){ f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

/* ================= 每一層 ================= */
const FX = {
  soft:{label:"軟陰影", hint:"換成 VSM 軟陰影、半徑放大 — 椅子與桌子在地板上的影子從硬邊變成散開",
    set(on){
      /* three 0.186 已經把 PCFSoftShadowMap 拿掉了，真正還能「散開」的是 VSM：
         它把深度做成分佈再模糊，radius 與 blurSamples 才真的有作用 */
      R.shadowMap.type = on ? THREE.VSMShadowMap : THREE.PCFShadowMap;
      lamp.shadow.mapSize.set(on ? 2048 : 2048, on ? 2048 : 2048);
      lamp.shadow.radius = on ? 4 : 3;
      lamp.shadow.blurSamples = on ? 12 : 8;
      lamp.shadow.bias = on ? 0 : -.0005;
      lamp.shadow.normalBias = on ? .02 : .012;
      if(lamp.shadow.map){ lamp.shadow.map.dispose(); lamp.shadow.map = null; }
      scene.traverse(o => { if(o.material) [].concat(o.material).forEach(m => m && (m.needsUpdate = true)); });
    }},
  area:{label:"燈罩＝面光源", hint:"頂燈從「一個點」換成「一塊 3.6×3.6 的發光面」，聚光燈降到四成只留影子 — 牌面的反光由小亮斑變成一塊柔光",
    set(on){
      /* 強度是量出來的：面光源很會鋪，area 2.6 配聚光燈降到六成，
         整張圖的平均亮度跟 A 差不到 2%——比的是高光的形狀，不是把畫面打亮 */
      area.intensity = on ? 2.6 : 0;
      lamp.intensity = on ? LAMP_I * .60 : LAMP_I;
    }},
  ao:{label:"接觸陰影 AO", hint:"GTAO：所有「兩個面靠在一起」的地方自己變暗 — 書櫃層板內、牌貼著桌布的一圈、椅腳落地處。整頁最有感的一層",
    set(on){ for(const d of aoDecals) d.visible = !on; rebuildComposer(); }},   /* 有真 AO 就不需要假的貼片 */
  bloom:{label:"光暈", hint:"只讓爐火、燈罩、蠟燭溢出一點光（threshold 1.3，色調映射前的亮度）— 夜間室內的相機一定會有",
    set(){ rebuildComposer(); }},
  dof:{label:"景深", hint:"對焦在桌心，書櫃與地毯散開 — 這是「照片」與「遊戲畫面」差最多的一項",
    set(){ rebuildComposer(); }},
  grain:{label:"暗角＋顆粒", hint:"四角壓暗把視線收回桌面，暗部加一點底片顆粒把數位的乾淨壓掉",
    set(){ rebuildComposer(); }},
  refine:{label:"靜止時精算", hint:"停手之後抖動取樣疊 24 格：鋸齒、陰影與 AO 的雜訊全部收斂 — 不動就不畫的架構才做得到",
    set(){ accN = 0; rebuildComposer(); }},
  micro:{label:"材質微結構", hint:"牌＝亞麻壓紋＋層疊的側邊；桌布＝絨毛法線＋方向性高光；木沿＝導管孔＋銅鑲線；骰子＝法線凹點",
    set(on){
      felt.material = on ? feltMicro : feltBase;
      rim.material = on ? woodMicro : woodBase;
      inlay.visible = on;
      paperMicro(on); dieMicro(on);
    }},
  geo:{label:"幾何細節", hint:"椅子＝滾邊／釘扣凹陷／收分的腳／各歪一點；牌庫＝每張錯開；手牌＝微微拱起；書＝深淺前後不一",
    set(on){
      for(const c of chairsBasic) c.visible = !on;
      for(const c of chairsPlus) c.visible = on;
      deckAligned.visible = !on; deckJitter.visible = on;
      layHand(on ? .012 : 0);
      booksVary(on);
    }}
};
const KEYS = Object.keys(FX);
for(const k of KEYS) FX[k].on = false;

const PRESETS = [
  {k:"A", name:"A 現在", note:"線上現在的樣子", fx:[]},
  {k:"B", name:"B 光影修正", note:"只修光：軟陰影＋面光源＋接觸陰影", fx:["soft", "area", "ao"]},
  {k:"C", name:"C 攝影感", note:"B ＋ 景深、光暈、暗角顆粒、靜止精算", fx:["soft", "area", "ao", "bloom", "dof", "grain", "refine"]},
  {k:"D", name:"D 全套仿真", note:"C ＋ 材質微結構與幾何細節", fx:KEYS.slice()}
];
let preset = "A";

function apply(on){
  for(const k of KEYS){
    const want = on.indexOf(k) >= 0;
    if(FX[k].on !== want){ FX[k].on = want; FX[k].set(want); }
  }
  rebuildComposer();
  accN = 0; dirty = 4;
  paint();
}
function setPreset(k){
  preset = k;
  apply(PRESETS.find(p => p.k === k).fx);
}
function toggle(k){
  FX[k].on = !FX[k].on;
  FX[k].set(FX[k].on);
  rebuildComposer();
  const now = KEYS.filter(x => FX[x].on).sort().join(",");
  const hit = PRESETS.find(p => p.fx.slice().sort().join(",") === now);
  preset = hit ? hit.k : "";
  accN = 0; dirty = 4;
  paint();
}

/* ================= 控制台 ================= */
const elPre = document.getElementById("pre"), elTogs = document.getElementById("togs"),
      elStat = document.getElementById("stat"), elView = document.getElementById("view");
VIEWS.forEach(v => {
  const b = document.createElement("button");
  b.textContent = v.name; b.dataset.k = v.k;
  b.onclick = () => setView(v.k);
  elView.appendChild(b);
});
PRESETS.forEach(p => {
  const b = document.createElement("button");
  b.innerHTML = "<b></b><em></em>";
  b.querySelector("b").textContent = p.name;
  b.querySelector("em").textContent = p.note;
  b.onclick = () => setPreset(p.k);
  b.dataset.k = p.k;
  elPre.appendChild(b);
});
KEYS.forEach(k => {
  const l = document.createElement("label");
  l.className = "tog";
  l.innerHTML = '<input type="checkbox"><span class="tx"><b></b><span></span></span>';
  l.querySelector("b").textContent = FX[k].label;
  l.querySelector(".tx span").textContent = FX[k].hint;
  const cb = l.querySelector("input");
  cb.onchange = () => toggle(k);
  l.dataset.k = k;
  elTogs.appendChild(l);
});
function paint(){
  for(const b of elPre.children) b.classList.toggle("on", b.dataset.k === preset);
  for(const l of elTogs.children){
    const on = FX[l.dataset.k].on;
    l.querySelector("input").checked = on;
    l.classList.toggle("dim", !on);
  }
}

/* ---- 前後對照：拍 A 一張、拍現在這組一張，疊起來用滑桿抹 ---- */
const wipe = document.getElementById("wipe");
async function snapshot(fx){
  const keep = KEYS.filter(k => FX[k].on);
  apply(fx);
  accN = 0;
  /* 精算那一層要等它疊完才拍，不然拍到第一格 */
  const n = FX.refine.on ? REFINE_MAX + 2 : 6;
  for(let i = 0; i < n; i++){ render(); await new Promise(r => requestAnimationFrame(r)); }
  const url = CANVAS.toDataURL("image/png");
  apply(keep);
  return url;
}
document.getElementById("shot").onclick = async () => {
  const btn = document.getElementById("shot");
  btn.textContent = "拍…";
  const mine = KEYS.filter(k => FX[k].on);
  const now = preset || "目前這組";
  const a = await snapshot([]);
  const b = await snapshot(mine);
  document.getElementById("wipeA").src = a;
  document.getElementById("wipeB").src = b;
  document.getElementById("wipeLa").textContent = "A 現在";
  document.getElementById("wipeLb").textContent = now;
  wipe.classList.add("on");
  btn.textContent = "拍前後對照";
};
document.getElementById("wipeX").onclick = () => wipe.classList.remove("on");
document.getElementById("wipeK").oninput = e => {
  wipe.style.setProperty("--k", e.target.value + "%");
};
document.getElementById("reset").onclick = () => setPreset("A");

/* ================= 算繪圈 ================= */
let dirty = 6, last = 0, ms = 0;
function resize(){
  const w = CANVAS.clientWidth, h = CANVAS.clientHeight;
  if(!w || !h) return;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  R.setSize(w, h, false);
  if(comp) comp.setSize(w, h);
  accTargets();
  dirty = 4; accN = 0;
}
window.addEventListener("resize", resize);

function render(){
  const t0 = performance.now();
  if(bokeh) bokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);
  if(grain) grain.uniforms.seed.value = Math.random() * 1000;

  if(FX.refine.on && comp){
    accTargets();
    const w = CANVAS.clientWidth, h = CANVAS.clientHeight;
    const jx = (halton(accN + 1, 2) - .5), jy = (halton(accN + 1, 3) - .5);
    camera.setViewOffset(w, h, jx, jy, w, h);
    comp.render();
    camera.clearViewOffset();
    blendMat.uniforms.tNew.value = comp.readBuffer.texture;
    blendMat.uniforms.tAcc.value = accA.texture;
    blendMat.uniforms.k.value = 1 / (accN + 1);
    quad.material = blendMat;
    R.setRenderTarget(accB); R.render(quadScene, quadCam);
    const tmp = accA; accA = accB; accB = tmp;
    showMat.uniforms.t.value = accA.texture;
    quad.material = showMat;
    R.setRenderTarget(null); R.render(quadScene, quadCam);
    accN++;
  }
  else if(comp) comp.render();
  else R.render(scene, camera);

  ms = ms * .8 + (performance.now() - t0) * .2;
}
function loop(t){
  requestAnimationFrame(loop);
  if(controls.update()) dirty = Math.max(dirty, 2);
  /* 壁爐的火：跟本體一樣每 90ms 抖一下 */
  /* 火一直在跳。它只要求重畫一格，不重置累積——不然精算永遠疊不完，
     而且火平均起來就是「火在燒」，那正是我們要的 */
  let fireMoved = false;
  if(room.tick && t - room.last > 90){ room.last = t; room.tick(t); fireMoved = true; }
  if(dirty > 0){ dirty--; accN = 0; render(); }
  else if(FX.refine.on && accN < REFINE_MAX) render();
  else if(fireMoved) render();
  if(t - last > 400){
    last = t;
    const on = KEYS.filter(k => FX[k].on).length;
    elStat.innerHTML = "<b>" + ms.toFixed(1) + " ms</b>／格　開著 <b>" + on + "</b> 層" +
      (FX.refine.on ? "　精算 <b>" + Math.min(accN, REFINE_MAX) + "/" + REFINE_MAX + "</b>" : "");
  }
}

/* 除錯用：CDP 從外面摸得到，看得到 AO 緩衝本身 */
window.__dbg = {FX, R, scene, camera, controls,
  gtao:() => gtao, GTAOPass,
  aoOutput(k){ if(gtao){ gtao.output = GTAOPass.OUTPUT[k]; dirty = 3; accN = 0; } return gtao ? Object.keys(GTAOPass.OUTPUT) : null; },
  setArea(i, k){ area.intensity = i; lamp.intensity = LAMP_I * k; dirty = 3; accN = 0; },
  gtaoSet(o){ if(gtao) gtao.updateGtaoMaterial(o); dirty = 3; accN = 0; }};

resize();
setView("game");
setPreset("A");
requestAnimationFrame(loop);
setTimeout(() => document.getElementById("load").classList.add("gone"), 240);
