/**
 * Shared-password auth gate for the sales-queue API.
 *
 * The board sends the password as the `x-queue-auth` header on every request.
 * Set QUEUE_PASSWORD in the environment to enable protection.
 */

export function checkAuth(req) {
  const expected = process.env.QUEUE_PASSWORD;
  if (!expected) return true; // not configured → allow (dev)
  const provided = req.headers?.['x-queue-auth'];
  return provided === expected;
}
