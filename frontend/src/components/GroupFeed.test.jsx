import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import GroupFeed from './GroupFeed.jsx'
import { getFeed, updateModule } from '../api/client.js'

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 'andre', name: 'Andre', hasGroup: true, groupId: 'shire' },
  }),
}))

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getFeed: vi.fn(), updateModule: vi.fn() }
})

const ROOMMATES = [
  { id: 'andre', name: 'Andre' },
  { id: 'kayla', name: 'Kayla' },
]

function feedItem(type, id = `${type}-1`, isArchived = false) {
  const common = {
    id,
    type,
    createdAt: 1,
    updatedAt: 1,
    sortAt: 1,
    title: `${type} title`,
    subtitle: type,
    actor: 'Andre',
    isArchived,
  }
  const payloads = {
    events: {
      id,
      text: 'Movie night',
      proposedBy: 'Andre',
      proposedById: 'andre',
      members: ['Andre'],
      memberIds: ['andre'],
      comments: [],
      createdAt: 1,
      updatedAt: 1,
      startAt: null,
      endAt: null,
      isLive: false,
      isExpired: false,
      isArchived,
    },
    requests: {
      id,
      text: 'Pick up milk',
      requester: 'Andre',
      requesterId: 'andre',
      requestedIds: ['kayla'],
      requested: [{ id: 'kayla', name: 'Kayla', response: 'pending' }],
      comments: [],
      createdAt: 1,
      updatedAt: 1,
      isArchived,
    },
    checklists: {
      id,
      title: 'Kitchen reset',
      createdBy: 'Andre',
      createdById: 'andre',
      items: [],
      createdAt: 1,
      updatedAt: 1,
      isArchived,
    },
    tv: {
      id,
      title: 'Severance',
      createdBy: 'Andre',
      createdById: 'andre',
      members: [],
      createdAt: 1,
      updatedAt: 1,
      isArchived,
    },
    spotify: {
      id,
      hostId: 'andre',
      hostName: 'Andre',
      link: 'https://spotify.link/jam',
      createdAt: 1,
      updatedAt: 1,
    },
  }
  return { ...common, payload: payloads[type] }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderFeed(initialUrl, items) {
  getFeed.mockResolvedValue(items)
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <GroupFeed roommates={ROOMMATES} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function cardForText(text) {
  return screen.getByText(text).closest('[role="button"]')
}

describe('GroupFeed module focus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateModule.mockResolvedValue({ module: {} })
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => cleanup())

  it.each([
    ['events', 'Movie night'],
    ['requests', 'Pick up milk'],
    ['checklists', 'Kitchen reset'],
    ['tv', 'Severance'],
  ])('opens and scrolls the %s module exactly once', async (type, label) => {
    const module = feedItem(type)
    renderFeed(`/?module=${type}&item=${module.id}`, [module])

    await waitFor(() => expect(cardForText(label)).toHaveAttribute('aria-expanded', 'true'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(''))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('scrolls a static Spotify module without adding expansion behavior', async () => {
    const module = feedItem('spotify', 'activeJam#shire')
    renderFeed('/?module=spotify&item=activeJam%23shire', [module])

    await screen.findByText("Andre's Jam is live")
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('')
  })

  it('reveals archived targets before focusing them', async () => {
    const module = feedItem('requests', 'request-archived', true)
    renderFeed('/?module=requests&item=request-archived', [module])

    await waitFor(() =>
      expect(cardForText('Pick up milk')).toHaveAttribute('aria-expanded', 'true'),
    )
    expect(screen.getByRole('button', { name: /Archived \(1\)/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('consumes missing targets without retrying scroll', async () => {
    renderFeed('/?module=requests&item=missing', [])

    expect(await screen.findByText('That module is no longer available.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('handles filter-only and unknown module destinations without scrolling', async () => {
    renderFeed('/?module=tv', [feedItem('tv')])
    expect(await screen.findByRole('heading', { name: 'TV' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(''))
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    cleanup()
    renderFeed('/?module=unknown&item=one', [])
    expect(await screen.findByText('That module type is not available.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('preserves a request draft and manual close across feed refreshes', async () => {
    const module = feedItem('requests')
    renderFeed(`/?module=requests&item=${module.id}`, [module])
    const user = userEvent.setup()

    const input = await screen.findByPlaceholderText(/Add a comment/)
    await waitFor(() => expect(cardForText('Pick up milk')).toHaveAttribute('aria-expanded', 'true'))
    await user.type(input, 'draft survives polling')

    getFeed.mockResolvedValue([{ ...module, payload: { ...module.payload } }])
    fireEvent.focus(window)
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2))
    expect(input).toHaveValue('draft survives polling')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText('Pick up milk'))
    expect(cardForText('Pick up milk')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.focus(window)
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(3))
    expect(cardForText('Pick up milk')).toHaveAttribute('aria-expanded', 'false')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['events', 'Edit event', 'Event', 'Movie night'],
    ['requests', 'Edit request', 'Request', 'Pick up milk'],
    ['checklists', 'Edit checklist', 'Checklist title', 'Kitchen reset'],
    ['tv', 'Edit show', 'Show title', 'Severance'],
    ['spotify', 'Edit Spotify Jam', 'Spotify Jam link', 'https://spotify.link/jam'],
  ])('opens a prepopulated creator editor for %s', async (type, editLabel, fieldLabel, value) => {
    renderFeed('/', [feedItem(type)])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: editLabel }))
    expect(screen.getByRole('dialog', { name: editLabel })).toBeInTheDocument()
    expect(screen.getByLabelText(fieldLabel)).toHaveValue(value)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('does not expose editing to non-creators or archived module owners', async () => {
    const nonOwner = feedItem('requests')
    nonOwner.payload.requesterId = 'kayla'
    renderFeed('/', [nonOwner, feedItem('checklists', 'archived', true)])

    await screen.findByText('Pick up milk')
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit checklist' })).not.toBeInTheDocument()
  })

  it('preserves an open edit draft across polling and saves through the generic API', async () => {
    const module = feedItem('requests')
    renderFeed('/', [module])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit request' }))
    const input = screen.getByLabelText('Request')
    await user.clear(input)
    await user.type(input, 'draft request text')

    getFeed.mockResolvedValue([
      { ...module, payload: { ...module.payload, text: 'server refresh text' } },
    ])
    fireEvent.focus(window)
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2))
    expect(input).toHaveValue('draft request text')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(updateModule).toHaveBeenCalledWith('requests', module.id, 'andre', {
        text: 'draft request text',
        requestedIds: ['kayla'],
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit request' })).not.toBeInTheDocument(),
    )
  })
})
