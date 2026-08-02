import type { Request } from 'express';

/** Device metadata attached to every audit row. */
export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

/**
 * Accepts any Express request shape. Controllers narrow `Request` with body and
 * params generics, which makes the concrete `Request` type incompatible; depending
 * only on the two members actually used keeps every call site assignable.
 */
type MetaSource = Pick<Request, 'ip'> & {
  header(name: string): string | undefined;
};

export function buildRequestMeta(req: MetaSource): RequestMeta {
  return {
    userAgent: req.header('user-agent') ?? null,
    ip: req.ip ?? null,
  };
}
