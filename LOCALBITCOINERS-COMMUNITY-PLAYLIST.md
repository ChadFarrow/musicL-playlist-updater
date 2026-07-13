# LocalBitcoiners Community Playlist (podcastL)

Generates **one combined `podcastL` playlist** aggregating the podcast episodes the
Local Bitcoiners community has boosted, as surfaced on
[localbitcoiners.com/feeds](https://localbitcoiners.com/feeds), and publishes it to
the target playlist repo alongside the `musicL` playlists.

Unlike the RSS-driven `musicL` playlists (one source feed → one playlist), this is a
**directory aggregator**: it pulls many shows' episodes from a single JSON source into
one list. Because the content is spoken-word podcast episodes rather than music, it uses
`<podcast:medium>podcastL</podcast:medium>` — the Podcasting 2.0 list medium that is the
direct analog of `musicL`.

## Data source

`localbitcoiners.com/feeds` is a client-rendered app; its static HTML contains no feed
data. The podcast list comes from the site's community-boosts JSON API:

```
https://localbitcoiners.com/api/community-boosts
```

Each entry in `boosts[]` carries `podcast_guid` (→ `feedGuid`) and `item_guid`
(→ `itemGuid`), which is exactly what a `<podcast:remoteItem>` needs. The script:

1. Fetches the JSON snapshot (with a browser `User-Agent`, retrying transient failures).
2. Extracts `feedGuid`/`itemGuid` pairs, skipping records missing a usable guid.
3. Dedupes by `feedGuid::itemGuid`.
4. **Merges with the currently-published playlist** so the rolling hourly snapshot never
   *removes* episodes (grow-only, matching `RSSPlaylistGenerator`).
5. Writes `docs/localbitcoins-community-playlists.xml` to the target repo
   (`ChadFarrow/chadf-musicl-playlists`) and a local copy under `./playlists/`.

The playlist keeps a **stable** `<podcast:guid>` across runs (a hardcoded constant), so
its identity as a published feed does not churn.

## Usage

```bash
# Generate and publish (requires GITHUB_TOKEN for the target repo)
npm run create-localbitcoins-playlists
# or
node scripts/create-localbitcoins-community-playlists.js

# Preview the XML without writing or pushing anything (no token needed):
node scripts/create-localbitcoins-community-playlists.js --dry-run > preview.xml
```

Diagnostic logs go to **stderr**, so `--dry-run > file.xml` captures clean XML on stdout.

### Options (CLI flag wins over env var)

| Flag | Env var | Purpose |
| --- | --- | --- |
| `--url=<url>` | `LBC_DIRECTORY_URL` | Community-boosts API URL |
| `--out=<file>` | `LBC_OUTPUT_PATH` | Local output XML path |
| `--dry-run` | `LBC_DRY_RUN=1` | Print the XML instead of writing/pushing |

## Daily CI

`scripts/daily-update.js` runs this aggregator as an extra step after the RSS feed loop,
under the same non-fatal error policy: transient errors are retried, `403`/`404` are
skipped, and a persistent failure emits a `::warning::` annotation instead of failing the
run. It is intentionally **not** listed in `FEEDS.md` — the RSS discovery path expects a
real source-feed RSS URL and would choke on the JSON API, so this runs as its own step.

## Requirements

- Network access to `localbitcoiners.com`.
- `GITHUB_TOKEN` for publishing to the target repo (not needed for `--dry-run`).
