# HCM Lite — AI-assisted HR system (Next.js)

Saylani Hackathon · 24 Oct 2026. Next.js 14 (App Router) + MongoDB + any OpenAI-compatible LLM with tool calling.
The system starts **empty**: Admin sets up the company, HR registers employees, every number comes from the app.

## Run locally (under 10 minutes)
```bash
npm install
cp .env.example .env.local     # fill MONGODB_URI, JWT_SECRET, AI_API_KEY
npm run dev                    # http://localhost:3000
npm test                       # unit tests for business rules
```
1. **First Admin:** open the app on a fresh database; it shows "Set up your company" (company name + Admin email/password).
   Or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in the env and leave those fields empty.
2. Admin: set office hours/location, add a department and designations, then **HR logins → Create HR login** (temporary password shown once).
3. HR signs in (must change password), **Employees → Register employee** (creates the employee login with a temporary password).
4. Employee signs in, changes password, checks in, asks for leave in plain words, etc.

## Environment
| Variable | Meaning |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | MongoDB (Atlas free tier is fine) |
| `JWT_SECRET` | long random string |
| `AI_API_KEY` | key for the LLM provider. **Server only**, the browser never calls the provider |
| `AI_BASE_URL`, `AI_MODEL` | OpenAI-compatible endpoint (default Groq `llama-3.3-70b-versatile`; Gemini/OpenAI work too) |
| `TZ_OFFSET_MIN` | office timezone offset in minutes (Pakistan = 300) |

Deploy free on Vercel: import the repo, add the env variables above, deploy. Commit only `.env.example`.

## Structure
```
app/api/[...path]/route.js  single API entry: route table -> role check -> service
lib/routes.js               every endpoint + allowed roles
lib/services.js             all business logic (auth, employees, attendance, leave, payroll, dashboards, audit)
lib/rules.mjs               pure rules (late/half-day, working days, tax slab, payroll, haversine) + tests/
lib/ai.js                   LLM tools (same services as REST), smart leave, summary, policy Q&A, rate limit, ai_logs
components/ , app/page.js   UI: role-based menus, dashboards, forms
```
Security: bcrypt passwords, JWT, role read from DB on every request, Employee data scope forced server-side, AI tools reuse the same scope, finalized payroll is locked, audit log is append-only with before/after JSON.

## Checklist status (25 functionalities)
Done: 01–25 (first-run setup, auth + forced password change, settings, lookups, HR logins, employee register/directory/360, CSV import (dry run) / export, web check-in/out, calendar + board, corrections, leave apply/cancel/approve with overlap + balance + holiday rules, salary, payroll draft/finalize/lock, payslip PDF, dashboards with date + department filters, AI chat with tools, AI summary, smart leave, policy Q&A, announcements, notifications, audit log).
Bonus done: optional location check on web check-in (Haversine, radius, GPS accuracy ≤ 100 m), Roman Urdu understanding via prompt, dark mode (system preference).
Not done: mobile app, face detection / liveness, attrition risk score, anomaly flags, late-penalty rule, PWA.

## Notes
- Late after 09:15; half day under 5 h; absent = no record and no approved leave (past days only); missing_checkout if no check-out on a past day.
- HR staff are created by Admin; their own leave requests are approved by Admin, employees' by HR (nobody approves their own).
- Existing finalized payroll cannot be edited; to test again use a different month.
