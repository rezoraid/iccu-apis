'use strict';

const axios = require('axios');
const FormData = require('form-data');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/removebg',
    group: 'tools',
    name: 'Remove Background',
    description: 'Remove the background from an image and get back a hosted URL of the result.',
    params: [{ key: 'url', required: true, hint: 'Direct URL of the image', example: 'https://example.com/photo.jpg' }]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { url } = req.query;
    if (!url || !url.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'The "url" parameter is required.' }
      });
    }

    try {
      const { data: imageBuffer } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000
      });

      const bgRemovedBuffer = await removeBg(Buffer.from(imageBuffer));

      res.set('Content-Type', 'image/png');
      res.send(bgRemovedBuffer);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Failed to remove background.' }
      });
    }
  });
};

async function removeBg(imageBuffer) {
  const api = axios.create({ baseURL: 'https://api4g.iloveimg.com' });

  const { data: html } = await axios.get('https://www.iloveimg.com/id/hapus-latar-belakang', {
    timeout: 15000
  });
  const bearerToken = html.match(/ey[a-zA-Z0-9?%-_/]+/g)[1];
  api.defaults.headers.post['authorization'] = `Bearer ${bearerToken}`;
  const taskId = html.match(/taskId = '(\w+)/)[1];

  const formUpload = new FormData();
  formUpload.append('file', imageBuffer, `${Math.random().toString(36).slice(2)}.jpg`);
  formUpload.append('task', taskId);

  const { data: uploadData, status: uploadStatus } = await api.post('/v1/upload', formUpload, {
    headers: formUpload.getHeaders(),
    timeout: 30000
  });
  if (uploadStatus !== 200) throw new Error('Upload to iloveimg failed');

  const formRemoveBg = new FormData();
  formRemoveBg.append('task', taskId);
  formRemoveBg.append('server_filename', uploadData.server_filename);

  const { data: removeBgData, headers, status: removeBgStatus } = await api.post(
    '/v1/removebackground',
    formRemoveBg,
    {
      headers: formRemoveBg.getHeaders(),
      responseType: 'arraybuffer',
      timeout: 30000
    }
  );
  if (removeBgStatus !== 200 || !/image/.test(headers['content-type'])) {
    throw new Error('Background removal process failed');
  }

  return removeBgData;
}
