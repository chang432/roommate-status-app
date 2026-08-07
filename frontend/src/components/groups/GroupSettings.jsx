import { useEffect, useState } from "react";
import {
  getCurrentGroup,
  removeGroupMember,
  renameGroup,
  setGroupMemberRole,
  updateGroupModules,
  updateGroupTheme,
} from "../../api/groups.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { GROUP_MODULE_DEFINITIONS } from "../../models/groupModules.js";
import { THEME_DEFINITIONS, themeDefinition } from "../../models/themes.js";
import { cx } from "../../utils/classNames.js";
import { ROLE, ROLE_LABEL, isAdmin, roleOf } from "../../utils/roles.js";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import styles from "./GroupSettings.module.css";

export default function GroupSettings({ group: initialGroup, roommates, onGroupChange, onRoommatesChange }) {
  const { user } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [group, setGroup] = useState(initialGroup);
  const [name, setName] = useState(initialGroup?.name ?? "");
  const [loading, setLoading] = useState(!initialGroup);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState("");
  const [modulesBusy, setModulesBusy] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const { confirm, confirmationDialog } = useConfirmDialog();

  useEffect(() => {
    let current = true;
    getCurrentGroup(user.id)
      .then(({ group: refreshed }) => {
        if (!current) return;
        setGroup(refreshed);
        setName(refreshed.name);
        setError("");
      })
      .catch((requestError) => {
        if (current) setError(requestError.message || "Could not load group settings.");
      })
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [user.id]);

  const viewerIsAdmin = Boolean(group?.viewerIsAdmin);
  const enabledModules = group?.enabledModules ?? [];

  function acceptGroup(updated) {
    setGroup(updated);
    setName(updated.name);
    onGroupChange?.(updated);
  }

  async function handleRename(event) {
    event.preventDefault();
    if (!name.trim() || nameBusy) return;
    setNameBusy(true);
    setError("");
    try {
      const { group: updated } = await renameGroup(user.id, name.trim());
      acceptGroup(updated);
    } catch (requestError) {
      setError(requestError.message || "Could not rename this group.");
    } finally {
      setNameBusy(false);
    }
  }

  async function handleCopyCode() {
    if (!group?.joinCode) return;
    await navigator.clipboard.writeText(group.joinCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleTheme(nextTheme) {
    if (themeBusy || nextTheme === theme) return;
    const previousTheme = theme;
    setTheme(nextTheme);
    setThemeBusy(true);
    setError("");
    try {
      await updateGroupTheme(user.id, nextTheme);
      acceptGroup({ ...group, theme: nextTheme });
    } catch (requestError) {
      setTheme(previousTheme);
      setError(requestError.message || "Could not save this group theme.");
    } finally {
      setThemeBusy(false);
    }
  }

  async function handleModuleToggle(moduleId, checked) {
    if (!viewerIsAdmin || modulesBusy) return;
    setModulesBusy(true);
    setError("");
    const next = checked
      ? [...enabledModules, moduleId]
      : enabledModules.filter((id) => id !== moduleId);
    try {
      const { group: updated } = await updateGroupModules(user.id, next);
      acceptGroup(updated);
    } catch (requestError) {
      setError(requestError.message || "Could not update enabled modules.");
    } finally {
      setModulesBusy(false);
    }
  }

  async function runMemberAction(member, action) {
    setPendingMemberId(member.id);
    setError("");
    try {
      onRoommatesChange?.(await action());
    } catch (requestError) {
      setError(requestError.message || "Could not update that roommate.");
    } finally {
      setPendingMemberId("");
    }
  }

  function handleToggleAdmin(member) {
    const nextRole = isAdmin(member) ? ROLE.MEMBER : ROLE.ADMIN;
    return runMemberAction(member, () => setGroupMemberRole(user.id, member.id, nextRole));
  }

  async function handleRemove(member) {
    const accepted = await confirm({
      title: `Remove ${member.name}?`,
      message: `This removes ${member.name} from ${group.name}.`,
      confirmLabel: "Remove member",
    });
    if (accepted) return runMemberAction(member, () => removeGroupMember(user.id, member.id));
  }

  if (loading) return <p className={styles.state}>Loading group settings…</p>;

  return (
    <div className={styles.panel}>
      {error ? <p className="ui-errorBox">{error}</p> : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3>Group</h3><p>{viewerIsAdmin ? "Rename this household or share its invite code." : "Group details are managed by an admin."}</p></div>
        {viewerIsAdmin ? (
          <form onSubmit={handleRename} className={styles.nameForm}>
            <label className={styles.grow}><span className="ui-formLabel">Group name</span><input className={cx("ui-textInput", styles.input)} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
            <button className={cx("ui-primaryButton", styles.nameButton)} disabled={nameBusy || !name.trim()}>{nameBusy ? "Saving…" : "Save"}</button>
          </form>
        ) : <p className={styles.groupName}>{group?.name}</p>}
        <p className={styles.codeLabel}>Invite code</p>
        <div className={styles.codeRow}><code>{group?.joinCode}</code><button type="button" onClick={handleCopyCode} className="ui-secondaryButton">{copied ? "Copied" : "Copy"}</button></div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3>Your theme in this group</h3><p>Current theme: {themeDefinition(resolvedTheme)?.label ?? resolvedTheme}. This choice follows you across devices.</p></div>
        <div className={styles.themeChoices} role="radiogroup" aria-label="Theme">
          {THEME_DEFINITIONS.map((choice) => <button key={choice.id} type="button" role="radio" aria-checked={theme === choice.id} disabled={themeBusy} onClick={() => handleTheme(choice.id)} className={cx(styles.themeChoice, theme === choice.id && styles.themeChoiceActive)}><strong>{choice.label}</strong><small>{choice.description}</small></button>)}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3>Enabled modules</h3><p>{viewerIsAdmin ? "Choose what appears for everyone. Hidden data is preserved." : "Only group admins can change these modules."}</p></div>
        <div className={styles.moduleList}>
          {GROUP_MODULE_DEFINITIONS.map((module) => <label key={module.id} className={styles.moduleRow}><span><strong>{module.label}</strong><small>{module.description}</small></span><input type="checkbox" checked={enabledModules.includes(module.id)} disabled={!viewerIsAdmin || modulesBusy} onChange={(event) => handleModuleToggle(module.id, event.target.checked)} /></label>)}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3>Members</h3><p>{viewerIsAdmin ? "Grant admin access or remove a roommate." : "Member roles are read-only for you."}</p></div>
        <ul className={styles.memberList}>
          {roommates.map((member) => {
            const self = member.id === user.id;
            const busy = pendingMemberId === member.id;
            return <li key={member.id} className={styles.memberRow}><div><strong>{member.name}{self ? " (you)" : ""}</strong><small>{ROLE_LABEL[roleOf(member)]}</small></div>{viewerIsAdmin ? <div className={styles.memberActions}><button type="button" className="ui-secondaryButton" disabled={busy} onClick={() => handleToggleAdmin(member)}>{isAdmin(member) ? "Revoke admin" : "Make admin"}</button>{!self && !isAdmin(member) ? <button type="button" className={styles.removeButton} disabled={busy} onClick={() => handleRemove(member)}>Remove</button> : null}</div> : null}</li>;
          })}
        </ul>
      </section>
      {confirmationDialog}
    </div>
  );
}
