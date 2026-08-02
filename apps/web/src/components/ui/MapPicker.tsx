import L from 'leaflet';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { FIELD_INPUT } from './control-styles';

/**
 * Picks a GPS position by clicking a map.
 *
 * Leaflet with OpenStreetMap tiles. This is the one place in the web app that reaches an
 * outside host: the tiles are fetched from openstreetmap.org, so the building form needs
 * internet access. That trade was made deliberately in favour of a real map over typing
 * coordinates by hand; self-hosting the tiles later changes only `TILE_URL`.
 *
 * The numeric fields stay editable alongside the map, because a surveyed coordinate is
 * often pasted rather than clicked, and it must be possible to correct one digit without
 * hunting for the pin.
 */

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Ulaanbaatar. Where the map opens when nothing has been chosen yet. */
const DEFAULT_CENTRE: [number, number] = [47.9184, 106.9177];
const DEFAULT_ZOOM = 12;
const PLACED_ZOOM = 16;

/**
 * Leaflet's default marker icon resolves its own image URLs relative to the stylesheet,
 * which a bundler rewrites and breaks. A divIcon avoids the image entirely and keeps the
 * pin styled with the same palette as the rest of the app.
 */
const PIN_ICON = L.divIcon({
  className: '',
  html: '<span style="display:block;width:18px;height:18px;border-radius:9999px 9999px 9999px 2px;transform:rotate(-45deg);background:#dc2626;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
});

function isValidLatitude(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= -180 && value <= 180;
}

export interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (position: { latitude: number | null; longitude: number | null }) => void;
  disabled?: boolean;
  label?: string;
}

export function MapPicker({
  latitude,
  longitude,
  onChange,
  disabled = false,
  label = 'GPS байршил',
}: MapPickerProps): ReactElement {
  // Derived rather than hardcoded, so two pickers on one page keep their own
  // label/control pairing instead of both pointing at the same input.
  const fieldId = useId();
  const latitudeId = `${fieldId}-latitude`;
  const longitudeId = `${fieldId}-longitude`;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // The click handler is rebound through a ref so the map is created once, rather than
  // being torn down and rebuilt every time the parent re-renders.
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);

  const [latitudeText, setLatitudeText] = useState(latitude === null ? '' : String(latitude));
  const [longitudeText, setLongitudeText] = useState(longitude === null ? '' : String(longitude));

  useEffect(() => {
    onChangeRef.current = onChange;
    disabledRef.current = disabled;
  }, [onChange, disabled]);

  // Keep the text inputs in step when the parent changes the value, for example on load.
  useEffect(() => {
    setLatitudeText(latitude === null ? '' : String(latitude));
  }, [latitude]);
  useEffect(() => {
    setLongitudeText(longitude === null ? '' : String(longitude));
  }, [longitude]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTRE,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: false,
    });

    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      // Six decimals is roughly a tenth of a metre, well past what a building needs, and
      // it keeps the stored value from carrying meaningless float noise.
      const nextLatitude = Number(event.latlng.lat.toFixed(6));
      const nextLongitude = Number(event.latlng.lng.toFixed(6));
      onChangeRef.current({ latitude: nextLatitude, longitude: nextLongitude });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Move the pin and the view to match the current value.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const position: [number, number] = [latitude, longitude];
    if (markerRef.current) {
      markerRef.current.setLatLng(position);
    } else {
      markerRef.current = L.marker(position, { icon: PIN_ICON }).addTo(map);
      map.setView(position, PLACED_ZOOM);
    }
  }, [latitude, longitude]);

  /**
   * Accepts a pasted coordinate pair as well as a plain number.
   *
   * People routinely copy "47.9175, 106.9172" out of another map, and splitting it here
   * saves them editing it into two boxes by hand.
   */
  function handleLatitudeText(value: string): void {
    setLatitudeText(value);

    const pair = value.split(',').map((part) => part.trim());
    if (pair.length === 2 && pair[0] && pair[1]) {
      const parsedLatitude = Number(pair[0]);
      const parsedLongitude = Number(pair[1]);
      if (isValidLatitude(parsedLatitude) && isValidLongitude(parsedLongitude)) {
        setLatitudeText(String(parsedLatitude));
        setLongitudeText(String(parsedLongitude));
        onChange({ latitude: parsedLatitude, longitude: parsedLongitude });
        return;
      }
    }

    const parsed = value.trim() === '' ? null : Number(value);
    onChange({ latitude: parsed !== null && Number.isFinite(parsed) ? parsed : null, longitude });
  }

  function handleLongitudeText(value: string): void {
    setLongitudeText(value);
    const parsed = value.trim() === '' ? null : Number(value);
    onChange({ latitude, longitude: parsed !== null && Number.isFinite(parsed) ? parsed : null });
  }

  const hasPosition = isValidLatitude(latitude) && isValidLongitude(longitude);

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>

      <div
        ref={containerRef}
        role="application"
        aria-label="Байршил сонгох газрын зураг"
        className={`h-56 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-slate-300 ${
          disabled ? 'pointer-events-none opacity-60' : ''
        }`}
      />

      <p className="mt-1 text-[11px] text-slate-400">
        Газрын зураг дээр дарж байршлыг тэмдэглэнэ. Эсвэл координатыг доор шууд оруулна.
      </p>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor={latitudeId} className="mb-1 block text-xs text-slate-500">
            Өргөрөг
          </label>
          <input
            id={latitudeId}
            type="text"
            inputMode="decimal"
            value={latitudeText}
            onChange={(event) => handleLatitudeText(event.target.value)}
            disabled={disabled}
            placeholder="47.917500"
            className={FIELD_INPUT}
          />
        </div>
        <div>
          <label htmlFor={longitudeId} className="mb-1 block text-xs text-slate-500">
            Уртраг
          </label>
          <input
            id={longitudeId}
            type="text"
            inputMode="decimal"
            value={longitudeText}
            onChange={(event) => handleLongitudeText(event.target.value)}
            disabled={disabled}
            placeholder="106.917200"
            className={FIELD_INPUT}
          />
        </div>
        {hasPosition && !disabled && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => onChange({ latitude: null, longitude: null })}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            >
              Цэвэрлэх
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
