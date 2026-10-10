import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function initScene(dive){
  const canvas = document.getElementById('scene');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'}); }
  catch (e) { return; }

  const small = innerWidth < 720;
  const lowPower = small || (navigator.hardwareConcurrency || 8) <= 4;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const fogCol = new THREE.Color('#3ab0c0');
  scene.background = fogCol;
  scene.fog = new THREE.FogExp2(fogCol.clone(), 0.034);

  const camera = new THREE.PerspectiveCamera(small ? 62 : 52, innerWidth / innerHeight, .15, 2400);
  const SURF = 1.6; // water level in world units

  // seeded random so the world is the same on every visit
  let seed = 1337;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rr = (a, b) => a + (b - a) * rand();
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mix = (a, b, n) => a + (b - a) * n;
  const smoothstep = smooth;

  // value noise for the landscape
  const hash2 = (x, y) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
  function vnoise(x, y){
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  function fbm(x, y, o = 4){ let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++){ s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); f *= 2.03; a *= .5; } return s; }
  const n3 = (x, y, z) => (fbm(x, y, 3) + fbm(y + 31, z, 3) + fbm(z - 17, x, 3)) / 3;

  /* ---------- Shared GLSL ---------- */
  const NOISE = `
    float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
    float hash13(vec3 p){ p = fract(p*.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash12(i), hash12(i+vec2(1.,0.)), f.x), mix(hash12(i+vec2(0.,1.)), hash12(i+vec2(1.,1.)), f.x), f.y); }
    float fbm2(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.03+vec2(17.1,9.3); a *= .5; } return s; }
    float cau(vec2 p, float t){ float c = 0.; for(int i=0;i<3;i++){ p += vec2(sin(p.y*1.3+t*.6), cos(p.x*1.1-t*.5)); c += .5/(.45+abs(sin(p.x)+cos(p.y))); } return c/3.; }
  `;
  const SKY = `
    uniform vec3 uLight; uniform float uNight; uniform float uTime;
    vec3 skyBase(vec3 d){
      float h = max(d.y, 0.);
      float t = pow(h, .42);
      vec3 day = mix(vec3(.42,.67,.86), vec3(.03,.2,.55), t);
      vec3 nig = mix(vec3(.03,.055,.11), vec3(.003,.008,.026), t);
      float a = max(dot(d, uLight), 0.);
      day += vec3(1.,.82,.55)*pow(a,8.)*.12 + vec3(1.,.93,.8)*pow(a,64.)*.45;
      nig += vec3(.2,.28,.46)*pow(a,9.)*.5 + vec3(.5,.55,.7)*pow(a,90.)*.45;
      vec2 cp = d.xz/(d.y+.12)*1.6 + vec2(uTime*.004, 0.);
      float cl = smoothstep(.56,.84, fbm2(cp)) * smoothstep(.0,.22,d.y);
      day = mix(day, vec3(.93,.95,.97)*(.85+.25*pow(a,4.)), cl*.6);
      nig = mix(nig, vec3(.07,.09,.14)+vec3(.24,.27,.36)*pow(a,6.), cl*.55);
      return mix(day, nig, uNight);
    }
    vec3 skyFull(vec3 d){
      vec3 col = skyBase(d);
      float a = dot(d, uLight);
      float sun = smoothstep(.99952,.99972,a);
      float moon = smoothstep(.99962,.99976,a);
      vec3 t1 = normalize(cross(uLight, vec3(0.,1.,0.))); vec3 t2 = cross(t1, uLight);
      vec2 mp = vec2(dot(d,t1), dot(d,t2))/.0218;
      float mar = .8 + .2*smoothstep(.35,.7, vn(mp*2.2+3.1)) - .2*smoothstep(.45,.78, vn(mp*3.7+11.));
      col += mix(vec3(9.,8.2,6.6)*sun, vec3(2.7,2.8,3.)*moon*mar, uNight);
      vec3 sd = d*220.; vec3 cell = floor(sd); float r = hash13(cell);
      float st = step(.9965, r) * smoothstep(.45, .0, length(fract(sd)-.5));
      st *= (.55+.45*sin(uTime*2.+r*80.)) * smoothstep(.04,.3,d.y) * (1.-smoothstep(.985,.9995,a));
      col += vec3(1.6,1.7,2.)*st*uNight;
      return col;
    }
  `;
  const WAVES = `
    float wav(vec2 p){ return .14*sin(p.x*.32+uTime*1.05) + .09*sin(p.y*.47-uTime*.85+p.x*.18) + .045*sin((p.x+p.y)*1.25+uTime*1.6) + .022*sin(p.x*2.9-p.y*2.2+uTime*2.2); }
  `;

  /* ---------- Sky dome ---------- */
  const lightDir = new THREE.Vector3(), lightDirW = new THREE.Vector3();
  const sunDir = new THREE.Vector3(small ? -.03 : .12, small ? .45 : .34, small ? -.89 : -.93).normalize();
  const moonDir = new THREE.Vector3(small ? -.04 : -.05, small ? .5 : .42, small ? -.86 : -.9).normalize();
  const skyMat = new THREE.ShaderMaterial({
    uniforms:{uLight:{value:lightDir}, uNight:{value:0}, uTime:{value:0}},
    vertexShader:`varying vec3 vDir; void main(){ vDir = position; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_Position.z = gl_Position.w; }`,
    fragmentShader:NOISE + SKY + `varying vec3 vDir; void main(){ gl_FragColor = vec4(skyFull(normalize(vDir)), 1.); }`,
    side:THREE.BackSide, depthWrite:false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  /* ---------- Sea surface (seen from above and from below) ---------- */
  const surfMat = new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0}, uFade:{value:1}, uFog:{value:new THREE.Color()}, uNight:{value:0}, uLight:{value:lightDir}, uLightW:{value:lightDirW}},
    vertexShader:`uniform float uTime; varying vec3 vW;` + WAVES + `
      void main(){ vec4 w = modelMatrix*vec4(position,1.); w.y += wav(w.xz); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader:NOISE + SKY + WAVES + `
      uniform float uFade; uniform vec3 uFog; uniform vec3 uLightW; varying vec3 vW;
      void main(){
        vec2 p = vW.xz; float e = .08;
        float hx = wav(p+vec2(e,0.))-wav(p-vec2(e,0.)); float hz = wav(p+vec2(0.,e))-wav(p-vec2(0.,e));
        vec2 q = p*1.7 + uTime*vec2(.3,.2);
        float r0 = vn(q); float r1 = r0-vn(q+vec2(.13,0.)); float r2 = r0-vn(q+vec2(0.,.13));
        vec3 n = normalize(vec3(-hx/(2.*e) + r1*.8, 1., -hz/(2.*e) + r2*.8));
        vec3 vd = normalize(vW - cameraPosition);
        float dist = length(vW.xz - cameraPosition.xz);
        vec3 col;
        if (cameraPosition.y > vW.y){
          vec3 rf = reflect(vd, n); rf.y = abs(rf.y);
          float fres = .02 + .98*pow(1.-max(dot(-vd, n), 0.), 5.);
          vec3 deep = mix(vec3(.0,.09,.16), vec3(.002,.008,.02), uNight);
          float crest = smoothstep(.0,.25, wav(p)+.1);
          deep += mix(vec3(.02,.12,.12), vec3(.0,.01,.02), uNight)*crest;
          col = mix(deep, skyBase(rf)*mix(.7,.85,uNight), fres);
          float rl = max(dot(rf, uLight), 0.);
          col += mix(vec3(14.,11.,8.), vec3(4.,4.3,4.8), uNight) * pow(rl, mix(700.,1100.,uNight));
          col += mix(vec3(.9,.8,.6), vec3(.22,.26,.36), uNight) * pow(rl, 40.) * .55;
          col = mix(skyBase(normalize(vec3(vd.x, .001, vd.z))), col, exp(-dist*.0028));
        } else {
          float c = smoothstep(.55, 1.5, cau(p*.32, uTime));
          float win = smoothstep(.6, .72, vd.y + n.x*.06);
          vec3 inside = mix(mix(vec3(.3,.82,.88), vec3(1.25,1.65,1.65), c), mix(vec3(.02,.05,.1), vec3(.14,.2,.3), c), uNight);
          vec3 outside = uFog*1.2 + inside*.06;
          col = mix(outside, inside, win);
          vec3 vr = normalize(vd + vec3(n.x,0.,n.z)*.25);
          float a = max(dot(vr, uLightW), 0.);
          col += (mix(vec3(6.,5.5,4.4), vec3(2.,2.2,2.5), uNight)*smoothstep(.9975,.999,a) + mix(vec3(1.2,1.2,1.), vec3(.2,.26,.38), uNight)*pow(a,80.))*win;
          col *= uFade;
          col = mix(uFog, col, exp(-dist*.035));
        }
        gl_FragColor = vec4(col, 1.);
      }`,
    side:THREE.DoubleSide
  });
  const surfGeo = new THREE.PlaneGeometry(1200, 1200, lowPower ? 160 : 240, lowPower ? 160 : 240); surfGeo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(surfGeo, surfMat); surface.position.y = SURF; surface.frustumCulled = false; scene.add(surface);

  /* ---------- Lights ---------- */
  const hemi = new THREE.HemisphereLight(0xc8f4ff, 0x0b2a3a, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xd8f8ff, 2.4);
  scene.add(sun); scene.add(sun.target);
  const fill = new THREE.PointLight(0x7fb8cc, 1.2, 14, 1.2);
  scene.add(fill);

  /* ---------- Caustics on shallow rock (day only) ---------- */
  const causU = {uTime:{value:0}, uCaus:{value:1}};
  function addCaustics(mat){
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = causU.uTime; sh.uniforms.uCaus = causU.uCaus;
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cw = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          cw = instanceMatrix*cw;
        #endif
        vWPos = (modelMatrix*cw).xyz;`);
      sh.fragmentShader = 'uniform float uTime; uniform float uCaus; varying vec3 vWPos;\n' + NOISE + sh.fragmentShader.replace('#include <opaque_fragment>', `
        float cUp = max(dot(normal, normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz)), 0.);
        outgoingLight += diffuseColor.rgb*vec3(.55,.95,1.)*pow(cau(vWPos.xz*.55, uTime), 2.2)*uCaus*exp(vWPos.y/6.)*cUp*1.4;
        #include <opaque_fragment>`);
    };
  }

  /* ---------- Diver ---------- */
  const suit = new THREE.MeshStandardMaterial({color:'#1e262a', roughness:.5, metalness:.08});
  const bcd = new THREE.MeshStandardMaterial({color:'#262d31', roughness:.7, metalness:.05});
  const amberMat = new THREE.MeshStandardMaterial({color:'#e59a1c', roughness:.45, metalness:.2});
  const tankMat = new THREE.MeshStandardMaterial({color:'#c8cfd2', roughness:.3, metalness:.75});
  const glass = new THREE.MeshStandardMaterial({color:'#0e1c22', roughness:.08, metalness:.9});
  const finMat = new THREE.MeshStandardMaterial({color:'#123f4a', roughness:.45, metalness:.1, side:THREE.DoubleSide});

  const diver = new THREE.Group();
  const lieZ = g => { g.rotateX(Math.PI / 2); return g; };
  diver.add(new THREE.Mesh(lieZ(new THREE.CapsuleGeometry(.21, .72, 6, 14)), suit));
  const jacket = new THREE.Mesh(lieZ(new THREE.CapsuleGeometry(.235, .36, 6, 14)), bcd); jacket.position.set(0, .01, -.16); diver.add(jacket);
  const stripe = new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.24, .24, .05, 18)), amberMat); stripe.position.set(0, 0, .1); diver.add(stripe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.15, 18, 14), suit); head.position.set(0, .05, -.66); diver.add(head);
  const mask = new THREE.Mesh(new THREE.BoxGeometry(.21, .1, .07), glass); mask.position.set(0, .01, -.79); mask.rotation.x = .35; diver.add(mask);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(.152, .012, 6, 24), suit); strap.position.set(0, .04, -.67); strap.rotation.y = Math.PI / 2; diver.add(strap);
  const reg = new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.035, .04, .06, 10)), amberMat); reg.position.set(0, -.09, -.78); diver.add(reg);
  const tank = new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.11, .11, .72, 18)), tankMat); tank.position.set(0, .29, .04); diver.add(tank);
  const tankTop = new THREE.Mesh(new THREE.SphereGeometry(.11, 14, 10), tankMat); tankTop.position.set(0, .29, -.32); diver.add(tankTop);
  const valve = new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.03, .03, .1, 8)), suit); valve.position.set(0, .29, -.45); diver.add(valve);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(.2, .012, 6, 20, Math.PI * .9), suit); hose.position.set(.05, .1, -.6); hose.rotation.set(0, Math.PI / 2, -.6); diver.add(hose);

  function limb(len, r){ const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.rotateX(Math.PI / 2); g.translate(0, 0, -(len / 2 + r)); return g; }
  const armR = new THREE.Group(); armR.position.set(.24, -.02, -.36); diver.add(armR);
  armR.add(new THREE.Mesh(limb(.5, .06), suit));
  armR.rotation.set(-.18, -.22, 0);
  const torch = new THREE.Group(); torch.position.set(0, 0, -.68); armR.add(torch);
  torch.add(new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.045, .04, .24, 12)), suit));
  const lensMat = new THREE.MeshStandardMaterial({color:'#2a2a24', emissive:'#ffe9c4', emissiveIntensity:0, roughness:.2});
  const lens = new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.05, .05, .02, 14)), lensMat); lens.position.z = -.13; torch.add(lens);
  const ring = new THREE.Mesh(lieZ(new THREE.CylinderGeometry(.052, .052, .03, 14)), amberMat); ring.position.z = -.1; torch.add(ring);
  const armL = new THREE.Group(); armL.position.set(-.24, -.04, -.34); diver.add(armL);
  armL.add(new THREE.Mesh(limb(.48, .06), suit));
  armL.rotation.set(.5, Math.PI * .92, .1);
  function leg(x){
    const g = new THREE.Group(); g.position.set(x, -.02, .42);
    const l = new THREE.Mesh(limb(.7, .075), suit); l.rotation.y = Math.PI; g.add(l);
    const finPivot = new THREE.Group(); finPivot.position.z = .9; g.add(finPivot);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([-.075,0,0, .075,0,0, .12,0,.42, -.12,0,.42], 3));
    fg.setIndex([0,1,2, 0,2,3]); fg.computeVertexNormals();
    finPivot.add(new THREE.Mesh(fg, finMat));
    diver.add(g);
    return {g, finPivot};
  }
  const legL = leg(-.11), legR = leg(.11);
  scene.add(diver);

  // torch light + visible beam
  const spot = new THREE.SpotLight(0xffeccc, 0, 34, .4, .45, 1.05);
  torch.add(spot);
  const spotTarget = new THREE.Object3D(); spotTarget.position.set(0, 0, -6); torch.add(spotTarget);
  spot.target = spotTarget;
  const beamLen = 8;
  const beamGeo = new THREE.ConeGeometry(1.7, beamLen, 64, 1, true); beamGeo.rotateX(Math.PI / 2); beamGeo.translate(0, 0, -beamLen / 2);
  const beamMat = new THREE.ShaderMaterial({
    uniforms:{uOpacity:{value:0}, uLen:{value:beamLen}},
    vertexShader:`varying float vD; varying vec3 vN; varying vec3 vV; uniform float uLen;
      void main(){ vD = -position.z/uLen; vec4 mv = modelViewMatrix*vec4(position,1.); vV = -mv.xyz; vN = normalMatrix*normal; gl_Position = projectionMatrix*mv; }`,
    fragmentShader:`varying float vD; varying vec3 vN; varying vec3 vV; uniform float uOpacity;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float a = pow(f,1.5)*pow(1.-smoothstep(.0,1.,vD),1.25)*smoothstep(0.,.05,vD); gl_FragColor = vec4(vec3(1.,.93,.8), a*uOpacity*.24); }`,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide
  });
  const beam = new THREE.Mesh(beamGeo, beamMat); beam.rotation.x = 0; beam.position.z = -.13; torch.add(beam);
  // inner hot core of the beam
  const coreGeo = new THREE.ConeGeometry(.55, beamLen * .7, 48, 1, true); coreGeo.rotateX(Math.PI / 2); coreGeo.translate(0, 0, -beamLen * .35);
  const coreMat = beamMat.clone(); coreMat.uniforms = THREE.UniformsUtils.clone(beamMat.uniforms); coreMat.uniforms.uLen.value = beamLen * .7;
  const beamCore = new THREE.Mesh(coreGeo, coreMat); beamCore.position.z = -.13; torch.add(beamCore);
  const glareMat = new THREE.SpriteMaterial({color:0xfff0d6, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending,
    map:(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.25,'rgba(255,240,210,.55)'); gr.addColorStop(1,'rgba(255,230,190,0)'); g.fillStyle = gr; g.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); })()});
  const glare = new THREE.Sprite(glareMat); glare.scale.setScalar(.42); glare.position.z = -.15; torch.add(glare);

  /* ---------- Bubbles ---------- */
  const BUB = 70;
  const bubMat = new THREE.MeshStandardMaterial({color:'#dff6ff', roughness:.05, metalness:0, transparent:true, opacity:.55, emissive:'#8fd6ee', emissiveIntensity:.25});
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), bubMat, BUB);
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bubbles.frustumCulled = false;
  const bub = Array.from({length:BUB}, () => ({alive:false, p:new THREE.Vector3(), s:0, life:0, ph:rand() * 6}));
  scene.add(bubbles);
  const regWorld = new THREE.Vector3();
  let bubTimer = 0, bubIdx = 0;
  const dummy = new THREE.Object3D();

  /* ---------- Fish ---------- */
  function fishGeometry(fat){
    const body = new THREE.SphereGeometry(1, 14, 10); body.scale(1, .36 * fat, .15 * fat);
    const sh = new THREE.Shape(); sh.moveTo(-.85, 0); sh.lineTo(-1.6, .42); sh.quadraticCurveTo(-1.4, 0, -1.6, -.42); sh.lineTo(-.85, 0);
    const dor = new THREE.Shape(); dor.moveTo(-.4, .3 * fat); dor.lineTo(.15, .3 * fat); dor.lineTo(-.25, .58 * fat); dor.lineTo(-.4, .3 * fat);
    const g = mergeGeometries([body.toNonIndexed(), new THREE.ShapeGeometry(sh).toNonIndexed(), new THREE.ShapeGeometry(dor).toNonIndexed()]);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }
  const fishGeo = fishGeometry(1), fatFishGeo = fishGeometry(1.35);
  const schools = [];
  function makeSchool(o){
    const mat = new THREE.MeshStandardMaterial({color:'#ffffff', roughness:.35, metalness:.45, side:THREE.DoubleSide});
    const mesh = new THREE.InstancedMesh(o.geo || fishGeo, mat, o.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new THREE.Color(o.color), c = new THREE.Color();
    const fish = [];
    for (let i = 0; i < o.count; i++){
      const u = rand() * Math.PI * 2, v = Math.acos(2 * rand() - 1), r = Math.cbrt(rand());
      fish.push({ox:Math.sin(v) * Math.cos(u) * r * o.rx, oy:Math.cos(v) * r * o.ry, oz:Math.sin(v) * Math.sin(u) * r * o.rz, ph:rand() * 6.28, sc:o.size * rr(.8, 1.2)});
      c.copy(base).offsetHSL(rr(-.02, .02), rr(-.08, .05), rr(-.08, .08)); mesh.setColorAt(i, c);
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
    schools.push({...o, mesh, fish});
  }
  const sc = lowPower ? .55 : 1;
  makeSchool({count:Math.round(150 * sc), color:'#b9d6e2', size:.085, y:-5.5, x:-1, z:-7, ax:5, ay:1.4, az:3, rx:2.8, ry:1, rz:2, w:.16, ph:0});
  makeSchool({count:Math.round(70 * sc), color:'#d9c98a', size:.11, y:-12, x:1.5, z:-9, ax:4.5, ay:1.2, az:2.5, rx:2.4, ry:.9, rz:1.8, w:.12, ph:2});
  makeSchool({count:Math.round(46 * sc), color:'#8fa4b0', size:.16, y:-20.5, x:-1.5, z:-10, ax:4.5, ay:1, az:3, rx:3.2, ry:.7, rz:1.4, w:.08, ph:4, slim:true});
  const hv = new THREE.Vector3();
  function updateSchool(s, t){
    const tt = t * s.w + s.ph;
    const cx = s.x + Math.sin(tt) * s.ax, cy = s.y + Math.sin(tt * .7) * s.ay, cz = s.z + Math.sin(tt * 2) * s.az * .5;
    const t2 = tt + .02;
    hv.set(s.x + Math.sin(t2) * s.ax - cx, s.y + Math.sin(t2 * .7) * s.ay - cy, s.z + Math.sin(t2 * 2) * s.az * .5 - cz).normalize();
    for (let i = 0; i < s.fish.length; i++){
      const f = s.fish[i];
      const wob = t * .9 + f.ph;
      dummy.position.set(cx + f.ox + Math.sin(wob) * .25, cy + f.oy + Math.sin(wob * 1.4) * .12, cz + f.oz + Math.cos(wob) * .25);
      dummy.lookAt(dummy.position.x + hv.x + Math.cos(wob) * .12, dummy.position.y + hv.y * .5, dummy.position.z + hv.z - Math.sin(wob) * .12);
      dummy.rotateY(Math.sin(t * 9 + f.ph) * .14);
      const k = s.slim ? .7 : 1;
      dummy.scale.set(f.sc * k, f.sc * k, f.sc * (s.slim ? 1.5 : 1));
      dummy.updateMatrix();
      s.mesh.setMatrixAt(i, dummy.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }
  const grouperMat = new THREE.MeshStandardMaterial({color:'#6b5238', roughness:.6, metalness:.15, side:THREE.DoubleSide});
  const groupers = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(fatFishGeo, grouperMat); m.scale.setScalar(rr(.32, .42)); scene.add(m);
    return {m, cx:rr(-4, 4), cy:rr(-19, -27), cz:rr(-6, -12), r:rr(2, 3.5), w:rr(.06, .1), ph:rand() * 6};
  });

  // eagle ray
  const rayMat = new THREE.MeshStandardMaterial({color:'#2d3b45', roughness:.55, metalness:.15, side:THREE.DoubleSide});
  const ray = new THREE.Group();
  const rayBody = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), rayMat); rayBody.scale.set(.42, .12, .75); ray.add(rayBody);
  function wing(side){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,.55, 0,0,-.45, side*1.7,0,-.15, 0,0,.55, side*1.7,0,-.15, side*.9,0,.2], 3));
    g.computeVertexNormals();
    const p = new THREE.Group(); p.position.x = side * .3; p.add(new THREE.Mesh(g, rayMat)); ray.add(p); return p;
  }
  const wingL = wing(-1), wingR = wing(1);
  const rayTail = new THREE.Mesh(new THREE.CylinderGeometry(.015, .005, 2.2, 6), rayMat); rayTail.rotation.x = Math.PI / 2; rayTail.position.z = -1.6; ray.add(rayTail);
  ray.scale.setScalar(1.2);
  scene.add(ray);

  /* ---------- Soft glow sprites (bioluminescent halos and neon haze) ---------- */
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  function glowMaterial(color, strength){
    return new THREE.ShaderMaterial({
      uniforms:{uColor:{value:new THREE.Color(color)}, uOpacity:{value:0}, uStrength:{value:strength}},
      vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader:`varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uStrength;
        void main(){ vec2 c = vUv-.5; float r2 = dot(c,c)*4.; float a = exp(-r2*3.2)*(1.-smoothstep(.75,1.,r2)); gl_FragColor = vec4(uColor*uStrength, a*uOpacity); }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    });
  }
  const billboards = [];

  // neon haze drifting in the deep water
  const hazeCols = ['#25d9f0', '#9b4dff', '#3a6bff', '#e04bd6', '#2fe0c0'];
  const haze = [];
  for (let i = 0; i < (lowPower ? 7 : 11); i++){
    const m = new THREE.Mesh(glowGeo, glowMaterial(hazeCols[i % hazeCols.length], 1));
    const s = rr(9, 16); m.scale.set(s, s, 1);
    m.position.set(rr(-7, 6), rr(-16, -43), rr(-5, -20));
    m.renderOrder = 2; scene.add(m); billboards.push(m);
    haze.push({m, base:m.position.clone(), ph:rand() * 6, k:rr(.6, 1)});
  }

  // jellyfish
  const jellies = [];
  const jellyCols = ['#7b5cff', '#3fe0e8', '#c46bff', '#46a9ff'];
  for (let i = 0; i < (lowPower ? 9 : 15); i++){
    const col = new THREE.Color(jellyCols[i % jellyCols.length]);
    const g = new THREE.Group();
    const bellMat = new THREE.MeshStandardMaterial({color:col.clone().multiplyScalar(.25), emissive:col, emissiveIntensity:.65, transparent:true, opacity:.5, roughness:.3, side:THREE.DoubleSide, depthWrite:false});
    const bell = new THREE.Mesh(new THREE.SphereGeometry(.45, 22, 12, 0, Math.PI * 2, 0, Math.PI * .55), bellMat); g.add(bell);
    const core = new THREE.Mesh(new THREE.SphereGeometry(.14, 12, 8), new THREE.MeshBasicMaterial({color:col.clone().multiplyScalar(1.1), transparent:true, opacity:.6})); core.position.y = .08; g.add(core);
    const tents = [];
    const tentMat = new THREE.LineBasicMaterial({color:col.clone().multiplyScalar(1.1), transparent:true, opacity:.35});
    for (let k = 0; k < 8; k++){
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
      const line = new THREE.Line(geo, tentMat); line.frustumCulled = false; g.add(line);
      tents.push({line, a:k / 8 * Math.PI * 2, len:rr(1.2, 2.2)});
    }
    const s = rr(.55, 1.15); g.scale.setScalar(s);
    g.position.set(rr(-6.5, 5.5), rr(-24, -41), rr(-2.5, -15));
    scene.add(g);
    const halo = new THREE.Mesh(glowGeo, glowMaterial(col, 1.1)); halo.scale.set(3 * s, 3 * s, 1); halo.renderOrder = 3; scene.add(halo); billboards.push(halo);
    jellies.push({g, bell, tents, halo, col, ph:rand() * 6, base:g.position.y, sx:g.position.x});
  }
  // a few jellies cast coloured light on the reef
  const jellyLights = [0, 5, 10].filter(i => jellies[i]).map(i => {
    const l = new THREE.PointLight(jellies[i].col, 0, 10, 1.4); scene.add(l); return {l, j:jellies[i]};
  });

  /* ---------- Plankton & marine snow ---------- */
  function particles(n, color, color2, size, area){
    const pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++){ pos[i*3] = rr(-area.x, area.x); pos[i*3+1] = rr(area.y0, area.y1); pos[i*3+2] = rr(area.z0, area.z1); ph[i] = rand() * 6.28; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms:{uTime:{value:0}, uSize:{value:size}, uPR:{value:renderer.getPixelRatio()}, uColor:{value:new THREE.Color(...color)}, uColor2:{value:new THREE.Color(...color2)}, uOpacity:{value:1}, uTw:{value:1}, uSoft:{value:1}},
      vertexShader:`attribute float aPhase; uniform float uTime; uniform float uSize; uniform float uPR; uniform float uTw; varying float vTw; varying float vPick;
        void main(){ vec3 p = position; p.x += sin(uTime*.2+aPhase)*.3; p.y += sin(uTime*.15+aPhase*1.3)*.4; vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          vTw = mix(1., .5+.5*pow(.5+.5*sin(uTime*.9+aPhase*3.),2.), uTw); vPick = step(.78, fract(aPhase*3.17)); gl_PointSize = uSize*uPR*(10./max(.5,-mv.z)); }`,
      fragmentShader:`uniform vec3 uColor; uniform vec3 uColor2; uniform float uOpacity; uniform float uSoft; varying float vTw; varying float vPick;
        void main(){ float d = length(gl_PointCoord-.5)*2.; float a = mix(smoothstep(1.,0.,d), exp(-d*d*3.5)*(1.-d*d), uSoft); gl_FragColor = vec4(mix(uColor, uColor2, vPick)*vTw, max(a,0.)*uOpacity*vTw); }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts); return mat;
  }
  const snow = particles(lowPower ? 700 : 1400, [.75, .9, .95], [.75, .9, .95], 1.6, {x:13, y0:1, y1:-46, z0:3, z1:-20});
  snow.uniforms.uTw.value = 0; snow.uniforms.uSoft.value = 0;
  const glow = particles(lowPower ? 650 : 1300, [.35, 1.15, 1.05], [.95, .45, 1.25], 5.5, {x:9, y0:-2, y1:-46, z0:3, z1:-18});

  /* ---------- Reef walls ---------- */
  const wallTop = z => -4.4 - 2.4 * (fbm(z * .045, 3.1) * .5 + .5);
  function wallX(side, y, z){
    let x = 10.4 + 2.6 * fbm(z * .075 + side * 40, y * .085) + 1.0 * fbm(z * .28, y * .26 + side * 7) + .32 * fbm(z * 1.05, y * 1.1, 3);
    const ledge = Math.pow(Math.max(0, Math.sin(y * .45 + fbm(z * .06, side * 5) * 2.5)), 8) * (1.2 + .6 * fbm(z * .2, y * .1));
    return side * (x - ledge);
  }
  const C = (h) => new THREE.Color(h);
  const rockA = C('#66726b'), rockB = C('#3c4642'), coral = C('#b0737d'), sponge = C('#d2832f'), algae = C('#5f7d43'), tmpC = new THREE.Color();
  function wallGeometry(side){
    const segZ = lowPower ? 110 : 160, segY = lowPower ? 90 : 130, Z0 = 16, Z1 = -66, YB = -50;
    const g = new THREE.PlaneGeometry(1, 1, segZ, segY);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let iy = 0; iy <= segY; iy++){
      for (let ix = 0; ix <= segZ; ix++){
        const i = iy * (segZ + 1) + ix, u = ix / segZ, v = iy / segY;
        const z = Z0 + (Z1 - Z0) * u, top = wallTop(z);
        let y, x;
        if (v < .06){ // rounded crest that turns into a plateau away from the gap
          const t = v / .06;
          y = top + .9 * Math.cos(t * Math.PI / 2) + .25 * fbm(z * .4, 9.1) * (1 - t);
          x = wallX(side, top, z) + side * (1 - t) * (1 - t) * 7;
        } else {
          y = top + (YB - top) * ((v - .06) / .94);
          x = wallX(side, y, z);
        }
        pos.setXYZ(i, x, y, z);
        const crev = smoothstep(.05, .45, fbm(z * .9, y * .9, 3));
        tmpC.copy(rockA).lerp(rockB, crev * .8);
        tmpC.lerp(algae, smoothstep(-13, -5, y) * smoothstep(.05, .35, fbm(z * .35, y * .35)) * .5);
        tmpC.lerp(coral, smoothstep(-26, -14, y) * smoothstep(.25, .5, fbm(z * .42 + 3, y * .42)) * .45);
        tmpC.lerp(sponge, smoothstep(-18, -28, y) * smoothstep(.45, .62, fbm(z * .95 + 5, y * .95)) * .6);
        col[i*3] = tmpC.r; col[i*3+1] = tmpC.g; col[i*3+2] = tmpC.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const wallMat = new THREE.MeshStandardMaterial({color:'#ffffff', vertexColors:true, roughness:.95, metalness:0, side:THREE.DoubleSide, flatShading:true});
  addCaustics(wallMat);
  [-1, 1].forEach(side => scene.add(new THREE.Mesh(wallGeometry(side), wallMat)));

  /* ---------- Sand floor ---------- */
  const floorY = (x, z) => -44 + 1.3 * fbm(x * .06, z * .06) + .3 * fbm(x * .35 + 4, z * .35, 3)
    + .07 * Math.sin(x * .45 + z * 2.1 + 1.6 * fbm(x * .1, z * .1, 2)) + 9 * smoothstep(7, 15, Math.abs(x));
  {
    const segX = lowPower ? 100 : 150, segZ = lowPower ? 230 : 330;
    const g = new THREE.PlaneGeometry(36, 84, segX, segZ); g.rotateX(-Math.PI / 2); g.translate(0, 0, -26);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const sand = C('#cdb78f'), sandD = C('#a8936f'), gravel = C('#7c725f'), sandL = C('#dccaa3');
    for (let i = 0; i < pos.count; i++){
      const x = pos.getX(i), z = pos.getZ(i), y = floorY(x, z);
      pos.setY(i, y);
      const rip = .5 + .5 * Math.sin(x * .45 + z * 2.1 + 1.6 * fbm(x * .1, z * .1, 2));
      tmpC.copy(sand).lerp(sandL, smoothstep(.2, .6, fbm(x * .15, z * .15)) * .6).lerp(sandD, (1 - rip) * .35);
      tmpC.lerp(gravel, smoothstep(.35, .6, fbm(x * .3 + 8, z * .3)) * .7);
      tmpC.lerp(rockB, smoothstep(8, 12, Math.abs(x)) * .7);
      col[i*3] = tmpC.r; col[i*3+1] = tmpC.g; col[i*3+2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({color:'#ffffff', vertexColors:true, roughness:1, metalness:0})));
  }

  /* ---------- Boulders and a pinnacle, resting on the sand ---------- */
  function rockGeometry(k){
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position, v = new THREE.Vector3(), col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++){
      v.fromBufferAttribute(p, i);
      const n = 1 + .42 * n3(v.x * 1.1 + k, v.y * 1.1, v.z * 1.1) + .16 * Math.abs(n3(v.x * 3 + k, v.y * 3, v.z * 3)) + .06 * n3(v.x * 7, v.y * 7 + k, v.z * 7);
      v.multiplyScalar(n); p.setXYZ(i, v.x, v.y, v.z);
      tmpC.copy(rockA).lerp(rockB, smoothstep(-.1, .35, n3(v.x * 3, v.y * 3 + k, v.z * 3)) * .8);
      tmpC.lerp(coral, smoothstep(.15, .4, n3(v.x * 2 + 5, v.y * 2, v.z * 2 + k)) * .55 * smoothstep(-.2, .6, v.y));
      col[i*3] = tmpC.r; col[i*3+1] = tmpC.g; col[i*3+2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals(); return g;
  }
  const rockMat = new THREE.MeshStandardMaterial({color:'#ffffff', vertexColors:true, roughness:.95, metalness:0, flatShading:true});
  addCaustics(rockMat);
  seed = 2024;
  const boulders = [];
  for (let i = 0; i < 30; i++){
    const x = rr(-8.5, 8.5), z = rr(3, -34), s = rr(.45, 2.1);
    boulders.push({x, z, s, sy:rr(.55, .9), y:floorY(x, z) + s * .25});
  }
  // pinnacle near the diver's last stop
  const pinX = -1.6, pinZ = -11.5;
  boulders.push({x:pinX, z:pinZ, s:2.6, sy:1.45, y:floorY(pinX, pinZ) + 1.1, pin:true});
  boulders.push({x:pinX + 1.4, z:pinZ - 1.2, s:1.7, sy:1.2, y:floorY(pinX + 1.4, pinZ - 1.2) + .6});
  const rockGeos = [rockGeometry(1.3), rockGeometry(4.1)];
  rockGeos.forEach((geo, gi) => {
    const list = boulders.filter((_, i) => i % 2 === gi);
    const m = new THREE.InstancedMesh(geo, rockMat, list.length);
    list.forEach((b, i) => { dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(rr(-.3, .3), rand() * 6.28, rr(-.3, .3)); dummy.scale.set(b.s * rr(.9, 1.2), b.s * b.sy, b.s * rr(.9, 1.2)); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
    scene.add(m);
  });

  /* ---------- Gorgonians: red fans with yellow tips ---------- */
  function gorgonianGeometry(k){
    seed = 4242 + k * 97;
    const parts = [], up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), mtx = new THREE.Matrix4();
    const red = C('#b51f2c'), tip = C('#e3b23c');
    function branch(start, angle, len, r, depth, lvl){
      const dir = new THREE.Vector3(Math.sin(angle), Math.cos(angle), rr(-.08, .08)).normalize();
      const end = start.clone().addScaledVector(dir, len);
      const c = new THREE.CylinderGeometry(r * .7, r, len, 5, 1);
      q.setFromUnitVectors(up, dir);
      mtx.compose(start.clone().addScaledVector(dir, len / 2), q, new THREE.Vector3(1, 1, 1));
      c.applyMatrix4(mtx);
      const g = c.toNonIndexed(), cnt = g.attributes.position.count, cols = new Float32Array(cnt * 3);
      const ty = g.attributes.position;
      for (let i = 0; i < cnt; i++){
        const along = (ty.getY(i) - Math.min(start.y, end.y)) / Math.max(.001, Math.abs(end.y - start.y));
        const f = depth === 0 ? smoothstep(.2, 1, along) : 0;
        tmpC.copy(red).lerp(tip, f * .9).multiplyScalar(.9 + lvl * .03);
        cols[i*3] = tmpC.r; cols[i*3+1] = tmpC.g; cols[i*3+2] = tmpC.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(g);
      if (depth > 0){
        const n = depth > 4 ? 2 : (rand() > .35 ? 2 : 3);
        for (let i = 0; i < n; i++) branch(end, angle * .85 + rr(-.35, .35) + (i - (n - 1) / 2) * .55, len * rr(.68, .86), r * .74, depth - 1, lvl + 1);
      }
    }
    branch(new THREE.Vector3(0, -.05, 0), 0, .4, .05, 6, 0);
    const g = mergeGeometries(parts); g.computeVertexNormals(); return g;
  }
  const gorgMat = new THREE.MeshStandardMaterial({color:'#ffffff', vertexColors:true, roughness:.75, metalness:0, emissive:'#250306', emissiveIntensity:.35});
  const gorgGeos = [gorgonianGeometry(1), gorgonianGeometry(2), gorgonianGeometry(3)];
  seed = 777;
  const placeGorg = (x, y, z, rz, ry, s) => { const m = new THREE.Mesh(gorgGeos[(rand() * 3) | 0], gorgMat); m.position.set(x, y, z); m.rotation.set(0, ry, rz, 'YXZ'); m.scale.setScalar(s); scene.add(m); };
  for (let i = 0; i < (lowPower ? 16 : 26); i++){
    const side = i % 2 ? 1 : -1, y = rr(-21, -42), z = rr(4, -18);
    const x = wallX(side, y, z) + side * .15;
    placeGorg(x, y, z, side * rr(.85, 1.25), rr(-.35, .35), rr(.75, 1.3));
  }
  // on the pinnacle
  for (let i = 0; i < 5; i++){ const a = rr(0, 6.28); placeGorg(pinX + Math.cos(a) * 2.4, floorY(pinX, pinZ) + rr(1.6, 3.4), pinZ + Math.sin(a) * 1.6 + 1.2, rr(-.3, .3), rr(-.45, .45), rr(.7, 1.05)); }

  /* ---------- Sea urchins and starfish ---------- */
  {
    const parts = [new THREE.SphereGeometry(.075, 10, 8).toNonIndexed()];
    const ico = new THREE.IcosahedronGeometry(1, 1), ip = ico.attributes.position, seen = new Set(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion(), mtx = new THREE.Matrix4();
    for (let i = 0; i < ip.count; i++){
      dir.fromBufferAttribute(ip, i).normalize(); const key = dir.toArray().map(v => v.toFixed(2)).join(); if (seen.has(key)) continue; seen.add(key);
      const c = new THREE.ConeGeometry(.008, .13, 4); c.translate(0, .065 + .06, 0); q.setFromUnitVectors(up, dir); mtx.makeRotationFromQuaternion(q); c.applyMatrix4(mtx); parts.push(c.toNonIndexed());
    }
    const urchinGeo = mergeGeometries(parts); urchinGeo.computeVertexNormals();
    const urch = new THREE.InstancedMesh(urchinGeo, new THREE.MeshStandardMaterial({color:'#2b1631', roughness:.6, metalness:.1}), 46);
    seed = 99;
    for (let i = 0; i < 46; i++){
      const x = rr(-8, 8), z = rr(2, -30), y = floorY(x, z) + .04;
      dummy.position.set(x, y, z); dummy.rotation.set(0, rand() * 6, 0); dummy.scale.setScalar(rr(.8, 1.3)); dummy.updateMatrix(); urch.setMatrixAt(i, dummy.matrix);
    }
    scene.add(urch);

    const star = new THREE.Shape();
    for (let i = 0; i <= 10; i++){ const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? .045 : .17; i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const starGeo = new THREE.ExtrudeGeometry(star, {depth:.02, bevelEnabled:true, bevelThickness:.014, bevelSize:.016, bevelSegments:2, curveSegments:4});
    starGeo.rotateX(-Math.PI / 2);
    const stars = new THREE.InstancedMesh(starGeo, new THREE.MeshStandardMaterial({color:'#c2391f', roughness:.85, metalness:0}), 16);
    for (let i = 0; i < 16; i++){
      const x = rr(-7.5, 7.5), z = rr(2, -28);
      dummy.position.set(x, floorY(x, z) + .01, z); dummy.rotation.set(rr(-.08, .08), rand() * 6.28, rr(-.08, .08)); dummy.scale.setScalar(rr(.8, 1.4)); dummy.updateMatrix(); stars.setMatrixAt(i, dummy.matrix);
    }
    scene.add(stars);
  }

  /* ---------- Light shafts, leaning toward the refracted sun ---------- */
  const rays = [];
  const rayShaftGeo = new THREE.PlaneGeometry(1.6, 34); rayShaftGeo.translate(0, -17, 0);
  seed = 555;
  for (let i = 0; i < 14; i++){
    const m = new THREE.ShaderMaterial({
      uniforms:{uOpacity:{value:1}, uTime:{value:0}, uSeed:{value:rand()}, uNight:{value:0}},
      vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader:`varying vec2 vUv; uniform float uOpacity; uniform float uTime; uniform float uSeed; uniform float uNight;
        void main(){ float x = abs(vUv.x-.5)*2.; float e = exp(-x*x*4.)*(1.-x); float v = smoothstep(0.,.8,vUv.y)*smoothstep(1.,.93,vUv.y); float f = .55+.45*sin(uTime*.7+uSeed*20.);
          gl_FragColor = vec4(mix(vec3(.8,1.,1.), vec3(.7,.82,1.), uNight), e*v*f*uOpacity*.13); }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(rayShaftGeo, m);
    mesh.position.set(rr(-8, 9), SURF - .2, rr(-1, -18));
    mesh.scale.x = rr(.5, 1.6);
    scene.add(mesh); rays.push(mesh);
  }
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), basis = new THREE.Matrix4();
  function orientShaft(m){
    by.copy(lightDirW);
    bz.copy(camera.position).sub(m.position); bz.addScaledVector(by, -bz.dot(by)).normalize();
    bx.crossVectors(by, bz).normalize();
    bz.crossVectors(bx, by);
    basis.makeBasis(bx, by, bz); m.quaternion.setFromRotationMatrix(basis);
  }

  /* ---------- Post-processing ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / (small ? 2 : 1.5), innerHeight / (small ? 2 : 1.5)), .3, .6, .82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- Depth-driven atmosphere ---------- */
  const dayW = ['#3ab0c0', '#0b5878', '#06304d', '#031a2e'].map(c => new THREE.Color(c));
  const nightW = ['#0d2c48', '#071a2e', '#030b17', '#000306'].map(c => new THREE.Color(c));
  const lSurf = new THREE.Color('#d8f8ff'), lDeep = new THREE.Color('#4f9cc8');
  const mSurf = new THREE.Color('#b4c8ec'), mDeep = new THREE.Color('#1c3a68');
  const lAir = new THREE.Color('#fff4e2'), mAir = new THREE.Color('#c4d4f4');
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  function ramp(w, d, out){
    if (d < 12) return out.copy(w[0]).lerp(w[1], d / 12);
    if (d < 26) return out.copy(w[1]).lerp(w[2], (d - 12) / 14);
    return out.copy(w[2]).lerp(w[3], Math.min(1, (d - 26) / 12));
  }
  let night = dive.night ? 1 : 0;

  let pointer = {x:0, y:0}, pSmooth = {x:0, y:0};
  if (!small) addEventListener('pointermove', e => { pointer.x = e.clientX / innerWidth - .5; pointer.y = e.clientY / innerHeight - .5; });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  });

  const clock = new THREE.Clock();
  let t = 0, torchLevel = 0, torchTarget = 0, flickerT = -1, lastTorch = false, firstFrame = true;
  const tmpV = new THREE.Vector3(), armWorld = new THREE.Vector3(), aimPt = new THREE.Vector3();

  function frame(){
    const dt = Math.min(clock.getDelta(), .05);
    const speed = dive.reduce ? 0 : 1;
    t += dt * speed;
    const dRaw = dive.depth;          // negative while still above the water
    const d = Math.max(0, dRaw);
    const y = -d;

    // day ↔ night blend
    const goal = dive.night ? 1 : 0;
    night = dive.reduce ? goal : night + (goal - night) * Math.min(1, dt * 2.2);
    const n = night;

    // sun or moon direction, and its refracted version under water
    lightDir.copy(sunDir).lerp(moonDir, n).normalize();
    const sinA = Math.hypot(lightDir.x, lightDir.z), sinW = sinA / 1.333, cosW = Math.sqrt(1 - sinW * sinW);
    lightDirW.set(lightDir.x / sinA * sinW, cosW, lightDir.z / sinA * sinW);

    // camera: starts above the waves, then sinks under
    pSmooth.x += (pointer.x - pSmooth.x) * .04; pSmooth.y += (pointer.y - pSmooth.y) * .04;
    const camY = -dRaw + (small ? 1.25 : 1.05);
    const above = smooth(1.3, 3.2, camY);
    const isAbove = camY > SURF + .15;
    if (small){
      camera.position.set(.9, camY, 6.5);
      camera.lookAt(-.4, camY + mix(-2.6, .95, above), -3);
    } else {
      camera.position.set(-1.2 + pSmooth.x * .8, camY - pSmooth.y * .5 * (1 - above), 5.3);
      camera.lookAt(-2.6, camY + mix(-1.5, .75, above), -4);
    }

    // atmosphere under water
    ramp(dayW, d, tmpA); ramp(nightW, d, tmpB); fogCol.copy(tmpA).lerp(tmpB, n);
    scene.fog.density = mix(.03 + d * .0006, .042 + d * .0005, n);
    scene.fog.color.copy(fogCol);
    sky.visible = isAbove;
    sky.position.copy(camera.position);
    skyMat.uniforms.uTime.value = t; skyMat.uniforms.uNight.value = n;

    const air = isAbove ? 1 : 0;
    hemi.intensity = mix(mix(1.4 * Math.exp(-d / 14) + .45, .5 * Math.exp(-d / 10) + .1, n), mix(1.6, .35, n), air);
    hemi.color.copy(lSurf).lerp(lDeep, Math.min(1, d / 18)).lerp(tmpA.copy(mSurf).lerp(mDeep, Math.min(1, d / 14)), n);
    sun.intensity = mix(mix(2.4 * Math.exp(-d / 12), .7 * Math.exp(-d / 8), n), mix(2.8, .6, n), air);
    sun.color.copy(lSurf).lerp(lDeep, Math.min(1, d / 14)).lerp(tmpA.copy(mSurf).lerp(mDeep, Math.min(1, d / 12)), n);
    if (isAbove) sun.color.copy(lAir).lerp(mAir, n);
    sun.target.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(isAbove ? lightDir : lightDirW, 30);

    surfMat.uniforms.uTime.value = t; surfMat.uniforms.uFade.value = Math.exp(-d / 7); surfMat.uniforms.uFog.value.copy(fogCol); surfMat.uniforms.uNight.value = n;
    causU.uTime.value = t; causU.uCaus.value = 1 - n;

    const rayOp = mix(Math.exp(-d / 6), .4 * Math.exp(-d / 7), n) * (isAbove ? 0 : 1);
    rays.forEach(r => { r.visible = rayOp > .02; if (!r.visible) return; r.material.uniforms.uOpacity.value = rayOp; r.material.uniforms.uTime.value = t; r.material.uniforms.uNight.value = n; orientShaft(r); });
    snow.uniforms.uTime.value = t; snow.uniforms.uOpacity.value = mix(.55 - smooth(10, 40, d) * .35, .3, n);
    const bio = mix(smooth(17, 34, d), .3 + smooth(2, 18, d) * .7, n) * (isAbove ? 0 : 1);
    glow.uniforms.uTime.value = t; glow.uniforms.uOpacity.value = bio * .32;
    haze.forEach(h => {
      h.m.position.set(h.base.x + Math.sin(t * .05 + h.ph) * 1.5, h.base.y + Math.sin(t * .07 + h.ph * 2) * 1.2, h.base.z);
      h.m.material.uniforms.uOpacity.value = bio * h.k * (.045 + .015 * Math.sin(t * .4 + h.ph));
    });
    bloom.strength = mix(mix(.25 + smooth(16, 36, d) * .4, .45 + smooth(4, 30, d) * .25, n), mix(.2, .5, n), above);
    bloom.radius = mix(.5, .95, Math.max(smooth(14, 34, d), n * smooth(2, 16, d)));
    bloom.threshold = mix(mix(.85 - smooth(16, 36, d) * .25, .62 - smooth(4, 30, d) * .08, n), mix(1.05, .9, n), above);

    // diver: waiting under the surface until the camera comes down
    diver.position.set(small ? -1.2 : -1.9, y + Math.sin(t * .8) * .06, 0);
    diver.rotation.set(-.3 + Math.sin(t * .5) * .04, -1.95 + Math.sin(t * .23) * .06, Math.sin(t * .6) * .04);
    const kick = Math.sin(t * 2.6);
    legL.g.rotation.x = kick * .26; legR.g.rotation.x = -kick * .26;
    legL.finPivot.rotation.x = Math.sin(t * 2.6 - .9) * .38; legR.finPivot.rotation.x = -Math.sin(t * 2.6 - .9) * .38;
    diver.updateMatrixWorld(true);
    armR.getWorldPosition(armWorld);
    aimPt.set(diver.position.x + 5.5 + Math.sin(t * .3) * .5, diver.position.y - 2.3 + Math.sin(t * .4) * .3, diver.position.z - 3.5);
    aimPt.sub(armWorld).multiplyScalar(-1).add(armWorld);
    armR.lookAt(aimPt);

    // torch: switch on with a short flicker
    if (dive.torch !== lastTorch){ lastTorch = dive.torch; if (dive.torch) flickerT = 0; else { flickerT = -1; torchTarget = 0; } }
    if (flickerT >= 0){
      flickerT += dive.reduce ? 1 : dt;
      const ft = flickerT;
      torchTarget = ft < .08 ? 1 : ft < .16 ? .1 : ft < .26 ? .9 : ft < .3 ? .3 : 1;
      if (ft > .35) flickerT = -1;
    }
    torchLevel = (flickerT >= 0 || dive.reduce) ? torchTarget : torchLevel + (torchTarget - torchLevel) * .2;
    spot.intensity = torchLevel * 90;
    beamMat.uniforms.uOpacity.value = torchLevel;
    coreMat.uniforms.uOpacity.value = torchLevel * .9;
    glareMat.opacity = torchLevel * .85;
    lensMat.emissiveIntensity = torchLevel * 2.2;

    // bubbles
    reg.getWorldPosition(regWorld);
    const breath = (t % 4.2) < 1.3;
    bubTimer += dt * speed;
    if (breath && bubTimer > .06){
      bubTimer = 0;
      for (let k = 0; k < 2; k++){ const b = bub[bubIdx]; bubIdx = (bubIdx + 1) % BUB; b.alive = true; b.p.copy(regWorld).add(tmpV.set(rr(-.04, .04), 0, rr(-.04, .04))); b.s = rr(.015, .05); b.life = 0; }
    }
    for (let i = 0; i < BUB; i++){
      const b = bub[i];
      if (b.alive){
        b.life += dt * speed;
        b.p.y += dt * speed * (1.1 + b.s * 12);
        b.p.x += Math.sin(b.life * 7 + b.ph) * .006; b.p.z += Math.cos(b.life * 6 + b.ph) * .006;
        if (b.p.y > regWorld.y + 7 || b.p.y > SURF - .35) b.alive = false;
        const s = b.s * (1 + b.life * .25);
        dummy.position.copy(b.p); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s * .8, s);
      } else { dummy.position.set(0, 999, 0); dummy.scale.setScalar(0); }
      dummy.updateMatrix(); bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;

    // fauna near the camera only
    schools.forEach(s => { const near = Math.abs(s.y - y) < 22; s.mesh.visible = near; if (near) updateSchool(s, t); });
    groupers.forEach(g => {
      const a = t * g.w + g.ph;
      g.m.position.set(g.cx + Math.cos(a) * g.r, g.cy + Math.sin(a * 1.7) * .4, g.cz + Math.sin(a) * g.r * .6);
      g.m.lookAt(g.cx + Math.cos(a + .05) * g.r, g.m.position.y, g.cz + Math.sin(a + .05) * g.r * .6);
      g.m.rotateY(Math.sin(t * 3 + g.ph) * .08);
    });
    {
      const a = t * .11, R = 5.5;
      ray.position.set(-.5 + Math.cos(a) * R, -15.5 + Math.sin(t * .4) * .8, -9 + Math.sin(a) * R * .6);
      ray.lookAt(-.5 + Math.cos(a + .03) * R, ray.position.y + Math.cos(t * .4) * .01, -9 + Math.sin(a + .03) * R * .6);
      ray.rotateZ(-.25);
      const fl = Math.sin(t * 1.5) * .42; wingL.rotation.z = -fl; wingR.rotation.z = fl;
    }
    jellies.forEach(j => {
      const near = Math.abs(j.base - y) < 24; j.g.visible = near; j.halo.visible = near && bio > .01; if (!near) return;
      const p = Math.pow(.5 + .5 * Math.sin(t * 1.8 + j.ph), 2);
      j.bell.scale.set(1 + p * .14, 1 - p * .18, 1 + p * .14);
      j.g.position.y = j.base + Math.sin(t * .25 + j.ph) * 1.2 + p * .06;
      j.g.position.x = j.sx + Math.sin(t * .1 + j.ph) * .6;
      j.g.rotation.z = Math.sin(t * .3 + j.ph) * .15;
      j.halo.position.copy(j.g.position); j.halo.position.y -= .25 * j.g.scale.y;
      j.halo.material.uniforms.uOpacity.value = (.14 + .06 * p) * Math.max(bio, .35 * smooth(20, 30, d));
      j.tents.forEach(tn => {
        const arr = tn.line.geometry.attributes.position.array;
        const rx = Math.cos(tn.a) * .36 * (1 + p * .14), rz = Math.sin(tn.a) * .36 * (1 + p * .14);
        for (let k = 0; k < 14; k++){
          const f = k / 13;
          arr[k*3] = rx * (1 - f * .4) + Math.sin(t * 1.5 + j.ph + k * .5 + tn.a) * .07 * k * .3;
          arr[k*3+1] = -f * tn.len;
          arr[k*3+2] = rz * (1 - f * .4) + Math.cos(t * 1.3 + j.ph + k * .45 + tn.a) * .07 * k * .3;
        }
        tn.line.geometry.attributes.position.needsUpdate = true;
      });
    });
    jellyLights.forEach(({l, j}) => { l.position.copy(j.g.position); l.intensity = j.g.visible ? 4 * Math.max(bio, .3 * smooth(20, 30, d)) : 0; });
    billboards.forEach(b => { if (b.visible) b.quaternion.copy(camera.quaternion); });

    fill.position.set(camera.position.x, camera.position.y, camera.position.z - 1);
    fill.intensity = isAbove ? 0 : mix(.8 + smooth(10, 30, d) * 2.4, 5, n);

    composer.render();
    if (firstFrame){ firstFrame = false; canvas.classList.add('ready'); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
