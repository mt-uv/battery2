"use client"

export default function AllAtomMSDChart({
  timePs,
  msdBySpecies,
  live,
}: {
  timePs: number[]
  msdBySpecies: Record<string, number[]>
  live: boolean
}) {
  const width = 720
  const height = 320
  const padL = 56
  const padR = 18
  const padT = 18
  const padB = 42

  const species = Object.keys(msdBySpecies)

  const n = Math.min(
    timePs.length,
    ...species.map((sp) => msdBySpecies[sp]?.length ?? 0),
    Number.MAX_SAFE_INTEGER
  )

  const xs = timePs.slice(0, n)

  const maxX = Math.max(...xs, 1)

  const allY = species.flatMap((sp) => msdBySpecies[sp].slice(0, n))
  const maxY = Math.max(...allY, 1e-6)

  const xScale = (x: number) => padL + (x / maxX) * (width - padL - padR)
  const yScale = (y: number) => height - padB - (y / maxY) * (height - padT - padB)

  const palette = [
    "#818cf8",
    "#34d399",
    "#f472b6",
    "#f59e0b",
    "#38bdf8",
    "#fb7185",
    "#a78bfa",
    "#2dd4bf",
  ]

  const xTicks = 5
  const yTicks = 5

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-slate-200">Live species-resolved MSD vs time</div>
        <div className="text-xs text-slate-400">{live ? "Streaming…" : "Complete"}</div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const val = (maxX * i) / xTicks
          const x = xScale(val)
          return (
            <g key={`x-${i}`}>
              <line
                x1={x}
                y1={padT}
                x2={x}
                y2={height - padB}
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="1"
              />
              <text
                x={x}
                y={height - padB + 18}
                textAnchor="middle"
                fontSize="11"
                fill="#94a3b8"
              >
                {val.toFixed(2)}
              </text>
            </g>
          )
        })}

        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const val = (maxY * i) / yTicks
          const y = yScale(val)
          return (
            <g key={`y-${i}`}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#94a3b8"
              >
                {val.toFixed(2)}
              </text>
            </g>
          )
        })}

        <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="#64748b" strokeWidth="1.5" />
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="#64748b" strokeWidth="1.5" />

        {species.map((sp, idx) => {
          const ys = msdBySpecies[sp].slice(0, n)
          const path =
            ys.length > 0
              ? ys
                  .map((y, i) => `${i === 0 ? "M" : "L"} ${xScale(xs[i]).toFixed(2)} ${yScale(y).toFixed(2)}`)
                  .join(" ")
              : ""

          const lastX = xs.length ? xScale(xs[xs.length - 1]) : xScale(0)
          const lastY = ys.length ? yScale(ys[ys.length - 1]) : yScale(0)
          const color = palette[idx % palette.length]

          return (
            <g key={sp}>
              {ys.length > 0 && (
                <>
                  <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
                  <circle
                    cx={lastX}
                    cy={lastY}
                    r={live ? 5 : 4}
                    fill={color}
                    className={live ? "animate-pulse" : ""}
                  />
                </>
              )}
            </g>
          )
        })}

        <text
          x={(padL + width - padR) / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize="12"
          fill="#cbd5e1"
        >
          Time (ps)
        </text>

        <text
          x="16"
          y={(padT + height - padB) / 2}
          transform={`rotate(-90 16 ${(padT + height - padB) / 2})`}
          textAnchor="middle"
          fontSize="12"
          fill="#cbd5e1"
        >
          MSD (Å²)
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
        {species.map((sp, idx) => {
          const color = palette[idx % palette.length]
          return (
            <div key={sp} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span>{sp}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}