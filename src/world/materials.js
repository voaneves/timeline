import { BackSide, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RedFormat, Vector2, Vector3 } from "three";

// Brand look: a 4-step toon ramp, a soft warm rim and ink (#0a0a0a) inverted-hull outlines.
// Per-blob seeds, computed on the CPU (double precision) so the shader and cloudBlobs() agree.
const fract = (v) => v - Math.floor(v);
const seeds = Array.from({ length: 6 }, (_, i) => new Vector2(fract(Math.sin(i * 12.9898 + 4.1) * 43758.5453), fract(Math.sin(i * 78.233 + 1.7) * 12345.679)));
export const uniforms = { uTime: { value: 0 }, uFocus: { value: 0 }, uCloudSeed: { value: seeds }, uPlayer: { value: new Vector3(0, -99, 0) } };
// Blob centres and radii at time t around focus x (also used by the debug hook to aim a screenshot).
export const cloudBlobs = (t, focus) =>
  seeds.map((h, i) => {
    const m = i * 10 + h.x * 6 + t * 1.5 - focus;
    return { x: m - Math.floor(m / 60) * 60 + focus - 30, z: (h.y - 0.5) * 22, r: 3.6 + h.x * 2.6 };
  });

// Cloud shadows: six soft blobs (4 units of soft edge) drift along +x at 1.5 u/s over the play
// area and wrap around the focus x, so there is always one near the camera. Ground only (cloud: true).
const CLOUD_GLSL = `
uniform float uTime; uniform float uFocus; uniform vec2 uCloudSeed[6]; varying vec2 vCsW;
float cloudShade(vec2 p) {
  float k = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float h = uCloudSeed[i].x;
    float h2 = uCloudSeed[i].y;
    float cx = mod(fi * 10.0 + h * 6.0 + uTime * 1.5 - uFocus, 60.0) + uFocus - 30.0;
    float cz = (h2 - 0.5) * 22.0;
    float r = 3.6 + h * 2.6;
    vec2 d = (p - vec2(cx, cz)) / vec2(1.45, 1.0);
    k = max(k, 1.0 - smoothstep(r - 2.0, r + 2.0, length(d)));
  }
  // ~3% low-amplitude surface grain (a fake bump) on top of the cloud shade.
  float grain = sin(p.x * 3.1 + sin(p.y * 1.7)) * sin(p.y * 2.9 - p.x * 0.8) + sin(p.x * 7.3 + p.y * 5.1) * 0.5;
  return (1.0 - 0.21 * k) * (1.0 + grain * 0.02);
}`;

const ramp = new DataTexture(new Uint8Array([84, 150, 208, 255]), 4, 1, RedFormat);
ramp.minFilter = ramp.magFilter = NearestFilter;
ramp.needsUpdate = true;

const KEYS = ["color", "map", "emissive", "emissiveMap", "emissiveIntensity", "vertexColors", "side", "transparent", "opacity"];

export function mat(params = {}, { sway = false, rim = 0.26, cloud = false } = {}) {
  const p = {};
  for (const k of KEYS) if (params[k] !== undefined) p[k] = params[k];
  const m = new MeshToonMaterial({ gradientMap: ramp, ...p });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    if (sway) {
      shader.uniforms.uPlayer = uniforms.uPlayer;
      shader.vertexShader =
        "uniform float uTime; uniform vec3 uPlayer; varying float vTip;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
          float bend = position.y * position.y * 0.9;
          float gust = sin(uTime * 0.7 + wp.x * 0.11) * 0.5 + 0.5;
          transformed.x += (sin(uTime * 2.3 + wp.x * 0.9 + wp.z * 0.7) * 0.6 + gust) * bend * 0.5;
          transformed.z += cos(uTime * 1.9 + wp.x * 0.6) * bend * 0.3;
          vTip = position.y;
          // Blades bend away from the avatar (radius ~1.2) and flatten a little.
          vec2 away = wp.xz - uPlayer.xz;
          float pd = length(away);
          float push = smoothstep(1.25, 0.15, pd) * smoothstep(-0.2, 1.2, 1.4 - abs(uPlayer.y - wp.y));
          mat3 im3 = mat3(instanceMatrix);
          vec3 pw = vec3(away.x, 0.0, away.y) / max(pd, 0.05) * push * 0.75 * (position.y / 0.7);
          transformed += transpose(im3) * pw / max(dot(im3[0], im3[0]), 0.01);
          transformed.y -= push * position.y * 0.3;`
        );
    }
    if (sway) {
      shader.fragmentShader =
        "varying float vTip;\n" +
        shader.fragmentShader.replace("#include <opaque_fragment>", "outgoingLight += vec3(0.62, 0.55, 0.16) * smoothstep(0.3, 0.7, vTip) * 0.5;\n#include <opaque_fragment>");
    }
    if (cloud) {
      shader.uniforms.uFocus = uniforms.uFocus;
      shader.uniforms.uCloudSeed = uniforms.uCloudSeed;
      shader.vertexShader =
        (sway ? "" : "uniform float uTime;\n") + "varying vec2 vCsW;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          `vec4 csw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          csw = instanceMatrix * csw;
          #endif
          vCsW = (modelMatrix * csw).xz;
          #include <project_vertex>`
        );
      shader.fragmentShader = CLOUD_GLSL + "\n" + shader.fragmentShader.replace("#include <opaque_fragment>", "outgoingLight *= cloudShade(vCsW);\n#include <opaque_fragment>");
    }
    if (rim > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `float rimK = pow(1.0 - clamp(dot(normalize(vViewPosition), normalize(normal)), 0.0, 1.0), 3.0);
        outgoingLight += rimK * vec3(${rim.toFixed(2)}, ${(rim * 0.85).toFixed(2)}, ${(rim * 0.6).toFixed(2)});
        #include <opaque_fragment>`
      );
    }
  };
  return m;
}

// Ink outline: back faces pushed out along the normal.
export function hullMat(thick = 0.03) {
  const m = new MeshBasicMaterial({ color: 0x0a0a0a, side: BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      transformed += normalize(normal) * ${thick.toFixed(4)};`
    );
  };
  return m;
}
