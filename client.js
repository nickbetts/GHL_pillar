import { TOKEN } from './config.js';

const BASE_URL = 'https://services.leadconnectorhq.com';

async function request(method, path, { body, params } = {}) {
  let url = `${BASE_URL}${path}`;

  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: 'v3',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText;
    const err = new Error(`GHL API ${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const get = (path, params) => request('GET', path, { params });
export const post = (path, body) => request('POST', path, { body });
export const put = (path, body) => request('PUT', path, { body });
export const del = (path) => request('DELETE', path);
