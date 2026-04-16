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
  local message="$1"
  local default="${2:-Y}"
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
  if confirm "Install fzf now?" "Y"; then
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

issue_title_for_number() {
  local issue_number="$1"
  gh issue view "$issue_number" --json title -q .title 2>/dev/null || true
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

ensure_clean_index() {
  if ! git diff --cached --quiet; then
    fail "You already have staged changes. Unstage or commit them before running this workflow."
  fi
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

  say "Changed files"
  for file in "${files[@]}"; do
    printf '  %2d) %s\n' "$index" "$file"
    index=$((index + 1))
  done

  echo
  read -r -p "Enter file numbers to stage (space-separated), or type 'patch' for git add -p: " selection

  if [[ "$selection" == "patch" ]]; then
    git add -p
    return 0
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

handle_existing_branch() {
  local branch_name="$1"
  local choice

  warn "Branch already exists: $branch_name"
  echo "  1) switch to existing branch"
  echo "  2) delete local branch and recreate from origin/staging"
  echo "  3) cancel"

  while true; do
    read -r -p "Choose [1-3]: " choice
    case "$choice" in
      1|"")
        git switch "$branch_name"
        return 0
        ;;
      2)
        git branch -D "$branch_name"
        git switch -c "$branch_name" --no-track origin/staging
        return 0
        ;;
      3)
        fail "Cancelled because branch already exists."
        ;;
      *)
        warn "Please choose 1, 2, or 3."
        ;;
    esac
  done
}

create_feature_branch() {
  local branch_name="$1"

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    handle_existing_branch "$branch_name"
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

  root="$(repo_root)" || fail "Not inside a git repository."
  cd "$root"

  step 1 7 "Inspect repo"
  ensure_clean_index
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
      if confirm "Override branch slug?" "N"; then
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

  if confirm "Use default PR body?" "Y"; then
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
    create_feature_branch "$branch_name"
    say "Using branch: $(current_branch)"

    choose_files_to_stage
    ensure_staged_changes

    say "Staged diff summary"
    git --no-pager diff --cached --stat
    echo
    git --no-pager diff --cached

    step 6 7 "Commit and push"
    confirm "Create commit with this staged content?" "Y" || fail "Cancelled before commit."
    create_commit "$commit_message"

    confirm "Push branch to origin?" "Y" || fail "Cancelled before push."
    push_branch "$branch_name"

    step 7 7 "Create PR and finish"
  fi

  confirm "Create PR into staging with GitHub CLI?" "Y" || fail "Cancelled before PR creation."
  create_pr "$branch_name" "$pr_title" "$pr_body_file"

  pr_url="$(pr_url_for_branch "$branch_name")"
  if [[ -n "$pr_url" ]]; then
    say "PR created: $pr_url"
  fi

  if confirm "Watch PR checks now?" "Y"; then
    watched_checks=1
    gh pr checks --watch
  fi

  if [[ "$watched_checks" -eq 1 ]]; then
    if confirm "Merge PR now that checks have been watched?" "Y"; then
      gh pr merge --squash --delete-branch
    fi
  else
    if confirm "Attempt merge when ready?" "N"; then
      gh pr merge --squash --delete-branch
    fi
  fi

  if confirm "Sync local staging now?" "Y"; then
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