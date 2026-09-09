// State
let currentSeriesData = null;
let currentHlsInstance = null;
let currentBatchEventSource = null;
let currentJobId = null;

// Active Player State
let currentlyPlayingSerial = null;
let currentlyPlayingBlob = null;
let currentlyPlayingFilename = '';
let currentlyPlayingUrl = null;
let isDownloadingForPlayer = false;

// DOM Elements
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const pasteBtn = document.getElementById('paste-btn');
const fetchBtn = document.getElementById('fetch-btn');
const alertBox = document.getElementById('alert-box');

// Target Episode Card
const targetSection = document.getElementById('target-episode-section');
const targetPoster = document.getElementById('target-poster');
const targetSource = document.getElementById('target-source');
const targetEpBadge = document.getElementById('target-ep-badge');
const targetSeriesTitle = document.getElementById('target-series-title');
const targetEpSubtitle = document.getElementById('target-ep-subtitle');
const downloadCurrentBtn = document.getElementById('download-current-btn');
const downloadCurrentText = document.getElementById('download-current-text');
const playVideoBtn = document.getElementById('play-video-btn');
const playVideoText = document.getElementById('play-video-text');

// Video Player Elements
const videoPreviewWrapper = document.getElementById('video-preview-wrapper');
const videoPlayer = document.getElementById('video-player');
const playerStatusBadge = document.getElementById('player-status-badge');
const closePlayerBtn = document.getElementById('close-player-btn');
const playerInfoText = document.getElementById('player-info-text');
const savePlayingVideoBtn = document.getElementById('save-playing-video-btn');

// All Episodes Section
const allEpisodesSection = document.getElementById('all-episodes-section');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const selectedCountText = document.getElementById('selected-count-text');
const downloadZipBtn = document.getElementById('download-zip-btn');
const downloadZipText = document.getElementById('download-zip-text');
const episodesSearch = document.getElementById('episodes-search');
const episodesCountPill = document.getElementById('episodes-count-pill');
const episodesGrid = document.getElementById('episodes-grid');

// Unlock Card Elements
const unlockCard = document.getElementById('unlock-card');
const unlockHeaderBox = document.getElementById('unlock-header-box');
const unlockOptionsBox = document.getElementById('unlock-options-box');
const unlockSuccessBox = document.getElementById('unlock-success-box');
const unlockSuccessTitle = document.getElementById('unlock-success-title');
const unlockSuccessDesc = document.getElementById('unlock-success-desc');
const unlockTokenInput = document.getElementById('unlock-token-input');
const unlockTokenBtn = document.getElementById('unlock-token-btn');
const headerBookmarklet = document.getElementById('header-bookmarklet');
const inlineBookmarkletLink = document.getElementById('inline-bookmarklet-link');

// Batch Modal
const progressModal = document.getElementById('progress-modal');
const modalTitle = document.getElementById('modal-title');
const modalSubtitle = document.getElementById('modal-subtitle');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercentage = document.getElementById('progress-percentage');
const progressDetail = document.getElementById('progress-detail');
const cancelBatchBtn = document.getElementById('cancel-batch-btn');
const modalSuccessBox = document.getElementById('modal-success-box');
const modalDownloadLink = document.getElementById('modal-download-link');

// Client Abort Controller
let clientAbortController = null;

// 1. Paste Button handler
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      urlInput.focus();
    }
  } catch (err) {
    showAlert('Clipboard access denied. Please paste directly into the box.', 'error');
  }
});

// 2. Sample chip clicks
document.querySelectorAll('.sample-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    urlInput.value = chip.getAttribute('data-url');
    urlForm.dispatchEvent(new Event('submit'));
  });
});

// 3. Form Submit
urlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  setLoading(true);
  hideAlert();
  resetUI();

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Failed to fetch episode details');
    }

    currentSeriesData = result.data;
    renderTargetEpisode(currentSeriesData);
    renderAllEpisodes(currentSeriesData);

    const hasStreams = currentSeriesData.targetStream?.streamUrl || currentSeriesData.episodes?.[0]?.streamUrl;
    if (!hasStreams && unlockCard) {
      unlockCard.hidden = false;
      unlockCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    if (url.includes('hdrama.net') || url.includes('/series/')) {
      handleHDramaClientFallback(url);
    } else {
      showAlert(err.message || 'Error communicating with server', 'error');
    }
  } finally {
    setLoading(false);
  }
});

// 4. Render Target Episode Card
function renderTargetEpisode(data) {
  targetPoster.onerror = () => {
    targetPoster.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%231e293b" width="100" height="150"/><text x="50" y="75" fill="%2364748b" font-size="12" text-anchor="middle" dominant-baseline="middle">Cover</text></svg>';
  };
  targetPoster.src = data.poster || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%231e293b" width="100" height="150"/></svg>';
  targetSource.textContent = data.source || 'HDrama';
  targetEpBadge.textContent = `Episode ${data.targetEpisode || 1}`;
  targetSeriesTitle.textContent = data.seriesTitle || 'Drama Series';
  targetEpSubtitle.textContent = `Ready for instant download & playback · Total: ${data.totalEpisodes} episodes available`;

  downloadCurrentText.textContent = `Download Episode ${data.targetEpisode || 1} (MP4)`;
  downloadCurrentBtn.onclick = () => {
    triggerSingleDownload(data.targetEpisode || 1);
  };

  playVideoBtn.onclick = () => {
    downloadAndPlayEpisode(data.targetEpisode || 1);
  };

  targetSection.hidden = false;
}

// 5. Render All Episodes
function renderAllEpisodes(data) {
  episodesGrid.innerHTML = '';
  const episodes = data.episodes || [];
  episodesCountPill.textContent = `${episodes.length} Episodes Found`;

  episodes.forEach((ep) => {
    const card = document.createElement('div');
    card.className = `episode-card ${ep.serial === data.targetEpisode ? 'is-target' : ''}`;
    card.dataset.serial = ep.serial;

    card.innerHTML = `
      <div class="episode-card-left">
        <input type="checkbox" class="episode-checkbox" data-serial="${ep.serial}" checked />
        <span class="episode-title-label">EP ${String(ep.serial).padStart(2, '0')}</span>
      </div>
      <div class="episode-card-actions">
        <button type="button" class="btn-ep-play" title="Download & Play EP ${ep.serial}">
          <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </button>
        <button type="button" class="btn-ep-download" title="Download EP ${ep.serial} (MP4)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
      </div>
    `;

    // Play episode (download into memory then play)
    card.querySelector('.btn-ep-play').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadAndPlayEpisode(ep.serial);
    });

    // Download single episode button
    card.querySelector('.btn-ep-download').addEventListener('click', (e) => {
      e.stopPropagation();
      triggerSingleDownload(ep.serial);
    });

    // Checkbox toggle updates count
    card.querySelector('.episode-checkbox').addEventListener('change', updateSelectionCount);

    episodesGrid.appendChild(card);
  });

  allEpisodesSection.hidden = false;
  updateSelectionCount();
}

// 6. Selection count and tool handlers
function updateSelectionCount() {
  const checkboxes = document.querySelectorAll('.episode-checkbox:checked');
  const total = document.querySelectorAll('.episode-checkbox').length;
  const count = checkboxes.length;

  selectedCountText.textContent = `${count} selected`;
  if (count === total) {
    downloadZipText.textContent = `Download All as ZIP (${count})`;
  } else {
    downloadZipText.textContent = `Download Selected as ZIP (${count})`;
  }
}

selectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.episode-card:not([style*="display: none"]) .episode-checkbox').forEach((cb) => {
    cb.checked = true;
  });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.episode-checkbox').forEach((cb) => {
    cb.checked = false;
  });
  updateSelectionCount();
});

// Search & Filter
episodesSearch.addEventListener('input', (e) => {
  const query = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.episode-card').forEach((card) => {
    const serial = card.dataset.serial;
    if (!query || serial.includes(query) || `episode ${serial}`.includes(query)) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
});

// Helper to sanitize filename
function sanitizeFilename(name) {
  return (name || 'Drama')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50);
}

// Helper to save a Blob to disk
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// Helper to fetch all TS segment URLs from an HLS playlist (recursing if master playlist)
async function fetchPlaylistSegments(playlistUrl, signal) {
  const playlistRes = await fetch(playlistUrl, { signal });
  if (!playlistRes.ok) throw new Error(`HTTP ${playlistRes.status} fetching playlist`);
  const text = await playlistRes.text();

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);

  // Check if master playlist
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  if (isMaster) {
    const variantLine = lines.find((l) => !l.startsWith('#') && (l.includes('.m3u8') || l.includes('http')));
    if (variantLine) {
      const variantUrl = variantLine.startsWith('http') ? variantLine : new URL(variantLine, playlistUrl).href;
      return fetchPlaylistSegments(variantUrl, signal);
    }
  }

  const segmentLines = lines.filter((l) => !l.startsWith('#'));
  const tsUrls = segmentLines.map((l) => (l.startsWith('http') ? l : new URL(l, playlistUrl).href));
  return tsUrls;
}

// Transmux MPEG-TS chunks into an ISO BMFF MP4 Blob using mux.js in the browser
function transmuxTsChunksToMp4(chunks) {
  return new Promise((resolve) => {
    if (typeof muxjs === 'undefined') {
      console.warn('mux.js is not loaded, returning raw blob');
      return resolve(new Blob(chunks, { type: 'video/mp4' }));
    }

    try {
      const transmuxer = new muxjs.mp4.Transmuxer({
        remux: true,
        keepOriginalTimestamps: false,
      });

      let initSegment = null;
      const mediaSegments = [];

      transmuxer.on('data', (segment) => {
        if (segment.initSegment && !initSegment) {
          initSegment = segment.initSegment;
        }
        if (segment.data) {
          mediaSegments.push(segment.data);
        }
      });

      for (const chunk of chunks) {
        if (chunk && chunk.byteLength > 0) {
          transmuxer.push(new Uint8Array(chunk));
        }
      }
      transmuxer.flush();

      if (!initSegment && mediaSegments.length === 0) {
        console.warn('Transmuxer produced no output segments, using raw blob');
        return resolve(new Blob(chunks, { type: 'video/mp4' }));
      }

      const totalLength =
        (initSegment ? initSegment.byteLength : 0) +
        mediaSegments.reduce((acc, seg) => acc + seg.byteLength, 0);

      const combined = new Uint8Array(totalLength);
      let offset = 0;
      if (initSegment) {
        combined.set(new Uint8Array(initSegment.buffer, initSegment.byteOffset, initSegment.byteLength), offset);
        offset += initSegment.byteLength;
      }
      for (const seg of mediaSegments) {
        combined.set(new Uint8Array(seg.buffer, seg.byteOffset, seg.byteLength), offset);
        offset += seg.byteLength;
      }

      resolve(new Blob([combined], { type: 'video/mp4' }));
    } catch (err) {
      console.warn('Transmux error, falling back to raw chunks:', err);
      resolve(new Blob(chunks, { type: 'video/mp4' }));
    }
  });
}

// Download stream segments directly in browser and transmux to MP4
async function fetchEpisodeBlob(serial, signal, onProgress) {
  let streamUrl = null;

  if (currentSeriesData.targetEpisode === serial && currentSeriesData.targetStream?.streamUrl) {
    streamUrl = currentSeriesData.targetStream.streamUrl;
  } else {
    const ep = currentSeriesData.episodes?.find((e) => e.serial === serial);
    if (ep?.streamUrl) {
      streamUrl = ep.streamUrl;
    }
  }

  if (!streamUrl && currentSeriesData.bookId) {
    try {
      const res = await fetch(`/api/stream-info?bookId=${currentSeriesData.bookId}&serial=${serial}`, { signal });
      const json = await res.json();
      if (res.ok && json.success && json.data?.streamUrl) {
        streamUrl = json.data.streamUrl;
      }
    } catch {}
  } else if (!streamUrl && currentSeriesData.directStream?.streamUrl) {
    streamUrl = currentSeriesData.directStream.streamUrl;
  }

  if (!streamUrl) {
    if (unlockCard) {
      unlockCard.hidden = false;
      unlockCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    throw new Error(`Episode ${serial} stream is locked. Use the 1-Click Bookmarklet or paste page source into the unlock box above.`);
  }

  const cleanTitle = sanitizeFilename(currentSeriesData.seriesTitle);
  const padSerial = String(serial).padStart(3, '0');
  const filename = `${cleanTitle}_EP${padSerial}.mp4`;

  // If HLS (.m3u8 or /hls/)
  if (streamUrl.includes('.m3u8') || streamUrl.includes('/hls/')) {
    const tsUrls = await fetchPlaylistSegments(streamUrl, signal);
    if (tsUrls.length === 0) throw new Error('No video segments found in playlist');

    const chunks = new Array(tsUrls.length);
    const queue = tsUrls.map((url, index) => ({ url, index }));
    let downloadedCount = 0;

    const worker = async () => {
      while (queue.length > 0) {
        if (signal?.aborted) throw new Error('Download cancelled');
        const item = queue.shift();
        const segRes = await fetch(item.url, { signal });
        if (!segRes.ok) throw new Error(`HTTP ${segRes.status} downloading segment`);
        chunks[item.index] = await segRes.arrayBuffer();
        downloadedCount++;
        if (onProgress) {
          onProgress(Math.round((downloadedCount / tsUrls.length) * 100));
        }
      }
    };

    const workerCount = Math.min(4, tsUrls.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // Transmux TS segments into an MP4 blob
    const blob = await transmuxTsChunksToMp4(chunks);
    return { blob, filename };
  } else {
    // Direct MP4 file
    const fileRes = await fetch(streamUrl, { signal });
    if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
    const blob = await fileRes.blob();
    return { blob, filename };
  }
}

// 7. Download & Play: Downloads the video into memory, transmuxes, then plays in the video player
async function downloadAndPlayEpisode(serial) {
  if (!currentSeriesData) return;

  // If already playing this exact episode, just unhide and play
  if (currentlyPlayingSerial === serial && currentlyPlayingBlob && currentlyPlayingUrl) {
    videoPreviewWrapper.hidden = false;
    videoPlayer.play().catch(() => {});
    videoPreviewWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  // Cancel any prior client download
  if (clientAbortController) {
    try {
      clientAbortController.abort();
    } catch {}
    clientAbortController = null;
  }

  isDownloadingForPlayer = true;
  clientAbortController = new AbortController();

  // Show player UI immediately with download progress
  videoPreviewWrapper.hidden = false;
  savePlayingVideoBtn.hidden = true;
  playerStatusBadge.textContent = `Downloading EP ${serial} (0%)...`;
  playerInfoText.textContent = `Downloading Episode ${serial} segments into browser memory...`;

  if (serial === currentSeriesData.targetEpisode) {
    playVideoText.textContent = `Downloading (0%)...`;
    playVideoBtn.disabled = true;
  }

  try {
    const { blob, filename } = await fetchEpisodeBlob(
      serial,
      clientAbortController.signal,
      (percent) => {
        playerStatusBadge.textContent = `Downloading EP ${serial} (${percent}%)...`;
        playerInfoText.textContent = `Downloading Episode ${serial} into memory (${percent}%)...`;
        if (serial === currentSeriesData.targetEpisode) {
          playVideoText.textContent = `Downloading (${percent}%)...`;
        }
      }
    );

    playerStatusBadge.textContent = `Transmuxing EP ${serial}...`;
    playerInfoText.textContent = `Converting segments to playable MP4...`;

    // Revoke previous blob URL
    if (currentlyPlayingUrl) {
      URL.revokeObjectURL(currentlyPlayingUrl);
      currentlyPlayingUrl = null;
    }

    currentlyPlayingSerial = serial;
    currentlyPlayingBlob = blob;
    currentlyPlayingFilename = filename;
    currentlyPlayingUrl = URL.createObjectURL(blob);

    videoPlayer.src = currentlyPlayingUrl;
    videoPlayer.play().catch((e) => {
      console.log('Autoplay deferred:', e.message);
    });

    const sizeMb = (blob.size / 1024 / 1024).toFixed(2);
    playerStatusBadge.textContent = `Playing EP ${serial}`;
    playerInfoText.textContent = `EP ${serial} · ${sizeMb} MB · MP4 (Memory)`;
    savePlayingVideoBtn.hidden = false;

    videoPreviewWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'Download cancelled') {
      console.error('Player download error:', err);
      playerStatusBadge.textContent = `Error loading EP ${serial}`;
      playerInfoText.textContent = err.message || 'Download failed';
      showAlert(`Could not load Episode ${serial} for playback: ${err.message}`, 'error');
    }
  } finally {
    isDownloadingForPlayer = false;
    playVideoText.textContent = 'Download & Play';
    playVideoBtn.disabled = false;
  }
}

// Close player button
closePlayerBtn.addEventListener('click', () => {
  videoPreviewWrapper.hidden = true;
  if (videoPlayer) {
    videoPlayer.pause();
  }
});

// Save currently loaded MP4 button
savePlayingVideoBtn.addEventListener('click', () => {
  if (currentlyPlayingBlob && currentlyPlayingFilename) {
    saveBlob(currentlyPlayingBlob, currentlyPlayingFilename);
  }
});

// 8. Single Episode Direct Download
async function triggerSingleDownload(serial) {
  if (!currentSeriesData) return;

  const isTarget = serial === currentSeriesData.targetEpisode;
  const btn = isTarget ? downloadCurrentBtn : null;
  const originalText = isTarget ? downloadCurrentText.textContent : '';

  try {
    if (btn) {
      downloadCurrentText.textContent = `Downloading EP ${serial}...`;
      btn.disabled = true;
    }

    clientAbortController = new AbortController();
    const { blob, filename } = await fetchEpisodeBlob(serial, clientAbortController.signal, (p) => {
      if (btn) downloadCurrentText.textContent = `Downloading EP ${serial} (${p}%)...`;
    });

    saveBlob(blob, filename);
  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'Download cancelled') {
      console.error('Download error:', err);
      showAlert(`Download failed for Episode ${serial}: ${err.message}`, 'error');
    }
  } finally {
    if (btn) {
      downloadCurrentText.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// 9. Batch Download & ZIP Handler (Netlify & Serverless optimized with JSZip)
downloadZipBtn.addEventListener('click', async () => {
  if (!currentSeriesData) return;

  const checkedBoxes = Array.from(document.querySelectorAll('.episode-checkbox:checked'));
  if (checkedBoxes.length === 0) {
    showAlert('Please select at least one episode to download.', 'error');
    return;
  }

  const selectedSerials = checkedBoxes.map((cb) => parseInt(cb.dataset.serial, 10));
  openProgressModal(selectedSerials.length);

  // If JSZip is available, run client-side batch download
  if (typeof JSZip !== 'undefined') {
    runClientBatchZip(selectedSerials);
  } else {
    // Fallback to server batch job
    runServerBatchZip(selectedSerials);
  }
});

// Client-side batch ZIP via JSZip (Perfect for Netlify)
async function runClientBatchZip(selectedSerials) {
  clientAbortController = new AbortController();
  const zip = new JSZip();
  const total = selectedSerials.length;
  let completed = 0;

  try {
    modalTitle.textContent = 'Downloading Episodes';
    modalSubtitle.textContent = `Starting download of ${total} episodes...`;

    // Concurrency of 2 episodes at a time
    const queue = [...selectedSerials];
    const runWorker = async () => {
      while (queue.length > 0) {
        if (clientAbortController.signal.aborted) throw new Error('Batch cancelled');
        const serial = queue.shift();

        modalSubtitle.textContent = `Downloading Episode ${serial} (${completed + 1}/${total})...`;
        const { blob, filename } = await fetchEpisodeBlob(serial, clientAbortController.signal);
        zip.file(filename, blob);

        completed++;
        const pct = Math.round((completed / total) * 85);
        progressBarFill.style.width = `${pct}%`;
        progressPercentage.textContent = `${pct}%`;
        progressDetail.textContent = `Downloaded ${completed} of ${total} episodes`;
      }
    };

    const workers = Array.from({ length: Math.min(2, total) }, () => runWorker());
    await Promise.all(workers);

    // Zipping phase
    modalTitle.textContent = 'Creating ZIP Archive';
    modalSubtitle.textContent = 'Compressing all episodes into a single ZIP file...';
    progressBarFill.style.width = '90%';
    progressPercentage.textContent = '90%';

    const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      const pct = 85 + Math.round(meta.percent * 0.15);
      progressBarFill.style.width = `${pct}%`;
      progressPercentage.textContent = `${pct}%`;
      progressDetail.textContent = `Compressing: ${Math.round(meta.percent)}%`;
    });

    const zipFilename = `${sanitizeFilename(currentSeriesData.seriesTitle)}_Episodes_${selectedSerials[0]}-${selectedSerials[selectedSerials.length - 1]}.zip`;

    // Ready!
    progressBarFill.style.width = '100%';
    progressPercentage.textContent = '100%';
    modalTitle.textContent = 'Download Ready!';
    modalSubtitle.textContent = 'All episodes packaged successfully.';
    progressDetail.textContent = `Completed ${completed} episodes`;
    modalSuccessBox.hidden = false;

    const zipUrl = URL.createObjectURL(zipBlob);
    modalDownloadLink.href = zipUrl;
    modalDownloadLink.download = zipFilename;

    // Trigger download
    saveBlob(zipBlob, zipFilename);
  } catch (err) {
    if (err.message === 'Batch cancelled') {
      modalTitle.textContent = 'Batch Cancelled';
      modalSubtitle.textContent = 'Operation was cancelled.';
    } else {
      console.error('Batch error:', err);
      modalTitle.textContent = 'Batch Download Failed';
      modalSubtitle.textContent = err.message || 'An error occurred';
      showAlert(err.message, 'error');
    }
  }
}

// Server batch fallback
async function runServerBatchZip(selectedSerials) {
  try {
    const res = await fetch('/api/batch-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesInfo: currentSeriesData,
        episodeSerials: selectedSerials,
        concurrency: 3,
      }),
    });

    const result = await res.json();
    if (!res.ok || !result.success) throw new Error(result.error || 'Failed to start batch');

    currentJobId = result.data.jobId;
    listenToBatchProgress(currentJobId);
  } catch (err) {
    modalSubtitle.textContent = `Error: ${err.message}`;
    showAlert(err.message, 'error');
  }
}

// 10. Listen to SSE for Server Batch Progress
function listenToBatchProgress(jobId) {
  if (currentBatchEventSource) {
    currentBatchEventSource.close();
  }

  currentBatchEventSource = new EventSource(`/api/batch-progress/${jobId}`);

  currentBatchEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      progressBarFill.style.width = `${data.progress || 0}%`;
      progressPercentage.textContent = `${data.progress || 0}%`;

      if (data.status === 'downloading') {
        modalTitle.textContent = 'Downloading Episodes';
        modalSubtitle.textContent = `Processing Episode ${data.currentEpisode || '...'}`;
        progressDetail.textContent = `Downloaded ${data.completed} of ${data.total} episodes`;
      } else if (data.status === 'zipping') {
        modalTitle.textContent = 'Creating ZIP Archive';
        modalSubtitle.textContent = 'Compressing downloaded episodes into ZIP...';
        progressDetail.textContent = 'Almost finished...';
      } else if (data.status === 'ready') {
        modalTitle.textContent = 'Download Ready!';
        modalSubtitle.textContent = 'All episodes packaged successfully.';
        progressDetail.textContent = `Completed ${data.completed} episodes`;
        modalSuccessBox.hidden = false;

        const zipUrl = `/api/download-zip/${jobId}`;
        modalDownloadLink.href = zipUrl;
        modalDownloadLink.download = '';

        const a = document.createElement('a');
        a.href = zipUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        currentBatchEventSource.close();
      } else if (data.status === 'error') {
        modalTitle.textContent = 'Batch Download Failed';
        modalSubtitle.textContent = data.error || 'An unexpected error occurred';
        currentBatchEventSource.close();
      } else if (data.status === 'cancelled') {
        modalTitle.textContent = 'Batch Cancelled';
        modalSubtitle.textContent = 'The batch operation was cancelled.';
        currentBatchEventSource.close();
      }
    } catch (e) {
      console.error('SSE JSON error:', e);
    }
  };

  currentBatchEventSource.onerror = () => {
    if (currentBatchEventSource) {
      currentBatchEventSource.close();
    }
  };
}

// 11. Modal Controls
function openProgressModal(totalCount) {
  modalTitle.textContent = 'Starting Batch Download';
  modalSubtitle.textContent = `Preparing to download ${totalCount} episodes...`;
  progressBarFill.style.width = '0%';
  progressPercentage.textContent = '0%';
  progressDetail.textContent = `0 of ${totalCount} completed`;
  modalSuccessBox.hidden = true;
  progressModal.hidden = false;
}

cancelBatchBtn.addEventListener('click', async () => {
  if (clientAbortController) {
    clientAbortController.abort();
    clientAbortController = null;
  }
  if (currentJobId) {
    try {
      await fetch(`/api/cancel-batch/${currentJobId}`, { method: 'POST' });
    } catch {}
  }
  if (currentBatchEventSource) {
    currentBatchEventSource.close();
    currentBatchEventSource = null;
  }
  progressModal.hidden = true;
});

// Helpers
function setLoading(isLoading) {
  fetchBtn.disabled = isLoading;
  const text = fetchBtn.querySelector('.btn-text');
  const spinner = fetchBtn.querySelector('.spinner');
  if (isLoading) {
    text.textContent = 'Fetching...';
    spinner.hidden = false;
  } else {
    text.textContent = 'Fetch Episode';
    spinner.hidden = true;
  }
}

function showAlert(message, type = 'error') {
  alertBox.textContent = message;
  alertBox.className = `alert-box alert-${type}`;
  alertBox.hidden = false;
}

function hideAlert() {
  alertBox.hidden = true;
  alertBox.className = 'alert-box';
  alertBox.textContent = '';
}

function resetUI() {
  targetSection.hidden = true;
  allEpisodesSection.hidden = true;
  videoPreviewWrapper.hidden = true;
  progressModal.hidden = true;
  modalSuccessBox.hidden = true;
  savePlayingVideoBtn.hidden = true;
  playVideoText.textContent = 'Download & Play';
  playVideoBtn.disabled = false;

  if (unlockCard) {
    unlockCard.hidden = true;
    if (unlockHeaderBox) unlockHeaderBox.hidden = false;
    if (unlockOptionsBox) unlockOptionsBox.hidden = false;
    if (unlockSuccessBox) unlockSuccessBox.hidden = true;
    if (unlockTokenInput) unlockTokenInput.value = '';
  }

  if (videoPlayer) {
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
  }
  if (currentlyPlayingUrl) {
    URL.revokeObjectURL(currentlyPlayingUrl);
    currentlyPlayingUrl = null;
  }
  currentlyPlayingSerial = null;
  currentlyPlayingBlob = null;
  currentlyPlayingFilename = '';

  if (currentHlsInstance) {
    currentHlsInstance.destroy();
    currentHlsInstance = null;
  }
}

// 12. HDrama Client-side Fallback & WebCrypto Unlock Engine
const HDRAMA_DEFAULT_KEY_B64 = 'QC6Ir2trghxRAyyyWZEOEFR4GgLhnfQ4A19I3QBlQkc=';

/**
 * Parses series slug, target episode number, and bookId from an HDrama URL on the client
 */
function parseHDramaClientUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    let slug = '';
    let targetEpisode = 1;

    const seriesIdx = parts.indexOf('series');
    if (seriesIdx !== -1 && parts.length > seriesIdx + 1) {
      slug = parts[seriesIdx + 1];
      if (parts.length > seriesIdx + 2) {
        const epMatch = parts[seriesIdx + 2].match(/episode-(\d+)/i);
        if (epMatch) targetEpisode = parseInt(epMatch[1], 10);
      }
    } else {
      for (const p of parts) {
        const epMatch = p.match(/episode-(\d+)/i);
        if (epMatch) targetEpisode = parseInt(epMatch[1], 10);
        else if (!slug && p !== 'series') slug = p;
      }
    }

    let bookId = null;
    const bookIdMatch = slug.match(/(\d{8,})/);
    if (bookIdMatch) bookId = bookIdMatch[1];

    let title = slug
      ? slug
          .replace(/-\d{8,}$/, '')
          .split('-')
          .filter(Boolean)
          .map((w) => (w === 's' ? "'s" : w.charAt(0).toUpperCase() + w.slice(1)))
          .join(' ')
          .replace(/\s+'s/g, "'s")
      : 'HDrama Series';

    return { domain: parsed.origin, slug, bookId, targetEpisode, title };
  } catch {
    return { domain: '', slug: '', bookId: null, targetEpisode: 1, title: 'HDrama Series' };
  }
}

/**
 * Renders fallback episodes when Netlify serverless is blocked by Cloudflare
 */
function handleHDramaClientFallback(url) {
  const meta = parseHDramaClientUrl(url);
  const total = Math.max(meta.targetEpisode || 1, 60);

  const episodes = [];
  for (let i = 1; i <= total; i++) {
    episodes.push({
      serial: i,
      title: `Episode ${i}`,
      url: `${meta.domain || 'https://en.hdrama.net'}/series/${meta.slug || 'series'}/episode-${i}`,
      qualities: [],
    });
  }

  currentSeriesData = {
    source: 'HDrama',
    seriesTitle: meta.title,
    slug: meta.slug,
    bookId: meta.bookId,
    poster: '',
    targetEpisode: meta.targetEpisode,
    totalEpisodes: episodes.length,
    episodes,
    targetStream: null,
  };

  renderTargetEpisode(currentSeriesData);
  renderAllEpisodes(currentSeriesData);

  if (unlockCard) {
    unlockCard.hidden = false;
    unlockCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  showAlert(
    'Cloudflare blocked Netlify server from reading stream keys directly. Click the 1-Click Bookmarklet on HDrama or paste the page source below to unlock!',
    'warning'
  );
}

/**
 * Decrypts an HDrama AES-256-GCM token directly in the browser via WebCrypto
 */
async function decryptTokenWebCrypto(encB64, keyB64 = HDRAMA_DEFAULT_KEY_B64) {
  try {
    if (!encB64 || typeof encB64 !== 'string') return null;
    const cleanB64 = encB64.trim();

    const rawKey = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const encData = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0));
    if (encData.length < 28) return null;

    const iv = encData.subarray(0, 12);
    const ciphertextAndTag = encData.subarray(12);

    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      cryptoKey,
      ciphertextAndTag
    );

    return new TextDecoder().decode(decryptedBuf);
  } catch (err) {
    console.warn('WebCrypto decryption error:', err);
    return null;
  }
}

/**
 * Extracts encrypted token or stream URL from raw text or full HTML page source
 */
function extractEncryptedTokenOrUrl(text) {
  if (!text || typeof text !== 'string') return null;
  text = text.trim();

  // 1. Direct GoodShort stream URL
  if (text.includes('/hls/') && (text.includes('goodshort') || text.includes('goodbos'))) {
    const urlMatch = text.match(/https?:\/\/[^\s"'<>]+\/hls\/\d+[^\s"'<>]*/i);
    if (urlMatch) return { type: 'url', url: urlMatch[0] };
  }

  // 2. "enc":"..." or \"enc\":\"...\" in JSON/HTML
  const encMatch = text.match(/\\?"enc\\?"\s*:\s*\\?"([^"\\\s]+)\\?"/i);
  if (encMatch && encMatch[1]) {
    return { type: 'enc', token: encMatch[1] };
  }

  // 3. Raw Base64 string
  if (/^[A-Za-z0-9+/=]{40,}$/.test(text)) {
    return { type: 'enc', token: text };
  }

  // 4. Any large Base64 substring
  const b64Match = text.match(/[A-Za-z0-9+/=]{64,300}/);
  if (b64Match) {
    return { type: 'enc', token: b64Match[0] };
  }

  return null;
}

/**
 * Connects decrypted stream URL, calculates sequential episode stream IDs, and updates UI
 */
function handleDirectDecryptedStream(decryptedUrl, originUrl = null) {
  if (!decryptedUrl || !decryptedUrl.includes('/hls/')) return false;

  const idMatch = decryptedUrl.match(/\/hls\/(\d+)/);
  if (!idMatch) return false;

  const currentEpId = parseInt(idMatch[1], 10);

  // Extract or preserve bookId
  let bookId = currentSeriesData?.bookId;
  const bookIdParamMatch = decryptedUrl.match(/[?&]bookId=(\d+)/);
  if (bookIdParamMatch) {
    bookId = bookIdParamMatch[1];
  }

  let targetEpisode = currentSeriesData?.targetEpisode || 1;
  let seriesTitle = currentSeriesData?.seriesTitle;
  let slug = currentSeriesData?.slug;
  let totalEpisodes = currentSeriesData?.totalEpisodes || 60;

  if (originUrl) {
    const meta = parseHDramaClientUrl(originUrl);
    if (meta.targetEpisode) targetEpisode = meta.targetEpisode;
    if (!seriesTitle || seriesTitle === 'HDrama Series') seriesTitle = meta.title;
    if (!slug) slug = meta.slug;
    if (!bookId && meta.bookId) bookId = meta.bookId;
  }

  if (!seriesTitle) seriesTitle = 'HDrama Series';

  // Base Episode 1 ID: sequential offset
  const baseEpisode1Id = currentEpId - (targetEpisode - 1);

  // Construct all episode streams
  const episodes = [];
  const maxEp = Math.max(totalEpisodes, targetEpisode, 60);
  for (let i = 1; i <= maxEp; i++) {
    const epId = baseEpisode1Id + (i - 1);
    const stream = `https://goodshort.goodbos.online/hls/${epId}?bookId=${bookId || ''}&q=720p`;
    episodes.push({
      serial: i,
      title: `Episode ${i}`,
      url: originUrl || '',
      qualities: [],
      streamUrl: stream,
    });
  }

  const targetStream = {
    streamUrl: decryptedUrl,
    source: 'GoodShort',
    type: 'hls',
  };

  currentSeriesData = {
    source: 'HDrama',
    seriesTitle,
    slug: slug || 'series',
    bookId,
    poster: currentSeriesData?.poster || '',
    targetEpisode,
    totalEpisodes: episodes.length,
    episodes,
    targetStream,
    directStream: targetStream,
  };

  renderTargetEpisode(currentSeriesData);
  renderAllEpisodes(currentSeriesData);

  if (unlockCard) {
    unlockCard.hidden = false;
    if (unlockHeaderBox) unlockHeaderBox.hidden = true;
    if (unlockOptionsBox) unlockOptionsBox.hidden = true;
    if (unlockSuccessBox) {
      if (unlockSuccessTitle) unlockSuccessTitle.textContent = `All ${episodes.length} Episodes Unlocked!`;
      if (unlockSuccessDesc) unlockSuccessDesc.textContent = 'GoodShort stream keys successfully resolved. You can now download individual episodes, watch in player, or batch export to ZIP.';
      unlockSuccessBox.hidden = false;
    }
  }

  showAlert(`Successfully unlocked ${episodes.length} episodes! Ready for download.`, 'success');
  return true;
}

/**
 * Unlocks stream from pasted text (HTML page source or raw token)
 */
async function unlockFromPastedContent(rawText) {
  if (!rawText) {
    showAlert('Please paste the page source code or encrypted token first.', 'error');
    return;
  }

  const extracted = extractEncryptedTokenOrUrl(rawText);
  if (!extracted) {
    showAlert('Could not find an encrypted token or stream URL in the pasted text. Make sure you copied the page source (Ctrl+U) or token.', 'error');
    return;
  }

  let streamUrl = null;
  if (extracted.type === 'url') {
    streamUrl = extracted.url;
  } else if (extracted.type === 'enc') {
    streamUrl = await decryptTokenWebCrypto(extracted.token);
  }

  if (!streamUrl) {
    showAlert('Failed to decrypt the token. Please make sure the token is valid.', 'error');
    return;
  }

  const currentUrl = urlInput.value.trim() || window.location.href;
  const success = handleDirectDecryptedStream(streamUrl, currentUrl);
  if (success) {
    targetSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    showAlert('Could not extract episode ID from the decrypted stream.', 'error');
  }
}

// 13. Bookmarklet Setup & Parameter Auto-detect
function getBookmarkletCode() {
  const origin = window.location.origin;
  return `javascript:(function(){var h=document.documentElement.innerHTML;var m=h.match(/"enc":"([^"]+)"/)||h.match(/\\\\"enc\\\\":\\\\"([^\\\\"]+)\\\\"/);var e=m?encodeURIComponent(m[1]):"";var u=encodeURIComponent(window.location.href);window.location.href="${origin}/?url="+u+(e?"&enc="+e:"");})();`;
}

function setupBookmarkletLinks() {
  const bookmarkletCode = getBookmarkletCode();

  if (headerBookmarklet) {
    headerBookmarklet.href = bookmarkletCode;
  }
  if (inlineBookmarkletLink) {
    inlineBookmarkletLink.href = bookmarkletCode;
  }

  const copyHandler = async (btn) => {
    try {
      await navigator.clipboard.writeText(getBookmarkletCode());
      const origText = btn.textContent;
      btn.textContent = '✓ Copied!';
      showAlert('Bookmarklet code copied! Follow the 3-step guide below to save as a bookmark on Android.', 'info');
      setTimeout(() => {
        btn.textContent = origText;
      }, 3000);
    } catch {
      showAlert('Could not access clipboard. Please copy manually from the link.', 'warning');
    }
  };

  const copyMobileBtn = document.getElementById('copy-mobile-btn');
  if (copyMobileBtn) {
    copyMobileBtn.addEventListener('click', () => copyHandler(copyMobileBtn));
  }

  const headerCopyMobileBtn = document.getElementById('header-copy-mobile-btn');
  if (headerCopyMobileBtn) {
    headerCopyMobileBtn.addEventListener('click', () => copyHandler(headerCopyMobileBtn));
  }
}

async function checkUrlParamsOnLoad() {
  setupBookmarkletLinks();

  const params = new URLSearchParams(window.location.search);
  const paramUrl = params.get('url');
  const paramEnc = params.get('enc');

  if (paramUrl) {
    urlInput.value = paramUrl;
  }

  if (paramEnc) {
    const decryptedUrl = await decryptTokenWebCrypto(paramEnc);
    if (decryptedUrl) {
      handleDirectDecryptedStream(decryptedUrl, paramUrl);
      return;
    }
  }

  if (paramUrl && !paramEnc) {
    urlForm.dispatchEvent(new Event('submit'));
  }
}

// Attach Unlock Card Button Handlers
if (unlockTokenBtn) {
  unlockTokenBtn.addEventListener('click', () => {
    unlockFromPastedContent(unlockTokenInput.value.trim());
  });
}

if (unlockTokenInput) {
  unlockTokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      unlockFromPastedContent(unlockTokenInput.value.trim());
    }
  });
}

// Initialize on page load
resetUI();
checkUrlParamsOnLoad();

