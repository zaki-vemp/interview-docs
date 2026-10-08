# AWS & Serverless (DVA-C02)

You hold the **AWS Certified Developer – Associate (DVA-C02)** certification (2023), and ScaleCapacity's products are **fully serverless on AWS**: Lambda, API Gateway, DynamoDB, S3, and Azure AD/Cognito-style auth. Expect practical questions on **Lambda behaviour and limits, API Gateway, IAM, S3, messaging (SQS/SNS/EventBridge), Step Functions, observability and deployment**.

> **Reminder:** the certification on your resume shows validity until **June 2026**. Recertify, or present it as "certified 2023" (see *Tell Me About Yourself*). DVA-C02 domains: Development with AWS services (32%), Security (26%), Deployment (24%), Troubleshooting & Optimisation (18%).

## Lambda

### How does AWS Lambda work? Explain the execution lifecycle and cold starts 🔥

- **Execution environment lifecycle:**
  1. **Init phase:** download the code or container image, start the runtime, **run code outside the handler** (imports, SDK clients, config).
  2. **Invoke phase:** run the handler for each event.
  3. **Shutdown phase.**
- Environments are **reused** for subsequent invocations (**warm starts**). Module-level state (DB connections, cached config, SDK clients) **persists between invocations in the same environment**, but never rely on it for correctness.
- **A cold start** happens when there's no warm environment: the first request, scale-out, or after idle time or a deployment. It adds latency: roughly 100 ms–1 s for Node/Python, more for JVM languages and large packages.
- **Reducing cold starts:**
  - **smaller deployment packages** (bundle with esbuild, tree-shake, use AWS SDK v3 modular clients)
  - lazy-load rarely used modules
  - more memory (**CPU scales with memory**, so init is faster)
  - **Provisioned Concurrency** (pre-initialised environments, at a cost; can be scheduled with Application Auto Scaling)
  - **SnapStart** (Java, Python, .NET: restores from a snapshot of an initialised environment)
  - avoiding heavy frameworks in handlers
- **VPC Lambdas** no longer suffer large cold starts (Hyperplane ENIs since 2019), but they need NAT or VPC endpoints for internet and AWS API access.

```node
// handler.mjs — initialise once per environment (outside the handler), reuse across invocations
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));   // reused while the environment is warm
const TABLE = process.env.TABLE_NAME;

export const handler = async (event) => {
  const id = event.pathParameters?.id;
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `DOC#${id}`, SK: 'META' } }));
  return Item
    ? { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Item) }
    : { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };
};
```

### What are Lambda's key limits and configuration options? 🔥

| Setting | Value / notes |
|---|---|
| **Timeout** | Up to **15 minutes** (the API Gateway integration timeout of **29 s** for REST, by default, is usually the real limit for synchronous APIs) |
| **Memory** | 128 MB – **10,240 MB**; **CPU and network scale proportionally** (about 1,769 MB = 1 vCPU) |
| **Ephemeral storage** `/tmp` | 512 MB default, configurable up to 10 GB |
| **Payload** | **6 MB** for synchronous request/response; async invocations have a much smaller event size limit (keep events small, pass S3 pointers) |
| Deployment package | 50 MB zipped direct upload / 250 MB unzipped (including layers); **container images up to 10 GB** |
| **Concurrency** | Account default **1,000 concurrent executions per Region** (a soft limit); **reserved concurrency** caps or guarantees a function's share; **provisioned concurrency** keeps environments warm |
| Layers | Up to 5 per function (shared libraries and dependencies) |
| Environment variables | 4 KB total; encrypted at rest with KMS; use **Secrets Manager / Parameter Store** for secrets |

**Versions and aliases:**

- a **version** is an immutable snapshot of code and config
- an **alias** (e.g. `prod`) points to a version and can **split traffic** between two versions (weighted aliases)
- used with **CodeDeploy** for **canary or linear deployments** with automatic rollback on CloudWatch alarms

### What are the Lambda invocation types and how are errors retried? 🔥

| Type | Examples | Error handling |
|---|---|---|
| **Synchronous** (RequestResponse) | API Gateway, Lambda URLs, ALB, the SDK `Invoke` | **No automatic retry** by Lambda; the caller sees the error and decides |
| **Asynchronous** (Event) | S3 events, SNS, EventBridge, the SDK with `InvocationType=Event` | Lambda queues the event and **retries twice** (with backoff, configurable 0–2), within a max event age (up to 6 h); then sends to an **on-failure destination** or a **DLQ** (SQS/SNS). On-success destinations exist too |
| **Event source mapping** (poll-based) | **SQS**, Kinesis, DynamoDB Streams, Kafka, MQ | Lambda **polls** and invokes with **batches**. A failed batch is retried (SQS: the message becomes visible again after the **visibility timeout** and moves to a **DLQ** after `maxReceiveCount`; streams: retry until success or expiry, blocking the shard, with **bisect batch**, max retry attempts and **partial batch responses** via `ReportBatchItemFailures`) |

**Idempotency is essential:** at-least-once delivery means **duplicate invocations happen**. Use idempotency keys (**Powertools Idempotency** stores results in DynamoDB) and conditional writes.

```js
// An API Gateway (HTTP API, payload v2) handler written as a pure function — testable without AWS
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function makeHandler({ saveUpload, now = () => Date.now(), idempotencyStore = new Map() }) {
  return async (event) => {
    if (event.requestContext?.http?.method !== 'POST') return json(405, { message: 'Method Not Allowed' });
    const claims = event.requestContext?.authorizer?.jwt?.claims;           // set by the API Gateway JWT authorizer
    if (!claims?.sub) return json(401, { message: 'Unauthorized' });

    let body;
    try { body = JSON.parse(event.body ?? '{}'); } catch { return json(400, { message: 'Invalid JSON' }); }
    const { fileName, sizeBytes } = body;
    if (typeof fileName !== 'string' || !/^[\w.\- ]{1,200}$/.test(fileName)) return json(422, { message: 'Invalid fileName' });
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 5 * 1024 ** 3) return json(422, { message: 'Invalid size' });

    const key = event.headers?.['idempotency-key'];
    if (key && idempotencyStore.has(key)) return idempotencyStore.get(key);   // replay the original response

    const upload = await saveUpload({ owner: claims.sub, fileName, sizeBytes, createdAt: now() });
    const response = json(201, { uploadId: upload.id });
    if (key) idempotencyStore.set(key, response);
    return response;
  };
}

let saved = 0;
const handler = makeHandler({ saveUpload: async (u) => ({ id: `up_${++saved}`, ...u }) });
const event = (overrides = {}) => ({
  requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { sub: 'user-42' } } } },
  headers: { 'idempotency-key': 'abc-123' },
  body: JSON.stringify({ fileName: 'evidence.pdf', sizeBytes: 1024 }),
  ...overrides,
});

const first = await handler(event());
const retry = await handler(event());                                            // client retried after a timeout
console.log(first, 'saved records:', saved);

test('validation, auth and idempotent retries', async () => {
  expect(first.statusCode).toBe(201);
  expect(retry.body).toBe(first.body);
  expect(saved).toBe(1);
  expect((await handler(event({ requestContext: { http: { method: 'POST' }, authorizer: {} } }))).statusCode).toBe(401);
  expect((await handler(event({ body: '{"fileName":"../etc/passwd","sizeBytes":5}', headers: {} }))).statusCode).toBe(422);
});
```

### How do you handle long-running work given Lambda and API Gateway limits? 🔥

The RBF and SCAI pipelines (OCR + LLM over big PDFs) can't fit in a 29-second synchronous API call. **Patterns:**

1. **Async job API:**
   - `POST /jobs` stores the job (DynamoDB) and enqueues it (**SQS**), or starts a **Step Functions** execution, then returns **202 Accepted** with a `jobId`
   - workers process it, splitting work into chunks across Lambdas
   - the client **polls** `GET /jobs/:id`, or receives **push updates** (an API Gateway WebSocket API, AppSync subscriptions, or IoT Core)
2. **Step Functions** for multi-step workflows (OCR → split pages → **Map state** for parallel LLM calls per chunk → merge → human review via a **task token callback** → generate the redacted PDF). It gives **retries and catch per step**, timeouts, and visual debugging.
3. **Fan-out** with SNS/EventBridge to several consumers.
4. For work over 15 minutes per unit, use **ECS Fargate** tasks or AWS Batch.
5. **Response streaming** (Lambda function URLs or the newer API Gateway streaming support) for LLM tokens to the UI.

## API Gateway, IAM & auth

### REST API vs HTTP API vs WebSocket API in API Gateway 🔥

| | **REST API** (v1) | **HTTP API** (v2) | **WebSocket API** |
|---|---|---|---|
| Cost and latency | Higher | **~70% cheaper, lower latency** | Per message plus connection minutes |
| Features | **Usage plans and API keys**, **request validation**, **caching**, **VTL mapping templates**, **WAF**, private APIs, edge-optimised endpoints, more authorizer options | **JWT authorizers** (Cognito, Entra ID, any OIDC), Lambda authorizers, IAM, simple CORS, auto-deploy | `$connect`/`$disconnect`/`$default` routes; push to clients through the `@connections` management API |
| Use | Public APIs that need throttling per client, validation, caching | **Most Lambda-backed APIs** (SPAs, internal) | Real-time push: processing status, chat, notifications |

**Common to all:**

- **Throttling:** account-level 10,000 rps steady with a 5,000 burst (soft limits), plus stage and route limits.
- **Stages:** dev, prod.
- **CORS configuration.**
- **Custom domains** + ACM certificates.
- CloudWatch access logs.

### How do API Gateway authorizers work? 🔥

- **JWT authorizer** (HTTP API): validates a JWT from an OIDC issuer: **signature (JWKS), `iss`, `aud`, expiry**, and optionally scopes per route. It's **zero code**, which makes it ideal for **Cognito user pools or Azure AD/Entra ID** (scQuill). The claims are available to the Lambda in `event.requestContext.authorizer.jwt.claims`.
- **Cognito user pool authorizer** (REST API): the same idea for Cognito tokens.
- **Lambda authorizer** (custom): your function receives the token or request (headers, query, context) and returns an **IAM policy** (REST) or a simple `{ isAuthorized, context }` response (HTTP). Use it for **custom token formats, API keys stored in DB, multi-tenant logic**. **Cache** results by identity source and TTL to cut latency and cost.
- **IAM authorization (SigV4):** callers sign requests with AWS credentials. Good for service-to-service calls, or for clients with **Cognito identity pool** credentials.
- **Resource policies** (REST): restrict by source IP, VPC endpoint or account.
- **Authorisation still belongs in your code:** the authorizer authenticates and coarse-grains. Fine-grained checks ("may this user edit document X?") happen in the handler.

### Explain IAM: users, roles, policies and how policies are evaluated 🔥

- **Principals:**
  - **IAM users** (long-term credentials; avoid them for humans, use **IAM Identity Center/SSO**)
  - **roles** (assumed **temporarily** through **STS**, for Lambda execution roles, EC2 instance profiles, cross-account access, federated users)
  - AWS services
- **Policies** are JSON documents (`Effect`, `Action`, `Resource`, `Condition`):
  - **Identity-based** policies attach to users, groups and roles.
  - **Resource-based** policies attach to resources: S3 bucket policies, SQS queue policies, **Lambda resource policies** (which allow API Gateway or S3 to invoke the function), KMS key policies.
  - **Permission boundaries** cap the maximum permissions of an identity.
  - **SCPs** (AWS Organizations) cap entire accounts.
  - Session policies.
- **Evaluation logic:**
  1. **Explicit Deny** anywhere wins.
  2. Otherwise, an **Allow** is needed from the applicable policies, and **within all boundaries** (SCP, permission boundary, session).
  3. Everything else is an **implicit deny**.
  4. Cross-account access needs **both** sides to allow it.
- **Best practices:**
  - **least privilege**, scoped to specific resources
  - **one execution role per Lambda**
  - **no long-lived access keys** in code (use roles; in CI use **OIDC federation**, e.g. GitHub Actions → AssumeRoleWithWebIdentity)
  - MFA
  - **IAM Access Analyzer** to find over-permissive policies

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteOwnDocuments",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
      "Resource": ["arn:aws:dynamodb:us-east-1:123456789012:table/Documents", "arn:aws:dynamodb:us-east-1:123456789012:table/Documents/index/GSI1"]
    },
    {
      "Sid": "UploadsBucketPrefixOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::nebraska-draw-uploads/tenant-123/*"
    }
  ]
}
```

### Cognito User Pools vs Identity Pools 🔥

- **User Pools** handle **authentication** (a user directory and an OIDC/OAuth 2.0 provider):
  - sign-up/sign-in, MFA, password policies
  - the **Hosted UI / managed login** with OAuth flows (Authorization Code + PKCE)
  - **federation** with social providers and **SAML/OIDC IdPs** (Azure AD/Entra ID, Okta)
  - **JWTs** (ID, access, refresh)
  - **Lambda triggers** (pre-sign-up, pre-token-generation to add custom claims, post-confirmation, custom auth challenges)
  
  Use them to protect APIs (API Gateway authorizers) and apps.
- **Identity Pools** (Federated Identities) handle **authorisation to AWS services**. They exchange a token (from a User Pool, Google, a SAML IdP, or unauthenticated guests) for **temporary AWS credentials** (STS) mapped to **IAM roles**, so a browser or mobile app can call S3 or IoT **directly** with scoped permissions (e.g. per-user S3 prefixes via policy variables `${cognito-identity.amazonaws.com:sub}`).
- **Typical combination:** User Pool for login, then Identity Pool for direct AWS access. For most SPAs, a User Pool plus API Gateway is enough.

## Storage & delivery

### What should you know about S3 for development? 🔥

- **Objects** (up to **5 TB**) live in **buckets**, with keys (prefixes behave like folders). **Strong read-after-write consistency** for all operations (since December 2020).
- **Uploads:**
  - a single PUT up to 5 GB
  - **multipart upload** recommended over about 100 MB and **required over 5 GB**: parallel parts, retry per part, resumable
  - **Transfer Acceleration** for distant clients
- **Pre-signed URLs:** time-limited URLs signed with the **signer's credentials**, so the URL's permissions equal the signer's IAM permissions. Browsers upload or download **directly** without AWS credentials, which keeps big files away from Lambda's payload limits.
  - Expiry: up to 7 days with IAM user keys, but limited by the **role session duration** when signed with temporary credentials (e.g. inside Lambda).
  - **Pre-signed POST** policies can enforce content type and size limits.
- **Security:**
  - **Block Public Access** (on by default)
  - **ACLs disabled** by default (Object Ownership: bucket owner enforced); use **bucket policies**
  - **encryption by default** with **SSE-S3** (since January 2023), or **SSE-KMS** (audit trail, key policies; watch KMS request costs, use S3 Bucket Keys), SSE-C, or client-side encryption
  - **CORS configuration** for browser uploads
  - access via **CloudFront with Origin Access Control** instead of a public bucket
- **Data management:**
  - **versioning** (protects against overwrites and deletes; MFA Delete)
  - **lifecycle rules** (move to Standard-IA / Glacier tiers, expire old recordings)
  - **storage classes**: Standard, Intelligent-Tiering, Standard-IA, One Zone-IA, Glacier Instant/Flexible/Deep Archive
  - Object Lock (WORM, for legal evidence retention: relevant to DA's office data)
  - replication (CRR/SRR)
- **Events:** S3 Event Notifications → Lambda/SQS/SNS, or **EventBridge** (richer filtering) to trigger processing pipelines (e.g. new upload → OCR).

```node
// Generate a pre-signed PUT URL (AWS SDK v3) — the browser then uploads directly to S3
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});
export const handler = async (event) => {
  const { fileName, contentType } = JSON.parse(event.body);
  const key = `uploads/${event.requestContext.authorizer.jwt.claims.sub}/${crypto.randomUUID()}-${fileName}`;
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET, Key: key, ContentType: contentType }), { expiresIn: 900 });
  return { statusCode: 200, body: JSON.stringify({ url, key }) };
};
```

### How do you host a React SPA on AWS? CloudFront details 🔥

1. Build → upload to a **private S3 bucket**. **CloudFront** distribution with **Origin Access Control (OAC)**, so only CloudFront can read the bucket.
2. **SPA routing:** map 403/404 to `/index.html` with status 200 through custom error responses, or a **CloudFront Function** that rewrites paths without file extensions.
3. **Caching:**
   - hashed assets: `Cache-Control: max-age=31536000, immutable`
   - `index.html`: `no-cache` (or a short TTL)
   - **invalidate** `/index.html` on deploy (invalidations cost money beyond the free tier, so use hashed filenames rather than invalidating everything)
4. **Security headers** via a **response headers policy** (CSP, HSTS, X-Frame-Options), **HTTPS** with ACM certificates (in **us-east-1** for CloudFront), **AWS WAF** in front.
5. **Edge logic:**
   - **CloudFront Functions** (lightweight JS at the edge: header manipulation, rewrites, redirects; sub-millisecond, cheap)
   - **Lambda@Edge** (full Node/Python, network access, larger limits: auth checks, image transformation; regional edge caches)
6. **Alternatives:** **Amplify Hosting** (CI/CD plus hosting with preview branches, SSR support for Next.js), or S3 + CloudFront deployed by **CDK**.
7. **Private content:** **CloudFront signed URLs or cookies** (e.g. recordings).

## Messaging & orchestration

### SQS vs SNS vs EventBridge vs Kinesis: when do you use which? 🔥

| Service | Model | Ordering | Use cases |
|---|---|---|---|
| **SQS Standard** | **Queue** (pull); each message processed by **one** consumer | Best-effort; **at-least-once** (duplicates possible) | Decoupling, buffering spikes, work queues (process uploads, send emails) |
| **SQS FIFO** | Queue with **exactly-once processing** within a 5-minute deduplication window, **ordered per message group ID** | Strict per group | Ordered workflows per entity (all updates for document X in order) |
| **SNS** | **Pub/sub** push to many subscribers (SQS, Lambda, HTTP, email, SMS, mobile push) | FIFO topics available | **Fan-out** (upload complete → thumbnail + index + notify), alerts |
| **EventBridge** | **Event bus** with **content-based routing rules** | No ordering guarantee | Event-driven architecture across services and accounts, SaaS integrations, **schedules (EventBridge Scheduler)**, archive and replay, **Pipes** (source → filter → enrich → target) |
| **Kinesis Data Streams** | **Ordered log** with shards; multiple consumers read independently; **replay** within retention | Ordered per shard (partition key) | High-throughput streaming: analytics, clickstreams, logs, real-time metrics |

**SQS key concepts (exam favourites):**

- **Visibility timeout:** set it to more than the processing time; 6× the Lambda timeout for event source mappings.
- **Long polling** (`WaitTimeSeconds` up to 20) reduces empty receives and cost.
- **DLQ + redrive policy** (`maxReceiveCount`), and **redrive back to the source** after fixing bugs.
- Message retention from 1 minute to **14 days** (default 4 days); **delay queues**.
- **Large payloads:** store them in S3 and send a pointer (Extended Client Library).
- **Fan-out pattern:** SNS topic → multiple SQS queues, each with its own consumer and retry semantics.

### When and how do you use Step Functions? 🔥

**AWS Step Functions** orchestrates multi-step workflows as **state machines** (Amazon States Language: JSON/YAML, or the visual Workflow Studio).

- **State types:** Task (call Lambda or **200+ AWS services directly** through SDK integrations), Choice, Parallel, **Map** (iterate; **Distributed Map** for millions of items from S3), Wait, Pass, Succeed/Fail.
- **Built-in error handling:** **`Retry`** (with backoff and jitter) and **`Catch`** per state. Timeouts and heartbeats.
- **Integration patterns:**
  - request-response
  - **`.sync`** (wait for a job such as ECS, Glue or Batch to finish)
  - **callback with a task token** (`.waitForTaskToken`), which pauses until an external system or a **human approves**. Ideal for **RBF's human review step**.
- **Standard vs Express:**
  - **Standard:** up to **1 year**, exactly-once, full execution history, priced per state transition. Use it for long, auditable business workflows.
  - **Express:** up to **5 minutes**, at-least-once, high volume, priced per duration. Use it for event processing and streaming transforms.
- **Why not chain Lambdas directly?** Orchestration in Step Functions gives visibility, retries, compensation (**sagas**) and less glue code. Lambdas stay focused and idempotent.

```json
{
  "Comment": "RBF redaction pipeline (simplified)",
  "StartAt": "ExtractText",
  "States": {
    "ExtractText": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": { "FunctionName": "extract-text", "Payload.$": "$" }, "ResultPath": "$.pages", "Retry": [{ "ErrorEquals": ["States.TaskFailed"], "MaxAttempts": 3, "BackoffRate": 2 }], "Next": "DetectEntitiesPerChunk" },
    "DetectEntitiesPerChunk": {
      "Type": "Map", "ItemsPath": "$.pages.Payload.chunks", "MaxConcurrency": 5,
      "ItemProcessor": { "ProcessorConfig": { "Mode": "INLINE" }, "StartAt": "CallLLM",
        "States": { "CallLLM": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": { "FunctionName": "detect-entities", "Payload.$": "$" }, "Retry": [{ "ErrorEquals": ["ThrottlingException", "States.Timeout"], "MaxAttempts": 5, "IntervalSeconds": 2, "BackoffRate": 2, "JitterStrategy": "FULL" }], "End": true } } },
      "ResultPath": "$.entities", "Next": "HumanReview"
    },
    "HumanReview": { "Type": "Task", "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken", "Parameters": { "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/review-queue", "MessageBody": { "documentId.$": "$.documentId", "taskToken.$": "$$.Task.Token" } }, "TimeoutSeconds": 604800, "Next": "ApplyRedactions" },
    "ApplyRedactions": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": { "FunctionName": "apply-redactions", "Payload.$": "$" }, "End": true }
  }
}
```

## Operations

### How do you monitor, debug and trace serverless applications? 🔥

- **CloudWatch Logs:** every Lambda writes to a log group. Use **structured JSON logs** (Powertools Logger) with correlation IDs. **Logs Insights** queries (`fields @timestamp, level, message | filter level = "ERROR" | stats count() by bin(5m)`). Set **retention** to control cost.
- **CloudWatch Metrics:**
  - Lambda: **Invocations, Errors, Throttles, Duration, ConcurrentExecutions, IteratorAge** (streams)
  - API Gateway: 4XX, 5XX, Latency, IntegrationLatency
  - SQS: **ApproximateAgeOfOldestMessage**, NumberOfMessagesVisible
  - DynamoDB: ThrottledRequests, ConsumedRCU/WCU
  - custom metrics through the **Embedded Metric Format** (EMF, logged as JSON)
- **Alarms** (with SNS → Slack/PagerDuty) on error rate, throttles, DLQ depth, p99 latency. **Dashboards.**
- **Distributed tracing:** **AWS X-Ray** (active tracing on Lambda and API Gateway; the service map shows latency per hop), or **OpenTelemetry** via the ADOT layer. Powertools Tracer adds annotations.
- **Troubleshooting checklist:**
  - permissions (an `AccessDenied` in the logs: check the execution role and the resource policy)
  - timeouts (check the downstream service; raise memory, which adds CPU)
  - throttling (concurrency limits, reserved concurrency set to 0 by mistake)
  - VPC networking (no NAT gateway means no internet)
  - cold starts (the Init Duration in the REPORT log line)
  - payload limits

### How do you deploy serverless applications? SAM vs CDK vs CloudFormation 🔥

- **CloudFormation:** the base **infrastructure-as-code** service (YAML/JSON templates → **stacks**, **change sets** to preview, rollbacks, drift detection, nested stacks, StackSets for multiple accounts).
- **SAM** (Serverless Application Model): a CloudFormation **transform** with concise serverless resources (`AWS::Serverless::Function`, `Api`, `HttpApi`, `SimpleTable`), plus a CLI: `sam build`, `sam local invoke/start-api` (Docker-based local testing), `sam deploy --guided`, `sam sync` (fast developer iteration). **Built-in gradual deployments** (`DeploymentPreference: Canary10Percent5Minutes` with CodeDeploy and alarms).
- **CDK** (Cloud Development Kit): infrastructure in **TypeScript** (or Python, Java…) with **constructs** (L1 = raw CFN, L2 = sensible defaults, L3 = patterns), loops and abstractions. It synthesises to CloudFormation (`cdk synth/diff/deploy`). It's great for frontend/full-stack teams already writing TypeScript.
- **Others:** Serverless Framework, Terraform/OpenTofu (multi-cloud), SST.
- **CI/CD:** GitHub Actions (with **OIDC role assumption**, so no stored keys) or CodePipeline + CodeBuild. Promote through **separate accounts** for dev, staging and prod. Integration tests against deployed stages. Automated rollback on alarms.

```yaml
# SAM: function + HTTP API with JWT authorizer (Entra ID / Cognito) + DynamoDB access + canary deploys
Resources:
  DocumentsApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      Auth:
        DefaultAuthorizer: OidcAuth
        Authorizers:
          OidcAuth:
            IdentitySource: $request.header.Authorization
            JwtConfiguration:
              issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
              audience: [api://scquill]
  GetDocumentFn:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: nodejs22.x
      Handler: handler.handler
      MemorySize: 1024
      Timeout: 10
      AutoPublishAlias: live
      DeploymentPreference: { Type: Canary10Percent5Minutes, Alarms: [!Ref GetDocumentErrorsAlarm] }
      Environment: { Variables: { TABLE_NAME: !Ref DocumentsTable } }
      Policies: [{ DynamoDBReadPolicy: { TableName: !Ref DocumentsTable } }]
      Events:
        Get: { Type: HttpApi, Properties: { ApiId: !Ref DocumentsApi, Path: /documents/{id}, Method: GET } }
```

### How do you manage secrets and encryption on AWS? 🔥

- **KMS:** managed keys for encryption at rest. **Envelope encryption**: KMS encrypts a **data key**, and the data key encrypts the data, so large data never goes to KMS. Key policies plus IAM. **Customer managed keys** for control, rotation and audit (CloudTrail logs every use). Watch **KMS request quotas and costs** (cache data keys).
- **Secrets Manager:** stores secrets (DB passwords, API keys such as an LLM API key) with **automatic rotation** (Lambda-based rotation for RDS and others), versioning and cross-account access. Costs per secret per month plus per API call.
- **SSM Parameter Store:** config and secrets (`SecureString` with KMS). The standard tier is free; no built-in rotation. Good for configuration.
- **In Lambda:** fetch secrets at init and **cache them** (the **Parameters and Secrets Lambda Extension** or Powertools Parameters, with a TTL). **Never** put plaintext secrets in env vars, code or the frontend.
- **In transit:** TLS everywhere (ACM certificates), TLS 1.2+ policies on API Gateway and CloudFront.

### What does the AWS Well-Architected Framework cover? Apply it to a serverless app

**Six pillars:**

1. **Operational excellence:** IaC, CI/CD, observability, runbooks, small reversible changes.
2. **Security:** least-privilege IAM, encryption, WAF, secrets management, auditing (CloudTrail), data classification (legal documents).
3. **Reliability:** retries with backoff, DLQs, idempotency, multi-AZ by default (Lambda, DynamoDB and S3 are regional services), quotas monitoring, backups (PITR).
4. **Performance efficiency:** right-size memory (**AWS Lambda Power Tuning**), caching (CloudFront, DAX, ElastiCache), async patterns, choosing the right data store.
5. **Cost optimisation:**
   - Graviton (**arm64**) Lambdas (better price-performance)
   - on-demand vs provisioned capacity
   - S3 lifecycle tiers
   - log retention
   - avoid idle provisioned concurrency
   - per-feature cost tags
6. **Sustainability:** efficient code, right-sized resources, managed services, data lifecycle.
