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
      { userId: 'andre', userName: 'Andre', attendanceStatus: 'attending' },
      { userId: 'kayla', userName: 'Kayla', attendanceStatus: 'maybe' },
      { userId: 'ting', userName: 'Ting', attendanceStatus: null },
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
    tags: ['Climate Fiction', 'Bechdel Pass'],
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
    tags: ['Cozy Science Fiction'],
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

async function mockBookClub(page, {
  tvFeedCount = 0,
  archivedTvFeedCount = 0,
  bookClubFeedCount = 0,
  viewerIsAdmin = true,
  crowdedAttendance = false,
} = {}) {
  const { meeting, activeBook, completedBook } = bookClubFixture()
  if (crowdedAttendance) {
    meeting.responses = Array.from({ length: 6 }, (_, index) => ({
      userId: index === 0 ? 'andre' : `member-${index}`,
      userName: index === 0 ? 'Andre' : `Member ${index}`,
      attendanceStatus: 'attending',
    }))
  }
  let books = [activeBook, completedBook]
  let forumItems = []
  const feedItems = [{
    id: meeting.id, type: 'book-club', createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt, sortAt: meeting.updatedAt,
    title: meeting.bookTitle, subtitle: 'Book Club meeting',
    actor: meeting.createdByName, isArchived: false, payload: meeting,
  }]
  function addTvFeedItems(count, isArchived = false) {
    for (let index = 0; index < count; index += 1) {
      const title = `${isArchived ? 'Archived ' : ''}Show ${index + 1}`
      const id = `${isArchived ? 'archived-' : ''}show-${index}`
      feedItems.push({
        id, type: 'tv', createdAt: NOW - index, updatedAt: NOW - index,
        sortAt: NOW - index, title, subtitle: 'TV', actor: 'Andre', isArchived,
        payload: {
          id, title, createdBy: 'Andre', createdById: 'andre', members: [],
          createdAt: NOW - index, updatedAt: NOW - index, isArchived,
        },
      })
    }
  }
  addTvFeedItems(tvFeedCount)
  addTvFeedItems(archivedTvFeedCount, true)
  for (let index = 0; index < bookClubFeedCount; index += 1) {
    const id = `meeting-extra-${index}`
    const extraMeeting = {
      ...meeting,
      id,
      bookTitle: `Book ${index + 1}`,
      scheduledAt: meeting.scheduledAt + (index + 1) * 86_400_000,
      createdAt: meeting.createdAt - index - 1,
      updatedAt: meeting.updatedAt - index - 1,
    }
    feedItems.push({
      id, type: 'book-club', createdAt: extraMeeting.createdAt,
      updatedAt: extraMeeting.updatedAt, sortAt: extraMeeting.updatedAt,
      title: extraMeeting.bookTitle, subtitle: 'Book Club meeting',
      actor: extraMeeting.createdByName, isArchived: false, payload: extraMeeting,
    })
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
        showRoster: true, showFeed: true, viewerIsAdmin,
      } }
    } else if (path === '/api/roommates') {
      payload = [
        { id: 'andre', name: 'Andre', role: viewerIsAdmin ? 'admin' : 'member' },
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
      payload = feedItems
    } else if (path === '/api/forums' && method === 'POST') {
      const changes = request.postDataJSON()
      const forum = {
        id: 'book-forum-demo', ...changes,
        bookTitle: books.find((book) => book.id === changes.bookId)?.title,
        bookAuthor: books.find((book) => book.id === changes.bookId)?.author,
        createdBy: 'Andre', createdById: 'andre', createdAt: NOW,
        updatedAt: NOW, isArchived: false, comments: [],
      }
      forumItems = [forum]
      feedItems.push({
        id: forum.id, type: 'forums', createdAt: forum.createdAt,
        updatedAt: forum.updatedAt, sortAt: forum.updatedAt,
        title: forum.title, subtitle: forum.bookTitle, actor: forum.createdBy,
        isArchived: false, payload: forum,
      })
      payload = forumItems
      status = 201
    } else if (path === '/api/forums/book-forum-demo/comments' && method === 'POST') {
      const changes = request.postDataJSON()
      forumItems = forumItems.map((forum) => ({
        ...forum,
        comments: [...forum.comments, {
          id: 'forum-comment-demo', authorId: 'andre', author: 'Andre',
          text: changes.text, createdAt: NOW, likedByIds: [], likedByNames: [],
        }],
      }))
      const updated = forumItems[0]
      const module = feedItems.find((item) => item.id === updated.id)
      module.payload = updated
      payload = forumItems
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
    } else if (path.includes('/api/book-club/meetings/')) {
      payload = { meeting }
    } else {
      throw new Error(`Unhandled API request: ${method} ${path}`)
    }

    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
  })
}

async function dragTouch(page, start, end, steps = 8) {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y, id: 1 }],
  })
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        id: 1,
      }],
    })
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

async function expectAttendanceRowsStacked(attendance) {
  const expectedNames = [
    'Attending: 1',
    'Maybe: 1',
    'Not attending: 0',
    'Pending: 1',
  ]
  const rows = attendance.getByRole('region')
  await expect(rows).toHaveCount(expectedNames.length)
  for (const name of expectedNames) {
    const row = attendance.getByRole('region', { name })
    await expect(row).toBeVisible()
    await expect(row.locator('[data-attendance-status-indicator]')).toBeVisible()
  }
  // The disclosure animates open, so wait until its final row spacing is stable.
  await expect.poll(async () => {
    const boxes = await Promise.all(expectedNames.map((name) => (
      attendance.getByRole('region', { name }).boundingBox()
    )))
    return boxes.slice(1).every((box, index) => {
      const previous = boxes[index]
      const spacing = box.y - (previous.y + previous.height)
      return spacing >= 4 && spacing <= 16
    })
  }).toBe(true)
  for (const name of ['Attending: 1', 'Maybe: 1', 'Pending: 1']) {
    const row = attendance.getByRole('region', { name })
    const rowBox = await row.boundingBox()
    const triggerBox = await row.getByRole('button').boundingBox()
    expect(Math.abs(
      (rowBox.x + rowBox.width) - (triggerBox.x + triggerBox.width),
    )).toBeLessThan(2)
  }
}

async function clickMeetingHeader(toggle) {
  const box = await toggle.boundingBox()
  await toggle.click({ position: { x: box.width - 8, y: 8 } })
}

test('uses the household modal for books and reviews', async ({ page }, testInfo) => {
  await mockBookClub(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Group Feed' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Feed categories' }).getByRole('tab')).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Open feed menu' })).toBeVisible()
  await expect.poll(() => page.locator('[data-feed-sticky-header]').evaluate((element) => (
    getComputedStyle(element).position
  ))).toBe('sticky')
  await expect(page.getByRole('button', { name: /Current book The Fifth Season/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Library All books/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Book Kayla/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Snack Andre/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('book-club-household-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: /Library All books/ }).click()
  const library = page.getByRole('dialog', { name: 'Book library' })
  await expect(library.getByRole('button', { name: /The Fifth Season/ })).toContainText('Current')
  await expect(library.getByRole('button', { name: /The Fifth Season/ })).toContainText('Bechdel Pass')
  await expect(library.getByRole('button', { name: /A Psalm for the Wild-Built/ })).toContainText('4.0 ★')
  await library.getByRole('searchbox', { name: 'Search books' }).fill('Climate Fiction')
  await expect(library.getByRole('button', { name: /The Fifth Season/ })).toBeVisible()
  await expect(library.getByRole('button', { name: /A Psalm for the Wild-Built/ })).toBeHidden()
  await library.getByRole('searchbox', { name: 'Search books' }).fill('')
  await page.screenshot({ path: testInfo.outputPath('book-club-library-modal-desktop.png'), fullPage: true })

  await library.getByRole('button', { name: 'Add book' }).click()
  const addDialog = page.getByRole('dialog', { name: 'Add a book' })
  await addDialog.getByRole('textbox', { name: 'Book title' }).fill('Kindred')
  await addDialog.getByRole('textbox', { name: 'Author' }).fill('Octavia E. Butler')
  await addDialog.getByRole('combobox', { name: 'Book tag' }).fill('bechdel pass')
  await addDialog.getByRole('button', { name: 'Add tag' }).click()
  await addDialog.getByRole('combobox', { name: 'Book tag' }).fill('Time Travel')
  await addDialog.getByRole('button', { name: 'Add tag' }).click()
  await addDialog.getByRole('button', { name: 'Add current book' }).click()
  await expect(page.getByRole('dialog', { name: 'Book details' })).toContainText('Kindred')
  await expect(page.getByRole('dialog', { name: 'Book details' })).toContainText('Bechdel Pass')
  await expect(page.getByRole('dialog', { name: 'Book details' })).toContainText('Time Travel')
  await page.getByRole('button', { name: '← All books' }).click()

  await library.getByRole('button', { name: /The Fifth Season/ }).click()
  const details = page.getByRole('dialog', { name: 'Book details' })
  await expect(details.getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()
  await expect(details.getByLabel('Book tags')).toContainText('Climate Fiction')
  await expect.poll(() => details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('book-club-detail-summary-desktop.png'), fullPage: true })
  await details.getByRole('radio', { name: '5 stars' }).locator('..').click()
  await details.getByRole('radio', { name: 'Finished' }).locator('..').click()
  await details.getByPlaceholder('What stayed with you?').fill('A fierce and unforgettable start.')
  await details.getByRole('button', { name: 'Save review' }).click()
  const personalReview = details.getByRole('region', { name: 'Your review' })
  const personalReviewToggle = personalReview.getByRole('button', { name: /Your review/ })
  const communityReviews = details.getByRole('region', { name: 'Community reviews' })
  const communityReviewsToggle = communityReviews.getByRole('button', {
    name: /Community reviews/,
  })
  await expect(details.getByRole('status')).toHaveText('Review saved.')
  await expect(personalReviewToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(communityReviewsToggle).toHaveAttribute('aria-expanded', 'false')
  expect(await personalReviewToggle.textContent()).not.toMatch(/[+−]/)
  expect(await communityReviewsToggle.textContent()).not.toMatch(/[+−]/)
  await expect.poll(() => personalReview.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
    }
  })).toEqual({ borderRadius: '12px', borderWidth: '1px' })
  await page.waitForTimeout(750)
  await details.evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: testInfo.outputPath('book-club-review-disclosures-desktop.png'), fullPage: true })
  await personalReviewToggle.click()
  await expect(personalReview.getByRole('button', { name: 'Update review' })).toBeVisible()
  await personalReviewToggle.click()
  await communityReviewsToggle.click()
  await expect(communityReviews.getByText('Andre')).toBeVisible()
  await page.waitForTimeout(750)

  await page.screenshot({ path: testInfo.outputPath('book-club-detail-modal-desktop.png'), fullPage: true })

  await details.getByRole('button', { name: '← All books' }).click()
  await page.getByRole('button', { name: /A Psalm for the Wild-Built/ }).click()
  await expect(page.getByText('Finish status not recorded').first()).toBeVisible()
  await page.getByRole('region', { name: 'Your review' }).getByRole('button', { name: /Your review/ }).click()
  await page.getByRole('radio', { name: 'Finished' }).locator('..').click()
  await page.getByRole('button', { name: 'Update review' }).click()
  await expect(page.getByRole('status')).toHaveText('Review saved.')
  await page.getByRole('button', { name: 'Close' }).click()

  const meetingHeader = page.getByRole('button', {
    name: /Open Book Club meeting .*Read through Chapter 9$/,
  })
  const meetingBookLink = page.getByRole('link', {
    name: 'View The Fifth Season in the Book Club library',
  })
  const meetingHeaderRoot = meetingHeader.locator('..')
  const meetingTitle = meetingHeaderRoot.locator('strong').first()
  const meetingModuleTag = meetingHeaderRoot.locator('[data-module-type="book-club"]')
  const meetingMeta = meetingHeaderRoot.locator('span').last()
  const meetingCard = meetingHeaderRoot.locator('..')
  const [meetingTitleBox, meetingBookBox, meetingTagBox, meetingMetaBox] = await Promise.all([
    meetingTitle.boundingBox(),
    meetingBookLink.boundingBox(),
    meetingModuleTag.boundingBox(),
    meetingMeta.boundingBox(),
  ])
  await expect(meetingTitle).toHaveText('The Fifth Season')
  await expect(meetingMeta).toContainText('2030')
  await expect(meetingMeta).toContainText('Read through Chapter 9')
  await expect(meetingMeta).not.toContainText('Snacks')
  expect(meetingBookBox.x).toBeGreaterThan(meetingTagBox.x + meetingTagBox.width)
  expect(Math.abs(meetingBookBox.y - meetingTagBox.y)).toBeLessThan(2)
  expect(Math.abs(meetingMetaBox.x - meetingTagBox.x)).toBeLessThan(2)
  expect(meetingTitleBox.x).toBeGreaterThan(meetingBookBox.x)
  expect(meetingTitleBox.x + meetingTitleBox.width)
    .toBeLessThan(meetingBookBox.x + meetingBookBox.width)
  await expect.poll(() => meetingTitle.evaluate((element) => ({
    fontFamily: getComputedStyle(element).fontFamily,
    fontSize: getComputedStyle(element).fontSize,
    fontWeight: getComputedStyle(element).fontWeight,
  }))).toMatchObject({ fontSize: '10px', fontWeight: '700' })
  expect(await meetingTitle.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe(await meetingModuleTag.evaluate((element) => getComputedStyle(element).fontSize))
  expect(await meetingTitle.evaluate((element) => (
    getComputedStyle(element).fontFamily
  ))).not.toContain('Fraunces')
  await expect.poll(() => meetingBookLink.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
    }
  })).toMatchObject({ borderRadius: '9999px', borderWidth: '1px' })
  expect(await meetingBookLink.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).not.toBe('rgba(0, 0, 0, 0)')
  await expect.poll(() => meetingMeta.evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    fontWeight: getComputedStyle(element).fontWeight,
  }))).toEqual({ fontSize: '12px', fontWeight: '400' })
  await expect.poll(() => meetingCard.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    }
  })).toEqual({ borderRadius: '12px', boxShadow: 'none', padding: '10px 14px 10px 14px' })
  await clickMeetingHeader(meetingHeader)
  const attendanceSection = page.getByRole('region', { name: 'Attendance' })
  await expect(attendanceSection.getByRole('button', { name: /Attendance/ })).toHaveCount(0)
  await expect(attendanceSection.getByText('Attendance', { exact: true })).toHaveCount(0)
  await expect(attendanceSection.getByText(/^\d+ members?$/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Discussion' })).toHaveCount(0)
  const attendance = page.getByLabel('Member attendance')
  await expectAttendanceRowsStacked(attendance)
  await expect(attendance.getByRole('button', { name: 'View 1 person marked attending' })).toBeVisible()
  await expect(attendance.getByRole('button', { name: 'View 1 person marked maybe' })).toBeVisible()
  const pendingTrigger = attendance.getByRole('button', { name: 'View 1 person marked pending' })
  await pendingTrigger.click()
  await expect(page.getByRole('dialog', { name: 'Pending members' })).toContainText('Ting')
  await pendingTrigger.click()
  await page.getByLabel('RSVP').selectOption('maybe')
  const maybeTrigger = attendance.getByRole('button', { name: 'View 2 people marked maybe' })
  await maybeTrigger.click()
  await expect(page.getByRole('dialog', { name: 'Maybe members' })).toContainText('Andre')
  await maybeTrigger.click()
  await page.waitForTimeout(750)
  await page.screenshot({ path: testInfo.outputPath('book-club-meeting-tracker-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Complete meeting' }).click()
  const confirmation = page.getByRole('dialog', { name: /Complete meeting/ })
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await expect(confirmation).toContainText('Attendance will become read-only')
  await page.screenshot({ path: testInfo.outputPath('complete-meeting-confirmation-desktop.png'), fullPage: true })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await meetingBookLink.click()
  await expect(page.getByRole('button', {
    name: /Close Book Club meeting .*Read through Chapter 9$/,
  })).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/\?book=active-book$/)
  const wholeBook = page.getByRole('dialog', { name: 'Book details' })
  await expect(wholeBook.getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()
  await expect(wholeBook.getByText('Discussions')).toHaveCount(0)
})

test('confirms meeting completion safely on desktop', async ({ page }, testInfo) => {
  await mockBookClub(page)
  await page.goto('/')

  const meetingHeader = page.getByRole('button', {
    name: /Open Book Club meeting .*Read through Chapter 9$/,
  })
  await meetingHeader.press('Enter')
  await page.getByRole('button', { name: 'Complete meeting' }).click()

  const confirmation = page.getByRole('dialog', { name: /Complete meeting/ })
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await expect(confirmation).toContainText('Attendance will become read-only')
  await expect.poll(() => confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('complete-meeting-confirmation-desktop.png'), fullPage: true })

  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Complete meeting' })).toBeVisible()
})

test('creates a book-tagged forum with flat comments', async ({ page }, testInfo) => {
  await mockBookClub(page)
  await page.goto('/')

  await page.getByRole('tab', { name: /^Forums/ }).click()
  await page.getByRole('button', { name: 'Create a forum' }).click()
  const creator = page.getByRole('dialog', { name: 'Create a forum' })
  await creator.getByLabel('Forum title').fill('Memory, survival, and change')
  await creator.getByLabel('Book').selectOption(ACTIVE_BOOK_ID)
  await creator.getByRole('button', { name: 'Create forum' }).click()

  const forumCard = page.getByRole('button', {
    name: /forum Memory, survival, and change$/,
  })
  await expect(page.getByText('Memory, survival, and change')).toBeVisible()
  const forumHeaderRoot = forumCard.locator('..')
  const forumCardRoot = forumHeaderRoot.locator('..')
  const forumBookLinkLocator = forumCardRoot.locator(
    'a[aria-label="View The Fifth Season in the Book Club library"]',
  )
  await expect(forumBookLinkLocator.locator('xpath=ancestor::*[@inert][1]'))
    .toHaveAttribute('inert', '')
  const forumTitle = forumHeaderRoot.getByText('Memory, survival, and change', { exact: true })
  const forumModuleTag = forumHeaderRoot.locator('[data-module-type="forums"]')
  const forumMeta = forumHeaderRoot.locator('span').last()
  const [forumTitleBox, forumTagBox, forumMetaBox] = await Promise.all([
    forumTitle.boundingBox(),
    forumModuleTag.boundingBox(),
    forumMeta.boundingBox(),
  ])
  expect(Math.abs(forumMetaBox.x - forumTagBox.x)).toBeLessThan(2)
  expect(forumMetaBox.y).toBeGreaterThanOrEqual(forumTitleBox.y + forumTitleBox.height)
  await expect.poll(() => forumTitle.evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    fontWeight: getComputedStyle(element).fontWeight,
  }))).toEqual({ fontSize: '14px', fontWeight: '600' })
  await expect.poll(() => forumMeta.evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    fontWeight: getComputedStyle(element).fontWeight,
  }))).toEqual({ fontSize: '12px', fontWeight: '400' })
  await expect.poll(() => forumCardRoot.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    }
  })).toEqual({ borderRadius: '12px', boxShadow: 'none', padding: '10px 14px 10px 14px' })
  await forumCard.click({ position: { x: 12, y: 12 } })
  await expect(page.getByRole('button', {
    name: 'Close forum Memory, survival, and change',
  })).toBeVisible()
  const forumBookLink = forumCardRoot.getByRole('link', {
    name: 'View The Fifth Season in the Book Club library',
  })
  await expect(forumBookLink).toBeVisible()
  await expect(page.getByText('Discussing')).toHaveCount(0)
  const forumPanel = forumHeaderRoot.locator(
    'xpath=following-sibling::div[1]/div/div',
  )
  const comments = forumPanel.getByText('Comments', { exact: true }).locator('..')
  const [forumPanelBox, forumBookBox, commentsBox] = await Promise.all([
    forumPanel.boundingBox(),
    forumBookLink.boundingBox(),
    comments.boundingBox(),
  ])
  expect(Math.abs(forumBookBox.x - forumPanelBox.x)).toBeLessThan(2)
  expect(forumBookBox.y).toBeGreaterThanOrEqual(forumMetaBox.y + forumMetaBox.height)
  expect(commentsBox.y).toBeGreaterThanOrEqual(forumBookBox.y + forumBookBox.height)
  expect(Math.abs(forumBookBox.height - forumTagBox.height)).toBeLessThan(1)
  expect(await forumBookLink.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe(await forumModuleTag.evaluate((element) => getComputedStyle(element).fontSize))
  await expect.poll(() => forumPanel.evaluate((element) => (
    getComputedStyle(element).borderTopWidth
  ))).toBe('0px')
  await expect.poll(() => comments.evaluate((element) => (
      getComputedStyle(element).borderTopWidth
    ))).toBe('1px')
  await page.getByPlaceholder('Add a comment… Use @ to mention someone')
    .fill('The book keeps changing what survival means.')
  await page.getByRole('button', { name: 'Send comment' }).click()
  await expect(page.getByText('The book keeps changing what survival means.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('forum-module-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  const [
    phoneForumHeaderBox,
    phoneForumTitleBox,
    phoneForumBookBox,
    phoneForumMetaBox,
    phoneForumTagBox,
    phoneCommentsBox,
  ] = await Promise.all([
    forumHeaderRoot.boundingBox(),
    forumTitle.boundingBox(),
    forumBookLink.boundingBox(),
    forumMeta.boundingBox(),
    forumModuleTag.boundingBox(),
    comments.boundingBox(),
  ])
  expect(Math.abs(phoneForumMetaBox.x - phoneForumTagBox.x)).toBeLessThan(2)
  expect(Math.abs(phoneForumBookBox.x - phoneForumMetaBox.x)).toBeLessThan(2)
  expect(phoneForumMetaBox.y).toBeGreaterThanOrEqual(
    phoneForumTitleBox.y + phoneForumTitleBox.height,
  )
  expect(phoneForumBookBox.y).toBeGreaterThanOrEqual(
    phoneForumMetaBox.y + phoneForumMetaBox.height,
  )
  expect(phoneCommentsBox.y).toBeGreaterThanOrEqual(
    phoneForumBookBox.y + phoneForumBookBox.height,
  )
  expect(phoneForumBookBox.x + phoneForumBookBox.width)
    .toBeLessThanOrEqual(phoneForumHeaderBox.x + phoneForumHeaderBox.width)
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('forum-module-phone.png'), fullPage: true })

  await forumBookLink.click()
  await expect(page.getByRole('button', {
    name: 'Close forum Memory, survival, and change',
  })).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/\?book=active-book$/)
  await expect(page.getByRole('dialog', { name: 'Book details' })
    .getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()
})

test('allows a household member to update reusable book tags', async ({ page }) => {
  await mockBookClub(page, { viewerIsAdmin: false })
  await page.goto('/')

  await page.getByRole('button', { name: /Library All books/ }).click()
  const library = page.getByRole('dialog', { name: 'Book library' })
  await expect(library.getByRole('button', { name: 'Add book' })).toHaveCount(0)
  await library.getByRole('button', { name: /The Fifth Season/ }).click()

  const details = page.getByRole('dialog', { name: 'Book details' })
  await details.getByRole('button', { name: 'Edit book' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit book' })
  await editor.getByRole('combobox', { name: 'Book tag' }).fill('Household Favorite')
  await editor.getByRole('button', { name: 'Add tag' }).click()
  await editor.getByRole('button', { name: 'Save book' }).click()

  await expect(page.getByRole('dialog', { name: 'Book details' }).getByLabel('Book tags'))
    .toContainText('Household Favorite')
})

test('shows the next feed category while swiping on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBookClub(page, { tvFeedCount: 20, bookClubFeedCount: 20 })
  await page.goto('/')

  const feedMenuButton = page.getByRole('button', { name: 'Open feed menu' })
  await expect(feedMenuButton).toBeVisible()
  await feedMenuButton.click()
  const feedMenu = page.getByLabel('Module types')
  await expect(feedMenu).toBeInViewport()
  await feedMenu.getByRole('button', { name: 'Close' }).click()

  const feedTabs = page.getByRole('tablist', { name: 'Feed categories' })
  const stickyHeader = page.locator('[data-feed-sticky-header]')
  await expect(feedTabs.getByRole('tab')).toHaveCount(8)
  await expect(stickyHeader).not.toHaveAttribute('data-feed-pinned')
  await expect.poll(() => stickyHeader.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).toBe('rgba(0, 0, 0, 0)')
  await feedTabs.getByRole('tab', { name: /^TV/ }).click()
  await expect(feedTabs.getByRole('tab', { name: /^TV/, selected: true })).toBeVisible()
  const categoryScroller = page.locator('[data-feed-category-scroller]')
  await categoryScroller.evaluate((element) => element.scrollTo({ left: 0, behavior: 'auto' }))
  const categoryScrollTargets = await categoryScroller.evaluate((element) => {
    const activeTab = element.querySelector('[role="tab"][aria-selected="true"]')
    const nextTab = element.querySelector('[role="tab"][data-module-type="book-club"]')
    const centeredTarget = (tab) => Math.min(Math.max(
      tab.offsetLeft - (element.clientWidth - tab.offsetWidth) / 2,
      0,
    ), element.scrollWidth - element.clientWidth)
    return {
      before: element.scrollLeft,
      active: centeredTarget(activeTab),
      next: centeredTarget(nextTab),
    }
  })
  expect(Math.abs(categoryScrollTargets.before - categoryScrollTargets.active)).toBeGreaterThan(5)
  const feedMain = page.locator('[data-feed-swipe-phase]').locator('..')
  await feedMain.scrollIntoViewIfNeeded()
  const feedShellTop = await page.locator('[data-feed-shell]').evaluate((element) => (
    element.getBoundingClientRect().top + window.scrollY
  ))
  const tvScrollOffset = 240
  await page.evaluate(
    ({ top, offset }) => window.scrollTo(0, top + offset),
    { top: feedShellTop, offset: tvScrollOffset },
  )
  await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)
  await expect(stickyHeader).toHaveAttribute('data-feed-pinned', '')

  async function feedSwipePoint(deltaX) {
    const activeFeedBox = await feedMain.boundingBox()
    const y = await page.locator('[role="tabpanel"]').evaluate((panel) => {
      const headerBottom = document.querySelector(
        '[data-feed-sticky-header]',
      ).getBoundingClientRect().bottom
      const cards = [...panel.querySelectorAll('article')]
        .map((card) => card.getBoundingClientRect())
        .filter((rect) => rect.bottom > headerBottom && rect.top < window.innerHeight)
        .sort((first, second) => first.top - second.top)
      for (let index = 0; index < cards.length - 1; index += 1) {
        const gapStart = Math.max(cards[index].bottom, headerBottom)
        const gapEnd = Math.min(cards[index + 1].top, window.innerHeight)
        if (gapEnd - gapStart >= 2) return gapStart + (gapEnd - gapStart) / 2
      }
      const panelRect = panel.getBoundingClientRect()
      return Math.min(
        Math.max(panelRect.top + Math.min(40, panelRect.height / 2), headerBottom + 4),
        window.innerHeight - 20,
      )
    })
    return {
      x: deltaX < 0
        ? activeFeedBox.x + activeFeedBox.width - 20
        : activeFeedBox.x + 20,
      y,
    }
  }

  const feedBox = await feedMain.boundingBox()
  const { x: swipeStartX, y: swipeY } = await feedSwipePoint(-260)
  const pinnedScrollBeforeSwipe = await page.evaluate(() => window.scrollY)
  await page.mouse.move(swipeStartX, swipeY)
  await page.mouse.down()
  await page.mouse.move(swipeStartX - 12, swipeY + 1)
  await page.mouse.move(swipeStartX - 260, swipeY + 140, { steps: 8 })
  await expect.poll(() => page.evaluate((top) => (
    Math.abs(window.scrollY - top)
  ), pinnedScrollBeforeSwipe)).toBeLessThan(2)
  await expect(stickyHeader).toHaveAttribute('data-feed-pinned', '')

  const incomingBookClub = page.locator('[data-feed-panel-type="book-club"]')
  await expect(incomingBookClub.getByText('The Fifth Season').first()).toBeVisible()
  const currentTv = page.locator('[data-feed-panel-type="tv"]')
  const currentTvBox = await currentTv.boundingBox()
  const incomingBookClubBox = await incomingBookClub.boundingBox()
  const panelGap = incomingBookClubBox.x - (currentTvBox.x + currentTvBox.width)
  expect(panelGap).toBeGreaterThanOrEqual(15)
  expect(panelGap).toBeLessThanOrEqual(17)
  const feedProgress = Math.min(
    Math.abs(currentTvBox.x - feedBox.x) / (currentTvBox.width + panelGap),
    1,
  )
  const expectedRibbonScroll = categoryScrollTargets.active + (
    categoryScrollTargets.next - categoryScrollTargets.active
  ) * feedProgress
  await expect.poll(async () => Math.abs(
    await categoryScroller.evaluate((element) => element.scrollLeft) - expectedRibbonScroll
  )).toBeLessThan(3)

  const indicator = page.locator('[data-feed-category-indicator]')
  const indicatorBox = await indicator.boundingBox()
  const tvTabBox = await feedTabs.getByRole('tab', { name: /^TV/ }).boundingBox()
  const bookClubTabBox = await feedTabs.getByRole('tab', { name: /^Book Club/ }).boundingBox()
  const indicatorCenter = indicatorBox.x + indicatorBox.width / 2
  const tvCenter = tvTabBox.x + tvTabBox.width / 2
  const bookClubCenter = bookClubTabBox.x + bookClubTabBox.width / 2
  expect(indicatorBox.height).toBe(4)
  expect(indicatorCenter).toBeGreaterThan(Math.min(tvCenter, bookClubCenter))
  expect(indicatorCenter).toBeLessThan(Math.max(tvCenter, bookClubCenter))
  await page.screenshot({ path: testInfo.outputPath('group-feed-swipe-preview-mobile.png') })

  await incomingBookClub.evaluate((panel) => {
    window.__incomingFeedPanel = panel
    window.__feedPanelFrames = []
    function samplePanel() {
      const rect = panel.getBoundingClientRect()
      const header = document.querySelector('[data-feed-sticky-header]')
      const phase = document.querySelector('[data-feed-swipe-phase]')
        ?.dataset.feedSwipePhase
      window.__feedPanelFrames.push({
        x: rect.x,
        y: rect.y,
        phase,
        headerPinned: header.hasAttribute('data-feed-pinned'),
        headerBackground: getComputedStyle(header).backgroundColor,
      })
      if (phase !== 'idle') window.requestAnimationFrame(samplePanel)
    }
    window.requestAnimationFrame(samplePanel)
  })

  await page.mouse.up()
  const selectedBookClubTab = feedTabs.getByRole('tab', { name: /^Book Club/, selected: true })
  await expect(selectedBookClubTab).toBeVisible()
  await expect(page.locator('[data-feed-panel-type="book-club"]')).toContainText('The Fifth Season')
  await expect.poll(async () => Math.abs(
    await categoryScroller.evaluate((element) => element.scrollLeft) - categoryScrollTargets.next
  )).toBeLessThan(2)
  await expect.poll(async () => {
    const activeTabBox = await selectedBookClubTab.boundingBox()
    const activeIndicatorBox = await indicator.boundingBox()
    return Math.abs(
      activeIndicatorBox.x + activeIndicatorBox.width / 2 -
      (activeTabBox.x + activeTabBox.width / 2)
    )
  }).toBeLessThan(2)
  const firstHandoff = await page.evaluate(() => ({
    samePanel: window.__incomingFeedPanel === document.querySelector(
      '[data-feed-panel-type="book-club"]',
    ),
    frames: window.__feedPanelFrames,
  }))
  expect(firstHandoff.samePanel).toBe(true)
  expect(firstHandoff.frames.length).toBeGreaterThan(2)
  for (let index = 1; index < firstHandoff.frames.length; index += 1) {
    expect(firstHandoff.frames[index].x).toBeLessThanOrEqual(
      firstHandoff.frames[index - 1].x + 1,
    )
  }
  const firstHandoffYs = firstHandoff.frames.map(({ y }) => y)
  expect(Math.max(...firstHandoffYs) - Math.min(...firstHandoffYs)).toBeLessThan(2)
  expect(firstHandoff.frames.every(({ headerPinned, headerBackground }) => (
    headerPinned &&
    headerBackground !== 'transparent' &&
    headerBackground !== 'rgba(0, 0, 0, 0)'
  ))).toBe(true)

  await expect.poll(() => page.evaluate((top) => (
    Math.abs(window.scrollY - top)
  ), feedShellTop)).toBeLessThan(2)

  const bookClubScrollOffset = 300
  await page.evaluate(
    ({ top, offset }) => window.scrollTo(0, top + offset),
    { top: feedShellTop, offset: bookClubScrollOffset },
  )
  await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)
  await expect.poll(() => stickyHeader.evaluate((element) => {
    const background = getComputedStyle(element).backgroundColor
    return background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'
  })).toBe(true)

  async function swipeActivePanel(deltaX) {
    const point = await feedSwipePoint(deltaX)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + deltaX, point.y + 4, { steps: 8 })
    await page.mouse.up()
  }

  await swipeActivePanel(260)
  await expect(feedTabs.getByRole('tab', { name: /^TV/, selected: true })).toBeVisible()
  await expect.poll(() => page.evaluate(({ top, offset }) => (
    Math.abs(window.scrollY - (top + offset))
  ), { top: feedShellTop, offset: tvScrollOffset })).toBeLessThan(2)
  await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)

  const tvReturnScrollOffset = 180
  await page.evaluate(
    ({ top, offset }) => window.scrollTo(0, top + offset),
    { top: feedShellTop, offset: tvReturnScrollOffset },
  )
  const returnPoint = await feedSwipePoint(-260)
  await page.mouse.move(returnPoint.x, returnPoint.y)
  await page.mouse.down()
  await page.mouse.move(returnPoint.x - 260, returnPoint.y + 4, { steps: 8 })
  const returningBookClub = page.locator('[data-feed-panel-type="book-club"]')
  const returningBookY = (await returningBookClub.getByText(
    'The Fifth Season',
  ).first().boundingBox()).y
  await returningBookClub.evaluate((panel) => {
    window.__returningFeedPanel = panel
  })
  await page.mouse.up()
  await expect(feedTabs.getByRole('tab', { name: /^Book Club/, selected: true })).toBeVisible()
  await expect.poll(() => page.evaluate(({ top, offset }) => (
    Math.abs(window.scrollY - (top + offset))
  ), { top: feedShellTop, offset: bookClubScrollOffset })).toBeLessThan(2)
  await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)
  const restoredBookY = (await page.locator(
    '[data-feed-panel-type="book-club"]',
  ).getByText('The Fifth Season').first().boundingBox()).y
  expect(Math.abs(restoredBookY - returningBookY)).toBeLessThan(2)
  expect(await page.evaluate(() => (
    window.__returningFeedPanel === document.querySelector(
      '[data-feed-panel-type="book-club"]',
    )
  ))).toBe(true)

  const unpinnedScrollTop = Math.max(feedShellTop - 80, 0)
  await page.evaluate((top) => window.scrollTo(0, top), unpinnedScrollTop)
  const unpinnedHeaderY = (await stickyHeader.boundingBox()).y
  expect(unpinnedHeaderY).toBeGreaterThan(5)
  await expect(stickyHeader).not.toHaveAttribute('data-feed-pinned')
  await expect.poll(() => stickyHeader.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).toBe('rgba(0, 0, 0, 0)')
  const unpinnedWindowScroll = await page.evaluate(() => window.scrollY)

  const unpinnedReturnPoint = await feedSwipePoint(260)
  await page.mouse.move(unpinnedReturnPoint.x, unpinnedReturnPoint.y)
  await page.mouse.down()
  await page.mouse.move(
    unpinnedReturnPoint.x + 260,
    unpinnedReturnPoint.y + 4,
    { steps: 8 },
  )
  const unpinnedTv = page.locator('[data-feed-panel-type="tv"]')
  await unpinnedTv.evaluate((panel) => {
    window.__unpinnedFeedPanel = panel
    window.__feedAnchorFrames = []
    function sampleAnchor() {
      const header = document.querySelector('[data-feed-sticky-header]')
      const phase = document.querySelector('[data-feed-swipe-phase]')
        ?.dataset.feedSwipePhase
      window.__feedAnchorFrames.push({
        headerY: header.getBoundingClientRect().y,
        scrollY: window.scrollY,
        phase,
        headerPinned: header.hasAttribute('data-feed-pinned'),
        headerBackground: getComputedStyle(header).backgroundColor,
      })
      if (phase !== 'idle') window.requestAnimationFrame(sampleAnchor)
    }
    window.requestAnimationFrame(sampleAnchor)
  })
  await page.mouse.up()
  await expect(feedTabs.getByRole('tab', { name: /^TV/, selected: true })).toBeVisible()
  const unpinnedHandoff = await page.evaluate(() => ({
    samePanel: window.__unpinnedFeedPanel === document.querySelector(
      '[data-feed-panel-type="tv"]',
    ),
    frames: window.__feedAnchorFrames,
    panelTransform: document.querySelector(
      '[data-feed-panel-type="tv"]',
    ).style.transform,
  }))
  expect(unpinnedHandoff.samePanel).toBe(true)
  expect(unpinnedHandoff.frames.length).toBeGreaterThan(2)
  expect(
    Math.max(...unpinnedHandoff.frames.map(({ headerY }) => headerY)) -
    Math.min(...unpinnedHandoff.frames.map(({ headerY }) => headerY))
  ).toBeLessThan(2)
  expect(
    Math.max(...unpinnedHandoff.frames.map(({ scrollY }) => scrollY)) -
    Math.min(...unpinnedHandoff.frames.map(({ scrollY }) => scrollY))
  ).toBeLessThan(2)
  expect(unpinnedHandoff.frames.every(({ headerPinned, headerBackground }) => (
    !headerPinned && headerBackground === 'rgba(0, 0, 0, 0)'
  ))).toBe(true)
  expect(Math.abs((await stickyHeader.boundingBox()).y - unpinnedHeaderY)).toBeLessThan(2)
  expect(Math.abs(await page.evaluate(() => window.scrollY) - unpinnedWindowScroll)).toBeLessThan(2)
  expect(unpinnedHandoff.panelTransform).toBe('translate3d(0px, 0px, 0px)')

  const prePinGap = 4
  await page.evaluate(
    ({ top, gap }) => window.scrollTo(0, top - gap),
    { top: feedShellTop, gap: prePinGap },
  )
  await expect.poll(async () => Math.round(
    (await stickyHeader.boundingBox()).y,
  )).toBe(prePinGap)
  const tvYBeforePin = (await unpinnedTv.boundingBox()).y
  await page.evaluate((top) => window.scrollTo(0, top), feedShellTop)
  await expect.poll(() => page.evaluate((top) => (
    Math.abs(window.scrollY - top)
  ), feedShellTop)).toBeLessThan(2)
  await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)
  await expect(stickyHeader).toHaveAttribute('data-feed-pinned', '')
  expect(
    Math.abs((await unpinnedTv.boundingBox()).y - tvYBeforePin + prePinGap),
  ).toBeLessThan(2)
  expect(await unpinnedTv.evaluate((panel) => panel.style.transform)).toBe(
    'translate3d(0px, 0px, 0px)',
  )

  const emptySwipePoint = await feedSwipePoint(260)
  await page.mouse.move(emptySwipePoint.x, emptySwipePoint.y)
  await page.mouse.down()
  await page.mouse.move(emptySwipePoint.x + 260, emptySwipePoint.y + 4, {
    steps: 8,
  })
  const incomingEmptyPolls = page.locator('[data-feed-panel-type="polls"]')
  const incomingEmptyMessage = incomingEmptyPolls.getByText(
    'No active modules here yet.',
  )
  const [emptyPreviewBox, stickyPreviewBox] = await Promise.all([
    incomingEmptyMessage.boundingBox(),
    stickyHeader.boundingBox(),
  ])
  expect(emptyPreviewBox.y).toBeGreaterThanOrEqual(
    stickyPreviewBox.y + stickyPreviewBox.height - 1,
  )
  expect(emptyPreviewBox.y + emptyPreviewBox.height).toBeLessThanOrEqual(844)
  await page.mouse.up()
  await expect(feedTabs.getByRole('tab', { name: /^Polls/, selected: true })).toBeVisible()
  await expect(incomingEmptyMessage).toBeVisible()
  const emptyFinalBox = await incomingEmptyMessage.boundingBox()
  const stickyFinalBox = await stickyHeader.boundingBox()
  expect(emptyFinalBox.y).toBeGreaterThanOrEqual(
    stickyFinalBox.y + stickyFinalBox.height - 1,
  )
  expect(emptyFinalBox.y + emptyFinalBox.height).toBeLessThanOrEqual(844)
  await expect.poll(() => page.evaluate((top) => Math.abs(
    document.documentElement.scrollHeight - window.innerHeight - top
  ), feedShellTop)).toBeLessThan(2)
  await page.evaluate((top) => window.scrollTo(0, top + 200), feedShellTop)
  await expect.poll(() => page.evaluate((top) => (
    Math.abs(window.scrollY - top)
  ), feedShellTop)).toBeLessThan(2)

  const shortToLongPoint = await feedSwipePoint(-260)
  await page.mouse.move(shortToLongPoint.x, shortToLongPoint.y)
  await page.mouse.down()
  await page.mouse.move(
    shortToLongPoint.x - 260,
    shortToLongPoint.y + 4,
    { steps: 8 },
  )
  const incomingLongTv = page.locator('[data-feed-panel-type="tv"]')
  await incomingLongTv.evaluate((panel) => {
    window.__shortToLongPanel = panel
    window.__shortToLongFrames = []
    function sampleShortToLong() {
      const viewport = document.querySelector('[data-feed-swipe-phase]')
      const phase = viewport?.dataset.feedSwipePhase
      window.__shortToLongFrames.push({
        x: panel.getBoundingClientRect().x,
        viewportHeight: viewport.getBoundingClientRect().height,
        panelHeight: panel.scrollHeight,
        documentHeight: document.documentElement.scrollHeight,
        phase,
      })
      if (phase !== 'idle') window.requestAnimationFrame(sampleShortToLong)
    }
    window.requestAnimationFrame(sampleShortToLong)
  })
  await page.mouse.up()
  await expect(feedTabs.getByRole('tab', { name: /^TV/, selected: true })).toBeVisible()
  const shortToLongHandoff = await page.evaluate(() => ({
    samePanel: window.__shortToLongPanel === document.querySelector(
      '[data-feed-panel-type="tv"]',
    ),
    frames: window.__shortToLongFrames,
  }))
  expect(shortToLongHandoff.samePanel).toBe(true)
  expect(shortToLongHandoff.frames.length).toBeGreaterThan(2)
  for (let index = 1; index < shortToLongHandoff.frames.length; index += 1) {
    expect(shortToLongHandoff.frames[index].x).toBeLessThanOrEqual(
      shortToLongHandoff.frames[index - 1].x + 1,
    )
  }
  expect(shortToLongHandoff.frames.every(({ viewportHeight, panelHeight }) => (
    viewportHeight >= panelHeight - 1
  ))).toBe(true)
  expect(
    Math.max(...shortToLongHandoff.frames.map(({ documentHeight }) => documentHeight)) -
    Math.min(...shortToLongHandoff.frames.map(({ documentHeight }) => documentHeight)),
  ).toBeLessThan(2)
  await page.getByText('Show 20', { exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByText('Show 20', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('group-feed-sticky-mobile.png') })
})

test('swipes categories from the blank feed canvas below Archived', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBookClub(page, { tvFeedCount: 1, archivedTvFeedCount: 1 })
  await page.goto('/')

  const feedTabs = page.getByRole('tablist', { name: 'Feed categories' })
  await feedTabs.getByRole('tab', { name: /^TV/ }).click()
  await expect(feedTabs.getByRole('tab', { name: /^TV/, selected: true })).toBeVisible()

  const feedShell = page.locator('[data-feed-shell]')
  const swipeSurface = page.locator('[data-feed-swipe-surface]')
  const stickyHeader = page.locator('[data-feed-sticky-header]')
  const archiveToggle = page.getByRole('button', { name: /^Archived \(1\)/ })
  await archiveToggle.click()
  await expect(page.getByText('Archived Show 1', { exact: true })).toBeVisible()
  await archiveToggle.click()
  await expect(page.getByText('Archived Show 1', { exact: true })).not.toBeVisible()
  const feedShellTop = await feedShell.evaluate((element) => (
    element.getBoundingClientRect().top + window.scrollY
  ))
  await page.evaluate((top) => window.scrollTo(0, top), feedShellTop)
  await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)

  const [surfaceBox, shellBox, archiveBox] = await Promise.all([
    swipeSurface.boundingBox(),
    feedShell.boundingBox(),
    archiveToggle.boundingBox(),
  ])
  expect(surfaceBox.y + surfaceBox.height).toBeGreaterThanOrEqual(
    shellBox.y + shellBox.height - 1,
  )
  const swipeY = archiveBox.y + archiveBox.height + 32
  expect(swipeY).toBeLessThan(surfaceBox.y + surfaceBox.height - 20)
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest('[data-feed-swipe-surface]') !== null
  ), { x: surfaceBox.x + surfaceBox.width / 2, y: swipeY })).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('group-feed-blank-canvas-mobile.png'),
  })

  const swipeStartX = surfaceBox.x + surfaceBox.width - 20
  await page.mouse.move(swipeStartX, swipeY)
  await page.mouse.down()
  await page.mouse.move(swipeStartX - 260, swipeY + 4, { steps: 8 })
  await page.mouse.up()

  await expect(
    feedTabs.getByRole('tab', { name: /^Book Club/, selected: true }),
  ).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true)
})

test('swipes categories from the clickable Book Club card header', async ({ page }, testInfo) => {
  await mockBookClub(page, { tvFeedCount: 1 })

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800, touch: false },
    { name: 'phone', width: 390, height: 844, touch: true },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')

    const feedTabs = page.getByRole('tablist', { name: 'Feed categories' })
    const bookClubTab = feedTabs.getByRole('tab', { name: /^Book Club/ })
    const tvTab = feedTabs.getByRole('tab', { name: /^TV/ })
    await bookClubTab.click()
    await expect(bookClubTab).toHaveAttribute('aria-selected', 'true')

    const cardHeader = page.getByRole('button', {
      name: /Book Club meeting .*Read through Chapter 9$/,
    })
    await expect(cardHeader).toHaveAttribute('aria-expanded', 'false')
    await clickMeetingHeader(cardHeader)
    await expect(cardHeader).toHaveAttribute('aria-expanded', 'true')
    await clickMeetingHeader(cardHeader)
    await expect(cardHeader).toHaveAttribute('aria-expanded', 'false')

    const feedShell = page.locator('[data-feed-shell]')
    const stickyHeader = page.locator('[data-feed-sticky-header]')
    const feedShellTop = await feedShell.evaluate((element) => (
      element.getBoundingClientRect().top + window.scrollY
    ))
    await page.evaluate((top) => window.scrollTo(0, top), feedShellTop)
    await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)
    const scrollBeforeSwipe = await page.evaluate(() => window.scrollY)
    const cardHeaderBox = await cardHeader.boundingBox()
    const swipeStart = {
      x: cardHeaderBox.x + 20,
      y: cardHeaderBox.y + cardHeaderBox.height / 2,
    }
    const swipeEnd = {
      x: cardHeaderBox.x + cardHeaderBox.width - 20,
      y: cardHeaderBox.y + cardHeaderBox.height / 2 + 4,
    }
    await cardHeader.evaluate((element) => {
      window.__swipedBookClubHeader = element
    })

    if (viewport.touch) {
      await dragTouch(page, swipeStart, swipeEnd)
    } else {
      await page.mouse.move(swipeStart.x, swipeStart.y)
      await page.mouse.down()
      await page.mouse.move(swipeEnd.x, swipeEnd.y, { steps: 8 })
      await page.mouse.up()
    }

    await expect(tvTab).toHaveAttribute('aria-selected', 'true')
    expect(await page.evaluate(() => (
      window.__swipedBookClubHeader.getAttribute('aria-expanded')
    ))).toBe('false')
    await expect.poll(() => page.evaluate((top) => (
      Math.abs(window.scrollY - top)
    ), scrollBeforeSwipe)).toBeLessThan(2)
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(
        `group-feed-book-club-card-swipe-${viewport.name}.png`,
      ),
    })
  }
})

test('keeps category focus and create permissions visually stable', async ({ page }, testInfo) => {
  await mockBookClub(page, { tvFeedCount: 1, viewerIsAdmin: false })

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')

    const feedTabs = page.getByRole('tablist', { name: 'Feed categories' })
    const allTab = feedTabs.getByRole('tab', { name: /^All/ })
    const tvTab = feedTabs.getByRole('tab', { name: /^TV/ })
    const bookClubTab = feedTabs.getByRole('tab', { name: /^Book Club/ })
    const titleRow = page.locator('[data-feed-title-row]')
    const categoryRow = page.locator('[data-feed-category-row]')
    const createSlot = page.locator('[data-feed-create-slot]')
    const heading = page.getByRole('heading', { name: 'Group Feed' })
    const feedShell = page.locator('[data-feed-shell]')
    const stickyHeader = page.locator('[data-feed-sticky-header]')

    await expect(allTab).toHaveAttribute('aria-selected', 'true')
    await expect(createSlot.getByRole('button', { name: 'Create a module' })).toBeVisible()
    const feedShellTop = await feedShell.evaluate((element) => (
      element.getBoundingClientRect().top + window.scrollY
    ))
    await page.evaluate((top) => window.scrollTo(0, top), feedShellTop)
    await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)

    const feedGeometry = async () => {
      const [titleRowBox, categoryRowBox, createSlotBox, headingBox, panelBox] =
        await Promise.all([
          titleRow.boundingBox(),
          categoryRow.boundingBox(),
          createSlot.boundingBox(),
          heading.boundingBox(),
          page.getByRole('tabpanel').boundingBox(),
        ])
      return {
        titleRowY: titleRowBox.y,
        titleRowHeight: titleRowBox.height,
        categoryRowY: categoryRowBox.y,
        createSlotX: createSlotBox.x,
        createSlotY: createSlotBox.y,
        headingX: headingBox.x,
        headingY: headingBox.y,
        panelY: panelBox.y,
      }
    }

    const expectStableGeometry = (actual, expected) => {
      Object.keys(expected).forEach((key) => {
        expect(Math.abs(actual[key] - expected[key]), key).toBeLessThan(1)
      })
    }

    const baselineGeometry = await feedGeometry()
    const pointerShadowBefore = await bookClubTab.evaluate((element) => (
      getComputedStyle(element).boxShadow
    ))
    const textColorBefore = await bookClubTab.evaluate((element) => (
      getComputedStyle(element).color
    ))
    const keyboardShadowBefore = await tvTab.evaluate((element) => (
      getComputedStyle(element).boxShadow
    ))

    await bookClubTab.click()
    await expect(bookClubTab).toHaveAttribute('aria-selected', 'true')
    await expect(createSlot.getByRole('button')).toHaveCount(0)
    expectStableGeometry(await feedGeometry(), baselineGeometry)
    expect(await bookClubTab.evaluate((element) => (
      getComputedStyle(element).boxShadow
    ))).toBe(pointerShadowBefore)
    await expect.poll(() => bookClubTab.evaluate((element) => (
      getComputedStyle(element).color
    ))).not.toBe(textColorBefore)
    await page.screenshot({
      path: testInfo.outputPath(`group-feed-permissions-${viewport.name}.png`),
    })

    await bookClubTab.press('ArrowLeft')
    await expect(tvTab).toBeFocused()
    await expect(tvTab).toHaveAttribute('aria-selected', 'true')
    await expect(createSlot.getByRole('button', { name: 'Add a show' })).toBeVisible()
    expectStableGeometry(await feedGeometry(), baselineGeometry)
    await expect.poll(() => tvTab.evaluate((element) => (
      getComputedStyle(element).boxShadow
    ))).not.toBe(keyboardShadowBefore)
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true)
  }
})

test('keeps the editorial feed header clear across themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockBookClub(page)
  await page.goto('/')

  for (const theme of ['light', 'dark', 'forest']) {
    await page.evaluate((nextTheme) => localStorage.setItem('roomie-theme', nextTheme), theme)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

    const stickyHeader = page.locator('[data-feed-sticky-header]')
    await expect(stickyHeader).not.toHaveAttribute('data-feed-pinned')
    await expect.poll(() => stickyHeader.evaluate((element) => (
      getComputedStyle(element).backgroundColor
    ))).toBe('rgba(0, 0, 0, 0)')
    const stickyDocumentTop = await stickyHeader.evaluate((element) => (
      element.getBoundingClientRect().top + window.scrollY
    ))
    await page.locator('[data-feed-panel-type="all"]').evaluate((panel) => {
      const spacer = document.createElement('div')
      spacer.style.height = '1000px'
      spacer.setAttribute('aria-hidden', 'true')
      panel.append(spacer)
    })
    await page.evaluate((top) => window.scrollTo(0, top + 200), stickyDocumentTop)
    await expect.poll(async () => Math.round((await stickyHeader.boundingBox()).y)).toBe(0)
    await expect(stickyHeader).toHaveAttribute('data-feed-pinned', '')
    await expect.poll(() => stickyHeader.evaluate((element) => {
      const background = getComputedStyle(element).backgroundColor
      return background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'
    })).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`group-feed-header-${theme}-desktop.png`) })
    await page.evaluate((top) => window.scrollTo(0, Math.max(top - 20, 0)), stickyDocumentTop)
    await expect(stickyHeader).not.toHaveAttribute('data-feed-pinned')
    await expect.poll(() => stickyHeader.evaluate((element) => (
      getComputedStyle(element).backgroundColor
    ))).toBe('rgba(0, 0, 0, 0)')
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true)
  }
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
  await expect(library.getByRole('button', { name: /The Fifth Season/ })).toContainText('Climate Fiction')
  await expect.poll(() => library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('book-club-library-modal-mobile.png'), fullPage: true })

  await library.getByRole('button', { name: /The Fifth Season/ }).click()
  const details = page.getByRole('dialog', { name: 'Book details' })
  await expect(details.getByRole('heading', { name: 'The Fifth Season' })).toBeVisible()
  const phonePersonalReview = details.getByRole('region', { name: 'Your review' })
  const phoneCommunityReviews = details.getByRole('region', { name: 'Community reviews' })
  await expect(phonePersonalReview.getByRole('button', { name: /Your review/ }))
    .toHaveAttribute('aria-expanded', 'true')
  await expect(phoneCommunityReviews.getByRole('button', { name: /Community reviews/ }))
    .toHaveAttribute('aria-expanded', 'false')
  expect(await phonePersonalReview.getByRole('button', { name: /Your review/ }).textContent())
    .not.toMatch(/[+−]/)
  await expect.poll(() => details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('book-club-detail-modal-mobile.png'), fullPage: true })

  await details.getByRole('button', { name: 'Close' }).click()
  const phoneMeetingHeader = page.getByRole('button', {
    name: /Open Book Club meeting .*Read through Chapter 9$/,
  })
  const phoneMeetingHeaderRoot = phoneMeetingHeader.locator('..')
  const phoneMeetingTitle = phoneMeetingHeaderRoot.locator('strong').first()
  const phoneMeetingBookLink = phoneMeetingHeaderRoot.getByRole('link', {
    name: 'View The Fifth Season in the Book Club library',
  })
  const phoneMeetingModuleTag = phoneMeetingHeaderRoot.locator('[data-module-type="book-club"]')
  const phoneMeetingMeta = phoneMeetingHeaderRoot.locator('span').last()
  const [
    phoneMeetingRootBox,
    phoneMeetingTitleBox,
    phoneMeetingBookBox,
    phoneMeetingTagBox,
    phoneMeetingMetaBox,
  ] = await Promise.all([
    phoneMeetingHeaderRoot.boundingBox(),
    phoneMeetingTitle.boundingBox(),
    phoneMeetingBookLink.boundingBox(),
    phoneMeetingModuleTag.boundingBox(),
    phoneMeetingMeta.boundingBox(),
  ])
  expect(phoneMeetingBookBox.x).toBeGreaterThan(
    phoneMeetingTagBox.x + phoneMeetingTagBox.width,
  )
  expect(Math.abs(
    phoneMeetingBookBox.y - phoneMeetingTagBox.y,
  )).toBeLessThan(2)
  expect(Math.abs(phoneMeetingMetaBox.x - phoneMeetingTagBox.x)).toBeLessThan(2)
  expect(phoneMeetingTitleBox.x).toBeGreaterThan(phoneMeetingBookBox.x)
  expect(phoneMeetingTitleBox.x + phoneMeetingTitleBox.width)
    .toBeLessThan(phoneMeetingBookBox.x + phoneMeetingBookBox.width)
  expect(phoneMeetingBookBox.x + phoneMeetingBookBox.width)
    .toBeLessThanOrEqual(phoneMeetingRootBox.x + phoneMeetingRootBox.width)
  await clickMeetingHeader(phoneMeetingHeader)
  const attendanceSection = page.getByRole('region', { name: 'Attendance' })
  await expect(attendanceSection.getByText('Attendance', { exact: true })).toHaveCount(0)
  await expect(attendanceSection.getByText(/^\d+ members?$/)).toHaveCount(0)
  const attendance = page.getByLabel('Member attendance')
  await expectAttendanceRowsStacked(attendance)
  await page.waitForTimeout(750)
  await expect(attendance.getByRole('button', { name: 'View 1 person marked attending' })).toBeVisible()
  await expect(attendance.getByRole('button', { name: 'View 1 person marked maybe' })).toBeVisible()
  await expect(attendance.getByRole('button', { name: 'View 1 person marked pending' })).toBeVisible()
  await expect.poll(() => attendance.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const rsvpLabel = attendanceSection.getByText('RSVP', { exact: true })
  const rsvpRow = attendanceSection.locator('label').filter({ hasText: 'RSVP' })
  const rsvpSelect = attendanceSection.getByLabel('RSVP')
  const rsvpRowBox = await rsvpRow.boundingBox()
  const rsvpSelectBox = await rsvpSelect.boundingBox()
  const rsvpLabelBox = await rsvpLabel.boundingBox()
  expect(rsvpRowBox.height).toBeGreaterThanOrEqual(rsvpSelectBox.height)
  expect(Math.abs(
    (rsvpLabelBox.y + rsvpLabelBox.height / 2) - (rsvpSelectBox.y + rsvpSelectBox.height / 2),
  )).toBeLessThanOrEqual(8)
  expect(rsvpSelectBox.x).toBeGreaterThan(rsvpLabelBox.x)
  await expect(page.getByRole('region', { name: 'Discussion' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true)
  const reminderBox = await page.getByRole('button', { name: 'Send reminder' }).boundingBox()
  const completeBox = await page.getByRole('button', { name: 'Complete meeting' }).boundingBox()
  for (const box of [reminderBox, completeBox]) {
    expect(box.height).toBeGreaterThanOrEqual(36)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  await page.getByRole('button', { name: 'Complete meeting' }).click()
  const confirmation = page.getByRole('dialog', { name: /Complete meeting/ })
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await expect.poll(() => confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('complete-meeting-confirmation-mobile.png'), fullPage: true })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(750)
  await page.screenshot({ path: testInfo.outputPath('book-club-meeting-tracker-mobile.png'), fullPage: true })
})

test('centers attendance overflow counters on desktop and phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockBookClub(page, { crowdedAttendance: true })
  await page.goto('/')

  const meetingHeader = page.getByRole('button', {
    name: /Open Book Club meeting .*Read through Chapter 9$/,
  })
  await clickMeetingHeader(meetingHeader)
  await page.waitForTimeout(750)
  const attendance = page.getByLabel('Member attendance')

  async function expectCounterCentered(counter) {
    await expect(counter).toBeVisible()
    await expect.poll(() => counter.evaluate((element) => {
      const circle = element.getBoundingClientRect()
      const textRange = document.createRange()
      textRange.selectNodeContents(element)
      const text = textRange.getBoundingClientRect()
      return {
        display: getComputedStyle(element).display,
        horizontallyCentered: Math.abs(
          (circle.left + circle.width / 2) - (text.left + text.width / 2),
        ) <= 1,
        verticallyCentered: Math.abs(
          (circle.top + circle.height / 2) - (text.top + text.height / 2),
        ) <= 1,
      }
    })).toEqual({
      display: 'grid',
      horizontallyCentered: true,
      verticallyCentered: true,
    })
  }

  await expectCounterCentered(attendance.getByText('+2', { exact: true }))
  await page.screenshot({
    path: testInfo.outputPath('book-club-attendance-overflow-desktop.png'),
    fullPage: true,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectCounterCentered(attendance.getByText('+3', { exact: true }))
  await expect.poll(() => attendance.evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('book-club-attendance-overflow-mobile.png'),
    fullPage: true,
  })
})
