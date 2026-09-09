# ClipDownloader

A video downloader web application and API built specifically for drama series (such as [HDrama](https://en.hdrama.net)) and direct video links. It allows you to paste any episode link, preview and download that episode directly as an MP4, view all episodes in the series, and download all or selected episodes together as a single ZIP archive.

---

## Features

- **Paste Any Episode Link**: Paste any HDrama episode URL (e.g. `https://en.hdrama.net/series/hero-husband-s-apocalypse-harem-31001691861/episode-1`) or generic video/stream URL.
- **Instant Episode Download**: Directly download the pasted episode as a remuxed `.mp4` file with standard AAC audio and H.264 video.
- **Built-in Player Preview**: Play the episode directly in your browser before downloading.
- **Fetch All Episodes ("Fetch all eps")**: Automatically extracts the full catalogue of episodes in the series (e.g., Episodes 1 to 61) with individual download buttons for each episode.
- **Batch ZIP Downloader ("Download all as zip")**:
  - Download all episodes or custom-selected episodes bundled into a clean `.zip` archive.
  - Multi-worker concurrent downloading engine.
  - Live progress tracking via Server-Sent Events (SSE) with real-time percentage and status updates.
  - Automatic download trigger as soon as the archive is ready.
- **Lossless & Fast Remuxing**: Uses bundled FFmpeg (`ffmpeg-static`) with `-c copy` to remux HLS MPEG-TS segments into MP4 in seconds without transcoding loss.

---

## Quick Start

### 1. Start the Server

```bash
npm start
```

Or for development with automatic restart:

```bash
npm run dev
```

The application will start on: **`http://localhost:3000`**

### 2. Run Automated Tests

```bash
npm test
```

Verifies:
1. HDrama metadata extraction (series title, book ID, episode list).
2. AES-256-GCM stream decryption.
3. Single episode MP4 download & remuxing.
4. Batch concurrent downloading and ZIP packaging.

---

## Deploying to Netlify

This project is configured out-of-the-box for seamless one-click Netlify deployment.

### Option A: Git Push (Recommended)
1. Push this repository to GitHub / GitLab / Bitbucket.
2. Log in to [Netlify](https://app.netlify.com).
3. Click **"Add new site"** → **"Import an existing project"**.
4. Select your repository.
5. Netlify will automatically detect:
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
   - **Build command**: `npm run build`
6. Click **"Deploy site"** — your live site will be deployed in seconds!

### Option B: Netlify CLI
```bash
npm install -g netlify-cli
netlify deploy --prod
```

### Why Netlify + Browser JSZip Architecture?
- **Serverless APIs**: Netlify Functions handle metadata parsing and token decryption in milliseconds without running any expensive servers.
- **No 10s Serverless Timeout or 6MB Limit**: Episode streams and batch ZIP archives are downloaded and packaged directly in the user's browser using `JSZip`, allowing multi-hundred megabyte series to download without hitting serverless execution limits.


# ClipDownloader
