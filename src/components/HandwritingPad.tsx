import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Eye, EyeOff } from 'lucide-react';

interface HandwritingPadProps {
  templateText: string;
  onDrawnChange: (hasDrawn: boolean) => void;
}

export const HandwritingPad: React.FC<HandwritingPadProps> = ({
  templateText,
  onDrawnChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [showTemplate, setShowTemplate] = useState(true);
  const [hasDrawn, setHasDrawn] = useState(false);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(280, Math.floor(rect.width * dpr));
    canvas.height = Math.max(200, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#15803D';
      ctx.lineWidth = templateText.length > 3 ? 6 : 9;
    }
  };

  useEffect(() => {
    setupCanvas();
    setHasDrawn(false);
    onDrawnChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateText]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const { x, y } = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);

    if (!hasDrawn) {
      setHasDrawn(true);
      onDrawnChange(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer already released
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onDrawnChange(false);
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-stone-600">
          Dùng ngón tay hoặc chuột viết theo nét mẫu bên dưới
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowTemplate((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors min-h-[40px] whitespace-nowrap"
          >
            {showTemplate ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span>{showTemplate ? 'Ẩn mẫu' : 'Hiện mẫu'}</span>
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors min-h-[40px] whitespace-nowrap"
          >
            <Eraser className="w-4 h-4" />
            <span>Viết lại</span>
          </button>
        </div>
      </div>

      <div className="relative w-full h-56 sm:h-64 bg-white rounded-2xl border border-stone-200 overflow-hidden select-none">
        {/* Ruled elementary notebook lines */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-evenly">
          <div className="border-b border-dashed border-sky-200/80 w-full" />
          <div className="border-b border-sky-300/80 w-full" />
          <div className="border-b border-dashed border-sky-200/80 w-full" />
        </div>

        {/* Faint tracing template */}
        {showTemplate && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className={`font-bold tracking-wide text-stone-200 select-none ${
                templateText.length <= 2
                  ? 'text-8xl sm:text-9xl'
                  : templateText.length <= 6
                    ? 'text-6xl sm:text-7xl'
                    : 'text-4xl sm:text-5xl'
              }`}
            >
              {templateText}
            </span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative z-10 w-full h-full cursor-crosshair touch-none"
        />
      </div>
    </div>
  );
};
