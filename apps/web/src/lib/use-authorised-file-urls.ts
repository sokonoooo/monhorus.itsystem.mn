import { useEffect, useState } from 'react';

import { authorisedFileUrl } from './file-url';

/** The least a stored file has to carry to be fetchable and keyed. */
export interface AuthorisedFileRef {
  id: string;
  downloadUrl: string;
}

/**
 * Object URLs for a set of authenticated files, keyed by file id.
 *
 * `GET /files/:id` requires the bearer token, so a stored file cannot be used as a bare
 * `img src` or `href`. Each one is fetched once and turned into an object URL that backs
 * its thumbnail, its enlarged preview and its download link alike. Everything handed out
 * is revoked when the set changes or the component unmounts, otherwise the blobs live as
 * long as the document does.
 *
 * One unreadable file is skipped rather than failing the set: a single 404'd photograph
 * must not blank out the rest of the evidence.
 */
export function useAuthorisedFileUrls(
  files: readonly AuthorisedFileRef[],
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Identity, not contents: a new array of the same files must not refetch.
  const key = files.map((file) => file.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    void (async () => {
      const resolved: Record<string, string> = {};
      for (const file of files) {
        try {
          const url = await authorisedFileUrl(file.downloadUrl);
          created.push(url);
          resolved[file.id] = url;
        } catch {
          // Skipped, not fatal — see the note above.
        }
      }
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setUrls(resolved);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}
