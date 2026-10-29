'use client';
// A reusable camera QR reader, extracted from app/scan/page.tsx (events S5 spec §8.2). It owns getUserMedia, the canvas +
// jsQR loop and the cleanup of the camera tracks. It makes no network call and knows nothing about check-in or tickets:
// the page decides what a decoded text means.
import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import jsQR from 'jsqr';

export type QrScannerState = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'insecure' | 'no_camera' | 'error';

export function QrScanner({ active, onDecode, onState, cooldownMs = 2000, previewLabel, offLabel, className = '' }: {
  /** Start (true) or stop (false) the camera. */
  active: boolean;
  onDecode: (text: string) => void;
  onState?: (state: QrScannerState) => void;
  /** The same text is not reported twice inside this window. 0 reports every frame that decodes. */
  cooldownMs?: number;
  /** aria-label of the `<video>`. */
  previewLabel?: string;
  /** Text shown over the black viewfinder while the camera is off. */
  offLabel: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const showing = useRef(false);
  const onDecodeRef = useRef(onDecode);
  const onStateRef = useRef(onState);
  onDecodeRef.current = onDecode;
  onStateRef.current = onState;
  const last = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    const emit = (s: QrScannerState) => onStateRef.current?.(s);
    let cancelled = false;
    let raf = 0;

    function stop() {
      cancelAnimationFrame(raf);
      const video = videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(track => track.stop());
      if (video) video.srcObject = null;
      showing.current = false;
      setLive(false);
    }

    function tick() {
      const video = videoRef.current, canvas = canvasRef.current;
      if (cancelled || !video || !canvas || !video.srcObject) return;
      if (video.readyState < 2) { raf = requestAnimationFrame(tick); return; }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code?.data) {
        const now = Date.now();
        const seen = last.current;
        if (cooldownMs <= 0 || !seen || seen.text !== code.data || now - seen.at >= cooldownMs) {
          last.current = { text: code.data, at: now };
          onDecodeRef.current(code.data);
        }
      }
      if (video.srcObject) raf = requestAnimationFrame(tick);
    }

    async function start() {
      if (typeof window !== 'undefined' && window.isSecureContext === false) { emit('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { emit('unsupported'); return; }
      emit('requesting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled || !videoRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (cancelled) { stop(); return; }
        showing.current = true;
        setLive(true);
        emit('active');
        tick();
      } catch (err) {
        stop();
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name;
        emit(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' ? 'no_camera' : 'error');
      }
    }

    // A hidden tab must not keep the camera on.
    const onVisibility = () => { if (document.visibilityState === 'hidden' && showing.current) { stop(); emit('idle'); } };
    document.addEventListener('visibilitychange', onVisibility);

    if (active) void start();
    else { stop(); emit('idle'); }
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisibility); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className={`relative aspect-video overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-gray-950)] ${className}`} data-testid="qr-viewfinder">
      <video ref={videoRef} className={live ? 'h-full w-full object-cover' : 'hidden'} muted playsInline aria-label={previewLabel} />
      {!live && (
        // gray-400 on gray-950 is about 7:1 (gray-600 was 2.45:1).
        <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-gray-400)]">
          <Camera aria-hidden="true" className="h-10 w-10" />
          <p className="text-sm">{offLabel}</p>
        </div>
      )}
      {live && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-48 w-48 rounded-[var(--radius-xl)] border-2 border-white/40" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
