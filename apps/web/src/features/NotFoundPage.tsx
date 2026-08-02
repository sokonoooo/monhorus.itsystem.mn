import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): ReactElement {
  return (
    <div className="rounded-xl bg-white px-6 py-20 text-center ring-1 ring-slate-200">
      <p className="text-3xl font-bold text-slate-900">404</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">Хуудас олдсонгүй</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
        Хандахыг оролдсон хуудас байхгүй эсвэл шилжсэн байна.
      </p>
      <Link
        to="/dashboard"
        className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Хяналтын самбар руу буцах
      </Link>
    </div>
  );
}
