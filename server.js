const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // set this in .env, never hardcode
const OWNER = 'pothabattulavinod';
const REPO = 'adc10';
const PORT = process.env.PORT || 3000;

// Map public-facing paths to private repo file paths
const fileMap = {
  segment003: 'CS26/segment003.ts',
  // add more mappings here as needed
  // key: 'path/inside/repo.ext',
};

app.get('/', (req, res) => {
  res.send('Server is running.');
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
