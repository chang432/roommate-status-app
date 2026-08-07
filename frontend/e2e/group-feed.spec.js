import { expect, test } from '@playwright/test'

const NOW = Date.UTC(2030, 0, 2, 12)

function feedItem(type, payload) {
  return {
    id: payload.id,
    type,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    sortAt: payload.updatedAt,
    title: payload.title || payload.text,
    subtitle: type,
    actor: 'Andre',
    isArchived: false,
    payload,
  }
}

function feedFixture() {
  const base = {
    createdAt: NOW,
    updatedAt: NOW,
    isArchived: false,
  }
  return [
    feedItem('counters', {
      ...base,
      id: 'counter-1',
      title: 'Days without a kitchen spill',
      mode: 'automatic',
      createdBy: 'Andre',
      createdById: 'andre',
      lastIncidentAt: Date.now() - (6 * 24 * 60 * 60 * 1000),
      currentValue: 6,
      version: 1,
    }),
    feedItem('events', {
      ...base,
      id: 'event-1',
      text: 'Movie night',
      proposedBy: 'Andre',
      proposedById: 'andre',
      members: ['Andre'],
      memberIds: ['andre'],
      comments: [],
      startAt: null,
      endAt: null,
      isLive: false,
      isExpired: false,
    }),
    feedItem('requests', {
      ...base,
      id: 'request-1',
      text: 'Pick up milk',
      requester: 'Andre',
      requesterId: 'andre',
      requestedIds: ['kayla'],
      requested: [{ id: 'kayla', name: 'Kayla', response: 'pending' }],
      comments: [],
    }),
    feedItem('checklists', {
      ...base,
      id: 'checklist-1',
      title: 'Kitchen reset',
      createdBy: 'Andre',
      createdById: 'andre',
      items: [
        {
          id: 'item-1',
          text: 'Wipe counters',
          checkedBy: [{ id: 'kayla', name: 'Kayla' }],
          checkedByIds: ['kayla'],
        },
        { id: 'item-2', text: 'Take out trash', checkedBy: [], checkedByIds: [] },
      ],
    }),
    feedItem('polls', {
      ...base,
      id: 'poll-1',
      title: 'Dinner?',
      createdBy: 'Andre',
      createdById: 'andre',
      options: [
        {
          id: 'option-1',
          text: 'Tacos',
          voters: [
            { id: 'andre', name: 'Andre' },
            { id: 'kayla', name: 'Kayla' },
          ],
          voterIds: ['andre', 'kayla'],
        },
        {
          id: 'option-2',
          text: 'Pizza',
          voters: [{ id: 'andre', name: 'Andre' }],
          voterIds: ['andre'],
        },
      ],
      comments: [],
    }),
    feedItem('tv', {
      ...base,
      id: 'show-1',
      title: 'Severance',
      createdBy: 'Andre',
      createdById: 'andre',
      members: [{ id: 'andre', name: 'Andre', season: 1, episode: 2 }],
      isWatchpartyLive: false,
    }),
  ]
}

async function mockFeedPage(page) {
  await page.addInitScript(() => {
    localStorage.setItem('roomie-session', JSON.stringify({
      id: 'andre',
      name: 'Andre',
      username: 'andre',
      groupId: 'shire',
      activeGroupId: 'shire',
      hasGroup: true,
    }))
  })

  await page.route(/^http:\/\/127\.0\.0\.1:4173\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname
    let payload
    if (path === '/api/accounts/andre') {
      payload = { user: {
        id: 'andre', name: 'Andre', username: 'andre', groupId: 'shire',
        hasGroup: true,
      } }
    } else if (path === '/api/groups') {
      payload = { groups: [{
        groupId: 'shire', name: 'The Shire', joinCode: 'SHIRE12',
        enabledModules: ['events', 'requests', 'checklists', 'polls', 'counters', 'tv'],
        theme: 'system', viewerIsAdmin: true,
      }] }
    } else if (path === '/api/groups/current') {
      payload = { group: {
        groupId: 'shire', name: 'The Shire', joinCode: 'SHIRE12',
        enabledModules: ['events', 'requests', 'checklists', 'polls', 'counters', 'tv'],
        theme: 'system', viewerIsAdmin: true,
      } }
    } else if (path === '/api/roommates') {
      payload = [
        { id: 'andre', name: 'Andre', role: 'admin', status: 'free' },
        { id: 'kayla', name: 'Kayla', role: 'member', status: 'busy' },
      ]
    } else if (path === '/api/feed') {
      payload = feedFixture()
    } else if (path === '/api/counters/counter-1') {
      const counter = feedFixture().find((item) => item.type === 'counters').payload
      payload = {
        counter,
        entries: [{
          id: 'incident-1',
          kind: 'incident',
          occurredAt: counter.lastIncidentAt,
          createdAt: counter.lastIncidentAt,
          createdById: 'andre',
          createdBy: 'Andre',
          note: 'Mopped and reset the tracker',
        }],
        nextCursor: null,
      }
    } else {
      payload = {}
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport)
}

async function waitForAnimations(locator) {
  await locator.evaluate((element) => Promise.all(
    element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
  ))
}

async function expectExpandedCardSettled(cardToggle) {
  await expect(cardToggle).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => cardToggle.locator('xpath=..').evaluate((card) => {
    const expandableRegion = card.lastElementChild
    const expandableContent = expandableRegion.firstElementChild
    return Math.abs(
      expandableRegion.getBoundingClientRect().height
        - expandableContent.scrollHeight,
    ) < 1
  })).toBe(true)
}

test('uses dismissible bottom trays for profile and active-group settings', async ({ page }, testInfo) => {
  await mockFeedPage(page)

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')

    await page.getByRole('button', { name: 'Open profile settings' }).click()
    const profileTray = page.getByRole('dialog', { name: 'Profile settings' })
    await expect(profileTray).toHaveAttribute('data-expanded', 'false')
    await expect(profileTray.getByRole('button', { name: /Profile Update your display name/i })).toBeVisible()
    await expect(profileTray.getByLabel('Display name')).toBeHidden()
    await waitForAnimations(profileTray)
    await page.screenshot({
      path: testInfo.outputPath(`profile-settings-menu-${viewport.width}.png`),
    })

    const profileHeader = profileTray.locator('header').first()
    await profileHeader.dispatchEvent('pointerdown', {
      pointerId: 6, pointerType: 'touch', button: 0, clientY: 140,
    })
    await profileHeader.dispatchEvent('pointermove', {
      pointerId: 6, pointerType: 'touch', clientY: 40,
    })
    await profileHeader.dispatchEvent('pointerup', {
      pointerId: 6, pointerType: 'touch', clientY: 40,
    })
    await expect(profileTray).toHaveAttribute('data-expanded', 'true')
    await expect.poll(() => profileTray.evaluate((element) => (
      Math.round(element.getBoundingClientRect().height)
    ))).toBe(viewport.height)

    await profileTray.getByRole('button', { name: /Change password Choose/i }).click()
    await expect(profileTray.getByLabel('New password', { exact: true })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath(`profile-settings-expanded-${viewport.width}.png`),
    })
    await expect.poll(() => profileTray.evaluate((element) => (
      element.scrollWidth <= element.clientWidth
    ))).toBe(true)
    await profileTray.getByRole('button', { name: 'Back to settings' }).click()
    await expect(profileTray).toHaveAttribute('data-expanded', 'false')
    await profileTray.getByRole('button', { name: 'Close' }).click()
    await expect(profileTray).toBeHidden()

    await page.getByRole('button', { name: /Open group switcher/ }).click()
    await page.getByLabel('Your groups').getByRole('button', { name: 'Edit' }).click()
    const groupTray = page.getByRole('dialog', { name: 'Group settings' })
    await expect(groupTray.getByText('SHIRE12')).toBeHidden()
    await waitForAnimations(groupTray)
    await waitForAnimations(page.getByLabel('Your groups'))
    await page.screenshot({
      path: testInfo.outputPath(`group-settings-menu-${viewport.width}.png`),
    })
    await groupTray.getByRole('button', { name: /Group details/i }).click()
    await expect(groupTray.getByText('SHIRE12')).toBeVisible()
    await expect(groupTray).toHaveAttribute('data-expanded', 'true')
    await groupTray.getByRole('button', { name: 'Back to settings' }).click()
    await groupTray.getByRole('button', { name: /Enabled modules/i }).click()
    await expect(groupTray.getByRole('checkbox', { name: /Events/i })).toBeChecked()
    await groupTray.getByRole('button', { name: 'Back to settings' }).click()
    await groupTray.getByRole('button', { name: /Appearance Current theme/i }).click()
    await expect(groupTray.getByRole('radio', { name: /Forest/i })).toBeEnabled()
    await page.screenshot({
      path: testInfo.outputPath(`group-settings-expanded-${viewport.width}.png`),
    })
    await expectNoHorizontalOverflow(page)

    const header = groupTray.locator('header').first()
    await header.dispatchEvent('pointerdown', {
      pointerId: 7, pointerType: 'touch', button: 0, clientY: 20,
    })
    await header.dispatchEvent('pointermove', {
      pointerId: 7, pointerType: 'touch', clientY: 150,
    })
    await header.dispatchEvent('pointerup', {
      pointerId: 7, pointerType: 'touch', clientY: 150,
    })
    await expect(groupTray).toBeHidden()
  }
})

test('keeps every registered feed card usable at desktop and phone widths', async ({
  page,
}, testInfo) => {
  await mockFeedPage(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Group Feed' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^All/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  for (const { tab, card } of [
    { tab: 'Events', card: 'Movie night' },
    { tab: 'Requests', card: 'Pick up milk' },
    { tab: 'Checklists', card: 'Kitchen reset' },
    { tab: 'Polls', card: 'Dinner?' },
    { tab: 'Counters', card: 'Days without a kitchen spill' },
    { tab: 'TV', card: 'Severance' },
  ]) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    const cardToggle = page.getByRole('button', { name: new RegExp(card) })
    await expect(cardToggle).toBeVisible()
    if (tab === 'Checklists') {
      await expect(cardToggle).toContainText('1 of 2 complete')
    }
    if (tab === 'Polls') await expect(cardToggle).toContainText('2 voters')
    await cardToggle.click()
    await expect(cardToggle).toHaveAttribute('aria-expanded', 'true')
  }

  await page.getByRole('tab', { name: /^Checklists/ }).click()
  const desktopChecklistCard = page.getByRole('button', { name: /Kitchen reset/ })
  await expect(desktopChecklistCard)
    .toContainText('Andre · just now · 1 of 2 complete')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath('checklist-card-desktop.png'),
    fullPage: true,
  })

  await page.getByRole('tab', { name: /^Polls/ }).click()
  const desktopPollCard = page.getByRole('button', { name: /Dinner\?/ })
  await desktopPollCard.click()
  await expectExpandedCardSettled(desktopPollCard)
  await expectNoHorizontalOverflow(page)

  await page.screenshot({
    path: testInfo.outputPath('group-feed-desktop.png'),
    fullPage: true,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Group Feed' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('tab', { name: /^Checklists/ }).click()
  const phoneChecklistCard = page.getByRole('button', { name: /Kitchen reset/ })
  await expect(phoneChecklistCard)
    .toContainText('Andre · just now · 1 of 2 complete')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath('checklist-card-phone.png'),
    fullPage: true,
  })

  await page.getByRole('tab', { name: /^Polls/ }).click()
  const pollCard = page.getByRole('button', { name: /Dinner\?/ })
  await expect(pollCard).toContainText('2 voters')
  await page.getByRole('button', { name: 'Create a poll' }).click()
  await expect(page.getByRole('dialog', { name: 'Create a poll' })).toBeVisible()
  await page.getByLabel('Poll title').fill('Weekend plans?')
  await page.getByRole('textbox', { name: 'Poll option 1', exact: true }).fill('Hike')
  await page.getByRole('button', { name: 'Add option' }).click()
  await page.getByRole('textbox', { name: 'Poll option 2', exact: true }).fill('Movie')
  await expect(page.getByRole('button', { name: 'Post poll' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.screenshot({
    path: testInfo.outputPath('poll-create-phone.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Cancel' }).click()
  await pollCard.click()
  await expectExpandedCardSettled(pollCard)
  const voteRequest = page.waitForRequest((request) => (
    request.method() === 'DELETE'
      && new URL(request.url()).pathname
        === '/api/polls/poll-1/options/option-1/votes'
  ))
  await page.getByRole('button', { name: 'Remove vote from Tacos' }).click()
  await voteRequest
  await expectExpandedCardSettled(pollCard)
  await expectNoHorizontalOverflow(page)

  await page.screenshot({
    path: testInfo.outputPath('poll-card-phone.png'),
    fullPage: true,
  })
})

test('keeps counter tracking and history usable at desktop and phone widths', async ({
  page,
}, testInfo) => {
  await mockFeedPage(page)

  for (const viewport of [
    { width: 1280, height: 900, name: 'desktop' },
    { width: 390, height: 844, name: 'phone' },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.getByRole('tab', { name: /^Counters/ }).click()

    const counterCard = page.getByRole('button', { name: /Days without a kitchen spill/ })
    await expect(counterCard).toContainText('6 days')
    await counterCard.click()
    await expectExpandedCardSettled(counterCard)
    await expect(page.getByRole('region', { name: 'Counter history' })).toContainText(
      'Mopped and reset the tracker',
    )
    await expect(page.getByRole('button', { name: 'Log incident' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({
      path: testInfo.outputPath(`counter-history-${viewport.name}.png`),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Create a counter' }).click()
    const createDialog = page.getByRole('dialog', { name: 'Create a counter' })
    await createDialog.getByRole('radio', { name: /Manual count/ }).check()
    await expect(createDialog.getByLabel('Starting value')).toBeVisible()
    await waitForAnimations(createDialog)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({
      path: testInfo.outputPath(`counter-create-${viewport.name}.png`),
      fullPage: true,
    })
  }
})
