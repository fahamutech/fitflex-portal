'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, ReactNode, useState } from 'react';
import {
  LayoutDashboard,
  QrCode,
  ClipboardList,
  LogOut,
  ChevronRight,
  Menu,
  X,
  Settings,
  Globe,
  Building2,
  Users,
  UserCheck,
  Dumbbell,
  CreditCard,
  ShieldCheck,
  BadgeCheck,
  BarChart3,
  LineChart,
  Activity,
  BookOpen,
  UserCog,
  BriefcaseBusiness,
  ShoppingBag,
  Store,
  Trophy,
  Gift,
  Flag,
  Building,
  Network,
  Megaphone,
  Star,
  HandCoins,
  SlidersHorizontal,
  Undo2, Receipt, KeyRound, ShieldAlert, Images, Landmark, Percent, CalendarCheck
} from 'lucide-react';
import { useApp } from '../../app/providers';
import { ChangePasswordGate } from './change-password-gate';
import { cn } from '@/lib/cn';
import { VENDOR_USER_TYPES, type VendorTools } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { fmt, VENDOR_AREAS, vendorAreaOpen } from '@/lib/vendor';
import { Alert, Avatar, Badge, Button, Card, CardContent, SkeletonCard, useToast } from './shared';
import { useVendor } from './vendor-context';
import { BrandLogo } from './brand-logo';
import { LanguageToggle } from './language-toggle';
import { PhotoPanel } from './photo-panel';
import { HERO_IMAGES_ADMIN, PHOTO_HERO_UI } from '@/lib/flags';
import { useShopBannersAvailable } from './shop-banners-gate';
import { useTaxRatesAvailable } from './tax-rates-gate';

/** SHOP_BANNERS as /vendor/me reports it (tools.merch.banners); undefined when the server doesn't say. */
const vendorBannersTool = (tools: VendorTools | null | undefined) => {
  const merch = tools?.merch as { banners?: unknown } | undefined;
  return typeof merch?.banners === 'boolean' ? merch.banners : undefined;
};

/* ── Nav definitions ─────────────────────────────────────── */
type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  groupKey?: string;
  aclScope?: string; // required ACL scope for portal staff; undefined = super-admin only
  aclAny?: string[]; // other scopes that also open the page
  /** A count pill (e.g. low stock) and the accessible name that says what it counts. */
  count?: { n: number; labelKey: MessageKey; tone: 'warning' | 'fuel' };
};
const scopesOf = (item: NavItem) => [item.aclScope, ...(item.aclAny ?? [])].filter(Boolean) as string[];

// Section roots highlight only on themselves, not on their sub-pages.
const ROOTS = new Set(['/admin', '/hr', '/org', '/vendor']);

// Someone who looks after a B2B organisation's billing: that, and nothing else.
// What each role is offered; the server decides what each page shows.
const ORG_PEOPLE = new Set(['owner', 'admin', 'manager', 'hr', 'analyst']);
const ORG_BILLING = new Set(['owner', 'admin', 'finance']);
const ORG_INSIGHTS = new Set(['owner', 'admin', 'manager', 'hr', 'finance', 'analyst']);
const orgNav = (roles?: string[]): NavItem[] => [
  ...(!roles || roles.some(r => ORG_INSIGHTS.has(r)) ? [{ href: '/org/insights', labelKey: 'org.nav.insights', icon: LineChart }] : []),
  ...(!roles || roles.some(r => ORG_PEOPLE.has(r)) ? [{ href: '/org/people', labelKey: 'org.nav.people', icon: Users }] : []),
  { href: '/org/programmes', labelKey: 'org.nav.programmes', icon: Network },
  // Challenges, the rewards they earn, and groups: the same roles that see people.
  ...(!roles || roles.some(r => ORG_PEOPLE.has(r)) ? [
    { href: '/org/challenges', labelKey: 'hr.nav.challenges', icon: Trophy },
    { href: '/org/rewards', labelKey: 'hr.nav.rewards', icon: Gift },
    { href: '/org/groups', labelKey: 'hr.nav.groups', icon: UserCheck },
  ] : []),
  ...(!roles || roles.some(r => ORG_BILLING.has(r)) ? [{ href: '/org', labelKey: 'org.nav.billing', icon: Receipt }] : []),
];

// Company HR: their company's wellness challenges, nothing else.
const HR_NAV: NavItem[] = [
  { href: '/hr', labelKey: 'hr.nav.challenges', icon: Trophy },
  { href: '/hr/rewards', labelKey: 'hr.nav.rewards', icon: Gift },
  { href: '/hr/groups', labelKey: 'hr.nav.groups', icon: Users },
  { href: '/hr/people', labelKey: 'hr.nav.people', icon: UserCheck },
  { href: '/hr/programmes', labelKey: 'hr.nav.programmes', icon: Network },
  { href: '/hr/insights', labelKey: 'org.nav.insights', icon: LineChart },
];

const OPERATOR_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard',  icon: LayoutDashboard },
  { href: '/scan',      labelKey: 'nav.scan',       icon: QrCode },
  { href: '/checkins',  labelKey: 'nav.checkins',   icon: ClipboardList },
  { href: '/owner/manage', labelKey: 'nav.manageGym', icon: BriefcaseBusiness },
  // Owners always; gym staff only with the communications permission.
  { href: '/owner/communications', labelKey: 'nav.communications', icon: Megaphone, aclScope: 'communications' },
  // Owners always; gym staff only with the gyms permission (read-only).
  { href: '/owner/reviews', labelKey: 'nav.reviews', icon: Star, aclScope: 'gyms' },
  // Owners always; gym staff only with the payments permission (read-only).
  { href: '/owner/statements', labelKey: 'nav.statements', icon: HandCoins, aclScope: 'payments' },
];

// A business that sells on FitFlex (vendor portal, S2): each item needs its permission.
function vendorNav(permissions: string[], tools: VendorTools | null | undefined, lowCount: number | null, waitingCount: number | null, bannersOn = false): NavItem[] {
  const icons: Record<string, React.ElementType> = { '/vendor': LayoutDashboard, '/vendor/products': ShoppingBag, '/vendor/promotions': Megaphone, '/vendor/orders': ClipboardList, '/vendor/sales': Receipt, '/vendor/customers': Users, '/vendor/payouts': HandCoins, '/vendor/settings/tax': Landmark };
  const labels: Record<string, string> = { '/vendor': 'vendor.nav.dashboard', '/vendor/products': 'vendor.nav.products', '/vendor/promotions': 'merch.nav', '/vendor/orders': 'vendor.nav.orders', '/vendor/sales': 'vendor.nav.sales', '/vendor/customers': 'vendor.nav.customers', '/vendor/payouts': 'vendor.nav.payouts', '/vendor/settings/tax': 'vendor.tax.title' };
  // S5: Settings → Tax details (VAT on; owner or staff with `payments`).
  const groups: Record<string, string> = { '/vendor/settings/tax': 'vendor.nav.group.settings' };
  return VENDOR_AREAS.filter(a => a.nav !== false && vendorAreaOpen(a, permissions, tools) && (a.href !== '/vendor/promotions' || bannersOn)).map(a => ({
    href: a.href, labelKey: labels[a.href], icon: icons[a.href], ...(groups[a.href] ? { groupKey: groups[a.href] } : {}),
    ...(a.href === '/vendor/products' && lowCount ? { count: { n: lowCount, labelKey: 'vendor.nav.productsLow' as MessageKey, tone: 'warning' as const } } : {}),
    ...(a.href === '/vendor/orders' && waitingCount ? { count: { n: waitingCount, labelKey: 'vendor.nav.ordersWaiting' as MessageKey, tone: 'fuel' as const } } : {}),
  }));
}

/** Where each kind of session lives. */
export function homeFor(user: { userType?: string } | null | undefined) {
  if (!user) return '/login';
  if (VENDOR_USER_TYPES.has(user.userType ?? '')) return '/vendor';
  if (user.userType === 'admin') return '/admin';
  if (user.userType === 'corporate_hr') return '/hr';
  return '/dashboard';
}

/** The signed-in person's role, in the chosen language. */
function roleLabel(t: (key: MessageKey) => string, user: { userType?: string; portalUser?: boolean; organizationUser?: boolean } | null) {
  const type = user?.userType ?? '';
  const base = type === 'vendor' ? t('vendor.role.owner')
    : type === 'vendor_staff' ? t('vendor.role.staff')
    : type === 'admin' ? t('shell.role.admin')
    : type === 'corporate_hr' ? t('nav.personaHr')
    : user?.organizationUser ? t('shell.role.organization')
    : type === 'gym_operator' ? t('nav.personaOwner')
    : type === 'gym_staff' ? t('nav.personaStaff')
    : type;
  return user?.portalUser ? `${base} · ${t('shell.role.staffSuffix')}` : base;
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',               labelKey: 'admin.nav.overview',       icon: LayoutDashboard, groupKey: 'nav.group.platform' },
  { href: '/admin/gyms',          labelKey: 'admin.nav.gyms',           icon: Building2,       groupKey: 'nav.group.platform', aclScope: 'gyms' },
  { href: '/admin/owners',        labelKey: 'admin.nav.owners',         icon: UserCheck,       groupKey: 'nav.group.platform', aclScope: 'owners' },
  { href: '/admin/members',       labelKey: 'admin.nav.members',        icon: Users,           groupKey: 'nav.group.platform', aclScope: 'members' },
  { href: '/admin/analytics',     labelKey: 'admin.nav.analytics',      icon: LineChart,       groupKey: 'nav.group.platform', aclScope: 'analytics' },
  { href: '/admin/challenges',    labelKey: 'admin.nav.challenges',     icon: Trophy,          groupKey: 'nav.group.platform', aclScope: 'challenges' },
  { href: '/admin/rewards',       labelKey: 'admin.nav.rewards',        icon: Gift,            groupKey: 'nav.group.platform', aclScope: 'rewards' },
  { href: '/admin/exercises',     labelKey: 'admin.nav.exercises',      icon: Dumbbell,        groupKey: 'nav.group.platform', aclScope: 'exercises' },
  // App photos (spec photo-hero-screens §36): only in builds with NEXT_PUBLIC_HERO_IMAGES_ADMIN=true.
  ...(HERO_IMAGES_ADMIN ? [{ href: '/admin/hero-images', labelKey: 'admin.nav.heroImages', icon: Images, groupKey: 'nav.group.platform', aclScope: 'brand_media' }] : []),
  { href: '/admin/social',        labelKey: 'admin.nav.social',         icon: Flag,            groupKey: 'nav.group.platform', aclScope: 'social' },
  { href: '/admin/reviews',       labelKey: 'admin.nav.reviews',        icon: Star,            groupKey: 'nav.group.platform', aclScope: 'social' },
  { href: '/admin/communications', labelKey: 'admin.nav.communications', icon: Megaphone,     groupKey: 'nav.group.platform', aclScope: 'communications' },
  { href: '/admin/corporate',     labelKey: 'admin.nav.corporate',      icon: Building,        groupKey: 'nav.group.platform', aclScope: 'corporate' },
  { href: '/admin/b2b',           labelKey: 'admin.nav.b2b',            icon: Network,         groupKey: 'nav.group.platform', aclScope: 'b2b' },
  { href: '/admin/b2b-analytics', labelKey: 'admin.nav.b2bAnalytics',   icon: LineChart,       groupKey: 'nav.group.platform', aclScope: 'b2b' },
  { href: '/admin/b2b-ops',       labelKey: 'admin.nav.b2bOps',         icon: Activity,        groupKey: 'nav.group.platform', aclScope: 'b2b', aclAny: ['b2b_billing', 'b2b_billing_approve', 'b2b_payments'] },
  { href: '/admin/trainers',      labelKey: 'admin.nav.trainers',       icon: Dumbbell,        groupKey: 'nav.group.platform', aclScope: 'trainers' },
  { href: '/admin/trainer-sessions', labelKey: 'admin.nav.trainerSessions', icon: CalendarCheck, groupKey: 'nav.group.platform', aclScope: 'trainers' },
  { href: '/admin/products',      labelKey: 'admin.nav.products',       icon: ShoppingBag,     groupKey: 'nav.group.platform', aclScope: 'shop' },
  { href: '/admin/vendors',       labelKey: 'admin.nav.vendors',        icon: Store,           groupKey: 'nav.group.platform', aclScope: 'shop' },
  { href: '/admin/promotion-overview', labelKey: 'admin.nav.promotionOverview', icon: LineChart, groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve', 'campaigns'] },
  { href: '/admin/moderation',    labelKey: 'admin.nav.moderation',     icon: ShieldAlert,     groupKey: 'nav.group.promotion', aclScope: 'moderation', aclAny: ['moderation_decide'] },
  { href: '/admin/promotions',    labelKey: 'admin.nav.promotions',     icon: Megaphone,       groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve', 'campaigns'] },
  // Shop banners (Phase 2 S1): shown only while the server has SHOP_BANNERS on (see visibleNav).
  { href: '/admin/shop-merch',    labelKey: 'admin.nav.shopMerch',      icon: Images,          groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve'] },
  { href: '/admin/promotion-campaigns', labelKey: 'admin.nav.promotionCampaigns', icon: Flag,   groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve', 'campaigns'] },
  { href: '/admin/promotion-analytics', labelKey: 'admin.nav.promotionAnalytics', icon: BarChart3, groupKey: 'nav.group.promotion', aclScope: 'promotion_analytics' },
  { href: '/admin/promotion-limits', labelKey: 'admin.nav.promotionLimits', icon: SlidersHorizontal, groupKey: 'nav.group.promotion', aclScope: 'campaigns', aclAny: ['promotions', 'promotions_approve'] },
  { href: '/admin/distributions', labelKey: 'admin.nav.distributions',  icon: BarChart3,       groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/settlements',   labelKey: 'admin.nav.settlements',    icon: HandCoins,       groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/trainer-settlements', labelKey: 'admin.nav.trainerSettlements', icon: Dumbbell, groupKey: 'nav.group.finance', aclScope: 'payments' },
  { href: '/admin/vendor-settlements', labelKey: 'admin.nav.vendorSettlements', icon: Store, groupKey: 'nav.group.finance', aclScope: 'payments' },
  { href: '/admin/settlement-config', labelKey: 'admin.nav.settlementConfig', icon: SlidersHorizontal, groupKey: 'nav.group.finance', aclScope: 'payments' },
  { href: '/admin/b2b-billing',   labelKey: 'admin.nav.b2bBilling',     icon: Receipt,         groupKey: 'nav.group.finance',  aclScope: 'b2b_billing', aclAny: ['b2b', 'b2b_billing_approve', 'b2b_payments'] },
  // S5: VAT rates with maker ≠ checker; shown only while the server has VAT on (useTaxRatesAvailable).
  { href: '/admin/tax-rates',     labelKey: 'admin.nav.taxRates',       icon: Percent,         groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/book-keeping',  labelKey: 'admin.nav.bookkeeping',    icon: BookOpen,        groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/payments',      labelKey: 'admin.nav.payments',       icon: CreditCard,      groupKey: 'nav.group.operations', aclScope: 'payments' },
  { href: '/admin/refunds',       labelKey: 'admin.nav.refunds',        icon: Undo2,           groupKey: 'nav.group.operations', aclScope: 'payments' },
  { href: '/admin/kyc',           labelKey: 'admin.nav.kyc',            icon: BadgeCheck,      groupKey: 'nav.group.operations', aclScope: 'kyc' },
  { href: '/admin/account-recovery', labelKey: 'admin.nav.accountRecovery', icon: KeyRound,    groupKey: 'nav.group.operations', aclScope: 'account_recovery' },
  { href: '/admin/approvals',     labelKey: 'admin.nav.approvals',      icon: ShieldCheck,     groupKey: 'nav.group.operations', aclScope: 'approvals' },
  { href: '/admin/settings',      labelKey: 'admin.nav.settings',       icon: Settings,        groupKey: 'nav.group.system',   aclScope: 'settings' },
  { href: '/admin/users',         labelKey: 'admin.nav.users',          icon: UserCog,         groupKey: 'nav.group.system',   aclScope: 'users' },
];

/* ── SidebarLink ─────────────────────────────────────────── */
function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
  count,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick?: () => void;
  count?: { n: number; label: string; tone: 'warning' | 'fuel' };
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={count ? count.label : undefined}
      className={cn(
        'group flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--color-sidebar-active)] text-[var(--color-sidebar-text-active)] font-semibold'
          : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-white',
      )}
    >
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 1.75} />
      <span className="flex-1 truncate" title={label}>{label}</span>
      {count && (
        <span
          aria-hidden="true"
          title={count.label}
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
            count.tone === 'fuel' ? 'bg-[var(--color-fuel-on-dark)] text-[var(--color-on-volt)]' : 'bg-[var(--color-warning-100)] text-[var(--color-warning-800)]',
          )}
        >
          {count.n > 99 ? '99+' : count.n}
        </span>
      )}
      {active && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 opacity-60" />}
    </Link>
  );
}

function resolveLabel(t: (key: any) => string, key: string): string {
  const resolved = t(key);
  // If translation returns the key itself, fall back to a human-readable version
  return resolved === key ? key.split('.').pop()?.replace(/([A-Z])/g, ' $1').trim() || key : resolved;
}

/* ── Sidebar content (shared by mobile drawer + desktop) ─── */
function SidebarContent({
  nav,
  onLinkClick,
}: {
  nav: NavItem[];
  onLinkClick?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, user, signOut, locale, setLocale, switchablePersonas, switchPersona } = useApp();
  const vendor = useVendor();
  const isVendor = VENDOR_USER_TYPES.has(user?.userType ?? '');
  const businessName = vendor.me?.businessName || t('vendor.shell.unnamed');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Identity V2: move this session onto another portal persona of the same Person.
  async function onSwitchPersona(personaId: string) {
    if (!personaId) return;
    setSwitching(true); setSwitchError(null);
    try {
      const next = await switchPersona(personaId);
      router.replace(homeFor(next));
    } catch {
      setSwitchError(t('nav.switchRoleFailed'));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4 border-b border-[var(--color-gray-800)]">
        <BrandLogo className="h-8 w-8 rounded-[var(--radius-md)]" />
        <div className="flex-1 min-w-0">
          {isVendor ? (
            <>
              <p className="truncate text-sm font-semibold text-white" title={businessName} data-testid="vendor-business-name">{businessName}</p>
              <p className="truncate text-xs text-[var(--color-gray-400)]">{t('vendor.shell.subtitle')}</p>
            </>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-white">FitFlex Af</p>
              <p className="truncate text-xs text-[var(--color-gray-400)]">
                {user?.userType === 'admin' ? t('shell.subtitle.admin') : user?.userType === 'corporate_hr' || user?.organizationUser ? t('shell.subtitle.business') : t('shell.subtitle.operator')}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Nav items */}
      <nav aria-label={t('common.mainNavigation')} className="flex-1 overflow-y-auto px-3 py-4">
        {(() => {
          const groups: string[] = [];
          nav.forEach(item => { if (item.groupKey && !groups.includes(item.groupKey)) groups.push(item.groupKey); });
          const ungrouped = nav.filter(item => !item.groupKey);
          return (
            <>
              {ungrouped.map(item => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={resolveLabel(t, item.labelKey)}
                  icon={item.icon}
                  active={ROOTS.has(item.href) ? pathname.replace(/\/$/, '') === item.href : (pathname === item.href || pathname.startsWith(item.href + '/'))}
                  onClick={onLinkClick}
                  count={item.count ? { n: item.count.n, tone: item.count.tone, label: fmt(t(item.count.labelKey), { n: item.count.n }) } : undefined}
                />
              ))}
              {groups.map(groupKey => (
                <div key={groupKey} className="mt-4">
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-400)]">{resolveLabel(t, groupKey)}</p>
                  {nav.filter(item => item.groupKey === groupKey).map(item => (
                    <SidebarLink
                      key={item.href}
                      href={item.href}
                      label={resolveLabel(t, item.labelKey)}
                      icon={item.icon}
                      active={ROOTS.has(item.href) ? pathname.replace(/\/$/, '') === item.href : (pathname === item.href || pathname.startsWith(item.href + '/'))}
                      onClick={onLinkClick}
                    />
                  ))}
                </div>
              ))}
            </>
          );
        })()}
      </nav>

      {/* Footer */}
      <div className="shrink-0 px-3 py-4 border-t border-[var(--color-gray-800)] space-y-1">
        {/* Locale toggle */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Globe aria-hidden="true" className="h-4 w-4 text-[var(--color-gray-400)]" />
          <select
            data-testid="locale-select"
            aria-label={t('common.language')}
            value={locale}
            onChange={e => setLocale(e.target.value as 'en' | 'sw')}
            className="min-h-11 flex-1 bg-transparent text-xs text-[var(--color-gray-400)] border-none outline-none cursor-pointer"
          >
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </div>

        {/* Identity V2: switch role, only when another portal persona exists */}
        {switchablePersonas.length > 0 && (
          <div className="px-3 py-2" data-testid="persona-switcher">
            <label className="block text-xs uppercase tracking-wide text-[var(--color-gray-400)]" htmlFor="persona-select">
              {t('nav.switchRole')}
            </label>
            <select
              id="persona-select"
              data-testid="persona-select"
              disabled={switching}
              value=""
              onChange={e => onSwitchPersona(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius-sm)] bg-[var(--color-gray-800)] px-2 py-1 text-xs text-white border-none outline-none cursor-pointer"
            >
              <option value="" disabled>{t('nav.switchRoleChoose')}</option>
              {switchablePersonas.map(p => (
                <option key={p.id} value={p.id}>
                  {p.userType === 'corporate_hr' ? t('nav.personaHr') : p.userType === 'gym_staff' ? t('nav.personaStaff') : p.userType === 'vendor' ? t('nav.personaVendor') : p.userType === 'vendor_staff' ? t('nav.personaVendorStaff') : t('nav.personaOwner')}
                  {p.approvalStatus === 'pending_approval' ? ` · ${t('nav.personaPending')}` : ''}
                </option>
              ))}
            </select>
            {switchError && <p className="mt-1 text-xs text-[var(--color-error-300)]" role="alert">{switchError}</p>}
          </div>
        )}

        {/* Staff are managed in the app (no web staff screen in S2). */}
        {isVendor && vendor.can('staff') && (
          <p className="px-3 py-1 text-xs text-[var(--color-gray-400)]" data-testid="vendor-staff-in-app">{t('vendor.shell.staffInApp')}</p>
        )}

        {/* User row + sign out */}
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2">
          <Avatar name={(user as any)?.displayName || user?.email || user?.id || 'User'} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-white">{(user as any)?.displayName || user?.email || user?.id || '—'}</p>
            <p className="truncate text-xs text-[var(--color-gray-400)]" data-testid="shell-role">{roleLabel(t, user)}</p>
          </div>
          <button
            onClick={() => { signOut(); router.replace('/login'); }}
            className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-gray-400)] hover:text-white transition-colors"
            title={t('nav.signout')}
            aria-label={t('nav.signout')}
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────── */
export function Shell({ children }: { children: ReactNode }) {
  const { ready, token, user, hasPermission, signOut, t, passwordChangeRequired } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const isAdminUser   = token && user?.userType === 'admin';
  const isHr          = token && user?.userType === 'corporate_hr';
  const isOrgUser     = token && user?.organizationUser === true && user?.userType !== 'admin';
  const isPortalStaff = isAdminUser && user?.portalUser === true;
  const isVendor      = !!token && VENDOR_USER_TYPES.has(user?.userType ?? '');
  const bannersOn = useShopBannersAvailable(
    isVendor ? 'vendor' : 'admin', token,
    isVendor ? vendor.status === 'ready' && !!vendor.me?.permissions?.includes('products') : !!isAdminUser && (hasPermission('promotions') || hasPermission('promotions_approve')),
    isVendor ? vendorBannersTool(vendor.me?.tools) : undefined,
  );

  const taxRatesOn = useTaxRatesAvailable(token, !!isAdminUser && hasPermission('payments'));

  // Build the visible nav — portal staff only see items their ACL permits.
  // Overview (/admin) is always visible to all admin users.
  const visibleNav = isVendor
    ? (vendor.status === 'ready' ? vendorNav(vendor.me?.permissions ?? [], vendor.me?.tools, vendor.lowCount, vendor.waitingCount, bannersOn) : [])
    : isAdminUser
    ? ADMIN_NAV.filter(item => {
        if (item.href === '/admin/shop-merch' && !bannersOn) return false;
        if (item.href === '/admin/tax-rates' && !taxRatesOn) return false;
        if (!item.aclScope) return true;             // no scope = super-admin only (overview)
        if (!isPortalStaff) return true;             // super-admin sees everything
        return scopesOf(item).some(hasPermission);   // portal staff: check ACL
      })
    : isOrgUser ? orgNav(user?.organizationRoles)
    : isHr ? HR_NAV
    : OPERATOR_NAV.filter(item => !item.aclScope || user?.userType !== 'gym_staff' || hasPermission(item.aclScope));

  // Where this person must go instead of the current page, or null when they may see it. One decision
  // drives both the redirect and the render: a page's content (and its requests) waits until it passes.
  const path = pathname.replace(/\/$/, '') || '/';
  const vendorPermissionMissing = (() => {
    if (!isVendor || vendor.status !== 'ready') return false;
    const area = [...VENDOR_AREAS].reverse().find(a => path === a.href || path.startsWith(`${a.href}/`));
    // Its permission and, where it has one, its tool (S3 sales: walkInSales) — both fail closed.
    return !!area && !vendorAreaOpen(area, vendor.me?.permissions ?? [], vendor.me?.tools);
  })();
  const redirectTo = ((): string | null => {
    if (!ready) return null;
    if (!token) return path !== '/login' && path !== '/' ? '/login' : null;

    // A business (vendor or vendor staff) only ever sees /vendor; nobody else does.
    const inVendorArea = path === '/vendor' || path.startsWith('/vendor/');
    if (isVendor) return !inVendorArea || vendorPermissionMissing ? '/vendor/' : null;
    if (inVendorArea) return homeFor(user);

    // Someone signed in for an organisation's billing only ever sees /org; nobody else does.
    if (isOrgUser && !path.startsWith('/org')) return orgNav(user?.organizationRoles)[0].href;
    if (!isOrgUser && path.startsWith('/org')) return user?.userType === 'admin' ? '/admin' : user?.userType === 'corporate_hr' ? '/hr' : '/dashboard';

    // Company HR only ever sees /hr; nobody else does.
    if (user?.userType === 'corporate_hr' && !path.startsWith('/hr')) return '/hr';
    if (user?.userType !== 'corporate_hr' && path.startsWith('/hr')) return user?.userType === 'admin' ? '/admin' : '/dashboard';

    // Block non-admin users from admin routes
    if (user?.userType !== 'admin' && path.startsWith('/admin')) return '/dashboard';

    // All admin users (including portal staff) go to /admin, not operator pages
    if (user?.userType === 'admin' && ['/dashboard', '/scan', '/checkins'].includes(path)) return '/admin';

    // Portal staff: away from pages outside their ACL, to the first permitted page (or the overview)
    if (isPortalStaff && path.startsWith('/admin')) {
      const matchedItem = ADMIN_NAV.find(item => (ROOTS.has(item.href) ? path === item.href : path.startsWith(item.href)));
      if (matchedItem?.aclScope && !scopesOf(matchedItem).some(hasPermission)) {
        const firstAllowed = ADMIN_NAV.find(i => !i.aclScope || scopesOf(i).some(hasPermission));
        const to = firstAllowed?.href ?? '/admin';
        return to === path ? null : to;
      }
    }
    return null;
  })();

  // Vendor pages need their permission: without it, back to the dashboard with a note (once per visit).
  const bouncedFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!redirectTo) { if (!vendorPermissionMissing) bouncedFrom.current = null; return; }
    if (vendorPermissionMissing && bouncedFrom.current !== path) {
      toast.error(t('vendor.noAccess'));
      bouncedFrom.current = path;
    }
    router.replace(redirectTo);
  }, [redirectTo, vendorPermissionMissing, path, router, toast, t]);

  /* Close mobile drawer on route change */
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  /* Mobile drawer: focus moves into it when it opens; Escape closes it and gives focus back to the menu button. */
  useEffect(() => {
    if (!mobileOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('a[href], button, select')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMobileOpen(false); menuButtonRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Authentication is restored from localStorage after mount. Keep the server
  // and the first client render identical so React never hydrates the public
  // header as the authenticated shell (or vice versa).
  if (!ready) {
    return (
      <div
        className="min-h-screen bg-[var(--color-bg-canvas)] flex flex-col"
        aria-busy="true"
        data-testid="shell-restoring-session"
      >
        <header className="h-16 flex items-center justify-center border-b border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)]">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-[var(--radius-md)]" />
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
        </header>
        {/* Photo hero login (flag): hold the navy panel ground while the
            session restores, so the page does not jump when it appears. */}
        {PHOTO_HERO_UI && pathname === '/login' && (
          <div className="flex flex-1 flex-col lg:flex-row">
            <PhotoPanel data-testid="login-photo-panel-restoring" />
          </div>
        )}
      </div>
    );
  }

  // Still on the start password an admin set: nothing but the step to choose their own (no nav, no
  // page content, so no page requests). The page they were going to opens once it is done.
  if (token && passwordChangeRequired && path !== '/login') {
    return (
      <div className="min-h-screen bg-[var(--color-bg-canvas)] flex flex-col">
        <header className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)]">
          <div className="w-24" />
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-[var(--radius-md)]" />
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <LanguageToggle className="justify-self-end" />
        </header>
        <main className="flex flex-1 items-center justify-center p-4">
          <ChangePasswordGate />
        </main>
      </div>
    );
  }

  const isLoginPage = path === '/login' || !token;

  /* Public / login layout — no sidebar */
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-canvas)] flex flex-col">
        {/* Minimal top bar for login */}
        <header className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)]">
          <div className="w-24" />
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-[var(--radius-md)]" />
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <LanguageToggle className="justify-self-end" />
        </header>
        <main className="flex-1">{redirectTo ? <div aria-busy="true" data-testid="shell-redirecting" /> : children}</main>
      </div>
    );
  }

  // Vendor area: nothing but a card when it is closed for this person (fails closed, no nav).
  if (isVendor && ['off', 'inactive', 'suspended'].includes(vendor.status)) {
    const [title, body, testId] = vendor.status === 'inactive'
      ? [t('vendor.staffDisabled.title'), t('vendor.staffDisabled.body'), 'vendor-staff-disabled']
      : vendor.status === 'suspended'
        ? [t('vendor.suspended.title'), t('vendor.suspended.banner'), 'vendor-suspended']
        : [t('vendor.portalOff.title'), t('vendor.portalOff.body'), 'vendor-portal-off'];
    return (
      <div className="min-h-screen bg-[var(--color-bg-canvas)] flex flex-col">
        <header className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)]">
          <div className="w-24" />
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-[var(--radius-md)]" />
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <LanguageToggle className="justify-self-end" />
        </header>
        <main className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-sm" data-testid={testId}>
            <CardContent className="space-y-4 text-center">
              <h1 className="text-lg font-semibold text-[var(--color-fg-primary)]">{title}</h1>
              <p className="text-sm text-[var(--color-fg-tertiary)]">{body}</p>
              <Button size="lg" className="w-full" onClick={() => { signOut(); router.replace('/login'); }}>{t('nav.signout')}</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Only inside the vendor area: swapping the page tree out elsewhere (e.g. /login right after
  // sign-in) would drop the navigation to /vendor/ that is under way.
  const inVendorPath = pathname === '/vendor' || pathname.startsWith('/vendor/');
  const vendorLoading = isVendor && inVendorPath && (vendor.status === 'loading' || vendor.status === 'none');
  const vendorBanner = isVendor && vendor.status === 'ready' && vendor.me
    ? vendor.me.accountStatus === 'suspended'
      ? <Alert tone="error" className="mb-4">{t('vendor.suspended.banner')}</Alert>
      : vendor.me.approvalStatus === 'pending_approval'
        ? <Alert tone="info" className="mb-4">{t('vendor.pending.banner')}</Alert>
        : null
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-canvas)] print:block print:h-auto print:overflow-visible print:bg-white">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 bg-[var(--color-sidebar-bg)] print:!hidden">
        <SidebarContent nav={visibleNav} />
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => { setMobileOpen(false); menuButtonRef.current?.focus(); }}>
          <div className="absolute inset-0 bg-black/60" />
        </div>
      )}
      <aside id="mobile-drawer" ref={drawerRef} inert={!mobileOpen} className={cn(
        'fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-sidebar-bg)] transition-transform duration-200 lg:hidden',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <SidebarContent nav={visibleNav} onLinkClick={() => setMobileOpen(false)} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">

        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)] px-4 lg:hidden print:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen(v => !v)}
            aria-label={mobileOpen ? t('common.closeMenu') : t('common.openMenu')}
            aria-expanded={mobileOpen}
            aria-controls="mobile-drawer"
            className="-m-2 inline-flex h-11 w-11 items-center justify-center text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)] transition-colors"
          >
            {mobileOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-brand-600)]">
              <span className="text-white font-bold text-xs">FF</span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <Badge tone="brand">{roleLabel(t, user)}</Badge>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible print:p-0">
          {redirectTo ? (
            <div className="space-y-4" aria-busy="true" data-testid="shell-redirecting"><SkeletonCard /></div>
          ) : vendorLoading ? (
            <div className="space-y-4" aria-busy="true" data-testid="vendor-loading">
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          ) : (
            <>
              {vendorBanner}
              {children}
            </>
          )}
        </main>

      </div>
    </div>
  );
}
