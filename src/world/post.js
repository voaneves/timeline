import { HalfFloatType, Vector2, Vector3, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Post chain: MSAA scene render -> bloom (signal-red emissives) -> tone map -> grade pass
// (vignette, brand colour grade, blur used when a card is open).
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uWipe: { value: 0 }, uBlur: { value: 0 }, uVig: { value: 0.5 }, uRes: { value: new Vector2(1, 1) }, uTint: { value: new Vector3(1, 1, 1) }, uSun: { value: new Vector2(0.8, 1.2) }, uRays: { value: 0 }, uInk: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uWipe; uniform float uBlur; uniform float uVig; uniform vec2 uRes; uniform vec3 uTint; uniform vec2 uSun; uniform float uRays; uniform float uInk; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (uBlur > 0.002) {
        vec2 px = uBlur * 5.0 / uRes;
        vec4 s = c * 0.16;
        s += texture2D(tDiffuse, vUv + vec2( px.x, 0.0)) * 0.105;
        s += texture2D(tDiffuse, vUv + vec2(-px.x, 0.0)) * 0.105;
        s += texture2D(tDiffuse, vUv + vec2(0.0,  px.y)) * 0.105;
        s += texture2D(tDiffuse, vUv + vec2(0.0, -px.y)) * 0.105;
        s += texture2D(tDiffuse, vUv + px) * 0.1;
        s += texture2D(tDiffuse, vUv - px) * 0.1;
        s += texture2D(tDiffuse, vUv + vec2(px.x, -px.y)) * 0.1;
        s += texture2D(tDiffuse, vUv + vec2(-px.x, px.y)) * 0.1;
        c = s;
      }
      vec3 col = c.rgb;
      // Subtle god rays: radial blur of the bright sky toward the sun's screen position (high tier only).
      if (uRays > 0.001) {
        vec2 dir = (uSun - vUv) / 12.0;
        vec2 suv = vUv;
        float acc = 0.0;
        float w = 1.0;
        for (int i = 0; i < 12; i++) {
          suv += dir;
          vec3 sc = texture2D(tDiffuse, suv).rgb;
          float lm = dot(sc, vec3(0.299, 0.587, 0.114));
          acc += smoothstep(0.62, 0.95, lm) * w;
          w *= 0.9;
        }
        float own = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        col += vec3(1.0, 0.82, 0.52) * acc * 0.02 * uRays * (1.0 - smoothstep(0.5, 0.85, own)); // shafts over the ground, not the sky itself
      }
      col = (col - 0.5) * 1.07 + 0.5;
      col *= uTint;
      // Split tone: cool shadows, warm highlights, then a saturation lift (no grey cast).
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col *= mix(vec3(0.96, 0.99, 1.04), vec3(1.06, 1.015, 0.93), smoothstep(0.12, 0.8, lum));
      col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.18);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.28, length(d * vec2(1.0, 1.15)));
      col *= mix(1.0, v, uVig);
      if (uWipe > 0.001 && uWipe < 1.999) {
        float n = sin(vUv.y * 23.0) * 0.03 + sin(vUv.y * 61.0 + 1.7) * 0.015 + sin(vUv.y * 9.0) * 0.045;
        float e1 = clamp(uWipe, 0.0, 1.0) * 1.35 - 0.2 + n;
        float e0 = clamp(uWipe - 1.0, 0.0, 1.0) * 1.35 - 0.2 + n;
        float ink = step(vUv.x, e1) - step(vUv.x, e0);
        float inPhase = step(uWipe, 1.0);
        float eEdge = mix(e0, e1, inPhase);
        float tear = (step(vUv.x, eEdge + 0.03) - step(vUv.x, eEdge)) * inPhase + (step(vUv.x, e0 + 0.03) - step(vUv.x, e0)) * (1.0 - inPhase);
        // Film-strip ribbon on the reveal edge: ink band with cream sprocket holes, then a red ribbon.
        float fx = (vUv.x - e0 - 0.03) / 0.07;
        float strip = (1.0 - inPhase) * step(0.0, fx) * step(fx, 1.0);
        float hole = step(abs(fract(vUv.y * 26.0) - 0.5), 0.22) * step(abs(fx - 0.5), 0.3);
        float ribbon = (1.0 - inPhase) * step(1.0, fx) * step(fx, 1.28);
        float dotR = length((vUv - vec2(0.5, 0.5)) * vec2(uRes.x / uRes.y, 1.0));
        vec3 inkCol = mix(vec3(0.04), vec3(0.96, 0.0, 0.0), step(dotR, 0.07));
        col = mix(col, inkCol, ink);
        col = mix(col, vec3(0.957, 0.918, 0.831), tear);
        col = mix(col, mix(vec3(0.04), vec3(0.957, 0.918, 0.831), hole), strip);
        col = mix(col, vec3(0.96, 0.0, 0.0), ribbon);
      }
      // Red-ink burst on arrival: an expanding blotchy ring that thins out as it grows.
      if (uInk > 0.002) {
        vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        float ang = atan(q.y, q.x);
        float rr = uInk * 1.15 + sin(ang * 7.0) * 0.03 + sin(ang * 13.0 + 2.0) * 0.018;
        float dd = length(q);
        float th = 0.16 * (1.0 - uInk) + 0.01;
        float blot = smoothstep(rr - th, rr - th + 0.02, dd) * (1.0 - smoothstep(rr, rr + 0.012, dd));
        col = mix(col, vec3(0.96, 0.0, 0.0), blot * (1.0 - uInk * 0.5));
      }
      gl_FragColor = vec4(col, c.a);
    }`,
};

export function createPost(renderer, scene, camera, w, h) {
  const dpr = renderer.getPixelRatio();
  const target = new WebGLRenderTarget(w * dpr, h * dpr, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(w, h), 0.6, 0.5, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GRADE);
  composer.addPass(grade);
  grade.uniforms.uRes.value.set(w * dpr, h * dpr);
  return {
    composer,
    bloom,
    grade,
    setSize(nw, nh) {
      composer.setSize(nw, nh);
      grade.uniforms.uRes.value.set(nw * dpr, nh * dpr);
    },
    setWipe(v) {
      grade.uniforms.uWipe.value = v;
    },
    setBlur(v) {
      grade.uniforms.uBlur.value = v;
    },
    setBloom(on) {
      bloom.enabled = on;
      grade.uniforms.uRays.value = on ? 1 : 0; // god rays share the high tier with bloom
    },
    setSun(x, y, on = true) {
      grade.uniforms.uSun.value.set(x, y);
      grade.uniforms.uRays.value = on && bloom.enabled ? 1 : 0;
    },
    setTint(r, g, b) {
      grade.uniforms.uTint.value.set(r, g, b);
    },
    setInk(v) {
      grade.uniforms.uInk.value = v;
    },
    render(dt) {
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
