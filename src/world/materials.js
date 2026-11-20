import { BackSide, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RedFormat } from "three";

// Brand look: a 4-step toon ramp, a soft warm rim and ink (#0a0a0a) inverted-hull outlines.
export const uniforms = { uTime: { value: 0 } };

const ramp = new DataTexture(new Uint8Array([84, 150, 208, 255]), 4, 1, RedFormat);
ramp.minFilter = ramp.magFilter = NearestFilter;
ramp.needsUpdate = true;

const KEYS = ["color", "map", "emissive", "emissiveMap", "emissiveIntensity", "vertexColors", "side", "transparent", "opacity"];

export function mat(params = {}, { sway = false, rim = 0.26 } = {}) {
  const p = {};
  for (const k of KEYS) if (params[k] !== undefined) p[k] = params[k];
  const m = new MeshToonMaterial({ gradientMap: ramp, ...p });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    if (sway) {
      shader.vertexShader =
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
          float bend = position.y * position.y * 0.9;
          float gust = sin(uTime * 0.7 + wp.x * 0.11) * 0.5 + 0.5;
          transformed.x += (sin(uTime * 2.3 + wp.x * 0.9 + wp.z * 0.7) * 0.6 + gust) * bend * 0.5;
          transformed.z += cos(uTime * 1.9 + wp.x * 0.6) * bend * 0.3;`
        );
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
