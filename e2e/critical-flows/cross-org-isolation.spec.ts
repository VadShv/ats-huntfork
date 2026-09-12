import { test, expect } from '../fixtures'

/**
 * Critical security flow: cross-organization isolation (RBAC v2, invariant A3).
 *
 * Guarantee: a resource that belongs to organization A must NOT be reachable
 * from organization B by direct ID — the API returns 404 (not 403, so we don't
 * even confirm the resource exists).
 *
 * Strategy (API-level, most reliable for an isolation check):
 *   1. Org A (authenticatedPage fixture) creates a job via the API.
 *   2. A brand-new user creates Org B, signs in, and requests Org A's job by ID.
 *   3. Expect 404.
 *
 * NOTE: requires the dev server (playwright webServer). Runs in CI / `test:e2e`;
 * it was authored but not executed in the constrained dev sandbox.
 */

test.describe('Cross-org isolation (A3)', () => {
  test('org B cannot read org A job by direct ID → 404', async ({ page, browser }) => {
    // ── Org A: create a job via the API using the authenticated fixture session ──
    // (page is authenticated as a fresh org owner via the authenticatedPage flow
    //  in fixtures; here we reuse `page`'s request context which carries cookies.)
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    const createResp = await page.request.post('/api/jobs', {
      data: {
        title: `Cross-org secret job ${Date.now()}`,
        status: 'draft',
      },
    })
    expect(createResp.ok(), 'org A can create its own job').toBeTruthy()
    const created = await createResp.json()
    const orgAJobId: string = created.id ?? created.job?.id
    expect(orgAJobId, 'created job id present').toBeTruthy()

    // Sanity: org A CAN read its own job.
    const ownResp = await page.request.get(`/api/jobs/${orgAJobId}`)
    expect(ownResp.status(), 'org A reads its own job').toBe(200)

    // ── Org B: fresh user + org in an isolated browser context ──
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    const idB = `${Date.now()}-b`
    const emailB = `e2e-crossorg-${idB}@test.local`
    const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!'

    await pageB.goto('/auth/sign-up')
    await pageB.waitForLoadState('networkidle')
    await pageB.getByLabel('Name').fill(`E2E CrossOrg ${idB}`)
    await pageB.getByLabel('Email').fill(emailB)
    await pageB.getByLabel('Password', { exact: true }).fill(password)
    await pageB.getByLabel('Confirm password').fill(password)
    await Promise.all([
      pageB.waitForResponse(r => r.url().includes('/api/auth/sign-up') && r.status() === 200, { timeout: 30_000 }),
      pageB.getByRole('button', { name: 'Sign up' }).click(),
    ])
    await pageB.waitForURL(u => u.pathname.includes('/onboarding/') || u.pathname.includes('/auth/sign-in'), { waitUntil: 'commit', timeout: 30_000 })
    if (pageB.url().includes('/auth/sign-in')) {
      await pageB.waitForLoadState('networkidle')
      await pageB.getByLabel('Email').fill(emailB)
      await pageB.getByLabel('Password').fill(password)
      await Promise.all([
        pageB.waitForResponse(r => r.url().includes('/api/auth/sign-in') && r.status() === 200, { timeout: 30_000 }),
        pageB.getByRole('button', { name: 'Sign in' }).click(),
      ])
      await pageB.waitForURL('**/onboarding/**', { waitUntil: 'commit', timeout: 30_000 })
    }
    await pageB.getByLabel('Organization name').waitFor({ state: 'visible', timeout: 30_000 })
    await pageB.getByLabel('Organization name').fill(`E2E Org B ${idB}`)
    await pageB.getByRole('button', { name: 'Create organization' }).click()
    await pageB.waitForURL('**/dashboard**', { waitUntil: 'commit' })

    // ── The isolation assertion: Org B requests Org A's job by ID → 404 ──
    const crossResp = await pageB.request.get(`/api/jobs/${orgAJobId}`)
    expect(crossResp.status(), 'org B must NOT read org A job (404, not 403)').toBe(404)

    await ctxB.close()
  })
})
