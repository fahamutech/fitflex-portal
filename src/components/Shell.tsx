'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, ReactNode, useState } from 'react';
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
  Undo2, Receipt, KeyRound
} from 'lucide-react';
import { useApp } from '../../app/providers';
import { cn } from '@/lib/cn';
import { Avatar, Badge } from './shared';
import { BrandLogo } from './brand-logo';

/* ── Nav definitions ─────────────────────────────────────── */
type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  groupKey?: string;
  aclScope?: string; // required ACL scope for portal staff; undefined = super-admin only
  aclAny?: string[]; // other scopes that also open the page
};
const scopesOf = (item: NavItem) => [item.aclScope, ...(item.aclAny ?? [])].filter(Boolean) as string[];

// Section roots highlight only on themselves, not on their sub-pages.
const ROOTS = new Set(['/admin', '/hr', '/org']);

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

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',               labelKey: 'admin.nav.overview',       icon: LayoutDashboard, groupKey: 'nav.group.platform' },
  { href: '/admin/gyms',          labelKey: 'admin.nav.gyms',           icon: Building2,       groupKey: 'nav.group.platform', aclScope: 'gyms' },
  { href: '/admin/owners',        labelKey: 'admin.nav.owners',         icon: UserCheck,       groupKey: 'nav.group.platform', aclScope: 'owners' },
  { href: '/admin/members',       labelKey: 'admin.nav.members',        icon: Users,           groupKey: 'nav.group.platform', aclScope: 'members' },
  { href: '/admin/analytics',     labelKey: 'admin.nav.analytics',      icon: LineChart,       groupKey: 'nav.group.platform', aclScope: 'analytics' },
  { href: '/admin/challenges',    labelKey: 'admin.nav.challenges',     icon: Trophy,          groupKey: 'nav.group.platform', aclScope: 'challenges' },
  { href: '/admin/rewards',       labelKey: 'admin.nav.rewards',        icon: Gift,            groupKey: 'nav.group.platform', aclScope: 'rewards' },
  { href: '/admin/social',        labelKey: 'admin.nav.social',         icon: Flag,            groupKey: 'nav.group.platform', aclScope: 'social' },
  { href: '/admin/reviews',       labelKey: 'admin.nav.reviews',        icon: Star,            groupKey: 'nav.group.platform', aclScope: 'social' },
  { href: '/admin/communications', labelKey: 'admin.nav.communications', icon: Megaphone,     groupKey: 'nav.group.platform', aclScope: 'communications' },
  { href: '/admin/corporate',     labelKey: 'admin.nav.corporate',      icon: Building,        groupKey: 'nav.group.platform', aclScope: 'corporate' },
  { href: '/admin/b2b',           labelKey: 'admin.nav.b2b',            icon: Network,         groupKey: 'nav.group.platform', aclScope: 'b2b' },
  { href: '/admin/b2b-analytics', labelKey: 'admin.nav.b2bAnalytics',   icon: LineChart,       groupKey: 'nav.group.platform', aclScope: 'b2b' },
  { href: '/admin/b2b-ops',       labelKey: 'admin.nav.b2bOps',         icon: Activity,        groupKey: 'nav.group.platform', aclScope: 'b2b', aclAny: ['b2b_billing', 'b2b_billing_approve', 'b2b_payments'] },
  { href: '/admin/trainers',      labelKey: 'admin.nav.trainers',       icon: Dumbbell,        groupKey: 'nav.group.platform', aclScope: 'trainers' },
  { href: '/admin/products',      labelKey: 'admin.nav.products',       icon: ShoppingBag,     groupKey: 'nav.group.platform', aclScope: 'shop' },
  { href: '/admin/vendors',       labelKey: 'admin.nav.vendors',        icon: Store,           groupKey: 'nav.group.platform', aclScope: 'shop' },
  { href: '/admin/distributions', labelKey: 'admin.nav.distributions',  icon: BarChart3,       groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/settlements',   labelKey: 'admin.nav.settlements',    icon: HandCoins,       groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/trainer-settlements', labelKey: 'admin.nav.trainerSettlements', icon: Dumbbell, groupKey: 'nav.group.finance', aclScope: 'payments' },
  { href: '/admin/settlement-config', labelKey: 'admin.nav.settlementConfig', icon: SlidersHorizontal, groupKey: 'nav.group.finance', aclScope: 'payments' },
  { href: '/admin/b2b-billing',   labelKey: 'admin.nav.b2bBilling',     icon: Receipt,         groupKey: 'nav.group.finance',  aclScope: 'b2b_billing', aclAny: ['b2b', 'b2b_billing_approve', 'b2b_payments'] },
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
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--color-sidebar-active)] text-white'
          : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-white',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 1.75} />
      <span className="flex-1 truncate">{label}</span>
      {active && <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />}
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
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Identity V2: move this session onto another portal persona of the same Person.
  async function onSwitchPersona(personaId: string) {
    if (!personaId) return;
    setSwitching(true); setSwitchError(null);
    try {
      const next = await switchPersona(personaId);
      router.replace(next.userType === 'corporate_hr' ? '/hr' : '/dashboard');
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
          <p className="truncate text-sm font-semibold text-white">FitFlex Af</p>
          <p className="truncate text-xs text-[var(--color-gray-500)]">
            {user?.userType === 'admin' ? 'Pilot Console' : user?.userType === 'corporate_hr' || user?.organizationUser ? 'FitFlex for Business' : 'Operator Portal'}
          </p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
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
                />
              ))}
              {groups.map(groupKey => (
                <div key={groupKey} className="mt-4">
                  <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-gray-600)]">{resolveLabel(t, groupKey)}</p>
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
          <Globe className="h-4 w-4 text-[var(--color-gray-500)]" />
          <select
            data-testid="locale-select"
            value={locale}
            onChange={e => setLocale(e.target.value as 'en' | 'sw')}
            className="flex-1 bg-transparent text-xs text-[var(--color-gray-400)] border-none outline-none cursor-pointer"
          >
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </div>

        {/* Identity V2: switch role, only when another portal persona exists */}
        {switchablePersonas.length > 0 && (
          <div className="px-3 py-2" data-testid="persona-switcher">
            <label className="block text-[10px] uppercase tracking-wide text-[var(--color-gray-500)]" htmlFor="persona-select">
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
                  {p.userType === 'corporate_hr' ? t('nav.personaHr') : p.userType === 'gym_staff' ? t('nav.personaStaff') : t('nav.personaOwner')}
                  {p.approvalStatus === 'pending_approval' ? ` · ${t('nav.personaPending')}` : ''}
                </option>
              ))}
            </select>
            {switchError && <p className="mt-1 text-[10px] text-[var(--color-error-300)]" role="alert">{switchError}</p>}
          </div>
        )}

        {/* User row + sign out */}
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2">
          <Avatar name={(user as any)?.displayName || user?.email || user?.id || 'User'} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-white">{(user as any)?.displayName || user?.email || user?.id || '—'}</p>
            <p className="truncate text-xs text-[var(--color-gray-500)] capitalize">{user?.userType === 'corporate_hr' ? 'Company HR' : user?.userType}{user?.portalUser ? ' · staff' : ''}</p>
          </div>
          <button
            onClick={() => { signOut(); router.replace('/login'); }}
            className="shrink-0 text-[var(--color-gray-500)] hover:text-white transition-colors"
            title={t('nav.signout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────── */
export function Shell({ children }: { children: ReactNode }) {
  const { ready, token, user, hasPermission, locale, setLocale } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdminUser   = token && user?.userType === 'admin';
  const isHr          = token && user?.userType === 'corporate_hr';
  const isOrgUser     = token && user?.organizationUser === true && user?.userType !== 'admin';
  const isPortalStaff = isAdminUser && user?.portalUser === true;

  // Build the visible nav — portal staff only see items their ACL permits.
  // Overview (/admin) is always visible to all admin users.
  const visibleNav = isAdminUser
    ? ADMIN_NAV.filter(item => {
        if (!item.aclScope) return true;             // no scope = super-admin only (overview)
        if (!isPortalStaff) return true;             // super-admin sees everything
        return scopesOf(item).some(hasPermission);   // portal staff: check ACL
      })
    : isOrgUser ? orgNav(user?.organizationRoles)
    : isHr ? HR_NAV
    : OPERATOR_NAV.filter(item => !item.aclScope || user?.userType !== 'gym_staff' || hasPermission(item.aclScope));

  useEffect(() => {
    if (!ready) return;
    if (!token && pathname !== '/login' && pathname !== '/') router.replace('/login');

    // Someone signed in for an organisation's billing only ever sees /org; nobody else does.
    if (token && isOrgUser && !pathname.startsWith('/org')) { router.replace(orgNav(user?.organizationRoles)[0].href); return; }
    if (token && !isOrgUser && pathname.startsWith('/org')) { router.replace(user?.userType === 'admin' ? '/admin' : user?.userType === 'corporate_hr' ? '/hr' : '/dashboard'); return; }

    // Company HR only ever sees /hr; nobody else does.
    if (token && user?.userType === 'corporate_hr' && !pathname.startsWith('/hr')) { router.replace('/hr'); return; }
    if (token && user?.userType !== 'corporate_hr' && pathname.startsWith('/hr')) router.replace(user?.userType === 'admin' ? '/admin' : '/dashboard');

    // Block non-admin users from admin routes
    if (token && user?.userType !== 'admin' && pathname.startsWith('/admin')) router.replace(user?.userType === 'corporate_hr' ? '/hr' : '/dashboard');

    // All admin users (including portal staff) go to /admin, not operator pages
    if (token && user?.userType === 'admin' && ['/dashboard', '/scan', '/checkins'].includes(pathname)) router.replace('/admin');

    // Portal staff: redirect away from pages outside their ACL
    if (token && isPortalStaff && pathname.startsWith('/admin')) {
      const matchedItem = ADMIN_NAV.find(item =>
        ROOTS.has(item.href) ? pathname.replace(/\/$/, '') === item.href : pathname.startsWith(item.href)
      );
      if (matchedItem?.aclScope && !scopesOf(matchedItem).some(hasPermission)) {
        // Redirect to the first permitted page, or just /admin overview
        const firstAllowed = ADMIN_NAV.find(i => !i.aclScope || scopesOf(i).some(hasPermission));
        router.replace(firstAllowed?.href ?? '/admin');
      }
    }
  }, [ready, token, user, isPortalStaff, isOrgUser, pathname, router, hasPermission]);

  /* Close mobile drawer on route change */
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Authentication is restored from localStorage after mount. Keep the server
  // and the first client render identical so React never hydrates the public
  // header as the authenticated shell (or vice versa).
  if (!ready) {
    return (
      <div
        className="min-h-screen bg-[var(--color-bg-secondary)] flex flex-col"
        aria-busy="true"
        data-testid="shell-restoring-session"
      >
        <header className="h-16 flex items-center justify-center border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)]">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-[var(--radius-md)]" />
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
        </header>
      </div>
    );
  }

  const isLoginPage = pathname === '/login' || !token;

  /* Public / login layout — no sidebar */
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-secondary)] flex flex-col">
        {/* Minimal top bar for login */}
        <header className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)]">
          <div className="w-24" />
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-[var(--radius-md)]" />
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <select
            data-testid="locale-select"
            aria-label="Language"
            value={locale}
            onChange={e => setLocale(e.target.value as 'en' | 'sw')}
            className="ui-input w-24 text-xs"
          >
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-secondary)] print:block print:h-auto print:overflow-visible print:bg-white">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 bg-[var(--color-sidebar-bg)] print:!hidden">
        <SidebarContent nav={visibleNav} />
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
        </div>
      )}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-sidebar-bg)] transition-transform duration-200 lg:hidden',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <SidebarContent nav={visibleNav} onLinkClick={() => setMobileOpen(false)} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">

        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] px-4 lg:hidden print:hidden">
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)] transition-colors"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-brand-600)]">
              <span className="text-white font-bold text-xs">FF</span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <Badge tone="brand">{user?.userType === 'corporate_hr' ? 'Company HR' : user?.userType}</Badge>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible print:p-0">
          {children}
        </main>

      </div>
    </div>
  );
}
