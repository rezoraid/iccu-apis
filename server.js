'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const monitor = require('./src/monitor');
const { startBot, sendNotification } = require('./src/bot');

if (typeof globalThis.File === 'undefined') {
  globalThis.File = require('node:buffer').File;
}

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.set('json spaces', 2);
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const ip = req.ip;
  if (monitor.isBlocked(ip)) {
    monitor.recordBlockedHit(ip);
    return res.status(403).json({
      ok: false,
      error: { code: 'IP_BLOCKED', message: 'Your IP has been blocked from accessing this API.' }
    });
  }
  next();
});

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    monitor.recordRequest({
      ip: ip,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms)
    });

    sendNotification(ip, req.method, req.path, res.statusCode, Math.round(ms), userAgent);
  });
  next();
});

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again shortly.'
    }
  }
}));

app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (payload = {}) => {
    const { ok = true, result, error, meta } = payload;
    const envelope = {
      ok,
      provider: config.identity.name,
      path: req.originalUrl,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(meta !== undefined ? { meta } : {}),
      timestamp: new Date().toISOString()
    };
    return send(envelope);
  };
  next();
});

app.use('/assets', express.static(path.join(__dirname, 'public/assets'), { maxAge: '1d' }));
app.get('/manifest.json', (req, res) => res.json({ result: config }));

const registry = [];
const apiRoot = path.join(__dirname, 'src/api');
let loadedCount = 0;

fs.readdirSync(apiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .forEach((group) => {
    const groupPath = path.join(apiRoot, group.name);
    fs.readdirSync(groupPath)
      .filter((file) => file.endsWith('.js'))
      .forEach((file) => {
        try {
          const mod = require(path.join(groupPath, file));
          mod(app, registry, { group: group.name });
          loadedCount += 1;
        } catch (err) {
          console.error(`[route-load-error] ${group.name}/${file}: ${err.message}`);
        }
      });
  });

console.log(`[gateway] ${loadedCount} route module(s) loaded`);

app.get('/api/routes', (req, res) => {
  res.json({ result: registry });
});

app.get('/api/stats', (req, res) => {
  res.json({ result: monitor.stats() });
});

app.use('/', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.originalUrl}` }
  });
});

app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something failed while handling this request.' }
  });
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on port ${PORT}`);
  startBot(config);
});

module.exports = app;