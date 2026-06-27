import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { useCallback, useRef } from "react";

/** Gradient outline on hover — inspired by [Aceternity Text Hover Effect](https://ui.aceternity.com/components/text-hover-effect) */
export function TextHoverEffect({
  text,
  className = "",
  duration = 0.4,
}: {
  text: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const cx = useMotionValue(50);
  const cy = useMotionValue(50);

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      cx.set(((e.clientX - rect.left) / rect.width) * 100);
      cy.set(((e.clientY - rect.top) / rect.height) * 100);
    },
    [cx, cy]
  );

  const mask = useMotionTemplate`radial-gradient(120px 120px at ${cx}% ${cy}%, black, transparent)`;

  return (
    <svg
      ref={ref}
      onMouseMove={handleMove}
      className={`select-none ${className}`}
      viewBox="0 0 800 120"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="majubiz-text-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-transparent stroke-neutral-700 font-bold"
        style={{ fontSize: 72, strokeWidth: 1.5, fontFamily: "Inter, system-ui, sans-serif" }}
      >
        {text}
      </text>
      <motion.text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-transparent font-bold"
        style={{
          fontSize: 72,
          strokeWidth: 2,
          stroke: "url(#majubiz-text-grad)",
          fontFamily: "Inter, system-ui, sans-serif",
          WebkitMaskImage: mask,
          maskImage: mask,
        }}
        transition={{ duration }}
      >
        {text}
      </motion.text>
    </svg>
  );
}
