"use client"

import { useState } from "react"
import CathodeExplorer from "../components/CathodeExplorer"
import RelaxStructure from "../components/RelaxStructure"
import GenericMD from "../components/GenericMD"

function TopTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-4 py-2 rounded-xl bg-indigo-600 text-white"
          : "px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500"
      }
    >
      {label}
    </button>
  )
}

export default function Page() {
  const [tab, setTab] = useState<"cathode" | "relax" | "md">("cathode")

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-800 text-white p-6 flex justify-center">
      <div className="w-full max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold">Na-ion Materials ML Platform</h1>
          <p className="mt-2 text-slate-400">
            Cathode explorer, uploaded-structure relaxation, and generic MD in one interface.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <TopTab active={tab === "cathode"} label="Cathode Explorer" onClick={() => setTab("cathode")} />
          <TopTab active={tab === "relax"} label="Relax Structure" onClick={() => setTab("relax")} />
          <TopTab active={tab === "md"} label="Run Generic MD" onClick={() => setTab("md")} />
        </div>

        {tab === "cathode" && <CathodeExplorer />}
        {tab === "relax" && <RelaxStructure />}
        {tab === "md" && <GenericMD />}
      </div>
    </div>
  )
}