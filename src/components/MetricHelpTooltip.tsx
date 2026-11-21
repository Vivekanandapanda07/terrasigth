import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface MetricHelpTooltipProps {
  title: string;
  explanation: string;
  budgetImpact: string;
}

export function MetricHelpTooltip({
  title,
  explanation,
  budgetImpact,
}: MetricHelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex items-center align-middle print:hidden"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Explain ${title}`}
        aria-expanded={open}
        className="inline-flex items-center justify-center p-0.5 text-slate-400 hover:text-[#0f2557] focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-500 rounded"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute left-0 bottom-full mb-2 z-50 w-64 sm:w-72 p-3 bg-white border-2 border-[#0f2557] rounded shadow-xl text-left font-sans font-normal normal-case tracking-normal"
        >
          <div className="text-xs font-display font-bold text-[#0f2557]">{title}</div>
          <p className="text-[11px] text-slate-600 leading-relaxed mt-1">{explanation}</p>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-[#1a2e05] bg-lime-50 p-2 rounded">
            <strong className="text-[#0f2557]">Why it matters for budget:</strong> {budgetImpact}
          </div>
        </div>
      )}
    </span>
  );
}
