import { useEffect, useState } from "react";
import auth from "../lib/auth";
import { AnimatePresence, motion } from "framer-motion";

export default function AuthControl() {
  const [userId, setUserId] = useState<string | null>(() => auth.getCurrentUser());
  const [username, setUsername] = useState<string>(() => auth.getUsername() || "");
  const [open, setOpen] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    return auth.onAuthChange((u, name) => {
      setUserId(u);
      setUsername(name || "");
    });
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("tm_show_auth", handler);
    return () => window.removeEventListener("tm_show_auth", handler);
  }, []);

  const doRegister = async () => {
    setMsg(null);
    if (!usernameInput.trim()) {
      setMsg("Username required");
      return;
    }
    const r = await auth.register(usernameInput.trim(), password);
    if (!r.success) setMsg(r.error ?? "Register failed");
    else {
      setMsg("Registered — signed in");
      setUsernameInput("");
      setPassword("");
      setOpen(false);
    }
  };

  const doLogin = async () => {
    setMsg(null);
    const r = await auth.login(password);
    if (!r.success) setMsg(r.error ?? "Login failed");
    else {
      setMsg("Signed in");
      setPassword("");
      setOpen(false);
    }
  };

  const doLogout = () => {
    auth.logout();
    setMsg("Signed out");
  };

  return (
    <div className="flex items-center gap-2">
      {userId ? (
        <div className="flex items-center gap-2">
          <div className="text-[12px] text-zinc-300">{username || userId?.slice(0, 6) || "User"}</div>
          <button
            onClick={doLogout}
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
          >
            Logout
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
        >
          Sign in / Register
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="w-[92vw] max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
              initial={{ scale: 0.98, y: 8, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, y: 8, opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 text-sm font-semibold text-zinc-100">Sign in or Register</div>
              <div className="text-xs text-zinc-400 mb-3">Enter a username and password.</div>

              <input
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-100 outline-none mb-2"
                placeholder="Username"
                type="text"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-100 outline-none"
                placeholder="Password"
                type="password"
              />

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={doLogin}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
                >
                  Sign in
                </button>
                <button
                  onClick={doRegister}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-950"
                >
                  Register
                </button>
                <div className="text-xs text-zinc-400">or press Enter</div>
              </div>

              {msg ? <div className="mt-3 text-sm text-zinc-300">{msg}</div> : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
