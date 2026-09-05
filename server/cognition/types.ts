/**
 * MYRAA cognition — shared type definitions.
 * Reconstructed from usage across every cognition module; the original
 * type-only file was elided from the shipped bundle's source map.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type CognitiveEventSource = "conversation" | "screen" | "tool" | "memory" | "internal" | "system" | "user" | "desktop" | "filesystem" | "goal" | "task" | "safety" | "skill";

export interface CognitiveEventInput {
  type: string;
  source: CognitiveEventSource;
  importance?: number;
  confidence?: number;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
  /** Optional explicit semantic-deduplication key. */
  dedupeKey?: string;
  projectId?: string | null;
  timestamp?: string;
}

export interface CognitiveEvent {
  id: string;
  type: string;
  source: CognitiveEventSource;
  importance: number;
  confidence: number;
  correlationId?: string | null;
  metadata: Record<string, unknown>;
  dedupeKey?: string;
  projectId?: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

export interface AttentionFactors {
  relevance: number;
  novelty: number;
  urgency: number;
  risk: number;
  userImpact: number;
  taskRelevance: number;
  confidence: number;
  repetitionPenalty: number;
  interruptionCost: number;
}

export interface AttentionAssessment {
  eventId: string;
  score: number;
  factors: AttentionFactors;
  semanticKey: string;
  repeated?: boolean;
  escalated?: boolean;
  explanation: string[];
}

// ---------------------------------------------------------------------------
// Situation model
// ---------------------------------------------------------------------------

export type CognitiveState =
  | "IDLE"
  | "LISTENING"
  | "PROCESSING"
  | "SPEAKING"
  | "THINKING"
  | "ACTING"
  | "LEARNING"
  | "PLANNING"
  | "VERIFYING"
  | "OBSERVING"
  | "INTERRUPTED"
  | "WORKING"
  | "PAUSED"
  | "ERROR";

export type UserActivityState = "active" | "idle" | "away";

export interface PendingRiskSummary {
  eventId?: string;
  description: string;
  level: number;
  confirmationId?: string;
}

export interface SituationEventSummary {
  id: string;
  type: string;
  timestamp: string;
  importance: number;
  source: CognitiveEventSource;
}

export interface SituationSnapshot {
  state: CognitiveState;
  activeApp: string | null;
  activeWindow: string | null;
  currentActivity: string | null;
  currentProject: string | null;
  conversationTopic: string | null;
  currentGoalId: string | null;
  currentTaskId: string | null;
  userActivity: UserActivityState;
  userSpeaking: boolean;
  myraaSpeaking: boolean;
  myraaWasInterrupted: boolean;
  silenceStartedAt: string | null;
  silenceSeconds: number;
  openApplications: string[];
  relevantFiles: string[];
  recentImportantEvents: SituationEventSummary[];
  recentFailures: SituationEventSummary[];
  recentSuccesses: SituationEventSummary[];
  pendingRisk: PendingRiskSummary | null;
  autonomyPaused: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

export type InitiativeAction = "SPEAK" | "ASK" | "WAIT" | "ACT" | "NOTIFY" | "OBSERVE" | "SUGGEST" | "REMEMBER" | "WARN" | "IGNORE";

export interface InitiativeDecisionReason {
  reason: string;
  urgency: number;
  novelty: number;
  confidence: number;
  interruptionAllowed?: boolean;
  suggestedTone: string;
}

export interface InitiativeDecision {
  eventId?: string;
  attentionScore?: number;
  action: InitiativeAction;
  shouldGenerateSpeech: boolean;
  reason: InitiativeDecisionReason;
  createdAt?: string;
  cooldownMs?: number;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type MemoryKind =
  | "identity"
  | "preference"
  | "project"
  | "episodic"
  | "correction"
  | "skill"
  | "working"
  | "semantic";

export interface StructuredMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  projectId: string | null;
  entities: string[];
  tags: string[];
  confidence: number;
  confirmations: number;
  importance: number;
  source: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  expiresAt: string | null;
  supersedesId?: string | null;
  active: boolean;
}

export interface MemoryQuery {
  text?: string;
  entities?: string[];
  projectId?: string | null;
  limit?: number;
  minConfidence?: number;
  kinds?: MemoryKind[];
}

// ---------------------------------------------------------------------------
// Goals & skills
// ---------------------------------------------------------------------------

export type GoalStatus = "active" | "blocked" | "pending" | "completed" | "failed" | "cancelled";

export type GoalTaskStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface GoalTask {
  id: string;
  title: string;
  status: GoalTaskStatus;
  priority: number;
  dependsOn: string[];
  attempts: number;
  maxRetries: number;
  timeoutMs: number;
  progress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  objective: string;
  status: GoalStatus;
  priority: number;
  projectId: string | null;
  constraints: string[];
  successCriteria: string[];
  blockers: string[];
  tasks: GoalTask[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalTaskPlanStep {
  title: string;
  tool?: string;
  dependsOn?: string[];
}

export interface LearnedSkillStep {
  id?: string;
  action: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

export interface LearnedSkill {
  id: string;
  name: string;
  description: string;
  preconditions: string[];
  steps: LearnedSkillStep[];
  expectedOutcome: string;
  projectId: string | null;
  confidence: number;
  uses: number;
  successes: number;
  failures: number;
  successRate: number;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Thoughts / autonomous mind
// ---------------------------------------------------------------------------

export type ThoughtOrigin =
  | "curiosity"
  | "unfinished_thread"
  | "memory"
  | "goal"
  | "reflection"
  | "social";

export type ThoughtAction =
  | "REMEMBER"
  | "WAIT"
  | "SPEAK"
  | "ASK"
  | "SUGGEST"
  | "ACT"
  | "REVISIT_LATER";

export interface ThoughtCandidate {
  id: string;
  createdAt: number;
  origin: ThoughtOrigin;
  content: string;
  relevance: number;
  novelty: number;
  urgency: number;
  socialValue: number;
  confidence: number;
  suggestedAction: ThoughtAction;
  relatedTopic?: string | null;
  relatedMemoryIds?: string[];
  expiresAt: number;
}

export type ConversationThreadStatus =
  | "ACTIVE"
  | "OPEN_ENDED"
  | "INTERRUPTED"
  | "WAITING_FOR_USER"
  | "RESOLVED"
  | "DORMANT";

export interface ConversationThread {
  id: string;
  topic: string | null;
  status: ConversationThreadStatus;
  importance: number;
  unresolvedPoints: string[];
  openQuestions: string[];
  lastUserStatement: string | null;
  lastMyraaStatement: string | null;
  interruptedThoughts: string[];
  possibleFollowups: string[];
  lastUserAt: number | null;
  lastMyraaAt: number | null;
  activeUntil: number;
  autonomousTurnsSinceUser: number;
}

export type SocialSilenceType =
  | "CONVERSATIONAL_PAUSE"
  | "AWKWARD_UNRESOLVED_SILENCE"
  | "THINKING_SILENCE"
  | "WORKING_SILENCE"
  | "USER_AWAY"
  | "NATURAL_END";

export interface CognitionCounters {
  cognitiveTicks: number;
  deepCognitiveMoments: number;
  internalThoughtsGenerated: number;
  internalThoughtsDropped: number;
  autonomousSpeechAttempts: number;
  autonomousSpeechCompleted: number;
  autonomousSpeechInterrupted: number;
  repetitionSuppressed: number;
  [key: string]: number;
}

// ---------------------------------------------------------------------------
// Social initiative
// ---------------------------------------------------------------------------

export interface SocialOpportunity {
  score: number;
  reason: string;
  userAvailability: number;
  topicRelevance: number;
  novelty: number;
  interruptionCost: number;
  continuationValue: number;
}

// ---------------------------------------------------------------------------
// Tools / safety
// ---------------------------------------------------------------------------

export type CognitionPermissionName =
  | "microphone"
  | "screen_awareness"
  | "filesystem_read"
  | "filesystem_write"
  | "desktop_control"
  | "browser"
  | "network"
  | "automation"
  | "code_execution"
  | "system_control";

export type PermissionName =
  | "microphone"
  | "screen_awareness"
  | "filesystem_read"
  | "filesystem_write"
  | "desktop_control"
  | "browser"
  | "network"
  | "automation"
  | "code_execution"
  | "system_control"
  | "local"
  | "input"
  | "clipboard"
  | "files"
  | "system"
  | "dangerous";

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export interface ToolDescriptor {
  name: string;
  purpose: string;
  permission: PermissionName;
  riskLevel: RiskLevel;
  timeoutMs: number;
  maxRetries: number;
}

export interface ToolExecutionContext {
  correlationId?: string | null;
  confirmed?: boolean;
  projectRoot?: string;
}

export type ToolExecutionStatus =
  | "succeeded"
  | "failed"
  | "denied"
  | "confirmation_required"
  | "cancelled"
  | "timed_out";

export interface ToolExecutionResult {
  success: boolean;
  status: ToolExecutionStatus;
  tool: string;
  result: unknown;
  error: string | null;
  riskLevel: RiskLevel;
  durationMs: number;
  attempts: number;
  confirmationId?: string;
}

export interface CriticVerdict {
  passed: boolean;
  retryRecommended: boolean;
  reason: string;
  missing: string[];
}

// ---------------------------------------------------------------------------
// Model router
// ---------------------------------------------------------------------------

export type ModelCapability = "fast" | "reasoning" | "coding" | "vision" | "research" | "embedding" | "speech";

export interface ModelCallResult {
  text: string;
  model: string;
  capability: ModelCapability;
  durationMs: number;
  cached: boolean;
  attempts: number;
  ok?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Desktop perception
// ---------------------------------------------------------------------------

export interface DesktopDownloadSnapshot {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  status: "downloading" | "complete";
}

export interface DesktopSnapshot {
  timestamp: string;
  activeWindow: {
    title: string | null;
    application: string | null;
    pid: number | null;
  };
  applications: string[];
  disk: {
    path: string;
    freeBytes: number;
    totalBytes: number;
    percentUsed: number;
  } | null;
  downloads: DesktopDownloadSnapshot[];
  userIdleSeconds: number;
}
