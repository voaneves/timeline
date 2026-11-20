import { CanvasTexture, Color, LinearFilter, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { uniforms } from "./materials.js";

// "Pull the timeline": a red ink ribbon laid on the ground. Its length is a uniform (stretching shrinks
// the width a little and adds a tension wobble); the year is a canvas texture mapped in world units, so
// it draws itself along the ribbon as the ribbon grows.
const SPAN = 4.6; // world units covered by the year texture

export function createRibbon() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  const geo = new PlaneGeometry(1, 1, 40, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    side: 2,
    uniforms: {
      uTime: uniforms.uTime,
      uTex: { value: tex },
      uLen: { value: 1 },
      uReveal: { value: 0 },
      uTension: { value: 0 },
      uWidth: { value: 0.95 },
      uRed: { value: new Color(0xf50000) },
      uInk: { value: new Color(0x0a0a0a) },
      uPaper: { value: new Color(0xf4ead4) },
    },
    vertexShader: `
      uniform float uLen; uniform float uTension; uniform float uWidth; uniform float uTime;
      varying vec2 vUv; varying float vS;
      void main(){
        vUv = uv;
        vec3 p = position;
        vS = p.x * uLen;
        float env = sin(p.x * 3.14159);
        p.x *= uLen;
        p.z *= uWidth;
        p.z += sin(p.x * 2.2 - uTime * 18.0) * uTension * 0.16 * env;
        p.y += sin(p.x * 1.3 + uTime * 9.0) * uTension * 0.05 * env;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform float uLen; uniform float uReveal; uniform vec3 uRed; uniform vec3 uInk; uniform vec3 uPaper;
      varying vec2 vUv; varying float vS;
      void main(){
        if (vS > uReveal) discard;
        float e = abs(vUv.y - 0.5);
        vec3 col = uRed * 1.7;
        // ink edges with cream sprocket holes
        float edge = smoothstep(0.4, 0.43, e);
        float hole = step(0.36, e) * step(e, 0.395) * step(abs(fract(vS * 5.0) - 0.5), 0.2);
        col = mix(col, uInk, edge);
        col = mix(col, uPaper, hole);
        // the year, drawn in cream with an ink drop shadow
        float u = vS / ${SPAN.toFixed(2)};
        if (u < 1.0) {
          float a = texture2D(uTex, vec2(u, vUv.y)).a;
          float sh = texture2D(uTex, vec2(u - 0.006, vUv.y + 0.05)).a;
          col = mix(col, uInk, sh * 0.55 * (1.0 - edge));
          col = mix(col, uPaper, a * (1.0 - edge));
        }
        // bright leading tip: the ink is still wet
        float tip = smoothstep(0.35, 0.0, uReveal - vS);
        col = mix(col, uPaper, tip * 0.55 * (1.0 - edge));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  const u = material.uniforms;
  return {
    mesh,
    // text: the year; anchor + angle place the ribbon on the ground.
    open(text, x, z, angle) {
      const g = canvas.getContext("2d");
      g.clearRect(0, 0, 1024, 128);
      g.fillStyle = "#fff";
      g.textBaseline = "middle";
      g.textAlign = "left";
      let size = 104;
      do {
        g.font = `800 ${size}px "Archivo", "Inter", system-ui, sans-serif`;
        size -= 4;
      } while (g.measureText(text).width > 900 && size > 30);
      g.fillText(text, 56, 70);
      tex.needsUpdate = true;
      mesh.position.set(x, 0.12, z);
      mesh.rotation.y = -angle;
      mesh.visible = true;
      this.set(0.05, 0, 0.05);
    },
    // len in world units; tension 0..1 drives the wobble; stretched ribbons thin out.
    set(len, tension, reveal = len) {
      const L = Math.max(0.05, len);
      u.uLen.value = L;
      u.uReveal.value = Math.max(0, reveal);
      u.uTension.value = tension;
      u.uWidth.value = 1.3 / (1 + Math.max(0, L - 1) * 0.07);
    },
    close() {
      mesh.visible = false;
    },
  };
}
