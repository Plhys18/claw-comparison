# NanoClaw vs OpenClaw — Deep Architecture Comparison

> Diagrams use [Mermaid](https://mermaid.live) — paste any block into mermaid.live to render interactively.

---

## 1. Top-Level Philosophy

| Dimension | NanoClaw | OpenClaw |
|-----------|----------|----------|
| Core premise | Agent is dangerous, must be caged | Agent is powerful, must be orchestrated |
| Codebase size | ~4,000 lines (intentional) | Enterprise monorepo, 100k+ lines |
| Security model | OS-level / hardware isolation | Application-layer + operator trust |
| Extensibility | Static code transformation | Runtime plugin registry (ClawHub) |
| Deployment target | Single-user, security-critical | Teams, cloud, Kubernetes |
| Stars / adoption | Niche, growing | 215,000+ stars |
| License | — | MIT |

---

## 2. High-Level Architecture

### NanoClaw

```mermaid
graph TB
    subgraph HOST["Orchestration Host (Node.js — never touches Claude API)"]
        ORC[Orchestrator / Batman]
        DB[(SQLite State)]
        IPC[Filesystem IPC Watcher]
        SCHED[Scheduler Loop]
        CHAN[Channel Adapters]
        ORC --> DB
        ORC --> IPC
        ORC --> SCHED
        ORC --> CHAN
    end

    subgraph CONTAINER["Execution Container (ephemeral Linux VM, --rm)"]
        AGENT[Claude Agent SDK / Alfred]
        TOOLS[Specialized Tools]
        AGENT --> TOOLS
    end

    CHAN -->|inbound message| ORC
    ORC -->|spawn container| CONTAINER
    AGENT -->|atomic JSON write| IPC
    IPC -->|verified response| AGENT
    CONTAINER -->|destroyed on completion| VOID[ ]

    style HOST fill:#1a1a2e,color:#eee,stroke:#4a4a8a
    style CONTAINER fill:#16213e,color:#eee,stroke:#e94560
    style VOID fill:none,stroke:none
```

### OpenClaw

```mermaid
graph TB
    subgraph CHANNELS["Channel Adapters (1k–5k lines each)"]
        WA[WhatsApp / Baileys]
        TG[Telegram / grammY]
        SL[Slack / Bolt]
        DC[Discord]
        IM[iMessage / BlueBubbles]
        OT[Signal, Matrix, WeChat, etc.]
    end

    subgraph GW["Gateway Control Plane (TCP 18789 WS)"]
        ROUTER[Router / Lane Queue]
        AUTH[Auth / Token Validation]
        HOOKS[Interception Hooks]
        CANVAS[Canvas Renderer]
        MEMORY[File-based Memory]
        ROUTER --> HOOKS
        ROUTER --> MEMORY
        ROUTER --> CANVAS
    end

    subgraph AGENT["Agent Runner (ReAct loop)"]
        LLM[LLM Provider]
        TOOLS2[Tool Executor]
        TELEM[Telemetry Streams]
        LLM -->|tool_use| TOOLS2
        TOOLS2 -->|result| LLM
        LLM --> TELEM
    end

    subgraph NODES["Hardware Nodes"]
        MOB[Mobile Apps iOS/Android]
        MAC[macOS Native App]
        HW[camera.snap / location.get / screen.record]
    end

    CHANNELS -->|normalized events| ROUTER
    AUTH --> ROUTER
    ROUTER -->|lane-queued task| AGENT
    AGENT -->|response| ROUTER
    ROUTER -->|outbound| CHANNELS
    NODES <-->|WebSocket| GW

    style GW fill:#0f3460,color:#eee,stroke:#533483
    style AGENT fill:#16213e,color:#eee,stroke:#e94560
    style CHANNELS fill:#1a1a2e,color:#eee,stroke:#4a4a8a
    style NODES fill:#1b1b2f,color:#eee,stroke:#ffd460
```

---

## 3. Security Architecture

### NanoClaw — Defense in Depth (OS-level)

```mermaid
graph LR
    subgraph BOUNDARIES["5 Security Boundaries"]
        B1["① Ephemeral Container\n--rm flag, zero persistence"]
        B2["② Cryptographic Mount Guard\nno .ssh / .aws / .kube\nsymlink resolution before mount"]
        B3["③ Session Partitioning\nper-group Claude config dirs\nfilesystem-level isolation"]
        B4["④ IPC Authorization\ncryptographic verification\nof all filesystem JSON requests"]
        B5["⑤ Credential Isolation\nonly ANTHROPIC_API_KEY passed\nno persistent auth in container"]
    end

    B1 --> B2 --> B3 --> B4 --> B5

    style B1 fill:#2d2d2d,color:#7fdbff
    style B2 fill:#2d2d2d,color:#7fdbff
    style B3 fill:#2d2d2d,color:#7fdbff
    style B4 fill:#2d2d2d,color:#7fdbff
    style B5 fill:#2d2d2d,color:#7fdbff
```

### OpenClaw — Application-Layer Trust Model

```mermaid
graph TD
    OP[Operator / Single Trust Boundary]
    GW[Gateway Instance]
    ALL_USERS[All Authenticated Users]

    OP --> GW
    ALL_USERS --> GW

    GW -->|can read| SESS[All Session Metadata]
    GW -->|can read| TRANS[Private Transcripts]
    GW -->|can modify| CONF[All Configurations]

    WARN["⚠️ No multi-tenant isolation.\nSeparate Gateway per untrusted actor required."]

    style WARN fill:#3d0000,color:#ff6b6b,stroke:#ff6b6b
    style OP fill:#1a3a1a,color:#7dff7d
    style ALL_USERS fill:#3a1a1a,color:#ff9999
```

### Vulnerability Comparison

| Attack Surface | NanoClaw | OpenClaw |
|---------------|----------|----------|
| Prompt injection → host escape | Blocked by VM boundary | Application-layer mitigations only |
| Cross-session data leak | Blocked by filesystem partitioning | Possible — single trust boundary |
| Credential exposure in container | Only API key, no persistent auth | Configurable, defaults vary |
| Network attack surface | None — containers have no network stack | TCP/18789 WebSocket, loopback default |
| Supply chain (skills) | Static merge, no runtime exec of skill code | 7.1% of ClawHub skills mishandle secrets; 283–341 confirmed credential stealers |
| Multi-tenant | Not supported (by design — single user) | Not supported (explicit doc disclaimer) |
| Memory accumulation (CWE-770) | N/A | Known bug in `command-queue.ts` — LaneState Map never cleaned, causes OOM |
| WebSocket hijacking | N/A | Session fixation via CSRF → persistent bidirectional access |
| Network misconfiguration | N/A | 0.0.0.0 binding → RCE within minutes of public exposure |

---

## 4. Inter-Process Communication

### NanoClaw — Filesystem IPC

```mermaid
sequenceDiagram
    participant C as Container Agent
    participant FS as Shared Filesystem
    participant H as Host Orchestrator

    C->>FS: Write atomic JSON request file
    Note over C,FS: No network stack needed<br/>No API credentials in container
    H->>FS: Detect file (inotify/poll)
    H->>H: Cryptographically verify request
    H->>FS: Write atomic JSON response file
    FS->>C: Read response
    Note over H: PR #816 replaces this<br/>with JSON-RPC 2.0 over stdio
```

**Properties:**
- Zero network exposure inside container
- Atomic writes prevent stream injection
- Request forgery blocked by crypto verification
- Host never writes back without verification

### OpenClaw — WebSocket Transport

```mermaid
sequenceDiagram
    participant CLIENT as Client / Channel
    participant GW as Gateway (TCP 18789)
    participant AGENT as Agent Runner

    CLIENT->>GW: WebSocket connect
    GW->>GW: Validate first frame (handshake)
    GW-->>CLIENT: hello-ok payload
    Note over GW,CLIENT: Contains: network presence,<br/>execution health, policy details

    CLIENT->>GW: Message event
    GW->>GW: Lane Queue (FIFO per session)
    GW->>AGENT: Dispatch task
    AGENT-->>GW: Tool stream / assistant stream / lifecycle stream
    GW-->>CLIENT: Real-time delta tokens (SSE deprecated → WS)
```

**Properties:**
- Bidirectional, real-time
- Strict FIFO per lane prevents race conditions
- Unencrypted by default — TLS is operator responsibility
- Session fixation risk on hijack

---

## 5. Memory Architecture

### NanoClaw — Three-Layer Memory

```mermaid
graph TD
    subgraph MEM["Memory Layers"]
        G["Global Context\n(read-only for all groups)\n(write: main group only)"]
        GR["Group Identity Context\n(per communication group)"]
        OP["Operational Artifacts\n(persistent .md files survive container destruction)"]
    end

    CONTAINER["Ephemeral Container"] -->|reads| G
    CONTAINER -->|reads/writes| GR
    CONTAINER -->|writes| OP
    OP -->|persists across lifecycles| CONTAINER

    style G fill:#1a3a1a,color:#aaffaa
    style GR fill:#1a1a3a,color:#aaaaff
    style OP fill:#3a1a1a,color:#ffaaaa
```

### OpenClaw — File-Based Markdown Memory

```mermaid
graph LR
    subgraph FILES["~/clawd/ Memory Files"]
        SOUL["SOUL.md\npersona, ethics, style"]
        USER["USER.md\noperator preferences"]
        AGENTS["AGENTS.md\nrouting, state machines"]
        MEMORY["MEMORY.md\nlong-term assertions"]
    end

    subgraph PROPOSED["Proposed Dual-Layer (not yet merged)"]
        T1["Tier 1: Short-Term Stream\nraw logs, 30-day window"]
        T2["Tier 2: Structured Knowledge Base\nnightly cron auto-org, topic hierarchy"]
        T1 -->|hybrid search| T2
    end

    GW[Gateway] --> FILES
    FILES -->|direct edit = instant behavioral correction| GW

    MEMORY -.->|current recall ~60-70%| PROPOSED

    style SOUL fill:#2a1a3a,color:#ddaaff
    style USER fill:#1a2a3a,color:#aaddff
    style AGENTS fill:#1a3a2a,color:#aaffdd
    style MEMORY fill:#3a2a1a,color:#ffddaa
    style PROPOSED fill:#1a1a1a,color:#888,stroke:#555,stroke-dasharray:5
```

---

## 6. Extensibility / Skills Engine

### NanoClaw — Static Code Transformation

```mermaid
flowchart LR
    SKILL["SKILL.md\n(YAML frontmatter + markdown)"]
    BASE[".nanoclaw/base/\nhidden original state"]
    LLM["LLM 3-way merge\nalgorithm"]
    CODE["Modified Source\n(static, reviewable)"]

    SKILL --> LLM
    BASE --> LLM
    LLM -->|deterministic merge| CODE
    CODE -->|next build| BINARY["New NanoClaw Binary"]

    NOTE["No runtime plugin execution.\nAll changes are explicit diffs\nin source code."]

    style NOTE fill:#1a2a1a,color:#aaffaa,stroke:#4a8a4a
    style LLM fill:#2a1a2a,color:#ffaaff
```

**Key properties:**
- Skills are merged *into* the codebase, not loaded at runtime
- Every integration is an auditable source diff
- Codebase stays small (skills don't accumulate as runtime deps)
- Follows Anthropic Agent Skills open standard

### OpenClaw — Runtime Plugin Registry (ClawHub)

```mermaid
flowchart TD
    HUB["ClawHub\n(npm-like registry ~4,000 skills)"]
    INSTALL["openclaw plugins install <name>"]
    RESOLVE["Resolution Priority"]
    P1["① project_root/skills/\n(workspace-specific)"]
    P2["② ~/.openclaw/skills/\n(global user)"]
    P3["③ Bundled internals\n(core)"]

    MANIFEST["skill.json\n(TypeBox schema, metadata)"]
    DOC["SKILL.md\n(human docs, injected into context)"]

    HUB --> INSTALL --> RESOLVE
    RESOLVE --> P1 --> P2 --> P3
    P1 & P2 & P3 --> MANIFEST
    MANIFEST --> DOC

    RISK["⚠️ Supply chain risk:\n7.1% mishandle secrets\n283–341 active credential stealers found"]

    style RISK fill:#3d0000,color:#ff6b6b,stroke:#ff6b6b
    style HUB fill:#1a1a3a,color:#aaaaff
```

---

## 7. Deployment Models

### NanoClaw

```mermaid
graph LR
    subgraph LOCAL["Local / macOS"]
        LAUNCHD["launchd .plist service"]
        APPLE["Apple Virtualization\n(macOS Tahoe+)\nlower overhead than Docker"]
    end
    subgraph CROSS["Cross-Platform"]
        DOCKER["Docker\nLinux / macOS / WSL2"]
    end

    NANO[NanoClaw Core] --> LAUNCHD
    NANO --> APPLE
    NANO --> DOCKER

    style NANO fill:#1a1a2e,color:#eee
```

### OpenClaw

```mermaid
graph LR
    subgraph LOCAL2["Native Local"]
        NATIVE["Single workstation\nzero-latency hardware nodes\ntotal downtime on sleep"]
    end
    subgraph VPS["VPS / Cloud"]
        CLOUD["One-click templates\nmajor cloud providers\ncontinuous WebSocket uptime"]
    end
    subgraph K8S["Kubernetes (Sympozium)"]
        CRD["Custom Resource Definitions"]
        PODS["Ephemeral sidecar Pods\nper execution"]
        NATS["NATS JetStream IPC\n(replaces filesystem)"]
        PSA["Pod Security Admission\nwebhooks"]
        CRD --> PODS --> NATS
        PODS --> PSA
    end

    OPENCLAW[OpenClaw Gateway] --> LOCAL2
    OPENCLAW --> VPS
    OPENCLAW --> K8S

    style OPENCLAW fill:#0f3460,color:#eee
    style K8S fill:#1a1a3a,color:#ccccff
```

---

## 8. Channel Support (Current + In-Flight PRs)

| Channel | NanoClaw | OpenClaw |
|---------|----------|----------|
| Telegram | ✅ core | ✅ core |
| Slack | ✅ core | ✅ core |
| Discord | ✅ skill | ✅ extension |
| WhatsApp | ✅ skill | ✅ Baileys |
| Signal | ✅ skill (PRs #784, #665) | ✅ extension |
| iMessage | — | ✅ BlueBubbles |
| Feishu / Lark | ✅ skills (3 PRs) | ✅ heavy (6+ PRs) |
| Matrix | ✅ PR #791 | — |
| Mattermost | ✅ PR #546 | ✅ extension |
| Google Chat | ✅ PR #752 | — |
| QQ / NapCat | ✅ PRs #821, #796 | — |
| WeChat Work | — | ✅ PR #39511 |
| DingTalk | ✅ PR #764 | — |
| Web Chat (browser) | ✅ PR #797 | ✅ core web-ui |
| IMAP Email | — | ✅ PR #39625 |
| CLI | ✅ PR #680 | ✅ core |
| Hardware nodes (camera/location) | ❌ | ✅ core |

---

## 9. AI Provider Support

| Provider | NanoClaw | OpenClaw |
|----------|----------|----------|
| Anthropic Claude | ✅ primary | ✅ |
| Ollama (local) | ✅ PR #797 | ✅ |
| llama.cpp | ✅ PR #762 | — |
| Generic LLM / OpenAI-compat | ✅ PR #557 | ✅ |
| Azure OpenAI | — | ✅ PR #39540 |
| Codex | ✅ PR #572 | — |
| Novita AI | — | ✅ PR #39675 |
| GitHub Copilot models | — | ✅ PR #39613 |
| Moonshot / Kimi | — | ✅ |

---

## 10. Concurrency Model

### NanoClaw

```mermaid
graph TD
    MSG[Incoming Message] --> GROUP[Identify Group]
    GROUP --> CONTAINER[Spawn Container]
    CONTAINER --> EXEC[Execute Task]
    EXEC --> DESTROY[Destroy Container]
    DESTROY --> PERSIST[Write artifacts to shared FS]

    NOTE2["Each group = isolated container lifecycle\nNo shared state between groups\nNo concurrent containers per group (implicit)"]
    style NOTE2 fill:#1a2a1a,color:#aaffaa
```

### OpenClaw — Lane Queue (Default Serial, Explicit Parallel)

```mermaid
graph TD
    MSG2[Incoming Message] --> ROUTE[Router]
    ROUTE --> LANE{Session Lane?}
    LANE -->|existing| QUEUE[FIFO Queue]
    LANE -->|new| NEW_LANE[Create Lane]
    QUEUE --> EXEC2[Execute in order]
    NEW_LANE --> EXEC2

    PARALLEL["Explicit parallel:\nOperator must opt-in\nper-session configuration"]
    EXEC2 -.->|optional| PARALLEL

    BUG["⚠️ CWE-770: clearCommandLane()\nnever deletes LaneState from Map\n→ unbounded memory growth → OOM"]
    LANE -.->|bug| BUG

    style BUG fill:#3d0000,color:#ff6b6b,stroke:#ff6b6b
    style PARALLEL fill:#1a1a3a,color:#aaaaff,stroke-dasharray:5
```

---

## 11. What's Actually Different — Summary Matrix

```mermaid
quadrantChart
    title NanoClaw vs OpenClaw — Positioning
    x-axis Low Capability --> High Capability
    y-axis Low Security --> High Security
    quadrant-1 Enterprise Sweet Spot
    quadrant-2 Paranoid / Minimal
    quadrant-3 Toy Projects
    quadrant-4 Power / Risk
    NanoClaw: [0.35, 0.90]
    OpenClaw: [0.85, 0.40]
```

| Concern | NanoClaw wins | OpenClaw wins |
|---------|--------------|--------------|
| Security isolation | ✅ OS-level, provable | |
| Attack surface | ✅ Minimal, auditable | |
| Channel breadth | | ✅ More native integrations |
| Hardware node support | | ✅ Camera, location, screen |
| Kubernetes / cloud scale | | ✅ Sympozium |
| AI provider variety | | ✅ More providers |
| Community size | | ✅ 215k stars |
| Codebase auditability | ✅ 4k lines, LLM-readable | |
| Skill supply chain safety | ✅ Static merge, no runtime exec | |
| Memory debuggability | ✅ Filesystem + SQLite | ✅ Markdown edit = instant fix |
| Real-time streaming | Filesystem-based (lower latency risk) | ✅ WebSocket, SSE |
| Mobile apps | ❌ | ✅ iOS + Android |
| Canvas / visual workspace | ❌ | ✅ HTML/CSS/JS agent-driven |
| Multi-tenant safety | ❌ (both fail, NanoClaw by design) | ❌ (explicit disclaimer) |

---

## 12. Active Development Signals (from open PRs)

### NanoClaw (open PR analysis)
- **IPC rewrite** (#816) — moving to JSON-RPC 2.0 over stdio (architectural shift away from filesystem IPC)
- **Web Chat UI** (#797) — 77k line PR adding browser channel, Cloudflare tunnel, Ollama, Airtable
- **Memory system** (#560/#561) — RAG-based semantic memory being added
- **New channels flood** — QQ, WeChat Work via NapCat, Matrix, Mattermost, Google Chat

### OpenClaw (open PR analysis)
- **Feishu mega-PR** (#39496) — 9 streaming bug fixes, 3-layer dedup, calendar CRUD tools
- **IMAP hook** (#39625) — email without Gmail dependency
- **Azure OpenAI + Novita** — provider expansion
- **Wecom channel** (#39511) — WeChat Work already on npm, requesting inclusion
- **Per-agent timezone** (#39610) — cross-cutting config quality-of-life
- **Dual-layer memory** — proposed upgrade from ~65% to higher recall (not yet in PR)

---

> **Bottom line:** NanoClaw is being pushed toward richer features (web UI, RAG memory, more channels) while trying to maintain its security-first identity. OpenClaw is maturing its core (fixing IPC bugs, better memory, provider breadth). The gap in security model is structural — NanoClaw's container boundary is a design constraint that OpenClaw doesn't share and can't easily retrofit.
