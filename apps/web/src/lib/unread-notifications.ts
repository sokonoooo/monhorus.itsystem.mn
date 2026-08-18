/**
 * A nudge, published whenever the caller's unread count is known to have changed.
 *
 * The bell in `AppShell` and the notification page hold separate state and separate
 * requests. Nothing connected them, so marking everything read updated the page while the
 * badge kept its old number until the next sixty-second poll — a stale count sitting next
 * to a list that plainly shows nothing unread, which reads as a broken badge rather than a
 * slow one.
 *
 * This carries no value, only the fact that something changed. Subscribers re-ask the
 * server rather than adjusting a local number, so the badge is still the server's answer
 * and cannot drift from it. Publishing an optimistic count here would put a number on
 * screen that nothing verified.
 *
 * A module-level set rather than a context or a store library: there is exactly one
 * publisher and one subscriber, both mounted for the life of the session, and the codebase
 * has no client-state library to hang this on. `useSyncExternalStore` would fit if the
 * value itself lived here, but it does not — each subscriber owns its own fetch.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribes to unread-count changes. Returns the unsubscribe function. */
export function onUnreadCountChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announces that the unread count has changed.
 *
 * Call after any action that reads or unreads a notification, once the server has
 * confirmed it — announcing before that would refetch the old count.
 */
export function publishUnreadCountChanged(): void {
  for (const listener of listeners) listener();
}
