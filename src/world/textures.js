import { CanvasTexture, NearestFilter, SRGBColorSpace, PlaneGeometry } from "three";

const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

const finish = (canvas, crisp) => {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  if (crisp) {
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
  }
  return t;
};

// Block atlas: 256x256, 4x4 cells of 64px. Cream face, embossed signal dot, year in mono.
export function makeBlockAtlas(years) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  years.forEach((year, i) => {
    const x = (i % 4) * 64;
    const y = Math.floor(i / 4) * 64;
    g.fillStyle = "#f4ead4";
    g.fillRect(x, y, 64, 64);
    g.fillStyle = "#ffffff";
    g.fillRect(x, y, 64, 3);
    g.fillRect(x, y, 3, 64);
    g.fillStyle = "#cdbf9b";
    g.fillRect(x, y + 61, 64, 3);
    g.fillRect(x + 61, y, 3, 64);
    g.fillStyle = "#b80000";
    g.beginPath();
    g.arc(x + 32, y + 26, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f50000";
    g.beginPath();
    g.arc(x + 31, y + 25, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0a0a0a";
    g.font = `700 15px ${MONO}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(year), x + 32, y + 51);
  });
  return finish(c, true);
}

// Emissive companion: only the signal dots glow (feeds the bloom pass).
export function makeDotAtlas(count) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < count; i++) {
    const x = (i % 4) * 64;
    const y = Math.floor(i / 4) * 64;
    g.fillStyle = "#ff1a1a";
    g.beginPath();
    g.arc(x + 31, y + 25, 11, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c, true);
}

// Remap a BoxGeometry so every face shows cell `i` of the 4x4 block atlas.
export function cellUV(geometry, i) {
  const u0 = (i % 4) / 4;
  const v1 = 1 - Math.floor(i / 4) / 4;
  const uv = geometry.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, u0 + uv.getX(k) / 4, v1 - (1 - uv.getY(k)) / 4);
  }
  uv.needsUpdate = true;
  return geometry;
}

// Label atlas: 512x512, 2 columns x 8 rows of 256x64 plates (ink on cream, brand contrast).
export function makeLabelAtlas(labels) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  labels.forEach((text, i) => {
    const x = (i % 2) * 256;
    const y = Math.floor(i / 2) * 64;
    g.fillStyle = "#0a0a0a";
    g.fillRect(x, y, 256, 64);
    g.fillStyle = "#f4ead4";
    g.fillRect(x + 4, y + 4, 248, 56);
    g.fillStyle = "#0a0a0a";
    let size = 28;
    g.textAlign = "center";
    g.textBaseline = "middle";
    do {
      g.font = `700 ${size}px ${MONO}`;
      size -= 2;
    } while (g.measureText(text).width > 232 && size > 10);
    g.fillText(text, x + 128, y + 34);
  });
  return finish(c, false);
}

// Plane showing label cell `i` of the label atlas.
export function labelPlane(i, w = 3.2) {
  const g = new PlaneGeometry(w, w / 4);
  const u0 = (i % 2) / 2;
  const row = Math.floor(i / 2);
  const vTop = 1 - row / 8;
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, u0 + uv.getX(k) / 2, vTop - (1 - uv.getY(k)) / 8);
  }
  return g;
}
