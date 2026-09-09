const { decryptHdramaToken } = require('../utils/crypto');

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Resilient fetch that bypasses Cloudflare bot checks using Googlebot and realistic headers.
 */
async function fetchWithBypass(url, options = {}) {
  const referer = options.referer || 'https://en.hdrama.net/';
  const userAgents = [
    GOOGLEBOT_UA,
    'curl/8.7.1',
    CHROME_UA,
  ];

  let lastError = null;

  for (const ua of userAgents) {
    try {
      const headers = {
        'User-Agent': ua,
        Accept: options.accept || '*/*',
        Referer: referer,
        'Accept-Language': 'en-US,en;q=0.9',
        ...options.headers,
      };

      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        signal: options.signal || AbortSignal.timeout(options.timeout || 12000),
      });

      if (res.ok) {
        return res;
      }

      if (res.status !== 403 && res.status !== 503) {
        return res;
      }

      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`);
}

/**
 * Checks whether a given URL is from HDrama
 * @param {string} url
 * @returns {boolean}
 */
function isHDramaUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('hdrama.net');
  } catch {
    return false;
  }
}

/**
 * Parses series slug, target episode number, and locale from an HDrama URL
 * @param {string} url
 */
function parseHDramaUrl(url) {
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
        if (epMatch) {
          targetEpisode = parseInt(epMatch[1], 10);
        }
      }
    } else {
      for (const p of parts) {
        const epMatch = p.match(/episode-(\d+)/i);
        if (epMatch) {
          targetEpisode = parseInt(epMatch[1], 10);
        } else if (!slug && p !== 'series') {
          slug = p;
        }
      }
    }

    let bookId = null;
    const bookIdMatch = slug.match(/(\d{8,})/);
    if (bookIdMatch) {
      bookId = bookIdMatch[1];
    }

    return {
      domain: parsed.origin,
      slug,
      bookId,
      targetEpisode,
      canonicalUrl: url,
    };
  } catch (err) {
    throw new Error(`Invalid HDrama URL: ${url}`);
  }
}

/**
 * Converts a slug like 'hero-husband-s-apocalypse-harem-31001691861' into readable title
 */
function titleFromSlug(slug) {
  if (!slug) return 'Drama Series';
  return slug
    .replace(/-\d{8,}$/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => {
      if (word === 's') return "'s";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .replace(/\s+'s/g, "'s");
}

/**
 * Fetches page HTML and extracts series metadata and all episode listings.
 * @param {string} url
 */
async function fetchHDramaInfo(url) {
  const parsedMeta = parseHDramaUrl(url);

  let html = '';
  try {
    const res = await fetchWithBypass(url, {
      referer: 'https://en.hdrama.net/',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    html = await res.text();
  } catch (fetchErr) {
    console.warn('HTML fetch warning, using URL metadata fallback:', fetchErr.message);
  }

  // 1. Extract Next.js RSC flight chunks
  let flightPayload = '';
  if (html) {
    const pushRegex = /self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)/g;
    let match;
    while ((match = pushRegex.exec(html)) !== null) {
      try {
        flightPayload += JSON.parse(`"${match[1]}"`);
      } catch {
        flightPayload += match[1];
      }
    }
  }

  // 2. Extract series title
  let title = titleFromSlug(parsedMeta.slug);
  if (html) {
    const titleMatch =
      html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i) ||
      html.match(/<title>(.*?)<\/title>/i) ||
      flightPayload.match(/"title":"([^"]+)"/);

    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1]
        .replace(/ - Watch Free Online.*$/i, '')
        .replace(/ - HDrama.*$/i, '')
        .replace(/\s*\|\s*HDrama.*$/i, '')
        .replace(/episode\s+\d+.*$/i, '')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
    }
  }

  // 3. Extract Book ID
  let bookId = parsedMeta.bookId;
  if (!bookId && html) {
    const bookIdMatch =
      flightPayload.match(/"bookId":"([^"]+)"/) ||
      html.match(/\/api\/episode-source\/(\d+)\//) ||
      html.match(/"bookId":"(\d+)"/);
    if (bookIdMatch) {
      bookId = bookIdMatch[1];
    }
  }

  // 4. Extract Poster / Cover
  let poster = '';
  if (html) {
    const posterMatch =
      html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i) ||
      flightPayload.match(/"poster":"([^"]+)"/) ||
      flightPayload.match(/"(https:\/\/acf\.goodshort\.com\/videobook\/[^"]+\.jpg[^"]*)"/);

    if (posterMatch && posterMatch[1]) {
      poster = posterMatch[1].replace(/&amp;/g, '&');
    }
  }

  // Fallback poster if not found in HTML
  if (!poster && bookId) {
    poster = `https://acf.goodshort.com/videobook/${bookId}/cover.jpg`;
  }

  // 5. Extract all episodes
  const episodes = [];
  if (flightPayload) {
    const epArrayMatch = flightPayload.match(/"episodes":\s*(\[\s*\{[^\]]*\}\s*\])/);
    if (epArrayMatch) {
      try {
        const epData = JSON.parse(epArrayMatch[1]);
        if (Array.isArray(epData)) {
          epData.forEach((item) => {
            const serial = item.serial_number || item.serial;
            if (serial) {
              episodes.push({
                serial,
                title: `Episode ${serial}`,
                url: `${parsedMeta.domain}/series/${parsedMeta.slug}/episode-${serial}`,
                qualities: item.qualities || [],
              });
            }
          });
        }
      } catch {}
    }
  }

  // Scrape episode links from HTML
  if (html) {
    const linkRegex = new RegExp(`/series/${parsedMeta.slug}/episode-(\\d+)`, 'gi');
    let linkMatch;
    const foundSerials = new Set(episodes.map((e) => e.serial));

    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const serial = parseInt(linkMatch[1], 10);
      if (serial && !foundSerials.has(serial)) {
        foundSerials.add(serial);
        episodes.push({
          serial,
          title: `Episode ${serial}`,
          url: `${parsedMeta.domain}/series/${parsedMeta.slug}/episode-${serial}`,
          qualities: [],
        });
      }
    }
  }

  // Sort episodes by serial number
  episodes.sort((a, b) => a.serial - b.serial);

  // If episodes couldn't be parsed from HTML, generate standard 60 episodes
  if (episodes.length === 0) {
    const totalFallback = Math.max(parsedMeta.targetEpisode || 1, 60);
    for (let i = 1; i <= totalFallback; i++) {
      episodes.push({
        serial: i,
        title: `Episode ${i}`,
        url: `${parsedMeta.domain}/series/${parsedMeta.slug}/episode-${i}`,
        qualities: [],
      });
    }
  }

  // 6. Check inline source
  let inlineStreamUrl = null;
  if (flightPayload) {
    const sourceFirstMatch = flightPayload.match(/"sourceFirst":\s*(\{[^}]+\})/);
    if (sourceFirstMatch) {
      const encMatch = sourceFirstMatch[1].match(/"enc":"([^"]+)"/);
      if (encMatch) {
        inlineStreamUrl = decryptHdramaToken(encMatch[1]);
      }
    }
  }

  return {
    source: 'HDrama',
    seriesTitle: title,
    slug: parsedMeta.slug,
    bookId,
    poster,
    targetEpisode: parsedMeta.targetEpisode,
    totalEpisodes: episodes.length,
    episodes,
    inlineStreamUrl: parsedMeta.targetEpisode === 1 ? inlineStreamUrl : null,
  };
}

/**
 * Resolves the decrypted stream URL for a given episode.
 * @param {string} bookId
 * @param {number} serialNumber
 * @param {string} domain
 * @returns {Promise<{ streamUrl: string, source: string, type: string }>}
 */
async function fetchEpisodeStream(bookId, serialNumber, domain = 'https://en.hdrama.net') {
  if (!bookId) {
    throw new Error('Missing bookId to fetch episode stream');
  }

  const apiUrl = `${domain}/api/episode-source/${bookId}/${serialNumber}?lang=en`;

  try {
    const response = await fetchWithBypass(apiUrl, {
      referer: `${domain}/`,
      accept: 'application/json, text/plain, */*',
    });

    const data = await response.json();
    const descriptor = data?.descriptor;
    if (!descriptor) {
      throw new Error(`No stream descriptor found for episode ${serialNumber}`);
    }

    const chain = descriptor.chain || [];
    let decryptedUrl = null;
    let streamType = 'hls';
    let streamSource = descriptor.source || 'GoodShort';

    for (const item of chain) {
      if (item.enc) {
        decryptedUrl = decryptHdramaToken(item.enc);
        if (decryptedUrl) {
          streamType = item.type || 'hls';
          streamSource = item.source || streamSource;
          break;
        }
      }
    }

    if (!decryptedUrl && descriptor.enc) {
      decryptedUrl = decryptHdramaToken(descriptor.enc);
    }

    if (decryptedUrl) {
      return {
        streamUrl: decryptedUrl,
        source: streamSource,
        type: streamType,
      };
    }
  } catch (err) {
    console.warn(`Stream fetch warning for EP ${serialNumber}:`, err.message);
  }

  // Direct GoodShort fallback if API fails
  // Every episode on GoodShort CDN is served from goodbos.online with the bookId
  const fallbackUrl = `https://goodshort.goodbos.online/hls/${bookId}_${serialNumber}?bookId=${bookId}&q=720p`;
  return {
    streamUrl: fallbackUrl,
    source: 'GoodShort',
    type: 'hls',
  };
}

module.exports = {
  isHDramaUrl,
  parseHDramaUrl,
  fetchHDramaInfo,
  fetchEpisodeStream,
  fetchWithBypass,
};
