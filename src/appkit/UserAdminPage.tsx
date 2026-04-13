import { createPortal } from "react-dom";
import { useAppChrome } from "../i18n/useAppChrome";
import type { Dispatch, SetStateAction } from "react";
import type { ProfileDraft } from "./useUserAdmin";
import type { PublicUser } from "../api/users";

type Role = "admin" | "user" | "subscriber";

export type UserAdminPageProps = {
  open: boolean;
  onClose: () => void;
  adminUsersErr: string | null;
  userAdminFormErr: string | null;
  newUserUsername: string;
  setNewUserUsername: Dispatch<SetStateAction<string>>;
  newUserPassword: string;
  setNewUserPassword: Dispatch<SetStateAction<string>>;
  newUserDisplayName: string;
  setNewUserDisplayName: Dispatch<SetStateAction<string>>;
  newUserEmail: string;
  setNewUserEmail: Dispatch<SetStateAction<string>>;
  newUserRole: Role;
  setNewUserRole: Dispatch<SetStateAction<Role>>;
  newUserBusy: boolean;
  submitNewUser: () => void | Promise<void>;
  adminUsers: PublicUser[];
  adminUsersLoading: boolean;
  rowBusyId: string | null;
  pwdResetByUser: Record<string, string>;
  setPwdResetByUser: Dispatch<SetStateAction<Record<string, string>>>;
  profileDrafts: Record<string, ProfileDraft>;
  setProfileDraft: (id: string, field: keyof ProfileDraft, value: string) => void;
  saveUserProfile: (u: PublicUser) => void | Promise<void>;
  onRoleChange: (u: PublicUser, role: Role) => void | Promise<void>;
  applyPasswordReset: (u: PublicUser) => void | Promise<void>;
  onDeleteUser: (u: PublicUser) => void | Promise<void>;
};

function shortId(id: string) {
  if (id.length <= 18) return id;
  return `${id.slice(0, 14)}…`;
}

export function UserAdminPage(p: UserAdminPageProps) {
  const {
    open,
    onClose,
    adminUsersErr,
    userAdminFormErr,
    newUserUsername,
    setNewUserUsername,
    newUserPassword,
    setNewUserPassword,
    newUserDisplayName,
    setNewUserDisplayName,
    newUserEmail,
    setNewUserEmail,
    newUserRole,
    setNewUserRole,
    newUserBusy,
    submitNewUser,
    adminUsers,
    adminUsersLoading,
    rowBusyId,
    pwdResetByUser,
    setPwdResetByUser,
    profileDrafts,
    setProfileDraft,
    saveUserProfile,
    onRoleChange,
    applyPasswordReset,
    onDeleteUser,
  } = p;

  const c = useAppChrome();
  if (!open) return null;

  return createPortal(
    <div className="user-admin-page" role="document">
      <header className="user-admin-page__header">
        <button
          type="button"
          className="user-admin-page__back"
          onClick={onClose}
        >
          {c.adminBackToNotes}
        </button>
        <h1 className="user-admin-page__title" id="user-admin-page-title">
          {c.adminTitle}
        </h1>
      </header>
      <div className="user-admin-page__body">
        <p className="user-admin-page__lead">
          {c.adminLead}
        </p>
        {adminUsersErr || userAdminFormErr ? (
          <p className="user-admin-page__err" role="alert">
            {adminUsersErr ?? userAdminFormErr}
          </p>
        ) : null}

        <section
          className="user-admin-page__section"
          aria-labelledby="user-admin-new-heading"
        >
          <h2 id="user-admin-new-heading" className="user-admin-page__h2">
            {c.adminNewUserHeading}
          </h2>
          <div className="user-admin__fields user-admin__fields--row">
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-username">
                {c.adminLabelLoginId}
              </label>
              <input
                id="ua-new-username"
                type="text"
                className="user-admin__field-input"
                autoComplete="off"
                placeholder={c.adminPhLoginId}
                value={newUserUsername}
                disabled={newUserBusy}
                onChange={(e) => setNewUserUsername(e.target.value)}
              />
            </div>
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-password">
                {c.adminLabelPassword}
              </label>
              <input
                id="ua-new-password"
                type="password"
                className="user-admin__field-input"
                autoComplete="new-password"
                placeholder={c.adminPhPassword}
                value={newUserPassword}
                disabled={newUserBusy}
                onChange={(e) => setNewUserPassword(e.target.value)}
              />
            </div>
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-display">
                {c.adminLabelDisplayName}
              </label>
              <input
                id="ua-new-display"
                type="text"
                className="user-admin__field-input"
                autoComplete="off"
                placeholder={c.adminPhDisplayName}
                value={newUserDisplayName}
                disabled={newUserBusy}
                onChange={(e) => setNewUserDisplayName(e.target.value)}
              />
            </div>
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-email">
                {c.adminLabelEmail}
              </label>
              <input
                id="ua-new-email"
                type="email"
                className="user-admin__field-input"
                autoComplete="off"
                placeholder={c.adminPhEmail}
                value={newUserEmail}
                disabled={newUserBusy}
                onChange={(e) => setNewUserEmail(e.target.value)}
              />
            </div>
            <div className="user-admin__field user-admin__field--role">
              <label className="user-admin__label" htmlFor="ua-new-role">
                {c.adminLabelRole}
              </label>
              <select
                id="ua-new-role"
                className="user-admin__field-select"
                value={newUserRole}
                disabled={newUserBusy}
                onChange={(e) => {
                  const v = e.target.value;
                  setNewUserRole(
                    v === "admin"
                      ? "admin"
                      : v === "subscriber"
                        ? "subscriber"
                        : "user"
                  );
                }}
              >
                <option value="user">{c.adminRoleUser}</option>
                <option value="subscriber">{c.adminRoleSubscriber}</option>
                <option value="admin">{c.adminRoleAdmin}</option>
              </select>
            </div>
            <div className="user-admin__field user-admin__field--action">
              <span className="user-admin__label user-admin__label--spacer" aria-hidden>
                &nbsp;
              </span>
              <button
                type="button"
                className="user-admin-page__btn user-admin-page__btn--primary user-admin-page__btn--row"
                disabled={
                  newUserBusy ||
                  !newUserUsername.trim() ||
                  newUserPassword.length < 4
                }
                onClick={() => void submitNewUser()}
              >
                {newUserBusy ? c.adminCreating : c.adminCreateUser}
              </button>
            </div>
          </div>
        </section>

        <section
          className="user-admin-page__section"
          aria-labelledby="user-admin-list-heading"
        >
          <h2 id="user-admin-list-heading" className="user-admin-page__h2">
            {c.adminAllUsers}
          </h2>
          <div className="user-admin-page__table-scroll">
            {adminUsersLoading ? (
              <p className="user-admin__loading">{c.adminLoadingList}</p>
            ) : (
              <table className="user-admin-page__table">
                <thead>
                  <tr>
                    <th>{c.adminThInternalId}</th>
                    <th>{c.adminThNickname}</th>
                    <th>{c.adminThLoginId}</th>
                    <th>{c.adminThEmail}</th>
                    <th>{c.adminThRole}</th>
                    <th>{c.adminThResetPwd}</th>
                    <th>{c.adminThProfile}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u) => {
                    const draft = profileDrafts[u.id];
                    const dn = draft?.displayName ?? u.displayName;
                    const un = draft?.username ?? u.username;
                    const em = draft?.email ?? (u.email ?? "");
                    const busy = rowBusyId === u.id;
                    const pendingDel = Boolean(u.deletionPending);
                    return (
                      <tr key={u.id}>
                        <td
                          className="user-admin__mono user-admin-page__id-cell"
                          title={u.id}
                        >
                          {shortId(u.id)}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="user-admin-page__cell-input"
                            aria-label={c.adminAriaDisplayName(u.username)}
                            value={dn}
                            disabled={busy || pendingDel}
                            onChange={(e) =>
                              setProfileDraft(u.id, "displayName", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="user-admin-page__cell-input user-admin-page__cell-input--mono"
                            autoComplete="off"
                            aria-label={c.adminAriaLoginId(u.username)}
                            value={un}
                            disabled={busy || pendingDel}
                            onChange={(e) =>
                              setProfileDraft(u.id, "username", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="email"
                            className="user-admin-page__cell-input"
                            autoComplete="off"
                            aria-label={c.adminAriaEmail(u.username)}
                            placeholder={c.adminPhUnbound}
                            value={em}
                            disabled={busy || pendingDel}
                            onChange={(e) =>
                              setProfileDraft(u.id, "email", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="user-admin__role-select user-admin__role-select--inline"
                            value={u.role}
                            disabled={busy || pendingDel}
                            aria-label={c.adminAriaRole(u.username)}
                            onChange={(e) => {
                              const v = e.target.value;
                              void onRoleChange(
                                u,
                                v === "admin"
                                  ? "admin"
                                  : v === "subscriber"
                                    ? "subscriber"
                                    : "user"
                              );
                            }}
                          >
                            <option value="user">{c.adminRoleUser}</option>
                            <option value="subscriber">{c.adminRoleSubscriber}</option>
                            <option value="admin">{c.adminRoleAdmin}</option>
                          </select>
                        </td>
                        <td>
                          <div className="user-admin__pwd-inner">
                            <input
                              type="password"
                              className="user-admin__pwd-input user-admin-page__pwd-input"
                              autoComplete="new-password"
                              placeholder={c.adminPhNewPassword}
                              value={pwdResetByUser[u.id] ?? ""}
                              disabled={busy || pendingDel}
                              onChange={(e) =>
                                setPwdResetByUser((prev) => ({
                                  ...prev,
                                  [u.id]: e.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="user-admin__mini-btn"
                              disabled={busy || pendingDel}
                              onClick={() => void applyPasswordReset(u)}
                            >
                              {c.adminApplyPwd}
                            </button>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="user-admin__mini-btn user-admin__mini-btn--save"
                            disabled={busy || pendingDel}
                            onClick={() => void saveUserProfile(u)}
                          >
                            {c.adminSave}
                          </button>
                        </td>
                        <td>
                          {pendingDel ? (
                            <span
                              className="user-admin__deletion-pending"
                              title={
                                u.deletionRequestedAt
                                  ? u.deletionRequestedAt
                                  : undefined
                              }
                            >
                              {c.adminDeletionPending}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="user-admin__mini-btn user-admin__mini-btn--danger"
                              disabled={busy}
                              onClick={() => void onDeleteUser(u)}
                            >
                              {c.adminDelete}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
