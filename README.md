# THE LAST SERVER

> One persistent 3D world. One shared history. **Nobody knows who is running it.**

Everyone who connects is inside the *same* evolving simulation. There is no match, no reset, no fixed story.
What players break stays broken, what they build stays built, what they discover becomes part of the world's
mythology — and an **AI Director** watches all of it and answers back, stamping every move with a UTC timecode:

```
SERVER EVENT: 01:37:22
A BUILDING MOVES
Marrow Diner is leaving Marrow Street. In a few seconds it will stand 84 metres away, in the Lakeshore.
```

This repository is the first playable version: **one extremely dense valley (Hollowmere)** plus the whole
persistent-world machine underneath it.

```
npm install
npm start                # → http://localhost:8080
```

Open the page, pick a name, click **ENTER HOLLOWMERE**. Open a second tab (or a friend) to share the world.

**Windows, no terminal:** extract the ZIP, then double-click `BASLAT.bat` (or `BASLAT-HIZLI.bat` for the fast demo pace). It installs on first run, starts the server and opens the browser. Needs Node.js 20+.

| command | what it does |
|---|---|
| `npm start` | run the server (world is saved to `./data`, so it survives restarts) |
| `PACE=fast npm start` | demo pace: Director events every ~45 s, lake consequences in ~40 s instead of hours |
| `npm run bots -- 6 300 ws://localhost:8080/ws` | populate a dev server with wandering / throwing / demolishing bots |
| `npm test` | end-to-end self-test: join → act → consequences → **restart** → still there |
| `DAY_MINUTES=32` | length of an in-game day in real minutes (default 32) |

Environment: `PORT`, `DATA_DIR`, `PACE`, `DAY_MINUTES`, `MAX_PLAYERS`, `DEV=1` (disables movement validation — for screenshots/tests only).

---

## The idea, and where it lives in the code

**Everything players do permanently changes the server.** The world state is one JSON-serialisable object
(`server/state.js`), mirrored to every client through tiny path-patches and saved to disk every 20 s and on shutdown.

| Player action | What happens (permanently) |
|---|---|
| Blow up a building (Charge tool, fuel drums chain-react) | The structure becomes a ruin, its debris is physical, the ground is cratered, trees are felled, residents inside die, neighbours grieve, a memorial plaque appears, the Sheriff may post a **WANTED** poster with your name — and **the building is reborn in the Understory** |
| Kill an NPC (blast, falling object, collapse) | They are gone forever. A grave appears, their ghost joins the Understory's Hall of the Departed, the town remembers *who*, and a new stranger may eventually arrive on the bus |
| Throw something into Lake Hollow | It is written into the **offering ledger**. Minutes/hours later the lake changes colour, level and glow *because of that action*, and gives something back: `THE LAKE REMEMBERS — Marlo gave a crate to the lake 3h ago…`. Throw the Gnome in and it returns **gilded** |
| Lay planks, write signs, gift NPCs | Permanent, walkable, readable, remembered. Planks chain end-to-end into bridges |
| Walk | Footsteps wear **desire paths** into the terrain. The ground literally learns where people go |
| Find the hatch under the chapel rug | You get to **name a place** on the world map. First discoverers become part of the Chronicle; a second entrance may later open where the most destruction happened |
| Die | A grave. Your last words are stored — and one day they may come out of a radio |
| Be first to do anything | **FIRSTS** are recorded forever (first blast, first life taken, first offering, first path, first kindness, first way down…) and grant titles |

### The AI Director (`server/director.js`)

The Director never speaks in its own voice; it only stamps a timecode. Internally it is a small, opinionated model of *the server's mood*:

* **Signals** (violence, destruction, offerings, exploration, cooperation, discovery, chatter, danger) with a 15-minute decay.
* A **consequence ledger** (delayed reactions to individual actions — the lake, prophecies, radio).
* A weighted **event library** that prefers events which *reference what people actually did*, with cooldowns and novelty.
* **Reactive rules** (blast spam → *"THE SERVER CLOSES ITS HAND"*, charges disabled; crowds get noticed and gifted; serial demolishers get a wanted poster).
* **Eras** ("The Age of Ash", "The Drowned Age", "The Descent"…) chosen from the dominant behaviour, plus milestones.

Events implemented: *a building moves* (physically, carrying whoever is inside) · *the sky changes* (extra moons, aurora, eclipse, red sky, **a constellation that spells a player's name**) · *an area disappears* (a permanent "Null" hole) · *the billboard names a player before they arrive* (also at join) · *a dead player's voice on the radio* (speech synthesis) · *the lake remembers* · blackout · storms/fog with lightning · meteor showers that leave craters and relics · earthquakes · sinkholes that open a second way down · time stopping / skipping · gravity hiccups · private whispers that quote your own history · a beacon over the chapel · stranger arrivals · statues of legendary players.

### Streamer chaos

Tick **"I am streaming"** on the title screen (or *Go live* in the pause menu) → you get a **viewer code**. Viewers open `/viewer`, enter it, and can:

* vote in **CHAT DECIDES** polls,
* spend limited **influence** on *real, global* effects (fog bank, gust, lightning, signal flare, supply drop that *anyone* can loot, radio whisper, blackout) — with per-stream **and** world-wide cooldowns,
* **clip** a moment.

Everything is written to the shared Chronicle with a `seen on <streamer>'s stream — jump to 13:21:19 UTC` tag, so
*a streamer destroys something on stream… another streamer finds the consequences hours later* and both can find the exact second.
Streamers are never shown on other players' maps (no stream-sniping); the map only shows players within 70 m.

The public Chronicle is also readable at `/api/chronicle`, `/api/chronicle?legends=1`, plus `/api/status` and `/api/streams`.

### Hollowmere — the polished area

A lake valley with a 11-person town (Marrow Street), pier, boathouse, water tower, radio station (the *Last Voice*),
diner, garage, inn, constabulary, houses, a billboard on Eastgate Road, and Saint Anselm's Chapel on the hill…
whose rug hides the way down to **THE UNDERSTORY**: a cavern city populated with every building players have ever destroyed
and the ghosts of everyone who has died. Its Archive wall shows the live Chronicle.

* **NPCs** keep routines by time of day, path through doors, panic, mourn, gossip *about what actually happened*
  (`Bettina: "Oh, honey — Ingrid brought down Whitlock House. Down to the foundation."`), hold grudges against culprits, and drop clues
  about the Understory once they trust you. Faces blink, track you, and form moods; each has their own voice blips.
* **Physics** is server-authoritative Rapier (props, debris, buoyancy in the lake, blast waves, kinematic buildings that can push things when they move).
* **Look & feel**: procedural PBR-ish world with no image assets — day/night cycle, dynamic clouds, stars, moons, aurora, rain, fog, lightning, MSAA + bloom + grade,
  instanced forests and wind-blown grass, depth-aware lake with shore foam, ripples and bioluminescence, hollow buildings with real window openings and furnished interiors.
* **Sound** is fully synthesized (wind, rain, lake, crickets, footsteps, explosions, thunder, bell, radio static, the SERVER EVENT sting…).

## Controls

`WASD` move · `Shift` run · `Space` jump/swim up · mouse look · `E` interact/talk · `G` give held item · `1–4`/wheel tools
(**hands** grab & throw — hold LMB to wind up · **charge** · **plank** (`Q`/`R` rotate) · **sign**) · `RMB` drop · `Tab` Chronicle · `M` map (click to zoom) ·
`T` chat · `F` clip this moment · `V` camera · `H` hide HUD · `Z X C B N` emotes · `P` mute.

## Architecture

```
shared/    terrain grid + craters, layout, oriented-box collision  (identical code on client and server)
server/    index.js (HTTP+WS) · game.js (sessions, actions, destruction) · physics.js (Rapier)
           npcs.js / npcdata.js · director.js · stream.js · chronicle.js · state.js (persistence)
public/    index.html + js/* (three.js renderer, characters, UI, audio, FX) · viewer.html
tools/     selftest · bots · headless screenshot/scenario harnesses (Playwright)
```

* Client-authoritative movement with server validation (speed/teleport checks, fall damage from landing reports); server-authoritative physics, damage, inventory and world.
* 30 Hz simulation, 15 Hz snapshots interpolated 110 ms behind; world changes travel as `{path: value}` patches.
* Saves: `data/world.json` (atomic write + rolling backup) and an append-only `data/chronicle.ndjson`.
* Hardening: payload cap, per-connection token bucket, per-IP connection cap, all player text sanitised and passed through a moderation hook (`server/text.js`) and only ever rendered via `textContent`/canvas.

## Hosting it

One Node process serves the game, the viewer console and the WebSocket (`/ws`). Run it anywhere with Node ≥ 20 and keep `DATA_DIR` on persistent disk —
that folder *is* the world. Behind a reverse proxy, forward WebSocket upgrades (`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`)
and the client will use `wss://` automatically on HTTPS. `Ctrl-C`/`SIGTERM` saves the world before exiting; back up `data/world.json` + `data/chronicle.ndjson` to preserve history.

## Honest status & limits

* This is a first version: one process, designed for **tens to a couple hundred concurrent players**. "Thousands" needs region sharding + interest management (the world state is already patch-based and zone-aware, so this is the next step).
* The word-filter is deliberately small — plug a real moderation service into `setModerationHook` before hosting publicly, since players' text lands on signs, billboards and radios.
* Speech synthesis for radio voices depends on the browser's installed voices. Desktop browsers only (pointer lock); no mobile controls.
* Visuals are procedural and stylised-realistic, not photoscanned AAA; quality presets (`High/Medium/Low`) trade MSAA, bloom, shadow resolution and grass density.
* The Director is heuristic — no LLM is involved (a natural extension is letting a model *narrate* the events it already selects).
* Automated checks: `npm test` (protocol + persistence), plus the harnesses in `tools/` used while building it:
  `events-check.mjs` (runs every Director event in-process), `npc-check.mjs` (simulates the town at different hours and verifies NPCs reach their routines),
  `viewer-check.mjs` (streamer + viewer console), and the headless-Chromium `shot.mjs` / `scenario.mjs` / `demolish.mjs` (need `npm i --no-save playwright-core`).
