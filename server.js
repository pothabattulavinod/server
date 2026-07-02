const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // set this in .env, never hardcode
const OWNER = 'pothabattulavinod';
const REPO = 'adc10';
const BRANCH = process.env.BRANCH || 'main'; // change if your default branch isn't "main"
const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // rebuild map every 10 minutes

// Optional: restrict indexing to specific top-level folders.
// e.g. ALLOWED_FOLDERS=CS26,CS30,CS40 in .env
// Leave empty/unset to index .ts files from the ENTIRE repo.
const ALLOWED_FOLDERS = (process.env.ALLOWED_FOLDERS || '')
  .split(',')
  .map(f => f.trim())
  .filter(Boolean);

// In-memory map: { 'CS26/segment003': 'CS26/segment003.ts', ... }
let fileMap = {};
let lastBuiltAt = null;

/**
 * Fetches the full repo tree once (single API call, not one per file) and
 * builds a { 'folder/filenameWithoutExt': fullPath } map for every .ts file,
 * optionally restricted to ALLOWED_FOLDERS.
 */
async function buildFileMap() {
  if (!GITHUB_TOKEN) {
    console.error('Missing GITHUB_TOKEN environment variable.');
    return {};
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });

  const map = {};

  for (const item of res.data.tree) {
    if (item.type !== 'blob') continue;
    if (!item.path.endsWith('.ts')) continue;

    if (ALLOWED_FOLDERS.length > 0) {
      const isAllowed = ALLOWED_FOLDERS.some(folder => item.path.startsWith(`${folder}/`));
      if (!isAllowed) continue;
    }

    // "CS26/segment003.ts" -> key "CS26/segment003"
    const key = item.path.replace(/\.ts$/, '');
    map[key] = item.path;
  }

  console.log(
    `File map rebuilt: ${Object.keys(map).length} files indexed` +
      (ALLOWED_FOLDERS.length ? ` from [${ALLOWED_FOLDERS.join(', ')}]` : ' from entire repo')
  );
  return map;
}

async function refreshFileMap() {
  try {
    fileMap = await buildFileMap();
    lastBuiltAt = new Date();
  } catch (err) {
    console.error('Failed to build file map:', err.message);
  }
}

app.get('/', (req, res) => {
  res.send(
    `Server is running. ${Object.keys(fileMap).length} files indexed. Last refreshed: ${lastBuiltAt}`
  );
});

// Manual trigger to rebuild the map immediately (e.g. right after pushing new files)
app.get('/_refresh', async (req, res) => {
  await refreshFileMap();
  res.send(`Refreshed. ${Object.keys(fileMap).length} files indexed.`);
});

// Matches any nested path, e.g. /CS26/segment003 or /veerab/segment000
app.get('/*', async (req, res) => {
  const rawKey = decodeURIComponent(req.params[0] || '');

  // Strip a trailing .ts if someone includes the extension in the URL
  const key = rawKey.replace(/\.ts$/, '');

  // Block path traversal attempts
  if (key.includes('..')) {
    return res.status(400).send('Invalid path');
  }

  const filePath = fileMap[key];

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
      }
    );
    res.type('text/plain').send(response.data);
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
