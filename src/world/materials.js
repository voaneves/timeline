import { MeshStandardMaterial } from "three";

// Standard PBR materials (reflect the procedural env map) with a soft warm rim light and
// an optional wind-sway vertex shader for instanced grass.
export const uniforms = { uTime: { value: 0 } };

export function mat(params = {}, { sway = false, rim = 0.32 } = {}) {
  const m = new MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...params });
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
