# Small Group Shows Playlist (podcastL)

Generates **one `podcastL` playlist** that follows every show listed on
[smallgroupscoop.com/shows](https://smallgroupscoop.com/shows/). It holds the latest 10
episodes from each show, newest first across the whole network, and is published to the
target playlist repo alongside the `musicL` playlists.

## Feed URL

```
https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/smallgroup-shows-playlist.xml
```

Add this URL to a podcast app. It's also served by GitHub Pages at
`https://chadfarrow.github.io/chadf-musicl-playlists/smallgroup-shows-playlist.xml`.
No PodPing is sent for this playlist (`SEND_PODPING = false` in the aggregator) while it is
kept out of Podcast Index: a PodPing reader may add a feed it does not know. Once it is in
PI, set `SEND_PODPING` to true; the PodPing names the raw URL above, with `medium=podcastL`.

| | |
| --- | --- |
| Medium | `podcastL` |
| `<podcast:guid>` | `5da03898-d837-435d-9474-4be9a6c95e13` (stable, never changes) |
| Target repo file | `docs/smallgroup-shows-playlist.xml` |
| Run state | `state/smallgroup-shows-playlist.json` |

## What's in it

- The **latest 10 episodes per show**, rolling: when a show releases a new episode,
  its oldest one drops out. Unlike the LocalBitcoiners playlist, this one doesn't only grow.
- **Newest first across all shows**, by release date. Dormant or live-only shows sink to
  the bottom.
- One flat `<podcast:remoteItem feedGuid="…" feedUrl="…" itemGuid="…"/>` per episode,
  with `medium="video"` added for video shows. liveItems are never included.

## How it stays current

The show list is read from smallgroupscoop.com/shows on every run, so shows that join
or leave are picked up automatically. The site publishes no feed URLs, so each show's
feed comes from (in order):

1. `KNOWN_FEEDS` in `src/services/SmallGroupPlaylistAggregator.js`: the 13 launch
   shows, each verified. **If discovery picks the wrong feed for a new show, add it here.**
2. The feed remembered in the run state.
3. Discovery: the show's own website (linked from its smallgroupscoop page). The run
   uses an RSS feed the site advertises, or a standard location such as
   `feed.<site>/feed.xml`. A feed only counts if its items have audio or video.

It is built to stay up while the site is being built:

- **A show's feed is down:** its previous episodes stay in the playlist (from the run state).
- **The shows page fails, or lists under half the last known shows:** the last known
  show list is used instead.
- **Nothing changed:** when the new XML matches the published file apart from its
  `<pubDate>`/`<lastBuildDate>`, nothing is pushed. A change to the channel
  (new artwork, a removed tag) is pushed on the next run, even with no new episode.

## Usage

```bash
# Generate and publish (borrows the gh CLI token if GITHUB_TOKEN is unset)
npm run create-smallgroup-playlist

# Preview the XML without writing or pushing anything:
node scripts/create-smallgroup-playlist.js --dry-run > preview.xml
```

| Flag | Env var | Purpose |
| --- | --- | --- |
| `--out=<file>` | `SGS_OUTPUT_PATH` | Local output XML path |
| `--dry-run` | `SGS_DRY_RUN=1` | Print the XML instead of writing/pushing |

## Daily CI

`scripts/daily-update.js` runs this as a non-fatal step after the community playlist.
Problems show up as annotations on the Actions run:

- `Small Group feed down` (warning): a feed failed; its previous episodes were kept.
- `Small Group show skipped` (warning): a show has no usable feed yet.
- `New Small Group show` (notice): a feed was discovered; check it and consider adding
  it to `KNOWN_FEEDS`.
- `Small Group playlist` (warning): for example, the shows page couldn't be read.

`FEEDS.md` lists it in its podcastL section, for reference. The per-feed RSS loop never
takes it: `parseFeedsMarkdown` keeps only IDs that contain `-music-playlist`,
`-muic-playlist` or `-musicl-`. The playlist writes no `<podcast:txt purpose="source-feed">`.
Do not add one — it would name the shows web page, which boostmebitch downloads as the
show the playlist was built from.

## Artwork

The cover is `docs/smallgroup-shows-playlist-art.png` in `chadf-musicl-playlists` (1024x1024 PNG),
linked by `PLAYLIST_IMAGE_URL` in `src/services/SmallGroupPlaylistAggregator.js`. To change it,
replace that file (same name, no code change), or upload a new one to `docs/` and point
`PLAYLIST_IMAGE_URL` at its raw.githubusercontent.com URL. A new URL is published on the next run,
even on a day with no new episode; a replaced file at the same URL needs no run, though podcast
apps may keep the old image cached for a while.

Design: `docs/superpowers/specs/2026-10-23-smallgroup-shows-playlist-design.md`.
