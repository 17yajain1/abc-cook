/** Home tab. Built up over the H1 commits; this first version is the wordmark and the
 * entry into the existing import flow. */
export function HomeScreen({ onImport }: { onImport: () => void }) {
  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-16">
      <h1 className="text-[24px] font-bold leading-none tracking-[-0.4px] text-home-ink">ABC Cook</h1>
      <button
        type="button"
        onClick={onImport}
        className="mt-6 rounded-full bg-home-terracotta px-6 py-3 text-[15px] font-semibold text-home-ground"
      >
        Paste a link
      </button>
    </div>
  )
}
