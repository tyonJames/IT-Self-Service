"use client";

import { useEffect, useRef } from "react";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

/**
 * Chart.js wrappers (instruction §14).
 *
 * Chart.js rather than a React charting library: it is small, has no React
 * version coupling, and only the canvas needs to be a Client Component.
 *
 * Accessibility: a canvas is opaque to a screen reader, so every chart is
 * paired with a visually-hidden data table carrying the same numbers
 * (instruction §29). The chart is the illustration; the table is the content.
 */

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

Chart.defaults.font.family =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
Chart.defaults.color = "#5a6069";
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation = { duration: 300 };

export interface ChartDatum {
  key: string;
  label: string;
  count: number;
  colour?: string;
}

function DataTable({ caption, rows }: { caption: string; rows: ChartDatum[] }) {
  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PALETTE = ["#2d7a45", "#d4a017", "#1a73e8", "#e85d1a", "#6f42c1", "#20c997", "#dc3545", "#6c757d"];

export function DoughnutChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const chart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            data: data.map((d) => d.count),
            backgroundColor: data.map((d, i) => d.colour ?? PALETTE[i % PALETTE.length]!),
            borderColor: "#fff",
            borderWidth: 2,
          },
        ],
      },
      options: {
        cutout: "58%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = data.reduce((sum, d) => sum + d.count, 0);
                const value = ctx.parsed;
                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                return ` ${ctx.label}: ${value} (${pct}%)`;
              },
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [data]);

  if (data.length === 0) {
    return <p className="text-secondary small text-center py-4 mb-0">No data for this period.</p>;
  }

  return (
    <>
      <div className="chart-frame">
        <canvas ref={canvasRef} role="img" aria-label={`${title}. The same figures follow as a table.`} />
      </div>
      <DataTable caption={title} rows={data} />
    </>
  );
}

export function BarChart({
  title,
  data,
  horizontal = false,
}: {
  title: string;
  data: ChartDatum[];
  horizontal?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            label: title,
            data: data.map((d) => d.count),
            backgroundColor: data.map((d, i) => d.colour ?? PALETTE[i % PALETTE.length]!),
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: horizontal }, ticks: { precision: 0 } },
          y: { grid: { display: !horizontal }, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });

    return () => chart.destroy();
  }, [data, title, horizontal]);

  if (data.length === 0) {
    return <p className="text-secondary small text-center py-4 mb-0">No data for this period.</p>;
  }

  return (
    <>
      <div className="chart-frame">
        <canvas ref={canvasRef} role="img" aria-label={`${title}. The same figures follow as a table.`} />
      </div>
      <DataTable caption={title} rows={data} />
    </>
  );
}

export interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
}

export function TrendChart({ title, points }: { title: string; points: TrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => p.date.slice(5)),
        datasets: [
          {
            label: "Raised",
            data: points.map((p) => p.created),
            borderColor: "#2d7a45",
            backgroundColor: "rgba(45,122,69,0.12)",
            fill: true,
            tension: 0.3,
            pointRadius: points.length > 45 ? 0 : 2,
          },
          {
            label: "Resolved",
            data: points.map((p) => p.resolved),
            borderColor: "#1a73e8",
            backgroundColor: "rgba(26,115,232,0.10)",
            fill: true,
            tension: 0.3,
            pointRadius: points.length > 45 ? 0 : 2,
          },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });

    return () => chart.destroy();
  }, [points]);

  if (points.length === 0) {
    return <p className="text-secondary small text-center py-4 mb-0">No data for this period.</p>;
  }

  return (
    <>
      <div className="chart-frame">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${title}. The same figures follow as a table.`}
        />
      </div>
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Raised</th>
            <th scope="col">Resolved</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>{p.created}</td>
              <td>{p.resolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
