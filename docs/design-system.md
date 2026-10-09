# FitFlex portal design system

Tokens live in `app/globals.css` (`@theme`). Primitives live in `src/components/shared.tsx`
(re-exporting `src/components/ui/*`). Import everything from `@/components/shared`. Use tokens
through arbitrary values (`bg-[var(--color-brand-600)]`) and merge classes with `cn()` from `@/lib/cn`.

Every user-visible string comes from `src/lib/i18n.ts` (`en` and `sw`); shared strings use the `common.*`
namespace. Swahili strings are marked as needing native review. Leave room for Swahili being longer than
English: no fixed widths, allow wrapping or ellipsis.

## Tokens

### Brand ramp (green)
| Token | Role |
|---|---|
| `brand-25` to `brand-100` | Tints: selected rows, chips, hover washes |
| `brand-400`, `brand-500` | Bright "energy" greens: charts, highlights, accents on dark surfaces. Not for text. |
| `brand-600` | Primary fills, links, focus outline. AA with white (5.7:1 either way). |
| `brand-700` to `brand-900` | Hover/pressed states, brand text on tints (`--color-fg-brand` is 700) |

### Semantic colours
`error`, `warning`, `success` (teal-leaning) and `info` (blue) each have 25 to 800 steps. Typical pairing:
`-50` background, `-200` border, `-800` text (see `Alert`, `Toast`). `-600` is the icon/fill colour.
`accent` (gold) is for fills and graphics only, with dark text on top, never as text on white.

### Neutrals and aliases
`gray-25` to `gray-950`; use the aliases in components: `fg-primary/secondary/tertiary/quaternary/disabled`,
`bg-primary/secondary/tertiary`, `border-primary`, `border-secondary`.
`border-input` (`#858d9d`) is the form-control boundary and keeps 3:1 against white (WCAG 1.4.11);
use it for any input-like outline instead of `border-primary`.

### Type scale
caption 12px (the floor, `text-xs`), small 14px (`text-sm`), body 16px, h3 18px, h2 20px, h1 24px,
display 30px. Font is Inter via `--font-sans`.

### Radius, shadow
`--radius-xs` to `--radius-2xl`, `--radius-full`; `--shadow-xs` to `--shadow-xl`.

### Focus and motion
A global `:focus-visible` outline (2px brand-600, offset 2px) covers links, buttons, summary, `[tabindex]`,
select, textarea and input; components with their own focus style (`.ui-input`, Tailwind `focus-visible:*`
utilities) override it. `prefers-reduced-motion: reduce` removes transitions and animations; the spinner is
slowed instead, skeleton pulses become static.

## Form controls

```tsx
<Field label="Gym" hint="Shown to members" error={errors.gym} required>
  <Input value={v} onChange={...} />          {/* md (default) */}
</Field>
<Field label="Region"><Select size="sm"><option>...</option></Select></Field>
<Field label="Notes"><Textarea rows={4} /></Field>
```

- `Input`, `Select`, `Textarea` share the `.ui-input` look. `size="sm"` is compact (about 32px, 12px text);
  it replaces the old `!py-1 !text-xs` overrides.
- `Field` labels a single child control and wires `id`, `aria-describedby` (hint or error),
  `aria-invalid` (when `error` is set) and `aria-required` (when `required` is set). It works for native
  `input/select/textarea` and for any component with `acceptsId = true` (as `Input`, `Select`, `Textarea` do).
- `SearchableSelect` is an ARIA combobox: pass `ariaLabel` to name it (defaults to the placeholder).

## Button

```tsx
<Button variant="primary" loading={saving} onClick={save}>{t('common.save')}</Button>
```
`loading` shows a spinner, sets `aria-busy` and disables the button.

## Table

```tsx
<Table aria-label={t('gyms.tableLabel')}>
  <THead><Tr><Th>Name</Th><Th>Status</Th></Tr></THead>
  <TBody><Tr><Td>FitFlex Gym</Td><Td>Active</Td></Tr></TBody>
</Table>
```
`Table` wraps `.ui-table` in a focusable, labelled `overflow-x-auto` region so horizontal scrolling works from
the keyboard. `Th` defaults to `scope="col"`. For sortable, searchable, paged lists use `DataTable`
(`aria-sort`, real sort buttons, labelled pagination).

## Feedback

### Toast
```tsx
const toast = useToast();
toast.success(t('saved'));
toast.error(t('failed'), { title: t('couldNotSave') });
toast.dismiss();            // all, or toast.dismiss(id)
```
`ToastProvider` is mounted in `app/providers.tsx`. Bottom-right (bottom-centre on phones), max 4 visible,
auto-dismiss after 6s (errors 10s, `duration: 0` to keep), paused while hovered or focused. Errors are in a
`role="alert"` region, the rest in a polite `role="status"` region. Existing inline `Alert`s are unchanged;
use a toast for confirmation of an action, an `Alert` for a message tied to a spot on the page.

### Skeleton
```tsx
<div aria-busy={loading}>{loading ? <SkeletonTable rows={6} columns={5} /> : <Table>...</Table>}</div>
```
`Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonTable` are `aria-hidden`; put `aria-busy` on the region.

### EmptyState and ErrorState
```tsx
<EmptyState icon={<Inbox />} title={t('none')} body={t('noneBody')} action={<Button>...</Button>} />
<ErrorState title={t('common.somethingWrong')} message={t('common.errorBody')} onRetry={reload} retryLabel={t('common.tryAgain')} />
```
`ErrorState` takes already-translated strings; the retry button shows only when `onRetry` is passed.

### Route files
`app/loading.tsx` (spinner placeholder), `app/error.tsx` (ErrorState with `reset`, never prints the raw error),
`app/not-found.tsx` (404 with a link home; exported as `404.html`) and `app/global-error.tsx` (root-layout
failure; has no providers, so it reads the saved language from `localStorage`).

## Dialogs
`Dialog` and `ConfirmDialog` close on Escape, trap Tab, label themselves, return focus to the opener and lock
page scroll while open. `ConfirmDialog` button labels default to `common.confirm`, `common.cancel` and
`common.pleaseWait`; pass `confirmLabel`/`cancelLabel` to override.
