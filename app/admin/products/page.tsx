'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ShopProduct } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from '@/components/shared';

export default function ProductsPage() {
  const { token, user, t } = useApp();
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setProducts(await api.adminProducts(token));
      setError(null);
    } catch {
      setError(t('products.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function updateDraft(id: string, patch: Partial<ShopProduct>) {
    setProducts((current) => current.map((product) => (
      product.id === id ? { ...product, ...patch } : product
    )));
  }

  async function save(product: ShopProduct) {
    if (!token) return;
    setSavingId(product.id);
    setSuccess(null);
    try {
      const updated = await api.updateProductListing(token, product.id, {
        homepageVisible: product.homepageVisible !== false,
        homepagePriority: Number(product.homepagePriority || 0),
        approvalStatus: product.approvalStatus || 'pending',
      });
      updateDraft(product.id, updated);
      setSuccess(t('products.saved'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('products.error'));
    } finally {
      setSavingId(null);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('products.title')}
        description={t('products.description')}
        actions={(
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.action.refresh')}
          </Button>
        )}
      />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : products.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-[var(--color-fg-tertiary)]">{t('products.empty')}</p></Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <Card key={product.id}>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_10rem_11rem_auto] md:items-end">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-[var(--color-fg-primary)]">{product.name}</h2>
                    <Badge tone={product.status === 'active' ? 'success' : 'gray'}>{product.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-fg-tertiary)]">
                    {t('products.vendor')}: {product.vendorId} · {t('products.stock')}: {product.stock}
                  </p>
                </div>
                <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--color-fg-primary)]">
                  <input
                    aria-label={`${t('listing.visible')}: ${product.name}`}
                    type="checkbox"
                    checked={product.homepageVisible !== false}
                    onChange={(event) => updateDraft(product.id, { homepageVisible: event.target.checked })}
                  />
                  {t('listing.visible')}
                </label>
                <Field label={t('products.approval')}>
                  <select
                    aria-label={`${t('products.approval')}: ${product.name}`}
                    className="ui-input"
                    value={product.approvalStatus || 'pending'}
                    onChange={(event) => updateDraft(product.id, { approvalStatus: event.target.value as ShopProduct['approvalStatus'] })}
                  >
                    <option value="pending">{t('products.pending')}</option>
                    <option value="approved">{t('products.approved')}</option>
                    <option value="rejected">{t('products.rejected')}</option>
                  </select>
                </Field>
                <Field label={t('listing.priority')} hint={t('listing.priorityHint')}>
                  <input
                    aria-label={`${t('listing.priority')}: ${product.name}`}
                    className="ui-input"
                    type="number"
                    min="0"
                    value={product.homepagePriority || 0}
                    onChange={(event) => updateDraft(product.id, { homepagePriority: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => save(product)}
                  disabled={savingId === product.id}
                >
                  <Save className="h-4 w-4" />
                  {t('products.save')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
