# backend/orchestrator/router.py

import json
from backend.tools import rag_tool, coding_tool, hardware_tool
from backend.services.llm import generate_response


# =========================================================
# CONSTANTS & SCHEMA
# =========================================================

CONFIDENCE_THRESHOLD = 0.75     # below this → ask user to clarify mode

VALID_TOOLS = {"document", "code", "hardware"}

TOOL_GROUPS = {
    "document_tools" : {"document"},
    "code_tools"     : {"code"},
    "hardware_tools" : {"hardware"},
}


# =========================================================
# CLARIFICATION QUESTION GENERATOR
# =========================================================

def generate_clarification_question(user_message: str, best_guess: str | None = None) -> str:
    """
    Uses the LLM to generate a short, friendly clarification question
    instead of exposing raw confidence scores to the user.
    """
    from backend.services.supabase_client import supabase
    try:
        resp = supabase.table("folders").select("name").execute()
        doc_folders = sorted([r["name"] for r in (resp.data or [])])
    except Exception:
        doc_folders = []

    devices = hardware_tool.list_devices()

    guess_hint = f"Best guess: {best_guess}." if best_guess else ""

    prompt = f"""
You are a helpful assistant inside SEIS (Student Engineering Intelligence System).

A user sent this message:
"{user_message}"

{guess_hint}
You are not sure which tool or context to use. Ask ONE short, friendly clarification question.
Do NOT mention confidence scores, thresholds, or internal system details.
Do NOT use technical terms like 'mode', 'FORCED', 'tool'.

Available document projects: {doc_folders}
Available hardware devices: {list(devices.keys()) if devices else 'none connected'}

Examples of good clarification questions:
- "Are you asking about the codetest project or the default project?"
- "Should I look through your uploaded files, or analyze a sensor reading?"
- "Which project folder should I search for this?"
- "Do you want me to write code, or look this up in your documents?"

Return ONLY the clarification question. One sentence. No extra text.
"""
    try:
        return generate_response(prompt).strip()
    except Exception:
        return "Could you clarify what you're looking for — a document, code help, or sensor analysis?"



# =========================================================
# MODE PARSER
# =========================================================

def parse_mode(mode_str: str | None):
    """
    Parse the user-supplied mode string into (mode_type, value).

    Accepted formats
    ----------------
    None / omitted   → ("auto",       None)
    "AUTO"           → ("auto",       None)
    "FORCED:<tool>"  → ("forced",     "<tool>")   — validated against VALID_TOOLS
    "RESTRICTED:<g>" → ("restricted", "<group>")  — validated against TOOL_GROUPS
    "document"       → ("direct",     "document") — legacy compat
    "code"           → ("direct",     "code")
    "hardware"       → ("direct",     "hardware")

    Raises ValueError for any unrecognised pattern.
    """
    if mode_str is None:
        return "auto", None

    upper = mode_str.strip().upper()

    if upper == "AUTO":
        return "auto", None

    if upper.startswith("FORCED:"):
        tool = mode_str.split(":", 1)[1].lower()
        if tool not in VALID_TOOLS:
            raise ValueError(
                f"Unknown tool '{tool}' in FORCED mode. "
                f"Valid tools: {sorted(VALID_TOOLS)}"
            )
        return "forced", tool

    if upper.startswith("RESTRICTED:"):
        group = mode_str.split(":", 1)[1].lower()
        if group not in TOOL_GROUPS:
            raise ValueError(
                f"Unknown tool group '{group}' in RESTRICTED mode. "
                f"Valid groups: {sorted(TOOL_GROUPS)}"
            )
        return "restricted", group

    # Legacy direct mode names keep working as before
    lower = mode_str.lower()
    if lower in VALID_TOOLS:
        return "direct", lower

    raise ValueError(
        f"Invalid mode '{mode_str}'. "
        f"Use AUTO, FORCED:<tool>, RESTRICTED:<group>, or {sorted(VALID_TOOLS)}."
    )


# =========================================================
# SESSION MEMORY  (lightweight — last_tool + last_folder only)
# =========================================================

SESSION_STORE: dict[str, dict] = {}
# Shape: { session_id: { "last_tool": str, "last_folder": str | None } }


def session_get(session_id: str | None) -> dict:
    if not session_id:
        return {}
    return SESSION_STORE.get(session_id, {})


def session_update(session_id: str | None, tool: str, folder: str | None = None):
    if not session_id:
        return
    SESSION_STORE[session_id] = {
        "last_tool"  : tool,
        "last_folder": folder
    }


# =========================================================
# ENTRY POINT
# =========================================================

def route_chat(request):

    # ── Parse mode (validates format, raises on bad input) ──
    try:
        mode_type, mode_value = parse_mode(request.mode)
    except ValueError as e:
        return {"error": str(e)}

    # ── Read session hint ──
    session = session_get(getattr(request, "session_id", None))

    # 1️⃣  FORCED / legacy direct → skip planner, execute immediately
    if mode_type in ("forced", "direct"):
        request.mode = mode_value      # normalise for handle_manual
        result = handle_manual(request)
        session_update(
            getattr(request, "session_id", None),
            tool=mode_value,
            folder=result.get("folder_used") if isinstance(result, dict) else None
        )
        return result

    # 2️⃣  Deterministic routing (unambiguous signals: code / instruction)
    deterministic = handle_deterministic(request)
    if deterministic:
        tool = "code"
        session_update(getattr(request, "session_id", None), tool=tool)
        return deterministic

    # 3️⃣  LLM Planner classification
    # Inject session folder hint so find_best_folder can favour the last project
    request._session_folder_hint = session.get("last_folder")
    decision = planner_classify(request)

    # 4️⃣  RESTRICTED: enforce tool group before execution
    if mode_type == "restricted":
        allowed = TOOL_GROUPS[mode_value]
        if decision.get("tool") not in allowed:
            return {
                "error": (
                    f"Planner selected '{decision.get('tool')}' but mode "
                    f"restricts to group '{mode_value}': {sorted(allowed)}."
                ),
                "clarification_needed": True,
                "suggested_modes": [f"FORCED:{t}" for t in VALID_TOOLS] + ["AUTO"]
            }

    result = execute_planner_decision(request, decision)

    # Write session after successful execution (not on clarification)
    if isinstance(result, dict) and not result.get("clarification_needed"):
        session_update(
            getattr(request, "session_id", None),
            tool=decision.get("tool", ""),
            folder=result.get("folder_used")
        )

    return result



# =========================================================
# MANUAL MODE (UNCHANGED)
# =========================================================

def handle_manual(request):

    if request.mode == "document":
        return rag_tool.run(
            question=request.question,
            folder=getattr(request, "folder", None)   # None = auto-select
        )

    if request.mode == "code":

        if request.task == "generate":
            return coding_tool.run(
                task="generate",
                instruction=request.instruction,
                language=request.language
            )

        return coding_tool.run(
            task="fix",
            code=request.code,
            error_log=request.error_log,
            language=request.language
        )

    if request.mode == "hardware":
        return hardware_tool.analyze(
            device_id=request.device_id,
            sensor_type=request.sensor_type,
            question=request.question
        )

    return {"error": "Invalid manual mode"}


# =========================================================
# DETERMINISTIC ROUTING (UNCHANGED)
# =========================================================

def handle_deterministic(request):

    # Code Fix — unambiguous: code payload present
    if request.code:
        return coding_tool.run(
            task="fix",
            code=request.code,
            error_log=request.error_log,
            language=request.language
        )

    # Code Generate — unambiguous: instruction payload present
    if request.instruction:
        return coding_tool.run(
            task="generate",
            instruction=request.instruction,
            language=request.language
        )

    # A bare question is ambiguous (could be document, hardware, etc.)
    # Let it fall through to the LLM planner for proper classification.
    return None


# =========================================================
# PLANNER — PURE CLASSIFIER (NO TOOL EXECUTION)
# =========================================================

def planner_classify(request):

    devices = hardware_tool.list_devices()

    # Collect available document project folders so the planner knows what exists
    from backend.services.supabase_client import supabase
    try:
        resp = supabase.table("folders").select("name").execute()
        doc_folders = sorted([r["name"] for r in (resp.data or [])])
    except Exception:
        doc_folders = []

    planner_prompt = f"""
You are a routing classifier for an AI backend called SEIS.

Available tools:
- document  : answers questions using uploaded files, datasheets, code repositories, reports
- code      : generates or fixes code
- hardware  : analyzes live sensor readings from physical devices

Available document project folders (each contains uploaded files):
{json.dumps(doc_folders)}

Available hardware devices (sensors with live readings):
{json.dumps(devices)}

RULES:
- If the question is about any document, file, datasheet, specification, report, or code file that
  would exist in the document folders above, classify as "document".
- If the question asks to generate, fix, debug, or refactor code, classify as "code".
- If the question refers to a device, sensor, or live reading, classify as "hardware".
- Only return "none" if the question does not fit any tool at all.

User message:
{request.question or request.instruction or ""}

Return strictly valid JSON only:

{{
  "tool": "document | code | hardware | none",
  "confidence": 0.0,
  "device_id": "string_or_null",
  "sensor_type": "string_or_null"
}}
"""

    response = generate_response(planner_prompt)

    # Gemini sometimes wraps JSON in ```json ... ``` — strip fences before parsing
    cleaned = response.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]   # drop opening fence line
        cleaned = cleaned.rsplit("```", 1)[0]   # drop closing fence
        cleaned = cleaned.strip()

    try:
        decision = json.loads(cleaned)
    except Exception:
        return {
            "tool": "none",
            "confidence": 0.0
        }

    return decision



# =========================================================
# EXECUTION PHASE (ROUTER-CONTROLLED)
# =========================================================

def execute_planner_decision(request, decision):

    tool       = decision.get("tool")
    confidence = float(decision.get("confidence", 0))

    # ── 1. Schema validation ──────────────────────────────
    if tool not in VALID_TOOLS:
        if tool == "none" or tool is None:
            user_message = request.question or request.instruction or ""
            question = generate_clarification_question(user_message)
            return {
                "clarification_needed": True,
                "answer": question
            }
        return {"error": f"Unknown tool '{tool}' returned by planner."}

    # ── 2. Argument validation ────────────────────────────
    arg_error = _validate_tool_args(request, tool, decision)
    if arg_error:
        return {"error": arg_error}

    # ── 3. Confidence gate ────────────────────────────────
    if confidence < CONFIDENCE_THRESHOLD:
        user_message = request.question or request.instruction or ""
        question = generate_clarification_question(user_message, best_guess=tool)
        return {
            "clarification_needed": True,
            "answer": question
        }

    # ── 4. Execute ────────────────────────────────────────
    if tool == "document":
        return rag_tool.run(
            question=request.question,
            folder=getattr(request, "folder", None)   # None = auto-select
        )

    if tool == "code":
        if request.code:
            return coding_tool.run(
                task="fix",
                code=request.code,
                error_log=request.error_log,
                language=request.language
            )
        # Use instruction if provided; fall back to question so that
        # natural language requests from the chat tab work too.
        instruction = request.instruction or request.question
        if instruction:
            return coding_tool.run(
                task="generate",
                instruction=instruction,
                language=request.language
            )
        return {"error": "Code request missing required fields."}

    if tool == "hardware":
        device_id   = decision.get("device_id")
        sensor_type = decision.get("sensor_type")
        return hardware_tool.analyze(
            device_id=device_id,
            sensor_type=sensor_type,
            question=request.question
        )

    return {"error": "Unsupported planner decision."}


# =========================================================
# ARGUMENT VALIDATOR (called before execution)
# =========================================================

def _validate_tool_args(request, tool: str, decision: dict) -> str | None:
    """
    Returns an error string if required arguments are missing,
    or None if everything is valid.
    """
    if tool == "document":
        if not request.question:
            return "Document tool requires 'question'."

    elif tool == "code":
        # Accept any of: code (fix), instruction (generate), or question (natural language generate)
        if not request.code and not request.instruction and not request.question:
            return "Code tool requires either 'code' (fix) or 'instruction' (generate)."

    elif tool == "hardware":
        if not decision.get("device_id") or not decision.get("sensor_type"):
            return "Hardware tool requires device_id and sensor_type (could not be inferred — use FORCED:hardware with explicit fields)."

    return None
