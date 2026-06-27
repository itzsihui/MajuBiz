import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/** Inspired by [Aceternity Background Beams With Collision](https://ui.aceternity.com/components/background-beams-with-collision) */

interface BeamOptions {
  /** Horizontal offset from viewport centre (px) */
  offsetX?: number;
  initialY?: string;
  translateY?: string;
  rotate?: number;
  className?: string;
  duration?: number;
  delay?: number;
  repeatDelay?: number;
}

/** Beams fan out from centre so collisions spread across the bottom edge */
const DEFAULT_BEAMS: BeamOptions[] = [
  { offsetX: 0, duration: 7, repeatDelay: 3, delay: 2 },
  { offsetX: -220, rotate: -10, duration: 6, repeatDelay: 3, delay: 1 },
  { offsetX: 220, rotate: 10, duration: 5, repeatDelay: 3, delay: 4 },
  { offsetX: -120, rotate: -6, duration: 7.5, repeatDelay: 3, delay: 0.5 },
  { offsetX: 120, rotate: 6, duration: 6, repeatDelay: 3, delay: 3 },
  { offsetX: -360, rotate: -12, duration: 8, repeatDelay: 3, delay: 2.5 },
  { offsetX: 360, rotate: 12, duration: 5.5, repeatDelay: 3, delay: 1.5 },
];

export function BackgroundBeamsWithCollision({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={parentRef}
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden bg-slate-950",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        {DEFAULT_BEAMS.map((beamOptions, idx) => (
          <CollisionMechanism
            key={idx}
            beamOptions={beamOptions}
            containerRef={containerRef}
            parentRef={parentRef}
          />
        ))}
      </div>

      <div className="relative z-10 w-full">{children}</div>

      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 w-full bg-slate-950"
        style={{
          height: "40px",
          boxShadow:
            "0 0 24px rgba(99, 102, 241, 0.15), 0 0 48px rgba(139, 92, 246, 0.08), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      />
    </div>
  );
}

function CollisionMechanism({
  parentRef,
  containerRef,
  beamOptions = {},
}: {
  parentRef: React.RefObject<HTMLDivElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  beamOptions?: BeamOptions;
}) {
  const beamRef = useRef<HTMLDivElement>(null);
  const [collision, setCollision] = useState<{
    detected: boolean;
    coordinates: { x: number; y: number } | null;
  }>({ detected: false, coordinates: null });
  const [beamKey, setBeamKey] = useState(0);
  const [cycleCollisionDetected, setCycleCollisionDetected] = useState(false);

  useEffect(() => {
    const checkCollision = () => {
      if (
        beamRef.current &&
        containerRef.current &&
        parentRef.current &&
        !cycleCollisionDetected
      ) {
        const beamRect = beamRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        const parentRect = parentRef.current.getBoundingClientRect();

        if (beamRect.bottom >= containerRect.top) {
          setCollision({
            detected: true,
            coordinates: {
              x: beamRect.left - parentRect.left + beamRect.width / 2,
              y: beamRect.bottom - parentRect.top,
            },
          });
          setCycleCollisionDetected(true);
        }
      }
    };

    const animationInterval = setInterval(checkCollision, 50);
    return () => clearInterval(animationInterval);
  }, [cycleCollisionDetected, containerRef, parentRef]);

  useEffect(() => {
    if (!collision.detected || !collision.coordinates) return;

    const resetTimer = setTimeout(() => {
      setCollision({ detected: false, coordinates: null });
      setCycleCollisionDetected(false);
      setBeamKey((k) => k + 1);
    }, 2000);

    return () => clearTimeout(resetTimer);
  }, [collision]);

  return (
    <>
      <motion.div
        key={beamKey}
        ref={beamRef}
        animate="animate"
        initial={{
          translateY: beamOptions.initialY ?? "-200px",
          translateX: beamOptions.offsetX ?? 0,
          rotate: beamOptions.rotate ?? 0,
        }}
        variants={{
          animate: {
            translateY: beamOptions.translateY ?? "1800px",
            translateX: beamOptions.offsetX ?? 0,
            rotate: beamOptions.rotate ?? 0,
          },
        }}
        transition={{
          duration: beamOptions.duration ?? 8,
          repeat: Infinity,
          ease: "linear",
          delay: beamOptions.delay ?? 0,
          repeatDelay: beamOptions.repeatDelay ?? 0,
        }}
        className={cn(
          "absolute left-1/2 top-20 h-14 w-px rounded-full bg-gradient-to-t from-indigo-500 via-violet-500 to-transparent",
          beamOptions.className
        )}
      />
      <AnimatePresence>
        {collision.detected && collision.coordinates && (
          <Explosion
            key={`${collision.coordinates.x}-${collision.coordinates.y}-${beamKey}`}
            style={{
              left: `${collision.coordinates.x}px`,
              top: `${collision.coordinates.y}px`,
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function Explosion({ className, ...props }: React.HTMLProps<HTMLDivElement>) {
  const spans = Array.from({ length: 20 }, (_, index) => ({
    id: index,
    directionX: Math.floor(Math.random() * 80 - 40),
    directionY: Math.floor(Math.random() * -50 - 10),
    duration: Math.random() * 1.5 + 0.5,
  }));

  return (
    <div {...props} className={cn("absolute z-50 h-2 w-2", className)}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
        className="absolute -inset-x-10 top-0 m-auto h-2 w-10 rounded-full bg-gradient-to-r from-transparent via-indigo-500 to-transparent blur-sm"
      />
      {spans.map((span) => (
        <motion.span
          key={span.id}
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: span.directionX, y: span.directionY, opacity: 0 }}
          transition={{ duration: span.duration, ease: "easeOut" }}
          className="absolute h-1 w-1 rounded-full bg-gradient-to-b from-indigo-400 to-violet-500"
        />
      ))}
    </div>
  );
}
