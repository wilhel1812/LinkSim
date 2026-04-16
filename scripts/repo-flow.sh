#!/usr/bin/env bash
export BASH_ENV=""

if [[ -n "${ZSH_VERSION:-}" ]]; then
  exec /bin/bash "$0" "$@"
fi

# Repo workflow helper for LinkSim.
#
# Purpose
# - Automate the normal local Git/GitHub flow for repo changes without bypassing
#   the workflow guardrails in agents.md.
# - Reduce manual step memory while keeping the user in control at every risky
#   point.
#
# Intended workflow
# 1. Inspect current repo state and optionally surface agents guidance.
# 2. Fetch origin/staging.
# 3. Collect issue number, branch slug, commit message, PR title, PR body, and
#    optional validation steps.
# 4. Create or reuse a feature branch from origin/staging using the naming
#    pattern issue/<id>-<slug>.
# 5. Let the user explicitly choose which files to stage.
# 6. Show the staged diff.
# 7. Confirm commit, push, PR creation, optional checks watching, optional
#    merge, and optional local staging sync.
#
# Design rules / guardrails
# - Do not auto-stage all changes. The repo may contain unrelated modified files.
# - Do not silently discard working tree changes.
# - Do not assume the current branch is staging. New branches are created from
#   origin/staging explicitly.
# - Do not hide important Git/GitHub actions behind implicit behavior. Prompt
#   before commit, push, PR creation, merge, and local sync.
# - Prefer plain Bash + git + gh so the script stays repo-local and easy to run.
# - Keep compatibility with macOS's default Bash where practical.
# - Keep terminal UX enhancements lightweight. Prefer simple colors and progress
#   markers over heavy TUI dependencies.
#
# Why the flow works this way
# - Branching from origin/staging avoids accidental dependence on local staging
#   drift.
# - Explicit staging protects against committing generated files or unrelated
#   edits.
# - The inline PR body prompt avoids editor-specific issues during interactive
#   runs.
# - Separate confirmations keep the script as an assistant for the workflow,
#   not a bypass around it.
#
# Editing guidance for future agents
# - Keep this script interactive-first and conservative.
# - Prefer narrow edits over large rewrites. Small mistakes can break the whole
#   flow in shell scripts.
# - After changing this file, validate with: bash -n scripts/repo-flow.sh
# - If changing staging/branch logic, preserve the invariant that the feature
#   branch base is origin/staging.
# - If changing file selection logic, preserve the invariant that only explicit
#   user-selected files are staged.
# - If adding automation, default to more confirmation rather than less.
# - Prefer safe inferred defaults over asking the user to retype information that
#   can be derived from the GitHub issue or the current repo state.
#
# Future-agent usage note
# - An agent may use this script to execute the standard repo workflow, but the
#   script is intentionally not a full policy engine. Agents should still read
#   agents.md and respect repo-specific guidance.

# =============================================================================
# CONFIGURATION
# =============================================================================
# Edit these patterns to match your repo's generated/noise files.
# These files will be excluded from "recommended" staging by default.

GENERATED_FILES=(
  "src/lib/buildInfo.ts"
  "functions/_lib/buildInfo.ts"
)

# =============================================================================

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

DETECTED_BRANCH=""
DETECTED_ISSUE=""
DETECTED_NEED_PUSH=0

if [[ -t 1 ]]; then
  COLOR_BLUE=$'\033[0;34m'
  COLOR_YELLOW=$'\033[0;33m'
  COLOR_RED=$'\033[0;31m'
  COLOR_GREEN=$'\033[0;32m'
  COLOR_BOLD=$'\033[1m'
  COLOR_RESET=$'\033[0m'
else
  COLOR_BLUE=''
  COLOR_YELLOW=''
  COLOR_RED=''
  COLOR_GREEN=''
  COLOR_BOLD=''
  COLOR_RESET=''
fi

say() {
  printf '\n%s[%s]%s %s\n' "$COLOR_BLUE" "$SCRIPT_NAME" "$COLOR_RESET" "$*" >&2
}

warn() {
  printf '\n%s[%s WARNING]%s %s\n' "$COLOR_YELLOW" "$SCRIPT_NAME" "$COLOR_RESET" "$*" >&2
}

fail() {
  printf '\n%s[%s ERROR]%s %s\n' "$COLOR_RED" "$SCRIPT_NAME" "$COLOR_RESET" "$*" >&2
  exit 1
}

step() {
  local current="$1"
  local total="$2"
  local label="$3"
  printf '\n%s[%s/%s]%s %s%s%s\n' "$COLOR_BOLD" "$current" "$total" "$COLOR_RESET" "$COLOR_BLUE" "$label" "$COLOR_RESET"
}

success() {
  printf '%s%s%s\n' "$COLOR_GREEN" "$*" "$COLOR_RESET"
}

is_generated_file() {
  local file="$1"
  for pattern in "${GENERATED_FILES[@]}"; do
    if [[ "$file" == "$pattern" ]]; then
      return 0
    fi
  done
  return 1
}

compact_diff_stats() {
  local -a stats
  local insertions deletions
  
  insertions=$(git diff --numstat 2>/dev/null | awk '{sum += $1} END {print sum+0}')
  deletions=$(git diff --numstat 2>/dev/null | awk '{sum += $2} END {print sum+0}')
  
  if [[ -n "$insertions" && "$insertions" -gt 0 ]]; then
    stats+=("+$insertions")
  fi
  if [[ -n "$deletions" && "$deletions" -gt 0 ]]; then
    stats+=("-$deletions")
  fi
  
  if [[ ${#stats[@]} -gt 0 ]]; then
    printf '%s' "${stats[*]}"
  else
    printf '0'
  fi
}

get_branch_ahead_behind() {
  local branch="$1"
  local base="${2:-origin/staging}"
  
  if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    echo "N/A"
    return
  fi
  
  local ahead behind
  ahead=$(git rev-list --count "$branch" "^$base" 2>/dev/null || echo "0")
  behind=$(git rev-list --count "$base" "^$branch" 2>/dev/null || echo "0")
  
  if [[ "$ahead" -gt 0 && "$behind" -gt 0 ]]; then
    echo "+${ahead}/-${behind}"
  elif [[ "$ahead" -gt 0 ]]; then
    echo "+${ahead}"
  elif [[ "$behind" -gt 0 ]]; then
    echo "-${behind}"
  else
    echo "even"
  fi
}

summarize_branch_state() {
  local branch="$1"
  local summary=""
  
  # Check for local-only commits
  local local_commits
  local_commits=$(git rev-list --count "$branch" "^origin/$branch" 2>/dev/null || echo "0")
  if [[ "$local_commits" -gt 0 ]]; then
    summary+="local-only commits: $local_commits; "
  fi
  
  # Check for uncommitted changes
  if ! git diff --quiet 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; then
    summary+="uncommitted changes: yes; "
  else
    summary+="uncommitted changes: no; "
  fi
  
  # Check ahead/behind staging
  local ahead_behind
  ahead_behind=$(get_branch_ahead_behind "$branch" "origin/staging")
  summary+="vs staging: $ahead_behind"
  
  printf '%s' "$summary"
}

prompt() {
  local message="$1"
  local default="${2-}"
  local value

  if [[ -n "$default" ]]; then
    read -r -p "$message [$default]: " value
    printf '%s' "${value:-$default}"
  else
    read -r -p "$message: " value
    printf '%s' "$value"
  fi
}

confirm() {
  local use_fzf="${3:-0}"
  local message="$1"
  local default="${2:-Y}"
  
  local default_idx=0
  if [[ "$default" == "N" || "$default" == "n" ]]; then
    default_idx=1
  fi
  
  if [[ "$use_fzf" -eq 1 ]] && have_fzf; then
    local action
    action=$(choose_action "$use_fzf" "$default_idx" \
      "Yes" "yes" \
      "No" "no")
    
    case "$action" in
      yes) return 0 ;;
      no) return 1 ;;
      *) return 1 ;;
    esac
  fi
  
  local reply
  local suffix="[y/N]"
  if [[ "$default" == "Y" ]]; then
    suffix="[Y/n]"
  fi

  while true; do
    read -r -p "$message $suffix " reply
    reply="${reply:-$default}"

    case "$reply" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) warn "Please answer yes or no." ;;
    esac
  done
}

multiline_prompt() {
  local heading="$1"
  local default_value="${2-}"
  local line
  local result=""

  echo >&2
  echo "$heading" >&2
  echo "Finish by entering a single dot (.) on its own line." >&2
  if [[ -n "$default_value" ]]; then
    echo "Press Enter on the first line, or enter only '.' immediately, to keep the default template." >&2
    echo >&2
    printf '%s\n' "$default_value" >&2
  fi
  echo >&2

  while IFS= read -r line; do
    if [[ "$line" == "." ]]; then
      if [[ -z "$result" && -n "$default_value" ]]; then
        printf '%s' "$default_value"
        return 0
      fi
      break
    fi

    if [[ -z "$result" && -z "$line" && -n "$default_value" ]]; then
      printf '%s' "$default_value"
      return 0
    fi

    if [[ -n "$result" ]]; then
      result+=$'\n'
    fi
    result+="$line"
  done

  printf '%s' "$result"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

have_fzf() {
  command -v fzf >/dev/null 2>&1
}

ensure_fzf() {
  if have_fzf; then
    return 0
  fi

  warn "fzf not found. fzf provides an interactive arrow-key picker."
  if confirm "Install fzf now?" "Y" "$use_fzf"; then
    say "Installing fzf..."
    brew install fzf
    if have_fzf; then
      say "fzf installed successfully."
      return 0
    else
      fail "fzf installation failed."
    fi
  fi
  return 1
}

choose_with_fzf() {
  local -a items=("$@")
  printf '%s\n' "${items[@]}" | fzf --height=15 --reverse --ansi
}

choose_with_menu() {
  local -a items=("$@")
  local index=0
  local choice

  for item in "${items[@]}"; do
    printf '  %2d) %s\n' "$((index + 1))" "$item"
    index=$((index + 1))
  done
  echo

  while true; do
    read -r -p "Choose [1-${#items[@]}]: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#items[@]} )); then
      printf '%s' "${items[$((choice - 1))]}"
      return 0
    fi
    warn "Please enter a number between 1 and ${#items[@]}"
  done
}

choose_action() {
  local use_fzf="$1"
  local default_idx="$2"
  shift 2
  
  local -a labels=()
  local -a tokens=()
  
  while [[ $# -ge 2 ]]; do
    labels+=("$1")
    tokens+=("$2")
    shift 2
  done
  
  local count=${#labels[@]}
  if [[ $count -eq 0 || -z "$default_idx" ]]; then
    return 1
  fi
  
  if [[ "$use_fzf" -eq 1 ]] && have_fzf; then
    local selected
    selected=$(printf '%s\n' "${labels[@]}" | fzf --height=10 --reverse --prompt="Select: ")
    
    if [[ -z "$selected" ]]; then
      if [[ "$default_idx" =~ ^[0-9]+$ ]] && [[ "$default_idx" -ge 0 && "$default_idx" -lt "$count" ]]; then
        selected="${labels[$default_idx]}"
      else
        return 1
      fi
    fi
    
    local i
    for i in "${!labels[@]}"; do
      if [[ "${labels[$i]}" == "$selected" ]]; then
        printf '%s' "${tokens[$i]}"
        return 0
      fi
    done
    return 1
  fi
  
  local i
  for i in "${!labels[@]}"; do
    printf '  %d) %s%s\n' $((i + 1)) "${labels[$i]}" $([[ $i -eq $default_idx ]] && echo " (default)")
  done
  echo
  
  local choice
  while true; do
    read -r -p "Choose [1-$count]: " choice
    if [[ -z "$choice" ]]; then
      choice=$((default_idx + 1))
    fi
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= count )); then
      printf '%s' "${tokens[$((choice - 1))]}"
      return 0
    fi
    warn "Please enter a number between 1 and $count"
  done
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

get_gh_repo() {
  gh repo view --json name,owner -q '.owner.login + "/" + .name'
}

find_agents_file() {
  local root="$1"
  local candidate

  for candidate in \
    "$root/agents.md" \
    "$root/AGENTS.md" \
    "$root/.github/agents.md" \
    "$root/.github/AGENTS.md"
  do
    if [[ -f "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  candidate="$(find "$root" -maxdepth 3 \( -name 'agents.md' -o -name 'AGENTS.md' \) -print | head -n 1 || true)"
  if [[ -n "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi

  return 1
}

sanitize_slug() {
  local raw="$1"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  raw="$(printf '%s' "$raw" | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
  printf '%s' "$raw"
}

sanitize_commit_fragment() {
  local raw="$1"
  raw="$(sanitize_slug "$raw")"
  raw="$(printf '%s' "$raw" | cut -c1-60)"
  raw="$(printf '%s' "$raw" | sed -E 's/-+$//')"
  printf '%s' "$raw"
}

derive_pr_title_from_branch() {
  local branch="$1"
  local issue_number="$2"
  local title=""
  
  # Extract slug from branch name: issue/125-user-settings → "user settings"
  local slug
  slug="$(printf '%s' "$branch" | sed -E 's/^issue\/[0-9]+-//' | tr '-' ' ')"
  
  if [[ -n "$issue_number" && -n "$slug" ]]; then
    # Capitalize first letter
    slug="$(printf '%s' "$slug" | sed 's/./\U&/')"
    title="#$issue_number $slug"
  elif [[ -n "$issue_number" ]]; then
    title="[#$issue_number]"
  fi
  
  printf '%s' "$title"
}

issue_title_for_number() {
  local issue_number="$1"
  gh issue view "$issue_number" --json title -q .title 2>/dev/null || true
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

ensure_clean_index() {
  local use_fzf="${1:-0}"
  
  if git diff --cached --quiet; then
    return 0
  fi

  while true; do
    echo
    echo "══════════════════════════════════════════════════════════════════"
    echo "              STAGED CHANGES DETECTED"
    echo "══════════════════════════════════════════════════════════════════"
    echo
    echo "You have staged changes from a previous run or manual staging."
    echo "This script stops to avoid mixing old staged files with new staging."
    echo
    
    local action
    action=$(choose_action "$use_fzf" "0" \
      "Review staged changes" "review" \
      "Unstage all and continue" "unstage" \
      "Cancel" "cancel")
    
    case "$action" in
      review)
        echo
        echo "--- Staged files ---"
        git status --short
        echo
        echo "--- Diff stats ---"
        git diff --cached --stat
        echo
        echo "--- Full diff ---"
        git diff --cached
        echo
        ;;
      unstage)
        say "Unstaging all changes..."
        git restore --staged .
        say "All changes unstaged. Working tree is unchanged."
        return 0
        ;;
      cancel)
        fail "Cancelled by user."
        ;;
    esac
  done
}

fetch_staging() {
  say "Fetching origin/staging"
  git fetch origin staging --prune
}

show_repo_state() {
  say "Repository: $(repo_root)"
  say "Current branch: $(current_branch)"
  echo
  git status --short
}

show_agents_guidance() {
  local agents_file="$1"

  say "Found agents guidance: ${agents_file#$PWD/}"
  if confirm "Show the first 120 lines now?" "N"; then
    echo
    sed -n '1,120p' "$agents_file"
  fi
}

choose_files_to_stage() {
  local use_fzf="${1:-0}"
  local files_text
  local -a files
  local index=1
  local selection
  local token
  local -a chosen
  local old_ifs="$IFS"

  files_text="$(git status --short | sed -E 's/^.. //' | awk 'NF' | sort -u)"

  if [[ -z "$files_text" ]]; then
    fail "No modified or untracked files found."
  fi

  IFS=$'\n'
  files=($files_text)
  IFS="$old_ifs"

  if [[ "$use_fzf" -eq 1 && -n "$(command -v fzf)" ]]; then
    say "Selecting files to stage..."
    fzf_choose_files_to_stage "${files[@]}"
    return $?
  fi

  say "Changed files:"
  for file in "${files[@]}"; do
    printf '  %2d) %s\n' "$index" "$file"
    index=$((index + 1))
  done

  echo
  echo "Select files to stage:"
  echo "  Enter file numbers (space-separated), or:"
  echo "    a = all files"
  echo "    r = recommended (exclude generated files)"  
  echo "    p = patch mode (git add -p)"
  echo "    q = quit"
  echo
  read -r -p "Selection: " selection

  if [[ "$selection" == "q" || "$selection" == "quit" ]]; then
    fail "No files selected."
  fi

  if [[ "$selection" == "patch" || "$selection" == "p" ]]; then
    git add -p
    return 0
  fi

  if [[ "$selection" == "all" || "$selection" == "a" ]]; then
    git add -- "${files[@]}"
    return 0
  fi

  if [[ "$selection" == "recommended" || "$selection" == "r" ]]; then
    local -a recommended=()
    for file in "${files[@]}"; do
      if ! is_generated_file "$file"; then
        recommended+=("$file")
      fi
    done
    if [[ ${#recommended[@]} -gt 0 ]]; then
      git add -- "${recommended[@]}"
      return 0
    else
      warn "No non-generated files found."
    fi
  fi

  [[ -n "$selection" ]] || fail "No files selected."

  for token in $selection; do
    [[ "$token" =~ ^[0-9]+$ ]] || fail "Invalid selection: $token"
    (( token >= 1 && token <= ${#files[@]} )) || fail "Selection out of range: $token"
    chosen+=("${files[$((token - 1))]}")
  done

  if [[ ${#chosen[@]} -eq 0 ]]; then
    fail "No files selected."
  fi

  git add -- "${chosen[@]}"
}

fzf_choose_files_to_stage() {
  local -a files=("$@")
  local -a selected
  
  local fzf_preview='
    F=$(echo {})
    if git ls-files --error-unmatch "$F" >/dev/null 2>&1; then
      git diff --color=never "$F"
    else
      echo "[untracked]"
      cat "$F" 2>/dev/null || echo "[cannot preview]"
    fi'

  local generated_count=0
  for file in "${files[@]}"; do
    if is_generated_file "$file"; then
      ((generated_count++))
    fi
  done

  while true; do
    local header_msg="Tab=toggle  Enter=confirm  Alt-A=all  Esc=cancel"
    if [[ "$generated_count" -gt 0 ]]; then
      header_msg="$header_msg  ⚠$generated_count generated"
    fi

    local result
    result=$(printf '%s\n' "${files[@]}" | fzf \
      --multi \
      --height=18 \
      --reverse \
      --ansi \
      --preview="$fzf_preview" \
      --preview-window=down:60% \
      --header="$header_msg" \
      --bind="alt-a:select-all") \
      2>/dev/null
    
    local exit_code=$?
    
    if [[ "$exit_code" -ge 128 ]]; then
      # ESC or Ctrl-C
      if confirm "Cancel file selection?" "Y"; then
        return 1
      fi
      continue
    fi
    
    if [[ -z "$result" ]]; then
      if confirm "No files selected. Try again?" "Y"; then
        continue
      else
        return 1
      fi
    fi
    
    while IFS= read -r line; do
      [[ -n "$line" ]] && selected+=("$line")
    done <<< "$result"
    
    break
  done
  
  if [[ ${#selected[@]} -eq 0 ]]; then
    fail "No files selected."
  fi
  
  local selected_generated=0
  for file in "${selected[@]}"; do
    if is_generated_file "$file"; then
      ((selected_generated++))
    fi
  done
  
  if [[ "$selected_generated" -gt 0 ]]; then
    warn "Note: $selected_generated generated file(s) selected: ${selected_generated}/${#selected[@]}"
  fi
  
  git add -- "${selected[@]}"
}

select_recommended_files() {
  local -a files=("$@")
  local -a recommended=()
  
  for file in "${files[@]}"; do
    if ! is_generated_file "$file"; then
      recommended+=("$file")
    fi
  done
  
  printf '%s\n' "${recommended[@]}"
}

handle_existing_branch() {
  local use_fzf="${1:-0}"
  local branch_name="$2"

  local branch_state
  branch_state=$(summarize_branch_state "$branch_name")
  
  echo
  echo "══════════════════════════════════════════════════════════════════"
  echo "              BRANCH ALREADY EXISTS"
  echo "══════════════════════════════════════════════════════════════════"
  echo
  echo "  Branch: $branch_name"
  echo "  Status: $branch_state"
  echo
  
  if [[ "$branch_state" == *"local-only commits"* ]]; then
    warn "WARNING: Recreating this branch may discard local-only commits."
    echo
  fi
  
  local action
  action=$(choose_action "$use_fzf" "0" \
    "Reuse existing branch - keep current branch and continue" "reuse" \
    "Recreate from origin/staging - WARNING: may lose local history" "recreate" \
    "Cancel" "cancel")
  
  case "$action" in
    recreate)
      say "Recreating branch from origin/staging..."
      git branch -D "$branch_name" 2>/dev/null || true
      git switch -c "$branch_name" --no-track origin/staging
      return 0
      ;;
    cancel)
      fail "Cancelled because branch already exists."
      ;;
    reuse|"")
      say "Using existing branch: $branch_name"
      git switch "$branch_name"
      return 0
      ;;
  esac
}

create_feature_branch() {
  local use_fzf="$1"
  local branch_name="$2"

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    handle_existing_branch "$use_fzf" "$branch_name"
    return 0
  fi

  if git ls-remote --exit-code --heads origin "$branch_name" >/dev/null 2>&1; then
    fail "Remote branch already exists: $branch_name"
  fi

  git switch -c "$branch_name" --no-track origin/staging
}

detect_existing_branch() {
  local current
  current="$(current_branch)"

  if [[ "$current" != issue/* ]]; then
    return 1
  fi

  if git ls-remote --exit-code --heads origin "$current" >/dev/null 2>&1; then
    local commit_count
    commit_count=$(git rev-list --count "origin/$current" ^origin/staging 2>/dev/null || echo "0")

    if [[ "$commit_count" -gt 0 ]]; then
      say "Detected pushed branch: ${current} (${commit_count} commit(s) ahead of staging)"

      local issue_number
      issue_number="$(printf '%s' "$current" | sed -E 's/^issue\/([[:digit:]]+)-.*/\1/')"

      if [[ "$issue_number" =~ ^[[:digit:]]+$ ]]; then
        local issue_title
        issue_title="$(issue_title_for_number "$issue_number")"
        if [[ -n "$issue_title" ]]; then
          say "Linked to issue #${issue_number}: ${issue_title}"
        fi
      fi

      if confirm "Create PR for this branch?" "Y"; then
        DETECTED_BRANCH="$current"
        DETECTED_ISSUE="$issue_number"
        return 0
      fi
    fi
  else
    local local_commit_count
    local_commit_count=$(git rev-list --count HEAD ^origin/staging 2>/dev/null || echo "0")

    if [[ "$local_commit_count" -gt 0 ]]; then
      say "Detected local branch with unpushed commits: ${current} (${local_commit_count} commit(s) ahead of staging)"

      local issue_number
      issue_number="$(printf '%s' "$current" | sed -E 's/^issue\/([[:digit:]]+)-.*/\1/')"

      if [[ "$issue_number" =~ ^[[:digit:]]+$ ]]; then
        local issue_title
        issue_title="$(issue_title_for_number "$issue_number")"
        if [[ -n "$issue_title" ]]; then
          say "Linked to issue #${issue_number}: ${issue_title}"
        fi
      fi

      if confirm "Push and create PR for this branch?" "Y"; then
        DETECTED_BRANCH="$current"
        DETECTED_ISSUE="$issue_number"
        DETECTED_NEED_PUSH=1
        return 0
      fi
    fi
  fi

  return 1
}

get_open_milestones() {
  local repo
  repo="$(get_gh_repo)"
  gh api "repos/$repo/milestones?state=open" -q '.[] | "\(.number) \(.title) (\(.open_issues) open issues)"' 2>/dev/null
}

get_milestone_issues() {
  local repo milestone_number
  repo="$(get_gh_repo)"
  milestone_number="$1"
  gh api "repos/$repo/issues?milestone=$milestone_number&state=open" -q '.[] | "#\(.number) \(.title)"' 2>/dev/null
}

choose_milestone() {
  local use_fzf="$1"
  local -a milestones
  local tmpfile
  tmpfile="$(mktemp)"

  get_open_milestones > "$tmpfile"

  local milestone_count=0
  while IFS= read -r line; do
    milestones+=("$line")
    milestone_count=$((milestone_count + 1))
  done < "$tmpfile"
  rm -f "$tmpfile"

  if [[ $milestone_count -eq 0 ]]; then
    fail "No open milestones found."
  fi

  if [[ "$use_fzf" -eq 1 ]]; then
    say "Select milestone (arrow keys to navigate, enter to select)"
    local selected
    selected="$(printf '%s\n' "${milestones[@]}" | fzf --height=12 --reverse --prompt="Select milestone: ")"
    if [[ -n "$selected" ]]; then
      printf '%s' "$selected" | sed -E 's/^([0-9]+).*/\1/'
      return 0
    fi
    fail "No milestone selected."
  fi

  say "Select milestone"

  local index=0
  for item in "${milestones[@]}"; do
    printf '  %2d) %s\n' "$((index + 1))" "$item"
    index=$((index + 1))
  done
  echo

  local choice
  while true; do
    read -r -p "Choose [1-$milestone_count] or enter milestone #: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= milestone_count )); then
      printf '%s' "${milestones[$((choice - 1))]}" | sed -E 's/^([0-9]+).*/\1/'
      return 0
    elif [[ "$choice" =~ ^[0-9]+$ ]]; then
      say "Interpreting as milestone number: $choice"
      printf '%s' "$choice"
      return 0
    fi
    warn "Please enter a number between 1 and $milestone_count, or a milestone number"
  done
}

choose_issue() {
  local use_fzf="$1"
  local milestone_number="$2"
  local -a issues

  local raw_output
  raw_output="$(get_milestone_issues "$milestone_number")"
  
  if [[ -z "$raw_output" ]]; then
    fail "No open issues in this milestone. (API returned empty)"
  fi

  while IFS= read -r line; do
    issues+=("$line")
  done <<< "$raw_output"

  local issue_count="${#issues[@]}"

  if [[ $issue_count -eq 0 ]]; then
    fail "No open issues in this milestone. (Found $issue_count issues)"
  fi

  if [[ "$use_fzf" -eq 1 ]]; then
    say "Select issue (arrow keys to navigate, enter to select)"
    local selected
    selected="$(printf '%s\n' "${issues[@]}" | fzf --height=15 --reverse --prompt="Select issue: ")"
    if [[ -n "$selected" ]]; then
      printf '%s' "$selected" | sed -E 's/^#([0-9]+).*/\1/'
      return 0
    fi
    fail "No issue selected."
  fi

  say "Select issue"

  local index=0
  for item in "${issues[@]}"; do
    printf '  %2d) %s\n' "$((index + 1))" "$item"
    index=$((index + 1))
  done
  echo

  local choice
  while true; do
    read -r -p "Choose [1-$issue_count] or enter issue #: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= issue_count )); then
      printf '%s' "${issues[$((choice - 1))]}" | sed -E 's/^#([0-9]+).*/\1/'
      return 0
    elif [[ "$choice" =~ ^[0-9]+$ ]]; then
      say "Interpreting as issue number: $choice"
      printf '%s' "$choice"
      return 0
    fi
    warn "Please enter a number between 1 and $issue_count, or an issue number"
  done
}

create_commit() {
  local message="$1"
  git commit -m "$message"
}

push_branch() {
  local branch_name="$1"
  git push -u origin "$branch_name"
}

create_pr() {
  local branch_name="$1"
  local pr_title="$2"
  local pr_body_file="$3"

  gh pr create \
    --base staging \
    --head "$branch_name" \
    --title "$pr_title" \
    --body-file "$pr_body_file"
}

pr_url_for_branch() {
  local branch_name="$1"
  gh pr view --head "$branch_name" --json url -q .url 2>/dev/null || true
}

sync_local_staging() {
  say "Syncing local staging with origin/staging"
  git switch staging
  git fetch origin staging --prune
  git reset --hard origin/staging
}

ensure_staged_changes() {
  if git diff --cached --quiet; then
    fail "No staged changes found after staging step."
  fi
}

run_optional_checks() {
  local root="$1"
  local choice

  echo
  echo "Run checks before commit?"
  echo "  1) none"
  echo "  2) npm test"
  echo "  3) npm run build"
  echo "  4) npm test && npm run build"
  echo "  5) custom command"
  read -r -p "Choose [1-5]: " choice

  case "$choice" in
    1|"")
      say "Skipping checks"
      ;;
    2)
      (cd "$root" && npm test)
      ;;
    3)
      (cd "$root" && npm run build)
      ;;
    4)
      (cd "$root" && npm test && npm run build)
      ;;
    5)
      local cmd
      cmd="$(prompt "Enter command to run from repo root")"
      [[ -n "$cmd" ]] || fail "Custom command cannot be empty."
      (cd "$root" && bash -lc "$cmd")
      ;;
    *)
      fail "Invalid checks option: $choice"
      ;;
  esac
}

show_preflight_summary() {
  local branch="$1"
  local commit_msg="$2"
  local pr_ttl="$3"
  local watch_opt="$4"
  local merge_opt="$5"
  local sync_opt="$6"
  local staged_files_count="${7:-0}"
  local staged_files_list="${8:-}"
  local generated_excluded="${9:-0}"
  
  echo
  echo "══════════════════════════════════════════════════════════════════"
  echo "                    REVIEW BEFORE EXECUTION"
  echo "══════════════════════════════════════════════════════════════════"
  echo
  echo "  Branch:    $branch"
  echo "  Commit:    $commit_msg"
  echo "  PR title:  $pr_ttl"
  echo
  echo "  Files:     $staged_files_count file(s) selected"
  if [[ -n "$staged_files_list" ]]; then
    echo "              $staged_files_list"
  fi
  if [[ "$generated_excluded" -gt 0 ]]; then
    echo "              (⚠ $generated_excluded generated file(s) staged)"
  fi
  echo
  echo "  What happens next:"
  echo "    1. Commit staged changes"
  echo "    2. Push to origin/$branch"
  echo "    3. Create PR → staging"
  if [[ "$watch_opt" == "Y" ]]; then
    echo "    4. Watch PR checks automatically"
    if [[ "$merge_opt" == "Y" ]]; then
      echo "    5. If checks pass, the PR will be squash-merged automatically."
    else
      echo "    5. Manual merge after checks pass"
    fi
  else
    echo "    4. Manual check watching (disabled)"
  fi
  if [[ "$sync_opt" == "Y" ]]; then
    echo "    6. Sync local staging branch"
  else
    echo "    6. Manual staging sync (disabled)"
  fi
  echo
  echo "──────────────────────────────────────────────────────────────────"
  echo "  Auto-settings: watch=$watch_opt  merge=$merge_opt  sync=$sync_opt"
  echo "──────────────────────────────────────────────────────────────────"
  echo
}

confirm_execution() {
  local use_fzf="$1"
  
  local action
  action=$(choose_action "$use_fzf" "0" \
    "Proceed with commit, push, PR, checks, merge, sync" "proceed" \
    "Edit commit message, PR title, or auto-settings" "edit" \
    "Cancel" "cancel")
  
  case "$action" in
    proceed) return 0 ;;
    edit) return 2 ;;
    cancel) return 1 ;;
    *) return 1 ;;
  esac
}

edit_options_menu() {
  local use_fzf="$1"
  local -n opt_watch="$2"
  local -n opt_merge="$3"
  local -n opt_sync="$4"
  local -n commit_msg_ref="$5"
  local -n pr_title_ref="$6"
  
  while true; do
    local action
    action=$(choose_action "$use_fzf" "5" \
      "Edit commit message" "commit" \
      "Edit PR title" "title" \
      "Toggle: watch PR checks (currently: $opt_watch)" "watch" \
      "Toggle: auto-merge when green (currently: $opt_merge)" "merge" \
      "Toggle: sync staging after merge (currently: $opt_sync)" "sync" \
      "Done — proceed with execution" "done" \
      "Cancel" "cancel")
    
    case "$action" in
      commit)
        echo "Current: $commit_msg_ref"
        read -r -p "New commit message: " new_msg
        if [[ -n "$new_msg" ]]; then
          commit_msg_ref="$new_msg"
        fi
        ;;
      title)
        echo "Current: $pr_title_ref"
        read -r -p "New PR title: " new_title
        if [[ -n "$new_title" ]]; then
          pr_title_ref="$new_title"
        fi
        ;;
      watch)
        if [[ "$opt_watch" == "Y" ]]; then opt_watch="N"; else opt_watch="Y"; fi
        ;;
      merge)
        if [[ "$opt_merge" == "Y" ]]; then opt_merge="N"; else opt_merge="Y"; fi
        ;;
      sync)
        if [[ "$opt_sync" == "Y" ]]; then opt_sync="N"; else opt_sync="Y"; fi
        ;;
      done)
        return 0
        ;;
      cancel)
        return 1
        ;;
      *)
        warn "Invalid selection"
        ;;
    esac
  done
}

main() {
  require_cmd git
  require_cmd gh

  local use_fzf=0
  if ensure_fzf; then
    use_fzf=1
  fi

  local root
  local agents_file=""
  local detected_branch=""
  local detected_issue=""
  local detected_need_push=0
  local issue_number
  local issue_title=""
  local issue_title_for_display=""
  local issue_slug_default=""
  local branch_slug_default=""
  local branch_slug_raw
  local branch_slug
  local branch_name
  local commit_message
  local pr_title
  local pr_body_default
  local pr_body
  local pr_body_file
  local commit_fragment_default=""
  local commit_message_default=""
  local pr_title_default=""
  local pr_url=""
  local watched_checks=0
  local opt_watch="Y"
  local opt_merge="Y"
  local opt_sync="Y"

  root="$(repo_root)" || fail "Not inside a git repository."
  cd "$root"

  step 1 7 "Inspect repo"
  ensure_clean_index "$use_fzf"
  show_repo_state

  if agents_file="$(find_agents_file "$root")"; then
    show_agents_guidance "$agents_file"
  else
    warn "No agents.md/AGENTS.md found in the repo. Proceeding without displaying guidance."
  fi

  step 2 7 "Fetch staging"
  fetch_staging

  if detect_existing_branch; then
    detected_branch="$DETECTED_BRANCH"
    detected_issue="$DETECTED_ISSUE"
    detected_need_push="$DETECTED_NEED_PUSH"
  fi

  [[ "$(current_branch)" == "staging" ]] || warn "You are not currently on staging. The script will create the new branch from origin/staging anyway."

  if ! git diff --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    say "Working tree contains changes. That is allowed, but you will explicitly choose what to stage."
  fi

  step 3 7 "Prepare branch and metadata"

  if [[ -n "$detected_branch" ]]; then
    issue_number="$detected_issue"
    branch_name="$detected_branch"
  else
    say "Select an issue to work on"
    local milestone_number
    milestone_number="$(choose_milestone "$use_fzf")"
    issue_number="$(choose_issue "$use_fzf" "$milestone_number")"
    branch_name="issue/${issue_number}-$(sanitize_slug "$(issue_title_for_number "$issue_number")")"
  fi

  issue_title="$(issue_title_for_number "$issue_number")"
  if [[ -n "$issue_title" ]]; then
    issue_title_for_display="$issue_title"
    issue_slug_default="$(sanitize_slug "$issue_title")"
    if [[ -n "$issue_slug_default" ]]; then
      branch_slug_default="$issue_slug_default"
      say "Issue #${issue_number}: ${issue_title}"
    fi
  else
    issue_title_for_display="Issue ${issue_number}"
  fi

  if [[ -z "$detected_branch" ]]; then
    if [[ -n "$branch_slug_default" ]]; then
      branch_slug_raw="$branch_slug_default"
      say "Proposed branch slug: $branch_slug_raw"
      if confirm "Override branch slug?" "N" "$use_fzf"; then
        branch_slug_raw="$(prompt "Branch slug" "$branch_slug_default")"
      fi
    else
      branch_slug_raw="$(prompt "Branch slug")"
    fi
    [[ -n "$branch_slug_raw" ]] || fail "Branch slug cannot be empty."

    branch_slug="$(sanitize_slug "$branch_slug_raw")"
    [[ -n "$branch_slug" ]] || fail "Branch slug became empty after sanitization."

    branch_name="issue/${issue_number}-${branch_slug}"
  fi
  say "Using branch: $branch_name"

  if [[ -n "$issue_title" ]]; then
    commit_fragment_default="$(sanitize_commit_fragment "$issue_title")"
  fi
  if [[ -z "$commit_fragment_default" ]]; then
    commit_fragment_default="$branch_slug"
  fi
  commit_message_default="feat: #${issue_number} ${commit_fragment_default}"
  commit_message="$(prompt "Commit message" "$commit_message_default")"
  [[ -n "$commit_message" ]] || fail "Commit message cannot be empty."

  if [[ -n "$issue_title" ]]; then
    pr_title_default="#${issue_number} ${issue_title}"
  else
    pr_title_default="[#${issue_number}] ${branch_slug_raw}"
  fi
  pr_title="$(prompt "PR title" "$pr_title_default")"
  [[ -n "$pr_title" ]] || fail "PR title cannot be empty."

  pr_body_default=$(cat <<EOF
## Summary
- ${issue_title_for_display}

## Testing
- 

## Issue
- Closes #${issue_number}
EOF
)

  if confirm "Use default PR body?" "Y" "$use_fzf"; then
    pr_body="$pr_body_default"
  else
    pr_body="$(multiline_prompt "PR body" "$pr_body_default")"
  fi
  [[ -n "$pr_body" ]] || fail "PR body cannot be empty."

  pr_body_file="$(mktemp)"
  printf '%s\n' "$pr_body" > "$pr_body_file"

  if [[ -n "$detected_branch" ]]; then
    if [[ "$detected_need_push" -eq 1 ]]; then
      say "Pushing branch to origin..."
      step 4 4 "Push branch and create PR"
      push_branch "$detected_branch"
    else
      say "Skipping checks, staging, commit, push - branch already pushed"
      step 4 4 "Create PR and finish"
    fi
  else
    step 4 7 "Run optional checks"
    run_optional_checks "$root"

    step 5 7 "Create or reuse branch and stage files"
    create_feature_branch "$use_fzf" "$branch_name"
    say "Using branch: $(current_branch)"

    choose_files_to_stage "$use_fzf"
    ensure_staged_changes

    step 6 7 "Show staged diff"
    say "Staged diff summary"
    git --no-pager diff --cached --stat
    echo
    git --no-pager diff --cached

    local staged_count
    staged_count=$(git diff --cached --numstat 2>/dev/null | wc -l)
    staged_count=$((staged_count + 0))
    
    local staged_filesCompact
    staged_filesCompact=$(git diff --cached --name-only 2>/dev/null | head -3 | tr '\n' ', ' | sed 's/,$//')
    local remaining_files
    remaining_files=$(($(git diff --cached --name-only 2>/dev/null | wc -l) - 3))
    if [[ "$remaining_files" -gt 0 ]]; then
      staged_filesCompact="$staged_filesCompact and $remaining_files more"
    fi
    
    local generated_excluded=0
    for f in $(git diff --cached --name-only 2>/dev/null); do
      if is_generated_file "$f"; then
        ((generated_excluded++))
      fi
    done

    show_preflight_summary "$branch_name" "$commit_message" "$pr_title" "$opt_watch" "$opt_merge" "$opt_sync" "$staged_count" "$staged_filesCompact" "$generated_excluded"
    
    confirm_execution "$use_fzf"
    local preflight_result=$?
    
    if [[ "$preflight_result" -eq 1 ]]; then
      fail "Cancelled."
    elif [[ "$preflight_result" -eq 2 ]]; then
      while true; do
        edit_options_menu "$use_fzf" opt_watch opt_merge opt_sync commit_message pr_title
        local edit_result=$?
        
        if [[ "$edit_result" -eq 0 ]]; then
          break
        elif [[ "$edit_result" -eq 1 ]]; then
          fail "Cancelled."
        fi
      done
      
      show_preflight_summary "$branch_name" "$commit_message" "$pr_title" "$opt_watch" "$opt_merge" "$opt_sync" "$staged_count" "$staged_filesCompact" "$generated_excluded"
      
      confirm_execution "$use_fzf"
      local retry_result=$?
      if [[ "$retry_result" -ne 0 ]]; then
        fail "Cancelled after edit."
      fi
    fi

    step 6 7 "Commit and push"
    create_commit "$commit_message"
    push_branch "$branch_name"

    step 7 7 "Create PR and finish"
  fi

  create_pr "$branch_name" "$pr_title" "$pr_body_file"

  pr_url="$(pr_url_for_branch "$branch_name")"
  if [[ -n "$pr_url" ]]; then
    say "PR created: $pr_url"
  fi

  if [[ "$opt_watch" == "Y" ]]; then
    watched_checks=1
    gh pr checks --watch
  fi

  if [[ "$opt_merge" == "Y" && "$watched_checks" -eq 1 ]]; then
    gh pr merge --squash --delete-branch
  fi

  if [[ "$opt_sync" == "Y" ]]; then
    sync_local_staging
  fi

  rm -f "$pr_body_file"

  echo
  success "✓ Workflow complete"
  success "✓ Branch: $(current_branch)"
  if [[ -n "$commit_message" ]]; then
    success "✓ Commit: $commit_message"
  fi
  if [[ -n "$pr_url" ]]; then
    success "✓ PR: $pr_url"
  fi
}

main "$@"