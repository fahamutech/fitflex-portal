'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, XCircle, Hash, User, Tag, Info } from 'lucide-react';
import jsQR from 'jsqr';
import { useApp } from '../providers';
import { api, ApiError, CheckInResult, Gym } from '@/lib/api';
import { Button, Card, CardHeader, CardContent, Badge, PageHeader, Alert, Input, Field, Select } from '@/components/shared';
import { MessageKey } from '@/lib/i18n';
import { sellableFrom } from '@/lib/pass-tiers';

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

/** Per-browser memory of the gym a multi-gym operator scans for (per signed-in user). */
const gymKey = (userId?: string) => `fitflex.scan.gymId.${userId ?? 'anon'}`;
function readStoredGym(userId?: string): string | null {
  try { return localStorage.getItem(gymKey(userId)); } catch { return null; }
}
function writeStoredGym(userId: string | undefined, gymId: string | null) {
  try {
    if (gymId) localStorage.setItem(gymKey(userId), gymId);
    else localStorage.removeItem(gymKey(userId));
  } catch { /* storage blocked: the choice just isn't remembered */ }
}

/** The refusal code: check-in rules use `failure`, access checks use `error`. */
function refusalCode(body: unknown): string | null {
  const b = body as { failure?: unknown; error?: unknown } | null;
  const code = b?.failure ?? b?.error;
  return typeof code === 'string' && code ? code : null;
}

export default function ScanPage() {
  const { token, user, t } = useApp();
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [last, setLast]     = useState<CheckInResult | null>(null);
  const [problem, setProblem] = useState<ScanProblem>(null);
  // The operator's gyms (null while loading). With more than one, or if the
  // backend says gym_required, a gym must be chosen before scanning.
  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [gymsFailed, setGymsFailed] = useState(false);
  const [gymRequired, setGymRequired] = useState(false);
  const [gymId, setGymId] = useState('');
  const userId = user?.id;

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.ownerGyms(token)
      .then(list => {
        if (!live) return;
        const rows = Array.isArray(list) ? list : [];
        setGyms(rows);
        const stored = readStoredGym(userId);
        if (stored && rows.some(g => g.id === stored)) setGymId(stored);
        else if (stored) writeStoredGym(userId, null); // no longer one of theirs
      })
      .catch(() => { if (live) { setGyms([]); setGymsFailed(true); } });
    return () => { live = false; };
  }, [token, userId]);

  const showPicker = !!gyms && gyms.length > 0 && (gyms.length > 1 || gymRequired);
  const gymsLoading = gyms === null;
  const canScan = !gymsLoading && (!showPicker || !!gymId);
  // The camera loop reads these through a ref, so it always sees the latest choice.
  const scanGym = useRef({ canScan, gymId: showPicker ? gymId : '' });
  scanGym.current = { canScan, gymId: showPicker ? gymId : '' };

  function chooseGym(id: string) {
    setGymId(id);
    writeStoredGym(userId, id || null);
    if (last && !last.ok && last.failure === 'gym_required') setLast(null);
  }
  const [manual, setManual] = useState('');
  const inFlight = useRef(false);
  // The result sits above the camera; a new one is scrolled into view so it is never below the fold.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [resultSeq, setResultSeq] = useState(0);
  useEffect(() => {
    if (resultSeq) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [resultSeq]);
  // Pass tier names as set in Settings ("premium" → "Premium"); the key, capitalised, if it isn't listed.
  const [tierLabels, setTierLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    api.subscriptionTiers()
      .then(rows => { if (live) setTierLabels(Object.fromEntries(sellableFrom(rows).map(x => [x.key, x.label || x.key]))); })
      .catch(() => { /* fall back to the key */ });
    return () => { live = false; };
  }, []);
  const tierLabel = (key: string) => tierLabels[key] ?? key.charAt(0).toLocaleUpperCase() + key.slice(1).replace(/_/g, ' ');

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
      setResultSeq(n => n + 1);
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
    if (!token || !scanGym.current.canScan) return;
    inFlight.current = true;
    try {
      const r = await api.checkIn(token, qrToken, scanGym.current.gymId || undefined);
      setProblem(null);
      if (r?.ok) {
        setLast(r);
        stopCamera();
      } else {
        setLast({ ok: false, failure: refusalCode(r) ?? 'unknown' });
      }
      setResultSeq(n => n + 1);
    } catch (e) {
      if (e instanceof ApiError) {
        // Any answer from the backend is a refusal; never guess "QR expired".
        setProblem(null);
        const code = refusalCode(e.body) ?? `http_${e.status}`;
        if (code === 'gym_required') { setGymRequired(true); setGymId(''); stopCamera(); }
        setLast({ ok: false, failure: code });
        setResultSeq(n => n + 1);
      } else {
        setLast(null);
        setProblem('network');
        setResultSeq(n => n + 1);
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
        description={t('scan.subtitle')}
      />

      {gymsFailed && <Alert tone="error">{t('scan.gym.loadFailed')}</Alert>}

      {/* Gym choice for operators who work at more than one gym */}
      {showPicker && (
        <Card>
          <CardContent>
            <Field label={t('scan.gym.label')} hint={t('scan.gym.hint')} required>
              <Select
                data-testid="scan-gym-select"
                value={gymId}
                onChange={e => chooseGym(e.target.value)}
              >
                <option value="">{t('scan.gym.placeholder')}</option>
                {gyms!.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
          </CardContent>
        </Card>
      )}

      {/* Result card. A repeat same-day scan is information (blue), not a fresh check-in (green). */}
      {last && (
        <div
          ref={resultRef}
          role="status"
          data-testid="scan-result"
          data-tone={!last.ok ? 'error' : last.idempotent ? 'info' : 'success'}
          className={`rounded-[var(--radius-xl)] border-2 p-5 ${
            !last.ok
              ? 'border-[var(--color-error-300)]   bg-[var(--color-error-50)]'
              : last.idempotent
                ? 'border-[var(--color-info-300)] bg-[var(--color-info-50)]'
                : 'border-[var(--color-success-300)] bg-[var(--color-success-50)]'
          }`}
        >
          <div className="flex items-start gap-4">
            {!last.ok
              ? <XCircle      aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-error-600)]" />
              : last.idempotent
                ? <Info         aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-info-700)]" />
                : <CheckCircle2 aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-success-600)]" />}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={!last.ok ? 'danger' : last.idempotent ? 'info' : 'success'} dot>
                  {/* A repeat scan at the same gym the same day returns the visit already recorded (idempotent). */}
                  {last.ok ? t(last.idempotent ? 'scan.already' : 'scan.success') : t('scan.fail')}
                </Badge>
              </div>
              {last.ok && last.idempotent && (
                <p data-testid="scan-already" className="text-sm text-[var(--color-info-800)]">{t('scan.alreadyBody')}</p>
              )}
              {last.ok && last.checkin && (
                <div className={`grid gap-1.5 text-sm ${last.idempotent ? 'text-[var(--color-info-800)]' : 'text-[var(--color-success-800)]'}`}>
                  {!last.idempotent && (
                    <div className="flex items-center gap-1.5" data-testid="scan-visit-number">
                      <Hash aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
                      {t('scan.visitNumber').replace('{n}', String(last.checkin.visitNumberInCycle ?? '—'))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5" data-testid="scan-tier">
                    <Tag aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
                    {last.checkin.passTier ? tierLabel(last.checkin.passTier) : t('scan.gymMembership')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
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
      {/* Camera card */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('scan.camera')}</h2>
          {streaming
            ? (
              <Button variant="secondary" size="sm" onClick={stopCamera}>
                <CameraOff className="h-4 w-4" />
                {t('scan.stop')}
              </Button>
            ) : (
              <Button size="sm" onClick={startCamera} data-testid="start-scan" disabled={!canScan}>
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
            // gray-400 on gray-950 is about 7:1 (gray-600 was 2.45:1).
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-gray-400)]">
              <Camera aria-hidden="true" className="h-10 w-10" />
              <p className="text-sm">{t('scan.cameraOff')}</p>
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
          <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('scan.manual')}</h2>
        </CardHeader>
        <CardContent>
          <Field label={t('scan.manualLabel')} hint={t('scan.manualHint')}>
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
                disabled={!manual || !canScan}
              >
                {t('scan.submit')}
              </Button>
            </div>
          </Field>
        </CardContent>
      </Card>

    </div>
  );
}
