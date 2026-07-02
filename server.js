const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // set this in .env, never hardcode
const OWNER = 'pothabattulavinod';
const REPO = 'adc10';
const BRANCH = process.env.BRANCH || 'main'; // change if your default branch isn't "main"
const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // rebuild map every 10 minutes

// Optional: restrict indexing to specific top-level folders.
// e.g. ALLOWED_FOLDERS=CS26,veerab in .env
// Leave empty/unset to index files from the ENTIRE repo.
const ALLOWED_FOLDERS = (process.env.ALLOWED_FOLDERS || '')
  .split(',')
  .map(f => f.trim())
  .filter(Boolean);

// tsMap: key (folder/filename WITHOUT .ts extension) -> full repo path
// allPaths: set of every indexed full repo path (.ts and .m3u8), used for exact playlist lookups
let tsMap = {};
let allPaths = new Set();
let lastBuiltAt = null;

/**
 * Fetches the full repo tree once (single API call) and indexes every
 * .ts (video segment) and .m3u8 (HLS playlist) file, optionally restricted
 * to ALLOWED_FOLDERS.
 */
async function buildFileMap() {
  if (!GITHUB_TOKEN) {
    console.error('Missing GITHUB_TOKEN environment variable.');
    return { tsMap: {}, allPaths: new Set() };
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });

  const newTsMap = {};
  const newAllPaths = new Set();

  for (const item of res.data.tree) {
    if (item.type !== 'blob') continue;

    const isTs = item.path.endsWith('.ts');
    const isM3u8 = item.path.endsWith('.m3u8');
    if (!isTs && !isM3u8) continue;

    if (ALLOWED_FOLDERS.length > 0) {
      const isAllowed = ALLOWED_FOLDERS.some(folder => item.path.startsWith(`${folder}/`));
      if (!isAllowed) continue;
    }

    newAllPaths.add(item.path);

    if (isTs) {
      // "CS26/segment000.ts" -> key "CS26/segment000"
      const key = item.path.replace(/\.ts$/, '');
      newTsMap[key] = item.path;
    }
  }

  console.log(
    `File map rebuilt: ${Object.keys(newTsMap).length} .ts segment(s), ` +
      `${[...newAllPaths].filter(p => p.endsWith('.m3u8')).length} .m3u8 playlist(s)` +
      (ALLOWED_FOLDERS.length ? ` from [${ALLOWED_FOLDERS.join(', ')}]` : ' from entire repo')
  );

  return { tsMap: newTsMap, allPaths: newAllPaths };
}

async function refreshFileMap() {
  try {
    const result = await buildFileMap();
    tsMap = result.tsMap;
    allPaths = result.allPaths;
    lastBuiltAt = new Date();
  } catch (err) {
    console.error('Failed to build file map:', err.message);
  }
}

app.get('/', (req, res) => {
  res.send(
    `Server is running. ${Object.keys(tsMap).length} .ts segments indexed. Last refreshed: ${lastBuiltAt}`
  );
});

// Manual trigger to rebuild the map immediately (e.g. right after pushing new files)
app.get('/_refresh', async (req, res) => {
  await refreshFileMap();
  res.send(`Refreshed. ${Object.keys(tsMap).length} .ts segments indexed.`);
});

// Matches any nested path, e.g. /CS26/segment000, /CS26/segment000.ts, /CS26/index.m3u8
app.get('/*', async (req, res) => {
  const rawKey = decodeURIComponent(req.params[0] || '');

  if (rawKey.includes('..')) {
    return res.status(400).send('Invalid path');
  }

  let filePath = null;
  let isPlaylist = false;

  if (rawKey.endsWith('.m3u8')) {
    // Playlists must be requested with their exact path + extension
    if (allPaths.has(rawKey)) {
      filePath = rawKey;
      isPlaylist = true;
    }
  } else {
    // .ts segment: extension optional in the URL
    const key = rawKey.replace(/\.ts$/, '');
    filePath = tsMap[key] || null;
  }

  if (!filePath) {
    return res.status(404).send('Not found');
  }

  if (!GITHUB_TOKEN) {
    console.error('Missing GITHUB_TOKEN environment variable.');
    return res.status(500).send('Server misconfigured');
  }

  try {
    const response = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.raw+json',
        },
        responseType: 'arraybuffer', // fetch as binary; decode to text only for playlists
      }
    );

    if (isPlaylist) {
      // Rewrite relative segment/sub-playlist references so the player
      // fetches them through THIS server (and thus through GitHub auth),
      // instead of trying to hit the private repo directly.
      const text = Buffer.from(response.data).toString('utf-8');
      const dir = path.posix.dirname(filePath); // '.' if playlist is at repo root

      const rewritten = text
        .split('\n')
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line; // comments/tags untouched
          if (/^https?:\/\//i.test(trimmed)) return line; // already absolute, leave as-is

          let resolved;
          if (trimmed.startsWith('/')) {
            resolved = trimmed.slice(1);
          } else {
            resolved = dir === '.' ? trimmed : path.posix.join(dir, trimmed);
          }
          return `/${resolved}`;
        })
        .join('\n');

      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache');
      return res.send(rewritten);
    }

    // .ts here = MPEG-2 Transport Stream video segment (binary), not TypeScript.
    res.set('Content-Type', 'video/mp2t');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Error fetching file:', err.message);
    res.status(500).send('Error fetching file');
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await refreshFileMap();
  setInterval(refreshFileMap, REFRESH_INTERVAL_MS);
});
