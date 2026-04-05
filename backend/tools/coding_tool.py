import json
import re
from backend.services.llm import generate_response


# =====================================================
# PROMPT BUILDERS
# =====================================================

def build_fix_prompt(code: str, error_log: str | None, language: str | None) -> str:
    return f"""
You are a senior software engineer.

Fix the provided code. Return the FULL corrected file.
Preserve formatting and indentation.
Do NOT add inline comments explaining the fix.

Language: {language if language else "Not specified"}

Error Log:
{error_log if error_log else "None provided"}

Original Code:
{code}

Return strictly in JSON format:

{{
  "corrected_code": "...",
  "changes": "Fixed: <one sentence only>",
  "reasoning": "Need explanation or examples? Just ask."
}}

Do NOT wrap the JSON in markdown.
Do NOT add any text before or after JSON.
"""


def build_generate_prompt(instruction: str, language: str | None) -> str:
    return f"""
You are a senior software engineer.

Generate clean, working code for the requirement below.
Do NOT include explanations, comments, or examples.
Return ONLY the code itself.

Requirement:
{instruction}

Language: {language if language else "Not specified"}

Return strictly in JSON format:

{{
  "generated_code": "...",
  "explanation": "Need an explanation or examples? Just ask."
}}

Do NOT wrap the JSON in markdown.
Do NOT add any text before or after JSON.
"""


# =====================================================
# JSON EXTRACTION HELPER
# =====================================================

def extract_json(text: str):
    """
    Extract JSON block from model response.
    Handles markdown wrapping and extra text.
    """

    # Remove markdown code fences if present
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)

    # Find first { and last }
    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1:
        raise ValueError("No JSON object found in response.")

    json_str = text[start:end + 1]

    return json.loads(json_str)


# =====================================================
# MAIN ENTRY
# =====================================================

def run(
    task: str,
    code: str | None = None,
    error_log: str | None = None,
    language: str | None = None,
    instruction: str | None = None
):

    # ---------------- FIX MODE ----------------
    if task == "fix":

        if not code or not code.strip():
            return {"error": "Code input is empty"}

        prompt = build_fix_prompt(code, error_log, language)

    # ---------------- GENERATE MODE ----------------
    elif task == "generate":

        if not instruction:
            return {"error": "Instruction required for generate mode"}

        prompt = build_generate_prompt(instruction, language)

    else:
        return {"error": "Invalid task type"}

    # Call LLM
    response_text = generate_response(prompt)

    # Try robust JSON extraction
    try:
        structured = extract_json(response_text)

        # ── Normalize field names ──────────────────────────────────────
        # LLM returns different keys per task. We always expose:
        # `code` + `explanation` — consistent for both fix and generate.

        if task == "fix":
            raw_code    = structured.get("corrected_code", "")
            explanation = (
                structured.get("changes", "") + "\n" +
                structured.get("reasoning", "")
            ).strip()
        else:
            raw_code    = structured.get("generated_code", "")
            explanation = structured.get("explanation", "")

        # Strip markdown fences Gemini sometimes adds inside the code string
        raw_code = re.sub(r"^```[a-zA-Z]*\n?", "", raw_code.strip())
        raw_code = re.sub(r"\n?```$", "", raw_code).strip()

        return {
            "type"       : "code",
            "task"       : task,
            "language"   : language or "not specified",
            "code"       : raw_code,
            "explanation": explanation
        }

    except Exception:
        return {
            "type"       : "code",
            "task"       : task,
            "language"   : language or "not specified",
            "code"       : "",
            "explanation": "Could not parse model output.",
            "raw_output" : response_text
        }
