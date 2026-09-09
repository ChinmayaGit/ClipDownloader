const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { extractInfo } = require('./src/extractors');
const { fetchEpisodeStream } = require('./src/extractors/hdrama');
const { streamMp4ToResponse, downloadToMp4 } = require('./src/services/downloader');
const { createBatchJob, getBatchJob } = require('./src/services/batchZip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Extract metadata from any video/drama link
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const info = await extractInfo(url);

    // Resolve target episode stream
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
    console.error('Extraction error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract video information' });
  }
});

// 2. Resolve single episode stream URL
app.get('/api/stream-info', async (req, res) => {
  try {
    const { bookId, serial } = req.query;
    if (!bookId || !serial) {
      return res.status(400).json({ error: 'bookId and serial are required' });
    }

    const stream = await fetchEpisodeStream(bookId, parseInt(serial, 10));
    res.json({ success: true, data: stream });
  } catch (err) {
    console.error('Stream info error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to resolve stream' });
  }
});

// 3. Download single episode as MP4
app.get('/api/download-single', async (req, res) => {
  try {
    const { bookId, serial, title, streamUrl: passedUrl } = req.query;
    let streamUrl = passedUrl;

    if (!streamUrl && bookId && serial) {
      const stream = await fetchEpisodeStream(bookId, parseInt(serial, 10));
      streamUrl = stream.streamUrl;
    }

    if (!streamUrl) {
      return res.status(400).json({ error: 'Could not resolve stream URL for download' });
    }

    const cleanTitle = (title || 'Video')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_');
    const epNum = serial ? String(serial).padStart(3, '0') : '001';
    const filename = `${cleanTitle}_EP${epNum}.mp4`;

    // Stream remuxed MP4 directly to browser response
    streamMp4ToResponse(streamUrl, res, filename);
  } catch (err) {
    console.error('Single download error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to download episode' });
    }
  }
});

// 4. Start batch download & ZIP job
app.post('/api/batch-zip', (req, res) => {
  try {
    const { seriesInfo, episodeSerials, concurrency } = req.body;
    if (!seriesInfo || !episodeSerials || !Array.isArray(episodeSerials) || episodeSerials.length === 0) {
      return res.status(400).json({ error: 'seriesInfo and non-empty episodeSerials array required' });
    }

    const job = createBatchJob(seriesInfo, episodeSerials, concurrency || 3);
    res.json({ success: true, data: job.toJSON() });
  } catch (err) {
    console.error('Batch job creation error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to start batch job' });
  }
});

// 5. Server-Sent Events (SSE) for real-time batch progress
app.get('/api/batch-progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getBatchJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state
  res.write(`data: ${JSON.stringify(job.toJSON())}\n\n`);

  const onProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.status === 'ready' || data.status === 'error' || data.status === 'cancelled') {
      res.end();
    }
  };

  job.on('progress', onProgress);

  req.on('close', () => {
    job.off('progress', onProgress);
  });
});

// 6. Cancel batch job
app.post('/api/cancel-batch/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getBatchJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  job.cancel();
  res.json({ success: true, message: 'Job cancelled' });
});

// 7. Download finished ZIP archive
app.get('/api/download-zip/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getBatchJob(jobId);

  if (!job || job.status !== 'ready' || !job.zipPath) {
    return res.status(400).json({ error: 'ZIP file is not ready yet or job does not exist' });
  }

  if (!fs.existsSync(job.zipPath)) {
    return res.status(404).json({ error: 'ZIP file has expired or was removed' });
  }

  const filename = path.basename(job.zipPath);
  res.download(job.zipPath, filename);
});

// Start server
app.listen(PORT, () => {
  console.log(`===========================================`);
  console.log(` ClipDownloader Server running!`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(`===========================================`);
});

