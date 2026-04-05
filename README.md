# SEIS — Student Engineering Intelligence System

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com)
[![Gemini](https://img.shields.io/badge/Gemini_1.5_Flash-4285F4?style=for-the-badge&logo=google-gemini)](https://deepmind.google/technologies/gemini/)

SEIS is a cutting-edge student engineering platform that combines **Retrieval-Augmented Generation (RAG)**, real-time **Hardware Monitoring**, and **Multimodal AI** (Speech/Vision) into a unified workspace.

## ✨ Key Features

- 🏗️ **Advanced RAG Engine**: Instant semantic search across project documents (PDF, Docx, Python, C++, etc.) using pgvector and sentence-transformers.
- 🔌 **Hardware Synchronization**: Real-time sensor data ingestion via a Serial Bridge (Arduino/ESP32) with AI-driven diagnostic capabilities.
- 🎙️ **Robust Audio Transcription**: MediaRecorder-based speech interface powered by Gemini 1.5 Flash for hands-free documentation and querying.
- 💻 **Code Intelligence**: Direct Git integration to clone and index repositories for deep-context code assistance and debugging.
- 👁️ **Multimodal Vision**: Specialized endpoint for image-based technical Q&A using Gemini Pro Vision.
- 💎 **Liquid Glass UI**: A premium, motion-rich frontend built with Framer Motion and Radix UI.

---

## 🛠️ Architecture & Tech Stack

### Backend
- **Framework**: FastAPI (Python 3.10+)
- **Database**: PostgreSQL with **pgvector**
- **Orchestration**: Custom RAG pipeline with hybrid search
- **LLM**: Google Gemini 1.5 Flash & Pro
- **Hardware Integration**: PySerial bridge for local device communication

### Frontend
- **Framework**: Next.js 15 (App Router)
- **Styling**: TailwindCSS 4 + Liquid Glass Design System
- **Animations**: Framer Motion
- **State Management**: React Hooks + Local Storage sessions

---

## 🚀 Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js 18+
- Supabase Project (with Storage and pgvector enabled)
- Google Gemini API Key

### 2. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```
Create a `.env` in the `backend/` folder:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key
```
Run the server:
```bash
uvicorn main:app --reload
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Access the dashboard at `http://localhost:3000`.

---

## 📜 License
Distribute under the MIT License. See `LICENSE` for more information (if applicable).

---

## 🤝 Contact
Amogh - [@Amogh2k5](https://github.com/Amogh2k5)
Project Link: [SEIS](https://github.com/Amogh2k5/SEIS---Student-Engineering-Intelligence-System)
