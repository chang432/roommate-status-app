import { expect, test } from '@playwright/test'

test('shows a backend login error', async ({ page }) => {
  await page.route('**/api/login', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Invalid username or password' }),
    })
  })

  await page.goto('/login')
  await expect(
    page.getByRole('heading', { name: 'Yorkshire Roomie Status' }),
  ).toBeVisible()

  await page.getByLabel('Username').fill('unknown')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText('Invalid username or password')).toBeVisible()
})
