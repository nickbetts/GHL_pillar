// Temporary diagnostic: identifies which import in the queue chain fails at load.
export default async function handler(req, res) {
  const targets = [
    ['auth', './auth.js'],
    ['db', './db.js'],
    ['apollo-client', './apollo-client.js'],
    ['client', '../client.js'],
    ['config', '../config.js'],
  ];
  const out = {};
  for (const [name, path] of targets) {
    try {
      await import(path);
      out[name] = 'ok';
    } catch (e) {
      out[name] = `ERR: ${e.message}`;
    }
  }
  out.env = {
    GHL_TOKEN: !!process.env.GHL_TOKEN,
    GHL_LOCATION_ID: !!process.env.GHL_LOCATION_ID,
    DATABASE_URL: !!process.env.DATABASE_URL,
    QUEUE_PASSWORD: !!process.env.QUEUE_PASSWORD,
  };
  res.status(200).json(out);
}
