import type { Page } from '@playwright/test';

/**
 * Admin sidebar groups start closed, except the one holding the current page (Phase 2B S2).
 * Waits for the sidebar to render, then opens every closed group, so a spec can click any link and a
 * "this link is absent" check means the link does not exist rather than sits in a closed group.
 */
export async function openAllNavGroups(page: Page) {
  const groups = page.locator('aside:not(#mobile-drawer) [data-testid="nav-group"]');
  await groups.first().waitFor();
  const closed = groups.locator(':scope > button[aria-expanded="false"]');
  while (await closed.count() > 0) await closed.first().click();
}
