import { HalfFloatType, Vector2, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Post chain: MSAA scene render -> bloom (signal-red emissives) -> tone map -> grade pass
// (vignette, brand colour grade, blur used when a card is open).
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 }, uVig: { value: 0.5 }, uRes: { value: new Vector2(1, 1) } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur; uniform float uVig; uniform vec2 uRes; varying vec2 vUv;
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
      col = (col - 0.5) * 1.07 + 0.5;
      col *= vec3(1.03, 1.0, 0.95);
      col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.1);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.28, length(d * vec2(1.0, 1.15)));
      col *= mix(1.0, v, uVig);
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
  const bloom = new UnrealBloomPass(new Vector2(w, h), 0.55, 0.5, 1.0);
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
    setBlur(v) {
      grade.uniforms.uBlur.value = v;
    },
    setBloom(on) {
      bloom.enabled = on;
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
