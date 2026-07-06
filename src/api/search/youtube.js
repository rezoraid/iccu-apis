'use strict';

const yts = require('yt-search');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/search/youtube',
    group: 'search',
    name: 'YouTube search',
    description: 'Search YouTube videos and get back title, channel, duration and link.',
    params: [{ key: 'q', required: true, hint: 'Search keywords', example: 'dj full bass' }]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'The "q" parameter is required.' }
      });
    }

    try {
      const { videos } = await yts.search(q);
      const results = videos.slice(0, 20).map((video) => ({
        title: video.title,
        channel: video.author.name,
        duration: video.duration.timestamp,
        thumbnail: video.thumbnail,
        url: video.url
      }));
      res.json({ result: results });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'YouTube search failed.' }
      });
    }
  });
};