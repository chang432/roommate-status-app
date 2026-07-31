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
      items: [{ id: 'item-1', text: 'Wipe counters', checkedBy: [], checkedByIds: [] }],
    }),
    feedItem('polls', {
      ...base,
      id: 'poll-1',
      title: 'Dinner?',
      createdBy: 'Andre',
      createdById: 'andre',
      options: [{ id: 'option-1', text: 'Tacos', voters: [], voterIds: [] }],
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
        groupId: 'shire', name: 'The Shire', showFeed: true,
        showRoster: false, showBookClub: false,
      }] }
    } else if (path === '/api/roommates') {
      payload = [
        { id: 'andre', name: 'Andre', role: 'admin', status: 'free' },
        { id: 'kayla', name: 'Kayla', role: 'member', status: 'busy' },
      ]
    } else if (path === '/api/feed') {
      payload = feedFixture()
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
    { tab: 'TV', card: 'Severance' },
  ]) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    const cardToggle = page.getByRole('button', { name: new RegExp(card) })
    await expect(cardToggle).toBeVisible()
    await cardToggle.click()
    await expect(cardToggle).toHaveAttribute('aria-expanded', 'true')
  }

  await page.screenshot({
    path: testInfo.outputPath('group-feed-desktop.png'),
    fullPage: true,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Group Feed' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('tab', { name: /^Requests/ }).click()
  await expect(page.getByRole('button', { name: /Pick up milk/ })).toBeVisible()
  await page.getByRole('button', { name: 'Create a request' }).click()
  await expect(page.getByRole('dialog', { name: 'Create a request' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

  await page.screenshot({
    path: testInfo.outputPath('group-feed-phone.png'),
    fullPage: true,
  })
})
