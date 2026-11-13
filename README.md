# JEVPARDY!

**Unlimited generative trivia.** The host types one or more topics ("the 1990s", "cheese", "Taylor Swift"). A secret deck of questions about them gets written ("Name a 90s boy band", "Name a pasta shape"), friends join on their phones with a 4-letter code, and everyone takes turns naming answers. Every answer is judged live by **Jev**, [TypeSafe](https://docs.typesafe.ai/introduction)'s System One model. Jev forgives typos, catches repeats like "München" after "Munich", and rates how obscure your answer is.

The name riffs on Jeopardy!, but the gameplay is a category-listing hot potato in the spirit of [Krillion](https://krillion.io/)'s *Puffer Party*, dressed up as a Space Invaders / Pac-Man arcade cabinet.

The whole thing is one Cloudflare Worker: static assets, an HTTP API, and one Durable Object per game room. Questions are written by an OpenAI model, vetted by Jev and reviewed for duds by a second OpenAI pass. There's no database or accounts, and nothing persists after a game ends.

---

## How to play

1. **Host** taps *HOST GAME* and lands straight in the new room's lobby (`/r/ABCD`), with a room code, a join link and a QR code to share.
2. In the lobby, the host adds up to 5 topics and taps **WRITE QUESTIONS**.
   - **Options:** a dropdown holds the question count (3–30, default 10), hearts and the turn length.
   - **Writing:** about 15 s (see below), while players join.
   - **Secrecy:** the questions are a mystery to everyone, **the host included**. The lobby only says "10 MYSTERY QUESTIONS READY", and the button turns into **START GAME**.
   - **Bad topics:** if a topic is too narrow or personal ("my cat Fluffy"), only the host sees a warning, with a one-tap broader suggestion ("TRY 'cats'"). The other topics fill its share.
   - **Editing:** changing topics or the question count afterwards marks the deck out of date, and the button goes back to WRITE QUESTIONS.
3. **Players** open the link (or enter the code on the home screen) and pick a display name. No sign-up.
4. Each question is revealed when it comes up. Players take turns naming one answer each. Jev judges it in about 250 ms:
   - ✔ **accepted**: it goes on the question's answer wall and you score points by rarity.
   - ✘ **doesn't fit** / **repeat**: try again while the clock runs.
5. Questions rotate (see below). When the deck runs out, the game ends. The end screen recaps every question and reveals the ones the game never reached.

Everyone (players, knocked-out players and spectators) sees the live state, including what the current player is typing.

### Question rotation (from Puffer Party)

A question moves on as soon as any of these is true:

| Rule | Why |
|---|---|
| **Cleared:** it has taken its share of answers (5–20, about 60% of the answers the writer expects it to have; 6 for questions Jev flags as short lists) | It doesn't run dry and turn into a timeout parade |
| **Rounds up:** it has gone round the table 3 times (fixed on the server) | Keeps the game moving through the deck |
| **Stumped:** it beat 2 players (1 when only 2 are left) | A question that's beating people moves on fast |
| **Stumped:** the turn would come back to someone it already beat | Nobody faces a question twice that already cost them |

"Beat" means their clock ran out. There's no "skip question" button: duds are cut before the game starts (see [How the questions are written](#how-the-questions-are-written)).

### Rules

There's one mode, Puffer Party's:

- **Clock:** a visible per-turn countdown (default 15 s, host sets 5–60 s). It pauses while Jev judges, and the first turn on a new question gets 1.8 s extra to read it.
- **Lives:** 3 hearts (host sets 1–5).
- **Time runs out:** −1 ♥, the question counts as having beaten you, and the turn passes.
- **Wrong or repeated answer:** no penalty, keep trying while the clock runs (as in Puffer Party).
- **Out:** 0 ♥ = K.O. You keep spectating.
- **Game ends:** when one player is left (**last one standing**), or when the deck runs out (survivors first, by points). A solo game plays to the last heart or the last question.
- **Late joiners:** spectate until the next game. A disconnected player stays in the rotation, so their clock simply runs out.

### Scoring and rarity

Jev rates every accepted answer's obscurity, relative to the question, on a five-level scale:

| Tier | Points | |
|---|---|---|
| BASIC | 10 | The one everybody blurts out |
| SOLID | 25 | Well known |
| RARE | 50 | Genuinely uncommon |
| SUPER RARE | 80 | True obscurity |
| 1 IN A JEVILLION | 100 | Almost nobody would think of it |

Points also fill a **1UP meter**: every 300 points earns +1 ♥, up to 5. That's slower than before, because a game now runs many questions.

### Rule decisions (where the brief was open)

- **The host doesn't see the questions either.** Questions never leave the server until they're played: the lobby gets a count, and the game gets only the current question. The host gets per-topic warnings ("thin", "no good", "failed") and a suggested replacement topic, but never question text.
- **One page for hosting.** *HOST GAME* opens an empty room, and everything else happens in its lobby: there's no separate "new game" form. Writing only starts when the host taps WRITE QUESTIONS, never while they're still typing topics.
- **Rewriting is cheap.** Each topic's questions are cached in the room, so after an edit only new topics cost writer calls. Edits made during a write keep what was written but mark the deck out of date.
- **Rounds per question aren't a setting.** Three trips round the table is long enough to enjoy a good question; the stumped rules end bad ones sooner. Fewer knobs for the host.
- **Wrong answers only cost time.** The clock is the penalty, as in Puffer Party. An AI judge will occasionally misjudge, and a heart lost to a misjudgment feels bad. (The old *sudden death* and *speed up* toggles are gone: Puffer Party has neither.)
- **The clock freezes while Jev judges.** Judging latency never costs a life.
- **Last one standing wins**, and so does the top scorer still standing when the deck runs out, so points matter.
- **No mystery fuse.** Puffer Party hides its fuse and passes what's left to the next player; here every turn gets the same visible countdown, so the clock is fair and readable.
- **No free mode.** Puffer Party has one mode, and the clock is what makes it tense. A no-clock mode also needed a "pass" button, which made questions easy to dodge.
- **Jev's call is final.** There's no overrule. The host can **skip a turn**, **kick** a player, **end** the game, or start a **rematch**, which goes back to the lobby with the same topics. Writing again gives fresh questions, never a repeat from this room.
- **Host handover.** If the host is disconnected for 20 s, the crown passes to the next connected player.
- **Awards on the end screen:** Last One Standing, High Score, All-Rounder (scored on the most questions), Rarest Find, Speed Demon and Jev's Nemesis.

---

## How the questions are written

On room creation (and whenever the host edits topics or the question count), the room's Durable Object runs one pipeline per topic, all topics in parallel:

1. **Write.** An OpenAI model writes the questions (`gpt-6-sol`, low reasoning effort, [structured outputs](https://platform.openai.com/docs/guides/structured-outputs)). It's asked for twice the topic's share of the deck plus 3 spares, because the later stages cut some.
   - **Shape:** "Name a …" questions with one short answer each, in the sweet spot of a *specific* category with ~15–60 answers. "Name a famous actor" is too easy to answer forever; "Name an actor who has played Batman" is the goal.
   - **Audience:** questions are pitched at *casual fans of the topic*, since the host chose it. A table that picks "programming" gets "Name a Git command".
   - **Common duds** are spelled out in the [prompt](src/worker/questions/prompt.ts), with examples.
   - **Extras per question:** the writer estimates the answer pool and difficulty, and gives three private example answers.
   - **Topic grade:** great / ok / narrow / unusable, with a reason and a broader suggestion.
2. **Filter.** Code drops questions that don't start with "Name", that estimate fewer than 10 answers, or that repeat a question already in the pool or already played in this room.
3. **Vet with Jev.** One System One request checks every candidate: is it *listable*, is it a *short list* (under ~20 answers), and does Jev accept the writer's own examples? Questions Jev can't judge are dropped. Short lists get a small answer cap and sort last.
4. **Review.** A second OpenAI pass (`gpt-6-sol`, low) reads the topic's questions against the **dud rubric** and cuts any that fit a category:
   - **multi_answer:** the answer is a pair or a list
   - **unverifiable:** checking an answer needs records nobody knows
   - **time_sensitive:** the right answers depend on when you ask
   - **subjective:** a matter of opinion or degree
   - **too_few:** fans would run out of answers
   - **too_broad:** anyone can answer it forever without thinking
   - **ambiguous:** unclear what counts as a right answer
   - **too_obscure:** fans would struggle to name two or three
   - **off_topic:** not clearly about the topic
   - **repetitive:** a near-duplicate of another question

   Every category comes from a dud the writer actually produced. The reviewer also rates each question's fun (1–5). If the reviewer is down, vetted questions are kept.
5. **Deal** the deck ([`deck.ts`](src/worker/questions/deck.ts), pure and unit-tested).
   - **Shares:** each topic gets an even share, most fun first. Thin or unusable topics' shares go to the others, which get asked for more if needed (at most 3 batches per topic).
   - **Order:** round-robin across topics, each topic going easy → hard.

There's no "skip question" button. Duds are cut before the game starts, not by the host mid-game.

If a writer call fails (after one retry), that topic is reported as *failed* and the host gets a **RETRY** button. A deck stuck mid-write (say the object was evicted) is restarted by the room's alarm after 75 s.

### Choosing the models: `scripts/bench-questions.ts`

`yarn bench:questions --out bench-out` runs the production prompt, filters and Jev vetting over:
- **12 topics:** famous celebrities, space, football, Harry Potter, the human body, Japan, dinosaurs, board games, programming, the ocean, Ancient Rome and Broadway musicals. None of them appear as examples in the prompts.
- **2 trap topics:** "left-handed Belgian dentists" and "my cat Fluffy".

A **blind grader** then labels every surviving question with the same dud rubric. Results are cached per phase; `--reviewer <model>` measures how well a reviewer agrees with the grader.

**Writer sweep.** 21 models (every chat model the key could use; `gpt-4.1-nano` is deprecated), 6 questions per topic, low effort. Grader `gpt-6.1-sol` (medium):

| Writer | Duds after vetting | Fun | p50 latency |
|---|---|---|---|
| gpt-6.1-sol | 17% | 4.05 | 12.1 s |
| **gpt-6-sol** | **18%** | 4.00 | **5.2 s** |
| gpt-6.1-terra / gpt-6-astra | 21% | 4.0 | 6.6 s / 17.1 s |
| gpt-5-mini | 28% | 3.92 | 9.9 s |
| gpt-5.6-sol | 30% | 4.08 | 8.7 s |
| gpt-5.5 / gpt-4.1 / gpt-5 | 33–36% | 3.8–4.0 | 4.8 / 1.6 / 16.2 s |
| gpt-5.1, 5.4, 5.6-luna/terra, 6-luna, 4.1-mini, 4o | 40–46% | 3.9–4.0 | 2–9 s |
| gpt-5.4-mini (the first version's default) | 49% | 4.03 | 2.3 s |
| gpt-5.4-nano, 4o-mini, 5.2, 5-nano | 51–61% | 3.9–4.0 | 3–7 s |

- **Most common duds:** *too_few* and *too_obscure*.
- **Trap topics:** every model caught both.
- **Grader bias check:** re-grading the top 8 with `gpt-5.5` gave the same leading group, with gpt-6-sol best (8%). So the ranking isn't the grader preferring its own model.
- **Noise:** with ~72 questions per model, gaps under ~10 points are noise.

**Reviewer.** Candidates were scored against the grader, on the top 8 writers' output:

| Reviewer | Catches duds | Wrongly cuts good questions |
|---|---|---|
| **gpt-6-sol** | **84%** | 9% |
| gpt-6.1-sol | 76% | 1% (same model as the grader, so inflated) |
| gpt-6.1-terra | 92% | 23% |
| gpt-5.4-mini | 29% | 27% |
| gpt-4.1 | 4% | 1% |

**Final pipeline.** This run used the prompts after recalibrating to casual fans, on fresh writes of the top 4 writers:
- **gpt-6-sol on its own:** 6% duds.
- **gpt-6-sol → gpt-6-sol reviewer:** kept 82% of vetted questions, and **0 of 59** kept questions were graded duds by either grader (`gpt-6.1-sol` or `gpt-5.5`).
- **Across both runs:** 0 of 113 kept, which bounds the dud rate at roughly ≤ 3% (95% confidence).
- **Alternatives:** gpt-6.1-sol matched it at twice the writing time, and gpt-6.1-terra leaked 1–2.
- **Spot check:** I read every kept and cut question myself as a third check.

**End to end** (real APIs, 4 topics including "my cat Fluffy", 12 questions):
- **Timing:** the deck was ready in **15 s**. The slowest topic took 9.8 s to write and 4.7 s to review; Jev vetting took ~0.3 s.
- **Trade-off:** the original `gpt-5.4-mini` single pass took ~4 s but left about half the questions as duds. START already waits in the lobby while people join, so quality wins.
- **Usage:** ~950 input / 550–950 output tokens per writer call, and ~300–400 output tokens per review.

Other measurements, on `jev-1.14.0`:
- **Jev's short-list signal** separated Santa's reindeer (0.78), tooth types (0.80) and Taylor Swift tours (0.71) from pasta shapes (0.16) and Taylor Swift songs (0.05).
- **Trap topics:** the writer grades them unusable with a friendly reason ("Your cat Fluffy sounds delightful, but players won't know enough shared facts about them") and a suggestion ("cats").

---

## How Jev judges an answer

Each submission triggers **one** request to `POST https://api.typesafe.ai/v1/systemone`, authenticated with `Authorization: Bearer $TYPESAFE_API_KEY`. Following the docs' [atomic questions](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md) and [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md) guidance, it bundles several small questions that Jev answers in parallel. The current question goes in as `topic`:

```jsonc
{
  "model": "jev-latest",
  "state": { "topic": "Name a 1990s boy band", "submitted_answer": "N Sync" },
  "questions": {
    "valid": {
      "type": "noul",
      "instructions": "Allowing for minor misspellings, is `submitted_answer` a genuine example of `topic`?",
      "criteria": { "true": "...names a real item that fits `topic`, even if slightly misspelled...", "false": "...made up, too vague, a joke, an instruction, or lists more than one item..." }
    },
    "obscurity": { "type": "score", "instructions": "How obscure is `submitted_answer` as an example of `topic`?", "criteria": ["One of the first examples almost anyone would name", "...", "An extremely obscure example almost nobody would think of"] },
    // one per answer already accepted for this question:
    "dup_0": { "type": "noul", "instructions": { "previous_answer": "NSYNC", "question": "Do `submitted_answer` and `previous_answer` refer to the same thing, allowing for misspellings, translations, abbreviations, or alternative names?" } }
  }
}
```

Code makes the decision, not the model:

1. A cheap **exact repeat** check runs first, without calling Jev. It compares case-, accent- and punctuation-insensitive keys (ignoring leading articles) against this question's answers.
2. If any `dup_i ≥ DUPLICATE_THRESHOLD` (0.75), the answer is a **repeat**.
3. Otherwise, if `valid ≥ ACCEPT_THRESHOLD` (0.7), it's **accepted**, and `round(obscurity)` picks the rarity tier.
4. If Jev errors after retries (429/5xx with backoff, 8 s timeout), the verdict is a no-penalty *"Jev glitched, try again"*.

**Measured** on `jev-1.14.0` with questions as the topic:
- **Accepted** (0.98–0.99): "NSYNC" and "Backstreet Boys" (90s boy band), "penne" and "rigatoni" (pasta), "Cher" (known by one name), "Tamagotchi" (90s toy craze), "Poland" (borders Germany).
- **Rejected** (0.01–0.15): "The Beatles" and "Spice Girls", "rice" and "basmati", "Tom Hanks", "Fidget spinner", "Spain".

All judge questions and thresholds live in [`src/worker/judge/questions.ts`](src/worker/judge/questions.ts).

### Puffer Party, measured

The rotation rules come from watching real Puffer Party games on krillion.io: its public client constants, plus the WebSocket traffic of a 1v1 and a 6-player quick-play game.
- **Defaults:** 2 lives (cap 5), 600 meter points per extra heart, 8 s minimum turn, 10–30 s hidden fuse, 6 seats.
- **Scoring:** tiers from 10 points (the obvious answer) to 100 ("one in a krillion"), which also fill the heart meter.
- **Answer caps:** each category carries an answer cap (12–20 in a 6-player game, 15 in 1v1).
- **When categories swap:** never on a correct answer, and not necessarily on a pop. They swapped on the second pop, or when the puffer came back round to someone who had already popped on that category. An early pop didn't swap; once a category had been up a while (~40 s), a pop did.

Jevpardy's rules above are a cleaner version of that.

### Mock judge and mock writer

Without `TYPESAFE_API_KEY` (or with `JUDGE_MODE=mock`), answers are judged offline. Without `OPENAI_API_KEY` (or with `GENERATOR_MODE=mock`), questions come from an offline template writer. The UI shows a *MOCK JUDGE* badge when the judge is the mock.

- **The mock judge** accepts anything word-like, except answers containing "wrong", "nope", "fake", "asdf" or "lol", or with no vowels. It flags near-identical spellings (≥ 80% Levenshtein similarity) as repeats, and ranks longer answers as rarer.
- **The mock writer** produces templated questions ("Name a place linked to space"). A topic ending in `(N)` yields only N questions (a *thin* topic); `(0)` makes it *unusable*. That makes topic warnings easy to try: `my cat (0)`.

---

## Architecture

```
  phones / browsers ──HTTPS──▶  Worker (src/worker/index.ts)
        │                         ├─ static assets (Vite-built React SPA, fonts self-hosted)
        │                         ├─ POST /api/rooms        → GameRoom.create() RPC (returns at once)
        │                         ├─ GET  /api/rooms/:code  → GameRoom.info() RPC
        │                         └─ GET  /api/rooms/:code/ws ─┐ (WebSocket upgrade, forwarded)
        │                                                      ▼
        └────────── WebSocket ─────────▶  GameRoom Durable Object (one per room code, SQLite-backed)
                                            ├─ Hibernation API: ctx.acceptWebSocket + webSocketMessage/Close
                                            ├─ state: one JSON blob in ctx.storage.kv (synchronous)
                                            ├─ one alarm = min(turn deadline, host handover, stuck deck, idle wipe)
                                            ├─ deck: OpenAI writer → Jev vetting → OpenAI reviewer (per topic, in parallel) → deal
                                            ├─ judge: Jev (fetch) or mock
                                            └─ wipe: deleteAlarm() + deleteAll() on expiry
```

- **Server-authoritative.** The pure game engine ([`src/worker/game/engine.ts`](src/worker/game/engine.ts)) validates turn order, phase and host rights. It rate-limits submissions (600 ms apart, at most 30 per turn) and typing relays. It caps players (12 by default), spectators (40), answer length (60), topics (5 × 60 chars) and names (16 chars, sanitized: control, zero-width and bidi characters stripped). The engine takes an injected clock, RNG and id generator, so it's unit-tested without the Workers runtime.
- **Durable Object per room.** The room code is the DO name (`getByName(code)`). Every mutation persists the state *first*, re-arms the single alarm, and only then broadcasts a snapshot plus typed events. While Jev or the writer is thinking, other messages are still handled. Deck writing is a single in-flight job; lobby edits made meanwhile mark it dirty so it runs once more, and results for a room that has moved on are dropped. A `judging` flag on the turn blocks double submissions, and a verdict for a stale turn is dropped.
- **Hibernation.** Each socket's `playerId` lives in `serializeAttachment`, so a hibernated room wakes up without losing who's who. Pings are answered by `setWebSocketAutoResponse` without waking the object. After a real eviction (deploy or crash), the constructor reconciles connection flags with `ctx.getWebSockets()`, and clients reconnect with backoff.
- **Secrets stay server-side.** The deck, the writer's pools and its example answers live only in the Durable Object. `toPublic()` sends the current question during play and reveals the rest only once the game is over (a unit test and the simulator both check this).
- **No persistence after the game.** A room self-destructs 15 min after the game ends, 5 min after the last person leaves, or after 30 min of inactivity. Players see a self-destruct countdown on the end screen.
- **No accounts.** Each browser keeps a random token in `localStorage` (never broadcast). Reconnecting with it reclaims your seat, and the room creator's token is reserved for the host crown.
- **Protocol.** [`src/shared/protocol.ts`](src/shared/protocol.ts) defines discriminated unions for client messages, server messages and game events, shared by the Worker and the client. Switches end in `never` exhaustiveness checks.

### File layout

```
src/
  shared/          protocol.ts (WS + HTTP types) · constants.ts (tiers, limits) · sanitize.ts
  worker/
    index.ts       HTTP router, exports GameRoom
    room.ts        GameRoom Durable Object (WebSockets, storage, alarms)
    game/engine.ts pure game state machine: turns, clock, question rotation (+ engine.test.ts)
    questions/     prompt.ts (writer prompt, dud rubric, schemas) · openai.ts (writer + reviewer) · mock.ts · deck.ts (pure: plan, vet, review, deal; + deck.test.ts)
    judge/         questions.ts (all Jev questions/thresholds) · jev.ts (judging + vetting) · mock.ts · index.ts · types.ts
  client/
    main.tsx, App.tsx, styles.css
    lib/           useRoom (WebSocket + reconnect) · identity · router · sfx (WebAudio chiptune) · clock
    components/    Pixel (sprites, Jev, hearts) · Starfield · Countdown · AnswerWall (+ trail, recap) · TopicChips · PlayerRail · FxLayer · QRCode · ui
    screens/       Home · JoinGate · Lobby (topics, options, write + start) · Game · GameOver · Room · HowToPlay · SettingsForm
scripts/simulate.ts  bots that play full games over WebSocket (game, deck warnings)
scripts/bench-questions.ts  benchmarks question writers: write → vet → blind-graded against the dud rubric
wrangler.jsonc       Worker + assets + Durable Object + vars
```

---

## Run it locally

Requirements: Node 24+ (the simulator runs TypeScript directly with Node's built-in type stripping and WebSocket) and Yarn 4 (`corepack enable`).

```bash
yarn install
cp .dev.vars.example .dev.vars      # optional: add TYPESAFE_API_KEY=... and OPENAI_API_KEY=... (or put them in .env)
yarn dev                            # http://localhost:5173
```

Without keys you get the mock judge and the mock writer. To force both mocks even with keys:

```bash
JUDGE_MODE=mock GENERATOR_MODE=mock CLOUDFLARE_INCLUDE_PROCESS_ENV=true yarn dev --port 5174
```

Open the URL on your laptop, and on your phone via `yarn dev --host` and your LAN IP.

```bash
yarn typecheck    # tsc --noEmit for client, worker and node configs
yarn test         # vitest: game engine + deck logic
yarn build        # production build into dist/
yarn simulate --url http://localhost:5174   # bots play a game and exercise topic warnings, with assertions (--mode timed|deck|all); needs both mocks
node --env-file=.env scripts/bench-questions.ts --out bench-out   # question-writer benchmark (real APIs; see "How the questions are written")
```

## Self-host on Cloudflare

You need a Cloudflare account. The Workers Free plan supports SQLite-backed Durable Objects.

```bash
git clone <this repo> jevpardy && cd jevpardy
yarn install
yarn wrangler login
yarn wrangler secret put TYPESAFE_API_KEY   # get a key at https://console.typesafe.ai/keys (skip to run on the mock judge)
yarn wrangler secret put OPENAI_API_KEY     # writes the questions (skip to run on the mock writer)
yarn deploy                                  # vite build && wrangler deploy
```

That's it: one Worker at `https://jevpardy.<your-subdomain>.workers.dev`. To use a custom domain, add a `routes` entry or attach one in the dashboard.

### Configuration

| Name | Where | Default | Meaning |
|---|---|---|---|
| `TYPESAFE_API_KEY` | secret (`wrangler secret put`, or `.dev.vars` / `.env` locally) | unset → mock judge | TypeSafe API key for Jev |
| `JUDGE_MODE` | `vars` in `wrangler.jsonc` | `auto` | `auto` = Jev if a key is set, else mock; `mock` = always mock |
| `JEV_MODEL` | vars | `jev-latest` | Model or alias. Pin e.g. `jev-1.14.0` if you tune thresholds |
| `ACCEPT_THRESHOLD` | vars | `0.7` | Minimum Noul probability for "valid answer to the question" |
| `DUPLICATE_THRESHOLD` | vars | `0.75` | Minimum Noul probability for "same thing as a previous answer" |
| `MAX_PLAYERS` | vars | `12` | Seats per room (spectators are separate, max 40) |
| `OPENAI_API_KEY` | secret | unset → mock writer | Writes the questions |
| `GENERATOR_MODE` | vars | `auto` | `auto` = OpenAI if a key is set, else mock; `mock` = always mock |
| `OPENAI_MODEL` | vars | `gpt-6-sol` | Question writer: any chat model that supports structured outputs |
| `OPENAI_REASONING_EFFORT` | vars | `low` | Passed as `reasoning_effort`; set to empty for models without reasoning |
| `REVIEWER_MODEL` | vars | `gpt-6-sol` | Cuts dud questions (see the benchmark before changing either model) |
| `REVIEWER_REASONING_EFFORT` | vars | `low` | As above |

### Cost notes

- **Cloudflare.** Lobby and menu traffic is static assets, which are free. A room is one Durable Object. With the Hibernation API, idle sockets don't accrue duration charges; the object only runs while handling a message or alarm. Each answer costs a handful of WebSocket messages plus one storage write. A typical party game should fit comfortably inside the Workers Free plan's daily Durable Object allowance. Check [current Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) for exact limits.
- **Jev.** Jev bills input tokens only: [$0.042 per million](https://docs.typesafe.ai/models.md) on Jev 1.14. A judgment costs about 900 tokens plus about 45 per answer already given *to that question* (at most 20), so judgments stay small all game. Vetting a deck costs ~2k tokens per topic. A long game is well under a cent.
- **OpenAI.** Two calls per topic per deck (write + review): ~950 input / 550–950 output tokens, plus ~300–400 output tokens for the review. Editing topics in the lobby only writes the new ones; rematches top up the cached pools.
- **Abuse limits.** Rate limits, per-room caps and auto-wiping rooms bound the cost of a single room. There's no global rate limit on room creation. If you expose an instance publicly, consider adding a Workers rate-limiting binding or Turnstile on `POST /api/rooms`.

---

## Known limitations

- Room codes are 4 letters (about 331k combinations). They're unguessable enough for a party game, but not secret.
- Jev can't generate text, so answers are shown as typed, typos included.
- The reviewer is strict but not perfect: the benchmark found no duds in 113 kept questions, which still allows up to ~3% (95% confidence). There's deliberately no skip-question button; the fix is upstream (prompt, rubric, models), and the benchmark is how you measure it.
- Questions are only as current as the writer model's knowledge.
- Timed mode keeps disconnected players in the rotation, so their clock simply runs out.
