'use strict';

const axios = require('axios');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/ai/luminai',
    group: 'ai',
    name: 'LuminAI',
    description: 'Send a prompt to LuminAI and get a text reply back.',
    params: [{ key: 'text', required: true, hint: 'What do you want to ask?', example: 'halo ai' }]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { text } = req.query;
    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'The "text" parameter is required.' }
      });
    }

    try {
      const { data } = await axios.post(
        'https://luminai.my.id/',
        { content: text },
        { timeout: 15000 }
      );
      res.json({ result: { reply: data.result } });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'LuminAI did not respond in time.' }
      });
    }
  });
};