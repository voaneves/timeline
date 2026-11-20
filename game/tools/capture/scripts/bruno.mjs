// Scripted input for https://bruno-simon.com (vehicle). Used with: record.mjs --script scripts/bruno.mjs
// Desktop: click "Click to start", then WASD/arrows. Mobile (touch): tap to start, then drag a virtual joystick.
export default async function ({ page, cdp, P, mark, sleep, remaining }) {
  // Wait for the world: network quiet for 1.5 s and a canvas present (loader/intro finished).
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  mark('worldReady');
  const cx = P.w / 2, cy = P.h / 2;
  // Context has no hasTouch, so touch goes through CDP (Input.dispatchTouchEvent).
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(60); await touch('touchEnd'); };
  // The intro gate is the class `input-filter-intro` on <html>; it disappears once the start click is accepted.
  const gated = () => page.evaluate(() => document.documentElement.classList.contains('input-filter-intro')).catch(() => true);
  const tries = P.mobile
    ? [[cx, cy], [P.w * 0.8, P.h * 0.42], [cx, cy], [P.w * 0.6, P.h * 0.5]]
    : [[cx, cy], [cx, cy]];
  let clicked = false;
  for (let i = 0; i < (P.mobile ? 12 : 1) && remaining() > 3000; i++) {
    const [x, y] = tries[i % tries.length];
    if (!clicked) { mark('startClick'); clicked = true; }
    if (P.mobile) { await tap(x, y); await sleep(300); if (await gated()) { await page.mouse.click(x, y); } }
    else await page.mouse.click(x, y);
    await sleep(1200);
    if (!P.mobile) { for (let k = 0; k < 6 && (await gated()); k++) await sleep(500); mark((await gated()) ? 'inputAssumed(gate class not cleared)' : 'inputAccepted'); break; }
    if (!(await gated())) { mark('inputAccepted'); break; } // world accepts input from this point
  }
  await sleep(800);

  if (!P.mobile) {
    const seq = [
      [['KeyW'], 2500], [['KeyW', 'KeyD'], 1800], [['KeyW'], 1500], [['KeyW', 'KeyA'], 2200],
      [['KeyW'], 1200], [['KeyS'], 1200], [['KeyW', 'KeyA'], 1800], [['KeyW', 'KeyD'], 2000],
    ];
    let first = true;
    while (remaining() > 600) {
      for (const [keys, ms] of seq) {
        if (remaining() < 300) return;
        for (const k of keys) await page.keyboard.down(k);
        if (first) { mark('firstKeyDown'); first = false; }
        await sleep(Math.min(ms, remaining()));
        for (const k of keys.reverse()) await page.keyboard.up(k);
        await sleep(150);
      }
    }
  } else {
    // Joystick: press low-left, drag up/side, release. CDP touch events (id 1).
    const bx = P.w * 0.25, by = P.h * 0.75;
    const dirs = [[0, -60], [50, -50], [0, -60], [-50, -50], [0, -60], [0, 50], [-50, -40], [50, -40]];
    let first = true;
    while (remaining() > 600) {
      for (const [dx, dy] of dirs) {
        if (remaining() < 300) return;
        await touch('touchStart', bx, by);
        for (let i = 1; i <= 5; i++) { await touch('touchMove', bx + dx * i / 5, by + dy * i / 5); await sleep(40); }
        if (first) { mark('firstTouchDrag'); first = false; }
        await sleep(Math.min(2000, remaining()));
        await touch('touchEnd');
        await sleep(150);
      }
    }
  }
}
