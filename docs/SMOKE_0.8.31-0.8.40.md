# GUI Smoke Procedure — UnodeAi 0.8.31 → 0.8.49

**What:** the human-only checks for everything shipped since 0.8.31 (the unit/E2E suites don't cover GUI).
**Where:** a **throwaway/test workspace** — ideally a real project with a working `npm test` *and* `npm run
build` so the verifier-gate and Evidence Report have something real to run.
**How:** ✅/❌ each line; for any ❌ note the section + what you saw, so fixes target the right version.

> **Resume note (you are here):** §1–6 ✅, §7 first 3 steps ✅, then stuck on §7's last step because **PM
> delegation broke** (Claude PM hallucinated `Glob`/`Bash`/`Edit`, didn't delegate, HTTP 400). That whole
> path was hardened in **0.8.44–0.8.49**. **Reinstall the 0.8.49 VSIX, run the new §11 FIRST** (it isolates
> the delegation/tool chain on a Claude model), then finish **§7 last step → §8 → §9 → §10**.

## Setup
1. `Extensions → … → Install from VSIX` → **`roam-crew-0.8.49-bundled.vsix`** → reload.
2. Open the test project folder. Open the UnodeAi sidebar (activity bar).
3. `UnodeAi: Set Provider API Key` → set your Roam key. (No account? Settings → Providers → Sign up / Top up.)
4. Confirm the **UnodeAi output channel** shows activation with no errors.

## 1 · Mission Control icon + tab
- [ ] With a file open, a **Roam brand icon** sits in the **editor title bar** (top-right).
- [ ] It's clearly visible on **both** a light and a dark theme (switch themes).
- [ ] Click it → the **Mission Control / Dashboard** opens as an editor tab. (`UnodeAi: Open Mission Control` too.)

## 2 · Status-bar version anchor
- [ ] Bottom-right status bar shows **`⬡ Roam v0.8.49`**.
- [ ] After creating a team it shows the version **and** the agent count (e.g. `Roam v0.8.49 · 2/4`) —
      **the version never disappears** (this was the 0.8.39 fix; pre-fix the count overwrote it).
- [ ] **Collapse the Team section** → the status-bar version is still there. Clicking it reopens the sidebar.

## 3 · Agent Builder model combobox
- [ ] **Build an Agent** (or Edit one): **Model** is a single **type-to-filter combobox** (not search box + dropdown).
- [ ] Typing filters suggestions; picking one sets it; a **hand-typed custom id** is accepted. Same for **Backup model**.
- [ ] **Edit an existing agent and Save** → it keeps its tools (does NOT lose Chat/delegate ability — 0.8.39 guard).

## 4 · Team Packs
- [ ] `Create or Switch Team…` → picker shows **task packs** (Bugfix / Refactor / Test Writer / Release /
      Security Review), grouped apart from knowledge-work presets, each with a description.
- [ ] Pick **Bugfix Crew** → builds a real crew (PM + specialists).
- [ ] No `roam.verifyCommand` set → it **offers** the pack's command; one already set → asks **Replace / Keep Existing**.

## 5 · Guided Add-MCP form
- [ ] **Add MCP Server** (Marketplace → MCP tab, or command) → name → transport → command/URL → env → approval.
- [ ] **URL** rejects a non-http(s) value; **env** rejects a literal secret (e.g. `TOKEN=abc123`), accepts only `${VAR}`.
- [ ] Finish → server shows in **Settings → MCP Servers**. The success toast matches reality:
      **"Added … grant it"** if it mounted, or **"saved but NOT mounted"** if you skipped approval (0.8.39 honesty fix).

## 6 · Cost-savings banner
- [ ] Run a PM task / a few turns, then open the Dashboard → a banner shows **"Mixed-model routing saved you
      $X (N% off)"** with all-premium baseline vs actual. (Blank until turns accrue post-upgrade — expected.)
- [ ] (Honesty check, rare) it can also read **"cost $Y over the all-premium baseline"** — it no longer
      always claims savings (0.8.39 fix). Don't expect to force this; just know amber = over.

## 7 · Verifier-gate honesty  ⭐ (0.8.39 — the moat)
Set `roam.verifyCommand` to a command that is **NOT** in `roam.allowedCommands` (e.g. `make check`) to force the
"blocked" path; or set `roam.commandApproval: none`:
- [ ] Hand the PM a task that changes a file → at completion it reports **"⚠ NOT verified — … blocked by your
      command policy …"** (it does **not** quietly say done).
- [ ] **Generate Evidence Report** → Verdict shows **🚧 Blocked**, not Unverified.
- [ ] (Worktree mode) with a blocked verify command, the lane is **held out of integration** (not merged).
- [ ] Now set a real allowlisted command (`npm test`) that **passes** → completion is clean / Evidence = ✅ Verified;
      make a test **fail** → PM is sent back to fix (bounded), Evidence = ❌ failed with output.

## 8 · Evidence Report
- [ ] After a crew run, `Generate Evidence Report` (or the **📋** in the Team toolbar) opens a Markdown doc:
      **Verdict**, **Work done** per agent, **Files changed**, **Verification**.
- [ ] **Files changed lists only THIS run's files** — run task A, then task B; B's report must not list A's files (0.8.39 fix).
- [ ] No crew activity yet → friendly "no recent crew activity" message (not an empty doc).

## 9 · Crew Mission Control lane board + worktree identity
- [ ] Dashboard first screen = **per-agent lanes**: status dot, current task, files count, cost, context %.
- [ ] Per-lane **Chat** / **Terminal** open the right agent; board-level **Evidence Report** link works.
- [ ] **Worktree mode** (`roam.concurrencyStrategy: worktree`): lanes show a **verified/mergeable** badge; normal
      mode omits that column (not blank/broken).
- [ ] (Identity, 0.8.40) if you have **two agents with the same display name**, each lane's badge / View diff /
      Re-verify / Hand back acts on the **correct** agent (no cross-wiring).

## 10 · Regression sanity
- [ ] Activation clean; create the default team; send a chat → **streamed reply** works.
- [ ] **Plan mode** still blocks writes/commands; **command approval** still prompts.
- [ ] Switch a provider (Roam → OpenRouter) → Settings shows the API-key field (not "CLI auth"); Smart Mode behaves.

## 11 · Multi-model PM delegation + tool discipline  ⭐ (0.8.44–0.8.49 — RUN THIS FIRST)
This is the chain that wedged §7. **Set the PM *and* the Senior Developer to a Claude model** (e.g.
Sonnet/Opus via the gateway) — that's the config that exposed the bugs. Default team, normal (non-worktree) mode.
- [ ] **PM completes a one-file task without flailing.** Give the PM *"add a line 'Canada vs Qatar' to the
      end of README.md"*. As a **working lead** (0.8.59) the PM may either **`assign_task`** to the developer
      **or do the small edit itself** (`Edit`→`apply_edit` aliases) — **both are fine**. The line must land,
      with **no "unknown tool"** error, **no `list_agents` loop**, and **no "prompt-injection / check your
      hooks" refusal** (0.8.59).
- [ ] **Claude developer's edit lands.** The developer (Claude) makes the change — even if it reaches for a
      native `Edit`/`Read`/`Bash`, the tool card resolves to a real Roam tool and the file is actually edited
      (tool-name aliasing + `apply_edit`, 0.8.49). **README.md really contains the new line** afterward.
- [ ] **No HTTP 400 in the output channel** — neither *"text content blocks must be non-empty"* (0.8.42) nor
      *"unexpected tool_use_id … must have a corresponding tool_use"* (0.8.48). The turn completes.
- [ ] **`apply_edit` directly (optional):** ask the developer to *"use a targeted edit to change X to Y"* →
      the tool card shows **`apply_edit`** with a small diff (not a whole-file rewrite); a wrong/duplicate
      snippet returns a clear "not found / appears N times" corrective rather than corrupting the file.
- [ ] **Load-aware routing (multi-agent):** add a **2nd developer**; while one is mid-task, delegate another
      dev task by **role** → it goes to the **idle/stopped** teammate (auto-starts), not the busy one (0.8.46).
- [ ] **Anti-spin:** if a model ever repeats the *same* tool call, it's blocked on the 4th identical call with
      a corrective (you won't usually trigger this — just confirm no infinite `list_agents` loop) (0.8.44).

---
**Result:** ___ / 11 sections clean. Note ❌s with the section number + version so fixes are targeted.
**Priority order given where you stopped:** §11 → §7 (last step) → §8 → §9 → §10.

# Part 2 — 0.8.50 → 0.8.57 (install `roam-crew-0.8.57-bundled.vsix`)

> New since Part 1: path-hallucination recovery + workspace grounding, the parallel-tool-call/tool-pairing
> 400 fixes, the Dashboard "Latest tasks" token panel, `apply_edit`, and per-agent model fine-tuning + tier.
> **Use a Claude model on PM + Developer** (that exposed most of these) and a throwaway repo with a real
> `README.md`. Keep the **Output channel** (`UnodeAi: Show Agent Output`) visible throughout.

## 12 · Path grounding + hallucination recovery  ⭐ (0.8.51 / 0.8.52)
- [ ] Chat the **PM**: *"show me the README file."* → it reads `README.md` and shows the content. **No
      "outside your working folder" give-up**, even though a Claude model may internally try an absolute
      path like `/Users/dev/workspace-xxxx/README.md` (it's re-rooted into your workspace).
- [ ] In the **Output channel**, the model is grounded with a file listing — confirm the read targets the
      **real** `README.md` (not an invented path), and the file content is correct.

## 13 · No HTTP 400 across a delegated run  ⭐ (0.8.54 / 0.8.55 / 0.8.56)
- [ ] PM task: *"In `README.md`, write a 5-paragraph summary of the project."* Let PM read → `list_agents`
      → `assign_task` → developer writes.
- [ ] In the Output channel `Ctrl+F` for **`400`**, **`tool_use_id`**, **`parallel_tool_calls`** →
      **no matches**. The run completes (neither the empty-content, the orphan-`tool_use_id`, nor the
      parallel-call 400 appears).
- [ ] (Wedged-session recovery, optional) if you have an **old chat from before 0.8.54** that used to 400,
      send one more message on 0.8.57 → it **self-heals and continues** (the Output channel notes the
      tool history was flattened). A brand-new chat should never need this.

## 14 · `apply_edit` targeted edit (0.8.49 / 0.8.50)
- [ ] Chat the **Developer**: *"use a targeted edit to change `<some exact line>` to `<new text>` in
      `README.md`."* → the tool card shows a **small diff** of just that line (not a whole-file rewrite),
      and the file really changes.
- [ ] Negative: ask it to targeted-edit a snippet that **doesn't exist** → a clear *"old_string was not
      found"* corrective, and **`README.md` is unchanged** (not blanked/corrupted).

## 15 · Dashboard "Latest tasks" token panel  ⭐ (0.8.53 / 0.8.55)
- [ ] After a PM-led task, `UnodeAi: Show Dashboard` → a **Latest tasks** panel lists recent tasks, each
      a card with **per-agent token bars** (hover = input/output split + cost) + the task's total tokens & cost.
- [ ] The header control **Show last: 3 · 5 · 10 · 20** changes how many tasks show (persists).
- [ ] (Attribution, 0.8.55) run **two tasks on two different agents close together** → each task card lists
      **only its own participants' tokens** (no cross-counting). Numbers need the gateway to report usage.

## 16 · Agent edit: model fine-tuning + per-agent tier  ⭐ (0.8.57)
- [ ] `UnodeAi: Edit Agent` (or the ✎ on an agent) → the page now has a **Model fine-tuning** section
      (temperature, top-P, max tokens, reasoning effort, presence/frequency penalty) and a **Smart Mode
      tier** section.
- [ ] Set e.g. **temperature 0.2** and a **tier**, **Save**, re-open the same agent → the values are
      **retained**. Leaving a fine-tuning field blank = "use global default" (placeholder shows).
- [ ] **Sync:** open **Settings** → the same agent's model params match what you set in the builder (and
      vice-versa).
- [ ] **Per-agent tier takes effect:** enable Smart Mode (`roam.smartMode.enabled: true`), give two
      same-role agents **different tiers**, hand each a task → each runs on the **model mapped to its own
      tier** (visible in the lane/model indicator), proving the per-agent tier overrides the role tier.
- [ ] The **"Manage in Settings →"** link in the tier section opens Settings → Smart Mode.

---
**Result Part 2:** ___ / 5 sections clean (§12–§16). Note ❌s with the section number + version.
