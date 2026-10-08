# Docker, Microservices, CI/CD & Git

Your resume mentions **Docker** (deploying web apps, back ends and microservices), **Docker-based microservices** at MeetHour (the Jitsi stack: web, Prosody, Jicofo, JVB, Jibri), **Jenkins**, **Yarn**, **Git/GitHub** and **Linux**. Full-stack interviews often include a DevOps segment: **Dockerfiles, Compose, networking, microservice patterns, pipelines, Git workflows, and Linux and Nginx debugging**.

## Docker

### Containers vs virtual machines: how do containers work? 🔥

| | Virtual machine | Container |
|---|---|---|
| Isolation | **Hardware-level**: a hypervisor runs full guest OSes with their own kernels | **OS-level**: processes **share the host kernel**, isolated with **namespaces** and limited with **cgroups** |
| Size and startup | GBs, minutes | MBs, **milliseconds to seconds** |
| Density | Tens per host | Hundreds or more per host |
| Security boundary | Strong | Weaker (shared kernel). Harden with non-root users, seccomp/AppArmor, rootless runtimes, gVisor/Firecracker for multi-tenant isolation |

**Linux primitives:**

- **Namespaces** give each container its own view of **PIDs**, **network** (its own interfaces and ports), **mount** (filesystem), UTS (hostname), IPC and user IDs.
- **cgroups** limit and account **CPU, memory and I/O**. Exceeding the memory limit gets the container OOM-killed (exit code 137).
- **Union/overlay filesystems** stack **read-only image layers** plus a thin **writable container layer** (copy-on-write).

**Image vs container:** an **image** is an immutable template (layers plus metadata). A **container** is a **running instance** with a writable layer. Data in that layer disappears when the container is removed, so use volumes.

### Write a production Dockerfile for a React/Vite SPA and explain the best practices 🔥

```dockerfile
# syntax=docker/dockerfile:1.7
# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app
# 1) copy only dependency manifests first -> this layer is cached until dependencies change
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn yarn install --frozen-lockfile
# 2) then copy the source (changes often) and build
COPY . .
ARG VITE_API_URL                     # build-time config (public, ends up in the bundle)
RUN yarn build

# ---------- runtime stage ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# run as non-root (nginx-unprivileged images listen on 8080) or adjust permissions
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]   # exec form: nginx is PID 1 and receives SIGTERM
```

**Best practices:**

1. **Multi-stage builds:** build tools and `node_modules` stay in the build stage. The final image contains only static files and Nginx (tens of MB instead of over 1 GB).
2. **Layer caching order:** copy lockfiles → install → copy source → build. Changing source code doesn't reinstall dependencies.
3. **`.dockerignore`** for `node_modules`, `.git`, `dist`, `.env*` and logs. That gives a smaller build context and **no secrets leaking into images**.
4. **Pin base image versions** (or digests) for reproducibility. Choose minimal bases: `-alpine` (musl libc, so watch for native-module issues), `-slim`, or **distroless** (no shell, so a smaller attack surface).
5. **Non-root user** (`USER node`, or nginx-unprivileged). Use a read-only filesystem where possible.
6. **Exec-form `CMD`/`ENTRYPOINT`** (JSON array) so the process is PID 1 and receives signals. Use `--init`/tini if the app doesn't reap child processes.
7. **Secrets:** never in `ENV`/`ARG`/`COPY`, because they remain in the layer history. Use **BuildKit secret mounts** (`RUN --mount=type=secret,id=npmrc …`) and runtime env or secret managers.
8. **One concern per container,** a `HEALTHCHECK`, scanning images (Trivy, Docker Scout), and small layers (combine `apt-get update && install && rm -rf /var/lib/apt/lists/*` in one `RUN`).
9. **Runtime configuration for SPAs:** Vite variables are baked in at build time. For "build once, deploy everywhere", serve a `config.json`, or inject `window.__CONFIG__` at container start with `envsubst` in an entrypoint script.

### `CMD` vs `ENTRYPOINT`, `ARG` vs `ENV`, `COPY` vs `ADD`

- **`ENTRYPOINT`** is the executable that always runs. **`CMD`** supplies **default arguments**, which `docker run image <args>` overrides. A common pairing is `ENTRYPOINT ["/docker-entrypoint.sh"]` + `CMD ["nginx", "-g", "daemon off;"]`.
- **Shell form** (`CMD npm start`) runs through `/bin/sh -c`, so the shell is PID 1 and **signals may not reach your app**, which makes graceful shutdown fail. Prefer the exec form.
- **`ARG`** is **build-time only** (`--build-arg`) and is visible in the image history, so don't use it for secrets. **`ENV`** persists into the **runtime** environment.
- **`COPY`** copies files from the build context. **`ADD`** also extracts local tarballs and fetches URLs (surprising behaviour), so prefer `COPY` unless you need extraction.

### Volumes vs bind mounts vs tmpfs 🔥

- **Named volumes** (`docker volume create`, `-v pgdata:/var/lib/postgresql/data`) are managed by Docker and the **best choice for persistent data** (databases, Prosody storage, Jibri recordings before upload). They survive container removal.
- **Bind mounts** (`-v $(pwd)/src:/app/src`) map a host path. Great for **local development** (hot reload) and for config files. They depend on host paths and permissions.
- **tmpfs** mounts are **in-memory**: scratch data, secrets that shouldn't touch disk.
- **The container's writable layer** is ephemeral and slow (copy-on-write). Don't store data there.

### How does Docker networking work? 🔥

- **Bridge network** (the default for standalone containers): a private subnet. Containers reach the outside through NAT. **Publish ports** to the host with `-p 8080:80`.
- **User-defined bridge networks** (what **Compose creates per project**) give **built-in DNS**: containers reach each other **by service name** (`http://api:3000`, `xmpp.meet.jitsi`). Use them instead of IP addresses.
- **Host network** (`--network host`): the container shares the host's network stack, with no NAT. It's useful for **media servers handling many UDP ports**, and some Jitsi JVB deployments use it. It's less isolated and works on Linux only.
- **Overlay networks** connect containers across hosts (Swarm), and **macvlan** gives containers addresses on the LAN.
- **Real-time media angle:** the JVB needs **UDP 10000 published** (`-p 10000:10000/udp`) **and must advertise the host's public IP** (`JVB_ADVERTISE_IPS`). Getting this wrong means media fails while signalling works, a classic dockerised Jitsi issue.

### Explain docker compose with a realistic multi-service example 🔥

```yaml
# compose.yaml — local full stack: React app, Node API, Postgres, Redis
services:
  web:
    build: ./web
    ports: ["5173:5173"]
    volumes: ["./web/src:/app/src"]            # bind mount for hot reload in dev
    environment: { VITE_API_URL: "http://localhost:3000" }
    depends_on: [api]

  api:
    build: ./api
    ports: ["3000:3000"]
    env_file: .env                             # not committed
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app   # "db" resolves via Compose DNS
      REDIS_URL: redis://cache:6379
    depends_on:
      db: { condition: service_healthy }       # wait until Postgres is actually ready
      cache: { condition: service_started }
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 10

  cache:
    image: redis:7-alpine

volumes:
  pgdata:
```

**Points to explain:**

- `depends_on` with a **healthcheck condition**, because plain `depends_on` only orders startup.
- Service-name DNS, named volumes, env files, profiles for optional services, `docker compose up -d --build`, `logs -f`, `exec`.
- **docker-jitsi-meet** is a real Compose example: `web` (Nginx + the React app), `prosody`, `jicofo` and `jvb` services on a shared network (`meet.jitsi`), plus optional `jibri`, `jigasi` and `etherpad` compose files.

### How do you debug a container that keeps crashing? 🔥

1. **`docker ps -a`**: status and **exit code**.
   - `0`: normal exit; the process ended because CMD wasn't long-running.
   - `1`: application error.
   - **`137`**: SIGKILL, often **OOM-killed** (check with `docker inspect --format '{{.State.OOMKilled}}'`) or a stop timeout.
   - `139`: segfault.
   - `143`: SIGTERM.
2. **`docker logs <c> --tail 200 -f`**: the app's stdout/stderr. Make apps log to stdout.
3. **`docker inspect`**: env, mounts, network, health status, restart count.
4. **`docker exec -it <c> sh`** to look inside, or `docker run -it --entrypoint sh image` if it dies instantly. For distroless images, use `docker debug` or an ephemeral debug container.
5. **`docker stats`**: CPU and memory usage against limits.
6. **Common causes:**
   - wrong `CMD` or working directory
   - missing env vars or config
   - a dependency not ready (DB), so add retries or health-based `depends_on`
   - port conflicts
   - file permissions with non-root users and bind mounts
   - architecture mismatch (an arm64 Mac building amd64 images → use `--platform`/buildx)
   - memory limits

### What are the Kubernetes basics a full-stack developer should know?

- **Pod:** one or more containers sharing a network namespace and volumes; the smallest deployable unit, and ephemeral.
- **Deployment:** declarative replicas of pods with **rolling updates** and rollbacks. **StatefulSet** for stable identities (databases). **DaemonSet** for one pod per node (log agents).
- **Service:** a stable virtual IP and DNS name in front of pods (ClusterIP, NodePort, LoadBalancer). **Ingress / Gateway API** for HTTP routing, TLS and host/path rules.
- **ConfigMap / Secret** for config and secrets injected as env vars or files. External secret managers via operators.
- **Probes:**
  - **liveness** restarts a stuck container
  - **readiness** removes a pod from Service endpoints until it's ready, and during shutdown
  - **startup** gives slow-starting apps time
- **Resources:** requests and limits (scheduling, OOM). **HPA** autoscales on CPU or custom metrics (e.g. JVB stress).
- **Graceful termination:** SIGTERM → `terminationGracePeriodSeconds` → SIGKILL. A **preStop hook** plus readiness failing drains traffic, as covered in Node graceful shutdown.
- **Jitsi on Kubernetes:** JVBs often need `hostNetwork` or a dedicated UDP NodePort per pod, because media is UDP and IP-sensitive. That's a good talking point on the limits of K8s for real-time media.

## Microservices

### Monolith vs microservices: when would you choose each? 🔥

| | Monolith (or modular monolith) | Microservices |
|---|---|---|
| Deploy | One unit | **Independent deployments** per service |
| Team scaling | Harder with many teams (merge conflicts, coordinated releases) | **Teams own services end-to-end** |
| Scaling | Scale everything together | **Scale services independently** (e.g. JVBs vs Prosody vs Jibri) |
| Tech choice | One stack | Polyglot (Java JVB, Lua Prosody, Kotlin Jicofo, React web) |
| Complexity | Simple calls, transactions, debugging, local dev | **Distributed systems costs**: network failures, latency, eventual consistency, observability, versioning, ops overhead |
| Data | One database, ACID | **Database per service**; consistency through events and sagas |

**Senior answer:**

> "Start with a **well-modularised monolith** unless there's a clear driver: independent scaling, team autonomy, or fault isolation. Extract services along **bounded contexts** when the pain is real. Jitsi is a good example of microservices that make sense: signalling, focus control, media forwarding and recording have very different scaling and runtime needs."

### Which patterns make microservices reliable? 🔥

- **Timeouts on every remote call.** No timeout means one slow dependency exhausts your threads and connections.
- **Retries with exponential backoff + jitter**, only for **idempotent** operations or with **idempotency keys**.
- **Circuit breaker:** after repeated failures, **fail fast** for a cool-down period (open → half-open → closed), so you don't hammer a failing service and cascade the failure (resilience4j, opossum, Envoy).
- **Bulkheads:** isolate resources (separate pools or queues per dependency) so one failure doesn't sink everything.
- **Asynchronous messaging** (SQS, Kafka, RabbitMQ) for decoupling and load levelling.
  - **Transactional outbox** solves dual writes.
  - **Saga pattern** handles multi-service transactions: a sequence of local transactions with **compensating actions** (orchestrated by Step Functions or Temporal, or choreographed with events).
  - **Idempotent consumers** handle at-least-once delivery.
- **API gateway / BFF** as a single entry point (auth, routing, rate limiting, aggregation). **Service discovery** via DNS (K8s Services, Cloud Map).
- **Observability:** **distributed tracing** (OpenTelemetry trace context propagated through HTTP headers and message attributes), structured logs with correlation IDs, RED metrics (Rate, Errors, Duration) per service.
- **Contracts and versioning:** backward-compatible API changes, consumer-driven contract tests (Pact), schema registries for events.

```js
// Circuit breaker: fail fast while a dependency is unhealthy, probe it after a cool-down (runnable)
function circuitBreaker(fn, { failureThreshold = 3, coolDownMs = 100, now = () => Date.now() } = {}) {
  let state = 'closed';
  let failures = 0;
  let openedAt = 0;
  const breaker = async (...args) => {
    if (state === 'open') {
      if (now() - openedAt < coolDownMs) throw new Error('circuit open: failing fast');
      state = 'half-open';                         // allow one trial request
    }
    try {
      const result = await fn(...args);
      state = 'closed';
      failures = 0;
      return result;
    } catch (err) {
      failures++;
      if (state === 'half-open' || failures >= failureThreshold) {
        state = 'open';
        openedAt = now();
      }
      throw err;
    }
  };
  breaker.state = () => state;
  return breaker;
}

let healthy = false;
let calls = 0;
let clock = 0;
const recordingService = async () => { calls++; if (!healthy) throw new Error('503 from recording service'); return 'ok'; };
const call = circuitBreaker(recordingService, { failureThreshold: 3, coolDownMs: 100, now: () => clock });

const outcomes = [];
for (let i = 0; i < 6; i++) outcomes.push(await call().catch((e) => e.message));
console.log(outcomes, 'real calls made:', calls, 'state:', call.state());

clock += 150;                    // cool-down elapsed
healthy = true;                  // dependency recovered
outcomes.push(await call());     // half-open trial succeeds -> closed

test('opens after 3 failures, fails fast, then recovers', () => {
  expect(calls).toBe(4);                                   // 3 failures + 1 successful trial; 3 calls short-circuited
  expect(outcomes.filter((o) => o.includes('circuit open'))).toHaveLength(3);
  expect(call.state()).toBe('closed');
});
```

## CI/CD

### Explain CI/CD and deployment strategies 🔥

- **Continuous Integration:** every change is merged frequently into the main branch and verified automatically: install, lint, type-check, unit and integration tests, build, security scans.
- **Continuous Delivery:** every green build is **deployable** to production (manual approval). **Continuous Deployment:** it's **deployed automatically**.
- **Pipeline stages (frontend):**
  1. checkout → install (with a cache) → lint/format/type-check → unit tests with coverage → build
  2. bundle-size budget → E2E against a preview deployment → security scan (`npm audit`, Snyk, Trivy)
  3. publish artifacts or images → deploy to staging → smoke tests → deploy to production → post-deploy checks
- **Deployment strategies:**
  - **Rolling:** replace instances gradually. Simple, but old and new versions run at the same time.
  - **Blue-green:** two full environments, then switch traffic at once. Instant rollback, at double the cost.
  - **Canary:** send a small percentage of traffic to the new version, watch the metrics, then ramp up (Lambda alias weights, K8s with Argo Rollouts, CloudFront continuous deployment).
  - **Feature flags:** deploy dark, release gradually, kill switches. This decouples deploy from release.
  - **Rollback plan:** keep previous artifacts; database migrations must be **backward compatible** (the expand-and-contract pattern).

### Write a Jenkins declarative pipeline for a React app 🔥

```groovy
// Jenkinsfile (declarative) — React/Vite app with Yarn, tests, Docker image, deploy
pipeline {
  agent { docker { image 'node:22-alpine'; args '-v $HOME/.cache/yarn:/root/.cache/yarn' } }
  options { timestamps(); timeout(time: 30, unit: 'MINUTES'); disableConcurrentBuilds() }
  environment {
    CI = 'true'
    REGISTRY = '123456789012.dkr.ecr.us-east-1.amazonaws.com/meethour-web'
  }
  stages {
    stage('Install') { steps { sh 'yarn install --frozen-lockfile' } }
    stage('Quality') {
      parallel {
        stage('Lint')      { steps { sh 'yarn lint' } }
        stage('Typecheck') { steps { sh 'yarn tsc --noEmit' } }
        stage('Unit tests') {
          steps { sh 'yarn test --coverage --reporters=default --reporters=jest-junit' }
          post { always { junit 'reports/junit.xml' } }
        }
      }
    }
    stage('Build') { steps { sh 'yarn build' } }
    stage('Docker image') {
      when { branch 'main' }
      agent any
      steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ci']]) {
          sh '''
            aws ecr get-login-password | docker login --username AWS --password-stdin ${REGISTRY%/*}
            docker build -t $REGISTRY:$GIT_COMMIT .
            docker push $REGISTRY:$GIT_COMMIT
          '''
        }
      }
    }
    stage('Deploy to staging') {
      when { branch 'main' }
      steps { sh './scripts/deploy.sh staging $GIT_COMMIT' }
    }
    stage('Approve production') {
      when { branch 'main' }
      steps { input message: 'Deploy to production?', ok: 'Deploy' }
    }
    stage('Deploy to production') {
      when { branch 'main' }
      steps { sh './scripts/deploy.sh production $GIT_COMMIT' }
    }
  }
  post {
    failure { slackSend channel: '#web-builds', message: "❌ ${env.JOB_NAME} #${env.BUILD_NUMBER} failed: ${env.BUILD_URL}" }
    always { cleanWs() }
  }
}
```

**Jenkins concepts to mention:**

- **Declarative vs scripted** pipelines.
- **Agents/nodes**; Docker agents give reproducible environments.
- **Multibranch pipelines**, with PR builds discovered automatically.
- The **credentials store** (`withCredentials`).
- **Shared libraries** for reusable steps.
- `parallel` stages, `when` conditions, `post` actions, `input` for manual gates, artifacts and **JUnit reports**.

**Jenkins vs GitHub Actions:** Jenkins is self-hosted, highly flexible and plugin-heavy (maintenance burden). **GitHub Actions** is integrated with the repo, uses a marketplace of actions, hosted runners, and **OIDC to AWS without stored keys**.

```yaml
# .github/workflows/ci.yml — same idea in GitHub Actions
name: ci
on: { push: { branches: [main] }, pull_request: {} }
permissions: { id-token: write, contents: read }      # OIDC for AWS
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: yarn }
      - run: yarn install --frozen-lockfile
      - run: yarn lint && yarn tsc --noEmit && yarn test --coverage
      - run: yarn build
      - if: github.ref == 'refs/heads/main'
        uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: arn:aws:iam::123456789012:role/gh-deploy, aws-region: us-east-1 }
      - if: github.ref == 'refs/heads/main'
        run: aws s3 sync dist s3://meethour-web --delete && aws cloudfront create-invalidation --distribution-id E123 --paths /index.html
```

### How do you version releases automatically? (Conventional Commits and semver)

**Semantic versioning:** `MAJOR.MINOR.PATCH`. **Breaking** changes bump MAJOR, **features** bump MINOR, **fixes** bump PATCH.

**Conventional Commits** (`feat:`, `fix:`, `feat!:` or a `BREAKING CHANGE:` footer, plus `chore:`, `docs:`, `refactor:`) let tools (semantic-release, changesets, release-please) **compute the next version and generate changelogs** automatically.

```js
// Compute the next semver from conventional commit messages (what semantic-release does)
function nextVersion(current, commits) {
  let [major, minor, patch] = current.split('.').map(Number);
  const isBreaking = (m) => /^\w+(\([^)]*\))?!:/.test(m) || /BREAKING CHANGE:/.test(m);
  if (commits.some(isBreaking)) return `${major + 1}.0.0`;
  if (commits.some((m) => /^feat(\([^)]*\))?:/.test(m))) return `${major}.${minor + 1}.0`;
  if (commits.some((m) => /^(fix|perf)(\([^)]*\))?:/.test(m))) return `${major}.${minor}.${patch + 1}`;
  return current;                                         // chore/docs/test only: no release
}

test('semver bumps from commit types', () => {
  expect(nextVersion('2.4.1', ['docs: update README', 'chore: bump deps'])).toBe('2.4.1');
  expect(nextVersion('2.4.1', ['fix(recording): retry jibri start', 'docs: x'])).toBe('2.4.2');
  expect(nextVersion('2.4.1', ['feat(webinar): attendee Q&A', 'fix: typo'])).toBe('2.5.0');
  expect(nextVersion('2.4.1', ['feat(api)!: remove v1 endpoints'])).toBe('3.0.0');
  expect(nextVersion('2.4.1', ['refactor: x\n\nBREAKING CHANGE: config renamed'])).toBe('3.0.0');
});
```

## Git

### Merge vs rebase: when do you use each? 🔥

- **Merge** (`git merge feature`) creates a **merge commit** with two parents. It **preserves history exactly** and is non-destructive. History becomes non-linear (with "merge bubbles"). It's a **fast-forward** if the target hasn't diverged.
- **Rebase** (`git rebase main` on the feature branch) **replays your commits on top of** the target, **rewriting them** (new hashes). History is **linear and clean**, which makes bisecting easier.
- **The golden rule:** **never rebase commits that others have based work on** (shared or public branches). Rebase your **local or feature** branch before opening or updating a PR, then **force-push with `--force-with-lease`**, which refuses if someone else pushed in the meantime.
- **Squash merge** (the PR setting) gives one commit per PR on main: a clean history, but intermediate commits are lost from main.
- **Interactive rebase** (`git rebase -i`) cleans up local commits: squash fixups, reword messages, reorder, drop.
- **Team conventions matter more than dogma.** Pick one: squash merges, or rebase + merge commits.

### `reset` vs `revert` vs `restore`, and recovering lost work with `reflog` 🔥

- **`git revert <sha>`** creates a **new commit that undoes** a commit. It's **safe for shared branches** because history isn't rewritten. Use it to undo a bad change on `main`.
- **`git reset`** moves the **branch pointer** (rewrites history, local branches only):
  - `--soft`: keep changes **staged**
  - `--mixed` (the default): keep changes in the **working tree**, unstaged
  - `--hard`: **discard** changes (dangerous)
- **`git restore <file>`** discards working-tree changes to a file. `git restore --staged <file>` unstages it. These replace the overloaded `git checkout -- file`.
- **`git reflog`** is the log of where `HEAD` and branches have pointed (local, about 90 days). **It recovers "lost" commits** after a bad reset, rebase or branch deletion: `git reflog` → find the SHA → `git branch rescue <sha>` or `git reset --hard <sha>`.
- **`git stash`** (`push -m`, `pop`, `list`, `apply`) shelves work in progress. **`git cherry-pick <sha>`** applies a specific commit to another branch, e.g. hotfix backports.

### How do you find which commit introduced a bug? (`git bisect`) 🔥

**`git bisect`** performs a **binary search** through history:

1. `git bisect start`
2. `git bisect bad` (the current commit is broken)
3. `git bisect good v2.3.0` (the last known good tag)
4. Git checks out the midpoint. Test it, then mark it `good` or `bad`.
5. Repeat. It finds the culprit in **log₂(n) steps** (1,000 commits take about 10 steps).
6. **Automate it** with `git bisect run npm test -- --testPathPattern=recording`, and the script's exit code marks commits.
7. `git bisect reset` when you're done.

This is a great story when you mention debugging a regression in the MeetHour UI.

### Which branching strategies do you know? 🔥

- **Git Flow:** `main` + `develop` + feature, release and hotfix branches. Heavyweight; suits scheduled, versioned releases (desktop apps with release trains, e.g. Electron versions).
- **GitHub Flow:** short-lived feature branches off `main` → PR → review → merge → deploy. Simple, and fits continuous delivery of web apps.
- **Trunk-based development:** everyone integrates into `main` **at least daily**, with very short branches, **feature flags** for unfinished work, and release branches cut only if needed. Best for high-velocity teams with strong CI.
- **Conventions:**
  - protected main branch (required reviews and green checks)
  - **Conventional Commits**
  - signed commits
  - **pre-commit hooks** (Husky + lint-staged running ESLint and Prettier on staged files)
  - **CODEOWNERS**

### How do you resolve merge conflicts well?

1. Understand **both sides'** intent. Read the PRs or commits (`git log -p --merge`, or `git diff` with `diff3`/`zdiff3` conflict style to see the **common ancestor**).
2. Resolve **semantically**, not just syntactically. Run the tests and type-check afterwards.
3. Keep branches **short-lived** and rebase or merge `main` frequently to reduce conflicts. Split big refactors from feature work.
4. Use `git rerere` to reuse recorded resolutions for repeated conflicts during long rebases.
5. Lockfile conflicts: regenerate the lockfile (`yarn install`) instead of hand-editing it.

## Linux & Nginx

### Which Linux commands do you use to debug a server? 🔥

| Need | Commands |
|---|---|
| Processes and CPU | `top`/`htop`, `ps aux --sort=-%cpu \| head`, `pgrep -fa node`, `kill -TERM <pid>` |
| Memory | `free -h`, `vmstat 1`, `dmesg -T \| grep -i oom` (OOM killer) |
| Disk | `df -h` (full disks break recordings and logs), `du -sh /var/log/* \| sort -h`, `iostat` |
| Network and ports | `ss -tulpn` (what is listening where), `curl -v`/`curl -I`, `dig`/`nslookup`, `ping`, `traceroute`/`mtr`, `nc -zv host 443`, `nc -u` for UDP, `tcpdump -i any udp port 10000` (is media arriving at the JVB?) |
| Logs | `journalctl -u prosody -f --since "10 min ago"`, `tail -f /var/log/nginx/error.log`, `grep -E "ERROR\|WARN"`, `less +F` |
| Services | `systemctl status/restart/enable jitsi-videobridge2`, `systemctl list-units --failed` |
| Files and permissions | `ls -la`, `chmod 640 file`, `chown app:app`, `find / -name "*.log" -mtime +7`, `lsof -i :443`, `lsof +D /dir` |
| Text processing | `grep`, `awk '{print $1}'`, `sed -i 's/old/new/'`, `sort \| uniq -c \| sort -nr`, `jq` for JSON |
| Remote | `ssh -L 5432:localhost:5432 host` (port forwarding), `scp`/`rsync -avz` |

**Example: top client IPs hitting Nginx:** `awk '{print $1}' access.log | sort | uniq -c | sort -nr | head`.

```js
// Linux permission bits: symbolic <-> octal (chmod 750 = rwxr-x---)
function toOctal(symbolic) {
  return symbolic.match(/.{3}/g).map((t) => (t[0] === 'r' ? 4 : 0) + (t[1] === 'w' ? 2 : 0) + (t[2] === 'x' ? 1 : 0)).join('');
}
function toSymbolic(octal) {
  return [...String(octal)].map((d) => ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'][Number(d)]).join('');
}
console.log(toOctal('rwxr-x---'), toSymbolic(644), toSymbolic(600));

test('permission conversions', () => {
  expect(toOctal('rw-r--r--')).toBe('644');
  expect(toSymbolic(755)).toBe('rwxr-xr-x');
  expect(toSymbolic(640)).toBe('rw-r-----');   // e.g. a private key readable by its group (prosody certs)
});
```

### Configure Nginx as a reverse proxy for a SPA + API + WebSocket (Jitsi-style) 🔥

```nginx
upstream api_backend {
    least_conn;
    server api1:3000 max_fails=3 fail_timeout=10s;
    server api2:3000 max_fails=3 fail_timeout=10s;
    keepalive 32;
}

map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl http2;
    server_name meet.example.com;
    ssl_certificate     /etc/letsencrypt/live/meet.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meet.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;

    root /usr/share/nginx/html;
    gzip on; gzip_types text/css application/javascript application/json image/svg+xml;

    # Hashed static assets: cache forever
    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; try_files $uri =404; }

    # API reverse proxy
    location /api/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    # XMPP over WebSocket to Prosody (Jitsi) — Upgrade headers + long timeouts
    location = /xmpp-websocket {
        proxy_pass http://prosody:5280/xmpp-websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 900s;
    }

    # Bridge channel WebSocket to the videobridge
    location ~ ^/colibri-ws/([a-zA-Z0-9-\._]+)/(.*) {
        proxy_pass http://jvb:9090/colibri-ws/$1/$2$is_args$args;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 900s;
    }

    # SPA fallback: unknown paths -> index.html (never cached)
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

**Key points:**

- **TLS termination** at Nginx.
- **Upgrade/Connection headers** for WebSockets, with **long read timeouts** for idle sockets.
- **Upstream load balancing** (round robin, `least_conn`, `ip_hash` for stickiness) with keepalive to upstreams.
- **`try_files` SPA fallback.**
- Cache headers per asset type, compression, security headers.
- **`X-Forwarded-*`** so the app knows the real client IP and protocol (and configure the app to trust the proxy).
- Optional: rate limiting (`limit_req_zone`), request size limits (`client_max_body_size`) for uploads.

### "The site is down." Walk me through your troubleshooting 🔥

1. **Scope:** everyone, or some users? All pages, or one feature? When did it start? Was there a **recent deploy or config change**? (Correlate with the deploy log, and roll back if in doubt.)
2. **Outside-in checks:**
   - DNS (`dig`), TLS certificate expiry (`curl -vI`)
   - CDN or load balancer health
   - status pages of cloud providers
3. **Edge and proxy:** Nginx/ALB logs (4xx vs 5xx, 502 = upstream down, 504 = upstream timeout), and whether upstreams are healthy.
4. **App:**
   - container or pod status and restarts (OOM 137)
   - app logs and error tracking (Sentry spikes)
   - metrics (CPU, memory, event-loop lag, error rate, latency)
5. **Dependencies:**
   - database (connections exhausted? slow queries? locks?)
   - cache, third-party APIs
   - **disk full** (`df -h`, a classic for log-heavy services and Jibri recordings)
6. **Mitigate first** (roll back, scale out, fail over, feature-flag off), **then** find the root cause. **Communicate** status regularly.
7. **Postmortem:** a blameless timeline, root cause, action items (alerts, tests, runbooks).
