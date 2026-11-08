import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];
  constructor(status: number, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Call the helpdesk API with the signed-in user's ID token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new ApiError(401, 'Please sign in again.');

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your signal and try again.');
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.details);
  return body as T;
}

/** Upload one file straight to the private bucket via a presigned URL. Returns the key to attach. */
export async function uploadFile(file: File | Blob, fileName: string): Promise<{ key: string; fileName: string; contentType: string }> {
  const contentType = file.type || 'application/octet-stream';
  const { key, url } = await api<{ key: string; url: string }>('/uploads', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType, size: file.size }),
  });
  const put = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: file });
  if (!put.ok) throw new ApiError(put.status, `Upload of ${fileName} failed. Please try again.`);
  return { key, fileName, contentType };
}
