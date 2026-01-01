// api/viewer.js
export default async function handler(req, res) {
  const { src } = req.query;

  if (!src) {
    return res.status(400).json({ error: 'Missing src parameter' });
  }

  try {
    // Native fetch – no external dependency needed
    const resp = await fetch(src, {
      headers: { Accept: 'text/html' }
    });

    if (!resp.ok) throw new Error(`GitHub responded ${resp.status}`);

    const html = await resp.text();

    // Strip X‑Frame‑Options and set correct headers
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load game' });
  }
}
