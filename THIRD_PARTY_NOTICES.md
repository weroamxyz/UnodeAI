# Third-Party Notices

UnodeAi's bundled Marketplace catalog (`marketplace/*.json`) references third-party Model Context
Protocol (MCP) servers and external agent runtimes. UnodeAi does **not** bundle or redistribute
their code — the catalog only contains metadata (name, package/command, and the user-approved
install configuration). Each referenced project is the property of its respective authors and is
governed by its own license.

## Model Context Protocol servers

The MCP server entries (filesystem, git, github, fetch, memory, sqlite, puppeteer, brave-search,
time, sequential-thinking, slack, gitlab, google-maps, everything) reference packages from the
**Model Context Protocol servers** project, licensed under the MIT License.

- Source: https://github.com/modelcontextprotocol/servers (and the archived
  https://github.com/modelcontextprotocol/servers-archived)
- License: MIT — Copyright (c) Anthropic, PBC and the MCP servers contributors.

These packages are fetched and run on the user's machine via `npx`/`uvx` only after the user
explicitly installs and approves them through UnodeAi's MCP approval gate.

## Hermes

The "Hermes Bridge" / "Hermes Operator" entries integrate with **Hermes**, an open-source autonomous
agent by Nous Research, via a user-provided MCP endpoint. UnodeAi does not bundle the Hermes
runtime; the user runs and points UnodeAi at their own Hermes bridge.

- Project: https://github.com/NousResearch (Hermes)

---

If you are a maintainer of a referenced project and would like an entry amended or removed, please
open an issue on the UnodeAi repository.
