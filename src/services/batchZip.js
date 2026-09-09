const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const { EventEmitter } = require('events');
const { downloadToMp4 } = require('./downloader');
const { fetchEpisodeStream } = require('../extractors/hdrama');

const jobs = new Map();

class BatchJob extends EventEmitter {
  constructor(jobId, seriesInfo, episodeSerials = [], concurrency = 3) {
    super();
    this.jobId = jobId;
    this.seriesInfo = seriesInfo;
    this.episodeSerials = episodeSerials.sort((a, b) => a - b);
    this.concurrency = concurrency;
    this.total = this.episodeSerials.length;
    this.completed = 0;
    this.failed = 0;
    this.currentEpisode = null;
    this.status = 'queued'; // 'queued' | 'downloading' | 'zipping' | 'ready' | 'error' | 'cancelled'
    this.progress = 0;
    this.error = null;
    this.zipPath = null;
    this.tempDir = path.join(__dirname, '../../temp', jobId);
    this.downloadedFiles = [];
    this.abortController = new AbortController();
  }

  cancel() {
    this.status = 'cancelled';
    this.abortController.abort();
    this.emit('progress', this.toJSON());
    this.cleanup();
  }

  async start() {
    this.status = 'downloading';
    this.emit('progress', this.toJSON());
    fs.ensureDirSync(this.tempDir);

    try {
      // Process queue with concurrency control
      const queue = [...this.episodeSerials];
      const workers = [];

      const runWorker = async () => {
        while (queue.length > 0 && this.status === 'downloading') {
          const serial = queue.shift();
          this.currentEpisode = serial;
          this.emit('progress', this.toJSON());

          try {
            // 1. Resolve stream
            const stream = await fetchEpisodeStream(this.seriesInfo.bookId, serial);
            const padSerial = String(serial).padStart(3, '0');
            const fileName = `${this.sanitizeName(this.seriesInfo.seriesTitle)}_EP${padSerial}.mp4`;
            const filePath = path.join(this.tempDir, fileName);

            // 2. Download and remux
            await downloadToMp4(stream.streamUrl, filePath, {
              signal: this.abortController.signal,
            });

            this.downloadedFiles.push({ serial, filePath, fileName });
            this.completed++;
          } catch (err) {
            console.error(`Error downloading episode ${serial}:`, err.message);
            this.failed++;
          }

          this.progress = Math.round(((this.completed + this.failed) / this.total) * 90);
          this.emit('progress', this.toJSON());
        }
      };

      for (let i = 0; i < Math.min(this.concurrency, this.total); i++) {
        workers.push(runWorker());
      }

      await Promise.all(workers);

      if (this.status === 'cancelled') return;

      if (this.downloadedFiles.length === 0) {
        throw new Error('No episodes were successfully downloaded');
      }

      // 3. Zip files
      this.status = 'zipping';
      this.emit('progress', this.toJSON());

      const zipFileName = `${this.sanitizeName(this.seriesInfo.seriesTitle)}_All_Episodes.zip`;
      this.zipPath = path.join(this.tempDir, zipFileName);

      await this.createZipArchive(this.downloadedFiles, this.zipPath);

      this.status = 'ready';
      this.progress = 100;
      this.emit('progress', this.toJSON());

      // Remove intermediate mp4 files to free up disk space, keeping only the zip
      for (const item of this.downloadedFiles) {
        try {
          fs.removeSync(item.filePath);
        } catch {}
      }

      // Auto-cleanup zip after 1 hour
      const timer = setTimeout(() => {
        this.cleanup();
      }, 60 * 60 * 1000);
      if (timer.unref) timer.unref();
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      this.emit('progress', this.toJSON());
      this.cleanup();
    }
  }

  createZipArchive(files, destination) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destination);
      let archive;
      if (typeof archiver === 'function') {
        archive = archiver('zip', { zlib: { level: 1 } });
      } else if (archiver.ZipArchive) {
        archive = new archiver.ZipArchive({ zlib: { level: 1 } });
      } else {
        throw new Error('Unsupported archiver module format');
      }

      output.on('close', () => resolve(destination));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      for (const file of files) {
        if (fs.existsSync(file.filePath)) {
          archive.file(file.filePath, { name: file.fileName });
        }
      }

      archive.finalize();
    });
  }

  sanitizeName(name) {
    return (name || 'Drama')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 50);
  }

  cleanup() {
    try {
      if (this.tempDir && fs.existsSync(this.tempDir)) {
        fs.removeSync(this.tempDir);
      }
    } catch (e) {
      console.error('Error during cleanup:', e.message);
    }
  }

  toJSON() {
    return {
      jobId: this.jobId,
      status: this.status,
      seriesTitle: this.seriesInfo.seriesTitle,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      currentEpisode: this.currentEpisode,
      progress: this.progress,
      error: this.error,
    };
  }
}

function createBatchJob(seriesInfo, episodeSerials = [], concurrency = 3) {
  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const job = new BatchJob(jobId, seriesInfo, episodeSerials, concurrency);
  jobs.set(jobId, job);
  job.start();
  return job;
}

function getBatchJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = {
  createBatchJob,
  getBatchJob,
};
