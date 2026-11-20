/**
 * The runtime seats this plugin contributes to, declared where the type system
 * can see them.
 *
 * This repo builds against the 0.1.5 package line while the running GUI is
 * 0.2.2 (AGENTS: "外部包的版本与本机运行时不齐"). The conversation and session
 * packages that declare `conversation.input.dock`, `useSession` and
 * `useSessions` live in the runtime, not in devDependencies, so the plugin
 * declares only the narrow shapes it actually reads. Declaration merging makes
 * `ctx.slots.inject('conversation.input.dock', …)` and the `useSessions` prop on
 * the main panel type-check without pulling those packages' whole type nets in.
 *
 * The shapes are deliberately smaller than the runtime's: a tracker needs the
 * session id, `running` and `pendingSubmissions` to notice a prompt; the panel
 * needs the list's id → `displayTitle`. Everything else stays the runtime's.
 */
export interface SessionListEntryLike {
  /** Host-projected label, falling back to the session id. */
  readonly displayTitle: string
}

/** The slice of the session-list snapshot the titles are read from. */
export interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionListEntryLike>>
}

/** The runtime's `useSessions` selector hook, narrowed to the title slice. */
export type UseSessionsHook = <T>(selector: (state: SessionListLike) => T) => T

/** The slice of one session's live snapshot the tracker reads. */
export interface SessionSnapshotLike {
  readonly sessionId: string
  readonly running: boolean
  /** Prompts the host accepted and that are not yet durable events. */
  readonly pendingSubmissions: readonly unknown[]
}

/** The runtime's `useSession` selector hook, narrowed to the tracker's slice. */
export type UseSessionHook = <T>(selector: (state: SessionSnapshotLike) => T) => T

/** The slice of the composer input machine the tracker watches. */
export interface InputStateLike {
  /** `sending` while an ordinary message waits for the host to accept it. */
  readonly phase: string
}

/** The runtime's `useInput` selector hook, narrowed to the phase. */
export type UseInputHook = <T>(selector: (state: InputStateLike) => T) => T

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Full-width entries above the composer card. A list; this plugin uses one
     * 1×1 marker to observe whether the conversation is really on screen.
     */
    'conversation.input.dock': {
      kind: 'list'
      scope: 'session'
      owner: {
        readonly session: { readonly sessionId: string }
        readonly input: { readonly phase: string }
      }
    }
  }

  interface GlobalStandardProps {
    /** The session list, supplied by the runtime's session adapter. */
    readonly useSessions: UseSessionsHook
  }

  interface SessionStandardProps {
    /** One session's live snapshot, supplied by the runtime's session adapter. */
    readonly useSession: UseSessionHook
    readonly sessionId: string
    /** The composer input machine: `sending` is the user's own prompt. */
    readonly useInput: UseInputHook
  }
}
