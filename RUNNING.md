# How the daily job in this repo runs

This file tells you what runs automatically in this repo, what the job needs, and how to run it on a different machine. Use it if you move the job off GitHub Actions.

Other files in this repo (`GITHUB-ACTIONS-SETUP.md`, `SETUP-GUIDE.md`, and others) are older and longer. This file describes only the current daily job.

## Summary

| Item | Value |
|---|---|
| Workflow file | `.github/workflows/daily-feed-update.yml` |
| Starts when | Every day at 07:00 UTC. Also by hand (`workflow_dispatch`, with an optional `force_update` input). |
| Runs | `npm ci`, then `node scripts/daily-update.js` |
| Runtime | Node 24 (`package.json` requires `^24.22.1`) |
| Writes to this repo | `src/config/feeds.json` only (commit message ends with `[skip ci]`) |
| Writes to [chadf-musicl-playlists](https://github.com/ChadFarrow/chadf-musicl-playlists) | The playlist files in `docs/`, and `state/smallgroup-shows-playlist.json`, through the GitHub API |

## What the job does

1. It reads `FEEDS.md` from `chadf-musicl-playlists` to get the list of playlists.
2. For each feed in `src/config/feeds.json`, it reads the source RSS feed. If a new episode is available, it updates the playlist.
3. It makes the community playlists (Local Bitcoiners) and the Small Group Scoop shows playlist.
4. It writes each changed playlist to `chadf-musicl-playlists/docs/` with the GitHub API. Each write starts the Greatest Hits job in that repo.
5. For each changed playlist, it tells Podcast Index to read the feed again (`/hub/pubnotify`, no API key necessary). It also sends a podping through the msp-podping-service pusher.
6. It commits `src/config/feeds.json` to this repo, if it changed.

A feed that fails (for example, HTTP 403 or 404) gives a warning. It does not stop the job.

## Secrets

These secrets are in **Settings → Secrets and variables → Actions** on GitHub. GitHub does not show the values again, so keep a copy in your password manager.

| Secret | Environment variable in the job | What it is | Where to get a new value |
|---|---|---|---|
| `TOKEN` | `GITHUB_TOKEN` | GitHub personal access token. The job uses it to read and write `chadf-musicl-playlists` through the API, and to check out and push this repo. | GitHub → Settings → Developer settings → Fine-grained tokens. Give **Contents: Read and write** on `chadf-musicl-playlists` and `musicL-playlist-updater`. |
| `PODPING_ENDPOINT_URL` | `PODPING_ENDPOINT_URL` | URL of the msp-podping-service pusher on Railway | The Railway project for `msp-podping-service` (currently `https://msp-podping-service-production.up.railway.app/`) |
| `PODPING_BEARER_TOKEN` | `PODPING_BEARER_TOKEN` | Bearer token for the pusher | The `PODPING_SHARED_SECRET` variable in that Railway service |

The secret is named `TOKEN` because GitHub reserves the name `GITHUB_TOKEN`. The workflow maps `TOKEN` to the `GITHUB_TOKEN` environment variable.

If the two podping values are not set, the job still runs, but it sends no podpings. It gives only a warning.

## Settings that are not secrets

- The target repo is `ChadFarrow/chadf-musicl-playlists`, branch `main`. These values are defaults in `scripts/daily-update.js`. An optional `config.json` can change them (`github.repoOwner`, `github.repoName`, `github.repoBranch`). `config.json` is in `.gitignore`. The daily job does not read the `GITHUB_REPO_*` lines in `env.example`.
- `FORCE_UPDATE=true` makes the job update all feeds, also feeds with no new episode.
- `LOG_LEVEL` sets the log level (default `info`).

## Run the job locally

These steps are for a Linux server, for example your Ubuntu server.

### 1. Install
```bash
git clone https://github.com/ChadFarrow/musicL-playlist-updater.git
cd musicL-playlist-updater
npm ci            # needs Node 24
```

### 2. Put the secrets in an env file
`scripts/daily-update.js` does not load a `.env` file by itself. Thus, use a file that the shell or systemd loads:

```bash
# /etc/musicl-updater.env   (chmod 600, owned by the job user)
GITHUB_TOKEN=github_pat_...
PODPING_ENDPOINT_URL=https://msp-podping-service-production.up.railway.app/
PODPING_BEARER_TOKEN=...
```

### 3. Run it
```bash
set -a; . /etc/musicl-updater.env; set +a
git pull --rebase origin main
node scripts/daily-update.js

# Keep feeds.json in the repo up to date
git add src/config/feeds.json
git diff --cached --quiet || git commit -m "Auto-update: feed configuration [skip ci]"
git push
```

To push, the clone needs git credentials (the same token in a credential helper, or an SSH deploy key with write access).

### 4. Then run Greatest Hits
The playlist writes go to `chadf-musicl-playlists` through the API. On GitHub, each write starts the Greatest Hits job there. On a local run, that does not occur, so run Greatest Hits after this job. See `RUNNING.md` in `chadf-musicl-playlists`.

### 5. Schedule
Use a systemd timer (`OnCalendar=*-*-* 07:00:00 UTC`, `Persistent=true`) or cron. If you run the job locally, disable the `schedule:` trigger in `.github/workflows/daily-feed-update.yml`. If you do not, GitHub and your server do the same updates two times.
