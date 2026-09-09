const axios = require('axios');
const path = require('path');

const VIDEO_EXTENSIONS = ['.mp4', '.m3u8', '.webm', '.mkv', '.mov', '.ts'];

/**
 * Checks if a URL points to a direct video or HLS file
 * @param {string} url
 */
function isGenericVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Extracts metadata for generic video links
 * @param {string} url
 */
async function fetchGenericVideoInfo(url) {
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname) || 'video';
    const cleanTitle = basename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    let streamType = 'mp4';
    if (parsed.pathname.toLowerCase().endsWith('.m3u8')) {
      streamType = 'hls';
    }

    return {
      source: 'DirectVideo',
      seriesTitle: cleanTitle || 'Direct Video Stream',
      slug: cleanTitle.toLowerCase().replace(/\s+/g, '-'),
      bookId: null,
      poster: '',
      targetEpisode: 1,
      totalEpisodes: 1,
      episodes: [
        {
          serial: 1,
          title: cleanTitle || 'Video 1',
          url: url,
          qualities: [],
        },
      ],
      inlineStreamUrl: url,
      directStream: {
        streamUrl: url,
        source: 'Direct',
        type: streamType,
      },
    };
  } catch (err) {
    throw new Error(`Failed to parse generic video URL: ${err.message}`);
  }
}

module.exports = {
  isGenericVideoUrl,
  fetchGenericVideoInfo,
};

