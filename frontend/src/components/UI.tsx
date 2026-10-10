import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X, LoaderCircle, ArrowUpRight, Info } from "lucide-react";
import type { Health } from "../types";
export function IconButton({
  label,
  children,
  onClick,
  active,
  className = "",
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`icon-button ${active ? "active" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
export function Status({ status }: { status: Health }) {
  const labels: Record<Health, string> = {
    fresh: "Available",
    stale: "Stale cache",
    empty: "No records",
    unavailable: "Unavailable",
    disabled: "Needs key",
    idle: "On demand",
    refreshing: "Connecting",
  };
  return (
    <span className={`status status-${status}`}>
      <i />
      {labels[status]}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={id}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">ATLAS WORKSPACE</span>
          <h2 id={id}>{title}</h2>
        </div>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Spinner({
  label = "Fetching source data…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-line">
      <LoaderCircle size={16} className="spin" />
      {label}
    </div>
  );
}
export function Note({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`note note-${tone}`}>
      <Info size={15} />
      <div>{children}</div>
    </div>
  );
}
export function ExternalLink({
  url,
  children,
  className = "",
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  if (!/^https?:\/\//.test(url))
    return <span className={className}>{children}</span>;
  return (
    <a
      className={`external ${className}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}
export function Sparkline({
  values,
  color = "#88dfbe",
  height = 52,
  filled = true,
}: {
  values: (number | null)[];
  color?: string;
  height?: number;
  filled?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (valid.length < 2)
    return (
      <div className="empty-chart" style={{ height }}>
        No usable series
      </div>
    );
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = Math.max(1, max - min);
  const points = values.map((v, i) =>
    v === null || !Number.isFinite(v)
      ? null
      : [
          (i / Math.max(1, values.length - 1)) * 300,
          height - 8 - ((v - min) / range) * (height - 18),
        ],
  );
  const paths: string[] = [];
  let current = "";
  for (const p of points) {
    if (!p) {
      if (current) paths.push(current);
      current = "";
    } else
      current += `${current ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)} `;
  }
  if (current) paths.push(current);
  return (
    <svg
      viewBox={`0 0 300 ${height}`}
      className="sparkline"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Series ranges from ${min.toFixed(1)} to ${max.toFixed(1)}`}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity=".17" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled && paths.length === 1 && (
        <path
          d={`${paths[0]}L300,${height} L0,${height}Z`}
          fill={`url(#g${id})`}
        />
      )}
      <path d={`M0 ${height - 5}H300`} stroke="#24323c" strokeDasharray="3 5" />
      {paths.map((p, i) => (
        <path
          key={i}
          d={p}
          stroke={color}
          strokeWidth="1.8"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
