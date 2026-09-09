const hdrama = require('./hdrama');
const generic = require('./generic');

/**
 * Automatically detects the right extractor for a URL and fetches metadata.
 * @param {string} url
 */
async function extractInfo(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Please provide a valid URL');
  }

  const cleanUrl = url.trim();

  if (hdrama.isHDramaUrl(cleanUrl)) {
    return await hdrama.fetchHDramaInfo(cleanUrl);
  }

  if (generic.isGenericVideoUrl(cleanUrl)) {
    return await generic.fetchGenericVideoInfo(cleanUrl);
  }

  // Fallback: try HDrama if it resembles a drama series URL, otherwise try generic
  try {
    return await hdrama.fetchHDramaInfo(cleanUrl);
  } catch (err) {
    return await generic.fetchGenericVideoInfo(cleanUrl);
  }
}

/**
 * Resolves the stream for a given episode.
 * @param {object} seriesInfo
 * @param {number} episodeNumber
 */
async function resolveEpisodeStream(seriesInfo, episodeNumber) {
  if (seriesInfo.source === 'HDrama') {
    return await hdrama.fetchEpisodeStream(seriesInfo.bookId, episodeNumber);
  }

  if (seriesInfo.directStream) {
    return seriesInfo.directStream;
  }

  throw new Error(`Unsupported stream resolution for source: ${seriesInfo.source}`);
}

module.exports = {
  extractInfo,
  resolveEpisodeStream,
  hdrama,
  generic,
};

