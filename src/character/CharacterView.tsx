/**
 * MYRAA — React wrapper for the PMX character stage.
 * Fades the canvas in when the model is ready and surfaces loading stages.
 */
import { useEffect, useRef, useState } from "react";
import { getCharacter, type EvelynConfig } from "./config";
import { MyraaCharacterStage } from "./character";

interface CharacterViewProps {
  characterId?: string;
  activity: "idle" | "listening" | "thinking" | "talking";
  outputAnalyser: AnalyserNode | null;
  inputAnalyser: AnalyserNode | null;
  controlsEnabled?: boolean;
  showControlHint?: boolean;
  reflectionStrength?: number;
}

interface StageState {
  phase: string;
  ratio: number;
  error: string | null;
}

export function CharacterView({
  characterId,
  activity,
  outputAnalyser,
  inputAnalyser,
  controlsEnabled = true,
  showControlHint = true,
  reflectionStrength = 1,
}: CharacterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<MyraaCharacterStage | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stageState, setStageState] = useState<StageState>({ phase: "Starting", ratio: 0, error: null });
  const [failed, setFailed] = useState(false);
  const config: EvelynConfig = getCharacter(characterId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 w-full h-full";
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity 1s ease";
    container.appendChild(canvas);
    canvasRef.current = canvas;

    let cancelled = false;
    const stage = new MyraaCharacterStage({
      canvas,
      config,
      onProgress: (phase, ratio) => {
        if (!cancelled) setStageState({ phase, ratio, error: null });
      },
      onError: (error) => {
        console.error("[MyraaCharacter]", error);
        if (!cancelled) setStageState((current) => ({ ...current, error: error.message }));
      },
    });
    stageRef.current = stage;
    stage.resize(container.clientWidth, container.clientHeight);
    stage
      .load()
      .then(() => {
        if (!cancelled) {
          stage.setActivity({ mode: activity });
          stage.start();
          setStageState({ phase: "Ready", ratio: 1, error: null });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setStageState((current) => ({ ...current, error: error.message }));
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      stageRef.current = null;
      stage.dispose();
      canvas.remove();
      canvasRef.current = null;
    };
    // Reload only when the character identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.opacity = stageState.ratio >= 1 && !stageState.error ? "1" : "0";
  }, [stageState.ratio, stageState.error]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      stageRef.current?.resize(width, height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    stageRef.current?.setActivity({ mode: activity });
  }, [activity]);

  useEffect(() => {
    stageRef.current?.setOutputAnalyser(outputAnalyser);
  }, [outputAnalyser]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      stageRef.current?.setPointer(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 - 1,
      );
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  useEffect(() => {
    if (!controlsEnabled) return;
    const keys = new Set<string>();
    let handle: number | null = null;
    let last = performance.now();
    const loop = () => {
      handle = requestAnimationFrame(loop);
      const now = performance.now();
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      const stage = stageRef.current;
      if (!stage) return;
      const orbitSpeed = 1.9;
      const zoomSpeed = 14;
      let yaw = 0;
      let pitch = 0;
      if (keys.has("a")) yaw -= orbitSpeed * delta;
      if (keys.has("d")) yaw += orbitSpeed * delta;
      if (keys.has("w")) pitch += 0.6 * delta;
      if (keys.has("s")) pitch -= 0.6 * delta;
      if (yaw || pitch) stage.orbitBy(yaw, pitch);
      let zoom = 0;
      if (keys.has("q")) zoom += zoomSpeed * delta;
      if (keys.has("e")) zoom -= zoomSpeed * delta;
      if (zoom) stage.zoomBy(zoom);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      keys.add(event.key.toLowerCase());
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    handle = requestAnimationFrame(loop);
    return () => {
      if (handle !== null) cancelAnimationFrame(handle);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controlsEnabled]);

  if (failed) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-amber-200/80">
            Character failed to load
          </p>
          <p className="max-w-sm text-xs text-slate-400 leading-relaxed">{stageState.error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 z-10" />
      {stageState.ratio < 1 && !stageState.error && (
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-40 pointer-events-none">
          <div className="text-center space-y-3">
            <div className="mx-auto h-9 w-9 rounded-full border-2 border-white/10 border-t-cyan-400 animate-spin" />
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">
              {stageState.phase}
            </p>
          </div>
        </div>
      )}
      {showControlHint && stageState.ratio >= 1 && (
        <div className="absolute bottom-28 right-6 z-20 hidden lg:block">
          <p className="myraa-chip text-slate-500">
            WASD orbit · Q/E zoom · F eyes · L lock
          </p>
        </div>
      )}
      <span className="hidden">{inputAnalyser ? "mic live" : ""}{reflectionStrength}</span>
    </>
  );
}
