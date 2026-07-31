import ActivityCreateForm from "./ActivityCreateForm.jsx";
import ChecklistCreateForm from "./ChecklistCreateForm.jsx";
import ChecklistFeature from "./ChecklistFeature.jsx";
import ModuleEditForm from "./ModuleEditForm.jsx";
import PollCreateForm from "./PollCreateForm.jsx";
import PollFeature from "./PollFeature.jsx";
import ProposeActivity from "./ProposeActivity.jsx";
import RequestCreateForm from "./RequestCreateForm.jsx";
import RequestFeature from "./RequestFeature.jsx";
import ShowCreateForm from "./ShowCreateForm.jsx";
import ShowTrackerFeature from "./ShowTrackerFeature.jsx";
import BookClubMeetingFeature from "../book-club/BookClubMeetingFeature.jsx";
import BookClubMeetingForm from "../book-club/BookClubMeetingForm.jsx";

const STANDARD = "standard";
const SHARED = "shared";
const BOOK_CLUB = "book-club";

function createFormProps(onChanged, onClose) {
  return {
    onSuccess: onClose,
    onCancel: onClose,
    onChanged,
  };
}

export const FEED_MODULE_REGISTRY = {
  events: {
    id: "events",
    label: "Events",
    shortLabel: "Events",
    createLabel: "Create an event",
    availability: STANDARD,
    ownerField: "proposedById",
    edit: {
      label: "Edit event",
      field: "text",
      fieldLabel: "Event",
      schedule: true,
    },
    renderCreate: ({ onChanged, onClose }) => {
      const props = createFormProps(onChanged, onClose);
      return (
        <ActivityCreateForm
          onActivitiesChange={props.onChanged}
          onSuccess={props.onSuccess}
          onCancel={props.onCancel}
        />
      );
    },
    renderCard: ({
      module,
      moduleTag,
      onChanged,
      onEdit,
      onLiveTransition,
      roommates,
      transitioningId,
    }) => (
      <ProposeActivity
        activity={module.payload}
        onActivitiesChange={onChanged}
        transitioningId={transitioningId}
        onLiveTransition={onLiveTransition}
        roommates={roommates}
        moduleTag={moduleTag}
        onEdit={onEdit}
      />
    ),
  },
  requests: {
    id: "requests",
    label: "Requests",
    shortLabel: "Requests",
    createLabel: "Create a request",
    availability: STANDARD,
    ownerField: "requesterId",
    edit: {
      label: "Edit request",
      field: "text",
      fieldLabel: "Request",
      recipients: true,
    },
    renderCreate: ({ onChanged, onClose, roommates }) => {
      const props = createFormProps(onChanged, onClose);
      return (
        <RequestCreateForm
          roommates={roommates}
          onRequestsChange={props.onChanged}
          onSuccess={props.onSuccess}
          onCancel={props.onCancel}
        />
      );
    },
    renderCard: ({ module, moduleTag, onChanged, onEdit, roommates }) => (
      <RequestFeature
        request={module.payload}
        onRequestsChange={onChanged}
        roommates={roommates}
        moduleTag={moduleTag}
        onEdit={onEdit}
      />
    ),
  },
  checklists: {
    id: "checklists",
    label: "Checklists",
    shortLabel: "Lists",
    createLabel: "Create a checklist",
    availability: STANDARD,
    ownerField: "createdById",
    edit: {
      label: "Edit checklist",
      field: "title",
      fieldLabel: "Checklist title",
    },
    renderCreate: ({ onChanged, onClose }) => {
      const props = createFormProps(onChanged, onClose);
      return (
        <ChecklistCreateForm
          onChecklistsChange={props.onChanged}
          onSuccess={props.onSuccess}
          onCancel={props.onCancel}
        />
      );
    },
    renderCard: ({ module, moduleTag, onChanged, onEdit }) => (
      <ChecklistFeature
        checklist={module.payload}
        onChecklistsChange={onChanged}
        moduleTag={moduleTag}
        onEdit={onEdit}
      />
    ),
  },
  polls: {
    id: "polls",
    label: "Polls",
    shortLabel: "Polls",
    createLabel: "Create a poll",
    availability: SHARED,
    ownerField: "createdById",
    edit: {
      label: "Edit poll",
      field: "title",
      fieldLabel: "Poll title",
    },
    renderCreate: ({ onChanged, onClose }) => {
      const props = createFormProps(onChanged, onClose);
      return (
        <PollCreateForm
          onPollsChange={props.onChanged}
          onSuccess={props.onSuccess}
          onCancel={props.onCancel}
        />
      );
    },
    renderCard: ({ module, moduleTag, onChanged, onEdit, roommates }) => (
      <PollFeature
        poll={module.payload}
        roommates={roommates}
        onPollsChange={onChanged}
        moduleTag={moduleTag}
        onEdit={onEdit}
      />
    ),
  },
  tv: {
    id: "tv",
    label: "TV",
    shortLabel: "TV",
    createLabel: "Add a show",
    availability: STANDARD,
    ownerField: "createdById",
    edit: {
      label: "Edit show",
      field: "title",
      fieldLabel: "Show title",
    },
    renderCreate: ({ onChanged, onClose }) => {
      const props = createFormProps(onChanged, onClose);
      return (
        <ShowCreateForm
          onShowsChange={props.onChanged}
          onSuccess={props.onSuccess}
          onCancel={props.onCancel}
        />
      );
    },
    renderCard: ({ module, moduleTag, onChanged, onEdit }) => (
      <ShowTrackerFeature
        show={module.payload}
        onShowsChange={onChanged}
        moduleTag={moduleTag}
        onEdit={onEdit}
      />
    ),
  },
  "book-club": {
    id: "book-club",
    label: "Book Club",
    shortLabel: "Books",
    createLabel: "Create a Book Club meeting",
    availability: BOOK_CLUB,
    ownerField: null,
    edit: { label: "Edit Book Club meeting" },
    canCreate: ({ canAdministerBookClub }) => canAdministerBookClub,
    canEdit: () => false,
    renderCreate: ({ onChanged, onClose, roommates }) => (
      <BookClubMeetingForm
        roommates={roommates}
        onSaved={async () => {
          await onChanged();
          onClose();
        }}
        onCancel={onClose}
      />
    ),
    renderCard: ({
      canAdministerBookClub,
      module,
      moduleTag,
      onChanged,
      onEdit,
    }) => (
      <BookClubMeetingFeature
        meeting={module.payload}
        moduleTag={moduleTag}
        onEdit={onEdit}
        canAdminister={canAdministerBookClub}
        onChanged={onChanged}
      />
    ),
    renderEdit: ({ module, onChanged, onClose, roommates }) => (
      <BookClubMeetingForm
        meeting={module.payload}
        roommates={roommates}
        onSaved={async () => {
          await onChanged();
          onClose();
        }}
        onCancel={onClose}
      />
    ),
  },
};

export const FEED_MODULE_TYPES = [
  { id: "all", label: "All", shortLabel: "All" },
  ...Object.values(FEED_MODULE_REGISTRY).map(
    ({ id, label, shortLabel }) => ({ id, label, shortLabel }),
  ),
];

export function isFeedModuleEnabled(
  definition,
  { showBookClub, showStandardModules },
) {
  if (definition.availability === STANDARD) return showStandardModules;
  if (definition.availability === BOOK_CLUB) return showBookClub;
  return showStandardModules || showBookClub;
}

export function canCreateFeedModule(definition, context) {
  return definition.canCreate?.(context) ?? true;
}

export function canEditFeedModule(definition, module, userId) {
  if (module.isArchived) return false;
  if (definition.canEdit) return definition.canEdit({ module, userId });
  return Boolean(
    definition.ownerField && module.payload[definition.ownerField] === userId,
  );
}

export function renderFeedModuleEdit(definition, context) {
  if (definition.renderEdit) return definition.renderEdit(context);
  return <ModuleEditForm {...context} editDefinition={definition.edit} />;
}
