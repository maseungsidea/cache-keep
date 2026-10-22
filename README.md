# cache-keep

A Claude Code mod that tells you when your prompt cache **silently dropped to a 5-minute TTL**, with zero model calls and no settings edits.

- **Status line:** `🔥 cache warm ▰▰▰▰▱ 47m · 312k · hit 94% · 1 miss` while the cache should be alive, `🧊 cache cold · next message rewrites 312k` once it has expired. One bar cell = 12 minutes left; the miss count appears after the first miss.
- **`/cache-keep`:** a report for the session — time left, context size, hit rate (input tokens read from cache), misses and the tokens they rewrote, and whether a 5-minute TTL is suspected. It answers at once, even mid-turn.
- **Alarm:** if a large context is rewritten whole after a gap that a 1-hour cache should have survived (5–55 min), twice within a rolling hour, you get one toast: *5-minute TTL suspected — check `promptCacheTtl: "1h"`*.

All of it counts the main thread only. A miss is a request that rewrote at least half of a 50k+ context; the first request of a session and the ones right after compaction or a model switch are not counted.

## Install

At the prompt of a terminal session:

```
/plugin install cache-keep --marketplace maseungsidea/cache-keep
```

From a shell:

```
claude plugin install cache-keep --marketplace maseungsidea/cache-keep
```

Answer `y` to add the marketplace, then pick a scope. In the desktop app: **+ → Plugins → Add marketplace**.

The `language` option (`en` / `ko`) sets the language of the status line, the report and the alarm.

## Why

On a subscription, the main conversation's prompt cache lives for 1 hour. Some accounts have reported it falling to 5 minutes; then every pause longer than 5 minutes rewrites the whole context at write price, and usage climbs without any visible sign. Setting `"promptCacheTtl": "1h"` in `settings.json` fixes that — but only if you know it is happening. cache-keep makes it visible.

## How it compares

Checked against cache mods found via claudemods.dev and GitHub as of 2026-10-22 (cache-clock 0.1.1, cache-tax 2.3.1, cache-warmer, token-optimizer 5.13.57), from their source.

| | cache-keep | cache-clock | cache-tax | cache-warmer | token-optimizer |
|---|---|---|---|---|---|
| Model calls | none | none | keep-warm pings: opt-in, auto-arms 3h after a cold write | keep-warm pings, always on | one per **Keep warm** press, never on a timer |
| Edits your settings | no (`$.ui.status`) | yes, wraps your `statusLine` | no | no | yes, installs its own `statusLine` and restores it each session |
| Blocks a message | no | no | first cold message, once (guard) | no | no |
| Detects a 5-minute TTL drop | yes, inferred; one alarm toast | no | no (assumes 60 min) | no (configurable, default 60 min) | yes, measured (reads the 5m/1h write split); the countdown shortens, no alarm |
| Reads usage | per API request (`turn.step`) | status-line input | per API request (`turn.step`) | per turn (`turn.complete`) | per API request, plus the transcript via a Python script |
| Shows | time left, context size, hit rate, misses, rewritten tokens; `/cache-keep` report | time left, hit rate, misses, tokens to re-cache | cold-write cost in USD | — | a band above the prompt: cache countdown, context fill, session quality, 5-hour and weekly limits, savings |
| Needs | nothing | nothing | nothing | nothing | Python 3.9+; PolyForm Noncommercial license (work for an employer needs a commercial or small-business license) |

In short: cache-keep is the small one. It does one job, prompt-cache visibility, with no model calls, no settings edits, no runtime beyond Claude Code and an MIT license. token-optimizer measures the TTL where cache-keep infers it, and does far more, but it rewrites your status line and needs Python. cache-clock shows most of the same numbers through your `statusLine`. cache-tax and cache-warmer exist to keep the cache warm, which cache-keep never does.

### Who it's for

- **Your usage jumped and you don't know why.** A common hidden cause is the cache going cold: a 5-minute TTL, or long breaks. The miss count and the alarm show whether it is the cache, and `/cache-keep` gives the numbers to compare with a colleague.
- **You work with a large context** (hundreds of thousands of tokens, or a 1M-context model). One cold rewrite there costs as much as many ordinary turns, so it pays to see the countdown before you step away.
- **You step away often** (meetings, reviews, waiting on a build) and want to know whether to send the next message now or accept a rewrite.
- **You already have a status line you like.** cache-keep adds one entry through the mod API and never touches `settings.json`.
- **You want nothing sent on your behalf:** no pings, no extra usage, no extra process.
- **You set `promptCacheTtl: "1h"` and want to confirm it holds.** The alarm stays quiet while it does.

### Where it does not fit

- **API-key, cloud or extra-usage sessions** run on a 5-minute TTL by design; there the alarm is noise. Use a 1-hour TTL setting or don't install it.
- cache-keep does not read the 5m/1h split of cache writes, so the alarm is an inference, not a measurement. If you need the measured TTL and don't mind a managed status line and Python, use token-optimizer.
- Where an organization manages Claude Code, installed plugins don't receive `session.compact`, so a rewrite right after compaction can count as a miss and toward the alarm.
- If you want the cache kept warm through long breaks, use a keep-warm mod instead; cache-keep only shows and warns.

## Validation

The alarm logic was replayed over 30 days of real transcripts (497 main-thread sessions). It fired in 6 sessions, all on Claude Code 2.1.280 or older where a prompt-prefix change caused the rewrite; on 2.1.290+ it fired in none.

## License

MIT
