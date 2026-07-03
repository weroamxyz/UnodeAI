# UnodeAi — Data Handling & Zero Data Retention (ZDR)

> Customer-facing reference. **Layer 1 is verified and unconditional.** Layers 2–3 depend on the model
> provider/gateway you choose — fill the `[FILL IN]` blanks with your gateway's actual policy before
> handing this to a customer, or point the customer at the self-host path (Layer 1c) for provable ZDR
> with no blanks to fill.

UnodeAi's data path has three layers. ZDR depends on all three, and **you control which providers you
route to**, so you control your ZDR posture end-to-end.

```
[ Your machine ]            [ Gateway (optional) ]        [ Upstream model ]
 UnodeAi extension  ──▶    Roam/unode (NewAPI)   ──▶      DeepSeek / Claude / GPT / …
   Layer 1                     Layer 2                        Layer 3
```

---

## Layer 1 — The UnodeAi extension (verified; unconditional)

The extension that runs in VS Code on your machine:

- **No telemetry, no analytics, no phone-home.** UnodeAi does not collect or transmit usage data,
  prompts, code, or any content to Roam/unode for analytics or product purposes. (No analytics SDKs are
  present in the codebase.)
- **Local-first storage — nothing leaves your machine except a model request.** Chat history, team
  config (`.roam/team.json`), message log, file checkpoints, and shared memory (`.roam/memory/`) are all
  stored **locally** in your workspace.
- **Keys in OS secret storage.** Provider API keys live in VS Code SecretStorage — never written to
  `.roam/`, settings files, chat exports, or source control.
- **Content goes only to the model provider you configure.** The only outbound transmission of your code
  or prompts is the inference request to the endpoint you set. Other network calls are metadata only
  (model price list, optional marketplace catalog, documentation links) and carry no user content.

**Net:** the extension itself is zero-retention and telemetry-free. Where your code goes next is your
configured provider's domain (Layers 2–3).

### Layer 1c — Provable end-to-end ZDR: bring your own / self-hosted endpoint
UnodeAi works with **any OpenAI-compatible endpoint**. A customer with strict requirements can point it
at a **self-hosted or in-VPC model** (e.g. an on-prem inference server). In that configuration, prompts
and code never leave the customer's own infrastructure — **ZDR by construction, no third party involved.**

---

## Layer 2 — The Roam / unode gateway (NewAPI) — `[FILL IN your policy]`

The default Roam gateway is built on **NewAPI**, self-hosted infrastructure operated by Roam/unode. NewAPI
is a proxy/aggregator: its retention is a **configuration** choice of the operator, not an inherent
property. State your deployment's policy here:

- **Prompt/completion content:** `[FILL IN — e.g. "Request and response bodies are NOT logged or stored;
  content-/body-logging is disabled."]`
- **Operational/billing metadata:** `[FILL IN — e.g. "We retain token counts, model, timestamp, and cost
  for billing for N days; no message content."]`
- **Caches:** `[FILL IN — e.g. "No request/response bodies are held in Redis or other caches."]`
- **Training:** `[FILL IN — e.g. "Customer content is never used to train or improve any model."]`
- **Retention period & deletion:** `[FILL IN — e.g. "Metadata is purged after N days; no content to
  delete because none is stored."]`

> To make Layer 2 ZDR: in NewAPI, ensure request/response **body logging is OFF** (keep only token-level
> billing metadata), confirm no debug/audit middleware persists payloads, and document the above.

---

## Layer 3 — Upstream model providers — `[FILL IN per channel]`

The gateway forwards to upstream models (DeepSeek, Claude, GPT, Qwen, …). **Each upstream has its own
retention/training policy**, which the gateway cannot override. For a ZDR-sensitive customer, route only
to channels with no-retention / no-training terms (or to self-hosted upstreams).

- **ZDR-eligible channels:** `[FILL IN — list the upstreams/endpoints you certify as no-retention.]`
- **Standard channels:** `[FILL IN — note any that retain or may train, so they're not offered to ZDR
  customers.]`

---

## Customer summary (safe to quote as-is)

> *"The UnodeAi extension is zero-retention and telemetry-free: your code and prompts stay on your
> machine, API keys are held in your OS secret store, and the extension sends content only to the model
> provider you choose — there is no analytics or phone-home to us. End-to-end zero retention is then
> determined by that provider: use a self-hosted / in-VPC model for provable ZDR with no third party, or
> our Roam gateway under its stated retention terms (content logging disabled; billing metadata only)."*

---

*Layer 1 reflects the UnodeAi extension as shipped (verified against the source). Layers 2–3 must be
completed and kept current by the gateway operator; this document is not legal advice.*
