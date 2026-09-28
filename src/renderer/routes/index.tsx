import { createFileRoute } from "@tanstack/react-router"
import { FolderOpenIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Picker } from "@/components/picker"
import { Presenter } from "@/components/presenter/presenter"
import { TitleBar } from "@/components/title-bar"
import { bridge, useAppState } from "@/lib/webdeck"

export const Route = createFileRoute("/")({ component: PresenterWindow })

/** The presenter window: whichever screen the app's phase calls for. */
function PresenterWindow() {
  const state = useAppState()
  switch (state.phase) {
    case "presenting":
      return <Presenter state={state} />
    case "picking":
      return <Picker archiveName={state.archiveName} candidates={state.candidates} />
    case "error":
      return (
        <Centered>
          <WarningCircleIcon className="size-10 text-destructive" weight="duotone" />
          <div className="space-y-1 text-center">
            <h1 className="text-base font-medium">Couldn’t open that deck</h1>
            <p className="max-w-md text-sm text-muted-foreground">{state.message}</p>
          </div>
          <OpenButton />
        </Centered>
      )
    case "loading":
      return (
        <Centered>
          <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="text-sm text-muted-foreground">Opening {state.title}…</p>
        </Centered>
      )
    case "idle":
      return (
        <Centered>
          <OpenButton />
        </Centered>
      )
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col">
      <TitleBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-5">{children}</div>
    </div>
  )
}

function OpenButton() {
  return (
    <Button onClick={() => bridge().send("app:open")}>
      <FolderOpenIcon data-icon="inline-start" />
      Open deck…
      <Kbd className="ml-1">⌘O</Kbd>
    </Button>
  )
}
