'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, ReactNode, useState } from 'react';
import {
  LayoutDashboard,
  QrCode,
  ClipboardList,
  LogOut,
  ChevronRight,
  ChevronDown,
  Search,
  Menu,
  X,
  Settings,
  Globe,
  Building2,
  Users,
  UserCheck,
  Dumbbell,
  CalendarDays,
  CreditCard,
  ShieldCheck,
  BadgeCheck,
  BarChart3,
  LineChart,
  Target,
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
  Undo2, Receipt, KeyRound, FileUp, ShieldAlert, ShieldQuestionMark, Images, Landmark, Percent, CalendarCheck, ImageUp, Plug, ScrollText, Truck,
} from 'lucide-react';
import { useApp } from '../../app/providers';
import { ChangePasswordGate } from './change-password-gate';
import { cn } from '@/lib/cn';
import { api, ORGANIZER_USER_TYPES, VENDOR_USER_TYPES, type OrganizerRole, type OrganizerStatus, type VendorTools } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { fmt, VENDOR_AREAS, vendorAreaOpen } from '@/lib/vendor';
import { Alert, Avatar, Badge, Button, Card, CardContent, SkeletonCard, useToast } from './shared';
import { useVendor } from './vendor-context';
import { BrandLogo } from './brand-logo';
import { LanguageToggle } from './language-toggle';
import { PhotoPanel } from './photo-panel';
import { EVENTS_MODULE, GYM_CUSTOM_PASSES, HERO_IMAGES_ADMIN, PARTNER_MEDIA_ADMIN, PHOTO_HERO_UI } from '@/lib/flags';
import { eventsAreaOpen, staffAreaOpen } from '@/lib/events';
import { useAdminEventsSummary, useOrganizer } from './organizer-context';
import { useCorporateEventsAvailable, useEventsOptions } from './events-options';
import { resultsOf } from '@/lib/events-results';
import { opsOf } from '@/lib/events-ops';
import { useShopBannersAvailable, useShopFlashSalesAvailable } from './shop-banners-gate';
import { useTaxRatesAvailable } from './tax-rates-gate';
import { useHrToOrgRefresh } from './hr-to-org-refresh';
import { isHrInOrg, orgHome, orgPathForHr } from '@/lib/hr-to-org';

/** SHOP_BANNERS / SHOP_FLASH_SALES as /vendor/me reports them (tools.merch.banners / flashSales); undefined when the server doesn't say. */
const vendorMerchTool = (tools: VendorTools | null | undefined, kind: 'banners' | 'flashSales') => {
  const merch = tools?.merch as Record<string, unknown> | undefined;
  return typeof merch?.[kind] === 'boolean' ? (merch[kind] as boolean) : undefined;
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

/**
 * The admin nav item that owns a path: the longest matching href, on a path boundary. A plain prefix match let
 * /admin/b2b-billing resolve to the /admin/b2b item and redirect staff who only hold b2b_billing. Roots match exactly.
 */
function matchAdminNav(path: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ADMIN_NAV) {
    const hit = ROOTS.has(item.href) ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

// Section roots highlight only on themselves, not on their sub-pages.
const ROOTS = new Set(['/admin', '/hr', '/org', '/vendor', '/organizer']);

// Someone who looks after a B2B organisation's billing: that, and nothing else.
// What each role is offered; the server decides what each page shows.
const ORG_PEOPLE = new Set(['owner', 'admin', 'manager', 'hr', 'analyst']);
const ORG_BILLING = new Set(['owner', 'admin', 'finance']);
const ORG_INSIGHTS = new Set(['owner', 'admin', 'manager', 'hr', 'finance', 'analyst']);
// Events S3 (spec §6.1): /org/events and /hr/events appear only with the build flag and the server's
// `registration && corporate` options (probed once by useCorporateEventsAvailable); roster roles only (D18 gates placing inside).
const orgNav = (roles?: string[], corporateEvents = false): NavItem[] => [
  ...(!roles || roles.some(r => ORG_INSIGHTS.has(r)) ? [{ href: '/org/insights', labelKey: 'org.nav.insights', icon: LineChart }] : []),
  ...(!roles || roles.some(r => ORG_PEOPLE.has(r)) ? [{ href: '/org/people', labelKey: 'org.nav.people', icon: Users }] : []),
  { href: '/org/programmes', labelKey: 'org.nav.programmes', icon: Network },
  ...(corporateEvents && (!roles || roles.some(r => ORG_PEOPLE.has(r))) ? [{ href: '/org/events', labelKey: 'org.nav.events', icon: Flag }] : []),
  // Challenges, the rewards they earn, and groups: the same roles that see people.
  ...(!roles || roles.some(r => ORG_PEOPLE.has(r)) ? [
    { href: '/org/challenges', labelKey: 'hr.nav.challenges', icon: Trophy },
    { href: '/org/rewards', labelKey: 'hr.nav.rewards', icon: Gift },
    { href: '/org/groups', labelKey: 'hr.nav.groups', icon: UserCheck },
  ] : []),
  ...(!roles || roles.some(r => ORG_BILLING.has(r)) ? [{ href: '/org', labelKey: 'org.nav.billing', icon: Receipt }] : []),
];

// Company HR: their company's wellness challenges, nothing else.
const hrNav = (corporateEvents = false): NavItem[] => [
  { href: '/hr', labelKey: 'hr.nav.challenges', icon: Trophy },
  { href: '/hr/rewards', labelKey: 'hr.nav.rewards', icon: Gift },
  { href: '/hr/groups', labelKey: 'hr.nav.groups', icon: Users },
  { href: '/hr/people', labelKey: 'hr.nav.people', icon: UserCheck },
  { href: '/hr/programmes', labelKey: 'hr.nav.programmes', icon: Network },
  ...(corporateEvents ? [{ href: '/hr/events', labelKey: 'org.nav.events', icon: Flag }] : []),
  { href: '/hr/insights', labelKey: 'org.nav.insights', icon: LineChart },
];

const OPERATOR_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard',  icon: LayoutDashboard },
  { href: '/scan',      labelKey: 'nav.scan',       icon: QrCode },
  { href: '/checkins',  labelKey: 'nav.checkins',   icon: ClipboardList },
  { href: '/owner/manage', labelKey: 'nav.manageGym', icon: BriefcaseBusiness },
  // Custom gym passes: only in builds with NEXT_PUBLIC_GYM_CUSTOM_PASSES=true. Owners always; gym staff with any of the
  // permissions its tabs need (plans: gyms, sales: payments, people: members).
  ...(GYM_CUSTOM_PASSES ? [{ href: '/owner/memberships', labelKey: 'nav.memberships', icon: BadgeCheck, aclScope: 'members', aclAny: ['gyms', 'payments'] }] : []),
  // Owners always; gym staff only with the communications permission.
  { href: '/owner/communications', labelKey: 'nav.communications', icon: Megaphone, aclScope: 'communications' },
  // Owners always; gym staff only with the gyms permission (read-only).
  { href: '/owner/reviews', labelKey: 'nav.reviews', icon: Star, aclScope: 'gyms' },
  // Owners always; gym staff only with the payments permission (read-only).
  { href: '/owner/statements', labelKey: 'nav.statements', icon: HandCoins, aclScope: 'payments' },
];

// A business that sells on FitFlex (vendor portal, S2): each item needs its permission.
function vendorNav(permissions: string[], tools: VendorTools | null | undefined, lowCount: number | null, waitingCount: number | null, bannersOn = false): NavItem[] {
  const icons: Record<string, React.ElementType> = { '/vendor': LayoutDashboard, '/vendor/products': ShoppingBag, '/vendor/purchases': Truck, '/vendor/promotions': Megaphone, '/vendor/orders': ClipboardList, '/vendor/sales': Receipt, '/vendor/customers': Users, '/vendor/reports': BarChart3, '/vendor/import': FileUp, '/vendor/payouts': HandCoins, '/vendor/settings/tax': Landmark };
  const labels: Record<string, string> = { '/vendor': 'vendor.nav.dashboard', '/vendor/products': 'vendor.nav.products', '/vendor/purchases': 'vendor.nav.purchases', '/vendor/promotions': 'merch.nav', '/vendor/orders': 'vendor.nav.orders', '/vendor/sales': 'vendor.nav.sales', '/vendor/customers': 'vendor.nav.customers', '/vendor/reports': 'vendor.nav.reports', '/vendor/import': 'vendor.nav.import', '/vendor/payouts': 'vendor.nav.payouts', '/vendor/settings/tax': 'vendor.tax.title' };
  // S5: Settings → Tax details (VAT on; owner or staff with `payments`).
  const groups: Record<string, string> = { '/vendor/settings/tax': 'vendor.nav.group.settings' };
  return VENDOR_AREAS.filter(a => a.nav !== false && vendorAreaOpen(a, permissions, tools) && (a.href !== '/vendor/promotions' || bannersOn)).map(a => ({
    href: a.href, labelKey: labels[a.href], icon: icons[a.href], ...(groups[a.href] ? { groupKey: groups[a.href] } : {}),
    ...(a.href === '/vendor/products' && lowCount ? { count: { n: lowCount, labelKey: 'vendor.nav.productsLow' as MessageKey, tone: 'warning' as const } } : {}),
    ...(a.href === '/vendor/orders' && waitingCount ? { count: { n: waitingCount, labelKey: 'vendor.nav.ordersWaiting' as MessageKey, tone: 'fuel' as const } } : {}),
  }));
}

// Events S2 (spec §3): a running-event organizer and their staff. Items open by organizer status and role.
function organizerNav(status: OrganizerStatus | null, role: OrganizerRole | null, integrations = false): NavItem[] {
  return [
    { href: '/organizer', labelKey: 'nav.organizer.overview', icon: LayoutDashboard },
    { href: '/organizer/onboarding', labelKey: 'nav.organizer.onboarding', icon: ShieldCheck },
    ...(eventsAreaOpen(status) ? [{ href: '/organizer/events', labelKey: 'nav.organizer.events', icon: Flag }] : []),
    ...(staffAreaOpen(status, role) ? [{ href: '/organizer/staff', labelKey: 'nav.organizer.staff', icon: Users }] : []),
    // Events S5 §8.1: owner/admin of an active organizer, and only while the server says the API or webhooks are on.
    ...(integrations && staffAreaOpen(status, role) ? [{ href: '/organizer/integrations', labelKey: 'organizer.nav.integrations', icon: Plug }] : []),
  ];
}

/** Where each kind of session lives. */
export function homeFor(user: { userType?: string; organizationUser?: boolean; organizationRoles?: string[] } | null | undefined) {
  if (!user) return '/login';
  if (VENDOR_USER_TYPES.has(user.userType ?? '')) return '/vendor';
  if (ORGANIZER_USER_TYPES.has(user.userType ?? '')) return '/organizer';
  if (user.userType === 'admin') return '/admin';
  // B5b: a company HR login the server marked for the organisation area (ORG_ONLY_SPONSORS) opens /org.
  if (isHrInOrg(user)) return orgHome(user.organizationRoles);
  if (user.userType === 'corporate_hr') return '/hr';
  return '/dashboard';
}

/** The signed-in person's role, in the chosen language. */
function roleLabel(t: (key: MessageKey) => string, user: { userType?: string; portalUser?: boolean; organizationUser?: boolean } | null) {
  const type = user?.userType ?? '';
  const base = type === 'vendor' ? t('vendor.role.owner')
    : type === 'vendor_staff' ? t('vendor.role.staff')
    : type === 'event_organizer' ? t('organizer.role.owner')
    : type === 'organizer_staff' ? t('nav.organizer.staff')
    : type === 'admin' ? t('shell.role.admin')
    : type === 'corporate_hr' ? t('nav.personaHr')
    : user?.organizationUser ? t('shell.role.organization')
    : type === 'gym_operator' ? t('nav.personaOwner')
    : type === 'gym_staff' ? t('nav.personaStaff')
    : type;
  return user?.portalUser ? `${base} · ${t('shell.role.staffSuffix')}` : base;
}

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin',               labelKey: 'admin.nav.overview',       icon: LayoutDashboard, groupKey: 'nav.group.platform' },
  { href: '/admin/gyms',          labelKey: 'admin.nav.gyms',           icon: Building2,       groupKey: 'nav.group.platform', aclScope: 'gyms' },
  { href: '/admin/owners',        labelKey: 'admin.nav.owners',         icon: UserCheck,       groupKey: 'nav.group.platform', aclScope: 'owners' },
  { href: '/admin/members',       labelKey: 'admin.nav.members',        icon: Users,           groupKey: 'nav.group.platform', aclScope: 'members' },
  { href: '/admin/analytics',     labelKey: 'admin.nav.analytics',      icon: LineChart,       groupKey: 'nav.group.platform', aclScope: 'analytics' },
  { href: '/admin/kpi-targets',   labelKey: 'admin.nav.kpiTargets',     icon: Target,          groupKey: 'nav.group.platform', aclScope: 'analytics' },
  { href: '/admin/challenges',    labelKey: 'admin.nav.challenges',     icon: Trophy,          groupKey: 'nav.group.platform', aclScope: 'challenges' },
  // Events S2 (spec §3): the moderation queue; only in builds with NEXT_PUBLIC_EVENTS_MODULE=true, and only while the
  // server answers GET /admin/events/summary (see visibleNav). The count is the number of submitted events.
  ...(EVENTS_MODULE ? [{ href: '/admin/events', labelKey: 'admin.nav.events', icon: Flag, groupKey: 'nav.group.platform', aclScope: 'events' }] : []),
  { href: '/admin/rewards',       labelKey: 'admin.nav.rewards',        icon: Gift,            groupKey: 'nav.group.platform', aclScope: 'rewards' },
  // Events S6 (spec §9.4): event rewards and medal art; shown only while the server's EVENTS_REWARDS is on (see visibleNav).
  ...(EVENTS_MODULE ? [{ href: '/admin/event-rewards', labelKey: 'admin.nav.eventRewards', icon: Gift, groupKey: 'nav.group.platform', aclScope: 'events' }] : []),
  { href: '/admin/exercises',     labelKey: 'admin.nav.exercises',      icon: Dumbbell,        groupKey: 'nav.group.platform', aclScope: 'exercises' },
  { href: '/admin/programmes',    labelKey: 'admin.nav.programmes',     icon: CalendarDays,    groupKey: 'nav.group.platform', aclScope: 'exercises' },
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
  // Partner photos (spec photo-hero-screens §43.1): only in builds with NEXT_PUBLIC_PARTNER_MEDIA_ADMIN=true. The queue needs
  // moderation or moderation_decide; brand_media alone opens the page with only "Set photo for a partner" (no queue).
  ...(PARTNER_MEDIA_ADMIN ? [{ href: '/admin/partner-media', labelKey: 'admin.nav.partnerMedia', icon: ImageUp, groupKey: 'nav.group.promotion', aclScope: 'moderation', aclAny: ['moderation_decide', 'brand_media'] }] : []),
  { href: '/admin/promotions',    labelKey: 'admin.nav.promotions',     icon: Megaphone,       groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve', 'campaigns'] },
  // Shop banners (Phase 2 S1): shown only while the server has SHOP_BANNERS on (see visibleNav).
  { href: '/admin/shop-merch',    labelKey: 'admin.nav.shopMerch',      icon: Images,          groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve'] },
  { href: '/admin/promotion-campaigns', labelKey: 'admin.nav.promotionCampaigns', icon: Flag,   groupKey: 'nav.group.promotion', aclScope: 'promotions', aclAny: ['promotions_approve', 'campaigns'] },
  { href: '/admin/promotion-analytics', labelKey: 'admin.nav.promotionAnalytics', icon: BarChart3, groupKey: 'nav.group.promotion', aclScope: 'promotion_analytics' },
  { href: '/admin/promotion-limits', labelKey: 'admin.nav.promotionLimits', icon: SlidersHorizontal, groupKey: 'nav.group.promotion', aclScope: 'campaigns', aclAny: ['promotions', 'promotions_approve'] },
  { href: '/admin/distributions', labelKey: 'admin.nav.distributions',  icon: BarChart3,       groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/settlements',   labelKey: 'admin.nav.settlements',    icon: HandCoins,       groupKey: 'nav.group.finance',  aclScope: 'payments', aclAny: ['settlements_prepare', 'settlements_approve', 'settlements_pay'] },
  { href: '/admin/trainer-settlements', labelKey: 'admin.nav.trainerSettlements', icon: Dumbbell, groupKey: 'nav.group.finance', aclScope: 'payments', aclAny: ['settlements_prepare', 'settlements_approve', 'settlements_pay'] },
  { href: '/admin/vendor-settlements', labelKey: 'admin.nav.vendorSettlements', icon: Store, groupKey: 'nav.group.finance', aclScope: 'payments', aclAny: ['settlements_prepare', 'settlements_approve', 'settlements_pay'] },
  { href: '/admin/settlement-config', labelKey: 'admin.nav.settlementConfig', icon: SlidersHorizontal, groupKey: 'nav.group.finance', aclScope: 'payments' },
  { href: '/admin/b2b-billing',   labelKey: 'admin.nav.b2bBilling',     icon: Receipt,         groupKey: 'nav.group.finance',  aclScope: 'b2b_billing', aclAny: ['b2b', 'b2b_billing_approve', 'b2b_payments'] },
  // S5: VAT rates with maker ≠ checker; shown only while the server has VAT on (useTaxRatesAvailable).
  { href: '/admin/tax-rates',     labelKey: 'admin.nav.taxRates',       icon: Percent,         groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/book-keeping',  labelKey: 'admin.nav.bookkeeping',    icon: BookOpen,        groupKey: 'nav.group.finance',  aclScope: 'payments' },
  { href: '/admin/payments',      labelKey: 'admin.nav.payments',       icon: CreditCard,      groupKey: 'nav.group.operations', aclScope: 'payments' },
  { href: '/admin/refunds',       labelKey: 'admin.nav.refunds',        icon: Undo2,           groupKey: 'nav.group.operations', aclScope: 'payments' },
  { href: '/admin/payments-held', labelKey: 'heldPayments.nav',     icon: ShieldAlert,     groupKey: 'nav.group.operations', aclScope: 'payments' },
  { href: '/admin/kyc',           labelKey: 'admin.nav.kyc',            icon: BadgeCheck,      groupKey: 'nav.group.operations', aclScope: 'kyc' },
  { href: '/admin/account-recovery', labelKey: 'admin.nav.accountRecovery', icon: KeyRound,    groupKey: 'nav.group.operations', aclScope: 'account_recovery' },
  // Security reports (S4b): members' reports of a web check-in they do not recognise. The page itself says
  // "not available yet" while the server's SECURITY_INCIDENT_REPORTS is off (404 feature_disabled).
  { href: '/admin/security-incidents', labelKey: 'admin.nav.securityIncidents', icon: ShieldQuestionMark, groupKey: 'nav.group.operations', aclScope: 'security_incidents' },
  { href: '/admin/approvals',     labelKey: 'admin.nav.approvals',      icon: ShieldCheck,     groupKey: 'nav.group.operations', aclScope: 'approvals' },
  { href: '/admin/settings',      labelKey: 'admin.nav.settings',       icon: Settings,        groupKey: 'nav.group.system',   aclScope: 'settings' },
  { href: '/admin/users',         labelKey: 'admin.nav.users',          icon: UserCog,         groupKey: 'nav.group.system',   aclScope: 'users' },
  { href: '/admin/audit',         labelKey: 'auditLog.nav',             icon: ScrollText,      groupKey: 'nav.group.system',   aclScope: 'audit' },
];

/*
 * Phase 2B S2: the admin sidebar is grouped by the job being done, at most seven links a group.
 * Only the grouping and the order change here: every href, scope, flag gate and label above stays as it
 * is. A link that is not listed (one added later) falls into System, at the end.
 */
const ADMIN_GROUPS: Array<[groupKey: string, hrefs: string[]]> = [
  ['nav.group.people',         ['/admin/members', '/admin/gyms', '/admin/owners', '/admin/trainers', '/admin/trainer-sessions', '/admin/vendors', '/admin/products']],
  ['nav.group.verification',   ['/admin/kyc', '/admin/approvals', '/admin/account-recovery', '/admin/security-incidents']],
  ['nav.group.money',          ['/admin/payments', '/admin/refunds', '/admin/payments-held', '/admin/settlements', '/admin/trainer-settlements', '/admin/vendor-settlements', '/admin/b2b-billing']],
  ['nav.group.financeRecords', ['/admin/distributions', '/admin/book-keeping']],
  ['nav.group.b2b',            ['/admin/corporate', '/admin/b2b', '/admin/b2b-ops', '/admin/b2b-analytics']],
  ['nav.group.engagement',     ['/admin/challenges', '/admin/rewards', '/admin/events', '/admin/event-rewards', '/admin/exercises', '/admin/programmes', '/admin/communications']],
  ['nav.group.promotionShop',  ['/admin/promotion-overview', '/admin/promotions', '/admin/promotion-campaigns', '/admin/shop-merch', '/admin/promotion-analytics', '/admin/promotion-limits']],
  ['nav.group.trust',          ['/admin/moderation', '/admin/partner-media', '/admin/reviews', '/admin/social', '/admin/hero-images']],
  ['nav.group.insights',       ['/admin/analytics', '/admin/kpi-targets']],
  ['nav.group.system',         ['/admin/settings', '/admin/settlement-config', '/admin/tax-rates', '/admin/users', '/admin/audit']],
];
const ADMIN_PLACE = new Map<string, { groupKey: string; order: number }>();
ADMIN_GROUPS.forEach(([groupKey, hrefs], g) => hrefs.forEach((href, n) => ADMIN_PLACE.set(href, { groupKey, order: g * 100 + n })));
const adminOrder = (item: NavItem) => (item.href === '/admin' ? -1 : ADMIN_PLACE.get(item.href)?.order ?? 10_000);
const ADMIN_NAV: NavItem[] = ADMIN_NAV_ITEMS
  .map(item => (item.href === '/admin' ? { ...item, groupKey: undefined } : { ...item, groupKey: ADMIN_PLACE.get(item.href)?.groupKey ?? 'nav.group.system' }))
  .sort((a, b) => adminOrder(a) - adminOrder(b));

const isActivePath = (pathname: string, href: string) =>
  ROOTS.has(href) ? pathname.replace(/\/$/, '') === href : (pathname === href || pathname.startsWith(href + '/'));

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
        'group flex min-h-11 items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors',
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

/** Listings waiting for moderation (GET /admin/moderation/counts). 0 while loading, on any failure, or without the scope. */
function useModerationPending(token: string | null | undefined, enabled: boolean): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!enabled || !token) { setPending(0); return; }
    let live = true;
    api.moderationCounts(token)
      .then(r => { if (live) setPending(Number(r?.counts?.pending) || 0); })
      .catch(() => { if (live) setPending(0); });
    return () => { live = false; };
  }, [token, enabled]);
  return pending;
}

/* ── Role switch (Identity V2): shared by the drawer footer and the desktop top bar ── */
function usePersonaSwitch() {
  const router = useRouter();
  const { t, switchPersona } = useApp();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  // Move this session onto another portal persona of the same Person.
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
  return { switching, switchError, onSwitchPersona };
}

const personaLabel = (t: (key: MessageKey) => string, p: { userType?: string; approvalStatus?: string }) =>
  `${p.userType === 'corporate_hr' ? t('nav.personaHr') : p.userType === 'gym_staff' ? t('nav.personaStaff') : p.userType === 'vendor' ? t('nav.personaVendor') : p.userType === 'vendor_staff' ? t('nav.personaVendorStaff') : t('nav.personaOwner')}${p.approvalStatus === 'pending_approval' ? ` · ${t('nav.personaPending')}` : ''}`;

/* ── Sidebar links, flat or in collapsible groups ── */
const NAV_GROUPS_KEY = 'ff.nav.groups';

function NavList({ nav, collapsible, onLinkClick }: { nav: NavItem[]; collapsible: boolean; onLinkClick?: () => void }) {
  const pathname = usePathname();
  const { t } = useApp();
  const baseId = useId();
  // What the person opened or closed by hand; a group they never touched follows the current page.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const loaded = useRef(false);

  const groups: string[] = [];
  nav.forEach(item => { if (item.groupKey && !groups.includes(item.groupKey)) groups.push(item.groupKey); });
  const ungrouped = nav.filter(item => !item.groupKey);
  const activeGroup = nav.find(item => item.groupKey && isActivePath(pathname, item.href))?.groupKey;

  useEffect(() => {
    if (!collapsible) return;
    let stored: Record<string, boolean> | null = null;
    if (!loaded.current) {
      loaded.current = true;
      try {
        const raw = JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || '{}');
        stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      } catch { stored = {}; }
    }
    // Arriving on a page always shows its group, even if it was closed by hand earlier.
    setManual(prev => {
      const next = stored ?? prev;
      if (activeGroup && next[activeGroup] === false) {
        const { [activeGroup]: _closed, ...rest } = next;
        return rest;
      }
      return next;
    });
  }, [collapsible, activeGroup, pathname]);

  const toggle = (groupKey: string, open: boolean) => {
    const next = { ...manual, [groupKey]: !open };
    setManual(next);
    try { localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(next)); } catch { /* private window: the choice lasts for this visit */ }
  };

  const link = (item: NavItem) => (
    <SidebarLink
      key={item.href}
      href={item.href}
      label={resolveLabel(t, item.labelKey)}
      icon={item.icon}
      active={isActivePath(pathname, item.href)}
      onClick={onLinkClick}
      count={item.count ? { n: item.count.n, tone: item.count.tone, label: fmt(t(item.count.labelKey), { n: item.count.n }) } : undefined}
    />
  );

  return (
    <>
      {ungrouped.map(link)}
      {groups.map((groupKey, g) => {
        const items = nav.filter(item => item.groupKey === groupKey);
        const label = resolveLabel(t, groupKey);
        if (!collapsible) {
          return (
            <div key={groupKey} className="mt-4">
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-400)]">{label}</p>
              {items.map(link)}
            </div>
          );
        }
        const open = manual[groupKey] ?? groupKey === activeGroup;
        const waiting = items.reduce((sum, item) => sum + (item.count?.n ?? 0), 0);
        const panelId = `${baseId}-group-${g}`;
        return (
          <div key={groupKey} className="mt-1" data-testid="nav-group" data-group={groupKey}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(groupKey, open)}
              className="flex min-h-11 w-full items-center gap-2 rounded-full px-3 text-left text-sm font-semibold text-white transition-colors hover:bg-[var(--color-sidebar-hover)]"
            >
              <span className="flex-1 truncate" title={label}>{label}</span>
              {!open && waiting > 0 && (
                <span aria-hidden="true" className="shrink-0 rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-warning-800)]">
                  {waiting > 99 ? '99+' : waiting}
                </span>
              )}
              {open
                ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-70" />
                : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 opacity-70" />}
            </button>
            {/* Closed groups stay in the page (hidden), so "this link does not exist" still means no permission. */}
            <div id={panelId} hidden={!open} className="pl-2">
              {items.map(link)}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ── Page finder: type part of a page or group name and jump to it. Lists only links in this person's menu. ── */
function PageFinder({ nav }: { nav: NavItem[] }) {
  const { t } = useApp();
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nav
      .map(item => ({ href: item.href, label: resolveLabel(t, item.labelKey), group: item.groupKey ? resolveLabel(t, item.groupKey) : '' }))
      .filter(item => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, nav, t]);

  const go = (href: string) => { setQuery(''); setOpen(false); router.push(href); };
  const showList = open && query.trim().length > 0;
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  return (
    <div className="relative w-full max-w-xs" data-testid="page-finder">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-quaternary)]" />
      <input
        type="text"
        role="combobox"
        aria-label={t('shell.finder.label')}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches.length ? `${listId}-${current}` : undefined}
        placeholder={t('shell.finder.label')}
        value={query}
        onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(Math.min(current + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(current - 1, 0)); }
          else if (e.key === 'Enter' && showList && matches[current]) { e.preventDefault(); go(matches[current].href); }
          else if (e.key === 'Escape') { setQuery(''); setOpen(false); }
        }}
        className="h-10 w-full rounded-full border border-[var(--color-border-input)] bg-[var(--color-bg-primary)] pl-9 pr-4 text-sm text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-quaternary)]"
      />
      <div id={listId} role="listbox" aria-label={t('shell.finder.label')} hidden={!showList}
        className="absolute left-0 right-0 top-full z-30 mt-1 rounded-[var(--radius-md)] bg-[var(--color-bg-primary)] p-1 shadow-[var(--shadow-lg)]">
        {matches.map((item, i) => (
          <div
            key={item.href}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === current}
            // mousedown, not click: the input's blur would close the list before a click lands.
            onMouseDown={e => { e.preventDefault(); go(item.href); }}
            onMouseEnter={() => setActive(i)}
            className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 text-sm', i === current ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-fg-primary)]' : 'text-[var(--color-fg-secondary)]')}
          >
            <span className="truncate font-medium">{item.label}</span>
            {item.group && <span className="shrink-0 text-xs text-[var(--color-fg-tertiary)]">{item.group}</span>}
          </div>
        ))}
        {matches.length === 0 && <p role="status" className="px-3 py-2.5 text-sm text-[var(--color-fg-tertiary)]">{t('common.noResults')}</p>}
      </div>
    </div>
  );
}

/* ── Desktop top bar: where am I, find a page, language, role, sign out ── */
function TopBar({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, user, signOut, locale, setLocale, switchablePersonas } = useApp();
  const { switching, switchError, onSwitchPersona } = usePersonaSwitch();

  // The link that owns this page: the longest href that matches, as the sidebar highlights it.
  let here: NavItem | undefined;
  for (const item of nav) {
    if (isActivePath(pathname, item.href) || (!ROOTS.has(item.href) && pathname.startsWith(`${item.href}/`))) {
      if (!here || item.href.length > here.href.length) here = item;
    }
  }
  const name = (user as any)?.displayName || user?.email || user?.id || '—';

  return (
    <header data-testid="top-bar" className="hidden h-16 shrink-0 items-center gap-4 border-b border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)] px-8 lg:flex print:!hidden">
      {here && (
        <nav aria-label={t('shell.breadcrumb')} className="min-w-0 shrink text-sm text-[var(--color-fg-tertiary)]">
          <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0">
            {here.groupKey && <li className="truncate">{resolveLabel(t, here.groupKey)}</li>}
            {here.groupKey && <li aria-hidden="true">›</li>}
            <li aria-current="page" className="truncate font-semibold text-[var(--color-fg-primary)]">{resolveLabel(t, here.labelKey)}</li>
          </ol>
        </nav>
      )}
      {nav.length > 8 && <PageFinder nav={nav} />}
      <div className="flex-1" />

      <div className="flex items-center gap-1 text-[var(--color-fg-tertiary)]">
        <Globe aria-hidden="true" className="h-4 w-4" />
        <select
          data-testid="locale-select"
          aria-label={t('common.language')}
          value={locale}
          onChange={e => setLocale(e.target.value as 'en' | 'sw')}
          className="min-h-11 cursor-pointer rounded-full border-none bg-transparent px-1 text-sm font-medium text-[var(--color-fg-secondary)]"
        >
          <option value="en">English</option>
          <option value="sw">Kiswahili</option>
        </select>
      </div>

      {/* Identity V2: switch role, only when another portal persona exists */}
      {switchablePersonas.length > 0 && (
        <div data-testid="persona-switcher" className="min-w-0">
          <select
            id="persona-select-top"
            data-testid="persona-select"
            aria-label={t('nav.switchRole')}
            disabled={switching}
            value=""
            onChange={e => onSwitchPersona(e.target.value)}
            className="min-h-11 max-w-[12rem] cursor-pointer rounded-full border border-[var(--color-border-input)] bg-[var(--color-bg-primary)] px-3 text-sm font-medium text-[var(--color-fg-secondary)]"
          >
            <option value="" disabled>{t('nav.switchRole')}</option>
            {switchablePersonas.map(p => <option key={p.id} value={p.id}>{personaLabel(t, p)}</option>)}
          </select>
          {switchError && <p className="mt-1 text-xs text-[var(--color-error-700)]" role="alert">{switchError}</p>}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={(user as any)?.displayName || user?.email || user?.id || 'User'} size="sm" />
        <div className="min-w-0 max-w-[14rem]">
          <p className="truncate text-sm font-semibold text-[var(--color-fg-primary)]" title={name}>{name}</p>
          <p className="truncate text-xs text-[var(--color-fg-tertiary)]" data-testid="shell-role">{roleLabel(t, user)}</p>
        </div>
        <button
          type="button"
          onClick={() => { signOut(); router.replace('/login'); }}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-fg-tertiary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)]"
          title={t('nav.signout')}
          aria-label={t('nav.signout')}
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

/* ── Sidebar content (shared by mobile drawer + desktop) ─── */
function SidebarContent({
  nav,
  onLinkClick,
  collapsible = false,
  footer = true,
}: {
  nav: NavItem[];
  onLinkClick?: () => void;
  /** Admin: groups open and close; the one holding the current page opens by itself. */
  collapsible?: boolean;
  /** Language, role switch and sign-out. Off on desktop, where the top bar holds them. */
  footer?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, user, signOut, locale, setLocale, switchablePersonas, switchPersona } = useApp();
  const vendor = useVendor();
  const organizer = useOrganizer();
  const isVendor = VENDOR_USER_TYPES.has(user?.userType ?? '');
  const isOrganizer = ORGANIZER_USER_TYPES.has(user?.userType ?? '');
  const businessName = vendor.me?.businessName || t('vendor.shell.unnamed');
  const organizerName = organizer.organizer?.name || t('organizer.shell.unnamed');
  const { switching, switchError, onSwitchPersona } = usePersonaSwitch();

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
          ) : isOrganizer ? (
            <>
              <p className="truncate text-sm font-semibold text-white" title={organizerName} data-testid="organizer-name">{organizerName}</p>
              <p className="truncate text-xs text-[var(--color-gray-400)]">{t('organizer.shell.subtitle')}</p>
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
        <NavList nav={nav} collapsible={collapsible} onLinkClick={onLinkClick} />
      </nav>

      {/* Footer (phone and tablet drawer). On desktop these controls are in the top bar. */}
      {footer ? (
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
      ) : isVendor && vendor.can('staff') ? (
        <p className="shrink-0 border-t border-[var(--color-gray-800)] px-6 py-4 text-xs text-[var(--color-gray-400)]" data-testid="vendor-staff-in-app">{t('vendor.shell.staffInApp')}</p>
      ) : null}
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────── */
export function Shell({ children }: { children: ReactNode }) {
  const { ready, token, user, hasPermission, signOut, t, passwordChangeRequired } = useApp();
  const vendor = useVendor();
  const organizer = useOrganizer();
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
  const isOrganizer   = !!token && ORGANIZER_USER_TYPES.has(user?.userType ?? '');
  const adminEvents = useAdminEventsSummary(token, !!isAdminUser && hasPermission('events'));
  // Phase 2B S3: listings waiting for moderation, from the light counts endpoint (one small request).
  const moderationPending = useModerationPending(token, !!isAdminUser && (hasPermission('moderation') || hasPermission('moderation_decide')));
  const organizerOptions = useEventsOptions(isOrganizer && EVENTS_MODULE);
  const adminEventOptions = useEventsOptions(!!isAdminUser && EVENTS_MODULE);
  const eventRewardsOn = resultsOf(adminEventOptions).rewards;
  const integrationsOn = opsOf(organizerOptions).api || opsOf(organizerOptions).webhooks;
  const corporateEvents = useCorporateEventsAvailable(!!token && (!!isOrgUser || !!isHr));
  const merchAllowed = isVendor ? vendor.status === 'ready' && !!vendor.me?.permissions?.includes('products') : !!isAdminUser && (hasPermission('promotions') || hasPermission('promotions_approve'));
  const bannersOnly = useShopBannersAvailable(isVendor ? 'vendor' : 'admin', token, merchAllowed, isVendor ? vendorMerchTool(vendor.me?.tools, 'banners') : undefined);
  const salesOn = useShopFlashSalesAvailable(isVendor ? 'vendor' : 'admin', token, merchAllowed, isVendor ? vendorMerchTool(vendor.me?.tools, 'flashSales') : undefined);
  // The merch page (banners and flash sales) shows while either is switched on.
  const bannersOn = bannersOnly || salesOn;

  const taxRatesOn = useTaxRatesAvailable(token, !!isAdminUser && hasPermission('payments'));
  // B5b: an HR session stored before ORG_ONLY_SPONSORS went on picks up the organisation marks.
  useHrToOrgRefresh();

  // Build the visible nav — portal staff only see items their ACL permits.
  // Overview (/admin) is always visible to all admin users.
  const visibleNav = isVendor
    ? (vendor.status === 'ready' ? vendorNav(vendor.me?.permissions ?? [], vendor.me?.tools, vendor.lowCount, vendor.waitingCount, bannersOn) : [])
    : isOrganizer
    ? (!EVENTS_MODULE ? [] : organizer.status === 'ready' ? organizerNav(organizer.organizer?.status ?? null, organizer.role, integrationsOn) : organizerNav(null, null))
    : isAdminUser
    ? ADMIN_NAV.filter(item => {
        if (item.href === '/admin/shop-merch' && !bannersOn) return false;
        if (item.href === '/admin/tax-rates' && !taxRatesOn) return false;
        if (item.href === '/admin/events' && !adminEvents.available) return false;
        if (item.href === '/admin/event-rewards' && !(adminEvents.available && eventRewardsOn)) return false;
        if (!item.aclScope) return true;             // no scope = super-admin only (overview)
        if (!isPortalStaff) return true;             // super-admin sees everything
        return scopesOf(item).some(hasPermission);   // portal staff: check ACL
      }).map(item => (item.href === '/admin/events' && adminEvents.submitted > 0
        ? { ...item, count: { n: adminEvents.submitted, labelKey: 'admin.nav.eventsCount' as MessageKey, tone: 'warning' as const } }
        : item.href === '/admin/moderation' && moderationPending > 0
        ? { ...item, count: { n: moderationPending, labelKey: 'admin.nav.moderationCount' as MessageKey, tone: 'warning' as const } }
        : item))
    : isOrgUser ? orgNav(user?.organizationRoles, corporateEvents)
    : isHr ? hrNav(corporateEvents)
    : OPERATOR_NAV.filter(item => !item.aclScope || user?.userType !== 'gym_staff' || scopesOf(item).some(hasPermission));

  // Where this person must go instead of the current page, or null when they may see it. One decision
  // drives both the redirect and the render: a page's content (and its requests) waits until it passes.
  const path = pathname.replace(/\/$/, '') || '/';
  const vendorArea = isVendor && vendor.status === 'ready'
    ? [...VENDOR_AREAS].reverse().find(a => path === a.href || path.startsWith(`${a.href}/`)) ?? null
    : null;
  // Its permission and, where it has one, its tool (S3 sales: walkInSales) — both fail closed.
  const vendorPermissionMissing = !!vendorArea && !vendorAreaOpen(vendorArea, vendor.me?.permissions ?? [], vendor.me?.tools);
  // S6 reports (spec §0.1): with the tool switched off, back home with no message (never "feature off").
  const vendorBounceQuiet = !!vendorArea?.quietWhenOff && !!vendorArea.tool && vendor.me?.tools?.[vendorArea.tool] !== true;
  // The public gym page (/g, opened from a gym's QR code) is for everyone, signed in or not: no redirect, no sidebar.
  // The gym pass invite page (/gym-pass, opened from an invitation link) is public in the same way.
  const isPublicGymPage = path === '/g' || path.startsWith('/g/') || path === '/gym-pass' || path.startsWith('/gym-pass/');
  // The member portal (/m) has its own session, its own frame and its own sign-in: the staff shell stays out of it.
  const isMemberArea = path === '/m' || path.startsWith('/m/');
  const redirectTo = ((): string | null => {
    if (!ready) return null;
    if (isPublicGymPage) return null;
    if (isMemberArea) return null;
    if (!token) return path !== '/login' && path !== '/' ? '/login' : null;

    // A business (vendor or vendor staff) only ever sees /vendor; nobody else does.
    const inVendorArea = path === '/vendor' || path.startsWith('/vendor/');
    if (isVendor) return !inVendorArea || vendorPermissionMissing ? '/vendor/' : null;
    if (inVendorArea) return homeFor(user);

    // Events S2 (spec §3): an organizer or organizer staff only ever sees /organizer. Anyone else signed in may open
    // /organizer/onboarding to request the capability (state A); the other organizer pages send them home.
    const inOrganizerArea = path === '/organizer' || path.startsWith('/organizer/');
    if (isOrganizer) return inOrganizerArea ? null : '/organizer/';
    if (inOrganizerArea && path !== '/organizer/onboarding') return homeFor(user);

    // B5b: company HR in the organisation area: an old /hr page opens the /org page of the same name.
    if (isOrgUser && isHrInOrg(user)) {
      const to = orgPathForHr(path);
      if (to) return to;
      // Anywhere else outside /org (e.g. /login right after sign-in): the same page the login page opens, so the
      // two redirects agree instead of racing.
      if (path !== '/org' && !path.startsWith('/org/')) return orgHome(user?.organizationRoles);
    }
    // Someone signed in for an organisation's billing only ever sees /org; nobody else does.
    // Exact area match: /organizer (events S2) is not the /org area.
    const inOrgArea = path === '/org' || path.startsWith('/org/');
    if (isOrgUser && !inOrgArea) return orgNav(user?.organizationRoles)[0].href;
    if (!isOrgUser && inOrgArea) return user?.userType === 'admin' ? '/admin' : user?.userType === 'corporate_hr' ? '/hr' : '/dashboard';

    // Company HR only ever sees /hr; nobody else does.
    if (user?.userType === 'corporate_hr' && !isOrgUser && !path.startsWith('/hr')) return '/hr';
    if (user?.userType !== 'corporate_hr' && path.startsWith('/hr')) return user?.userType === 'admin' ? '/admin' : '/dashboard';

    // Block non-admin users from admin routes
    if (user?.userType !== 'admin' && path.startsWith('/admin')) return '/dashboard';

    // Custom gym passes page: gym owners and gym staff only.
    if ((path === '/owner/memberships' || path.startsWith('/owner/memberships/')) && user?.userType !== 'gym_operator' && user?.userType !== 'gym_staff') return homeFor(user);

    // All admin users (including portal staff) go to /admin, not operator pages
    if (user?.userType === 'admin' && ['/dashboard', '/scan', '/checkins'].includes(path)) return '/admin';

    // Portal staff: away from pages outside their ACL, to the first permitted page (or the overview)
    if (isPortalStaff && path.startsWith('/admin')) {
      const matchedItem = matchAdminNav(path);
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
      if (!vendorBounceQuiet) toast.error(t(vendorArea?.noAccessKey ?? 'vendor.noAccess'));
      bouncedFrom.current = path;
    }
    router.replace(redirectTo);
  }, [redirectTo, vendorPermissionMissing, vendorBounceQuiet, vendorArea, path, router, toast, t]);

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

  // Member portal: no staff header, nav or redirects (the member frame draws its own).
  if (isMemberArea) return <>{children}</>;

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

  const isLoginPage = path === '/login' || !token || isPublicGymPage;

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
          {isPublicGymPage ? <div className="w-24" /> : <LanguageToggle className="justify-self-end" />}
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
  // Organizer area: the context loads before any organizer page renders; suspended organizers see the banner everywhere (§5.1).
  const inOrganizerPath = pathname === '/organizer' || pathname.startsWith('/organizer/');
  const organizerLoading = inOrganizerPath && EVENTS_MODULE && (organizer.status === 'loading' || (isOrganizer && organizer.status === 'none'));
  const organizerBanner = inOrganizerPath && organizer.status === 'ready' && organizer.organizer?.status === 'suspended'
    ? <div data-testid="organizer-suspended-banner"><Alert tone="error" className="mb-4">{fmt(t('organizer.suspendedBanner'), { reason: organizer.organizer.statusReason || t('organizer.status.noReason') })}</Alert></div>
    : null;
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
        <SidebarContent nav={visibleNav} collapsible={!!isAdminUser} footer={false} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">

        <TopBar nav={visibleNav} />

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
          ) : organizerLoading ? (
            <div className="space-y-4" aria-busy="true" data-testid="organizer-loading">
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          ) : (
            <>
              {vendorBanner}
              {organizerBanner}
              {children}
            </>
          )}
        </main>

      </div>

      {/* The drawer comes after the main area in the page so the top bar's language, role and sign-out
          controls are the first of their kind; it is position: fixed, so where it sits here does not matter. */}
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
        <SidebarContent nav={visibleNav} collapsible={!!isAdminUser} onLinkClick={() => setMobileOpen(false)} />
      </aside>
    </div>
  );
}
