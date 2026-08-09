import LiveEventBanner from "./LiveEventBanner.jsx";

export default function LiveModuleBanners({
  liveEvents,
  liveWatchparties,
  onEndEvent,
  onEndWatchparty,
  onOpenFeed,
  transitioningId,
  user,
}) {
  if (liveEvents.length === 0 && liveWatchparties.length === 0) return null;

  return (
    <>
      {liveEvents.map((event) => (
        <LiveEventBanner
          key={event.id}
          event={event}
          canEnd={event.proposedById === user.id}
          ending={transitioningId === event.id}
          onEnd={() => onEndEvent(event)}
          user={user}
          onBannerClick={onOpenFeed}
          type="event"
        />
      ))}
      {liveWatchparties.map((show) => (
        <LiveEventBanner
          key={`watchparty:${show.id}`}
          event={{
            id: show.id,
            text: `Watching ${show.title}${
              show.watchpartySeason && show.watchpartyEpisode
                ? ` S${show.watchpartySeason} E${show.watchpartyEpisode}`
                : ""
            }`,
            proposedBy: show.watchpartyStartedBy || "Someone",
            liveStartedAt: show.watchpartyStartedAt,
            memberIds: (show.members || []).map((member) => member.id),
          }}
          canEnd={(show.members || []).some((member) => member.id === user.id)}
          ending={transitioningId === show.id}
          onEnd={() => onEndWatchparty(show)}
          user={user}
          onBannerClick={onOpenFeed}
          type="watchparty"
        />
      ))}
    </>
  );
}

