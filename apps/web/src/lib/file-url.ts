import { apiClient } from './api-client';

/**
 * Fetches an authenticated file and returns a blob URL for it.
 *
 * The download route requires a bearer token, so a private file cannot be used directly as
 * an `img src` or an `href`. The caller owns the returned URL and must revoke it with
 * `URL.revokeObjectURL` when the element unmounts, otherwise the blob stays in memory for
 * the lifetime of the document.
 */
export async function authorisedFileUrl(downloadPath: string): Promise<string> {
  // The stored path already carries the /api/v1 prefix that the client's baseURL adds.
  const path = downloadPath.replace(/^\/api\/v1/, '');
  const response = await apiClient.get<Blob>(path, { responseType: 'blob' });
  return URL.createObjectURL(response.data);
}
