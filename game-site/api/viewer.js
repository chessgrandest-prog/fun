// api/viewer.js
export default async function handler(req, res) {
  const { src } = req.query;

  if (!src) {
    return res.status(400).json({ error: 'Missing src parameter' });
  }

  try {
    // Fetch the raw file from GitHub (standard Fetch API)
    const resp = await fetch(src, {
      // GitHub sends text/html already, but we can set Accept just in case
      headers: { Accept: 'text/html' }
    });

    if (!resp.ok) {
      throw new Error(`GitHub responded ${resp.status}`);
    }

    const html = await resp.text();

    // Remove X-Frame-Options and set proper content type
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    // Optional: cache the result for 1 hour
    res.setHeader('Cache-Control', 'public, max-age=3600');

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load game' });
  }
}
