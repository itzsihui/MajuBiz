import { motion } from "framer-motion";
import { useId } from "react";

const BEAM_PATHS = [
  "M-380 -189C-380 -189 -312 216 152 343C616 470 684 875 684 875",
  "M-373 -197C-373 -197 -305 208 159 335C623 462 691 867 691 867",
  "M-364 -204C-364 -204 -296 201 168 328C632 455 700 860 700 860",
];

/** Ambient beam paths — inspired by [Aceternity Background Beams](https://ui.aceternity.com/components/background-beams) */
export function BackgroundBeams({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <svg
        className="absolute left-1/2 top-0 h-[min(120%,40rem)] w-[140%] -translate-x-1/2 opacity-40"
        viewBox="0 0 960 540"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient id={`beam-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
            <stop offset="50%" stopColor="#818cf8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
        </defs>
        {BEAM_PATHS.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            stroke={`url(#beam-grad-${id})`}
            strokeWidth={1.2}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: [0.2, 0.6, 0.2] }}
            transition={{
              pathLength: { duration: 2.5, delay: i * 0.4, ease: "easeInOut" },
              opacity: { duration: 4, repeat: Infinity, delay: i * 0.5 },
            }}
          />
        ))}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/80" />
    </div>
  );
}
