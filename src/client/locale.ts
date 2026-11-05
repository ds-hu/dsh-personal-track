/**
 * The shell's locale service, as this plugin uses it.
 *
 * **Why the surface is declared here instead of imported.** The package that
 * owns it (`@deepseek-ai/dsh-client-locale`) is the one this repo's toolchain
 * does not carry: its `devDependencies` are pinned to the 0.1.5 line while the
 * running runtime is 0.2.2, and that package does not exist in the 0.1.5 line at
 * all. Importing its declaration file would drag its own type graph (package
 * manifest, settings form) into the build for three method signatures. So the
 * three methods this plugin calls are declared once, here, and the file says
 * where the truth lives:
 *
 * - `register(namespace, { zh, en })` — the typed overload in the runtime also
 *   checks every key against `LocaleNamespaceMap`; this plugin's correctness
 *   rests on {@link ./copy/table.ts} instead, where both dictionaries are
 *   projected from one table, so the key check has nothing left to catch.
 * - `bind(namespace)` — returns a function that reads the *active* locale at
 *   call time, so a `t` obtained once keeps working across a language switch.
 * - `subscribe(listener)` — fires on a language switch and on dictionary
 *   registration; that is what lets React re-render instead of the panel
 *   freezing in the language it booted in.
 *
 * The runtime's real declaration is
 * `<nvm>\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-locale\lib\types\client\index.d.ts`
 * (`LocaleRuntime`), if a future runtime changes the surface, start there.
 */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { Dictionary } from './copy/table.ts'

/** The namespace this plugin owns. One owner per namespace, per the service. */
export const COPY_NAMESPACE = 'personal-track'

/** The part of the locale runtime this plugin calls. */
export interface LocaleService {
  /** Register both baseline dictionaries; returns a disposer. */
  register(namespace: string, dicts: { zh: Dictionary; en: Dictionary }): () => void
  /** A translate function bound to one namespace, stable across switches. */
  bind(namespace: string): Translate
  /** The active language id (`zh`, `en`, or a registered pack). */
  getLocale(): { readonly active: string }
  /** Notified when the active language or the registered dictionaries change. */
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by `@deepseek-ai/dsh-client-locale`, composed by the web app. */
    locale: LocaleService
  }
}
