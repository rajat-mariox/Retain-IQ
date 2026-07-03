/* global window, document */
const $ = (id) => document.getElementById(id);

async function render() {
  const session = await window.agent.session();
  const loginView = $("loginView");
  const statusView = $("statusView");
  if (!session) {
    loginView.classList.remove("hide");
    statusView.classList.add("hide");
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

$("logoutBtn").addEventListener("click", async () => {
  await window.agent.logout();
  await render();
});

render();
setInterval(render, 3000);
