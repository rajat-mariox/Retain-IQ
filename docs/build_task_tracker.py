"""Generate RetainIQ project task tracker (.xlsx).

Scope: derived from the codebase AND the planning docs
(docs/architecture/06-implementation-roadmap.md, docs/featureDocs/*, READMEs).
So the sheet shows the FULL intended product surface — built or not:
  Completed   -> shipped (has backend + UI, commit in history)
  In Progress -> scaffolded / partial (module or worker exists, not feature-complete)
  Not Started -> defined in docs/roadmap, no implementation yet

Columns: Task | Sub-task | Backend/Frontend | Status
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

C, P, N = "Completed", "In Progress", "Not Started"

# Each row: (Task, Sub-task, Layer, Status)
# Layer: Backend | Frontend | Full-stack | Infra | Desktop
rows = [
    # ---------------------------------------------------------------- Platform Foundation
    ("Platform Foundation", "Microservices monorepo scaffold (backend/ + frontend/ workspaces)", "Full-stack", C),
    ("Platform Foundation", "Shared packages (authz, config, contracts, database, messaging, observability, platform)", "Backend", C),
    ("Platform Foundation", "Database-per-service (identity/billing/analytics/notifications DBs, 5432-5435)", "Backend", C),
    ("Platform Foundation", "Pluggable event broker (Kafka + Redis Streams drivers, DLQ, idempotent consumers)", "Backend", C),
    ("Platform Foundation", "Transactional outbox + relay", "Backend", C),
    ("Platform Foundation", "event-processor consumer-group worker (idempotent inbox)", "Backend", C),
    ("Platform Foundation", "Local dev orchestration (npm run up / up:redis, auto-migrations)", "Infra", C),
    ("Platform Foundation", "Terraform infrastructure (main.tf, variables)", "Infra", C),
    ("Platform Foundation", "Kubernetes manifests (HPA, PDB, KEDA lag autoscaling, probes)", "Infra", C),
    ("Platform Foundation", "Observability stack (Prometheus, Grafana, Loki, /metrics)", "Infra", C),
    ("Platform Foundation", "CI/CD workflows (ci.yml, deploy.yml)", "Infra", C),
    ("Platform Foundation", "ClickHouse analytics store (roadmap Phase 2)", "Infra", N),
    ("Platform Foundation", "Schema registry / contract-validation strategy (roadmap Phase 3)", "Backend", N),

    # ---------------------------------------------------------------- Identity & Auth
    ("Identity & Auth", "Tenant identity + org register/login", "Backend", C),
    ("Identity & Auth", "Short-lived access JWT + rotating DB-backed refresh sessions", "Backend", C),
    ("Identity & Auth", "Logout revocation (global denylist)", "Backend", C),
    ("Identity & Auth", "RBAC/ABAC (Owner > Manager > Employee), PermissionGuard", "Backend", C),
    ("Identity & Auth", "Invite flow: temp password + forced first-login change", "Full-stack", C),
    ("Identity & Auth", "'Remember me' persistent sessions", "Full-stack", C),
    ("Identity & Auth", "Multi-org login selection", "Backend", C),
    ("Identity & Auth", "Idempotent writes (Idempotency-Key) + rate limiting", "Backend", C),
    ("Identity & Auth", "SAML/OIDC SSO (roadmap Phase 4)", "Backend", N),
    ("Identity & Auth", "Google / Microsoft OAuth login (roadmap Phase 4)", "Full-stack", N),
    ("Identity & Auth", "MFA for admins (roadmap Phase 4)", "Full-stack", N),
    ("Identity & Auth", "SCIM provisioning + domain verification (roadmap Phase 4)", "Backend", N),

    # ---------------------------------------------------------------- Platform Admin (admin-web)
    ("Platform Admin", "Super-admin auth (/platform/auth/*, httpOnly-cookie BFF, middleware gate)", "Full-stack", C),
    ("Platform Admin", "Organization CRUD + lifecycle management", "Full-stack", C),
    ("Platform Admin", "Server-side pagination across list APIs", "Backend", C),
    ("Platform Admin", "Live reporting API (/platform/admin/*)", "Backend", C),
    ("Platform Admin", "Platform Health dashboard (service/db/queue probes)", "Full-stack", C),
    ("Platform Admin", "Customer Success dashboard", "Full-stack", C),
    ("Platform Admin", "Usage analytics (DAU/MAU, login-trend, feature-usage)", "Full-stack", C),
    ("Platform Admin", "Audit logs (login + org + billing, category filters)", "Full-stack", C),
    ("Platform Admin", "SaaS config (branding, notifications, feature flags, maintenance mode)", "Full-stack", C),
    ("Platform Admin", "Activity dashboard", "Full-stack", C),

    # ---------------------------------------------------------------- Billing & Metering
    ("Billing & Metering", "billing-service extraction (own DB + events)", "Backend", C),
    ("Billing & Metering", "Plan / Subscription / Invoice model", "Backend", C),
    ("Billing & Metering", "Admin plan management API + storage-tiered plans", "Backend", C),
    ("Billing & Metering", "Recurring-billing lifecycle worker", "Backend", C),
    ("Billing & Metering", "org.created event provisions subscriptions", "Backend", C),
    ("Billing & Metering", "Edit org subscription + reconcile seats + seat-limit enforcement", "Full-stack", C),
    ("Billing & Metering", "Subscriptions & Revenue dashboards", "Frontend", C),
    ("Billing & Metering", "Org-side billing page", "Frontend", C),
    ("Billing & Metering", "Payment methods + real payment-gateway webhooks (roadmap Phase 6)", "Backend", N),
    ("Billing & Metering", "Failed-payment handling / dunning (roadmap Phase 6)", "Backend", N),
    ("Billing & Metering", "Usage meters (events, screenshots, reports, AI requests) + overage policy", "Backend", N),

    # ---------------------------------------------------------------- Attendance
    ("Attendance", "Tenant check-in / check-out API", "Backend", C),
    ("Attendance", "Attendance dashboard, records & reports", "Full-stack", C),
    ("Attendance", "Shift-aware punctuality + dynamic break deduction", "Backend", C),
    ("Attendance", "Platform-admin attendance rollup in org detail", "Frontend", C),
    ("Attendance", "Shift management (types, assignment, rules, rotations)", "Full-stack", P),
    ("Attendance", "Work schedule management (flexible/hybrid/remote/recurring)", "Full-stack", N),
    ("Attendance", "Attendance regularization (missed check-in/out approval workflow)", "Full-stack", N),
    ("Attendance", "Overtime management (approved/billable OT, trends)", "Full-stack", N),
    ("Attendance", "Attendance calendar + team availability view", "Frontend", N),
    ("Attendance", "Attendance intelligence scores (attendance/punctuality/consistency/risk)", "Full-stack", N),
    ("Attendance", "Geofencing / location verification on check-in", "Full-stack", N),
    ("Attendance", "Workforce planning / capacity forecast", "Full-stack", N),

    # ---------------------------------------------------------------- Leave & Holidays
    ("Leave & Holidays", "Leave management API (request, balances, history)", "Backend", C),
    ("Leave & Holidays", "Holidays module", "Backend", C),
    ("Leave & Holidays", "Leave & holidays org-web UI", "Frontend", C),
    ("Leave & Holidays", "Leave approval center (calendars, conflict detection, analytics)", "Full-stack", P),
    ("Leave & Holidays", "Supporting-document upload on leave requests", "Full-stack", N),

    # ---------------------------------------------------------------- Time Tracking
    ("Time Tracking", "Time tracking sessions module", "Full-stack", C),
    ("Time Tracking", "Daily timeline (sessions, apps, websites, idle, breaks)", "Full-stack", P),
    ("Time Tracking", "Idle-time detection", "Backend", C),
    ("Time Tracking", "Manual time entries", "Full-stack", N),
    ("Time Tracking", "Timesheets (daily/weekly/monthly, submit/approve/reject)", "Full-stack", N),
    ("Time Tracking", "Time reports + custom report builder", "Full-stack", P),

    # ---------------------------------------------------------------- Workforce / Org Structure
    ("Workforce", "Org structure (departments, teams, designations)", "Full-stack", C),
    ("Workforce", "Employee management + directory", "Full-stack", C),
    ("Workforce", "Refresh directory & lifecycle counts after edits", "Full-stack", C),
    ("Workforce", "Members module", "Backend", C),
    ("Workforce", "Manager workspace", "Full-stack", P),

    # ---------------------------------------------------------------- Projects & Team
    ("Projects & Team", "Projects CRUD + progress", "Full-stack", C),
    ("Projects & Team", "Milestones", "Full-stack", C),
    ("Projects & Team", "Tasks (assign, priority, status, comments)", "Full-stack", P),
    ("Projects & Team", "Project admin view", "Full-stack", P),
    ("Projects & Team", "Kanban board / task lists", "Frontend", N),
    ("Projects & Team", "Project & task reports", "Full-stack", N),

    # ---------------------------------------------------------------- Employee Monitoring
    ("Employee Monitoring", "Activity ingestion service (high-volume intake, broker publish)", "Backend", C),
    ("Employee Monitoring", "Activity pipeline -> analytics worker -> monitoring API", "Backend", C),
    ("Employee Monitoring", "Monitoring UI (activity timeline, app/website usage)", "Full-stack", C),
    ("Employee Monitoring", "Admin-configurable capture policy", "Full-stack", C),
    ("Employee Monitoring", "Work session tracking", "Full-stack", C),
    ("Employee Monitoring", "Real-time live status (online/idle/break/meeting) presence board", "Full-stack", N),
    ("Employee Monitoring", "Break monitoring (types, excess-break detection)", "Full-stack", N),
    ("Employee Monitoring", "Compliance monitoring (policy violations)", "Full-stack", N),
    ("Employee Monitoring", "Monitoring reports + custom report builder", "Full-stack", P),

    # ---------------------------------------------------------------- Screenshot Storage
    ("Screenshot Storage", "Employee screenshots on S3/MinIO", "Backend", C),
    ("Screenshot Storage", "Plan-tiered GB quotas", "Backend", C),
    ("Screenshot Storage", "Super-admin storage/subscription cards", "Frontend", C),
    ("Screenshot Storage", "Role-based view/delete (Owner/Manager/Employee)", "Full-stack", C),
    ("Screenshot Storage", "Screenshots review center UI (timeline, filtering)", "Frontend", C),
    ("Screenshot Storage", "Blur / sensitive-data masking + privacy exclusion rules", "Full-stack", N),
    ("Screenshot Storage", "S3 screenshot lifecycle / retention rules", "Backend", N),

    # ---------------------------------------------------------------- Desktop Agent
    ("Desktop Agent", "Electron activity agent scaffold (independent app, own build)", "Desktop", C),
    ("Desktop Agent", "Agent auth (sign-in, /auth/me resolve employeeId, token refresh on 401)", "Desktop", C),
    ("Desktop Agent", "Work session start/end events", "Desktop", C),
    ("Desktop Agent", "Foreground app sampling (active-win, pollSeconds)", "Desktop", C),
    ("Desktop Agent", "Idle detection (powerMonitor system idle time)", "Desktop", C),
    ("Desktop Agent", "Batched event upload (flushSeconds, retry, 401 refresh)", "Desktop", C),
    ("Desktop Agent", "Website tracking via active-win URL (macOS)", "Desktop", C),
    ("Desktop Agent", "Chrome browser extension (active-tab URL -> loopback receiver)", "Desktop", C),
    ("Desktop Agent", "Firefox browser extension", "Desktop", C),
    ("Desktop Agent", "Screenshot capture (desktopCapturer -> JPEG -> presigned PUT, quota-aware)", "Desktop", C),
    ("Desktop Agent", "Agent renderer / tray UI", "Desktop", C),
    ("Desktop Agent", "electron-builder packaging (release artifacts)", "Desktop", C),
    ("Desktop Agent", "Break start/stop & focus-block detection (README roadmap)", "Desktop", N),
    ("Desktop Agent", "Multi-monitor capture (primary display only today)", "Desktop", N),
    ("Desktop Agent", "Mobile check-in app (docs: Future)", "Desktop", N),

    # ---------------------------------------------------------------- Productivity Tracking
    ("Productivity Tracking", "Productivity classification (productive/neutral/distracting) in analytics worker", "Backend", C),
    ("Productivity Tracking", "Productivity read model + daily score task", "Backend", C),
    ("Productivity Tracking", "Basic productivity dashboard", "Full-stack", C),
    ("Productivity Tracking", "Focus-time / deep-work analytics + focus quality score", "Full-stack", N),
    ("Productivity Tracking", "Context-switching / attention fragmentation analysis", "Full-stack", N),
    ("Productivity Tracking", "Utilization & capacity analytics", "Full-stack", N),
    ("Productivity Tracking", "Consistency / reliability score", "Full-stack", N),
    ("Productivity Tracking", "Productivity heatmaps (hourly/daily/weekly)", "Frontend", N),
    ("Productivity Tracking", "Team & department productivity workspaces", "Full-stack", P),
    ("Productivity Tracking", "Productivity goals & benchmarks", "Full-stack", P),
    ("Productivity Tracking", "Productivity forecasting", "Backend", N),

    # ---------------------------------------------------------------- Insights & Analytics
    ("Insights & Analytics", "Executive overview / insights dashboard", "Full-stack", C),
    ("Insights & Analytics", "analytics-service (read model + scoring task)", "Backend", C),
    ("Insights & Analytics", "AI-insights org-web page", "Frontend", C),
    ("Insights & Analytics", "HR analytics module", "Full-stack", P),

    # ---------------------------------------------------------------- AI Behavior Analytics
    ("AI Behavior Analytics", "Employee score (basic productivity scoring)", "Backend", P),
    ("AI Behavior Analytics", "Python FastAPI AI service (roadmap Phase 5)", "Backend", N),
    ("AI Behavior Analytics", "Feature-builder worker + feature-store tables", "Backend", N),
    ("AI Behavior Analytics", "Burnout risk detection & prediction", "Full-stack", N),
    ("AI Behavior Analytics", "Attrition / flight-risk scoring & prediction", "Full-stack", N),
    ("AI Behavior Analytics", "Workforce Health Score (flagship USP metric)", "Full-stack", N),
    ("AI Behavior Analytics", "Focus quality / consistency / engagement scores", "Full-stack", N),
    ("AI Behavior Analytics", "Manager effectiveness & team health scores", "Full-stack", N),
    ("AI Behavior Analytics", "Employee intelligence profile (multi-score scorecard)", "Full-stack", N),
    ("AI Behavior Analytics", "Productivity recommendation / coaching engine", "Full-stack", N),
    ("AI Behavior Analytics", "AI daily & weekly executive summaries", "Full-stack", N),
    ("AI Behavior Analytics", "Executive AI Copilot (Q&A over workforce data)", "Full-stack", N),
    ("AI Behavior Analytics", "Workforce risk center + department risk heatmap", "Full-stack", N),
    ("AI Behavior Analytics", "AI model & scoring settings (thresholds, explainability, governance)", "Full-stack", N),

    # ---------------------------------------------------------------- Notifications
    ("Notifications", "notifications-service (channels, rules, recipients, quiet-hours)", "Backend", C),
    ("Notifications", "Real-time SSE notifications (Redis Pub/Sub fan-out)", "Backend", C),
    ("Notifications", "Global notifications + notification center UI", "Full-stack", C),
    ("Notifications", "Notification inbox history", "Full-stack", C),

    # ---------------------------------------------------------------- HR Suite
    ("HR Suite", "Onboarding module + templates", "Full-stack", P),
    ("HR Suite", "Performance module (goals, reviews, H2 2026 cycle)", "Full-stack", P),
    ("HR Suite", "Recruitment / requisitions module", "Full-stack", P),
    ("HR Suite", "Goals org-web page", "Frontend", P),

    # ---------------------------------------------------------------- Payroll & Timesheets (roadmap Phase 7)
    ("Payroll & Timesheets", "Timesheets (weekly, entries, submit, week-locking)", "Full-stack", C),
    ("Payroll & Timesheets", "Timesheet approvals (manager review/approve/reject + notes)", "Full-stack", C),
    ("Payroll & Timesheets", "Client model + project-to-client linking", "Backend", C),
    ("Payroll & Timesheets", "Billable hours by employee/team/project/client + utilization", "Full-stack", C),
    ("Payroll & Timesheets", "Rate foundation: EmployeeRate/BillRate/PayrollSetting + resolution", "Backend", C),
    ("Payroll & Timesheets", "Rate management UI (admin: cost/bill rates, effective-dating)", "Frontend", C),
    ("Payroll & Timesheets", "Client CRUD (API + settings UI)", "Full-stack", C),
    ("Payroll & Timesheets", "Payroll calculations (PayrollCycle/PayrollLine, weekly OT, snapshot rates)", "Backend", C),
    ("Payroll & Timesheets", "Payroll cycle UI (create/preview/run/lock/paid, per-employee lines)", "Frontend", C),
    ("Payroll & Timesheets", "Payroll & timesheets dashboard (spec s1)", "Full-stack", C),
    ("Payroll & Timesheets", "Payroll reports (per-employee, overtime, history) (spec s6)", "Full-stack", C),
    ("Payroll & Timesheets", "Client invoices: generate/preview/send/paid/void + numbering (spec s7)", "Full-stack", C),
    ("Payroll & Timesheets", "Export center: payroll/timesheets/billable/invoices CSV (spec s8)", "Full-stack", C),
    ("Payroll & Timesheets", "Payroll settings UI (OT rules, cycle, invoice prefix)", "Frontend", N),
    ("Payroll & Timesheets", "PDF invoice output (CSV only today)", "Full-stack", N),

    # ---------------------------------------------------------------- Reports (roadmap Phase 7)
    ("Reports", "Reports page (org-web)", "Frontend", P),
    ("Reports", "Async report builder + job framework", "Backend", N),
    ("Reports", "Scheduled reports", "Backend", N),
    ("Reports", "PDF / Excel exports to S3", "Backend", N),
    ("Reports", "Report notifications", "Full-stack", N),

    # ---------------------------------------------------------------- 3rd-Party Integrations (roadmap Phase 7)
    ("Integrations", "Integrations dashboard + app marketplace", "Full-stack", N),
    ("Integrations", "Slack integration", "Full-stack", N),
    ("Integrations", "Microsoft Teams integration", "Full-stack", N),
    ("Integrations", "Google Workspace integration", "Full-stack", N),
    ("Integrations", "Outlook integration", "Full-stack", N),
    ("Integrations", "GitHub integration (commits/PRs/contributors)", "Full-stack", N),
    ("Integrations", "GitLab integration", "Full-stack", N),
    ("Integrations", "Jira integration", "Full-stack", N),
    ("Integrations", "ClickUp integration", "Full-stack", N),
    ("Integrations", "Asana integration", "Full-stack", N),
    ("Integrations", "Data sync center (sync health, retries, encrypted OAuth tokens)", "Full-stack", N),

    # ---------------------------------------------------------------- UX & Branding
    ("UX & Branding", "Branding on login + across apps", "Frontend", C),
    ("UX & Branding", "Responsive mobile navigation drawer", "Frontend", C),
    ("UX & Branding", "Navigation loading skeletons", "Frontend", C),
    ("UX & Branding", "Time display convention (UTC stored, viewer-local shown)", "Frontend", C),

    # ---------------------------------------------------------------- Enterprise Scale (roadmap Phase 8)
    ("Enterprise Scale", "Tenant routing by home region / data residency", "Infra", N),
    ("Enterprise Scale", "Dedicated DB / ClickHouse option + read replicas", "Infra", N),
    ("Enterprise Scale", "Compliance exports + custom retention", "Full-stack", N),
    ("Enterprise Scale", "OpenSearch audit/security search (roadmap Phase 4)", "Infra", N),
]

# ---- workbook -------------------------------------------------------------
wb = Workbook()
ws = wb.active
ws.title = "Task Tracker"

HEADERS = ["Task", "Sub-task", "Backend/Frontend", "Status"]

header_fill = PatternFill("solid", fgColor="1F4E78")
header_font = Font(bold=True, color="FFFFFF", size=11)
thin = Side(style="thin", color="D9D9D9")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
center = Alignment(horizontal="center", vertical="center")
left = Alignment(horizontal="left", vertical="center", wrap_text=True)

status_fill = {
    C: PatternFill("solid", fgColor="C6EFCE"),
    P: PatternFill("solid", fgColor="FFEB9C"),
    N: PatternFill("solid", fgColor="FFC7CE"),
}
status_font = {
    C: Font(color="006100"),
    P: Font(color="9C5700"),
    N: Font(color="9C0006"),
}
group_fill = PatternFill("solid", fgColor="F2F2F2")

ws.append(HEADERS)
for col, _ in enumerate(HEADERS, 1):
    c = ws.cell(row=1, column=col)
    c.fill, c.font, c.alignment, c.border = header_fill, header_font, center, border
ws.freeze_panes = "A2"
ws.row_dimensions[1].height = 24

r = 2
for task, sub, layer, status in rows:
    ws.cell(row=r, column=1, value=task).alignment = left
    ws.cell(row=r, column=2, value=sub).alignment = left
    ws.cell(row=r, column=3, value=layer).alignment = center
    sc = ws.cell(row=r, column=4, value=status)
    sc.alignment, sc.fill, sc.font = center, status_fill[status], status_font[status]
    for col in range(1, 5):
        ws.cell(row=r, column=col).border = border
    r += 1

# merge Task column for consecutive identical groups
start = 2
for i in range(3, r + 1):
    this = ws.cell(row=i, column=1).value if i < r else None
    if this != ws.cell(row=start, column=1).value:
        if i - 1 > start:
            ws.merge_cells(start_row=start, start_column=1, end_row=i - 1, end_column=1)
            ws.cell(row=start, column=1).alignment = Alignment(
                horizontal="left", vertical="center", wrap_text=True)
        ws.cell(row=start, column=1).fill = group_fill
        ws.cell(row=start, column=1).font = Font(bold=True)
        start = i

ws.column_dimensions["A"].width = 24
ws.column_dimensions["B"].width = 68
ws.column_dimensions["C"].width = 18
ws.column_dimensions["D"].width = 15

dv = DataValidation(type="list", formula1='"Completed,In Progress,Not Started"', allow_blank=False)
ws.add_data_validation(dv)
dv.add(f"D2:D{r-1}")
ws.auto_filter.ref = f"A1:D{r-1}"

# ---- Summary sheet --------------------------------------------------------
s = wb.create_sheet("Summary")
s.append(["Status", "Count"])
for col in (1, 2):
    hc = s.cell(row=1, column=col)
    hc.fill, hc.font, hc.alignment = header_fill, header_font, center

counts = {C: 0, P: 0, N: 0}
for *_, st in rows:
    counts[st] += 1
for i, st in enumerate([C, P, N], start=2):
    s.cell(row=i, column=1, value=st).fill = status_fill[st]
    s.cell(row=i, column=1).font = status_font[st]
    s.cell(row=i, column=2, value=counts[st]).alignment = center
s.cell(row=5, column=1, value="Total").font = Font(bold=True)
s.cell(row=5, column=2, value=sum(counts.values())).font = Font(bold=True)

# per-area breakdown
s.cell(row=7, column=1, value="Area").font = Font(bold=True)
s.cell(row=7, column=2, value="Completed").font = Font(bold=True)
s.cell(row=7, column=3, value="In Progress").font = Font(bold=True)
s.cell(row=7, column=4, value="Not Started").font = Font(bold=True)
areas = []
seen = set()
for task, *_ in rows:
    if task not in seen:
        seen.add(task); areas.append(task)
rr = 8
for area in areas:
    cc = {C: 0, P: 0, N: 0}
    for task, _sub, _l, st in rows:
        if task == area:
            cc[st] += 1
    s.cell(row=rr, column=1, value=area)
    s.cell(row=rr, column=2, value=cc[C]).alignment = center
    s.cell(row=rr, column=3, value=cc[P]).alignment = center
    s.cell(row=rr, column=4, value=cc[N]).alignment = center
    rr += 1

s.column_dimensions["A"].width = 26
for col in ("B", "C", "D"):
    s.column_dimensions[col].width = 13

import sys
out = sys.argv[1] if len(sys.argv) > 1 else "RetainIQ-Task-Tracker.xlsx"
wb.save(out)
print(f"Saved {out}: {len(rows)} sub-tasks across {len(areas)} areas "
      f"({counts[C]} completed, {counts[P]} in progress, {counts[N]} not started)")
