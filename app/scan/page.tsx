'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, XCircle, Hash, User, Tag } from 'lucide-react';
import jsQR from 'jsqr';
import { useApp } from '../providers';
import { api, ApiError, CheckInResult } from '@/lib/api';
import { Button, Card, CardHeader, CardContent, Badge, PageHeader, Alert, Input, Field } from '@/components/shared';
import { MessageKey } from '@/lib/i18n';

const FAILURE_KEYS: Record<string, MessageKey> = {
  subscription_inactive: 'scan.fail.subscription_inactive',
  tier_not_covered:      'scan.fail.tier_not_covered',
  visits_exhausted:      'scan.fail.visits_exhausted',
  gym_closed:            'scan.fail.gym_closed',
  basic_daily_limit:     'scan.fail.basic_daily_limit',
  invalid_or_expired_qr: 'scan.fail.invalid_or_expired_qr',
  wrong_gym:             'scan.fail.wrong_gym',
  member_not_found:      'scan.fail.member_not_found',
  gym_not_found:         'scan.fail.gym_not_found',
  gym_not_verified:      'scan.fail.gym_not_verified',
  gym_required:          'scan.fail.gym_required',
  not_your_gym:          'scan.fail.not_your_gym',
  operator_not_assigned_to_gym: 'scan.fail.operator_not_assigned_to_gym',
  invalid_gym_qr:        'scan.fail.invalid_gym_qr',
  active_subscription_required: 'scan.fail.active_subscription_required',
  tier_not_configured:   'scan.fail.tier_not_configured',
};

/** What went wrong with the last scan, apart from a backend refusal code. */
type ScanProblem = 'network' | 'camera' | null;

/** The refusal code: check-in rules use `failure`, access checks use `error`. */
function refusalCode(body: unknown): string | null {
  const b = body as { failure?: unknown; error?: unknown } | null;
  const code = b?.failure ?? b?.error;
  return typeof code === 'string' && code ? code : null;
}

export default function ScanPage() {
  const { token, t } = useApp();
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [last, setLast]     = useState<CheckInResult | null>(null);
  const [problem, setProblem] = useState<ScanProblem>(null);
  const [manual, setManual] = useState('');
  const inFlight = useRef(false);

  useEffect(() => () => stopCamera(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
        tick();
      }
    } catch {
      setLast(null);
      setProblem('camera');
    }
  }

  function stopCamera() {
    const video  = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());
    if (video) video.srcObject = null;
    setStreaming(false);
  }

  function tick() {
    if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) {
      requestAnimationFrame(tick); return;
    }
    const video = videoRef.current, canvas = canvasRef.current;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code?.data && !inFlight.current) submit(code.data);
    if (videoRef.current?.srcObject) requestAnimationFrame(tick);
  }

  async function submit(qrToken: string) {
    if (!token) return;
    inFlight.current = true;
    try {
      const r = await api.checkIn(token, qrToken);
      setProblem(null);
      if (r?.ok) {
        setLast(r);
        stopCamera();
      } else {
        setLast({ ok: false, failure: refusalCode(r) ?? 'unknown' });
      }
    } catch (e) {
      if (e instanceof ApiError) {
        // Any answer from the backend is a refusal; never guess "QR expired".
        setProblem(null);
        setLast({ ok: false, failure: refusalCode(e.body) ?? `http_${e.status}` });
      } else {
        setLast(null);
        setProblem('network');
      }
    } finally {
      setTimeout(() => { inFlight.current = false; }, 2500);
    }
  }

  const failureCode  = last && !last.ok ? (last.failure ?? 'unknown') : null;
  const knownFailure = failureCode ? FAILURE_KEYS[failureCode] : undefined;
  const failureMsg   = failureCode ? t(knownFailure ?? 'scan.fail.unknown') : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('scan.heading')}
        description="Point the camera at the member's QR code to record a check-in."
      />

      {/* Camera card */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">Camera</h2>
          {streaming
            ? (
              <Button variant="secondary" size="sm" onClick={stopCamera}>
                <CameraOff className="h-4 w-4" />
                {t('scan.stop')}
              </Button>
            ) : (
              <Button size="sm" onClick={startCamera} data-testid="start-scan">
                <Camera className="h-4 w-4" />
                {t('scan.start')}
              </Button>
            )}
        </CardHeader>

        {/* Viewfinder */}
        <div className="relative mx-6 mb-6 aspect-video overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-gray-950)]">
          <video
            ref={videoRef}
            className={streaming ? 'h-full w-full object-cover' : 'hidden'}
            muted
            playsInline
          />
          {!streaming && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-gray-600)]">
              <Camera className="h-10 w-10" />
              <p className="text-sm">Camera is off</p>
            </div>
          )}
          {/* Scan overlay guide lines */}
          {streaming && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-[var(--radius-xl)] border-2 border-white/40" />
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </Card>

      {/* Manual token input */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">Manual entry</h2>
        </CardHeader>
        <CardContent>
          <Field label="QR token (for testing)" hint="Format: usr_xxx.<bucket>.<sig>">
            <div className="flex gap-2">
              <Input
                data-testid="manual-token"
                value={manual}
                onChange={e => setManual(e.target.value)}
                placeholder="usr_xxx.<bucket>.<sig>"
                className="font-mono"
              />
              <Button
                data-testid="manual-submit"
                onClick={() => manual && submit(manual)}
                disabled={!manual}
              >
                Submit
              </Button>
            </div>
          </Field>
        </CardContent>
      </Card>

      {/* Result card */}
      {last && (
        <div
          data-testid="scan-result"
          className={`rounded-[var(--radius-xl)] border-2 p-5 ${
            last.ok
              ? 'border-[var(--color-success-300)] bg-[var(--color-success-50)]'
              : 'border-[var(--color-error-300)]   bg-[var(--color-error-50)]'
          }`}
        >
          <div className="flex items-start gap-4">
            {last.ok
              ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-success-600)]" />
              : <XCircle     className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-error-600)]" />}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={last.ok ? 'success' : 'danger'} dot>
                  {last.ok ? t('scan.success') : t('scan.fail')}
                </Badge>
              </div>
              {last.ok && last.checkin && (
                <div className="grid gap-1.5 text-sm text-[var(--color-success-800)]">
                  <div className="flex items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 opacity-60" />
                    Visit #{last.checkin.visitNumberInCycle ?? '—'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 opacity-60" />
                    {last.checkin.passTier ?? 'Direct subscription'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 opacity-60" />
                    {last.checkin.memberPublicId ?? last.checkin.memberId}
                  </div>
                </div>
              )}
              {!last.ok && failureMsg && (
                <p data-testid="scan-failure-message" className="text-sm text-[var(--color-error-700)]">{failureMsg}</p>
              )}
              {!last.ok && failureCode && !knownFailure && (
                <p data-testid="scan-failure-code" className="font-mono text-xs text-[var(--color-error-600)]">
                  {t('scan.fail.code')}: {failureCode}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Camera or network problem — distinct from a backend refusal */}
      {problem && (
        <div data-testid="scan-problem">
          <Alert tone="error">
            {t(problem === 'network' ? 'scan.fail.network' : 'scan.fail.camera')}
          </Alert>
        </div>
      )}
    </div>
  );
}
