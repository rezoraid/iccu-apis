# Gateway

A small REST API gateway that auto-loads route modules and documents itself.
Drop a new file under `src/api/<group>/`, restart the server, and it shows up
in the docs page and in `/api/routes` automatically — nothing to register by hand.

## Run it

```bash
npm install
npm start
```

The server listens on port 4000 by default. Set `PORT` to change it.

Open `http://localhost:4000` for the docs page, where every route can be
run directly from the browser.

## Project layout

```
server.js              entrypoint: middleware, route loader, error handling
src/config.js           shared identity/group metadata (also served at /manifest.json)
src/api/<group>/*.js     one file per route; each exports a function(app, registry)
public/                 the documentation UI (static, no build step)
```

## Adding a route

Create a file under `src/api/<group>/your-route.js`:

```js
'use strict';

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/group/your-route',
    group: 'group',
    name: 'Human-readable name',
    description: 'One line describing what it does.',
    params: [{ key: 'q', required: true, hint: 'Example placeholder text' }]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: '"q" is required.' }
      });
    }
    res.json({ result: { echoed: q } });
  });
};
```

If the group is new, add its label in `src/config.js` under `groups` so the
sidebar shows a proper name instead of the raw folder name.

## Response shape

Every JSON response is wrapped the same way:

```json
{
  "ok": true,
  "provider": "Gateway",
  "path": "/search/youtube?q=lofi",
  "result": { "...": "..." },
  "timestamp": "2026-07-06T12:00:00.000Z"
}
```

Errors use the same envelope with `ok: false` and an `error` object
(`code` and `message`) instead of `result`.
