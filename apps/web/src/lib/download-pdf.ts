import { apiClient } from './api-client';
import { tokenStorage } from './token-storage';

/**
 * Downloads a generated PDF from an authenticated endpoint.
 *
 * The same mechanism the CSV export uses, and for the same reason: the route wants a
 * bearer token, so the file cannot be fetched by pointing an `<a href>` or a new tab at
 * it. The bytes are requested with the header attached, wrapped in an object url and
 * handed to a synthetic anchor, which is what makes the browser save rather than render.
 *
 * The object url is revoked in a `finally` — a blob that is never revoked pins its bytes
 * in memory for the life of the tab, and a report is not small.
 */
export async function downloadPdf(path: string, filename: string): Promise<void> {
  const response = await apiClient.get<Blob>(path, {
    responseType: 'blob',
    headers: { Authorization: `Bearer ${tokenStorage.getAccessToken() ?? ''}` },
  });

  const url = URL.createObjectURL(response.data);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
