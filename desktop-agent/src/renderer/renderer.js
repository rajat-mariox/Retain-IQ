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

  // Owners aren't tracked for attendance — hide the panel entirely.
  if (!a || !a.tracksAttendance) {
    box.classList.add("hide");
    return;
  }
  box.classList.remove("hide");

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

  // Overtime is measured but not payable until a manager signs it off, so show
  // it read-only and say so. Only surface it once there's any to show.
  const ot = a.overtimeMinutes || 0;
  if (ot > 0) {
    $("attOtRow").classList.remove("hide");
    $("attOt").textContent = `${Math.floor(ot / 60)}h ${ot % 60}m (pending approval)`;
  } else {
    $("attOtRow").classList.add("hide");
  }

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
    await window.agent.logout();
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign out";
    await render();
  }
});

// Exposed so the headless flow test can drive a render directly.
globalThis.__render = render;

render();
setInterval(render, 3000);
