/* global window, document */
const $ = (id) => document.getElementById(id);

async function render() {
  const session = await window.agent.session();
  const loginView = $("loginView");
  const statusView = $("statusView");
  if (!session) {
    // Signed out: show only the login card. Every signed-in panel must be
    // hidden here — including attendance, which lives in its own card.
    loginView.classList.remove("hide");
    statusView.classList.add("hide");
    $("attendance").classList.add("hide");
    $("corrections").classList.add("hide");
    $("sub").textContent = "Sign in to start activity tracking.";
    return;
  }
  loginView.classList.add("hide");
  statusView.classList.remove("hide");
  $("sub").textContent = "Your work activity is being recorded for your organization.";
  $("who").textContent = session.email;
  $("org").textContent = session.orgName;

  const s = await window.agent.status();
  const dot = s.idle ? "idle" : s.running ? "on" : "off";
  const label = s.idle ? "Idle" : s.running ? "Tracking" : "Paused";
  $("state").innerHTML = `<span class="dot ${dot}"></span>${label}`;
  $("app").textContent = s.lastApp || "—";
  $("site").textContent = s.currentSite || "— (extension not detected)";
  $("shots").textContent = !s.screenshotsEnabled ? "off" : s.lastScreenshotAt ? `last ${new Date(s.lastScreenshotAt).toLocaleTimeString()}` : "on (pending)";
  $("queued").textContent = s.queued;
  $("uploaded").textContent = s.uploadedTotal;
  $("flush").textContent = s.lastFlushAt ? new Date(s.lastFlushAt).toLocaleTimeString() : "—";
  $("toggleBtn").textContent = s.running ? "Pause tracking" : "Resume tracking";

  await renderAttendance();
}

/**
 * Attendance panel. The server is the source of truth, so this reflects a
 * check-in or break started in the web app too — the 3s refresh keeps both
 * surfaces in step without the agent holding any state of its own.
 */
async function renderAttendance() {
  const box = $("attendance");
  if (!box) return;
  const a = await window.agent.attendance();

  // Owners aren't tracked for attendance — hide both attendance and corrections.
  if (!a || !a.tracksAttendance) {
    box.classList.add("hide");
    $("corrections").classList.add("hide");
    return;
  }
  box.classList.remove("hide");
  $("corrections").classList.remove("hide");

  const STATE_LABEL = {
    NOT_CHECKED_IN: "Not checked in",
    WORKING: "Working",
    ON_BREAK: "On break",
    CHECKED_OUT: "Checked out",
    COMPLETED: "Completed",
    ON_LEAVE: "On leave",
    HOLIDAY: "Holiday",
    WEEKEND: "Weekend",
    ABSENT: "Absent",
  };
  const dot = a.state === "ON_BREAK" ? "idle" : a.state === "WORKING" ? "on" : "off";
  $("attState").innerHTML = `<span class="dot ${dot}"></span>${STATE_LABEL[a.state] || a.state}`;
  $("attIn").textContent = a.checkInAt ? new Date(a.checkInAt).toLocaleTimeString() : "—";
  $("attOut").textContent = a.checkOutAt ? new Date(a.checkOutAt).toLocaleTimeString() : "—";
  $("attBreak").textContent = `${a.breakMinutes} min`;

  // Overtime is measured but not payable until a manager signs it off. Always
  // shown (as "0h 0m" until any accrues) so the employee can see it's tracked;
  // the "pending approval" note only makes sense once there's some.
  const ot = a.overtimeMinutes || 0;
  $("attOtRow").classList.remove("hide");
  $("attOt").textContent = ot > 0
    ? `${Math.floor(ot / 60)}h ${ot % 60}m (pending approval)`
    : "0h 0m";

  // Render strictly from the server's list of valid actions, so the agent can
  // never offer something the state machine would reject.
  const actions = a.availableActions || [];
  const breakBtn = $("breakBtn");
  const punchBtn = $("punchBtn");
  const breakKind = $("breakKind");

  if (actions.includes("BREAK_END")) {
    breakBtn.classList.remove("hide");
    breakBtn.disabled = false;
    breakBtn.textContent = "End break";
    breakKind.classList.add("hide"); // kind is fixed once a break is running
  } else if (actions.includes("BREAK_START")) {
    breakBtn.classList.remove("hide");
    breakBtn.disabled = false;
    breakBtn.textContent = "Start break";
    breakKind.classList.remove("hide"); // let the person pick the kind first
  } else {
    breakBtn.classList.add("hide");
    breakKind.classList.add("hide");
  }

  if (actions.includes("CHECK_OUT")) {
    punchBtn.classList.remove("hide");
    punchBtn.disabled = false;
    punchBtn.dataset.action = "check-out";
    punchBtn.textContent = "Check out";
  } else if (actions.includes("CHECK_IN")) {
    punchBtn.classList.remove("hide");
    punchBtn.disabled = false;
    punchBtn.dataset.action = "check-in";
    punchBtn.textContent = a.sessionCount > 0 ? "Check in again" : "Check in";
  } else {
    punchBtn.classList.add("hide");
  }

  await renderCorrections();
}

const STATUS_LABEL = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", CANCELLED: "withdrawn" };
const TYPE_LABEL = {
  MISSED_CHECK_IN: "Missed check-in",
  MISSED_CHECK_OUT: "Missed check-out",
  WRONG_TIME: "Wrong time",
  OVERTIME: "Overtime",
  OTHER: "Other",
};

/**
 * The employee's correction history. The list is server truth (approvals happen
 * in the web app), so the agent only renders it and offers withdraw on pending
 * ones. "Request a fix" is disabled while a request is already awaiting a
 * decision — the backend allows one open request at a time.
 */
async function renderCorrections() {
  const list = $("corrList");
  const rows = (await window.agent.corrections()) || [];
  if (rows.length === 0) {
    list.innerHTML = `<div style="color:var(--muted); padding:8px 0;">No corrections raised.</div>`;
  } else {
    list.innerHTML = rows
      .map((c) => {
        const when = new Date(c.day).toLocaleDateString();
        const type = TYPE_LABEL[c.type] || c.type;
        const status = STATUS_LABEL[c.status] || c.status.toLowerCase();
        const canWithdraw = c.status === "PENDING";
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--line);">
          <span>${when} · ${type} <em style="color:var(--muted);">(${status})</em></span>
          ${canWithdraw ? `<button data-cancel="${c.id}" class="secondary" style="width:auto; margin:0; padding:4px 10px; font-size:12px;">Withdraw</button>` : ""}
        </div>`;
      })
      .join("");
    // Wire the withdraw buttons this render produced.
    list.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        await window.agent.cancelCorrection(btn.dataset.cancel);
        await render();
      });
    });
  }

  // "Request a fix" is blocked while one is already pending (backend rejects it too).
  const hasPending = rows.some((c) => c.status === "PENDING");
  $("corrNewBtn").disabled = hasPending;
  $("corrNewBtn").title = hasPending ? "You already have a request awaiting a decision" : "";
}

/** Show/hide the time/overtime inputs to match the chosen correction type. */
function syncCorrectionForm() {
  const type = $("corrType").value;
  const needsIn = type === "MISSED_CHECK_IN" || type === "WRONG_TIME";
  const needsOut = type === "MISSED_CHECK_OUT" || type === "WRONG_TIME";
  const needsOt = type === "OVERTIME";
  $("corrInWrap").classList.toggle("hide", !needsIn);
  $("corrOutWrap").classList.toggle("hide", !needsOut);
  $("corrOtWrap").classList.toggle("hide", !needsOt);
}

$("loginBtn").addEventListener("click", async () => {
  $("err").textContent = "";
  $("loginBtn").disabled = true;
  try {
    await window.agent.login($("email").value.trim(), $("password").value, $("remember").checked);
    await render();
  } catch (e) {
    $("err").textContent = e && e.message ? e.message : "Sign in failed.";
  } finally {
    $("loginBtn").disabled = false;
  }
});

$("toggleBtn").addEventListener("click", async () => {
  const s = await window.agent.status();
  if (s.running) await window.agent.stop();
  else await window.agent.start();
  await render();
});

$("breakBtn").addEventListener("click", async () => {
  const btn = $("breakBtn");
  btn.disabled = true;
  try {
    const a = await window.agent.attendance();
    if (a && (a.availableActions || []).includes("BREAK_END")) await window.agent.breakEnd();
    else await window.agent.breakStart($("breakKind").value || "BREAK");
    await render();
  } finally {
    btn.disabled = false;
  }
});

// Manual check in / out from the agent. Which one it is comes from the state.
$("punchBtn").addEventListener("click", async () => {
  const btn = $("punchBtn");
  const action = btn.dataset.action;
  btn.disabled = true;
  try {
    if (action === "check-out") await window.agent.checkOut();
    else await window.agent.checkIn();
    await render();
  } finally {
    btn.disabled = false;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  const btn = $("logoutBtn");
  btn.disabled = true;
  btn.textContent = "Signing out…";
  try {
    // Hide signed-in panels immediately: sign-out also checks the user out, so
    // leaving stale attendance on screen while that lands is misleading.
    $("statusView").classList.add("hide");
    $("attendance").classList.add("hide");
    $("corrections").classList.add("hide");
    await window.agent.logout();
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign out";
    await render();
  }
});

// ---- corrections form ----
$("corrNewBtn").addEventListener("click", () => {
  $("corrDay").max = new Date().toISOString().slice(0, 10);
  $("corrDay").value = new Date().toISOString().slice(0, 10);
  $("corrErr").textContent = "";
  syncCorrectionForm();
  $("corrForm").classList.remove("hide");
});
$("corrCancel").addEventListener("click", () => $("corrForm").classList.add("hide"));
$("corrType").addEventListener("change", syncCorrectionForm);

$("corrSubmit").addEventListener("click", async () => {
  const type = $("corrType").value;
  const day = $("corrDay").value;
  const reason = $("corrReason").value.trim();
  const err = $("corrErr");
  if (reason.length < 3) { err.textContent = "Please give a brief reason (at least 3 characters)."; return; }

  // Build the payload to match the type — a time input is a local wall-clock on
  // the chosen day, sent as an ISO instant, mirroring the web app.
  const isoFor = (hhmm) => (hhmm ? new Date(`${day}T${hhmm}:00`).toISOString() : undefined);
  const body = { day, type, reason };
  if (type === "MISSED_CHECK_IN" || type === "WRONG_TIME") body.checkInAt = isoFor($("corrIn").value);
  if (type === "MISSED_CHECK_OUT" || type === "WRONG_TIME") body.checkOutAt = isoFor($("corrOut").value);
  if (type === "OVERTIME") body.overtimeMinutes = Number($("corrOt").value) || undefined;

  const btn = $("corrSubmit");
  btn.disabled = true;
  err.textContent = "";
  try {
    const problem = await window.agent.requestCorrection(body);
    if (problem) { err.textContent = problem; return; }
    $("corrForm").classList.add("hide");
    $("corrReason").value = "";
    await render();
  } finally {
    btn.disabled = false;
  }
});

// Exposed so the headless flow test can drive a render directly.
globalThis.__render = render;

render();

// Live-sync is the primary signal: the main process pushes "attendance changed"
// off the SSE stream and we refresh at once. The interval is now just a slow
// fallback for when the stream is down, not the main heartbeat.
if (window.agent.onAttendanceChanged) window.agent.onAttendanceChanged(render);
setInterval(render, 15000);
