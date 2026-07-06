'use strict';

const axios = require('axios');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/random/blue-archive',
    group: 'random',
    name: 'Blue Archive',
    description: 'Returns one random Blue Archive image as a PNG.',
    params: []
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    try {
      const { data: links } = await axios.get(
        'https://raw.githubusercontent.com/rynxzyy/blue-archive-r-img/refs/heads/main/links.json',
        { timeout: 10000 }
      );
      const pick = links[Math.floor(Math.random() * links.length)];
      const { data: image } = await axios.get(pick, {
        responseType: 'arraybuffer',
        timeout: 15000
      });

      const buffer = Buffer.from(image);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length
      });
      res.end(buffer);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Could not fetch an image right now.' }
      });
    }
  });
};