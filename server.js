const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // set this in .env, never hardcode
const OWNER = 'pothabattulavinod';
const REPO = 'adc10';
const PORT = process.env.PORT || 3000;

const githubHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
};

// Cache of allowed top-level folders, refreshed periodically
let allowedFolders = [];

async function refreshAllowedFolders() {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/`,
      { headers: githubHeaders }
    );
    allowedFolders = response.data
      .filter((item) => item.type === 'dir')
      .map((item) => item.name);
    console.log('Allowed folders refreshed:', allowedFolders);
  } catch (err) {
    console.error('Failed to refresh folder list:', err.message);
  }
}

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.get('/*', async (req, res) => {
  const requestedPath = req.params[0];

  if (!requestedPath || requestedPath.includes('..')) {
    return res.status(400).send('Invalid path');
  }

  const topFolder = requestedPath.split('/')[0];
  if (!allowedFolders.includes(topFolder)) {
    return res.status(404).send('Not found');
  }

  if (!GITHUB_TOKEN) {
    console.error('Missing GITHUB_TOKEN environment variable.');
    return res.status(500).send('Server misconfigured');
  }

  try {
    const response = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${requestedPath}`,
      {
        headers: {
          ...githubHeaders,
          Accept: 'application/vnd.github.raw+json',
        },
      }
    );
    res.type('text/plain').send(response.data);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).send('Not found');
    }
    console.error('Error fetching file:', err.message);
    res.status(500).send('Error fetching file');
  }
});

// Load folder list on startup, then refresh every 10 minutes
refreshAllowedFolders();
setInterval(refreshAllowedFolders, 10 * 60 * 1000);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
