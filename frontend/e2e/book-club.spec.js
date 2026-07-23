import { expect, test } from '@playwright/test'

const MEETING_ID = 'meeting#demo'
const BOOK_ID = 'completed-book'
const NOW = Date.UTC(2030, 7, 7, 23, 30)

function bookClubFixture() {
  const meeting = {
    id: MEETING_ID,
    bookId: 'active-book',
    bookTitle: 'The Fifth Season',
    bookAuthor: 'N. K. Jemisin',
    readingTarget: 'Read through Chapter 9',
    bookOwnerId: 'kayla',
    bookOwnerName: 'Kayla',
    snackOwnerId: 'andre',
    snackOwnerName: 'Andre',
    scheduledAt: NOW,
    status: 'scheduled',
    createdById: 'andre',
    createdByName: 'Andre',
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    responses: [
      {
        userId: 'andre',
        userName: 'Andre',
        attendanceStatus: 'attending',
        chaptersReadThrough: 6,
      },
      {
        userId: 'kayla',
        userName: 'Kayla',
        attendanceStatus: 'maybe',
        chaptersReadThrough: 5,
      },
    ],
  }
  const book = {
    id: BOOK_ID,
    title: 'A Psalm for the Wild-Built',
    author: 'Becky Chambers',
    bookOwnerId: 'andre',
    bookOwnerName: 'Andre',
    status: 'completed',
    selectedAt: NOW - 2_000_000,
    completedAt: NOW - 1_000_000,
    reviewCount: 1,
    averageRating: 4,
    finishedCount: 0,
    unfinishedCount: 0,
    unknownFinishCount: 1,
    viewerReview: {
      userId: 'andre',
      userName: 'Andre',
      rating: 4,
      finished: null,
      note: '',
      createdAt: NOW - 500,
      updatedAt: NOW - 500,
    },
    reviews: [{
      userId: 'andre',
      userName: 'Andre',
      rating: 4,
      finished: null,
      note: '',
      createdAt: NOW - 500,
      updatedAt: NOW - 500,
    }],
  }
  return { meeting, book }
}

async function mockBookClub(page) {
  const { meeting, book } = bookClubFixture()
  let forum = { meetingId: MEETING_ID, locked: false, threads: [] }
  let books = [book]

  await page.addInitScript(() => {
    localStorage.setItem('roomie-session', JSON.stringify({
      id: 'andre',
      name: 'Andre',
      username: 'andre',
      groupId: 'book-club',
      activeGroupId: 'book-club',
      hasGroup: true,
    }))
  })

  // Match proxied API calls without intercepting Vite source modules under
  // `/src/api/`.
  await page.route(/^http:\/\/127\.0\.0\.1:4173\/api\//, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let payload
    let status = 200

    if (path === '/api/accounts/andre') {
      payload = { user: {
        id: 'andre',
        name: 'Andre',
        username: 'andre',
        groupId: 'book-club',
        hasGroup: true,
      } }
    } else if (path === '/api/groups') {
      payload = { groups: [{ groupId: 'book-club', name: 'Book Club' }] }
    } else if (path === '/api/groups/current') {
      payload = { group: {
        groupId: 'book-club',
        name: 'Book Club',
        showBookClub: true,
      } }
    } else if (path === '/api/roommates') {
      payload = [
        { id: 'andre', name: 'Andre', role: 'admin' },
        { id: 'kayla', name: 'Kayla', role: 'member' },
      ]
    } else if (path === '/api/book-club') {
      payload = { summary: {
        configuration: {
          bookOwnerOrderUserIds: ['kayla', 'andre'],
          snackOwnerOrderUserIds: ['andre', 'kayla'],
        },
        activeBook: {
          id: 'active-book',
          title: 'The Fifth Season',
          author: 'N. K. Jemisin',
          bookOwnerId: 'kayla',
          bookOwnerName: 'Kayla',
          selectedAt: NOW - 1_000_000,
        },
        openMeeting: meeting,
      } }
    } else if (path === '/api/book-club/meetings') {
      payload = { meetings: [meeting] }
    } else if (path === '/api/book-club/books/completed') {
      payload = { books }
    } else if (path.endsWith('/review') && method === 'PUT') {
      const review = request.postDataJSON()
      books = [{
        ...books[0],
        reviewCount: 1,
        averageRating: review.rating,
        finishedCount: review.finished ? 1 : 0,
        unfinishedCount: review.finished ? 0 : 1,
        unknownFinishCount: 0,
        viewerReview: {
          ...books[0].viewerReview,
          ...review,
          updatedAt: NOW,
        },
        reviews: [{
          ...books[0].reviews[0],
          ...review,
          updatedAt: NOW,
        }],
      }]
      payload = { books }
    } else if (path.endsWith('/forum') && method === 'GET') {
      payload = { forum }
    } else if (path.endsWith('/forum') && method === 'POST') {
      const entry = request.postDataJSON()
      if (entry.parentPostId) {
        forum = {
          ...forum,
          threads: forum.threads.map((thread) => (
            thread.id === entry.parentPostId
              ? {
                  ...thread,
                  replies: [...thread.replies, {
                    id: 'forum#reply',
                    meetingId: MEETING_ID,
                    parentPostId: thread.id,
                    authorId: 'andre',
                    authorName: 'Andre',
                    body: entry.body,
                    createdAt: NOW,
                    updatedAt: NOW,
                    lastActivityAt: NOW,
                  }],
                }
              : thread
          )),
        }
      } else {
        forum = {
          ...forum,
          threads: [{
            id: 'forum#topic',
            meetingId: MEETING_ID,
            title: entry.title,
            authorId: 'andre',
            authorName: 'Andre',
            body: entry.body,
            createdAt: NOW,
            updatedAt: NOW,
            lastActivityAt: NOW,
            replies: [],
          }],
        }
      }
      payload = { forum }
      status = 201
    } else if (path.includes('/api/book-club/meetings/') && path.endsWith('/forum')) {
      payload = { forum }
    } else if (path.includes('/api/book-club/meetings/')) {
      payload = { meeting }
    } else {
      throw new Error(`Unhandled API request: ${method} ${path}`)
    }

    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
}

test('uses meeting forums and completes a legacy review', async ({ page }, testInfo) => {
  await mockBookClub(page)
  await page.goto('/book-club')

  await expect(page.getByRole('heading', { name: 'Book Club', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()

  await page.getByRole('button', { name: 'Meetings' }).click()
  await page.getByRole('button', { name: /The Fifth Season/, expanded: false }).click()
  await page.getByRole('tab', { name: 'Forum' }).click()
  await page.getByLabel('New topic title').fill('Favorite passage')
  await page.getByLabel('New topic post').fill('Which scene stayed with you?')
  await page.getByRole('button', { name: 'Post topic' }).click()
  await expect(page.getByRole('heading', { name: 'Favorite passage' })).toBeVisible()

  await page.getByRole('button', { name: 'Reply' }).click()
  await page.getByLabel('Reply to Favorite passage').fill('The final conversation.')
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.getByText('The final conversation.')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('book-club-forum-desktop.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Library' }).click()
  await expect(page.getByText('Finish status not recorded').first()).toBeVisible()
  const fiveStars = page.getByRole('radio', { name: '5 stars' })
  await fiveStars.locator('..').click()
  await expect(fiveStars).toBeChecked()
  const finished = page.getByRole('radio', { name: 'Finished' })
  await finished.locator('..').click()
  await expect(finished).toBeChecked()
  await page.getByPlaceholder('What stayed with you?').fill('Warm, thoughtful, and hopeful.')
  await page.getByRole('button', { name: 'Update review' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('book-club-library-desktop.png'),
    fullPage: true,
  })
})

test('keeps the Book Club library usable on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBookClub(page)
  await page.goto('/book-club')
  await page.getByRole('button', { name: 'Library' }).click()

  await expect(page.getByRole('searchbox', { name: 'Search completed books' })).toBeVisible()
  await expect(page.getByRole('button', { name: /A Psalm for the Wild-Built/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update review' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('book-club-library-mobile.png'),
    fullPage: true,
  })
})
