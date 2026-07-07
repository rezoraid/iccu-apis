'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);
const TIMEOUT = 60000;
const ALLOWED_BITRATES = ['64', '128'];

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/ytmp3',
    group: 'download',
    name: 'YouTube to MP3',
    description: 'Download audio from a YouTube video as MP3, using yt-dlp, with a choice of bitrate.',
    params: [
      { key: 'url', required: true, hint: 'YouTube video URL', example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { key: 'bitrate', required: false, hint: 'Pilih kualitas audio', example: '128', options: ['64', '128'] }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { url, bitrate } = req.query;

    if (!url || !url.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'The "url" parameter is required.' }
      });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_URL', message: 'Could not extract a valid YouTube video ID from that URL.' }
      });
    }

    const quality = ALLOWED_BITRATES.includes(String(bitrate)) ? String(bitrate) : '128';
    const outPath = path.join(os.tmpdir(), `ytmp3_${videoId}_${Date.now()}.mp3`);
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      await execAsync(
        `yt-dlp -x --audio-format mp3 --audio-quality ${quality}K --no-playlist -o "${outPath}" "${ytUrl}"`,
        { timeout: TIMEOUT }
      );

      if (!fs.existsSync(outPath)) {
        throw new Error('yt-dlp did not produce an output file');
      }

      const buffer = fs.readFileSync(outPath);
      fs.unlinkSync(outPath);

      if (buffer.length < 10000) {
        throw new Error('Downloaded file is too small, likely failed');
      }

      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Disposition', `attachment; filename="${videoId}.mp3"`);
      res.send(buffer);
    } catch (err) {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      res.status(502).json({
        ok: false,
        error: { code: 'DOWNLOAD_FAILED', message: err.message || 'Failed to download audio.' }
      });
    }
  });
};

function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}
