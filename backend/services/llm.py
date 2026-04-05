from google import genai
import os
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv(dotenv_path=".env")

api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    raise ValueError("GOOGLE_API_KEY not found in environment")

client = genai.Client(api_key=api_key)


def generate_response(prompt: str) -> str:
    """Text-only response — used by the planner and all existing tools (unchanged)."""
    try:
        response = client.models.generate_content(
            model="models/gemini-2.5-flash",
            contents=prompt
        )
        return response.text
    except Exception as exc:
        err = str(exc)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            raise HTTPException(
                status_code=429,
                detail=(
                    "Gemini API quota exhausted (free tier: 20 requests/day). "
                    "Please wait for your quota to reset, or add billing at "
                    "https://aistudio.google.com to increase limits."
                )
            )
        raise


def generate_response_with_image(prompt: str, image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """
    Multimodal response — sends both a text prompt and an image to Gemini Vision.
    Used ONLY by the /vision endpoint. All other existing callers use generate_response().
    """
    try:
        import base64
        image_part = {
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(image_bytes).decode("utf-8"),
            }
        }
        contents = [{"parts": [{"text": prompt}, image_part]}]
        response = client.models.generate_content(
            model="models/gemini-2.5-flash",
            contents=contents,
        )
        return response.text
    except Exception as exc:
        err = str(exc)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            raise HTTPException(
                status_code=429,
                detail=(
                    "Gemini API quota exhausted (free tier: 20 requests/day). "
                    "Please wait for your quota to reset, or add billing at "
                    "https://aistudio.google.com to increase limits."
                )
            )
        raise