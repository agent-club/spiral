"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from "react";

const TAU = Math.PI * 2;
const RING_TEETH = 144;
const MAX_TRACE_POINTS = 52000;

const gearPresets = [
  { teeth: 59, label: "柔瓣", note: "59 圈闭合" },
  { teeth: 61, label: "繁花", note: "61 圈闭合" },
  { teeth: 65, label: "星芒", note: "65 圈闭合" },
] as const;

const holePresets = [
  { value: 0.42, label: "内圈" },
  { value: 0.66, label: "中圈" },
  { value: 0.82, label: "外圈" },
] as const;

const inks = [
  { value: "#2146d0", name: "群青" },
  { value: "#f05b40", name: "朱砂" },
  { value: "#167966", name: "松绿" },
  { value: "#7e42b7", name: "紫藤" },
] as const;

type Metrics = {
  size: number;
  cx: number;
  cy: number;
  outerRadius: number;
  gearRadius: number;
};

type SoundEngine = {
  context: AudioContext;
  exhaust: OscillatorNode;
  intake: OscillatorNode;
  whine: OscillatorNode;
  exhaustGain: GainNode;
  intakeGain: GainNode;
  whineGain: GainNode;
  exhaustFilter: BiquadFilterNode;
  whineFilter: BiquadFilterNode;
  master: GainNode;
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function normalizeDelta(value: number) {
  let delta = value;
  while (delta > Math.PI) delta -= TAU;
  while (delta < -Math.PI) delta += TAU;
  return delta;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<Metrics | null>(null);
  const angleRef = useRef(-Math.PI / 2);
  const startAngleRef = useRef(-Math.PI / 2);
  const previousPointerAngleRef = useRef(-Math.PI / 2);
  const traceRef = useRef<number[]>([-Math.PI / 2]);
  const draggingRef = useRef(false);
  const soundRef = useRef<SoundEngine | null>(null);
  const soundMotionRef = useRef({ time: 0, speed: 0 });
  const lastSpeedDisplayRef = useRef(0);
  const displayedSpeedRef = useRef(0);
  const speedDecayFrameRef = useRef(0);

  const [gearIndex, setGearIndex] = useState(1);
  const [holeIndex, setHoleIndex] = useState(1);
  const [inkIndex, setInkIndex] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [turns, setTurns] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [burstOrigin, setBurstOrigin] = useState({ x: "50vw", y: "50vh" });

  const syncBurstOrigin = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    setBurstOrigin({
      x: `${bounds.left + bounds.width / 2}px`,
      y: `${bounds.top + bounds.height / 2}px`,
    });
  }, []);

  const updateDisplayedSpeed = useCallback((speed: number) => {
    displayedSpeedRef.current = speed;
    setRotationSpeed(speed);
  }, []);

  const stopSpeedDecay = useCallback(() => {
    window.cancelAnimationFrame(speedDecayFrameRef.current);
    speedDecayFrameRef.current = 0;
  }, []);

  const beginSpeedDecay = useCallback(() => {
    stopSpeedDecay();

    const decay = () => {
      const nextSpeed = displayedSpeedRef.current * 0.975;
      if (nextSpeed < 0.04) {
        updateDisplayedSpeed(0);
        speedDecayFrameRef.current = 0;
        return;
      }

      updateDisplayedSpeed(nextSpeed);
      speedDecayFrameRef.current = window.requestAnimationFrame(decay);
    };

    speedDecayFrameRef.current = window.requestAnimationFrame(decay);
  }, [stopSpeedDecay, updateDisplayedSpeed]);

  const silenceSound = useCallback(() => {
    const sound = soundRef.current;
    if (!sound) return;

    const now = sound.context.currentTime;
    sound.master.gain.cancelScheduledValues(now);
    sound.master.gain.setValueAtTime(Math.max(sound.master.gain.value, 0.0001), now);
    sound.master.gain.linearRampToValueAtTime(0, now + 0.045);
  }, []);

  const ensureSound = useCallback(() => {
    if (!soundEnabled || typeof window === "undefined") return null;

    let sound = soundRef.current;
    if (!sound) {
      if (!window.AudioContext) return null;

      try {
        const context = new AudioContext({ latencyHint: "interactive" });
        const exhaust = context.createOscillator();
        const intake = context.createOscillator();
        const whine = context.createOscillator();
        const exhaustGain = context.createGain();
        const intakeGain = context.createGain();
        const whineGain = context.createGain();
        const exhaustFilter = context.createBiquadFilter();
        const whineFilter = context.createBiquadFilter();
        const drive = context.createWaveShaper();
        const compressor = context.createDynamicsCompressor();
        const master = context.createGain();
        const driveCurve = new Float32Array(512);

        for (let index = 0; index < driveCurve.length; index += 1) {
          const input = (index / (driveCurve.length - 1)) * 2 - 1;
          driveCurve[index] = Math.tanh(input * 1.65);
        }

        exhaust.type = "sawtooth";
        intake.type = "triangle";
        whine.type = "sine";
        exhaust.frequency.value = 62;
        intake.frequency.value = 126;
        whine.frequency.value = 280;
        exhaustGain.gain.value = 0.28;
        intakeGain.gain.value = 0.12;
        whineGain.gain.value = 0.055;
        exhaustFilter.type = "lowpass";
        exhaustFilter.frequency.value = 920;
        exhaustFilter.Q.value = 1.1;
        whineFilter.type = "bandpass";
        whineFilter.frequency.value = 1050;
        whineFilter.Q.value = 2.4;
        drive.curve = driveCurve;
        drive.oversample = "4x";
        compressor.threshold.value = -24;
        compressor.knee.value = 16;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.1;
        master.gain.value = 0;

        exhaust.connect(exhaustGain);
        intake.connect(intakeGain);
        whine.connect(whineGain);
        exhaustGain.connect(exhaustFilter);
        intakeGain.connect(exhaustFilter);
        whineGain.connect(whineFilter);
        exhaustFilter.connect(drive);
        drive.connect(compressor);
        whineFilter.connect(compressor);
        compressor.connect(master);
        master.connect(context.destination);
        exhaust.start();
        intake.start();
        whine.start();

        sound = {
          context,
          exhaust,
          intake,
          whine,
          exhaustGain,
          intakeGain,
          whineGain,
          exhaustFilter,
          whineFilter,
          master,
        };
        soundRef.current = sound;
      } catch {
        return null;
      }
    }

    if (sound.context.state === "suspended") {
      void sound.context.resume().catch(() => undefined);
    }
    return sound;
  }, [soundEnabled]);

  const updateSound = useCallback(
    (angularSpeed: number) => {
      const sound = ensureSound();
      if (!sound) return;

      const energy = Math.min(1, angularSpeed / 7.5);
      const now = sound.context.currentTime;
      const engineFrequency = 62 + energy * 292;

      sound.exhaust.frequency.setTargetAtTime(engineFrequency, now, 0.022);
      sound.intake.frequency.setTargetAtTime(engineFrequency * 2.015, now, 0.025);
      sound.whine.frequency.setTargetAtTime(280 + energy * 1540, now, 0.028);
      sound.exhaustGain.gain.setTargetAtTime(0.28 - energy * 0.08, now, 0.035);
      sound.intakeGain.gain.setTargetAtTime(0.11 + energy * 0.07, now, 0.03);
      sound.whineGain.gain.setTargetAtTime(0.045 + energy * 0.075, now, 0.03);
      sound.exhaustFilter.frequency.setTargetAtTime(880 + energy * 3100, now, 0.035);
      sound.whineFilter.frequency.setTargetAtTime(980 + energy * 2700, now, 0.035);
      sound.master.gain.cancelScheduledValues(now);
      sound.master.gain.setTargetAtTime(0.012 + energy * 0.05, now, 0.018);
    },
    [ensureSound],
  );

  const gear = gearPresets[gearIndex];
  const hole = holePresets[holeIndex];
  const ink = inks[inkIndex];
  const closureTurns = useMemo(
    () => gear.teeth / gcd(RING_TEETH, gear.teeth),
    [gear.teeth],
  );
  const completedLayers = Math.floor(turns / closureTurns);
  const pointForAngle = useCallback(
    (angle: number, metrics: Metrics) => {
      const { cx, cy, outerRadius, gearRadius } = metrics;
      const orbitRadius = outerRadius - gearRadius;
      const gearRotation = -((outerRadius - gearRadius) / gearRadius) * angle;
      const penOffset = gearRadius * hole.value;

      return {
        gearX: cx + orbitRadius * Math.cos(angle),
        gearY: cy + orbitRadius * Math.sin(angle),
        penX:
          cx +
          orbitRadius * Math.cos(angle) +
          penOffset * Math.cos(gearRotation),
        penY:
          cy +
          orbitRadius * Math.sin(angle) +
          penOffset * Math.sin(gearRotation),
        gearRotation,
      };
    },
    [hole.value],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const metrics = metricsRef.current;
    if (!canvas || !metrics) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const { size, cx, cy, outerRadius, gearRadius } = metrics;
    context.clearRect(0, 0, size, size);

    const paper = context.createRadialGradient(
      cx - size * 0.12,
      cy - size * 0.18,
      size * 0.05,
      cx,
      cy,
      size * 0.68,
    );
    paper.addColorStop(0, "#fffdf7");
    paper.addColorStop(0.72, "#f5f0e5");
    paper.addColorStop(1, "#e9e1d1");
    context.fillStyle = paper;
    context.fillRect(0, 0, size, size);

    context.save();
    context.translate(cx, cy);
    context.strokeStyle = "rgba(26, 39, 34, 0.12)";
    context.lineWidth = 1;
    for (let i = 0; i < 8; i += 1) {
      context.beginPath();
      context.arc(0, 0, outerRadius + 19 + i * 2.4, 0, TAU);
      context.stroke();
    }

    for (let i = 0; i < RING_TEETH; i += 1) {
      const angle = (i / RING_TEETH) * TAU;
      const inner = outerRadius + 4;
      const outer = outerRadius + 13;
      context.beginPath();
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      context.strokeStyle =
        i % 4 === 0 ? "rgba(22, 36, 31, 0.42)" : "rgba(22, 36, 31, 0.23)";
      context.lineWidth = i % 4 === 0 ? 1.6 : 1;
      context.stroke();
    }

    context.beginPath();
    context.arc(0, 0, outerRadius, 0, TAU);
    context.strokeStyle = "rgba(20, 33, 29, 0.78)";
    context.lineWidth = 2.5;
    context.stroke();
    context.restore();

    const trace = traceRef.current;
    if (trace.length > 1) {
      context.beginPath();
      trace.forEach((angle, index) => {
        const point = pointForAngle(angle, metrics);
        if (index === 0) context.moveTo(point.penX, point.penY);
        else context.lineTo(point.penX, point.penY);
      });
      context.strokeStyle = ink.value;
      context.globalAlpha = Math.min(
        0.58 + (turns / closureTurns) * 0.08,
        0.96,
      );
      context.lineWidth =
        Math.max(1.05, size / 620) + Math.min(completedLayers * 0.08, 0.48);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
      context.globalAlpha = 1;
    }

    const point = pointForAngle(angleRef.current, metrics);
    context.save();
    context.translate(point.gearX, point.gearY);
    context.rotate(point.gearRotation);

    const gearGradient = context.createRadialGradient(
      -gearRadius * 0.3,
      -gearRadius * 0.38,
      gearRadius * 0.08,
      0,
      0,
      gearRadius * 1.1,
    );
    gearGradient.addColorStop(0, "rgba(226, 255, 126, 0.9)");
    gearGradient.addColorStop(0.55, "rgba(174, 219, 73, 0.82)");
    gearGradient.addColorStop(1, "rgba(117, 163, 42, 0.9)");

    context.beginPath();
    const toothCount = gear.teeth;
    for (let i = 0; i < toothCount * 2; i += 1) {
      const toothAngle = (i / (toothCount * 2)) * TAU;
      const radius = i % 2 === 0 ? gearRadius * 1.04 : gearRadius * 0.96;
      const x = Math.cos(toothAngle) * radius;
      const y = Math.sin(toothAngle) * radius;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = gearGradient;
    context.shadowColor = "rgba(40, 56, 29, 0.22)";
    context.shadowBlur = 14;
    context.shadowOffsetY = 7;
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(73, 104, 25, 0.48)";
    context.lineWidth = 1.2;
    context.stroke();

    for (const distance of [0.42, 0.66, 0.82]) {
      context.beginPath();
      context.arc(gearRadius * distance, 0, gearRadius * 0.07, 0, TAU);
      context.fillStyle = "rgba(244, 250, 218, 0.72)";
      context.fill();
      context.strokeStyle = "rgba(65, 92, 27, 0.34)";
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();

    const pulse = isDrawing ? 2 : 0;
    context.beginPath();
    context.arc(point.penX, point.penY, 12 + pulse, 0, TAU);
    context.fillStyle = "rgba(255, 255, 255, 0.93)";
    context.shadowColor = "rgba(19, 29, 26, 0.28)";
    context.shadowBlur = 10;
    context.fill();
    context.shadowColor = "transparent";
    context.beginPath();
    context.arc(point.penX, point.penY, 5.5, 0, TAU);
    context.fillStyle = "#17231f";
    context.fill();
    context.beginPath();
    context.arc(point.penX - 1.5, point.penY - 1.5, 1.7, 0, TAU);
    context.fillStyle = ink.value;
    context.fill();
  }, [closureTurns, completedLayers, gear.teeth, ink.value, isDrawing, pointForAngle, turns]);

  const updateTurns = useCallback(
    (angle: number) => {
      setTurns(Math.abs(angle - startAngleRef.current) / TAU);
    },
    [],
  );

  const advanceTo = useCallback(
    (nextAngle: number) => {
      const current = angleRef.current;
      const difference = nextAngle - current;
      const steps = Math.max(1, Math.ceil(Math.abs(difference) / 0.012));

      for (let step = 1; step <= steps; step += 1) {
        traceRef.current.push(current + (difference * step) / steps);
      }
      if (traceRef.current.length > MAX_TRACE_POINTS) {
        traceRef.current = traceRef.current.slice(-MAX_TRACE_POINTS);
      }

      angleRef.current = nextAngle;
      setHasStarted(true);
      updateTurns(nextAngle);
      draw();
    },
    [draw, updateTurns],
  );

  const reset = useCallback(() => {
    const start = -Math.PI / 2;
    angleRef.current = start;
    startAngleRef.current = start;
    previousPointerAngleRef.current = start;
    traceRef.current = [start];
    setTurns(0);
    setHasStarted(false);
    setIsDrawing(false);
    stopSpeedDecay();
    updateDisplayedSpeed(0);
    draggingRef.current = false;
    silenceSound();
    requestAnimationFrame(draw);
  }, [draw, silenceSound, stopSpeedDecay, updateDisplayedSpeed]);

  const selectGear = (index: number) => {
    setGearIndex(index);
    requestAnimationFrame(reset);
  };

  const selectHole = (index: number) => {
    setHoleIndex(index);
    requestAnimationFrame(reset);
  };

  const startDraggingAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const metrics = metricsRef.current;
    if (!canvas || !metrics) return;

    const bounds = canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const rawAngle = Math.atan2(y - metrics.cy, x - metrics.cx);
    const distance = Math.hypot(x - metrics.cx, y - metrics.cy);
    const orbitRadius = metrics.outerRadius - metrics.gearRadius;

    if (Math.abs(distance - orbitRadius) > metrics.gearRadius * 1.55) return;

    draggingRef.current = true;
    setIsDrawing(true);
    syncBurstOrigin();
    stopSpeedDecay();
    previousPointerAngleRef.current = rawAngle;
    soundMotionRef.current = { time: performance.now(), speed: 0 };
    lastSpeedDisplayRef.current = 0;
    updateDisplayedSpeed(0);
    updateSound(0.18);

    const currentRaw = Math.atan2(
      Math.sin(angleRef.current),
      Math.cos(angleRef.current),
    );
    advanceTo(angleRef.current + normalizeDelta(rawAngle - currentRaw));
  };

  const moveDraggingAt = (clientX: number, clientY: number) => {
    if (!draggingRef.current) return;
    const canvas = canvasRef.current;
    const metrics = metricsRef.current;
    if (!canvas || !metrics) return;

    const bounds = canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const rawAngle = Math.atan2(y - metrics.cy, x - metrics.cx);
    const delta = normalizeDelta(rawAngle - previousPointerAngleRef.current);
    const now = performance.now();
    const elapsed = Math.max((now - soundMotionRef.current.time) / 1000, 0.001);
    const instantSpeed = Math.abs(delta) / elapsed;
    const speed = soundMotionRef.current.speed * 0.62 + instantSpeed * 0.38;

    soundMotionRef.current = { time: now, speed };
    if (now - lastSpeedDisplayRef.current >= 48) {
      lastSpeedDisplayRef.current = now;
      updateDisplayedSpeed(speed);
    }
    updateSound(speed);
    previousPointerAngleRef.current = rawAngle;
    advanceTo(angleRef.current + delta);
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    startDraggingAt(event.clientX, event.clientY);
    if (draggingRef.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    moveDraggingAt(event.clientX, event.clientY);
  };

  const handleMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (!draggingRef.current) startDraggingAt(event.clientX, event.clientY);
  };

  const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    moveDraggingAt(event.clientX, event.clientY);
  };

  const handleTouchStart = (event: TouchEvent<HTMLCanvasElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    if (!draggingRef.current) startDraggingAt(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (event: TouchEvent<HTMLCanvasElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    moveDraggingAt(touch.clientX, touch.clientY);
  };

  const stopDragging = useCallback(() => {
    draggingRef.current = false;
    soundMotionRef.current = { time: 0, speed: 0 };
    lastSpeedDisplayRef.current = 0;
    setIsDrawing(false);
    beginSpeedDecay();
    silenceSound();
    requestAnimationFrame(draw);
  }, [beginSpeedDecay, draw, silenceSound]);

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    advanceTo(angleRef.current + direction * 0.05);
  };

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const resize = () => {
      const size = Math.max(280, Math.floor(stage.clientWidth));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const context = canvas.getContext("2d");
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      metricsRef.current = {
        size,
        cx: size / 2,
        cy: size / 2,
        outerRadius: size * 0.355,
        gearRadius: size * 0.355 * (gear.teeth / RING_TEETH),
      };
      syncBurstOrigin();
      draw();
    };

    let resizeFrame = 0;
    const scheduleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(stage);
    resize();
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
  }, [draw, gear.teeth, syncBurstOrigin]);

  useEffect(() => {
    draw();
  }, [draw, inkIndex]);

  useEffect(() => {
    const stopOnRelease = () => {
      if (draggingRef.current) {
        stopDragging();
      } else {
        silenceSound();
      }
    };
    const stopWhenHidden = () => {
      if (document.hidden) stopOnRelease();
    };

    window.addEventListener("pointerup", stopOnRelease);
    window.addEventListener("pointercancel", stopOnRelease);
    window.addEventListener("mouseup", stopOnRelease);
    window.addEventListener("touchend", stopOnRelease);
    window.addEventListener("blur", stopOnRelease);
    document.addEventListener("visibilitychange", stopWhenHidden);

    return () => {
      window.removeEventListener("pointerup", stopOnRelease);
      window.removeEventListener("pointercancel", stopOnRelease);
      window.removeEventListener("mouseup", stopOnRelease);
      window.removeEventListener("touchend", stopOnRelease);
      window.removeEventListener("blur", stopOnRelease);
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [silenceSound, stopDragging]);

  useEffect(() => {
    return () => {
      stopSpeedDecay();
      const sound = soundRef.current;
      if (!sound) return;

      sound.exhaust.stop();
      sound.intake.stop();
      sound.whine.stop();
      void sound.context.close().catch(() => undefined);
      soundRef.current = null;
    };
  }, [stopSpeedDecay]);

  const remix = () => {
    setGearIndex((value) => (value + 1) % gearPresets.length);
    setHoleIndex((value) => (value + 1) % holePresets.length);
    setInkIndex((value) => (value + 1) % inks.length);
    requestAnimationFrame(reset);
  };

  const toggleSound = () => {
    if (soundEnabled) silenceSound();
    setSoundEnabled((value) => !value);
  };

  const level = completedLayers + 1;
  const closureProgress = (turns % closureTurns) / closureTurns;
  const closurePercent = Math.round(closureProgress * 100);
  const score = Math.round(completedLayers * 250 + turns * 120);
  const missionPhase = `${gear.label} / ${hole.label} / ${ink.name}`;
  const missionState = isDrawing
    ? "正在进行中"
    : hasStarted
      ? "可继续拖动以复写"
      : "等待第一次落笔";
  const speedEnergy = Math.min(1, rotationSpeed / 7.5);
  const burstEnergy = Math.max(0, (speedEnergy - 0.24) / 0.76);
  const engineRpm = rotationSpeed > 0.05
    ? Math.round((900 + rotationSpeed * 880) / 10) * 10
    : 0;
  const turnsPerSecond = rotationSpeed / TAU;
  const speedState = burstEnergy > 0.72
    ? "极速盛放"
    : burstEnergy > 0.12
      ? "正在加速"
      : isDrawing
        ? "巡航描线"
        : "等待起步";
  const speedStyle = {
    "--speed-energy": speedEnergy.toFixed(3),
    "--burst-energy": burstEnergy.toFixed(3),
    "--burst-duration": `${(1.65 - burstEnergy * 0.72).toFixed(2)}s`,
    "--particle-duration": `${(2.15 - burstEnergy * 0.62).toFixed(2)}s`,
    "--burst-origin-x": burstOrigin.x,
    "--burst-origin-y": burstOrigin.y,
  } as CSSProperties;

  return (
    <main
      className={`app-shell ${burstEnergy > 0.05 ? "is-speeding" : ""}`}
      style={speedStyle}
    >
      <div className="speed-atmosphere" aria-hidden="true">
        <div className="speed-rings">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="speed-particles">
          {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
        </div>
        <span className="speed-cheer speed-cheer-one">漂亮！</span>
        <span className="speed-cheer speed-cheer-two">保持节奏</span>
        <span className="speed-cheer speed-cheer-three">极速盛放</span>
      </div>
      <header className="topbar">
        <a className="brand" href="#game" aria-label="回到绘图游戏">
          <span className="brand-mark" aria-hidden="true">
            <i />
          </span>
          <span>Spiral Bloom Arcade</span>
        </a>
        <div className="top-hint">
          <span className="live-dot" />
          轨迹 + 转速 + 闭环任务
        </div>
      </header>

      <section className="hero" id="game">
        <div className="hud-strip" aria-label="游戏 HUD">
          <article className="hud-card">
            <p>LEVEL</p>
            <strong>Lv.{level}</strong>
          </article>
          <article className="hud-card">
            <p>COMPLETION</p>
            <strong>{closurePercent}%</strong>
          </article>
          <article className="hud-card">
            <p>SCORE</p>
            <strong>{score.toString().padStart(6, "0")}</strong>
          </article>
          <article className="hud-card hud-speed">
            <p>SPEED</p>
            <strong>{engineRpm.toLocaleString()} <small>RPM</small></strong>
            <span>{turnsPerSecond.toFixed(2)} 圈/秒 · {speedState}</span>
          </article>
          <article className="hud-card hud-mission">
            <p>MISSION</p>
            <strong>{missionPhase}</strong>
          </article>
        </div>

        <div className="game-grid">
          <div className="stage-column">
            <div className={`stage-card ${isDrawing ? "is-drawing" : ""}`}>
              <div className="stage-meta">
                <span>阶段 {level}</span>
                <span>{missionState}</span>
              </div>
              <div className="canvas-wrap" ref={stageRef}>
                <canvas
                  ref={canvasRef}
                  className="drawing-canvas"
                  aria-label="万花尺绘图区域。按住齿轮或使用方向键绘图。"
                  tabIndex={0}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={stopDragging}
                  onPointerCancel={stopDragging}
                  onKeyDown={handleKeyDown}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={stopDragging}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={stopDragging}
                  onTouchCancel={stopDragging}
                />
                {!hasStarted && (
                  <div className="drag-prompt" aria-hidden="true">
                    <span className="prompt-line" />
                    <span>按住齿轮沿环拖动，感受引擎升转</span>
                  </div>
                )}
              </div>
              <div className="progress-track" aria-label={`真实轨迹闭合进度 ${closurePercent}%`}>
                <span style={{ width: `${closurePercent}%` }} />
              </div>
              <div className="stage-footer">
                <div className="stage-status">
                  <strong>{isDrawing ? "正在描线" : hasStarted ? "继续描线" : "等待落笔"}</strong>
                  <span>{hasStarted ? `已绘制 ${turns.toFixed(1)} 圈，${closureTurns} 圈后闭合` : `当前闭合周期：${closureTurns} 圈`}</span>
                </div>
                <div className="stage-actions">
                  <button
                    className={`text-button sound-button ${soundEnabled ? "is-on" : ""}`}
                    type="button"
                  onClick={toggleSound}
                  aria-pressed={soundEnabled}
                  aria-label={`跑车引擎声音${soundEnabled ? "开启" : "关闭"}`}
                >
                    引擎 {soundEnabled ? "开" : "关"}
                  </button>
                  <button className="text-button reset-button" type="button" onClick={reset}>
                    清空重画
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="control-panel" aria-label="绘图设置">
            <div className="panel-heading">
              <span>控制台</span>
              <button type="button" className="shuffle-button" onClick={remix}>
                重组参数
              </button>
            </div>

            <div className="rule-card mission-tile">
              <span>当 下 任务</span>
              <strong>第 {level} 关：{gear.label} 齿轮 / {hole.label} 孔位</strong>
              <p>
                按照闭合周期推进，本层完成度 {closurePercent}%，每次闭合后进入新的叠加层。
              </p>
            </div>

            <fieldset>
              <legend>齿轮</legend>
              <div className="segmented-control">
                {gearPresets.map((preset, index) => (
                  <button
                    type="button"
                    key={preset.teeth}
                    className={index === gearIndex ? "active" : ""}
                    onClick={() => selectGear(index)}
                    aria-pressed={index === gearIndex}
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.note}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>落笔位置</legend>
              <div className="hole-control">
                {holePresets.map((preset, index) => (
                  <button
                    type="button"
                    key={preset.label}
                    className={index === holeIndex ? "active" : ""}
                    onClick={() => selectHole(index)}
                    aria-pressed={index === holeIndex}
                  >
                    <span className="hole-icon" aria-hidden="true">
                      <i style={{ left: `${18 + preset.value * 52}%` }} />
                    </span>
                    {preset.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>墨色</legend>
              <div className="ink-row">
                {inks.map((color, index) => (
                  <button
                    type="button"
                    key={color.value}
                    className={index === inkIndex ? "active" : ""}
                    style={{ "--swatch": color.value } as React.CSSProperties}
                    onClick={() => setInkIndex(index)}
                    aria-label={color.name}
                    aria-pressed={index === inkIndex}
                  />
                ))}
              </div>
            </fieldset>

            <div className="rule-card">
              <span>能量面板</span>
              <strong>{isDrawing ? "音频反馈：开启" : "音频反馈：" + (soundEnabled ? "开启" : "关闭")}</strong>
              <p>完成一轮完整复走后可获得更高叠加能量，曲线会更亮更有层次。</p>
            </div>
          </aside>
        </div>
      </section>

      <footer className="footer-note">
        <span>SPIROGRAPH PLAYGROUND</span>
        <p>规律负责重复，你只负责开始。</p>
      </footer>
    </main>
  );
}
