// F.4.99.14    src\web\components\ui\Map.tsx
/**
 * Обёртка над react-leaflet. Маркеры, кластеры, полигоны.
 * Используется: Cells (расположение), Planetary (карта общин),
 * Pulse (live-карта), Regimes (точки сбора).
 */

import L from 'leaflet';
import type { ReactElement } from 'react';
import { useEffect, useMemo , useState as useStateReact } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polygon,
} from 'react-leaflet';

import { colors, fontSize, radius, spacing } from '../../theme';

// ─── Иконки Leaflet (дефолтные пути) ────────────────────────────
// В Vite дефолтный iconPath ломается — задаём вручную через CDN.

const ICON_BASE = 'https://unpkg.com/leaflet@1.9.4/dist/images';

const defaultIcon = L.icon({
  iconUrl: `${ICON_BASE}/marker-icon.png`,
  iconRetinaUrl: `${ICON_BASE}/marker-icon-2x.png`,
  shadowUrl: `${ICON_BASE}/marker-shadow.png`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const coloredIcon = (color: string): L.DivIcon =>
  L.divIcon({
    className: '',
    html: `<div style="
      background:${color};
      width:14px;height:14px;
      border-radius:50%;
      border:2px solid #fff;
      box-shadow:0 0 4px rgba(0,0,0,0.5);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });

L.Marker.prototype.options.icon = defaultIcon;

// ─── Типы ────────────────────────────────────────────────────────

export type MarkerType =
  | 'participant'
  | 'cell'
  | 'community'
  | 'crisis'
  | 'cultural_center'
  | 'gateway';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  type: MarkerType;
  data?: Record<string, unknown>;
}

export interface MapPolygon {
  id: string;
  coords: Array<[number, number]>;
  color?: string;
  label?: string;
}

export interface MapCircle {
  id: string;
  lat: number;
  lon: number;
  radiusMeters: number;
  color?: string;
  label?: string;
}

export interface MapProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  onMarkerClick?: (marker: MapMarker) => void;
  height?: number | string;
  showUserLocation?: boolean;
}

const MARKER_COLORS: Record<MarkerType, string> = {
  participant: '#60a5fa', // синий
  cell: '#a78bfa',        // фиолетовый
  community: '#22c55e',   // зелёный
  crisis: '#ef4444',      // красный
  cultural_center: '#f59e0b', // оранжевый
  gateway: '#14b8a6',     // тил
};

// ─── Компонент ───────────────────────────────────────────────────

export function Map({
  center = [55.7558, 37.6173],
  zoom = 10,
  markers = [],
  polygons = [],
  circles = [],
  onMarkerClick,
  height = 400,
  showUserLocation = false,
}: MapProps): ReactElement {
  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  // Автоматический fit по маркерам, если их больше 1
  const autoCenter = useMemo<[number, number]>(() => {
    if (markers.length === 0) {return center;}
    const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
    const lon = markers.reduce((s, m) => s + m.lon, 0) / markers.length;
    return [lat, lon];
  }, [markers, center]);

  return (
    <div style={{ width: '100%', height: heightStyle, borderRadius: radius.md, overflow: 'hidden' }}>
      <MapContainer
        center={autoCenter}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='© OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {showUserLocation ? <UserLocation /> : null}

        {circles.map((c) => (
          <Circle
            key={c.id}
            center={[c.lat, c.lon]}
            radius={c.radiusMeters}
            pathOptions={{
              color: c.color ?? colors.primary,
              fillOpacity: 0.15,
            }}
          >
            {c.label ? <Popup>{c.label}</Popup> : null}
          </Circle>
        ))}

        {polygons.map((p) => (
          <Polygon
            key={p.id}
            positions={p.coords}
            pathOptions={{
              color: p.color ?? colors.primary,
              fillOpacity: 0.15,
            }}
          >
            {p.label ? <Popup>{p.label}</Popup> : null}
          </Polygon>
        ))}

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lon]}
            icon={coloredIcon(MARKER_COLORS[m.type] ?? '#60a5fa')}
            eventHandlers={
              onMarkerClick
                ? {
                    click: () => {
                      onMarkerClick(m);
                    },
                  }
                : undefined
            }
          >
            <Popup>
              <div style={{ fontSize: 13, minWidth: 120 }}>
                <strong>{m.label}</strong>
                {m.type ? (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    {m.type}
                  </div>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// ─── UserLocation (внутренний) ───────────────────────────────────

function UserLocation(): ReactElement | null {
  const [pos, setPos] = useStateSafe<[number, number] | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {return;}
    navigator.geolocation.getCurrentPosition(
      (p) => setPos([p.coords.latitude, p.coords.longitude]),
      () => {
        // молча игнорируем отказ
      },
      { timeout: 5000 },
    );
  }, []);

  if (!pos) {return null;}
  return <Circle center={pos} radius={100} pathOptions={{ color: '#3b82f6' }} />;
}

// локальный useState (без импорта ради читаемости)
function useStateSafe<T>(initial: T): [T, (v: T) => void] {
  return useStateReact<T>(initial);
}

// ─── useGeolocation ──────────────────────────────────────────────

export interface GeolocationResult {
  lat: number | null;
  lon: number | null;
  loading: boolean;
  error: string | null;
  request: () => void;
}

export function useGeolocation(): GeolocationResult {
  const [lat, setLat] = useStateReact<number | null>(null);
  const [lon, setLon] = useStateReact<number | null>(null);
  const [loading, setLoading] = useStateReact(false);
  const [error, setError] = useStateReact<string | null>(null);

  const request = (): void => {
    if (!navigator.geolocation) {
      setError('Geolocation не поддерживается');
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude);
        setLon(p.coords.longitude);
        setLoading(false);
      },
      (e) => {
        setError(e.message || 'Не удалось получить местоположение');
        setLoading(false);
      },
      { timeout: 5000 },
    );
  };

  return { lat, lon, loading, error, request };
}

// ─── MapWrapper с подписью (для быстрого использования) ─────────

export function MapWithLabel({
  label,
  ...props
}: MapProps & { label?: string }): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      {label ? (
        <span
          style={{
            fontSize: fontSize.xs,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {label}
        </span>
      ) : null}
      <Map {...props} />
    </div>
  );
}