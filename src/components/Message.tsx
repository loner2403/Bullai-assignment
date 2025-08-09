"use client";
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChartSpec = {
  type?: "line" | "bar" | "scatter" | "pie";
  labels: string[];
  series: { name: string; values: number[]; color?: string }[];
  unit?: string;
  stacked?: boolean;
};

interface MessageProps {
  role: "user" | "assistant";
  content: string;
  chartSpec?: ChartSpec | null;
  sources?: Array<{ id?: string; source?: string; title?: string; company?: string }>;
}

function Chart({ spec }: { spec: ChartSpec }) {
  // Responsive sizing based on container width
  const containerRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number>(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width || el.clientWidth;
      setW(cw);
    });
    ro.observe(el);
    // Initialize
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const width = Math.max(280, w || 0);
  const height = Math.max(220, Math.round(width * 0.6)); // 3:5 aspect-ish
  const isSmall = width < 400;
  const m = isSmall
    ? { top: 28, right: 12, bottom: 42, left: 56 }
    : { top: 40, right: 20, bottom: 50, left: 80 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6"];

  const xs = spec.labels.length;
  const isPie = spec.type === "pie";
  const isStacked = spec.type === "bar" && spec.stacked;
  const allVals = spec.series.flatMap((s) => s.values);
  let ymin = Math.min(...allVals);
  let ymax = Math.max(...allVals);

  const makeTicks = (min: number, max: number, count: number) => {
    const range = max - min;
    const step = range / (count - 1);
    const arr: number[] = [];
    for (let i = 0; i < count; i++) {
      arr.push(min + i * step);
    }
    return arr;
  };

  const yTicks = isPie ? [] : makeTicks(ymin, ymax, 5);
  if (!isPie) {
    ymin = yTicks[0];
    ymax = yTicks[yTicks.length - 1];
  }

  const xFor = (i: number) => (xs <= 1 ? iw / 2 : (i * iw) / (xs - 1));
  const yFor = (v: number) => ih - ((v - ymin) / (ymax - ymin)) * ih;

  const bar = spec.type === "bar";
  const groupW = xs > 0 ? iw / xs : iw;
  const barGap = isSmall ? 10 : 14;
  const barW = bar && !isStacked ? Math.max(6, (groupW - barGap * 2) / Math.max(1, spec.series.length)) : Math.max(12, groupW - barGap * 2);
  const groupLeft = (i: number) => i * groupW;

  const fmtNum = (n: number) => {
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + "K";
    return n.toFixed(1);
  };

  const rotateX = width < 380 || spec.labels.some(l => l.length > 8);

  return (
    <div ref={containerRef} className="w-full bg-white/5 rounded-lg px-2 sm:px-4 py-3 sm:py-4 border border-white/10">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="bg-transparent">
        <g transform={`translate(${m.left},${m.top})`}>
          {/* Legend */}
          <g transform={`translate(0, -12)`}>
            {isPie
              ? spec.labels.map((lab, i) => (
                  <g key={i} transform={`translate(${i * 120}, 0)`}>
                    <rect width={12} height={12} rx={2} fill={colors[i % colors.length]} />
                    <text x={16} y={10} className="fill-gray-700 dark:fill-gray-300 text-[11px] font-medium">{lab}</text>
                  </g>
                ))
              : spec.series.map((s, si) => (
                  <g key={si} transform={`translate(${si * 120}, 0)`}>
                    <rect width={12} height={12} rx={2} fill={s.color || colors[si % colors.length]} />
                    <text x={16} y={10} className="fill-gray-700 dark:fill-gray-300 text-[11px] font-medium">{s.name}</text>
                  </g>
                ))}
          </g>

          {/* Grid and axes for non-pie charts */}
          {!isPie && (
            <>
              {yTicks.map((t, i) => (
                <g key={i}>
                  <line x1={0} y1={yFor(t)} x2={iw} y2={yFor(t)} stroke="currentColor" strokeWidth={1} className="text-gray-200 dark:text-gray-600" />
                  <text x={-10} y={yFor(t)} textAnchor="end" alignmentBaseline="middle" className="fill-gray-500 dark:fill-gray-400 text-[11px]">
                    {fmtNum(t)} {i === yTicks.length - 1 && spec.unit ? spec.unit : ""}
                  </text>
                </g>
              ))}
              <line x1={0} y1={0} x2={0} y2={ih} stroke="currentColor" strokeWidth={1} className="text-gray-300 dark:text-gray-600" />
              <line x1={0} y1={yFor(0)} x2={iw} y2={yFor(0)} stroke="currentColor" strokeWidth={1} className="text-gray-300 dark:text-gray-600" />
            </>
          )}

          {/* X labels for non-pie charts */}
          {!isPie && spec.labels.map((lab, i) => (
            <g key={i} transform={`translate(${(bar ? groupLeft(i) + groupW / 2 : xFor(i))}, ${ih + 18})`}>
              <text
                transform={rotateX ? "rotate(-20)" : undefined}
                textAnchor={rotateX ? "end" : "middle"}
                className="fill-gray-700 dark:fill-gray-300 text-[11px]"
              >
                {lab}
              </text>
            </g>
          ))}

          {/* Series rendering */}
          {!isPie && spec.series.map((s, si) => {
            const color = s.color || colors[si % colors.length];
            if (bar && !isStacked) {
              return (
                <g key={si}>
                  {s.values.map((v, i) => {
                    const left = groupLeft(i) + barGap;
                    const x = left + si * barW;
                    const y0 = yFor(Math.min(0, v));
                    const y1 = yFor(Math.max(0, v));
                    const y = Math.min(y0, y1);
                    const h = Math.max(2, Math.abs(y1 - y0));
                    return (
                      <rect key={i} x={x} y={y} width={barW - 3} height={h} fill={color} opacity={0.9} rx={3} />
                    );
                  })}
                </g>
              );
            }
            // Line/scatter
            const pts = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
            return (
              <g key={si}>
                <polyline fill="none" stroke={color} strokeWidth={2.25} points={pts} />
                {s.values.map((v, i) => (
                  <circle key={i} cx={xFor(i)} cy={yFor(v)} r={3} fill={color} />
                ))}
              </g>
            );
          })}

          {/* Pie chart */}
          {isPie && (() => {
            const series0 = spec.series[0];
            const vals = series0?.values || [];
            const total = vals.reduce((acc: number, v: number) => acc + (Number.isFinite(v) ? v : 0), 0);
            const cx = iw / 2;
            const cy = ih / 2;
            const outer = Math.min(iw, ih) / 2 - 4;
            let angle = -Math.PI / 2;
            const slices: React.ReactElement[] = [];
            vals.forEach((v, i) => {
              const frac = total > 0 ? Math.max(0, v) / total : 0;
              const theta = frac * Math.PI * 2;
              const x0 = cx + outer * Math.cos(angle);
              const y0 = cy + outer * Math.sin(angle);
              const x1 = cx + outer * Math.cos(angle + theta);
              const y1 = cy + outer * Math.sin(angle + theta);
              const large = theta > Math.PI ? 1 : 0;
              const path = `M ${cx} ${cy} L ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} Z`;
              slices.push(<path key={i} d={path} fill={colors[i % colors.length]} opacity={0.95} />);
              const mid = angle + theta / 2;
              const lx = cx + (outer * 0.7) * Math.cos(mid);
              const ly = cy + (outer * 0.7) * Math.sin(mid);
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              slices.push(
                <text key={`t${i}`} x={lx} y={ly} textAnchor="middle" className="fill-gray-800 dark:fill-gray-200 text-[11px] font-medium">
                  {pct}%
                </text>
              );
              angle += theta;
            });
            return <g>{slices}</g>;
          })()}
        </g>
      </svg>
    </div>
  );
}

export function Message({ role, content, chartSpec, sources }: MessageProps) {
  return (
    <div className={`group w-full ${role === "assistant" ? "bg-[#2f2f2f]" : "bg-[#212121]"}`}>
      <div className="max-w-3xl mx-auto px-2 sm:px-4 py-6">
        <div className="flex gap-4">
          {/* Avatar */}
          <div className={`flex-shrink-0 ${role === "assistant" ? "hidden sm:block" : ""}`}>
            {role === "user" ? (
              <div className="w-8 h-8 bg-[#19c37d] rounded-full flex items-center justify-center text-white text-sm font-medium">
                U
              </div>
            ) : (
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-sm flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
            )}
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="prose prose-sm prose-invert max-w-[75ch] sm:max-w-none mx-auto break-words prose-a:text-emerald-400 prose-strong:text-white prose-headings:text-white">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                  table: (props: any) => (
                    <div className="overflow-x-auto">
                      <table {...props} />
                    </div>
                  ),
                  code: (props: any) => {
                    const { className, children, ...rest } = props || {};
                    return (
                      <code className={`${className || ''} bg-white/10 px-1.5 py-0.5 rounded`} {...rest}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </div>

            {/* Chart */}
            {chartSpec && (
              <div className="mt-4">
                <Chart spec={chartSpec} />
              </div>
            )}

            {/* Sources */}
            {sources && sources.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-xs text-white/50 font-medium mb-2">Sources:</div>
                <div className="space-y-1">
                  {sources.map((source, i) => (
                    <div key={i} className="text-xs text-white/70">
                      <span className="font-medium text-white/90">[S{i + 1}]</span> {source.title || source.source}
                      {source.company && <span className="text-white/50"> • {source.company}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
