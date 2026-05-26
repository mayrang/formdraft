// Scenario 2: 20-field profile settings with offline-retry and multi-tab.
// Requirements:
// - Half-fill -> close tab -> reopen -> all there  (covered by persist)
// - Server save fails -> retry queued for online  (NOT covered)
// - Multi-tab edit -> warning or sync  (NOT covered)
//
// Stack: react-hook-form + react-hook-form-persist + localforage (IndexedDB)
//        + BroadcastChannel + online/offline events
//
// This file is where the gaps explode. The persist library gets us ~30%
// of the way; everything else is hand-rolled.

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import useFormPersist from "react-hook-form-persist";
import localforage from "localforage";

type ProfileForm = {
  // Personal (8)
  firstName: string; lastName: string; displayName: string; pronouns: string;
  birthday: string; phone: string; country: string; city: string;
  // Account (7)
  username: string; email: string; website: string; company: string;
  jobTitle: string; bio: string; timezone: string;
  // Notifications (5)
  emailDigest: "daily" | "weekly" | "never";
  pushEnabled: boolean; smsEnabled: boolean;
  marketingOptIn: boolean; productUpdates: boolean;
};

const DEFAULTS: ProfileForm = {
  firstName: "", lastName: "", displayName: "", pronouns: "",
  birthday: "", phone: "", country: "", city: "",
  username: "", email: "", website: "", company: "",
  jobTitle: "", bio: "", timezone: "",
  emailDigest: "weekly", pushEnabled: true, smsEnabled: false,
  marketingOptIn: false, productUpdates: true,
};

const KEY = "profile-draft-v1";
const QUEUE_KEY = "profile-pending-saves";
const BC_NAME = "profile-channel";

// ---- Offline retry queue (hand-rolled — no library covers this) ----
type QueuedSave = { id: string; payload: ProfileForm; tryCount: number; at: number };

async function enqueueSave(payload: ProfileForm) {
  const queue = (await localforage.getItem<QueuedSave[]>(QUEUE_KEY)) ?? [];
  queue.push({ id: crypto.randomUUID(), payload, tryCount: 0, at: Date.now() });
  await localforage.setItem(QUEUE_KEY, queue);
}

async function flushQueue(send: (p: ProfileForm) => Promise<void>) {
  const queue = (await localforage.getItem<QueuedSave[]>(QUEUE_KEY)) ?? [];
  const remaining: QueuedSave[] = [];
  for (const item of queue) {
    try {
      await send(item.payload);
    } catch {
      // GOTCHA: no exponential backoff, no max retries unless we add them.
      remaining.push({ ...item, tryCount: item.tryCount + 1 });
    }
  }
  await localforage.setItem(QUEUE_KEY, remaining);
}

// ---- Multi-tab coordination (hand-rolled) ----
// GOTCHA: BroadcastChannel exists on all modern browsers, but:
// - Safari < 15.4 needs polyfill.
// - structuredClone of File / Blob works; but Date objects come through
//   as Date — fine. Maps/Sets fine. Class instances LOSE prototype.
// - No "last writer wins" or merge semantics. We have to design that.
// - No cross-tab "lock" primitive — Web Locks API exists but is separate.

export default function ProfileSettings() {
  const { register, handleSubmit, watch, setValue, control, reset, getValues } =
    useForm<ProfileForm>({ defaultValues: DEFAULTS });

  // GOTCHA: react-hook-form-persist uses synchronous storage interface
  // (getItem/setItem return strings, not promises). localforage is
  // PROMISE-based. They are incompatible. To use IndexedDB we either:
  //   (a) write a sync-looking adapter that schedules async writes
  //       in the background (loses durability guarantee), or
  //   (b) skip the library and hand-roll persist.
  // Here we accept (a) with localStorage and ADD localforage as a
  // secondary async mirror — duplicating storage. Ugly.
  useFormPersist(KEY, {
    watch,
    setValue,
    storage: window.localStorage,
  });

  // Async mirror to IndexedDB (so >5MB drafts survive Safari's quota)
  const values = useWatch({ control });
  useEffect(() => {
    localforage.setItem(KEY, values).catch(() => {});
  }, [values]);

  // ---- Status UI ----
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "offline" | "error">("idle");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => { setOnline(true); flushQueue(saveToServer).then(() => setStatus("saved")); };
    const off = () => { setOnline(false); setStatus("offline"); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ---- Multi-tab ----
  // Strategy: broadcast every change; if THIS tab receives a change it
  // didn't make, show a warning. Generating a tab id manually.
  const tabId = useRef(crypto.randomUUID());
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (e) => {
      if (e.data.tabId === tabId.current) return;
      // Another tab edited. Compare timestamps.
      // GOTCHA: We have no causality info — just "another tab changed
      // something." We can't tell if it was a deliberate edit or just
      // a focus event. There is no semantic of "field-level conflict";
      // we'd have to diff the whole form.
      setConflict(true);
    };
    return () => bc.close();
  }, []);

  // Broadcast every change. This fires on EVERY keystroke across 20 fields.
  // GOTCHA: BroadcastChannel.postMessage costs ~30-100us; on a slow laptop
  // with 20 fields and a fast typist this is fine, but with rich content
  // (e.g. base64 image previews in a field) it gets heavy. No batching
  // primitive exists in the platform — we'd have to debounce ourselves.
  useEffect(() => {
    const bc = new BroadcastChannel(BC_NAME);
    bc.postMessage({ tabId: tabId.current, values, at: Date.now() });
    bc.close();
  }, [values]);

  // ---- Server save (mock) ----
  const saveToServer = async (data: ProfileForm) => {
    // Simulate failure on alternating calls
    if (Math.random() < 0.4) throw new Error("network");
    await new Promise((r) => setTimeout(r, 200));
    void data;
  };

  const onSubmit = async (data: ProfileForm) => {
    setStatus("saving");
    if (!navigator.onLine) {
      await enqueueSave(data);
      setStatus("offline");
      return;
    }
    try {
      await saveToServer(data);
      setStatus("saved");
      // GOTCHA: still have to manually clear both stores
      localStorage.removeItem(KEY);
      await localforage.removeItem(KEY);
    } catch {
      // GOTCHA: react-hook-form-persist gives no way to "mark dirty
      // until acked by server." Our local draft still says "saved"
      // but server doesn't know. We have to manage that flag ourselves.
      await enqueueSave(data);
      setStatus("error");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>Status: {status} ({online ? "online" : "offline"})</div>
      {conflict && (
        <div role="alert">
          Another tab edited this draft. <button type="button" onClick={() => {
            // GOTCHA: To "merge" we'd need to know which fields differ.
            // We'd have to diff `values` vs the broadcast payload —
            // O(n) per field, and resolving conflicts means showing
            // a diff UI per field. None of this exists. Skipped.
            setConflict(false);
          }}>Dismiss</button>
        </div>
      )}

      <fieldset><legend>Personal</legend>
        <input {...register("firstName")} placeholder="First" />
        <input {...register("lastName")} placeholder="Last" />
        <input {...register("displayName")} placeholder="Display" />
        <input {...register("pronouns")} placeholder="Pronouns" />
        <input {...register("birthday")} type="date" />
        <input {...register("phone")} placeholder="Phone" />
        <input {...register("country")} placeholder="Country" />
        <input {...register("city")} placeholder="City" />
      </fieldset>

      <fieldset><legend>Account</legend>
        <input {...register("username")} placeholder="Username" />
        <input {...register("email")} placeholder="Email" />
        <input {...register("website")} placeholder="Website" />
        <input {...register("company")} placeholder="Company" />
        <input {...register("jobTitle")} placeholder="Job title" />
        <textarea {...register("bio")} placeholder="Bio" />
        <input {...register("timezone")} placeholder="Timezone" />
      </fieldset>

      <fieldset><legend>Notifications</legend>
        <select {...register("emailDigest")}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="never">Never</option>
        </select>
        <label><input type="checkbox" {...register("pushEnabled")} /> Push</label>
        <label><input type="checkbox" {...register("smsEnabled")} /> SMS</label>
        <label><input type="checkbox" {...register("marketingOptIn")} /> Marketing</label>
        <label><input type="checkbox" {...register("productUpdates")} /> Product</label>
      </fieldset>

      <button type="submit">Save</button>
      <button type="button" onClick={() => {
        reset(DEFAULTS);
        localStorage.removeItem(KEY);
        localforage.removeItem(KEY);
      }}>Discard draft</button>
    </form>
  );
}
