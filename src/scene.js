import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadDiver, updateDiver, spring } from './diver.js';
import { createFauna } from './fauna.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/diver.glb`;
// development only: ?close=x,y,z puts the camera next to the diver to check the rig
// development only: ?dtmax=1 lets a very slow test browser advance in real time
const DT_MAX = (import.meta.env.DEV && +new URLSearchParams(location.search).get('dtmax')) || .1;
const OCTO_CAM = import.meta.env.DEV && new URLSearchParams(location.search).has('octo');
const CLOSE = import.meta.env.DEV && new URLSearchParams(location.search).get('close')?.split(',').map(Number);

export function initScene(dive){
  const canvas = document.getElementById('scene');
  let renderer;
  // no antialias on the canvas itself: the scene renders into the composer's multisampled target
  try { renderer = new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:'high-performance'}); }
  catch (e) { return; }

  const small = innerWidth < 720;
  // framing follows the shape of the screen: phones and portrait tablets (an iPad upright) get the
  // centred, closer shot; only landscape screens put the diver beside the text
  let narrow = small || innerWidth / innerHeight < .85;
  const lowPower = small || (navigator.hardwareConcurrency || 8) <= 4;
  // resolution adapts to the device: it starts sharp and steps down if frames come in slow
  const PR_MAX = Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75), PR_MIN = Math.min(PR_MAX, small ? .8 : 1);
  // multisampling only where pixels are big enough for jagged edges to show; on retina screens the
  // density already smooths them and 4x MSAA on a half-float buffer was the costliest thing on screen
  const msaa = () => (!lowPower && pr <= 1.25 ? 4 : 0);
  let pr = PR_MAX;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const fogCol = new THREE.Color('#3ab0c0');
  scene.background = fogCol;
  scene.fog = new THREE.FogExp2(fogCol.clone(), 0.034);

  const camera = new THREE.PerspectiveCamera(narrow ? 62 : 52, innerWidth / innerHeight, .15, 2400);
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
  // uCloud: overcast (rain .8, storm 1) · uHaze: fog · uDusk: sunset · uMeteor: meteor shower ·
  // uFlash: lightning, 0..1 for a split second
  const SKY = `
    uniform vec3 uLight; uniform float uNight; uniform float uTime;
    uniform float uCloud; uniform float uHaze; uniform float uDusk; uniform float uMeteor; uniform float uFlash;
    vec3 skyBase(vec3 d){
      float h = max(d.y, 0.);
      float t = pow(h, .42);
      vec3 day = mix(vec3(.42,.67,.86), vec3(.03,.2,.55), t);
      // sunset: a warm band on the horizon fading through rose into a violet blue
      vec3 dusk = mix(vec3(1.,.5,.24), mix(vec3(.62,.36,.46), vec3(.1,.13,.34), smoothstep(.12,.6,h)), smoothstep(.0,.3,h));
      day = mix(day, dusk, uDusk);
      vec3 nig = mix(vec3(.03,.055,.11), vec3(.003,.008,.026), t);
      float a = max(dot(d, uLight), 0.);
      float open = 1. - .9*uCloud;
      day += mix(vec3(1.,.82,.55)*pow(a,8.)*.12 + vec3(1.,.93,.8)*pow(a,64.)*.45,
                 vec3(1.,.55,.22)*pow(a,4.)*.55 + vec3(1.,.72,.4)*pow(a,36.)*.7, uDusk) * open;
      nig += (vec3(.2,.28,.46)*pow(a,9.)*.5 + vec3(.5,.55,.7)*pow(a,90.)*.45) * open;
      vec2 cp = d.xz/(d.y+.12)*1.6 + vec2(uTime*(.004 + .01*uCloud), 0.);
      float cov = mix(.56, .28, uCloud);
      float cl = smoothstep(cov, cov + .28, fbm2(cp)) * smoothstep(.0,.22,d.y);
      vec3 cDay = mix(vec3(.93,.95,.97)*(.85+.25*pow(a,4.)), vec3(1.,.6,.42)*(.55+.7*pow(a,3.)), uDusk);
      cDay = mix(cDay, vec3(.36,.39,.43)*mix(1.,.6,uCloud*uCloud), uCloud);
      day = mix(day, cDay, cl*mix(.6, .95, uCloud));
      // overcast: the blue gives way to a flat grey, darker for a storm
      day = mix(day, mix(vec3(.6,.64,.68), vec3(.44,.48,.53), t)*mix(1., .55, uCloud*uCloud), uCloud*.8);
      nig = mix(nig, vec3(.07,.09,.14)+vec3(.24,.27,.36)*pow(a,6.), cl*.55);
      nig = mix(nig, vec3(.03,.036,.05), uCloud*.85);
      vec3 col = mix(day, nig, uNight);
      // fog: everything leans to one grey, most of all near the horizon
      vec3 hz = mix(vec3(.7,.75,.79)*mix(1., .58, uCloud*uCloud), vec3(.055,.065,.085), uNight);
      col = mix(col, hz, uHaze*mix(1., .7, smoothstep(.0,.55,h)));
      // lightning lights the clouds from inside
      col += vec3(.8,.85,1.)*uFlash*(.35 + .65*cl)*mix(1.2, .9, uNight);
      return col;
    }
    vec3 skyFull(vec3 d){
      vec3 col = skyBase(d);
      float a = dot(d, uLight);
      float clear = (1. - smoothstep(.25, .75, uCloud))*(1. - .85*uHaze);
      float sun = smoothstep(mix(.99952,.9993,uDusk),mix(.99972,.99958,uDusk),a);
      float moon = smoothstep(.99962,.99976,a);
      vec3 t1 = normalize(cross(uLight, vec3(0.,1.,0.))); vec3 t2 = cross(t1, uLight);
      vec2 mp = vec2(dot(d,t1), dot(d,t2))/.0218;
      float mar = .8 + .2*smoothstep(.35,.7, vn(mp*2.2+3.1)) - .2*smoothstep(.45,.78, vn(mp*3.7+11.));
      col += mix(mix(vec3(9.,8.2,6.6), vec3(9.,4.6,1.8), uDusk)*sun, vec3(2.7,2.8,3.)*moon*mar, uNight)*clear;
      vec3 sd = d*220.; vec3 cell = floor(sd); float r = hash13(cell);
      float st = step(mix(.9965,.9925,uMeteor), r) * smoothstep(.45, .0, length(fract(sd)-.5));
      st *= (.55+.45*sin(uTime*2.+r*80.)) * smoothstep(.04,.3,d.y) * (1.-smoothstep(.985,.9995,a));
      col += vec3(1.6,1.7,2.)*st*uNight*clear;
      // meteor shower: a few shooting stars at a time, each a short bright streak with a fading tail
      if (uMeteor > .01){
        vec2 q = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1., 1.)));
        for (int i = 0; i < 4; i++){
          float fi = float(i), per = 1.9 + fi*1.1, cyc = uTime/per + fi*.37;
          float k = floor(cyc), age = fract(cyc)*per, dur = .75 + .3*hash12(vec2(k, fi+5.));
          if (age < dur){
            vec2 s0 = vec2(hash12(vec2(k, fi))*1.3 - .65, .32 + hash12(vec2(fi, k+3.))*.42);
            float side = hash12(vec2(k, fi+9.)) < .5 ? -1. : 1.;
            float ang = .35 + hash12(vec2(k+7., fi))*.6;
            vec2 dir = vec2(cos(ang)*side, -sin(ang));
            float pr = age/dur, len = .22 + .12*hash12(vec2(fi+2., k));
            vec2 head = s0 + dir*len*pr, tail = head - dir*min(len*pr, .13);
            vec2 pa = q - tail, ba = head - tail;
            float hh = clamp(dot(pa, ba)/max(dot(ba, ba), 1e-6), 0., 1.);
            float m = smoothstep(.0022, .0, length(pa - ba*hh)) * hh * hh * sin(pr*3.1416);
            col += vec3(2.2,2.3,2.6)*m*uMeteor*clear*uNight;
          }
        }
      }
      return col;
    }
  `;
  const WAVES = `
    uniform float uSea;   // 1 calm, up to ~2.6 in a storm: bigger swell plus a short, choppy sea on top
    float wav(vec2 p){ float k = uSea - 1.;
      return (.14*sin(p.x*.32+uTime*1.05) + .09*sin(p.y*.47-uTime*.85+p.x*.18))*uSea + (.045*sin((p.x+p.y)*1.25+uTime*1.6) + .022*sin(p.x*2.9-p.y*2.2+uTime*2.2))*(1. + .6*k)
        + k*(.07*sin(p.x*.7+p.y*.42+uTime*1.35) + .035*sin(p.y*1.6-p.x*.5+uTime*2.4)); }
  `;

  /* ---------- Sky dome ---------- */
  const lightDir = new THREE.Vector3(), lightDirW = new THREE.Vector3();
  const sunDir = new THREE.Vector3(narrow ? -.03 : .12, narrow ? .45 : .34, narrow ? -.89 : -.93).normalize();
  const moonDir = new THREE.Vector3(narrow ? -.04 : -.05, narrow ? .5 : .42, narrow ? -.86 : -.9).normalize();
  // weather, shared by the sky, the sea surface and the rain (see weather.js for the states)
  const WX = { uCloud:{value:0}, uHaze:{value:0}, uDusk:{value:0}, uMeteor:{value:0}, uFlash:{value:0}, uRain:{value:0}, uSea:{value:1} };
  const duskDir = new THREE.Vector3(narrow ? -.02 : .1, .075, -1).normalize();
  const skyMat = new THREE.ShaderMaterial({
    uniforms:{uLight:{value:lightDir}, uNight:{value:0}, uTime:{value:0}, ...WX},
    vertexShader:`varying vec3 vDir; void main(){ vDir = position; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_Position.z = gl_Position.w; }`,
    fragmentShader:NOISE + SKY + `varying vec3 vDir; void main(){ gl_FragColor = vec4(skyFull(normalize(vDir)), 1.); }`,
    side:THREE.BackSide, depthWrite:false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  /* ---------- Sea surface (seen from above and from below) ---------- */
  const surfMat = new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0}, uFade:{value:1}, uFog:{value:new THREE.Color()}, uNight:{value:0}, uLight:{value:lightDir}, uLightW:{value:lightDirW}, ...WX},
    vertexShader:`uniform float uTime; varying vec3 vW;` + WAVES + `
      void main(){ vec4 w = modelMatrix*vec4(position,1.); w.y += wav(w.xz); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader:NOISE + SKY + WAVES + `
      uniform float uFade; uniform vec3 uFog; uniform vec3 uLightW; uniform float uRain; varying vec3 vW;
      void main(){
        vec2 p = vW.xz; float e = .08;
        float hx = wav(p+vec2(e,0.))-wav(p-vec2(e,0.)); float hz = wav(p+vec2(0.,e))-wav(p-vec2(0.,e));
        vec2 q = p*1.7 + uTime*vec2(.3,.2);
        float r0 = vn(q); float r1 = r0-vn(q+vec2(.13,0.)); float r2 = r0-vn(q+vec2(0.,.13));
        // rain pockmarks the water with fine, quick ripples
        vec2 rq = p*6.5 + uTime*vec2(2.1,-1.7); float s0 = vn(rq);
        vec2 rr2 = vec2(s0 - vn(rq+vec2(.09,0.)), s0 - vn(rq+vec2(0.,.09)))*2.6*uRain;
        vec3 n = normalize(vec3(-hx/(2.*e) + r1*.8 + rr2.x, 1., -hz/(2.*e) + r2*.8 + rr2.y));
        vec3 vd = normalize(vW - cameraPosition);
        float dist = length(vW.xz - cameraPosition.xz);
        vec3 col;
        if (cameraPosition.y > vW.y){
          vec3 rf = reflect(vd, n); rf.y = abs(rf.y);
          float fres = .02 + .98*pow(1.-max(dot(-vd, n), 0.), 5.);
          vec3 deep = mix(vec3(.0,.09,.16), vec3(.002,.008,.02), uNight)*mix(1., .62, uCloud);
          deep = mix(deep, vec3(.16,.08,.07), uDusk*(1.-uNight)*.5);
          float crest = smoothstep(.0,.25, wav(p)+.1);
          deep += mix(vec3(.02,.12,.12), vec3(.0,.01,.02), uNight)*crest;
          col = mix(deep, skyBase(rf)*mix(.7,.85,uNight), fres);
          float rl = max(dot(rf, uLight), 0.);
          float glint = (1. - smoothstep(.25, .75, uCloud))*(1. - .8*uHaze);
          col += mix(mix(vec3(14.,11.,8.), vec3(14.,7.,2.6), uDusk), vec3(4.,4.3,4.8), uNight) * pow(rl, mix(mix(700.,260.,uDusk),1100.,uNight)) * glint;
          col += mix(mix(vec3(.9,.8,.6), vec3(1.,.5,.2), uDusk), vec3(.22,.26,.36), uNight) * pow(rl, mix(40.,14.,uDusk)) * .55 * glint;
          col = mix(skyBase(normalize(vec3(vd.x, .001, vd.z))), col, exp(-dist*(.0028 + .03*uHaze)));
        } else {
          float c = smoothstep(.55, 1.5, cau(p*.32, uTime));
          float win = smoothstep(.6, .72, vd.y + n.x*.06);
          vec3 inside = mix(mix(vec3(.3,.82,.88), vec3(1.25,1.65,1.65), c), mix(vec3(.02,.05,.1), vec3(.14,.2,.3), c), uNight);
          vec3 outside = uFog*1.2 + inside*.06;
          col = mix(outside, inside, win);
          vec3 vr = normalize(vd + vec3(n.x,0.,n.z)*.25);
          float a = max(dot(vr, uLightW), 0.);
          col += (mix(vec3(6.,5.5,4.4), vec3(2.,2.2,2.5), uNight)*smoothstep(.9975,.999,a) + mix(vec3(1.2,1.2,1.), vec3(.2,.26,.38), uNight)*pow(a,80.))*win*(1. - .85*uCloud);
          col += vec3(.6,.65,.8)*uFlash*win*.8;
          col *= uFade;
          col = mix(uFog, col, exp(-dist*.035));
        }
        gl_FragColor = vec4(col, 1.);
      }`,
    side:THREE.DoubleSide
  });
  const surfGeo = new THREE.PlaneGeometry(1200, 1200, lowPower ? 160 : 240, lowPower ? 160 : 240); surfGeo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(surfGeo, surfMat); surface.position.y = SURF; surface.frustumCulled = false; scene.add(surface);

  /* ---------- Rain and lightning (weather.js picks when) ---------- */
  // Rain: short streaks falling in a box that travels with the camera, seen only above the water;
  // the drops that fall below the sea surface are hidden by it.
  const RAIN_N = lowPower ? 700 : 1500;
  const rainGeo = new THREE.BufferGeometry();
  { const pos = new Float32Array(RAIN_N * 6), seed = new Float32Array(RAIN_N * 6), tip = new Float32Array(RAIN_N * 2);
    // Math.random, not the seeded rand: the world layout drawn after this must not change
    for (let i = 0; i < RAIN_N; i++){ const a = Math.random(), b = Math.random(), c = Math.random();
      for (const k of [0, 1]){ seed.set([a, b, c], (i * 2 + k) * 3); tip[i * 2 + k] = k; } }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rainGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 3)); rainGeo.setAttribute('tip', new THREE.BufferAttribute(tip, 1)); }
  const rainMat = new THREE.ShaderMaterial({
    uniforms:{ uTime:{value:0}, uCam:{value:new THREE.Vector3()}, uRain:WX.uRain, uNight:{value:0} },
    vertexShader:`uniform float uTime; uniform vec3 uCam; uniform float uRain; attribute vec3 seed; attribute float tip; varying float vA;
      void main(){
        vec3 box = vec3(26., 13., 24.);
        vec3 p = seed*box; p.y = mod(seed.y*box.y - uTime*(10. + seed.x*4.), box.y);
        vec3 w = uCam + vec3(-13., -3., -21.) + p - normalize(vec3(.14, -1., .04))*tip*(.35 + seed.z*.25);
        vA = (1. - tip) * uRain * step(seed.z, .35 + .65*uRain);
        gl_Position = projectionMatrix*viewMatrix*vec4(w, 1.);
      }`,
    fragmentShader:`uniform float uNight; varying float vA; void main(){ gl_FragColor = vec4(mix(vec3(.5,.56,.63), vec3(.45,.5,.6), uNight), vA*mix(.55, .42, uNight)); }`,
    transparent:true, depthWrite:false, fog:false
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  // Lightning: a jagged bolt far out over the sea, redrawn for every strike
  const BOLT_N = 16;
  const boltGeo = new THREE.BufferGeometry(); boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_N * 3), 3));
  const boltMat = new THREE.LineBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const bolt = new THREE.Line(boltGeo, boltMat); bolt.frustumCulled = false; bolt.visible = false; scene.add(bolt);
  function newBolt(){
    const arr = boltGeo.attributes.position.array, az = (Math.random() - .5) * 1.1, R = 520;
    let x = Math.sin(az) * R, z = -Math.cos(az) * R, y = 260;
    for (let i = 0; i < BOLT_N; i++){
      arr.set([x, y, z], i * 3);
      y -= 260 / (BOLT_N - 1) * (.7 + Math.random() * .6); x += (Math.random() - .5) * 34; z += (Math.random() - .5) * 18;
    }
    boltGeo.attributes.position.needsUpdate = true;
  }
  const storm = { next: 2 + Math.random() * 4, t: -1 };

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

  // Seen from high above, the dark seabed rocks stood out through the fog as floating blobs; real
  // water hides the bottom until you get near it, so these materials also fade with the height
  // of the camera above them.
  const murky = m => (addMurk(m), m);
  function addMurk(mat){
    const before = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (before) before(sh, r);
      if (!sh.vertexShader.includes('vWPos')){
        sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          vec4 mw = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            mw = instanceMatrix*mw;
          #endif
          vWPos = (modelMatrix*mw).xyz;`);
        sh.fragmentShader = 'varying vec3 vWPos;\n' + sh.fragmentShader;
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(5., 12., cameraPosition.y - vWPos.y));`);
    };
    mat.customProgramCacheKey = () => 'murk' + (before ? '-caustics' : '');
  }

  /* ---------- Diver ---------- */
  // rig: root (position, heading) > pitch > roll > model (lying along -z, back up)
  const diverRoot = new THREE.Group(), diverPitch = new THREE.Group(), diverRoll = new THREE.Group(), diverModel = new THREE.Group();
  diverRoot.add(diverPitch); diverPitch.add(diverRoll); diverRoll.add(diverModel);
  diverModel.rotation.y = Math.PI;        // the file swims toward +z; turn it head-first along -z
  diverModel.scale.setScalar(1.2);
  diverRoot.rotation.y = -1.95;
  scene.add(diverRoot);
  let diverRig = null;
  const diverAddCaustics = mat => addCaustics(mat);
  loadDiver(MODEL_URL, { decorate: diverAddCaustics }).then(rig => {
    rig.object.position.set(0, -.85, .15);   // centre the body on the rig's pivot
    diverRig = rig; diverModel.add(rig.object);
  }).catch(err => console.warn('Diver model failed to load', err));

  /* ---------- Dive light ---------- */
  // No torch in the diver's hands: the light simply comes from the chest rig, where divers clip
  // a backup light. It switches on in the deep and at night, and on the seabed it settles on
  // the easter egg spot.
  const lightRig = new THREE.Group(); scene.add(lightRig);
  const spot = new THREE.SpotLight(0xffeccc, 0, 30, .34, .5, 1.05);
  lightRig.add(spot);
  const spotTarget = new THREE.Object3D(); spotTarget.position.set(0, 0, -6); lightRig.add(spotTarget); spot.target = spotTarget;
  const beamLen = 7.5;
  const beamMat = new THREE.ShaderMaterial({
    uniforms:{uOpacity:{value:0}, uLen:{value:beamLen}},
    vertexShader:`varying float vD; varying vec3 vN; varying vec3 vV; uniform float uLen;
      void main(){ vD = -position.z/uLen; vec4 mv = modelViewMatrix*vec4(position,1.); vV = -mv.xyz; vN = normalMatrix*normal; gl_Position = projectionMatrix*mv; }`,
    fragmentShader:`varying float vD; varying vec3 vN; varying vec3 vV; uniform float uOpacity;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float a = pow(f,1.6)*pow(1.-smoothstep(.0,1.,vD),1.3)*smoothstep(0.,.12,vD); gl_FragColor = vec4(vec3(1.,.93,.8), a*uOpacity*.2); }`,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide
  });
  const cone = (r, len) => { const g = new THREE.ConeGeometry(r, len, 56, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, -len / 2); return g; };
  lightRig.add(new THREE.Mesh(cone(1.35, beamLen), beamMat));
  const coreMat = beamMat.clone(); coreMat.uniforms = THREE.UniformsUtils.clone(beamMat.uniforms); coreMat.uniforms.uLen.value = beamLen * .7;
  lightRig.add(new THREE.Mesh(cone(.45, beamLen * .7), coreMat));
  // the spot on the seabed where the light comes to rest: put the easter egg in this group
  const easterEgg = new THREE.Group(); easterEgg.name = 'easterEgg';
  scene.add(easterEgg);
  // Easter egg: a Nomai mask from Outer Wilds, half buried in the sand, right where the light lands.
  // Model: "Outer Wilds - Nomai Mask scan" by 09williamsad, CC BY 4.0 (simplified, see scripts/).
  const maskPivot = new THREE.Group(); easterEgg.add(maskPivot);
  new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/nomai-mask.glb`).then(g => {
    const m = g.scene;
    m.traverse(o => { if (o.isMesh){ o.material.flatShading = true; o.material.roughness = .78; o.material.metalness = 0; o.material.needsUpdate = true; } });
    const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const k = 2.1 / size.x;                  // about 2 m across: an old Nomai relic, big enough to read from the camera
    m.scale.setScalar(k); m.position.copy(c).multiplyScalar(-k);
    maskPivot.add(m);
  }).catch(err => console.warn('Mask failed to load', err));


  /* ---------- Easter egg on the horizon: Beedle's shop ship from The Wind Waker ---------- */
  // Model extracted from the game (see scripts/convert-boat.mjs). It only shows from the surface,
  // small and hazy far out on the open side of the frame, rocking on the same waves as the sea.
  const boat = new THREE.Group(); boat.visible = false; scene.add(boat);
  const boatHaze = { uHaze: { value: new THREE.Color() }, uHazeK: { value: .3 } };
  {
    // where it sits: a fixed bearing seen from the camera at the top of the page
    const heroY = 2.6 + (narrow ? 1.25 : 1.05), cam0 = new THREE.PerspectiveCamera(camera.fov, innerWidth / innerHeight, .1, 2000);
    if (narrow){ cam0.position.set(.9, heroY, 6.5); cam0.lookAt(-.4, heroY + .95, -3); }
    else { cam0.position.set(-1.2, heroY, 5.3); cam0.lookAt(-2.6, heroY + .75, -4); }
    cam0.updateMatrixWorld(); cam0.updateProjectionMatrix();
    const dir = new THREE.Vector3(narrow ? .5 : .3, 0, .5).unproject(cam0).sub(cam0.position); dir.y = 0; dir.normalize();
    const D = narrow ? 85 : 115;
    boat.position.set(cam0.position.x + dir.x * D, SURF, cam0.position.z + dir.z * D);
    boat.userData.yaw = Math.atan2(dir.x, dir.z) + 2.2;     // three-quarter view, bow to the right
  }
  new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/beedle-boat.glb`).then(g => {
    const m = g.scene;
    m.scale.setScalar(narrow ? .0085 : .0105);
    m.traverse(o => {
      if (!o.isMesh) return;
      const mat = o.material; mat.fog = false; mat.roughness = .9;
      mat.onBeforeCompile = sh => {
        sh.uniforms.uHaze = boatHaze.uHaze; sh.uniforms.uHazeK = boatHaze.uHazeK;
        sh.fragmentShader = 'uniform vec3 uHaze; uniform float uHazeK;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, uHaze, uHazeK);\n#include <opaque_fragment>');
      };
    });
    boat.add(m);
  }).catch(err => console.warn('Boat failed to load', err));
  // same swell as the sea surface shader (WAVES), sampled at the hull
  const swell = (x, z, t) => { const s = WX.uSea.value, k = s - 1;
    return (.14 * Math.sin(x * .32 + t * 1.05) + .09 * Math.sin(z * .47 - t * .85 + x * .18)) * s + (.045 * Math.sin((x + z) * 1.25 + t * 1.6) + .022 * Math.sin(x * 2.9 - z * 2.2 + t * 2.2)) * (1 + .6 * k)
      + k * (.07 * Math.sin(x * .7 + z * .42 + t * 1.35) + .035 * Math.sin(z * 1.6 - x * .5 + t * 2.4)); };

  /* ---------- Bubbles ---------- */
  const BUB = 70;
  const bubMat = new THREE.MeshStandardMaterial({color:'#dff6ff', roughness:.22, metalness:0, transparent:true, opacity:.55, emissive:'#8fd6ee', emissiveIntensity:.25});
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), bubMat, BUB);
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bubbles.frustumCulled = false;
  const bub = Array.from({length:BUB}, () => ({alive:false, p:new THREE.Vector3(), s:0, life:0, ph:rand() * 6}));
  scene.add(bubbles);
  const regWorld = new THREE.Vector3();
  let bubTimer = 0, bubIdx = 0;
  const dummy = new THREE.Object3D();

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
  for (let i = 0; i < (lowPower ? 3 : 5); i++){
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
    g.position.set(rr(-5, 5), -27 - i * 3.2 + rr(-1, 1), rr(-4, -14));
    scene.add(g);
    const halo = new THREE.Mesh(glowGeo, glowMaterial(col, 1.1)); halo.scale.set(3 * s, 3 * s, 1); halo.renderOrder = 3; scene.add(halo); billboards.push(halo);
    jellies.push({g, bell, tents, halo, col, ph:rand() * 6, base:g.position.y, sx:g.position.x});
  }
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

  // a little low-poly octopus near the surface: round head, big eyes, curly arms, soft jet pulses
  const octo = (() => {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .62, metalness: 0, side: THREE.DoubleSide });
    const top = C('#ff7a5c'), belly = C('#ffc4a3'), spot = C('#ef5f47');
    // head: a round, slightly bulbous mantle
    const mg = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
    { const p = mg.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3){
        let cy = 0, cz = 0; for (let k = 0; k < 3; k++){ v.fromBufferAttribute(p, i + k); cy += v.y / 3; cz += v.z / 3; }
        tmpC.copy(belly).lerp(top, smoothstep(-.75, .35, cy));
        if (cy > .1 && cz < .55 && hash2(i, 11) > .86) tmpC.lerp(spot, .7);
        for (let k = 0; k < 3; k++){
          v.fromBufferAttribute(p, i + k);
          v.set(v.x * .98, v.y * (v.y > 0 ? 1.08 : .86) + .62, v.z * .94);
          p.setXYZ(i + k, v.x, v.y, v.z); col.set([tmpC.r, tmpC.g, tmpC.b], (i + k) * 3);
        }
      }
      mg.setAttribute('color', new THREE.BufferAttribute(col, 3)); mg.computeVertexNormals(); }
    const mantle = new THREE.Mesh(mg, skin); group.add(mantle);
    // face, on the front of the head
    const white = new THREE.MeshStandardMaterial({ color: '#fbf7ee', flatShading: true, roughness: .35 });
    const black = new THREE.MeshStandardMaterial({ color: '#1d1714', roughness: .25, metalness: .1 });
    const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const blushM = new THREE.MeshBasicMaterial({ color: '#ff8fa6', transparent: true, opacity: .75 });
    const face = new THREE.Group(); face.position.y = .5; mantle.add(face);
    const eyes = [];
    for (const sx of [-1, 1]){
      const eye = new THREE.Group(); eye.position.set(sx * .36, .12, .78); face.add(eye); eyes.push(eye);
      eye.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.27, 1), white));
      const pupil = new THREE.Mesh(new THREE.IcosahedronGeometry(.17, 1), black); pupil.position.set(sx * .015, -.02, .15); eye.add(pupil);
      const glint = new THREE.Mesh(new THREE.IcosahedronGeometry(.055, 0), shine); glint.position.set(-.06, .07, .3); eye.add(glint);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(.11, 10), blushM); blush.position.set(sx * .5, -.25, .82); blush.rotation.y = sx * .5; face.add(blush);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(.09, .024, 6, 12, Math.PI), black);
    smile.position.set(0, -.2, .9); smile.rotation.z = Math.PI; face.add(smile);
    // arms
    const N = 10, RAD = 6, L = 1.25;
    const tentacles = [];
    for (let i = 0; i < 8; i++){
      const a = (i + .5) / 8 * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array((N * RAD + 1) * 3), col = new Float32Array((N * RAD + 1) * 3), idx = [];
      for (let k = 0; k < N; k++) for (let j = 0; j < RAD; j++){
        const under = j >= 2 && j <= 3;                       // the sucker side, paler
        const c = tmpC.copy(top).lerp(belly, under ? .85 : .1 + .2 * k / N);
        col.set([c.r, c.g, c.b], (k * RAD + j) * 3);
        if (k < N - 1){ const a0 = k * RAD + j, a1 = k * RAD + (j + 1) % RAD, b0 = a0 + RAD, b1 = a1 + RAD; idx.push(a0, b0, a1, a1, b0, b1); }
      }
      const tipI = N * RAD; col.set([belly.r, belly.g, belly.b], tipI * 3);
      for (let j = 0; j < RAD; j++) idx.push((N - 1) * RAD + j, tipI, (N - 1) * RAD + (j + 1) % RAD);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, skin); mesh.frustumCulled = false; group.add(mesh);
      tentacles.push({ mesh, out, axis: new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, -1, 0)).normalize(), root: out.clone().multiplyScalar(.42).add(new THREE.Vector3(0, .05, 0)), ph: rand() * 6.28 });
    }
    const dir = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), q = new THREE.Quaternion(), tmp = new THREE.Vector3();
    function shapeTentacles(t, pulse, speed = 0){
      for (const T of tentacles){
        const p = T.mesh.geometry.attributes.position;
        // relaxed: arms spread out and the tips curl up like little springs; on the pulse they draw together
        const tuck = Math.max(pulse, speed * .7);
        dir.copy(T.out).multiplyScalar(mix(1.05, .28, tuck)).add(tmp.set(0, -.75, 0)).normalize();
        c.copy(T.root);
        for (let k = 0; k < N; k++){
          const f = k / (N - 1), r = .25 * Math.pow(1 - f, .8) + .03;
          nrm.crossVectors(dir, T.axis).normalize();
          for (let j = 0; j < RAD; j++){
            const th = j / RAD * Math.PI * 2;
            tmp.copy(nrm).multiplyScalar(Math.cos(th) * r).addScaledVector(T.axis, Math.sin(th) * r).add(c);
            p.setXYZ(k * RAD + j, tmp.x, tmp.y, tmp.z);
          }
          const ang = mix(.62, .14, tuck) * Math.pow(f, 1.6) + Math.sin(t * (1.4 + speed * 2) - f * 3.5 + T.ph) * mix(.16, .07, tuck) * f;
          q.setFromAxisAngle(T.axis, -ang); dir.applyQuaternion(q).normalize();
          c.addScaledVector(dir, L / (N - 1));
        }
        p.setXYZ(N * RAD, c.x, c.y, c.z);
        p.needsUpdate = true;
      }
    }
    group.scale.setScalar(narrow ? .2 : .23);
    scene.add(group);
    // it roams the open water near the surface, in the part of the frame left free by the text
    const zone = narrow ? { x: [-2.2, 1.4], y: [-1.6, -7], z: [-3.2, .4] } : { x: [-5.5, 2.4], y: [-1.5, -8], z: [-4.5, 1] };
    const pickSpot = out => out.set(rr(zone.x[0], zone.x[1]), rr(zone.y[1], zone.y[0]), rr(zone.z[0], zone.z[1]));
    const pos = pickSpot(new THREE.Vector3()), target = pickSpot(new THREE.Vector3());
    return { group, mantle, eyes, shapeTentacles, zone, pickSpot, pos, target, vel: new THREE.Vector3(), heading: new THREE.Vector3(1, .3, 0).normalize(),
      jet: -1, nextJet: 1.5, since: 0, blink: 3, quat: new THREE.Quaternion(), speed: 0 };
  })();

  /* ---------- Sand floor ---------- */
  const floorY = (x, z) => -44 + 1.3 * fbm(x * .06, z * .06) + .3 * fbm(x * .35 + 4, z * .35, 3)
    + .07 * Math.sin(x * .45 + z * 2.1 + 1.6 * fbm(x * .1, z * .1, 2)) + 9 * smoothstep(7, 15, Math.abs(x));
  // shared by the seabed and the sand heaped around the mask, so both read as the same ground
  const sand = C('#cdb78f'), sandD = C('#a8936f'), gravel = C('#7c725f'), sandL = C('#dccaa3');
  function sandColor(x, z, out){
    const rip = .5 + .5 * Math.sin(x * .45 + z * 2.1 + 1.6 * fbm(x * .1, z * .1, 2));
    out.copy(sand).lerp(sandL, smoothstep(.2, .6, fbm(x * .15, z * .15)) * .6).lerp(sandD, (1 - rip) * .35);
    out.lerp(gravel, smoothstep(.35, .6, fbm(x * .3 + 8, z * .3)) * .7);
    return out.lerp(rockB, smoothstep(8, 12, Math.abs(x)) * .7);
  }
  const sandMat = new THREE.MeshStandardMaterial({color:'#ffffff', vertexColors:true, roughness:1, metalness:0});
  addMurk(sandMat);
  {
    const segX = lowPower ? 100 : 150, segZ = lowPower ? 230 : 330;
    const g = new THREE.PlaneGeometry(36, 84, segX, segZ); g.rotateX(-Math.PI / 2); g.translate(0, 0, -26);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++){
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, floorY(x, z));
      sandColor(x, z, tmpC);
      col[i*3] = tmpC.r; col[i*3+1] = tmpC.g; col[i*3+2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, sandMat));
  }

  const fauna = createFauna({ scene, rand, rr, floorY, smooth, lowPower, small });

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
  addCaustics(rockMat); addMurk(rockMat);
  seed = 2024;
  const boulders = [];
  // the easter egg spot: open sand in the frame at the bottom of the page, where the light lands
  // found by casting a ray from the camera as it sits at the bottom, so it lands in the open part
  // of the screen: right of the text on desktop, below it on a phone
  const eggCam = new THREE.PerspectiveCamera(camera.fov, innerWidth / innerHeight, .1, 100);
  const bottomY = -40 + (narrow ? 1.25 : 1.05);
  if (narrow){ eggCam.position.set(.9, bottomY, 6.5); eggCam.lookAt(-.4, bottomY - 2.6, -3); }
  else { eggCam.position.set(-1.2, bottomY, 5.3); eggCam.lookAt(-2.6, bottomY - 1.5, -4); }
  eggCam.updateMatrixWorld(); eggCam.updateProjectionMatrix();
  const eggRay = new THREE.Raycaster(); eggRay.setFromCamera(new THREE.Vector2(narrow ? .05 : .32, narrow ? -.72 : -.5), eggCam);
  let eggT = 0; for (let k = 0; k < 6; k++){ const p = eggRay.ray.at(eggT, new THREE.Vector3()); const fy = floorY(p.x, p.z); eggT = (fy - eggRay.ray.origin.y) / eggRay.ray.direction.y; }
  const eggP = eggRay.ray.at(eggT, new THREE.Vector3());
  const EGG_X = eggP.x, EGG_Z = eggP.z;
  easterEgg.position.set(EGG_X, floorY(EGG_X, EGG_Z), EGG_Z);
  // the face leans back toward the camera like a stone half sunk in the sand, a little askew
  {
    const toCam = eggCam.position.clone().sub(easterEgg.position).normalize();
    const face = toCam.add(new THREE.Vector3(0, .35, 0)).normalize();
    // keep the mask's own "up" pointing up, so the face is level and only leans back
    const m4 = new THREE.Matrix4(), side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), face).normalize();
    const upv = new THREE.Vector3().crossVectors(face, side);
    maskPivot.quaternion.setFromRotationMatrix(m4.makeBasis(side, upv, face));
    maskPivot.rotateZ(-.18);                       // turned a touch off-square
    maskPivot.position.y = .38;                    // the lower third stays under the sand
  }
  // sand heaped around the mask: same colours and material as the seabed, following its relief
  // and fading into it at the edge, so it reads as buried rather than set on a plate
  {
    const R = 1.8, g = new THREE.CircleGeometry(R, 48, 0, Math.PI * 2); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), ey = easterEgg.position.y;
    for (let i = 0; i < p.count; i++){
      const lx = p.getX(i), lz = p.getZ(i), r = Math.min(1, Math.hypot(lx, lz) / R);
      const wx = EGG_X + lx, wz = EGG_Z + lz;
      const heap = .16 * Math.pow(1 - r, 1.6) * (1 + .25 * fbm(wx * 3, wz * 3, 2));
      p.setY(i, floorY(wx, wz) - ey + heap - .004 * r);
      sandColor(wx, wz, tmpC);
      col[i*3] = tmpC.r; col[i*3+1] = tmpC.g; col[i*3+2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    easterEgg.add(new THREE.Mesh(g, sandMat));
  }
  for (let i = 0; i < 30; i++){
    const x = rr(-8.5, 8.5), z = rr(3, -34), s = rr(.45, 2.1);
    if (Math.hypot(x - EGG_X, z - EGG_Z) < s + 2.6) continue;   // keep the spot clear
    boulders.push({x, z, s, sy:rr(.55, .9), y:floorY(x, z) + s * .25});
  }
  // pinnacle a little off to the side, framing the mask without hiding it
  const pinX = EGG_X - 4.2, pinZ = EGG_Z - 3.5;
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
  addMurk(gorgMat);
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
    const urch = new THREE.InstancedMesh(urchinGeo, murky(new THREE.MeshStandardMaterial({color:'#2b1631', roughness:.6, metalness:.1})), 46);
    seed = 99;
    for (let i = 0; i < 46; i++){
      let x = rr(-8, 8), z = rr(2, -30); if (Math.hypot(x - EGG_X, z - EGG_Z) < 1.9) x += 3.8; const y = floorY(x, z) + .04;
      dummy.position.set(x, y, z); dummy.rotation.set(0, rand() * 6, 0); dummy.scale.setScalar(rr(.8, 1.3)); dummy.updateMatrix(); urch.setMatrixAt(i, dummy.matrix);
    }
    scene.add(urch);

    const star = new THREE.Shape();
    for (let i = 0; i <= 10; i++){ const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? .045 : .17; i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const starGeo = new THREE.ExtrudeGeometry(star, {depth:.02, bevelEnabled:true, bevelThickness:.014, bevelSize:.016, bevelSegments:2, curveSegments:4});
    starGeo.rotateX(-Math.PI / 2);
    const stars = new THREE.InstancedMesh(starGeo, murky(new THREE.MeshStandardMaterial({color:'#c2391f', roughness:.85, metalness:0})), 16);
    for (let i = 0; i < 16; i++){
      let x = rr(-7.5, 7.5), z = rr(2, -28); if (Math.hypot(x - EGG_X, z - EGG_Z) < 1.9) x += 3.8;
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
  const target = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: msaa() });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .3, .6, .82);
  // The bloom blurs through several halving steps, so one invalid pixel (NaN, or a highlight past the
  // half-float range) spreads into a black block. Clean the input before it gets there.
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    'vec4 texel = texture2D( tDiffuse, vUv ); if (any(notEqual(texel, texel))) texel = vec4(0.); texel.rgb = min(texel.rgb, vec3(24.));');
  bloom.materialHighPassFilter.needsUpdate = true;
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
  const WX_GOALS = {
    clear: { cloud: 0, haze: 0, rain: 0, sea: 1 },
    rain: { cloud: .8, haze: .3, rain: .75, sea: 1.35 },
    storm: { cloud: 1, haze: .35, rain: 1, sea: 2.6 },
    fog: { cloud: .35, haze: .88, rain: 0, sea: .8 },
    special: { cloud: 0, haze: 0, rain: 0, sea: 1 },
  };
  // start already in this visit's weather, no fade-in on load
  const wx0 = WX_GOALS[dive.weather] || WX_GOALS.clear;
  const wx = { ...wx0, dusk: dive.weather === 'special' && !dive.night ? 1 : 0, meteor: dive.weather === 'special' && dive.night ? 1 : 0 };
  const lDusk = new THREE.Color('#ffb27a');

  let pointer = {x:0, y:0}, pSmooth = {x:0, y:0};
  if (!small) addEventListener('pointermove', e => { pointer.x = e.clientX / innerWidth - .5; pointer.y = e.clientY / innerHeight - .5; });

  function applySize(){
    narrow = small || innerWidth / innerHeight < .85;
    camera.fov = narrow ? 62 : 52;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false);
    composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
    const sm = msaa();
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== sm){ rt.samples = sm; rt.dispose(); }
    snow.uniforms.uPR.value = glow.uniforms.uPR.value = pr;
  }
  addEventListener('resize', applySize);
  // frame-time watchdog: drop the resolution a step when the average frame is slow, and bring it
  // back after a long run of quick frames
  const perf = { n: 0, sum: 0, good: 0, warm: 0 };
  function watchPerf(raw){
    perf.warm += raw; if (perf.warm < 3 || document.hidden) return;   // ignore start-up and shader compiles
    perf.sum += raw; if (++perf.n < 60) return;
    const avg = perf.sum / perf.n; perf.n = perf.sum = 0;
    if (avg > 1 / 48 && pr > PR_MIN){ pr = Math.max(PR_MIN, pr - .25); perf.good = 0; applySize(); }
    else if (avg < 1 / 55 && pr < PR_MAX && ++perf.good >= 4){ pr = Math.min(PR_MAX, pr + .25); perf.good = 0; applySize(); }
  }

  const clock = new THREE.Clock();
  let t = 0, firstFrame = true;
  const tmpV = new THREE.Vector3();
  const swim = { prevD:null, vel:0, breath:0, effort:{x:0, v:0}, pitch:{x:-.04, v:0}, amp:{x:.3, v:0}, rate:{x:.45, v:0},
    lead:{x:0, v:0}, down:{x:0, v:0}, up:{x:0, v:0}, yaw:{x:0, v:0}, light:0, flicker:-1, lightOn:false };
  const diverState = { rate:.45, amp:.3, descend:0, ascend:0, dt:0 };
  const lightAim = new THREE.Vector3(), lightGoal = new THREE.Vector3(), lightPos = new THREE.Vector3();
  let lightAimInit = false;
  const eggAimOffset = new THREE.Vector3(0, 0, -.9);   // centre of the pool just behind the mask

  const oDir = new THREE.Vector3(), oX = new THREE.Vector3(), oY = new THREE.Vector3(), oZ = new THREE.Vector3(), oM = new THREE.Matrix4();
  const oE = new THREE.Euler(), qUp = new THREE.Quaternion(), qSwim = new THREE.Quaternion(), qGoal = new THREE.Quaternion();
  function updateOcto(dt){
    const o = octo, JET = .6;
    if (o.pos.distanceTo(o.target) < .8){ let k = 0; do o.pickSpot(o.target); while (o.target.distanceTo(o.pos) < 3 && ++k < 8); }
    // aim: turn the heading toward the target, faster while gliding than mid-jet
    oDir.copy(o.target).sub(o.pos).normalize();
    o.heading.lerp(oDir, Math.min(1, dt * (o.jet >= 0 ? .6 : 1.4))).normalize();
    o.since += dt;
    if (o.jet < 0 && o.since > o.nextJet){ o.jet = 0; o.since = 0; o.nextJet = rr(1.6, 3.6); }
    let pulse = 0;
    if (o.jet >= 0){
      o.jet += dt;
      const f = o.jet / JET;
      pulse = Math.sin(Math.min(1, f) * Math.PI);
      o.vel.addScaledVector(o.heading, 3.4 * pulse * dt);
      if (f >= 1) o.jet = -1;
    } else pulse = 0;
    o.vel.multiplyScalar(Math.exp(-dt * 1.25));
    o.vel.y -= .05 * dt;                                          // a slow sink while it glides
    o.pos.addScaledVector(o.vel, dt);
    // keep it inside its patch of water
    o.pos.x = THREE.MathUtils.clamp(o.pos.x, o.zone.x[0] - .5, o.zone.x[1] + .5);
    o.pos.y = THREE.MathUtils.clamp(o.pos.y, o.zone.y[1] - .5, o.zone.y[0]);
    o.pos.z = THREE.MathUtils.clamp(o.pos.z, o.zone.z[0] - .5, o.zone.z[1] + .5);
    const speed = o.vel.length();
    o.speed += (Math.min(1, speed / .8) - o.speed) * Math.min(1, dt * 4);
    // orientation: upright and facing the camera at rest, mantle first along the travel when fast
    oZ.set(camera.position.x - o.pos.x, 0, camera.position.z - o.pos.z).normalize();
    qUp.setFromRotationMatrix(oM.lookAt(oX.copy(oZ).add(o.pos), o.pos, oY.set(0, 1, 0)));
    qUp.multiply(qGoal.setFromEuler(oE.set(-.12 + Math.sin(t * .5) * .06, Math.sin(t * .3) * .3, Math.sin(t * .45) * .08)));
    if (speed > 1e-4){
      oY.copy(o.vel).normalize();
      oZ.set(camera.position.x - o.pos.x, camera.position.y - o.pos.y, camera.position.z - o.pos.z).normalize();
      oZ.addScaledVector(oY, -oZ.dot(oY)); if (oZ.lengthSq() < 1e-4) oZ.set(0, 0, 1); oZ.normalize();
      oX.crossVectors(oY, oZ);
      qSwim.setFromRotationMatrix(oM.makeBasis(oX, oY, oZ));
    } else qSwim.copy(qUp);
    qGoal.copy(qUp).slerp(qSwim, smooth(.12, .7, speed) * .9);
    o.quat.slerp(qGoal, 1 - Math.exp(-dt * 4));
    o.group.position.copy(o.pos);
    o.group.quaternion.copy(o.quat);
    o.mantle.scale.set(1 - .14 * pulse, 1 + .1 * pulse, 1 - .14 * pulse);
    // blink now and then
    o.blink -= dt;
    const shut = o.blink < 0 && o.blink > -.13;
    if (o.blink < -.13) o.blink = rr(2.5, 5.5);
    o.eyes.forEach(e => { e.scale.y = shut ? .12 : 1; });
    o.shapeTentacles(t, pulse, o.speed);
  }

  function frame(){
    const raw = clock.getDelta();
    watchPerf(raw);
    const dt = Math.min(raw, DT_MAX);
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
    // weather: ease toward what this visit drew (weather.js); the special state is a sunset by
    // day and a meteor shower by night, so it follows the day/night switch
    const wGoal = WX_GOALS[dive.weather] || WX_GOALS.clear, wk = dive.reduce ? 1 : Math.min(1, dt * 1.5);
    wx.cloud += (wGoal.cloud - wx.cloud) * wk; wx.haze += (wGoal.haze - wx.haze) * wk; wx.rain += (wGoal.rain - wx.rain) * wk;
    wx.sea += (wGoal.sea - wx.sea) * (dive.reduce ? 1 : Math.min(1, dt * .6)); WX.uSea.value = wx.sea;
    const special = dive.weather === 'special' ? 1 : 0;
    wx.dusk += (special * (1 - (dive.night ? 1 : 0)) - wx.dusk) * wk; wx.meteor += (special * (dive.night ? 1 : 0) - wx.meteor) * wk;
    // lightning: a strike every few seconds, two quick flashes and a fading glow (never with reduced motion)
    let flash = 0;
    if (dive.weather === 'storm' && !dive.reduce){
      storm.next -= dt;
      if (storm.next < 0){ storm.t = 0; storm.next = 5 + Math.random() * 9; newBolt(); }
    }
    if (storm.t >= 0){
      storm.t += dt; const f = storm.t;
      flash = f < .07 ? 1 : f < .14 ? .12 : f < .22 ? .75 : .75 * Math.exp(-(f - .22) * 9);
      if (f > .7){ storm.t = -1; flash = 0; }
    }
    WX.uCloud.value = wx.cloud; WX.uHaze.value = wx.haze; WX.uRain.value = wx.rain; WX.uDusk.value = wx.dusk; WX.uMeteor.value = wx.meteor; WX.uFlash.value = flash;

    lightDir.copy(sunDir).lerp(duskDir, wx.dusk).lerp(moonDir, n).normalize();
    const sinA = Math.hypot(lightDir.x, lightDir.z), sinW = sinA / 1.333, cosW = Math.sqrt(1 - sinW * sinW);
    lightDirW.set(lightDir.x / sinA * sinW, cosW, lightDir.z / sinA * sinW);

    // camera: starts above the waves, then sinks under
    pSmooth.x += (pointer.x - pSmooth.x) * .04; pSmooth.y += (pointer.y - pSmooth.y) * .04;
    const camY = -dRaw + (narrow ? 1.25 : 1.05);
    const above = smooth(1.3, 3.2, camY);
    const isAbove = camY > SURF + .15;
    if (narrow){
      camera.position.set(.9, camY, 6.5);
      camera.lookAt(-.4, camY + mix(-2.6, .95, above), -3);
    } else if (OCTO_CAM && octo.group.visible){
      camera.position.copy(octo.group.position).add(tmpV.set(.35, .15, 1.5));
      camera.lookAt(octo.group.position.x, octo.group.position.y + .05, octo.group.position.z);
    } else if (CLOSE){
      camera.position.set(diverRoot.position.x + CLOSE[0], diverRoot.position.y + CLOSE[1], CLOSE[2]);
      camera.lookAt(diverRoot.position.x + .3, diverRoot.position.y, 0);
    } else {
      camera.position.set(-1.2 + pSmooth.x * .8, camY - pSmooth.y * .5 * (1 - above), 5.3);
      camera.lookAt(-2.6, camY + mix(-1.5, .75, above), -4);
    }

    // atmosphere under water
    ramp(dayW, d, tmpA); ramp(nightW, d, tmpB); fogCol.copy(tmpA).lerp(tmpB, n);
    scene.fog.density = mix(.03 + d * .0006, .042 + d * .0005, n) * (1 + .4 * wx.haze + .15 * wx.cloud);
    scene.fog.color.copy(fogCol);
    sky.visible = isAbove;
    sky.position.copy(camera.position);
    skyMat.uniforms.uTime.value = t; skyMat.uniforms.uNight.value = n;

    const air = isAbove ? 1 : 0;
    hemi.intensity = mix(mix(1.4 * Math.exp(-d / 14) + .45, .5 * Math.exp(-d / 10) + .1, n), mix(1.6, .35, n), air);
    hemi.color.copy(lSurf).lerp(lDeep, Math.min(1, d / 18)).lerp(tmpA.copy(mSurf).lerp(mDeep, Math.min(1, d / 14)), n);
    sun.intensity = mix(mix(2.4 * Math.exp(-d / 12), .7 * Math.exp(-d / 8), n), mix(2.8, .6, n), air);
    sun.color.copy(lSurf).lerp(lDeep, Math.min(1, d / 14)).lerp(tmpA.copy(mSurf).lerp(mDeep, Math.min(1, d / 12)), n);
    if (isAbove) sun.color.copy(lAir).lerp(lDusk, wx.dusk).lerp(mAir, n);
    else sun.color.lerp(lDusk, wx.dusk * .35 * (1 - n));
    // clouds and fog take the edge off the sun; lightning lights everything for an instant
    sun.intensity *= (1 - .6 * wx.cloud) * (1 - .3 * wx.haze) * (1 - .25 * wx.dusk * (1 - air));
    hemi.intensity *= (1 - .3 * wx.cloud) * (1 - .15 * wx.dusk);
    hemi.intensity += flash * (air ? 2.6 : 1.8 * Math.exp(-d / 9));
    rain.visible = isAbove && wx.rain > .01;
    rainMat.uniforms.uTime.value = t; rainMat.uniforms.uCam.value.copy(camera.position); rainMat.uniforms.uNight.value = n;
    bolt.visible = isAbove && flash > .02; boltMat.opacity = Math.min(1, flash * 1.4);
    sun.target.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(isAbove ? lightDir : lightDirW, 30);

    // the boat on the horizon, only while we are above the water
    boat.visible = isAbove && boat.children.length > 0;
    if (boat.visible){
      const bx = boat.position.x, bz = boat.position.z;
      // it rides the same sea as the surface; in a storm it pitches and rolls hard and yaws off course
      const rough = Math.max(0, wx.sea - 1);
      boat.position.y = SURF + swell(bx, bz, t) * .8 - .05;
      boat.rotation.set((swell(bx, bz + 3, t) - swell(bx, bz - 3, t)) * (.08 + .05 * rough) + Math.sin(t * .9) * .03 * rough,
        boat.userData.yaw + Math.sin(t * .05) * .06 + Math.sin(t * .33) * .12 * rough,
        (swell(bx + 2, bz, t) - swell(bx - 2, bz, t)) * (.14 + .08 * rough) + Math.sin(t * .6) * (.02 + .05 * rough), 'YXZ');
      boatHaze.uHaze.value.setRGB(.42, .67, .86).lerp(tmpB.setRGB(.03, .055, .11), n);
      boatHaze.uHazeK.value = Math.min(.96, mix(.22, .42, n) + .6 * wx.haze * (1 - .5 * wx.cloud) + .15 * wx.cloud);
      boatHaze.uHaze.value.lerp(tmpB.setRGB(.7, .75, .79).multiplyScalar(1 - .42 * wx.cloud * wx.cloud).lerp(tmpA.setRGB(.055, .065, .085), n), wx.haze).lerp(tmpB.setRGB(.5, .54, .58).multiplyScalar(1 - .9 * n), wx.cloud * .7 * (1 - wx.haze));
    }
    surface.visible = camY > -24;
    surfMat.uniforms.uTime.value = t; surfMat.uniforms.uFade.value = Math.exp(-d / 7); surfMat.uniforms.uFog.value.copy(fogCol); surfMat.uniforms.uNight.value = n;
    causU.uTime.value = t; causU.uCaus.value = (1 - n) * (1 - .8 * wx.cloud) * (1 - .4 * wx.haze);

    const rayOp = mix(Math.exp(-d / 6), .4 * Math.exp(-d / 7), n) * (isAbove ? 0 : 1) * (1 - .75 * wx.cloud) * (1 - .45 * wx.haze);
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

    // diver: everything follows the actual vertical speed through springs, so a scroll of any
    // speed or direction turns into a continuous movement
    if (swim.prevD === null) swim.prevD = dRaw;
    const vRaw = dt > 0 && !dive.reduce ? (dRaw - swim.prevD) / dt : 0; swim.prevD = dRaw;
    swim.vel += (vRaw - swim.vel) * (1 - Math.exp(-dt / .2));
    const vel = swim.vel;                                   // m/s, positive going down
    const effort = spring(swim.effort, Math.tanh(Math.abs(vel) / 6), 2.2, dt);
    const down = spring(swim.down, smooth(.4, 3, vel), 3, dt);     // how much it is descending
    const up = spring(swim.up, smooth(.4, 3, -vel), 3, dt);        // how much it is ascending
    // descending: head down, gliding with light kicks; ascending: head up, slow, letting the BCD lift
    const pitch = spring(swim.pitch, -.04 - .7 * down * (.6 + .4 * effort) + .62 * up, 2.6, dt);
    const amp = spring(swim.amp, (.3 + .55 * effort) * (1 - .35 * up) * (1 - .2 * down), 2.4, dt);
    const rate = spring(swim.rate, (.42 + .7 * effort) * (1 - .3 * up), 2.4, dt);
    const lead = spring(swim.lead, -.5 * Math.tanh(vel / 6), 1.5, dt);
    // a small turn into the direction of travel, like a diver steering with the body
    const yaw = spring(swim.yaw, .18 * (down - up), 1.6, dt);
    swim.breath += dt * speed / mix(4.6, 3.0, effort);
    const breathe = Math.sin(swim.breath * Math.PI * 2);
    diverRoot.position.set(narrow ? -.4 : -.75, y + lead + breathe * .035, 0);
    diverRoot.rotation.y = -1.95 + yaw + Math.sin(t * .23) * .05;
    diverPitch.rotation.x = pitch + breathe * .015;
    diverRoll.rotation.z = Math.sin(t * .4) * .025 + yaw * .25;

    if (diverRig){
      diverState.rate = rate * speed; diverState.amp = amp; diverState.descend = down; diverState.ascend = up; diverState.dt = dive.reduce ? 0 : dt;
      updateDiver(diverRig, diverState);
    }

    // dive light: on in the deep and at night, with a short flicker when it comes on
    const wantLight = !isAbove && (dive.night ? d > .5 : (swim.lightOn ? d > 24 : d > 26));
    if (wantLight !== swim.lightOn){ swim.lightOn = wantLight; swim.flicker = wantLight ? 0 : -1; }
    let lightTarget = swim.lightOn ? 1 : 0;
    if (swim.flicker >= 0){ swim.flicker += dive.reduce ? 1 : dt; const f = swim.flicker; lightTarget = f < .08 ? 1 : f < .16 ? .1 : f < .26 ? .9 : f < .3 ? .3 : 1; if (f > .35) swim.flicker = -1; }
    swim.light = (swim.flicker >= 0 || dive.reduce) ? lightTarget : swim.light + (lightTarget - swim.light) * Math.min(1, dt * 6);
    lightRig.visible = !!diverRig && swim.light > .01;
    if (diverRig){
      diverRig.lightAnchor.getWorldPosition(lightPos);
      // ahead and down along the swim; near the bottom it settles on the easter egg
      lightGoal.set(lightPos.x + 4.6 + Math.sin(t * .3) * .4, lightPos.y - 2.4 + pitch * 2 + Math.sin(t * .4) * .25, -3);
      lightGoal.lerp(tmpV.copy(easterEgg.position).add(eggAimOffset), smooth(31, 38.5, d));
      if (!lightAimInit){ lightAim.copy(lightGoal); lightAimInit = true; }
      lightAim.lerp(lightGoal, 1 - Math.exp(-dt * 2.4));
      lightRig.position.copy(lightPos);
      lightRig.lookAt(tmpV.copy(lightPos).multiplyScalar(2).sub(lightAim));    // the light points down its -z axis
      spotTarget.position.set(0, 0, -lightPos.distanceTo(lightAim));
    }
    spot.intensity = swim.light * mix(85, narrow ? 22 : 38, smooth(31, 38.5, d));
    spot.angle = mix(.34, .42, smooth(31, 38.5, d));
    beamMat.uniforms.uOpacity.value = swim.light;
    coreMat.uniforms.uOpacity.value = swim.light * .8;

    // bubbles
    if (diverRig) diverRig.mouth.getWorldPosition(regWorld); else regWorld.set(0, -999, 0);
    const breath = diverRig && (swim.breath % 1) < .3;
    bubTimer += dt * speed;
    if (breath && bubTimer > .06){
      bubTimer = 0;
      for (let k = 0; k < 2; k++){ const b = bub[bubIdx]; bubIdx = (bubIdx + 1) % BUB; b.alive = true; b.p.copy(regWorld).add(tmpV.set(rr(-.04, .04), 0, rr(-.04, .04))); b.s = rr(.012, .04); b.life = 0; }
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
    fauna.update(t, dive.reduce ? 0 : dt, camY);
    // octopus: it swims like a real one, by jets. Between jets it turns toward wherever it wants
    // to go and glides with its arms spread; on a jet the mantle squeezes, the arms close behind it
    // and it shoots off head first. When it slows down it turns upright and looks at you again.
    if (Math.abs(camY - octo.pos.y) < 15){
      octo.group.visible = true;
      updateOcto(dive.reduce ? 0 : dt);
    } else octo.group.visible = false;
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
    billboards.forEach(b => { if (b.visible) b.quaternion.copy(camera.quaternion); });

    fill.position.set(camera.position.x, camera.position.y, camera.position.z - 1);
    fill.intensity = isAbove ? 0 : mix(.8 + smooth(10, 30, d) * 2.4, 5, n);

    composer.render();
    if (firstFrame){ firstFrame = false; canvas.classList.add('ready'); }
    requestAnimationFrame(frame);
  }
  try { renderer.compile(scene, camera); } catch (e) {}
  requestAnimationFrame(frame);
  if (import.meta.env.DEV) window.__scene = { dive, swim, bub, regWorld, camera, diverRoot, easterEgg, lightAim, rig: () => diverRig };
}
