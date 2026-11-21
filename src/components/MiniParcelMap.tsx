import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SiteAssessment } from '../types/site';

interface MiniParcelMapProps {
  site: SiteAssessment;
  accentHex: string;
}

export function MiniParcelMap({ site, accentHex }: MiniParcelMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const [tileMode, setTileMode] = useState<'satellite' | 'street'>('satellite');

  const { lat, lng, label } = site.telemetry.query;
  const sampleFeatures = site.telemetry.landUse2Km.sampleFeatures;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    const overlayGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    overlayLayerRef.current = overlayGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      overlayLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl =
      tileMode === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

    tileLayerRef.current = L.tileLayer(tileUrl, {
      maxZoom: 18,
    }).addTo(map);
  }, [tileMode]);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayLayerRef.current;
    if (!map || !overlay) return;

    map.setView([lat, lng], 13, { animate: false });
    overlay.clearLayers();

    // 2 km environmental buffer ring
    L.circle([lat, lng], {
      radius: 2000,
      color: accentHex,
      weight: 2,
      fillColor: accentHex,
      fillOpacity: 0.12,
    }).addTo(overlay);

    // Center parcel pin
    L.circleMarker([lat, lng], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: accentHex,
      fillOpacity: 1,
    })
      .bindTooltip(label, { direction: 'top' })
      .addTo(overlay);

    // Surrounding green & water features
    for (const feat of sampleFeatures.slice(0, 20)) {
      const color =
        feat.kind === 'green'
          ? '#65a30d'
          : feat.kind === 'water'
            ? '#0284c7'
            : feat.kind === 'industrial'
              ? '#d97706'
              : '#64748b';
      L.circleMarker([feat.lat, feat.lng], {
        radius: 3,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.85,
      }).addTo(overlay);
    }
  }, [lat, lng, label, accentHex, sampleFeatures]);

  return (
    <div className="relative rounded border border-slate-200 overflow-hidden bg-slate-100 h-40">
      <div ref={containerRef} className="w-full h-full z-0" />

      <div className="absolute top-2 right-2 z-[400] flex items-center gap-1 bg-white/95 border border-slate-200 rounded p-0.5 shadow-sm print:hidden">
        <button
          type="button"
          onClick={() => setTileMode('satellite')}
          className={`px-2 py-0.5 text-[10px] font-bold rounded-xs transition-colors ${
            tileMode === 'satellite' ? 'bg-[#0f2557] text-white' : 'text-slate-600 hover:text-[#0f2557]'
          }`}
        >
          Satellite
        </button>
        <button
          type="button"
          onClick={() => setTileMode('street')}
          className={`px-2 py-0.5 text-[10px] font-bold rounded-xs transition-colors ${
            tileMode === 'street' ? 'bg-[#0f2557] text-white' : 'text-slate-600 hover:text-[#0f2557]'
          }`}
        >
          Street
        </button>
      </div>

      <div className="absolute bottom-1.5 left-2 z-[400] px-2 py-0.5 bg-white/90 border border-slate-200 rounded text-[10px] font-mono text-[#0f2557] font-semibold pointer-events-none">
        2 km buffer · {site.telemetry.landUse2Km.greenFeaturesCount} green ·{' '}
        {site.telemetry.landUse2Km.waterFeaturesCount} water
      </div>
    </div>
  );
}
