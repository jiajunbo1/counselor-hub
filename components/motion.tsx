import { useEffect, useRef, useState } from "react";

const reduced = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 关键数字滚动：数据刷新后让「变了多少」可被眼睛追上；不动效时直接落终值。
export function CountUp({
  value,
  decimals = 0,
  duration = 480,
  className,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    if (reduced() || !Number.isFinite(from) || !Number.isFinite(value) || from === value) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{shown.toFixed(decimals)}</span>;
}

// 状态变更（审批、授予、登记）后给一次 0.9s 闪光，补上「按了不知道生效没有」的反馈。
export function useFlash(dep: unknown): string {
  const first = useRef(true);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced()) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 900);
    return () => clearTimeout(t);
  }, [dep]);
  return on ? "flash-changed" : "";
}
