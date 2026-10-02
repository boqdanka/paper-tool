// Creased Paper Poster — full tool code, loaded by the Brik snippet.
import * as THREE from 'https://esm.sh/three@0.170.0';
import { OrbitControls } from 'https://esm.sh/three@0.170.0/addons/controls/OrbitControls.js';
const controls = window.ControlsAPI;

// COLOR FIX: keep hex colors & PNG pixels as raw sRGB values.
// The shaders do their own sRGB->linear (sRGBToLinear) and linear->sRGB
// (pow 1/2.2) conversion. With SRGBColorSpace textures / managed Colors,
// three.js ALSO decodes on the GPU, so colors were linearized twice
// (yellow -> orange, teal -> dark green).
THREE.ColorManagement.enabled = false;

// Version stamp — visible in the browser console, so it's easy to see which
// tool.js Brik actually loaded.
window.PAPER_TOOL_VERSION = '2026-10-02 · v9 (no card cut-through in steps)';
console.info('%c[paper-tool] loaded ' + window.PAPER_TOOL_VERSION, 'background:#ffd23f;color:#111;padding:2px 6px;border-radius:3px');

// Setup render area and Three.js scene
const area = document.querySelector('.tool-canvas-area') || document.body;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, area.clientWidth / area.clientHeight, 0.1, 100);
camera.position.set(0, 0, 7.2);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setSize(area.clientWidth, area.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
renderer.autoClear = false;

// Tone Mapping
renderer.toneMapping = THREE.NoToneMapping;
// Remove canvases left behind by an earlier run of this tool (Brik can re-run
// the code without reloading the page) — two canvases side by side in the flex
// frame is exactly what squeezes/crops the picture to half the width.
document.querySelectorAll('canvas[data-paper-tool]').forEach((c) => c.remove());
renderer.domElement.setAttribute('data-paper-tool', '1');
// Pin the canvas over the whole frame, independent of the flex layout.
Object.assign(renderer.domElement.style, {
  position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block',
});
if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
area.appendChild(renderer.domElement);

// Multi-Pass 2D Compositing Layer Setup (Background & Foreground Overlay)
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const bgScene = new THREE.Scene();
const fgScene = new THREE.Scene();
const quadGeo = new THREE.PlaneGeometry(2, 2);

// Background Shader
const bgVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const bgFragmentShader = `
  uniform vec4 uBgLight;     // xy = pool centre (uv), z = radius (uv height units), w = amount
  uniform vec3 uBgLightMix;  // x = shadow depth, y = highlight, z = warmth
  uniform float uBgAspect;
  uniform int uType; // 0 = none, 1 = solid, 2 = image
  uniform vec3 uColor;
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  uniform vec2 uUvScale;
  uniform float uBlur;
  uniform float uDim;
  varying vec2 vUv;

  void bgBase() {
    if (uType == 0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else if (uType == 1 || uHasTexture < 0.5) {
      gl_FragColor = vec4(uColor, 1.0);
    } else {
      vec2 uv = (vUv - 0.5) * uUvScale + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(uColor, 1.0);
      } else {
        vec4 sum = vec4(0.0);
        float total = 0.0;
        float b = uBlur * 0.020;

        if (b > 0.0001) {
          for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
              vec2 offset = vec2(float(x), float(y)) * b;
              vec2 sampleUv = clamp(uv + offset, 0.0001, 0.9999);
              float weight = 1.0 / (1.0 + length(vec2(float(x), float(y))));
              vec4 tex = texture2D(uTexture, sampleUv);
              sum += tex * weight;
              total += weight;
            }
          }
        } else {
          sum = texture2D(uTexture, uv);
          total = 1.0;
        }
        vec4 avgTex = sum / total;
        vec3 col = mix(uColor, avgTex.rgb, avgTex.a);
        col = mix(col, uColor, clamp(uDim, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    }
  }

  void main() {
    bgBase();
    if (uBgLight.w > 0.0001 && gl_FragColor.a > 0.0) {
      vec2 d = (vUv - uBgLight.xy) * vec2(uBgAspect, 1.0);
      float pool = 1.0 - smoothstep(0.0, 1.0, length(d) / max(0.05, uBgLight.z));
      float dl = mix(-uBgLightMix.x, uBgLightMix.y, pool) * uBgLight.w;
      float tw = clamp(abs(dl) * 3.0, 0.0, 1.0) * uBgLightMix.z;
      vec3 tint = dl > 0.0 ? mix(vec3(1.0), vec3(1.0, 0.95, 0.86), tw)
                           : mix(vec3(1.0), vec3(0.88, 0.93, 1.0), tw);
      gl_FragColor.rgb *= (1.0 + dl) * tint;
    }
  }
`;

const bgUniforms = {
  uType: { value: 1 },
  uColor: { value: new THREE.Color('#121418') },
  uTexture: { value: null },
  uHasTexture: { value: 0.0 },
  uUvScale: { value: new THREE.Vector2(1.0, 1.0) },
  uBlur: { value: 0.0 },
  uDim: { value: 0.0 },
  uBgLight: { value: new THREE.Vector4(0.5, 0.8, 1.0, 0.0) },
  uBgLightMix: { value: new THREE.Vector3(0.3, 0.12, 0.35) },
  uBgAspect: { value: 1.0 },
};

const bgMaterial = new THREE.ShaderMaterial({
  vertexShader: bgVertexShader,
  fragmentShader: bgFragmentShader,
  uniforms: bgUniforms,
  depthTest: false,
  depthWrite: false,
});
const bgQuad = new THREE.Mesh(quadGeo, bgMaterial);
bgScene.add(bgQuad);

// Foreground Shader
const fgVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fgFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uOpacity;
  uniform vec2 uUvScale;
  uniform int uBlendMode; // 0: Normal, 1: Multiply, 2: Screen, 3: Overlay
  varying vec2 vUv;

  void main() {
    vec2 uv = (vUv - 0.5) * uUvScale + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      discard;
    }
    vec4 tex = texture2D(uTexture, uv);
    float alpha = tex.a * uOpacity;
    if (alpha <= 0.0001) {
      discard;
    }

    if (uBlendMode == 1) {
      vec3 col = mix(vec3(1.0), tex.rgb, alpha);
      gl_FragColor = vec4(col, 1.0);
    } else if (uBlendMode == 2) {
      vec3 col = tex.rgb * alpha;
      gl_FragColor = vec4(col, 1.0);
    } else {
      vec3 col = tex.rgb;
      gl_FragColor = vec4(col, alpha);
    }
  }
`;

const fgUniforms = {
  uTexture: { value: null },
  uOpacity: { value: 0.8 },
  uUvScale: { value: new THREE.Vector2(1.0, 1.0) },
  uBlendMode: { value: 0 },
};

const fgMaterial = new THREE.ShaderMaterial({
  vertexShader: fgVertexShader,
  fragmentShader: fgFragmentShader,
  uniforms: fgUniforms,
  depthTest: false,
  depthWrite: false,
  transparent: true,
});
const fgQuad = new THREE.Mesh(quadGeo, fgMaterial);
fgScene.add(fgQuad);

let bgAspect = 1.0;
let fgAspect = 1.0;
let hasBgTexture = false;
let hasFgTexture = false;

function updateBgUvScale() {
  const w = area.clientWidth || window.innerWidth;
  const h = area.clientHeight || window.innerHeight;
  if (w <= 0 || h <= 0) return;
  const ac = w / h;
  const ai = bgAspect > 0 ? bgAspect : ac;
  const scaleMode = controls.get('bgScale') || 'cover';
  const isCover = scaleMode === 'cover';

  let sx = 1.0;
  let sy = 1.0;
  if (isCover) {
    if (ac > ai) {
      sx = 1.0;
      sy = ai / ac;
    } else {
      sx = ac / ai;
      sy = 1.0;
    }
  } else {
    if (ac > ai) {
      sx = ac / ai;
      sy = 1.0;
    } else {
      sx = 1.0;
      sy = ai / ac;
    }
  }
  bgUniforms.uUvScale.value.set(sx, sy);
}

function updateFgUvScale() {
  const w = area.clientWidth || window.innerWidth;
  const h = area.clientHeight || window.innerHeight;
  if (w <= 0 || h <= 0) return;
  const ac = w / h;
  const ai = fgAspect > 0 ? fgAspect : ac;
  const scaleMode = controls.get('fgScale') || 'cover';
  const isCover = scaleMode === 'cover';

  let sx = 1.0;
  let sy = 1.0;
  if (isCover) {
    if (ac > ai) {
      sx = 1.0;
      sy = ai / ac;
    } else {
      sx = ac / ai;
      sy = 1.0;
    }
  } else {
    if (ac > ai) {
      sx = ac / ai;
      sy = 1.0;
    } else {
      sx = 1.0;
      sy = ai / ac;
    }
  }
  fgUniforms.uUvScale.value.set(sx, sy);
}

function updateForegroundBlending() {
  const mode = controls.get('fgBlendMode') || 'normal';
  if (mode === 'multiply') {
    fgUniforms.uBlendMode.value = 1;
    fgMaterial.blending = THREE.CustomBlending;
    fgMaterial.blendEquation = THREE.AddEquation;
    fgMaterial.blendSrc = THREE.DstColorFactor;
    fgMaterial.blendDst = THREE.ZeroFactor;
    fgMaterial.transparent = false;
  } else if (mode === 'screen') {
    fgUniforms.uBlendMode.value = 2;
    fgMaterial.blending = THREE.CustomBlending;
    fgMaterial.blendEquation = THREE.AddEquation;
    fgMaterial.blendSrc = THREE.OneMinusDstColorFactor;
    fgMaterial.blendDst = THREE.OneFactor;
    fgMaterial.transparent = false;
  } else if (mode === 'overlay') {
    fgUniforms.uBlendMode.value = 3;
    fgMaterial.blending = THREE.CustomBlending;
    fgMaterial.blendEquation = THREE.AddEquation;
    fgMaterial.blendSrc = THREE.DstColorFactor;
    fgMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    fgMaterial.transparent = true;
  } else {
    fgUniforms.uBlendMode.value = 0;
    fgMaterial.blending = THREE.NormalBlending;
    fgMaterial.transparent = true;
  }
  fgMaterial.needsUpdate = true;
}

function updateBackgroundSettings() {
  const bgType = controls.get('bgType') || 'solid';
  if (bgType === 'none') {
    bgUniforms.uType.value = 0;
  } else if (bgType === 'image') {
    bgUniforms.uType.value = 2;
  } else {
    bgUniforms.uType.value = 1;
  }
  const colHex = controls.get('bgColor') || '#121418';
  bgUniforms.uColor.value.set(colHex);
  bgUniforms.uBlur.value = controls.get('bgBlur') ?? 0.0;
  bgUniforms.uDim.value = controls.get('bgDim') ?? 0.0;
  updateBgUvScale();
}

function updateForegroundSettings() {
  fgUniforms.uOpacity.value = controls.get('fgOpacity') ?? 0.8;
  updateForegroundBlending();
  updateFgUvScale();
}

// Stage Group for Cinematic Orbit & Sway
const mainStage = new THREE.Group();
scene.add(mainStage);

// Platform Globals
window.renderer = renderer;
window.scene = scene;
window.camera = camera;

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 2.0;
orbitControls.maxDistance = 18.0;
orbitControls.maxPolarAngle = Math.PI * 0.85;

// Camera state persistence & Reset System
const DEFAULT_CAM_POS = new THREE.Vector3(0, 0, 7.2);
const DEFAULT_CAM_TARGET = new THREE.Vector3(0, 0, 0);
const DEFAULT_CAM_ZOOM = 1.0;

let isCamResetting = false;
let camResetStartTime = 0;
const CAM_RESET_DURATION = 0.45;
const camStartPos = new THREE.Vector3();
const camStartTarget = new THREE.Vector3();
let camStartZoom = 1.0;

let stageOrbitAngle = 0.0;

function applyCamera(cam) {
  if (isCamResetting) return;
  if (!cam || !cam.position) return;
  camera.position.fromArray(cam.position);
  orbitControls.target.fromArray(cam.target || [0, 0, 0]);
  if (typeof cam.zoom === 'number') {
    camera.zoom = cam.zoom;
    camera.updateProjectionMatrix();
  }
  orbitControls.update();
}
applyCamera(controls.get('canvasState'));
controls.onChange('canvasState', applyCamera);
orbitControls.addEventListener('end', () => {
  if (isCamResetting) return;
  controls.set('canvasState', {
    version: 1,
    position: camera.position.toArray(),
    target: orbitControls.target.toArray(),
    zoom: camera.zoom,
  });
});

function triggerCameraReset() {
  camStartPos.copy(camera.position);
  camStartTarget.copy(orbitControls.target);
  camStartZoom = camera.zoom;
  camResetStartTime = performance.now();
  isCamResetting = true;
  stageOrbitAngle = 0.0;
}

controls.onAction('resetCamera', () => {
  triggerCameraReset();
});

// =========================================================================
// EASING & TWEEN ENGINE
// =========================================================================
function easeInOutSine(x) {
  return -(Math.cos(Math.PI * THREE.MathUtils.clamp(x, 0.0, 1.0)) - 1.0) / 2.0;
}

function createTweenState(initialVal = 0.0, baseDuration = 1.2) {
  return {
    current: initialVal,
    from: initialVal,
    to: initialVal,
    elapsed: 0.0,
    baseDuration: baseDuration,
    active: false,
  };
}

function startTweenTo(tween, targetVal) {
  if (Math.abs(tween.to - targetVal) < 0.0001 && !tween.active) return;
  tween.from = tween.current;
  tween.to = targetVal;
  tween.elapsed = 0.0;
  tween.active = true;
}

function updateTween(tween, delta, speed) {
  if (!tween.active) return tween.current;
  const duration = Math.max(0.08, tween.baseDuration / Math.max(0.1, speed));
  tween.elapsed += delta;
  const t = Math.min(1.0, tween.elapsed / duration);
  const ease = easeInOutSine(t);
  tween.current = THREE.MathUtils.lerp(tween.from, tween.to, ease);
  if (t >= 1.0) {
    tween.current = tween.to;
    tween.active = false;
  }
  return tween.current;
}

// =========================================================================
// MOUSE & CLICK INTERACTION SYSTEM
// =========================================================================
const mouseTarget = new THREE.Vector2(0, 0);
const mouseCurrent = new THREE.Vector2(0, 0);

let pointerDownPos = { x: 0, y: 0, time: 0 };
let isPointerDragging = false;

// Sequential Compound 2-Stage Fold State Machine
let foldCycleCount = 0;
let autoFoldTime = 0.0;
let lastAutoFoldCycleIdx = -1;

let foldAxis1 = 0.0;
let foldSign1 = 1.0;
let foldSign2 = 1.0;
let foldZSign2 = 1.0;

function setupNextFoldCycleSigns() {
  const isRandomSeq = controls.get('randomizeFoldSequence');
  if (isRandomSeq) {
    foldAxis1 = Math.random() < 0.5 ? 0.0 : 1.0;
    foldSign1 = Math.random() < 0.5 ? 1.0 : -1.0;
    foldSign2 = Math.random() < 0.5 ? 1.0 : -1.0;
    foldZSign2 = 1.0;
  } else {
    foldCycleCount++;
    const step = foldCycleCount % 4;
    if (step === 0) { foldAxis1 = 0.0; foldSign1 = 1.0; foldSign2 = 1.0; foldZSign2 = 1.0; }
    else if (step === 1) { foldAxis1 = 0.0; foldSign1 = -1.0; foldSign2 = -1.0; foldZSign2 = 1.0; }
    else if (step === 2) { foldAxis1 = 1.0; foldSign1 = 1.0; foldSign2 = 1.0; foldZSign2 = 1.0; }
    else { foldAxis1 = 1.0; foldSign1 = -1.0; foldSign2 = -1.0; foldZSign2 = 1.0; }
  }
}
setupNextFoldCycleSigns();

// Interactive Step Progress & Tweens for Click-Trigger Mode
let clickFoldStep = 0;
const foldTween1 = createTweenState(0.0, 1.3);
const foldTween2 = createTweenState(0.0, 1.3);

let clickPeelStep = 0;
const peelTween = createTweenState(0.25, 1.4);

let clickCrumpleStep = 0;
const crumpleTween = createTweenState(0.0, 1.4);

let floatClickWave = 0.0;
let floatAnimTime = 0.0;
let autoPeelTime = 0.0;
let autoCrumpleTime = 0.0;
let lastAutoCrumpleCycleIdx = -1;

function getIdleTease(tween, time, amplitude = 0.038, freq = 2.4) {
  if (tween.active) return 0.0;
  const target = tween.to;
  if (target <= 0.05) {
    return (0.5 - 0.5 * Math.cos(time * freq)) * amplitude;
  } else if (target >= 0.95) {
    return -(0.5 - 0.5 * Math.cos(time * freq)) * amplitude;
  } else {
    return Math.sin(time * freq) * (amplitude * 0.65);
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  const pos = CanvasRuntimeAPI.getMousePos(e);
  pointerDownPos = { x: pos.x, y: pos.y, time: performance.now() };
  isPointerDragging = false;
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const pos = CanvasRuntimeAPI.getMousePos(e);
  const w = area.clientWidth || window.innerWidth;
  const h = area.clientHeight || window.innerHeight;
  mouseTarget.x = (pos.x / w) * 2 - 1;
  mouseTarget.y = -(pos.y / h) * 2 + 1;

  if (Math.hypot(pos.x - pointerDownPos.x, pos.y - pointerDownPos.y) > 8) {
    isPointerDragging = true;
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const pos = CanvasRuntimeAPI.getMousePos(e);
  const dt = performance.now() - pointerDownPos.time;
  const dist = Math.hypot(pos.x - pointerDownPos.x, pos.y - pointerDownPos.y);

  if (dist < 8 && dt < 400 && !isPointerDragging) {
    handleCanvasClick();
  }
});

renderer.domElement.addEventListener('pointerleave', () => {
  mouseTarget.set(0, 0);
});

function handleCanvasClick() {
  const mode = controls.get('mode');
  const trigger = controls.get('animTrigger') || 'auto';

  if (trigger === 'click') {
    if (mode === 'fold') {
      clickFoldStep = (clickFoldStep + 1) % 5;
      if (clickFoldStep === 1) {
        setupNextFoldCycleSigns();
        startTweenTo(foldTween1, 1.0);
        startTweenTo(foldTween2, 0.0);
      } else if (clickFoldStep === 2) {
        startTweenTo(foldTween1, 1.0);
        startTweenTo(foldTween2, 1.0);
      } else if (clickFoldStep === 3) {
        startTweenTo(foldTween1, 1.0);
        startTweenTo(foldTween2, 0.0);
      } else {
        clickFoldStep = 0;
        startTweenTo(foldTween1, 0.0);
        startTweenTo(foldTween2, 0.0);
      }
    } else if (mode === 'peel') {
      const numLayers = parseInt(controls.get('numLayers')) || 4;
      const peelable = Math.max(1, numLayers - 1);
      clickPeelStep = (clickPeelStep + 1) % (peelable + 1);
      startTweenTo(peelTween, clickPeelStep / peelable);
    } else if (mode === 'crumple') {
      clickCrumpleStep = (clickCrumpleStep + 1) % 3;
      if (clickCrumpleStep === 0) {
        startTweenTo(crumpleTween, 0.0);
      } else if (clickCrumpleStep === 1) {
        startTweenTo(crumpleTween, 0.55);
      } else {
        startTweenTo(crumpleTween, 1.0);
      }
    } else if (mode === 'float') {
      floatClickWave = 1.0;
    }
  } else {
    if (mode === 'float') {
      floatClickWave = 1.0;
    }
  }
}

// =========================================================================
// 1. STUDIO LIGHTING ENVIRONMENT
// =========================================================================
function createStudioEnvironment() {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512;
  envCanvas.height = 256;
  const envCtx = envCanvas.getContext('2d');

  const bgGrad = envCtx.createLinearGradient(0, 0, 0, 256);
  bgGrad.addColorStop(0.0, '#fbf9f6');
  bgGrad.addColorStop(0.4, '#e9e3da');
  bgGrad.addColorStop(0.8, '#cfc7ba');
  bgGrad.addColorStop(1.0, '#9a9287');
  envCtx.fillStyle = bgGrad;
  envCtx.fillRect(0, 0, 512, 256);

  const keyGlow = envCtx.createRadialGradient(190, 70, 5, 190, 70, 120);
  keyGlow.addColorStop(0, 'rgba(255, 250, 240, 1.0)');
  keyGlow.addColorStop(0.5, 'rgba(255, 240, 220, 0.6)');
  keyGlow.addColorStop(1, 'rgba(255, 240, 220, 0.0)');
  envCtx.fillStyle = keyGlow;
  envCtx.fillRect(0, 0, 512, 256);

  const fillGlow = envCtx.createRadialGradient(410, 110, 5, 410, 110, 140);
  fillGlow.addColorStop(0, 'rgba(235, 245, 255, 0.8)');
  fillGlow.addColorStop(0.6, 'rgba(220, 235, 255, 0.3)');
  fillGlow.addColorStop(1, 'rgba(220, 235, 255, 0.0)');
  envCtx.fillStyle = fillGlow;
  envCtx.fillRect(0, 0, 512, 256);

  const envTexture = new THREE.CanvasTexture(envCanvas);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;
  const envRenderTarget = pmremGenerator.fromEquirectangular(envTexture);
  pmremGenerator.dispose();
  return envRenderTarget.texture;
}

try {
  scene.environment = createStudioEnvironment();
} catch (e) {
  // Fallback
}

// =========================================================================
// 2. PROCEDURAL PAPER MAPS ENGINE (Lightweight 2D Baked Bump & Normal Engine)
// =========================================================================
function makeSeededRng(seed) {
  let s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  s = s - Math.floor(s);
  return function() {
    s = Math.sin(s * 91.3458 + 47.1234) * 43758.5453;
    s = s - Math.floor(s);
    return s;
  };
}

function hash2D(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3.0 - 2.0 * fx);
  const sy = fy * fy * (3.0 - 2.0 * fx);

  const n00 = hash2D(i, j);
  const n10 = hash2D(i + 1, j);
  const n01 = hash2D(i, j + 1);
  const n11 = hash2D(i + 1, j + 1);

  return (n00 * (1.0 - sx) + n10 * sx) * (1.0 - sy) + (n01 * (1.0 - sx) + n11 * sx) * sy;
}

function getEdgePoint(side, t, size) {
  if (side === 0) return { x: t * size, y: 0 };
  if (side === 1) return { x: size, y: t * size };
  if (side === 2) return { x: t * size, y: size };
  return { x: 0, y: t * size };
}

function getStockTypeCode(preset) {
  if (preset === 'lightly_crumpled') return 4.0;
  if (preset === 'spot_varnish') return 5.0;
  return 0.0;
}

function getStockSpecParams(preset) {
  if (preset === 'lightly_crumpled') {
    return { power: 22.0, intensity: 0.16, sheen: 0.14, fleck: 0.0, grainScale: 1.0, bumpMult: 1.45 };
  }
  if (preset === 'spot_varnish') {
    return { power: 10.0, intensity: 0.10, sheen: 0.08, fleck: 0.0, grainScale: 9.5, bumpMult: 2.2 };
  }
  return { power: 18.0, intensity: 0.22, sheen: 0.20, fleck: 0.0, grainScale: 9.5, bumpMult: 2.6 };
}

function getStockRoughnessScalar(preset, baseVal) {
  if (preset === 'smooth_matte') return Math.max(0.70, baseVal * 0.98);
  if (preset === 'lightly_crumpled') return Math.max(0.75, baseVal);
  if (preset === 'spot_varnish') return Math.max(0.92, baseVal);
  return baseVal;
}

function generatePaperMaps(preset, foldsFactor = 1.6, seed = 42) {
  const size = 512;
  const rng = makeSeededRng(seed);

  const albCanvas = document.createElement('canvas');
  albCanvas.width = size;
  albCanvas.height = size;
  const albCtx = albCanvas.getContext('2d');

  albCtx.fillStyle = 'rgb(249, 246, 241)';
  albCtx.fillRect(0, 0, size, size);

  const normCanvas = document.createElement('canvas');
  normCanvas.width = size;
  normCanvas.height = size;
  const normCtx = normCanvas.getContext('2d');
  const normImg = normCtx.createImageData(size, size);
  const normData = normImg.data;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d');
  const roughImg = roughCtx.createImageData(size, size);
  const roughData = roughImg.data;

  const height = new Float32Array(size * size);
  const stress = new Float32Array(size * size);

  // 1. Base paper fiber micro-relief + broad low-frequency tactile undulation
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n1 = smoothNoise(x * 0.14, y * 0.14);
      const n2 = smoothNoise(x * 0.42, y * 0.42);
      const micro = (hash2D(x, y) - 0.5) * 0.16;
      
      let broadWarp = 0.0;
      if (preset === 'lightly_crumpled') {
        const bw1 = smoothNoise(x * 0.010 + seed * 0.08, y * 0.010 + seed * 0.08);
        const bw2 = smoothNoise(x * 0.024 + 19.3, y * 0.024 + 31.7);
        broadWarp = (bw1 * 0.65 + bw2 * 0.35 - 0.5) * 0.09 * Math.min(1.6, foldsFactor * 0.80);
      }
      
      height[y * size + x] = (n1 * 0.55 + n2 * 0.35 + micro * 0.10) * 0.07 + broadWarp;
    }
  }

  // 2. Fine organic fiber strands
  albCtx.lineWidth = 1.0;
  const fiberCount = 130;
  for (let f = 0; f < fiberCount; f++) {
    const startX = rng() * size;
    const startY = rng() * size;
    const length = 6 + rng() * 22;
    const angle = rng() * Math.PI * 2;
    const endX = startX + Math.cos(angle) * length;
    const endY = startY + Math.sin(angle) * length;
    const fiberAlpha = 0.04 + rng() * 0.08;
    const isDark = rng() < 0.25;
    albCtx.strokeStyle = isDark ? `rgba(60, 50, 40, ${fiberAlpha * 0.6})` : `rgba(255, 255, 255, ${fiberAlpha})`;
    albCtx.beginPath();
    albCtx.moveTo(startX, startY);
    albCtx.lineTo(endX, endY);
    albCtx.stroke();
  }

  // 3. Lightly Crumpled Paper: Realistic, rich, shallow diagonal & cross creases
  if (preset === 'lightly_crumpled') {
    const intensity = Math.min(1.8, 0.40 + foldsFactor * 0.32);
    const lines = [];

    function addCreasePath(pts, baseWidth, baseDepth, sgn, tilt) {
      for (let s = 0; s < pts.length - 1; s++) {
        const pA = pts[s];
        const pB = pts[s + 1];
        const segLen = Math.hypot(pB.x - pA.x, pB.y - pA.y);
        if (segLen < 2) continue;
        const segWidth = baseWidth * (0.85 + rng() * 0.30);
        const segDepth = baseDepth * (0.85 + rng() * 0.30);
        const segTilt = tilt + (rng() - 0.5) * 0.20;
        lines.push({
          x1: pA.x, y1: pA.y,
          x2: pB.x, y2: pB.y,
          width: segWidth,
          depth: segDepth,
          sign: sgn,
          tilt: segTilt
        });
      }
    }

    // Tier A: Major Long Multi-Segment Diagonal Creases (2 to 5 lines)
    const numMajor = Math.max(2, Math.min(5, Math.round(1.8 + foldsFactor * 0.9)));
    const majorJunctions = [];

    for (let i = 0; i < numMajor; i++) {
      const side1 = Math.floor(rng() * 4);
      const side2 = (side1 + 1 + Math.floor(rng() * 3)) % 4;

      const pStart = getEdgePoint(side1, 0.10 + rng() * 0.80, size);
      const pEnd = getEdgePoint(side2, 0.10 + rng() * 0.80, size);

      const numKinks = 2 + Math.floor(rng() * 3);
      const pathPts = [pStart];

      for (let k = 1; k <= numKinks; k++) {
        const frac = k / (numKinks + 1);
        const interpX = pStart.x + (pEnd.x - pStart.x) * frac;
        const interpY = pStart.y + (pEnd.y - pStart.y) * frac;
        const offset = (rng() - 0.5) * (size * 0.16);
        const perpX = -(pEnd.y - pStart.y) / (Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y) || 1) * offset;
        const perpY = (pEnd.x - pStart.x) / (Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y) || 1) * offset;

        const kPt = { x: interpX + perpX, y: interpY + perpY };
        pathPts.push(kPt);
        majorJunctions.push(kPt);
      }
      pathPts.push(pEnd);

      const sgn = rng() > 0.45 ? 1.0 : -1.0;
      const tilt = (rng() - 0.5) * 0.40;
      const w = (2.6 + rng() * 3.4) * (0.85 + foldsFactor * 0.15);
      const d = (0.16 + rng() * 0.16) * intensity;

      addCreasePath(pathPts, w, d, sgn, tilt);
    }

    // Tier B: Secondary Branching & Crossing Creases (4 to 10 lines)
    const numSecondary = Math.max(3, Math.min(10, Math.round(3.0 + foldsFactor * 1.8)));
    for (let j = 0; j < numSecondary; j++) {
      let origin;
      if (majorJunctions.length > 0 && rng() > 0.35) {
        origin = majorJunctions[Math.floor(rng() * majorJunctions.length)];
      } else {
        origin = { x: size * (0.15 + rng() * 0.70), y: size * (0.15 + rng() * 0.70) };
      }

      const branchAngle = (rng() * Math.PI * 2);
      const branchLen = size * (0.12 + rng() * 0.28);
      const numSegs = 2 + Math.floor(rng() * 2);
      const bPts = [{ x: origin.x, y: origin.y }];

      let currX = origin.x;
      let currY = origin.y;
      for (let s = 1; s <= numSegs; s++) {
        const a = branchAngle + (rng() - 0.5) * 0.55;
        currX += Math.cos(a) * (branchLen / numSegs);
        currY += Math.sin(a) * (branchLen / numSegs);
        bPts.push({ x: currX, y: currY });
      }

      const sgn = rng() > 0.50 ? 1.0 : -1.0;
      const tilt = (rng() - 0.5) * 0.35;
      const w = (1.8 + rng() * 2.2) * (0.85 + foldsFactor * 0.15);
      const d = (0.10 + rng() * 0.12) * intensity;

      addCreasePath(bPts, w, d, sgn, tilt);
    }

    // Tier C: Minor Localized Micro-Wrinkles & Compression Lines
    const numMicro = Math.max(5, Math.min(18, Math.round(5.0 + foldsFactor * 2.8)));
    for (let m = 0; m < numMicro; m++) {
      const cx = size * (0.08 + rng() * 0.84);
      const cy = size * (0.08 + rng() * 0.84);
      const mAngle = (rng() * Math.PI * 2);
      const mLen = size * (0.04 + rng() * 0.12);

      const x1 = cx - Math.cos(mAngle) * (mLen * 0.5);
      const y1 = cy - Math.sin(mAngle) * (mLen * 0.5);
      const x2 = cx + Math.cos(mAngle) * (mLen * 0.5);
      const y2 = cy + Math.sin(mAngle) * (mLen * 0.5);

      const sgn = rng() > 0.48 ? 1.0 : -1.0;
      const tilt = (rng() - 0.5) * 0.30;
      const w = 1.2 + rng() * 1.8;
      const d = (0.05 + rng() * 0.08) * intensity;

      lines.push({
        x1, y1, x2, y2,
        width: w,
        depth: d,
        sign: sgn,
        tilt: tilt
      });
    }

    // Rasterize creases into height buffer
    for (const line of lines) {
      const lx = line.x2 - line.x1;
      const ly = line.y2 - line.y1;
      const lenSq = lx * lx + ly * ly;
      if (lenSq < 1) continue;
      const len = Math.sqrt(lenSq);
      const unx = -ly / len;
      const uny = lx / len;

      const maxReach = line.width * 3.6;
      const pad = maxReach + 1.5;
      const minX = Math.max(0, Math.floor(Math.min(line.x1, line.x2) - pad));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(line.x1, line.x2) + pad));
      const minY = Math.max(0, Math.floor(Math.min(line.y1, line.y2) - pad));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(line.y1, line.y2) + pad));

      const wHalf = Math.max(0.7, line.width);
      const depth = line.depth;
      const sgn = line.sign;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const t = Math.max(0.0, Math.min(1.0, ((x - line.x1) * lx + (y - line.y1) * ly) / lenSq));
          const sDist = (x - line.x1) * unx + (y - line.y1) * uny;
          const dist = Math.abs(sDist);

          if (dist < maxReach) {
            const normDist = dist / wHalf;
            const ridge = Math.exp(-normDist * 1.6) * depth * sgn;
            const slopeFactor = sDist > 0 ? (1.0 + line.tilt) : (1.0 - line.tilt);
            const slope = Math.max(0.0, 1.0 - dist / maxReach) * depth * 0.28 * sgn * slopeFactor;

            const taper = Math.sin(t * Math.PI);
            const totalCreaseH = (ridge * 0.70 + slope * 0.30) * taper;

            const idx = y * size + x;
            height[idx] += totalCreaseH;

            if (dist < 1.8) {
              const strVal = Math.exp(-dist * 1.4) * (0.22 + 0.40 * Math.abs(sgn)) * taper;
              if (strVal > stress[idx]) stress[idx] = strVal;
            }
          }
        }
      }
    }
  }

  // 4. Subtle cellulose fiber stress in albedo (whitening at crease ridges)
  const albImg = albCtx.getImageData(0, 0, size, size);
  const albData = albImg.data;
  for (let i = 0; i < size * size; i++) {
    const s = stress[i];
    if (s > 0.01) {
      const idx = i * 4;
      albData[idx] = Math.min(255, albData[idx] + Math.floor(s * 10));
      albData[idx + 1] = Math.min(255, albData[idx + 1] + Math.floor(s * 10));
      albData[idx + 2] = Math.min(255, albData[idx + 2] + Math.floor(s * 8));
    }
  }
  albCtx.putImageData(albImg, 0, 0);

  // 5. Convert Height to Tangent-Space Normal Map & Roughness
  const bumpMult = preset === 'lightly_crumpled' ? (1.45 * (0.80 + foldsFactor * 0.22)) : 2.6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;
      const yPrev = (y - 1 + size) % size;
      const yNext = (y + 1) % size;

      const dhdx = (height[y * size + xNext] - height[y * size + xPrev]) * bumpMult;
      const dhdy = (height[yNext * size + x] - height[yPrev * size + x]) * bumpMult;

      let nx = -dhdx;
      let ny = -dhdy;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      nx /= len;
      ny /= len;
      nz /= len;

      normData[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
      normData[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      normData[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      normData[idx + 3] = 255;

      const h = height[y * size + x];
      const str = stress[y * size + x];
      const baseR = preset === 'spot_varnish' ? 240 : (preset === 'lightly_crumpled' ? 218 : 215);
      const rVal = Math.max(0, Math.min(255, Math.floor(baseR + h * 12 - str * 18 + (hash2D(x, y) - 0.5) * 10)));
      roughData[idx] = rVal;
      roughData[idx + 1] = rVal;
      roughData[idx + 2] = rVal;
      roughData[idx + 3] = 255;
    }
  }

  normCtx.putImageData(normImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const albTex = new THREE.CanvasTexture(albCanvas);
  albTex.wrapS = THREE.RepeatWrapping;
  albTex.wrapT = THREE.RepeatWrapping;
  albTex.colorSpace = THREE.NoColorSpace;
  albTex.generateMipmaps = true;

  const normTex = new THREE.CanvasTexture(normCanvas);
  normTex.wrapS = THREE.RepeatWrapping;
  normTex.wrapT = THREE.RepeatWrapping;
  normTex.colorSpace = THREE.NoColorSpace;
  normTex.generateMipmaps = true;

  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = THREE.RepeatWrapping;
  roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.colorSpace = THREE.NoColorSpace;
  roughTex.generateMipmaps = true;

  return { albedo: albTex, normal: normTex, roughness: roughTex };
}

const paperPresetsCache = {
  smooth_matte: generatePaperMaps('smooth_matte'),
  lightly_crumpled: generatePaperMaps('lightly_crumpled', controls.get('crumpleTextureFolds') ?? 1.7, 42),
  spot_varnish: generatePaperMaps('spot_varnish'),
};

const tileMapsCache = {};
function getTilePaperMaps(preset, foldsFactor, tileIdx) {
  if (preset !== 'lightly_crumpled') {
    return paperPresetsCache[preset] || paperPresetsCache.smooth_matte;
  }
  const key = `${preset}_${foldsFactor}_${tileIdx}`;
  if (!tileMapsCache[key]) {
    tileMapsCache[key] = generatePaperMaps('lightly_crumpled', foldsFactor, 42 + tileIdx * 29);
  }
  return tileMapsCache[key];
}

let activePaperPreset = controls.get('paperTexture') || 'lightly_crumpled';
let activePaperAlbedoMap = (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte).albedo;
let activePaperNormalMap = (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte).normal;
let activePaperRoughnessMap = (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte).roughness;

// =========================================================================
// 3. GRAPHIC POSTER TEXTURES
// =========================================================================
function createDefaultPosterTexture(index = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1448;
  const ctx = canvas.getContext('2d');

  if (index === 0) {
    ctx.fillStyle = '#14171d';
    ctx.fillRect(0, 0, 1024, 1448);

    ctx.fillStyle = '#e11d48';
    ctx.fillRect(72, 72, 880, 520);

    ctx.fillStyle = '#faf8f5';
    ctx.beginPath();
    ctx.arc(512, 332, 170, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#14171d';
    ctx.font = '900 68px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('POSTER', 512, 325);
    ctx.font = '700 38px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('& STUDIO 3D', 512, 375);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#faf8f5';
    ctx.font = '800 48px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('TACTILE PAPER SIMULATOR', 72, 660);

    ctx.font = '400 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#a8a29e';
    ctx.fillText('FOLD • MULTI-LAYER PEEL • FLOATING TILES • CRUMPLED PAPER', 72, 710);
    ctx.fillText('PHYSICAL CELLULOSE DEFORMATION & REALISTIC CREASE WEAR', 72, 745);

    ctx.strokeStyle = 'rgba(250, 248, 245, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(72, 785);
    ctx.lineTo(952, 785);
    ctx.moveTo(72, 1040);
    ctx.lineTo(952, 1040);
    ctx.stroke();

    ctx.fillStyle = 'rgba(225, 29, 72, 0.15)';
    ctx.fillRect(72, 820, 425, 190);
    ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
    ctx.fillRect(527, 820, 425, 190);

    ctx.fillStyle = '#faf8f5';
    ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('SECTION 01: MAP FOLD', 96, 865);
    ctx.font = '400 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#d6d3d1';
    ctx.fillText('Multi-directional centered fold with', 96, 905);
    ctx.fillText('zero drift and crisp cellulose peaks.', 96, 935);

    ctx.fillStyle = '#faf8f5';
    ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('SECTION 02: CRUMPLED POSTER', 551, 865);
    ctx.font = '400 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#d6d3d1';
    ctx.fillText('Planar origami creases & facet folds with', 551, 905);
    ctx.fillText('zero distortion and sharp paper edges.', 551, 935);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(72, 1070, 880, 290);

    ctx.fillStyle = '#faf8f5';
    ctx.font = '800 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('INTERNATIONAL POSTER SERIES 2025', 108, 1160);
    ctx.font = '400 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('DYNAMIC STUDIO LIGHTING • HIGH DENSITY CELLULOSE MATERIAL', 108, 1210);
    ctx.fillText('THREE.JS PHOTOREALISTIC SHADER ENGINE', 108, 1245);
  } else if (index === 1) {
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(0, 0, 1024, 1448);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(72, 72, 880, 380);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '900 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LAYER 02', 512, 270);
    ctx.font = '600 28px sans-serif';
    ctx.fillText('CONCEALED DESIGN DISCOVERY', 512, 330);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 38px sans-serif';
    ctx.fillText('CONTINUOUS LAYER PEELING', 72, 530);
    ctx.font = '400 22px sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('Staggered sequential revelation across all stacked posters.', 72, 580);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(72, 680, 880, 680);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '800 42px sans-serif';
    ctx.fillText('HIGH CONTRAST BLUEPRINT', 110, 780);
  } else if (index === 2) {
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(0, 0, 1024, 1448);
    ctx.fillStyle = '#fde047';
    ctx.font = '900 60px sans-serif';
    ctx.fillText('LAYER 03 : STRATUM', 80, 180);
    ctx.fillStyle = '#ffedd5';
    ctx.font = '400 24px sans-serif';
    ctx.fillText('Foundational poster pasted onto the studio board.', 80, 240);
    ctx.fillStyle = '#451a03';
    ctx.fillRect(80, 320, 864, 1040);
    ctx.fillStyle = '#fdba74';
    ctx.font = '700 36px sans-serif';
    ctx.fillText('RAW URBAN WALL ARCHIVE', 120, 420);
  } else {
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, 0, 1024, 1448);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(72, 72, 880, 420);
    ctx.fillStyle = '#064e3b';
    ctx.font = '900 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LAYER 04', 512, 290);
    ctx.fillStyle = '#ecfdf5';
    ctx.font = '700 38px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('BOTANICAL ABSTRACT', 72, 560);
    ctx.fillStyle = '#022c22';
    ctx.fillRect(72, 660, 880, 700);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

const defaultTextures = [
  createDefaultPosterTexture(0),
  createDefaultPosterTexture(1),
  createDefaultPosterTexture(2),
  createDefaultPosterTexture(3),
  createDefaultPosterTexture(4),
];

let loadedImageTextures = [];
let hasCustomImages = false;

// =========================================================================
// 4. STUDIO DIRECTIONAL LIGHTS
// =========================================================================
const ambientLight = new THREE.HemisphereLight(0xfffdfa, 0xd2cbbf, 0.95);
scene.add(ambientLight);

const keyLightTarget = new THREE.Object3D();
keyLightTarget.position.set(0, 0, 0);
scene.add(keyLightTarget);

const keyLight = new THREE.DirectionalLight(0xfff8ee, 2.4);
keyLight.position.set(4.5, 6.5, 6.8);
keyLight.target = keyLightTarget;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xe4edff, 0.85);
fillLight.position.set(-5.5, -2.5, 4.5);
scene.add(fillLight);

// =========================================================================
// 5. POSTER ASPECT RATIO & DIMENSIONS COMPUTATION
// =========================================================================
let currentAspect = 1 / 1.4142;
let posterWidth = 2.75;
let posterHeight = 3.88;

function computePosterDimensions(aspect) {
  if (typeof aspect !== 'number' || isNaN(aspect) || aspect <= 0.02) {
    aspect = getFallbackAspect(controls.get('fallbackAspect'));
  }
  currentAspect = Math.max(0.15, Math.min(6.0, aspect));
  
  let targetH = 3.85;
  let targetW = targetH * currentAspect;

  if (targetW > 4.8) {
    const scale = 4.8 / targetW;
    targetW *= scale;
    targetH *= scale;
  }
  if (targetH > 4.2) {
    const scale = 4.2 / targetH;
    targetW *= scale;
    targetH *= scale;
  }

  posterWidth = targetW;
  posterHeight = targetH;
}

function getFallbackAspect(key) {
  if (key === 'square') return 1.0;
  if (key === 'a4_landscape') return 1.4142;
  return 1 / 1.4142;
}

function getTextureAspect(tex) {
  if (!tex || !tex.image) return null;
  const img = tex.image;
  const w = img.naturalWidth || img.videoWidth || img.width || 0;
  const h = img.naturalHeight || img.videoHeight || img.height || 0;
  if (w > 0 && h > 0) {
    return w / h;
  }
  return null;
}

// =========================================================================
// 6. UNIFIED GLSL PAPER MATERIAL (Optimized GPU Shader with Baked Normal Mapping)
// =========================================================================
const glslPaperHeader = `
  uniform sampler2D uPaperAlbedoMap;
  uniform sampler2D uPaperNormalMap;
  uniform sampler2D uPaperRoughnessMap;
  uniform float uGrainScale;
  uniform float uGrainIntensity;
  uniform float uRoughness;
  uniform float uSpecPower;
  uniform float uSpecIntensity;
  uniform float uSheenFactor;
  uniform float uFleckIntensity;
  uniform float uStockType;
  uniform float uGlossDensity;
  uniform float uGlossShine;
  uniform float uCrumpleFolds;
  uniform vec2 uNoiseOffset;
  uniform float uKeyLightIntensity;
  uniform float uFillLightIntensity;
  uniform vec3 uKeyLightPos;
  uniform vec3 uFillLightPos;
  // studio light & shadow
  uniform float uLightAmount;     // 0 = neutral (exact source colors)
  uniform vec3 uLightSpot;        // xy = light pool centre (world), z = radius
  uniform vec4 uLightMix;         // x = shadow depth, y = highlight, z = warmth, w = grain relief
  uniform vec2 uLightSheen;       // x = sheen strength, y = form contrast
  // procedural paper surface
  uniform vec4 uPaperSurf1;       // x = crumple, y = crumple scale, z = crease sharpness, w = seed
  uniform vec4 uPaperSurf2;       // x = waviness, y = grain, z = mottling, w = relief strength
  uniform vec4 uPaperSurf3;       // x = fold lines X, y = fold lines Y, z = fold depth, w = wear
  uniform sampler2D uPaperScan;   // optional scanned paper texture
  uniform vec4 uPaperScanParams;  // x = amount, y = tiles across width, z = relief, w = has scan
  uniform vec4 uPaperSurf4;       // x = edge wear, y = ink voids, z = ink blotch, w = unused

  vec2 psfHash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float psfHash1(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float psfNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(psfHash1(i), psfHash1(i + vec2(1.0, 0.0)), u.x),
               mix(psfHash1(i + vec2(0.0, 1.0)), psfHash1(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float psfFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * psfNoise(p);
      p = p * 2.03 + vec2(17.1, 9.7);
      a *= 0.5;
    }
    return v;
  }

  // Faceted crumple: each Voronoi cell is a slightly tilted flat facet, the cell
  // borders are creases. Returns xy = height gradient (surface slope), z = crease mask.
  vec3 psfCrumple(vec2 p, float sharp, float seed) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec2 c1 = vec2(0.0); vec2 c2 = vec2(0.0);
    vec2 r1 = vec2(0.0); vec2 r2 = vec2(1.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = psfHash2(n + g + seed);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; c2 = c1; r2 = r1; d1 = d; c1 = n + g; r1 = r; }
        else if (d < d2) { d2 = d; c2 = n + g; r2 = r; }
      }
    }
    vec2 rr = r2 - r1;
    float e = dot(0.5 * (r1 + r2), rr / max(length(rr), 1e-4));
    vec2 s1 = psfHash2(c1 * 1.37 + seed * 3.1) * 2.0 - 1.0;
    vec2 s2 = psfHash2(c2 * 1.37 + seed * 3.1) * 2.0 - 1.0;
    float w = mix(0.35, 0.03, clamp(sharp, 0.0, 1.0));
    float t = 0.5 - 0.5 * smoothstep(0.0, w, e);
    return vec3(mix(s1, s2, t), 1.0 - smoothstep(0.0, 0.035, e));
  }

  // Paper surface in sheet coordinates q (world units, sheet centred at 0).
  // Returns xy = height gradient, z = wear mask; mulOut = albedo multiplier.
  vec3 psfSurface(vec2 q, vec2 dim, out float mulOut) {
    float seed = uPaperSurf1.w;
    vec2 grad = vec2(0.0);
    float wear = 0.0;

    // light crumple = long random creases (flattened crumpled paper)
    //               + gentle warped facets between them
    float cr = uPaperSurf1.x;
    if (cr > 0.001) {
      float sc = max(0.2, uPaperSurf1.y);
      float sharp = clamp(uPaperSurf1.z, 0.0, 1.0);
      // facets: domain-warped, anisotropic Voronoi so it never reads as a mosaic
      vec2 fp = q * sc * 0.8;
      fp += (vec2(psfFbm(fp * 0.45 + seed), psfFbm(fp * 0.45 + seed + 5.2)) - 0.5) * 1.6;
      fp = vec2(fp.x + fp.y * 0.35, fp.y * 0.8);
      vec3 fa = psfCrumple(fp, sharp * 0.6, seed);
      grad += fa.xy * 0.07 * cr;
      // creases
      float nLines = 4.0 + sc * 4.0;
      float w = mix(0.05, 0.007, sharp);
      for (int k = 0; k < 20; k++) {
        float fk = float(k);
        if (fk >= nLines) break;
        vec2 h1 = psfHash2(vec2(fk * 7.13 + seed, fk * 1.91 - seed));
        vec2 h2 = psfHash2(vec2(fk * 3.37 - seed * 0.7, fk * 5.53 + seed));
        vec2 c = (h1 - 0.5) * dim * 1.1;
        float ang = h2.x * 6.2832;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 nn = vec2(-dir.y, dir.x);
        float len = (0.30 + h2.y * 0.8) * max(dim.x, dim.y);
        float t = dot(q - c, dir);
        float taper = 1.0 - smoothstep(len * 0.25, len * 0.5, abs(t));
        if (taper <= 0.0) continue;
        float d = dot(q - c, nn);
        float sg = h1.x > 0.5 ? 1.0 : -1.0;
        float amp = (0.5 + h2.y) * taper * cr;
        grad += nn * (-sign(d)) * sg * amp * (0.20 * exp(-abs(d) / w) + 0.05 * exp(-abs(d) / (w * 8.0)));
        wear = max(wear, exp(-abs(d) / (w * 0.4)) * amp * 0.25);
      }
    }

    // soft waviness of the whole sheet
    float wv = uPaperSurf2.x;
    if (wv > 0.001) {
      vec2 wp = q * 0.9 + seed * 0.37;
      float ex = 0.03;
      float hx = psfFbm(wp + vec2(ex, 0.0)) - psfFbm(wp - vec2(ex, 0.0));
      float hy = psfFbm(wp + vec2(0.0, ex)) - psfFbm(wp - vec2(0.0, ex));
      grad += vec2(hx, hy) / (2.0 * ex) * 0.9 * 0.12 * wv;
    }

    // straight fold lines (poster that was folded for shipping)
    vec2 hd = dim * 0.5;
    float fd = uPaperSurf3.z;
    for (int k = 1; k <= 3; k++) {
      float fk = float(k);
      if (fk <= uPaperSurf3.x) {
        float x0 = -hd.x + fk * dim.x / (uPaperSurf3.x + 1.0);
        float dx = q.x - x0;
        float sg = mod(fk, 2.0) < 0.5 ? 1.0 : -1.0;
        float ex = exp(-abs(dx) / 0.010);
        grad.x += -sign(dx) * sg * fd * (0.30 * ex + 0.06 * exp(-abs(dx) / 0.14));
        wear = max(wear, exp(-abs(dx) / 0.005) * fd);
      }
      if (fk <= uPaperSurf3.y) {
        float y0 = -hd.y + fk * dim.y / (uPaperSurf3.y + 1.0);
        float dy = q.y - y0;
        float sg = mod(fk, 2.0) < 0.5 ? -1.0 : 1.0;
        float ey = exp(-abs(dy) / 0.010);
        grad.y += -sign(dy) * sg * fd * (0.30 * ey + 0.06 * exp(-abs(dy) / 0.14));
        wear = max(wear, exp(-abs(dy) / 0.005) * fd);
      }
    }

    // albedo: soft mottling + fine fibre grain
    float mul = 1.0;
    mul *= 1.0 + (psfFbm(q * 1.3 + seed) - 0.5) * uPaperSurf2.z * 0.10;
    float gr = uPaperSurf2.y;
    mul *= 1.0 + ((psfNoise(q * 180.0 + seed) - 0.5) * 0.07 + (psfNoise(q * 55.0 - seed) - 0.5) * 0.05) * gr;
    grad += (vec2(psfNoise(q * 90.0 + 3.0), psfNoise(q * 90.0 + 7.0)) - 0.5) * 0.05 * gr;

    // optional scanned paper
    if (uPaperScanParams.w > 0.5) {
      vec2 suv = q / max(0.01, dim.x) * max(0.05, uPaperScanParams.y) + 0.5;
      vec2 ts = vec2(textureSize(uPaperScan, 0));
      vec2 e = 1.5 / max(ts, vec2(1.0));
      float L  = dot(texture2D(uPaperScan, suv).rgb, vec3(0.299, 0.587, 0.114));
      float Lx = dot(texture2D(uPaperScan, suv + vec2(e.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float Ly = dot(texture2D(uPaperScan, suv + vec2(0.0, e.y)).rgb, vec3(0.299, 0.587, 0.114));
      float avg = dot(textureLod(uPaperScan, vec2(0.5), 16.0).rgb, vec3(0.299, 0.587, 0.114));
      mul *= mix(1.0, L / max(avg, 0.05), clamp(uPaperScanParams.x, 0.0, 1.0));
      grad += vec2(Lx - L, Ly - L) * 6.0 * uPaperScanParams.z;
    }

    mulOut = mul;
    return vec3(grad, wear * uPaperSurf3.w);
  }

  vec3 sRGBToLinear(vec3 c) {
    return pow(c, vec3(2.2));
  }

  vec3 sampleBacksideBleed(sampler2D tex, vec2 uv, vec2 dimensions) {
    vec2 aspectScale = vec2(1.0, dimensions.y / dimensions.x);
    float baseBlur = 0.0035;
    
    vec2 step1 = vec2(baseBlur * 0.70, baseBlur * 0.70) / aspectScale;
    
    vec4 s0 = texture2D(tex, uv);
    vec4 s1 = texture2D(tex, uv + vec2(step1.x, 0.0));
    vec4 s2 = texture2D(tex, uv - vec2(step1.x, 0.0));
    vec4 s3 = texture2D(tex, uv + vec2(0.0, step1.y));
    vec4 s4 = texture2D(tex, uv - vec2(0.0, step1.y));

    vec3 c0 = mix(vec3(1.0), sRGBToLinear(s0.rgb), s0.a);
    vec3 c1 = mix(vec3(1.0), sRGBToLinear(s1.rgb), s1.a);
    vec3 c2 = mix(vec3(1.0), sRGBToLinear(s2.rgb), s2.a);
    vec3 c3 = mix(vec3(1.0), sRGBToLinear(s3.rgb), s3.a);
    vec3 c4 = mix(vec3(1.0), sRGBToLinear(s4.rgb), s4.a);
    
    vec3 col = c0 * 0.36 + c1 * 0.16 + c2 * 0.16 + c3 * 0.16 + c4 * 0.16;
    return col;
  }

  // -------------------------------------------------------------------------
  // Spot-UV Varnish
  // -------------------------------------------------------------------------
  vec2 spotHash22(vec2 p) {
    float n = sin(dot(p, vec2(41.0, 289.0))) * 45758.5453;
    return fract(vec2(n, n * 121.345));
  }

  float spotValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = spotHash22(i).x;
    float b = spotHash22(i + vec2(1.0, 0.0)).x;
    float c = spotHash22(i + vec2(0.0, 1.0)).x;
    float d = spotHash22(i + vec2(1.0, 1.0)).x;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float spotFbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * spotValueNoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return v;
  }

  float computeSpotUvVarnish(vec2 uv, vec2 dimensions, vec2 noiseOffset, float density, out vec2 varnishGrad) {
    vec2 aspectScale = vec2(1.0, dimensions.y / dimensions.x);
    float baseFreq = 22.0;
    vec2 p = (uv + noiseOffset) * vec2(baseFreq, baseFreq * aspectScale.y);

    vec2 warp = vec2(
      spotFbm(p * 0.9 + vec2(13.7, 5.2)),
      spotFbm(p * 0.9 + vec2(29.3, 17.8))
    );
    vec2 wp = p + (warp - 0.5) * 1.5;

    float coarse = spotFbm(wp * 0.7);
    float fine = spotFbm(wp * 2.2);
    float field = coarse * 0.65 + fine * 0.35;

    float thr = mix(0.85, 0.52, clamp(density, 0.0, 1.0));
    float band = 0.035;
    float mask = smoothstep(thr, thr + band, field);

    float e = 0.025;
    float fx = spotFbm((wp + vec2(e, 0.0)) * 2.2) - spotFbm((wp - vec2(e, 0.0)) * 2.2);
    float fy = spotFbm((wp + vec2(0.0, e)) * 2.2) - spotFbm((wp - vec2(e, 0.0)) * 2.2);
    float rim = mask * (1.0 - mask) * 4.0;
    varnishGrad = -vec2(fx, fy) * rim * 8.0;

    return clamp(mask, 0.0, 1.0);
  }

  vec3 perturbPaperNormal(vec3 N, vec2 uv, vec2 dimensions, float grainIntensity, float grainScale, float varnishFactor, vec2 varnishGrad, vec2 noiseOffset) {
    vec2 tileUV = (uv + noiseOffset * 0.1) * vec2(grainScale, grainScale * (dimensions.y / dimensions.x));
    if (uStockType > 3.5 && uStockType < 4.5) {
      tileUV = uv + noiseOffset * 0.05;
    }
    
    vec3 mapNormal = texture2D(uPaperNormalMap, tileUV).xyz * 2.0 - 1.0;
    
    if (varnishFactor > 0.01) {
      mapNormal.xy = mix(mapNormal.xy * 0.12, varnishGrad, varnishFactor * 0.88);
      mapNormal.z = sqrt(max(0.01, 1.0 - dot(mapNormal.xy, mapNormal.xy)));
    }
    
    vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
    
    float effectiveStrength = (uStockType > 3.5 && uStockType < 4.5)
      ? (0.60 + grainIntensity * 0.40)
      : max(0.25, grainIntensity * 1.25);

    vec3 perturbed = T * (mapNormal.x * effectiveStrength) +
                     B * (mapNormal.y * effectiveStrength) +
                     N * max(0.20, mapNormal.z);
    return length(perturbed) > 0.001 ? normalize(perturbed) : N;
  }

  vec3 renderPaperMaterial(
    vec3 rawSampleColor,
    vec3 albedoLinear,
    vec3 geomNormal,
    vec3 normal,
    vec2 uv,
    vec2 dimensions,
    vec3 worldPos,
    vec3 camPos,
    float grainIntensity,
    float baseRoughness,
    float keyIntensity,
    float fillIntensity,
    vec3 keyPos,
    vec3 fillPos,
    float creaseHighlight,
    float creaseAo
  ) {
    vec2 varnishGrad = vec2(0.0);
    float varnishFactor = 0.0;
    if (uStockType > 4.5 && uStockType < 5.5 && gl_FrontFacing) {
      varnishFactor = computeSpotUvVarnish(uv, dimensions, uNoiseOffset, uGlossDensity, varnishGrad);
    }

    vec3 N = perturbPaperNormal(normal, uv, dimensions, grainIntensity, uGrainScale, varnishFactor, varnishGrad, uNoiseOffset);

    vec3 V = normalize(camPos - worldPos);
    
    float paperSubstrateRough = texture2D(uPaperRoughnessMap, (uv + uNoiseOffset * 0.1) * vec2(uGrainScale, uGrainScale * (dimensions.y / dimensions.x))).r;

    // Roughness affects ONLY micro-spec sharpness — never albedo hue.
    // NOTE: the warm paper substrate is deliberately NOT multiplied into the
    // albedo any more; that cream tint was pushing yellows toward orange.
    float effRoughness = gl_FrontFacing
      ? clamp(baseRoughness * (0.85 + paperSubstrateRough * 0.30), 0.12, 0.98)
      : clamp(baseRoughness * (0.85 + paperSubstrateRough * 0.25), 0.25, 0.95);

    float activeSpecPower = uSpecPower;
    float activeSpecIntensity = uSpecIntensity;
    if (uStockType > 4.5 && uStockType < 5.5 && gl_FrontFacing) {
      effRoughness = mix(0.92, 0.015, varnishFactor);
      activeSpecPower = mix(8.0, 680.0, varnishFactor);
      activeSpecIntensity = mix(0.08, uGlossShine, varnishFactor);
    }

    vec3 L1 = normalize(keyPos - worldPos);
    vec3 L2 = normalize(fillPos - worldPos);

    // ---- Pure ACHROMATIC form light ----
    // Reference is a flat sheet facing the camera (+Z world). A flat, unfolded
    // poster therefore shades to EXACTLY 1.0, so its pixels pass through
    // unchanged (art with alpha=1 == source color). Only genuine surface tilt
    // (folds, creases, curl) brightens/darkens, applied equally to R,G,B, so
    // hue and saturation are never touched.
    float kAmt = 0.55 * (keyIntensity / 4.0);
    float fAmt = 0.30 * (fillIntensity / 3.0);
    float form = kAmt * (dot(geomNormal, L1) - L1.z)
               + fAmt * (dot(geomNormal, L2) - L2.z);
    // ---- Paper surface: crumple / waviness / fold lines / grain ----
    vec2 psQ = (uv - 0.5) * dimensions;
    float psMul = 1.0;
    vec3 psS = psfSurface(psQ, dimensions, psMul);
    vec2 psG = gl_FrontFacing ? psS.xy : -psS.xy;
    // tangent frame of the (possibly folded) sheet from screen derivatives
    vec3 psDp1 = dFdx(worldPos);
    vec3 psDp2 = dFdy(worldPos);
    vec2 psDq1 = dFdx(psQ);
    vec2 psDq2 = dFdy(psQ);
    float psDet = psDq1.x * psDq2.y - psDq1.y * psDq2.x;
    vec3 psT = vec3(1.0, 0.0, 0.0);
    vec3 psB = vec3(0.0, 1.0, 0.0);
    if (abs(psDet) > 1e-12) {
      psT = (psDp1 * psDq2.y - psDp2 * psDq1.y) / psDet;
      psB = (psDp2 * psDq1.x - psDp1 * psDq2.x) / psDet;
    }
    psT = normalize(psT - geomNormal * dot(psT, geomNormal) + vec3(1e-6));
    psB = normalize(psB - geomNormal * dot(psB, geomNormal) + vec3(1e-6));
    vec3 psN = normalize(geomNormal - (psG.x * psT + psG.y * psB) * uPaperSurf2.w);
    float psForm = kAmt * (dot(psN, L1) - dot(geomNormal, L1))
                 + fAmt * (dot(psN, L2) - dot(geomNormal, L2));
    psForm *= 1.6;
    albedoLinear *= psMul;
    // worn fibres along creases turn slightly lighter
    albedoLinear = mix(albedoLinear, max(albedoLinear, vec3(0.80)), clamp(psS.z, 0.0, 1.0) * 0.30);

    // ---- printed-ink craft: ink voids / uneven ink density (front side only) ----
    if (gl_FrontFacing) {
      vec3 paperWhiteL = vec3(0.93, 0.92, 0.89);
      float inkCov = clamp(1.0 - dot(albedoLinear, vec3(0.2126, 0.7152, 0.0722)) / 0.93, 0.0, 1.0);
      float seedI = uPaperSurf1.w * 1.7;
      // tiny specks where the ink didn't take
      float nv = psfNoise(psQ * 240.0 + seedI) * 0.55 + psfNoise(psQ * 95.0 - seedI) * 0.45;
      float blotch = psfFbm(psQ * 5.0 + seedI);
      float voids = smoothstep(0.72, 0.86, nv * 0.7 + blotch * 0.45) * uPaperSurf4.y * inkCov;
      albedoLinear = mix(albedoLinear, paperWhiteL, clamp(voids, 0.0, 1.0) * 0.75);
      // ink laid down thicker / thinner in soft patches
      float dens = (psfFbm(psQ * 2.2 - seedI) - 0.5) * uPaperSurf4.z * inkCov;
      albedoLinear *= 1.0 - dens * 0.35;

      // ---- worn, handled edges: ink rubbed off + a little grime ----
      float ew = uPaperSurf4.x;
      if (ew > 0.001) {
        vec2 ed = min(uv, 1.0 - uv) * dimensions;
        float edgeD = min(ed.x, ed.y);
        float cornerD = length(ed);
        float jag = psfNoise(psQ * 38.0 + seedI) * 0.6 + psfNoise(psQ * 9.0 - seedI) * 0.4;
        float band = 0.012 + jag * 0.035;
        float rub = (1.0 - smoothstep(0.0, band, edgeD)) * ew;
        rub = max(rub, (1.0 - smoothstep(0.0, 0.10 + jag * 0.06, cornerD)) * ew * 0.8);
        albedoLinear = mix(albedoLinear, max(albedoLinear, paperWhiteL * 0.97), clamp(rub, 0.0, 1.0) * 0.65);
        float grime = (1.0 - smoothstep(0.0, 0.12 + jag * 0.08, edgeD)) * ew * 0.10;
        albedoLinear *= 1.0 - grime * (0.6 + 0.4 * psfFbm(psQ * 14.0 + seedI));
      }
    }

    // ---- Studio light & shadow (uLightAmount = 0 -> neutral, exact colors) ----
    float lAmt = max(0.0, uLightAmount);
    float formC = form * (1.0 + lAmt * (uLightSheen.y - 1.0));
    // soft pool of light: bright where the key light points, falling off to shadow
    float poolR = length(worldPos.xy - uLightSpot.xy) / max(0.3, uLightSpot.z);
    float pool = 1.0 - smoothstep(0.0, 1.0, poolR);
    float poolLum = mix(-uLightMix.x, uLightMix.y, pool) * lAmt;
    // paper tooth / grain catching the raking light
    float relief = (dot(N, L1) - dot(geomNormal, L1)) * uLightMix.w * lAmt * 0.6 * (keyIntensity / 4.0);
    float lightLuminance = clamp(1.0 + formC + poolLum + relief + psForm - creaseAo * 0.45, 0.02, 4.0);

    // Neutral white micro-specular, masked to zero where the sheet lies flat to
    // the camera so it can never tint or brighten a flat poster.
    vec3 H1 = normalize(L1 + V);
    float pwr = mix(activeSpecPower, 6.0, effRoughness);
    float specMask = 1.0 - clamp(geomNormal.z, 0.0, 1.0);
    float spec = pow(max(dot(N, H1), 0.0), pwr) * activeSpecIntensity * 0.06 * (1.0 - effRoughness * 0.5) * specMask;

    // broad satin sheen (real reflection of the key light, visible on flat paper too)
    float sheenPow = mix(80.0, 12.0, effRoughness);
    float sheen = pow(max(dot(psN, H1), 0.0), sheenPow) * uLightSheen.x * lAmt
                * (keyIntensity / 4.0) * (0.35 + 0.65 * pool) * (gl_FrontFacing ? 1.0 : 0.4);

    // warm highlights / cool shadows
    float dl = lightLuminance - 1.0;
    float tw = clamp(abs(dl) * 3.0, 0.0, 1.0) * uLightMix.z * lAmt;
    vec3 tint = dl > 0.0 ? mix(vec3(1.0), vec3(1.0, 0.95, 0.86), tw)
                         : mix(vec3(1.0), vec3(0.88, 0.93, 1.0), tw);

    vec3 litColor = albedoLinear * lightLuminance * tint
                  + vec3(spec) * (keyIntensity / 4.0)
                  + vec3(1.0, 0.97, 0.92) * sheen;

    if (!gl_FrontFacing) {
      float tKey = max(dot(-geomNormal, L1), 0.0) * 0.10 * (keyIntensity / 4.0);
      litColor += albedoLinear * tKey;
    }

    return pow(max(litColor, vec3(0.0)), vec3(1.0 / 2.2));
  }
`;

const glslCommonUniforms = {
  uPaperAlbedoMap: { value: activePaperAlbedoMap },
  uPaperNormalMap: { value: activePaperNormalMap },
  uPaperRoughnessMap: { value: activePaperRoughnessMap },
  uGrainScale: { value: 9.5 },
  uGrainIntensity: { value: 0.45 },
  uRoughness: { value: 0.72 },
  uSpecPower: { value: 18.0 },
  uSpecIntensity: { value: 0.22 },
  uSheenFactor: { value: 0.20 },
  uFleckIntensity: { value: 0.0 },
  uStockType: { value: 4.0 },
  uGlossDensity: { value: 1.0 },
  uGlossShine: { value: 0.5 },
  uCrumpleFolds: { value: 1.7 },
  uNoiseOffset: { value: new THREE.Vector2(0.0, 0.0) },
  uKeyLightIntensity: { value: 4.0 },
  uFillLightIntensity: { value: 3.0 },
  uKeyLightPos: { value: new THREE.Vector3(4.5, 6.5, 6.8) },
  uFillLightPos: { value: new THREE.Vector3(-5.5, -2.5, 4.5) },
  uLightAmount: { value: 0.0 },
  uLightSpot: { value: new THREE.Vector3(0, 2, 4) },
  uLightMix: { value: new THREE.Vector4(0.3, 0.12, 0.35, 0.5) },
  uLightSheen: { value: new THREE.Vector2(0.25, 1.6) },
  uPaperSurf1: { value: new THREE.Vector4(0, 2, 0.6, 7) },
  uPaperSurf2: { value: new THREE.Vector4(0, 0, 0, 1) },
  uPaperSurf3: { value: new THREE.Vector4(0, 0, 0.6, 0.4) },
  uPaperScan: { value: null },
  uPaperScanParams: { value: new THREE.Vector4(0.5, 1, 0.5, 0) },
  uPaperSurf4: { value: new THREE.Vector4(0, 0, 0, 0) },
};

// =========================================================================
// 7. TWO-STAGE COMPOUND FOLD SHADER
// =========================================================================
const foldUniforms = {
  ...glslCommonUniforms,
  uTexture: { value: defaultTextures[0] },
  uBackTexture: { value: null },
  uHasBackTexture: { value: 0.0 },
  uDimensions: { value: new THREE.Vector2(2.75, 3.88) },
  uFoldProg1: { value: 0.0 },
  uFoldProg2: { value: 0.0 },
  uFoldAxis1: { value: 0.0 },
  uFoldSign1: { value: 1.0 },
  uFoldSign2: { value: 1.0 },
  uFoldZSign2: { value: 1.0 },
  uFlutter: { value: 0.44 },
  uMotionActivity: { value: 0.0 },
  uTime: { value: 0.0 },
};

const glslFoldVertexTransform = `
  float easeFold(float x) {
    return -(cos(3.141592653589793 * clamp(x, 0.0, 1.0)) - 1.0) * 0.5;
  }

  vec3 applyTwoStageFold(
    vec3 p,
    vec2 dim,
    float p1,
    float p2,
    float axis1,
    float sign1,
    float sign2,
    float zSign2,
    float flutter,
    float motionActivity,
    float time
  ) {
    float w = dim.x;
    float h = dim.y;
    const float PI = 3.141592653589793;
    
    float e1 = easeFold(p1);
    float theta1 = e1 * PI;
    
    float e2 = easeFold(p2);
    float theta2 = e2 * PI;
    
    vec3 pos = p;
    
    if (axis1 < 0.5) {
      float s1 = pos.x * sign1;
      float R1 = max(0.012 * w, 0.024 * w * (1.0 - e1 * 0.40));
      float L1 = R1 * theta1;
      float dz1 = 0.015 * e1;
      
      float z1 = 0.0;
      if (s1 > 0.0 && theta1 > 0.0001) {
        float xLocal = 0.0;
        float zLocal = 0.0;
        if (s1 <= L1) {
          float phi1 = s1 / R1;
          xLocal = R1 * sin(phi1);
          zLocal = R1 * (1.0 - cos(phi1)) + dz1 * (phi1 / PI);
        } else {
          float rem1 = s1 - L1;
          xLocal = R1 * sin(theta1) + rem1 * cos(theta1);
          zLocal = R1 * (1.0 - cos(theta1)) + rem1 * sin(theta1) + dz1;
        }
        pos.x = sign1 * xLocal;
        z1 = zLocal;
      }
      pos.x += sign1 * (w * 0.25) * e1;
      pos.z = z1;
      
      if (e2 > 0.0001) {
        float s2 = pos.y * sign2;
        float R2 = max(0.016 * h, 0.030 * h * (1.0 - e2 * 0.40));
        float L2 = R2 * theta2;
        float dz2 = (0.025 + 0.015 * e1) * e2;
        
        if (s2 > 0.0 && theta2 > 0.0001) {
          float yLocal = 0.0;
          float zLocal = 0.0;
          if (s2 <= L2) {
            float phi2 = s2 / R2;
            yLocal = (R2 - z1) * sin(phi2);
            zLocal = R2 * (1.0 - cos(phi2)) + z1 * cos(phi2) + dz2 * (phi2 / PI);
          } else {
            float rem2 = s2 - L2;
            yLocal = R2 * sin(theta2) + rem2 * cos(theta2) - z1 * sin(theta2);
            zLocal = R2 * (1.0 - cos(theta2)) + rem2 * sin(theta2) + z1 * cos(theta2) + dz2;
          }
          pos.y = sign2 * yLocal;
          pos.z = zLocal;
        }
        pos.y += sign2 * (h * 0.25) * e2;
      }
    } else {
      float s1 = pos.y * sign1;
      float R1 = max(0.012 * h, 0.024 * h * (1.0 - e1 * 0.40));
      float L1 = R1 * theta1;
      float dz1 = 0.015 * e1;
      
      float z1 = 0.0;
      if (s1 > 0.0 && theta1 > 0.0001) {
        float yLocal = 0.0;
        float zLocal = 0.0;
        if (s1 <= L1) {
          float phi1 = s1 / R1;
          yLocal = R1 * sin(phi1);
          zLocal = R1 * (1.0 - cos(phi1)) + dz1 * (phi1 / PI);
        } else {
          float rem1 = s1 - L1;
          yLocal = R1 * sin(theta1) + rem1 * cos(theta1);
          zLocal = R1 * (1.0 - cos(theta1)) + rem1 * sin(theta1) + dz1;
        }
        pos.y = sign1 * yLocal;
        z1 = zLocal;
      }
      pos.y += sign1 * (h * 0.25) * e1;
      pos.z = z1;
      
      if (e2 > 0.0001) {
        float s2 = pos.x * sign2;
        float R2 = max(0.016 * w, 0.030 * w * (1.0 - e2 * 0.40));
        float L2 = R2 * theta2;
        float dz2 = (0.025 + 0.015 * e1) * e2;
        
        if (s2 > 0.0 && theta2 > 0.0001) {
          float xLocal = 0.0;
          float zLocal = 0.0;
          if (s2 <= L2) {
            float phi2 = s2 / R2;
            xLocal = (R2 - z1) * sin(phi2);
            zLocal = R2 * (1.0 - cos(phi2)) + z1 * cos(phi2) + dz2 * (phi2 / PI);
          } else {
            float rem2 = s2 - L2;
            xLocal = R2 * sin(theta2) + rem2 * cos(theta2) - z1 * sin(theta2);
            zLocal = R2 * (1.0 - cos(theta2)) + rem2 * sin(theta2) + z1 * cos(theta2) + dz2;
          }
          pos.x = sign2 * xLocal;
          pos.z = zLocal;
        }
        pos.x += sign2 * (w * 0.25) * e2;
      }
    }
    
    if (flutter > 0.001 && motionActivity > 0.01) {
      float flutterWave = sin(time * 5.5 + p.x * 3.5 + p.y * 3.5) * cos(time * 4.2 + p.y * 2.8);
      float flutterAmp = flutter * motionActivity * 0.005 * (0.5 + 0.5 * (abs(p.x) / (w * 0.5) + abs(p.y) / (h * 0.5)));
      pos.z += flutterWave * flutterAmp;
    }
    
    return pos;
  }
`;

const foldVertexShader = `
  uniform vec2 uDimensions;
  uniform float uFoldProg1;
  uniform float uFoldProg2;
  uniform float uFoldAxis1;
  uniform float uFoldSign1;
  uniform float uFoldSign2;
  uniform float uFoldZSign2;
  uniform float uFlutter;
  uniform float uMotionActivity;
  uniform float uTime;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  ${glslFoldVertexTransform}

  void main() {
    vUv = clamp(uv, 0.0005, 0.9995);
    vec3 pos = position;
    
    pos = applyTwoStageFold(
      pos,
      uDimensions,
      uFoldProg1,
      uFoldProg2,
      uFoldAxis1,
      uFoldSign1,
      uFoldSign2,
      uFoldZSign2,
      uFlutter,
      uMotionActivity,
      uTime
    );
    
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const foldFragmentShader = `
  uniform sampler2D uTexture;
  uniform sampler2D uBackTexture;
  uniform float uHasBackTexture;
  uniform vec2 uDimensions;
  uniform float uFoldProg1;
  uniform float uFoldProg2;
  uniform float uFoldAxis1;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  ${glslPaperHeader}
  
  void main() {
    vec3 dX = dFdx(vWorldPos);
    vec3 dY = dFdy(vWorldPos);
    vec3 crossN = cross(dX, dY);
    vec3 geomNormal = length(crossN) > 0.0001 ? normalize(crossN) : vec3(0.0, 0.0, 1.0);
    if (!gl_FrontFacing) geomNormal = -geomNormal;
    
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 paperBase = sRGBToLinear(vec3(0.97, 0.97, 0.97));
    vec3 baseAlbedo;
    
    if (gl_FrontFacing) {
      baseAlbedo = mix(paperBase, sRGBToLinear(texColor.rgb), texColor.a);
    } else {
      vec2 backUv = vec2(1.0 - vUv.x, vUv.y);
      if (uHasBackTexture > 0.5) {
        vec4 backTexColor = texture2D(uBackTexture, backUv);
        vec3 backInk = sRGBToLinear(backTexColor.rgb);
        vec3 bleedColor = sampleBacksideBleed(uTexture, backUv, uDimensions);
        vec3 basePaperWithBleed = paperBase * mix(vec3(1.0), bleedColor, 0.32);
        baseAlbedo = mix(basePaperWithBleed, backInk, backTexColor.a);
      } else {
        vec3 bleedColor = sampleBacksideBleed(uTexture, backUv, uDimensions);
        baseAlbedo = paperBase * mix(vec3(1.0), bleedColor, 0.32);
      }
    }
    
    float t1 = clamp(uFoldProg1, 0.0, 1.0);
    float t2 = clamp(uFoldProg2, 0.0, 1.0);
    float e1 = -(cos(3.141592653589793 * t1) - 1.0) * 0.5;
    float e2 = -(cos(3.141592653589793 * t2) - 1.0) * 0.5;

    float distX = abs(vUv.x - 0.5) * uDimensions.x;
    float distY = abs(vUv.y - 0.5) * uDimensions.y;

    float crease1Dist = (uFoldAxis1 < 0.5) ? distX : distY;
    float crease2Dist = (uFoldAxis1 < 0.5) ? distY : distX;

    float shadow1 = (1.0 - smoothstep(0.001, 0.016, crease1Dist)) * (0.10 + e1 * 0.24);
    float stress1 = (1.0 - smoothstep(0.0001, 0.0020, crease1Dist)) * 0.85 * (0.30 + 0.70 * e1);

    float shadow2 = (1.0 - smoothstep(0.001, 0.016, crease2Dist)) * (0.10 + e2 * 0.24);
    float stress2 = (1.0 - smoothstep(0.0001, 0.0020, crease2Dist)) * 0.85 * (0.30 + 0.70 * e2);

    float totalShadow = max(shadow1, shadow2);
    float totalStress = max(stress1, stress2);

    baseAlbedo *= (1.0 - totalShadow * 0.35);

    vec3 celluloseFiberColor = sRGBToLinear(vec3(0.96, 0.95, 0.93));
    baseAlbedo = mix(baseAlbedo, max(baseAlbedo * 1.30, celluloseFiberColor), totalStress * 0.35);

    float foldOcclusion = totalShadow * 0.25;

    vec3 color = renderPaperMaterial(
      texColor.rgb,
      baseAlbedo,
      geomNormal,
      geomNormal,
      vUv,
      uDimensions,
      vWorldPos,
      cameraPosition,
      uGrainIntensity,
      uRoughness,
      uKeyLightIntensity,
      uFillLightIntensity,
      uKeyLightPos,
      uFillLightPos,
      0.0,
      foldOcclusion
    );
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

// =========================================================================
// 8. PEEL LAYERS: MULTI-LAYER SEQUENTIAL PEELING & CYLINDRICAL CURL
// =========================================================================
function getBacksideStyleCode(style) {
  if (style === 'bleed') return 1.0;
  if (style === 'solid') return 2.0;
  return 0.0;
}

const peelUniforms = {
  ...glslCommonUniforms,
  uTexture: { value: defaultTextures[0] },
  uDimensions: { value: new THREE.Vector2(2.75, 3.88) },
  uPeelProgress: { value: 0.25 },
  uPeelAngle: { value: 25.0 },
  uCurlRadius: { value: 0.20 },
  uBacksideStyle: { value: 0.0 },
  uBacksideColor: { value: new THREE.Color('#DD1010') },
  uTime: { value: 0.0 },
};

const glslPeelVertexTransform = `
  vec3 computePeelPosition(vec3 pos, vec2 dimensions, float progress, float angle, float curlRadius) {
    float w = dimensions.x;
    float h = dimensions.y;
    
    float rad = radians(angle);
    vec2 dir = vec2(cos(rad), sin(rad));
    vec2 perp = vec2(-dir.y, dir.x);
    
    float maxDist = (abs(w * dir.x) + abs(h * dir.y)) * 0.5;
    float proj = dot(pos.xy, dir);
    float projPerp = dot(pos.xy, perp);
    
    float R = max(0.04, curlRadius * 0.85 + 0.03);
    
    const float PI = 3.141592653589793;
    float tProg = clamp(progress, 0.0, 1.0);
    float peelStart = maxDist + 0.02;
    float peelEnd = -maxDist - PI * R * 2.2 - 0.35;
    float peelFront = mix(peelStart, peelEnd, tProg);
    
    float s = proj - peelFront;
    
    if (s > 0.0) {
      float theta = s / R;
      if (theta <= PI) {
        float u_curled = peelFront + R * sin(theta);
        float z_curled = R * (1.0 - cos(theta));
        pos.xy = u_curled * dir + projPerp * perp;
        pos.z = z_curled + 0.012;
      } else {
        float s_rem = s - PI * R;
        float phi = 0.08;
        float u_curled = peelFront - s_rem * cos(phi);
        float z_curled = 2.0 * R + s_rem * sin(phi);
        pos.xy = u_curled * dir + projPerp * perp;
        pos.z = z_curled + 0.012;
      }
    }
    return pos;
  }
`;

const peelVertexShader = `
  uniform vec2 uDimensions;
  uniform float uPeelProgress;
  uniform float uPeelAngle;
  uniform float uCurlRadius;
  uniform float uTime;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  ${glslPeelVertexTransform}

  void main() {
    vUv = clamp(uv, 0.0005, 0.9995);
    vec3 pos = position;
    pos = computePeelPosition(pos, uDimensions, uPeelProgress, uPeelAngle, uCurlRadius);
    
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const peelFragmentShader = `
  uniform sampler2D uTexture;
  uniform vec2 uDimensions;
  uniform float uBacksideStyle;
  uniform vec3 uBacksideColor;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  ${glslPaperHeader}
  
  void main() {
    vec3 dX = dFdx(vWorldPos);
    vec3 dY = dFdy(vWorldPos);
    vec3 crossN = cross(dX, dY);
    vec3 geomNormal = length(crossN) > 0.0001 ? normalize(crossN) : vec3(0.0, 0.0, 1.0);
    if (!gl_FrontFacing) geomNormal = -geomNormal;
    
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 paperBase = sRGBToLinear(vec3(0.97, 0.97, 0.97));
    vec3 baseAlbedo;
    
    if (gl_FrontFacing) {
      baseAlbedo = mix(paperBase, sRGBToLinear(texColor.rgb), texColor.a);
    } else {
      vec2 backUv = vec2(1.0 - vUv.x, vUv.y);
      vec3 bleedColor = sampleBacksideBleed(uTexture, backUv, uDimensions);
      
      if (uBacksideStyle < 0.5) {
        baseAlbedo = paperBase;
      } else if (uBacksideStyle < 1.5) {
        baseAlbedo = paperBase * mix(vec3(1.0), bleedColor, 0.32);
      } else {
        vec3 solidCol = sRGBToLinear(uBacksideColor);
        baseAlbedo = solidCol * mix(vec3(1.0), bleedColor, 0.18);
      }
    }
    
    float effRoughness = gl_FrontFacing ? uRoughness : clamp(uRoughness + 0.08, 0.35, 0.98);
    
    vec3 color = renderPaperMaterial(
      texColor.rgb,
      baseAlbedo,
      geomNormal,
      geomNormal,
      vUv,
      uDimensions,
      vWorldPos,
      cameraPosition,
      uGrainIntensity,
      effRoughness,
      uKeyLightIntensity,
      uFillLightIntensity,
      uKeyLightPos,
      uFillLightPos,
      0.0,
      0.0
    );
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

// =========================================================================
// 9. CRUMPLED PAPER (Smooth Faceted & Creased Paper Simulation with Seed Morphing)
// =========================================================================
const crumpleUniforms = {
  ...glslCommonUniforms,
  uTexture: { value: defaultTextures[0] },
  uDimensions: { value: new THREE.Vector2(2.75, 3.88) },
  uCrumpleProgress: { value: 0.0 },
  uCrumpleFoldStrength: { value: 1.0 },
  uSeedMorph: { value: 0.0 },
  uWrinkleDensity: { value: 50.0 },
  uCrumpleSeed: { value: 73.0 },
  uCrumpleMicroTextureIntensity: { value: 1.0 },
  uCrumpleMicroTextureSize: { value: 1.2 },
  uTime: { value: 0.0 },
};

const crumpleVertexShader = `
  attribute vec3 aCrumpledPos;
  attribute vec3 aCrumpledNormal;
  attribute vec3 aCrumpledPosNext;
  attribute vec3 aCrumpledNormalNext;
  
  uniform vec2 uDimensions;
  uniform float uCrumpleProgress;
  uniform float uCrumpleFoldStrength;
  uniform float uSeedMorph;
  uniform float uTime;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  float easeInOutSine(float x) {
    return -(cos(3.141592653589793 * clamp(x, 0.0, 1.0)) - 1.0) * 0.5;
  }

  void main() {
    vUv = clamp(uv, 0.0005, 0.9995);
    
    float tProg = clamp(uCrumpleProgress, 0.0, 1.0);
    // Strength drives the solver (press force), not a raw displacement scale.
    // Clamping here keeps panels non-stretchable at maximum force.
    float str = clamp(uCrumpleFoldStrength, 0.0, 1.0);
    float easedT = easeInOutSine(tProg);
    float morphT = easeInOutSine(clamp(uSeedMorph, 0.0, 1.0));
    
    vec3 blendedCrumplePos = mix(aCrumpledPos, aCrumpledPosNext, morphT);
    vec3 blendedCrumpleNorm = normalize(mix(aCrumpledNormal, aCrumpledNormalNext, morphT));
    
    vec3 targetDisp = (blendedCrumplePos - position) * str;
    vec3 displaced = position + targetDisp * easedT;
    
    vec3 targetNormDelta = (blendedCrumpleNorm - normal) * str;
    vec3 dispNormal = normalize(normal + targetNormDelta * easedT);
    
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * dispNormal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const crumpleFragmentShader = `
  uniform sampler2D uTexture;
  uniform vec2 uDimensions;
  uniform float uCrumpleProgress;
  uniform float uCrumpleFoldStrength;
  uniform float uCrumpleMicroTextureIntensity;
  uniform float uCrumpleMicroTextureSize;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  ${glslPaperHeader}
  
  vec2 crumpleHash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float evalMicroWrinkleOctave(vec2 p, float sharpness, out float outRidge, out float outCrevice) {
    vec2 n = floor(p);
    vec2 f = fract(p);

    float md1 = 8.0;
    vec2 mr, mg;

    for (int j = -1; j <= 1; j++) {
      for (int k = -1; k <= 1; k++) {
        vec2 g = vec2(float(k), float(j));
        vec2 o = crumpleHash22(n + g) * 0.70 + 0.15;
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md1) {
          md1 = d;
          mr = r;
          mg = g;
        }
      }
    }

    float md2 = 8.0;
    for (int j = -2; j <= 2; j++) {
      for (int k = -2; k <= 2; k++) {
        vec2 g = mg + vec2(float(k), float(j));
        vec2 o = crumpleHash22(n + g) * 0.70 + 0.15;
        vec2 r = g + o - f;
        if (dot(mr - r, mr - r) > 0.00001) {
          float d = dot(0.5 * (mr + r), normalize(r - mr));
          md2 = min(md2, d);
        }
      }
    }

    float edgeDist = max(0.0, md2);
    float ridge = exp(-edgeDist * sharpness);
    float facet = clamp(1.0 - edgeDist * 1.5, 0.0, 1.0);
    facet = facet * facet * (3.0 - 2.0 * facet);

    outRidge = ridge;
    outCrevice = clamp(1.0 - ridge * 0.85, 0.0, 1.0);

    return ridge * 0.70 + facet * 0.30;
  }

  void main() {
    vec3 dX = dFdx(vWorldPos);
    vec3 dY = dFdy(vWorldPos);
    vec3 crossN = cross(dX, dY);
    vec3 geomNormal = (length(crossN) > 0.0001) ? normalize(crossN) : normalize(vNormal);
    if (!gl_FrontFacing) geomNormal = -geomNormal;
    
    vec3 vertNormal = normalize(vNormal);
    if (!gl_FrontFacing) vertNormal = -vertNormal;
    // Flat shading: sharp facets, no smoothing across creases
    vec3 blendedNormal = geomNormal;
    
    float prog = clamp(uCrumpleProgress, 0.0, 1.0);
    float foldStr = max(0.0, uCrumpleFoldStrength);
    
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 paperBase = sRGBToLinear(vec3(0.97, 0.97, 0.97));
    // Back faces = blank paper stock, no poster, no bleed-through
    vec3 baseAlbedo = gl_FrontFacing
      ? mix(paperBase, sRGBToLinear(texColor.rgb), texColor.a)
      : paperBase * 0.97;

    // Large Fold Pattern: panels are perfectly flat — no micro relief at all.
    float ridgeLift = 0.0;
    float creviceAo = 0.0;

    vec3 color = renderPaperMaterial(
      texColor.rgb,
      baseAlbedo,
      blendedNormal,
      blendedNormal,
      vUv,
      uDimensions,
      vWorldPos,
      cameraPosition,
      uGrainIntensity,
      uRoughness,
      uKeyLightIntensity,
      uFillLightIntensity,
      uKeyLightPos,
      uFillLightPos,
      0.0,
      creviceAo * 0.45
    );
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

function generateLegacyCrumpleData(w, h, densityRaw, seed) {
  const densityNorm = Math.min(1.0, Math.max(0.0, (densityRaw - 1.0) / 49.0));
  const rng = makeSeededRng(seed);
  const minDim = Math.min(w, h);

  function getPerimeterPoint(side, t) {
    const clampedT = Math.max(0.04, Math.min(0.96, t));
    if (side === 0) return { x: -w * 0.5 + clampedT * w, y: h * 0.5 };   // Top
    if (side === 1) return { x: w * 0.5, y: h * 0.5 - clampedT * h };   // Right
    if (side === 2) return { x: w * 0.5 - clampedT * w, y: -h * 0.5 };  // Bottom
    return { x: -w * 0.5, y: -h * 0.5 + clampedT * h };                 // Left
  }

  // 1. Generate 5 to 9 Major Edge-to-Edge Diagonal & Transverse Creases
  const numMajor = Math.max(5, Math.min(9, Math.round(5 + densityNorm * 4)));
  const creaseLines = [];

  for (let i = 0; i < numMajor; i++) {
    const sideA = (i * 2 + Math.floor(rng() * 2)) % 4;
    const sideB = (sideA + 1 + Math.floor(rng() * 3)) % 4;

    const pA = getPerimeterPoint(sideA, 0.10 + rng() * 0.80);
    const pB = getPerimeterPoint(sideB, 0.10 + rng() * 0.80);

    const vx = pB.x - pA.x;
    const vy = pB.y - pA.y;
    const len = Math.hypot(vx, vy) || 1.0;
    const dirX = vx / len;
    const dirY = vy / len;
    const normX = -dirY;
    const normY = dirX;

    const width = minDim * (0.045 + rng() * 0.055);
    const depth = minDim * (0.13 + rng() * 0.18);
    const step = minDim * (0.045 + rng() * 0.075) * (rng() > 0.5 ? 1.0 : -1.0);
    const tilt = (rng() - 0.5) * 0.22;
    const sign = (i % 2 === 0 ? 1.0 : -1.0) * (rng() > 0.35 ? 1.0 : -1.0);
    const contract = 0.05 + rng() * 0.06;

    creaseLines.push({
      pAx: pA.x, pAy: pA.y,
      pBx: pB.x, pBy: pB.y,
      dirX, dirY,
      normX, normY,
      len,
      width, depth, step, tilt,
      sign, contract
    });
  }

  // 2. Generate Secondary Branching Crease Network (Y-junctions & Origami facets)
  const numSecondary = Math.max(4, Math.min(8, Math.round(3 + densityNorm * 5)));
  for (let j = 0; j < numSecondary; j++) {
    const parent = creaseLines[Math.floor(rng() * creaseLines.length)];
    const tFrac = 0.15 + rng() * 0.70;
    const startX = parent.pAx + parent.dirX * (parent.len * tFrac);
    const startY = parent.pAy + parent.dirY * (parent.len * tFrac);

    const branchAngle = (rng() > 0.5 ? 1 : -1) * (0.55 + rng() * 0.75);
    const cosB = Math.cos(branchAngle);
    const sinB = Math.sin(branchAngle);
    const bDirX = parent.dirX * cosB - parent.dirY * sinB;
    const bDirY = parent.dirX * sinB + parent.dirY * cosB;

    const bLen = minDim * (0.22 + rng() * 0.45);
    const endX = startX + bDirX * bLen;
    const endY = startY + bDirY * bLen;

    const width = minDim * (0.035 + rng() * 0.045);
    const depth = minDim * (0.08 + rng() * 0.13);
    const step = minDim * (0.025 + rng() * 0.045) * (rng() > 0.5 ? 1.0 : -1.0);
    const tilt = (rng() - 0.5) * 0.15;
    const sign = rng() > 0.5 ? 1.0 : -1.0;
    const contract = 0.04 + rng() * 0.05;

    creaseLines.push({
      pAx: startX, pAy: startY,
      pBx: endX, pBy: endY,
      dirX: bDirX, dirY: bDirY,
      normX: -bDirY, normY: bDirX,
      len: bLen,
      width, depth, step, tilt,
      sign, contract
    });
  }

  // 3. Facet Region Generator (Voronoi Polygons with Planar Tilts)
  const numSites = Math.max(16, Math.min(28, Math.round(14 + densityNorm * 12)));
  const sites = [];
  for (let s = 0; s < numSites; s++) {
    const sx = (rng() - 0.5) * w * 1.08;
    const sy = (rng() - 0.5) * h * 1.08;
    const zBase = (rng() - 0.5) * minDim * 0.14;
    const tiltX = (rng() - 0.5) * 0.16;
    const tiltY = (rng() - 0.5) * 0.16;
    sites.push({ x: sx, y: sy, zBase, tiltX, tiltY });
  }

  // 4. Corner & Edge Dog-Ear Flaps (Acute folded paper flaps as on reference)
  const cornerFolds = [];
  const cornerPresets = [
    { cx: -w * 0.5, cy: h * 0.5,  dirX: 0.7071,  dirY: -0.7071 }, // Top-Left
    { cx: w * 0.5,  cy: h * 0.5,  dirX: -0.7071, dirY: -0.7071 }, // Top-Right
    { cx: w * 0.5,  cy: -h * 0.5, dirX: -0.7071, dirY: 0.7071 },  // Bottom-Right
    { cx: -w * 0.5, cy: -h * 0.5, dirX: 0.7071,  dirY: 0.7071 }   // Bottom-Left
  ];
  const numFlaps = rng() > 0.35 ? 2 : 1;
  const pickedFlaps = [0, 2];
  if (numFlaps === 1) pickedFlaps.pop();

  for (const cIdx of pickedFlaps) {
    const cp = cornerPresets[cIdx];
    const foldDist = minDim * (0.16 + rng() * 0.18);
    const foldAngle = (rng() - 0.5) * 0.40;
    const cosA = Math.cos(foldAngle);
    const sinA = Math.sin(foldAngle);
    const rDirX = cp.dirX * cosA - cp.dirY * sinA;
    const rDirY = cp.dirX * sinA + cp.dirY * cosA;

    cornerFolds.push({
      cornerX: cp.cx,
      cornerY: cp.cy,
      dirX: rDirX,
      dirY: rDirY,
      normX: -rDirY,
      normY: rDirX,
      foldDist,
      liftAmount: minDim * (0.10 + rng() * 0.12) * (rng() > 0.4 ? 1.0 : -0.7)
    });
  }

  const cols = 144;
  const rows = Math.max(144, Math.round(cols / (currentAspect || 0.707)));

  const numVertices = (cols + 1) * (rows + 1);
  const restPositions = new Float32Array(numVertices * 3);
  const crumpledPositions = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);

  let sumX = 0, sumY = 0, sumZ = 0;

  for (let iy = 0; iy <= rows; iy++) {
    const vNorm = iy / rows;
    for (let ix = 0; ix <= cols; ix++) {
      const uNorm = ix / cols;
      const idx = iy * (cols + 1) + ix;

      const px = -w * 0.5 + uNorm * w;
      const py = h * 0.5 - vNorm * h;

      restPositions[idx * 3] = px;
      restPositions[idx * 3 + 1] = py;
      restPositions[idx * 3 + 2] = 0.0;

      uvs[idx * 2] = Math.max(0.0005, Math.min(0.9995, uNorm));
      uvs[idx * 2 + 1] = Math.max(0.0005, Math.min(0.9995, 1.0 - vNorm));

      let dispX = 0.0;
      let dispY = 0.0;
      let dispZ = 0.0;

      // 1. Voronoi Facet Network Computation
      let d1 = 1e9, d2 = 1e9;
      let s1 = sites[0], s2 = sites[1];
      for (let s = 0; s < sites.length; s++) {
        const d = Math.hypot(px - sites[s].x, py - sites[s].y);
        if (d < d1) {
          d2 = d1;
          s2 = s1;
          d1 = d;
          s1 = sites[s];
        } else if (d < d2) {
          d2 = d;
          s2 = sites[s];
        }
      }

      const h1 = s1.zBase + s1.tiltX * (px - s1.x) + s1.tiltY * (py - s1.y);
      const h2 = s2.zBase + s2.tiltX * (px - s2.x) + s2.tiltY * (py - s2.y);
      const deltaD = Math.max(0.0, d2 - d1);
      const tFacet = Math.min(1.0, deltaD / (minDim * 0.08));
      const facetZ = h2 + (h1 - h2) * (tFacet * tFacet * (3.0 - 2.0 * tFacet));
      dispZ += facetZ * 0.75;

      // 2. Major & Branching Crease Network
      for (let f = 0; f < creaseLines.length; f++) {
        const cl = creaseLines[f];
        const dx = px - cl.pAx;
        const dy = py - cl.pAy;

        const sDist = dx * cl.normX + dy * cl.normY;
        const tDist = dx * cl.dirX + dy * cl.dirY;

        const absS = Math.abs(sDist);

        let tTaper = 1.0;
        if (tDist < 0) {
          tTaper = Math.max(0.0, 1.0 + tDist / (cl.width * 2.5));
        } else if (tDist > cl.len) {
          tTaper = Math.max(0.0, 1.0 - (tDist - cl.len) / (cl.width * 2.5));
        }

        if (tTaper > 0.001) {
          const uS = absS / cl.width;
          if (uS < 2.5) {
            const ridgeShape = Math.exp(-uS * 1.6) * (1.0 - uS * 0.20);
            dispZ += cl.depth * cl.sign * ridgeShape * tTaper;

            const sSign = sDist >= 0 ? 1.0 : -1.0;
            const pull = -sSign * (cl.depth * cl.contract) * (uS * Math.exp(-uS * 1.2)) * tTaper;
            dispX += pull * cl.normX;
            dispY += pull * cl.normY;
          }

          const stepTransition = Math.tanh(sDist / (cl.width * 0.60));
          dispZ += cl.step * stepTransition * tTaper;

          const slopeFade = Math.exp(-absS / (minDim * 0.50));
          dispZ += cl.tilt * sDist * slopeFade * tTaper;
        }
      }

      // 3. Corner Dog-Ear Flaps
      for (let c = 0; c < cornerFolds.length; c++) {
        const cf = cornerFolds[c];
        const cdx = px - cf.cornerX;
        const cdy = py - cf.cornerY;
        const proj = cdx * cf.dirX + cdy * cf.dirY;

        if (proj < cf.foldDist && proj > 0.0) {
          const tFold = 1.0 - proj / cf.foldDist;
          const foldHeight = Math.pow(tFold, 1.35) * cf.liftAmount;
          dispZ += foldHeight;

          dispX += -cf.dirX * (foldHeight * 0.40);
          dispY += -cf.dirY * (foldHeight * 0.40);
        }
      }

      // 4. Subtle edge wave
      const edgeDistX = Math.abs(px) / (w * 0.5);
      const edgeDistY = Math.abs(py) / (h * 0.5);
      const edgeFactor = Math.max(edgeDistX, edgeDistY);
      if (edgeFactor > 0.85) {
        const eT = (edgeFactor - 0.85) / 0.15;
        const edgeWarp = Math.sin(px * 10.0 + py * 10.0 + seed * 0.3) * (0.009 * minDim) * eT;
        dispZ += edgeWarp;
      }

      const finalX = px + dispX;
      const finalY = py + dispY;
      const finalZ = dispZ;

      crumpledPositions[idx * 3] = finalX;
      crumpledPositions[idx * 3 + 1] = finalY;
      crumpledPositions[idx * 3 + 2] = finalZ;

      sumX += finalX;
      sumY += finalY;
      sumZ += finalZ;
    }
  }

  const count = (cols + 1) * (rows + 1);
  const avgX = sumX / count;
  const avgY = sumY / count;
  const avgZ = sumZ / count;

  for (let i = 0; i < count; i++) {
    crumpledPositions[i * 3] -= avgX;
    crumpledPositions[i * 3 + 1] -= avgY;
    crumpledPositions[i * 3 + 2] -= avgZ;
  }

  const indices = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const v00 = iy * (cols + 1) + ix;
      const v10 = v00 + 1;
      const v01 = (iy + 1) * (cols + 1) + ix;
      const v11 = v01 + 1;

      indices.push(v00, v01, v10);
      indices.push(v10, v01, v11);
    }
  }

  const tempGeo = new THREE.BufferGeometry();
  tempGeo.setAttribute('position', new THREE.BufferAttribute(crumpledPositions.slice(), 3));
  tempGeo.setIndex(indices);
  tempGeo.computeVertexNormals();
  const crumpledNormals = tempGeo.getAttribute('normal').array;

  return {
    restPositions,
    crumpledPositions,
    crumpledNormals,
    uvs,
    indices
  };
}

// -------------------------------------------------------------------------
// VELLUM PAPER XPBD SOLVER
//  - hard distance constraints (zero stretch / rest-length conservation)
//  - bending constraints with PLASTIC rest-angle update past ~15 deg
//  - Voronoi crease map: bending is compliant only on cell edges
//  - shrinking box collider (6-sided press) + spatial-hash self-collision
//  - flat-shaded facet normals
// -------------------------------------------------------------------------
function generateOrganicCrumpleData(w, h, densityRaw, seed, strengthRaw = 1.0) {
  const densityNorm = Math.min(1.0, Math.max(0.0, (densityRaw - 1.0) / 49.0));
  // 0 .. 1 normalized press force (slider goes 0..2)
  const forceN = Math.min(1.0, Math.max(0.0, strengthRaw / 2.0));
  const rng = makeSeededRng(seed + 0.137);
  const minDim = Math.min(w, h);

  const cols = 42;
  const rows = Math.max(30, Math.min(64, Math.round(cols * (h / w))));
  const NX = cols + 1;
  const NY = rows + 1;
  const N = NX * NY;
  const sx = w / cols;
  const sy = h / rows;
  const spacing = Math.min(sx, sy);

  const restPositions = new Float32Array(N * 3);
  const uvs = new Float32Array(N * 2);
  const pos = new Float32Array(N * 3);
  const prev = new Float32Array(N * 3);

  // ---- Voronoi crease map (jittered, anisotropic, multi-scale cells) ----
  // Stratified jitter grid -> uneven cell shapes; per-site radius weight mixes
  // large flat panels with clusters of small facets. Anisotropy stretches cells
  // along a random axis so creases read as long diagonals, not a honeycomb.
  // Stratified (jittered) grid of sites: guarantees EVEN coverage of the whole
  // sheet — every region gets a comparable number of creases — while the jitter,
  // per-site rotation and mild anisotropy keep the network irregular/asymmetric.
  const aspectWH = w / h;
  const targetCells = 4 + Math.round(densityNorm * 6);
  let gx = Math.max(2, Math.round(Math.sqrt(targetCells * aspectWH)));
  let gy = Math.max(2, Math.round(targetCells / gx));
  const numSites = gx * gy;
  const siteX = new Float32Array(numSites);
  const siteY = new Float32Array(numSites);
  const siteSg = new Float32Array(numSites);
  const siteWt = new Float32Array(numSites);   // radius weight (cell size)
  const siteCos = new Float32Array(numSites);
  const siteSin = new Float32Array(numSites);
  const siteAni = new Float32Array(numSites);  // anisotropy factor
  const siteSharp = new Float32Array(numSites);
  const siteOn = new Float32Array(numSites);   // seed-driven active subset

  let si = 0;
  for (let j = 0; j < gy; j++) {
    for (let i2 = 0; i2 < gx; i2++) {
      // jitter inside each stratum -> irregular, non-symmetric cells,
      // but density per unit area stays constant across the sheet
      const jitter = 0.85;
      const ux = (i2 + 0.5 + (rng() - 0.5) * jitter) / gx;
      const uy = (j + 0.5 + (rng() - 0.5) * jitter) / gy;
      siteX[si] = (ux - 0.5) * w * 1.06;
      siteY[si] = (uy - 0.5) * h * 1.06;
      siteSg[si] = rng() > 0.5 ? 1.0 : -1.0;
      // near-uniform cell weight: no clustering of tiny facets in one region
      siteWt[si] = 0.94 + rng() * 0.12;
      const a = rng() * Math.PI;
      siteCos[si] = Math.cos(a);
      siteSin[si] = Math.sin(a);
      siteAni[si] = 1.15 + rng() * 0.75;
      // some creases crisp, some soft
      siteSharp[si] = 0.55 + rng() * 0.45;
      // ACTIVE / DISABLED grid points: the seed decides which subset of the
      // crease network can fold at all. Disabled sites keep their boundary rigid.
      siteOn[si] = rng() < 0.62 ? 1.0 : 0.0;
      si++;
    }
  }

  const creaseW = new Float32Array(N);   // 1 = on a crease line
  const cellSign = new Float32Array(N);  // mountain / valley bias
  const creaseSharp = new Float32Array(N);
  const creaseBand = minDim * 0.015;

  for (let iy = 0; iy < NY; iy++) {
    const vN = iy / rows;
    for (let ix = 0; ix < NX; ix++) {
      const uN = ix / cols;
      const i = iy * NX + ix;
      const px = -w * 0.5 + uN * w;
      const py = h * 0.5 - vN * h;

      restPositions[i * 3] = px;
      restPositions[i * 3 + 1] = py;
      restPositions[i * 3 + 2] = 0.0;
      uvs[i * 2] = Math.max(0.0005, Math.min(0.9995, uN));
      uvs[i * 2 + 1] = Math.max(0.0005, Math.min(0.9995, 1.0 - vN));

      let d1 = 1e9, d2 = 1e9, sg = 1.0, sh = 0.5;
      let a1 = 1.0, a2 = 1.0;
      for (let s = 0; s < numSites; s++) {
        const dx0 = px - siteX[s];
        const dy0 = py - siteY[s];
        // rotate into site frame, stretch one axis (anisotropic cells)
        const rx = (dx0 * siteCos[s] + dy0 * siteSin[s]) / siteAni[s];
        const ry = (-dx0 * siteSin[s] + dy0 * siteCos[s]) * 0.85;
        const d = Math.sqrt(rx * rx + ry * ry) / siteWt[s];
        if (d < d1) { d2 = d1; a2 = a1; d1 = d; sg = siteSg[s]; sh = siteSharp[s]; a1 = siteOn[s]; }
        else if (d < d2) { d2 = d; a2 = siteOn[s]; }
      }
      const edgeDist = Math.max(0.0, d2 - d1);
      // sharper sites -> tighter crease band, softer sites -> broad round fold
      const band = creaseBand * (1.25 - sh * 0.70);
      // an edge only folds if BOTH neighbouring grid points are active
      const activeGate = (a1 > 0.5 && a2 > 0.5) ? 1.0 : 0.0;
      creaseW[i] = Math.exp(-edgeDist / band) * activeGate;
      cellSign[i] = sg;
      creaseSharp[i] = sh;

      // seed buckling: cells lift/dip slightly so folds nucleate on cell edges
      const z0 = sg * minDim * 0.020 * (1.0 - creaseW[i]);
      pos[i * 3] = px;
      pos[i * 3 + 1] = py;
      pos[i * 3 + 2] = z0;
      prev[i * 3] = px;
      prev[i * 3 + 1] = py;
      prev[i * 3 + 2] = z0;
    }
  }

  // ---- Distance constraints (rigid edges: stretch resistance 100%) ----
  const dA = [], dB = [], dRest = [], dK = [];
  function addDist(a, b, k) {
    const dx = restPositions[a * 3] - restPositions[b * 3];
    const dy = restPositions[a * 3 + 1] - restPositions[b * 3 + 1];
    dA.push(a); dB.push(b); dRest.push(Math.hypot(dx, dy)); dK.push(k);
  }
  for (let iy = 0; iy < NY; iy++) {
    for (let ix = 0; ix < NX; ix++) {
      const i = iy * NX + ix;
      if (ix < NX - 1) addDist(i, i + 1, 1.0);
      if (iy < NY - 1) addDist(i, i + NX, 1.0);
      if (ix < NX - 1 && iy < NY - 1) {
        addDist(i, i + NX + 1, 0.85);
        addDist(i + 1, i + NX, 0.85);
      }
    }
  }
  const dCount = dA.length;
  const dAi = Int32Array.from(dA), dBi = Int32Array.from(dB);
  const dRestF = Float32Array.from(dRest), dKF = Float32Array.from(dK);

  // ---- Bending constraints (3-point) with plastic rest length ----
  const bA = [], bB = [], bC = [], bRest = [], bK = [], bP = [];
  function addBend(a, c, b) {
    // a --- c --- b  (c = hinge vertex)
    const dx = restPositions[a * 3] - restPositions[b * 3];
    const dy = restPositions[a * 3 + 1] - restPositions[b * 3 + 1];
    const L = Math.hypot(dx, dy);
    const cr = creaseW[c];
    const sh = creaseSharp[c];
    // rigid everywhere, compliant only along Voronoi crease edges;
    // sharp creases go fully limp, soft ones keep some spring
    // vellum: near-rigid panels, hinge compliance ONLY on crease lines
    const k = 1.0 - (0.92 + 0.075 * sh) * cr;
    // per-edge plastic threshold: creases lock permanently past ~7-14 deg
    const degThr = 26.0 - sh * 8.0;
    bA.push(a); bB.push(b); bC.push(c); bRest.push(L); bK.push(k);
    bP.push(Math.cos(Math.PI * (degThr * 0.5) / 180.0));
  }
  for (let iy = 0; iy < NY; iy++) {
    for (let ix = 1; ix < NX - 1; ix++) {
      const i = iy * NX + ix;
      addBend(i - 1, i, i + 1);
    }
  }
  for (let iy = 1; iy < NY - 1; iy++) {
    for (let ix = 0; ix < NX; ix++) {
      const i = iy * NX + ix;
      addBend(i - NX, i, i + NX);
    }
  }
  const bCount = bA.length;
  const bAi = Int32Array.from(bA), bBi = Int32Array.from(bB), bCi = Int32Array.from(bC);
  const bRestF = Float32Array.from(bRest), bKF = Float32Array.from(bK);
  const bPlast = Float32Array.from(bP);
  const PLASTIC_RATE = 0.88;

  // ---- Fixed invisible sphere: gravity centre + hard core ----
  // Radius derived from sheet AREA so the sheet is always big enough to wrap it
  // completely: 4piR^2 * 3 (slack for folds) = w*h  ->  R = sqrt(w*h / 12pi).
  // It NEVER changes with any control. Force only drives the pull strength.
  const coreR = Math.sqrt((w * h) / (12.0 * Math.PI));
  const coreR2 = coreR * coreR;

  // ---- (legacy press params removed: the solve is pure spherical attraction) ----
  /* legacy notes
  // Planar press: a flat platen squeezes mostly along Z, lateral walls only
  // close in a little. A radial/spherical squeeze is what balled the sheet up,
  // so lateral travel stays small even at maximum force.
  // At the very top of the force range the platen gives way to an isotropic
  // squeeze: the sheet is driven into a shrinking sphere so it wraps onto
  // itself as a faceted ball (rigid edges + plastic creases keep it flat-panelled,
  // it is NOT a smooth radial blob).
  const ballT = Math.max(0.0, Math.min(1.0, (forceN - 0.55) / 0.45));
  const ballE = ballT * ballT * (3.0 - 2.0 * ballT);
  // Core radius sized from SHEET AREA, not eyeballed: a sphere of radius R has
  // surface 4piR^2, so for the sheet (w*h) to wrap it COMPLETELY with slack for
  // folds we need w*h >= ~3x that. Solve R = sqrt(w*h / (3 * 4pi)).
  const wrapR = Math.sqrt((w * h) / (12.0 * Math.PI));
  const ballR = wrapR * (1.02 - ballE * 0.10);

  const planarHz = minDim * (0.105 - forceN * 0.045);
  const planarShrink = (0.90 - densityNorm * 0.04) - forceN * 0.10;
  const ballLateral = ballR / (Math.max(w, h) * 0.5);

  // invisible inner core the sheet wraps around; scales with press force
  let innerRTarget = minDim * (0.02 + forceN * 0.22);
  // the wrap core must stay well inside the confining ball, otherwise the two
  // colliders fight and the sheet can never close over the top of the core
  if (ballE > 0.001) {
    const maxCore = ballR * (0.72 - ballE * 0.14);
    innerRTarget = innerRTarget + (Math.min(innerRTarget, maxCore) - innerRTarget) * ballE;
  }

  const hzTargetRaw = planarHz + (ballR - planarHz) * ballE;
  // the platen must never squash below the core, otherwise the two colliders fight
  const hzTarget = Math.max(hzTargetRaw, innerRTarget * 1.06);
  */

  // ---- Self collision spatial hash ----
  const thickness = spacing * 0.85;
  const cellSize = thickness;
  const invCell = 1.0 / cellSize;
  // Uniform spatial hash on typed arrays (counting sort, no allocations per call)
  const TABLE = 1 << 13;
  const TABLE_MASK = TABLE - 1;
  const cellStart = new Int32Array(TABLE + 1);
  const cellEntries = new Int32Array(N);
  const cellIdx = new Int32Array(N);

  function hashCell(cx, cy, cz) {
    return (((cx * 92837111) ^ (cy * 689287499) ^ (cz * 283923481)) & TABLE_MASK);
  }

  // paper-on-paper contact spawns a NEW crease at the contact region
  const contactFlag = new Uint8Array(N);

  function spawnContactCreases() {
    let any = false;
    for (let c = 0; c < bCount; c++) {
      const hinge = bCi[c];
      if (contactFlag[hinge] && bKF[c] > 0.12) {
        bKF[c] *= 0.35;
        any = true;
      }
    }
    if (any) contactFlag.fill(0);
  }

  function solveSelfCollision() {
    cellStart.fill(0);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const k = hashCell(
        Math.floor(pos[i3] * invCell),
        Math.floor(pos[i3 + 1] * invCell),
        Math.floor(pos[i3 + 2] * invCell)
      );
      cellIdx[i] = k;
      cellStart[k]++;
    }
    let acc = 0;
    for (let k = 0; k < TABLE; k++) { const c = cellStart[k]; cellStart[k] = acc; acc += c; }
    cellStart[TABLE] = acc;
    const cursor = cellStart.slice(0, TABLE);
    for (let i = 0; i < N; i++) cellEntries[cursor[cellIdx[i]]++] = i;

    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      const cx = Math.floor(px * invCell), cy = Math.floor(py * invCell), cz = Math.floor(pz * invCell);
      const ixi = i % NX, iyi = (i - ixi) / NX;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const k = hashCell(cx + ox, cy + oy, cz + oz);
            const s0 = cellStart[k];
            const s1 = cellStart[k + 1];
            for (let n = s0; n < s1; n++) {
              const j = cellEntries[n];
              if (j <= i) continue;
              const ixj = j % NX, iyj = (j - ixj) / NX;
              if (Math.abs(ixi - ixj) <= 2 && Math.abs(iyi - iyj) <= 2) continue;
              const j3 = j * 3;
              let vx = pos[j3] - px;
              let vy = pos[j3 + 1] - py;
              let vz = pos[j3 + 2] - pz;
              const dsq = vx * vx + vy * vy + vz * vz;
              if (dsq > 0.0000001 && dsq < thickness * thickness) {
                const d = Math.sqrt(dsq);
                const corr = (thickness - d) * 0.5 / d;
                vx *= corr; vy *= corr; vz *= corr;
                pos[i3] -= vx; pos[i3 + 1] -= vy; pos[i3 + 2] -= vz;
                pos[j3] += vx; pos[j3 + 1] += vy; pos[j3 + 2] += vz;
                contactFlag[i] = 1; contactFlag[j] = 1;
              }
            }
          }
        }
      }
    }
  }

  // ---- Solve ----
  const STEPS = 40 + Math.round(forceN * 32);
  // more Gauss-Seidel passes at high force = harder stretch constraint
  const ITERS = 4 + Math.round(forceN * 4);
  const DAMP = 0.86;

  for (let step = 0; step < STEPS; step++) {
    const t = step / (STEPS - 1);
    const ease = -(Math.cos(Math.PI * t) - 1.0) * 0.5;

    // GRAVITY toward the centre of the invisible sphere. This is the ONLY
    // driving force — no shrinking collider, no platen. Every vertex is pulled
    // with the same relative strength, so the centre folds as much as the edges.
    // F = normalize(Center - Vi) * Strength — identical magnitude for EVERY
    // vertex, so the sheet presses in from all 360 degrees at once.
    const g = coreR * (0.030 + forceN * 0.075) * ease;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const vx = (pos[i3] - prev[i3]) * DAMP;
      const vy = (pos[i3 + 1] - prev[i3 + 1]) * DAMP;
      const vz = (pos[i3 + 2] - prev[i3 + 2]) * DAMP;
      prev[i3] = pos[i3]; prev[i3 + 1] = pos[i3 + 1]; prev[i3 + 2] = pos[i3 + 2];

      const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      const d = Math.sqrt(x * x + y * y + z * z) || 1e-6;
      const nx = x / d, ny = y / d, nz = z / d;
      pos[i3] = x + vx - nx * g;
      pos[i3 + 1] = y + vy - ny * g;
      // tiny buckling bias so folds nucleate on ACTIVE crease lines only
      pos[i3 + 2] = z + vz - nz * g
        + cellSign[i] * creaseW[i] * spacing * 0.030 * ease;
    }

    for (let it = 0; it < ITERS; it++) {
      // rigid distance constraints
      for (let c = 0; c < dCount; c++) {
        const a = dAi[c] * 3, b = dBi[c] * 3;
        let vx = pos[b] - pos[a];
        let vy = pos[b + 1] - pos[a + 1];
        let vz = pos[b + 2] - pos[a + 2];
        const d = Math.hypot(vx, vy, vz);
        if (d < 0.000001) continue;
        const diff = (d - dRestF[c]) / d * 0.5 * dKF[c];
        vx *= diff; vy *= diff; vz *= diff;
        pos[a] += vx; pos[a + 1] += vy; pos[a + 2] += vz;
        pos[b] -= vx; pos[b + 1] -= vy; pos[b + 2] -= vz;
      }
      // plastic bending
      for (let c = 0; c < bCount; c++) {
        const a = bAi[c] * 3, b = bBi[c] * 3;
        let vx = pos[b] - pos[a];
        let vy = pos[b + 1] - pos[a + 1];
        let vz = pos[b + 2] - pos[a + 2];
        const d = Math.hypot(vx, vy, vz);
        if (d < 0.000001) continue;
        let rest = bRestF[c];
        // past 15 deg of bend -> permanent crease (rest angle follows)
        if (d < rest * bPlast[c]) {
          rest += (d - rest) * PLASTIC_RATE;
          bRestF[c] = rest;
        }
        const diff = (d - rest) / d * 0.5 * bKF[c];
        vx *= diff; vy *= diff; vz *= diff;
        pos[a] += vx; pos[a + 1] += vy; pos[a + 2] += vz;
        pos[b] -= vx; pos[b + 1] -= vy; pos[b + 2] -= vz;
      }
      // FIXED invisible sphere: hard, non-penetrable core of constant radius.
      // Paper drapes over it; it never shrinks or grows.
      for (let i = 0; i < N; i++) {
        const i3 = i * 3;
        const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
        const dsq = x * x + y * y + z * z;
        if (dsq < coreR2) {
          // push OUT to the surface. Near the z=0 plane the radial direction is
          // degenerate (purely in-plane), so bias it off-plane by the cell's
          // mountain/valley sign — that is what makes the sheet climb onto the
          // sphere from both hemispheres instead of staying flat.
          let bz = z;
          const flat = 1.0 - Math.min(1.0, Math.abs(z) / (coreR * 0.35));
          if (flat > 0.0) bz += cellSign[i] * coreR * 0.55 * flat;
          let d = Math.sqrt(x * x + y * y + bz * bz);
          let nx, ny, nz;
          if (d < 1e-6) {
            nx = 0.0; ny = 0.0; nz = cellSign[i] >= 0 ? 1.0 : -1.0;
          } else {
            nx = x / d; ny = y / d; nz = bz / d;
          }
          pos[i3] = nx * coreR;
          pos[i3 + 1] = ny * coreR;
          pos[i3 + 2] = nz * coreR;
        }
      }
    }

    const scEvery = forceN > 0.4 ? 2 : 3;
    if (step % scEvery === 0 && step > 3) {
      solveSelfCollision();
      spawnContactCreases();
    }

    // final rigid-edge passes so the platen clamp and self-collision can never
    // leave the surface stretched or shrunk (rest-length conservation)
    const finalPasses = 1 + Math.round(forceN * 2);
    for (let it = 0; it < finalPasses; it++) {
      for (let c = 0; c < dCount; c++) {
        const a = dAi[c] * 3, b = dBi[c] * 3;
        let vx = pos[b] - pos[a];
        let vy = pos[b + 1] - pos[a + 1];
        let vz = pos[b + 2] - pos[a + 2];
        const d = Math.hypot(vx, vy, vz);
        if (d < 0.000001) continue;
        const diff = (d - dRestF[c]) / d * 0.5 * dKF[c];
        vx *= diff; vy *= diff; vz *= diff;
        pos[a] += vx; pos[a + 1] += vy; pos[a + 2] += vz;
        pos[b] -= vx; pos[b + 1] -= vy; pos[b + 2] -= vz;
      }
    }
  }

  const crumpledPositions = new Float32Array(pos);

  // recenter
  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < N; i++) {
    ax += crumpledPositions[i * 3];
    ay += crumpledPositions[i * 3 + 1];
    az += crumpledPositions[i * 3 + 2];
  }
  ax /= N; ay /= N; az /= N;
  for (let i = 0; i < N; i++) {
    crumpledPositions[i * 3] -= ax;
    crumpledPositions[i * 3 + 1] -= ay;
    crumpledPositions[i * 3 + 2] -= az;
  }

  const indices = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const v00 = iy * NX + ix;
      const v10 = v00 + 1;
      const v01 = (iy + 1) * NX + ix;
      const v11 = v01 + 1;
      indices.push(v00, v01, v10);
      indices.push(v10, v01, v11);
    }
  }

  const tempGeo = new THREE.BufferGeometry();
  tempGeo.setAttribute('position', new THREE.BufferAttribute(crumpledPositions.slice(), 3));
  tempGeo.setIndex(indices);
  tempGeo.computeVertexNormals();
  const crumpledNormals = tempGeo.getAttribute('normal').array;
  tempGeo.dispose();

  return { restPositions, crumpledPositions, crumpledNormals, uvs, indices };
}

// -------------------------------------------------------------------------
// LARGE FOLD PATTERN (rigid origami, no micro-creases)
//  - 3..4 straight diagonal crease lines across the whole sheet
//  - 5..8 perfectly PLANAR panels (each is a rigid transform of the flat sheet)
//  - large fold angles (90..140 deg) so panels physically overlap in 3D
//  - nested half-spaces => every fold rotates a set with a single uniform
//    transform, so panels never tear and never stretch
// -------------------------------------------------------------------------
function generateLargeFoldCrumpleData(w, h, densityRaw, seed, strengthRaw = 1.0, platenZ = 0.155) {
  const rng = makeSeededRng(seed * 1.371 + 11.7);
  const densityNorm = Math.min(1.0, Math.max(0.0, (densityRaw - 1.0) / 49.0));
  const forceN = Math.min(1.0, Math.max(0.0, strengthRaw / 1.6));
  const minDim = Math.min(w, h);
  const DEG = Math.PI / 180.0;

  const cols = 96;
  const rows = Math.max(64, Math.round(cols * (h / w)));
  const NX = cols + 1;
  const NY = rows + 1;
  const N = NX * NY;

  const restPositions = new Float32Array(N * 3);
  const uvs = new Float32Array(N * 2);
  const crumpledPositions = new Float32Array(N * 3);

  // --- CROSS-FOLD ORIGAMI NODE ---------------------------------------------
  // 4 straight crease rays meeting at ONE point => 4 wedge panels that face in
  // different directions. Rigid folding around a degree-4 vertex: the product
  // of the four fold rotations must be identity (loop closure), otherwise the
  // panels tear apart. We solve for that closure numerically, so every panel
  // stays perfectly planar and the sheet never stretches.
  const TWO_PI = Math.PI * 2.0;

  function solve3(A, b) {
    const M = [
      [A[0][0], A[0][1], A[0][2], b[0]],
      [A[1][0], A[1][1], A[1][2], b[1]],
      [A[2][0], A[2][1], A[2][2], b[2]],
    ];
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      const t = M[c]; M[c] = M[piv]; M[piv] = t;
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // node position — near the centre, offset so the layout reads asymmetric
  const nodeX = (rng() - 0.5) * w * 0.26;
  const nodeY = (rng() - 0.5) * h * 0.26;
  const nodeC = new THREE.Vector3(nodeX, nodeY, 0);

  // 4 sectors of clearly unequal size => wedges of different width
  // Kawasaki-flat-foldable degree-4 vertex: opposite sector angles sum to PI.
  // This guarantees a NON-TRIVIAL rigid folding branch exists with LARGE fold
  // angles (90-140 deg) — without it the closure solver collapses to a flat
  // sheet with one lifted corner.
  const a1 = 0.62 + rng() * 0.85;
  const a2 = 0.62 + rng() * 0.85;
  const sect = [a1, a2, Math.PI - a1, Math.PI - a2];
  const ang = [];
  let accA = rng() * TWO_PI;
  for (let i = 0; i < 4; i++) { ang.push(accA); accA += sect[i]; }
  const axes = ang.map((a) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0));

  // Alternating mountain / valley: adjacent panels swing to OPPOSITE sides,
  // so the node is pushed out along Z and the sheet gains real volume.
  const driveDeg = 46 + rng() * 20;
  const drive = driveDeg * DEG * forceN * (rng() < 0.5 ? 1 : -1);
  const rho = [drive, -drive * 0.92, drive * 1.05, -drive * 0.88];

  const qTmp = new THREE.Quaternion();
  function prodQ(r) {
    const q = new THREE.Quaternion();
    const order = [1, 2, 3, 0];
    for (let n = 0; n < 4; n++) {
      const i = order[n];
      qTmp.setFromAxisAngle(axes[i], r[i]);
      q.multiply(qTmp);
    }
    return q;
  }
  function logQ(q) {
    let x = q.x, y = q.y, z = q.z, ww = q.w;
    if (ww < 0) { x = -x; y = -y; z = -z; ww = -ww; }
    const s = Math.sqrt(Math.max(0.0, 1.0 - ww * ww));
    if (s < 1e-9) return [0, 0, 0];
    const a = 2.0 * Math.acos(Math.min(1.0, ww));
    return [x / s * a, y / s * a, z / s * a];
  }

  // Levenberg-Marquardt on rho1..rho3 so the four folds close the vertex loop
  for (let it = 0; it < 70; it++) {
    const f = logQ(prodQ(rho));
    const err = Math.hypot(f[0], f[1], f[2]);
    if (err < 1e-5) break;
    const eps = 1e-4;
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) {
      const t = rho.slice();
      t[k + 1] += eps;
      const fk = logQ(prodQ(t));
      for (let r = 0; r < 3; r++) J[r][k] = (fk[r] - f[r]) / eps;
    }
    const lam = 1e-3 + err * 0.03;
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const b = [0, 0, 0];
    for (let i2 = 0; i2 < 3; i2++) {
      for (let j2 = 0; j2 < 3; j2++) {
        let s2 = 0;
        for (let r = 0; r < 3; r++) s2 += J[r][i2] * J[r][j2];
        A[i2][j2] = s2 + (i2 === j2 ? lam : 0);
      }
      let s3 = 0;
      for (let r = 0; r < 3; r++) s3 += J[r][i2] * f[r];
      b[i2] = -s3;
    }
    const d = solve3(A, b);
    if (!d) break;
    for (let k = 0; k < 3; k++) rho[k + 1] += Math.max(-0.35, Math.min(0.35, d[k]));
  }

  // accumulated rigid transform per wedge
  const T = [new THREE.Quaternion()];
  const accQ = new THREE.Quaternion();
  for (let k = 1; k < 4; k++) {
    qTmp.setFromAxisAngle(axes[k], rho[k]);
    accQ.multiply(qTmp);
    T.push(accQ.clone());
  }
  // spread whatever closure error is left evenly across the four creases
  const resLog = logQ(prodQ(rho));
  const rl = new THREE.Vector3(resLog[0], resLog[1], resLog[2]);
  const rang = rl.length();
  if (rang > 1e-8) {
    const rax = rl.divideScalar(rang);
    for (let k = 1; k < 4; k++) {
      T[k].multiply(new THREE.Quaternion().setFromAxisAngle(rax, -rang * k * 0.25));
    }
  }

  // NO TUMBLE: re-frame every wedge transform relative to the LARGEST panel so
  // that panel stays exactly in the flat XY plane, facing the camera. The sheet
  // therefore always reads as folding out of a flat sheet — it never spins or
  // drifts in orientation with the seed.
  let baseWedge = 0;
  for (let k = 1; k < 4; k++) if (sect[k] > sect[baseWedge]) baseWedge = k;
  const baseInv = T[baseWedge].clone().invert();
  for (let k = 0; k < 4; k++) T[k].premultiply(baseInv);

  function wedgeOf(px, py) {
    const th = Math.atan2(py - nodeY, px - nodeX);
    for (let k = 0; k < 4; k++) {
      let d0 = th - ang[k];
      d0 = ((d0 % TWO_PI) + TWO_PI) % TWO_PI;
      const wsp = (k < 3) ? (ang[k + 1] - ang[k]) : (ang[0] + TWO_PI - ang[3]);
      if (d0 < wsp) return k;
    }
    return 0;
  }

  // --- 1..2 large corner flaps, each fully inside a single wedge ------------
  const cornersXY = [
    [-w * 0.5, -h * 0.5], [w * 0.5, -h * 0.5],
    [w * 0.5, h * 0.5], [-w * 0.5, h * 0.5],
  ];
  const cornerFolds = [];
  const pickOrder = [0, 1, 2, 3].sort(() => rng() - 0.5);
  const wantFlaps = 4;
  for (const ci of pickOrder) {
    if (cornerFolds.length >= wantFlaps) break;
    const ccx = cornersXY[ci][0], ccy = cornersXY[ci][1];
    const ul = Math.hypot(ccx - nodeX, ccy - nodeY) || 1;
    const ux = (nodeX - ccx) / ul, uy = (nodeY - ccy) / ul;
    // panel scale 0.866 linear => ~25% less area per flat panel
    const dcut = minDim * (0.22 + rng() * 0.22) * 0.79;
    const pxp = -uy, pyp = ux;
    const wc = wedgeOf(ccx, ccy);
    let ok = true;
    for (let s = 0; s <= 4; s++) {
      const tt = (s / 4) * dcut;
      if (wedgeOf(ccx + ux * tt + pxp * tt, ccy + uy * tt + pyp * tt) !== wc) ok = false;
      if (wedgeOf(ccx + ux * tt - pxp * tt, ccy + uy * tt - pyp * tt) !== wc) ok = false;
    }
    if (!ok) continue;
    // SECONDARY SMALLER FACETS: in SOME flaps only (seed decides), the flap is
    // subdivided by 1-2 extra creases parallel to its hinge. They are nested
    // triangles fully inside the flap, so every sub-panel stays perfectly
    // planar and no edge tears. Applied innermost-first.
    const subs = [];
    if (rng() < 1.0) {
      const nSub = 2 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.35 ? 1 : 0);
      let dPrev = dcut;
      for (let s = 0; s < nSub; s++) {
        const dSub = dPrev * (0.52 + rng() * 0.20);
        subs.push({
          d: dSub,
          point: new THREE.Vector3(ccx + ux * dSub, ccy + uy * dSub, 0),
          quat: new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(-uy, ux, 0).normalize(),
            (34 + rng() * 28) * DEG * forceN * (rng() < 0.5 ? 1 : -1)
          ),
        });
        dPrev = dSub;
      }
      // innermost first
      subs.sort((a, b) => a.d - b.d);
    }

    cornerFolds.push({
      cx: ccx, cy: ccy, ux, uy, dcut, wedge: wc, subs,
      point: new THREE.Vector3(ccx + ux * dcut, ccy + uy * dcut, 0),
      quat: new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(-uy, ux, 0).normalize(),
        (48 + rng() * 22) * DEG * forceN * (rng() < 0.5 ? 1 : -1)
      ),
    });
  }

  const v = new THREE.Vector3();
  for (let iy = 0; iy < NY; iy++) {
    const vN = iy / rows;
    for (let ix = 0; ix < NX; ix++) {
      const uN = ix / cols;
      const i = iy * NX + ix;
      const px = -w * 0.5 + uN * w;
      const py = h * 0.5 - vN * h;

      restPositions[i * 3] = px;
      restPositions[i * 3 + 1] = py;
      restPositions[i * 3 + 2] = 0.0;
      uvs[i * 2] = Math.max(0.0005, Math.min(0.9995, uN));
      uvs[i * 2 + 1] = Math.max(0.0005, Math.min(0.9995, 1.0 - vN));

      const wk = wedgeOf(px, py);
      v.set(px, py, 0);

      // corner flap folds first, in the flat frame (keeps the panel rigid)
      for (const cf of cornerFolds) {
        if (cf.wedge !== wk) continue;
        const rel = (px - cf.cx) * cf.ux + (py - cf.cy) * cf.uy;
        if (rel >= 0 && rel < cf.dcut) {
          for (let s = 0; s < cf.subs.length; s++) {
            const sf = cf.subs[s];
            if (rel < sf.d) v.sub(sf.point).applyQuaternion(sf.quat).add(sf.point);
          }
          v.sub(cf.point).applyQuaternion(cf.quat).add(cf.point);
          break;
        }
      }

      // wedge rotation about the shared node => real Z depth, panels overlap
      v.sub(nodeC).applyQuaternion(T[wk]).add(nodeC);

      crumpledPositions[i * 3] = v.x;
      crumpledPositions[i * 3 + 1] = v.y;
      // hairline separation so stacked panels never z-fight
      crumpledPositions[i * 3 + 2] = v.z + wk * minDim * 0.0035;
    }
  }

  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < N; i++) {
    ax += crumpledPositions[i * 3];
    ay += crumpledPositions[i * 3 + 1];
    az += crumpledPositions[i * 3 + 2];
  }
  ax /= N; ay /= N; az /= N;
  // PLATEN FLATTENING: an invisible flat surface presses the folded form down.
  // A uniform scale along Z is affine, so every panel stays perfectly planar and
  // every crease stays sharp — the silhouette just reads pressed, not airborne.
  const PLATEN_Z = 0.155;
  for (let i = 0; i < N; i++) {
    crumpledPositions[i * 3] -= ax;
    crumpledPositions[i * 3 + 1] -= ay;
    crumpledPositions[i * 3 + 2] = (crumpledPositions[i * 3 + 2] - az) * PLATEN_Z;
  }

  const indices = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const v00 = iy * NX + ix;
      const v10 = v00 + 1;
      const v01 = (iy + 1) * NX + ix;
      const v11 = v01 + 1;
      indices.push(v00, v01, v10);
      indices.push(v10, v01, v11);
    }
  }

  const tempGeo = new THREE.BufferGeometry();
  tempGeo.setAttribute('position', new THREE.BufferAttribute(crumpledPositions.slice(), 3));
  tempGeo.setIndex(indices);
  tempGeo.computeVertexNormals();
  const crumpledNormals = tempGeo.getAttribute('normal').array;
  tempGeo.dispose();

  return { restPositions, crumpledPositions, crumpledNormals, uvs, indices };
}

// Small LRU cache so a seed morph only simulates the NEW seed, not both.
const crumpleDataCache = new Map();
function getCrumpleData(w, h, density, seed, strength = 1.0) {
  const sQ = Math.round(strength * 10) / 10;
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${density.toFixed(2)}_${seed}_${sQ}`;
  const hit = crumpleDataCache.get(key);
  if (hit) return hit;
  const data = generateLargeFoldCrumpleData(w, h, density, seed, sQ);
  crumpleDataCache.set(key, data);
  if (crumpleDataCache.size > 4) {
    crumpleDataCache.delete(crumpleDataCache.keys().next().value);
  }
  return data;
}

// -------------------------------------------------------------------------
// 5-PHASE PROGRESSIVE CRUMPLE
// Phase 0 = flat sheet, phases 1..5 = the SAME crease layout folded to
// progressively deeper angles. The sheet therefore passes through real
// intermediate stages instead of snapping between "flat" and "crumpled".
// -------------------------------------------------------------------------
const CRUMPLE_PHASES = 5;
const phaseCache = new Map();

function getCrumplePhases(w, h, density, seed, strength) {
  const sQ = Math.round(strength * 10) / 10;
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${density.toFixed(2)}_${seed}_${sQ}`;
  const hit = phaseCache.get(key);
  if (hit) return hit;

  // Per-phase fold force and platen compression. The ramp is deliberately
  // non-linear: phases 1-4 build up, phase 5 is a hard slam — maximum fold
  // angles AND a much flatter platen, so the final pose reads unmistakably as
  // "pressed against a wall by an invisible bar".
  const PHASE_FORCE = [0.30, 0.52, 0.74, 1.00, 1.85];
  const PHASE_PLATEN = [0.170, 0.160, 0.145, 0.120, 0.045];

  const stages = [];
  let flatNormals = null;
  for (let p = 1; p <= CRUMPLE_PHASES; p++) {
    const f = PHASE_FORCE[p - 1];
    const d = generateLargeFoldCrumpleData(w, h, density, seed, sQ * f, PHASE_PLATEN[p - 1]);
    if (!flatNormals) {
      flatNormals = new Float32Array(d.restPositions.length);
      for (let i = 2; i < flatNormals.length; i += 3) flatNormals[i] = 1.0;
      stages.push({ pos: d.restPositions, norm: flatNormals });
    }
    stages.push({ pos: d.crumpledPositions, norm: d.crumpledNormals });
  }
  phaseCache.set(key, stages);
  if (phaseCache.size > 3) phaseCache.delete(phaseCache.keys().next().value);
  return stages;
}

function blendPhase(stages, prog, out, outN, weight, additive) {
  const t = Math.max(0, Math.min(1, prog)) * CRUMPLE_PHASES;
  let i = Math.floor(t);
  let f = t - i;
  if (i >= CRUMPLE_PHASES) { i = CRUMPLE_PHASES - 1; f = 1.0; }
  f = f * f * (3.0 - 2.0 * f);
  const a = stages[i], b = stages[i + 1];
  const n = out.length;
  for (let k = 0; k < n; k++) {
    const pv = a.pos[k] + (b.pos[k] - a.pos[k]) * f;
    const nv = a.norm[k] + (b.norm[k] - a.norm[k]) * f;
    if (additive) { out[k] += pv * weight; outN[k] += nv * weight; }
    else { out[k] = pv * weight; outN[k] = nv * weight; }
  }
}

let phaseBufPos = null;
let phaseBufNorm = null;

// Stepped phase remap: each of the 5 phases gets a SHORT transition followed by
// a long visible plateau, so the eye reads five distinct stages of crumpling.
function phaseStep(p) {
  const u = Math.max(0, Math.min(1, p)) * CRUMPLE_PHASES;
  let i = Math.floor(u);
  let f = u - i;
  if (i >= CRUMPLE_PHASES) { i = CRUMPLE_PHASES - 1; f = 1.0; }
  const TRANS = 0.42; // 30% moving, 70% holding
  let g = Math.min(1.0, f / TRANS);
  g = g * g * (3.0 - 2.0 * g);
  return (i + g) / CRUMPLE_PHASES;
}

function applyCrumplePhase(progRaw, morph) {
  if (!crumpleMesh || !crumpleMesh.geometry) return;
  const prog = phaseStep(progRaw);
  const density = controls.get('wrinkleDensity') ?? 50.0;
  const str = controls.get('crumpleFoldStrength') ?? 1.0;
  const stagesA = getCrumplePhases(posterWidth, posterHeight, density, currentSeedA, str);
  const stagesB = (currentSeedA === currentSeedB)
    ? stagesA
    : getCrumplePhases(posterWidth, posterHeight, density, currentSeedB, str);

  const len = stagesA[0].pos.length;
  if (!phaseBufPos || phaseBufPos.length !== len) {
    phaseBufPos = new Float32Array(len);
    phaseBufNorm = new Float32Array(len);
  }
  const m = Math.max(0, Math.min(1, morph || 0));
  blendPhase(stagesA, prog, phaseBufPos, phaseBufNorm, 1.0 - m, false);
  if (m > 0.0001) blendPhase(stagesB, prog, phaseBufPos, phaseBufNorm, m, true);

  const geo = crumpleMesh.geometry;
  const ap = geo.getAttribute('aCrumpledPos');
  const an = geo.getAttribute('aCrumpledNormal');
  const ap2 = geo.getAttribute('aCrumpledPosNext');
  const an2 = geo.getAttribute('aCrumpledNormalNext');
  if (!ap || ap.array.length !== len) return;
  ap.copyArray(phaseBufPos); an.copyArray(phaseBufNorm);
  ap2.copyArray(phaseBufPos); an2.copyArray(phaseBufNorm);
  ap.needsUpdate = true; an.needsUpdate = true;
  ap2.needsUpdate = true; an2.needsUpdate = true;
}

let currentSeedA = controls.get('crumpleSeed') ?? 74;
let currentSeedB = currentSeedA;

function createCrumpleGeometry(w, h, density, seedA, seedB) {
  const str = controls.get('crumpleFoldStrength') ?? 1.0;
  const dataA = getCrumpleData(w, h, density, seedA, str);
  const dataB = (seedA === seedB) ? dataA : getCrumpleData(w, h, density, seedB, str);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(dataA.restPositions, 3));
  
  const attrPosA = new THREE.BufferAttribute(new Float32Array(dataA.crumpledPositions), 3);
  attrPosA.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCrumpledPos', attrPosA);

  const attrNormA = new THREE.BufferAttribute(new Float32Array(dataA.crumpledNormals), 3);
  attrNormA.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCrumpledNormal', attrNormA);

  const attrPosB = new THREE.BufferAttribute(new Float32Array(dataB.crumpledPositions), 3);
  attrPosB.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCrumpledPosNext', attrPosB);

  const attrNormB = new THREE.BufferAttribute(new Float32Array(dataB.crumpledNormals), 3);
  attrNormB.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCrumpledNormalNext', attrNormB);

  geometry.setAttribute('uv', new THREE.BufferAttribute(dataA.uvs, 2));
  geometry.setIndex(dataA.indices);
  geometry.computeVertexNormals();

  return geometry;
}

function updateCrumpleBuffers(seedA, seedB) {
  if (!crumpleMesh || !crumpleMesh.geometry) return;
  const density = controls.get('wrinkleDensity') ?? 50.0;
  
  const str = controls.get('crumpleFoldStrength') ?? 1.0;
  const dataA = getCrumpleData(posterWidth, posterHeight, density, seedA, str);
  const dataB = (seedA === seedB) ? dataA : getCrumpleData(posterWidth, posterHeight, density, seedB, str);

  const geo = crumpleMesh.geometry;
  const attrPosA = geo.getAttribute('aCrumpledPos');
  const attrNormA = geo.getAttribute('aCrumpledNormal');
  const attrPosB = geo.getAttribute('aCrumpledPosNext');
  const attrNormB = geo.getAttribute('aCrumpledNormalNext');

  if (attrPosA && attrPosB) {
    attrPosA.copyArray(dataA.crumpledPositions);
    attrNormA.copyArray(dataA.crumpledNormals);
    attrPosB.copyArray(dataB.crumpledPositions);
    attrNormB.copyArray(dataB.crumpledNormals);

    attrPosA.needsUpdate = true;
    attrNormA.needsUpdate = true;
    attrPosB.needsUpdate = true;
    attrNormB.needsUpdate = true;
  }
}

// =========================================================================
// 10. FLOATING TILES SHADER
// =========================================================================
const tileVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  void main() {
    vUv = clamp(uv, 0.0005, 0.9995);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const tileFragmentShader = `
  uniform sampler2D uTexture;
  uniform vec2 uDimensions;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  
  ${glslPaperHeader}
  
  void main() {
    vec3 dX = dFdx(vWorldPos);
    vec3 dY = dFdy(vWorldPos);
    vec3 crossN = cross(dX, dY);
    vec3 geomNormal = length(crossN) > 0.0001 ? normalize(crossN) : vNormal;
    if (!gl_FrontFacing) geomNormal = -geomNormal;
    
    vec4 texColor = texture2D(uTexture, vUv);
    vec3 paperBase = sRGBToLinear(vec3(0.97, 0.97, 0.97));
    vec3 baseAlbedo;
    
    if (gl_FrontFacing) {
      baseAlbedo = mix(paperBase, sRGBToLinear(texColor.rgb), texColor.a);
    } else {
      vec2 backUv = vec2(1.0 - vUv.x, vUv.y);
      vec3 bleedColor = sampleBacksideBleed(uTexture, backUv, uDimensions);
      baseAlbedo = paperBase * mix(vec3(1.0), bleedColor, 0.32);
    }
    
    vec3 color = renderPaperMaterial(
      texColor.rgb,
      baseAlbedo,
      geomNormal,
      geomNormal,
      vUv,
      uDimensions,
      vWorldPos,
      cameraPosition,
      uGrainIntensity,
      uRoughness,
      uKeyLightIntensity,
      uFillLightIntensity,
      uKeyLightPos,
      uFillLightPos,
      0.0,
      0.0
    );
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

// =========================================================================
// 11. 3D MESH GENERATION & DYNAMIC TEXTURE BINDING
// =========================================================================
const SEG_X = 96;
const SEG_Y = 128;

let foldMesh = null;
let peelLayerMeshes = [];
let crumpleMesh = null;

let foldMaterial = null;
let peelLayerMaterials = [];
let crumpleMaterial = null;

const floatTilesGroup = new THREE.Group();
mainStage.add(floatTilesGroup);
let floatingTiles = [];

function updateMaterialStockAndTextures() {
  activePaperPreset = controls.get('paperTexture') || 'lightly_crumpled';
  const crumpleFolds = controls.get('crumpleTextureFolds') ?? 1.7;

  if (activePaperPreset === 'lightly_crumpled') {
    paperPresetsCache.lightly_crumpled = generatePaperMaps('lightly_crumpled', crumpleFolds, 42);
  } else if (!paperPresetsCache[activePaperPreset]) {
    paperPresetsCache[activePaperPreset] = generatePaperMaps(activePaperPreset);
  }

  const maps = paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte;
  activePaperAlbedoMap = maps.albedo;
  activePaperNormalMap = maps.normal;
  activePaperRoughnessMap = maps.roughness;

  const baseRough = controls.get('paperRoughness') ?? 0.0;
  const effRough = getStockRoughnessScalar(activePaperPreset, baseRough);
  const specParams = getStockSpecParams(activePaperPreset);
  const stockCode = getStockTypeCode(activePaperPreset);
  const glossDens = controls.get('glossVarnishDensity') ?? 1.0;
  const glossShine = controls.get('glossShineStrength') ?? 0.5;

  const applyToUniforms = (u) => {
    if (!u) return;
    if (u.uPaperAlbedoMap) u.uPaperAlbedoMap.value = activePaperAlbedoMap;
    if (u.uPaperNormalMap) u.uPaperNormalMap.value = activePaperNormalMap;
    if (u.uPaperRoughnessMap) u.uPaperRoughnessMap.value = activePaperRoughnessMap;
    if (u.uRoughness) u.uRoughness.value = effRough;
    if (u.uStockType) u.uStockType.value = stockCode;
    if (u.uGrainScale) u.uGrainScale.value = specParams.grainScale;
    if (u.uSpecPower) u.uSpecPower.value = specParams.power;
    if (u.uSpecIntensity) u.uSpecIntensity.value = specParams.intensity;
    if (u.uSheenFactor) u.uSheenFactor.value = specParams.sheen;
    if (u.uFleckIntensity) u.uFleckIntensity.value = specParams.fleck;
    if (u.uGlossDensity) u.uGlossDensity.value = glossDens;
    if (u.uGlossShine) u.uGlossShine.value = glossShine;
    if (u.uCrumpleFolds) u.uCrumpleFolds.value = crumpleFolds;
    if (u.uCrumpleFoldStrength) u.uCrumpleFoldStrength.value = controls.get('crumpleFoldStrength') ?? 1.0;
    if (u.uCrumpleMicroTextureIntensity) u.uCrumpleMicroTextureIntensity.value = controls.get('crumpleMicroTextureIntensity') ?? 1.0;
    if (u.uCrumpleMicroTextureSize) u.uCrumpleMicroTextureSize.value = controls.get('crumpleMicroTextureSize') ?? 1.2;
  };

  applyToUniforms(foldUniforms);
  applyToUniforms(peelUniforms);
  applyToUniforms(crumpleUniforms);

  peelLayerMaterials.forEach((m) => {
    applyToUniforms(m.uniforms);
  });

  floatingTiles.forEach((tile, i) => {
    if (tile.material && tile.material.uniforms) {
      const perTileVariation = controls.get('perTileTextureVariation') !== false;
      const tileMaps = perTileVariation
        ? getTilePaperMaps(activePaperPreset, crumpleFolds, i)
        : (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte);

      applyToUniforms(tile.material.uniforms);
      tile.material.uniforms.uPaperAlbedoMap.value = tileMaps.albedo;
      tile.material.uniforms.uPaperNormalMap.value = tileMaps.normal;
      tile.material.uniforms.uPaperRoughnessMap.value = tileMaps.roughness;
    }
  });
}

function createMaterials() {
  foldMaterial = new THREE.ShaderMaterial({
    vertexShader: foldVertexShader,
    fragmentShader: foldFragmentShader,
    uniforms: foldUniforms,
    side: THREE.DoubleSide,
  });

  peelLayerMaterials = [];
  for (let i = 0; i < 5; i++) {
    const uniforms = {
      ...glslCommonUniforms,
      uTexture: { value: defaultTextures[i % defaultTextures.length] },
      uDimensions: { value: new THREE.Vector2(2.75, 3.88) },
      uPeelProgress: { value: 0.0 },
      uPeelAngle: { value: 25.0 },
      uCurlRadius: { value: 0.20 },
      uBacksideStyle: { value: 0.0 },
      uBacksideColor: { value: new THREE.Color('#DD1010') },
      uTime: { value: 0.0 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: peelVertexShader,
      fragmentShader: peelFragmentShader,
      uniforms: uniforms,
      side: THREE.DoubleSide,
    });
    peelLayerMaterials.push(mat);
  }

  crumpleMaterial = new THREE.ShaderMaterial({
    vertexShader: crumpleVertexShader,
    fragmentShader: crumpleFragmentShader,
    uniforms: crumpleUniforms,
    side: THREE.DoubleSide,
  });

  updateMaterialStockAndTextures();
}

createMaterials();

function getActiveTexturesList() {
  if (loadedImageTextures.length > 0) return loadedImageTextures;
  return defaultTextures;
}

function rebuildFloatingTiles() {
  while (floatTilesGroup.children.length > 0) {
    const child = floatTilesGroup.children[0];
    floatTilesGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  }
  floatingTiles = [];

  const tileCount = parseInt(controls.get('tileCount')) || 4;
  const layoutPattern = controls.get('tileLayoutPattern') || 'scatter';
  const grainInt = controls.get('grainIntensity') ?? 0.0;
  const baseRough = controls.get('paperRoughness') ?? 0.0;
  const effRough = getStockRoughnessScalar(activePaperPreset, baseRough);
  const specParams = getStockSpecParams(activePaperPreset);
  const stockCode = getStockTypeCode(activePaperPreset);
  const glossDens = controls.get('glossVarnishDensity') ?? 1.0;
  const glossShine = controls.get('glossShineStrength') ?? 0.5;
  const crumpleFolds = controls.get('crumpleTextureFolds') ?? 1.7;
  const perTileVariation = controls.get('perTileTextureVariation') !== false;
  const keyLightInt = controls.get('keyLightIntensity') ?? 4.0;
  const fillLightInt = controls.get('fillLightIntensity') ?? 3.0;

  const textures = getActiveTexturesList();

  if (layoutPattern === 'grid') {
    let cols = Math.ceil(Math.sqrt(tileCount * currentAspect));
    cols = Math.max(1, Math.min(tileCount, cols));
    const rows = Math.ceil(tileCount / cols);

    const gap = 0.15;
    const tileW = (posterWidth - gap * (cols - 1)) / cols;
    const tileH = (posterHeight - gap * (rows - 1)) / rows;

    for (let i = 0; i < tileCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const posX = -posterWidth * 0.5 + tileW * 0.5 + col * (tileW + gap);
      const posY = posterHeight * 0.5 - tileH * 0.5 - row * (tileH + gap);
      const posZ = 0.10 + i * 0.06;

      const tileGeo = new THREE.PlaneGeometry(tileW, tileH);
      const assignedTex = textures[i % textures.length];

      const tileNoiseOffset = perTileVariation
        ? new THREE.Vector2((i + 1) * 4.71, (i + 1) * 9.23)
        : new THREE.Vector2(0.0, 0.0);

      const tileMaps = perTileVariation
        ? getTilePaperMaps(activePaperPreset, crumpleFolds, i)
        : (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte);

      const tileUniforms = {
        ...glslCommonUniforms,
        uPaperAlbedoMap: { value: tileMaps.albedo },
        uPaperNormalMap: { value: tileMaps.normal },
        uPaperRoughnessMap: { value: tileMaps.roughness },
        uTexture: { value: assignedTex },
        uDimensions: { value: new THREE.Vector2(tileW, tileH) },
        uGrainScale: { value: specParams.grainScale },
        uGrainIntensity: { value: grainInt },
        uRoughness: { value: effRough },
        uSpecPower: { value: specParams.power },
        uSpecIntensity: { value: specParams.intensity },
        uSheenFactor: { value: specParams.sheen },
        uFleckIntensity: { value: specParams.fleck },
        uStockType: { value: stockCode },
        uGlossDensity: { value: glossDens },
        uGlossShine: { value: glossShine },
        uCrumpleFolds: { value: crumpleFolds },
        uNoiseOffset: { value: tileNoiseOffset },
        uKeyLightIntensity: { value: keyLightInt },
        uFillLightIntensity: { value: fillLightInt },
        uKeyLightPos: { value: keyLight.position },
        uFillLightPos: { value: fillLight.position },
      };

      const tileMat = new THREE.ShaderMaterial({
        vertexShader: tileVertexShader,
        fragmentShader: tileFragmentShader,
        uniforms: tileUniforms,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -(i + 1) * 2.0,
        polygonOffsetUnits: -(i + 1) * 4.0,
      });

      const tileMesh = new THREE.Mesh(tileGeo, tileMat);
      tileMesh.position.set(posX, posY, posZ);
      tileMesh.renderOrder = i;

      floatTilesGroup.add(tileMesh);

      floatingTiles.push({
        mesh: tileMesh,
        material: tileMat,
        basePos: new THREE.Vector3(posX, posY, posZ),
        baseRot: new THREE.Euler(0, 0, 0),
        phase: (i * 1.6180339887 * Math.PI * 2),
        speedMult: 0.85 + ((i * 13) % 7) * 0.05,
      });
    }

  } else if (layoutPattern === 'scatter') {
    const cardScale = Math.max(0.46, Math.min(0.68, 1.30 / Math.sqrt(tileCount)));
    const baseCardW = posterWidth * cardScale;

    const cardPositions = [];
    const minCardDist = baseCardW * 0.95;
    const spreadSpanX = posterWidth * 0.98;
    const spreadSpanY = posterHeight * 0.98;

    for (let i = 0; i < tileCount; i++) {
      const phi = i * 2.3999632;
      const r = Math.sqrt((i + 0.4) / Math.max(1, tileCount));
      let px = Math.cos(phi) * spreadSpanX * r * 0.50;
      let py = Math.sin(phi) * spreadSpanY * r * 0.50;
      cardPositions.push({ x: px, y: py });
    }

    for (let iter = 0; iter < 24; iter++) {
      for (let i = 0; i < cardPositions.length; i++) {
        for (let j = i + 1; j < cardPositions.length; j++) {
          const dx = cardPositions[j].x - cardPositions[i].x;
          const dy = cardPositions[j].y - cardPositions[i].y;
          const dist = Math.hypot(dx, dy);
          if (dist < minCardDist && dist > 0.001) {
            const overlap = (minCardDist - dist) * 0.55;
            const nx = dx / dist;
            const ny = dy / dist;
            cardPositions[i].x -= nx * overlap;
            cardPositions[i].y -= ny * overlap;
            cardPositions[j].x += nx * overlap;
            cardPositions[j].y += ny * overlap;
          }
        }
      }
    }

    const stepZ = 0.45;

    for (let i = 0; i < tileCount; i++) {
      const assignedTex = textures[i % textures.length];
      const texAspect = getTextureAspect(assignedTex) || currentAspect;
      const cardW = baseCardW;
      const cardH = cardW / texAspect;

      const posX = cardPositions[i].x;
      const posY = cardPositions[i].y;
      const posZ = 0.25 + i * stepZ;

      const rotZ = ((i * 73) % 17 - 8) * (Math.PI / 180);
      const tiltX = ((i * 41) % 5 - 2) * (Math.PI / 180);
      const tiltY = ((i * 59) % 5 - 2) * (Math.PI / 180);

      const tileGeo = new THREE.PlaneGeometry(cardW, cardH);

      const tileNoiseOffset = perTileVariation
        ? new THREE.Vector2((i + 1) * 4.71, (i + 1) * 9.23)
        : new THREE.Vector2(0.0, 0.0);

      const tileMaps = perTileVariation
        ? getTilePaperMaps(activePaperPreset, crumpleFolds, i)
        : (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte);

      const tileUniforms = {
        ...glslCommonUniforms,
        uPaperAlbedoMap: { value: tileMaps.albedo },
        uPaperNormalMap: { value: tileMaps.normal },
        uPaperRoughnessMap: { value: tileMaps.roughness },
        uTexture: { value: assignedTex },
        uDimensions: { value: new THREE.Vector2(cardW, cardH) },
        uGrainScale: { value: specParams.grainScale },
        uGrainIntensity: { value: grainInt },
        uRoughness: { value: effRough },
        uSpecPower: { value: specParams.power },
        uSpecIntensity: { value: specParams.intensity },
        uSheenFactor: { value: specParams.sheen },
        uFleckIntensity: { value: specParams.fleck },
        uStockType: { value: stockCode },
        uGlossDensity: { value: glossDens },
        uGlossShine: { value: glossShine },
        uCrumpleFolds: { value: crumpleFolds },
        uNoiseOffset: { value: tileNoiseOffset },
        uKeyLightIntensity: { value: keyLightInt },
        uFillLightIntensity: { value: fillLightInt },
        uKeyLightPos: { value: keyLight.position },
        uFillLightPos: { value: fillLight.position },
      };

      const tileMat = new THREE.ShaderMaterial({
        vertexShader: tileVertexShader,
        fragmentShader: tileFragmentShader,
        uniforms: tileUniforms,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -(i + 1) * 2.0,
        polygonOffsetUnits: -(i + 1) * 4.0,
      });

      const tileMesh = new THREE.Mesh(tileGeo, tileMat);
      tileMesh.position.set(posX, posY, posZ);
      tileMesh.rotation.set(tiltX, tiltY, rotZ);
      tileMesh.renderOrder = i;

      floatTilesGroup.add(tileMesh);

      floatingTiles.push({
        mesh: tileMesh,
        material: tileMat,
        basePos: new THREE.Vector3(posX, posY, posZ),
        baseRot: new THREE.Euler(tiltX, tiltY, rotZ),
        phase: (i * 1.6180339887 * Math.PI * 2),
        speedMult: 0.82 + ((i * 17) % 9) * 0.045,
      });
    }

  } else {
    const cardScale = Math.max(0.58, Math.min(0.75, 1.38 / Math.sqrt(Math.max(4, tileCount))));
    const cardW = posterWidth * cardScale;
    
    const spreadSpanX = posterWidth * 0.38;
    const spreadSpanY = posterHeight * 0.26;
    const stepX = tileCount > 1 ? spreadSpanX / (tileCount - 1) : 0;
    const stepY = tileCount > 1 ? spreadSpanY / (tileCount - 1) : 0;

    const stepZ = 0.50;

    for (let i = 0; i < tileCount; i++) {
      const assignedTex = textures[i % textures.length];
      const texAspect = getTextureAspect(assignedTex) || currentAspect;
      const cardH = cardW / texAspect;

      const normIndex = i - (tileCount - 1) * 0.5;
      
      const posX = normIndex * stepX;
      const posY = -normIndex * stepY;
      const posZ = 0.25 + i * stepZ;

      const rotZ = normIndex * -0.026;
      const tiltX = normIndex * 0.005;
      const tiltY = normIndex * -0.006;

      const tileGeo = new THREE.PlaneGeometry(cardW, cardH);

      const tileNoiseOffset = perTileVariation
        ? new THREE.Vector2((i + 1) * 4.71, (i + 1) * 9.23)
        : new THREE.Vector2(0.0, 0.0);

      const tileMaps = perTileVariation
        ? getTilePaperMaps(activePaperPreset, crumpleFolds, i)
        : (paperPresetsCache[activePaperPreset] || paperPresetsCache.smooth_matte);

      const tileUniforms = {
        ...glslCommonUniforms,
        uPaperAlbedoMap: { value: tileMaps.albedo },
        uPaperNormalMap: { value: tileMaps.normal },
        uPaperRoughnessMap: { value: tileMaps.roughness },
        uTexture: { value: assignedTex },
        uDimensions: { value: new THREE.Vector2(cardW, cardH) },
        uGrainScale: { value: specParams.grainScale },
        uGrainIntensity: { value: grainInt },
        uRoughness: { value: effRough },
        uSpecPower: { value: specParams.power },
        uSpecIntensity: { value: specParams.intensity },
        uSheenFactor: { value: specParams.sheen },
        uFleckIntensity: { value: specParams.fleck },
        uStockType: { value: stockCode },
        uGlossDensity: { value: glossDens },
        uGlossShine: { value: glossShine },
        uCrumpleFolds: { value: crumpleFolds },
        uNoiseOffset: { value: tileNoiseOffset },
        uKeyLightIntensity: { value: keyLightInt },
        uFillLightIntensity: { value: fillLightInt },
        uKeyLightPos: { value: keyLight.position },
        uFillLightPos: { value: fillLight.position },
      };

      const tileMat = new THREE.ShaderMaterial({
        vertexShader: tileVertexShader,
        fragmentShader: tileFragmentShader,
        uniforms: tileUniforms,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -(i + 1) * 2.0,
        polygonOffsetUnits: -(i + 1) * 4.0,
      });

      const tileMesh = new THREE.Mesh(tileGeo, tileMat);
      tileMesh.position.set(posX, posY, posZ);
      tileMesh.rotation.set(tiltX, tiltY, rotZ);
      tileMesh.renderOrder = i;

      floatTilesGroup.add(tileMesh);

      floatingTiles.push({
        mesh: tileMesh,
        material: tileMat,
        basePos: new THREE.Vector3(posX, posY, posZ),
        baseRot: new THREE.Euler(tiltX, tiltY, rotZ),
        phase: (i * 1.6180339887 * Math.PI * 2),
        speedMult: 0.88 + ((i * 11) % 5) * 0.05,
      });
    }
  }
}

function updateActiveModeVisibility() {
  const mode = controls.get('mode');
  const numLayers = parseInt(controls.get('numLayers')) || 4;

  if (foldMesh) foldMesh.visible = mode === 'fold';
  
  peelLayerMeshes.forEach((m, idx) => {
    m.visible = mode === 'peel' && idx < numLayers;
  });

  if (floatTilesGroup) floatTilesGroup.visible = mode === 'float';
  if (crumpleMesh) crumpleMesh.visible = mode === 'crumple';
}

function rebuildGeometries() {
  const geo = new THREE.PlaneGeometry(posterWidth, posterHeight, SEG_X, SEG_Y);

  foldUniforms.uDimensions.value.set(posterWidth, posterHeight);
  crumpleUniforms.uDimensions.value.set(posterWidth, posterHeight);

  peelLayerMaterials.forEach((m) => {
    m.uniforms.uDimensions.value.set(posterWidth, posterHeight);
  });

  if (foldMesh) {
    mainStage.remove(foldMesh);
    if (foldMesh.geometry) foldMesh.geometry.dispose();
  }
  peelLayerMeshes.forEach((m) => {
    mainStage.remove(m);
    if (m.geometry) m.geometry.dispose();
  });
  peelLayerMeshes = [];

  if (crumpleMesh) {
    mainStage.remove(crumpleMesh);
    if (crumpleMesh.geometry) crumpleMesh.geometry.dispose();
  }

  foldMesh = new THREE.Mesh(geo, foldMaterial);
  mainStage.add(foldMesh);

  for (let i = 0; i < 5; i++) {
    const peelGeo = new THREE.PlaneGeometry(posterWidth, posterHeight, SEG_X, SEG_Y);
    const mesh = new THREE.Mesh(peelGeo, peelLayerMaterials[i]);
    mesh.position.z = (4 - i) * 0.008;
    mainStage.add(mesh);
    peelLayerMeshes.push(mesh);
  }

  const density = controls.get('wrinkleDensity') ?? 50.0;
  const baseSeed = controls.get('crumpleSeed') ?? 74;
  currentSeedA = baseSeed;
  currentSeedB = baseSeed;
  const crumpleGeo = createCrumpleGeometry(posterWidth, posterHeight, density, currentSeedA, currentSeedB);
  
  crumpleMesh = new THREE.Mesh(crumpleGeo, crumpleMaterial);
  mainStage.add(crumpleMesh);

  rebuildFloatingTiles();
  updateActiveModeVisibility();
}

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

function syncTexturesToShaders() {
  const textures = getActiveTexturesList();
  
  foldUniforms.uTexture.value = textures[0];
  crumpleUniforms.uTexture.value = textures[0];

  for (let i = 0; i < peelLayerMaterials.length; i++) {
    const texIdx = i % textures.length;
    peelLayerMaterials[i].uniforms.uTexture.value = textures[texIdx];
  }

  rebuildFloatingTiles();
}

function updateAspectRatioFromPrimaryImage() {
  const textures = getActiveTexturesList();
  const primary = textures[0];
  const aspect = getTextureAspect(primary);

  if (aspect && aspect > 0.02) {
    computePosterDimensions(aspect);
  } else {
    const fallback = getFallbackAspect(controls.get('fallbackAspect'));
    computePosterDimensions(fallback);
  }

  rebuildGeometries();
}

function loadMultiImages(input) {
  let urls = [];
  if (Array.isArray(input)) {
    urls = input.filter((u) => typeof u === 'string' && u.trim().length > 0);
  } else if (typeof input === 'string' && input.trim().length > 0) {
    urls = [input.trim()];
  }

  if (urls.length === 0) {
    hasCustomImages = false;
    loadedImageTextures = [];
    syncTexturesToShaders();
    updateAspectRatioFromPrimaryImage();
    return;
  }

  let loadedCount = 0;
  const newTextures = new Array(urls.length);

  urls.forEach((url, idx) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
        newTextures[idx] = tex;
        loadedCount++;

        if (tex.image && (!tex.image.naturalWidth || tex.image.naturalWidth === 0)) {
          tex.image.onload = () => {
            if (idx === 0) {
              updateAspectRatioFromPrimaryImage();
            }
          };
        }

        if (loadedCount === urls.length) {
          hasCustomImages = true;
          loadedImageTextures = newTextures.filter(Boolean);
          syncTexturesToShaders();
          updateAspectRatioFromPrimaryImage();
        }
      },
      undefined,
      () => {
        loadedCount++;
        if (loadedCount === urls.length) {
          loadedImageTextures = newTextures.filter(Boolean);
          hasCustomImages = loadedImageTextures.length > 0;
          syncTexturesToShaders();
          updateAspectRatioFromPrimaryImage();
        }
      }
    );
  });
}

function loadBgImage(url) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    hasBgTexture = false;
    bgUniforms.uHasTexture.value = 0.0;
    bgUniforms.uTexture.value = null;
    return;
  }
  textureLoader.load(
    url,
    (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      
      const img = tex.image;
      if (img && img.naturalWidth && img.naturalHeight) {
        bgAspect = img.naturalWidth / img.naturalHeight;
      }
      hasBgTexture = true;
      bgUniforms.uTexture.value = tex;
      bgUniforms.uHasTexture.value = 1.0;
      updateBgUvScale();
    },
    undefined,
    () => {
      hasBgTexture = false;
      bgUniforms.uHasTexture.value = 0.0;
    }
  );
}

function loadFgImage(url) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    hasFgTexture = false;
    fgUniforms.uTexture.value = null;
    return;
  }
  textureLoader.load(
    url,
    (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      
      const img = tex.image;
      if (img && img.naturalWidth && img.naturalHeight) {
        fgAspect = img.naturalWidth / img.naturalHeight;
      }
      hasFgTexture = true;
      fgUniforms.uTexture.value = tex;
      updateFgUvScale();
    },
    undefined,
    () => {
      hasFgTexture = false;
    }
  );
}

let hasFoldBackTexture = false;

function updateFoldBacksideTexture() {
  const useBackside = controls.get('useFoldBacksideImage') === true;
  if (useBackside && hasFoldBackTexture && foldUniforms.uBackTexture.value) {
    foldUniforms.uHasBackTexture.value = 1.0;
  } else {
    foldUniforms.uHasBackTexture.value = 0.0;
  }
}

function loadFoldBacksideImage(url) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    hasFoldBackTexture = false;
    foldUniforms.uBackTexture.value = null;
    updateFoldBacksideTexture();
    return;
  }
  textureLoader.load(
    url.trim(),
    (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;

      hasFoldBackTexture = true;
      foldUniforms.uBackTexture.value = tex;
      updateFoldBacksideTexture();
    },
    undefined,
    () => {
      hasFoldBackTexture = false;
      foldUniforms.uBackTexture.value = null;
      updateFoldBacksideTexture();
    }
  );
}

// Initial Build & Assets Loading
rebuildGeometries();
loadMultiImages(controls.get('posterImages'));

updateBackgroundSettings();
loadBgImage(controls.get('bgImage'));

updateForegroundSettings();
loadFgImage(controls.get('fgImage'));

loadFoldBacksideImage(controls.get('foldBacksideImage'));

// Controls Listeners
controls.onChange('bgType', updateBackgroundSettings);
controls.onChange('bgColor', updateBackgroundSettings);
controls.onChange('bgImage', (val) => {
  loadBgImage(val);
});
controls.onChange('bgScale', () => {
  updateBgUvScale();
});
controls.onChange('bgBlur', updateBackgroundSettings);
controls.onChange('bgDim', updateBackgroundSettings);

controls.onChange('fgImage', (val) => {
  loadFgImage(val);
});
controls.onChange('fgBlendMode', () => {
  updateForegroundBlending();
});
controls.onChange('fgOpacity', (val) => {
  fgUniforms.uOpacity.value = val ?? 0.8;
});
controls.onChange('fgScale', () => {
  updateFgUvScale();
});

controls.onChange('useFoldBacksideImage', () => {
  updateFoldBacksideTexture();
});

controls.onChange('foldBacksideImage', (val) => {
  loadFoldBacksideImage(val);
});

controls.onChange('mode', (val) => {
  updateActiveModeVisibility();
  if (val === 'crumple') {
    autoCrumpleTime = 0.0;
    lastAutoCrumpleCycleIdx = -1;
    crumpleUniforms.uSeedMorph.value = 0.0;
  }
});

controls.onChange('numLayers', () => {
  updateActiveModeVisibility();
});

controls.onChange('posterImages', (val) => {
  loadMultiImages(val);
});

controls.onChange('fallbackAspect', (val) => {
  if (!hasCustomImages) {
    computePosterDimensions(getFallbackAspect(val));
    rebuildGeometries();
  }
});

controls.onChange('paperTexture', () => {
  updateMaterialStockAndTextures();
});

controls.onChange('glossVarnishDensity', (val) => {
  foldUniforms.uGlossDensity.value = val;
  peelLayerMaterials.forEach(m => m.uniforms.uGlossDensity.value = val);
  crumpleUniforms.uGlossDensity.value = val;
  floatingTiles.forEach(tile => {
    if (tile.material && tile.material.uniforms) tile.material.uniforms.uGlossDensity.value = val;
  });
});

controls.onChange('glossShineStrength', (val) => {
  foldUniforms.uGlossShine.value = val;
  peelLayerMaterials.forEach(m => m.uniforms.uGlossShine.value = val);
  crumpleUniforms.uGlossShine.value = val;
  floatingTiles.forEach(tile => {
    if (tile.material && tile.material.uniforms) tile.material.uniforms.uGlossShine.value = val;
  });
});

controls.onChange('crumpleTextureFolds', (val) => {
  foldUniforms.uCrumpleFolds.value = val;
  peelLayerMaterials.forEach(m => m.uniforms.uCrumpleFolds.value = val);
  crumpleUniforms.uCrumpleFolds.value = val;
  for (const k in tileMapsCache) delete tileMapsCache[k];
  updateMaterialStockAndTextures();
});

controls.onChange('perTileTextureVariation', () => {
  for (const k in tileMapsCache) delete tileMapsCache[k];
  rebuildFloatingTiles();
});

controls.onChange('tileCount', () => {
  rebuildFloatingTiles();
});

controls.onChange('tileLayoutPattern', () => {
  rebuildFloatingTiles();
});

controls.onChange('paperRoughness', () => {
  updateMaterialStockAndTextures();
});

let crumpleRebuildTimer = null;
function scheduleCrumpleRebuild(seedA, seedB) {
  if (crumpleRebuildTimer) clearTimeout(crumpleRebuildTimer);
  crumpleRebuildTimer = setTimeout(() => {
    crumpleRebuildTimer = null;
    updateCrumpleBuffers(seedA, seedB);
  }, 90);
}

controls.onChange('wrinkleDensity', () => {
  scheduleCrumpleRebuild(currentSeedA, currentSeedB);
});

controls.onChange('crumpleSeed', (val) => {
  currentSeedA = val;
  currentSeedB = val;
  crumpleUniforms.uSeedMorph.value = 0.0;
  scheduleCrumpleRebuild(val, val);
});

controls.onChange('autoCrumple', (val) => {
  if (!val) {
    currentSeedA = controls.get('crumpleSeed') ?? 74;
    currentSeedB = currentSeedA;
    crumpleUniforms.uSeedMorph.value = 0.0;
    updateCrumpleBuffers(currentSeedA, currentSeedB);
  } else {
    autoCrumpleTime = 0.0;
    lastAutoCrumpleCycleIdx = -1;
  }
});

controls.onChange('randomizeCrumpleSeed', (val) => {
  if (!val) {
    currentSeedA = controls.get('crumpleSeed') ?? 74;
    currentSeedB = currentSeedA;
    crumpleUniforms.uSeedMorph.value = 0.0;
    updateCrumpleBuffers(currentSeedA, currentSeedB);
  }
});

controls.onChange('crumpleAnimType', () => {
  autoCrumpleTime = 0.0;
  lastAutoCrumpleCycleIdx = -1;
  crumpleUniforms.uSeedMorph.value = 0.0;
});

controls.onChange('crumpleFoldStrength', (val) => {
  crumpleUniforms.uCrumpleFoldStrength.value = val;
  // press force is part of the simulation now — re-solve the sheet
  scheduleCrumpleRebuild(currentSeedA, currentSeedB);
});

controls.onChange('crumpleMicroTextureIntensity', (val) => {
  crumpleUniforms.uCrumpleMicroTextureIntensity.value = val;
});

controls.onChange('crumpleMicroTextureSize', (val) => {
  crumpleUniforms.uCrumpleMicroTextureSize.value = val;
});

controls.onChange('grainIntensity', (val) => {
  foldUniforms.uGrainIntensity.value = val;
  peelLayerMaterials.forEach((m) => {
    m.uniforms.uGrainIntensity.value = val;
  });
  crumpleUniforms.uGrainIntensity.value = val;
  floatingTiles.forEach((tile) => {
    if (tile.material && tile.material.uniforms) {
      tile.material.uniforms.uGrainIntensity.value = val;
    }
  });
});

controls.onChange('backsideStyle', (val) => {
  const code = getBacksideStyleCode(val);
  peelLayerMaterials.forEach((m) => {
    m.uniforms.uBacksideStyle.value = code;
  });
});

controls.onChange('backsideColor', (val) => {
  if (val) {
    peelLayerMaterials.forEach((m) => {
      m.uniforms.uBacksideColor.value.set(val);
    });
  }
});

// =========================================================================
// 12. CORNER FOLD MODE  (mode: 'corners')
// =========================================================================
{
  const CF_MAX = 8;
  const CF_SEG_X = 280;
  const CF_SEG_Y = 400;
  // the crease roll must span >= ~2 mesh cells, otherwise the fold edge turns
  // into a jagged staircase (one triangle can't bend smoothly)
  const cfMinRadius = () => 2.2 * Math.max(posterWidth / CF_SEG_X, posterHeight / CF_SEG_Y);
  const CF_PI = Math.PI;

  const cfGet = (k) => controls.get(k);
  // realistic shadow controls (defaults used when the panel doesn't have them)
  const CF_SHADOW_DEFAULTS = {
    cornerFlapLift: 0.5,          // наскільки флеп пружинить над постером (0 = ідеально пласко)
    cornerShadowLength: 1.0,      // довжина тіні від флепа
    cornerShadowSoftness: 1.0,    // м'якість тіні від флепа
    cornerDropShadow: 0.45,       // тінь постера на фон (0 = вимк.)
    cornerDropDistance: 0.05,     // відстань постера від фону
    cornerDropSoftness: 0.07,     // розмиття тіні на фоні
  };
  const cfNum = (k) => { const v = controls.get(k); return (typeof v === 'number' && isFinite(v)) ? v : CF_SHADOW_DEFAULTS[k]; };

  const cfVertexShader = `
    #define CF_MAX ${CF_MAX}
    uniform int uCFCount;
    uniform vec4 uCFLine[CF_MAX];
    uniform float uCFAngle[CF_MAX];
    uniform float uCFRadius;
    uniform float uCFLift;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vRest;
    varying float vFolded;

    void main() {
      vUv = clamp(uv, 0.0005, 0.9995);
      vec3 p = position;
      vRest = p.xy;
      float folded = 0.0;

      for (int i = 0; i < CF_MAX; i++) {
        if (i >= uCFCount) break;
        float th = uCFAngle[i];
        if (th < 0.0001) continue;
        vec2 M = uCFLine[i].xy;
        vec2 n = uCFLine[i].zw;
        float d = dot(p.xy - M, n);
        if (d <= 0.0) continue;

        float R = max(0.002, uCFRadius);
        float L = R * th;
        float along; float z; float c;
        if (d <= L) {
          float phi = d / R;
          along = R * sin(phi);
          z = R * (1.0 - cos(phi));
          c = cos(phi);
        } else {
          float rem = d - L;
          along = R * sin(th) + rem * cos(th);
          z = R * (1.0 - cos(th)) + rem * sin(th);
          // real paper springs back: the flap bows up slightly towards its tip
          z += uCFLift * 0.06 * (1.0 - exp(-rem * 1.8)) * smoothstep(1.5708, 3.1416, th);
          c = cos(th);
        }
        p.xy += (along - d) * n;
        float lift = 0.0045 * float(i + 1) * (th / 3.14159265) * smoothstep(0.0, L + R, d);
        p.z = p.z * c + z + lift;
        folded = max(folded, smoothstep(0.0, 0.004, d));
      }

      vFolded = folded;
      vec4 worldPos = modelMatrix * vec4(p, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const cfFragmentShader = `
    #define CF_MAX ${CF_MAX}
    uniform sampler2D uTexture;
    uniform vec2 uDimensions;
    uniform int uCFCount;
    uniform vec4 uCFLine[CF_MAX];
    uniform float uCFAngle[CF_MAX];
    uniform float uCFBackStyle;
    uniform vec3 uCFBackColor;
    uniform float uCFShadow;
    uniform vec2 uCFLightDir;
    uniform float uCFRadius;
    uniform float uCFLift;
    uniform vec2 uCFShadowShape;   // x = length, y = softness

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vRest;
    varying float vFolded;

    ${glslPaperHeader}

    float cfBoxSd(vec2 p, vec2 b) {
      vec2 q = abs(p) - b;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    }

    void main() {
      vec3 dX = dFdx(vWorldPos);
      vec3 dY = dFdy(vWorldPos);
      vec3 crossN = cross(dX, dY);
      vec3 geomNormal = length(crossN) > 0.0001 ? normalize(crossN) : vec3(0.0, 0.0, 1.0);
      if (!gl_FrontFacing) geomNormal = -geomNormal;

      vec4 texColor = texture2D(uTexture, vUv);
      vec3 paperBase = sRGBToLinear(vec3(0.97, 0.97, 0.97));
      vec3 baseAlbedo;

      if (gl_FrontFacing) {
        baseAlbedo = mix(paperBase, sRGBToLinear(texColor.rgb), texColor.a);
      } else {
        vec2 backUv = vec2(1.0 - vUv.x, vUv.y);
        vec3 bleedColor = sampleBacksideBleed(uTexture, backUv, uDimensions);
        if (uCFBackStyle < 0.5) {
          baseAlbedo = paperBase;
        } else if (uCFBackStyle < 1.5) {
          baseAlbedo = paperBase * mix(vec3(1.0), bleedColor, 0.32);
        } else {
          baseAlbedo = sRGBToLinear(uCFBackColor) * mix(vec3(1.0), bleedColor, 0.12);
        }
      }

      vec2 hd = uDimensions * 0.5;
      float shade = 0.0;
      float creaseAo = 0.0;

      for (int i = 0; i < CF_MAX; i++) {
        if (i >= uCFCount) break;
        float th = uCFAngle[i];
        if (th < 0.0001) continue;
        vec2 M = uCFLine[i].xy;
        vec2 n = uCFLine[i].zw;
        float e = th / 3.14159265;

        float d = dot(vRest - M, n);
        creaseAo = max(creaseAo, (1.0 - smoothstep(0.0, 0.02, abs(d))) * 0.12 * e);

        float c = cos(th);
        if (c < -0.02 && vFolded < 0.5 && gl_FrontFacing) {
          float s = sin(th);
          float R = max(0.002, uCFRadius);
          float liftK = smoothstep(1.5708, 3.1416, th);
          // lobe 0 = tight dark contact shadow, lobe 1 = wide soft cast shadow
          for (int lobe = 0; lobe < 2; lobe++) {
            float fl = float(lobe);
            // how high the flap floats above this spot: crease roll + paper spring
            float dist = max(0.0, -d);
            float hgt = 2.0 * R + uCFLift * 0.06 * (1.0 - exp(-dist * 1.8)) * liftK + s * dist * 0.5;
            float off = mix(0.0015 + hgt * 0.35, 0.003 + hgt * 1.25, fl) * uCFShadowShape.x;
            float soft = mix(0.002 + hgt * 0.22, 0.010 + hgt * 1.3 + 0.08 * s, fl) * uCFShadowShape.y;
            vec2 b = vRest + uCFLightDir * off;
            float db = dot(b - M, n);
            if (db >= 0.0) continue;
            float dSrc = R * th + (db - R * s) / c;
            vec2 src = b + (dSrc - db) * n;
            float sd = cfBoxSd(src, hd);
            float gone = 0.0;
            for (int j = 0; j < CF_MAX; j++) {
              if (j >= i) break;
              if (uCFAngle[j] > 0.0001 && dot(src - uCFLine[j].xy, uCFLine[j].zw) > 0.0) gone = 1.0;
            }
            float sh = (1.0 - smoothstep(-soft, soft, sd)) * (1.0 - gone);
            shade = max(shade, sh * mix(0.55, 0.36, fl));
          }
        }
      }

      baseAlbedo *= 1.0 - shade * uCFShadow * 0.75;

      float effRoughness = gl_FrontFacing ? uRoughness : clamp(uRoughness + 0.08, 0.35, 0.98);

      vec3 color = renderPaperMaterial(
        texColor.rgb,
        baseAlbedo,
        geomNormal,
        geomNormal,
        vUv,
        uDimensions,
        vWorldPos,
        cameraPosition,
        uGrainIntensity,
        effRoughness,
        uKeyLightIntensity,
        uFillLightIntensity,
        uKeyLightPos,
        uFillLightPos,
        0.0,
        creaseAo + shade * uCFShadow * 0.25
      );

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const cfUniforms = {
    ...glslCommonUniforms,
    uTexture: { value: getActiveTexturesList()[0] },
    uDimensions: { value: new THREE.Vector2(posterWidth, posterHeight) },
    uCFCount: { value: 0 },
    uCFLine: { value: Array.from({ length: CF_MAX }, () => new THREE.Vector4()) },
    uCFAngle: { value: new Array(CF_MAX).fill(0) },
    uCFRadius: { value: 0.012 },
    uCFBackStyle: { value: 0 },
    uCFBackColor: { value: new THREE.Color('#ffffff') },
    uCFShadow: { value: 0.6 },
    uCFLightDir: { value: new THREE.Vector2(0.5, 0.7) },
    uCFLift: { value: 0.5 },
    uCFShadowShape: { value: new THREE.Vector2(1, 1) },
  };

  const cfMaterial = new THREE.ShaderMaterial({
    vertexShader: cfVertexShader,
    fragmentShader: cfFragmentShader,
    uniforms: cfUniforms,
    side: THREE.DoubleSide,
  });

  let cfGeoW = 0;
  let cfGeoH = 0;
  const cfMesh = new THREE.Mesh(new THREE.BufferGeometry(), cfMaterial);
  cfMesh.frustumCulled = false;
  cfMesh.visible = false;
  mainStage.add(cfMesh);

  // Poster -> background drop shadow. Shape = poster minus folded-away corners,
  // plus the flaps, so the shadow follows the real silhouette.
  const cfDropMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xy;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      #define CF_MAX ${CF_MAX}
      uniform int uCFCount;
      uniform vec4 uCFLine[CF_MAX];
      uniform float uCFAngle[CF_MAX];
      uniform float uCFRadius;
      uniform vec2 uCFLightDir;
      uniform vec2 uHalf;
      uniform vec3 uDrop;   // x = opacity, y = distance, z = softness
      varying vec2 vPos;

      float boxSd(vec2 p, vec2 b) {
        vec2 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }

      void main() {
        vec2 p = vPos + uCFLightDir * uDrop.y;
        float body = boxSd(p, uHalf);
        float flaps = 1e3;
        for (int i = 0; i < CF_MAX; i++) {
          if (i >= uCFCount) break;
          float th = uCFAngle[i];
          if (th < 0.0001) continue;
          vec2 M = uCFLine[i].xy;
          vec2 n = uCFLine[i].zw;
          float d = dot(p - M, n);
          body = max(body, d);
          float c = cos(th);
          if (c < -0.02 && d < 0.0) {
            float R = max(0.002, uCFRadius);
            float dSrc = R * th + (d - R * sin(th)) / c;
            vec2 src = p + (dSrc - d) * n;
            float gone = 0.0;
            for (int j = 0; j < CF_MAX; j++) {
              if (j >= i) break;
              if (uCFAngle[j] > 0.0001 && dot(src - uCFLine[j].xy, uCFLine[j].zw) > 0.0) gone = 1.0;
            }
            if (gone < 0.5) flaps = min(flaps, boxSd(src, uHalf));
          }
        }
        float sd = min(body, flaps);
        float soft = max(0.003, uDrop.z);
        float a = (1.0 - smoothstep(-soft, soft, sd)) * uDrop.x;
        // denser right under the edge, airy further out
        a *= mix(1.0, 0.75, smoothstep(0.0, soft, sd));
        if (a < 0.002) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }
    `,
    uniforms: {
      uCFCount: cfUniforms.uCFCount,
      uCFLine: cfUniforms.uCFLine,
      uCFAngle: cfUniforms.uCFAngle,
      uCFRadius: cfUniforms.uCFRadius,
      uCFLightDir: cfUniforms.uCFLightDir,
      uHalf: { value: new THREE.Vector2(1, 1) },
      uDrop: { value: new THREE.Vector3(0.45, 0.05, 0.07) },
    },
    transparent: true,
    depthWrite: false,
  });
  const cfDrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cfDropMat);
  cfDrop.frustumCulled = false;
  cfDrop.renderOrder = -10;
  cfDrop.visible = false;
  mainStage.add(cfDrop);

  function cfEnsureGeometry() {
    if (Math.abs(cfGeoW - posterWidth) < 1e-6 && Math.abs(cfGeoH - posterHeight) < 1e-6) return;
    cfGeoW = posterWidth;
    cfGeoH = posterHeight;
    cfMesh.geometry.dispose();
    cfMesh.geometry = new THREE.PlaneGeometry(posterWidth, posterHeight, CF_SEG_X, CF_SEG_Y);
  }

  let cfFolds = [];
  let cfSelfSet = false;

  const cfValidPt = (a) => Array.isArray(a) && a.length === 2 && a.every((x) => typeof x === 'number' && isFinite(x));

  function cfLoadFromControls() {
    const raw = controls.get('cornerFolds');
    cfFolds = (Array.isArray(raw) ? raw : [])
      .filter((f) => f && cfValidPt(f.p) && cfValidPt(f.t))
      .slice(0, CF_MAX)
      .map((f) => ({ p: [f.p[0], f.p[1]], t: [f.t[0], f.t[1]], anim: 1, target: 1 }));
  }

  function cfPersist() {
    cfSelfSet = true;
    controls.set('cornerFolds', cfFolds
      .filter((f) => f.target > 0)
      .map((f) => ({
        p: [+f.p[0].toFixed(4), +f.p[1].toFixed(4)],
        t: [+f.t[0].toFixed(4), +f.t[1].toFixed(4)],
      })));
    cfSelfSet = false;
  }

  cfLoadFromControls();
  controls.onChange('cornerFolds', () => { if (!cfSelfSet) cfLoadFromControls(); });

  const cfEase = (x) => -(Math.cos(CF_PI * Math.min(1, Math.max(0, x))) - 1) / 2;
  const cfSmooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function cfBuildLines() {
    const W = posterWidth;
    const H = posterHeight;
    const R = Math.max(cfMinRadius(), cfGet('cornerCreaseRadius') || 0);
    const maxRad = THREE.MathUtils.degToRad(Math.min(180, Math.max(0, cfGet('cornerFoldAngle'))));
    const lines = [];
    for (let fi = 0; fi < cfFolds.length && lines.length < CF_MAX; fi++) {
      const f = cfFolds[fi];
      const px = f.p[0] * W, py = f.p[1] * H;
      const tx = f.t[0] * W, ty = f.t[1] * H;
      const D = Math.hypot(px - tx, py - ty);
      if (D < 1e-4) continue;
      const nx = (px - tx) / D;
      const ny = (py - ty) / D;
      const a = Math.max(0, (D - CF_PI * R) * 0.5);
      lines.push({ mx: tx + nx * a, my: ty + ny * a, nx, ny, th: maxRad * cfEase(f.anim), R, fi });
    }
    return lines;
  }

  function cfApply(x, y, lines) {
    let z = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.th < 1e-4) continue;
      const d = (x - l.mx) * l.nx + (y - l.my) * l.ny;
      if (d <= 0) continue;
      const L = l.R * l.th;
      let along, zz, c;
      if (d <= L) {
        const phi = d / l.R;
        along = l.R * Math.sin(phi); zz = l.R * (1 - Math.cos(phi)); c = Math.cos(phi);
      } else {
        const rem = d - L;
        along = l.R * Math.sin(l.th) + rem * Math.cos(l.th);
        zz = l.R * (1 - Math.cos(l.th)) + rem * Math.sin(l.th);
        zz += cfNum('cornerFlapLift') * 0.06 * (1 - Math.exp(-rem * 1.8)) * cfSmooth(CF_PI / 2, CF_PI, l.th);
        c = Math.cos(l.th);
      }
      x += (along - d) * l.nx;
      y += (along - d) * l.ny;
      z = z * c + zz + 0.0045 * (i + 1) * (l.th / CF_PI) * cfSmooth(0, L + l.R, d);
    }
    return { x, y, z };
  }

  const cfEl = renderer.domElement;
  const cfRay = new THREE.Raycaster();
  const cfNdc = new THREE.Vector2();
  const cfPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const cfHitV = new THREE.Vector3();
  const cfProjV = new THREE.Vector3();

  let cfDrag = null;
  let cfHover = null;

  const cfActive = () => controls.get('mode') === 'corners';

  function cfPointer(e) {
    const rect = cfEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    cfNdc.set((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    cfRay.setFromCamera(cfNdc, camera);
    const ok = cfRay.ray.intersectPlane(cfPlane, cfHitV);
    return { sx, sy, rect, x: ok ? cfHitV.x : null, y: ok ? cfHitV.y : null, touch: e.pointerType === 'touch' };
  }

  function cfFindHandle(ptr) {
    const lines = cfBuildLines();
    const radius = ptr.touch ? 40 : 26;
    let best = -1;
    let bestD = radius;
    for (let li = lines.length - 1; li >= 0; li--) {
      const f = cfFolds[lines[li].fi];
      if (f.target <= 0) continue;
      const tip = cfApply(f.p[0] * posterWidth, f.p[1] * posterHeight, lines);
      cfProjV.set(tip.x, tip.y, tip.z).project(camera);
      const hx = (cfProjV.x + 1) * 0.5 * ptr.rect.width;
      const hy = (1 - cfProjV.y) * 0.5 * ptr.rect.height;
      const d = Math.hypot(hx - ptr.sx, hy - ptr.sy);
      if (d < bestD) { bestD = d; best = lines[li].fi; }
    }
    return best;
  }

  function cfFindBoundary(ptr) {
    if (ptr.x === null) return null;
    const hw = posterWidth * 0.5;
    const hh = posterHeight * 0.5;
    const minDim = Math.min(posterWidth, posterHeight);
    const x = ptr.x, y = ptr.y;
    if (Math.abs(x) > hw + 0.08 || Math.abs(y) > hh + 0.08) return null;

    let P = null;
    if (cfGet('cornerSnapToCorners')) {
      const snapR = minDim * 0.26;
      let bd = snapR;
      [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach((c) => {
        const d = Math.hypot(x - c[0], y - c[1]);
        if (d < bd) { bd = d; P = { x: c[0], y: c[1] }; }
      });
    }
    if (!P) {
      const cx = Math.max(-hw, Math.min(hw, x));
      const cy = Math.max(-hh, Math.min(hh, y));
      const dl = Math.abs(cx + hw), dr = Math.abs(hw - cx), db = Math.abs(cy + hh), dt = Math.abs(hh - cy);
      const m = Math.min(dl, dr, db, dt);
      if (m > minDim * 0.16) return null;
      if (m === dl) P = { x: -hw, y: cy };
      else if (m === dr) P = { x: hw, y: cy };
      else if (m === db) P = { x: cx, y: -hh };
      else P = { x: cx, y: hh };
    }

    const lines = cfBuildLines();
    for (const l of lines) {
      if (l.th < 1e-4 || cfFolds[l.fi].target <= 0) continue;
      if ((P.x - l.mx) * l.nx + (P.y - l.my) * l.ny > 1e-4) return null;
    }
    return [P.x / posterWidth, P.y / posterHeight];
  }

  function cfEndDrag() {
    if (!cfDrag) return;
    try { cfEl.releasePointerCapture(cfDrag.id); } catch (err) { /* noop */ }
    const wasFold = cfDrag.kind === 'edit' || cfDrag.idx >= 0;
    cfDrag = null;
    orbitControls.enabled = true;
    if (wasFold) cfPersist();
  }

  cfEl.addEventListener('pointerdown', (e) => {
    if (!cfActive()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ptr = cfPointer(e);
    if (ptr.x === null) return;

    const h = cfFindHandle(ptr);
    if (h >= 0) {
      cfDrag = { kind: 'edit', idx: h, id: e.pointerId };
    } else {
      if (cfFolds.filter((f) => f.target > 0).length >= CF_MAX) return;
      const p = cfFindBoundary(ptr);
      if (!p) return;
      cfDrag = { kind: 'new', idx: -1, p, sx: ptr.sx, sy: ptr.sy, id: e.pointerId };
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    orbitControls.enabled = false;
    try { cfEl.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  }, true);

  cfEl.addEventListener('pointermove', (e) => {
    if (!cfActive()) { cfHover = null; return; }
    const ptr = cfPointer(e);

    if (!cfDrag) {
      cfHover = cfFindHandle(ptr) >= 0 ? 'handle' : (cfFindBoundary(ptr) ? 'edge' : null);
      return;
    }
    if (ptr.x === null) return;
    const t = [ptr.x / posterWidth, ptr.y / posterHeight];

    if (cfDrag.kind === 'new') {
      if (cfDrag.idx < 0) {
        if (Math.hypot(ptr.sx - cfDrag.sx, ptr.sy - cfDrag.sy) < 5) return;
        cfFolds.push({ p: cfDrag.p, t, anim: 1, target: 1 });
        cfDrag.idx = cfFolds.length - 1;
      } else {
        cfFolds[cfDrag.idx].t = t;
      }
    } else if (cfFolds[cfDrag.idx]) {
      cfFolds[cfDrag.idx].t = t;
    }
  });

  cfEl.addEventListener('pointerup', cfEndDrag);
  cfEl.addEventListener('pointercancel', cfEndDrag);

  cfEl.addEventListener('dblclick', (e) => {
    if (!cfActive()) return;
    const h = cfFindHandle(cfPointer(e));
    if (h >= 0) { cfFolds[h].target = 0; cfPersist(); }
  });

  function cfUndo() {
    for (let i = cfFolds.length - 1; i >= 0; i--) {
      if (cfFolds[i].target > 0) { cfFolds[i].target = 0; cfPersist(); return; }
    }
  }
  function cfReset() {
    cfFolds.forEach((f) => { f.target = 0; });
    cfPersist();
  }

  window.addEventListener('keydown', (e) => {
    if (!cfActive()) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); cfUndo(); }
  });

  controls.onAction('undoCornerFold', cfUndo);
  controls.onAction('resetCornerFolds', cfReset);

  let cfLastT = performance.now();
  const cfPrevHook = scene.onBeforeRender;

  scene.onBeforeRender = function (r, s, c, rt) {
    if (typeof cfPrevHook === 'function') cfPrevHook.call(this, r, s, c, rt);

    const now = performance.now();
    const dt = Math.min(0.1, (now - cfLastT) / 1000);
    cfLastT = now;

    const active = cfActive();
    cfMesh.visible = active;
    cfDrop.visible = active && cfNum('cornerDropShadow') > 0.001;
    if (!active) { if (cfDrag) cfEndDrag(); return; }

    cfEnsureGeometry();

    const speed = Math.max(0.1, cfGet('cornerFoldSpeed'));
    let removed = false;
    for (let i = cfFolds.length - 1; i >= 0; i--) {
      const f = cfFolds[i];
      if (f.anim !== f.target) {
        const step = dt * speed * 1.6;
        f.anim = f.target > f.anim ? Math.min(f.target, f.anim + step) : Math.max(f.target, f.anim - step);
      }
      if (f.target <= 0 && f.anim <= 0) {
        cfFolds.splice(i, 1);
        removed = true;
        if (cfDrag && cfDrag.idx > i) cfDrag.idx--;
      }
    }
    if (removed) cfPersist();

    const lines = cfBuildLines();
    cfUniforms.uCFCount.value = lines.length;
    for (let i = 0; i < CF_MAX; i++) {
      const l = lines[i];
      if (l) {
        cfUniforms.uCFLine.value[i].set(l.mx, l.my, l.nx, l.ny);
        cfUniforms.uCFAngle.value[i] = l.th;
      } else {
        cfUniforms.uCFLine.value[i].set(0, 0, 1, 0);
        cfUniforms.uCFAngle.value[i] = 0;
      }
    }
    cfUniforms.uCFRadius.value = Math.max(cfMinRadius(), cfGet('cornerCreaseRadius') || 0);
    cfUniforms.uCFBackStyle.value = getBacksideStyleCode(cfGet('cornerBacksideStyle'));
    cfUniforms.uCFBackColor.value.set(cfGet('cornerBacksideColor') || '#ffffff');
    cfUniforms.uCFShadow.value = cfGet('cornerShadowStrength');

    cfUniforms.uTexture.value = getActiveTexturesList()[0];
    cfUniforms.uDimensions.value.set(posterWidth, posterHeight);
    cfUniforms.uGrainIntensity.value = controls.get('grainIntensity') ?? 0.0;
    cfUniforms.uRoughness.value = getStockRoughnessScalar(activePaperPreset, controls.get('paperRoughness') ?? 0.0);
    cfUniforms.uStockType.value = getStockTypeCode(activePaperPreset);
    cfUniforms.uKeyLightIntensity.value = controls.get('keyLightIntensity') ?? 4.0;
    cfUniforms.uFillLightIntensity.value = controls.get('fillLightIntensity') ?? 3.0;
    cfUniforms.uKeyLightPos.value.copy(keyLight.position);
    cfUniforms.uFillLightPos.value.copy(fillLight.position);
    // light direction in the poster plane; its length = how long shadows get
    // (low light -> long shadows, overhead light -> short ones)
    const lx = keyLight.position.x, ly = keyLight.position.y;
    const ll = Math.hypot(lx, ly) || 1;
    const lz = Math.max(0.5, keyLight.position.z);
    const slope = Math.min(2.0, Math.max(0.25, ll / lz));
    cfUniforms.uCFLightDir.value.set((lx / ll) * slope, (ly / ll) * slope);
    cfUniforms.uCFLift.value = cfNum('cornerFlapLift');
    cfUniforms.uCFShadowShape.value.set(cfNum('cornerShadowLength'), cfNum('cornerShadowSoftness'));

    const dropA = cfNum('cornerDropShadow');
    const dropD = cfNum('cornerDropDistance');
    const dropS = cfNum('cornerDropSoftness');
    cfDrop.position.set(0, 0, -0.03);
    cfDrop.scale.set(posterWidth + 2.0, posterHeight + 2.0, 1);
    cfDropMat.uniforms.uHalf.value.set(posterWidth * 0.5, posterHeight * 0.5);
    cfDropMat.uniforms.uDrop.value.set(dropA, dropD * slope, dropS + dropD * 0.6);
    cfDrop.updateMatrixWorld(true);

    if (cfDrag) cfEl.style.cursor = 'grabbing';
    else if (cfHover) cfEl.style.cursor = 'grab';
  };
}

// =========================================================================
// 13. COLLAGE MODE  (mode: 'collage')
// =========================================================================
{
  const clGet = (k) => controls.get(k);
  if (controls.get('collageStartOpacity') === undefined) controls.set('collageStartOpacity', 0);
  if (controls.get('collageFadeDuration') === undefined) controls.set('collageFadeDuration', 0.12);
  controls.setDefaults({ collageStartOpacity: 0, collageFadeDuration: 0.12 });
  const CL_EXIT_DEFAULTS = {
    collageExitStyle: 'fade',     // 'fade' (злітають і розчиняються) | 'sweep' (змітаються вбік) | 'pile' (засипаються новою композицією)
    collageSweepAngle: 0,         // куди змітає рука, ° (0 = праворуч, 90 = вгору, 180 = ліворуч)
    collageSweepDuration: 0.6,    // як довго виїжджає один шматок, с
    collageSweepStagger: 0.35,    // розкид затримок між шматками, с
    collagePileMax: 60,           // ліміт шматків у купі (найнижчі прибираються першими)
  };
  Object.keys(CL_EXIT_DEFAULTS).forEach((k) => { if (controls.get(k) === undefined) controls.set(k, CL_EXIT_DEFAULTS[k]); });
  controls.setDefaults(CL_EXIT_DEFAULTS);
  const clExitGet = (k) => { const v = controls.get(k); return v === undefined || v === null ? CL_EXIT_DEFAULTS[k] : v; };
  const clExitNum = (k) => { const v = Number(clExitGet(k)); return isFinite(v) ? v : CL_EXIT_DEFAULTS[k]; };
  const clExitStyle = () => { const v = clExitGet('collageExitStyle'); return v === 'sweep' || v === 'pile' ? v : 'fade'; };

  const CL_EASE = {
    back: (x) => { const c1 = 1.9; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    elastic: (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    },
    bounce: (x) => {
      const n1 = 7.5625, d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
      if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
      return n1 * (x -= 2.625 / d1) * x + 0.984375;
    },
    smooth: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  };
  const clEase = (x) => (CL_EASE[clGet('collageEasing')] || CL_EASE.back)(Math.min(1, Math.max(0, x)));
  const clClamp01 = (x) => Math.min(1, Math.max(0, x));

  const clVertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const clFragmentShader = `
    uniform sampler2D uTexture;
    uniform vec2 uDimensions;
    uniform float uOpacity;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    ${glslPaperHeader}

    void main() {
      vec4 tex = texture2D(uTexture, vUv);
      float a = tex.a * uOpacity;
      if (a < 0.01) discard;

      vec3 dX = dFdx(vWorldPos);
      vec3 dY = dFdy(vWorldPos);
      vec3 crossN = cross(dX, dY);
      vec3 geomNormal = length(crossN) > 0.0001 ? normalize(crossN) : vec3(0.0, 0.0, 1.0);
      if (!gl_FrontFacing) geomNormal = -geomNormal;

      vec3 color = renderPaperMaterial(
        tex.rgb, sRGBToLinear(tex.rgb), geomNormal, geomNormal,
        vUv, uDimensions, vWorldPos, cameraPosition,
        uGrainIntensity, uRoughness,
        uKeyLightIntensity, uFillLightIntensity, uKeyLightPos, uFillLightPos,
        0.0, 0.0
      );
      gl_FragColor = vec4(color, a);
    }
  `;

  const clShadowFragment = `
    uniform sampler2D uTexture;
    uniform float uOpacity;
    uniform vec2 uBlur;
    uniform float uPad;
    varying vec2 vUv;
    void main() {
      vec2 uv = (vUv - 0.5) * uPad + 0.5;
      float a = 0.0;
      float tot = 0.0;
      // each tap reads a pre-blurred mip level as wide as the tap spacing, so a
      // wide blur stays smooth instead of breaking into stepped copies
      vec2 ts = vec2(textureSize(uTexture, 0));
      vec2 stepUv = uBlur * 0.5;
      float lod = log2(max(1.0, max(stepUv.x * ts.x, stepUv.y * ts.y)) * 1.5);
      for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
          vec2 o = vec2(float(x), float(y));
          float w = exp(-dot(o, o) * 0.35);
          vec2 s = uv + o * stepUv;
          float inb = step(0.0, s.x) * step(s.x, 1.0) * step(0.0, s.y) * step(s.y, 1.0);
          a += textureLod(uTexture, clamp(s, 0.0, 1.0), lod).a * inb * w;
          tot += w;
        }
      }
      a /= tot;
      if (a * uOpacity < 0.003) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, a * uOpacity);
    }
  `;

  const clGroup = new THREE.Group();
  clGroup.visible = false;
  mainStage.add(clGroup);

  const CL_SHADOW_PAD = 1.18;
  const clQuad = new THREE.PlaneGeometry(1, 1);
  let clItems = [];

  function clClearItems() {
    clItems.forEach((it) => {
      clGroup.remove(it.mesh);
      clGroup.remove(it.shadow);
      it.mesh.material.dispose();
      it.shadow.material.dispose();
    });
    clItems = [];
  }

  function clSources() {
    return getActiveTexturesList();
  }

  function clTexSize(tex) {
    const img = tex && tex.image;
    if (!img) return null;
    const w = img.naturalWidth || img.videoWidth || img.width || 0;
    const h = img.naturalHeight || img.videoHeight || img.height || 0;
    return w > 0 && h > 0 ? { w, h } : null;
  }

  let clSeed = 7;

  function clViewHalf() {
    const dist = camera.position.distanceTo(orbitControls.target) || 7.2;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dist;
    return { hw: halfH * camera.aspect, hh: halfH };
  }

  function clRelayout(restart, keepOld) {
    if (keepOld) clItems.forEach((it) => { it.settled = true; });
    else clClearItems();
    const texs = clSources().filter((t) => clTexSize(t));
    if (!texs.length) return;

    const rng = makeSeededRng(clSeed);
    const { hw, hh } = clViewHalf();
    const spread = clClamp01(clGet('collageSpread'));
    const scale = Math.max(0.05, clGet('collageScale'));
    const jitter = Math.max(0, Math.min(0.6, clGet('collageScaleJitter')));
    const maxRot = THREE.MathUtils.degToRad(clGet('collageMaxRotation'));
    const styleSetting = clGet('collageAnimStyle');
    const styles = ['drop', 'slide', 'pop'];

    let unit;
    if (clGet('collageSizeMode') === 'absolute') {
      unit = (2.0 / 1000) * scale;
    } else {
      let refPx = 1;
      texs.forEach((t) => { const s = clTexSize(t); refPx = Math.max(refPx, s.w, s.h); });
      unit = (hh * 2 * 0.62 * scale) / refPx;
    }

    const count = Math.max(0, Math.round(clGet('collageCount')));
    let picks;
    if (count === 0) {
      picks = texs.slice();
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [picks[i], picks[j]] = [picks[j], picks[i]];
      }
    } else {
      picks = Array.from({ length: count }, () => texs[Math.floor(rng() * texs.length) % texs.length]);
    }

    const tri = () => rng() + rng() - 1;

    picks.forEach((tex, i) => {
      const px = clTexSize(tex);
      const k = 1 + (rng() - 0.5) * 2 * jitter;
      const w = px.w * unit * k;
      const h = px.h * unit * k;

      const rx = Math.max(0, hw * spread - w * 0.25);
      const ry = Math.max(0, hh * spread - h * 0.25);
      const x = tri() * rx;
      const y = tri() * ry;
      const rot = (rng() - 0.5) * 2 * maxRot;
      const style = styleSetting === 'mixed' ? styles[Math.floor(rng() * 3) % 3] : styleSetting;
      const dirA = rng() * Math.PI * 2;

      const mat = new THREE.ShaderMaterial({
        vertexShader: clVertexShader,
        fragmentShader: clFragmentShader,
        uniforms: {
          ...glslCommonUniforms,
          uNoiseOffset: { value: new THREE.Vector2((i + 1) * 4.71, (i + 1) * 9.23) },
          uTexture: { value: tex },
          uDimensions: { value: new THREE.Vector2(w, h) },
          uOpacity: { value: 0 },
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(clQuad, mat);
      mesh.renderOrder = 1000 + i * 2;
      mesh.frustumCulled = false;

      const shMat = new THREE.ShaderMaterial({
        vertexShader: clVertexShader,
        fragmentShader: clShadowFragment,
        uniforms: {
          uTexture: { value: tex },
          uOpacity: { value: 0 },
          uBlur: { value: new THREE.Vector2(0.01, 0.01) },
          uPad: { value: CL_SHADOW_PAD },
        },
        transparent: true,
        depthWrite: false,
      });
      const shadow = new THREE.Mesh(clQuad, shMat);
      shadow.renderOrder = 1000 + i * 2 - 1;
      shadow.frustumCulled = false;

      clGroup.add(shadow);
      clGroup.add(mesh);

      clItems.push({
        mesh, shadow, w, h, x, y, rot, style, tex,
        k: i, settled: false,
        sweepDelay: 0, sweepSpin: (rng() - 0.5) * 2,
        baseZ: 0.02 + i * 0.006,
        spin: (rng() - 0.5) * 1.4,
        tiltX: (rng() - 0.5) * 0.9,
        tiltY: (rng() - 0.5) * 0.9,
        dirX: Math.cos(dirA),
        dirY: Math.sin(dirA),
        slideDist: Math.max(hw, hh) * 1.6 + Math.max(w, h),
      });
    });

    // stacking order = order in the list (old pile at the bottom, new on top);
    // renumbering keeps the pile's depth bounded no matter how long it grows
    clItems.forEach((it, r) => {
      it.baseZ = 0.02 + r * 0.006;
      it.mesh.renderOrder = 1000 + r * 2;
      it.shadow.renderOrder = 1000 + r * 2 - 1;
    });

    if (restart) clStartIn();
  }

  // ---- 'pile': remove pieces that are completely hidden under newer ones ----
  const clMaskCache = new Map();
  function clMask(tex) {
    if (clMaskCache.has(tex)) return clMaskCache.get(tex);
    let mask = null;
    try {
      const S = 32;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(tex.image, 0, 0, S, S);
      const d = cx.getImageData(0, 0, S, S).data;
      mask = { S, a: new Uint8Array(S * S) };
      for (let i = 0; i < S * S; i++) mask.a[i] = d[i * 4 + 3];
    } catch (e) { mask = null; }          // unreadable image -> treat as opaque
    clMaskCache.set(tex, mask);
    return mask;
  }
  function clOpaqueAt(it, u, v) {        // u,v in 0..1 of the piece (v up)
    const m = clMask(it.tex);
    if (!m) return true;
    const px = Math.min(m.S - 1, Math.max(0, Math.floor(u * m.S)));
    const py = Math.min(m.S - 1, Math.max(0, Math.floor((1 - v) * m.S)));
    return m.a[py * m.S + px] > 128;
  }
  function clLocalUV(it, wx, wy) {
    const c = Math.cos(-it.rot), sn = Math.sin(-it.rot);
    const dx = wx - it.x, dy = wy - it.y;
    return [(dx * c - dy * sn) / it.w + 0.5, (dx * sn + dy * c) / it.h + 0.5];
  }
  function clRemoveItem(idx) {
    const it = clItems[idx];
    clGroup.remove(it.mesh); clGroup.remove(it.shadow);
    it.mesh.material.dispose(); it.shadow.material.dispose();
    clItems.splice(idx, 1);
  }
  function clCullCovered() {
    const { hw, hh } = clViewHalf();
    const G = 7;
    for (let a = clItems.length - 1; a >= 0; a--) {
      const A = clItems[a];
      if (!A.settled) continue;
      let covered = true;
      for (let gy = 0; gy < G && covered; gy++) {
        for (let gx = 0; gx < G && covered; gx++) {
          const u = (gx + 0.5) / G, v = (gy + 0.5) / G;
          if (!clOpaqueAt(A, u, v)) continue;
          const lx = (u - 0.5) * A.w, ly = (v - 0.5) * A.h;
          const c = Math.cos(A.rot), sn = Math.sin(A.rot);
          const wx = A.x + lx * c - ly * sn, wy = A.y + lx * sn + ly * c;
          if (Math.abs(wx) > hw * 1.05 || Math.abs(wy) > hh * 1.05) continue;   // off-screen: nobody sees it
          let hit = false;
          for (let b = a + 1; b < clItems.length && !hit; b++) {
            const B = clItems[b];
            const [bu, bv] = clLocalUV(B, wx, wy);
            if (bu >= 0 && bu <= 1 && bv >= 0 && bv <= 1 && clOpaqueAt(B, bu, bv)) hit = true;
          }
          if (!hit) covered = false;
        }
      }
      if (covered) clRemoveItem(a);
    }
    // hard limit: the very bottom of the pile goes first
    const max = Math.max(5, Math.round(clExitNum('collagePileMax')));
    while (clItems.length > max && clItems[0].settled) clRemoveItem(0);
    clItems.forEach((it, r) => {
      it.baseZ = 0.02 + r * 0.006;
      it.mesh.renderOrder = 1000 + r * 2;
      it.shadow.renderOrder = 1000 + r * 2 - 1;
    });
  }

  let clPhase = 'in';
  let clTime = 0;
  let clOutTime = 0;
  const CL_OUT_DUR = 0.35;
  const CL_OUT_STAGGER = 0.045;

  let clCulled = false;
  function clStartIn() { clPhase = 'in'; clTime = 0; clOutTime = 0; clCulled = false; }
  function clStartOut() {
    if (!clItems.length) { clStartIn(); return; }
    clPhase = 'out'; clOutTime = 0;
    // sweep: the hand reaches the pieces on its side first
    const a = THREE.MathUtils.degToRad(clExitNum('collageSweepAngle'));
    const dx = Math.cos(a), dy = Math.sin(a);
    let lo = Infinity, hi = -Infinity;
    clItems.forEach((it) => { it.proj = it.x * dx + it.y * dy; lo = Math.min(lo, it.proj); hi = Math.max(hi, it.proj); });
    const span = Math.max(1e-3, hi - lo);
    const st = Math.max(0, clExitNum('collageSweepStagger'));
    clItems.forEach((it) => { it.sweepDelay = (1 - (it.proj - lo) / span) * st; });
  }

  function clInTotal() {
    const n = clItems.filter((it) => !it.settled).length;
    return Math.max(0, n - 1) * Math.max(0, clGet('collageStagger')) + Math.max(0.05, clGet('collageDuration'));
  }
  function clOutTotal() {
    if (clExitStyle() === 'sweep') return Math.max(0, clExitNum('collageSweepStagger')) + Math.max(0.05, clExitNum('collageSweepDuration'));
    return Math.max(0, clItems.length - 1) * CL_OUT_STAGGER + CL_OUT_DUR;
  }

  function clNextComposition(keepOld) {
    if (clGet('collageRandomizeOnReplay')) clSeed = Math.floor(Math.random() * 100000) + 1;
    clRelayout(true, !!keepOld);
  }

  let clPendingNew = true;
  function clReplay() {
    if (clExitStyle() === 'pile') { clNextComposition(true); return; }
    clStartOut(); clPendingNew = true;
  }

  controls.onAction('replayCollage', clReplay);
  controls.onAction('shuffleCollage', () => {
    clSeed = Math.floor(Math.random() * 100000) + 1;
    clRelayout(true);
  });

  ['collageCount', 'collageSizeMode', 'collageScale', 'collageScaleJitter',
    'collageSpread', 'collageMaxRotation', 'collageAnimStyle'].forEach((k) => {
    controls.onChange(k, () => { if (controls.get('mode') === 'collage') clRelayout(false); });
  });

  let clDown = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { clDown = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (controls.get('mode') !== 'collage' || !clDown) return;
    const isClick = Math.hypot(e.clientX - clDown.x, e.clientY - clDown.y) < 8 && performance.now() - clDown.t < 400;
    if (isClick && controls.get('animTrigger') === 'click') clReplay();
  });

  let clLastT = performance.now();
  let clInited = false;
  const clPrevHook = scene.onBeforeRender;

  scene.onBeforeRender = function (r, s, c, rt) {
    if (typeof clPrevHook === 'function') clPrevHook.call(this, r, s, c, rt);

    const now = performance.now();
    const dt = Math.min(0.1, (now - clLastT) / 1000);
    clLastT = now;

    const active = controls.get('mode') === 'collage';
    clGroup.visible = active;
    if (!active) return;

    if (!clInited) {
      const texs = clSources().filter((t) => clTexSize(t));
      if (texs.length) { clRelayout(true); clInited = true; }
    }
    if (!clItems.length) return;

    const autoReplay = clGet('collageAutoReplay') && controls.get('animTrigger') !== 'click';
    const exitStyle = clExitStyle();
    if (clPhase === 'in') {
      clTime += dt;
      // 'pile': once the new layer has landed, drop what it fully hides
      if (exitStyle === 'pile' && !clCulled && clTime > clInTotal() + 0.05) { clCullCovered(); clCulled = true; }
      if (autoReplay && clTime > clInTotal() + Math.max(0, clGet('collageHold'))) {
        if (exitStyle === 'pile') {
          clNextComposition(true);          // new pieces fall on top of the old pile
        } else {
          clStartOut();
          clPendingNew = true;
        }
      }
    } else {
      clOutTime += dt;
      if (clOutTime > clOutTotal()) {
        if (clPendingNew) clNextComposition(); else clStartIn();
        clPendingNew = true;
      }
    }

    const fps = clGet('collageStopMotionFps');
    const q = (t) => (fps > 0 ? Math.floor(t * fps) / fps : t);
    const tIn = q(clTime);
    const tOut = q(clOutTime);

    const stagger = Math.max(0, clGet('collageStagger'));
    const dur = Math.max(0.05, clGet('collageDuration'));
    const shadowK = clGet('collageShadowStrength');
    // appearance opacity: start value + how long the fade-in lasts (fraction of
    // one piece's animation). Start = 1 -> no fade, pieces simply fall in.
    const opStartRaw = Number(clGet('collageStartOpacity'));
    const opStart = isFinite(opStartRaw) ? Math.min(1, Math.max(0, opStartRaw)) : 0;
    const fadeRaw = Number(clGet('collageFadeDuration'));
    const fadeLen = isFinite(fadeRaw) ? Math.min(1, Math.max(0.001, fadeRaw)) : 0.12;
    const fadeIn = (p) => (p <= 0 ? 0 : opStart + (1 - opStart) * clClamp01(p / fadeLen));

    const lx = keyLight.position.x, ly = keyLight.position.y;
    const ll = Math.hypot(lx, ly) || 1;
    const shX = -lx / ll, shY = -ly / ll;

    const n = clItems.length;
    for (let i = 0; i < n; i++) {
      const it = clItems[i];
      const p = it.settled ? 1 : clClamp01((tIn - it.k * stagger) / dur);

      let x = it.x, y = it.y, z = it.baseZ;
      let rz = it.rot, rx = 0, ry = 0, sc = 1, op = 0;

      if (clPhase === 'in' || clPhase === 'out') {
        if (p > 0) {
          const e = clEase(p);
          const inv = 1 - e;
          if (it.style === 'drop') {
            z = it.baseZ + Math.max(0, inv) * 3.2;
            rz = it.rot + inv * it.spin;
            rx = Math.max(0, inv) * it.tiltX;
            ry = Math.max(0, inv) * it.tiltY;
            sc = 1 + Math.min(0, inv) * 0.35;
            op = fadeIn(p);
          } else if (it.style === 'slide') {
            x = it.x + inv * it.dirX * it.slideDist;
            y = it.y + inv * it.dirY * it.slideDist;
            z = it.baseZ + Math.max(0, inv) * 0.5;
            rz = it.rot + inv * it.spin;
            op = fadeIn(p);
          } else {
            sc = Math.max(0.001, e);
            z = it.baseZ + Math.max(0, inv) * 0.35;
            rz = it.rot + inv * it.spin * 0.5;
            op = fadeIn(p);
          }
        }
      }

      if (clPhase === 'out') {
        if (exitStyle === 'sweep') {
          // swept off the table by a hand: accelerate out of frame, turning a bit
          const sd = Math.max(0.05, clExitNum('collageSweepDuration'));
          const qs = clClamp01((tOut - it.sweepDelay) / sd);
          const es = qs * qs * (1.6 - 0.6 * qs);
          const a = THREE.MathUtils.degToRad(clExitNum('collageSweepAngle'));
          const { hw, hh } = clViewHalf();
          const far = Math.hypot(hw, hh) * 2.2 + Math.max(it.w, it.h);
          x += Math.cos(a) * far * es;
          y += Math.sin(a) * far * es;
          z += Math.sin(Math.PI * Math.min(1, qs * 1.4)) * 0.12;   // lifted slightly by the push
          rz += it.sweepSpin * 0.9 * es;
        } else {
          const qo = clClamp01((tOut - (n - 1 - i) * CL_OUT_STAGGER) / CL_OUT_DUR);
          const eo = qo * qo * qo;
          z += eo * 3.0;
          rz += eo * it.spin * 0.6;
          op *= 1 - qo;
        }
      }

      const visible = op > 0.001;
      it.mesh.visible = visible;
      it.shadow.visible = visible && shadowK > 0.001;
      if (!visible) continue;

      it.mesh.position.set(x, y, z);
      it.mesh.rotation.set(rx, ry, rz);
      it.mesh.scale.set(it.w * sc, it.h * sc, 1);
      it.mesh.material.uniforms.uOpacity.value = op;

      const height = Math.max(0, z - it.baseZ);
      const off = 0.035 + height * 0.3;
      const blurW = 0.02 + height * 0.14;
      it.shadow.position.set(x + shX * off, y + shY * off, it.baseZ - 0.003);
      it.shadow.rotation.set(0, 0, rz);
      it.shadow.scale.set(it.w * sc * CL_SHADOW_PAD, it.h * sc * CL_SHADOW_PAD, 1);
      const su = it.shadow.material.uniforms;
      // a piece high above the table casts only a faint, wide shadow that
      // gathers as it lands (matters when pieces fall in fully opaque)
      su.uOpacity.value = shadowK * op * 0.6 * Math.exp(-height * 1.3);
      su.uBlur.value.set(blurW / Math.max(0.01, it.w * sc), blurW / Math.max(0.01, it.h * sc));
    }

    glslCommonUniforms.uGrainIntensity.value = controls.get('grainIntensity') ?? 0.0;
    glslCommonUniforms.uRoughness.value = getStockRoughnessScalar(activePaperPreset, controls.get('paperRoughness') ?? 0.0);
    glslCommonUniforms.uStockType.value = getStockTypeCode(activePaperPreset);
    glslCommonUniforms.uKeyLightIntensity.value = controls.get('keyLightIntensity') ?? 4.0;
    glslCommonUniforms.uFillLightIntensity.value = controls.get('fillLightIntensity') ?? 3.0;
    glslCommonUniforms.uKeyLightPos.value.copy(keyLight.position);
    glslCommonUniforms.uFillLightPos.value.copy(fillLight.position);

    clGroup.updateMatrixWorld(true);
  };

  // re-init collage when entering the mode or when textures change
  controls.onChange('mode', (v) => { if (v === 'collage') { clInited = false; } });
  const clOrigSync = syncTexturesToShaders;
}

// =========================================================================
// 14. SHOWCASE MODE  (mode: 'showcase')
//     Posters / PNG cut-outs float in 3D space around a big title — they fly
//     out of the depth past the camera (tunnel), orbit the title, or drift.
// =========================================================================
{
  const SC_DEFAULTS = {
    showcaseImages: [],          // картки; порожньо = posterImages
    showcaseMotion: 'steps',     // 'steps' | 'fly' | 'orbit' | 'drift'
    // 'steps' = Jitter-style conveyor: cards hop one place along a diagonal
    showcaseStepDuration: 0.72,  // тривалість одного кроку, с
    showcaseStepHold: 0.14,      // пауза між кроками, с
    showcaseStepEasing: 'soft',  // 'soft' | 'jitter' (як на референсі) | 'expo' | 'back' | 'smooth' | 'linear'
    showcaseStepDrift: 0.18,     // частка руху, що йде безперервно (картки ніколи не зупиняються повністю)
    showcaseStepAngle: 33,       // нахил діагоналі, °
    showcaseStepSpacing: 1.0,    // відстань між картками
    showcaseStepTilt: 6,         // випадковий нахил кожного місця в ланцюжку, °
    showcaseStepSpin: 15,        // на скільки градусів картка прокручується за кожне місце (як на референсі)
    showcaseStepStagger: 0.025,  // затримка між картками на кроці, с
    showcaseStepDirection: 1,    // 1 = вгору-ліворуч, -1 = вниз-праворуч
    showcaseStepGap: 0.45,
    showcaseStepPlaces: 1,       // на скільки місць ланцюжка картки переїжджають за один крок (ширина кроку)       // відстань між картками в глибину (щоб не провалювались одна в одну)
    showcaseCount: 12,
    showcaseSpeed: 0.35,
    showcaseCardSize: 1.5,
    showcaseSizeJitter: 0.35,
    showcaseSpread: 1.0,
    showcaseRotation: 0.6,
    showcaseDepth: 1.0,
    showcaseParallax: 0.4,
    showcaseSeed: 11,
    showcaseTitle: '',            // великий напис у центрі (порожньо = без напису)
    showcaseTitleColor: '#111111',
    showcaseTitleSize: 1.0,
    showcaseTitleFont: 'sans',   // 'sans' | 'serif' | 'mono'
  };
  Object.keys(SC_DEFAULTS).forEach((k) => {
    if (controls.get(k) === undefined) controls.set(k, JSON.parse(JSON.stringify(SC_DEFAULTS[k])));
  });
  controls.setDefaults(SC_DEFAULTS);
  const scGet = (k) => { const v = controls.get(k); return v === undefined || v === null ? SC_DEFAULTS[k] : v; };
  const scNum = (k) => { const v = Number(scGet(k)); return isFinite(v) ? v : SC_DEFAULTS[k]; };
  const scActive = () => controls.get('mode') === 'showcase';

  // ---------------- shaders ----------------
  const scVertex = `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const scCardFragment = `
    uniform sampler2D uTexture;
    uniform vec2 uDimensions;
    uniform float uOpacity;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    ${glslPaperHeader}
    void main() {
      vec4 tex = texture2D(uTexture, vUv);
      float a = tex.a * uOpacity;
      if (a < 0.02) discard;
      vec3 dX = dFdx(vWorldPos);
      vec3 dY = dFdy(vWorldPos);
      vec3 cn = cross(dX, dY);
      vec3 N = length(cn) > 1e-6 ? normalize(cn) : vec3(0.0, 0.0, 1.0);
      if (!gl_FrontFacing) N = -N;
      vec3 albedo = gl_FrontFacing ? sRGBToLinear(tex.rgb) : sRGBToLinear(vec3(0.95, 0.95, 0.94));
      vec3 color = renderPaperMaterial(
        tex.rgb, albedo, N, N, vUv, uDimensions, vWorldPos, cameraPosition,
        uGrainIntensity, uRoughness, uKeyLightIntensity, uFillLightIntensity,
        uKeyLightPos, uFillLightPos, 0.0, 0.0
      );
      gl_FragColor = vec4(color, a);
    }
  `;
  // flat printed title (raw sRGB colour, no lighting)
  const scTitleFragment = `
    uniform sampler2D uTexture;
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      float a = texture2D(uTexture, vUv).a * uOpacity;
      if (a < 0.01) discard;
      gl_FragColor = vec4(uColor, a);
    }
  `;

  const scGroup = new THREE.Group();
  scGroup.visible = false;
  mainStage.add(scGroup);
  const scQuad = new THREE.PlaneGeometry(1, 1);

  // ---------------- title ----------------
  const scTitleCanvas = document.createElement('canvas');
  const scTitleTex = new THREE.CanvasTexture(scTitleCanvas);
  scTitleTex.colorSpace = THREE.NoColorSpace;
  scTitleTex.generateMipmaps = true;
  scTitleTex.minFilter = THREE.LinearMipmapLinearFilter;
  const scTitleMat = new THREE.ShaderMaterial({
    vertexShader: scVertex,
    fragmentShader: scTitleFragment,
    uniforms: {
      uTexture: { value: scTitleTex },
      uColor: { value: new THREE.Color('#111111') },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const scTitle = new THREE.Mesh(scQuad, scTitleMat);
  scGroup.add(scTitle);
  let scTitleAspect = 4;

  function scDrawTitle() {
    const text = String(scGet('showcaseTitle') || '');
    const fam = { sans: '"Helvetica Neue", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"SF Mono", Menlo, Consolas, monospace' }[scGet('showcaseTitleFont')] || 'sans-serif';
    const px = 256;
    const ctx = scTitleCanvas.getContext('2d');
    ctx.font = `500 ${px}px ${fam}`;
    const tw = Math.max(1, Math.ceil(ctx.measureText(text).width));
    scTitleCanvas.width = Math.min(8192, tw + 64);
    scTitleCanvas.height = Math.round(px * 1.25);
    ctx.clearRect(0, 0, scTitleCanvas.width, scTitleCanvas.height);
    ctx.font = `500 ${px}px ${fam}`;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, scTitleCanvas.width / 2, scTitleCanvas.height / 2);
    scTitleAspect = scTitleCanvas.width / scTitleCanvas.height;
    scTitleTex.needsUpdate = true;
    scTitle.visible = text.length > 0;
  }
  scDrawTitle();
  ['showcaseTitle', 'showcaseTitleFont'].forEach((k) => controls.onChange(k, scDrawTitle));

  // ---------------- images ----------------
  let scOwnTex = [];
  let scToken = 0;
  let scSrcRef = null;
  function scTexSize(t) {
    const img = t && t.image;
    const w = img && (img.naturalWidth || img.width), h = img && (img.naturalHeight || img.height);
    return w && h ? { w, h } : null;
  }
  function scLoad(list) {
    const urls = (Array.isArray(list) ? list : [list]).filter((u) => typeof u === 'string' && u.trim());
    const token = ++scToken;
    if (!urls.length) { scOwnTex = []; scBuild(); return; }
    const out = new Array(urls.length).fill(null);
    let done = 0;
    const fin = () => { if (token === scToken && ++done === urls.length) { scOwnTex = out.filter(Boolean); scBuild(); } };
    urls.forEach((u, i) => textureLoader.load(u.trim(), (tex) => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
      out[i] = tex; fin();
    }, undefined, fin));
  }
  const scSources = () => (scOwnTex.length ? scOwnTex : getActiveTexturesList()).filter((t) => scTexSize(t));

  // ---------------- cards ----------------
  let scCards = [];
  const scHash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

  function scBuild() {
    scCards.forEach((c) => { scGroup.remove(c.mesh); c.mesh.material.dispose(); });
    scCards = [];
    const texs = scSources();
    if (!texs.length) return;
    const n = Math.max(1, Math.round(scNum('showcaseCount')));
    const seed = scNum('showcaseSeed');
    for (let i = 0; i < n; i++) {
      const tex = texs[i % texs.length];
      const mat = new THREE.ShaderMaterial({
        vertexShader: scVertex,
        fragmentShader: scCardFragment,
        uniforms: {
          ...glslCommonUniforms,
          uNoiseOffset: { value: new THREE.Vector2((i + 1) * 4.71, (i + 1) * 9.23) },
          uTexture: { value: tex },
          uDimensions: { value: new THREE.Vector2(1, 1) },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(scQuad, mat);
      mesh.frustumCulled = false;
      scGroup.add(mesh);
      const sz = scTexSize(tex);
      scCards.push({
        mesh, aspect: sz.w / sz.h,
        phase: (i + scHash(i, seed) * 0.6) / n,   // spread evenly along the loop
        r1: scHash(i + 1, seed * 1.3), r2: scHash(i + 2, seed * 2.1), r3: scHash(i + 3, seed * 3.7),
        r4: scHash(i + 4, seed * 4.9), r5: scHash(i + 5, seed * 5.3),
      });
    }
  }
  ['showcaseCount', 'showcaseSeed'].forEach((k) => controls.onChange(k, scBuild));
  controls.onChange('showcaseImages', (v) => scLoad(v));
  scLoad(scGet('showcaseImages'));

  // ---------------- pointer parallax ----------------
  const scMouse = new THREE.Vector2(), scMouseS = new THREE.Vector2();
  renderer.domElement.addEventListener('pointermove', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    scMouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  });
  renderer.domElement.addEventListener('pointerleave', () => scMouse.set(0, 0));

  // ---------------- step conveyor helpers ----------------
  function scBezier(p1x, p1y, p2x, p2y) {
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let u = t;
      for (let k = 0; k < 8; k++) {
        const x = 3 * (1 - u) * (1 - u) * u * p1x + 3 * (1 - u) * u * u * p2x + u * u * u;
        const dx = 3 * (1 - u) * (1 - u) * p1x + 6 * (1 - u) * u * (p2x - p1x) + 3 * u * u * (1 - p2x);
        if (Math.abs(dx) < 1e-6) break;
        u = Math.min(1, Math.max(0, u - (x - t) / dx));
      }
      return 3 * (1 - u) * (1 - u) * u * p1y + 3 * (1 - u) * u * u * p2y + u * u * u;
    };
  }
  const SC_STEP_EASE = {
    soft: scBezier(0.45, 0, 0.12, 1),         // smoother start, same long glide
    jitter: scBezier(0.3, 0, 0, 1),           // measured from the reference video
    expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    back: (x) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    smooth: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    linear: (x) => x,
  };
  let scStepClock = 0;
  // per-place tilt: every place in the chain has its own angle; a card takes
  // on the angle of the place it lands on
  const scSlotTilt = (k, seed) => scHash(k * 3.17 + 0.5, seed * 0.71 + 9.1) - 0.5;
  const scSlotYaw = (k, seed) => scHash(k * 5.31 + 1.5, seed * 1.37 + 2.3) - 0.5;
  const scLerp = (a, b, t) => a + (b - a) * t;

  // ---------------- per frame ----------------
  let scTime = 0;
  let scLastT = performance.now();
  const scPrevHook = scene.onBeforeRender;
  const scEuler = new THREE.Euler();

  scene.onBeforeRender = function (r, s, c, rt) {
    if (typeof scPrevHook === 'function') scPrevHook.call(this, r, s, c, rt);
    const now = performance.now();
    const dt = Math.min(0.1, (now - scLastT) / 1000);
    scLastT = now;

    const active = scActive();
    scGroup.visible = active;
    if (!active) return;

    if (!scOwnTex.length) {
      const src = getActiveTexturesList();
      if (src !== scSrcRef) { scSrcRef = src; scBuild(); }
    }

    mainStage.rotation.set(0, 0, 0);
    mainStage.position.set(0, 0, 0);

    scTime += dt * scNum('showcaseSpeed');
    scStepClock += dt;
    const motion = scGet('showcaseMotion');
    const spread = scNum('showcaseSpread');
    const depth = Math.max(0.2, scNum('showcaseDepth'));
    const rotAmt = scNum('showcaseRotation');
    const baseSize = scNum('showcaseCardSize');
    const jitter = scNum('showcaseSizeJitter');

    // view size at the title plane (z = 0), so layouts adapt to any frame ratio
    const dist = camera.position.distanceTo(orbitControls.target) || 7.2;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dist;
    const halfW = halfH * camera.aspect;

    // title
    const tH = halfH * 0.42 * scNum('showcaseTitleSize');
    let tW = tH * scTitleAspect;
    const maxW = halfW * 1.9;
    const tScale = tW > maxW ? maxW / tW : 1;
    // in 'steps' the title sits behind the whole chain (same on-screen size)
    const nC = Math.max(1, scCards.length);
    const tZ = motion === 'steps' ? -(nC / 2 * Math.max(0.02, scNum('showcaseStepGap')) * depth + 0.6) : 0;
    const tP = Math.max(0.2, (dist - tZ) / dist);
    scTitle.scale.set(tW * tScale * tP, tH * tScale * tP, 1);
    scTitle.position.set(0, 0, tZ);
    scTitleMat.uniforms.uColor.value.set(scGet('showcaseTitleColor') || '#111111');

    // parallax: the whole cloud leans towards the pointer
    scMouseS.lerp(scMouse, 1 - Math.exp(-dt * 4));
    const par = scNum('showcaseParallax');
    scGroup.rotation.set(-scMouseS.y * 0.18 * par, scMouseS.x * 0.25 * par, 0);

    for (let i = 0; i < scCards.length; i++) {
      const cd = scCards[i];
      const hgt = baseSize * (1 + (cd.r1 - 0.5) * 2 * jitter);
      const wid = hgt * cd.aspect;
      cd.mesh.material.uniforms.uDimensions.value.set(wid, hgt);

      let x, y, z, op = 1;
      const wobT = scTime * 0.6 + cd.r5 * 10;
      if (motion === 'steps') {
        // ---- Jitter-style conveyor ----
        const n = scCards.length;
        const moveD = Math.max(0.05, scNum('showcaseStepDuration'));
        const cycle = moveD + Math.max(0, scNum('showcaseStepHold'));
        const easeFn = SC_STEP_EASE[scGet('showcaseStepEasing')] || SC_STEP_EASE.jitter;
        const stagger = scNum('showcaseStepStagger');
        const dirSign = scNum('showcaseStepDirection') < 0 ? -1 : 1;
        // which place this card is heading for (unwrapped)
        const baseSlot = i - (n - 1) / 2;
        const hop = Math.max(0.25, scNum('showcaseStepPlaces'));
        const half = n / 2;
        const wrapS = (v) => ((v + half) % n + n) % n - half;
        const hold = Math.max(0, scNum('showcaseStepHold'));
        const G = Math.floor(scStepClock / cycle);
        // stagger = a wave along the chain: the card at the FRONT of the chain
        // moves first, the ones behind follow. The order is taken from where each
        // card LANDS on this hop, so cards never overtake each other (that was
        // what made a card cut through its neighbour), and the whole wave fits
        // inside the hold, so nothing jumps at the start of the next hop.
        const landing = wrapS(baseSlot - dirSign * (G + 1) * hop);
        const rankFront = dirSign > 0 ? (landing + half) : (half - landing);
        const H = hold * 0.95;
        const delay = Math.min(H, Math.max(0, Math.max(0, stagger) * (rankFront - (n - 1) / 2) + H / 2));
        const local = scStepClock - G * cycle - delay;
        const eStep = local <= 0 ? 0 : (local < moveD ? easeFn(local / moveD) : 1);
        // part of the travel is a constant slow glide, so cards never freeze
        // completely between hops; still exactly `hop` places per cycle
        const drift = Math.min(0.6, Math.max(0, scNum('showcaseStepDrift')));
        const glide = (scStepClock - G * cycle) / cycle;
        const e = (1 - drift) * eStep + drift * glide;
        // position along the chain, wrapped so the chain loops endlessly
        let sPos = wrapS(baseSlot - dirSign * (G + e) * hop);
        const ang = THREE.MathUtils.degToRad(scNum('showcaseStepAngle'));
        const spacing = halfW * 0.55 * scNum('showcaseStepSpacing') * spread;
        x = Math.cos(ang) * sPos * spacing;
        y = -Math.sin(ang) * sPos * spacing;
        // later cards (towards bottom-right) lie on top of earlier ones, with a
        // real gap in depth so tilted cards never cut into each other; the
        // perspective this would add is cancelled below (see persp)
        z = sPos * Math.max(0.02, scNum('showcaseStepGap')) * depth;
        // fade only at the far ends of the loop, where the wrap happens
        const edge = half - Math.abs(sPos);
        op = Math.min(1, Math.max(0, edge / (0.6 + Math.max(0, hop - 1))));
        cd.slotPos = sPos;
      } else if (motion === 'orbit') {
        // carousel around the title
        const a = (cd.phase + scTime * 0.12) * Math.PI * 2;
        const R = halfW * 0.95 * spread;
        x = Math.cos(a) * R;
        z = Math.sin(a) * R * 0.8 * depth;
        y = (cd.r2 - 0.5) * halfH * 1.3 * spread + Math.sin(wobT) * 0.08;
      } else if (motion === 'drift') {
        // gentle float in place
        x = (cd.r2 - 0.5) * 2 * halfW * 0.85 * spread + Math.sin(wobT) * 0.12;
        y = (cd.r3 - 0.5) * 2 * halfH * 0.8 * spread + Math.cos(wobT * 0.8) * 0.1;
        z = (cd.r4 - 0.5) * 4 * depth + Math.sin(wobT * 0.5) * 0.15;
      } else {
        // fly: out of the depth, past the camera, endlessly (tunnel)
        const u = (cd.phase + scTime * 0.08) % 1;
        const cycle = Math.floor(cd.phase + scTime * 0.08);
        const zFar = -14 * depth, zNear = dist * 0.92;
        z = zFar + (zNear - zFar) * u;
        // a new spot every lap, never through the dead centre of the title
        const ang = scHash(i * 7 + cycle, 3.3) * Math.PI * 2;
        const rr = (0.35 + scHash(i * 11 + cycle, 7.7) * 0.75) * spread;
        x = Math.cos(ang) * rr * halfW * 1.1;
        y = Math.sin(ang) * rr * halfH * 0.95;
        op = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.04);
      }

      // tilts: each card leans its own way, slowly breathing
      const tx = (cd.r3 - 0.5) * 0.9 * rotAmt + Math.sin(wobT * 0.7) * 0.06 * rotAmt;
      const ty = (cd.r4 - 0.5) * 1.1 * rotAmt + Math.cos(wobT * 0.5) * 0.08 * rotAmt;
      const tz = (cd.r5 - 0.5) * 0.9 * rotAmt + Math.sin(wobT * 0.4) * 0.05 * rotAmt;
      if (motion === 'steps') {
        // the place decides the angle: interpolate between the two places
        // the card is travelling between
        const seed = scNum('showcaseSeed');
        const sp = cd.slotPos;
        const k0 = Math.floor(sp), fl = sp - k0;
        const f = fl * fl * (3 - 2 * fl);   // smooth hand-over between the angles of two places
        const tiltDeg = scNum('showcaseStepTilt');
        // steady spin: the angle changes linearly along the chain, so every hop
        // turns the card by the same amount (measured ~15° per place in the
        // reference: bottom-right cards lean clockwise, they unwind while
        // travelling to the top-left)
        const spin = THREE.MathUtils.degToRad(scNum('showcaseStepSpin')) * -sp;
        const tiltZ = spin + THREE.MathUtils.degToRad(tiltDeg) * 2 * scLerp(scSlotTilt(k0, seed), scSlotTilt(k0 + 1, seed), f);
        const yaw = 0.2 * rotAmt * 2 * scLerp(scSlotYaw(k0, seed), scSlotYaw(k0 + 1, seed), f);
        scEuler.set(0.06 * rotAmt * Math.sin(wobT * 0.3), yaw, tiltZ + (cd.r5 - 0.5) * 0.12 * rotAmt);
      } else {
        scEuler.set(tx, ty + (motion === 'orbit' ? -Math.atan2(z, x) + Math.PI / 2 : 0), tz);
      }

      // steps: keep the on-screen size & layout independent of depth, so the
      // depth gap doesn't read as perspective (near cards bigger, far smaller)
      const persp = motion === 'steps' ? Math.max(0.2, (dist - z) / dist) : 1;
      cd.mesh.position.set(x * persp, y * persp, z);
      cd.mesh.rotation.copy(scEuler);
      cd.mesh.scale.set(wid * persp, hgt * persp, 1);
      cd.mesh.material.uniforms.uOpacity.value = op;
      cd.mesh.visible = op > 0.01;
    }

    glslCommonUniforms.uKeyLightPos.value.copy(keyLight.position);
    glslCommonUniforms.uFillLightPos.value.copy(fillLight.position);
    glslCommonUniforms.uKeyLightIntensity.value = controls.get('keyLightIntensity') ?? 4.0;
    glslCommonUniforms.uFillLightIntensity.value = controls.get('fillLightIntensity') ?? 3.0;
    glslCommonUniforms.uGrainIntensity.value = controls.get('grainIntensity') ?? 0.0;
    glslCommonUniforms.uRoughness.value = getStockRoughnessScalar(activePaperPreset, controls.get('paperRoughness') ?? 0.0);
    glslCommonUniforms.uStockType.value = getStockTypeCode(activePaperPreset);

    mainStage.updateMatrixWorld(true);
  };
}

// Animation Loop State & Dynamics
let prevFoldCombined = 0;
let motionActivity = 0;

const clock = new THREE.Clock();

// Keep the canvas filling the frame no matter who resized it (Brik's frame /
// export sizing, late script load, ratio switch). CSS always 100%; the drawing
// buffer follows the frame unless Brik fixed an export size; the camera aspect
// always follows the real drawing buffer, so nothing gets cropped or stretched.
const __sizeV = new THREE.Vector2();
const __bufV = new THREE.Vector2();
function syncCanvasSize() {
  const el = renderer.domElement;
  if (el.style.width !== '100%' || el.style.position !== 'absolute') {
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
  }
  const api = window.CanvasRuntimeAPI;
  const fixed = !!(api && api.isFixedExportMode && api.isFixedExportMode());
  if (!fixed) {
    const w = area.clientWidth, h = area.clientHeight;
    renderer.getSize(__sizeV);
    if (w > 0 && h > 0 && (Math.abs(__sizeV.x - w) > 0.5 || Math.abs(__sizeV.y - h) > 0.5)) {
      renderer.setSize(w, h, false);
    }
  }
  renderer.getDrawingBufferSize(__bufV);
  if (__bufV.x > 0 && __bufV.y > 0) {
    const asp = __bufV.x / __bufV.y;
    if (Math.abs(camera.aspect - asp) > 1e-4) {
      camera.aspect = asp;
      camera.updateProjectionMatrix();
      updateBgUvScale();
      updateFgUvScale();
    }
  }
}

function animate() {
  // a newer run of the tool replaced our canvas -> stop this old loop
  if (!renderer.domElement.isConnected) return;
  requestAnimationFrame(animate);
  syncCanvasSize();
  const delta = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  const lerpFactor = 1.0 - Math.exp(-delta * 9.0);
  mouseCurrent.lerp(mouseTarget, lerpFactor);

  const mode = controls.get('mode');
  const animTrigger = controls.get('animTrigger') || 'auto';
  const isClickTrigger = animTrigger === 'click';
  const pauseDuration = Math.max(0.02, controls.get('animPauseDuration') ?? 1.5);

  renderer.domElement.style.cursor = isClickTrigger
    ? (isPointerDragging ? 'grabbing' : 'pointer')
    : (isPointerDragging ? 'grabbing' : 'default');

  const grainInt = controls.get('grainIntensity') ?? 0.0;
  const baseRough = controls.get('paperRoughness') ?? 0.0;
  const effRough = getStockRoughnessScalar(activePaperPreset, baseRough);
  const stockCode = getStockTypeCode(activePaperPreset);
  const glossDens = controls.get('glossVarnishDensity') ?? 1.0;
  const glossShine = controls.get('glossShineStrength') ?? 0.5;
  const crumpleFolds = controls.get('crumpleTextureFolds') ?? 1.7;
  const keyLightInt = controls.get('keyLightIntensity') ?? 4.0;
  const fillLightInt = controls.get('fillLightIntensity') ?? 3.0;
  const lightAngX = controls.get('lightAngleX') ?? -20;
  const lightAngY = controls.get('lightAngleY') ?? 61;

  // Studio Lighting
  const radX = THREE.MathUtils.degToRad(lightAngX);
  const radY = THREE.MathUtils.degToRad(lightAngY);
  const lightDist = 9.5;
  
  const keyX = lightDist * Math.sin(radX) * Math.cos(radY);
  const keyY = lightDist * Math.sin(radY);
  const keyZ = lightDist * Math.cos(radX) * Math.cos(radY);
  keyLight.position.set(keyX, keyY, keyZ);
  keyLight.intensity = keyLightInt;
  keyLightTarget.position.set(0, 0, 0);
  keyLightTarget.updateMatrixWorld();

  const fillX = -lightDist * 0.8 * Math.sin(radX) * Math.cos(radY);
  const fillY = -lightDist * 0.4 * Math.sin(radY);
  const fillZ = lightDist * 0.7 * Math.cos(radX) * Math.cos(radY);
  fillLight.position.set(fillX, fillY, fillZ);
  fillLight.intensity = fillLightInt;

  ambientLight.intensity = (keyLightInt + fillLightInt) * 0.45;

  const keyPosVec = keyLight.position;
  const fillPosVec = fillLight.position;

  floatClickWave = Math.max(0.0, floatClickWave - delta * 2.2);

  // 1. Fold & Unfold Mode Animation
  if (mode === 'fold') {
    let p1 = 0.0;
    let p2 = 0.0;
    const foldSpeed = controls.get('foldSpeed') ?? 1.1;

    if (isClickTrigger) {
      p1 = updateTween(foldTween1, delta, foldSpeed);
      p2 = updateTween(foldTween2, delta, foldSpeed);

      const tease1 = foldTween1.to <= 0.05 ? getIdleTease(foldTween1, elapsed, 0.038, 2.4) : 0.0;
      const tease2 = foldTween1.to >= 0.95 && foldTween2.to <= 0.05 ? getIdleTease(foldTween2, elapsed, 0.038, 2.4) : 0.0;

      p1 = THREE.MathUtils.clamp(p1 + tease1, 0.0, 1.0);
      p2 = THREE.MathUtils.clamp(p2 + tease2, 0.0, 1.0);
    } else if (controls.get('autoFold')) {
      const stageDuration = 1.35 / Math.max(0.1, foldSpeed);
      const halfPause = pauseDuration * 0.28;
      const fullPause = pauseDuration;
      
      const t1 = stageDuration;
      const t2 = t1 + halfPause;
      const t3 = t2 + stageDuration;
      const t4 = t3 + fullPause;
      const t5 = t4 + stageDuration;
      const t6 = t5 + halfPause;
      const t7 = t6 + stageDuration;
      const totalCycle = t7 + fullPause;

      autoFoldTime += delta;
      const cycleIdx = Math.floor(autoFoldTime / totalCycle);
      if (cycleIdx !== lastAutoFoldCycleIdx) {
        setupNextFoldCycleSigns();
        lastAutoFoldCycleIdx = cycleIdx;
      }

      const cycleTime = autoFoldTime % totalCycle;

      if (cycleTime < t1) {
        p1 = easeInOutSine(cycleTime / stageDuration);
        p2 = 0.0;
      } else if (cycleTime < t2) {
        p1 = 1.0;
        p2 = 0.0;
      } else if (cycleTime < t3) {
        p1 = 1.0;
        p2 = easeInOutSine((cycleTime - t2) / stageDuration);
      } else if (cycleTime < t4) {
        p1 = 1.0;
        p2 = 1.0;
      } else if (cycleTime < t5) {
        p1 = 1.0;
        p2 = 1.0 - easeInOutSine((cycleTime - t4) / stageDuration);
      } else if (cycleTime < t6) {
        p1 = 1.0;
        p2 = 0.0;
      } else if (cycleTime < t7) {
        p1 = 1.0 - easeInOutSine((cycleTime - t6) / stageDuration);
        p2 = 0.0;
      } else {
        p1 = 0.0;
        p2 = 0.0;
      }
    } else {
      const manualVal = controls.get('foldProgress') ?? 0.0;
      if (manualVal < 0.5) {
        p1 = manualVal * 2.0;
        p2 = 0.0;
      } else {
        p1 = 1.0;
        p2 = (manualVal - 0.5) * 2.0;
      }
    }

    foldUniforms.uFoldProg1.value = p1;
    foldUniforms.uFoldProg2.value = p2;
    foldUniforms.uFoldAxis1.value = foldAxis1;
    foldUniforms.uFoldSign1.value = foldSign1;
    foldUniforms.uFoldSign2.value = foldSign2;
    foldUniforms.uFoldZSign2.value = foldZSign2;

    const combinedFold = p1 + p2;
    const currentFoldSpeed = Math.abs(combinedFold - prevFoldCombined) / Math.max(delta, 0.001);
    motionActivity = THREE.MathUtils.lerp(motionActivity, Math.min(currentFoldSpeed, 2.5), 0.12);
    motionActivity = Math.max(0.0, motionActivity - delta * 0.4);
    prevFoldCombined = combinedFold;

    foldUniforms.uFlutter.value = controls.get('paperFlutter') ?? 0.44;
    foldUniforms.uMotionActivity.value = motionActivity;
    foldUniforms.uGrainIntensity.value = grainInt;
    foldUniforms.uRoughness.value = effRough;
    foldUniforms.uStockType.value = stockCode;
    foldUniforms.uGlossDensity.value = glossDens;
    foldUniforms.uGlossShine.value = glossShine;
    foldUniforms.uCrumpleFolds.value = crumpleFolds;
    foldUniforms.uKeyLightIntensity.value = keyLightInt;
    foldUniforms.uFillLightIntensity.value = fillLightInt;
    foldUniforms.uKeyLightPos.value.copy(keyPosVec);
    foldUniforms.uFillLightPos.value.copy(fillPosVec);
    foldUniforms.uTime.value = elapsed;
  }

  // 2. Peel Layers Mode Animation
  else if (mode === 'peel') {
    const numLayers = parseInt(controls.get('numLayers')) || 4;
    const peelSpeed = controls.get('peelSpeed') ?? 0.3;
    let peelMasterProg = controls.get('peelProgress') ?? 0.25;
    
    if (isClickTrigger) {
      peelMasterProg = updateTween(peelTween, delta, peelSpeed);
      const peelTease = getIdleTease(peelTween, elapsed, 0.040, 2.4);
      peelMasterProg = THREE.MathUtils.clamp(peelMasterProg + peelTease, 0.0, 1.0);
    } else if (controls.get('autoPeel')) {
      const peelMotionDuration = 1.65 / Math.max(0.1, peelSpeed);
      const t1 = peelMotionDuration;
      const t2 = t1 + pauseDuration;
      const t3 = t2 + peelMotionDuration;
      const totalPeelCycle = t3 + pauseDuration;

      autoPeelTime += delta;
      const cycleTime = autoPeelTime % totalPeelCycle;

      if (cycleTime < t1) {
        peelMasterProg = easeInOutSine(cycleTime / peelMotionDuration);
      } else if (cycleTime < t2) {
        peelMasterProg = 1.0;
      } else if (cycleTime < t3) {
        peelMasterProg = 1.0 - easeInOutSine((cycleTime - t2) / peelMotionDuration);
      } else {
        peelMasterProg = 0.0;
      }
    }

    const peelAng = controls.get('peelAngle') ?? 25;
    const curlRad = controls.get('curlRadius') ?? 0.20;
    const backStyle = getBacksideStyleCode(controls.get('backsideStyle'));
    const backColHex = controls.get('backsideColor') || '#DD1010';

    const peelableLayers = Math.max(1, numLayers - 1);

    for (let i = 0; i < numLayers && i < peelLayerMaterials.length; i++) {
      let localProg = 0.0;
      if (i < peelableLayers) {
        const slotStart = i / peelableLayers;
        const slotEnd = (i + 1) / peelableLayers;
        localProg = THREE.MathUtils.clamp((peelMasterProg - slotStart) / (slotEnd - slotStart), 0.0, 1.0);
      } else {
        localProg = 0.0;
      }

      const mat = peelLayerMaterials[i];
      mat.uniforms.uPeelProgress.value = localProg;
      mat.uniforms.uPeelAngle.value = peelAng;
      mat.uniforms.uCurlRadius.value = curlRad;
      mat.uniforms.uBacksideStyle.value = backStyle;
      mat.uniforms.uBacksideColor.value.set(backColHex);
      mat.uniforms.uGrainIntensity.value = grainInt;
      mat.uniforms.uRoughness.value = effRough;
      mat.uniforms.uStockType.value = stockCode;
      mat.uniforms.uGlossDensity.value = glossDens;
      mat.uniforms.uGlossShine.value = glossShine;
      mat.uniforms.uCrumpleFolds.value = crumpleFolds;
      mat.uniforms.uKeyLightIntensity.value = keyLightInt;
      mat.uniforms.uFillLightIntensity.value = fillLightInt;
      mat.uniforms.uKeyLightPos.value.copy(keyPosVec);
      mat.uniforms.uFillLightPos.value.copy(fillPosVec);
      mat.uniforms.uTime.value = elapsed;

      if (peelLayerMeshes[i]) {
        peelLayerMeshes[i].position.z = (numLayers - 1 - i) * 0.008;
      }
    }
  }

  // 3. Floating Tiles Mode
  else if (mode === 'float') {
    const floatSpeed = controls.get('floatSpeed') ?? 3.0;
    const floatAmp = controls.get('floatAmplitude') ?? 0.5;
    const parallaxStrength = controls.get('parallaxStrength') ?? 2.0;
    const randomness = controls.get('motionRandomness') ?? 1.0;
    const layoutPattern = controls.get('tileLayoutPattern') || 'scatter';
    const isStack = layoutPattern === 'stack';
    const isGrid = layoutPattern === 'grid';

    floatAnimTime += delta * floatSpeed;
    const t = floatAnimTime;

    for (let i = 0; i < floatingTiles.length; i++) {
      const tile = floatingTiles[i];
      const p = tile.phase * randomness;
      const speedMult = THREE.MathUtils.lerp(1.0, tile.speedMult, randomness);

      const bobZFactor = isStack ? 0.012 : (isGrid ? 0.004 : 0.015);
      const bobXYFactor = isStack ? 0.008 : (isGrid ? 0.004 : 0.012);

      const clickBounce = Math.sin(floatClickWave * Math.PI * 2 + i * 0.5) * floatClickWave * 0.06;
      const idleFloatTease = isClickTrigger
        ? Math.sin(elapsed * 2.5 + i * 0.45) * (0.010 / Math.max(1, i * 0.5 + 1.0))
        : 0.0;

      const bobZ = Math.sin(t * 1.2 * speedMult + p) * bobZFactor * floatAmp + clickBounce + idleFloatTease;
      const bobX = Math.cos(t * 0.85 * speedMult + p * 1.3) * bobXYFactor * floatAmp * randomness;
      const bobY = Math.sin(t * 1.05 * speedMult + p * 0.9) * bobXYFactor * floatAmp * randomness;

      const maxTiltDrift = isGrid ? 0.003 : (isStack ? 0.005 : 0.010);
      const rotXDrift = Math.sin(t * 0.95 * speedMult + p) * maxTiltDrift * floatAmp * randomness;
      const rotYDrift = Math.cos(t * 1.15 * speedMult + p * 1.1) * maxTiltDrift * floatAmp * randomness;
      const rotZDrift = Math.sin(t * 0.75 * speedMult + p * 0.7) * (isGrid ? 0.0 : 0.008) * floatAmp * randomness;

      const normX = tile.basePos.x / (posterWidth * 0.5 || 1);
      const normY = tile.basePos.y / (posterHeight * 0.5 || 1);
      const distToMouse = Math.hypot(normX - mouseCurrent.x, normY - mouseCurrent.y);
      const mouseProximity = Math.max(0, 1.0 - distToMouse * 0.55);

      const parallaxZ = (mouseProximity * (isStack ? 0.015 : 0.020) + 0.004) * parallaxStrength;
      const parallaxTiltX = -mouseCurrent.y * (isGrid ? 0.025 : (isStack ? 0.028 : 0.045)) * parallaxStrength;
      const parallaxTiltY = mouseCurrent.x * (isGrid ? 0.025 : (isStack ? 0.028 : 0.045)) * parallaxStrength;
      const parallaxShiftX = mouseCurrent.x * (isStack ? 0.018 : (isGrid ? 0.008 : 0.025)) * parallaxStrength;
      const parallaxShiftY = mouseCurrent.y * (isStack ? 0.018 : (isGrid ? 0.008 : 0.025)) * parallaxStrength;

      tile.mesh.position.set(
        tile.basePos.x + bobX + parallaxShiftX,
        tile.basePos.y + bobY + parallaxShiftY,
        tile.basePos.z + bobZ + parallaxZ
      );

      tile.mesh.rotation.set(
        tile.baseRot.x + rotXDrift + parallaxTiltX,
        tile.baseRot.y + rotYDrift + parallaxTiltY,
        tile.baseRot.z + rotZDrift
      );

      if (tile.material && tile.material.uniforms) {
        tile.material.uniforms.uGrainIntensity.value = grainInt;
        tile.material.uniforms.uRoughness.value = effRough;
        tile.material.uniforms.uStockType.value = stockCode;
        tile.material.uniforms.uGlossDensity.value = glossDens;
        tile.material.uniforms.uGlossShine.value = glossShine;
        tile.material.uniforms.uCrumpleFolds.value = crumpleFolds;
        tile.material.uniforms.uKeyLightIntensity.value = keyLightInt;
        tile.material.uniforms.uFillLightIntensity.value = fillLightInt;
        tile.material.uniforms.uKeyLightPos.value.copy(keyPosVec);
        tile.material.uniforms.uFillLightPos.value.copy(fillPosVec);
      }
    }
  }

  // 4. Crumpled Paper Mode Animation (Silky Smooth Morphed Transitions)
  else if (mode === 'crumple') {
    const crumpleSpeed = controls.get('crumpleSpeed') ?? 1.35;
    let crumpleProg = controls.get('crumpleProgress') ?? 0.0;
    const shouldRandomizeSeed = controls.get('randomizeCrumpleSeed') !== false;
    const animType = controls.get('crumpleAnimType') || 'cycle';
    
    if (isClickTrigger) {
      crumpleProg = updateTween(crumpleTween, delta, crumpleSpeed);
      const crumpleTease = getIdleTease(crumpleTween, elapsed, 0.038, 2.4);
      crumpleProg = THREE.MathUtils.clamp(crumpleProg + crumpleTease, 0.0, 1.0);
      crumpleUniforms.uSeedMorph.value = 0.0;
    } else if (controls.get('autoCrumple')) {
      // Stop-motion: hold each pose for one "shot", then jump to the next.
      const stopMo = controls.get('crumpleStopMotion') === true;
      const stopFps = Math.max(1.0, controls.get('crumpleStopMotionFps') ?? 8);
      const stopStep = 1.0 / stopFps;
      const quantT = (t) => (stopMo ? Math.floor(t / stopStep) * stopStep : t);

      if (animType === 'stay_crumpled') {
        crumpleProg = 1.0;
        const morphDuration = 2.0 / Math.max(0.1, crumpleSpeed);
        const totalCycle = morphDuration + pauseDuration;
        
        autoCrumpleTime += delta;
        const animT = quantT(autoCrumpleTime);
        const cycleIdx = Math.floor(animT / totalCycle);
        
        if (cycleIdx !== lastAutoCrumpleCycleIdx) {
          if (lastAutoCrumpleCycleIdx !== -1) {
            currentSeedA = currentSeedB;
            currentSeedB = shouldRandomizeSeed
              ? Math.floor(Math.random() * 10000) + 1
              : (controls.get('crumpleSeed') ?? 74);
            updateCrumpleBuffers(currentSeedA, currentSeedB);
          } else {
            currentSeedA = controls.get('crumpleSeed') ?? 74;
            currentSeedB = shouldRandomizeSeed
              ? Math.floor(Math.random() * 10000) + 1
              : currentSeedA;
            updateCrumpleBuffers(currentSeedA, currentSeedB);
          }
          lastAutoCrumpleCycleIdx = cycleIdx;
        }

        const cycleTime = animT % totalCycle;
        if (cycleTime < morphDuration) {
          crumpleUniforms.uSeedMorph.value = cycleTime / morphDuration;
        } else {
          crumpleUniforms.uSeedMorph.value = 1.0;
        }
      } else {
        // Longer per-phase dwell: the 5 folding stages each get noticeably more
        // screen time so the progression reads stage by stage.
        const crumpleMotionDuration = 7.4 / Math.max(0.1, crumpleSpeed);
        const t1 = crumpleMotionDuration;
        const t2 = t1 + pauseDuration;
        const t3 = t2 + crumpleMotionDuration;
        const totalCrumpleCycle = t3 + pauseDuration;

        autoCrumpleTime += delta;
        const cycleIdx = Math.floor(autoCrumpleTime / totalCrumpleCycle);
        
        if (cycleIdx !== lastAutoCrumpleCycleIdx) {
          if (lastAutoCrumpleCycleIdx !== -1 && shouldRandomizeSeed) {
            currentSeedA = Math.floor(Math.random() * 10000) + 1;
            currentSeedB = currentSeedA;
            updateCrumpleBuffers(currentSeedA, currentSeedB);
          }
          lastAutoCrumpleCycleIdx = cycleIdx;
        }

        const animT = quantT(autoCrumpleTime);
        const cycleTime = animT % totalCrumpleCycle;
        crumpleUniforms.uSeedMorph.value = 0.0;

        // LINEAR ramp: phaseStep() already shapes each stage, so a linear drive
        // gives all 5 phases exactly the same plateau + transition length.
        if (cycleTime < t1) {
          crumpleProg = cycleTime / crumpleMotionDuration;
        } else if (cycleTime < t2) {
          crumpleProg = 1.0;
        } else if (cycleTime < t3) {
          crumpleProg = 1.0 - (cycleTime - t2) / crumpleMotionDuration;
        } else {
          crumpleProg = 0.0;
        }
      }
    } else {
      crumpleProg = controls.get('crumpleProgress') ?? 0.0;
      crumpleUniforms.uSeedMorph.value = 0.0;
    }

    // Progressive 5-phase folding is baked on the CPU into the morph buffers,
    // so the shader just displays the already-blended pose at full amount.
    const seedMorphNow = crumpleUniforms.uSeedMorph.value;
    applyCrumplePhase(crumpleProg, seedMorphNow);
    crumpleUniforms.uCrumpleProgress.value = 1.0;
    crumpleUniforms.uSeedMorph.value = 0.0;
    crumpleUniforms.uCrumpleFoldStrength.value = 1.0;
    crumpleUniforms.uCrumpleMicroTextureIntensity.value = controls.get('crumpleMicroTextureIntensity') ?? 1.0;
    crumpleUniforms.uCrumpleMicroTextureSize.value = controls.get('crumpleMicroTextureSize') ?? 1.2;
    crumpleUniforms.uGrainIntensity.value = grainInt;
    crumpleUniforms.uRoughness.value = effRough;
    crumpleUniforms.uStockType.value = stockCode;
    crumpleUniforms.uGlossDensity.value = glossDens;
    crumpleUniforms.uGlossShine.value = glossShine;
    crumpleUniforms.uCrumpleFolds.value = crumpleFolds;
    crumpleUniforms.uKeyLightIntensity.value = keyLightInt;
    crumpleUniforms.uFillLightIntensity.value = fillLightInt;
    crumpleUniforms.uKeyLightPos.value.copy(keyPosVec);
    crumpleUniforms.uFillLightPos.value.copy(fillPosVec);
    crumpleUniforms.uTime.value = elapsed;
  }

  // Continuous Camera Orbit & Sway (Runs on Stage independently of paper mode)
  const orbitSpeed = controls.get('cameraOrbitSpeed') ?? 0.2;
  const swayAmount = controls.get('cameraSwayAmount') ?? 0.3;

  // Crumpled sheet reads as a pressed object, so it barely turns: orbit and
  // sway are damped to roughly a third in this mode only.
  // Crumpled mode: the sheet is LOCKED front-facing. No auto-orbit, no sway,
  // no drift, no seed-driven orientation. Only the user's manual orbit moves it.
  if (mode === 'crumple' || mode === 'corners' || mode === 'collage' || mode === 'showcase') {
    stageOrbitAngle = 0.0;
    mainStage.rotation.set(0, 0, 0);
    mainStage.position.set(0, 0, 0);
  } else {
    if (orbitSpeed > 0.0001) {
      stageOrbitAngle += delta * orbitSpeed * 0.45;
    }
    const swayD = swayAmount;
    mainStage.rotation.y = stageOrbitAngle;
    mainStage.rotation.x = Math.sin(elapsed * 0.72) * (0.12 * swayD);
    mainStage.rotation.z = Math.cos(elapsed * 0.58) * (0.08 * swayD);
    mainStage.position.x = Math.cos(elapsed * 0.85) * (0.06 * swayD);
    mainStage.position.y = Math.sin(elapsed * 1.10) * (0.08 * swayD);
  }

  // Cinematic Camera Breathing Zoom
  const zoomAmount = controls.get('cameraZoomAmount') ?? 0.25;
  const zoomSpeed = controls.get('cameraZoomSpeed') ?? 1.0;
  let targetCamZoom = DEFAULT_CAM_ZOOM;

  if (zoomAmount > 0.001) {
    const breathingFactor = Math.sin(elapsed * 0.90 * zoomSpeed) * (0.28 * zoomAmount);
    targetCamZoom = 1.0 + breathingFactor;
  }

  if (isCamResetting) {
    const elapsedReset = (performance.now() - camResetStartTime) / 1000;
    const t = Math.min(1.0, elapsedReset / CAM_RESET_DURATION);
    const ease = 1.0 - Math.pow(1.0 - t, 3.0);

    camera.position.lerpVectors(camStartPos, DEFAULT_CAM_POS, ease);
    orbitControls.target.lerpVectors(camStartTarget, DEFAULT_CAM_TARGET, ease);
    camera.zoom = THREE.MathUtils.lerp(camStartZoom, DEFAULT_CAM_ZOOM, ease);
    camera.updateProjectionMatrix();
    orbitControls.update();

    if (t >= 1.0) {
      isCamResetting = false;
      camera.position.copy(DEFAULT_CAM_POS);
      orbitControls.target.copy(DEFAULT_CAM_TARGET);
      camera.zoom = DEFAULT_CAM_ZOOM;
      camera.updateProjectionMatrix();
      orbitControls.update();
      controls.set('canvasState', {
        version: 1,
        position: camera.position.toArray(),
        target: orbitControls.target.toArray(),
        zoom: camera.zoom,
      });
    }
  } else {
    camera.zoom = THREE.MathUtils.lerp(camera.zoom, targetCamZoom, 1.0 - Math.exp(-delta * 3.5));
    camera.updateProjectionMatrix();
    orbitControls.update();
  }

  // Multi-pass compositing render
  const craftOn = craftPostBegin();
  const bgType = controls.get('bgType') || 'solid';
  const colHex = controls.get('bgColor') || '#121418';

  if (bgType === 'none') {
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear();
  } else {
    renderer.setClearColor(colHex, 1.0);
    renderer.clear();
    renderer.render(bgScene, orthoCamera);
  }

  renderer.clearDepth();
  renderer.render(scene, camera);

  if (hasFgTexture && (controls.get('fgOpacity') ?? 0.8) > 0.001) {
    renderer.clearDepth();
    renderer.render(fgScene, orthoCamera);
  }

  if (craftOn) craftPostEnd(elapsed);
}

// Window & Canvas Resize handling
window.addEventListener('resize', () => {
  const w = area.clientWidth;
  const h = area.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateBgUvScale();
  updateFgUvScale();
});


// =========================================================================
// STUDIO LIGHT & SHADOW — drives the lighting uniforms from the controls.
// The pool of light follows lightAngleX / lightAngleY automatically.
// =========================================================================
{
  const LT_DEFAULTS = {
    lightAmount: 0.6,          // 0 = нейтрально (точні кольори), 1 = виразна світлотінь
    lightPoolSize: 4.0,        // розмір світлової плями
    lightShadowDepth: 0.3,     // наскільки темніють краї поза світлом
    lightHighlight: 0.12,      // наскільки яскравіший центр світла
    lightSheen: 0.25,          // атласний відблиск на папері
    lightWarmth: 0.35,         // теплі світла / холодні тіні
    lightGrainRelief: 0.5,     // рельєф фактури паперу у світлі
    lightFormContrast: 1.6,    // контраст світлотіні на згинах / закрутках
    lightOnBackground: 0.7,    // наскільки світло падає й на фон
  };
  Object.keys(LT_DEFAULTS).forEach((k) => { if (controls.get(k) === undefined) controls.set(k, LT_DEFAULTS[k]); });
  controls.setDefaults(LT_DEFAULTS);
  const ltGet = (k) => (controls.get(k) ?? LT_DEFAULTS[k]);
  const ltV = new THREE.Vector3();

  const ltPrevHook = scene.onBeforeRender;
  scene.onBeforeRender = function (r, sc, cam, rt) {
    if (typeof ltPrevHook === 'function') ltPrevHook.call(this, r, sc, cam, rt);

    const amt = Math.max(0, ltGet('lightAmount'));
    const kp = keyLight.position;
    let hx = (kp.x / Math.max(1.0, kp.z)) * 2.4;
    let hy = (kp.y / Math.max(1.0, kp.z)) * 2.4;
    const hl = Math.hypot(hx, hy);
    if (hl > 3.5) { hx *= 3.5 / hl; hy *= 3.5 / hl; }
    const radius = Math.max(0.3, ltGet('lightPoolSize'));

    const U = glslCommonUniforms;
    U.uLightAmount.value = amt;
    U.uLightSpot.value.set(hx, hy, radius);
    U.uLightMix.value.set(ltGet('lightShadowDepth'), ltGet('lightHighlight'), ltGet('lightWarmth'), ltGet('lightGrainRelief'));
    U.uLightSheen.value.set(ltGet('lightSheen'), ltGet('lightFormContrast'));

    // same pool on the background, in screen space
    ltV.set(hx, hy, 0).project(camera);
    const w = area.clientWidth || window.innerWidth;
    const h = area.clientHeight || window.innerHeight;
    ltV.set(hx + radius, hy, 0);
    const edge = ltV.clone().project(camera);
    const centre = new THREE.Vector3(hx, hy, 0).project(camera);
    const rUv = Math.abs(edge.x - centre.x) * 0.5 * (w / h);
    bgUniforms.uBgLight.value.set((centre.x + 1) * 0.5, (centre.y + 1) * 0.5, Math.max(0.05, rUv * 1.3), amt * Math.max(0, ltGet('lightOnBackground')));
    bgUniforms.uBgLightMix.value.set(ltGet('lightShadowDepth'), ltGet('lightHighlight'), ltGet('lightWarmth'));
    bgUniforms.uBgAspect.value = w / h;
  };
}


// =========================================================================
// PAPER SURFACE — light crumple, waviness, fold lines, grain, optional scan.
// Works in every mode (it lives in the shared paper lighting).
// =========================================================================
{
  const PS_DEFAULTS = {
    paperCrumple: 0.35,         // легка м'ятість (фасетки)
    paperCrumpleScale: 2.0,     // дрібність м'ятості (більше = дрібніші фасетки)
    paperCreaseSharpness: 0.5,  // м'які хвилі (0) ... чіткі заломи (1)
    paperWave: 0.3,             // загальна хвилястість аркуша
    paperGrain: 0.4,            // зерно / волокна паперу
    paperMottle: 0.3,           // легка нерівномірність тону
    paperRelief: 1.0,           // загальна сила рельєфу у світлі
    paperFoldLinesX: 0,         // вертикальні лінії згину (0..3), як у складеного постера
    paperFoldLinesY: 0,         // горизонтальні лінії згину (0..3)
    paperFoldDepth: 0.6,
    paperWear: 0.4,             // потертість (світліші волокна на згинах)
    paperSeed: 7,
    paperScanImage: '',         // скан справжнього паперу (необов'язково)
    paperScanAmount: 0.5,
    paperScanScale: 1.0,        // скільки разів повторюється по ширині
    paperScanRelief: 0.5,
    paperEdgeWear: 0.35,        // потерті краї й кути аркуша
    paperInkVoids: 0.25,        // крапинки, де фарба не лягла (друкований вигляд)
    paperInkBlotch: 0.3,        // нерівна щільність фарби плямами
  };
  Object.keys(PS_DEFAULTS).forEach((k) => { if (controls.get(k) === undefined) controls.set(k, PS_DEFAULTS[k]); });
  controls.setDefaults(PS_DEFAULTS);
  const psNum = (k) => { const v = controls.get(k); return (typeof v === 'number' && isFinite(v)) ? v : PS_DEFAULTS[k]; };

  let psScanTex = null;
  function psLoadScan(url) {
    if (!url || typeof url !== 'string' || !url.trim()) { psScanTex = null; return; }
    textureLoader.load(url.trim(), (tex) => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      psScanTex = tex;
    }, undefined, () => { psScanTex = null; });
  }
  psLoadScan(controls.get('paperScanImage'));
  controls.onChange('paperScanImage', psLoadScan);

  const psPrevHook = scene.onBeforeRender;
  scene.onBeforeRender = function (r, sc, cam, rt) {
    if (typeof psPrevHook === 'function') psPrevHook.call(this, r, sc, cam, rt);
    const U = glslCommonUniforms;
    U.uPaperSurf1.value.set(psNum('paperCrumple'), psNum('paperCrumpleScale'), psNum('paperCreaseSharpness'), psNum('paperSeed') % 997);
    U.uPaperSurf2.value.set(psNum('paperWave'), psNum('paperGrain'), psNum('paperMottle'), psNum('paperRelief'));
    U.uPaperSurf3.value.set(Math.round(psNum('paperFoldLinesX')), Math.round(psNum('paperFoldLinesY')), psNum('paperFoldDepth'), psNum('paperWear'));
    U.uPaperScan.value = psScanTex;
    U.uPaperScanParams.value.set(psNum('paperScanAmount'), psNum('paperScanScale'), psNum('paperScanRelief'), psScanTex ? 1 : 0);
    U.uPaperSurf4.value.set(psNum('paperEdgeWear'), psNum('paperInkVoids'), psNum('paperInkBlotch'), 0);
  };
}


// =========================================================================
// CRAFT POST-PROCESS — over the WHOLE frame (background + poster + overlay):
// print grain, riso / halftone print, ink misregistration & bleed,
// dust & scratches, vignette, paper backdrop texture.
// =========================================================================
const CRAFT_DEFAULTS = {
  craftEnabled: true,
  craftGrain: 0.35,          // зерно друку / плівки
  craftGrainSize: 1.2,       // розмір зерна, px
  craftGrainAnimated: false, // зерно "живе" (кожен кадр інше)
  craftGrainFps: 12,         // як часто оновлюється живе зерно
  craftPrintStyle: 'none',   // 'none' | 'riso' | 'halftone'
  craftPrintAmount: 0.6,
  craftHalftoneSize: 5,      // розмір растра, px
  craftPosterize: 7,         // кількість тонів у riso
  craftMisregister: 1.2,     // зсув фарб, px
  craftMisregisterAngle: 35, // напрям зсуву, °
  craftInkBleed: 0.25,       // розтікання фарби (м'які краї)
  craftDust: 0.3,            // пилинки
  craftScratches: 0.15,      // подряпини / волосинки
  craftVignette: 0.2,
  craftBackdropPaper: 0.25,  // фактура паперу поверх усього кадру (включно з фоном)
  craftSeed: 3,
};
Object.keys(CRAFT_DEFAULTS).forEach((k) => { if (controls.get(k) === undefined) controls.set(k, CRAFT_DEFAULTS[k]); });
controls.setDefaults(CRAFT_DEFAULTS);
const craftGet = (k) => { const v = controls.get(k); return v === undefined || v === null ? CRAFT_DEFAULTS[k] : v; };
const craftNum = (k) => { const v = Number(craftGet(k)); return isFinite(v) ? v : CRAFT_DEFAULTS[k]; };

let craftRT = null;
const craftSize = new THREE.Vector2();
const craftScene = new THREE.Scene();
const craftMat = new THREE.ShaderMaterial({
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;          // device pixels
    uniform float uPx;          // device pixel ratio
    uniform float uTime;
    uniform vec4 uGrain;        // amount, size px, time seed, unused
    uniform vec4 uPrint;        // style, amount, halftone px, posterize levels
    uniform vec3 uMis;          // offset x px, offset y px, ink bleed
    uniform vec4 uDust;         // dust, scratches, seed, unused
    uniform vec2 uFrame;        // vignette, backdrop paper
    varying vec2 vUv;

    float h1(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec2 h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h1(i), h1(i + vec2(1, 0)), u.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), u.x), u.y); }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vn(p); p = p * 2.02 + 7.3; a *= 0.5; } return v; }

    // one halftone screen: ink coverage 0..1 -> printed 0..1 (1 = ink)
    float screen(vec2 fc, float ink, float ang, float cell) {
      float c = cos(ang), s = sin(ang);
      vec2 r = mat2(c, -s, s, c) * fc / cell;
      vec2 g = fract(r) - 0.5;
      float d = length(g);
      // dot AREA proportional to ink coverage (area = pi r^2 per unit cell)
      float rad = min(0.75, sqrt(clamp(ink, 0.0, 1.0) / 3.14159));
      float aa = 0.9 / cell;
      return 1.0 - smoothstep(rad - aa, rad + aa, d);
    }

    void main() {
      vec2 fc = vUv * uRes;
      vec2 px = 1.0 / uRes;
      vec2 off = uMis.xy * px;

      // ---- ink misregistration: every ink plate slightly shifted ----
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = base.g;
      col.b = texture2D(tDiffuse, vUv - off * 0.8).b;
      float alpha = base.a;

      // ---- ink bleed: dark ink spreads a hair into the paper ----
      if (uMis.z > 0.001) {
        vec2 b = px * (1.0 + uMis.z * 1.5) * uPx;
        vec3 n4 = texture2D(tDiffuse, vUv + vec2(b.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(b.x, 0.0)).rgb
                + texture2D(tDiffuse, vUv + vec2(0.0, b.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, b.y)).rgb;
        vec3 blur = (n4 + col) / 5.0;
        col = mix(col, min(col, blur), uMis.z * 0.8);
      }

      vec2 cssFc = fc / uPx;   // pattern coordinates in CSS pixels (same look on retina)

      // ---- print style ----
      float style = uPrint.x;
      if (style > 0.5 && style < 1.5) {
        // RISOGRAPH: few tones, dithered, uneven ink density
        float lv = max(2.0, uPrint.w);
        float dither = h1(floor(cssFc / 1.5) + uDust.z) - 0.5;
        vec3 post = floor(col * lv + 0.5 + dither * 0.9) / lv;
        float dens = 0.82 + 0.18 * fbm(cssFc / 90.0 + uDust.z);
        vec3 inked = 1.0 - (1.0 - post) * dens;
        col = mix(col, clamp(inked, 0.0, 1.0), uPrint.y);
      } else if (style > 1.5) {
        // HALFTONE: CMY screens at classic angles
        float cell = max(2.0, uPrint.z);
        vec3 ink = 1.0 - col;
        vec3 ht = vec3(
          screen(cssFc, ink.r, 0.2618, cell),   // cyan 15°
          screen(cssFc, ink.g, 1.3090, cell),   // magenta 75°
          screen(cssFc, ink.b, 0.0, cell)       // yellow 0°
        );
        col = mix(col, 1.0 - ht, uPrint.y);
      }

      // ---- paper backdrop over the whole frame ----
      if (uFrame.y > 0.001) {
        float fib = fbm(cssFc / 3.0 + uDust.z) * 0.6 + fbm(vec2(cssFc.x / 1.2, cssFc.y / 14.0) + 11.0) * 0.4;
        float mott = fbm(cssFc / 160.0 - uDust.z);
        float paper = 1.0 - ((1.0 - fib) * 0.10 + (1.0 - mott) * 0.06) * uFrame.y;
        col *= paper;
      }

      // ---- grain (strongest in the mid-tones, like film / toner) ----
      if (uGrain.x > 0.001) {
        vec2 gp = floor(cssFc / max(0.5, uGrain.y)) + uGrain.z * 17.0;
        float g = (h1(gp) - 0.5) + (vn(cssFc / (max(0.5, uGrain.y) * 2.3) + uGrain.z) - 0.5) * 0.6;
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        float w = 0.35 + 2.6 * l * (1.0 - l);
        col += g * uGrain.x * 0.11 * w;
      }

      // ---- dust specks ----
      if (uDust.x > 0.001) {
        float cell = 46.0;
        vec2 cid = floor(cssFc / cell);
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 c = cid + vec2(float(i), float(j));
            vec2 r = h2(c + uDust.z * 13.0);
            if (r.x > uDust.x * 0.45) continue;
            vec2 ctr = (c + h2(c * 1.7 + uDust.z)) * cell;
            float rad = 0.5 + h1(c * 3.1) * 1.8;
            float d = length(cssFc - ctr);
            float m = 1.0 - smoothstep(rad * 0.5, rad, d);
            float dark = h1(c * 5.3 + 1.0) > 0.35 ? 1.0 : -1.0;   // mostly dark specks, some light
            col = mix(col, dark > 0.0 ? col * 0.45 : mix(col, vec3(1.0), 0.8), m * 0.85);
          }
        }
      }

      // ---- scratches & hairs ----
      if (uDust.y > 0.001) {
        vec2 res = uRes / uPx;
        for (int k = 0; k < 7; k++) {
          float fk = float(k);
          if (fk >= uDust.y * 7.0) break;
          vec2 a = h2(vec2(fk * 3.7, uDust.z)) * res;
          vec2 dir = normalize(h2(vec2(fk * 9.1, uDust.z + 2.0)) - 0.5 + 1e-4);
          float len = (0.08 + h1(vec2(fk, uDust.z)) * 0.35) * max(res.x, res.y);
          vec2 q = cssFc - a;
          float t = clamp(dot(q, dir), 0.0, len);
          // gently curved hair
          vec2 nrm = vec2(-dir.y, dir.x);
          float bend = sin(t / len * 3.14159) * len * 0.06 * (h1(vec2(fk, 4.0)) - 0.5);
          float d = abs(dot(q - dir * t, nrm) - bend);
          float m = (1.0 - smoothstep(0.15, 0.7, d)) * smoothstep(0.0, 0.1, t / len) * smoothstep(1.0, 0.9, t / len);
          m *= 0.55 + 0.45 * vn(vec2(t * 0.05, fk * 7.0));   // broken, uneven line
          col = mix(col, mix(col, vec3(1.0), 0.5), m * 0.35);
        }
      }

      // ---- vignette ----
      if (uFrame.x > 0.001) {
        vec2 v = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        float vig = smoothstep(0.35, 1.05, length(v));
        col *= 1.0 - vig * uFrame.x * 0.55;
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
    }
  `,
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPx: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: new THREE.Vector4() },
    uPrint: { value: new THREE.Vector4() },
    uMis: { value: new THREE.Vector3() },
    uDust: { value: new THREE.Vector4() },
    uFrame: { value: new THREE.Vector2() },
  },
  depthTest: false,
  depthWrite: false,
  transparent: false,
  blending: THREE.NoBlending,
});
craftScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), craftMat));

function craftPostBegin() {
  if (!craftGet('craftEnabled')) return false;
  renderer.getDrawingBufferSize(craftSize);
  const w = Math.max(1, craftSize.x), h = Math.max(1, craftSize.y);
  if (!craftRT || craftRT.width !== w || craftRT.height !== h) {
    if (craftRT) craftRT.dispose();
    craftRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      samples: 4,
    });
  }
  renderer.setRenderTarget(craftRT);
  return true;
}

function craftPostEnd(time) {
  const u = craftMat.uniforms;
  u.tDiffuse.value = craftRT.texture;
  u.uRes.value.set(craftRT.width, craftRT.height);
  u.uPx.value = renderer.getPixelRatio();
  u.uTime.value = time;

  const fps = Math.max(1, craftNum('craftGrainFps'));
  const grainSeed = craftGet('craftGrainAnimated') ? Math.floor(time * fps) % 997 : 0;
  u.uGrain.value.set(craftNum('craftGrain'), craftNum('craftGrainSize'), grainSeed, 0);

  const st = craftGet('craftPrintStyle');
  const styleCode = st === 'riso' ? 1 : st === 'halftone' ? 2 : 0;
  u.uPrint.value.set(styleCode, craftNum('craftPrintAmount'), craftNum('craftHalftoneSize'), craftNum('craftPosterize'));

  const mis = craftNum('craftMisregister') * renderer.getPixelRatio();
  const ang = THREE.MathUtils.degToRad(craftNum('craftMisregisterAngle'));
  u.uMis.value.set(Math.cos(ang) * mis, Math.sin(ang) * mis, craftNum('craftInkBleed'));

  u.uDust.value.set(craftNum('craftDust'), craftNum('craftScratches'), craftNum('craftSeed') % 97, 0);
  u.uFrame.value.set(craftNum('craftVignette'), craftNum('craftBackdropPaper'));

  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0.0);
  renderer.clear();
  renderer.render(craftScene, orthoCamera);
}

animate();
