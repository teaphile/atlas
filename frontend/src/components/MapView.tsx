import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as LibreMap,
  StyleSpecification,
  LayerSpecification,
} from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import {
  Plus,
  Minus,
  LocateFixed,
  Globe2,
  Scan,
  SquareDashedMousePointer,
  Layers3,
  Compass,
  Maximize2,
} from "lucide-react";
import { IconButton } from "./UI";
import type { AtlasEvent, GeoPolygon, Place } from "../types";
import { COLORS, severityRank, num } from "../utils";
import "maplibre-gl/dist/maplibre-gl.css";
import { deploymentHeaders } from "../api";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import baseStyle from "../../public/openfreemap-dark.json";
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);
const baseLayers = (baseStyle.layers as LayerSpecification[])
  .filter((l) => "source" in l && l.source === "openmaptiles")
  .map((l) => {
    const layer = {
      ...l,
      id: "base-" + l.id,
      source: "basemap",
    } as LayerSpecification;
    if (layer.type === "symbol" && layer.layout) {
      layer.layout = { ...layer.layout };
      delete layer.layout["icon-image"];
      if (layer.layout["text-field"])
        layer.layout["text-field"] = [
          "coalesce",
          ["get", "name:en"],
          ["get", "name:latin"],
          ["get", "name"],
        ];
    }
    if (layer.type === "fill" && /water/.test(layer.id)) {
      layer.paint = { ...layer.paint, "fill-color": "#0b1924" };
    }
    return layer;
  });
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
function graticule(): FeatureCollection {
  const lines: GeoJSON.Feature<Geometry>[] = [];
  for (let lon = -180; lon < 180; lon += 30)
    lines.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: Array.from({ length: 31 }, (_, i) => [lon, -75 + i * 5]),
      },
    });
  for (let lat = -60; lat <= 75; lat += 30)
    lines.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]),
      },
    });
  return { type: "FeatureCollection", features: lines };
}
const style: StyleSpecification = {
  version: 8,
  glyphs: "/api/v1/map/fonts/{fontstack}/{range}.pbf",
  sources: {
    world: { type: "geojson", data: "/world-lowres.geojson" },
    grid: { type: "geojson", data: graticule() },
    basemap: {
      type: "vector",
      tiles: [`${window.location.origin}/api/v1/map/tiles/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 14,
      attribution:
        '<a href="https://openfreemap.org">OpenFreeMap</a> · © OpenMapTiles · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
    },
    satellite: {
      type: "raster",
      tiles: [`${window.location.origin}/api/v1/tiles/satellite/{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 9,
      attribution: "NASA GIBS / MODIS · imagery from 2 days ago",
    },
    events: {
      type: "geojson",
      data: EMPTY,
      cluster: true,
      clusterMaxZoom: 5,
      clusterRadius: 28,
      clusterMinPoints: 5,
    },
    selected: { type: "geojson", data: EMPTY },
    focused: { type: "geojson", data: EMPTY },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0b1620" },
    },
    {
      id: "land",
      type: "fill",
      source: "world",
      paint: { "fill-color": "#1b2933", "fill-opacity": 1 },
    },
    {
      id: "borders",
      type: "line",
      source: "world",
      paint: {
        "line-color": "#35444e",
        "line-width": 0.6,
        "line-opacity": 0.5,
      },
    },
    ...baseLayers,
    {
      id: "satellite-map",
      type: "raster",
      source: "satellite",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.8 },
    },
    {
      id: "grid-lines",
      type: "line",
      source: "grid",
      paint: {
        "line-color": "#668193",
        "line-width": 0.5,
        "line-opacity": 0.12,
        "line-dasharray": [2, 6],
      },
    },
    {
      id: "cluster-glow",
      type: "circle",
      source: "events",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#86dcbf",
        "circle-opacity": 0.05,
        "circle-radius": ["step", ["get", "point_count"], 22, 50, 28, 200, 35],
      },
    },
    {
      id: "clusters",
      type: "circle",
      source: "events",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#213c3c",
        "circle-radius": ["step", ["get", "point_count"], 12, 50, 16, 200, 20],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#82c1ad",
        "circle-stroke-opacity": 0.7,
      },
    },
    {
      id: "cluster-label",
      type: "symbol",
      source: "events",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#c9ebdf" },
    },
    {
      id: "event-glow",
      type: "circle",
      source: "events",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["+", 6, ["*", 1.1, ["get", "size"]]],
        "circle-opacity": 0.09,
      },
    },
    {
      id: "event-points",
      type: "circle",
      source: "events",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["get", "size"],
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-opacity": 0.25,
      },
    },
    {
      id: "selected-ring",
      type: "circle",
      source: "selected",
      paint: {
        "circle-radius": 22,
        "circle-color": "#8fe8c3",
        "circle-opacity": 0.055,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#8fe8c3",
        "circle-stroke-opacity": 0.3,
      },
    },
    {
      id: "selected-dot",
      type: "circle",
      source: "selected",
      paint: {
        "circle-radius": 5,
        "circle-color": "#c0ffdf",
        "circle-stroke-color": "#0c2420",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "focus",
      type: "circle",
      source: "focused",
      paint: {
        "circle-radius": 15,
        "circle-color": "transparent",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    },
  ],
};
export interface MapPreset {
  center: [number, number];
  zoom: number;
  id: number;
}
export function MapView({
  events,
  place,
  focus,
  preset,
  onPoint,
  onEvent,
  onArea,
  onMessage,
}: {
  events: AtlasEvent[];
  place: Place;
  focus: AtlasEvent | null;
  preset: MapPreset | null;
  onPoint: (lat: number, lon: number) => void;
  onEvent: (e: AtlasEvent) => void;
  onArea: (p: GeoPolygon) => void;
  onMessage: (s: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const eventsRef = useRef(events);
  const actions = useRef({ onPoint, onEvent, onArea, onMessage });
  const [baseWarning, setBaseWarning] = useState("");
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [base, setBase] = useState<"dark" | "satellite">("dark");
  const [globe, setGlobe] = useState(false);
  const [coords, setCoords] = useState<[number, number]>([25, 22]);
  eventsRef.current = events;
  actions.current = { onPoint, onEvent, onArea, onMessage };
  useEffect(() => {
    if (!root.current) return;
    let map: LibreMap;
    try {
      map = new maplibregl.Map({
        transformRequest: (url) => ({
          url,
          headers:
            url.startsWith(window.location.origin + "/api/") ||
            url.startsWith("/api/")
              ? deploymentHeaders()
              : {},
        }),
        container: root.current,
        style,
        center: [28, 20],
        zoom: 1.7,
        minZoom: 0.7,
        maxZoom: 15,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        pitchWithRotate: false,
      });
      mapRef.current = map;
    } catch {
      setMapError(
        "WebGL is unavailable. Intelligence panels and data exports remain accessible.",
      );
      return;
    }
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.on("load", () => setReady(true));
    map.on("error", (e) => {
      if (e.error?.message?.toLowerCase().includes("worker"))
        setMapError(
          "Map worker unavailable. Use the feed, location report and exports.",
        );
      else
        setBaseWarning(
          "Some map resources are unavailable. Source reports remain accessible.",
        );
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      setCoords([c.lng, c.lat]);
    });
    map.on("click", async (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["clusters", "event-points"],
      });
      if (features.length) {
        const p = features[0].properties;
        if (p?.cluster) {
          const src = map.getSource("events") as GeoJSONSource;
          try {
            const zoom = await src.getClusterExpansionZoom(
              Number(p.cluster_id),
            );
            const g = features[0].geometry as GeoJSON.Point;
            map.easeTo({
              center: g.coordinates as [number, number],
              zoom: Math.min(9, zoom + 0.2),
            });
          } catch {
            /* map removed */
          }
          return;
        }
        const found = eventsRef.current.find((x) => x.id === p?.id);
        if (found) actions.current.onEvent(found);
        return;
      }
      actions.current.onPoint(
        Number(e.lngLat.lat.toFixed(4)),
        Number((((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180).toFixed(4)),
      );
    });
    for (const id of ["clusters", "event-points"]) {
      map.on("mouseenter", id, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", id, () => {
        map.getCanvas().style.cursor = "crosshair";
      });
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const features = events
      .filter((e) => e.point)
      .map((e) => ({
        type: "Feature" as const,
        id: e.id,
        geometry: {
          type: "Point" as const,
          coordinates: [e.point!.lon, e.point!.lat],
        },
        properties: {
          id: e.id,
          color: COLORS[e.kind],
          size:
            e.kind === "earthquake"
              ? Math.min(8, Math.max(2.4, (e.attributes.magnitude ?? 3) * 0.85))
              : e.kind === "satellite"
                ? 5
                : e.kind === "fire"
                  ? 2.2
                  : 3.5,
          rank: severityRank[e.severity] ?? 0,
        },
      }));
    (map.getSource("events") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }, [events, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("selected") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [place.lon, place.lat] },
        },
      ],
    });
  }, [place, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("focused") as GeoJSONSource).setData(
      focus?.point
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Point",
                  coordinates: [focus.point.lon, focus.point.lat],
                },
              },
            ],
          }
        : EMPTY,
    );
    if (focus?.point)
      map.easeTo({
        center: [focus.point.lon, focus.point.lat],
        zoom: Math.max(map.getZoom(), 3.5),
        duration: 900,
      });
  }, [focus, ready]);
  useEffect(() => {
    if (preset && ready)
      mapRef.current?.flyTo({
        center: preset.center,
        zoom: preset.zoom,
        duration: 1400,
      });
  }, [preset, ready]);
  function toggleBase() {
    const next = base === "dark" ? "satellite" : "dark";
    setBase(next);
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty(
      "satellite-map",
      "visibility",
      next === "satellite" ? "visible" : "none",
    );
    if (next === "satellite")
      onMessage(
        "NASA MODIS imagery · 2-day lag · clouds and gaps are expected. Not a live camera.",
      );
  }
  function toggleGlobe() {
    const next = !globe;
    setGlobe(next);
    mapRef.current?.setProjection({ type: next ? "globe" : "mercator" });
  }
  function analyzeView() {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    if (b.getEast() - b.getWest() >= 179) {
      onMessage(
        "Zoom into a region before area analysis (less than 180° wide).",
      );
      return;
    }
    const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
    const w = wrap(b.getWest()),
      e = wrap(b.getEast()),
      s = Math.max(-85, b.getSouth()),
      n = Math.min(85, b.getNorth());
    onArea({
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    });
  }
  return (
    <div className="map-stage" data-map-ready={ready}>
      <div className="map-canvas" ref={root} />
      {mapError && (
        <div className="map-fallback">
          <Globe2 size={64} />
          <h3>Map rendering unavailable</h3>
          <p>{mapError}</p>
        </div>
      )}
      {baseWarning && !mapError && (
        <div className="map-resource-warning" role="status">
          {baseWarning}
        </div>
      )}
      <div className="map-top-label">
        <span className="cross-mark">+</span>
        <div>
          GLOBAL OBSERVATION NETWORK
          <small>Public sources. One connected perspective.</small>
        </div>
      </div>
      <div className="map-location-tag">
        <span className="live-dot" />
        SELECTED AREA <b>{place.name}</b>
      </div>
      <div className="map-controls">
        <IconButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={17} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={17} />
        </IconButton>
        <span className="control-divider" />
        <IconButton
          label="Fly to selected location"
          onClick={() =>
            mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 7 })
          }
        >
          <LocateFixed size={17} />
        </IconButton>
        <IconButton
          label="Toggle 3D globe"
          active={globe}
          onClick={toggleGlobe}
        >
          <Globe2 size={17} />
        </IconButton>
        <IconButton
          label="Reset bearing"
          onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0 })}
        >
          <Compass size={17} />
        </IconButton>
        <IconButton label="Analyze visible area" onClick={analyzeView}>
          <SquareDashedMousePointer size={17} />
        </IconButton>
      </div>
      <div className="map-bottom-tools">
        <div className="map-legend">
          <span>
            <i style={{ background: COLORS.earthquake }} />
            Seismic
          </span>
          <span>
            <i style={{ background: COLORS.fire }} />
            Thermal
          </span>
          <span>
            <i style={{ background: COLORS.weather }} />
            Weather
          </span>
          <span>
            <i className="cluster-legend" />
            Grouped
          </span>
        </div>
        <div className="basemap-buttons">
          <button onClick={toggleBase}>
            <Layers3 size={13} />
            {base === "dark" ? "Vector dark" : "NASA imagery"}
          </button>
          <IconButton
            label="Global extent"
            onClick={() =>
              mapRef.current?.flyTo({
                center: [28, 20],
                zoom: 1.7,
                pitch: 0,
                bearing: 0,
              })
            }
          >
            <Maximize2 size={14} />
          </IconButton>
        </div>
      </div>
      <div className="map-coordinate">
        <Scan size={11} />
        {num(Math.abs(coords[1]), 3)}° {coords[1] >= 0 ? "N" : "S"}{" "}
        <span>/</span>
        {num(Math.abs(coords[0]), 3)}° {coords[0] >= 0 ? "E" : "W"}{" "}
        <span>·</span> CLICK TO ANALYZE
      </div>
    </div>
  );
}
