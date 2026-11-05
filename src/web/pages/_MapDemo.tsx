// F.4.99.30 — Map demo page (вынесена из App.tsx для lazy-роута).
// Использует components/ui/Map (leaflet) — тяжёлая, потому lazy.

import type { ReactElement } from 'react';

import { Map } from '../components/ui/Map';

export function MapDemoPage(): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>Map Demo</h1>
      <Map
        center={[55.7558, 37.6173]}
        zoom={10}
        markers={[
          { id: '1', lat: 55.7558, lon: 37.6173, label: 'Москва', type: 'community' },
          { id: '2', lat: 55.7658, lon: 37.6273, label: 'Кризис', type: 'crisis' },
        ]}
        height={500}
        showUserLocation
      />
    </div>
  );
}