# cache-keep

A Claude Code mod that tells you when your prompt cache **silently dropped to a 5-minute TTL**, with zero model calls and no settings edits.

- **Status line:** `cache warm 47m · 312k` while the cache should be alive, `cache cold · next message rewrites 312k` once it has expired.
- **Alarm:** if a large context is rewritten whole after a gap that a 1-hour cache should have survived (5–55 min), twice within a rolling hour, you get one toast: *5-minute TTL suspected — check `promptCacheTtl: "1h"`*.

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

The `language` option (`en` / `ko`) sets the language of the status line and the alarm.

## Why

On a subscription, the main conversation's prompt cache lives for 1 hour. Some accounts have reported it falling to 5 minutes; then every pause longer than 5 minutes rewrites the whole context at write price, and usage climbs without any visible sign. Setting `"promptCacheTtl": "1h"` in `settings.json` fixes that — but only if you know it is happening. cache-keep makes it visible.

## How it compares

Checked against cache mods found via claudemods.dev and GitHub as of 2026-10-22 (cache-clock 0.1.1, cache-tax 2.3.1, cache-warmer), from their source.

| | cache-keep | cache-clock | cache-tax | cache-warmer |
|---|---|---|---|---|
| Model calls | none | none | keep-warm pings: opt-in, auto-arms 3h after a cold write | keep-warm pings, always on |
| Edits your settings | no (`$.ui.status`) | yes, wraps your `statusLine` | no | no |
| Blocks a message | no | no | first cold message, once (guard) | no |
| Detects a 5-minute TTL drop | **yes** | no | no (assumes 60 min) | no (configurable, default 60 min) |
| Reads usage | per API request (`turn.step`) | status-line input | per API request (`turn.step`) | per turn (`turn.complete`) |
| Shows | minutes left, context size | **time left, hit rate, misses, tokens to re-cache** | cold-write cost in USD | — |

### Where cache-keep fits

- You are on a subscription (1-hour TTL) and want to know when the cache expires, and to catch a silent drop to 5 minutes.
- You want nothing sent on your behalf: no pings, no extra usage.

### Where it does not

- **API-key, cloud or extra-usage sessions** run on a 5-minute TTL by design; there the alarm is noise. Use a 1-hour TTL setting or don't install it.
- It cannot see the 5m/1h split of cache writes (the usage data does not carry it), so the alarm is an inference, not a measurement.
- Where an organization manages Claude Code, installed plugins don't receive `session.compact`, so a rewrite right after compaction can count toward the alarm.
- If you want the cache kept warm through long breaks, use a keep-warm mod instead; cache-keep only shows and warns.

## Validation

The alarm logic was replayed over 30 days of real transcripts (497 main-thread sessions). It fired in 6 sessions, all on Claude Code 2.1.280 or older where a prompt-prefix change caused the rewrite; on 2.1.290+ it fired in none.

## License

MIT
