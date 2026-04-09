import { useCallback, useEffect, useState } from "react";
import {
  createUserApi,
  deleteUserApi,
  fetchUsersList,
  updateUserApi,
  type PublicUser,
} from "../api/users";

type Role = "admin" | "user" | "subscriber";

export type ProfileDraft = {
  displayName: string;
  username: string;
  email: string;
};

/**
 * 站长：拉名单、新建用户、改资料/角色/口令、删除用户（含删自己时登出）。
 */
export function useUserAdmin(p: {
  isAdmin: boolean;
  currentUserId: string | undefined;
  logout: () => void;
  refreshMe: () => Promise<void>;
}) {
  const { isAdmin, currentUserId, logout, refreshMe } = p;

  const [userAdminOpen, setUserAdminOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<PublicUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersErr, setAdminUsersErr] = useState<string | null>(null);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("user");
  const [newUserBusy, setNewUserBusy] = useState(false);
  const [userAdminFormErr, setUserAdminFormErr] = useState<string | null>(
    null
  );
  const [pwdResetByUser, setPwdResetByUser] = useState<Record<string, string>>(
    {}
  );
  const [profileDrafts, setProfileDrafts] = useState<
    Record<string, ProfileDraft>
  >({});
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!userAdminOpen || !isAdmin) return;
    let cancelled = false;
    setAdminUsersLoading(true);
    setAdminUsersErr(null);
    void fetchUsersList()
      .then((list) => {
        if (!cancelled) setAdminUsers(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAdminUsersErr(
            e instanceof Error ? e.message : "小伙伴名单没拉出来…"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAdminUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userAdminOpen, isAdmin]);

  useEffect(() => {
    if (!userAdminOpen || !isAdmin) return;
    setProfileDrafts(() => {
      const next: Record<string, ProfileDraft> = {};
      for (const u of adminUsers) {
        next[u.id] = {
          displayName: u.displayName,
          username: u.username,
          email: (u.email ?? "").trim(),
        };
      }
      return next;
    });
  }, [adminUsers, userAdminOpen, isAdmin]);

  useEffect(() => {
    if (!userAdminOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserAdminOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userAdminOpen]);

  const reloadAdminUsers = useCallback(async () => {
    try {
      const list = await fetchUsersList();
      setAdminUsers(list);
      setAdminUsersErr(null);
    } catch (e: unknown) {
      setAdminUsersErr(
        e instanceof Error ? e.message : "小伙伴名单没拉出来…"
      );
    }
  }, []);

  const setProfileDraft = useCallback(
    (id: string, field: keyof ProfileDraft, value: string) => {
      setProfileDrafts((prev) => {
        const base: ProfileDraft =
          prev[id] ?? { displayName: "", username: "", email: "" };
        return {
          ...prev,
          [id]: { ...base, [field]: value },
        };
      });
    },
    []
  );

  const submitNewUser = useCallback(async () => {
    setUserAdminFormErr(null);
    const u = newUserUsername.trim();
    const pw = newUserPassword;
    if (!u || !pw) {
      setUserAdminFormErr("用户名和密码都要填好噢");
      return;
    }
    setNewUserBusy(true);
    try {
      const email = newUserEmail.trim();
      await createUserApi({
        username: u,
        password: pw,
        displayName: newUserDisplayName.trim() || u,
        role: newUserRole,
        ...(email ? { email } : {}),
      });
      setNewUserUsername("");
      setNewUserPassword("");
      setNewUserDisplayName("");
      setNewUserEmail("");
      setNewUserRole("user");
      await reloadAdminUsers();
    } catch (e: unknown) {
      setUserAdminFormErr(
        e instanceof Error ? e.message : "拉新失败惹，看看报错？"
      );
    } finally {
      setNewUserBusy(false);
    }
  }, [
    newUserUsername,
    newUserPassword,
    newUserDisplayName,
    newUserEmail,
    newUserRole,
    reloadAdminUsers,
  ]);

  const saveUserProfile = useCallback(
    async (u: PublicUser) => {
      const d = profileDrafts[u.id];
      if (!d) return;
      const body: Partial<{
        displayName: string;
        username: string;
        email: string | null;
      }> = {};
      if (d.displayName.trim() !== u.displayName) {
        body.displayName = d.displayName.trim();
      }
      if (d.username.trim() !== u.username) {
        body.username = d.username.trim();
      }
      const prevEmail = (u.email ?? "").trim();
      if (d.email.trim() !== prevEmail) {
        body.email = d.email.trim() ? d.email.trim() : null;
      }
      if (Object.keys(body).length === 0) {
        setUserAdminFormErr("资料没有改动");
        return;
      }
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await updateUserApi(u.id, body);
        await reloadAdminUsers();
        if (currentUserId === u.id) await refreshMe();
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "保存资料失败惹…"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [profileDrafts, currentUserId, refreshMe, reloadAdminUsers]
  );

  const onDeleteUser = useCallback(
    async (u: PublicUser) => {
      if (!window.confirm(`要把用户「${u.username}」请出群吗？（删除不可撤销）`))
        return;
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await deleteUserApi(u.id);
        if (currentUserId === u.id) {
          logout();
          setUserAdminOpen(false);
        } else {
          await reloadAdminUsers();
        }
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "送走失败惹…"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [currentUserId, logout, reloadAdminUsers]
  );

  const onRoleChange = useCallback(
    async (u: PublicUser, role: Role) => {
      if (u.role === role) return;
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await updateUserApi(u.id, { role });
        await reloadAdminUsers();
        if (currentUserId === u.id) await refreshMe();
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "改身份失败惹…"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [currentUserId, refreshMe, reloadAdminUsers]
  );

  const applyPasswordReset = useCallback(
    async (u: PublicUser) => {
      const pwd = (pwdResetByUser[u.id] ?? "").trim();
      if (pwd.length < 4) {
        setUserAdminFormErr("新口令至少 4 位啦");
        return;
      }
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await updateUserApi(u.id, { password: pwd });
        setPwdResetByUser((prev) => ({ ...prev, [u.id]: "" }));
        setUserAdminFormErr(null);
        await reloadAdminUsers();
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "换口令失败惹…"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [pwdResetByUser, reloadAdminUsers]
  );

  return {
    userAdminOpen,
    setUserAdminOpen,
    adminUsers,
    adminUsersLoading,
    adminUsersErr,
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
    userAdminFormErr,
    pwdResetByUser,
    setPwdResetByUser,
    profileDrafts,
    setProfileDraft,
    saveUserProfile,
    rowBusyId,
    submitNewUser,
    onDeleteUser,
    onRoleChange,
    applyPasswordReset,
  };
}
