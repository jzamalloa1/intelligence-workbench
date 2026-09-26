"""Durable memory for this deployment."""

from managed_deepagents import MemoryLayer, define_memory

# Memory is opt-in: without this file the agent keeps nothing between runs.
#
# `agent=MemoryLayer()` mounts one deployment-shared tree at `/memories/agent/`,
# read/write. `/memories/agent/AGENTS.md` is hot memory — loaded into every run —
# and other files under that path are read on demand. Every caller of this
# deployment shares it, so keep procedural knowledge there and never per-person
# facts, API keys, or tokens. Omitting every layer keeps no durable memory.
#
# MDA 0.8 added a second layer, `user=MemoryLayer(allow=...)`, mounted at
# `/memories/user/` and scoped to the caller. It is deliberately NOT enabled: the
# runtime only grants it to a "trusted person" (a verified Studio user or a managed
# Slack DM), and a browser talking to `mda dev` through CopilotKit is neither — so it
# would mount for nobody here. Revisit with identity.py in Milestone 8. (The old
# `scope="agent"` form is still accepted by the Python function but rejected by the
# 0.8 CLI at build time.)
#
# The shared slice is a trust boundary. Because runs can write hot memory and hot
# memory is injected into every later run, whatever one caller gets the agent to
# save is read by everyone after them — instructions included. Treat memory as
# untrusted input, keep authority (tool access, approvals) in agent.py rather than
# in memory, and drop the layer if your callers should not influence each other.
#
# The content lives in LangSmith Context Hub, not in this file: deploys never
# overwrite what earlier runs learned.
memory = define_memory(agent=MemoryLayer())
