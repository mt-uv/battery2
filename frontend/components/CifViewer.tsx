"use client"

import { useEffect, useId, useMemo, useState } from "react"

declare global {
  interface Window {
    $3Dmol: any
  }
}

async function load3DMolLocal(): Promise<void> {
  if (typeof window === "undefined") return
  if (window.$3Dmol) return

  // If script exists but didn't initialize, remove it and re-add
  const existing = document.querySelector<HTMLScriptElement>('script[data-3dmol="1"]')
  if (existing) existing.remove()

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "/3Dmol-min.js"
    s.async = true
    s.dataset["3dmol"] = "1"
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load script: ${s.src}`))
    document.head.appendChild(s)
  })

  if (!window.$3Dmol) {
    throw new Error("3Dmol script loaded but window.$3Dmol is undefined")
  }
}

export default function CifViewer({ cif }: { cif: string }) {
  const reactId = useId()
  const containerId = useMemo(() => `cif-viewer-${reactId.replace(/:/g, "")}`, [reactId])

  const [err, setErr] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle")

  useEffect(() => {
    let cancelled = false

    const render = async () => {
      setErr("")
      if (!cif?.trim()) {
        setStatus("idle")
        return
      }

      setStatus("loading")
      await load3DMolLocal()
      if (cancelled) return

      const el = document.getElementById(containerId)
      if (!el) throw new Error("Viewer container not found")

      el.innerHTML = ""
      el.style.position = "relative"
      el.style.width = "100%"
      el.style.height = "380px"
      el.style.overflow = "hidden"

      const viewer = window.$3Dmol.createViewer(containerId, { backgroundColor: "#070a12" })
      viewer.addModel(cif, "cif")
      viewer.setStyle({}, { stick: {}, sphere: { scale: 0.28 } })
      viewer.zoomTo()
      viewer.render()

      // clamp internal nodes
      const nodes = el.querySelectorAll("canvas, div")
      nodes.forEach((node) => {
        const n = node as HTMLElement
        n.style.position = "absolute"
        n.style.inset = "0"
      })

      setStatus("ready")
    }

    render().catch((e) => {
      console.error(e)
      setErr(String(e?.message || "3D viewer failed to load."))
      setStatus("idle")
    })

    return () => {
      cancelled = true
    }
  }, [cif, containerId])

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-200">Structure preview</div>
        <div className="text-xs text-slate-400">
          {status === "ready" ? "Interactive 3D" : status === "loading" ? "Loading viewer…" : "CIF → 3D"}
        </div>
      </div>

      {err ? (
        <div className="p-4 text-sm text-rose-300">{err}</div>
      ) : (
        <div className="p-4">
          <div
            id={containerId}
            className="relative h-[380px] w-full overflow-hidden rounded-xl border border-slate-700 bg-[#070a12]"
          />
        </div>
      )}
    </div>
  )
}