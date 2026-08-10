export type JsonObject = Record<string, unknown>

export interface SessionSummary {
  id: string
  cwd: string
  name: string
  sessionPath?: string
  activeAgent?: string
  status: 'starting' | 'idle' | 'running' | 'exited'
  pendingUi: JsonObject[]
}

export interface RecentSession {
  id: string
  cwd: string
  name: string
  sessionPath: string
  updatedAt: number
  /** Session path this session was forked or cloned from, when the header records it. */
  parentSession?: string
}

/** Editable metadata attached to a session, keyed by its canonical session path (Fase 4.4). */
export interface SessionMeta {
  /** When true, the sidebar lists the session before unpinned ones. */
  pinned?: boolean
  /** Free-form labels, at most 8 entries of up to 40 characters each. */
  tags?: string[]
  /** Free-form note of at most 2000 characters. */
  note?: string
}

/** Global session metadata keyed by canonical session path (survives fork/clone). */
export type SessionMetaStore = Record<string, SessionMeta>

export interface DirectoryEntry {
  name: string
  path: string
}

export interface DirectoryListing {
  path: string
  parentPath: string | null
  directories: DirectoryEntry[]
}

export interface GitFileChange {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  additions: number | null
  deletions: number | null
}

export interface GitCommit {
  hash: string
  subject: string
  files: GitFileChange[]
}

export interface GitSnapshot {
  repository: boolean
  root: string | null
  branch: string | null
  files: GitFileChange[]
  ahead: number
  commits: GitCommit[]
}

export interface GitActionResult {
  committed: boolean
  pushed: boolean
  pushError?: string
}

export interface GitPushResult {
  pushed: boolean
  pushError?: string
}

export interface GitResetResult {
  hash: string
}

export interface GitRevertResult {
  hash: string
}

export interface GitFileDiff {
  path: string
  diff: string
}

export interface WorkspaceFile {
  path: string
  content: string
}

export interface TodoSessionLink {
  id: string
  name: string
  sessionPath: string
}

export interface TodoItem {
  id: string
  text: string
  completed: boolean
  session?: TodoSessionLink
}

export interface ManagerRuntimeIdentity {
  instanceId: string
  startedAt: string
  runtimeRevision: string | null
  supervised: boolean
}

export type ManagerRuntimeState =
  | 'checking'
  | 'current'
  | 'stale'
  | 'restarting'
  | 'disconnected'
  | 'unknown'

export interface ManagerRuntimeStatus {
  state: ManagerRuntimeState
  canRestart: boolean
  error?: string
}

export interface ManagerRequest {
  id: string
  action:
    | 'list'
    | 'create'
    | 'open'
    | 'close'
    | 'rename'
    | 'command'
    | 'improve_prompt'
    | 'run_prompt'
    | 'status'
    | 'restart'
  sessionId?: string
  cwd?: string
  name?: string
  sessionPath?: string
  command?: JsonObject
  prompt?: string
  systemPrompt?: string
  thinkingLevel?: string
  model?: { provider: string; modelId: string }
  extensions?: string[]
  tools?: string[]
  includeContextFiles?: boolean
  direction?: string
}

export interface ManagerResponse {
  kind: 'response'
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface ManagerEvent {
  kind: 'event'
  event:
    | 'session_created'
    | 'session_exited'
    | 'session_reassigned'
    | 'manager_connected'
    | 'manager_disconnected'
    | 'manager_status'
    | 'pi'
  sessionId: string
  data?: unknown
  sequence?: number
}

export type ManagerMessage = ManagerResponse | ManagerEvent

export interface SessionStats {
  cost?: number
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  toolResults?: number
  totalMessages?: number
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
  contextUsage?: {
    tokens?: number | null
    contextWindow?: number | null
    percent?: number | null
  }
}

export interface PromptTemplate {
  name: string
  content: string
  description?: string
}

/** A visible conversation message with its stable session entry identity (M1). */
export interface SessionMessage {
  /** Stable session entry id; absent only for synthesized compaction placeholders. */
  entryId?: string
  /** Entry id of the parent, kept so the client can rebuild branch context without a second call. */
  parentEntryId?: string
  message: JsonObject
}

/** Capabilities of the connected Pi installation, used to gate UI (M5). */
export interface PiCapabilities {
  version: string
  commands: Record<string, boolean>
}

export interface SessionSnapshot {
  state: JsonObject | null
  messages: SessionMessage[]
  models: JsonObject[]
  commands: JsonObject[]
  promptTemplates: PromptTemplate[]
  stats: SessionStats | null
  liveEvents: Array<{ data: JsonObject; sequence: number }>
  capabilities: PiCapabilities | null
}

export interface OpenAiQuotaWindow {
  period: '5h' | '7d'
  remainingPercent: number
  resetsAt?: number
}

export interface CopilotQuotaWindow {
  name: string
  used: number
  limit: number
  resetsAt?: number
}

export interface ProviderBalance {
  currency: string
  total: number
  cash?: number
  voucher?: number
  granted?: number
  toppedUp?: number
  usable?: boolean
}

export interface QuotaProviderSnapshot<T> {
  data: T[]
  updatedAt?: number
  stale: boolean
  error?: string
}

export interface QuotaSnapshot {
  openai: QuotaProviderSnapshot<OpenAiQuotaWindow>
  copilot: QuotaProviderSnapshot<CopilotQuotaWindow>
  deepseek: QuotaProviderSnapshot<ProviderBalance>
  moonshot: QuotaProviderSnapshot<ProviderBalance>
  moonshotCn: QuotaProviderSnapshot<ProviderBalance>
  refreshing: boolean
  sessionRequired: boolean
}

export type QuotaProviderReport<T> =
  | { ok: true; data: T[] }
  | { ok: false; error: string }

export interface QuotaReport {
  protocol: 'pi-livecraft.quotas'
  version: 2
  refreshedAt: number
  openai: QuotaProviderReport<OpenAiQuotaWindow>
  copilot: QuotaProviderReport<CopilotQuotaWindow>
  deepseek: QuotaProviderReport<ProviderBalance>
  moonshot: QuotaProviderReport<ProviderBalance>
  moonshotCn: QuotaProviderReport<ProviderBalance>
}
