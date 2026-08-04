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
