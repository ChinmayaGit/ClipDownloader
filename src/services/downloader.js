const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const ffmpegPath = require('ffmpeg-static');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Downloads and remuxes a video stream (HLS or MP4) to an MP4 file on disk.
 * @param {string} streamUrl Source HLS or video URL
 * @param {string} outputPath Target .mp4 file path
 * @param {object} options Optional callbacks: onProgress, signal
 * @returns {Promise<string>} Output file path
 */
function downloadToMp4(streamUrl, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(outputPath));

    const args = [
      '-y',
      '-headers', `User-Agent: ${USER_AGENT}\r\n`,
      '-i', streamUrl,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args);

    let durationSeconds = 0;
    let stderrBuffer = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;

      // Detect duration: Duration: 00:02:20.00
      if (!durationSeconds) {
        const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        if (durMatch) {
          durationSeconds =
            parseInt(durMatch[1], 10) * 3600 +
            parseInt(durMatch[2], 10) * 60 +
            parseFloat(durMatch[3]);
        }
      }

      // Detect current time: time=00:01:12.34
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (timeMatch && durationSeconds > 0) {
        const currentSeconds =
          parseInt(timeMatch[1], 10) * 3600 +
          parseInt(timeMatch[2], 10) * 60 +
          parseFloat(timeMatch[3]);
        const percent = Math.min(100, Math.round((currentSeconds / durationSeconds) * 100));
        if (options.onProgress) {
          options.onProgress({ percent, currentSeconds, durationSeconds });
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (options.onProgress) {
          options.onProgress({ percent: 100, currentSeconds: durationSeconds, durationSeconds });
        }
        resolve(outputPath);
      } else {
        const errorSnippet = stderrBuffer.slice(-500);
        reject(new Error(`FFmpeg exited with code ${code}: ${errorSnippet}`));
      }
    });

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        reject(new Error('Download cancelled by user'));
      });
    }
  });
}

/**
 * Pipes a remuxed MP4 stream directly to an HTTP response.
 * @param {string} streamUrl Source HLS or video URL
 * @param {object} res Express response object
 * @param {string} filename Output attachment filename
 */
function streamMp4ToResponse(streamUrl, res, filename = 'video.mp4') {
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

  const args = [
    '-headers', `User-Agent: ${USER_AGENT}\r\n`,
    '-i', streamUrl,
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4',
    'pipe:1',
  ];

  const proc = spawn(ffmpegPath, args);

  proc.stdout.pipe(res);

  proc.stderr.on('data', () => {});

  proc.on('error', (err) => {
    console.error('Streaming error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process video stream' });
    }
  });

  res.on('close', () => {
    try {
      proc.kill('SIGKILL');
    } catch {}
  });
}

module.exports = {
  downloadToMp4,
  streamMp4ToResponse,
};

