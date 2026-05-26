// Scenario 3: Offline-first comment editor.
// Requirements:
// - Type 500 chars OFFLINE -> save to localStorage, no errors
// - Go ONLINE -> server sync fires automatically
// - Server returns 409 conflict -> handle (show warning at minimum)
//
// This scenario isolates the conflict-resolution and online-flush story.

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import useFormPersist from "react-hook-form-persist";

type CommentForm = { title: string; body: string };
const DEFAULTS: CommentForm = { title: "", body: "" };
const KEY = "comment-draft-v1";
const SERVER_VERSION_KEY = "comment-server-version";

export default function CommentEditor() {
  const { register, handleSubmit, watch, setValue, control } =
    useForm<CommentForm>({ defaultValues: DEFAULTS });

  useFormPersist(KEY, { watch, setValue, storage: window.localStorage });

  const values = useWatch({ control });
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "offline" | "conflict">("idle");
  const [serverConflict, setServerConflict] = useState<CommentForm | null>(null);

  // GOTCHA: navigator.onLine is famously unreliable — it can return true
  // when the device is connected to a network with no internet (captive
  // portal, airplane wifi). For real apps we'd need a heartbeat ping.
  // No library in our stack provides that.
  useEffect(() => {
    const on = () => { setOnline(true); flushIfPending(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // GOTCHA: react-hook-form-persist saves on every change but only
  // when the form is mounted. If user types offline -> hides tab ->
  // comes back online while the tab is in background, the "online"
  // event STILL fires (good), but if the tab is suspended (memory
  // pressure on mobile Safari) we miss the event entirely. There's
  // no resume-on-visibility recovery built in. We have to add a
  // visibilitychange listener that also tries to flush.
  useEffect(() => {
    const vis = () => { if (document.visibilityState === "visible") flushIfPending(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  const pendingRef = useRef<CommentForm | null>(null);

  // Mock server with optimistic concurrency
  const postToServer = async (data: CommentForm): Promise<void> => {
    // Pretend we read an If-Match: <version> header.
    const localVersion = Number(localStorage.getItem(SERVER_VERSION_KEY) ?? "0");
    const serverVersion = Number(localStorage.getItem("__mock_server_version__") ?? "0");
    if (localVersion < serverVersion) {
      const err: any = new Error("conflict");
      err.status = 409;
      err.serverState = JSON.parse(localStorage.getItem("__mock_server_state__") ?? "null");
      throw err;
    }
    // Pretend success
    const next = serverVersion + 1;
    localStorage.setItem("__mock_server_version__", String(next));
    localStorage.setItem(SERVER_VERSION_KEY, String(next));
    localStorage.setItem("__mock_server_state__", JSON.stringify(data));
    void data;
  };

  const flushIfPending = async () => {
    const pending = pendingRef.current ?? JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!pending) return;
    setStatus("saving");
    try {
      await postToServer(pending);
      setStatus("saved");
      pendingRef.current = null;
    } catch (e: any) {
      if (e.status === 409) {
        // GOTCHA: We have a conflict — server version differs. None of
        // our libraries help merge. We must:
        //  (1) preserve local state (don't blow it away),
        //  (2) surface server state to user,
        //  (3) let user choose: keep mine / take theirs / merge by field.
        // This is the single biggest hand-rolled chunk.
        setServerConflict(e.serverState);
        setStatus("conflict");
      } else {
        setStatus("offline");
      }
    }
  };

  // Auto-save on values change (when online)
  useEffect(() => {
    if (!online) { setStatus("offline"); pendingRef.current = values as CommentForm; return; }
    pendingRef.current = values as CommentForm;
    // GOTCHA: no debounce primitive in react-hook-form-persist; if
    // we want "save 500ms after last keystroke" we have to bring our
    // own setTimeout-based debounce. Adding 5-10 LOC every time.
    const t = setTimeout(() => flushIfPending(), 500);
    return () => clearTimeout(t);
  }, [values, online]);

  const onSubmit = handleSubmit(async (data) => {
    await postToServer(data);
    localStorage.removeItem(KEY);
  });

  return (
    <form onSubmit={onSubmit}>
      <div>Online: {String(online)} — Status: {status}</div>
      <input {...register("title")} placeholder="Title" />
      <textarea {...register("body")} rows={10} placeholder="Body" />
      {serverConflict && (
        <div role="alert">
          <strong>Conflict:</strong> The server has a newer version.
          <pre>Server: {JSON.stringify(serverConflict, null, 2)}</pre>
          <pre>Yours:  {JSON.stringify(values, null, 2)}</pre>
          <button type="button" onClick={() => {
            // "Keep mine" — bump local version and retry.
            const sv = Number(localStorage.getItem("__mock_server_version__") ?? "0");
            localStorage.setItem(SERVER_VERSION_KEY, String(sv));
            setServerConflict(null);
            flushIfPending();
          }}>Keep mine</button>
          <button type="button" onClick={() => {
            // "Take theirs" — replace form with server state.
            if (serverConflict) {
              setValue("title", serverConflict.title);
              setValue("body", serverConflict.body);
            }
            setServerConflict(null);
          }}>Take theirs</button>
        </div>
      )}
      <button type="submit">Submit</button>
    </form>
  );
}
