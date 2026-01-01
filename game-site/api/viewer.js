// api/viewer.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { src } = req.query;      // raw GitHub URL
  if (!src) {
    return res.status(400).send('Missing src parameter');
  }

  try {
    const resp = await fetch(src, {
      headers: { Accept: 'text/html' }
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const html = await resp.text();

    // Remove X-Frame-Options and set content‑type
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading game');
  }
}
