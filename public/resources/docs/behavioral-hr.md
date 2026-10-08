# Behavioral (STAR) & HR Round

Senior candidates are often rejected in the **behavioural** round, not the technical one. Interviewers want evidence that you can own outcomes, handle conflict, communicate trade-offs and make a team better. This page gives you a method, a bank of stories built from your resume, and model answers for the most common questions, including HR topics such as salary and notice period.

> **Rules for every behavioural answer**
> 1. Use **STAR**: Situation (10%), Task (10%), **Action (60%)**, Result (20%).
> 2. Say **"I"** for your actions and "we" for team outcomes. Interviewers are assessing *you*.
> 3. **Quantify** the result (time saved, errors reduced, users affected), or describe a concrete qualitative outcome.
> 4. Finish with **what you learned** or would do differently.
> 5. Keep each answer to **about 2 minutes**. Stop and let them ask follow-ups.
>
> ⚠️ **The model answers are templates.** They're built around your resume's projects, but the specific incidents, numbers and conversations are illustrative. Replace every detail with what actually happened to you, and never tell an invented story in an interview: follow-up questions expose made-up details quickly.

## Your story bank

### Which stories should I prepare, and how do I map them to questions? 🔥

Prepare **six to eight strong stories** in advance. Each one can answer several questions. Here is a bank built from your resume. Fill in the real details in **My notes**.

| # | Story | Use it for |
|---|---|---|
| 1 | **Multi-Jibri recording & streaming**: designing multiple concurrent sessions while controlling cost | Most complex project, technical leadership, trade-offs, cost awareness |
| 2 | **Electron app revamp**: annotations, PiP, local recording, performance | Ownership, learning new tech fast, cross-platform issues |
| 3 | **React architecture refactor** for render performance | Tech debt, convincing others, measuring impact |
| 4 | **Visitor/Webinar mode**: large-audience architecture (upcoming release) | Ambiguity, designing for scale, collaboration with backend/DevOps |
| 5 | **RBF redaction with Claude**: AI in a sensitive domain | Innovation, risk management, customer trust |
| 6 | **scQuill**: CKEditor timing sync, Azure AD SSO for a DA's office | Hard technical problem, security requirements, government customer |
| 7 | **A production incident** (recording failures, an Electron upgrade breaking screen share…) | Pressure, debugging, communication, postmortem |
| 8 | **A disagreement in code review or architecture** | Conflict, influence without authority |
| 9 | **Mentoring a junior** or onboarding someone to the Jitsi stack | Leadership, teaching |
| 10 | **A missed deadline or a mistake** | Failure, accountability, learning |

**Practice:** write each story as five bullet points (S, T, A1, A2, R) and rehearse them out loud. Don't script full sentences.

## Ownership & impact

### Tell me about the most challenging project you've worked on 🔥

Use **Story 1 (multi-Jibri)** or **Story 4 (Webinar mode)**.

> **S:** "MeetHour customers running large events wanted to record a meeting *and* live-stream it to multiple platforms at the same time. Stock Jitsi allows only one recording-or-streaming session per conference, and each Jibri recorder is an expensive Chrome-plus-ffmpeg instance."
>
> **T:** "I was responsible for designing and delivering multi-session support on the client side and coordinating the server-side changes, without letting recorder costs grow linearly."
>
> **A:** "First, I mapped the full flow: UI → signalling IQ → Jicofo → Jibri selection → status presence. I found the single-session assumption hard-coded at each layer. I proposed modelling sessions as a map keyed by session ID end-to-end. On the client, I refactored the recording Redux state and UI so each session had its own status, errors and stop control. I wrote a short design doc comparing 'one Jibri per output' with 'one Jibri fan-out to many outputs', listing cost against failure isolation, and reviewed it with backend and DevOps. We chose *[option]*. I also pushed for per-session failure handling, so a bad stream key doesn't kill the recording, and for pool autoscaling based on idle Jibris."
>
> **R:** "We shipped simultaneous recording and multi-destination streaming. Recorder costs *[dropped by ~X% / grew sub-linearly]*, and support tickets about 'recording stopped' *[fell]*. The lesson: write down hidden single-instance assumptions early, because they're what make features expensive later."

### Tell me about a time you took ownership of something outside your job description 🔥

Good candidates: **Prosody/Lua or Jibri work** (backend/infrastructure) while hired as a frontend developer, or **Docker deployments**.

> "On Visitor mode the frontend work depended on a signalling change in Prosody. Our backend engineer was busy with *[X]*, so rather than wait, I learned enough Lua and Prosody's module API to prototype the hook that flags visitor occupants and enforces their permissions. I paired with the backend engineer for review, added logging, and documented how to test it locally with Docker. It unblocked the feature by *[N days]*, and Prosody changes are now something I can pick up independently."

### Describe a time you improved performance or quality significantly 🔥

Use **Story 3 (React refactor)** or the **virtual background** work.

> **S:** "In meetings with 30+ participants, our React UI dropped frames. Audio-level updates and stats triggered re-renders across the whole filmstrip."
> **T:** "Improve rendering performance without a rewrite."
> **A:** "I profiled with the React Profiler and Chrome Performance panel. Several `useSelector` calls returned new arrays on every dispatch, tiles received whole participant objects, and audio levels flowed through Redux many times per second. I normalised participant state, introduced memoised selectors, made tiles `React.memo` components that select by ID, moved audio-level rendering to a small subscription component outside Redux, and virtualised the tile view. I added a profiling checklist to our PR template."
> **R:** "Commits per participant update dropped from *[N]* to *[M]*, and frame drops in 30-person meetings *[mostly disappeared]*. More importantly, we now had patterns that stopped the problem from coming back."

### Tell me about a time you had to learn a new technology quickly 🔥

Use **Prosody/XMPP** or **Electron**, or **Claude/LLM APIs** for RBF.

> "When I started on RBF, I'd never built anything with an LLM. In the first week I read the API docs, built a small prototype that extracted entities from three sample reports, and measured recall by hand. That showed me free-text responses were unreliable to parse, so I switched to structured JSON output with schema validation and verbatim-text matching. I shared the prototype and its failure cases with the team, which set the direction for the real implementation. The general approach I use is: docs and fundamentals first, then a throwaway prototype aimed at the riskiest part, then measure."

## Collaboration & conflict

### Tell me about a disagreement with a teammate or senior engineer. How did you resolve it? 🔥

The interviewer is looking for **respect, data and commitment to the decision**, not "I was right".

> **S:** "During a code review, a senior colleague wanted to keep high-frequency audio levels in Redux for consistency. I believed it was causing our re-render problems."
> **T:** "Reach the best technical decision without damaging the relationship."
> **A:** "Instead of arguing in PR comments, I set up a 15-minute call and brought data: a profiler recording of 30 participants showing commit counts with and without the change. I acknowledged the real benefit of their approach (one source of truth, easier debugging) and proposed a compromise: keep the *derived* 'is speaking' flag in Redux, but render the fast-changing level meter from a subscription. We agreed to try it behind a flag."
> **R:** "The data convinced us both. We merged the compromise, and the colleague later reused the pattern for connection stats. My takeaway: move disagreements out of text, lead with evidence, and look for the concern behind the other person's position."

**Also be ready for:** "What if you had been overruled?"

> "Then I'd disagree and commit: implement the decision well, and record the trade-off so we can revisit it if the problem returns."

### How do you handle code review feedback you disagree with?

- Assume good intent, and ask a clarifying question first ("Can you help me understand the concern?").
- Separate **preferences** from **correctness**. On style, defer to the linter or team conventions. On correctness and performance, discuss with evidence.
- Move long threads to a quick call, then summarise the outcome in the PR.
- When **giving** reviews: comment on code, not people; explain *why*; label nits as nits; approve with suggestions when blocking isn't necessary.

### Tell me about working with a difficult stakeholder or customer

Use the **DA's office (scQuill)** or **RBF**: government customers with strict requirements.

> "For scQuill, the DA's office required that evidence transcripts never be processed by third-party services. A late requirement change meant our planned approach to Word export, a cloud conversion service, wasn't acceptable. Instead of pushing back on the requirement, I explained the trade-offs to the product owner, proposed client-side export with the `docx` library, built a quick spike to confirm formatting fidelity (speaker labels, timestamps, headers), and agreed a slightly reduced formatting scope for the first release. We delivered on time, and the customer valued that we treated their constraint as a feature, not an obstacle."

### Describe a time you mentored someone or helped a teammate grow

> "A junior developer joined MeetHour and was overwhelmed by the Jitsi stack. I drew the architecture (Prosody, Jicofo, JVB, Jibri) on one page, paired with them on their first bug (a mute-state sync issue), and gave them a 'trace a participant join through the logs' exercise. I reviewed their PRs with explanations rather than just fixes. Within *[N weeks]* they shipped *[feature]* independently, and I turned my notes into an onboarding doc the team still uses."

### How do you work with designers, product managers and QA?

- **Designers:** review designs early for feasibility (e.g. "this animation on 50 video tiles will hurt performance"). Agree on loading, empty and error states, which designs often miss. Use the design system's tokens.
- **PMs:** clarify the problem and the success metric, not just the solution. Raise scope and timeline trade-offs early with options ("we can ship A by Friday or A+B next Wednesday").
- **QA:** share testing notes for tricky areas such as multi-participant scenarios, network conditions and OS differences in Electron. Write automated tests for regressions they find.

## Pressure, failure & ambiguity

### Tell me about a production issue you handled under pressure 🔥

Use **Story 7**. Show calm triage → mitigation → communication → root cause → prevention.

> **S:** "A customer's large webinar was about to start, and recordings had been failing intermittently that morning."
> **T:** "Restore recording before the event, then find the root cause."
> **A:** "I checked the Jibri status in the brewery first: most instances showed busy or unhealthy. Jibri logs showed Chrome crashing at launch. I coordinated with DevOps to restart the pool and pin the previous Chrome version as an immediate mitigation, and posted updates in the incident channel every 15 minutes. After the event, we traced the cause to an automatic Chrome update incompatible with our ChromeDriver version."
> **R:** "Recording worked for the webinar. Afterwards we pinned Chrome and ChromeDriver versions in the Jibri image, added a health check that starts a test recording, and added an alert on failed sessions. That class of incident hasn't recurred."

### Tell me about a time you failed or made a mistake 🔥

Choose a **real, moderate** failure where you owned it and changed your process. Don't pick a catastrophe, and don't pick a fake failure.

> **S:** "Early on, I shipped a refactor of the participant list that passed tests but broke ordering for moderators in large rooms."
> **T:** "Fix it fast and make sure it couldn't happen again."
> **A:** "I owned it immediately in the team channel, reverted within the hour, then wrote a test reproducing the 50-participant case. The bug was a sort that assumed every participant had a join timestamp, but visitors promoted mid-meeting didn't. I fixed it and added fixtures with promoted visitors."
> **R:** "No customer escalation, and I changed how I work: for any change to list or state logic, I now test with realistic, large and edge-case fixtures, not just the happy path."

### Tell me about a time you missed a deadline

> "I underestimated local recording in the Electron app. The audio mixing worked quickly, but saving long recordings without memory issues and handling crashes mid-recording took much longer. When I realised at mid-sprint that we'd slip, I told the PM right away with options: ship recording with a 30-minute limit now, or the robust version a week later. We chose the second, and I broke the work into smaller demoable pieces. Lesson: I now spike the riskiest part (here, long-running persistence) before committing to an estimate."

### How do you handle ambiguous requirements? 🔥

> "I turn ambiguity into explicit decisions. For Webinar mode, 'support large audiences' was the whole requirement. I wrote down the questions: how large, what interaction do attendees need, what latency is acceptable, and what happens when a presenter drops. I answered what I could from customer data, proposed defaults for the rest, and reviewed them with the PM in a one-page doc. Then I built the riskiest part first, the scale path with visitor nodes, so we learned early. Ambiguity is fine as long as the assumptions are written down and validated."

### How do you prioritise when you have multiple urgent tasks?

- Clarify **impact and urgency** with stakeholders. Don't silently guess.
- **Production issues affecting customers come first**, then committed sprint work, then improvements.
- Make trade-offs visible: "If I take this escalation, feature X slips two days. Is that OK?"
- Protect focus time for deep work, and batch interruptions such as reviews and messages.

### Tell me about a time you pushed back on a decision

> "A PM wanted to add a 'record' button for every participant in Webinar mode. I pushed back on two points: privacy (recording consent) and cost (recorder capacity). I proposed allowing recording for hosts only, with a visible indicator for everyone, and the option for hosts to grant permission. I backed it with the cost per recording-hour and a legal note about consent. The PM agreed, and we avoided both a compliance risk and an infrastructure bill."

## Agile, process & engineering practices

### What does your Agile/Scrum process look like? 🔥

- **Sprint length:** usually two weeks *[confirm yours]*.
- **Ceremonies:**
  - **planning** (pick and estimate stories, define acceptance criteria)
  - **daily stand-up** (progress, plan, blockers, 15 minutes max)
  - **backlog refinement/grooming** (split stories, clarify)
  - **sprint review/demo** (show working software to stakeholders)
  - **retrospective** (what went well, what to improve, action items)
- **Artefacts:** product backlog, sprint backlog, increment. Tracked in Jira (or similar) with story points.
- **Definition of Done:** code reviewed, tests written and passing, accessibility checked, documented, deployed to staging, QA verified.

### How do you estimate stories? What are story points?

- **Story points** measure relative **effort + complexity + uncertainty**, not hours. Teams often use a Fibonacci-like scale (1, 2, 3, 5, 8, 13).
- **Planning poker:** everyone estimates privately, then reveals. Big differences trigger discussion, which is where hidden complexity surfaces.
- **Velocity** (points completed per sprint) is for forecasting **within one team**. It's not a performance metric and can't be compared across teams.
- For uncertain work (e.g. "can Electron capture system audio on macOS?"), do a **time-boxed spike** first, then estimate.
- Break anything bigger than about 8 points into smaller vertical slices.

### What makes a good pull request and a good code review?

**A good PR:**

- small and focused (under ~400 lines when possible)
- a clear title and description: what, why, how to test, screenshots or video for UI
- tests included
- no unrelated changes
- self-reviewed first

**A good review:**

- checks correctness, edge cases, readability, performance and security, and that tests exist
- asks questions rather than giving commands
- distinguishes blocking issues from nits
- is timely (within a day)
- automate what you can (lint, format, type checks) so humans focus on design

### How do you handle technical debt?

- Make it **visible**: tickets with the cost of *not* fixing it ("every recording feature takes 2× longer because…").
- Fix it **incrementally**, alongside features that touch the same area (the "boy scout rule").
- Reserve **capacity**, e.g. ~15–20% per sprint, or tie debt work to business goals (performance, reliability).
- Avoid big-bang rewrites; prefer the **strangler pattern** (replace pieces behind stable interfaces).

### How do you ensure quality in your frontend code?

- **TypeScript** in strict mode, ESLint and Prettier, pre-commit hooks.
- **Tests:** unit tests for logic, **React Testing Library** for components, a few **E2E** tests for critical flows (join meeting, start recording).
- **Code review** and a **Definition of Done**.
- **Monitoring:** error tracking (e.g. Sentry), performance metrics (Core Web Vitals, custom metrics such as time-to-join), and logs for WebRTC failures.
- **Feature flags** for risky features, with gradual rollout.

## HR round

### What are your salary expectations? 🔥

**Preparation:**

- Research the market for **Senior Frontend / Full-stack (React, 6 years)** in your city or target cities. Sources: AmbitionBox, Glassdoor, LinkedIn Salary, Levels.fyi (for product companies), and peers.
- Know your **current CTC breakdown**: fixed, variable/bonus, benefits, ESOPs.
- Decide three numbers in advance: your **target**, your **walk-away minimum**, and your **opening ask** (slightly above target).

**How to answer:**

- Try to **let them share the range first**: "Could you share the budgeted range for this role? I'm sure we can find something that works if the role is the right fit."
- If you must give a number, give a **researched range** with your target near the bottom:
  > "Based on my experience in React, real-time systems and AWS, and current market rates for senior roles, I'm looking for *[X–Y]* fixed. I'm open to discussing the overall structure: fixed, variable and benefits."
- In India, HR will ask for your **current CTC** and expect a hike percentage. Anchor on **market value and the role's scope**, not only a percentage on your current salary.
- **Never lie** about current compensation. Payslips are verified during background checks.

### How do you negotiate an offer?

- **Express enthusiasm first:** "I'm excited about the role and the team."
- **Negotiate on specifics:** "The fixed component is below what I discussed with the recruiter and below market for this scope. Can we get to *[number]*?"
- Use **leverage honestly**: a competing offer (share it only if real), a strong interview performance, niche skills (WebRTC/Electron).
- Consider the whole package:
  - fixed vs variable (variable is often not fully paid)
  - joining bonus (useful to offset notice-period buyout)
  - ESOPs/RSUs and their vesting schedule
  - relocation support
  - remote or hybrid policy
  - learning budget
  - title/level
- Get the final offer **in writing** before resigning.

### Your notice period is two months. Can you join earlier? 🔥

> "My notice period is two months. I'll do my best to negotiate an early release by planning a thorough handover. If the company offers a notice buyout, that would help me join sooner. Realistically, I can join by *[date]*."

**Tips:**

- Don't promise an early date you can't guarantee.
- If you've already resigned, say so: "I'm currently serving my notice, and my last working day is *[date]*." That's a strong advantage.
- Companies often ask for proof (a resignation email or acceptance) before or after the offer.

### What if your current company makes a counter-offer?

> "I've thought carefully about this move. My decision is about the role, the scope and growth, not just compensation, so I don't plan to entertain a counter-offer."

(Only say this if it's true. Accepting a counter-offer after signing elsewhere damages your reputation.)

### Are you willing to relocate? Are you comfortable working from the office?

Your resume says **willing to relocate anywhere**. Confirm it, and check practical details: relocation support, temporary accommodation, timeline. For hybrid/onsite questions, say what you're truly comfortable with. Mismatches here lead to early attrition, which hurts everyone.

### Do you have other offers or interviews in progress?

Be honest without oversharing:

> "Yes, I'm in the final stages with a couple of companies. This role is my top preference because of *[reason]*, so I'd appreciate knowing the timeline."

This creates healthy urgency without sounding like a threat.

### Why is there an overlap between your ScaleCapacity and V-Empower dates?

See **Tell Me About Yourself → overlap question**. Give the same consistent, truthful one-sentence explanation in every round. HR will cross-check it against **offer letters, relieving letters and payslips** during background verification. Fix the resume before applying, if you can.

### Is there anything else we should know about you? / Any questions?

Use it to **reinforce your fit** in one sentence, then ask a good question:

> "Just that I'm very motivated by this role. It combines the React architecture work I enjoy with *[their domain]*, and I'd be productive quickly. One question from my side: how do you measure success for this role in the first six months?"

**Good questions for HR or the hiring manager:**

- "What does the onboarding process look like?"
- "How are performance reviews and promotions structured?"
- "What is the team's working model: remote, hybrid, office days?"
- "What is the next step and the expected timeline?"

## Red flags to avoid

### What should I never say in a behavioural or HR interview? 🔥

- Criticising current or past employers, managers or colleagues.
- "We did X" with no clarity about **your** contribution.
- Stories with no result, or with no learning from a failure.
- Fake weaknesses ("I'm a perfectionist", "I work too hard").
- Inconsistent facts (dates, CTC, reasons for leaving) across rounds.
- Over-claiming technologies you can't discuss for five minutes (every resume keyword is fair game).
- Talking only about salary and leave in technical rounds.
- Rambling past three minutes. Watch the interviewer's cues and offer to go deeper instead.
