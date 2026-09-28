import {
  applyEditModeOverrides,
  findEditModeBlock,
  schemaFromDcProps,
  schemaFromEditMode,
  type TweakSchema,
  type TweakValues,
} from "@shared/tweaks"

import type { DeckFiles } from "../deck/files"
import type { DeckMounts } from "../protocol/deck-protocol"

/**
 * Applies tweak values to a deck. `live` backends update the running page;
 * the others change the deck's source and need the page reloaded.
 */
export interface TweakBackend {
  readonly schema: TweakSchema
  readonly live: boolean
  /** Prepare `values` for the next (re)load. Live backends apply via the stage instead. */
  stage(values: TweakValues): void
}

/** Design Component root props, pushed live through `__dcSetProps`. */
export function dcPropsBackend(dcProps: unknown): TweakBackend | null {
  const schema = schemaFromDcProps(dcProps)
  return schema ? { schema, live: true, stage: () => {} } : null
}

const SCRIPT_LIKE = /\.(html?|m?jsx?|tsx?)$/i

/** EDITMODE blocks, rewritten on the way out of the `deck://` protocol. */
export async function editModeBackend(
  files: DeckFiles,
  mounts: DeckMounts,
  mountId: string,
): Promise<TweakBackend | null> {
  const paths: string[] = []
  const defaults: TweakValues = {}
  for (const path of files.list()) {
    if (!SCRIPT_LIKE.test(path) || path.startsWith("_ds/")) continue
    const block = findEditModeBlock((await files.read(path)).toString("utf8"))
    if (!block) continue
    paths.push(path)
    // The first file to declare a key wins.
    for (const [k, v] of Object.entries(block.values)) if (!(k in defaults)) defaults[k] = v
  }
  const schema = schemaFromEditMode(defaults)
  if (!schema) return null
  const withBlocks = new Set(paths)
  return {
    schema,
    live: false,
    stage(values) {
      mounts.setTransform(mountId, (path, body) =>
        withBlocks.has(path)
          ? Buffer.from(applyEditModeOverrides(body.toString("utf8"), values), "utf8")
          : body,
      )
    },
  }
}
