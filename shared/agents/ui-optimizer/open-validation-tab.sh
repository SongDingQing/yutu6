#!/usr/bin/env bash
# Reuse one browser tab for UI validation screenshots.
# Targets Safari and Google Chrome because those are the browsers used by Peekaboo checks.
set -uo pipefail

MODE="open"
WAIT_SECONDS="${VALIDATION_TAB_WAIT:-1}"
URL=""

usage() {
  cat <<'EOF'
Usage:
  open-validation-tab.sh <url> [--wait seconds]
  open-validation-tab.sh --count <url>
  open-validation-tab.sh --key <url>
  open-validation-tab.sh --self-test

Opens the URL by reusing one Safari/Chrome validation tab when possible.
Matching ignores query/hash and treats localhost as 127.0.0.1.
EOF
}

normalize_key() {
  printf '%s' "$1" |
    sed -E \
      -e 's#^http://localhost:#http://127.0.0.1:#' \
      -e 's#^http://localhost/#http://127.0.0.1/#' \
      -e 's#[?].*$##' \
      -e 's#\#.*$##'
}

self_test() {
  local a b c
  a="$(normalize_key 'http://localhost:41218/workspace?view=office#x')"
  b="$(normalize_key 'http://127.0.0.1:41218/workspace')"
  c="$(normalize_key 'http://localhost:41218/control-room?x=1')"
  [ "$a" = "$b" ] || { echo "key mismatch: $a != $b" >&2; return 1; }
  [ "$c" = "http://127.0.0.1:41218/control-room" ] || { echo "key mismatch: $c" >&2; return 1; }
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --count)
      MODE="count"
      shift
      ;;
    --key)
      MODE="key"
      shift
      ;;
    --wait)
      WAIT_SECONDS="${2:-1}"
      shift 2
      ;;
    --self-test)
      self_test
      exit $?
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      URL="$1"
      shift
      ;;
  esac
done

if [ -z "$URL" ]; then
  usage >&2
  exit 2
fi

if [ "$MODE" = "key" ]; then
  normalize_key "$URL"
  exit 0
fi

if ! command -v osascript >/dev/null 2>&1; then
  if [ "$MODE" = "count" ]; then
    echo "0"
    exit 0
  fi
  echo "open-validation-tab: osascript is required to avoid browser tab pileup" >&2
  exit 1
fi

TARGET_KEY="$(normalize_key "$URL")"

process_running() {
  osascript -e "tell application \"System Events\" to get exists process \"$1\"" 2>/dev/null | grep -qi '^true$'
}

safari_count() {
  osascript - "$TARGET_KEY" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set targetKey to item 1 of argv
  set n to 0
  tell application "Safari"
    repeat with wi from 1 to count of windows
      repeat with ti from 1 to count of tabs of window wi
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then set n to n + 1
        end try
      end repeat
    end repeat
  end tell
  return n as text
end run

on normalizedTabKey(rawUrl)
  if rawUrl is missing value then return ""
  set u to rawUrl as text
  set u to my replaceText("http://localhost:", "http://127.0.0.1:", u)
  set u to my replaceText("http://localhost/", "http://127.0.0.1/", u)
  set u to my stripAfter(u, "#")
  set u to my stripAfter(u, "?")
  return u
end normalizedTabKey

on stripAfter(sourceText, marker)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to marker
  set parts to text items of sourceText
  set AppleScript's text item delimiters to oldDelims
  return item 1 of parts
end stripAfter

on replaceText(searchText, replacementText, sourceText)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set replacedText to parts as text
  set AppleScript's text item delimiters to oldDelims
  return replacedText
end replaceText
APPLESCRIPT
}

safari_reuse() {
  osascript - "$TARGET_KEY" "$URL" <<'APPLESCRIPT'
on run argv
  set targetKey to item 1 of argv
  set targetUrl to item 2 of argv
  set keepWindow to 0
  set keepTab to 0
  tell application "Safari"
    repeat with wi from 1 to count of windows
      repeat with ti from 1 to count of tabs of window wi
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then
            set keepWindow to wi
            set keepTab to ti
            exit repeat
          end if
        end try
      end repeat
      if keepWindow is not 0 then exit repeat
    end repeat

    if keepWindow is 0 then return "missing Safari"

    repeat with wi from (count of windows) to 1 by -1
      repeat with ti from (count of tabs of window wi) to 1 by -1
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then
            if not (wi is keepWindow and ti is keepTab) then close tab ti of window wi
          end if
        end try
      end repeat
    end repeat

    set current tab of window keepWindow to tab keepTab of window keepWindow
    set URL of tab keepTab of window keepWindow to targetUrl
    set index of window keepWindow to 1
    activate
  end tell
  return "reused Safari"
end run

on normalizedTabKey(rawUrl)
  if rawUrl is missing value then return ""
  set u to rawUrl as text
  set u to my replaceText("http://localhost:", "http://127.0.0.1:", u)
  set u to my replaceText("http://localhost/", "http://127.0.0.1/", u)
  set u to my stripAfter(u, "#")
  set u to my stripAfter(u, "?")
  return u
end normalizedTabKey

on stripAfter(sourceText, marker)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to marker
  set parts to text items of sourceText
  set AppleScript's text item delimiters to oldDelims
  return item 1 of parts
end stripAfter

on replaceText(searchText, replacementText, sourceText)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set replacedText to parts as text
  set AppleScript's text item delimiters to oldDelims
  return replacedText
end replaceText
APPLESCRIPT
}

safari_open_new() {
  osascript - "$URL" <<'APPLESCRIPT'
on run argv
  set targetUrl to item 1 of argv
  tell application "Safari"
    if (count of windows) is 0 then
      make new document with properties {URL:targetUrl}
    else
      tell window 1
        set newTab to make new tab at end of tabs with properties {URL:targetUrl}
        set current tab to newTab
      end tell
    end if
    activate
  end tell
  return "opened Safari"
end run
APPLESCRIPT
}

safari_close_all() {
  osascript - "$TARGET_KEY" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set targetKey to item 1 of argv
  tell application "Safari"
    repeat with wi from (count of windows) to 1 by -1
      repeat with ti from (count of tabs of window wi) to 1 by -1
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then close tab ti of window wi
        end try
      end repeat
    end repeat
  end tell
end run

on normalizedTabKey(rawUrl)
  if rawUrl is missing value then return ""
  set u to rawUrl as text
  set u to my replaceText("http://localhost:", "http://127.0.0.1:", u)
  set u to my replaceText("http://localhost/", "http://127.0.0.1/", u)
  set u to my stripAfter(u, "#")
  set u to my stripAfter(u, "?")
  return u
end normalizedTabKey

on stripAfter(sourceText, marker)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to marker
  set parts to text items of sourceText
  set AppleScript's text item delimiters to oldDelims
  return item 1 of parts
end stripAfter

on replaceText(searchText, replacementText, sourceText)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set replacedText to parts as text
  set AppleScript's text item delimiters to oldDelims
  return replacedText
end replaceText
APPLESCRIPT
}

chrome_count() {
  osascript - "$TARGET_KEY" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set targetKey to item 1 of argv
  set n to 0
  tell application "Google Chrome"
    repeat with wi from 1 to count of windows
      repeat with ti from 1 to count of tabs of window wi
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then set n to n + 1
        end try
      end repeat
    end repeat
  end tell
  return n as text
end run

on normalizedTabKey(rawUrl)
  if rawUrl is missing value then return ""
  set u to rawUrl as text
  set u to my replaceText("http://localhost:", "http://127.0.0.1:", u)
  set u to my replaceText("http://localhost/", "http://127.0.0.1/", u)
  set u to my stripAfter(u, "#")
  set u to my stripAfter(u, "?")
  return u
end normalizedTabKey

on stripAfter(sourceText, marker)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to marker
  set parts to text items of sourceText
  set AppleScript's text item delimiters to oldDelims
  return item 1 of parts
end stripAfter

on replaceText(searchText, replacementText, sourceText)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set replacedText to parts as text
  set AppleScript's text item delimiters to oldDelims
  return replacedText
end replaceText
APPLESCRIPT
}

chrome_reuse() {
  osascript - "$TARGET_KEY" "$URL" <<'APPLESCRIPT'
on run argv
  set targetKey to item 1 of argv
  set targetUrl to item 2 of argv
  set keepWindow to 0
  set keepTab to 0
  tell application "Google Chrome"
    repeat with wi from 1 to count of windows
      repeat with ti from 1 to count of tabs of window wi
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then
            set keepWindow to wi
            set keepTab to ti
            exit repeat
          end if
        end try
      end repeat
      if keepWindow is not 0 then exit repeat
    end repeat

    if keepWindow is 0 then return "missing Chrome"

    repeat with wi from (count of windows) to 1 by -1
      repeat with ti from (count of tabs of window wi) to 1 by -1
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then
            if not (wi is keepWindow and ti is keepTab) then close tab ti of window wi
          end if
        end try
      end repeat
    end repeat

    set active tab index of window keepWindow to keepTab
    set URL of tab keepTab of window keepWindow to targetUrl
    set index of window keepWindow to 1
    activate
  end tell
  return "reused Chrome"
end run

on normalizedTabKey(rawUrl)
  if rawUrl is missing value then return ""
  set u to rawUrl as text
  set u to my replaceText("http://localhost:", "http://127.0.0.1:", u)
  set u to my replaceText("http://localhost/", "http://127.0.0.1/", u)
  set u to my stripAfter(u, "#")
  set u to my stripAfter(u, "?")
  return u
end normalizedTabKey

on stripAfter(sourceText, marker)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to marker
  set parts to text items of sourceText
  set AppleScript's text item delimiters to oldDelims
  return item 1 of parts
end stripAfter

on replaceText(searchText, replacementText, sourceText)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set replacedText to parts as text
  set AppleScript's text item delimiters to oldDelims
  return replacedText
end replaceText
APPLESCRIPT
}

chrome_open_new() {
  osascript - "$URL" <<'APPLESCRIPT'
on run argv
  set targetUrl to item 1 of argv
  tell application "Google Chrome"
    if (count of windows) is 0 then make new window
    tell window 1
      set newTab to make new tab at end of tabs
      set URL of newTab to targetUrl
      set active tab index to count of tabs
    end tell
    activate
  end tell
  return "opened Chrome"
end run
APPLESCRIPT
}

chrome_close_all() {
  osascript - "$TARGET_KEY" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set targetKey to item 1 of argv
  tell application "Google Chrome"
    repeat with wi from (count of windows) to 1 by -1
      repeat with ti from (count of tabs of window wi) to 1 by -1
        try
          if my normalizedTabKey(URL of tab ti of window wi) is targetKey then close tab ti of window wi
        end try
      end repeat
    end repeat
  end tell
end run

on normalizedTabKey(rawUrl)
  if rawUrl is missing value then return ""
  set u to rawUrl as text
  set u to my replaceText("http://localhost:", "http://127.0.0.1:", u)
  set u to my replaceText("http://localhost/", "http://127.0.0.1/", u)
  set u to my stripAfter(u, "#")
  set u to my stripAfter(u, "?")
  return u
end normalizedTabKey

on stripAfter(sourceText, marker)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to marker
  set parts to text items of sourceText
  set AppleScript's text item delimiters to oldDelims
  return item 1 of parts
end stripAfter

on replaceText(searchText, replacementText, sourceText)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchText
  set parts to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set replacedText to parts as text
  set AppleScript's text item delimiters to oldDelims
  return replacedText
end replaceText
APPLESCRIPT
}

safe_number() {
  case "${1:-0}" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$1" ;;
  esac
}

safari_tabs=0
chrome_tabs=0
process_running "Safari" && safari_tabs="$(safe_number "$(safari_count)")"
process_running "Google Chrome" && chrome_tabs="$(safe_number "$(chrome_count)")"

if [ "$MODE" = "count" ]; then
  echo $((safari_tabs + chrome_tabs))
  exit 0
fi

rc=0
if [ "$safari_tabs" -gt 0 ]; then
  safari_reuse
  rc=$?
  process_running "Google Chrome" && chrome_close_all
elif [ "$chrome_tabs" -gt 0 ]; then
  chrome_reuse
  rc=$?
  process_running "Safari" && safari_close_all
else
  preferred="$(printf '%s' "${VALIDATION_BROWSER:-}" | tr '[:upper:]' '[:lower:]')"
  if [ "$preferred" = "chrome" ] && process_running "Google Chrome"; then
    chrome_open_new
    rc=$?
  else
    safari_open_new
    rc=$?
  fi
fi

if [ "$MODE" = "open" ] && [ "$rc" -ne 0 ]; then
  echo "open-validation-tab: AppleScript failed; refusing to open a new unmanaged tab" >&2
fi

if [ "$MODE" = "open" ] && [ "$rc" -eq 0 ]; then
  sleep "$WAIT_SECONDS"
fi

exit "$rc"
