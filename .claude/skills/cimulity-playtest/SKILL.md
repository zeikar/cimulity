---
name: cimulity-playtest
description: Drive a Playwright browser to actually PLAY Cimulity through real input (keyboard tool selection + canvas clicks), then judge how the game feels. Use for gameplay/balance testing, persona playtests, and canvas-level QA — not for renderer screenshots (that is cimulity-visual-test, which seeds scenes instead of playing).
---

# Cimulity Playtest (play the game, don't seed it)

`cimulity-visual-test` injects a scene and screenshots it. This skill does the opposite: it **plays** — keyboard tool selection, real canvas clicks, watching the simulation react — so gameplay and balance can be judged rather than rendering.

## When to use

- Judging whether a mechanic *feels* right (is congestion noticeable? is money too easy?).
- Persona playtests (min-maxer / casual / QA) on a balance change.
- Canvas-level QA where the bug only appears through real input.

## When NOT to use

- Renderer/visual verification → `cimulity-visual-test`.
- Pure logic → `npm test`.

## Hard constraints

- **The Playwright MCP has ONE browser.** Never run two playtest agents concurrently — they fight over the same tab. Run personas **sequentially**, and confirm the previous one is actually stopped (Step 5) before starting the next. Each persona resets the world at the **start** of its own session, never at the end.
- The canvas has **no accessibility tree**: `browser_click` cannot target tiles. Use `browser_run_code_unsafe` → `page.mouse.click(x, y)`. The HUD (toolbar, panels, stat readouts) *is* real DOM and can be read with `innerText`.
- `window.__cimulity.dev` exposes only `seedScene / setCameraTile / markDirty / resetWorld / saveNow / regenerateTerrain / resetFlat`. There is **no `executeClick`** — placement must go through real input, which is the point.

## Step 1 — Server

Cimulity may not own port 3000 (other projects on this machine use it). Start it and read the port from the log rather than assuming:

```bash
npm run dev > /tmp/cimulity-dev.log 2>&1 &
# then grep the log for "Local: http://localhost:<port>"
```

Verify the page title is `Cimulity` after navigating — a 200 on :3000 may be a different app.

## Step 2 — Install the play kit

Navigate, wait for the dev API, then inject helpers once per page load:

```js
// browser_run_code_unsafe
async (page) => {
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      if (window.__cimulity?.world && window.__cimulity?.pixiApp) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const api = window.__cimulity;
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();

    // Camera is centred with dev.setCameraTile(cx, cy); at zoom 1 the iso basis is
    // 64x32 per tile, so a tile's screen centre is exact on FLAT ground.
    window.__kit = {
      cam: { x: 32, y: 32 },
      centre: { x: r.width / 2, y: r.height / 2 },
      recentre(tx, ty) { api.dev.setCameraTile(tx, ty); this.cam = { x: tx, y: ty }; },
      screenOf(tx, ty) {
        return [
          this.centre.x + 32 * ((tx - this.cam.x) - (ty - this.cam.y)),
          this.centre.y + 16 * ((tx - this.cam.x) + (ty - this.cam.y)),
        ];
      },
      selected() {
        const m = document.body.innerText.match(/Selected Tile:\s*\((\d+),\s*(\d+)\)/);
        return m ? { x: +m[1], y: +m[2] } : null;
      },
      state() {
        const w = api.world, t = document.body.innerText;
        const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
        return {
          money: w.getMoney(), pop: w.getPopulation(), happiness: w.getHappiness(),
          tick: num(/Tick:\s*(\d+)/), speed: (t.match(/Speed:\s*(\S+)/) || [])[1],
          demandR: num(/R:.*?([\d.]+)\n/), demandC: num(/C:.*?([\d.]+)\n/), demandI: num(/I:.*?([\d.]+)\n/),
          tool: (t.match(/Tool:\s*([^\n]+)/) || [])[1],
        };
      },
      tileAt(x, y) { return api.world.getMap().getTile(x, y)?.type; },
      // Ground truth the HUD does not show — useful for judging, not for playing.
      traffic() {
        const tm = api.world.getTrafficMap();
        let hot = 0, sum = 0, n = 0, peak = 0;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const c = tm.getCongestion(x, y);
          if (c > 0) { n++; sum += c; peak = Math.max(peak, c); if (c > 128) hot++; }
        }
        return { loadedTiles: n, meanLoad: n ? +(sum / n).toFixed(1) : 0, peak, hotTiles: hot,
                 cityIndex: +tm.getCongestionIndex().toFixed(4) };
      },
      jobs() {
        const lm = api.world.getLaborMarket();
        return { employed: lm.getEmployed(), unemployed: lm.getUnemployed(),
                 capacity: lm.getJobsCapacity(), filled: lm.getJobsFilled() };
      },
    };
    return true;
  });
}
```

## Step 3 — Play

**Tool keys** (press with `page.keyboard.press`): `s` select · `t` road · `b` bulldoze · `q`/`w`/`e` R/C/I zone · `p` power plant · `a` water tower · `c` police · `d` fire · `h` hospital · `l` school · `k` park · `r`/`f`/`g` raise/lower/level · `Space` pause · `1`/`2`/`3` speed.

**Place a tile** — select the tool once, then click tile centres:

```js
await page.keyboard.press('t');
for (let x = 28; x <= 36; x++) {
  const [sx, sy] = await page.evaluate(([x, y]) => window.__kit.screenOf(x, y), [x, 32]);
  await page.mouse.click(sx, sy);
}
```

**Verify placement** with `__kit.tileAt(x, y)` rather than trusting the click — a click that lands exactly on a tile edge can resolve to the neighbour.

### ⚠ Edge-pan drift — the #1 way a session silently goes wrong

`CameraController` auto-pans whenever the pointer sits within **32 px of any canvas edge**, at up to **600 px/s**, and it keeps panning until the pointer moves back inside. So a click aimed at a tile far from the camera centre puts the mouse in the pan margin, the camera slides away, and every later coordinate computed from a cached camera is wrong — silently. Money is still spent and tiles are still placed, just in the wrong place. Symptoms: placements landing 8–20 tiles off, or a loop that lays a checkerboard because alternate clicks drifted.

Three rules that eliminate it:

1. **Only click near the centre.** After `recentre(cx, cy)`, restrict clicks to roughly **±8 tiles** of that centre; anything further, recentre first. A safe target is ≥ 60 px inside every canvas edge — verify with `__kit.isSafe(sx, sy)`.
2. **Never trust a cached camera — read the live one.** `__kit.screenOf` below derives from `pixiApp.getCamera().getPosition()` each call, so it cannot go stale.
3. **Park the mouse at the centre when you finish a batch** (`page.mouse.move(centreX, centreY)`), otherwise a pan started by your last click keeps running while you think you are idle.

Add these to the kit (they depend only on the live camera):

```js
window.__kit.camLive = () => {
  const c = window.__cimulity.pixiApp.getCamera();
  return { pos: c.getPosition(), zoom: c.getZoom() };
};
window.__kit.isSafe = (sx, sy) => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return sx > 60 && sy > 60 && sx < r.width - 60 && sy < r.height - 60;
};
```

After any batch of placements, re-read `__kit.tileAt()` (or `getStructureMap().getAllStructures()` for 2×2 structures) to confirm what actually landed. A money delta alone proves only that *something* was placed, not that it was placed where you aimed.

**Drag, don't spam clicks.** Roads and zones support drag-place (`PointerHandler` → `executeDrag`), and a human lays a road in ONE gesture. Clicking tile-by-tile is slow, unlike real play, and costs a round trip per tile:

```js
const [x0, y0] = await page.evaluate(([x, y]) => window.__kit.screenOf(x, y), [28, 32]);
const [x1, y1] = await page.evaluate(([x, y]) => window.__kit.screenOf(x, y), [40, 32]);
await page.mouse.move(x0, y0);
await page.mouse.down();
await page.mouse.move(x1, y1, { steps: 8 }); // intermediate moves drive the drag preview
await page.mouse.up();
```

A click is suppressed after a drag (`justDragged`), so do not mix the two on one gesture.

**Elevation caveat:** the formula above is exact on flat ground. On generated terrain a raised tile's screen centre shifts UP by its height, so clicks drift. Either call `dev.resetFlat()` for a clean balance test, or click-then-verify with `__kit.selected()` and nudge `sy` upward until the intended tile is hit.

**Let time pass:** press `3` for 3× speed and `page.waitForTimeout(...)`. Growth runs on an interval, so a city needs real ticks before buildings appear, level up, or go derelict. Read `__kit.state()` before and after rather than guessing.

**Overlays:** the `[Data]` button opens the data-view selector (None/Traffic/Jobs); `[Stats]` toggles the sparkline panel. Both are ordinary DOM buttons — click them by text.

## The rules you need to play competently

You are blind to the visual channel the game teaches through (utility badges, overlays, the look of a lit vs unpowered building), so rediscovering these by trial and error costs a lot of turns and produces *your* confusion, not a player's. Take them as given.

**Everything hangs off the road network.**

- **Power / water are binary road reachability.** A power plant seeds the grid through a ROAD tile orthogonally adjacent to its own footprint; power then flows along connected road tiles. A non-road cell is powered iff it is orthogonally adjacent to a reachable road. Water towers work identically but on a separate network — a plant never sources water and a tower never powers anything. Practical consequence: **a plant sitting in a field powers nothing. It must touch a road, and every zone must touch a road connected to that same network.** Range is unlimited; connectivity is all that matters.
- **Services (police / fire / hospital / school) also travel the road network**, but with distance decay: up to `SERVICE_RANGE_TILES = 24` road hops, and a tile only counts as covered at `SERVICE_COVERAGE_THRESHOLD_RAW = 64` of 255. So a station 24+ hops away is useless, and one 15 hops away gives partial coverage.
- **Zones need road frontage to spawn at all** — a lot only forms where a cell's neighbour is a road.

**Growth gates, in order:** power gates the initial spawn → water gates level-ups and density → all four services must cover the anchor for a level-up → land value decides which level is *supported* (and, since this cycle, congestion subtracts from that land value). Growth is evaluated every `ZONE_GROWTH_INTERVAL = 8` ticks.

**Structures are placed NW-anchored** — your click is the top-left cell and the footprint extends right/down. Sizes: power plant, police, fire, hospital, school = **2×2**; water tower and park = **1×1**. The whole footprint must be free.

**Terrain:** roads, zones and structures need FLAT ground (all four tile corners at equal height) above sea level. On generated terrain this is a real constraint; `dev.resetFlat()` removes it.

**Costs:** road 10 · zone 5 · bulldoze 2 · park 100 · water tower 800 · police / fire / hospital / school 800 each · power plant 1000. You start with `STARTING_FUNDS = 10000`. Income is tax at `TAX_PER_POP = 1` per population per month — **there is no upkeep on anything**, so money only ever grows once population does.

Knowing these is not cheating: a human learns them from the tutorial-free UI in a few minutes of clicking, and they can *see* what is powered. Do NOT report "I didn't know roads carry power" as a legibility failure — you were told, and you cannot see the channel that teaches it. Legibility findings must come from what the HUD and tile-info panel *text* tell you when state changes.

## Step 4 — Judge, then report

**Play BLIND — text only.** The playtester does not look at screenshots. Everything needed to play and to judge balance is already text: the HUD `innerText`, `__kit.state()`, `__kit.tileAt()`, and the ground truth in `__kit.traffic()` / `__kit.jobs()`. Reading images costs far more than reading numbers, and it drags the run toward "does it look nice", which is a different question with a different judge.

### The X-ray problem — keep two ledgers

`window.__cimulity.world` exposes the entire simulation core: every tile, every building's level / density / `abandoned` flag, **per-tile land value**, coverage and utility maps, **per-road congestion bytes**, employment, demand. A human player sees none of that — they get the HUD, the tile-info panel, the overlays, and what the city looks like.

So a playtester with kit access can "notice" a mechanic no human could ever feel, and report it as working. That silently answers the wrong question.

Keep the two ledgers separate and label every finding with which one it came from:

- **PLAYER ledger** — what is inferable from the HUD text, the tile-info panel, the Data/Stats overlays, and the consequences you actually hit (a building you owned went derelict; a level-up you expected never came). This is the one that answers "is the mechanic legible / does it matter".
- **TRUTH ledger** — `__kit.traffic()`, `__kit.jobs()`, raw land value. Use it to *check* the player ledger, never to substitute for it. Its job is to expose the gap: a mechanic that fired hard while the player ledger stayed blank is a **legibility failure**, not a success.

When asked "did you notice X", answer from the PLAYER ledger only.

A playtest report is about **feel**, backed by numbers: what the player tried, what the game did, where it was unclear, boring, punishing, or exploitable. Use `__kit.traffic()` / `__kit.jobs()` to check whether a mechanic the player *felt* matches what actually fired — and, just as important, whether one that fired was never felt at all.

### Division of labour — do not mix these

| Question | Who answers it | How |
|---|---|---|
| Is it fun / balanced / legible? | **this skill**, blind | HUD text + kit numbers, no images |
| Does it render correctly? | `cimulity-visual-test` | seeds a scene, screenshots it |
| Does it look good? | `aesthetic-critic` agent | reads PNGs someone else already saved; it does not drive the browser |

A blind playtester still captures screenshots — but as **artifacts for the critic, not input for itself**. Shoot at a few fixed checkpoints (e.g. first buildings, mid-game, final city), name them predictably, and hand the paths on. Do not open them.

`browser_take_screenshot` writes to the **repo root**, not `.playwright-mcp/` — keep them out of commits.

## Step 5 — End the session; leave the city standing

**Do NOT reset the world when you finish.** Your final city is the measurement — whoever reads your report will want to re-derive numbers from it (peak load per road tile, the trip distribution, land value at specific anchors), and those questions only occur to them *after* reading what you wrote. A `resetWorld()` on the way out destroys the only copy. This has already cost one calibration pass.

Leave the session in a quiet, inspectable state:

1. `page.keyboard.press('Space')` — pause the simulation, so nothing drifts while someone inspects it.
2. `page.mouse.move(centreX, centreY)` — park the pointer dead-centre so the 32 px edge-pan margin cannot fire.
3. Do NOT call `resetWorld`, `resetFlat`, or `regenerateTerrain` at the end.
4. Report the final tick and a one-line summary of what is on the map, so the reader knows what they are looking at.

**Your final text is a report, not a resignation.** Emitting it does not end you — you stay live and will keep going if left alone. Stop after you deliver it: say the session is complete and take no further browser actions unless someone sends you new instructions.

### For whoever dispatched the playtest

A playtest agent is NOT finished when its report arrives, and a named background agent may not appear in `ListAgents`' subagent list at all — so an empty listing is **not** evidence that it stopped. Absence there plus a delivered report is exactly the state in which one of these has been observed to still be playing: it had already reset the world and laid 53 roads and 60 zone tiles into a fresh city while the dispatcher believed it was done.

**End it explicitly:** `TaskStop` with the agent's name (`TaskStop({ task_id: "playtest-<persona>" })`). It is harmless if the agent really has stopped. Then confirm the world is static by snapshotting tile/structure/money counts twice a couple of seconds apart and comparing — a paused, unattended city is byte-identical between reads.

Only after the world is confirmed static should you take measurements from it, or hand its screenshots to a visual critic.

## Gotchas

- After a hot reload the page's `__kit` is gone — re-inject it.
- `getTrafficMap()` and `getLaborMarket()` drain their dirty flags on read. Harmless, but it means reading them is not perfectly passive.
- `dirt` heals to grass each tick; pause before inspecting terrain edits.
- `seedScene` refuses structure tiles (power plant, water tower, stations, park) by design — place those with their tools, which is what this skill does anyway.
