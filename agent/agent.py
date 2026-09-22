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
from langchain.agents.middleware import InterruptOnConfig, TodoListMiddleware
from managed_deepagents import define_deep_agent

from agent_core.models import build_model, describe
from agent_core.subagents import build_subagents
from middleware.errors import FriendlyErrorMiddleware
from middleware.guards import call_limit
from middleware.provider_prompt import ProviderPromptMiddleware
from tools.charts import render_chart
from tools.research import research

print(f"[agent] {describe()}")

agent = define_deep_agent(
    name="workbench",  # becomes the LangGraph assistant id == CopilotKit graphId
    model=build_model("lead"),
    # render_chart is lead-only: subagents gather and summarize, the lead
    # synthesizes and is the one that decides something deserves a chart.
    tools=[research, render_chart],
    subagents=build_subagents(),
    # Human-in-the-loop. Only `execute` is gated: it is the one tool that runs
    # arbitrary code, and gating a tool the agent calls constantly (research)
    # would turn every run into a clickfest without buying any safety.
    #
    # This pauses the run via LangGraph's interrupt mechanism, which surfaces to
    # the browser as an `on_interrupt` event carrying
    # `{action_requests, review_configs}`; the frontend resumes it with
    # `{"decisions": [...]}` — one decision per request, in order. See
    # ApprovalCard.tsx, and README's "Steering" section for the round trip.
    interrupt_on={
        "execute": InterruptOnConfig(
            allowed_decisions=["approve", "edit", "reject"],
            description=(
                "This command runs in the sandbox VM. Review it before it executes — "
                "you can edit the command or reject it outright."
            ),
        )
    },
    # Order is explicit and never inferred.
    #   1. CopilotKit first  — installs shared state and frontend tools before
    #      anything else inspects the request.
    #   2. Todo list         — contributes the `write_todos` tool and a `todos`
    #      state field. NOT provided by MDA or by deepagents' default profile
    #      (verified: managed_deepagents has zero references to it, and the
    #      compiled agent's tool list lacked write_todos until this was added).
    #      The Plan Board panel has no data source without it.
    #   3. Provider prompt   — appends provider steering, so it must run after
    #      anything else that contributes to the system prompt.
    #   4. Friendly errors   — must sit OUTSIDE the model call it protects, so it
    #      wraps everything downstream of it and catches provider failures before
    #      they abort the run and surface as a bare "An internal error occurred".
    #   5. Call limit last   — the outermost ceiling on the whole run.
    middleware=[
        CopilotKitMiddleware(),
        TodoListMiddleware(),
        ProviderPromptMiddleware(),
        FriendlyErrorMiddleware(),
        call_limit(),
    ],
)
