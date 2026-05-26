// Scenario 1: 5-step signup wizard
// Requirements:
// - Refresh mid-step-3 -> resume on step 3 with all prior data
// - Browser back -> previous step + data intact
// - Submit success -> draft cleared
//
// Stack: react-hook-form + react-hook-form-persist + localStorage
// Step state managed via URL query param so browser back works.

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import useFormPersist from "react-hook-form-persist";
import { useSearchParams, useNavigate } from "react-router-dom";

type SignupForm = {
  email: string;
  password: string;
  name: string;
  bio: string;
  prefs: { news: boolean; promos: boolean; tips: boolean };
  notify: "email" | "sms" | "none";
};

const DEFAULT: SignupForm = {
  email: "",
  password: "",
  name: "",
  bio: "",
  prefs: { news: false, promos: false, tips: false },
  notify: "email",
};

export default function SignupWizard() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const step = Number(params.get("step") ?? "1");

  const { register, handleSubmit, watch, setValue, control, getValues } =
    useForm<SignupForm>({ defaultValues: DEFAULT });

  // GOTCHA #1: react-hook-form-persist uses watch() under the hood — every
  // keystroke triggers a re-render of the entire form AND a localStorage
  // write. No debounce. No throttle. For a 20-field form (Scenario 2) this
  // is a perf footgun.
  useFormPersist("signup-draft-v1", {
    watch,
    setValue,
    storage: window.localStorage,
    exclude: ["password"], // sensible default to omit, but we have to remember
  });

  // GOTCHA #2: react-hook-form-persist does NOT persist the current step.
  // We have to manage that ourselves. If we put it in URL, browser back
  // works for free — but then it's not in localStorage, so closing the tab
  // mid-wizard loses the step (data persists, position doesn't).
  // To get BOTH (refresh restores step AND browser back works) we have to
  // sync URL <-> localStorage manually.
  useEffect(() => {
    const saved = localStorage.getItem("signup-step");
    if (saved && !params.get("step")) {
      setParams({ step: saved }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem("signup-step", String(step));
  }, [step]);

  // GOTCHA #3: We want to show "Draft saved 3s ago" status. The persist
  // library writes silently — no callback, no event, no return value.
  // To know when a save happened we have to subscribe to watch() AGAIN
  // (duplicate work) and timestamp manually.
  const allValues = useWatch({ control });
  useEffect(() => {
    localStorage.setItem("signup-draft-savedAt", String(Date.now()));
  }, [allValues]);

  const next = () => setParams({ step: String(step + 1) });
  const prev = () => setParams({ step: String(step - 1) });

  const onSubmit = async (data: SignupForm) => {
    // Pretend server call
    await new Promise((r) => setTimeout(r, 300));
    // GOTCHA #4: There is NO documented "clear" helper. The library
    // exposes nothing. We reach into localStorage directly with the
    // same key we passed in. If we ever rename the key, this breaks
    // silently — submit succeeds but draft never clears.
    localStorage.removeItem("signup-draft-v1");
    localStorage.removeItem("signup-step");
    localStorage.removeItem("signup-draft-savedAt");
    navigate("/done");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h2>Signup — Step {step}/5</h2>
      {step === 1 && (
        <>
          <input {...register("email")} placeholder="email" />
          <input {...register("password")} placeholder="password" type="password" />
        </>
      )}
      {step === 2 && (
        <>
          <input {...register("name")} placeholder="name" />
          <textarea {...register("bio")} placeholder="bio" />
        </>
      )}
      {step === 3 && (
        <>
          <label><input type="checkbox" {...register("prefs.news")} /> News</label>
          <label><input type="checkbox" {...register("prefs.promos")} /> Promos</label>
          <label><input type="checkbox" {...register("prefs.tips")} /> Tips</label>
        </>
      )}
      {step === 4 && (
        <>
          <label><input type="radio" value="email" {...register("notify")} /> Email</label>
          <label><input type="radio" value="sms" {...register("notify")} /> SMS</label>
          <label><input type="radio" value="none" {...register("notify")} /> None</label>
        </>
      )}
      {step === 5 && (
        <pre>{JSON.stringify(getValues(), null, 2)}</pre>
      )}

      {step > 1 && <button type="button" onClick={prev}>Back</button>}
      {step < 5 && <button type="button" onClick={next}>Next</button>}
      {step === 5 && <button type="submit">Submit</button>}
    </form>
  );
}
