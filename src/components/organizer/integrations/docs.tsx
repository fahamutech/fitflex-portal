'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.7): the Docs tab. Static content; the code samples
// are not translated, every sentence is.
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { Button, Card, CardContent } from '@/components/shared';
import { useApp } from '../../../../app/providers';

const NODE_SAMPLE = `const crypto = require('crypto');
function verify(rawBody, headers, secret) {
  const ts = headers['x-fitflex-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex');
  return headers['x-fitflex-signature'].split(',').some(v => {
    const got = v.replace('v1=', '');
    return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  });
}`;
const PY_SAMPLE = `import hmac, hashlib, time
def verify(raw_body, headers, secret):
    ts = headers['X-FitFlex-Timestamp']
    if abs(time.time() - int(ts)) > 300: return False
    expected = hmac.new(secret.encode(), (ts + '.').encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(v.replace('v1=', ''), expected) for v in headers['X-FitFlex-Signature'].split(','))`;
const PHP_SAMPLE = `function verify($rawBody, $headers, $secret) {
  $ts = $headers['X-FitFlex-Timestamp'];
  if (abs(time() - (int)$ts) > 300) return false;
  $expected = hash_hmac('sha256', $ts . '.' . $rawBody, $secret);
  foreach (explode(',', $headers['X-FitFlex-Signature']) as $v) {
    if (hash_equals($expected, str_replace('v1=', '', $v))) return true;
  }
  return false;
}`;

function CodeBlock({ code, id }: { code: string; id: string }) {
  const { t } = useApp();
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 pr-20 text-xs" data-testid={`docs-code-${id}`}><code>{code}</code></pre>
      <Button variant="secondary" size="sm" className="absolute right-2 top-2" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => undefined); }}>
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />{done ? t('integrations.action.copied') : t('integrations.docs.copy')}
      </Button>
    </div>
  );
}

export function DocsTab() {
  const { t } = useApp();
  const base = `${API_BASE}/v1/organizer`;
  const steps = [
    { n: 1, text: t('integrations.docs.step1'), code: null },
    { n: 2, text: t('integrations.docs.step2'), code: `curl -X POST ${base}/token \\\n  -H 'content-type: application/json' \\\n  -d '{"grant_type":"client_credentials","client_id":"ffc_...","client_secret":"ffs_test_..."}'` },
    { n: 3, text: t('integrations.docs.step3'), code: `curl ${base}/events -H 'authorization: Bearer <access_token>'` },
    { n: 4, text: t('integrations.docs.step4'), code: `curl '${base}/events/<eventId>/registration-changes?cursor=' -H 'authorization: Bearer <access_token>'` },
    { n: 5, text: t('integrations.docs.step5'), code: null },
  ];
  const [sample, setSample] = useState<'node' | 'python' | 'php'>('node');
  return (
    <div className="space-y-4" data-testid="docs-tab">
      <Card><CardContent className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('integrations.docs.base')}</h2>
        <CodeBlock code={base} id="base" />
        <a href={`${base}/openapi.json`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--color-brand-700)] underline-offset-4 hover:underline">{t('integrations.docs.openapi')}</a>
      </CardContent></Card>
      <Card><CardContent className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('integrations.docs.quick')}</h2>
        <ol className="space-y-4">
          {steps.map(s => (
            <li key={s.n} className="space-y-2">
              <p className="text-sm text-[var(--color-fg-secondary)]"><span className="mr-2 font-semibold text-[var(--color-fg-primary)]">{s.n}.</span>{s.text}</p>
              {s.code && <CodeBlock code={s.code} id={`step${s.n}`} />}
            </li>
          ))}
        </ol>
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('integrations.docs.limits')}</p>
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('integrations.docs.sandbox')}</p>
      </CardContent></Card>
      <Card><CardContent className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('integrations.docs.signature')}</h2>
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('integrations.docs.signatureBody')}</p>
        <div className="flex gap-2" role="group" aria-label={t('integrations.docs.signature')}>
          {(['node', 'python', 'php'] as const).map(l => <Button key={l} size="sm" variant={sample === l ? 'primary' : 'secondary'} aria-pressed={sample === l} onClick={() => setSample(l)}>{l === 'node' ? 'Node' : l === 'python' ? 'Python' : 'PHP'}</Button>)}
        </div>
        <CodeBlock code={sample === 'node' ? NODE_SAMPLE : sample === 'python' ? PY_SAMPLE : PHP_SAMPLE} id={sample} />
      </CardContent></Card>
    </div>
  );
}
