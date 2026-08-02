import type { ReactElement } from 'react';

import type { NavIcon } from '../../config/navigation';

/**
 * Sidebar and header glyphs.
 *
 * Drawn rather than pulled from an icon package: sixteen shapes do not justify a
 * dependency, and each is chosen to say what its module is for. They replaced a green and
 * grey dot that distinguished nothing once every module was built.
 */
export function NavGlyph({ icon, className = 'h-4 w-4' }: {
  icon: NavIcon;
  className?: string;
}): ReactElement {
  const props = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (icon) {
    case 'DASHBOARD':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );

    case 'EMPLOYEE':
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0114 0" />
        </svg>
      );

    case 'CUSTOMER':
      return (
        <svg {...props}>
          <path d="M3 21V7l7-4 7 4v14" />
          <path d="M17 21V11h4v10" />
          <path d="M7 10h3M7 14h3M7 18h3" />
        </svg>
      );

    case 'PROJECT':
      return (
        <svg {...props}>
          <path d="M3 21h18" />
          <path d="M5 21V8l7-5 7 5v13" />
          <path d="M10 21v-6h4v6" />
        </svg>
      );

    case 'PLANNED_WORK':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
          <path d="M9 15l2 2 4-4" />
        </svg>
      );

    case 'SERVICE_REQUEST':
      return (
        <svg {...props}>
          <path d="M21 12a8 8 0 10-3.2 6.4L21 20z" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      );

    case 'INSPECTION':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
          <path d="M9 11l1.6 1.6L14 9" />
        </svg>
      );

    case 'CATALOGUE':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 4v16" />
          <path d="M12 9h5M12 13h5" />
        </svg>
      );

    case 'REPORT':
      return (
        <svg {...props}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 12v5M12 9v8M16 14v3" />
        </svg>
      );

    case 'INVOICE':
      return (
        <svg {...props}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );

    case 'ACCESS':
      return (
        <svg {...props}>
          <path d="M12 3l7 3v6c0 4.4-3 8.3-7 9-4-0.7-7-4.6-7-9V6z" />
          <path d="M9.5 12l1.8 1.8L15 10" />
        </svg>
      );

    case 'AUDIT':
      return (
        <svg {...props}>
          <path d="M5 3h9l5 5v13H5z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );

    case 'SETTINGS':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
      );

    case 'CALENDAR':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );

    case 'BELL':
      return (
        <svg {...props}>
          <path d="M18 8a6 6 0 10-12 0v4l-1.5 3h15L18 12z" />
          <path d="M10 19a2 2 0 004 0" />
        </svg>
      );

    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
