import { createPortal } from "react-dom";
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

  if (!open) return null;

  return createPortal(
    <div className="user-admin-page" role="document">
      <header className="user-admin-page__header">
        <button
          type="button"
          className="user-admin-page__back"
          onClick={onClose}
        >
          ← 返回笔记
        </button>
        <h1 className="user-admin-page__title" id="user-admin-page-title">
          用户管理
        </h1>
      </header>
      <div className="user-admin-page__body">
        <p className="user-admin-page__lead">
          新建账号、修改昵称与登录 ID、绑定邮箱、调整身份或重置口令。删除后该用户的笔记与附件将一并清理（不可恢复）。
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
            新建用户
          </h2>
          <div className="user-admin__fields user-admin__fields--row">
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-username">
                登录 ID
              </label>
              <input
                id="ua-new-username"
                type="text"
                className="user-admin__field-input"
                autoComplete="off"
                placeholder="2–32 位字母、数字或下划线"
                value={newUserUsername}
                disabled={newUserBusy}
                onChange={(e) => setNewUserUsername(e.target.value)}
              />
            </div>
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-password">
                初始密码
              </label>
              <input
                id="ua-new-password"
                type="password"
                className="user-admin__field-input"
                autoComplete="new-password"
                placeholder="至少 4 位"
                value={newUserPassword}
                disabled={newUserBusy}
                onChange={(e) => setNewUserPassword(e.target.value)}
              />
            </div>
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-display">
                显示昵称
              </label>
              <input
                id="ua-new-display"
                type="text"
                className="user-admin__field-input"
                autoComplete="off"
                placeholder="侧栏与笔记旁显示；不填则用登录 ID"
                value={newUserDisplayName}
                disabled={newUserBusy}
                onChange={(e) => setNewUserDisplayName(e.target.value)}
              />
            </div>
            <div className="user-admin__field">
              <label className="user-admin__label" htmlFor="ua-new-email">
                邮箱（可选）
              </label>
              <input
                id="ua-new-email"
                type="email"
                className="user-admin__field-input"
                autoComplete="off"
                placeholder="绑定后可用邮箱登录"
                value={newUserEmail}
                disabled={newUserBusy}
                onChange={(e) => setNewUserEmail(e.target.value)}
              />
            </div>
            <div className="user-admin__field user-admin__field--role">
              <label className="user-admin__label" htmlFor="ua-new-role">
                身份
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
                <option value="user">住民（普通）</option>
                <option value="subscriber">订阅</option>
                <option value="admin">站长</option>
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
                {newUserBusy ? "创建中…" : "创建用户"}
              </button>
            </div>
          </div>
        </section>

        <section
          className="user-admin-page__section"
          aria-labelledby="user-admin-list-heading"
        >
          <h2 id="user-admin-list-heading" className="user-admin-page__h2">
            全部用户
          </h2>
          <div className="user-admin-page__table-scroll">
            {adminUsersLoading ? (
              <p className="user-admin__loading">名单加载中…</p>
            ) : (
              <table className="user-admin-page__table">
                <thead>
                  <tr>
                    <th>内部 ID</th>
                    <th>昵称</th>
                    <th>登录 ID</th>
                    <th>邮箱</th>
                    <th>身份</th>
                    <th>重置口令</th>
                    <th>资料</th>
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
                            aria-label={`${u.username} 的昵称`}
                            value={dn}
                            disabled={busy}
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
                            aria-label={`${u.username} 的登录 ID`}
                            value={un}
                            disabled={busy}
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
                            aria-label={`${u.username} 的邮箱`}
                            placeholder="未绑定"
                            value={em}
                            disabled={busy}
                            onChange={(e) =>
                              setProfileDraft(u.id, "email", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="user-admin__role-select user-admin__role-select--inline"
                            value={u.role}
                            disabled={busy}
                            aria-label={`${u.username} 的身份`}
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
                            <option value="user">住民（普通）</option>
                            <option value="subscriber">订阅</option>
                            <option value="admin">站长</option>
                          </select>
                        </td>
                        <td>
                          <div className="user-admin__pwd-inner">
                            <input
                              type="password"
                              className="user-admin__pwd-input user-admin-page__pwd-input"
                              autoComplete="new-password"
                              placeholder="新口令"
                              value={pwdResetByUser[u.id] ?? ""}
                              disabled={busy}
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
                              disabled={busy}
                              onClick={() => void applyPasswordReset(u)}
                            >
                              生效
                            </button>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="user-admin__mini-btn user-admin__mini-btn--save"
                            disabled={busy}
                            onClick={() => void saveUserProfile(u)}
                          >
                            保存
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="user-admin__mini-btn user-admin__mini-btn--danger"
                            disabled={busy}
                            onClick={() => void onDeleteUser(u)}
                          >
                            删除
                          </button>
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
