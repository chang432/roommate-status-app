import { expect, test } from '@playwright/test'

const MEETING_ID = 'meeting#demo'
const ACTIVE_BOOK_ID = 'active-book'
const COMPLETED_BOOK_ID = 'completed-book'
const NOW = Date.UTC(2030, 7, 7, 23, 30)

function bookClubFixture() {
  const meeting = {
    id: MEETING_ID,
    bookId: ACTIVE_BOOK_ID,
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
      { userId: 'andre', userName: 'Andre', attendanceStatus: 'attending', chaptersReadThrough: 6, readingComplete: false },
      { userId: 'kayla', userName: 'Kayla', attendanceStatus: 'maybe', chaptersReadThrough: 5, readingComplete: true },
      { userId: 'ting', userName: 'Ting', attendanceStatus: null, chaptersReadThrough: 0, readingComplete: false },
    ],
  }
  const activeBook = {
    id: ACTIVE_BOOK_ID,
    title: 'The Fifth Season',
    author: 'N. K. Jemisin',
    bookOwnerId: 'kayla',
    bookOwnerName: 'Kayla',
    status: 'active',
    isCurrent: true,
    selectedAt: NOW - 1_000_000,
    completedAt: null,
    reviewCount: 0,
    averageRating: null,
    finishedCount: 0,
    unfinishedCount: 0,
    unknownFinishCount: 0,
    viewerReview: null,
    reviews: [],
    meetings: [meeting],
  }
  const completedBook = {
    id: COMPLETED_BOOK_ID,
    title: 'A Psalm for the Wild-Built',
    author: 'Becky Chambers',
    bookOwnerId: 'andre',
    bookOwnerName: 'Andre',
    status: 'completed',
    isCurrent: false,
    selectedAt: NOW - 2_000_000,
    completedAt: NOW - 1_500_000,
    reviewCount: 1,
    averageRating: 4,
    finishedCount: 0,
    unfinishedCount: 0,
    unknownFinishCount: 1,
    viewerReview: {
      userId: 'andre', userName: 'Andre', rating: 4, finished: null, note: '',
      createdAt: NOW - 500, updatedAt: NOW - 500,
    },
    reviews: [{
      userId: 'andre', userName: 'Andre', rating: 4, finished: null, note: '',
      createdAt: NOW - 500, updatedAt: NOW - 500,
    }],
    meetings: [],
  }
  return { meeting, activeBook, completedBook }
}

async function mockBookClub(page) {
  const { meeting, activeBook, completedBook } = bookClubFixture()
  let books = [activeBook, completedBook]
  const forums = {
    [MEETING_ID]: { meetingId: MEETING_ID, locked: false, threads: [] },
  }

  await page.addInitScript(() => {
    localStorage.setItem('roomie-session', JSON.stringify({
      id: 'andre', name: 'Andre', username: 'andre', groupId: 'book-club',
      activeGroupId: 'book-club', hasGroup: true,
    }))
  })

  await page.route(/^http:\/\/127\.0\.0\.1:4173\/api\//, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let payload
    let status = 200

    if (path === '/api/accounts/andre') {
      payload = { user: { id: 'andre', name: 'Andre', username: 'andre', groupId: 'book-club', hasGroup: true } }
    } else if (path === '/api/groups') {
      payload = { groups: [{ groupId: 'book-club', name: 'Book Club' }] }
    } else if (path === '/api/groups/current') {
      payload = { group: {
        groupId: 'book-club', name: 'Book Club', showBookClub: true,
        showRoster: true, showFeed: true, viewerIsAdmin: true,
      } }
    } else if (path === '/api/roommates') {
      payload = [
        { id: 'andre', name: 'Andre', role: 'admin' },
        { id: 'kayla', name: 'Kayla', role: 'member' },
        { id: 'ting', name: 'Ting', role: 'member' },
      ]
    } else if (path === '/api/book-club') {
      payload = { summary: {
        configuration: {
          bookOwnerOrderUserIds: ['kayla', 'andre'],
          snackOwnerOrderUserIds: ['andre', 'kayla'],
        },
        activeBook: {
          id: ACTIVE_BOOK_ID,
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
    } else if (path.endsWith('/response') && method === 'PUT') {
      const changes = request.postDataJSON()
      meeting.responses = meeting.responses.map((response) => response.userId === 'andre'
        ? { ...response, ...changes }
        : response)
      payload = { meeting }
    } else if (path === '/api/activities' || path === '/api/shows') {
      payload = []
    } else if (path === '/api/jam') {
      payload = null
    } else if (path === '/api/feed') {
      payload = [{
        id: meeting.id, type: 'book-club', createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt, sortAt: meeting.updatedAt,
        title: meeting.bookTitle, subtitle: 'Book Club meeting',
        actor: meeting.createdByName, isArchived: false, payload: meeting,
      }]
    } else if (path === '/api/book-club/books') {
      if (method === 'POST') {
        const book = {
          id: 'new-book', ...request.postDataJSON(), bookOwnerName: 'Andre',
          status: 'active', isCurrent: false, selectedAt: NOW,
          completedAt: null, reviewCount: 0, averageRating: null,
          finishedCount: 0, unfinishedCount: 0, unknownFinishCount: 0,
          viewerReview: null, reviews: [], meetings: [],
        }
        books = [books[0], book, ...books.slice(1)]
        payload = { book, books }
        status = 201
      } else {
        payload = { books }
      }
    } else if (path.startsWith('/api/book-club/books/') && method === 'PATCH') {
      const bookId = decodeURIComponent(path.split('/books/')[1])
      const changes = request.postDataJSON()
      books = books.map((book) => book.id === bookId ? { ...book, ...changes, bookOwnerName: changes.bookOwnerId === 'kayla' ? 'Kayla' : 'Andre' } : book)
      payload = { book: books.find((book) => book.id === bookId), books }
    } else if (path.endsWith('/review') && method === 'PUT') {
      const bookId = decodeURIComponent(path.split('/books/')[1].split('/')[0])
      const review = request.postDataJSON()
      books = books.map((book) => book.id === bookId ? {
        ...book,
        reviewCount: 1,
        averageRating: review.rating,
        finishedCount: review.finished ? 1 : 0,
        unfinishedCount: review.finished ? 0 : 1,
        unknownFinishCount: 0,
        viewerReview: {
          userId: 'andre', userName: 'Andre', createdAt: NOW - 500,
          ...book.viewerReview, ...review, updatedAt: NOW,
        },
        reviews: [{
          userId: 'andre', userName: 'Andre', createdAt: NOW - 500,
          ...book.reviews[0], ...review, updatedAt: NOW,
        }],
      } : book)
      payload = { books }
    } else if (path.endsWith('/forum')) {
      const encodedMeetingId = path.split('/meetings/')[1].split('/forum')[0]
      const meetingId = decodeURIComponent(encodedMeetingId)
      if (method === 'GET') {
        payload = { forum: forums[meetingId] }
      } else {
        const entry = request.postDataJSON()
        const forum = forums[meetingId]
        if (entry.parentPostId) {
          forum.threads = forum.threads.map((thread) => thread.id === entry.parentPostId ? {
            ...thread,
            replies: [...thread.replies, {
              id: 'forum#reply', meetingId, parentPostId: thread.id,
              authorId: 'andre', authorName: 'Andre', body: entry.body,
              createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW,
            }],
          } : thread)
        } else {
          forum.threads = [{
            id: 'forum#topic', meetingId, title: entry.title,
            authorId: 'andre', authorName: 'Andre', body: entry.body,
            createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW, replies: [],
          }]
        }
        payload = { forum }
        status = 201
      }
    } else if (path.includes('/api/book-club/meetings/')) {
      payload = { meeting }
    } else {
      throw new Error(`Unhandled API request: ${method} ${path}`)
    }

    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
  })
}

test('uses the household modal for books, reviews, and discussions', async ({ page }, testInfo) => {
  await mockBookClub(page)
  await page.goto('/')

  await expect(page.getByRole('button', { name: /Current book The Fifth Season/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Library All books/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Book Kayla/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Snack Andre/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('book-club-household-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: /Library All books/ }).click()
  const library = page.getByRole('dialog', { name: 'Book library' })
  await expect(library.getByRole('button', { name: /The Fifth Season/ })).toContainText('Current')
  await expect(library.getByRole('button', { name: /A Psalm for the Wild-Built/ })).toContainText('4.0 ★')
  await page.screenshot({ path: testInfo.outputPath('book-club-library-modal-desktop.png'), fullPage: true })

  await library.getByRole('button', { name: 'Add book' }).click()
  const addDialog = page.getByRole('dialog', { name: 'Add a book' })
  await addDialog.getByRole('textbox', { name: 'Book title' }).fill('Kindred')
  await addDialog.getByRole('textbox', { name: 'Author' }).fill('Octavia E. Butler')
  await addDialog.getByRole('button', { name: 'Add book' }).click()
  await expect(page.getByRole('dialog', { name: 'Book details' })).toContainText('Kindred')
  await page.getByRole('button', { name: '← All books' }).click()

  await library.getByRole('button', { name: /The Fifth Season/ }).click()
  const details = page.getByRole('dialog', { name: 'Book details' })
  await expect(details.getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()
  await expect.poll(() => details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('book-club-detail-summary-desktop.png'), fullPage: true })
  await details.getByRole('radio', { name: '5 stars' }).locator('..').click()
  await details.getByRole('radio', { name: 'Finished' }).locator('..').click()
  await details.getByPlaceholder('What stayed with you?').fill('A fierce and unforgettable start.')
  await details.getByRole('button', { name: 'Save review' }).click()
  await expect(details.getByRole('status')).toHaveText('Saved')

  await details.getByRole('button', { name: /Discussions/ }).click()
  await details.getByRole('button', { name: /Read through Chapter 9/ }).click()
  await details.getByRole('button', { name: 'New topic' }).click()
  await details.getByLabel('New topic title').fill('Favorite passage')
  await details.getByLabel('New topic post').fill('Which scene stayed with you?')
  await details.getByRole('button', { name: 'Post topic' }).click()
  await details.getByRole('button', { name: 'Reply' }).click()
  await details.getByLabel('Reply to Favorite passage').fill('The final conversation.')
  await details.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(details.getByText('The final conversation.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('book-club-detail-modal-desktop.png'), fullPage: true })

  await details.getByRole('button', { name: '← All books' }).click()
  await page.getByRole('button', { name: /A Psalm for the Wild-Built/ }).click()
  await expect(page.getByText('Finish status not recorded').first()).toBeVisible()
  await page.getByRole('radio', { name: 'Finished' }).locator('..').click()
  await page.getByRole('button', { name: 'Update review' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: /The Fifth Season/, expanded: false }).click()
  const responseList = page.getByRole('list', { name: 'Member attendance and progress' })
  await expect(responseList.getByRole('listitem')).toHaveCount(3)
  await expect(page.getByLabel('Attendance totals')).toContainText('1 Pending')
  await page.getByLabel('Your reading progress mode').selectOption('complete')
  await expect(page.getByLabel('Your reading progress mode')).toHaveValue('complete')
  await page.waitForTimeout(750)
  await page.screenshot({ path: testInfo.outputPath('book-club-meeting-tracker-desktop.png'), fullPage: true })
  await page.getByRole('link', { name: 'Forum' }).click()
  await expect(page).toHaveURL(/\?book=active-book&meeting=meeting%23demo/)
  await expect(page.getByRole('dialog', { name: 'Book details' })).toContainText('Favorite passage')
})

test('keeps the two-column cards and library modal usable on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBookClub(page)
  await page.goto('/')

  const bookCard = page.getByRole('button', { name: /Book Kayla/ })
  const snackCard = page.getByRole('button', { name: /Snack Andre/ })
  await expect(bookCard).toBeVisible()
  await expect(snackCard).toBeVisible()
  const bookBox = await bookCard.boundingBox()
  const snackBox = await snackCard.boundingBox()
  expect(Math.abs(bookBox.y - snackBox.y)).toBeLessThan(2)

  await page.getByRole('button', { name: /Library All books/ }).click()
  const library = page.getByRole('dialog', { name: 'Book library' })
  await expect(library.getByRole('searchbox', { name: 'Search books' })).toBeVisible()
  await expect(library.getByRole('button', { name: /The Fifth Season/ })).toBeVisible()
  await expect.poll(() => library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('book-club-library-modal-mobile.png'), fullPage: true })

  await library.getByRole('button', { name: /The Fifth Season/ }).click()
  const details = page.getByRole('dialog', { name: 'Book details' })
  await expect(details.getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()
  await expect.poll(() => details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('book-club-detail-modal-mobile.png'), fullPage: true })

  await details.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /The Fifth Season/, expanded: false }).click()
  const responseList = page.getByRole('list', { name: 'Member attendance and progress' })
  await expect(responseList.getByRole('listitem')).toHaveCount(3)
  await expect.poll(() => responseList.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.waitForTimeout(750)
  await page.screenshot({ path: testInfo.outputPath('book-club-meeting-tracker-mobile.png'), fullPage: true })
})
