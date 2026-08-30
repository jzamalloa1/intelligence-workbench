"""Intelligence Workbench — Managed Deep Agent entry point.

Deliberately thin. Everything substantive lives in agent_core/, tools/, and
middleware/; this file only assembles them.

Fields the managed runtime owns and that must NOT be set here:
    backend, store, checkpointer, memory, skills, system_prompt

The system prompt comes from instructions.md (synced to Context Hub), memory from
memory.py, and the sandbox from sandbox/. Setting any of them here fails at
compile time.
"""

from copilotkit import CopilotKitMiddleware
from managed_deepagents import define_deep_agent

from agent_core.models import build_model, describe
from agent_core.subagents import build_subagents
from middleware.guards import call_limit
from middleware.provider_prompt import ProviderPromptMiddleware
from tools.research import research

print(f"[agent] {describe()}")

agent = define_deep_agent(
    name="workbench",  # becomes the LangGraph assistant id == CopilotKit graphId
    model=build_model("lead"),
    tools=[research],
    subagents=build_subagents(),
    # Order is explicit and never inferred.
    #   1. CopilotKit first  — installs shared state and frontend tools before
    #      anything else inspects the request.
    #   2. Provider prompt   — needs the final system prompt, so it runs after
    #      CopilotKit may have contributed context.
    #   3. Call limit last   — the outermost ceiling on the whole run.
    middleware=[
        CopilotKitMiddleware(),
        ProviderPromptMiddleware(),
        call_limit(),
    ],
)
