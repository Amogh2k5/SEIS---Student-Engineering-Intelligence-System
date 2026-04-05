"""
backend/services/speech_service.py
──────────────────────────────────────────────────────────────
Robust transcription service using Gemini 1.5 Flash.
Handles API failures, network issues, and potential rate limits 
gracefully for a "Demo Safe" experience.
"""

import logging
import base64
import time
from typing import TypedDict, Optional
from backend.services.llm import client

# Configure logging for transcription events
logger = logging.getLogger(__name__)

class TranscriptionResponse(TypedDict):
    text: str
    error: Optional[str]

def transcribe_audio_robust(audio_bytes: bytes, mime_type: str = "audio/webm") -> TranscriptionResponse:
    """
    Transcribes a chunk of audio using Gemini 1.5 Flash.
    Wraps the call in a try-except to prevent backend crashes on API limits.
    """
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        # ── Gemini Transcription Call
        # We use a very strict prompt to ensure only the transcript is returned.
        prompt = "Transcribe this audio precisely. Return ONLY the text or an empty string if silent. Do not add any conversational filler."
        
        audio_part = {
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(audio_bytes).decode("utf-8"),
            }
        }
        
        contents = [{"parts": [{"text": prompt}, audio_part]}]
        
        response = client.models.generate_content(
            model="models/gemini-2.0-flash", # Fast, robust for audio
            contents=contents,
        )
        
        transcript = response.text.strip()
        logger.info(f"[{timestamp}] [Speech] SUCCESS: Transcribed {len(audio_bytes)} bytes.")
        
        return {"text": transcript, "error": None}

    except Exception as exc:
        err_msg = str(exc)
        err_type = type(exc).__name__
        
        # ── Error Categorization for Debugging
        category = "INTERNAL"
        if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower():
            category = "QUOTA_LIMITED"
        elif "network" in err_msg.lower() or "connection" in err_msg.lower():
            category = "NETWORK"
            
        logger.error(f"[{timestamp}] [Speech] {category} FAILURE: {err_type} - {err_msg}")
        
        # ── Return a safe response that won't break the frontend demo
        return {"text": "", "error": category}
