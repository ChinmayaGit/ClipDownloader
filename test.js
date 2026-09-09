const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');
const { extractInfo } = require('./src/extractors');
const { fetchEpisodeStream } = require('./src/extractors/hdrama');
const { downloadToMp4 } = require('./src/services/downloader');
const { createBatchJob } = require('./src/services/batchZip');

const TEST_URL = 'https://en.hdrama.net/series/hero-husband-s-apocalypse-harem-31001691861/episode-1';

async function runTests() {
  console.log('🧪 Starting ClipDownloader Automated Tests...\n');

  // Test 1: Extraction
  console.log('1️⃣ Testing HDrama Info Extraction...');
  const info = await extractInfo(TEST_URL);
  assert.ok(info, 'Info object should exist');
  assert.strictEqual(info.source, 'HDrama');
  assert.ok(info.seriesTitle.includes('Hero Husband'), 'Title should match');
  assert.strictEqual(info.bookId, '31001691861');
  assert.strictEqual(info.targetEpisode, 1);
  assert.ok(info.totalEpisodes >= 60, `Total episodes should be >= 60, got ${info.totalEpisodes}`);
  console.log(`✅ Extracted: "${info.seriesTitle}" (${info.totalEpisodes} episodes, target: EP ${info.targetEpisode})`);

  // Test 2: Stream Decryption
  console.log('\n2️⃣ Testing Episode Stream Decryption...');
  const stream = await fetchEpisodeStream(info.bookId, 1);
  assert.ok(stream, 'Stream should exist');
  assert.ok(stream.streamUrl.startsWith('https://'), 'Stream URL should be valid HTTPS');
  assert.ok(stream.streamUrl.includes('goodshort') || stream.streamUrl.includes('m3u8'), 'Stream URL should be goodshort/m3u8');
  console.log(`✅ Stream Decrypted: ${stream.streamUrl.slice(0, 70)}...`);

  // Test 3: Download & Remux to MP4
  console.log('\n3️⃣ Testing Download & Remux of Episode 1...');
  const testMp4Path = path.join(__dirname, 'temp/test_output_ep1.mp4');
  fs.removeSync(testMp4Path);

  let reportedProgress = false;
  await downloadToMp4(stream.streamUrl, testMp4Path, {
    onProgress: (p) => {
      reportedProgress = true;
      process.stdout.write(`\r   Progress: ${p.percent}%`);
    },
  });
  console.log('');

  assert.ok(fs.existsSync(testMp4Path), 'MP4 file should be created');
  const stats = fs.statSync(testMp4Path);
  assert.ok(stats.size > 100000, `MP4 size should be > 100KB, got ${stats.size} bytes`);
  console.log(`✅ MP4 Created Successfully: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  // Test 4: Batch ZIP on Episodes 1 & 2
  console.log('\n4️⃣ Testing Batch Download & ZIP (EP 1 & 2)...');
  const job = createBatchJob(info, [1, 2], 2);

  await new Promise((resolve, reject) => {
    job.on('progress', (data) => {
      process.stdout.write(`\r   Batch Status: ${data.status} (${data.progress}%) - Completed: ${data.completed}/${data.total}`);
      if (data.status === 'ready') {
        resolve();
      } else if (data.status === 'error') {
        reject(new Error(data.error));
      }
    });
  });
  console.log('');

  assert.ok(job.zipPath, 'ZIP path should exist');
  assert.ok(fs.existsSync(job.zipPath), 'ZIP file should exist on disk');
  const zipStats = fs.statSync(job.zipPath);
  assert.ok(zipStats.size > 500000, `ZIP size should be > 500KB, got ${zipStats.size} bytes`);
  console.log(`✅ ZIP Archive Created: ${(zipStats.size / 1024 / 1024).toFixed(2)} MB at ${job.zipPath}`);

  // Cleanup test files
  fs.removeSync(testMp4Path);
  job.cleanup();

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
