import { useCallback, useEffect, useState } from "react";
import { getGroups } from "../api/groups.js";

export default function useGroupMemberships({
  createGroup,
  joinGroup,
  searchParams,
  selectGroup,
  setSearchParams,
  user,
}) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadGroups = useCallback(async () => {
    try {
      const { groups: memberships } = await getGroups(user.id);
      setGroups(memberships);
      setError("");

      const requestedGroupId = searchParams.get("groupId");
      const isMember = (groupId) =>
        memberships.some((group) => group.groupId === groupId);
      const nextGroupId = isMember(requestedGroupId)
        ? requestedGroupId
        : isMember(user.activeGroupId)
          ? user.activeGroupId
          : isMember(user.groupId)
            ? user.groupId
            : memberships[0]?.groupId;
      if (nextGroupId && nextGroupId !== user.activeGroupId) {
        selectGroup(nextGroupId);
      }
      if (requestedGroupId) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("groupId");
        setSearchParams(nextParams, { replace: true });
      }
    } catch (err) {
      setError(err.message || "Could not load your groups.");
    } finally {
      setLoading(false);
    }
  }, [
    searchParams,
    selectGroup,
    setSearchParams,
    user.activeGroupId,
    user.groupId,
    user.id,
  ]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const refreshMemberships = useCallback(async () => {
    const { groups: memberships } = await getGroups(user.id);
    setGroups(memberships);
    setError("");
  }, [user.id]);

  const join = useCallback(
    async (code) => {
      await joinGroup(code);
      await refreshMemberships();
    },
    [joinGroup, refreshMemberships],
  );

  const create = useCallback(
    async (name) => {
      await createGroup(name);
      await refreshMemberships();
    },
    [createGroup, refreshMemberships],
  );

  const update = useCallback((updatedGroup) => {
    setGroups((current) =>
      current.map((group) =>
        group.groupId === updatedGroup.groupId ? updatedGroup : group,
      ),
    );
  }, []);

  return { create, error, groups, join, loading, update };
}

