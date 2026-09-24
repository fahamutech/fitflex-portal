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
  BarChart3,
  LineChart,
  BookOpen,
  UserCog,
  BriefcaseBusiness,
  ShoppingBag,
  Store,
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
};

const OPERATOR_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard',  icon: LayoutDashboard },
  { href: '/scan',      labelKey: 'nav.scan',       icon: QrCode },
  { href: '/checkins',  labelKey: 'nav.checkins',   icon: ClipboardList },
  { href: '/owner/manage', labelKey: 'nav.manageGym', icon: BriefcaseBusiness },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',               labelKey: 'admin.nav.overview',       icon: LayoutDashboard, groupKey: 'nav.group.platform' },
  { href: '/admin/gyms',          labelKey: 'admin.nav.gyms',           icon: Building2,       groupKey: 'nav.group.platform', aclScope: 'gyms' },
  { href: '/admin/owners',        labelKey: 'admin.nav.owners',         icon: UserCheck,       groupKey: 'nav.group.platform', aclScope: 'owners' },
  { href: '/admin/members',       labelKey: 'admin.nav.members',        icon: Users,           groupKey: 'nav.group.platform', aclScope: 'members' },
  { href: '/admin/analytics',     labelKey: 'admin.nav.analytics',      icon: LineChart,       groupKey: 'nav.group.platform', aclScope: 'analytics' },
  { href: '/admin/trainers',      labelKey: 'admin.nav.trainers',       icon: Dumbbell,        groupKey: 'nav.group.platform', aclScope: 'trainers' },
  { href: '/admin/products',      labelKey: 'admin.nav.products',       icon: ShoppingBag,     groupKey: 'nav.group.platform', aclScope: 'shop' },
  { href: '/admin/vendors',       labelKey: 'admin.nav.vendors',        icon: Store,           groupKey: 'nav.group.platform', aclScope: 'shop' },
  { href: '/admin/distributions', labelKey: 'admin.nav.distributions',  icon: BarChart3,       groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/book-keeping',  labelKey: 'admin.nav.bookkeeping',    icon: BookOpen,        groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/payments',      labelKey: 'admin.nav.payments',       icon: CreditCard,      groupKey: 'nav.group.operations', aclScope: 'payments' },
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
  const { t, user, signOut, locale, setLocale } = useApp();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4 border-b border-[var(--color-gray-800)]">
        <BrandLogo className="h-8 w-8 rounded-[var(--radius-md)]" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-white">FitFlex Af</p>
          <p className="truncate text-xs text-[var(--color-gray-500)]">
            {user?.userType === 'admin' ? 'Pilot Console' : 'Operator Portal'}
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
                  active={item.href === '/admin' ? pathname === '/admin' : (pathname === item.href || pathname.startsWith(item.href + '/'))}
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
                      active={item.href === '/admin' ? pathname === '/admin' : (pathname === item.href || pathname.startsWith(item.href + '/'))}
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

        {/* User row + sign out */}
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2">
          <Avatar name={(user as any)?.displayName || user?.email || user?.id || 'User'} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-white">{(user as any)?.displayName || user?.email || user?.id || '—'}</p>
            <p className="truncate text-xs text-[var(--color-gray-500)] capitalize">{user?.userType}{user?.portalUser ? ' · staff' : ''}</p>
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
  const isPortalStaff = isAdminUser && user?.portalUser === true;

  // Build the visible nav — portal staff only see items their ACL permits.
  // Overview (/admin) is always visible to all admin users.
  const visibleNav = isAdminUser
    ? ADMIN_NAV.filter(item => {
        if (!item.aclScope) return true;             // no scope = super-admin only (overview)
        if (!isPortalStaff) return true;             // super-admin sees everything
        return hasPermission(item.aclScope);         // portal staff: check ACL
      })
    : OPERATOR_NAV;

  useEffect(() => {
    if (!ready) return;
    if (!token && pathname !== '/login' && pathname !== '/') router.replace('/login');

    // Block non-admin users from admin routes
    if (token && user?.userType !== 'admin' && pathname.startsWith('/admin')) router.replace('/dashboard');

    // All admin users (including portal staff) go to /admin, not operator pages
    if (token && user?.userType === 'admin' && ['/dashboard', '/scan', '/checkins'].includes(pathname)) router.replace('/admin');

    // Portal staff: redirect away from pages outside their ACL
    if (token && isPortalStaff && pathname.startsWith('/admin')) {
      const matchedItem = ADMIN_NAV.find(item =>
        item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
      );
      if (matchedItem?.aclScope && !hasPermission(matchedItem.aclScope)) {
        // Redirect to the first permitted page, or just /admin overview
        const firstAllowed = ADMIN_NAV.find(i => !i.aclScope || hasPermission(i.aclScope));
        router.replace(firstAllowed?.href ?? '/admin');
      }
    }
  }, [ready, token, user, isPortalStaff, pathname, router, hasPermission]);

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
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-secondary)]">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 bg-[var(--color-sidebar-bg)]">
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
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] px-4 lg:hidden">
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
          <Badge tone="brand">{user?.userType}</Badge>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>

      </div>
    </div>
  );
}
