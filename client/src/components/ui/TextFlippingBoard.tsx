import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$".split("");

function FlipTile({ char, flipKey }: { char: string; flipKey: number }) {
  const display = char === " " ? "\u00A0" : char.toUpperCase();

  return (
    <div className="relative h-12 w-8 overflow-hidden rounded-md bg-slate-900 shadow-[inset_0_-2px_0_rgba(255,255,255,0.08)] sm:h-14 sm:w-10">
      <motion.div
        key={flipKey}
        initial={{ rotateX: -90, opacity: 0 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-950 text-lg font-bold tracking-tight text-amber-300 sm:text-xl"
        style={{ transformOrigin: "50% 100%", backfaceVisibility: "hidden" }}
      >
        {display}
      </motion.div>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/40" />
    </div>
  );
}

function buildRows(text: string, cols = 12): string[] {
  const words = text.toUpperCase().split(/\s+/);
  const rows: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > cols) {
      if (line) rows.push(line.padEnd(cols, " "));
      line = word.length > cols ? word.slice(0, cols) : word;
    } else {
      line = next;
    }
  }
  if (line) rows.push(line.padEnd(cols, " "));
  return rows.length ? rows : [text.toUpperCase().padEnd(cols, " ")];
}

export interface TextFlippingBoardProps {
  /** Lines to cycle through on the split-flap display */
  phrases: string[];
  /** Seconds between phrase changes */
  intervalSec?: number;
  className?: string;
}

/** Split-flap board inspired by [Aceternity Text Flipping Board](https://ui.aceternity.com/components/text-flipping-board) */
export function TextFlippingBoard({ phrases, intervalSec = 3.2, className = "" }: TextFlippingBoardProps) {
  const [index, setIndex] = useState(0);
  const [flipKey, setFlipKey] = useState(0);
  const phrase = phrases[index % phrases.length] ?? "";
  const rows = buildRows(phrase, 14);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % phrases.length);
      setFlipKey((k) => k + 1);
    }, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [phrases.length, intervalSec]);

  return (
    <div
      className={`inline-flex flex-col gap-1.5 rounded-2xl border border-slate-800/80 bg-slate-950/90 p-3 shadow-2xl ${className}`}
      style={{ perspective: "800px" }}
    >
      {rows.map((row, rowIdx) => (
        <div key={`${flipKey}-${rowIdx}`} className="flex gap-1">
          {row.split("").map((char, colIdx) => (
            <FlipTile
              key={`${flipKey}-${rowIdx}-${colIdx}-${char}`}
              char={FLAP_CHARS.includes(char) ? char : "?"}
              flipKey={flipKey + rowIdx * 20 + colIdx}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
