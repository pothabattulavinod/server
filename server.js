const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // set this in .env, never hardcode
const OWNER = 'pothabattulavinod';
const REPO = 'adc10';
const BRANCH = process.env.BRANCH || 'main'; // change if your default branch isn't "main"
const SOURCE_FOLDER = process.env.SOURCE_FOLDER || 'CS26'; // folder containing your .ts files
const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // rebuild map every 10 minutes

// In-memory map: { segment003: 'CS26/segment003.ts', ... }
let fileMap = {};
let lastBuiltAt = null;

/**
 * Fetches the full repo tree once and builds a { filenameWithoutExt: fullPath } map
 * for every file under SOURCE_FOLDER. Uses the Git Trees API (1 request, not 300).
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
  const duplicates = [];

  for (const item of res.data.tree) {
    if (item.type !== 'blob') continue;
    if (!item.path.startsWith(`${SOURCE_FOLDER}/`)) continue;
    if (!item.path.endsWith('.ts')) continue;

    // "CS26/segment003.ts" -> key "segment003"
    const filename = item.path.split('/').pop();
    const key = filename.replace(/\.ts$/, '');

    if (map[key]) {
      duplicates.push({ key, existing: map[key], skipped: item.path });
      continue; // keep the first one found; log the clash
    }

    map[key] = item.path;
  }

  if (duplicates.length) {
    console.warn(
      `Warning: ${duplicates.length} duplicate filename(s) found, some files are not reachable by key:`,
      duplicates
    );
  }

  console.log(`File map rebuilt: ${Object.keys(map).length} files indexed from ${SOURCE_FOLDER}/`);
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

app.get('/:key', async (req, res) => {
  const filePath = fileMap[req.params.key];

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
