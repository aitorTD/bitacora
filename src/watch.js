/*
 * The dive computer in the "Lo que llevo buceado" panel: an Apple Watch Ultra 2 in black titanium
 * turning slowly inside its orange ring. Hovering it with the mouse slows the turn and tilts the
 * watch a little towards the pointer; leaving eases it back. It has its own small renderer and only
 * draws while the panel is on screen.
 *
 * Model: "Apple Watch Ultra Made In Blender (PolygonMBW)" by PolygonMBW, CC BY 4.0,
 * recoloured and simplified with scripts/convert-watch.mjs.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const URL_MODEL = `${import.meta.env.BASE_URL}models/apple-watch-ultra.glb`;
const TURN = Math.PI * 2 / 28; // one full turn every 28 s

export async function mountWatch(canvas, { reduce = false } = {}){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  renderer.debug.checkShaderErrors = import.meta.env.DEV;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  pmrem.dispose();
  // a warm key light from the orange glow behind, a cool rim from above
  const key = new THREE.DirectionalLight(0xffc48a, 1.6); key.position.set(-2, 1, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe6ff, 1.2); rim.position.set(2, 3, -2); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(24, 1, .1, 50);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL_MODEL);
  const model = gltf.scene;
  // the watch face is emissive at 3× in the source; tone it down so the dial stays readable
  model.traverse(o => { if (o.isMesh && o.material.emissiveMap) o.material.emissiveIntensity = 1.4; });
  const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  // tilt (screen-space, follows the mouse) holds spin (the slow turn) holds the model
  const spin = new THREE.Group(); spin.add(model);
  const tilt = new THREE.Group(); tilt.add(spin); scene.add(tilt);
  const BASE_PITCH = .12; // a touch forward so the face catches the light
  // fit the turn inside the ring: half the height, or the widest the case and band get as they spin
  const size = box.getSize(new THREE.Vector3()), reach = Math.hypot(size.x, size.z) / 2;
  const fit = Math.max(size.y / 2, reach) * 1.18;
  camera.position.set(0, 0, fit / Math.tan(THREE.MathUtils.degToRad(12)));
  camera.lookAt(0, 0, 0);

  let visible = false, raf = 0, last = 0, angle = reduce ? -.55 : -.5;
  // eased state: spin speed (1 = normal turn), tilt towards the pointer, and their targets
  const cur = { speed: reduce ? 0 : 1, yaw: 0, pitch: 0 }, goal = { ...cur };
  const draw = () => {
    spin.rotation.y = angle;
    tilt.rotation.set(BASE_PITCH + cur.pitch, cur.yaw, 0);
    renderer.render(scene, camera);
  };
  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    draw();
  }
  // shaders compiled off the main thread where possible before the first frame
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {});
  resize();
  new ResizeObserver(resize).observe(canvas);

  const settled = () => Math.abs(cur.yaw - goal.yaw) + Math.abs(cur.pitch - goal.pitch) + Math.abs(cur.speed - goal.speed) < .002;
  let lastDraw = 0;
  function loop(t){
    raf = 0;
    if (!visible || document.hidden) return;
    // the slow turn needs no more than 30 frames a second; a hover runs at full rate
    if (settled() && t - lastDraw < 32){ raf = requestAnimationFrame(loop); return; }
    lastDraw = t;
    const dt = last ? Math.min(.05, (t - last) / 1000) : 0; last = t;
    const k = 1 - Math.exp(-dt * 3); // frame-rate independent easing
    for (const key in cur) cur[key] += (goal[key] - cur[key]) * k;
    angle += dt * TURN * cur.speed;
    draw();
    // keep going while it turns, or until a hover tilt has eased out
    if (cur.speed > .001 || !settled()) raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf){ last = 0; raf = requestAnimationFrame(loop); } };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { rootMargin: '80px' }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) start(); });

  // hover with a mouse: the turn slows almost to a stop and the watch leans towards the pointer
  const stage = canvas.parentElement;
  stage.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = stage.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1));
    const ny = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1));
    Object.assign(goal, { speed: reduce ? 0 : .12, yaw: nx * .38, pitch: ny * .26 });
    start();
  });
  stage.addEventListener('pointerleave', () => { Object.assign(goal, { speed: reduce ? 0 : 1, yaw: 0, pitch: 0 }); start(); });
  canvas.classList.add('ready');
}
