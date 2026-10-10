import { useEffect, useMemo, useState } from "react";
import { Play, Pause, Radio, History } from "lucide-react";
import type { AtlasEvent } from "../types";
import { histogram } from "../utils";
export function Timeline({
  events,
  hours,
  onHours,
  end,
  onEnd,
}: {
  events: AtlasEvent[];
  hours: number;
  onHours: (n: number) => void;
  end: number | null;
  onEnd: (n: number | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(100);
  const bins = useMemo(() => histogram(events, hours, 56), [events, hours]);
  const peak = Math.max(1, ...bins);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(
      () => setCursor((v) => Math.min(100, v + 2)),
      380,
    );
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => {
    if (playing) {
      onEnd(
        cursor >= 100
          ? null
          : Date.now() - hours * 3600000 * (1 - cursor / 100),
      );
      if (cursor >= 100) setPlaying(false);
    }
  }, [cursor, playing, hours, onEnd]);
  return (
    <section className="timeline">
      <div className="timeline-heading">
        <span className="small-label">
          <History size={12} />
          OBSERVATION WINDOW
        </span>
        <div className="time-presets">
          {[
            [24, "24H"],
            [72, "72H"],
            [168, "7D"],
          ].map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                onHours(Number(v));
                onEnd(null);
                setCursor(100);
                setPlaying(false);
              }}
              className={hours === v ? "active" : ""}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`live-timeline ${end ? "paused" : ""}`}
          onClick={() => {
            onEnd(null);
            setCursor(100);
            setPlaying(false);
          }}
        >
          <Radio size={12} />
          {end ? "RETURN TO LIVE" : "LIVE"}
        </button>
      </div>
      <div className="timeline-track">
        <button
          className="play-button"
          title="Replay published event timestamps (not archived snapshots)"
          aria-label={playing ? "Pause timeline" : "Replay event timestamps"}
          onClick={() => {
            if (!playing && cursor >= 100) setCursor(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="histogram-wrapper">
          <div className="histogram">
            {bins.map((v, i) => (
              <div
                key={i}
                className={`${end && i / 56 > cursor / 100 ? "future" : ""} ${v === 0 ? "zero" : ""}`}
                style={{ height: `${Math.max(3, (v / peak) * 100)}%` }}
                title={`${v} published hazard records in this interval`}
              />
            ))}
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={end ? cursor : 100}
            aria-label="Inspect event-time cutoff"
            onChange={(e) => {
              const v = Number(e.target.value);
              setCursor(v);
              setPlaying(false);
              onEnd(
                v >= 100 ? null : Date.now() - hours * 3600000 * (1 - v / 100),
              );
            }}
          />
          <div className="time-labels">
            <span>{hours === 168 ? "7 days" : hours + " hours"} ago</span>
            <span>Provider event times · not a historical data replay</span>
            <span>
              {end
                ? new Date(end).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  }) + " UTC"
                : "Now"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
