# This repo doubles as a Homebrew tap:
#
#   brew tap wgoodall01/webdeck https://github.com/wgoodall01/webdeck
#   brew install --cask wgoodall01/webdeck/webdeck
#
# `pnpm release vX.Y.Z` bumps `version` here in the release commit. There's no
# checksum: the zip doesn't exist until CI builds the tag.
cask "webdeck" do
  version "0.1.0"
  sha256 :no_check

  url "https://github.com/wgoodall01/webdeck/releases/download/v#{version}/Webdeck-mac-arm64.zip"
  name "Webdeck"
  desc "Presenter for Claude Design HTML decks and PDF slides"
  homepage "https://github.com/wgoodall01/webdeck"

  depends_on arch: :arm64
  depends_on macos: ">= :monterey"

  app "Webdeck.app"

  # The app is ad-hoc signed, not notarized, so Gatekeeper would block the
  # first launch. Homebrew quarantines downloads; lift that for this app only.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Webdeck.app"]
  end

  zap trash: [
    "~/Library/Application Support/Webdeck",
    "~/Library/Logs/Webdeck",
    "~/Library/Preferences/com.allgoodhq.webdeck.plist",
    "~/Library/Saved Application State/com.allgoodhq.webdeck.savedState",
  ]
end
