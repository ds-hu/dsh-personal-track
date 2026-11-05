/**
 * `t`, for a panel that is rendered from one root.
 *
 * The shell hands every outlet a translate function; this plugin's components
 * are not outlets — they are one React tree mounted inside one panel — so the
 * binding is carried by context instead of by props, and the tree re-renders
 * once when the language changes. That is the whole mechanism:
 *
 * - the dictionaries are registered by the plugin body (`apply`), so their
 *   lifetime is the plugin's, not a component's, and a re-mount cannot register
 *   the same namespace twice;
 * - {@link CopyProvider} subscribes to the locale revision — a language switch
 *   is not a re-mount, so without the subscription every label would keep the
 *   language it was first rendered in;
 * - {@link useCopy} is the only way in, and a component rendered outside the
 *   provider throws instead of quietly saying `undefined` somewhere.
 *
 * Pure modules (the report, the formatters) take a {@link Copy} as an argument
 * rather than reaching for the context: they are called from tests with a plain
 * function and from components with the bound one, and neither needs React.
 */
import { createContext, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import { COPY_NAMESPACE, type LocaleService } from '../locale.ts'
import { EN, ZH, type CopyKey } from './table.ts'

/** A translate function for this plugin's own keys. */
export interface Copy {
  (key: CopyKey, params?: Record<string, string | number>): string
  /**
   * The active language id, for the handful of formatters that cannot be
   * spelled with a placeholder (`Intl` wants a tag, not a sentence). It rides
   * on `t` so a formatter needs one argument, not two that could disagree.
   */
  readonly language: string
}

/** The dictionaries the plugin body registers, in one place. */
export const DICTIONARIES = { zh: ZH, en: EN }

const CopyContext = createContext<Copy | null>(null)

/** Read the panel's `t`. Throws outside {@link CopyProvider}, by design. */
export function useCopy(): Copy {
  const copy = useContext(CopyContext)
  if (copy === null) {
    throw new Error('personal-track: a component read the copy outside <CopyProvider>')
  }
  return copy
}

/**
 * Subscribe one subtree to the active language.
 *
 * `subscribe` covers both things that change what a key says: the active locale
 * and the dictionaries themselves — the service bumps its revision for either,
 * so a late registration cannot leave a rendered label behind.
 */
export function CopyProvider({ locale, children }: {
  readonly locale: LocaleService
  readonly children: ReactNode
}): JSX.Element {
  const [revision, setRevision] = useState(0)
  useEffect(() => locale.subscribe(() => setRevision(value => value + 1)), [locale])
  // `revision` is a dependency on purpose: the bound function and the language
  // id must be rebuilt on a switch, because a stable context value would leave
  // every consumer showing the language it first mounted in.
  const copy = useMemo<Copy>(() => {
    const bound = locale.bind(COPY_NAMESPACE)
    const translate = (key: CopyKey, params?: Record<string, string | number>): string => bound(key, params)
    return Object.assign(translate, { language: locale.getLocale().active })
  }, [locale, revision])
  return <CopyContext.Provider value={copy}>{children}</CopyContext.Provider>
}
