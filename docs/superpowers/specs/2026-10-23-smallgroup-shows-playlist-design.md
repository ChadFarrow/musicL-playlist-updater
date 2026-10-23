# Small Group Shows Playlist — Design

**Date:** 2026-10-23
**Status:** Approved

## Problem

Chad wants one automated playlist that follows every show listed at
https://smallgroupscoop.com/shows/ (13 shows at launch, a mix of talk and music
shows) and lists each show's episodes as they're released, so a podcast app shows
what's new across the whole network.

## Decisions (made with Chad)

- **Full episodes, not songs.** A `podcastL` playlist like the LocalBitcoiners
  community playlist, using a plain flat list rather than the musicL template
  (no `purpose="episode"` markers).
- **Latest 10 episodes per show, rolling.** A new episode pushes that show's
  oldest one out. This differs from the LocalBitcoiners playlist, which only grows.
- **Newest first across all shows**, by release date. Dormant or live-only shows
  sink to the bottom.
- **Fully automatic show list.** Every run reads the /shows/ page, so shows that
  join get picked up and shows that leave drop out. The site is new and still
  being built, so a site change must never break or empty the playlist.
- **If a show's feed is down, keep its previous episodes** instead of dropping
  them or holding back the whole update.
- **Artwork comes later.** `PLAYLIST_IMAGE_URL` stays empty, so no `<image>` is
  written, until Chad uploads art to the target repo's `docs/`.

## Findings that shaped the design

- smallgroupscoop.com is static HTML. No page publishes a feed URL, and there is
  no JSON or OPML. Each show page links "Visit the show's own site".
- Every show's feed holds its full back catalog, and every `<item>` has a
  `<guid>`. 12 of 13 feeds also carry `<podcast:liveItem>`s, which are excluded.
- 8 feeds bind `podcast:` to the old GitHub namespace URI, and Podhome feeds put
  liveItems *before* the channel's `<podcast:guid>`. So channel tags are read
  with regexes on the raw XML, after removing the liveItems.
- ABS n' a 6-Pack (Squarespace) has no `<podcast:guid>`, and its Podcast Index
  GUID can't be derived from its current URL, so `KNOWN_FEEDS` overrides it.
- Show websites often advertise a blog feed instead of the podcast feed, so
  discovery only accepts feeds whose items have audio or video enclosures.
- CI runs Node 18, but the locked cheerio needs Node ≥20.18.1, and
  `daily-update.js` imports every aggregator when it loads. **No cheerio.**

## Design

`src/services/SmallGroupPlaylistAggregator.js` follows the
`CommunityPlaylistAggregator` pattern: the same config, `generate()`,
`--dry-run`, GitHub sync, and a hardcoded `<podcast:guid>`. Each run:

1. **Loads state** from `state/smallgroup-shows-playlist.json` in the target repo
   (`{ updatedAt, shows, episodes }`, where each episode has its `pubDate`). This
   holds what the XML can't: dates and each show's feed. It sits outside `docs/`
   so nothing serves it or treats it as a playlist.
2. **Reads the show list** from /shows/. If the fetch fails, or the page lists
   fewer than half the shows the last run saw, it falls back to the last known
   list plus `KNOWN_FEEDS` and raises a warning.
3. **Resolves each feed** from `KNOWN_FEEDS` (13 verified feeds), then from the
   feed saved in state, then by discovery: the show's own site's advertised
   feeds, then standard locations such as `feed.<site>/feed.xml`.
4. **Fetches each feed's 10 newest episodes**, retrying 2× with 10s waits (403
   and 404 aren't retried). If a show still fails, it keeps the episodes saved
   in state (reported as `stale`); a show with nothing saved is `skipped`. The
   feedGuid comes from the override, then the channel's `<podcast:guid>`, then
   the UUIDv5 of the URL (with a warning).
5. **Builds the XML:** every episode, newest first, as
   `<podcast:remoteItem feedGuid feedUrl itemGuid [medium]>`. `medium` is only
   written for shows that aren't `podcast`, which today means Hyper SpaceOut
   (`video`).
6. **Publishes only on change.** If the ordered entries match the state, it
   writes, pushes, and PodPings nothing. Otherwise it pushes
   `docs/smallgroup-shows-playlist.xml`, then the state, then sends a PodPing.

`scripts/daily-update.js` runs it as a non-fatal step after the community
playlist, sharing that step's error handling through `runAggregatorStep`. There's
no outer retry, because the step already retries each show. Stale, skipped, and
discovered shows and warnings become `::warning::` / `::notice::` annotations.
`scripts/create-smallgroup-playlist.js` (`npm run create-smallgroup-playlist`)
is the manual CLI.

## Testing

`src/services/SmallGroupPlaylistAggregator.test.js` tests the parsers with
fixtures taken from the real pages, and runs `generate()` end-to-end against an
in-memory web and an in-memory target repo. The end-to-end tests cover: ordering,
a feed going down, retries, skipping, publishing only on change, a show leaving
the page, a broken shows page, the ABS guid override, discovery that rejects blog
feeds, standard-location discovery, and dry-run.
