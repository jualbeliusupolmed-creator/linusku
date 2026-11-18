'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Polygon,
  Marker,
  Popup,
  CircleMarker,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { Globe, Map as MapIcon } from 'lucide-react';
import {
  BusPosition,
  BusStop,
  DEFAULT_ETA_SETTINGS,
  DEFAULT_MAP_SETTINGS,
  ETASettings,
  MapSettings,
  ROUTE_POLYLINE,
  USU_CENTER,
  USU_MAP_BOUNDS,
  USU_STOPS,
  estimateEtaMinutes,
} from '@/data/usuRoutes';

interface LinusMapProps {
  buses: BusPosition[];
  stops?: BusStop[];
  routePolyline?: [number, number][];
  selectedStopId: string | null;
  onSelectStop: (stop: BusStop) => void;
  etaSettings?: ETASettings;
  mapSettings?: MapSettings;
}

type MapMode = 'city' | 'satellite';

const STORAGE_MAP_MODE_KEY = 'linusku:mapMode';
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();

const CITY_TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() ||
  (CARTO_API_KEY
    ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png');

const FALLBACK_OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const SATELLITE_LABELS_URL = CARTO_API_KEY
  ? `https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`
  : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png';

const [[SOUTH, WEST], [NORTH, EAST]] = USU_MAP_BOUNDS;

// Masking halus di luar area Kampus USU + sekitarnya agar fokus visual hanya di kawasan kampus
const OUTSIDE_CAMPUS_MASK: [number, number][][] = [
  [
    [-90, -180],
    [-90, 180],
    [90, 180],
    [90, -180],
  ],
  [
    [SOUTH, WEST],
    [NORTH, WEST],
    [NORTH, EAST],
    [SOUTH, EAST],
  ],
];

const occupancyLabel: Record<BusPosition['occupancy'], string> = {
  low: 'Lega',
  medium: 'Sedang',
  full: 'Penuh',
};

const occupancyColor: Record<BusPosition['occupancy'], string> = {
  low: '#10b981',
  medium: '#f59e0b',
  full: '#ef4444',
};

function createBusIcon(bus: BusPosition) {
  const badgeColor = occupancyColor[bus.occupancy];
  return L.divIcon({
    className: 'linus-bus-marker',
    html: `
      <div style="
        display:flex;
        align-items:center;
        gap:6px;
        background:#0f172a;
        color:#ffffff;
        padding:6px 10px;
        border-radius:9999px;
        border:2px solid #ffffff;
        box-shadow:0 6px 16px rgba(15,23,42,0.28);
        font-size:12px;
        font-weight:700;
        white-space:nowrap;
        transform:translate(-50%,-50%);
      ">
        <span style="width:8px;height:8px;border-radius:9999px;background:${badgeColor};display:inline-block;"></span>
        <span>${bus.busId}</span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function MapFlyToStop({
  selectedStopId,
  stops,
}: {
  selectedStopId: string | null;
  stops: BusStop[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedStopId) return;
    const target = stops.find((s) => s.id === selectedStopId);
    if (target) {
      map.flyTo([target.lat, target.lng], 16, { duration: 0.7 });
    }
  }, [map, selectedStopId, stops]);

  return null;
}

export default function LinusMap({
  buses,
  stops = USU_STOPS,
  routePolyline = ROUTE_POLYLINE,
  selectedStopId,
  onSelectStop,
  etaSettings = DEFAULT_ETA_SETTINGS,
  mapSettings = DEFAULT_MAP_SETTINGS,
}: LinusMapProps) {
  const [mapMode, setMapMode] = useState<MapMode>('city');
  const [useFallbackOsm, setUseFallbackOsm] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_MAP_MODE_KEY);
      if (saved === 'city' || saved === 'satellite') {
        setMapMode(saved);
      }
    } catch {
      // Ignore storage error
    }
  }, []);

  useEffect(() => {
    setUseFallbackOsm(false);
  }, [mapSettings.tileProvider, mapSettings.fallbackToOsm]);

  const handleChangeMode = (mode: MapMode) => {
    setMapMode(mode);
    try {
      window.localStorage.setItem(STORAGE_MAP_MODE_KEY, mode);
    } catch {
      // Ignore storage error
    }
  };

  const configuredTileUrl =
    mapSettings.tileProvider === 'osm'
      ? FALLBACK_OSM_URL
      : mapSettings.tileProvider === 'pmtiles_r2'
        ? process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() || FALLBACK_OSM_URL
        : CITY_TILE_URL;
  const cityTileUrl = useFallbackOsm ? FALLBACK_OSM_URL : configuredTileUrl;

  return (
    <div className="relative h-full w-full">
      {/* Toggle Mode Kota / Satelit */}
      <div className="map-mode-toggle">
        <button
          type="button"
          onClick={() => handleChangeMode('city')}
          className={`map-mode-button ${mapMode === 'city' ? 'is-selected' : ''}`}
          aria-pressed={mapMode === 'city'}
        >
          <MapIcon className="h-3.5 w-3.5" />
          Kota
        </button>
        <button
          type="button"
          onClick={() => handleChangeMode('satellite')}
          className={`map-mode-button ${mapMode === 'satellite' ? 'is-selected' : ''}`}
          aria-pressed={mapMode === 'satellite'}
        >
          <Globe className="h-3.5 w-3.5" />
          Satelit
        </button>
      </div>

      <MapContainer
        center={USU_CENTER}
        zoom={16}
        minZoom={15}
        maxZoom={18}
        maxBounds={USU_MAP_BOUNDS}
        maxBoundsViscosity={1.0}
        scrollWheelZoom={true}
        className="h-full w-full rounded-2xl z-0"
      >
        {mapMode === 'city' ? (
          <TileLayer
            key={`city-${cityTileUrl}`}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={cityTileUrl}
            bounds={USU_MAP_BOUNDS}
            maxZoom={18}
            eventHandlers={{
              tileerror: () => {
                if (mapSettings.fallbackToOsm && !useFallbackOsm) {
                  setUseFallbackOsm(true);
                }
              },
            }}
          />
        ) : (
          <>
            <TileLayer
              key="satellite-base"
              attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
              url={SATELLITE_TILE_URL}
              bounds={USU_MAP_BOUNDS}
              maxZoom={18}
            />
            <TileLayer
              key="satellite-labels"
              url={SATELLITE_LABELS_URL}
              bounds={USU_MAP_BOUNDS}
              maxZoom={18}
            />
          </>
        )}

        <Polygon
          positions={OUTSIDE_CAMPUS_MASK}
          pathOptions={{
            stroke: false,
            fillColor: mapMode === 'satellite' ? '#0f172a' : '#f8fafc',
            fillOpacity: mapMode === 'satellite' ? 0.65 : 0.78,
            interactive: false,
          }}
        />

        <MapFlyToStop selectedStopId={selectedStopId} stops={stops} />

        <Polyline
          positions={routePolyline}
          pathOptions={{
            color: mapMode === 'satellite' ? '#34d399' : '#059669',
            weight: 5,
            opacity: 0.9,
          }}
        />

        {stops.map((stop) => {
          const isSelected = stop.id === selectedStopId;
          const nearestEta = buses.length
            ? Math.min(
                ...buses.map((b) =>
                  estimateEtaMinutes(b, stop, routePolyline, etaSettings)
                )
              )
            : null;

          return (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lng]}
              radius={isSelected ? 10 : 7}
              pathOptions={{
                color: isSelected ? '#0f172a' : '#059669',
                weight: isSelected ? 3 : 2,
                fillColor: isSelected ? '#10b981' : '#ffffff',
                fillOpacity: 1,
              }}
              eventHandlers={{
                click: () => onSelectStop(stop),
              }}
            >
              <Popup>
                <div className="min-w-[170px] space-y-1">
                  <p className="map-popup-label">Halte {stop.sequenceOrder}</p>
                  <p className="map-popup-name">{stop.name}</p>
                  <p className="map-popup-area">{stop.area}</p>
                  {nearestEta !== null && (
                    <p className="map-popup-eta">
                      Bus terdekat: ~{nearestEta} menit
                    </p>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {buses.map((bus) => (
          <Marker
            key={bus.busId}
            position={[bus.lat, bus.lng]}
            icon={createBusIcon(bus)}
          >
            <Popup>
              <div className="min-w-[160px] space-y-1">
                <p className="map-popup-name">{bus.name}</p>
                <p className="map-popup-detail">
                  Kecepatan: {Math.round(bus.speedKmh)} km/jam
                </p>
                <p className="map-popup-detail">
                  Kepadatan:{' '}
                  <span className="font-semibold">
                    {occupancyLabel[bus.occupancy]}
                  </span>
                </p>
                <p className="map-popup-detail">Sumber: {bus.sourceType}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
