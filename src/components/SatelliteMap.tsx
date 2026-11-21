import { useEffect, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import { AlertTriangle, Search } from 'lucide-react';
import type { ElevationGridPoint, EnvironmentalTelemetry, MapLayerMode } from '../types/site';

interface SatelliteMapProps {
  lat: number;
  lng: number;
  label: string;
  layerMode: MapLayerMode;
  showElevationGrid: boolean;
  showLandUseBuffer: boolean;
  elevationGrid: ElevationGridPoint[];
  landUseSamples: EnvironmentalTelemetry['landUse2Km']['sampleFeatures'];
  onSelectCoordinates: (lat: number, lng: number, placeLabel?: string) => void;
  onLayerChange: (mode: MapLayerMode) => void;
  onToggleElevationGrid: () => void;
  onToggleLandUseBuffer: () => void;
}

const MAP_TYPE_BY_MODE: Record<MapLayerMode, string> = {
  satellite: 'hybrid',
  urban: 'roadmap',
  topo: 'terrain',
};

function MapCameraSync({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    if (
      prevRef.current &&
      Math.abs(prevRef.current.lat - lat) < 1e-5 &&
      Math.abs(prevRef.current.lng - lng) < 1e-5
    ) {
      return;
    }
    prevRef.current = { lat, lng };
    map.panTo({ lat, lng });
    if ((map.getZoom() ?? 0) < 13) {
      map.setZoom(13);
    }
  }, [map, lat, lng]);

  return null;
}

interface MapCircleHandle {
  setMap: (map: unknown) => void;
  setCenter: (center: { lat: number; lng: number }) => void;
}

function AnalysisBufferCircle({
  lat,
  lng,
  visible,
}: {
  lat: number;
  lng: number;
  visible: boolean;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const circleRef = useRef<MapCircleHandle | null>(null);

  useEffect(() => {
    if (!map || !visible || !mapsLib?.Circle) {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
      return;
    }

    if (!circleRef.current) {
      circleRef.current = new mapsLib.Circle({
        map,
        center: { lat, lng },
        radius: 2000,
        strokeColor: '#65a30d',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: '#84cc16',
        fillOpacity: 0.12,
        clickable: false,
      }) as unknown as MapCircleHandle;
    } else {
      circleRef.current.setCenter({ lat, lng });
      circleRef.current.setMap(map);
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, mapsLib, lat, lng, visible]);

  return null;
}

function PlacesQuickSearch({
  onSelectPlace,
}: {
  onSelectPlace: (lat: number, lng: number, placeLabel?: string) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  if (!placesLib?.Place) return null;

  const handlePlacesLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || searching) return;
    setSearching(true);
    try {
      const { places } = await placesLib.Place.searchByText({
        textQuery: trimmed,
        fields: ['displayName', 'location', 'formattedAddress'],
        maxResultCount: 1,
      });
      const first = places?.[0];
      if (first?.location) {
        const nextLat = +first.location.lat().toFixed(5);
        const nextLng = +first.location.lng().toFixed(5);
        onSelectPlace(nextLat, nextLng, first.displayName || trimmed);
        setQuery('');
      }
    } catch {
      // Ignore transient SDK lookup failures cleanly
    } finally {
      setSearching(false);
    }
  };

  return (
    <form
      onSubmit={handlePlacesLookup}
      className="hidden sm:flex items-center bg-white/95 border border-slate-300 rounded shadow-xs overflow-hidden"
    >
      <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 shrink-0" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Places jump..."
        className="w-36 px-2 py-1 text-xs bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={searching || !query.trim()}
        className="px-2.5 py-1 text-[11px] font-mono font-bold bg-[#0f2557] hover:bg-lime-600 text-white border-l border-slate-200 transition-colors disabled:opacity-50"
      >
        {searching ? '...' : 'Go'}
      </button>
    </form>
  );
}

function InnerGoogleMap({
  lat,
  lng,
  label,
  layerMode,
  showElevationGrid,
  showLandUseBuffer,
  elevationGrid,
  landUseSamples,
  onSelectCoordinates,
  onLayerChange,
  onToggleElevationGrid,
  onToggleLandUseBuffer,
}: SatelliteMapProps) {
  const status = useApiLoadingStatus();
  const [selectedProbe, setSelectedProbe] = useState<{
    lat: number;
    lng: number;
    title: string;
    detail: string;
  } | null>(null);

  const minElev =
    elevationGrid.length > 0 ? Math.min(...elevationGrid.map((p) => p.elevation)) : 0;
  const maxElev =
    elevationGrid.length > 0 ? Math.max(...elevationGrid.map((p) => p.elevation)) : 1;
  const elevSpan = Math.max(1, maxElev - minElev);

  const handleMapClick = (ev: MapMouseEvent) => {
    const clicked = ev.detail?.latLng;
    if (!clicked) return;
    setSelectedProbe(null);
    onSelectCoordinates(+clicked.lat.toFixed(5), +clicked.lng.toFixed(5));
  };

  if (status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-slate-100">
        <AlertTriangle className="w-6 h-6 text-[#0f2557] mb-2" />
        <p className="text-sm font-bold text-[#0f2557]">
          Google Maps Viewport Temporarily Unavailable
        </p>
        <p className="text-xs text-slate-600 mt-1 max-w-md">
          Coordinate selection via location search and benchmark corridors remains active. Live Open-Meteo, Copernicus DEM, CAMS, GloFAS, and NASA POWER telemetry continues uninterrupted.
        </p>
      </div>
    );
  }

  return (
    <>
      <Map
        mapId="DEMO_MAP_ID"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        defaultCenter={{ lat, lng }}
        defaultZoom={13}
        colorScheme="LIGHT"
        mapTypeId={MAP_TYPE_BY_MODE[layerMode]}
        gestureHandling="greedy"
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        onClick={handleMapClick}
        style={{ width: '100%', height: '100%' }}
      >
        <MapCameraSync lat={lat} lng={lng} />
        <AnalysisBufferCircle lat={lat} lng={lng} visible={showLandUseBuffer} />

        {/* Primary Parcel Pin */}
        <AdvancedMarker
          position={{ lat, lng }}
          title={`${label} (${lat.toFixed(4)}, ${lng.toFixed(4)})`}
          onClick={() =>
            setSelectedProbe({
              lat,
              lng,
              title: label,
              detail: `Target Parcel · ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`,
            })
          }
        >
          <Pin
            background="#0f2557"
            borderColor="#84cc16"
            glyphColor="#a3e635"
            scale={1.15}
          />
        </AdvancedMarker>

        {/* 5x5 Copernicus DEM 90m Elevation Probes */}
        {showElevationGrid &&
          elevationGrid.map((pt, idx) => {
            const ratio = (pt.elevation - minElev) / elevSpan;
            const dotColor =
              ratio < 0.3 ? '#d97706' : ratio < 0.7 ? '#65a30d' : '#1e3a8a';
            return (
              <AdvancedMarker
                key={`dem-${idx}`}
                position={{ lat: pt.lat, lng: pt.lng }}
                title={`DEM 90m: ${pt.elevation.toFixed(1)} m`}
                onClick={() =>
                  setSelectedProbe({
                    lat: pt.lat,
                    lng: pt.lng,
                    title: 'Copernicus DEM 90m Probe',
                    detail: `Elevation: ${pt.elevation.toFixed(1)} m ASL`,
                  })
                }
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: dotColor,
                    border: '1.5px solid #ffffff',
                    boxShadow: '0 1px 4px rgba(15,23,42,0.45)',
                  }}
                />
              </AdvancedMarker>
            );
          })}

        {/* 2 km OSM Land-Use Feature Samples */}
        {showLandUseBuffer &&
          landUseSamples.map((feat, idx) => {
            const color =
              feat.kind === 'green'
                ? '#65a30d'
                : feat.kind === 'water'
                  ? '#0284c7'
                  : feat.kind === 'industrial'
                    ? '#dc2626'
                    : '#1e3a8a';
            return (
              <AdvancedMarker
                key={`osm-${idx}`}
                position={{ lat: feat.lat, lng: feat.lng }}
                title={`${feat.name} (${feat.kind})`}
                onClick={() =>
                  setSelectedProbe({
                    lat: feat.lat,
                    lng: feat.lng,
                    title: feat.name,
                    detail: `OSM Feature Classification: ${feat.kind.toUpperCase()}`,
                  })
                }
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    backgroundColor: color,
                    border: '1px solid #ffffff',
                    transform: 'rotate(45deg)',
                  }}
                />
              </AdvancedMarker>
            );
          })}

        {selectedProbe && (
          <InfoWindow
            position={{ lat: selectedProbe.lat, lng: selectedProbe.lng }}
            onCloseClick={() => setSelectedProbe(null)}
          >
            <div className="text-slate-900 p-0.5 max-w-[210px]">
              <div className="text-xs font-bold text-[#0f2557]">{selectedProbe.title}</div>
              <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                {selectedProbe.detail}
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* Top-Left Basemap Mode Segmented Switcher + Places Quick Jump */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 bg-white/95 border border-slate-200 rounded shadow-xs">
          {(['satellite', 'urban', 'topo'] as MapLayerMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onLayerChange(mode)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                layerMode === mode
                  ? 'bg-[#0f2557] text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-[#0f2557]'
              }`}
            >
              {mode === 'satellite' ? 'Satellite' : mode === 'urban' ? 'Urban Map' : 'Terrain'}
            </button>
          ))}
        </div>

        <PlacesQuickSearch onSelectPlace={onSelectCoordinates} />
      </div>

      {/* Top-Right Spatial Layer Toggles */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleLandUseBuffer}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors whitespace-nowrap shrink-0 shadow-xs ${
            showLandUseBuffer
              ? 'bg-lime-100 border-lime-600 text-[#0f2557]'
              : 'bg-white/95 border-slate-200 text-slate-600 hover:text-[#0f2557]'
          }`}
        >
          2 km Buffer
        </button>
        <button
          type="button"
          onClick={onToggleElevationGrid}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors whitespace-nowrap shrink-0 shadow-xs ${
            showElevationGrid
              ? 'bg-lime-100 border-lime-600 text-[#0f2557]'
              : 'bg-white/95 border-slate-200 text-slate-600 hover:text-[#0f2557]'
          }`}
        >
          5×5 DEM Grid
        </button>
      </div>

      {/* Bottom-Left Coordinate Readout */}
      <div className="absolute bottom-3 left-3 z-10 bg-white/95 border border-slate-200 rounded px-3 py-1.5 shadow-xs">
        <div className="flex items-center gap-3 text-xs text-slate-700">
          <span className="font-mono tabular-nums font-bold text-[#0f2557]">
            {lat.toFixed(4)}° N, {lng.toFixed(4)}° E
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="text-slate-500 hidden sm:inline">
            Click anywhere on map to analyze parcel
          </span>
        </div>
      </div>
    </>
  );
}

export function SatelliteMap(props: SatelliteMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  return (
    <div className="relative w-full h-[460px] lg:h-[520px] border border-slate-200 rounded overflow-hidden bg-slate-100">
      {!apiKey ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-[#0f2557] mb-2" />
          <p className="text-sm font-bold text-[#0f2557]">
            Google Maps API Key Not Configured
          </p>
          <p className="text-xs text-slate-600 mt-1 max-w-md">
            Set <code className="font-mono text-[#0f2557]">VITE_GOOGLE_MAPS_API_KEY</code> to display the interactive satellite viewport.
          </p>
        </div>
      ) : (
        <APIProvider apiKey={apiKey} libraries={['marker', 'places']}>
          <InnerGoogleMap {...props} />
        </APIProvider>
      )}
    </div>
  );
}
