import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { Cluster, Report } from '@dw/shared';

export const SEVERITY_COLORS = ['#888', '#3e9b6b', '#c9a227', '#e2812f', '#e5484d', '#b4237a'];

// OpenFreeMap: free vector basemap, no API key.
const STYLE = 'https://tiles.openfreemap.org/styles/dark';

export interface Layers {
  heat: boolean;
  clusters: boolean;
  reports: boolean;
}

interface Props {
  reports: Report[];
  clusters: Cluster[];
  selectedId: string | null;
  focusReportId: string | null;
  layers: Layers;
  onSelect: (id: string | null) => void;
  onSelectReport: (id: string) => void;
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

function reportFeatures(reports: Report[]) {
  return fc(
    reports.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        cluster_id: r.cluster_id ?? '',
        urgency: r.extracted?.urgency ?? 2,
        trapped: (r.extracted?.trapped_count ?? r.trapped_count) > 0 ? 1 : 0,
      },
    })),
  );
}

function clusterFeatures(clusters: Cluster[]) {
  return fc(
    clusters.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        id: c.id,
        severity: c.severity,
        count: c.report_count,
        trapped: c.trapped_count,
        resolved: c.status === 'resolved' ? 1 : 0,
        // Pixel radius at zoom 0 for a circle of radius_m metres (Web Mercator).
        px0: c.radius_m / (78271.517 * Math.cos((c.lat * Math.PI) / 180)),
        label: c.trapped_count > 0 ? `${c.report_count} · ${c.trapped_count} trapped` : String(c.report_count),
      },
    })),
  );
}

const sevColor: maplibregl.ExpressionSpecification = [
  'match', ['get', 'severity'],
  5, SEVERITY_COLORS[5], 4, SEVERITY_COLORS[4], 3, SEVERITY_COLORS[3], 2, SEVERITY_COLORS[2], SEVERITY_COLORS[1],
];

export default function MapView({ reports, clusters, selectedId, focusReportId, layers, onSelect, onSelectReport }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const fitted = useRef(false);
  const handlers = useRef({ onSelect, onSelectReport });
  handlers.current = { onSelect, onSelectReport };

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [77.05, 28.46], zoom: 11.5, attributionControl: { compact: true } });
    m.on('styleimagemissing', () => {});
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('reports', { type: 'geojson', data: fc([]) });
      m.addSource('clusters', { type: 'geojson', data: fc([]) });
      m.addLayer({
        id: 'heat', type: 'heatmap', source: 'reports',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'urgency'], 1, 0.15, 5, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 15, 40],
          'heatmap-opacity': 0.75,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.15, '#2b4c7e', 0.35, '#3e9b6b', 0.55, '#c9a227', 0.75, '#e2812f', 1, '#e5484d'],
        },
      });
      m.addLayer({
        id: 'cluster-area', type: 'circle', source: 'clusters',
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'px0'], 22, ['*', ['get', 'px0'], 4194304]],
          'circle-color': sevColor,
          'circle-opacity': ['case', ['==', ['get', 'resolved'], 1], 0.05, 0.18],
          'circle-stroke-color': sevColor,
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.8,
        },
      });
      m.addLayer({
        id: 'cluster-dot', type: 'circle', source: 'clusters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 40, 16],
          'circle-color': sevColor,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
          'circle-opacity': ['case', ['==', ['get', 'resolved'], 1], 0.35, 1],
        },
      });
      m.addLayer({
        id: 'cluster-label', type: 'symbol', source: 'clusters',
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.8], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.5 },
      });
      m.addLayer({
        id: 'report-dot', type: 'circle', source: 'reports',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'trapped'], 1], 6, 4],
          'circle-color': ['case', ['==', ['get', 'trapped'], 1], '#ff5c5c', '#d9e3f0'],
          'circle-stroke-color': '#111',
          'circle-stroke-width': 1,
        },
      });
      m.addLayer({
        id: 'report-focus', type: 'circle', source: 'reports', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffd84d', 'circle-stroke-width': 3 },
      });

      m.on('click', 'cluster-dot', (e) => handlers.current.onSelect(String(e.features?.[0]?.properties?.id)));
      m.on('click', 'cluster-area', (e) => {
        if (m.queryRenderedFeatures(e.point, { layers: ['cluster-dot', 'report-dot'] }).length) return;
        handlers.current.onSelect(String(e.features?.[0]?.properties?.id));
      });
      m.on('click', 'report-dot', (e) => handlers.current.onSelectReport(String(e.features?.[0]?.properties?.id)));
      for (const id of ['cluster-dot', 'report-dot']) {
        m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
      }
      ready.current = true;
      m.fire('dw-ready');
    });
    return () => m.remove();
  }, []);

  // Push data into the map whenever it changes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      (m.getSource('reports') as GeoJSONSource).setData(reportFeatures(reports));
      (m.getSource('clusters') as GeoJSONSource).setData(clusterFeatures(clusters));
      if (!fitted.current && reports.length) {
        fitted.current = true;
        const b = new maplibregl.LngLatBounds();
        reports.forEach((r) => b.extend([r.lng, r.lat]));
        m.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
      }
    };
    if (ready.current) apply();
    else m.once('dw-ready', apply);
  }, [reports, clusters]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      m.setLayoutProperty('heat', 'visibility', layers.heat ? 'visible' : 'none');
      for (const id of ['cluster-area', 'cluster-dot', 'cluster-label']) m.setLayoutProperty(id, 'visibility', layers.clusters ? 'visible' : 'none');
      // Individual pins: all of them if toggled on, otherwise only the selected cluster's.
      m.setLayoutProperty('report-dot', 'visibility', layers.reports || selectedId ? 'visible' : 'none');
      m.setFilter('report-dot', layers.reports || !selectedId ? null : ['==', ['get', 'cluster_id'], selectedId]);
      m.setFilter('report-focus', ['==', ['get', 'id'], focusReportId ?? '']);
    };
    if (ready.current) apply();
    else m.once('dw-ready', apply);
  }, [layers, selectedId, focusReportId]);

  // Fly to the selected cluster.
  useEffect(() => {
    const m = map.current;
    const c = clusters.find((x) => x.id === selectedId);
    if (!m || !c) return;
    const zoom = Math.max(14, Math.min(16.5, Math.log2((78271.517 * Math.cos((c.lat * Math.PI) / 180) * 180) / Math.max(60, c.radius_m))));
    m.flyTo({ center: [c.lng, c.lat], zoom, offset: [-180, 0], duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const m = map.current;
    const r = reports.find((x) => x.id === focusReportId);
    if (m && r) m.easeTo({ center: [r.lng, r.lat], offset: [-180, 0], duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReportId]);

  return <div ref={el} className="map" />;
}
