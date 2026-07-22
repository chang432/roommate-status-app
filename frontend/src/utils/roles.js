// Membership role model, mirroring the backend's db.VALID_ROLES. A role is
// per-group: the same account can administer one household and be a plain
// member of another, so always read it off a roommate row from that group's
// roster rather than off the signed-in user.

export const ROLE = {
  ADMIN: 'admin',
  MEMBER: 'member',
}

export const ROLE_LABEL = {
  [ROLE.ADMIN]: 'Admin',
  [ROLE.MEMBER]: 'Member',
}

// Rows written before roles existed have no `role`; treat them as members, the
// same fallback the backend applies.
export function roleOf(member) {
  return member?.role === ROLE.ADMIN ? ROLE.ADMIN : ROLE.MEMBER
}

export function isAdmin(member) {
  return roleOf(member) === ROLE.ADMIN
}

// Whether `userId` administers the group this roster belongs to.
export function isAdminIn(roommates, userId) {
  return isAdmin((roommates || []).find((member) => member.id === userId))
}
