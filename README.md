# Pinball Missions

Focused in-game objectives for the pinball machines at your location. Objectives are **questlines**: ordered chains of goals (qualify → start → jackpots → super jackpot → mini-wizard) drawn from the community rulesheets at [pinballrulesheets.com](https://pinballrulesheets.com/).

The site is static. Rulesheets are imported into SQLite by a script a few times a year, then exported to a JSON bundle the pages load. Player locations and progress live in the browser.

## Layout

| Path | What it is |
| --- | --- |
| `scripts/scrape.js` | Reads the master list and every rulesheet, stores markdown + a content hash in `data/pinball.db` |
| `scripts/extract.js` | Sends changed rulesheets to Claude (`claude-sonnet-5-5`) and stores questlines/steps |
| `scripts/export.js` | Writes `public/data/machines.json` and `public/data/questlines.json` |
| `scripts/dev.js` | Local server for `public/` plus the Pinball Map proxy |
| `netlify/functions/pinballmap.js` | Proxy for Pinball Map search/lineups (keeps the API token server-side) |
| `public/` | The website (plain HTML/CSS/JS, no build step) |

## Setup

Requires Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
```

Create `.env` from `.env.example` and fill in:

- `ANTHROPIC_API_KEY`: needed only for `npm run extract`.
- `PINBALLMAP_API_TOKEN`: needed for the "Import from Pinball Map" feature. Request one at <https://pinballmap.com/api_token>.

## Updating the database

When new machines or rulesheet updates come out:

```bash
npm run update
```

This runs scrape → extract → export. Extraction only processes rulesheets whose content changed since the last run, so a no-change update costs nothing. Useful flags (pass after `--`):

- `npm run extract -- --only stern/godzilla,fallout`: limit to some machines
- `npm run extract -- --force`: re-extract even if unchanged (e.g. after editing the prompt)

Commit `data/pinball.db` and `public/data/` so deploys don't need to re-run extraction. Player progress is keyed by questline and step titles, so re-extracting can reset progress on steps whose wording changes.

## Local development

```bash
npm run dev
```

Then open <http://localhost:8888>.

## Pushing to a Git repository

Netlify deploys from a Git repository, so the project needs to live in one (GitHub is assumed below; GitLab and Bitbucket work the same way).

1. **Install Git** if `git --version` doesn't work. On Windows:

   ```bash
   winget install --id Git.Git -e
   ```

   Then open a new terminal so `git` is on your PATH, and set your name and email once:

   ```bash
   git config --global user.name "Your Name"
   ```

   ```bash
   git config --global user.email "you@example.com"
   ```

2. **Create an empty repository** on GitHub (New repository → name it, e.g. `pinball-missions`). Don't add a README, license, or `.gitignore`, since this project already has them.

3. **Commit the project.** From this folder:

   ```bash
   git init -b main
   ```

   ```bash
   git add .
   ```

   Before committing, run `git status` and confirm `.env` and `node_modules/` are **not** listed. `.gitignore` excludes them, and `.env` holds your API keys. `data/pinball.db` and `public/data/` **should** be listed, because the deployed site needs them.

   ```bash
   git commit -m "Initial commit"
   ```

4. **Connect and push**, using the URL GitHub shows for your new repository:

   ```bash
   git remote add origin https://github.com/<your-username>/pinball-missions.git
   ```

   ```bash
   git push -u origin main
   ```

   The first push opens a browser window to sign in to GitHub.

After a database update (`npm run update`), publish the new data with:

```bash
git add data public/data
```

```bash
git commit -m "Update rulesheet data"
```

```bash
git push
```

Netlify redeploys automatically on each push.

## Deploying to Netlify

1. Create a Netlify site from the repository (Add new site → Import an existing project → pick the repo). `netlify.toml` publishes `public/` with no build command.
2. In the site's environment variables, set `PINBALLMAP_API_TOKEN`.
3. Deploy. The proxy is served at `/api/pinballmap`.

## Credits

Rulesheets by the writers credited on each pinballrulesheets.com page (originally TiltForums). Venue data from Pinball Map, CC BY-SA 4.0.
