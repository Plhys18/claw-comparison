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

NanoClaw decomposes into a small set of named roles: the **Orchestrator (Batman)** that never touches the Claude API directly, the **Filesystem IPC Watcher** that mediates all agent-to-host communication, the **Scheduler Loop** that manages container lifecycle, and the **Channel Adapters** that normalize inbound messages — all running on a Node.js host process. The agent itself executes inside an ephemeral, network-isolated Linux VM and communicates exclusively through atomic JSON files on a shared mount.

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

OpenClaw is structured as four named layers. **Layer 1** is the Edge Integration tier — one adapter per channel (WhatsApp/Baileys, Telegram/grammY, Slack/Bolt, Discord, iMessage/BlueBubbles, and others), each 1,000–5,000 lines. **Layer 2** is the Central Control Plane — a Gateway daemon on TCP 18789 with a Router, Session Verification, Interception Hooks, and a Canvas Renderer. **Layer 3** is the Deterministic Execution tier — a Lane Queue (FIFO per session) feeding a ReAct loop with LLM Provider, Tool Executor, and Telemetry streams. **Layer 4** is the State Management tier — file-based Markdown documents under `~/clawd/` (SOUL.md, USER.md, AGENTS.md, MEMORY.md).

```mermaid
graph TB
    subgraph L1["Layer 1 — Edge Integration\n(1,000–5,000 lines per adapter)"]
        WA["WhatsApp / Baileys"]
        TG["Telegram / grammY"]
        SL["Slack / Bolt"]
        DC["Discord"]
        IM["iMessage / BlueBubbles"]
        OT["Signal, Matrix, WeChat, etc."]
    end
    subgraph L2["Layer 2 — Central Control Plane\n(Gateway Daemon, TCP 18789 WS)"]
        ROUTER["Router"]
        AUTH["Session Verification\n& Cryptographic Validation"]
        HOOKS["Interception Hooks\n(bootstrap / before_model_resolve /\nbefore_prompt_build /\nbefore_tool_call / agent_end)"]
        CANVAS["Canvas Renderer\n(/__openclaw__/canvas/)"]
        AUTH --> ROUTER
        ROUTER --> HOOKS
        ROUTER --> CANVAS
    end
    subgraph L3["Layer 3 — Deterministic Execution\n(Lane Queue — ReAct loop)"]
        LANE["Lane Queue\nFIFO per session\ncontrolled parallelism for idempotent tasks"]
        LLM["LLM Provider"]
        TOOLS["Tool Executor"]
        TELEM["Telemetry\n(Tool / Assistant / Lifecycle streams)"]
        LANE --> LLM
        LLM -->|tool_use JSON| TOOLS
        TOOLS -->|result| LLM
        LLM --> TELEM
    end
    subgraph L4["Layer 4 — State Management\n(~/clawd/ file-based Markdown)"]
        SOUL["SOUL.md"]
        USER["USER.md"]
        AGENTS["AGENTS.md"]
        MEMORY["MEMORY.md"]
    end
    L1 -->|normalized payload| L2
    ROUTER -->|lane-queued task| L3
    L3 -->|response| ROUTER
    ROUTER -->|outbound| L1
    L3 <-->|read/write| L4
    L2 <-->|read| L4
    style L1 fill:#1a1a2e,color:#eee,stroke:#4a4a8a
    style L2 fill:#0f3460,color:#eee,stroke:#533483
    style L3 fill:#16213e,color:#eee,stroke:#e94560
    style L4 fill:#2a1a3a,color:#ddaaff,stroke:#7a4a9a
```

---

## 3. Security Architecture

### NanoClaw — Defense in Depth (OS-level)

NanoClaw enforces **six** distinct security boundaries. B1 now runs the container agent under non-root UID 1000 in addition to the `--rm` flag. B2's cryptographic mount guard blocks an expanded blocklist that includes `.gnupg`, `.env`, and `id_rsa` in addition to `.ssh`, `.aws`, and `.kube`. B6 is a new boundary: the project root is mounted read-only, preventing the agent from modifying its own tooling or orchestration code.

```mermaid
graph LR
    subgraph BOUNDARIES["6 Security Boundaries"]
        B1["① Ephemeral Container\n--rm flag, zero persistence\nnon-root UID 1000"]
        B2["② Cryptographic Mount Guard\nno .ssh / .aws / .kube /\n.gnupg / .env / id_rsa\nsymlink resolution before mount"]
        B3["③ Session Partitioning\nper-group Claude config dirs\nfilesystem-level isolation"]
        B4["④ IPC Authorization\ncryptographic verification\nof all filesystem JSON requests"]
        B5["⑤ Credential Isolation\nonly ANTHROPIC_API_KEY passed\nno persistent auth in container"]
        B6["⑥ Read-Only Project Root\nproject root mounted read-only\nagent cannot modify own tooling"]
    end

    B1 --> B2 --> B3 --> B4 --> B5 --> B6

    style B1 fill:#2d2d2d,color:#7fdbff
    style B2 fill:#2d2d2d,color:#7fdbff
    style B3 fill:#2d2d2d,color:#7fdbff
    style B4 fill:#2d2d2d,color:#7fdbff
    style B5 fill:#2d2d2d,color:#7fdbff
    style B6 fill:#2d2d2d,color:#7fdbff
```

### NanoClaw — Trust Taxonomy

NanoClaw applies a four-tier trust hierarchy that is enforced structurally — not by policy flags — because each tier is implemented at a different system boundary.

```mermaid
graph TD
    ROOT["Trusted Root\n(Main Group)\nCross-group commands\nGlobal memory writes\nSystem reconfiguration"]
    UNTRUSTED["Untrusted\n(Non-Main Groups)\nNo global memory access\nRead-only mounts only\nCannot issue cross-group commands"]
    SANDBOXED["Sandboxed\n(Container Agents / Alfred)\nZero inherent trust\nEphemeral VM — destroyed on completion\nAll outputs verified by host before action"]
    HOSTILE["Hostile\n(Messaging Payloads)\nTreated as potential injection vectors\nNever interpreted as commands without host mediation"]
    ROOT -->|delegates to| UNTRUSTED
    ROOT -->|spawns| SANDBOXED
    UNTRUSTED -->|sends messages through| SANDBOXED
    HOSTILE -->|input to| SANDBOXED
    style ROOT fill:#1a3a1a,color:#aaffaa,stroke:#4a8a4a
    style UNTRUSTED fill:#3a2a1a,color:#ffddaa,stroke:#8a6a4a
    style SANDBOXED fill:#2d2d2d,color:#7fdbff,stroke:#4a6a8a
    style HOSTILE fill:#3d0000,color:#ff6b6b,stroke:#ff6b6b
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
| Prompt injection → host escape | Blocked by VM boundary (UID 1000 + ephemeral container) | Application-layer mitigations only |
| Cross-session data leak | Blocked by filesystem partitioning | Possible — single trust boundary |
| Credential exposure in container | Only API key, no persistent auth | Configurable, defaults vary |
| Network attack surface | None — containers have no network stack | TCP/18789 WebSocket, loopback default |
| Supply chain (skills) | Static merge, no runtime exec of skill code (see Section 6) | 7.1% of ClawHub skills mishandle secrets; 283–341 confirmed credential stealers (see Section 6) |
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
    alt First frame invalid
        GW-->>CLIENT: Immediate socket closure (no error message)
    end
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
- Invalid first frames result in immediate silent socket closure (no error payload leaked)
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

### OpenClaw — Context Management Strategy

Because OpenClaw runs long-lived agent sessions over WebSocket, accumulated context (turns + large tool results) eventually threatens the model's context window. OpenClaw addresses this with an eight-stage pipeline. Stages S1 through S8 are applied in sequence to every context before the next inference call. The Head (system prompt) and Tail (latest turns) are treated as **inviolable** by the Head/Tail Preservation stage — they are never discarded regardless of budget pressure; all pruning targets mid-session filler between them.

```mermaid
flowchart TD
    START["Incoming context\n(accumulated turns + tool results)"]
    S1["① Pre-Compaction Memory Flush\nFlush critical facts to MEMORY.md\nbefore context is compacted"]
    S2["② Context Window Guards\nMonitor token count against model limit\ntrigger intervention thresholds"]
    S3["③ Tool Result Guard\nTruncate or summarize large tool outputs\nbefore re-injection into context"]
    S4["④ Turn-Based Limiting\nEnforce maximum turn count per session\nprevent runaway inference chains"]
    S5["⑤ Cache-Aware Pruning\nDrop turns that fall outside cache windows\nprioritize cache-hit candidates"]
    S6["⑥ Head/Tail Preservation\nRetain system prompt (head) + latest turns (tail)\ndiscard mid-session filler\n[INVIOLABLE — never overridden by budget pressure]"]
    S7["⑦ Adaptive Chunk Sizing\nDynamically resize message batches\nbased on remaining context budget"]
    S8["⑧ Staged Summarization\nMulti-pass compression of older turns\ninto progressively shorter summaries"]
    FINAL["Pruned context\nready for next inference call"]
    START --> S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> FINAL
    NOTE["Combined effect: prevents context overflow\nwithout losing semantically critical content\nCurrent recall baseline: ~60–70%"]
    style NOTE fill:#1a1a3a,color:#aaaaff,stroke:#533483
    style START fill:#0f3460,color:#eee
    style FINAL fill:#0f3460,color:#eee
    style S1 fill:#16213e,color:#eee,stroke:#e94560
    style S2 fill:#16213e,color:#eee,stroke:#e94560
    style S3 fill:#16213e,color:#eee,stroke:#e94560
    style S4 fill:#16213e,color:#eee,stroke:#e94560
    style S5 fill:#16213e,color:#eee,stroke:#e94560
    style S6 fill:#16213e,color:#eee,stroke:#e94560
    style S7 fill:#16213e,color:#eee,stroke:#e94560
    style S8 fill:#16213e,color:#eee,stroke:#e94560
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

### NanoClaw — Channel Registry Interface

Each channel adapter in NanoClaw is registered through a factory pattern that enforces a uniform five-method interface. This means any new channel integration is automatically subject to the same lifecycle and ownership guarantees without requiring changes to the orchestrator. The interface is:

```typescript
interface ChannelAdapter {
  connect(): Promise<void>;
  sendMessage(jid: string, content: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
}
```

- `connect` / `disconnect` — lifecycle hooks called by the Scheduler Loop
- `sendMessage` — the only outbound path; JID must be validated by the adapter before use
- `isConnected` — polled by the Orchestrator's health-check loop
- `ownsJid` — used to route inbound messages to the correct adapter when multiple channels are active simultaneously

Adapters that do not implement all five methods are rejected at registration time, preventing silent routing failures.

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

Concurrency is explicitly bounded by the **Group Queue**, which enforces `MAX_CONCURRENT_CONTAINERS` and uses disk-based queuing during load spikes. Each group receives an isolated container lifecycle with no shared state between groups.

```mermaid
graph TD
    MSG[Incoming Message] --> GROUP[Identify Group]
    GROUP --> GQ["Group Queue\n(MAX_CONCURRENT_CONTAINERS enforced)\ndisk-based queuing during spikes"]
    GQ --> CONTAINER[Spawn Container]
    CONTAINER --> EXEC[Execute Task]
    EXEC --> DESTROY[Destroy Container]
    DESTROY --> PERSIST[Write artifacts to shared FS]
    NOTE2["Each group = isolated container lifecycle\nNo shared state between groups\nConcurrency explicitly capped by Group Queue"]
    style NOTE2 fill:#1a2a1a,color:#aaffaa
    style GQ fill:#2a1a2a,color:#ffaaff
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
- **IPC rewrite** (#816) — moving to JSON-RPC 2.0 over stdio (architectural shift away from filesystem IPC; also changes the threat model: stdio is not cryptographically verified the way the current filesystem JSON path is, so the transition requires careful re-evaluation of the IPC Authorization boundary described in Section 3)
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

> **Bottom line:** NanoClaw is being pushed toward richer features (web UI, RAG memory, more channels) while trying to maintain its security-first identity; the eight-stage context management investment in OpenClaw signals that long-session reliability is now a first-class concern for that project as well. OpenClaw is maturing its core (fixing IPC bugs, better memory, provider breadth). The gap in security model is structural — NanoClaw's container boundary is a design constraint that OpenClaw doesn't share and can't easily retrofit.
