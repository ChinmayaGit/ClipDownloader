const http2 = require('http2');
const { decryptHdramaToken } = require('../utils/crypto');

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// In-memory cache of resolved base episode IDs per bookId
const bookIdBaseMap = new Map();

/**
 * Resilient HTTP/2 fetch that negotiates h2 ALPN to pass Cloudflare checks.
 */
function fetchH2(url, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const origin = parsed.origin;
      const path = parsed.pathname + parsed.search;

      const client = http2.connect(origin, {
        rejectUnauthorized: true,
      });

      const timeoutId = setTimeout(() => {
        try { client.destroy(); } catch {}
        reject(new Error(`HTTP2 request timeout: ${url}`));
      }, 10000);

      client.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      const headers = {
        ':method': 'GET',
        ':path': path,
        ':authority': parsed.hostname,
        ':scheme': 'https',
        'user-agent': CHROME_UA,
        'referer': 'https://en.hdrama.net/',
        'accept': customHeaders['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        ...customHeaders,
      };

      const req = client.request(headers);

      let statusCode = 200;
      req.on('response', (resHeaders) => {
        statusCode = parseInt(resHeaders[':status'], 10);
      });

      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        clearTimeout(timeoutId);
        client.close();
        if (statusCode >= 200 && statusCode < 400) {
          resolve({
            status: statusCode,
            text: () => Promise.resolve(body),
            json: () => Promise.resolve(JSON.parse(body)),
          });
        } else {
          reject(new Error(`HTTP ${statusCode} from ${url}`));
        }
      });

      req.on('error', (err) => {
        clearTimeout(timeoutId);
        client.close();
        reject(err);
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Resilient fetch that tries HTTP/2 first, then standard fetch
 */
async function fetchWithBypass(url, options = {}) {
  try {
    return await fetchH2(url, options.headers || {});
  } catch (h2Err) {
    console.warn('HTTP/2 fetch failed, falling back to standard fetch:', h2Err.message);
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': CHROME_UA,
        Referer: 'https://en.hdrama.net/',
        Accept: options.accept || '*/*',
        ...options.headers,
      },
      signal: options.signal || AbortSignal.timeout(options.timeout || 10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res;
  }
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

  episodes.sort((a, b) => a.serial - b.serial);

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

  // 6. Decrypt inline source & calculate base episode ID
  let inlineStreamUrl = null;
  let baseEpisode1Id = null;

  if (flightPayload) {
    const sourceFirstMatch = flightPayload.match(/"sourceFirst":\s*(\{[^}]+\})/);
    if (sourceFirstMatch) {
      const encMatch = sourceFirstMatch[1].match(/"enc":"([^"]+)"/);
      if (encMatch) {
        inlineStreamUrl = decryptHdramaToken(encMatch[1]);
        if (inlineStreamUrl) {
          const idMatch = inlineStreamUrl.match(/\/hls\/(\d+)/);
          if (idMatch) {
            const currentEpId = parseInt(idMatch[1], 10);
            baseEpisode1Id = currentEpId - (parsedMeta.targetEpisode - 1);
            if (bookId) {
              bookIdBaseMap.set(bookId, baseEpisode1Id);
            }
          }
        }
      }
    }
  }

  // Pre-attach stream URLs to all episodes if base ID is determined
  if (baseEpisode1Id && bookId) {
    episodes.forEach((ep) => {
      const epId = baseEpisode1Id + (ep.serial - 1);
      ep.streamUrl = `https://goodshort.goodbos.online/hls/${epId}?bookId=${bookId}&q=720p`;
    });
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
    inlineStreamUrl,
    targetStream: inlineStreamUrl ? {
      streamUrl: inlineStreamUrl,
      source: 'GoodShort',
      type: 'hls',
    } : null,
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

  // If already in baseEpisode map, return immediately with zero latency
  const cachedBase = bookIdBaseMap.get(bookId);
  if (cachedBase) {
    const epId = cachedBase + (serialNumber - 1);
    return {
      streamUrl: `https://goodshort.goodbos.online/hls/${epId}?bookId=${bookId}&q=720p`,
      source: 'GoodShort',
      type: 'hls',
    };
  }

  const apiUrl = `${domain}/api/episode-source/${bookId}/${serialNumber}?lang=en`;

  try {
    const response = await fetchWithBypass(apiUrl, {
      headers: {
        accept: 'application/json, text/plain, */*',
      },
    });

    const data = await response.json();
    const descriptor = data?.descriptor;
    if (descriptor) {
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
        const idMatch = decryptedUrl.match(/\/hls\/(\d+)/);
        if (idMatch) {
          const epId = parseInt(idMatch[1], 10);
          const base1 = epId - (serialNumber - 1);
          bookIdBaseMap.set(bookId, base1);
        }

        return {
          streamUrl: decryptedUrl,
          source: streamSource,
          type: streamType,
        };
      }
    }
  } catch (err) {
    console.warn(`Stream fetch warning for EP ${serialNumber}:`, err.message);
  }

  throw new Error(`Could not resolve stream URL for Episode ${serialNumber}`);
}

module.exports = {
  isHDramaUrl,
  parseHDramaUrl,
  fetchHDramaInfo,
  fetchEpisodeStream,
  fetchWithBypass,
  fetchH2,
  bookIdBaseMap,
};
