'use strict';

const axios = require('axios');
const FormData = require('form-data');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/ai/hydromind',
    group: 'ai',
    name: 'HydroMind',
    description: 'Chat with HydroMind. Pick a model to route the prompt through.',
    params: [
      { key: 'text', required: true, hint: 'What do you want to ask?', example: 'halo ai' },
      { key: 'model', required: true, hint: 'Model id, e.g. gpt-4o-mini', example: 'gpt-4o-mini' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { text, model } = req.query;
    if (!text || !model) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Both "text" and "model" are required.' }
      });
    }

    try {
      const form = new FormData();
      form.append('content', text);
      form.append('model', model);

      const { data } = await axios.post(
        'https://mind.hydrooo.web.id/v1/chat/',
        form,
        { headers: form.getHeaders(), timeout: 20000 }
      );
      res.json({ result: { reply: data.result } });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'HydroMind did not respond in time.' }
      });
    }
  });
};