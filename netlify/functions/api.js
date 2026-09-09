const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const { extractInfo } = require('../../src/extractors');
const { fetchEpisodeStream } = require('../../src/extractors/hdrama');

const app = express();

app.use(cors());
app.use(express.json());

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', runtime: 'netlify-serverless', time: new Date().toISOString() });
});

// 1. Extract metadata from any video/drama link
router.post('/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const info = await extractInfo(url);

    // Pre-resolve target episode stream
    let targetStream = null;
    try {
      if (info.targetStream) {
        targetStream = info.targetStream;
      } else if (info.source === 'HDrama' && info.bookId) {
        targetStream = await fetchEpisodeStream(info.bookId, info.targetEpisode || 1);
      } else if (info.directStream) {
        targetStream = info.directStream;
      }
    } catch (streamErr) {
      console.warn('Could not pre-fetch target stream:', streamErr.message);
    }

    res.json({
      success: true,
      data: {
        ...info,
        targetStream,
      },
    });
  } catch (err) {
    console.error('Netlify function extraction error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract video information' });
  }
});

// 2. Resolve single episode stream URL
router.get('/stream-info', async (req, res) => {
  try {
    const { bookId, serial } = req.query;
    if (!bookId || !serial) {
      return res.status(400).json({ error: 'bookId and serial are required' });
    }

    const stream = await fetchEpisodeStream(bookId, parseInt(serial, 10));
    res.json({ success: true, data: stream });
  } catch (err) {
    console.error('Netlify function stream info error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to resolve stream' });
  }
});

// 3. Redirect to direct stream URL for browser download
router.get('/download-single', async (req, res) => {
  try {
    const { bookId, serial } = req.query;
    if (!bookId || !serial) {
      return res.status(400).json({ error: 'bookId and serial are required' });
    }

    const stream = await fetchEpisodeStream(bookId, parseInt(serial, 10));
    if (stream && stream.streamUrl) {
      return res.redirect(302, stream.streamUrl);
    }
    res.status(404).json({ error: 'Stream not found' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to resolve stream' });
  }
});

// Handle paths under both /api and root
app.use('/api', router);
app.use('/.netlify/functions/api', router);
app.use('/', router);

module.exports.handler = serverless(app);
