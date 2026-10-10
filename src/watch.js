/*
 * The dive computer in the "Lo que llevo buceado" panel: an Apple Watch Ultra 2 in black titanium
 * turning slowly inside its orange ring. It has its own small renderer and only draws while the
 * panel is on screen.
 *
 * Model: "Apple Watch Ultra Made In Blender (PolygonMBW)" by PolygonMBW, CC BY 4.0,
 * recoloured and simplified with scripts/convert-watch.mjs.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const URL_MODEL = `${import.meta.env.BASE_URL}models/apple-watch-ultra.glb`;
const TURN = Math.PI * 2 / 16; // one full turn every 16 s

export async function mountWatch(canvas, { reduce = false } = {}){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

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
  const pivot = new THREE.Group(); pivot.add(model); scene.add(pivot);
  pivot.rotation.x = .12; // a touch forward so the face catches the light
  // fit the turn inside the ring: half the height, or the widest the case and band get as they spin
  const size = box.getSize(new THREE.Vector3()), spin = Math.hypot(size.x, size.z) / 2;
  const fit = Math.max(size.y / 2, spin) * 1.14;
  camera.position.set(0, 0, fit / Math.tan(THREE.MathUtils.degToRad(12)));
  camera.lookAt(0, 0, 0);

  let visible = false, raf = 0, last = 0, angle = reduce ? -.55 : -.5;
  const draw = () => { pivot.rotation.y = angle; renderer.render(scene, camera); };
  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    draw();
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  function loop(t){
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = last ? Math.min(.05, (t - last) / 1000) : 0; last = t;
    angle += dt * TURN;
    draw();
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf && !reduce){ last = 0; raf = requestAnimationFrame(loop); } };
  // with reduced motion it stays still, three-quarters on
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { rootMargin: '80px' }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) start(); });
  canvas.classList.add('ready');
}
