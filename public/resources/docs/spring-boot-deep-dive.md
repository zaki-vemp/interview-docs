# Spring Boot, Spring Security & Hibernate Deep Dive

For Java/Kotlin backend roles, **Spring Boot is the job**. [Java & Spring Boot](/docs/java) covers the basics: DI, a REST controller, `@Transactional` pitfalls, N+1, JWT security. This doc goes as deep as senior interviews go:

- **The container:** how it starts, the bean lifecycle, and AOP proxies.
- **Auto-configuration and configuration binding.**
- **The request pipeline:** MVC internals, WebFlux vs virtual threads, HTTP clients and resilience.
- **Spring Security's architecture**, JWT resource servers and OIDC login.
- **Hibernate:** the persistence context, dirty checking, fetching, mapping, locking, batching.
- **Transaction propagation**, including the infamous `UnexpectedRollbackException`.
- **Testing slices, Testcontainers and deployment.**

Everything here applies to **Kotlin + Spring** too. See [Kotlin Deep Dive](/docs/kotlin-deep-dive) for the Kotlin-specific gotchas.

> Java code isn't runnable here. **Hibernate's persistence context with dirty checking** and **Spring's transaction propagation semantics** are simulated in **runnable JavaScript with tests**, because those behaviours surprise even experienced developers.

## Spring core

### What happens when a Spring `ApplicationContext` starts? Walk through the bean lifecycle 🔥

**Context startup** (`refresh()`), simplified:

1. **Bean definitions are loaded:** component scanning (`@Component`, `@Service`, `@Repository`, `@Controller`), `@Configuration` classes with `@Bean` methods, and **auto-configuration** imports. Definitions are recipes, not objects yet.
2. **`BeanFactoryPostProcessor`s run.** They modify the **definitions**. For example, `ConfigurationClassPostProcessor` parses `@Configuration`, `@Import` and `@Bean`, and property placeholder resolution happens here.
3. **`BeanPostProcessor`s are registered.** They will act on **instances**.
4. **Non-lazy singletons are instantiated**, each going through the lifecycle below.
5. `SmartLifecycle` beans start (embedded web server, message listeners), then `ContextRefreshedEvent` and `ApplicationReadyEvent` fire.

**The lifecycle of each bean:**

```text
instantiate (constructor injection happens here)
 → populate properties (field/setter @Autowired, @Value)        ← AutowiredAnnotationBeanPostProcessor
 → Aware callbacks (BeanNameAware, ApplicationContextAware…)
 → BeanPostProcessor.postProcessBeforeInitialization
 → @PostConstruct → InitializingBean.afterPropertiesSet → custom init-method
 → BeanPostProcessor.postProcessAfterInitialization             ← AOP PROXIES are created here
 → (bean in use)
 → @PreDestroy → DisposableBean.destroy → custom destroy-method  (on context close)
```

**Why this matters:**

- **The object in the container is often a proxy, not your class.** `@Transactional`, `@Async`, `@Cacheable`, `@PreAuthorize` and `@Validated` all work through proxies created in the *after-initialisation* step. Calling `this.method()` bypasses them.
- `@PostConstruct` runs **before** proxying, so transactional calls made from `@PostConstruct` aren't transactional. Use `ApplicationReadyEvent` listeners for startup work that needs proxies or transactions.
- **Fail fast:** singletons are created at startup, so misconfiguration shows up immediately rather than on the first request. `@Lazy` defers creation, but hides errors.

### Which injection style should you use, and how do you handle multiple implementations? 🔥

**Prefer constructor injection:**

- Dependencies are `final`, so the bean is **immutable** and always **fully initialised**.
- It's trivial to unit test with `new Service(fakeRepo)`.
- A huge constructor makes too many dependencies obvious (an SRP smell).
- With a single constructor, `@Autowired` isn't needed.
- **Field injection** hides dependencies and needs reflection or a container in tests.

**Choosing between beans of the same type:**

```java
@Service
public class RecordingService {
    private final StorageClient storage;
    private final Map<String, RecordingStrategy> strategies;     // ALL beans of the type, keyed by bean name
    private final ObjectProvider<AuditPublisher> audit;           // optional / lazy / prototype access

    public RecordingService(@Qualifier("s3Storage") StorageClient storage,
                            Map<String, RecordingStrategy> strategies,
                            ObjectProvider<AuditPublisher> audit) {
        this.storage = storage;
        this.strategies = strategies;
        this.audit = audit;
    }

    public void start(Meeting m) {
        strategies.getOrDefault(m.mode().beanName(), strategies.get("fileRecording")).start(m);   // strategy pattern via DI
        audit.ifAvailable(a -> a.recordingStarted(m.id()));
    }
}
```

| Tool | Use |
|---|---|
| `@Primary` | The default bean when several exist |
| `@Qualifier("name")`, or custom qualifier annotations | Pick a specific bean |
| Inject a `List<T>` or `Map<String, T>` | Get all implementations (plugins, strategies). `@Order` sorts the list |
| `ObjectProvider<T>` / `Optional<T>` | Optional dependencies, lazy access, a fresh prototype per call |
| `@ConditionalOnProperty` on beans | Choose implementations by configuration |

**Circular dependencies:**

- Spring Boot 2.6+ **fails on circular references by default**, and constructor injection makes cycles impossible anyway.
- Fix the design: extract a third bean, or use events.
- `@Lazy` on one constructor parameter (injecting a lazy proxy) is a band-aid.

### Bean scopes: what goes wrong when you inject a prototype into a singleton?

| Scope | Instances |
|---|---|
| **singleton** (default) | One per container. **Must be thread-safe**: no mutable per-request fields |
| prototype | A new instance **every time it's requested from the container** |
| request / session / application | Per HTTP request, session, or `ServletContext` (web only; injected through scoped proxies) |

**The trap:**

- A prototype injected into a singleton's constructor is created **once**, when the singleton is created.
- So the singleton keeps **the same "prototype" forever**.

**Fixes:**

- `ObjectProvider<Proto>.getObject()` per use.
- `@Lookup` method injection.
- A scoped proxy (`@Scope(value = "prototype", proxyMode = ScopedProxyMode.TARGET_CLASS)`).

**Thread-safety rule:** singleton services hold **only immutable configuration and thread-safe collaborators**. Per-request state lives in method locals, the request, or a `ThreadLocal`/`ScopedValue`, never in fields.

### `@Configuration` vs `@Component` with `@Bean` methods: what's the difference?

**`@Configuration` classes are CGLIB-proxied** (`proxyBeanMethods = true` by default):

- Calling another `@Bean` method **from inside** the configuration class returns the **container's singleton**, not a new object.

```java
@Configuration
public class StorageConfig {
    @Bean S3Client s3() { return S3Client.create(); }
    @Bean RecordingStore store() { return new RecordingStore(s3()); }    // s3() → the SAME singleton (intercepted)
}
```

**In "lite mode"** (`@Component` with `@Bean` methods, or `@Configuration(proxyBeanMethods = false)`):

- `s3()` is a plain Java call, so a **second, unmanaged instance** is created.
- Lite mode is used by Boot's own auto-configurations for **faster startup** and GraalVM friendliness. They inject dependencies as **method parameters** instead (`@Bean RecordingStore store(S3Client s3)`), which works in both modes.

### How does Spring AOP work? Write a timing aspect 🔥

**Spring AOP is proxy-based:**

- **Advice** is wrapped around **method calls on beans** that go **through the proxy**.
- **Pointcuts** select the methods (AspectJ expression syntax).

```java
@Aspect
@Component
@Order(1)                                              // ordering among aspects (lower = outer)
public class TimingAspect {
    private final MeterRegistry meters;
    public TimingAspect(MeterRegistry meters) { this.meters = meters; }

    @Around("@annotation(timed)")                      // methods annotated with @Timed (our custom annotation)
    public Object time(ProceedingJoinPoint pjp, Timed timed) throws Throwable {
        long start = System.nanoTime();
        try {
            return pjp.proceed();                      // call the real method (or the next advice)
        } finally {
            meters.timer(timed.value(), "method", pjp.getSignature().toShortString())
                  .record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
        }
    }

    @AfterThrowing(pointcut = "within(com.meethour.recording..*)", throwing = "ex")
    public void logFailure(JoinPoint jp, Exception ex) {
        log.warn("recording op {} failed: {}", jp.getSignature().getName(), ex.getMessage());
    }
}
```

**Advice types:** `@Before`, `@AfterReturning`, `@AfterThrowing`, `@After` (finally), and `@Around` (the most powerful: control whether and how to proceed).

**Limitations of proxy-based AOP:**

- **Self-invocation** (`this.x()`) isn't intercepted.
- **`private`, `final` and `static` methods** aren't intercepted (CGLIB subclasses can't override them).
- **Only Spring beans** are advised. `new MyService()` isn't.

**Full AspectJ weaving** (compile-time or load-time) removes these limits but adds build complexity. It's rarely needed.

**Advice ordering and transactions:** the `@Transactional` interceptor is itself an aspect. If your aspect must run *inside* the transaction (to see uncommitted data, for example), order it after the transaction advisor.

### How do Spring application events work, and why use `@TransactionalEventListener`?

```java
public record RecordingFinished(long recordingId, long meetingId) {}

@Service
class RecordingService {
    private final ApplicationEventPublisher events;
    @Transactional
    public void finish(long id) {
        Recording r = repo.markReady(id);
        events.publishEvent(new RecordingFinished(r.id(), r.meetingId()));   // listeners run synchronously by default
    }
}

@Component
class RecordingNotifications {
    // Runs only AFTER the surrounding transaction COMMITS: never email about data that rolled back
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Async                                                                  // and off the request thread
    public void onFinished(RecordingFinished e) { mailer.sendRecordingReady(e.meetingId()); }
}
```

**Semantics to remember:**

- **`@EventListener` is synchronous, in the publisher's thread and transaction.** An exception in a listener propagates to the publisher.
- **`@TransactionalEventListener`** binds to transaction phases: `AFTER_COMMIT` (the default), `AFTER_ROLLBACK`, `AFTER_COMPLETION`, `BEFORE_COMMIT`. If no transaction is active, the event is **dropped**, unless you set `fallbackExecution = true`.
- Events are **in-memory**: lost on a crash after commit. For guaranteed delivery to other services, use the **transactional outbox** (see [Transactions & Locking](/docs/db-transactions-locking)). Spring Modulith offers an event publication registry for this.

## Spring Boot

### How does Spring Boot auto-configuration work? 🔥

**`@SpringBootApplication`** = `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`.

**How it works:**

1. **`@EnableAutoConfiguration`** loads the auto-configuration classes listed in **`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`** in every JAR on the classpath. This replaced `spring.factories` for auto-configuration in Boot 2.7/3.
2. Each auto-configuration is guarded by **conditions**:

| Condition | Example |
|---|---|
| `@ConditionalOnClass(DataSource.class)` | Only if the JDBC classes are on the classpath (the starter added them) |
| **`@ConditionalOnMissingBean`** | **Back off if the user defined their own bean.** This is how you override Boot's defaults |
| `@ConditionalOnProperty("spring.cache.type")` | Toggled by configuration |
| `@ConditionalOnWebApplication`, `@ConditionalOnBean`, `@ConditionalOnResource` | Environment-specific |

3. **Starters** (`spring-boot-starter-web`, `-data-jpa`, `-security`) are dependency bundles: they put classes on the classpath, which trips the conditions.

**Debugging "why is this bean (not) there?":**

- Run with `--debug` (or `debug=true`) to print the **conditions evaluation report**.
- Or use `/actuator/conditions`.
- Exclude an auto-configuration with `@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)` or `spring.autoconfigure.exclude`.

**Writing your own starter** (for example a shared `meethour-observability-starter`):

1. Create an `@AutoConfiguration` class with `@ConditionalOnMissingBean` beans and `@ConfigurationProperties`.
2. Register it in the `.imports` file.
3. Optionally add a `-starter` POM that pulls in the dependencies.

### How does Spring Boot externalised configuration work? 🔥

**Precedence (highest first, simplified):**

1. Command-line arguments (`--server.port=9090`).
2. `SPRING_APPLICATION_JSON`.
3. **OS environment variables** (`SERVER_PORT`, `SPRING_DATASOURCE_URL`: **relaxed binding** maps them to `server.port`).
4. Profile-specific files outside the JAR, then inside it (`application-prod.yml`).
5. `application.yml` / `.properties` outside the JAR, then inside it.
6. `@PropertySource`, then defaults.

**Prefer type-safe `@ConfigurationProperties` over scattered `@Value`:**

```java
@ConfigurationProperties(prefix = "recording")
@Validated
public record RecordingProperties(
        @NotBlank String bucket,
        @DurationUnit(ChronoUnit.SECONDS) Duration maxDuration,
        @Min(1) @Max(20) int maxConcurrentPerNode,
        Map<String, String> tags) {}

// application.yml
// recording:
//   bucket: meethour-recordings-prod
//   max-duration: 14400          # relaxed binding: kebab-case in YAML → camelCase field
//   max-concurrent-per-node: 4
```

**Practices:**

- Enable binding with `@ConfigurationPropertiesScan`.
- **Validate at startup.** Records make immutable configuration easy.
- **Profiles:** `spring.profiles.active=prod`, `@Profile("!test")`. Profile **groups** combine several.
- **Don't keep secrets in YAML in git.** Use env vars from a secret manager, `spring.config.import=aws-secretsmanager:…`, `vault://`, or Kubernetes Secrets mounted as files (`configtree:`).
- `@RefreshScope` (Spring Cloud) for runtime changes, or restart the pods.

### Walk through how Spring MVC handles a request 🔥

```text
Servlet container (Tomcat thread, or a virtual thread)
 → Servlet Filters (FilterChain)                    e.g. Spring Security's FilterChainProxy, CORS, request logging
 → DispatcherServlet
    → HandlerMapping (RequestMappingHandlerMapping) finds the @RequestMapping method
    → HandlerInterceptor.preHandle                  e.g. tenant resolution, locale, rate limit checks
    → HandlerAdapter invokes the controller method
        → HandlerMethodArgumentResolvers            @PathVariable, @RequestParam, @RequestBody (HttpMessageConverter: Jackson),
                                                    @AuthenticationPrincipal, Pageable
        → @Valid validation (MethodArgumentNotValidException on failure)
        → controller → services (through AOP proxies)
        → HandlerMethodReturnValueHandlers          ResponseEntity / object → HttpMessageConverter → JSON
    → HandlerInterceptor.postHandle / afterCompletion
    → HandlerExceptionResolvers                     @ExceptionHandler / @ControllerAdvice → ProblemDetail
 → Filters (response path)
```

**Filter vs interceptor vs AOP:**

| Mechanism | Level | Sees | Use for |
|---|---|---|---|
| **Servlet Filter** | Servlet, before Spring MVC | Raw request and response | Security, CORS, compression, request ids, logging bodies |
| **HandlerInterceptor** | Spring MVC | The handler (which controller method) | Per-controller concerns (tenant, locale, audit by handler) |
| **AOP** | Any bean method | Method arguments and results | Cross-cutting **business** concerns (timing, transactions, authorisation) |

### How do you implement validation and global error handling with ProblemDetail? 🔥

```java
public record ScheduleMeetingRequest(
        @NotBlank @Size(max = 200) String title,
        @NotNull @Future Instant startsAt,
        @Min(5) @Max(1440) int durationMin,
        @Valid List<@Email String> invitees) {}

@RestController
@RequestMapping("/api/meetings")
@Validated
class MeetingController {
    @PostMapping
    ResponseEntity<MeetingDto> schedule(@Valid @RequestBody ScheduleMeetingRequest req, @AuthenticationPrincipal Jwt jwt) {
        MeetingDto dto = service.schedule(req, jwt.getSubject());
        return ResponseEntity.created(URI.create("/api/meetings/" + dto.id())).body(dto);
    }
}

@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {          // standard Spring MVC exceptions → ProblemDetail
    @ExceptionHandler(MeetingNotFoundException.class)
    ProblemDetail notFound(MeetingNotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setType(URI.create("https://api.meethour.example/problems/meeting-not-found"));
        return pd;
    }
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    ProblemDetail conflict() {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "The meeting was modified by someone else. Reload and retry.");
    }
}
```

**Details:**

- Set `spring.mvc.problemdetails.enabled=true` for built-in RFC 9457 responses.
- **Custom constraints:** an `@interface ValidTimeRange` plus a `ConstraintValidator`, for cross-field rules like "end after start".
- **Validation groups** (`@Validated(OnCreate.class)`) apply different rules for create and update.
- `@Validated` on a class enables **method-parameter validation** (`ConstraintViolationException`).
- **Never return stack traces.** Log with a trace id and return the id in the problem.

### Spring MVC vs WebFlux vs virtual threads: which do you choose? 🔥

| | **Spring MVC (thread per request)** | **Spring WebFlux (reactive)** | **MVC + virtual threads** (Boot 3.2+) |
|---|---|---|---|
| Model | Blocking I/O; each request holds a thread | **Non-blocking** event loop (Netty); `Mono`/`Flux` with backpressure | Blocking code; each request gets a **cheap virtual thread** |
| Scalability limit | Platform thread count (~200 Tomcat threads by default) | Very high concurrency with few threads | Very high concurrency (I/O-bound) |
| Code style | Simple, imperative, easy to debug | Reactive operators; harder stack traces; **one blocking call ruins the event loop** | **Simple imperative code** |
| Data access | JDBC/JPA | **R2DBC** or reactive drivers (JPA is blocking) | JDBC/JPA (watch the pool size) |
| Best for | Most CRUD services | Streaming (SSE and WebSockets at scale), gateways (Spring Cloud Gateway), backpressure-heavy pipelines | **The new default for I/O-heavy services**: high concurrency without reactive complexity |

**Interview answer:** "With virtual threads, most services stay on MVC with simple blocking code. I'd pick WebFlux for streaming-heavy or gateway workloads, or where the whole stack is already reactive. I'd also cap downstream concurrency (Hikari pool, semaphores), since virtual threads remove the old accidental limit."

```yaml
spring:
  threads:
    virtual:
      enabled: true          # Tomcat request handling, @Async, schedulers on virtual threads (Boot 3.2+)
```

### What does Actuator give you, and how do you set up observability? 🔥

**Actuator endpoints:**

| Endpoint | Purpose |
|---|---|
| `/actuator/health`, plus **`/health/liveness`** and **`/health/readiness`** groups | Kubernetes probes. Readiness includes DB and broker checks; liveness doesn't |
| `/actuator/metrics`, **`/actuator/prometheus`** | **Micrometer** metrics: JVM, GC, HTTP server requests (with percentile histograms), Hikari pool, executor, cache, custom |
| `/actuator/info` | Build and git info |
| `/actuator/loggers` | **Change log levels at runtime** |
| `/actuator/threaddump`, `/heapdump` | Diagnostics. **Secure or disable these!** |
| `/actuator/conditions`, `/beans`, `/env`, `/configprops` | Debugging configuration (they expose secrets unless sanitised) |

**Tracing:**

- **Micrometer Tracing** (the successor to Sleuth) with an OpenTelemetry bridge gives W3C `traceparent` propagation.
- Trace ids appear in logs (MDC) automatically, and RestClient/WebClient/Kafka are instrumented.

**Security:**

- Expose only what you need (`management.endpoints.web.exposure.include=health,info,prometheus`).
- Serve actuator on a **separate management port** that isn't routed publicly.
- Require authentication for everything except the probes.

### What changed in Spring Boot 3 and 4 that you should know? 🔥

**Spring Boot 3 / Spring Framework 6** (from November 2022):

- **Java 17 baseline.**
- **Jakarta EE 9+**: `javax.*` became **`jakarta.*`** (`jakarta.persistence`, `jakarta.servlet`, `jakarta.validation`). This is the big migration step. Use **OpenRewrite** recipes to automate it.
- **GraalVM native image** support through AOT processing at build time.
- **Observability with Micrometer** (Observation API, Micrometer Tracing).
- **`ProblemDetail`** (RFC 7807, now RFC 9457) responses.
- **HTTP interface clients:** `@HttpExchange` declarative clients.
- **`RestClient`** (6.1): a modern synchronous fluent client, replacing `RestTemplate` usage.
- **Virtual threads** (3.2).
- **`@ServiceConnection`** with Testcontainers (3.1), and Docker Compose support for development.
- **CRaC** checkpoint/restore support (3.2).

**Spring Boot 4 / Spring Framework 7** (November 2025). Headline themes:

- Java 17 still the baseline, with **Java 25** support.
- **Jakarta EE 11.**
- **JSpecify null-safety annotations** across the portfolio (great for Kotlin interop).
- **First-class API versioning** in Spring MVC and WebFlux.
- **Jackson 3.**
- **Resilience annotations** (`@Retryable`, `@ConcurrencyLimit`) in core.
- Improved HTTP service clients.
- **More modular auto-configuration.**

Check the release notes before a migration. Interviewers mostly want to know you're aware of the direction (null-safety, versioning, modularisation) and of the `jakarta` move.

### How do you call other services from Spring, and make those calls resilient? 🔥

| Client | Status | Notes |
|---|---|---|
| `RestTemplate` | Maintenance mode | Still common in legacy code |
| **`RestClient`** (6.1+) | **Recommended for synchronous calls** | Fluent API, the same converters and interceptors as RestTemplate, works great with virtual threads |
| `WebClient` | Reactive | Non-blocking. Use it in WebFlux apps, or for concurrent fan-out without virtual threads |
| **`@HttpExchange` interfaces** | Declarative | Spring-native alternative to OpenFeign, backed by RestClient or WebClient |
| OpenFeign (Spring Cloud) | Declarative | Popular in Spring Cloud stacks |

```java
@HttpExchange("/v1/recordings")
public interface RecordingApi {
    @PostExchange RecordingDto start(@RequestBody StartRecording cmd);
    @GetExchange("/{id}") RecordingDto get(@PathVariable String id);
}

@Bean
RecordingApi recordingApi(RestClient.Builder builder) {
    var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
    factory.setReadTimeout(Duration.ofSeconds(5));                         // ALWAYS set timeouts
    RestClient client = builder.baseUrl("https://recording.internal").requestFactory(factory).build();
    return HttpServiceProxyFactory.builderFor(RestClientAdapter.create(client)).build().createClient(RecordingApi.class);
}

// Resilience4j via annotations (Spring Boot starter)
@CircuitBreaker(name = "recording", fallbackMethod = "recordingUnavailable")
@Retry(name = "recording")                    // only idempotent operations, or with idempotency keys!
@Bulkhead(name = "recording")
public RecordingDto startRecording(StartRecording cmd) { return recordingApi.start(cmd); }
private RecordingDto recordingUnavailable(StartRecording cmd, Throwable t) { throw new ServiceUnavailableException("Recording is temporarily unavailable"); }
```

**Resilience4j modules:**

- **CircuitBreaker:** failure-rate or slow-call-rate thresholds, sliding windows, half-open trial calls.
- **Retry:** backoff, retrying only certain exceptions.
- **Bulkhead:** semaphore or thread-pool isolation.
- **RateLimiter.**
- **TimeLimiter.**

The **order of decorators** matters: Retry wraps CircuitBreaker, which wraps the call. Metrics are exported via Micrometer.

### How do `@Async` and `@Scheduled` work, and what goes wrong in clusters?

**`@Async`** (with `@EnableAsync`):

- The method runs on a `TaskExecutor` through a **proxy**, so self-invocation doesn't work.
- Return `CompletableFuture<T>` to get results and propagate errors. `void` methods' exceptions go to the `AsyncUncaughtExceptionHandler` (often unnoticed).
- **Configure the executor.** Recent Boot versions auto-configure a `ThreadPoolTaskExecutor` (or virtual threads, if enabled). Set the queue size and rejection policy deliberately.
- **Context propagation:** the security context, MDC and trace ids don't follow automatically. Use `TaskDecorator` or Micrometer context propagation.

**`@Scheduled`** (with `@EnableScheduling`):

- `fixedRate`, `fixedDelay` and `cron` (with a `zone`!).
- **Runs on every instance.** With 4 pods, the job runs 4 times.
- **Fixes:**
  - **ShedLock** (a lock row in the DB or Redis, with `lockAtMostFor`).
  - Kubernetes CronJobs.
  - Quartz in clustered mode (a JDBC job store).
  - An external scheduler (EventBridge) calling an endpoint or queue.
- **Default scheduler:** **a single thread** in older Boot defaults, so one slow job delays every other job. Configure `spring.task.scheduling.pool.size`, or use virtual threads.

## Spring Security

### Explain Spring Security's architecture 🔥

```text
Servlet container
 → DelegatingFilterProxy (a servlet filter bridging to the Spring bean)
   → FilterChainProxy
     → picks the FIRST SecurityFilterChain whose matcher matches the request (e.g. /api/** vs /admin/**)
       → ordered security filters:
          CorsFilter → CsrfFilter → LogoutFilter →
          authentication filters (BearerTokenAuthenticationFilter, UsernamePasswordAuthenticationFilter, OAuth2LoginAuthenticationFilter…) →
          SecurityContextHolderFilter / session management →
          ExceptionTranslationFilter (401 entry point / 403 access denied) →
          AuthorizationFilter (URL rules)
     → your controller (method security @PreAuthorize runs as AOP on beans)
```

**Core types:**

| Type | Role |
|---|---|
| **`SecurityContextHolder`** | Holds the current `Authentication`. **ThreadLocal** by default, so new threads don't get it (`@Async` needs propagation) |
| **`Authentication`** | The principal, credentials and **`GrantedAuthority`s** (roles = `ROLE_` prefix, scopes = `SCOPE_` prefix) |
| `AuthenticationManager` → `AuthenticationProvider`s | Verify credentials (DAO + `UserDetailsService`, JWT, LDAP, OAuth2) |
| **`PasswordEncoder`** | **BCrypt / Argon2 / PBKDF2**. `DelegatingPasswordEncoder` stores `{bcrypt}$2a$…` so the algorithm can be upgraded later |
| `AuthorizationManager` | Decides access for URLs (`requestMatchers`) and methods |

**Modern (6.x) configuration is component-based:** declare a `SecurityFilterChain` bean (the old `WebSecurityConfigurerAdapter` was removed), and use the lambda DSL.

### Configure a stateless JWT resource server (Azure AD/Entra ID or Cognito) 🔥

```java
@Configuration
@EnableMethodSecurity                                  // enables @PreAuthorize / @PostAuthorize
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/api/**")
            .csrf(csrf -> csrf.disable())                         // stateless bearer tokens: no cookies, so no CSRF risk
            .cors(Customizer.withDefaults())                      // uses a CorsConfigurationSource bean
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/meetings/**").hasAuthority("SCOPE_meetings.write")
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(rolesConverter())))
            .build();
    }

    // Map IdP claims (Azure AD "roles", Cognito "cognito:groups") to Spring authorities
    private JwtAuthenticationConverter rolesConverter() {
        var scopes = new JwtGrantedAuthoritiesConverter();         // "scp"/"scope" → SCOPE_x
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Collection<GrantedAuthority> out = new ArrayList<>(scopes.convert(jwt));
            List<String> roles = Optional.ofNullable(jwt.getClaimAsStringList("roles")).orElse(List.of());
            roles.forEach(r -> out.add(new SimpleGrantedAuthority("ROLE_" + r.toUpperCase())));
            return out;
        });
        return converter;
    }
}
```

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://login.microsoftonline.com/<tenant-id>/v2.0   # discovers the JWKS; validates iss + exp + signature
          audiences: api://meethour-api                                    # validate aud (Boot 3.2+)
```

**What the resource server validates:**

- The **signature** against the issuer's **JWKS** (keys are cached and rotated automatically).
- **`exp`/`nbf`**, **`iss`** and **`aud`**.
- **Algorithm pinning** comes from the keys.

**CSRF decision:**

- **Disable it only for stateless, header-token APIs.**
- **Cookie-based sessions** (a BFF, or server-rendered pages) **need CSRF protection**. Spring's SPA support uses the `CookieCsrfTokenRepository` + `X-XSRF-TOKEN` pattern.

### How do OAuth2 login (OIDC SSO) and the BFF pattern work in Spring Security?

**`spring-boot-starter-oauth2-client`** with `.oauth2Login()` implements the **authorization code flow with PKCE** against Azure AD (Entra ID), Okta, Google or Cognito:

1. The user is redirected to the IdP and authenticates there (SSO).
2. The IdP redirects back with a code, which Spring exchanges for **ID and access tokens**.
3. Spring creates a server-side session and sets an `HttpOnly` session cookie.
4. The tokens are stored server-side (`OAuth2AuthorizedClientService`), and **refreshed automatically** when calling downstream APIs through `WebClient`/`RestClient` with the OAuth2 filter or interceptor.

**This is the Backend-for-Frontend pattern:**

- **The browser never holds tokens.** The React SPA talks to the BFF with a cookie, and the BFF calls APIs with tokens. It's now the recommended architecture for browser apps (the OAuth 2.0 for Browser-Based Apps guidance).
- **Spring Cloud Gateway** can act as the BFF, with the `TokenRelay` filter.

**Relating it to scQuill (Azure AD SSO):**

- "We integrated Azure AD for SSO. Server-side, Spring maps **app roles or groups claims** to authorities and enforces them per endpoint."
- *[Adjust: if scQuill used MSAL in the browser with a Node or other backend, say exactly that.]*

### How do you implement method-level and object-level authorisation? 🔥

**URL rules aren't enough.** "Is this user allowed to touch **this** meeting?" is **object-level authorisation**. It's the #1 API vulnerability (BOLA/IDOR).

```java
@Service
public class MeetingService {
    @PreAuthorize("hasRole('ADMIN') or @meetingAuthz.isHost(#meetingId, authentication)")
    public void endMeeting(long meetingId) { … }

    @PostAuthorize("returnObject.orgId() == authentication.principal.claims['org_id']")    // check after loading
    public MeetingDto get(long meetingId) { … }
}

@Component("meetingAuthz")
class MeetingAuthz {
    private final MeetingRepository repo;
    MeetingAuthz(MeetingRepository repo) { this.repo = repo; }
    public boolean isHost(long meetingId, Authentication auth) {
        return repo.existsByIdAndHostId(meetingId, auth.getName());   // a cheap existence query
    }
}
```

**Best practices:**

- **Scope queries by tenant** at the repository level: `findByIdAndOrgId(id, currentOrg())`. A missing match returns **404**, not 403, so existence isn't leaked.
- Use Hibernate **filters** or Postgres RLS for tenant isolation as **defence in depth**.
- **Centralise policy:** a domain authorisation service, or a policy engine (OPA, Cedar) for complex rules.
- **Test authorisation explicitly:** `@WithMockUser`, `jwt()` request post-processors in MockMvc tests, and "user B can't read user A's resource" tests for every endpoint.

## JPA / Hibernate

### Explain the persistence context: entity states, the first-level cache and dirty checking 🔥

**Entity states:**

| State | Meaning |
|---|---|
| **Transient** | `new Meeting()`, not associated with the persistence context. No id yet |
| **Managed** | Associated with the **current persistence context** (EntityManager/Session). **Changes are tracked automatically** |
| **Detached** | Was managed, but the context closed (the transaction ended) or `detach()` was called. Changes **aren't** tracked |
| **Removed** | Scheduled for deletion at flush |

**The persistence context is a first-level cache and an identity map:**

- Within one context, `find(Meeting.class, 1)` called twice returns the **same instance**, with **one SELECT**.
- **Dirty checking:** at **flush**, Hibernate compares each managed entity with the **snapshot** taken when it was loaded, and issues UPDATEs for the changed ones. **You don't call `save()` for managed entities.**
- **When flush happens** (`FlushMode.AUTO`):
  - Before the transaction commits.
  - **Before queries** whose results might be affected by pending changes.
  - On an explicit `flush()`.
- `persist(new)` makes the entity managed. **`merge(detached)` copies the state onto a managed instance and returns *that*.** The argument stays detached, a classic bug.
- Spring Data's `save()` calls `persist` for new entities and `merge` otherwise. For managed entities it's unnecessary.

```js
// A tiny persistence context: identity map + snapshots + dirty checking at flush
class EntityManager {
  constructor(db) { this.db = db; this.managed = new Map(); this.snapshots = new Map(); this.sql = []; }
  find(id) {
    if (this.managed.has(id)) return this.managed.get(id);          // first-level cache hit: no SQL
    this.sql.push(`select meeting ${id}`);
    const row = this.db.get(id);
    if (!row) return null;
    const entity = { ...row };
    this.managed.set(id, entity);
    this.snapshots.set(id, JSON.stringify(entity));                  // snapshot for dirty checking
    return entity;
  }
  persist(entity) { this.managed.set(entity.id, entity); this.snapshots.set(entity.id, null); }
  detach(entity) { this.managed.delete(entity.id); this.snapshots.delete(entity.id); }
  flush() {
    for (const [id, entity] of this.managed) {
      const snapshot = this.snapshots.get(id);
      const now = JSON.stringify(entity);
      if (snapshot === null) this.sql.push(`insert meeting ${id}`);
      else if (snapshot !== now) this.sql.push(`update meeting ${id}`);
      else continue;                                                  // unchanged: no SQL at all
      this.db.set(id, { ...entity });
      this.snapshots.set(id, now);
    }
  }
}

const db = new Map([[1, { id: 1, title: 'Standup', status: 'scheduled' }], [2, { id: 2, title: 'Retro', status: 'scheduled' }]]);

test('identity map: same instance, one SELECT', () => {
  const em = new EntityManager(db);
  expect(em.find(1)).toBe(em.find(1));
  expect(em.sql).toEqual(['select meeting 1']);
});
test('dirty checking: modify a managed entity → UPDATE at flush, without calling save()', () => {
  const em = new EntityManager(db);
  em.find(1).status = 'live';
  em.find(2);                                 // loaded but unchanged
  em.persist({ id: 3, title: 'Demo', status: 'scheduled' });
  em.flush();
  expect(em.sql).toEqual(['select meeting 1', 'select meeting 2', 'update meeting 1', 'insert meeting 3']);
  expect(db.get(1).status).toBe('live');
});
test('changes to a detached entity are NOT persisted', () => {
  const em = new EntityManager(db);
  const m = em.find(2);
  em.detach(m);
  m.title = 'Changed while detached';
  em.flush();
  expect(db.get(2).title).toBe('Retro');
});
```

**Consequences:**

- A long-running persistence context holding **thousands of managed entities** makes every flush slow (dirty checking compares them all) and uses a lot of memory. Use **read-only** transactions for reads, `clear()` in batch loops, or projections.
- **Accidental updates:** modifying an entity inside a transaction "just to format it for the response" **writes to the database**. Map to DTOs instead.

### LAZY vs EAGER, `LazyInitializationException` and open-in-view 🔥

**JPA's defaults:**

- **`@ManyToOne` and `@OneToOne` are EAGER by default.**
- `@OneToMany` and `@ManyToMany` are LAZY.

**Make everything `LAZY`**, and fetch explicitly per use case. EAGER associations load on every query, including into lists, causing hidden N+1 and huge joins.

**`LazyInitializationException`:** accessing an uninitialised lazy association **after the persistence context has closed** (outside the transaction, in the controller or JSON serialisation).

**The "fix" Spring Boot enables by default: Open Session in View** (`spring.jpa.open-in-view=true`, which logs a warning at startup):

- It keeps the persistence context open for the **whole HTTP request**, including view and JSON rendering, so lazy loading "just works".
- **Problems:**
  - Lazy loads fire **during serialisation**: invisible N+1 queries in the controller layer.
  - A **database connection is held for the whole request**, so the pool drains under load.
  - It blurs layer boundaries.
- **Disable it** (`spring.jpa.open-in-view=false`) and fetch what you need inside the service transaction.

**Fetch only what the use case needs:**

```java
public interface MeetingRepository extends JpaRepository<Meeting, Long> {

    // 1. JOIN FETCH in JPQL
    @Query("select m from Meeting m join fetch m.host where m.org.id = :orgId and m.startsAt >= :from")
    List<Meeting> findUpcomingWithHost(long orgId, Instant from);

    // 2. Entity graph (declarative fetch plan)
    @EntityGraph(attributePaths = {"host", "recordings"})
    Optional<Meeting> findWithHostAndRecordingsById(long id);

    // 3. DTO / record projection: only the columns needed, no entities, no dirty checking
    @Query("select new com.meethour.api.MeetingCard(m.id, m.title, m.startsAt, h.name) from Meeting m join m.host h where m.org.id = :orgId")
    List<MeetingCard> findCards(long orgId);
}
```

**For collections:**

- **`@BatchSize(size = 50)`** or `hibernate.default_batch_fetch_size=50` loads lazy collections for 50 parents with **one `IN` query**: N+1 becomes 1 + N/50.
- **Never JOIN FETCH two `List` (bag) collections at once.** You get a Cartesian product, and Hibernate throws `MultipleBagFetchException`. Fetch one collection with a join and the other with batch fetching, or in a second query.
- **Pagination plus a collection fetch join** makes Hibernate paginate **in memory** (warning HHH90003004). Paginate the ids first, then fetch by ids.

### What are the best practices for mapping relationships? 🔥

```java
@Entity
public class Meeting {
    @Id @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "meeting_seq")
    @SequenceGenerator(name = "meeting_seq", sequenceName = "meeting_seq", allocationSize = 50)   // enables batching
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)            // override the EAGER default
    @JoinColumn(name = "host_id")
    private User host;

    @OneToMany(mappedBy = "meeting", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Recording> recordings = new ArrayList<>();          // the inverse side; Recording owns the FK

    @Version
    private long version;                                            // optimistic locking

    public void addRecording(Recording r) { recordings.add(r); r.setMeeting(this); }      // keep BOTH sides in sync
    public void removeRecording(Recording r) { recordings.remove(r); r.setMeeting(null); }

    @Override public boolean equals(Object o) {                      // id-based, safe for transient entities
        if (this == o) return true;
        if (!(o instanceof Meeting other)) return false;
        return id != null && id.equals(other.id);
    }
    @Override public int hashCode() { return getClass().hashCode(); }  // constant: stable before and after persist
}
```

**Rules:**

- **The owning side holds the foreign key.** For bidirectional `@OneToMany`, the `@ManyToOne` side owns the relationship, and `mappedBy` marks the inverse side. **Updating only the inverse collection doesn't change the FK.** Use helper methods.
- **Cascades:**
  - `ALL`/`PERSIST`/`REMOVE` only from aggregate root to children: Meeting → Recordings, never Recording → Meeting.
  - **`orphanRemoval = true`** deletes children removed from the collection.
  - `CascadeType.REMOVE` on `@ManyToMany` deletes **shared** rows, which is a disaster.
- **`@ManyToMany` with extra columns** (role, joined_at) should be an explicit **join entity** (`MeetingParticipant`) with two `@ManyToOne`s.
- **`equals`/`hashCode`:**
  - **Never use all fields** (lazy proxies, mutable fields, broken `Set` membership after persist).
  - Use a **natural business key**, or **id-based equality with a constant `hashCode`** as above.
  - **Lombok's `@Data` on entities is dangerous**: generated equals/hashCode/toString traverse lazy associations, causing infinite recursion and N+1.
- **ID generation:**
  - **`IDENTITY` disables JDBC insert batching** in Hibernate, because the id must be fetched per insert.
  - **`SEQUENCE` with a pooled optimiser** (`allocationSize = 50`) allows batching.
- **Kotlin entities:** use the `kotlin-jpa` (no-arg) and `all-open` plugins. Avoid data classes for entities.

### How do optimistic and pessimistic locking work in JPA?

**Optimistic (`@Version`):**

- Every update runs `UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?`.
- 0 rows updated means **`OptimisticLockException`** (in Spring: `ObjectOptimisticLockingFailureException`).
- Map it to **409 Conflict**, or retry if the operation is safe to recompute.
- **Use it for:** user edits and most entities. It's cheap and holds no locks.

**Pessimistic:**

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)                                   // SELECT … FOR UPDATE
@QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
@Query("select s from Seat s where s.event.id = :eventId and s.status = 'FREE' order by s.id")
List<Seat> lockFreeSeats(long eventId, Pageable limit);
```

- Holds row locks until commit. Use it for **short, high-contention critical sections** (seat allocation, balances).
- **Set lock timeouts** and keep the transactions tiny.
- `SKIP LOCKED` needs a native query or Hibernate-specific hints.

**Retrying optimistic failures:** Spring Retry's `@Retryable(retryFor = ObjectOptimisticLockingFailureException.class)` **around** the `@Transactional` method (a new transaction per attempt).

### Explain `@Transactional` propagation, rollback rules, and the `UnexpectedRollbackException` trap 🔥

| Propagation | If a transaction exists | If none exists |
|---|---|---|
| **`REQUIRED`** (default) | **Join it** | Start a new one |
| **`REQUIRES_NEW`** | **Suspend it** and start an independent transaction (**a second DB connection!**) | Start a new one |
| `NESTED` | Savepoint inside the existing one (JDBC savepoints) | Start a new one |
| `MANDATORY` | Join | **Throw** |
| `SUPPORTS` | Join | Run without one |
| `NOT_SUPPORTED` | Suspend; run without one | Run without one |
| `NEVER` | **Throw** | Run without one |

**Rollback rules:**

- By default, the transaction rolls back on **unchecked exceptions** (`RuntimeException`, `Error`) **only**.
- **Checked exceptions commit!** Use `@Transactional(rollbackFor = Exception.class)`, or throw unchecked domain exceptions.

**The `UnexpectedRollbackException` trap:**

- An inner `REQUIRED` method throws a RuntimeException.
- The transaction interceptor **marks the shared transaction rollback-only** as the exception passes through the inner proxy.
- Even if the outer method **catches** the exception and carries on, the commit at the end fails with *"Transaction silently rolled back because it has been marked as rollback-only"*.

**`REQUIRES_NEW` pitfalls:**

- It needs a **second connection while the first is held**. With a pool of 10 and 10 concurrent requests all waiting for a second connection, you get a **pool deadlock**.
- Its commit is independent: the inner commit stays even if the outer transaction rolls back.
- Use it deliberately, for **audit logs that must survive** a failed business transaction.

```js
// Simulate Spring's propagation semantics (REQUIRED joins, REQUIRES_NEW suspends, MANDATORY needs an existing tx)
class TxManager {
  constructor() { this.stack = []; this.committed = []; this.connectionsInUse = 0; this.maxConnections = 0; }
  current() { return this.stack[this.stack.length - 1]; }
  transactional(propagation, fn) {
    const outer = this.current();
    if (propagation === 'MANDATORY' && !outer) throw new Error('IllegalTransactionStateException: no existing transaction');
    if ((propagation === 'REQUIRED' || propagation === 'MANDATORY') && outer) {
      try { return fn(outer); }
      catch (e) { outer.rollbackOnly = true; throw e; }            // the proxy marks the SHARED tx rollback-only
    }
    const tx = { writes: [], rollbackOnly: false };              // new physical transaction = a new connection
    this.stack.push(tx);
    this.connectionsInUse++;
    this.maxConnections = Math.max(this.maxConnections, this.connectionsInUse);
    try {
      const result = fn(tx);
      if (tx.rollbackOnly) throw new Error('UnexpectedRollbackException: transaction marked rollback-only');
      this.committed.push(...tx.writes);
      return result;
    } finally {
      this.stack.pop();
      this.connectionsInUse--;
    }
  }
}

test('caught exception from a REQUIRED inner method still rolls back everything', () => {
  const tm = new TxManager();
  expect(() => tm.transactional('REQUIRED', (tx) => {
    tx.writes.push('order#1');
    try {
      tm.transactional('REQUIRED', (inner) => { inner.writes.push('coupon#9'); throw new Error('coupon expired'); });
    } catch { /* "handled" — but the shared transaction is already doomed */ }
  })).toThrow('UnexpectedRollbackException');
  expect(tm.committed).toEqual([]);
});
test('REQUIRES_NEW: the inner failure rolls back only the inner transaction', () => {
  const tm = new TxManager();
  tm.transactional('REQUIRED', (tx) => {
    tx.writes.push('order#1');
    try { tm.transactional('REQUIRES_NEW', (inner) => { inner.writes.push('coupon#9'); throw new Error('coupon expired'); }); } catch {}
  });
  expect(tm.committed).toEqual(['order#1']);
  expect(tm.maxConnections).toBe(2);                            // REQUIRES_NEW held a SECOND connection
});
test('REQUIRES_NEW commits independently, so an audit row survives the outer rollback', () => {
  const tm = new TxManager();
  expect(() => tm.transactional('REQUIRED', (tx) => {
    tx.writes.push('payment#5');
    tm.transactional('REQUIRES_NEW', (audit) => audit.writes.push('audit:payment-attempt'));
    throw new Error('gateway declined');
  })).toThrow('gateway declined');
  expect(tm.committed).toEqual(['audit:payment-attempt']);
});
test('MANDATORY without a surrounding transaction fails fast', () => {
  expect(() => new TxManager().transactional('MANDATORY', () => {})).toThrow('no existing transaction');
});
```

**Other `@Transactional` facts:**

- It's **ignored on private methods and self-invocation** (proxy-based).
- **Put it on service methods (use cases)**, not repositories or controllers.
- **`readOnly = true`** sets Hibernate's flush mode to MANUAL (no dirty checking at flush), can route to **read replicas** via a routing DataSource, and tells the driver it's read-only.
- `timeout` and `isolation` attributes are available.
- **Programmatic alternative:** `TransactionTemplate.execute(status -> …)` for fine-grained boundaries inside one method.

### How do you make Hibernate fast for bulk operations? 🔥

| Problem | Fix |
|---|---|
| **Inserts one by one** | `spring.jpa.properties.hibernate.jdbc.batch_size=50`, `order_inserts=true`, `order_updates=true`, a **SEQUENCE** id with `allocationSize`, and for Postgres `reWriteBatchedInserts=true` on the JDBC URL |
| **The persistence context grows** in big loops | `flush()` + `clear()` every batch, or use a **`StatelessSession`** (no first-level cache or dirty checking) |
| **Bulk updates or deletes** | A JPQL or native `@Modifying @Query("update Meeting m set m.status = 'ARCHIVED' where m.endsAt < :cutoff")` runs one SQL statement. **It bypasses the persistence context**: clear it afterwards (`clearAutomatically = true`) |
| **Reads with no updates** | `@Transactional(readOnly = true)`, DTO projections, `@QueryHints(HINT_READ_ONLY)` |
| **Repeated reads of reference data** | **Second-level cache** (Caffeine/Ehcache/Redis via JCache) for **rarely changing entities**. The **query cache** is rarely worth its invalidation cost |
| **Seeing what SQL runs** | `hibernate.generate_statistics=true`, `logging.level.org.hibernate.SQL=debug` plus bind parameters (`org.hibernate.orm.jdbc.bind=trace`), **datasource-proxy** or p6spy, query-count assertions in tests |
| **Very complex reports** | Native SQL or **jOOQ**. Don't force JPA where SQL is clearer |

### What should you know about Spring Data JPA repositories?

| Feature | Example | Notes |
|---|---|---|
| Derived queries | `List<Meeting> findByOrgIdAndStatusOrderByStartsAtDesc(long orgId, Status s)` | Great for simple filters. Long names suggest you should switch to `@Query` |
| `@Query` JPQL / native | `@Query(value = "select … for update skip locked", nativeQuery = true)` | Native for database-specific SQL |
| **Projections** | Interface projections, **records/DTOs** (`select new …`), dynamic `<T> List<T> findBy…(Class<T> type)` | Load only the needed columns |
| Dynamic filters | **Specifications** (Criteria API), **Querydsl**, Query by Example | Search screens with optional filters |
| **Paging** | `Page<T> findAll(Pageable p)` runs **an extra COUNT query**; **`Slice<T>`** has no count (just `hasNext`); **`Window` / `ScrollPosition`** (Spring Data 3.1+) gives **keyset scrolling** | `Page` counts are expensive on big tables. Prefer Slice or keyset for feeds |
| `@Modifying` | Bulk update and delete queries | Needs a transaction; clear the context |
| Auditing | `@CreatedDate`, `@LastModifiedBy` with `@EnableJpaAuditing` + `AuditorAware` | Who changed what and when |

**Schema management:**

- **Never use `ddl-auto=update` in production.** Use **Flyway** or Liquibase migrations (Boot runs them at startup, or as a separate step).
- **`ddl-auto=validate`** catches entity/schema drift at boot.

## Testing & deployment

### How do you test Spring Boot applications efficiently? 🔥

| Test type | Annotation | Loads |
|---|---|---|
| **Web slice** | `@WebMvcTest(MeetingController.class)` | MVC infrastructure + that controller + `@ControllerAdvice`. Services are mocked with **`@MockitoBean`** (Spring 6.2+, replacing `@MockBean`) |
| **JPA slice** | `@DataJpaTest` | JPA, repositories, Flyway; transactional and rolled back per test. Pair with **Testcontainers** (`@AutoConfigureTestDatabase(replace = NONE)`) rather than H2 |
| JSON slice | `@JsonTest` | Jackson configuration: serialisation of DTOs |
| HTTP client slice | `@RestClientTest` | `RestClient`/`RestTemplate` with a `MockRestServiceServer` |
| **Full integration** | `@SpringBootTest(webEnvironment = RANDOM_PORT)` | The whole app, plus **Testcontainers** (`@ServiceConnection` wires the container's URL automatically) |

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class MeetingApiIT {
    @Container @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    @Autowired TestRestTemplate http;

    @Test
    void hostCanScheduleAndOthersCannotEnd() {
        var created = http.withBasicAuth("host", "pw")
            .postForEntity("/api/meetings", new ScheduleMeetingRequest("Demo", Instant.now().plusSeconds(3600), 30, List.of()), MeetingDto.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        var forbidden = http.withBasicAuth("guest", "pw").postForEntity("/api/meetings/" + created.getBody().id() + "/end", null, Void.class);
        assertThat(forbidden.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }
}
```

**Speed tips:**

- **The Spring test context cache:** tests with the **same configuration share one context**.
- Every distinct `@MockitoBean` combination or property override creates **a new context**, which is slow. **Standardise test base classes.**
- Use **slices** instead of `@SpringBootTest` where you can.
- Reuse Testcontainers across the suite (static containers, or `testcontainers.reuse.enable`).
- Test **security rules** with `spring-security-test`: `jwt()`, `@WithMockUser`.

### How do you package and deploy Spring Boot to containers?

**Image options:**

- **Buildpacks:** `./gradlew bootBuildImage` builds an OCI image with a sensible JVM memory calculator, layered and non-root. No Dockerfile needed.
- **A Dockerfile** with a slim JRE (**`jlink`** a custom runtime) and **layered jars** (`java -Djarmode=tools -jar app.jar extract --layers`), so the dependency layers cache between builds.

**Runtime settings:**

- **JVM flags:** `-XX:MaxRAMPercentage=70`, `-XX:+ExitOnOutOfMemoryError` (see [Java Deep Dive](/docs/java-deep-dive)).
- **Graceful shutdown:** `server.shutdown=graceful` with `spring.lifecycle.timeout-per-shutdown-phase=25s`. In-flight requests finish, and readiness turns DOWN on shutdown.
- **Probes:** `/actuator/health/liveness` and `/readiness`. Use a **startup probe** for slow JVM boots.

**Startup time** (serverless, scale-to-zero):

- **CDS / the AOT cache.**
- **GraalVM native images** (`nativeCompile`): ~100 ms startup and low memory, but longer builds, reflection hints, and a lower peak throughput.
- **CRaC**, or **Lambda SnapStart**.

### When do you need Spring Cloud, and when is Kubernetes enough?

| Spring Cloud component | Purpose | Kubernetes / cloud-native alternative |
|---|---|---|
| Config Server | Central configuration | ConfigMaps/Secrets, AWS AppConfig, Parameter Store |
| Eureka (discovery) | Service registry | **Kubernetes Services + DNS** |
| Spring Cloud Gateway | API gateway, BFF, token relay | Ingress/Gateway API, Envoy, AWS API Gateway (SCG is still great as an app-level gateway or BFF) |
| LoadBalancer | Client-side load balancing | kube-proxy / service mesh |
| OpenFeign | Declarative HTTP clients | `@HttpExchange` interfaces |
| Resilience4j | Circuit breakers, retries | A service mesh (Istio) for some policies; app-level is still useful |
| Spring Cloud Stream | Kafka/RabbitMQ binding abstraction | Spring for Apache Kafka directly |
| Sleuth (→ Micrometer Tracing) | Tracing | OpenTelemetry |

**Interview answer:** "On Kubernetes I don't need Eureka or Config Server. The platform covers discovery and configuration. I'd still use Resilience4j for app-level resilience, Spring Cloud Gateway if we need a Java-based gateway or BFF, and Micrometer/OpenTelemetry for observability. On plain VMs, Spring Cloud fills those platform gaps."
