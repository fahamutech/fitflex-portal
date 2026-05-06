'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon path issue in Leaflet + bundlers
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface LocationPickerProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: string;
}

export function LocationPicker({ lat, lng, onChange, height = '260px' }: LocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const defaultLat = lat ?? -6.7924;
  const defaultLng = lng ?? 39.2083;

  const updateMarker = useCallback((newLat: number, newLng: number) => {
    if (!mapInstance.current) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([newLat, newLng]);
    } else {
      markerRef.current = L.marker([newLat, newLng], { icon: DefaultIcon, draggable: true })
        .addTo(mapInstance.current);
      markerRef.current.on('dragend', () => {
        const pos = markerRef.current?.getLatLng();
        if (pos) onChange(pos.lat, pos.lng);
      });
    }
  }, [onChange]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView([defaultLat, defaultLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    mapInstance.current = map;

    // Place initial marker
    updateMarker(defaultLat, defaultLng);

    // Click to place marker
    map.on('click', (e: L.LeafletMouseEvent) => {
      updateMarker(e.latlng.lat, e.latlng.lng);
      onChange(e.latlng.lat, e.latlng.lng);
    });

    // Invalidate size after mount (dialog might animate in)
    setTimeout(() => map.invalidateSize(), 300);

    return () => {
      map.remove();
      mapInstance.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker when lat/lng props change externally
  useEffect(() => {
    if (lat != null && lng != null && mapInstance.current) {
      updateMarker(lat, lng);
    }
  }, [lat, lng, updateMarker]);

  async function handleSearch() {
    if (!searchQuery.trim() || !mapInstance.current) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`);
      const data = await res.json();
      if (data.length > 0) {
        const { lat: rLat, lon: rLng } = data[0];
        const nLat = Number(rLat);
        const nLng = Number(rLng);
        mapInstance.current.setView([nLat, nLng], 15);
        updateMarker(nLat, nLng);
        onChange(nLat, nLng);
      }
    } catch {
      // Geocode failed silently
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="ui-input flex-1"
          placeholder="Search location..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50 transition-colors"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>
      <div ref={mapRef} style={{ height, width: '100%', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border-secondary)', position: 'relative', zIndex: 0 }} />
      {lat != null && lng != null && (
        <p className="text-xs text-[var(--color-fg-quaternary)]">
          Coordinates: {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
      )}
    </div>
  );
}
