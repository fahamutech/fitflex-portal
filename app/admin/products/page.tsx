'use client';

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Save } from 'lucide-react';
import { useApp } from '../../providers';
import { api, AdminProductDraft, ShopProduct, VendorSummary } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

const EMPTY_PRODUCT: AdminProductDraft = {
  vendorId: '', name: '', description: '', category: '', brand: '',
  priceTzs: 0, stock: 0, approvalStatus: 'pending', homepageVisible: false,
  homepagePriority: 0,
};

export default function ProductsPage() {
  const { token, user, t } = useApp();
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<AdminProductDraft>({ ...EMPTY_PRODUCT });

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const [productRows, vendorRows] = await Promise.all([
        api.adminProducts(token),
        api.adminVendors(token),
      ]);
      setProducts(productRows);
      setVendors(vendorRows);
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

  async function createProduct() {
    if (!token || !draft.vendorId || !draft.name.trim() || draft.priceTzs <= 0) return;
    setSavingId('new');
    setSuccess(null);
    try {
      const created = await api.createAdminProduct(token, draft);
      setProducts((current) => [created, ...current]);
      setDraft({ ...EMPTY_PRODUCT });
      setCreateOpen(false);
      setError(null);
      setSuccess(t('products.created'));
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
        actions={<div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.action.refresh')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />{t('products.create')}
          </Button>
        </div>}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('products.createTitle')}
        description={t('products.createDescription')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('products.vendor')}>
            <select aria-label={t('products.vendor')} className="ui-input" value={draft.vendorId} onChange={(event) => setDraft({ ...draft, vendorId: event.target.value })}>
              <option value="">{t('products.selectVendor')}</option>
              {vendors.filter((vendor) => vendor.approvalStatus === 'approved' && vendor.accountStatus === 'active').map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.vendorProfile?.businessName || vendor.displayName || vendor.email || vendor.id}</option>
              ))}
            </select>
          </Field>
          <Field label={t('products.name')}>
            <input aria-label={t('products.name')} className="ui-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t('products.category')}>
            <input aria-label={t('products.category')} className="ui-input" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
          </Field>
          <Field label={t('products.brand')}>
            <input aria-label={t('products.brand')} className="ui-input" value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} />
          </Field>
          <Field label={t('products.price')}>
            <input aria-label={t('products.price')} className="ui-input" type="number" min="1" value={draft.priceTzs || ''} onChange={(event) => setDraft({ ...draft, priceTzs: Number(event.target.value) || 0 })} />
          </Field>
          <Field label={t('products.stock')}>
            <input aria-label={t('products.stock')} className="ui-input" type="number" min="0" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) || 0 })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('products.productDescription')}>
              <textarea aria-label={t('products.productDescription')} className="ui-input min-h-24" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </Field>
          </div>
          <Field label={t('products.approval')}>
            <select aria-label={t('products.approval')} className="ui-input" value={draft.approvalStatus} onChange={(event) => setDraft({ ...draft, approvalStatus: event.target.value as AdminProductDraft['approvalStatus'] })}>
              <option value="pending">{t('products.pending')}</option>
              <option value="approved">{t('products.approved')}</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-3 text-sm text-[var(--color-fg-primary)]">
            <input type="checkbox" checked={draft.homepageVisible} onChange={(event) => setDraft({ ...draft, homepageVisible: event.target.checked })} />
            {t('listing.visible')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('admin.action.cancel')}</Button>
          <Button variant="primary" onClick={createProduct} disabled={savingId === 'new' || !draft.vendorId || !draft.name.trim() || draft.priceTzs <= 0}>
            {t('products.create')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
